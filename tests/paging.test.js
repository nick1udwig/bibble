"use strict";

var assert = require("assert");
var Bible = require("../src/pkjs/bible");
var BibbleSettings = require("../src/common/settings");
var testBooks = require("./helpers").testBooks;

var PAGE_CHAR_LIMIT = 200;

Bible.loadFromBooks(testBooks({
  verseText: function(_book, bookIndex, chapter, verse) {
    if (bookIndex === 0 && chapter === 1 && verse === 1) {
      return new Array(700 + 1).join("a");
    }
    return null;
  }
}));

var firstPage = Bible.getChapterPage(0, 1, 1, 1);
var defaultPageCount = firstPage.pageCount;
var profiles = [
  { fontSize: "18", bold: true },
  { fontSize: "14", bold: false },
  { fontSize: "14", bold: true },
  { fontSize: "18", bold: false },
  { fontSize: "24", bold: false },
  { fontSize: "24", bold: true },
  { fontSize: "28", bold: false },
  { fontSize: "28", bold: true }
];
var profileIndex;
var pageNumber;
var page;

for (pageNumber = 1; pageNumber <= firstPage.pageCount; pageNumber += 1) {
  page = Bible.getChapterPage(0, 1, 0, pageNumber);
  assert(
    page.text.length < 2048,
    "page " + String(pageNumber) + " should fit within the watch payload limit"
  );
}

assert.strictEqual(Bible.fontSize(), BibbleSettings.FONT_SIZE_18);
assert.strictEqual(Bible.fontBold(), true);
assert.strictEqual(Bible.fontProfile(), "18b");
assert.strictEqual(Bible.cacheInfo().chapters, 1);

for (profileIndex = 1; profileIndex < profiles.length; profileIndex += 1) {
  assert.strictEqual(Bible.setSettings(profiles[profileIndex]), true);
  firstPage = Bible.getChapterPage(0, 1, 1, 1);
  assert.strictEqual(
    Bible.cacheInfo().chapters,
    profileIndex + 1,
    "each size and boldness combination should keep its own cached pages"
  );
  for (pageNumber = 1; pageNumber <= firstPage.pageCount; pageNumber += 1) {
    page = Bible.getChapterPage(0, 1, 0, pageNumber);
    assert(
      page.text.length < 2048,
      Bible.fontProfile() + " page " + String(pageNumber) + " should fit the reader buffer"
    );
  }
}

assert(firstPage.pageCount > defaultPageCount, "28 Bold should split the chapter into more pages");
assert.strictEqual(Bible.setSettings(profiles[0]), true);
assert.strictEqual(
  Bible.getChapterPage(0, 1, 1, 1).pageCount,
  defaultPageCount,
  "switching back should reuse the default 18 Bold pagination profile"
);
assert.strictEqual(Bible.cacheInfo().chapters, profiles.length, "switching back should reuse the cached profile");

page = Bible.getChapterPage(42, 3, 16, 0);
assert.strictEqual(page.bookName, "John");
assert.strictEqual(page.chapter, 3);
assert(page.text.indexOf("16.") !== -1, "John 3:16 page should include verse marker");

var invalidVersePage = Bible.getChapterPage(42, 3, 999, 0);
assert.strictEqual(invalidVersePage.bookName, "John");
assert.strictEqual(invalidVersePage.chapter, 3);
assert.strictEqual(invalidVersePage.verse, 1, "invalid verse lookup should report fallback page verse");

var previousFromFirst = Bible.getAdjacentPage(0, 1, firstPage.page, -1);
assert.strictEqual(previousFromFirst.bookName, "Genesis");
assert.strictEqual(previousFromFirst.chapter, 1);
assert.strictEqual(previousFromFirst.page, 1);

var invalidPrevious = Bible.getAdjacentPage(999, 999, 1, -1);
assert.strictEqual(invalidPrevious.bookName, "Genesis");
assert.strictEqual(invalidPrevious.chapter, 1);
assert.strictEqual(invalidPrevious.page, 1);

var sameChapter = Bible.getAdjacentPage(42, 3, 999, 0);
assert.strictEqual(sameChapter.bookName, "John");
assert.strictEqual(sameChapter.chapter, 3);

// Every screen uses the bitmap metrics, including descenders and round chords.
var Layout = require("../src/common/reader-layout");
var john316 = "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";
["emery", "gabbro"].forEach(function(platform) {
  profiles.forEach(function(profile) {
    var geo = Layout.geometry(profile, platform);
    var verses = [john316, new Array(701).join("a"), new Array(1401).join("i"), "Next verse with gyp descenders."];
    var result = Layout.paginate(verses, profile, platform);
    assert.strictEqual(result.pages.join("").replace(/\s/g, ""), verses.map(function(v, i) { return (i + 1) + ". " + v; }).join("").replace(/\s/g, ""), "pagination preserves every character");
    result.pages.forEach(function(page, index) {
      var lines = page.split("\n");
      assert(lines.length <= geo.rows.length);
      assert(Buffer.byteLength(page, "utf8") < 2048);
      lines.forEach(function(line, i) {
        assert(Layout.width(geo.font, line) <= geo.rows[i].width);
        assert(geo.rows[i].y + geo.font.bottom <= geo.height - 4);
      });
      if (index < result.pages.length - 1) {
        assert(lines.length === geo.rows.length || /^\d+\.\s/.test(result.pages[index + 1]), "only verse boundaries may leave unused rows");
      }
    });
    // A verse that fits a fresh screen must never be split to fill the
    // previous screen. Build a near-full page from one-line short verses.
    var shortVerses = new Array(geo.rows.length - 1).fill("Amen.");
    var twoLines = "The Lord is my shepherd; I shall not want.";
    while (Layout.paginate([twoLines], profile, platform).pages[0].split("\n").length < 2) {
      twoLines += " Amen.";
    }
    var whole = Layout.paginate(shortVerses.concat([twoLines]), profile, platform);
    assert.strictEqual(whole.pages.length, 2);
    assert(whole.pages[1].indexOf(geo.rows.length + ". ") === 0, "new page starts with the next verse number");
    assert.strictEqual(whole.versePage[geo.rows.length], 2);
    assert.strictEqual(whole.pageFirstVerse[2], geo.rows.length);
    assert.strictEqual(whole.pages[1].replace(/\s+/g, " "), geo.rows.length + ". " + twoLines);
    var packed = Layout.paginate(["Amen.", "Amen."], profile, platform);
    assert.strictEqual(packed.pages.length, 1, "pack multiple whole verses when they fit");
    var john = Layout.paginate([john316], profile, platform, 16);
    if (platform === "emery" && profile.fontSize === "28") {
      assert(john.pages.length > 1, "Very large must continue on another screen");
    }
    if (platform === "emery" && profile.fontSize === "24") {
      assert.strictEqual(john.pages.length, 1, "John 3:16 fits a 24px screen");
    }
  });
});
console.log("paging tests passed");
