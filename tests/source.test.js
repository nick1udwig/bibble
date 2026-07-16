"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var KJV_SOURCE = require("../src/common/kjv-source");

assert.strictEqual(KJV_SOURCE.repository, "nick1udwig/bible");
assert.strictEqual(KJV_SOURCE.ref, "master");
assert.strictEqual(KJV_SOURCE.path, "json/en_kjv.json");
assert.strictEqual(
  KJV_SOURCE.url,
  "https://raw.githubusercontent.com/nick1udwig/bible/master/json/en_kjv.json"
);
assert.strictEqual(KJV_SOURCE.storageVersion, "nick1udwig-bible-master-v1");

var generatedMetadata = fs.readFileSync(path.join(__dirname, "../src/pkjs/bible-meta.js"), "utf8");
assert(
  generatedMetadata.indexOf(" * Source: " + KJV_SOURCE.url) !== -1,
  "generated metadata should record the canonical source"
);

console.log("source tests passed");
