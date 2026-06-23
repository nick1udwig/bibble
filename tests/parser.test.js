"use strict";

var assert = require("assert");
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
ref("the Psalm twenty three", "Psalms", 23, 1);
ref("Psalm twenty three", "Psalms", 23, 1);
ref("psalm 23 verse 4", "Psalms", 23, 4);
ref("soulm twenty three", "Psalms", 23, 1);
ref("salm twenty three", "Psalms", 23, 1);
ref("John three sixteen", "John", 3, 16);
ref("John 316", "John", 3, 16);
ref("jn three sixteen", "John", 3, 16);
ref("book of John three sixteen", "John", 3, 16);
ref("book John three sixteen", "John", 3, 16);
ref("the book of John three sixteen", "John", 3, 16);
ref("the book John three sixteen", "John", 3, 16);
ref("go to John three sixteen", "John", 3, 16);
ref("turn to John three sixteen", "John", 3, 16);
ref("open psalm twenty three", "Psalms", 23, 1);
ref("show me Romans eight twenty eight", "Romans", 8, 28);
ref("John one twenty", "John", 1, 20);
ref("John first twenty", "John", 1, 20);
ref("first john two one", "1 John", 2, 1);
ref("1st Corinthians 13:4", "1 Corinthians", 13, 4);
ref("Song of Solomon 2 1", "Song of Solomon", 2, 1);
ref("the Song of Solomon 2 1", "Song of Solomon", 2, 1);
ref("jn one one", "Jonah", 1, 1);
ref("jn four eleven", "Jonah", 4, 11);
ref("Jude 5", "Jude", 1, 5);
ref("revelations twenty one four", "Revelation", 21, 4);
ref("revelation twenty first four", "Revelation", 21, 4);
ref("Romans 828", "Romans", 8, 28);
ref("psalm one nineteen", "Psalms", 119, 1);
ref("psalm one hundred nineteen", "Psalms", 119, 1);
ref("psalm one hundred and nineteen", "Psalms", 119, 1);
ref("psalm one twenty", "Psalms", 120, 1);
ref("psalm one twenty three", "Psalms", 123, 1);
ref("psalm one twenty three four", "Psalms", 123, 4);
ref("psalm one zero one", "Psalms", 101, 1);
ref("psalm one oh one", "Psalms", 101, 1);
ref("psalm first oh first", "Psalms", 101, 1);
ref("psalm one twenty verse three", "Psalms", 120, 3);
ref("psalm one twenty three verse four", "Psalms", 123, 4);
ref("psalm one oh one verse five", "Psalms", 101, 5);
ref("psalm one nineteen verse one hundred seventy six", "Psalms", 119, 176);
ref("psalm one nineteen verse one hundred and seventy six", "Psalms", 119, 176);
ref("psalm one nineteen one seventy six", "Psalms", 119, 176);
ref("psalm one nineteen verse one seventy six", "Psalms", 119, 176);
ref("psalm one nineteen verse one five", "Psalms", 119, 15);
ref("john twenty one", "John", 21, 1);
fail("somewhere around breakfast");
fail("John 99");
fail("John 3 16 17");
fail("psalm 23 verse 4 5");

console.log("parser tests passed");
