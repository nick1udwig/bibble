"use strict";

var childProcess = require("child_process");
var fs = require("fs");
var path = require("path");

var testDir = __dirname;
var tests = fs.readdirSync(testDir).filter(function(file) {
  return /\.test\.js$/.test(file);
}).sort();
var index;
var result;

for (index = 0; index < tests.length; index += 1) {
  result = childProcess.spawnSync(process.execPath, [path.join(testDir, tests[index])], {
    stdio: "inherit"
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
