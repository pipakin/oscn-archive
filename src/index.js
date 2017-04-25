import {getCaseInformation} from "./caseRetriever";
import Datastore from "@google-cloud/datastore";
import _ from "lodash";
import fs from "fs";
import app from "commander";
import apiServer from "./server";
import {serialize} from "./postgres-serialization";
import pool from "./postgres-pool";
const projectId = "blissful-canyon-138323";

const datastore = Datastore({
    projectId: projectId
});

const google = {
    readCase: function(caseNumber) {

    }
    writeCase: function(case, county, caseNumber) {

    }
}

const postgres = {
    readCase: function(caseNumber) {

    }
    writeCase: function(case, county, caseNumber) {

    }
}

const stores = {
    google,
    postgres
}

function archiveCase(caseNumber, county) {
  return getCaseInformation(caseNumber, county)
  .then(caseInfo => caseInfo.counts.length == 0 && caseInfo.parties.length == 0 ? Promise.reject("Not a valid case") : caseInfo )
  .then(caseInfo => ({
    key: datastore.key([`${county} county case`, caseNumber]),
    data: caseInfo
  })).then(entity => datastore.save(entity))
  .then(() => console.log(`Saved case ${caseNumber} from county ${county} to Datastore.`))
  .catch(err => console.log(`Failed to save case ${caseNumber} from county ${county} to Datastore: ${err}.`));
}

function archiveCasePg(caseNumber, county) {
  return getCaseInformation(caseNumber, county)
  .then(caseInfo => caseInfo.counts.length == 0 && caseInfo.parties.length == 0 ? Promise.reject("Not a valid case") : caseInfo )
  .then(entity => serialize(Object.assign({}, entity, {number: caseNumber, county})))
  .then(() => console.log(`Saved case ${caseNumber} from county ${county} to Postgres database.`))
  .catch(err => console.log(`Failed to save case ${caseNumber} from county ${county} to Postgres database: ${err}.`))
  .then(() => pool.close());
}

function getArchiveCaseInformation(caseNumber, county) {
    return datastore.get(datastore.key([`${county} county case`, caseNumber]));
}

let promiseChain = Promise.resolve();

function archiveTulsaCaseNum(year, i) {
    var caseNum = `CF-${year}-${i}`;
    promiseChain = promiseChain.then(() => console.log(`Archiving ${caseNum}...`) || archiveCase(caseNum, "tulsa"));
}

function archiveTulsaCaseNumPg(year, i, type) {
    var caseNum = `${type}-${year}-${i}`;
    promiseChain = promiseChain.then(() => console.log(`Archiving ${caseNum}...`) || archiveCasePg(caseNum, "tulsa"));
}

function deleteArchiveItem(year, i) {
    var caseNum = `CF-${year}-${i}`;
    promiseChain = promiseChain.then(() => console.log(`Purging ${caseNum}...`) || datastore.delete(datastore.key([`tulsa county case`, caseNum])));
}

app.version("1.0.0");
app.command("archive <year> <start> <end>")
    .description("Archive cases from the provided year, from start to end.")
    .action((year, start, end) => {
        for(var i=parseInt(start);i<=parseInt(end);i++) {
            archiveTulsaCaseNum(year, i);
        }
        promiseChain.then(() => console.log(`Completed archive of cases CF-${year}-${start} to CF-${year}-${end}`));
    });
app.command("archive-pg <year> <start> <end>")
    .description("Archive cases from the provided year, from start to end.")
    .option("-t, --type <type>")
    .action((year, start, end, options) => {
        for(var i=parseInt(start);i<=parseInt(end);i++) {
            archiveTulsaCaseNumPg(year, i, options.type || "CF");
        }
        promiseChain.then(() => console.log(`Completed archive of cases ${options.type || "CF"}-${year}-${start} to ${options.type || "CF"}-${year}-${end}`));
    });

app.command("purge <year> <start> <end>")
    .description("Purge cases from the provided year, from start to end.")
    .action((year, start, end) => {
        for(var i=parseInt(start);i<=parseInt(end);i++) {
            deleteArchiveItem(year, i);
        }
        promiseChain.then(() => console.log(`Completed purge of cases CF-${year}-${start} to CF-${year}-${end}`));
    });

app.command("export <caseNumber>")
    .description("Export the provided case from oscn to a file")
    .action((caseNumber) => {
        getCaseInformation(caseNumber, "tulsa")
            .then(caseInfo => fs.writeFileSync(caseNumber + ".json", JSON.stringify(caseInfo, null, 4)))
        });

app.command("export-archive <caseNumber>")
    .description("Export the provided case from the archive to a file")
    .action((caseNumber) => {
        getArchiveCaseInformation(caseNumber, "tulsa")
            .then(caseInfo => fs.writeFileSync(caseNumber + ".json", JSON.stringify(caseInfo, null, 4)))
        });

app.command("server <port>")
    .description("Run an api server for querying the data")
    .action((port) => {
        apiServer(parseInt(port), datastore);
    });

function transferCase(caseNumber, county) {
    const kind = `${county} county case`;
    return datastore.get(datastore.key([kind, caseNumber]))
        .then(caseEntity => caseEntity[0])
        .then(caseEntity => serialize(Object.assign({}, caseEntity, {number: caseNumber, county})))
        .then(() => console.log(`Saved case ${caseNumber} from county ${county} to Postgres database.`))
        .catch(err => console.log(`Failed to save case ${caseNumber} from county ${county} to Postgres database: ${err}.`));
}

function transferCFCasePromise(year, i, county) {
    return () => transferCase(`CF-${year}-${i}`, county)
}

function transferCFCasesPromise(year, i, county, chunkSize, end) {
    return () => {
        var proms = []
        for(var j=i;j<i+chunkSize && j<=end;j++) {
            proms.push(transferCase(`CF-${year}-${j}`, county));
        }

        return Promise.all(proms);
    };
}

function doAllTasks(tasks, N) {
    const newTasks = [].concat(tasks);
    function pickUpNextTask() {
      if (newTasks.length) {
        return newTasks.shift()();
      }
    }
    function startChain() {
      return Promise.resolve().then(function next() {
        const t = pickUpNextTask()
        if(t)return t.then(next);
        return true;
      });
    }

    var chains = [];
    for (var k = 0; k < N; k += 1) {
      chains.push(startChain());
    }
    return Promise.all(chains);
}

app.command("transfer-archive-pg <year> <start> <end>")
    .description("Copy cases from google datastore to a postgres db for the year provided")
    .action((year, start, end) => {
        const county = "tulsa";

        const caseTasks = _.range(parseInt(start),parseInt(end))
            .map(i => transferCFCasePromise(year, i, county));

        doAllTasks(caseTasks, 10).then(() => pool.close());
    });

app.parse(process.argv);
