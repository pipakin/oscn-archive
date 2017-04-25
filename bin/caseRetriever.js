"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getCaseInformation = getCaseInformation;

var _http = require("http");

var _http2 = _interopRequireDefault(_http);

var _jsdom = require("jsdom");

var _jsdom2 = _interopRequireDefault(_jsdom);

var _wordwrap = require("wordwrap");

var _wordwrap2 = _interopRequireDefault(_wordwrap);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var wrap = (0, _wordwrap2.default)(1000);
var oscnUrl = "http://www.oscn.net/dockets/GetCaseInformation.aspx";
var oscnCountyParam = "db";
var oscnCaseNumberParam = "number";

function readCountOffenseDate(description) {
  var matches = description.match(/Date of Offense:\s+(\d+\/\d+\/\d+)/i);
  if (matches.length < 2) return null;
  return matches[1];
}

function readCountDispositions($, countContainer) {
  var dispositionTable = countContainer.find("table").eq(1);
  if (!dispositionTable) return null;

  return dispositionTable.find("tr:has(td)").get().map(function (tr) {
    var disposition = {};
    disposition.party = $(tr).find("td").eq(1).text().trim();

    var dispositionInfoCell = $(tr).find("td").eq(2);
    var dispositionInfo = dispositionInfoCell.text().trim().replace(/\s+/g, " ");
    //disposition.info = dispositionInfo;
    var infoMatch = dispositionInfo.match(/Disposed:\s+(\w+),\s+(\d+\/\d+\/\d+)\.\s+(.+)\s+Count as Disposed:(.+)/i);

    disposition.outcome = infoMatch ? infoMatch[1] : null;
    disposition.date = infoMatch ? infoMatch[2] : null;
    disposition.type = infoMatch ? infoMatch[3] : null;
    disposition.countAsDisposed = infoMatch ? infoMatch[4] : null;

    return disposition;
  });
}

var readCount = function readCount($) {
  return function () {
    var countContainer = $(this);
    var count = {};

    var countTable = countContainer.find("table.Counts");
    count.id = countTable.find("td").first().text().trim();
    count.description = countTable.find("td.CountDescription").text().trim().replace(/\s+/g, " ");
    count.dateOfOffense = readCountOffenseDate(count.description);
    count.dispositions = readCountDispositions($, countContainer);

    return count;
  };
};

function readCounts(window, $) {
  return $("div.CountsContainer").map(readCount($)).get();
}

function camelize(str) {
  return str.replace(/(?:^\w|[A-Z]|\b\w)/g, function (letter, index) {
    return index == 0 ? letter.toLowerCase() : letter.toUpperCase();
  }).replace(/\s+/g, '');
}

function readCitationInformation(window, $) {
  var trafficHtml = $("h2.traffic").next("blockquote").html();
  if (!trafficHtml) return;

  var trafficText = trafficHtml.trim().replace(/<br\/?>/ig, "").split("\n").map(function (s) {
    return s.trim().split(/\:/);
  }).reduce(function (agg, kv) {
    if (kv.length > 2) {
      agg[camelize(kv[0])] = kv[1].trim().split("&nbsp;")[0].replace("&nbsp;", "").trim();
      for (var i = 1; i < kv.length - 1; i++) {
        agg[camelize(kv[i].trim().split("&nbsp;&nbsp;&nbsp;")[1].trim())] = kv[i + 1].trim().split("&nbsp;")[0].replace("&nbsp;", "").trim();
      }
    } else {
      agg[camelize(kv[0])] = kv[1].trim();
    }
    return agg;
  }, {});
  return trafficText;
}

function getCaseInformation(caseNumber, county) {
  return new Promise(function (resolve, reject) {
    if (!caseNumber || !county) {
      reject("caseNumber and county are required");
      return;
    }

    _jsdom2.default.env(oscnUrl + "?" + oscnCountyParam + "=" + county + "&" + oscnCaseNumberParam + "=" + caseNumber, ["http://code.jquery.com/jquery-3.2.0.min.js"], function (errors, window) {
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
          color: ($(row.find("td")[2]).find("font").attr("color") || "BLACK").toUpperCase(),
          description: $(row.find("td")[2]).text().replace(/\s+/g, ' ').trim(),
          count: parseInt($(row.find("td")[3]).text().replace(/\s+/g, ' ').trim()),
          party: $(row.find("td")[4]).text().replace(/\s+/g, ' ').trim(),
          amount: parseFloat($(row.find("td")[5]).text().replace(/\s+/g, ' ').replace("$", "").trim())
        };

        docket.description = wrap($(row.find("td")[2]).text()).split("\n").map(function (x) {
          return x.replace(/\s+/g, ' ').trim();
        }).filter(function (x) {
          return x !== "";
        });

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

      var traffic = readCitationInformation(window, $);

      var caseData = {
        parties: parties,
        dockets: dockets,
        events: events,
        counts: readCounts(window, $)
      };

      if (traffic) {
        caseData.citation = traffic;
      }

      window.close();

      resolve(caseData);
    });
  });
}