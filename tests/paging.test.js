"use strict";

var assert = require("assert");
var Bible = require("../src/pkjs/bible");
var KJV_META = require("../src/pkjs/bible-meta");

var PAGE_CHAR_LIMIT = 360;

function testBooks() {
  return KJV_META.map(function(book, bookIndex) {
    return {
      abbrev: book.abbrev,
      chapters: book.verseCounts.map(function(verseCount, chapterIndex) {
        var verses = [];
        var verse;

        for (verse = 1; verse <= verseCount; verse += 1) {
          if (bookIndex === 0 && chapterIndex === 0 && verse === 1) {
            verses.push(new Array(PAGE_CHAR_LIMIT + 42).join("a"));
          } else {
            verses.push(book.name + " " + String(chapterIndex + 1) + ":" + String(verse));
          }
        }
        return verses;
      })
    };
  });
}

Bible.loadFromBooks(testBooks());

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
