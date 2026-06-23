"use strict";

var assert = require("assert");
var fs = require("fs");
var Bible = require("../src/pkjs/bible");

function ref(input, bookName, chapter, verse) {
  var parsed = Bible.parseReference(input);
  assert.strictEqual(parsed.ok, true, input + " should parse");
  assert.strictEqual(parsed.bookName, bookName, input + " book");
  assert.strictEqual(parsed.chapter, chapter, input + " chapter");
  assert.strictEqual(parsed.verse, verse, input + " verse");
}

function fail(input) {
  var parsed = Bible.parseReference(input);
  assert.strictEqual(parsed.ok, false, input + " should fail");
}

ref("psalms 23", "Psalms", 23, 1);
ref("Psalm twenty three", "Psalms", 23, 1);
ref("psalm 23 verse 4", "Psalms", 23, 4);
ref("soulm twenty three", "Psalms", 23, 1);
ref("salm twenty three", "Psalms", 23, 1);
ref("John three sixteen", "John", 3, 16);
ref("John one twenty", "John", 1, 20);
ref("first john two one", "1 John", 2, 1);
ref("1st Corinthians 13:4", "1 Corinthians", 13, 4);
ref("Song of Solomon 2 1", "Song of Solomon", 2, 1);
ref("Jude 5", "Jude", 1, 5);
ref("revelations twenty one four", "Revelation", 21, 4);
ref("psalm one nineteen", "Psalms", 119, 1);
ref("psalm one twenty", "Psalms", 120, 1);
ref("psalm one twenty three", "Psalms", 123, 1);
fail("somewhere around breakfast");
fail("John 99");

assert.strictEqual(Bible.isLoaded(), false, "KJV text should not be bundled at initial load");
Bible.loadFromJsonText(fs.readFileSync("/tmp/bibble-kjv.json", "utf8"));
assert.strictEqual(Bible.isLoaded(), true, "KJV text should load into PKJS state");

var page = Bible.getChapterPage(42, 3, 16, 0);
assert.strictEqual(page.bookName, "John");
assert.strictEqual(page.chapter, 3);
assert(page.text.indexOf("16.") !== -1, "John 3:16 page should include verse marker");

console.log("parser tests passed");
