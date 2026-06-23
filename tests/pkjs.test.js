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

function createPebbleMock() {
  var listeners = {};
  var sent = [];

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
      if (success) {
        success();
      }
    }
  };
}

function withPkjs(options, work) {
  var previousPebble = global.Pebble;
  var previousXmlHttpRequest = global.XMLHttpRequest;
  var pebble = createPebbleMock();

  if (typeof options === "function") {
    work = options;
    options = {};
  }

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

console.log("pkjs tests passed");
