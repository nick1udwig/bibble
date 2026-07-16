"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var Settings = require("../src/common/settings");

function memoryStorage(initial) {
  var values = initial || {};

  return {
    getItem: function(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setItem: function(key, value) {
      values[key] = String(value);
    }
  };
}

assert.deepStrictEqual(Settings.normalizeSettings(null), { fontSize: "normal" });
assert.deepStrictEqual(Settings.normalizeSettings({ fontSize: "large" }), { fontSize: "large" });
assert.deepStrictEqual(Settings.normalizeSettings({ fontSize: "unexpected" }), { fontSize: "normal" });
assert.strictEqual(Settings.pageCharLimit("normal"), 360);
assert.strictEqual(Settings.pageCharLimit("large"), 200);

var storage = memoryStorage();
assert.deepStrictEqual(Settings.loadSettings(storage), { fontSize: "normal" });
Settings.saveSettings({ fontSize: "large", ignored: true }, storage);
assert.deepStrictEqual(Settings.loadSettings(storage), { fontSize: "large" });

var configUrl = Settings.buildConfigPageUrl("https://example.test/config/", { fontSize: "large" }, 123);
assert(configUrl.indexOf("https://example.test/config/?state=") === 0);
assert(configUrl.indexOf("&v=123") > 0);
assert.deepStrictEqual(
  Settings.readConfigPageState(configUrl.slice(configUrl.indexOf("?"))),
  { fontSize: "large" }
);
assert.deepStrictEqual(
  Settings.parseConfigPageResponse(encodeURIComponent(JSON.stringify({ fontSize: "large" }))),
  { fontSize: "large" }
);
assert.deepStrictEqual(
  Settings.parseConfigPageResponse({ response: JSON.stringify({ fontSize: "normal" }) }),
  { fontSize: "normal" }
);
assert.strictEqual(Settings.parseConfigPageResponse("CANCELLED"), null);

[
  ["src/config/index.html", "docs/config/index.html"],
  ["src/config/app.js", "docs/config/app.js"],
  ["src/config/style.css", "docs/config/style.css"],
  ["src/common/settings.js", "docs/config/settings.js"],
  ["src/config-root.html", "docs/index.html"]
].forEach(function(files) {
  assert.strictEqual(
    fs.readFileSync(path.join(__dirname, "..", files[0]), "utf8"),
    fs.readFileSync(path.join(__dirname, "..", files[1]), "utf8"),
    files[1] + " should be regenerated with npm run build:config:docs"
  );
});

console.log("settings tests passed");
