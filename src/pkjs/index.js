"use strict";

var Bible = require("./bible");

var Key = Object.freeze({
  messageType: 0,
  payload: 1
});

var MessageType = Object.freeze({
  ready: "ready",
  pageRequest: "page_request",
  prefetchRequest: "prefetch_request",
  dictationLookup: "dictation_lookup",
  status: "status",
  page: "page",
  prefetchPage: "prefetch_page",
  navigate: "navigate",
  error: "error"
});

var ProtocolByteLimit = Object.freeze({
  payload: 520,
  pageText: 400,
  status: 150
});

var SEND_QUEUE_MAX = 16;
var SEND_RETRY_MAX = 2;
var SEND_RETRY_DELAY_MS = 250;
var sendQueue = [];
var pendingBibleWork = [];
var sending = false;
var sendRetryTimer = null;
var loadingBible = false;

Pebble.addEventListener("ready", function() {
  sendStatus("Select a book");
  ensureBibleReady();
});

Pebble.addEventListener("appmessage", function(event) {
  var type = readPayloadValue(event.payload, Key.messageType, "MessageType");
  var payload = readPayloadValue(event.payload, Key.payload, "Payload");

  if (type === MessageType.ready) {
    sendStatus("Select a book");
    ensureBibleReady();
  } else if (type === MessageType.pageRequest) {
    handlePageRequest(payload);
  } else if (type === MessageType.prefetchRequest) {
    handlePrefetchRequest(payload);
  } else if (type === MessageType.dictationLookup) {
    handleDictationLookup(payload);
  }
});

function handlePageRequest(payload) {
  var fields = splitPayload(payload || "");
  var bookIndex = parsePayloadInteger(fields[0]);
  var chapter = parsePayloadInteger(fields[1]);
  var verse = parsePayloadInteger(fields[2]);
  var page = parsePayloadInteger(fields[3]);
  var generation = parsePayloadInteger(fields[4]);

  if (
    !Bible.isValidChapter(bookIndex, chapter) ||
    isBadOptionalInteger(fields[2], verse) ||
    isBadOptionalInteger(fields[3], page)
  ) {
    sendError("Bad chapter");
    return;
  }
  if (verse > 0 && !Bible.isValidVerse(bookIndex, chapter, verse)) {
    sendError("Bad verse");
    return;
  }
  if (generation !== generation || generation < 1 || generation > 65535) {
    sendError("Bad request");
    return;
  }

  withBibleReady(function() {
    var result;

    verse = verse || 0;
    page = page || 0;
    if (page < 0) {
      result = Bible.getAdjacentPage(bookIndex, chapter, -page, -1);
    } else if (page > 999) {
      result = Bible.getAdjacentPage(bookIndex, chapter, page - 1000, 1);
    } else {
      result = Bible.getChapterPage(bookIndex, chapter, verse, page);
    }

    sendPage(result, generation);
  });
}

function handlePrefetchRequest(payload) {
  var fields = splitPayload(payload || "");
  var bookIndex = parsePayloadInteger(fields[0]);
  var chapter = parsePayloadInteger(fields[1]);
  var page = parsePayloadInteger(fields[2]);
  var delta = parsePayloadInteger(fields[3]);
  var generation = parsePayloadInteger(fields[4]);

  if (
    !Bible.isValidChapter(bookIndex, chapter) ||
    page !== page ||
    page < 1 ||
    delta !== delta ||
    (delta !== -1 && delta !== 1) ||
    generation !== generation ||
    generation < 0 ||
    generation > 65535
  ) {
    return;
  }

  withBibleReady(function() {
    sendPrefetchPage(Bible.getAdjacentPage(bookIndex, chapter, page, delta), generation);
  });
}

function handleDictationLookup(text) {
  var parsed = Bible.parseReference(text);

  if (!parsed.ok) {
    sendError("couldn't parse " + sanitizeField(text, 96));
    return;
  }

  sendEnvelope(
    MessageType.navigate,
    [parsed.bookIndex, parsed.chapter, parsed.verse, sanitizeField(parsed.reference, 80)].join("|")
  );

  if (parsed.chapter > 0) {
    withBibleReady(function() {
      sendPage(Bible.getChapterPage(parsed.bookIndex, parsed.chapter, parsed.verse, 0), 0);
    });
  }
}

function withBibleReady(work) {
  if (Bible.isLoaded()) {
    work();
    return;
  }

  pendingBibleWork.push(work);
  ensureBibleReady();
}

function ensureBibleReady() {
  if (Bible.isLoaded() || loadingBible) {
    return;
  }

  loadingBible = true;
  Bible.ensureLoaded(function(error) {
    var work;

    loadingBible = false;
    if (error) {
      pendingBibleWork = [];
      sendError("KJV download failed");
      log("KJV download failed", error);
      return;
    }

    while (pendingBibleWork.length) {
      work = pendingBibleWork.shift();
      work();
    }
  });
}

function sendPage(page, generation) {
  sendEnvelope(
    MessageType.page,
    truncateUtf8([
      generation || 0,
      page.bookIndex,
      page.chapter,
      page.verse,
      page.page,
      page.pageCount,
      sanitizePageText(page.text, ProtocolByteLimit.pageText)
    ].join("|"), ProtocolByteLimit.payload)
  );
}

function sendPrefetchPage(page, generation) {
  sendEnvelope(
    MessageType.prefetchPage,
    truncateUtf8([
      generation,
      page.bookIndex,
      page.chapter,
      page.verse,
      page.page,
      page.pageCount,
      sanitizePageText(page.text, ProtocolByteLimit.pageText)
    ].join("|"), ProtocolByteLimit.payload)
  );
}

function sendStatus(status) {
  sendEnvelope(MessageType.status, sanitizeField(status || "", ProtocolByteLimit.status));
}

function sendError(message) {
  sendEnvelope(MessageType.error, sanitizeField(message || "Error", ProtocolByteLimit.status));
}

function sendEnvelope(type, payload) {
  var message = {};
  message[Key.messageType] = type || "";
  message[Key.payload] = payload || "";
  enqueueMessage(message, type || "");
  flushSendQueue();
}

function isRequiredMessage(type) {
  return type === MessageType.page || type === MessageType.navigate || type === MessageType.error;
}

function enqueueMessage(message, type) {
  var index;

  if (sendQueue.length >= SEND_QUEUE_MAX) {
    if (!isRequiredMessage(type)) {
      return false;
    }
    for (index = 0; index < sendQueue.length; index += 1) {
      if (!isRequiredMessage(sendQueue[index].type)) {
        sendQueue.splice(index, 1);
        break;
      }
    }
    if (sendQueue.length >= SEND_QUEUE_MAX) {
      sendQueue.shift();
    }
  }
  sendQueue.push({
    attempts: 0,
    message: message,
    type: type
  });
  return true;
}

function scheduleSendRetry() {
  if (sendRetryTimer !== null) {
    return;
  }
  if (typeof setTimeout !== "function") {
    flushSendQueue();
    return;
  }
  sendRetryTimer = setTimeout(function() {
    sendRetryTimer = null;
    flushSendQueue();
  }, SEND_RETRY_DELAY_MS);
}

function flushSendQueue() {
  var entry;

  if (sending || sendRetryTimer !== null || !sendQueue.length) {
    return;
  }

  sending = true;
  entry = sendQueue.shift();
  Pebble.sendAppMessage(entry.message, function() {
    sending = false;
    flushSendQueue();
  }, function(error) {
    sending = false;
    log("sendAppMessage failed", error);
    if (isRequiredMessage(entry.type) && entry.attempts < SEND_RETRY_MAX) {
      entry.attempts += 1;
      sendQueue.unshift(entry);
      scheduleSendRetry();
    } else if (entry.type === MessageType.page || entry.type === MessageType.navigate) {
      sendError("Page delivery failed");
    } else {
      flushSendQueue();
    }
  });
}

function readPayloadValue(payload, numericKey, namedKey) {
  if (!payload) {
    return null;
  }
  if (payload[namedKey] !== undefined && payload[namedKey] !== null) {
    return payload[namedKey];
  }
  if (payload[numericKey] !== undefined && payload[numericKey] !== null) {
    return payload[numericKey];
  }
  if (payload[String(numericKey)] !== undefined && payload[String(numericKey)] !== null) {
    return payload[String(numericKey)];
  }
  return null;
}

function splitPayload(payload) {
  return String(payload || "").split("|");
}

function parsePayloadInteger(value) {
  var text = String(value == null ? "" : value).trim();
  if (!/^-?\d+$/.test(text)) {
    return NaN;
  }
  return parseInt(text, 10);
}

function isBadOptionalInteger(rawValue, parsedValue) {
  return String(rawValue == null ? "" : rawValue).trim() !== "" && parsedValue !== parsedValue;
}

function sanitizeField(value, maxBytes) {
  return truncateUtf8(
    String(value == null ? "" : value)
      .replace(/\|/g, "/")
      .replace(/\r\n/g, " ")
      .replace(/[\r\n]/g, " ")
      .trim(),
    maxBytes
  );
}

function sanitizePageText(value, maxBytes) {
  return truncateUtf8(
    String(value == null ? "" : value)
      .replace(/\|/g, "/")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    maxBytes
  );
}

function truncateUtf8(value, maxBytes) {
  var text = String(value == null ? "" : value);
  var length = 0;
  var end = 0;
  var index;
  var code;
  var next;
  var codeUnitLength;
  var codeByteLength;

  for (index = 0; index < text.length; index += codeUnitLength) {
    code = text.charCodeAt(index);
    codeUnitLength = 1;
    codeByteLength = 1;

    if (code <= 0x7F) {
      codeByteLength = 1;
    } else if (code <= 0x7FF) {
      codeByteLength = 2;
    } else if (code >= 0xD800 && code <= 0xDBFF && index + 1 < text.length) {
      next = text.charCodeAt(index + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        codeUnitLength = 2;
        codeByteLength = 4;
      } else {
        codeByteLength = 3;
      }
    } else {
      codeByteLength = 3;
    }

    if (length + codeByteLength > maxBytes) {
      break;
    }

    length += codeByteLength;
    end = index + codeUnitLength;
  }

  return text.slice(0, end);
}

function log(label, value) {
  try {
    console.log("[bibble] " + label + (value == null ? "" : ": " + String(value)));
  } catch (_) {
  }
}
