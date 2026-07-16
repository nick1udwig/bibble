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

withPkjs(function(pebble) {
  pebble.emit("ready");

  assert.deepStrictEqual(pebble.sent[0], {
    0: "status",
    1: "Select a book"
  });
});

var settingsStorage = createMemoryStorage();
var settingsCalls = [];
var settingsBible = pageBibleFake([]);
settingsBible.setFontSize = function(fontSize) {
  settingsCalls.push(fontSize);
};

withPkjs({
  bible: settingsBible,
  storage: settingsStorage
}, function(pebble) {
  pebble.emit("showConfiguration");
  assert.strictEqual(pebble.openedUrls.length, 1);
  assert(pebble.openedUrls[0].indexOf("https://nick1udwig.github.io/bibble/config/?state=") === 0);

  pebble.emit("webviewclosed", {
    response: encodeURIComponent(JSON.stringify({ fontSize: "large" }))
  });
  assert.deepStrictEqual(settingsCalls, ["normal", "large"]);
  assert.deepStrictEqual(pebble.sent[0], {
    0: "settings",
    1: "large"
  });
  assert.deepStrictEqual(JSON.parse(settingsStorage.values["bibble.settings.v1"]), {
    fontSize: "large"
  });

  pebble.emit("appmessage", {
    payload: {
      MessageType: "page_request",
      Payload: "42|3|16|0|41"
    }
  });
  assert.deepStrictEqual(pebble.sent[1], {
    0: "page",
    1: "41|large|42|3|16|2|5|John 3:16"
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
    1: "normal"
  });
});

withPkjs(function(pebble) {
  pebble.emit("appmessage", {
    payload: {
      MessageType: "dictation_lookup",
      Payload: "not\rparseable|text"
    }
  });

  assert.deepStrictEqual(pebble.sent[0], {
    0: "error",
    1: "couldn't parse not parseable/text"
  });
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
    1: "0|normal|42|3|16|2|5|16. For God so loved the world"
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
    1: "23|normal|42|3|16|2|5|John 3:16"
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
    1: "24|normal|42|3|1|2|5|previous"
  });
  assert.deepStrictEqual(pebble.sent[1], {
    0: "page",
    1: "25|normal|42|3|1|2|5|next"
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
    1: "17|normal|42|3|1|2|5|previous"
  });
  assert.deepStrictEqual(pebble.sent[1], {
    0: "prefetch_page",
    1: "17|normal|42|3|1|2|5|next"
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
