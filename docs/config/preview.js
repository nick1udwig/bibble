(function(root) {
  "use strict";

  var sample = "16. For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";

  function width(font, text) {
    return text.split("").reduce(function(total, ch) {
      return total + font.glyphs[ch][4];
    }, 0);
  }

  function text(ctx, font, value, x, y) {
    value.split("").forEach(function(ch) {
      var g = font.glyphs[ch];
      for (var row = 0; row < g[1]; row += 1) {
        for (var col = 0; col < g[0]; col += 1) {
          if (g[5][row] & (1 << col)) {
            ctx.fillRect(x + g[2] + col, y + g[3] + row, 1, 1);
          }
        }
      }
      x += g[4];
    });
  }

  function draw(canvas, settings, platform, pageIndex) {
    var round = platform === "gabbro";
    var w = round ? 260 : 200;
    var h = round ? 260 : 228;
    var size = Number(settings.fontSize);
    var font = root.BibblePreviewFonts[size + (settings.bold ? "b" : "r")];
    var headerFont = round ? root.BibblePreviewFonts["14b"] : font;
    var headerHeight = round ? 38 : size + 4;
    canvas.width = w;
    canvas.height = h;
    canvas.setAttribute("data-watch", platform);
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, w, h);
    if (round) {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
      ctx.clip();
    }
    ctx.fillStyle = "black";
    text(ctx, headerFont, "John 3", round ? Math.floor((w - width(headerFont, "John 3")) / 2) : 4, round ? 18 : 0);
    text(ctx, headerFont, "10:09", round ? Math.floor((w - width(headerFont, "10:09")) / 2) : w - 4 - width(headerFont, "10:09"), 0);
    var layout = root.BibbleReaderLayout;
    var geo = layout.geometry(settings, platform);
    var pages = layout.paginate([sample.replace(/^16\. /, "")], settings, platform, 16);
    pages.pages[Math.min(pageIndex || 0, pages.pages.length - 1)].split("\n").forEach(function(line, index) {
      text(ctx, font, line, geo.rows[index].x, geo.rows[index].y);
    });
    return pages.pages.length;
  }

  root.BibblePreview = { draw: draw };
}(window));
