"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

exports.default = function (port, datasource) {

    var schema = (0, _graphql.buildSchema)("\n  type Query {\n    cases(county: String!, year: String, pageSize: Int): PagedCases\n    case(county: String!, number: String!): Case\n  }\n\n  type PagedCases {\n    page: Int\n    pageSize: Int\n    nextPageToken: String,\n    data: [Case]\n  }\n\n  type Case {\n    number: String\n    county: String\n    counts(id: String): [Count]\n    events: [Event]\n    dockets: [Docket]\n    parties: [Party]\n  }\n\n  type Party {\n    name: String\n    type: String\n  }\n\n  type Docket {\n    amount: String\n    date: String\n    party: String\n    color: String\n    count: Int\n    description: String\n    code: String\n  }\n\n  type Event {\n    party: String\n    reporter: String\n    description: String\n    docket: String\n    date: String\n  }\n\n  type Count {\n    id: String\n    dateOfOffense: String\n    description: String\n    dispositions(outcome: String): [Disposition]\n  }\n\n  type Disposition {\n    party: String\n    countAsDisposed: String\n    outcome: String\n    type: String\n    date: String,\n    count: Count\n  }\n");

    var mapPropAll = function mapPropAll(arr, props) {
        return Promise.all(arr).then(function (x) {
            return x.map(function (y) {
                return Object.assign({}, y, props);
            });
        });
    };

    var mapProp = function mapProp(arr, props) {
        return arr.then(function (x) {
            return x.map(function (y) {
                return Object.assign({}, y, props);
            });
        });
    };

    var mapPropPaged = function mapPropPaged(arr, props) {
        return arr.then(function (x) {
            return Object.assign({}, x, { data: x.data.map(function (y) {
                    return Object.assign({}, y, props);
                }) });
        });
    };

    var countNumberFromId = function countNumberFromId() {
        console.log("countnumber", this.countid);
        return (0, _postgresSerialization.deserializeCountById)(this.countid).then(function (x) {
            return x.length > 0 ? x[0].id : null;
        });
    };

    var countFromId = function countFromId() {
        return mapProp((0, _postgresSerialization.deserializeCountById)(this.countid), { dispositions: dispositions }).then(function (x) {
            return x.length > 0 ? x[0] : null;
        });
    };

    var memoizedPartyById = _lodash2.default.memoize(_postgresSerialization.deserializePartyById);

    var partyNameFromId = function partyNameFromId() {
        return memoizedPartyById(this.partyid).then(function (x) {
            return x.length > 0 ? x[0].name : null;
        });
    };

    var dispositions = function dispositions() {
        return mapProp((0, _postgresSerialization.deserializeDispositionsByCount)(this.ident), {
            party: partyNameFromId,
            count: countFromId
        });
    };

    var counts = function counts() {
        return mapProp((0, _postgresSerialization.deserializeCountsByCase)(this.id), { dispositions: dispositions });
    };

    var parties = function parties() {
        return (0, _postgresSerialization.deserializePartiesByCase)(this.id);
    };

    var events = function events() {
        return mapProp((0, _postgresSerialization.deserializeEventsByCase)(this.id), {
            party: partyNameFromId
        });
    };

    var dockets = function dockets() {
        return mapProp((0, _postgresSerialization.deserializeDocketsByCase)(this.id), {
            party: partyNameFromId,
            count: countNumberFromId
        });
    };

    var citation = function citation() {
        return (0, _postgresSerialization.deserializeCitationByCase)(this.id).then(function (x) {
            return x.length > 0 ? x[0] : null;
        });
    };

    var root = {
        case: function _case(args, context) {
            return mapPropAll([(0, _postgresSerialization.deserialize)(args.county, args.number)], {
                counts: counts,
                parties: parties,
                events: events,
                dockets: dockets,
                citation: citation
            });
        },
        cases: function cases(args, context) {
            if (args.pageSize > MAX_PAGE_SIZE) {
                throw "Maximum page size is " + MAX_PAGE_SIZE;
            }

            if (!args.pageSize) {
                args.pageSize = DEFAULT_PAGE_SIZE;
            }

            if (args.year) {
                return mapPropPaged((0, _postgresSerialization.deserializeByYear)(args.county, args.year, args.pageSize, args.pageToken), {
                    counts: counts,
                    parties: parties,
                    events: events,
                    dockets: dockets,
                    citation: citation
                });
            }

            return mapPropPaged((0, _postgresSerialization.deserializeAll)(args.county, args.pageSize, args.pageToken), {
                counts: counts,
                parties: parties,
                events: events,
                dockets: dockets,
                citation: citation
            });
        }
    };

    var app = (0, _express2.default)();
    app.use('/graphql', (0, _expressGraphql2.default)({
        schema: schema,
        rootValue: root,
        graphiql: true
    }));
    app.listen(4000, function () {
        return console.log('Now browse to localhost:4000/graphql');
    });
};

var _express = require("express");

var _express2 = _interopRequireDefault(_express);

var _expressGraphql = require("express-graphql");

var _expressGraphql2 = _interopRequireDefault(_expressGraphql);

var _graphql = require("graphql");

var _postgresSerialization = require("./postgres-serialization");

var _lodash = require("lodash");

var _lodash2 = _interopRequireDefault(_lodash);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var MAX_PAGE_SIZE = 100;
var DEFAULT_PAGE_SIZE = 20;