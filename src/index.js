import {getCaseInformation} from "./caseRetriever";
import Datastore from "@google-cloud/datastore";
import _ from "lodash";
import fs from "fs";
import app from "commander";
const projectId = "blissful-canyon-138323";

const datastore = Datastore({
    projectId: projectId
});

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

function getArchiveCaseInformation(caseNumber, county) {
    return datastore.get(datastore.key([`${county} county case`, caseNumber]));
}

let promiseChain = Promise.resolve();

function archiveTulsaCaseNum(year, i) {
    var caseNum = `CF-${year}-${i}`;
    promiseChain = promiseChain.then(() => console.log(`Archiving ${caseNum}...`) || archiveCase(caseNum, "tulsa"));
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
app.parse(process.argv);
