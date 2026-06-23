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

console.log("paging tests passed");
