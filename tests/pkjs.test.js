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

  options = options || {};

  return {
    sent: sent,
    addEventListener: function(type, handler) {
      listeners[type] = handler;
    },
    emit: function(type, event) {
      assert.strictEqual(typeof listeners[type], "function", type + " listener should be registered");
      listeners[type](event || {});
    },
    sendAppMessage: function(message, success) {
      sent.push(message);
      if (options.autoAck === false) {
        pending.push(success);
      } else if (success) {
        success();
      }
    },
    ackNext: function() {
      var success = pending.shift();
      assert.strictEqual(typeof success, "function", "pending send callback should exist");
      success();
    }
  };
}

function withPkjs(options, work) {
  var previousPebble = global.Pebble;
  var previousXmlHttpRequest = global.XMLHttpRequest;
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
    1: "42|3|16|2|5|16. For God so loved the world"
  });
});

var pageCalls = [];
withPkjs({
  bible: pageBibleFake(pageCalls)
}, function(pebble) {
  pebble.emit("appmessage", {
    payload: {
      0: "page_request",
      1: "42|3|16|0"
    }
  });

  assert.deepStrictEqual(pageCalls, [
    ["chapter", 42, 3, 16, 0]
  ]);
  assert.deepStrictEqual(pebble.sent[0], {
    0: "page",
    1: "42|3|16|2|5|John 3:16"
  });
});

var adjacentCalls = [];
withPkjs({
  bible: pageBibleFake(adjacentCalls)
}, function(pebble) {
  pebble.emit("appmessage", {
    payload: {
      MessageType: "page_request",
      Payload: "42|3|0|-2"
    }
  });
  pebble.emit("appmessage", {
    payload: {
      MessageType: "page_request",
      Payload: "42|3|0|1002"
    }
  });

  assert.deepStrictEqual(adjacentCalls, [
    ["adjacent", 42, 3, 2, -1],
    ["adjacent", 42, 3, 2, 1]
  ]);
  assert.deepStrictEqual(pebble.sent[0], {
    0: "page",
    1: "42|3|1|2|5|previous"
  });
  assert.deepStrictEqual(pebble.sent[1], {
    0: "page",
    1: "42|3|1|2|5|next"
  });
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
