import express from "express";
import graphqlHTTP from "express-graphql";
import { buildSchema, graphql } from "graphql";
import {
    deserialize,
    deserializeAll,
    deserializeByYear,
    deserializeCountsByCase,
    deserializePartiesByCase,
    deserializeEventsByCase,
    deserializeDocketsByCase,
    deserializeCitationByCase,
    deserializeDispositionsByCount,
    deserializePartyById,
    deserializeCountById,
    deserializePartyByName,
    deserializePartyByType,
    deserializeAllParties,
    deserializeCasesByList
} from "./postgres-serialization";
import _ from "lodash";
import xlsx from "xlsx";

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

export function standardQuery(caseNumber, county) {
    return `{
        case(county:"${county}", number:"${caseNumber}") {
            parties {
                name
                type
            }
            counts {
                id
                description
                dateOfOffense
                dispositions {
                    party
                    outcome
                    date
                    type
                    countAsDisposed
                }
            }
            dockets {
                date
                code
                color
                description
                count
                party
                amount
            }
            events {
                date
                description
                party
                docket
                reporter
            }
        }
    }`
}

export const schema = buildSchema(`
  type Query {
    flattenCases(county: String!, year: String, pageSize: Int, page: Int, pageToken: String): PagedFlattenedCases
    cases(county: String!, year: String, pageSize: Int, page: Int, pageToken: String, partialDocketDescription: String, partialCountDescription: String, partialEventDescription: String): PagedCases
    case(county: String!, number: String!): Case
    parties(type: String, name: String, pageSize: Int, page: Int, pageToken: String): PagedGroupedParties
  }

  type PagedGroupedParties {
    page: Int
    pageSize: Int
    nextPageToken: String
    data: [GroupedParty]
    totalPages: Int
    totalItems: Int
  }

  type GroupedParty {
      name: String
      type: String
      cases: [Case]
  }

  type PagedCases {
    page: Int
    pageSize: Int
    nextPageToken: String
    data: [Case]
    totalPages: Int
    totalItems: Int
  }

  type PagedFlattenedCases {
    page: Int
    pageSize: Int
    nextPageToken: String
    data: [FlattenedCase]
    totalPages: Int
    totalItems: Int
  }

  type FlattenedCase {
    case_number: String
    case_county: String
    party_name: String
    party_type: String
    docket_amount: String
    docket_date: String
    docket_party: String
    docket_color: String
    docket_count: String
    docket_description: String
    docket_code: String
    event_reporter: String
    event_description: String
    event_docket: String
    event_date: String
    count_id: String
    count_dateOfOffense: String
    count_description: String
    count_disposition_countAsDisposed: String
    count_disposition_outcome: String
    count_disposition_type: String
    count_disposition_date: String
    count_disposition_count: Count
  }
  type Case {
    number: String
    county: String
    counts(id: String): [Count]
    events: [Event]
    dockets: [Docket]
    parties(type: String): [Party]
  }

  type Party {
    name: String
    type: String
    events: [Event]
  }

  type Docket {
    amount: String
    date: String
    party: String
    color: String
    count: String
    description: [String]
    code: String
  }

  type Event {
    party: String
    reporter: String
    description: String
    docket: String
    date: String
  }

  type Count {
    id: String
    dateOfOffense: String
    description: String
    dispositions(outcome: String): [Disposition]
  }

  type Disposition {
    party: String
    countAsDisposed: String
    outcome: String
    type: String
    date: String
    count: Count
  }
`);

const mapPropAll = function(arr, props) {
    return Promise.all(arr).then(x => x.map(y => Object.assign({}, y, props)));
}

const mapProp = function(arr, props) {
    return arr.then(x => x.map(y => Object.assign({}, y, props)));
}

const mapPropPaged = function(arr, props) {
    return arr.then(x => Object.assign({}, x, {data: x.data.map(y => Object.assign({}, y, props))}));
}

const countNumberFromId = function() {
    return deserializeCountById(this.countid).then(x => x.length > 0 ? x[0].id : null);
}

const countFromId = function() {
    return mapProp(deserializeCountById(this.countid), {dispositions: dispositions}).then(x => x.length > 0 ? x[0] : null);
}

var memoizedPartyById = _.memoize(deserializePartyById);

const partyNameFromId = function() {
    return memoizedPartyById(this.partyid).then(x => x.length > 0 ? x[0].name : null);
}

const dispositions = function() {
    return mapProp(deserializeDispositionsByCount(this.ident), {
        party: partyNameFromId,
        count: countFromId
    });
}

const counts = function() {
    return mapProp(deserializeCountsByCase(this.id), {dispositions: dispositions});
}

const events = function() {
    return mapProp(deserializeEventsByCase(this.id), {
        party: partyNameFromId
    });
}

const eventsByCaseAndParty = function() {
    return mapProp(deserializeEventsByCase(this.caseid).then(v => v.filter(x => x.partyid == this.id)), {
        party: partyNameFromId
    });
}

const parties = function(args) {
    return mapProp(deserializePartiesByCase(this.id).then(v => v.filter(x => !args.type || x.type == args.type)), {
        events: eventsByCaseAndParty
    });
}

const dockets = function() {
    return mapProp(deserializeDocketsByCase(this.id), {
        party: partyNameFromId,
        count: countNumberFromId
    });
}

const citation = function() {
    return deserializeCitationByCase(this.id)
        .then(x => x.length > 0 ? x[0] : null);
}

const partyCases = function() {
    return mapProp(deserializeCasesByList(this.caseids), {
        counts,
        parties,
        events,
        dockets,
        citation
    });
}

function checkIds(v, i) {
    return _.map(v, (val, key) => key)
        .filter(key => key.endsWith("id"))
        .map(key => !i[key] || i[key] == v[key])
        .reduce((a,b) => a && b, true);
}

function mapFields(v, prefix) {
    return _.map(v, (val, key) => key == "id" ? {[`${prefix}${key}`]: val} : {[`${prefix}_${key}`]: val})
        .map(v => v.countid ? {count_id: v.countid} : v)
        .map(v => v.count_ident ? {countid: v.count_ident} : v)
        .reduce((a, b) => Object.assign({}, a, b), {});
}

function flattenData(data, fields, prefix, getter) {
    if(_.find(fields, x => x.startsWith(prefix))) {
        return Promise.all(data.map(d => getter(d).then(v => ({item: d, vals: v || []}))))
            .then(i => i.reduce((rows, newItem) => rows.concat(
                newItem.vals
                    .filter(v => checkIds(v, newItem.item))
                    .map(v => Object.assign({[`${prefix}_checkIds`]: checkIds(v, newItem.item)}, newItem.item, mapFields(v, prefix)))
            ), []))
    }
    return Promise.resolve(data);
}

const flattenCasesResult = (fields) => (caseData) => {
    var data = caseData.data.map(v => mapFields(v, "case"));
    return flattenData(data, fields, "party", x => deserializePartiesByCase(x.caseid))
        .then(d => flattenData(d, fields, "event", x => deserializeEventsByCase(x.caseid)))
        .then(d => flattenData(d, fields, "docket", x => deserializeDocketsByCase(x.caseid)))
        .then(d => flattenData(d, fields, "count", x => deserializeCountsByCase(x.caseid)))
        .then(d => flattenData(d, fields, "count_disposition", x => deserializeDispositionsByCount(x.countid)))
        .then(d => Object.assign({}, caseData, {data: d}));
}

function getFlattenSelectedFields(c) {
    const field = _.find(c.fieldNodes, x => x.name.value == "flattenCases");
    const data = _.find(field.selectionSet.selections, x => x.name.value == "data");
    if(!data) return [];
    return data.selectionSet.selections.map(x => x.name.value);
}

var root = {
    flattenCases: (args, context, qlContext) => {
        var fields = getFlattenSelectedFields(qlContext);

        //get the case
        if(args.pageSize > MAX_PAGE_SIZE) {
            throw `Maximum page size is ${MAX_PAGE_SIZE}`
        }

        if(!args.pageSize) {
            args.pageSize = DEFAULT_PAGE_SIZE;
        }

        if(args.year) {
            return deserializeByYear(args.county, args.year, args.pageSize, args.page, args.pageToken)
                .then(flattenCasesResult(fields));
        }

        return deserializeAll(args.county, args.pageSize, args.page, args.pageToken)
            .then(flattenCasesResult(fields));
    },
    parties: (args, context) => {
        if(args.name) {
            return mapPropPaged(deserializePartyByName(args.name, args.pageSize, args.page, args.pageToken), {
                cases: partyCases
            });
        }

        if(args.type) {
            return mapPropPaged(deserializePartyByType(args.type, args.pageSize, args.page, args.pageToken), {
                cases: partyCases
            });
        }

        return mapPropPaged(deserializeAllParties(args.pageSize, args.page, args.pageToken), {
            cases: partyCases
        });
    },
    ["case"]: (args, context) => {
        return mapPropAll([deserialize(args.county, args.number)], {
            counts,
            parties,
            events,
            dockets,
            citation
        }).then(x => x[0]);
    },
    cases: (args, context, qlContext) => {
        if(args.pageSize > MAX_PAGE_SIZE) {
            throw `Maximum page size is ${MAX_PAGE_SIZE}`
        }

        if(!args.pageSize) {
            args.pageSize = DEFAULT_PAGE_SIZE;
        }

        if(args.year) {
            return mapPropPaged(deserializeByYear(args.county, args.year, args.pageSize, args.page, args.pageToken, {
                partialDocketDescription: args.partialDocketDescription,
                partialCountDescription: args.partialCountDescription,
                partialEventDescription: args.partialEventDescription
            }), {
                counts,
                parties,
                events,
                dockets,
                citation
            });
        }

        return mapPropPaged(deserializeAll(args.county, args.pageSize, args.page, args.pageToken, {
            partialDocketDescription: args.partialDocketDescription,
            partialCountDescription: args.partialCountDescription,
            partialEventDescription: args.partialEventDescription
        }), {
            counts,
            parties,
            events,
            dockets,
            citation
        });
    }
};

export function executeQuery(query) {
    return graphql(schema, query, root);
}

export default function(port, datasource) {

var app = express();
app.use('/graphql', graphqlHTTP({
  schema: schema,
  rootValue: root,
  graphiql: false,
}));
app.use('/graphiql', graphqlHTTP({
  schema: schema,
  rootValue: root,
  graphiql: true,
}));
app.get('/case/:county/:caseNumber', (req, res) => {
    executeQuery(standardQuery(req.params.caseNumber, req.params.county))
        .then(data => data.data["case"])
        .then(data => {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify(data));
        });
});

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

app.get('/xlsx/:county', (req, res) => {
    const fields = req.query.fields.split(",");
    const getPage = (page, size) =>
        executeQuery(`{flattenCases(county:"${req.params.county}",page:${page},pageSize:${size}){totalPages,page,data{${fields.join(",")}}}}`)
            .then(x => console.log("Page:", x.data.flattenCases.page) || x.data);

    getPage(1,1)
        .then(x => doAllTasks(
                _.range(1,Math.ceil(x.flattenCases.totalPages/100.0)).map(page => () => getPage(page, 100).then(pageData => pageData.flattenCases.data)),
                10
            )
        )
        .then(x => x.reduce((a,b) => a.concat(b),[]))
        .then(x => xlsx.utils.aoa_to_sheet([_.map(x[0], (v, k) => k)].concat(x.map(y => _.map(y, (v,k) => v)))))
        .then(sheet => ({ SheetNames: ["cases"], Sheets: {cases: sheet} }))
        .then(wb => xlsx.write(wb, { bookType:'xlsx', bookSST:false, type:'binary' }))
        .then(bytes => {
            res.writeHead(200, {'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
            res.end(bytes, 'binary');
        })
        .catch(err => {
            res.writeHead(500);
            res.end("Error getting cases: " + err.toString());
        });
});

const server = app.listen(port, () => console.log(`Now browse to localhost:${port}/graphiql`));
server.timeout = 0;

}
