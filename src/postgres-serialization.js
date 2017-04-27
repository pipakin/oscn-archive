import pool from "./postgres-pool";
import moment from "moment";
import snake from "to-snake-case";
import _ from "lodash";
import atob from "atob";
import btoa from "btoa";

function getFullCaseYear(year) {
    if(year.length == 4) return year;
    if(year.length == 2) {
        var number = year.parseInt(year);
        if(number < 90) return `20${year}`;
        return `19${year}`;
    }

    console.error(`Error: case year "${year}" invalid.`)
    return null;
}

function promisequery(query, args) {
    return new Promise(function(resolve, reject) {
        pool.query(query, args, (err, res) => {
            if(err) {
                reject(`Error with query\n--Query: ${query}\n--Args: ${args}\n--error: ${err}`);
                return;
            }
            resolve(res.rows)
        })
    });
}

function reduceEventually(arr, fn) {
    if(!arr) return Promise.resolve([]);
    return arr.reduce((promiseChain, item) => promiseChain.then(v => fn(item).then(n => v.concat(n))), Promise.resolve([]));
}

function partyIdOrNull(parties, name) {
    if(!parties) return null;
    const matches = parties.filter(x => x.name.replace(/\s+/g, ' ') == name.replace(/\s+/g, ' '));
    if(matches.length > 0) return matches[0].id;
    return null;
}

function countIdOrNull(counts, idx) {
    if(!idx) return null;
    const trueIndex = idx - 1;
    if(trueIndex < 0 || trueIndex >= counts.length) return null;
    return counts[trueIndex].id;
}

function upsert(table, fields, id, args) {
    if(id) {
        return promisequery(`UPDATE ${table} SET ${fields.map((f, i) => f + " = $" + (i+1)).join(", ")} RETURNING *`, args.concat(id))
    }

    return promisequery(`INSERT INTO ${table} (${fields.join(", ")}) VALUES (${fields.map((f, i) => "$" + (i+1)).join(", ")}) RETURNING *`, args)
}

function upsertCase(caseid, county, casenumber, typeid, caseYear, caseSerial) {
    return upsert("cases", ["county", "case_number", "typeid", "year", "serial_number"], caseid, [county, casenumber, typeid, caseYear, caseSerial]);
}

function upsertParty(id, caseid, name, type) {
    return upsert("parties", ["caseid", "name", "type"], id, [caseid, name, type]);
}

function upsertEvent(id, caseid, partyid, date, docket, description, reporter) {
    return upsert("events", ["caseid", "partyid", "event_date", "docket", "description", "reporter"], id, [caseid, partyid, date ? moment(date.replace(" at ", " "), "dddd, MMMM D, YYYY h:mm A").format("YYYY-MM-DD HH:mm:ss") : null, docket, description, reporter]);
}

function upsertCount(id, caseid, number, dateOfOffense, description) {
    return upsert("counts", ["caseid", "count_number", "date_of_offense", "description"], id, [caseid, number, dateOfOffense ? moment(dateOfOffense, "MM/DD/YYYY").format("YYYY-MM-DD") : null, description])
}

function upsertDisposition(id, countid, partyid, countAsDisposed, outcome, type, date) {
    if(partyid) return upsert("dispositions", ["countid", "partyid", "count_as_disposed", "outcome", "type", "disposition_date"], id, [countid, partyid, countAsDisposed, outcome, type, date ? moment(date, "MM/DD/YYYY").format("YYYY-MM-DD") : null])
    return Promise.resolve([]);
}

function upsertDocket(id, caseid, partyid, countid, amount, color, description, code, date) {
    return upsert("dockets", ["caseid", "partyid", "countid", "amount", "color", "description", "code", "docket_date"], id,
        [caseid, partyid, countid, isNaN(amount) ? null : amount, color, description.join("\n"), code, moment(date, "MM/DD/YYYY").format("YYYY-MM-DD")]);
}

function upsertCitation(caseid, thecitation) {
    const citation = Object.assign({}, thecitation, {bondAmount: thecitation.bondAmount ? parseFloat(thecitation.bondAmount.toString().replace("$", "")) : null})
    const fields = _.map(citation, (v, k) => k).filter(x => x != "id");
    const vals = fields.map(v => citation[v]);
    const dbfields = fields.map(v => snake(v));
    return upsert("citations", ["caseid"].concat(dbfields), citation.id, [caseid].concat(vals));
}

export function serialize(caseEntity) {

    const caseSegments = caseEntity.number.split("-");

    //get case id info
    const caseTypeCode = caseSegments[0];
    const caseYearRaw = caseSegments[1];
    const caseSerial = caseSegments[2];

    const caseYear = getFullCaseYear(caseYearRaw);
    const caseNumber =  `${caseTypeCode}-${caseYear}-${caseSerial}`

    //get the case type id and then insert the case
    return promisequery("DELETE FROM cases WHERE case_number = $1 AND county = $2", [caseNumber, caseEntity.county]).then(x =>
        promisequery("SELECT id FROM case_types WHERE code = $1", [caseTypeCode])
            .then(rows => rows[0].id)
            .then(id => upsertCase(caseEntity.id, caseEntity.county, caseNumber, id, caseYear, caseSerial))
            .then(caseRows => caseRows[0])
            .then(caseRow =>
                reduceEventually(caseEntity.parties, party => upsertParty(party.id, caseRow.id, party.name, party.type))
                    .then(parties =>
                        reduceEventually(caseEntity.counts, count => upsertCount(count.ident, caseRow.id, count.id, count.dateOfOffense, count.description)
                            .then(countRows =>
                                reduceEventually(count.dispositions, disp => upsertDisposition(disp.id, countRows[0].id, partyIdOrNull(parties, disp.party), disp.countAsDisposed, disp.outcome, disp.type, disp.date))
                                    .then(x => countRows)
                            ))
                        .then(counts => reduceEventually(caseEntity.dockets, docket => upsertDocket(docket.id, caseRow.id, partyIdOrNull(parties, docket.party), countIdOrNull(counts, docket.count), docket.amount, docket.color, docket.description, docket.code, docket.date)))
                        .then(dockets => reduceEventually(caseEntity.events, ev => upsertEvent(ev.id, caseRow.id, partyIdOrNull(parties, ev.party), ev.date, ev.docket, ev.description, ev.reporter)))
                        .then(events => {
                            if(caseEntity.citation) {
                                return upsertCitation(
                                    caseRow.id, caseEntity.citation
                                ).then(x => caseRow)
                            } else return Promise.resolve(caseRow);
                        })
                    )
        )
    );
}

export function deserializeCitationByCase(caseid) {
    return promisequery("SELECT * FROM citations WHERE caseid = $1", [caseid]);
}

export function deserializeDocketsByCase(caseid) {
    return promisequery("SELECT * FROM dockets WHERE caseid = $1", [caseid])
        .then(dockets => dockets.map(e => Object.assign({}, e, {
            description: e.description.split('\n'),
            date: moment(e.docket_date).format("dddd, MMMM D, YYYY [at] h:mm A"),
            amount: e.amount ? "$" + e.amount : null
        })));
}

export function deserializeEventsByCase(caseid) {
    return promisequery("SELECT * FROM events WHERE caseid = $1", [caseid])
        .then(events => events.map(e => Object.assign({}, e, {date: moment(e.event_date).format("dddd, MMMM D, YYYY [at] h:mm A")})));
}

export function deserializePartyById(id) {
    return promisequery("SELECT * FROM parties WHERE id = $1", [id]);
}

export function deserializePartiesByCase(caseid) {
    return promisequery("SELECT * FROM parties WHERE caseid = $1", [caseid]);
}

export function deserializeDispositionsByCount(countid) {
    return promisequery("SELECT * FROM dispositions WHERE countid = $1", [countid])
        .then(disps => disps.map(d => ({
            id: d.id,
            partyid: d.partyid,
            countid: d.countid,
            outcome: d.outcome,
            date: moment(d.disposition_date).format("MM/DD/YYYY"),
            type: d.type,
            countAsDisposed: d.count_as_disposed
        })));
}

function deserializeCounts(counts) {
    return counts.map(c => ({
        ident: c.id,
        id: c.count_number,
        description: c.description,
        dateOfOffense: moment(c.date).format("MM/DD/YYYY")
    }));
}

export function deserializeCountById(id) {
    return promisequery("SELECT * FROM counts WHERE id = $1", [id])
        .then(deserializeCounts);
}

export function deserializeCountsByCase(caseid) {
    return promisequery("SELECT * FROM counts WHERE caseid = $1", [caseid])
        .then(deserializeCounts);
}

function deserializeCases(query, args) {
    return promisequery(query, args)
        .then(caseEntity => {
            if(caseEntity.length == 0) {
                throw "Unable to find cases matching your query";
            }
            return caseEntity.map(x => ({
                id: x.id,
                number: x.case_number,
                county: x.county,
                updated: x.updated_date
            }));
        });

}

export function deserialize(county, casenumber) {
    const caseSegments = casenumber.split("-");

    //get case id info
    const caseTypeCode = caseSegments[0];
    const caseYearRaw = caseSegments[1];
    const caseSerial = caseSegments[2];

    const caseYear = getFullCaseYear(caseYearRaw);
    const caseNumber =  `${caseTypeCode}-${caseYear}-${caseSerial}`

    return deserializeCases("SELECT * FROM cases WHERE case_number = $1 AND county = $2", [caseNumber, county])
        .then(caseEntities => caseEntities[0]);
}

function extractToken(pageSize, page, pageToken) {
    var token = {
        page: 1,
        pageSize : 20
    }
    if(pageToken) {
        var json = atob(pageToken);
        try {
            token = JSON.parse(json);
        } catch(e) {
            throw "Invalid page token";
        }
    }

    if(page) token.page = page;
    if(pageSize) token.pageSize = pageSize;

    return token;
}

function packToken(pageSize, page) {
    return btoa(JSON.stringify({pageSize, page}));
}

function deserializePaged(fields, table, where, args, fn, pageSize, page, pageToken) {
    const token = extractToken(pageSize, page, pageToken);
    return promisequery(`SELECT COUNT(1) FROM ${table} ${where}`, args)
        .then(total => total.length > 1 ? total.length : total[0].count)
        .then(total =>
            fn(`SELECT ${fields} FROM ${table} ${where} LIMIT ${"$" + (args.length + 1)} OFFSET ${"$" + (args.length + 2)}`, args.concat([token.pageSize, (token.page - 1) * token.pageSize])).then(x => ({
                page: token.page,
                pageSize: token.pageSize,
                data: x,
                nextPageToken: packToken(token.pageSize, token.page + 1),
                totalPages: Math.ceil(total/token.pageSize),
                totalItems: total
            })));
}

export function deserializePartyByType(type, pageSize, page, pageToken) {
    return deserializePaged("name, type, array_agg(caseid) as caseids", "parties", "WHERE type = $1 GROUP BY name, type", [type], promisequery, pageSize, page, pageToken)
}

export function deserializePartyByName(name, pageSize, page, pageToken) {
    return deserializePaged("name, type, array_agg(caseid) as caseids", "parties", "WHERE name = $1 GROUP BY name, type", [name], promisequery, pageSize, page, pageToken)
}
export function deserializeAllParties(pageSize, page, pageToken) {
    return deserializePaged("name, type, array_agg(caseid) as caseids", "parties", "GROUP BY name, type", [], promisequery, pageSize, page, pageToken)
}

export function deserializeByYear(county, year, pageSize, page, pageToken) {
    return deserializePaged("*", "cases", "WHERE year = $1 AND county = $2", [year, county], deserializeCases, pageSize, page, pageToken);
}

export function deserializeAll(county, pageSize, page, pageToken) {
    return deserializePaged("*", "cases", "WHERE county = $1", [county], deserializeCases, pageSize, page, pageToken);
}

export function deserializeCasesByList(ids) {
    return Promise.all(ids.map(x => deserializeCases("SELECT * FROM cases WHERE id = $1", [parseInt(x)])))
        .then(results => results.reduce((a,b) => a.concat(b), []));
}
