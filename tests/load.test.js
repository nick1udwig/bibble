"use strict";

var assert = require("assert");
var helpers = require("./helpers");
var freshBible = helpers.freshBible;
var testBooks = helpers.testBooks;

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

withXmlHttpRequest(function SuccessfulRequest() {
  this.open = function() {};
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
