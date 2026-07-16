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

assert.deepStrictEqual(Settings.normalizeSettings(null), { fontSize: "14", bold: false });
assert.deepStrictEqual(
  Settings.normalizeSettings({ fontSize: "large" }),
  { fontSize: "18", bold: true },
  "the previous large option should migrate to 18 Bold"
);
assert.deepStrictEqual(
  Settings.normalizeSettings({ fontSize: "normal" }),
  { fontSize: "14", bold: false }
);
assert.deepStrictEqual(
  Settings.normalizeSettings({ fontSize: 24, bold: "bold" }),
  { fontSize: "24", bold: true }
);
assert.deepStrictEqual(
  Settings.normalizeSettings({ fontSize: "unexpected", bold: "yes" }),
  { fontSize: "14", bold: true }
);
assert.strictEqual(Settings.profileKey({ fontSize: "14", bold: false }), "14r");
assert.strictEqual(Settings.profileKey({ fontSize: "14", bold: true }), "14b");
assert.strictEqual(Settings.profileKey({ fontSize: "18", bold: false }), "18r");
assert.strictEqual(Settings.profileKey({ fontSize: "18", bold: true }), "18b");
assert.strictEqual(Settings.profileKey({ fontSize: "24", bold: false }), "24r");
assert.strictEqual(Settings.profileKey({ fontSize: "24", bold: true }), "24b");
assert.strictEqual(Settings.pageCharLimit({ fontSize: "14", bold: false }), 360);
assert.strictEqual(Settings.pageCharLimit({ fontSize: "14", bold: true }), 330);
assert.strictEqual(Settings.pageCharLimit({ fontSize: "18", bold: false }), 220);
assert.strictEqual(Settings.pageCharLimit({ fontSize: "18", bold: true }), 200);
assert.strictEqual(Settings.pageCharLimit({ fontSize: "24", bold: false }), 150);
assert.strictEqual(Settings.pageCharLimit({ fontSize: "24", bold: true }), 135);

var storage = memoryStorage();
assert.deepStrictEqual(Settings.loadSettings(storage), { fontSize: "14", bold: false });
Settings.saveSettings({ fontSize: "24", bold: true, ignored: true }, storage);
assert.deepStrictEqual(Settings.loadSettings(storage), { fontSize: "24", bold: true });

var configUrl = Settings.buildConfigPageUrl(
  "https://example.test/config/",
  { fontSize: "24", bold: true },
  123
);
assert(configUrl.indexOf("https://example.test/config/?state=") === 0);
assert(configUrl.indexOf("&v=123") > 0);
assert.deepStrictEqual(
  Settings.readConfigPageState(configUrl.slice(configUrl.indexOf("?"))),
  { fontSize: "24", bold: true }
);
assert.deepStrictEqual(
  Settings.parseConfigPageResponse(
    encodeURIComponent(JSON.stringify({ fontSize: "18", bold: false }))
  ),
  { fontSize: "18", bold: false }
);
assert.deepStrictEqual(
  Settings.parseConfigPageResponse({ response: JSON.stringify({ fontSize: "14", bold: true }) }),
  { fontSize: "14", bold: true }
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
