"use strict";

var assert = require("assert");
var helpers = require("./helpers");
var KJV_SOURCE = require("../src/common/kjv-source");
var freshBible = helpers.freshBible;
var testBooks = helpers.testBooks;
var storagePrefix = "bibble." + KJV_SOURCE.storageVersion;

var unloadedBible = freshBible();
assert.strictEqual(unloadedBible.isLoaded(), false, "KJV text should not be bundled at initial load");
assert.strictEqual(unloadedBible.loadState(), "idle");

function withXmlHttpRequest(mock, work) {
  var previous = global.XMLHttpRequest;
  global.XMLHttpRequest = mock;
  try {
    work();
  } finally {
    if (previous === undefined) {
      delete global.XMLHttpRequest;
    } else {
      global.XMLHttpRequest = previous;
    }
  }
}

function withLocalStorage(storage, work) {
  var previous = global.localStorage;
  global.localStorage = storage;
  try {
    work();
  } finally {
    if (previous === undefined) {
      delete global.localStorage;
    } else {
      global.localStorage = previous;
    }
  }
}

function memoryStorage() {
  var values = {};
  var reads = [];

  return {
    reads: reads,
    values: values,
    getItem: function(key) {
      reads.push(key);
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

withXmlHttpRequest(function ThrowingRequest() {
  this.open = function() {};
  this.send = function() {
    throw new Error("socket unavailable");
  };
}, function() {
  var Bible = freshBible();
  var callbackCount = 0;

  assert.doesNotThrow(function() {
    Bible.ensureLoaded(function(error) {
      callbackCount += 1;
      assert.strictEqual(error, "KJV download failed");
    });
  });
  assert.strictEqual(callbackCount, 1, "sync send failure should flush pending callbacks");
  assert.strictEqual(Bible.loadState(), "error");
  assert.strictEqual(Bible.lastLoadError(), "KJV download failed");
});

withXmlHttpRequest(function FailingRequest() {
  this.open = function() {};
  this.send = function() {
    this.onerror();
    this.readyState = 4;
    this.status = 0;
    this.onreadystatechange();
  };
}, function() {
  var Bible = freshBible();
  var callbackCount = 0;

  Bible.ensureLoaded(function(error) {
    callbackCount += 1;
    assert.strictEqual(error, "KJV download failed");
  });

  assert.strictEqual(callbackCount, 1, "network failure should settle once");
  assert.strictEqual(Bible.loadState(), "error");
});

withXmlHttpRequest(function TimedOutRequest() {
  this.open = function() {};
  this.send = function() {
    assert.strictEqual(this.timeout, 30000);
    this.ontimeout();
  };
}, function() {
  var Bible = freshBible();
  var callbackCount = 0;

  Bible.ensureLoaded(function(error) {
    callbackCount += 1;
    assert.strictEqual(error, "KJV download timed out");
  });

  assert.strictEqual(callbackCount, 1, "timeout should flush pending callbacks");
  assert.strictEqual(Bible.loadState(), "error");
});

withXmlHttpRequest(function HangingRequest() {
  this.open = function() {};
  this.send = function() {};
}, function() {
  var Bible = freshBible();
  var callbackCount = 0;

  Bible.ensureLoaded(function(error) {
    callbackCount += 1;
    assert.strictEqual(error, null);
  });
  assert.strictEqual(Bible.loadState(), "loading");
  assert.strictEqual(callbackCount, 0, "callback should wait while request is pending");

  Bible.loadFromBooks(testBooks());

  assert.strictEqual(Bible.loadState(), "ready");
  assert.strictEqual(Bible.isLoaded(), true);
  assert.strictEqual(callbackCount, 1, "direct load should flush pending callbacks");
});

withLocalStorage(memoryStorage(), function() {
  var storage = global.localStorage;
  var Bible = freshBible();
  var RestoredBible;
  var callbackCount = 0;
  var requestCount = 0;
  var page;

  Bible.loadFromBooks(testBooks());
  assert.strictEqual(storage.values[storagePrefix + ".complete"], KJV_SOURCE.storageVersion);
  assert(storage.values[storagePrefix + ".book.42"], "John should be persisted separately");

  withXmlHttpRequest(function UnexpectedRequest() {
    requestCount += 1;
  }, function() {
    RestoredBible = freshBible();
    assert.strictEqual(RestoredBible.isLoaded(), false, "persistent marker should load only after ready work");
    RestoredBible.ensureLoaded(function(error) {
      callbackCount += 1;
      assert.strictEqual(error, null);
    });
  });

  assert.strictEqual(requestCount, 0, "restoring persistent corpus should not make a network request");
  assert.strictEqual(callbackCount, 1);
  assert.strictEqual(RestoredBible.isLoaded(), true);
  page = RestoredBible.getChapterPage(42, 3, 16, 0);
  assert(page.text.indexOf("16. John 3:16") !== -1);
  assert(storage.reads.indexOf(storagePrefix + ".book.42") !== -1, "requested book should hydrate");
  assert.strictEqual(storage.reads.indexOf(storagePrefix + ".book.0"), -1, "unrequested books should stay cold");

  [0, 1, 2, 3, 4, 5].forEach(function(bookIndex) {
    RestoredBible.getChapterPage(bookIndex, 1, 1, 0);
  });
  assert.strictEqual(RestoredBible.cacheInfo().textBooks, 4, "hydrated book cache should be bounded");

  for (var chapter = 1; chapter <= 20; chapter += 1) {
    RestoredBible.getChapterPage(0, chapter, 1, 0);
  }
  assert.strictEqual(RestoredBible.cacheInfo().chapters, 12, "chapter page cache should be bounded");
});

withLocalStorage((function() {
  var storage = memoryStorage();
  storage.setItem = function() {
    throw new Error("quota exceeded");
  };
  return storage;
})(), function() {
  var Bible = freshBible();
  var page;

  assert.doesNotThrow(function() {
    Bible.loadFromBooks(testBooks());
  });
  page = Bible.getChapterPage(42, 3, 16, 0);
  assert(page.text.indexOf("16. John 3:16") !== -1, "storage failure should retain in-memory corpus");
});

withXmlHttpRequest(function SuccessfulRequest() {
  this.open = function(method, url, async) {
    assert.strictEqual(method, "GET");
    assert.strictEqual(url, KJV_SOURCE.url);
    assert.strictEqual(async, true);
  };
  this.send = function() {
    this.readyState = 4;
    this.status = 200;
    this.responseText = JSON.stringify(testBooks());
    this.onreadystatechange();
  };
}, function() {
  var Bible = freshBible();
  var callbackCount = 0;

  Bible.ensureLoaded(function(error) {
    callbackCount += 1;
    assert.strictEqual(error, null);
  });

  assert.strictEqual(Bible.loadState(), "ready");
  assert.strictEqual(Bible.isLoaded(), true);
  assert.strictEqual(callbackCount, 1, "successful request should flush callbacks once");
});

console.log("load tests passed");
