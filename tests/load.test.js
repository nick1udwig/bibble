"use strict";

var assert = require("assert");

function freshBible() {
  var modulePath = require.resolve("../src/pkjs/bible");
  delete require.cache[modulePath];
  return require("../src/pkjs/bible");
}

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

console.log("load tests passed");
