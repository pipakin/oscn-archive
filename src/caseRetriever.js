import http from "http";
import jsdom from "jsdom";
import wordwrap from "wordwrap";

const wrap = wordwrap(1000);
const oscnUrl = "http://www.oscn.net/dockets/GetCaseInformation.aspx";
const oscnCountyParam = "db";
const oscnCaseNumberParam = "number";

function readCountOffenseDate(description) {
  var matches = description.match(/Date of Offense:\s+(\d+\/\d+\/\d+)/i);
  if(matches.length < 2) return null;
  return matches[1];
}

function readCountDispositions($, countContainer) {
  var dispositionTable = countContainer.find("table").eq(1);
  if(!dispositionTable) return null;

  return dispositionTable.find("tr:has(td)").get().map(tr => {
    const disposition = {};
    disposition.party = $(tr).find("td").eq(1).text().trim();

    const dispositionInfoCell = $(tr).find("td").eq(2)
    const dispositionInfo = dispositionInfoCell.text().trim().replace(/\s+/g, " ");
    //disposition.info = dispositionInfo;
    const infoMatch = dispositionInfo.match(/Disposed:\s+(\w+),\s+(\d+\/\d+\/\d+)\.\s+(.+)\s+Count as Disposed:(.+)/i);

    disposition.outcome = infoMatch ? infoMatch[1] : null;
    disposition.date = infoMatch ? infoMatch[2] : null;
    disposition.type = infoMatch ? infoMatch[3] : null;
    disposition.countAsDisposed = infoMatch ? infoMatch[4] : null;

    return disposition;
  });
}

const readCount = ($) => function() {
  const countContainer = $(this);
  const count = {};

  const countTable = countContainer.find("table.Counts");
  count.id = countTable.find("td").first().text().trim();
  count.description = countTable.find("td.CountDescription").text().trim().replace(/\s+/g, " ");
  count.dateOfOffense = readCountOffenseDate(count.description);
  count.dispositions = readCountDispositions($, countContainer);

  return count;
}

function readCounts(window, $) {
  return $("div.CountsContainer").map(readCount($)).get();
}

export function getCaseInformation(caseNumber, county) {
  return new Promise(function(resolve, reject) {
    if(!caseNumber || !county) {
      reject("caseNumber and county are required");
      return;
    }

    jsdom.env(`${oscnUrl}?${oscnCountyParam}=${county}&${oscnCaseNumberParam}=${caseNumber}`,
      ["http://code.jquery.com/jquery-3.2.0.min.js"],
      function (errors, window) {
        var $ = window.$;

        var parties = [];
        $(".party").next().find("a").each(function() { parties.push({ name: $(this).text().replace(/\s+/g, ' '), type: $(this)[0].nextSibling.nodeValue.replace(",", "").replace("\n", "") }); });

        var dockets = [];

        $(".docketlist").find("tr.docketRow").each(function() {
          var row = $(this);
          var docket = {
            date: $(row.find("td")[0]).text().replace(/\s+/g, ' ').trim(),
            code: $(row.find("td")[1]).text().replace(/\s+/g, ' ').trim(),
            color: ($(row.find("td")[2]).find("font").attr("color") || "BLACK").toUpperCase(),
            description: $(row.find("td")[2]).text().replace(/\s+/g, ' ').trim(),
            count: parseInt($(row.find("td")[3]).text().replace(/\s+/g, ' ').trim()),
            party: $(row.find("td")[4]).text().replace(/\s+/g, ' ').trim(),
            amount: parseFloat($(row.find("td")[5]).text().replace(/\s+/g, ' ').replace("$", "").trim())
          }

          docket.description = wrap($(row.find("td")[2]).text()).split("\n").map(x =>
            x.replace(/\s+/g, ' ').trim()
          ).filter(x => x !== "");

          dockets.push(docket);
        });

        var events = [];

        $("table").has("th:contains(Event)").find("tr").each(function() {
          var row = $(this);
          if(row.find("td").length > 0) {
            var date = $(row.find("td")[0]).find("font").text().replace(/\s+/g, ' ').trim();
            var eventData = {
              date,
              description: $(row.find("td")[0]).text().replace(/\s+/g, ' ').replace(date, "").trim(),
              party: $(row.find("td")[1]).text().replace(/\s+/g, ' ').trim(),
              docket: $(row.find("td")[2]).text().replace(/\s+/g, ' ').trim(),
              reporter: $(row.find("td")[3]).text().replace(/\s+/g, ' ').trim()
            }
            events.push(eventData);
          }
        });

        var defendants = parties.filter(x => x.type == "Defendant").map(x => ({
          name: x.name,
          dockets: dockets.filter(doc => doc.party == x.name),
          events: events.filter(evt => evt.party == x.name),
          counts: []
        }));

        var caseData = {
          parties,
          dockets,
          events,
          counts: readCounts(window, $)
        };

        window.close();

        resolve(caseData);
      }
    );
  });
}
