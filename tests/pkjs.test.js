"use strict";

var assert = require("assert");

function freshPkjs() {
  var indexPath = require.resolve("../src/pkjs/index");
  var biblePath = require.resolve("../src/pkjs/bible");
  delete require.cache[indexPath];
  delete require.cache[biblePath];
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

function withPkjs(work) {
  var previousPebble = global.Pebble;
  var previousXmlHttpRequest = global.XMLHttpRequest;
  var pebble = createPebbleMock();

  global.Pebble = pebble;
  global.XMLHttpRequest = function HangingRequest() {
    this.open = function() {};
    this.send = function() {};
  };

  try {
    freshPkjs();
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
  }
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

console.log("pkjs tests passed");
