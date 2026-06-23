"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var KJV_META = require("../src/pkjs/bible-meta");

var header = fs.readFileSync(path.join(__dirname, "../src/c/bible_meta.h"), "utf8");

function defineValue(name) {
  var match = header.match(new RegExp("#define\\s+" + name + "\\s+(\\d+)"));
  assert(match, name + " should be defined");
  return parseInt(match[1], 10);
}

function arrayBody(name) {
  var pattern = new RegExp(name + "[^=]*=\\s*\\{([\\s\\S]*?)\\};");
  var match = header.match(pattern);
  assert(match, name + " should be present");
  return match[1];
}

function parseCStringArray(name) {
  var matches = arrayBody(name).match(/"([^"\\]*(?:\\.[^"\\]*)*)"/g) || [];
  return matches.map(function(value) {
    return JSON.parse(value);
  });
}

function parseNumberArray(name) {
  return (arrayBody(name).match(/\d+/g) || []).map(function(value) {
    return parseInt(value, 10);
  });
}

var bookNames = parseCStringArray("BIBBLE_BOOK_NAMES");
var chapterCounts = parseNumberArray("BIBBLE_BOOK_CHAPTER_COUNTS");
var chapterOffsets = parseNumberArray("BIBBLE_BOOK_CHAPTER_OFFSETS");
var verseCounts = parseNumberArray("BIBBLE_CHAPTER_VERSE_COUNTS");
var expectedChapterOffset = 0;
var expectedVerseCounts = [];

assert.strictEqual(defineValue("BIBBLE_BOOK_COUNT"), KJV_META.length);
assert.strictEqual(bookNames.length, KJV_META.length);
assert.strictEqual(chapterCounts.length, KJV_META.length);
assert.strictEqual(chapterOffsets.length, KJV_META.length);

KJV_META.forEach(function(book, index) {
  assert.strictEqual(bookNames[index], book.name, book.name + " name should match");
  assert.strictEqual(chapterCounts[index], book.verseCounts.length, book.name + " chapter count should match");
  assert.strictEqual(chapterOffsets[index], expectedChapterOffset, book.name + " chapter offset should match");
  expectedChapterOffset += book.verseCounts.length;
  expectedVerseCounts = expectedVerseCounts.concat(book.verseCounts);
});

assert.strictEqual(defineValue("BIBBLE_CHAPTER_COUNT"), expectedVerseCounts.length);
assert.deepStrictEqual(verseCounts, expectedVerseCounts);

console.log("metadata tests passed");
