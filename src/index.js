import {getCaseInformation} from "./caseRetriever";
import Datastore from "@google-cloud/datastore";
import _ from "lodash";
import fs from "fs";
import app from "commander";
import apiServer, {executeQuery, standardQuery} from "./server";
import {serialize} from "./postgres-serialization";
import pool from "./postgres-pool";
const projectId = "blissful-canyon-138323";

const datastore = Datastore({
    projectId: projectId
});

const google = {
    readCase: function(caseNumber, county) {
        const key = datastore.key([`${county} county case`, caseNumber]);
        return datastore.get(key);
    },
    writeCase: function(caseData, caseNumber, county) {
        const entity = {
          key: datastore.key([`${county} county case`, caseNumber]),
          data: caseInfo
      };

      return datastore.save(entity)
        .then(() => console.log(`Saved case ${caseNumber} from county ${county} to Datastore.`))
        .catch(err => console.log(`Failed to save case ${caseNumber} from county ${county} to Datastore: ${err}.`))
    },
    cleanup:() => {},
    description: "Google Datastore"
}

const postgres = {
    readCase: function(caseNumber, county) {
        return executeQuery(standardQuery(caseNumber, county)).then(data => data.data["case"]);
    },
    writeCase: function(caseData, caseNumber, county) {
        return serialize(Object.assign({}, caseData, { number: caseNumber, county }));
    },
    cleanup:() => {
        pool.close();
    },
    description: "PostgresDB"
}

const oscn = {
    readCase: (caseNumber, county) => getCaseInformation(caseNumber, county)
        .then(caseInfo => caseInfo.counts.length == 0 && caseInfo.parties.length == 0 ? Promise.reject("Not a valid case") : caseInfo ),
    cleanup:() => {},
    description: "OSCN system"
}

const dataStores = {
    google,
    postgres,
    oscn
}

function transferCase(caseNumber, county, source, dest) {
  return source.readCase(caseNumber.county)
    .then(caseData => dest.wrtieCase(caseData, caseNumber, county))
    .then(() => console.log(`Saved case ${caseNumber} from county ${county} to ${dest.description} from ${source.description}.`))
    .catch(err => console.log(`Failed to save case ${caseNumber} from county ${county} to ${dest.description} from ${source.description}: ${err}.`));
}

let promiseChain = Promise.resolve();

function transferCaseNum(year, i, type, county, source, dest) {
    var caseNum = `${type}-${year}-${i}`;
    promiseChain = promiseChain.then(() => console.log(`Archiving ${caseNum}...`) || transferCase(caseNum, county, source, dest));
}

function deleteArchiveItem(year, i) {
    var caseNum = `CF-${year}-${i}`;
    promiseChain = promiseChain.then(() => console.log(`Purging ${caseNum}...`) || datastore.delete(datastore.key([`tulsa county case`, caseNum])));
}

app.version("1.0.0");
app.command("archive <year> <start> <end>")
    .description("Archive cases from the provided year, from start to end.")
    .option("-s, --source <source>", "Source to pull data from (oscn, google, or postgres) (Default: oscn)", "oscn")
    .option("-d, --destination <dest>", "Destination to send data to (google or postgres) (Default: google)", "google")
    .option("-t, --type <type>", "Type of the case (CF, CM, TR, etc) (Default: CF)", "CF")
    .option("-c, --county <county>", "County of the case (tulsa, oklahoma, etc) (Default: tulsa)", "tulsa")
    .action((year, start, end, args) => {
        for(var i=parseInt(start);i<=parseInt(end);i++) {
            transferCaseNum(year, i, args.type, args.county, dataStores[args.source], dataStores[args.dest]);
        }
        promiseChain
            .then(() => console.log(`Completed archive of cases ${args.type}-${year}-${start} to ${args.type}-${year}-${end}`))
            .then(dataStores[args.source].cleanup)
            .then(dataStores[args.dest].cleanup);
    });

app.command("purge <year> <start> <end>")
    .description("Purge cases from the provided year, from start to end.")
    .action((year, start, end) => {
        for(var i=parseInt(start);i<=parseInt(end);i++) {
            deleteArchiveItem(year, i);
        }
        promiseChain
            .then(() => console.log(`Completed purge of cases CF-${year}-${start} to CF-${year}-${end}`));
    });

app.command("export <caseNumber>")
    .description("Export the provided case from oscn to a file")
    .option("-s, --source <source>", "Source to pull data from (oscn, google, or postgres)", "oscn")
    .option("-c, --county <county>", "County of the case (tulsa, oklahoma, etc)", "tulsa")
    .action((caseNumber, args) => {
        dataStores[args.source].readCase(caseNumber, args.county)
            .then(caseInfo => fs.writeFileSync(caseNumber + ".json", JSON.stringify(caseInfo, null, 4)))
            .then(dataStores[args.source].cleanup);
        });

app.command("server <port>")
    .description("Run an api server for querying the data")
    .action((port) => {
        apiServer(parseInt(port), datastore);
    });

app.parse(process.argv);
