"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.serialize = serialize;
exports.deserializeCitationByCase = deserializeCitationByCase;
exports.deserializeDocketsByCase = deserializeDocketsByCase;
exports.deserializeEventsByCase = deserializeEventsByCase;
exports.deserializePartyById = deserializePartyById;
exports.deserializePartiesByCase = deserializePartiesByCase;
exports.deserializeDispositionsByCount = deserializeDispositionsByCount;
exports.deserializeCountById = deserializeCountById;
exports.deserializeCountsByCase = deserializeCountsByCase;
exports.deserialize = deserialize;
exports.deserializeByYear = deserializeByYear;
exports.deserializeAll = deserializeAll;

var _postgresPool = require("./postgres-pool");

var _postgresPool2 = _interopRequireDefault(_postgresPool);

var _moment = require("moment");

var _moment2 = _interopRequireDefault(_moment);

var _toSnakeCase = require("to-snake-case");

var _toSnakeCase2 = _interopRequireDefault(_toSnakeCase);

var _lodash = require("lodash");

var _lodash2 = _interopRequireDefault(_lodash);

var _atob = require("atob");

var _atob2 = _interopRequireDefault(_atob);

var _btoa = require("btoa");

var _btoa2 = _interopRequireDefault(_btoa);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function getFullCaseYear(year) {
    if (year.length == 4) return year;
    if (year.length == 2) {
        var number = year.parseInt(year);
        if (number < 90) return "20" + year;
        return "19" + year;
    }

    console.error("Error: case year \"" + year + "\" invalid.");
    return null;
}

function promisequery(query, args) {
    return new Promise(function (resolve, reject) {
        _postgresPool2.default.query(query, args, function (err, res) {
            if (err) {
                reject("Error with query\n--Query: " + query + "\n--Args: " + args + "\n--error: " + err);
                return;
            }
            resolve(res.rows);
        });
    });
}

function reduceEventually(arr, fn) {
    if (!arr) return Promise.resolve([]);
    return arr.reduce(function (promiseChain, item) {
        return promiseChain.then(function (v) {
            return fn(item).then(function (n) {
                return v.concat(n);
            });
        });
    }, Promise.resolve([]));
}

function partyIdOrNull(parties, name) {
    if (!parties) return null;
    var matches = parties.filter(function (x) {
        return x.name.replace(/\s+/g, ' ') == name.replace(/\s+/g, ' ');
    });
    if (matches.length > 0) return matches[0].id;
    return null;
}

function countIdOrNull(counts, idx) {
    if (!idx) return null;
    var trueIndex = idx - 1;
    if (trueIndex < 0 || trueIndex >= counts.length) return null;
    return counts[trueIndex].id;
}

function upsert(table, fields, id, args) {
    if (id) {
        return promisequery("UPDATE " + table + " SET " + fields.map(function (f, i) {
            return f + " = $" + (i + 1);
        }).join(", ") + " RETURNING *", args.concat(id));
    }

    return promisequery("INSERT INTO " + table + " (" + fields.join(", ") + ") VALUES (" + fields.map(function (f, i) {
        return "$" + (i + 1);
    }).join(", ") + ") RETURNING *", args);
}

function upsertCase(caseid, county, casenumber, typeid, caseYear, caseSerial) {
    return upsert("cases", ["county", "case_number", "typeid", "year", "serial_number"], caseid, [county, casenumber, typeid, caseYear, caseSerial]);
}

function upsertParty(id, caseid, name, type) {
    return upsert("parties", ["caseid", "name", "type"], id, [caseid, name, type]);
}

function upsertEvent(id, caseid, partyid, date, docket, description, reporter) {
    return upsert("events", ["caseid", "partyid", "event_date", "docket", "description", "reporter"], id, [caseid, partyid, date ? (0, _moment2.default)(date.replace(" at ", " "), "dddd, MMMM D, YYYY h:mm A").format("YYYY-MM-DD HH:mm:ss") : null, docket, description, reporter]);
}

function upsertCount(id, caseid, number, dateOfOffense, description) {
    return upsert("counts", ["caseid", "count_number", "date_of_offense", "description"], id, [caseid, number, dateOfOffense ? (0, _moment2.default)(dateOfOffense, "MM/DD/YYYY").format("YYYY-MM-DD") : null, description]);
}

function upsertDisposition(id, countid, partyid, countAsDisposed, outcome, type, date) {
    if (partyid) return upsert("dispositions", ["countid", "partyid", "count_as_disposed", "outcome", "type", "disposition_date"], id, [countid, partyid, countAsDisposed, outcome, type, date ? (0, _moment2.default)(date, "MM/DD/YYYY").format("YYYY-MM-DD") : null]);
    return Promise.resolve([]);
}

function upsertDocket(id, caseid, partyid, countid, amount, color, description, code, date) {
    return upsert("dockets", ["caseid", "partyid", "countid", "amount", "color", "description", "code", "docket_date"], id, [caseid, partyid, countid, isNaN(amount) ? null : amount, color, description.join("\n"), code, (0, _moment2.default)(date, "MM/DD/YYYY").format("YYYY-MM-DD")]);
}

function upsertCitation(caseid, thecitation) {
    var citation = Object.assign({}, thecitation, { bondAmount: thecitation.bondAmount ? parseFloat(thecitation.bondAmount.toString().replace("$", "")) : null });
    var fields = _lodash2.default.map(citation, function (v, k) {
        return k;
    }).filter(function (x) {
        return x != "id";
    });
    var vals = fields.map(function (v) {
        return citation[v];
    });
    var dbfields = fields.map(function (v) {
        return (0, _toSnakeCase2.default)(v);
    });
    return upsert("citations", ["caseid"].concat(dbfields), citation.id, [caseid].concat(vals));
}

function serialize(caseEntity) {

    var caseSegments = caseEntity.number.split("-");

    //get case id info
    var caseTypeCode = caseSegments[0];
    var caseYearRaw = caseSegments[1];
    var caseSerial = caseSegments[2];

    var caseYear = getFullCaseYear(caseYearRaw);
    var caseNumber = caseTypeCode + "-" + caseYear + "-" + caseSerial;

    //get the case type id and then insert the case
    return promisequery("DELETE FROM cases WHERE case_number = $1 AND county = $2", [caseNumber, caseEntity.county]).then(function (x) {
        return promisequery("SELECT id FROM case_types WHERE code = $1", [caseTypeCode]).then(function (rows) {
            return rows[0].id;
        }).then(function (id) {
            return upsertCase(caseEntity.id, caseEntity.county, caseNumber, id, caseYear, caseSerial);
        }).then(function (caseRows) {
            return caseRows[0];
        }).then(function (caseRow) {
            return reduceEventually(caseEntity.parties, function (party) {
                return upsertParty(party.id, caseRow.id, party.name, party.type);
            }).then(function (parties) {
                return reduceEventually(caseEntity.counts, function (count) {
                    return upsertCount(count.ident, caseRow.id, count.id, count.dateOfOffense, count.description).then(function (countRows) {
                        return reduceEventually(count.dispositions, function (disp) {
                            return upsertDisposition(disp.id, countRows[0].id, partyIdOrNull(parties, disp.party), disp.countAsDisposed, disp.outcome, disp.type, disp.date);
                        }).then(function (x) {
                            return countRows;
                        });
                    });
                }).then(function (counts) {
                    return reduceEventually(caseEntity.dockets, function (docket) {
                        return upsertDocket(docket.id, caseRow.id, partyIdOrNull(parties, docket.party), countIdOrNull(counts, docket.count), docket.amount, docket.color, docket.description, docket.code, docket.date);
                    });
                }).then(function (dockets) {
                    return reduceEventually(caseEntity.events, function (ev) {
                        return upsertEvent(ev.id, caseRow.id, partyIdOrNull(parties, ev.party), ev.date, ev.docket, ev.description, ev.reporter);
                    });
                }).then(function (events) {
                    if (caseEntity.citation) {
                        return upsertCitation(caseRow.id, caseEntity.citation).then(function (x) {
                            return caseRow;
                        });
                    } else return Promise.resolve(caseRow);
                });
            });
        });
    });
}

function deserializeCitationByCase(caseid) {
    return promisequery("SELECT * FROM citations WHERE caseid = $1", [caseid]);
}

function deserializeDocketsByCase(caseid) {
    return promisequery("SELECT * FROM dockets WHERE caseid = $1", [caseid]).then(function (dockets) {
        return dockets.map(function (e) {
            return Object.assign({}, e, {
                date: (0, _moment2.default)(e.date).format("dddd, MMMM D, YYYY [at] h:mm A"),
                amount: e.amount ? "$" + e.amount : null
            });
        });
    });
}

function deserializeEventsByCase(caseid) {
    return promisequery("SELECT * FROM events WHERE caseid = $1", [caseid]).then(function (events) {
        return events.map(function (e) {
            return Object.assign({}, e, { date: (0, _moment2.default)(e.date).format("dddd, MMMM D, YYYY [at] h:mm A") });
        });
    });
}

function deserializePartyById(id) {
    return promisequery("SELECT * FROM parties WHERE id = $1", [id]);
}

function deserializePartiesByCase(caseid) {
    return promisequery("SELECT * FROM parties WHERE caseid = $1", [caseid]);
}

function deserializeDispositionsByCount(countid) {
    return promisequery("SELECT * FROM dispositions WHERE countid = $1", [countid]).then(function (disps) {
        return disps.map(function (d) {
            return {
                id: d.id,
                partyid: d.partyid,
                countid: d.countid,
                outcome: d.outcome,
                date: (0, _moment2.default)(d.date).format("MM/DD/YYYY"),
                type: d.type,
                countAsDisposed: d.count_as_disposed
            };
        });
    });
}

function deserializeCounts(counts) {
    return counts.map(function (c) {
        return {
            ident: c.id,
            id: c.count_number,
            description: c.description,
            dateOfOffense: (0, _moment2.default)(c.date).format("MM/DD/YYYY")
        };
    });
}

function deserializeCountById(id) {
    return promisequery("SELECT * FROM counts WHERE id = $1", [id]).then(deserializeCounts);
}

function deserializeCountsByCase(caseid) {
    return promisequery("SELECT * FROM counts WHERE caseid = $1", [caseid]).then(deserializeCounts);
}

function deserializeCases(query, args) {
    return promisequery(query, args).then(function (caseEntity) {
        if (caseEntity.length == 0) {
            throw "Unable to find cases matching your query";
        }
        return caseEntity.map(function (x) {
            return {
                id: x.id,
                number: x.case_number,
                county: x.county
            };
        });
    });
}

function deserialize(county, casenumber) {
    var caseSegments = casenumber.split("-");

    //get case id info
    var caseTypeCode = caseSegments[0];
    var caseYearRaw = caseSegments[1];
    var caseSerial = caseSegments[2];

    var caseYear = getFullCaseYear(caseYearRaw);
    var caseNumber = caseTypeCode + "-" + caseYear + "-" + caseSerial;

    return deserializeCases("SELECT * FROM cases WHERE case_number = $1 AND county = $2", [caseNumber, county]).then(function (caseEntities) {
        return caseEntities[0];
    });
}

function extractToken(pageSize, page, pageToken) {
    token = {
        page: 1,
        pageSize: 20
    };
    if (pageToken) {
        var json = (0, _btoa2.default)(pageToken);
        try {
            token = JSON.parse(json);
        } catch (e) {
            throw "Invalid page token";
        }
    }

    if (page) token.page = page;
    if (pageSize) token.pageSize = pageSize;

    return token;
}

function packToken(pageSize, page) {
    return (0, _atob2.default)(JSON.stringify({ pageSize: pageSize, page: page }));
}

function deserializeByYear(county, year, pageSize, page, pageToken) {
    var token = extractToken(pageSize, page, pageToken);
    return deserializeCases("SELECT * FROM cases WHERE year = $1 AND county = $2 LIMIT $3", [year, county, token.pageSize, (token.page - 1) * token.pageSize]).then(function (x) {
        return {
            page: token.page,
            pageSize: token.pageSize,
            data: x,
            nextPageToken: packToken(token.pageSize, token.page + 1)
        };
    });
}

function deserializeAll(county, pageSize, page, pageToken) {
    return deserializeCases("SELECT * FROM cases WHERE county = $1 LIMIT $2", [county, token.pageSize, (token.page - 1) * token.pageSize]).then(function (x) {
        return {
            page: token.page,
            pageSize: token.pageSize,
            data: x,
            nextPageToken: packToken(token.pageSize, token.page + 1)
        };
    });
}