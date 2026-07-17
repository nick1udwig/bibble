"use strict";

var assert = require("assert");

function freshPkjs(bible) {
  var indexPath = require.resolve("../src/pkjs/index");
  var biblePath = require.resolve("../src/pkjs/bible");
  delete require.cache[indexPath];
  if (bible) {
    require.cache[biblePath] = {
      id: biblePath,
      filename: biblePath,
      loaded: true,
      exports: bible
    };
  } else {
    delete require.cache[biblePath];
  }
  return require("../src/pkjs/index");
}

function createPebbleMock(options) {
  var listeners = {};
  var sent = [];
  var pending = [];
  var openedUrls = [];

  options = options || {};

  return {
    sent: sent,
    openedUrls: openedUrls,
    addEventListener: function(type, handler) {
      listeners[type] = handler;
    },
    emit: function(type, event) {
      assert.strictEqual(typeof listeners[type], "function", type + " listener should be registered");
      listeners[type](event || {});
    },
    sendAppMessage: function(message, success, failure) {
      sent.push(message);
      if (options.failSendCount > 0) {
        options.failSendCount -= 1;
        if (failure) {
          failure("mock failure");
        }
        return;
      }
      if (options.autoAck === false) {
        pending.push(success);
      } else if (success) {
        success();
      }
    },
    openURL: function(url) {
      openedUrls.push(url);
    },
    ackNext: function() {
      var success = pending.shift();
      assert.strictEqual(typeof success, "function", "pending send callback should exist");
      success();
    }
  };
}

function createMemoryStorage(initial) {
  var values = initial || {};

  return {
    values: values,
    getItem: function(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setItem: function(key, value) {
      values[key] = String(value);
    }
  };
}

function withPkjs(options, work) {
  var previousPebble = global.Pebble;
  var previousXmlHttpRequest = global.XMLHttpRequest;
  var previousSetTimeout = global.setTimeout;
  var previousLocalStorage = global.localStorage;
  var pebble;

  if (typeof options === "function") {
    work = options;
    options = {};
  }

  pebble = createPebbleMock(options.pebble);
  global.Pebble = pebble;
  global.XMLHttpRequest = function HangingRequest() {
    this.open = function() {};
    this.send = function() {};
  };
  if (options.storage) {
    global.localStorage = options.storage;
  } else {
    delete global.localStorage;
  }
  if (options.immediateTimers) {
    global.setTimeout = function(callback) {
      callback();
      return null;
    };
  }

  try {
    freshPkjs(options.bible);
    work(pebble);
  } finally {
    if (previousPebble === undefined) {
      delete global.Pebble;
    } else {
      global.Pebble = previousPebble;
    }
    if (previousXmlHttpRequest === undefined) {
      delete global.XMLHttpRequest;
    } else {
      global.XMLHttpRequest = previousXmlHttpRequest;
    }
    if (previousSetTimeout === undefined) {
      delete global.setTimeout;
    } else {
      global.setTimeout = previousSetTimeout;
    }
    if (previousLocalStorage === undefined) {
      delete global.localStorage;
    } else {
      global.localStorage = previousLocalStorage;
    }
    delete require.cache[require.resolve("../src/pkjs/index")];
    delete require.cache[require.resolve("../src/pkjs/bible")];
  }
}

function pageBibleFake(calls) {
  return {
    isLoaded: function() {
      return true;
    },
    isValidChapter: function(bookIndex, chapter) {
      return bookIndex === 42 && chapter === 3;
    },
    isValidVerse: function(bookIndex, chapter, verse) {
      return bookIndex === 42 && chapter === 3 && verse >= 1 && verse <= 16;
    },
    getChapterPage: function(bookIndex, chapter, verse, page) {
      calls.push(["chapter", bookIndex, chapter, verse, page]);
      return {
        bookIndex: bookIndex,
        chapter: chapter,
        verse: verse || 1,
        page: page || 2,
        pageCount: 5,
        text: "John 3:16"
      };
    },
    getAdjacentPage: function(bookIndex, chapter, page, delta) {
      calls.push(["adjacent", bookIndex, chapter, page, delta]);
      return {
        bookIndex: bookIndex,
        chapter: chapter,
        verse: 1,
        page: page,
        pageCount: 5,
        text: delta > 0 ? "next" : "previous"
      };
    }
  };
}

function parseFailBibleFake() {
  return {
    isLoaded: function() {
      return true;
    },
    parseReference: function() {
      return {
        ok: false
      };
    }
  };
}

function dictationBibleFake(calls) {
  return {
    isLoaded: function() {
      return true;
    },
    parseReference: function(text) {
      calls.push(["parse", text]);
      return {
        ok: true,
        bookIndex: 42,
        chapter: 3,
        verse: 16,
        reference: "John 3:16"
      };
    },
    getChapterPage: function(bookIndex, chapter, verse, page) {
      calls.push(["page", bookIndex, chapter, verse, page]);
      return {
        bookIndex: bookIndex,
        chapter: chapter,
        verse: verse,
        page: 2,
        pageCount: 5,
        text: "16. For God so loved the world"
      };
    }
  };
}

function searchBibleFake(calls, results) {
  return {
    isLoaded: function() {
      return true;
    },
    isSearchReady: function() {
      return true;
    },
    ensureSearchReady: function(callback) {
      callback(null);
    },
    parseReference: function(text) {
      calls.push(["parse", text]);
      return {
        ok: false
      };
    },
    search: function(text, offset, limit) {
      calls.push(["search", text, offset, limit]);
      if (typeof results === "function") {
        return results(text, offset, limit);
      }
      return results || {
        offset: offset,
        total: 0,
        hits: []
      };
    }
  };
}

function installBibleFake(calls) {
  var loaded = false;
  var indexed = false;

  return {
    isLoaded: function() {
      return loaded;
    },
    isSearchReady: function() {
      return indexed;
    },
    ensureLoaded: function(callback) {
      calls.push("download");
      loaded = true;
      callback(null);
    },
    ensureSearchReady: function(callback, progress) {
      calls.push("index");
      progress(0);
      indexed = true;
      progress(100);
      callback(null);
    }
  };
}

withPkjs(function(pebble) {
  pebble.emit("ready");

  assert.deepStrictEqual(pebble.sent[0], {
    0: "status",
    1: "Select a book"
  });
});

var installCalls = [];
withPkjs({
  bible: installBibleFake(installCalls)
}, function(pebble) {
  pebble.emit("ready");

  assert.deepStrictEqual(installCalls, ["download", "index"]);
  assert.deepStrictEqual(pebble.sent, [
    { 0: "status", 1: "Select a book" },
    { 0: "status", 1: "Downloading Bible" },
    { 0: "status", 1: "Indexing Bible 0%" },
    { 0: "status", 1: "Select a book" }
  ]);
});

var settingsStorage = createMemoryStorage();
var settingsCalls = [];
var settingsBible = pageBibleFake([]);
settingsBible.setSettings = function(settings) {
  settingsCalls.push(settings);
};

withPkjs({
  bible: settingsBible,
  storage: settingsStorage
}, function(pebble) {
  pebble.emit("showConfiguration");
  assert.strictEqual(pebble.openedUrls.length, 1);
  assert(pebble.openedUrls[0].indexOf("https://nick1udwig.github.io/bibble/config/?state=") === 0);

  pebble.emit("webviewclosed", {
    response: encodeURIComponent(JSON.stringify({ fontSize: "24", bold: true }))
  });
  assert.deepStrictEqual(settingsCalls, [
    { fontSize: "18", bold: true },
    { fontSize: "24", bold: true }
  ]);
  assert.deepStrictEqual(pebble.sent[0], {
    0: "settings",
    1: "24b"
  });
  assert.deepStrictEqual(JSON.parse(settingsStorage.values["bibble.settings.v1"]), {
    fontSize: "24",
    bold: true
  });

  pebble.emit("appmessage", {
    payload: {
      MessageType: "page_request",
      Payload: "42|3|16|0|41"
    }
  });
  assert.deepStrictEqual(pebble.sent[1], {
    0: "page",
    1: "41|24b|42|3|16|2|5|John 3:16"
  });
});

withPkjs(function(pebble) {
  pebble.emit("appmessage", {
    payload: {
      MessageType: "ready",
      Payload: ""
    }
  });

  assert.deepStrictEqual(pebble.sent[0], {
    0: "status",
    1: "Select a book"
  });
  assert.deepStrictEqual(pebble.sent[1], {
    0: "settings",
    1: "18b"
  });
});

var searchFallbackCalls = [];
withPkjs({
  bible: searchBibleFake(searchFallbackCalls, {
    offset: 0,
    total: 7,
    hits: [
      {
        bookIndex: 42,
        chapter: 3,
        verse: 16,
        excerpt: "For {God so loved} the world"
      },
      {
        bookIndex: 61,
        chapter: 4,
        verse: 10,
        excerpt: "not that we loved God|but"
      }
    ]
  })
}, function(pebble) {
  pebble.emit("appmessage", {
    payload: {
      MessageType: "dictation_lookup",
      Payload: "17|for God so loved"
    }
  });

  assert.deepStrictEqual(searchFallbackCalls, [
    ["parse", "for God so loved"],
    ["search", "for God so loved", 0, 5]
  ]);
  assert.deepStrictEqual(pebble.sent[0], {
    0: "search_results",
    1: "17|0|7|2|42|3|16|For {God so loved} the world|61|4|10|not that we loved God/but"
  });
});

var searchPageCalls = [];
withPkjs({
  bible: searchBibleFake(searchPageCalls, function(text, offset) {
    return {
      offset: offset,
      total: 8,
      hits: [{
        bookIndex: 44,
        chapter: 8,
        verse: 28,
        excerpt: "all things work together for good"
      }]
    };
  })
}, function(pebble) {
  pebble.emit("appmessage", {
    payload: {
      MessageType: "search_page_request",
      Payload: "23|5|all things"
    }
  });

  assert.deepStrictEqual(searchPageCalls, [
    ["search", "all things", 5, 5]
  ]);
  assert.deepStrictEqual(pebble.sent[0], {
    0: "search_results",
    1: "23|5|8|1|44|8|28|all things work together for good"
  });
});

withPkjs({
  bible: searchBibleFake([], {
    offset: 0,
    total: 0,
    hits: []
  })
}, function(pebble) {
  pebble.emit("appmessage", {
    payload: {
      MessageType: "dictation_lookup",
      Payload: "24|phrase with no hits"
    }
  });
  assert.deepStrictEqual(pebble.sent[0], {
    0: "search_results",
    1: "24|0|0|0"
  });
});

withPkjs({
  bible: searchBibleFake([], {
    offset: 0,
    total: 12,
    hits: [0, 1, 2, 3, 4].map(function(index) {
      return {
        bookIndex: index,
        chapter: 1,
        verse: 1,
        excerpt: new Array(40).join("long excerpt ")
      };
    })
  })
}, function(pebble) {
  var payload;

  pebble.emit("appmessage", {
    payload: {
      MessageType: "dictation_lookup",
      Payload: "25|long result payload"
    }
  });
  payload = pebble.sent[0][1];
  assert.strictEqual(payload.split("|")[3], "5");
  assert(Buffer.byteLength(payload, "utf8") <= 520, "search result payload should fit AppMessage");
});

var dictationCalls = [];
withPkjs({
  bible: dictationBibleFake(dictationCalls)
}, function(pebble) {
  pebble.emit("appmessage", {
    payload: {
      MessageType: "dictation_lookup",
      Payload: "John three sixteen"
    }
  });

  assert.deepStrictEqual(dictationCalls, [
    ["parse", "John three sixteen"],
    ["page", 42, 3, 16, 0]
  ]);
  assert.deepStrictEqual(pebble.sent[0], {
    0: "navigate",
    1: "42|3|16|John 3:16"
  });
  assert.deepStrictEqual(pebble.sent[1], {
    0: "page",
    1: "0|18b|42|3|16|2|5|16. For God so loved the world"
  });
});

var pageCalls = [];
withPkjs({
  bible: pageBibleFake(pageCalls)
}, function(pebble) {
  pebble.emit("appmessage", {
    payload: {
      0: "page_request",
      1: "42|3|16|0|23"
    }
  });

  assert.deepStrictEqual(pageCalls, [
    ["chapter", 42, 3, 16, 0]
  ]);
  assert.deepStrictEqual(pebble.sent[0], {
    0: "page",
    1: "23|18b|42|3|16|2|5|John 3:16"
  });
});

var adjacentCalls = [];
withPkjs({
  bible: pageBibleFake(adjacentCalls)
}, function(pebble) {
  pebble.emit("appmessage", {
    payload: {
      MessageType: "page_request",
      Payload: "42|3|0|-2|24"
    }
  });
  pebble.emit("appmessage", {
    payload: {
      MessageType: "page_request",
      Payload: "42|3|0|1002|25"
    }
  });

  assert.deepStrictEqual(adjacentCalls, [
    ["adjacent", 42, 3, 2, -1],
    ["adjacent", 42, 3, 2, 1]
  ]);
  assert.deepStrictEqual(pebble.sent[0], {
    0: "page",
    1: "24|18b|42|3|1|2|5|previous"
  });
  assert.deepStrictEqual(pebble.sent[1], {
    0: "page",
    1: "25|18b|42|3|1|2|5|next"
  });
});

var prefetchCalls = [];
withPkjs({
  bible: pageBibleFake(prefetchCalls)
}, function(pebble) {
  pebble.emit("appmessage", {
    payload: {
      MessageType: "prefetch_request",
      Payload: "42|3|2|-1|17"
    }
  });
  pebble.emit("appmessage", {
    payload: {
      MessageType: "prefetch_request",
      Payload: "42|3|2|1|17"
    }
  });

  assert.deepStrictEqual(prefetchCalls, [
    ["adjacent", 42, 3, 2, -1],
    ["adjacent", 42, 3, 2, 1]
  ]);
  assert.deepStrictEqual(pebble.sent[0], {
    0: "prefetch_page",
    1: "17|18b|42|3|1|2|5|previous"
  });
  assert.deepStrictEqual(pebble.sent[1], {
    0: "prefetch_page",
    1: "17|18b|42|3|1|2|5|next"
  });
});

var badPrefetchCalls = [];
withPkjs({
  bible: pageBibleFake(badPrefetchCalls)
}, function(pebble) {
  [
    "42|3|0|1|1",
    "42|3|2|0|1",
    "42|3|2|1|-1",
    "42|3|2|1|oops"
  ].forEach(function(payload) {
    pebble.emit("appmessage", {
      payload: {
        MessageType: "prefetch_request",
        Payload: payload
      }
    });
  });

  assert.deepStrictEqual(badPrefetchCalls, []);
  assert.deepStrictEqual(pebble.sent, []);
});

var retriedPageCalls = [];
withPkjs({
  bible: pageBibleFake(retriedPageCalls),
  immediateTimers: true,
  pebble: {
    failSendCount: 1
  }
}, function(pebble) {
  pebble.emit("appmessage", {
    payload: {
      MessageType: "page_request",
      Payload: "42|3|16|0|31"
    }
  });

  assert.strictEqual(pebble.sent.length, 2, "required page should retry once");
  assert.deepStrictEqual(pebble.sent[0], pebble.sent[1]);
});

var exhaustedPageCalls = [];
withPkjs({
  bible: pageBibleFake(exhaustedPageCalls),
  immediateTimers: true,
  pebble: {
    failSendCount: 3
  }
}, function(pebble) {
  pebble.emit("appmessage", {
    payload: {
      MessageType: "page_request",
      Payload: "42|3|16|0|32"
    }
  });

  assert.strictEqual(pebble.sent.length, 4, "exhausted page should be followed by an error");
  assert.deepStrictEqual(pebble.sent[3], {
    0: "error",
    1: "Page delivery failed"
  });
});

var droppedPrefetchCalls = [];
withPkjs({
  bible: pageBibleFake(droppedPrefetchCalls),
  immediateTimers: true,
  pebble: {
    failSendCount: 1
  }
}, function(pebble) {
  pebble.emit("appmessage", {
    payload: {
      MessageType: "prefetch_request",
      Payload: "42|3|2|1|33"
    }
  });

  assert.strictEqual(pebble.sent.length, 1, "prefetch response should not retry");
});

var malformedPageCalls = [];
withPkjs({
  bible: pageBibleFake(malformedPageCalls)
}, function(pebble) {
  ["42x|3|16|0", "42|3|16x|0", "42|3|16|0x"].forEach(function(payload) {
    pebble.emit("appmessage", {
      payload: {
        MessageType: "page_request",
        Payload: payload
      }
    });
  });

  assert.deepStrictEqual(malformedPageCalls, []);
  assert.deepStrictEqual(pebble.sent[0], {
    0: "error",
    1: "Bad chapter"
  });
  assert.deepStrictEqual(pebble.sent[1], {
    0: "error",
    1: "Bad chapter"
  });
  assert.deepStrictEqual(pebble.sent[2], {
    0: "error",
    1: "Bad chapter"
  });
});

var invalidVerseCalls = [];
withPkjs({
  bible: pageBibleFake(invalidVerseCalls)
}, function(pebble) {
  pebble.emit("appmessage", {
    payload: {
      MessageType: "page_request",
      Payload: "42|3|99|0"
    }
  });

  assert.deepStrictEqual(invalidVerseCalls, []);
  assert.deepStrictEqual(pebble.sent[0], {
    0: "error",
    1: "Bad verse"
  });
});

var invalidGenerationCalls = [];
withPkjs({
  bible: pageBibleFake(invalidGenerationCalls)
}, function(pebble) {
  ["42|3|16|0", "42|3|16|0|0", "42|3|16|0|-1", "42|3|16|0|65536", "42|3|16|0|oops"].forEach(function(payload) {
    pebble.emit("appmessage", {
      payload: {
        MessageType: "page_request",
        Payload: payload
      }
    });
  });

  assert.deepStrictEqual(invalidGenerationCalls, []);
  assert.strictEqual(pebble.sent.length, 5);
  pebble.sent.forEach(function(message) {
    assert.deepStrictEqual(message, {
      0: "error",
      1: "Bad request"
    });
  });
});

withPkjs({
  bible: parseFailBibleFake(),
  pebble: {
    autoAck: false
  }
}, function(pebble) {
  var index;

  pebble.emit("ready");
  for (index = 0; index < 16; index += 1) {
    pebble.emit("appmessage", {
      payload: {
        MessageType: "dictation_lookup",
        Payload: "missing " + String(index)
      }
    });
  }

  assert.deepStrictEqual(pebble.sent[0], {
    0: "status",
    1: "Select a book"
  });

  pebble.ackNext();

  assert.deepStrictEqual(pebble.sent[1], {
    0: "error",
    1: "couldn't parse missing 0"
  });
});

console.log("pkjs tests passed");
