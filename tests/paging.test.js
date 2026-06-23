"use strict";

var assert = require("assert");
var Bible = require("../src/pkjs/bible");
var testBooks = require("./helpers").testBooks;

var PAGE_CHAR_LIMIT = 360;

Bible.loadFromBooks(testBooks({
  verseText: function(_book, bookIndex, chapter, verse) {
    if (bookIndex === 0 && chapter === 1 && verse === 1) {
      return new Array(PAGE_CHAR_LIMIT + 42).join("a");
    }
    return null;
  }
}));

var firstPage = Bible.getChapterPage(0, 1, 1, 1);
var pageNumber;
var page;

for (pageNumber = 1; pageNumber <= firstPage.pageCount; pageNumber += 1) {
  page = Bible.getChapterPage(0, 1, 0, pageNumber);
  assert(
    page.text.length <= PAGE_CHAR_LIMIT,
    "page " + String(pageNumber) + " should fit within the watch payload limit"
  );
}

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

console.log("paging tests passed");
