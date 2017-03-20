import {getCaseInformation} from "./caseRetriever";
import Datastore from "@google-cloud/datastore";
import _ from "lodash";
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
  .then(() => console.log(`Saved case ${caseNumber} from county ${county} to Datastore.`));
}

const start = 1000;
const end = 5000;

let promiseChain = Promise.resolve();

function archiveTulsaCaseNum(i) {
  var caseNum = `CF-2017-${i}`;
  promiseChain = promiseChain.then(() => console.log(`Archiving ${caseNum}...`) || archiveCase(caseNum, "tulsa"));
}

function deleteArchiveItem(i) {
  var caseNum = `CF-2017-${i}`;
  promiseChain = promiseChain.then(() => console.log(`Purging ${caseNum}...`) || datastore.delete(datastore.key([`tulsa county case`, caseNum])));
}

for(var i=start;i<=end;i++) {
  archiveTulsaCaseNum(i);
  //deleteArchiveItem(i);
}

promiseChain.then(() => console.log(`Completed archive of cases CF-2016-${start} to CF-2016-${end}`));
