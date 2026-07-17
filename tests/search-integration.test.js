"use strict";

var assert = require("assert");
var helpers = require("./helpers");
var SearchIndex = require("../src/pkjs/search-index");
var KJV_SOURCE = require("../src/common/kjv-source");
var StorageCodec = require("../src/pkjs/storage-codec");

function memoryStorage() {
  var values = {};
  var writes = [];
  return {
    values: values,
    writes: writes,
    getItem: function(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setItem: function(key, value) {
      writes.push(key);
      values[key] = String(value);
    },
    removeItem: function(key) {
      delete values[key];
    }
  };
}

var previousStorage = global.localStorage;
var previousRequest = global.XMLHttpRequest;
var storage = memoryStorage();
var networkRequests = 0;
var books = helpers.testBooks({
  verseText: function(book, bookIndex, chapter, verse) {
    if (bookIndex === 42 && chapter === 3 && verse === 16) {
      return "For God so loved the world, that he gave his only begotten Son.";
    }
    return book.name + " chapter " + String(chapter) + " verse " + String(verse);
  }
});

function restoreGlobals() {
  if (previousStorage === undefined) {
    delete global.localStorage;
  } else {
    global.localStorage = previousStorage;
  }
  if (previousRequest === undefined) {
    delete global.XMLHttpRequest;
  } else {
    global.XMLHttpRequest = previousRequest;
  }
}

global.localStorage = storage;
global.XMLHttpRequest = function UnexpectedRequest() {
  networkRequests += 1;
};

var Bible = helpers.freshBible();
Bible.loadFromBooks(books);
assert.strictEqual(Bible.isSearchReady(), false);

Bible.ensureSearchReady(function(error) {
  var results;
  var fuzzyResults;
  var RestartedBible;
  var writesBeforeRestart;

  assert.strictEqual(error, null);
  assert.strictEqual(Bible.isSearchReady(), true);
  results = Bible.search("for God so loved", 0, 5);
  assert.strictEqual(results.total, 1);
  assert.deepStrictEqual(
    [results.hits[0].bookIndex, results.hits[0].chapter, results.hits[0].verse],
    [42, 3, 16]
  );
  assert(results.hits[0].excerpt.indexOf("{For God so loved}") !== -1);
  fuzzyResults = Bible.search("for God so loaded the world", 0, 5);
  assert.deepStrictEqual(
    [fuzzyResults.hits[0].bookIndex, fuzzyResults.hits[0].chapter, fuzzyResults.hits[0].verse],
    [42, 3, 16]
  );
  assert(/[{}]/.test(fuzzyResults.hits[0].excerpt));
  assert(storage.values[SearchIndex.constants.markerKey], "index marker should be persisted last");
  assert(StorageCodec.isCompressed(
    storage.values["bibble." + KJV_SOURCE.storageVersion + ".book.42"]
  ));

  writesBeforeRestart = storage.writes.length;
  RestartedBible = helpers.freshBible();
  RestartedBible.ensureLoaded(function(loadError) {
    assert.strictEqual(loadError, null);
  });
  RestartedBible.ensureSearchReady(function(restartError) {
    var MigratedBible;

    assert.strictEqual(restartError, null);
    assert.strictEqual(
      storage.writes.length,
      writesBeforeRestart,
      "a normal restart should restore the completed index without writing or rebuilding"
    );
    assert.strictEqual(networkRequests, 0);

    storage.removeItem(SearchIndex.constants.markerKey);
    MigratedBible = helpers.freshBible();
    MigratedBible.ensureLoaded(function(migrationLoadError) {
      assert.strictEqual(migrationLoadError, null);
    });
    MigratedBible.ensureSearchReady(function(migrationError) {
      var migratedResults;
      var CorruptBible;

      assert.strictEqual(migrationError, null);
      assert.strictEqual(networkRequests, 0, "a missing index should rebuild from cached books");
      migratedResults = MigratedBible.search("for God so loved", 0, 5);
      assert.strictEqual(migratedResults.total, 1);
      assert.strictEqual(storage.values[SearchIndex.constants.markerKey] != null, true);

      storage.removeItem(SearchIndex.constants.markerKey);
      storage.values["bibble." + KJV_SOURCE.storageVersion + ".book.0"] = "{}";
      CorruptBible = helpers.freshBible();
      CorruptBible.ensureLoaded(function(corruptLoadError) {
        assert.strictEqual(corruptLoadError, null);
      });
      CorruptBible.ensureSearchReady(function(corruptIndexError) {
        assert(corruptIndexError, "corrupt cached books should fail indexing without hanging");
        restoreGlobals();
        console.log("search integration tests passed");
      });
    });
  });
});
