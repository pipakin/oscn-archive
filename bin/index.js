"use strict";

var _caseRetriever = require("./caseRetriever");

var _datastore = require("@google-cloud/datastore");

var _datastore2 = _interopRequireDefault(_datastore);

var _lodash = require("lodash");

var _lodash2 = _interopRequireDefault(_lodash);

var _fs = require("fs");

var _fs2 = _interopRequireDefault(_fs);

var _commander = require("commander");

var _commander2 = _interopRequireDefault(_commander);

var _server = require("./server");

var _server2 = _interopRequireDefault(_server);

var _postgresSerialization = require("./postgres-serialization");

var _postgresPool = require("./postgres-pool");

var _postgresPool2 = _interopRequireDefault(_postgresPool);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var projectId = "blissful-canyon-138323";

var datastore = (0, _datastore2.default)({
    projectId: projectId
});

function archiveCase(caseNumber, county) {
    return (0, _caseRetriever.getCaseInformation)(caseNumber, county).then(function (caseInfo) {
        return caseInfo.counts.length == 0 && caseInfo.parties.length == 0 ? Promise.reject("Not a valid case") : caseInfo;
    }).then(function (caseInfo) {
        return {
            key: datastore.key([county + " county case", caseNumber]),
            data: caseInfo
        };
    }).then(function (entity) {
        return datastore.save(entity);
    }).then(function () {
        return console.log("Saved case " + caseNumber + " from county " + county + " to Datastore.");
    }).catch(function (err) {
        return console.log("Failed to save case " + caseNumber + " from county " + county + " to Datastore: " + err + ".");
    });
}

function archiveCasePg(caseNumber, county) {
    return (0, _caseRetriever.getCaseInformation)(caseNumber, county).then(function (caseInfo) {
        return caseInfo.counts.length == 0 && caseInfo.parties.length == 0 ? Promise.reject("Not a valid case") : caseInfo;
    }).then(function (entity) {
        return (0, _postgresSerialization.serialize)(Object.assign({}, entity, { number: caseNumber, county: county }));
    }).then(function () {
        return console.log("Saved case " + caseNumber + " from county " + county + " to Postgres database.");
    }).catch(function (err) {
        return console.log("Failed to save case " + caseNumber + " from county " + county + " to Postgres database: " + err + ".");
    }).then(function () {
        return _postgresPool2.default.close();
    });
}

function getArchiveCaseInformation(caseNumber, county) {
    return datastore.get(datastore.key([county + " county case", caseNumber]));
}

var promiseChain = Promise.resolve();

function archiveTulsaCaseNum(year, i) {
    var caseNum = "CF-" + year + "-" + i;
    promiseChain = promiseChain.then(function () {
        return console.log("Archiving " + caseNum + "...") || archiveCase(caseNum, "tulsa");
    });
}

function archiveTulsaCaseNumPg(year, i, type) {
    var caseNum = type + "-" + year + "-" + i;
    promiseChain = promiseChain.then(function () {
        return console.log("Archiving " + caseNum + "...") || archiveCasePg(caseNum, "tulsa");
    });
}

function deleteArchiveItem(year, i) {
    var caseNum = "CF-" + year + "-" + i;
    promiseChain = promiseChain.then(function () {
        return console.log("Purging " + caseNum + "...") || datastore.delete(datastore.key(["tulsa county case", caseNum]));
    });
}

_commander2.default.version("1.0.0");
_commander2.default.command("archive <year> <start> <end>").description("Archive cases from the provided year, from start to end.").action(function (year, start, end) {
    for (var i = parseInt(start); i <= parseInt(end); i++) {
        archiveTulsaCaseNum(year, i);
    }
    promiseChain.then(function () {
        return console.log("Completed archive of cases CF-" + year + "-" + start + " to CF-" + year + "-" + end);
    });
});
_commander2.default.command("archive-pg <year> <start> <end>").description("Archive cases from the provided year, from start to end.").option("-t, --type <type>").action(function (year, start, end, options) {
    for (var i = parseInt(start); i <= parseInt(end); i++) {
        archiveTulsaCaseNumPg(year, i, options.type || "CF");
    }
    promiseChain.then(function () {
        return console.log("Completed archive of cases " + (options.type || "CF") + "-" + year + "-" + start + " to " + (options.type || "CF") + "-" + year + "-" + end);
    });
});

_commander2.default.command("purge <year> <start> <end>").description("Purge cases from the provided year, from start to end.").action(function (year, start, end) {
    for (var i = parseInt(start); i <= parseInt(end); i++) {
        deleteArchiveItem(year, i);
    }
    promiseChain.then(function () {
        return console.log("Completed purge of cases CF-" + year + "-" + start + " to CF-" + year + "-" + end);
    });
});

_commander2.default.command("export <caseNumber>").description("Export the provided case from oscn to a file").action(function (caseNumber) {
    (0, _caseRetriever.getCaseInformation)(caseNumber, "tulsa").then(function (caseInfo) {
        return _fs2.default.writeFileSync(caseNumber + ".json", JSON.stringify(caseInfo, null, 4));
    });
});

_commander2.default.command("export-archive <caseNumber>").description("Export the provided case from the archive to a file").action(function (caseNumber) {
    getArchiveCaseInformation(caseNumber, "tulsa").then(function (caseInfo) {
        return _fs2.default.writeFileSync(caseNumber + ".json", JSON.stringify(caseInfo, null, 4));
    });
});

_commander2.default.command("server <port>").description("Run an api server for querying the data").action(function (port) {
    (0, _server2.default)(port, datastore);
});

function transferCase(caseNumber, county) {
    var kind = county + " county case";
    return datastore.get(datastore.key([kind, caseNumber])).then(function (caseEntity) {
        return caseEntity[0];
    }).then(function (caseEntity) {
        return (0, _postgresSerialization.serialize)(Object.assign({}, caseEntity, { number: caseNumber, county: county }));
    }).then(function () {
        return console.log("Saved case " + caseNumber + " from county " + county + " to Postgres database.");
    }).catch(function (err) {
        return console.log("Failed to save case " + caseNumber + " from county " + county + " to Postgres database: " + err + ".");
    });
}

function transferCFCasePromise(year, i, county) {
    return function () {
        return transferCase("CF-" + year + "-" + i, county);
    };
}

function transferCFCasesPromise(year, i, county, chunkSize, end) {
    return function () {
        var proms = [];
        for (var j = i; j < i + chunkSize && j <= end; j++) {
            proms.push(transferCase("CF-" + year + "-" + j, county));
        }

        return Promise.all(proms);
    };
}

function doAllTasks(tasks, N) {
    var newTasks = [].concat(tasks);
    function pickUpNextTask() {
        if (newTasks.length) {
            return newTasks.shift()();
        }
    }
    function startChain() {
        return Promise.resolve().then(function next() {
            var t = pickUpNextTask();
            if (t) return t.then(next);
            return true;
        });
    }

    var chains = [];
    for (var k = 0; k < N; k += 1) {
        chains.push(startChain());
    }
    return Promise.all(chains);
}

_commander2.default.command("transfer-archive-pg <year> <start> <end>").description("Copy cases from google datastore to a postgres db for the year provided").action(function (year, start, end) {
    var county = "tulsa";

    var caseTasks = _lodash2.default.range(parseInt(start), parseInt(end)).map(function (i) {
        return transferCFCasePromise(year, i, county);
    });

    doAllTasks(caseTasks, 10).then(function () {
        return _postgresPool2.default.close();
    });
});

_commander2.default.parse(process.argv);