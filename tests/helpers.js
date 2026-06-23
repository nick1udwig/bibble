"use strict";

var KJV_META = require("../src/pkjs/bible-meta");

function testBooks(options) {
  options = options || {};

  return KJV_META.map(function(book, bookIndex) {
    return {
      abbrev: book.abbrev,
      chapters: book.verseCounts.map(function(verseCount, chapterIndex) {
        var chapter = chapterIndex + 1;
        var verses = [];
        var verse;
        var override;

        for (verse = 1; verse <= verseCount; verse += 1) {
          override = options.verseText ? options.verseText(book, bookIndex, chapter, verse) : null;
          verses.push(override == null ? book.name + " " + String(chapter) + ":" + String(verse) : override);
        }
        return verses;
      })
    };
  });
}

function freshBible() {
  var modulePath = require.resolve("../src/pkjs/bible");
  delete require.cache[modulePath];
  return require("../src/pkjs/bible");
}

module.exports = {
  KJV_META: KJV_META,
  freshBible: freshBible,
  testBooks: testBooks
};
