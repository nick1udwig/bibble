(function(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./font-metrics"));
  else root.BibbleReaderLayout = factory(root.BibbleFontMetrics);
}(this, function(metrics) {
  "use strict";
  function geometry(settings, platform) {
    var font = metrics[settings.fontSize + (settings.bold ? "b" : "r")];
    var round = platform === "gabbro";
    var width = round ? 260 : 200;
    var height = round ? 260 : 228;
    var start = round ? 38 : font.height + 8;
    var rows = [];
    for (var y = start; y + font.bottom <= height - 4; y += font.height) {
      var inset = 4;
      if (round) {
        var distance = Math.max(Math.abs(y + font.top - height / 2), Math.abs(y + font.bottom - 1 - height / 2));
        // Integer chord calculation also used by the watch renderer.
        while ((width / 2 - inset + 4) * (width / 2 - inset + 4) + distance * distance > width * width / 4) inset += 1;
      }
      rows.push({ x: inset, y: y, width: width - inset * 2 });
    }
    return { font: font, width: width, height: height, rows: rows };
  }
  function width(font, value) {
    var advance = 0, right = 0;
    for (var i = 0; i < value.length; i += 1) {
      var g = font.glyphs[value[i]] || font.glyphs["?"];
      right = Math.max(right, advance + g[2] + g[0]);
      advance += g[4];
    }
    return Math.max(right, advance);
  }
  function paginate(verses, settings, platform, firstVerse) {
    var geo = geometry(settings, platform);
    var pages = [], firstVerses = [1], versePages = [0], lines = [], first = 1;
    function flush() {
      if (!lines.length) return;
      pages.push(lines.join("\n"));
      firstVerses[pages.length] = first;
      lines = [];
    }
    function takeLine(remaining, rowIndex) {
      var row = geo.rows[rowIndex];
      var end = 0, space = 0;
      while (end < remaining.length && width(geo.font, remaining.slice(0, end + 1)) <= row.width) {
        if (remaining[end] === " ") space = end;
        end += 1;
      }
      if (end < remaining.length && remaining[end] !== " " && space > 0) end = space;
      if (!end) throw new Error("Reader row cannot fit a glyph");
      return {
        text: remaining.slice(0, end).replace(/\s+$/, ""),
        rest: remaining.slice(end).replace(/^\s+/, "")
      };
    }
    function fits(remaining, rowIndex) {
      while (remaining.length && rowIndex < geo.rows.length) {
        remaining = takeLine(remaining, rowIndex).rest;
        rowIndex += 1;
      }
      return !remaining.length;
    }
    verses.forEach(function(verse, index) {
      index += (firstVerse || 1) - 1;
      var remaining = String(index + 1) + ". " + verse;
      // Pack whole verses. Only a verse longer than a fresh screen may split;
      // measure at the actual starting row because round-screen widths vary.
      if (lines.length && !fits(remaining, lines.length)) flush();
      while (remaining.length) {
        if (lines.length === geo.rows.length) flush();
        var line = takeLine(remaining, lines.length);
        if (!lines.length) first = index + 1;
        if (!versePages[index + 1]) versePages[index + 1] = pages.length + 1;
        lines.push(line.text);
        remaining = line.rest;
      }
    });
    flush();
    return { pages: pages.length ? pages : [""], pageFirstVerse: firstVerses, versePage: versePages };
  }
  return { geometry: geometry, width: width, paginate: paginate };
}));
