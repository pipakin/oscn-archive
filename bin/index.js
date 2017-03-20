"use strict";

var _caseRetriever = require("./caseRetriever");

var _fs = require("fs");

var _fs2 = _interopRequireDefault(_fs);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

(0, _caseRetriever.getCaseInformation)("CF-2016-1", "tulsa").then(function (caseInfo) {
  return _fs2.default.writeFileSync("cf20161.json", JSON.stringify(caseInfo));
});