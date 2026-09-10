"use strict";
var assert = require("assert");
var fs = require("fs");
var vm = require("vm");
var path = require("path");
var context = { window: {} };
["preview-fonts.js", "preview.js"].forEach(function(file) {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/config", file), "utf8"), context);
});
function render(size, bold, platform) {
  var pixels = [];
  var canvas = {
    setAttribute: function() {},
    getContext: function() {
      return {
        fillRect: function(x, y, w, h) {
          if (w === 1 && h === 1) {
            assert(x >= 0 && x < canvas.width && y >= 0 && y < canvas.height, "glyph pixels must fit the screen");
            pixels.push([x, y]);
          }
        },
        beginPath: function() {}, arc: function() {}, clip: function() {}
      };
    }
  };
  context.window.BibblePreview.draw(canvas, { fontSize: String(size), bold: bold }, platform);
  assert.strictEqual(canvas.width, platform === "gabbro" ? 260 : 200);
  assert.strictEqual(canvas.height, platform === "gabbro" ? 260 : 228);
  assert(pixels.length > 100, "preview should draw bitmap glyphs");
  return pixels;
}
["gabbro", "emery"].forEach(function(platform) {
  var header;
  [14, 18, 24, 28].forEach(function(size) {
    var regular = render(size, false, platform);
    var bold = render(size, true, platform);
    assert.notDeepStrictEqual(regular, bold, "bold must use a different bitmap face");
    if (platform === "gabbro") {
      [regular, bold].forEach(function(pixels) {
        var current = pixels.filter(function(pixel) { return pixel[1] < 38; });
        if (header) assert.deepStrictEqual(current, header, "round header stays compact across all profiles");
        header = current;
      });
    }
  });
});
console.log("preview tests passed");
