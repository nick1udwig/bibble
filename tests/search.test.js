"use strict";

var assert = require("assert");
var SearchIndex = require("../src/pkjs/search-index");
var StorageCodec = require("../src/pkjs/storage-codec");

var meta = [
  {
    name: "Genesis",
    verseCounts: [5]
  },
  {
    name: "John",
    verseCounts: [6]
  }
];

var books = [
  [[
    "In the beginning God created the heaven and the earth.",
    "God came for every person in the world and so deeply loved them.",
    "The world was without form, and void.",
    "Light entered the world before the morning.",
    "The people of the world saw the light."
  ]],
  [[
    "For God so loved the world, that he gave his only begotten Son.",
    "God loved all the people dwelling throughout this wide world.",
    "He was in the world, and the world was made by him.",
    "The world knew him not.",
    "This is the true Light, which lighteth every man in the world.",
    "Behold the Lamb of God, which taketh away the sin of the world."
  ]]
];

function memoryStorage(initial) {
  var values = initial || {};
  return {
    values: values,
    getItem: function(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setItem: function(key, value) {
      values[key] = String(value);
    },
    removeItem: function(key) {
      delete values[key];
    }
  };
}

function characterQuotaStorage(limit) {
  var storage = memoryStorage();

  storage.setItem = function(key, value) {
    var next = String(value);
    var total = next.length;

    Object.keys(storage.values).forEach(function(existingKey) {
      if (existingKey !== key) {
        total += storage.values[existingKey].length;
      }
    });
    if (total > limit) {
      throw new Error("quota exceeded");
    }
    storage.values[key] = next;
  };
  return storage;
}

function source(reads) {
  return {
    getBookChapters: function(bookIndex) {
      if (reads) {
        reads.count += 1;
      }
      return books[bookIndex];
    }
  };
}

function verseText(bookIndex, chapter, verse) {
  return books[bookIndex][chapter - 1][verse - 1];
}

function immediate(callback) {
  callback();
}

function referenceKey(hit) {
  return [hit.bookIndex, hit.chapter, hit.verse].join(":");
}

var storage = memoryStorage();
var progress = [];
var callbackCount = 0;
var index = new SearchIndex({
  corpusVersion: "test-corpus-v1",
  meta: meta,
  getStorage: function() {
    return storage;
  },
  schedule: immediate
});

index.ensureReady(source(), function(error) {
  var phrase;
  var fuzzy;
  var omitted;
  var typo;
  var firstPage;
  var secondPage;
  var firstReferences;
  var rankedVerseReads;
  var restoredReads;
  var restored;

  callbackCount += 1;
  assert.strictEqual(error, null);
  assert.strictEqual(callbackCount, 1);
  assert.strictEqual(index.isReady(), true);
  assert.strictEqual(progress[0], 0);
  assert.strictEqual(progress[progress.length - 1], 100);
  assert.strictEqual(
    storage.values[SearchIndex.constants.markerKey],
    "test-corpus-v1." + SearchIndex.constants.schemaVersion
  );
  assert(storage.values[SearchIndex.constants.metaKey], "index metadata should persist");
  for (var shard = 0; shard < SearchIndex.constants.shardCount; shard += 1) {
    assert(
      storage.values[SearchIndex.constants.shardKeyPrefix + String(shard)],
      "every index shard should persist"
    );
    assert(
      StorageCodec.isCompressed(storage.values[SearchIndex.constants.shardKeyPrefix + String(shard)]),
      "every persisted index shard should be compressed"
    );
  }
  assert(StorageCodec.isCompressed(storage.values[SearchIndex.constants.metaKey]));

  phrase = index.search("search the bible for God so loved", 0, 5, verseText);
  assert(phrase.total >= 2);
  assert.deepStrictEqual(
    [phrase.hits[0].bookIndex, phrase.hits[0].chapter, phrase.hits[0].verse],
    [1, 1, 1],
    "an exact phrase should rank ahead of looser suggestions"
  );
  assert(phrase.hits[0].excerpt.indexOf("{God so loved}") !== -1);
  assert(Buffer.byteLength(phrase.hits[0].excerpt, "utf8") <= 64);

  fuzzy = index.search("for God so loaded the world", 0, 5, verseText);
  assert.deepStrictEqual(
    [fuzzy.hits[0].bookIndex, fuzzy.hits[0].chapter, fuzzy.hits[0].verse],
    [1, 1, 1],
    "a mistranscribed term should still surface the intended passage"
  );
  assert(/[{}]/.test(fuzzy.hits[0].excerpt), "fuzzy excerpts should mark contributing terms");

  omitted = index.search("God loved world", 0, 10, verseText);
  assert(omitted.hits.some(function(hit) {
    return hit.bookIndex === 1 && hit.chapter === 1 && hit.verse === 1;
  }), "a query with an omitted word should still contain the intended passage");

  typo = index.search("in the begining", 0, 5, verseText);
  assert.deepStrictEqual(
    [typo.hits[0].bookIndex, typo.hits[0].chapter, typo.hits[0].verse],
    [0, 1, 1],
    "phonetic normalization should handle a misspelling"
  );
  assert(typo.hits[0].excerpt.indexOf("{In the beginning}") !== -1);

  rankedVerseReads = 0;
  firstPage = index.search("world", 0, 5, function(bookIndex, chapter, verse) {
    rankedVerseReads += 1;
    return verseText(bookIndex, chapter, verse);
  });
  assert.strictEqual(
    rankedVerseReads,
    5,
    "index-resident ranking should hydrate only the displayed verses"
  );
  secondPage = index.search("world", 5, 5, verseText);
  assert.strictEqual(firstPage.total, 10);
  assert.strictEqual(firstPage.hits.length, 5);
  assert.strictEqual(secondPage.hits.length, 5);
  firstReferences = {};
  firstPage.hits.forEach(function(hit) {
    firstReferences[referenceKey(hit)] = true;
  });
  secondPage.hits.forEach(function(hit) {
    assert.strictEqual(firstReferences[referenceKey(hit)], undefined, "pages should not overlap");
    assert(hit.excerpt.indexOf("{") !== -1 && hit.excerpt.indexOf("}") !== -1);
  });

  restoredReads = { count: 0 };
  restored = new SearchIndex({
    corpusVersion: "test-corpus-v1",
    meta: meta,
    getStorage: function() {
      return storage;
    },
    schedule: immediate
  });
  restored.ensureReady(source(restoredReads), function(restoreError) {
    var corruptValues = {};
    var corruptStorage;
    var corruptReads = { count: 0 };
    var corrupt;

    assert.strictEqual(restoreError, null);
    assert.strictEqual(restoredReads.count, 0, "a complete index should restore without rebuilding");
    assert.strictEqual(restored.search("world", 0, 5, verseText).total, 10);

    Object.keys(storage.values).forEach(function(key) {
      corruptValues[key] = storage.values[key];
    });
    corruptValues[SearchIndex.constants.metaKey] = "invalid";
    corruptStorage = memoryStorage(corruptValues);
    corrupt = new SearchIndex({
      corpusVersion: "test-corpus-v1",
      meta: meta,
      getStorage: function() {
        return corruptStorage;
      },
      schedule: immediate
    });
    corrupt.ensureReady(source(corruptReads), function(corruptError) {
      var quotaStorage = memoryStorage();
      var memoryOnly;

      assert.strictEqual(corruptError, null);
      assert(corruptReads.count > 0, "a corrupt persisted index should rebuild from the corpus");
      assert.strictEqual(corrupt.search("world", 0, 5, verseText).total, 10);

      quotaStorage.setItem = function() {
        throw new Error("quota exceeded");
      };
      memoryOnly = new SearchIndex({
        corpusVersion: "test-corpus-v1",
        meta: meta,
        getStorage: function() {
          return quotaStorage;
        },
        schedule: immediate
      });
      memoryOnly.ensureReady(source(), function(memoryError) {
        var compressedCharacters = 0;
        var expandedCharacters = 0;
        var quotaLimit;
        var quotaConstrainedStorage;
        var quotaConstrained;

        assert.strictEqual(memoryError, null);
        assert.strictEqual(memoryOnly.isReady(), true);
        assert.strictEqual(memoryOnly.search("world", 0, 5, verseText).total, 10);
        assert.strictEqual(quotaStorage.values[SearchIndex.constants.markerKey], undefined);
        assert.strictEqual(
          SearchIndex.normalizeQuery("Please find FOR GOD so loved!"),
          "for god so loved"
        );

        Object.keys(storage.values).forEach(function(key) {
          var stored = storage.values[key];

          compressedCharacters += stored.length;
          expandedCharacters += StorageCodec.isCompressed(stored)
            ? StorageCodec.decompress(stored).length
            : stored.length;
        });
        assert(compressedCharacters < expandedCharacters, "compression should reduce index storage");
        quotaLimit = compressedCharacters +
          Math.floor((expandedCharacters - compressedCharacters) / 2);
        quotaConstrainedStorage = characterQuotaStorage(quotaLimit);
        quotaConstrained = new SearchIndex({
          corpusVersion: "test-corpus-v1",
          meta: meta,
          getStorage: function() {
            return quotaConstrainedStorage;
          },
          schedule: immediate
        });
        quotaConstrained.ensureReady(source(), function(quotaError) {
          var quotaRestoreReads = { count: 0 };
          var quotaRestored;

          assert.strictEqual(quotaError, null);
          assert.strictEqual(
            quotaConstrainedStorage.values[SearchIndex.constants.markerKey],
            "test-corpus-v1." + SearchIndex.constants.schemaVersion,
            "the compressed index should persist within a quota too small for plaintext"
          );
          quotaRestored = new SearchIndex({
            corpusVersion: "test-corpus-v1",
            meta: meta,
            getStorage: function() {
              return quotaConstrainedStorage;
            },
            schedule: immediate
          });
          quotaRestored.ensureReady(source(quotaRestoreReads), function(quotaRestoreError) {
            assert.strictEqual(quotaRestoreError, null);
            assert.strictEqual(
              quotaRestoreReads.count,
              0,
              "a quota-constrained restart should restore rather than reindex"
            );
            assert.strictEqual(quotaRestored.search("world", 0, 5, verseText).total, 10);
            console.log("search tests passed");
          });
        });
      });
    });
  });
}, function(percent) {
  progress.push(percent);
});
