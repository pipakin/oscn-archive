import express from "express";
import graphqlHTTP from "express-graphql";
import { buildSchema } from "graphql";
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

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

export default function(port, datasource) {

var schema = buildSchema(`
  type Query {
    cases(county: String!, year: String, pageSize: Int, page: Int, pageToken: String): PagedCases
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
    count: Int
    description: String
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
    date: String,
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
    console.log("countnumber", this.countid);
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

var root = {
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
    cases: (args, context) => {
        if(args.pageSize > MAX_PAGE_SIZE) {
            throw `Maximum page size is ${MAX_PAGE_SIZE}`
        }

        if(!args.pageSize) {
            args.pageSize = DEFAULT_PAGE_SIZE;
        }

        if(args.year) {
            return mapPropPaged(deserializeByYear(args.county, args.year, args.pageSize, args.page, args.pageToken), {
                counts,
                parties,
                events,
                dockets,
                citation
            });
        }

        return mapPropPaged(deserializeAll(args.county, args.pageSize, args.page, args.pageToken), {
            counts,
            parties,
            events,
            dockets,
            citation
        });
    }
};

var app = express();
app.use('/graphql', graphqlHTTP({
  schema: schema,
  rootValue: root,
  graphiql: true,
}));
app.listen(port, () => console.log(`Now browse to localhost:${port}/graphql`));

}
