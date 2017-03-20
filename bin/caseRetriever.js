"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getCaseInformation = getCaseInformation;

var _http = require("http");

var _http2 = _interopRequireDefault(_http);

var _jsdom = require("jsdom");

var _jsdom2 = _interopRequireDefault(_jsdom);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var oscnUrl = "http://www.oscn.net/dockets/GetCaseInformation.aspx";
var oscnCountyParam = "db";
var oscnCaseNumberParam = "number";

function readCountOffenseDate(description) {
  var matches = description.match(/Date of Offense:\s+(\d+\/\d+\/\d+)/i);
  if (matches.length < 2) return null;
  return matches[1];
}

function readCountDisposition($, countContainer) {
  var dispositionTable = countContainer.find("table").eq(1);
  if (!dispositionTable) return null;
  var disposition = {};

  disposition.party = dispositionTable.find("td").eq(1).text().trim();

  var dispositionInfo = dispositionTable.find("td").eq(2).text().trim();
  var infoMatch = dispositionInfo.match(/Disposed:\s+(\w+),\s+(\d+\/\d+\/\d+).\s+(.*)Count as Disposed:\s+(.*)/i);

  disposition.outcome = infoMatch[1];
  disposition.date = infoMatch[2];
  disposition.type = infoMatch[3];
  disposition.countAsDisposed = infoMatch[4];

  return disposition;
}

function readCount($) {
  var countContainer = $(this);
  var count = {};

  var countTable = countContainer.find("table.Counts");
  count.id = countTable.find("td").first().text().trim();
  count.description = countTable.find("td.CountDescription").text().trim();
  count.dateOfOffense = readCountOffenseDate(count.description);
  count.disposition = readCountDisposition($, countContainer);

  return count;
}

function readCounts(window, $) {
  return $("div.CountsContainer").map(readCount).get();
}

function getCaseInformation(caseNumber, county) {
  return new Promise(function (resolve, reject) {
    if (!caseNumber || !county) {
      reject("caseNumber and county are required");
      return;
    }

    _http2.default.get(oscnUrl + "?" + oscnCountyParam + "=" + county + "&" + oscnCaseNumberParam + "=" + caseNumber, function (response) {
      var body = '';
      response.on('data', function (d) {
        body += d;
      });
      response.on('end', function () {
        _jsdom2.default.env(body, ["http://code.jquery.com/jquery.js"], function (errors, window) {
          console.dir(errors);
          var $ = window.$;

          var parties = [];
          $(".party").next().find("a").each(function () {
            parties.push({ name: $(this).text().replace(/\s+/g, ' '), type: $(this)[0].nextSibling.nodeValue.replace(",", "").replace("\n", "") });
          });

          var dockets = [];

          $(".docketlist").find("tr.docketRow").each(function () {
            var row = $(this);
            var docket = {
              date: $(row.find("td")[0]).text().replace(/\s+/g, ' ').trim(),
              code: $(row.find("td")[1]).text().replace(/\s+/g, ' ').trim(),
              description: $(row.find("td")[2]).text().replace(/\s+/g, ' ').trim(),
              count: parseInt($(row.find("td")[3]).text().replace(/\s+/g, ' ').trim()),
              party: $(row.find("td")[4]).text().replace(/\s+/g, ' ').trim(),
              amount: parseFloat($(row.find("td")[5]).text().replace(/\s+/g, ' ').trim())
            };

            dockets.push(docket);
          });

          var events = [];

          $("table").has("th:contains(Event)").find("tr").each(function () {
            var row = $(this);
            if (row.find("td").length > 0) {
              var date = $(row.find("td")[0]).find("font").text().replace(/\s+/g, ' ').trim();
              var eventData = {
                date: date,
                description: $(row.find("td")[0]).text().replace(/\s+/g, ' ').replace(date, "").trim(),
                party: $(row.find("td")[1]).text().replace(/\s+/g, ' ').trim(),
                docket: $(row.find("td")[2]).text().replace(/\s+/g, ' ').trim(),
                reporter: $(row.find("td")[3]).text().replace(/\s+/g, ' ').trim()
              };
              events.push(eventData);
            }
          });

          var defendants = parties.filter(function (x) {
            return x.type == "Defendant";
          }).map(function (x) {
            return {
              name: x.name,
              dockets: dockets.filter(function (doc) {
                return doc.party == x.name;
              }),
              events: events.filter(function (evt) {
                return evt.party == x.name;
              }),
              counts: []
            };
          });

          var caseData = {
            parties: parties,
            defendants: defendants,
            counts: readCounts(window, $),
            html: body
          };

          resolve(caseData);
        });
      });
    });
  });
}