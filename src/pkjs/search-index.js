"use strict";

var lunr = require("lunr");
var StorageCodec = require("./storage-codec");

var INDEX_SCHEMA_VERSION = "search-v6-lunr-bm25-positional-range-lz16";
var INDEX_MARKER_KEY = "bibble.search.complete";
var INDEX_META_KEY = "bibble.search.meta";
var INDEX_SHARD_KEY_PREFIX = "bibble.search.shard.";
var INDEX_SHARD_COUNT = 64;
var SHARD_CACHE_LIMIT = 12;
var BUILD_VERSES_PER_TICK = 250;
var SHARD_TOKENS_PER_TICK = 400;
var MAX_FUZZY_EDIT_DISTANCE = 2;
var FUZZY_DISTANCE_DIVISOR = 3;
var FUZZY_VARIANT_LIMIT = 64;
var BM25_K1 = 1.2;
var BM25_B = 0.75;
var DEFAULT_EXCERPT_BYTES = 64;
var EXCERPT_CONTEXT_WORDS = 3;
var FLEX_PART_KEY_PREFIX = "bibble.search.flex.";
var FLEX_PARTS = ["reg", "cfg", "map", "ctx"];

function scheduleSoon(callback) {
  if (typeof setTimeout === "function") {
    setTimeout(callback, 0);
  } else {
    callback();
  }
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function mapKey(value) {
  return "$" + String(value);
}

function encodeStoredJson(value) {
  return StorageCodec.compress(JSON.stringify(value));
}

function decodeStoredJson(value) {
  return JSON.parse(StorageCodec.decompress(value));
}

function normalizeText(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeQuery(value) {
  var normalized = normalizeText(value);
  var stripped = normalized.replace(
    /^(?:please\s+)?(?:search(?:\s+the\s+bible)?(?:\s+for)?|find|look\s+up|show\s+me|show)\s+/,
    ""
  );

  return stripped || normalized;
}

function splitTokens(value) {
  var normalized = normalizeText(value);
  return normalized ? normalized.split(" ") : [];
}

function buildReferenceMap(meta) {
  var bookStarts = [];
  var bookEnds = [];
  var chapterStarts = [];
  var total = 0;
  var bookIndex;
  var chapterIndex;
  var counts;

  for (bookIndex = 0; bookIndex < meta.length; bookIndex += 1) {
    bookStarts[bookIndex] = total;
    chapterStarts[bookIndex] = [];
    counts = meta[bookIndex].verseCounts || [];
    for (chapterIndex = 0; chapterIndex < counts.length; chapterIndex += 1) {
      chapterStarts[bookIndex][chapterIndex] = total;
      total += counts[chapterIndex];
    }
    bookEnds[bookIndex] = total;
  }

  return {
    bookStarts: bookStarts,
    bookEnds: bookEnds,
    chapterStarts: chapterStarts,
    totalVerses: total
  };
}

function referenceForId(map, id) {
  var low = 0;
  var high = map.bookEnds.length - 1;
  var bookIndex = -1;
  var middle;
  var starts;
  var chapterIndex;

  if (id < 0 || id >= map.totalVerses) {
    return null;
  }
  while (low <= high) {
    middle = Math.floor((low + high) / 2);
    if (id < map.bookStarts[middle]) {
      high = middle - 1;
    } else if (id >= map.bookEnds[middle]) {
      low = middle + 1;
    } else {
      bookIndex = middle;
      break;
    }
  }
  if (bookIndex < 0) {
    return null;
  }

  starts = map.chapterStarts[bookIndex];
  chapterIndex = starts.length - 1;
  while (chapterIndex > 0 && id < starts[chapterIndex]) {
    chapterIndex -= 1;
  }
  return {
    bookIndex: bookIndex,
    chapter: chapterIndex + 1,
    verse: id - starts[chapterIndex] + 1
  };
}

function encodePostingEntry(documentDelta, positions) {
  var parts = [];
  var previousPosition = 0;
  var index;
  var delta;

  for (index = 0; index < positions.length; index += 1) {
    delta = index === 0 ? positions[index] : positions[index] - previousPosition;
    parts.push(delta.toString(36));
    previousPosition = positions[index];
  }
  return documentDelta.toString(36) + "," + parts.join(".");
}

function decodePostingList(encoded) {
  var entries;
  var ids = [];
  var positions = [];
  var currentDocument = 0;
  var entryIndex;
  var fields;
  var documentDelta;
  var positionValues;
  var documentPositions;
  var currentPosition;
  var positionIndex;
  var positionDelta;

  if (encoded === "") {
    return { ids: ids, positions: positions };
  }
  if (typeof encoded !== "string") {
    throw new Error("Invalid search posting list");
  }
  entries = encoded.split(";");
  for (entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    fields = entries[entryIndex].split(",");
    if (fields.length !== 2 || !/^[0-9a-z]+$/.test(fields[0]) || !fields[1]) {
      throw new Error("Invalid search posting entry");
    }
    documentDelta = parseInt(fields[0], 36);
    if (documentDelta !== documentDelta || documentDelta < 0 ||
        (entryIndex > 0 && documentDelta < 1)) {
      throw new Error("Invalid search posting delta");
    }
    currentDocument = entryIndex === 0 ? documentDelta : currentDocument + documentDelta;
    ids.push(currentDocument);
    positionValues = fields[1].split(".");
    documentPositions = [];
    currentPosition = 0;
    for (positionIndex = 0; positionIndex < positionValues.length; positionIndex += 1) {
      if (!/^[0-9a-z]+$/.test(positionValues[positionIndex])) {
        throw new Error("Invalid search position value");
      }
      positionDelta = parseInt(positionValues[positionIndex], 36);
      if (positionDelta !== positionDelta || positionDelta < 0 ||
          (positionIndex > 0 && positionDelta < 1)) {
        throw new Error("Invalid search position delta");
      }
      currentPosition = positionIndex === 0 ? positionDelta : currentPosition + positionDelta;
      documentPositions.push(currentPosition);
    }
    positions.push(documentPositions);
  }
  return { ids: ids, positions: positions };
}

function encodeDocumentLengths(lengths) {
  return lengths.map(function(length) {
    return length.toString(36);
  }).join(".");
}

function decodeDocumentLengths(encoded, expectedCount) {
  var values = typeof encoded === "string" && encoded ? encoded.split(".") : [];
  var lengths = [];
  var index;
  var length;

  if (values.length !== expectedCount) {
    throw new Error("Search document lengths are incomplete");
  }
  for (index = 0; index < values.length; index += 1) {
    if (!/^[0-9a-z]+$/.test(values[index])) {
      throw new Error("Invalid search document length");
    }
    length = parseInt(values[index], 36);
    if (!(length > 0)) {
      throw new Error("Invalid search document length");
    }
    lengths.push(length);
  }
  return lengths;
}

function postingIndexForDocument(ids, documentId) {
  var low = 0;
  var high = ids.length - 1;
  var middle;

  while (low <= high) {
    middle = Math.floor((low + high) / 2);
    if (ids[middle] === documentId) {
      return middle;
    }
    if (ids[middle] < documentId) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return -1;
}

function fuzzyEditDistance(term) {
  return Math.min(MAX_FUZZY_EDIT_DISTANCE, Math.floor(term.length / FUZZY_DISTANCE_DIVISOR));
}

function damerauLevenshtein(left, right) {
  var previousPrevious = null;
  var previous = [];
  var current;
  var leftIndex;
  var rightIndex;
  var substitution;
  var value;

  for (rightIndex = 0; rightIndex <= right.length; rightIndex += 1) {
    previous[rightIndex] = rightIndex;
  }
  for (leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current = [leftIndex];
    for (rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      substitution = left.charAt(leftIndex - 1) === right.charAt(rightIndex - 1) ? 0 : 1;
      value = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitution
      );
      if (previousPrevious && leftIndex > 1 && rightIndex > 1 &&
          left.charAt(leftIndex - 1) === right.charAt(rightIndex - 2) &&
          left.charAt(leftIndex - 2) === right.charAt(rightIndex - 1)) {
        value = Math.min(value, previousPrevious[rightIndex - 2] + 1);
      }
      current[rightIndex] = value;
    }
    previousPrevious = previous;
    previous = current;
  }
  return previous[right.length];
}

function unionSortedPostingLists(lists) {
  var seen;
  var result;
  var listIndex;
  var idIndex;

  if (!lists.length) {
    return [];
  }
  if (lists.length === 1) {
    return lists[0];
  }
  seen = {};
  result = [];
  for (listIndex = 0; listIndex < lists.length; listIndex += 1) {
    for (idIndex = 0; idIndex < lists[listIndex].length; idIndex += 1) {
      seen[mapKey(lists[listIndex][idIndex])] = lists[listIndex][idIndex];
    }
  }
  Object.keys(seen).forEach(function(key) {
    result.push(seen[key]);
  });
  result.sort(function(leftId, rightId) {
    return leftId - rightId;
  });
  return result;
}

function intersectSortedPostingLists(left, right) {
  var result = [];
  var leftIndex = 0;
  var rightIndex = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      result.push(left[leftIndex]);
      leftIndex += 1;
      rightIndex += 1;
    } else if (left[leftIndex] < right[rightIndex]) {
      leftIndex += 1;
    } else {
      rightIndex += 1;
    }
  }
  return result;
}

function tokenizeVerse(text) {
  var words = String(text == null ? "" : text).match(/\S+/g) || [];
  var tokens = [];
  var tokenWords = [];
  var wordIndex;
  var wordTokens;
  var tokenIndex;

  for (wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
    wordTokens = splitTokens(words[wordIndex]);
    for (tokenIndex = 0; tokenIndex < wordTokens.length; tokenIndex += 1) {
      tokens.push(wordTokens[tokenIndex]);
      tokenWords.push(wordIndex);
    }
  }
  return {
    words: words,
    tokens: tokens,
    tokenWords: tokenWords
  };
}

function exactPhraseStart(tokens, queryTokens) {
  var start;
  var queryIndex;
  var exact;

  if (!queryTokens.length || tokens.length < queryTokens.length) {
    return -1;
  }
  for (start = 0; start <= tokens.length - queryTokens.length; start += 1) {
    exact = true;
    for (queryIndex = 0; queryIndex < queryTokens.length; queryIndex += 1) {
      if (tokens[start + queryIndex] !== queryTokens[queryIndex]) {
        exact = false;
        break;
      }
    }
    if (exact) {
      return start;
    }
  }
  return -1;
}

function exactGroups(queryTokens) {
  return queryTokens.map(function(token) {
    var terms = {};

    terms[mapKey(token)] = true;
    return {
      query: token,
      terms: terms,
      variants: [{ term: token, score: 0, similarity: 1, ids: [] }]
    };
  });
}

function findMatch(tokens, queryTokens, groups) {
  var exactStart = exactPhraseStart(tokens, queryTokens);
  var positions = [];
  var tokenGroups = [];
  var targetGroups = [];
  var present = [];
  var satisfied = 0;
  var left = 0;
  var right;
  var groupIndex;
  var tokenIndex;
  var key;
  var bestStart = -1;
  var bestEnd = -1;
  var bestSpan = Number.MAX_VALUE;
  var fuzzyPhrase;

  groups = groups && groups.length ? groups : exactGroups(queryTokens);
  if (!tokens.length || !queryTokens.length) {
    return null;
  }
  if (exactStart >= 0) {
    for (tokenIndex = 0; tokenIndex < queryTokens.length; tokenIndex += 1) {
      positions.push(exactStart + tokenIndex);
    }
    return {
      exact: true,
      phraseLevel: 2,
      start: exactStart,
      end: exactStart + queryTokens.length - 1,
      span: queryTokens.length,
      matchedCount: queryTokens.length,
      positions: positions
    };
  }

  fuzzyPhrase = groups.length === queryTokens.length && tokens.length >= groups.length;
  if (fuzzyPhrase) {
    for (left = 0; left <= tokens.length - groups.length; left += 1) {
      fuzzyPhrase = true;
      for (groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
        if (!hasOwn(groups[groupIndex].terms, mapKey(tokens[left + groupIndex]))) {
          fuzzyPhrase = false;
          break;
        }
      }
      if (fuzzyPhrase) {
        for (groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
          positions.push(left + groupIndex);
        }
        return {
          exact: false,
          phraseLevel: 1,
          start: left,
          end: left + groups.length - 1,
          span: groups.length,
          matchedCount: groups.length,
          positions: positions
        };
      }
    }
  }

  for (tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    key = mapKey(tokens[tokenIndex]);
    tokenGroups[tokenIndex] = [];
    for (groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      if (hasOwn(groups[groupIndex].terms, key)) {
        tokenGroups[tokenIndex].push(groupIndex);
        targetGroups[groupIndex] = true;
      }
    }
  }
  for (groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    present[groupIndex] = 0;
  }
  var targetCount = targetGroups.filter(function(value) {
    return !!value;
  }).length;
  if (!targetCount) {
    return null;
  }

  left = 0;
  for (right = 0; right < tokenGroups.length; right += 1) {
    for (groupIndex = 0; groupIndex < tokenGroups[right].length; groupIndex += 1) {
      tokenIndex = tokenGroups[right][groupIndex];
      present[tokenIndex] += 1;
      if (present[tokenIndex] === 1) {
        satisfied += 1;
      }
    }
    while (satisfied === targetCount && left <= right) {
      if (right - left + 1 < bestSpan) {
        bestStart = left;
        bestEnd = right;
        bestSpan = right - left + 1;
      }
      for (groupIndex = 0; groupIndex < tokenGroups[left].length; groupIndex += 1) {
        tokenIndex = tokenGroups[left][groupIndex];
        present[tokenIndex] -= 1;
        if (present[tokenIndex] === 0) {
          satisfied -= 1;
        }
      }
      left += 1;
    }
  }
  if (bestStart < 0) {
    return null;
  }
  for (tokenIndex = bestStart; tokenIndex <= bestEnd; tokenIndex += 1) {
    if (tokenGroups[tokenIndex].length) {
      positions.push(tokenIndex);
    }
  }
  return {
    exact: false,
    phraseLevel: 0,
    start: bestStart,
    end: bestEnd,
    span: bestSpan,
    matchedCount: targetCount,
    positions: positions
  };
}

function utf8Length(value) {
  var text = String(value || "");
  var length = 0;
  var index;
  var code;

  for (index = 0; index < text.length; index += 1) {
    code = text.charCodeAt(index);
    if (code <= 0x7F) {
      length += 1;
    } else if (code <= 0x7FF) {
      length += 2;
    } else if (code >= 0xD800 && code <= 0xDBFF && index + 1 < text.length &&
               text.charCodeAt(index + 1) >= 0xDC00 && text.charCodeAt(index + 1) <= 0xDFFF) {
      length += 4;
      index += 1;
    } else {
      length += 3;
    }
  }
  return length;
}

function truncateUtf8(value, maxBytes) {
  var text = String(value || "");
  var length = 0;
  var end = 0;
  var index;
  var code;
  var units;
  var bytes;

  for (index = 0; index < text.length; index += units) {
    code = text.charCodeAt(index);
    units = 1;
    bytes = 1;
    if (code <= 0x7F) {
      bytes = 1;
    } else if (code <= 0x7FF) {
      bytes = 2;
    } else if (code >= 0xD800 && code <= 0xDBFF && index + 1 < text.length &&
               text.charCodeAt(index + 1) >= 0xDC00 && text.charCodeAt(index + 1) <= 0xDFFF) {
      units = 2;
      bytes = 4;
    } else {
      bytes = 3;
    }
    if (length + bytes > maxBytes) {
      break;
    }
    length += bytes;
    end = index + units;
  }
  return text.slice(0, end);
}

function renderMarkedWords(words, from, to, highlightedWords) {
  var output = from > 0 ? "..." : "";
  var marking = false;
  var index;
  var highlighted;

  for (index = from; index <= to; index += 1) {
    highlighted = !!highlightedWords[mapKey(index)];
    if (index > from) {
      if (marking && !highlighted) {
        output += "}";
        marking = false;
      }
      output += " ";
    }
    if (highlighted && !marking) {
      output += "{";
      marking = true;
    }
    output += words[index];
  }
  if (marking) {
    output += "}";
  }
  if (to + 1 < words.length) {
    output += "...";
  }
  return output;
}

function makeExcerpt(tokenized, match, maxBytes) {
  var words = tokenized.words;
  var highlightedWords = {};
  var startWord;
  var endWord;
  var focusWord;
  var before = EXCERPT_CONTEXT_WORDS;
  var after = EXCERPT_CONTEXT_WORDS;
  var trimBefore = true;
  var positionIndex;
  var wordIndex;
  var from;
  var to;
  var excerpt;
  var core;

  maxBytes = maxBytes || DEFAULT_EXCERPT_BYTES;
  if (!match || !words.length || !tokenized.tokenWords.length) {
    excerpt = words.join(" ");
    if (utf8Length(excerpt) <= maxBytes) {
      return excerpt;
    }
    return truncateUtf8(excerpt, Math.max(0, maxBytes - 3)) + "...";
  }

  for (positionIndex = 0; positionIndex < (match.positions || []).length; positionIndex += 1) {
    wordIndex = tokenized.tokenWords[match.positions[positionIndex]];
    if (wordIndex != null) {
      highlightedWords[mapKey(wordIndex)] = true;
    }
  }
  startWord = tokenized.tokenWords[match.start];
  endWord = tokenized.tokenWords[match.end];
  if (startWord == null || endWord == null) {
    return truncateUtf8(words.join(" "), maxBytes);
  }

  core = renderMarkedWords(words, startWord, endWord, highlightedWords);
  if (utf8Length(core) > maxBytes) {
    focusWord = (match.positions && match.positions.length)
      ? tokenized.tokenWords[match.positions[0]]
      : startWord;
    startWord = focusWord;
    endWord = focusWord;
  }

  function render() {
    from = Math.max(0, startWord - before);
    to = Math.min(words.length - 1, endWord + after);
    return renderMarkedWords(words, from, to, highlightedWords);
  }

  excerpt = render();
  while (utf8Length(excerpt) > maxBytes && (before > 0 || after > 0)) {
    if ((trimBefore && before > 0) || after <= 0) {
      before -= 1;
    } else {
      after -= 1;
    }
    trimBefore = !trimBefore;
    excerpt = render();
  }
  if (utf8Length(excerpt) <= maxBytes) {
    return excerpt;
  }

  focusWord = startWord;
  if (highlightedWords[mapKey(focusWord)]) {
    return "{" + truncateUtf8(words[focusWord], Math.max(0, maxBytes - 2)) + "}";
  }
  return truncateUtf8(words[focusWord], maxBytes);
}

function SearchIndex(options) {
  options = options || {};
  this.meta = options.meta || [];
  this.version = String(options.corpusVersion || "unknown") + "." + INDEX_SCHEMA_VERSION;
  this.getStorage = typeof options.getStorage === "function" ? options.getStorage : function() {
    return null;
  };
  this.schedule = typeof options.schedule === "function" ? options.schedule : scheduleSoon;
  this.referenceMap = buildReferenceMap(this.meta);
  this.ready = false;
  this.building = false;
  this.error = "";
  this.callbacks = [];
  this.progressCallbacks = [];
  this.buildGeneration = 0;
  this.memoryShards = null;
  this.shardCache = {};
  this.shardCacheKeys = [];
  this.vocabulary = [];
  this.vocabularyMap = {};
  this.termSet = lunr.TokenSet.fromArray([]);
  this.shardBoundaries = [];
  this.documentLengths = [];
  this.averageDocumentLength = 1;
  this.lastSearch = null;
}

SearchIndex.prototype._storage = function() {
  try {
    return this.getStorage() || null;
  } catch (_) {
    return null;
  }
};

SearchIndex.prototype._setVocabulary = function(vocabulary, shardBoundaries) {
  var map = {};
  var index;

  this.vocabulary = (vocabulary || []).slice().sort();
  for (index = 0; index < this.vocabulary.length; index += 1) {
    map[mapKey(this.vocabulary[index])] = index;
  }
  this.vocabularyMap = map;
  this.termSet = lunr.TokenSet.fromArray(this.vocabulary);
  this.shardBoundaries = (shardBoundaries || []).slice();
};

SearchIndex.prototype._shardIndexForToken = function(token) {
  var low = 0;
  var high = this.shardBoundaries.length - 1;
  var middle;
  var shardIndex = 0;

  while (low <= high) {
    middle = Math.floor((low + high) / 2);
    if (token < this.shardBoundaries[middle]) {
      high = middle - 1;
    } else {
      shardIndex = middle + 1;
      low = middle + 1;
    }
  }
  return shardIndex;
};

SearchIndex.prototype._clearCaches = function() {
  this.shardCache = {};
  this.shardCacheKeys = [];
  this.lastSearch = null;
};

SearchIndex.prototype._removePersistentIndex = function(storage) {
  var index;

  if (!storage || typeof storage.removeItem !== "function") {
    return;
  }
  try {
    storage.removeItem(INDEX_MARKER_KEY);
    storage.removeItem(INDEX_META_KEY);
    for (index = 0; index < INDEX_SHARD_COUNT; index += 1) {
      storage.removeItem(INDEX_SHARD_KEY_PREFIX + String(index));
    }
    for (index = 0; index < FLEX_PARTS.length; index += 1) {
      storage.removeItem(FLEX_PART_KEY_PREFIX + FLEX_PARTS[index]);
    }
  } catch (_) {
  }
};

SearchIndex.prototype.invalidate = function() {
  var hadPendingBuild = this.building && this.callbacks.length > 0;

  this.buildGeneration += 1;
  this.ready = false;
  this.building = false;
  this.error = "";
  this.memoryShards = null;
  this._setVocabulary([]);
  this.documentLengths = [];
  this._clearCaches();
  this._removePersistentIndex(this._storage());
  if (hadPendingBuild) {
    this._flushCallbacks("Search index invalidated");
  }
};

SearchIndex.prototype._restore = function() {
  var storage = this._storage();
  var rawMeta;
  var meta;
  var average;
  var vocabulary;
  var shardBoundaries;
  var documentLengths;
  var index;
  var rawShard;
  var shard;
  var restoredShards = [];

  if (!storage) {
    return false;
  }
  try {
    if (storage.getItem(INDEX_MARKER_KEY) !== this.version) {
      return false;
    }
    rawMeta = storage.getItem(INDEX_META_KEY);
    meta = decodeStoredJson(rawMeta);
    average = parseFloat(meta && meta.averageDocumentLength);
    vocabulary = meta && meta.vocabulary;
    shardBoundaries = meta && meta.shardBoundaries;
    documentLengths = decodeDocumentLengths(
      meta && meta.documentLengths,
      this.referenceMap.totalVerses
    );
    if (!(average > 0) || !Array.isArray(vocabulary) || !vocabulary.length ||
        !Array.isArray(shardBoundaries) || shardBoundaries.length >= INDEX_SHARD_COUNT) {
      throw new Error("Search index metadata is incomplete");
    }
    for (index = 0; index < INDEX_SHARD_COUNT; index += 1) {
      rawShard = storage.getItem(INDEX_SHARD_KEY_PREFIX + String(index));
      if (rawShard == null) {
        throw new Error("Search index shard is missing");
      }
      if (!StorageCodec.isCompressed(rawShard)) {
        throw new Error("Search index shard encoding is invalid");
      }
      shard = decodeStoredJson(rawShard);
      if (!shard || typeof shard !== "object" || Array.isArray(shard)) {
        throw new Error("Search index shard is invalid");
      }
      restoredShards[index] = shard;
    }
  } catch (_) {
    this._removePersistentIndex(storage);
    return false;
  }

  this.averageDocumentLength = average;
  this.documentLengths = documentLengths;
  this._setVocabulary(vocabulary, shardBoundaries);
  this.memoryShards = restoredShards;
  this.ready = true;
  this.building = false;
  this.error = "";
  this._clearCaches();
  return true;
};

SearchIndex.prototype._reportProgress = function(percent) {
  var callbacks = this.progressCallbacks.slice();
  var index;

  for (index = 0; index < callbacks.length; index += 1) {
    try {
      callbacks[index](percent);
    } catch (_) {
    }
  }
};

SearchIndex.prototype._flushCallbacks = function(error) {
  var callbacks = this.callbacks;
  var index;

  this.callbacks = [];
  this.progressCallbacks = [];
  for (index = 0; index < callbacks.length; index += 1) {
    callbacks[index](error || null);
  }
};

SearchIndex.prototype.ensureReady = function(source, callback, progress) {
  if (this.ready) {
    if (callback) {
      callback(null);
    }
    return;
  }
  if (callback) {
    this.callbacks.push(callback);
  }
  if (progress) {
    this.progressCallbacks.push(progress);
  }
  if (this.building) {
    return;
  }
  if (this._restore()) {
    this._flushCallbacks(null);
    return;
  }
  this._startBuild(source);
};

SearchIndex.prototype._failBuild = function(message, generation) {
  if (generation !== this.buildGeneration) {
    return;
  }
  this.ready = false;
  this.building = false;
  this.error = message || "Search indexing failed";
  this.memoryShards = null;
  this._setVocabulary([]);
  this.documentLengths = [];
  this._clearCaches();
  this._flushCallbacks(this.error);
};

SearchIndex.prototype._startBuild = function(source) {
  var self = this;
  var generation = this.buildGeneration + 1;
  var storage = this._storage();
  var state;

  this.buildGeneration = generation;
  this.building = true;
  this.ready = false;
  this.error = "";
  this.memoryShards = null;
  this._setVocabulary([]);
  this.documentLengths = [];
  this._clearCaches();
  this._removePersistentIndex(storage);

  state = {
    generation: generation,
    source: source,
    storage: storage,
    postings: {},
    documentLengths: [],
    totalTokens: 0,
    bookIndex: 0,
    chapterIndex: 0,
    verseIndex: 0,
    verseId: 0,
    chapters: null,
    tokenKeys: null,
    tokenKeyIndex: 0,
    vocabulary: null,
    activeShardCount: 0,
    shardBoundaries: null,
    shards: null,
    shardIndex: 0
  };

  this._reportProgress(0);
  this.schedule(function() {
    self._buildVerseBatch(state);
  });
};

SearchIndex.prototype._buildVerseBatch = function(state) {
  var self = this;
  var processed = 0;
  var metaBook;
  var expectedCounts;
  var verseText;
  var tokens;
  var termPositions;
  var posting;
  var tokenIndex;
  var key;
  var percent;

  if (state.generation !== this.buildGeneration) {
    return;
  }
  try {
    while (processed < BUILD_VERSES_PER_TICK && state.bookIndex < this.meta.length) {
      metaBook = this.meta[state.bookIndex];
      expectedCounts = metaBook.verseCounts || [];
      if (!state.chapters) {
        if (!state.source || typeof state.source.getBookChapters !== "function") {
          throw new Error("Bible text is unavailable for indexing");
        }
        state.chapters = state.source.getBookChapters(state.bookIndex);
        if (!Array.isArray(state.chapters) || state.chapters.length !== expectedCounts.length) {
          throw new Error("Invalid Bible chapters while indexing " + String(metaBook.name || state.bookIndex));
        }
      }
      if (state.chapterIndex >= expectedCounts.length) {
        state.bookIndex += 1;
        state.chapterIndex = 0;
        state.verseIndex = 0;
        state.chapters = null;
        continue;
      }
      if (!Array.isArray(state.chapters[state.chapterIndex]) ||
          state.chapters[state.chapterIndex].length !== expectedCounts[state.chapterIndex]) {
        throw new Error("Invalid Bible verses while indexing " + String(metaBook.name || state.bookIndex));
      }
      if (state.verseIndex >= expectedCounts[state.chapterIndex]) {
        state.chapterIndex += 1;
        state.verseIndex = 0;
        continue;
      }

      verseText = state.chapters[state.chapterIndex][state.verseIndex];
      if (typeof verseText !== "string") {
        throw new Error("Invalid Bible text while indexing " + String(metaBook.name || state.bookIndex));
      }
      tokens = splitTokens(verseText);
      state.totalTokens += tokens.length;
      state.documentLengths.push(tokens.length);
      termPositions = {};
      for (tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
        key = mapKey(tokens[tokenIndex]);
        termPositions[key] = termPositions[key] || [];
        termPositions[key].push(tokenIndex);
      }
      Object.keys(termPositions).forEach(function(termKey) {
        posting = state.postings[termKey];
        if (!posting) {
          posting = {
            entries: [],
            lastDocumentId: 0
          };
          state.postings[termKey] = posting;
        }
        posting.entries.push(encodePostingEntry(
          posting.entries.length ? state.verseId - posting.lastDocumentId : state.verseId,
          termPositions[termKey]
        ));
        posting.lastDocumentId = state.verseId;
      });

      state.verseId += 1;
      state.verseIndex += 1;
      processed += 1;
    }
  } catch (error) {
    this._failBuild(error && error.message ? error.message : "Search indexing failed", state.generation);
    return;
  }

  if (state.bookIndex >= this.meta.length) {
    if (state.verseId !== this.referenceMap.totalVerses) {
      this._failBuild("Unexpected Bible verse count while indexing", state.generation);
      return;
    }
    state.tokenKeys = Object.keys(state.postings).sort();
    state.vocabulary = state.tokenKeys.map(function(tokenKey) {
      return tokenKey.slice(1);
    });
    state.activeShardCount = Math.min(INDEX_SHARD_COUNT, state.vocabulary.length);
    state.shardBoundaries = [];
    for (tokenIndex = 1; tokenIndex < state.activeShardCount; tokenIndex += 1) {
      state.shardBoundaries.push(state.vocabulary[
        Math.ceil((tokenIndex * state.vocabulary.length) / state.activeShardCount)
      ]);
    }
    state.shards = [];
    for (tokenIndex = 0; tokenIndex < INDEX_SHARD_COUNT; tokenIndex += 1) {
      state.shards[tokenIndex] = {};
    }
    this._reportProgress(90);
    this.schedule(function() {
      self._buildShardBatch(state);
    });
    return;
  }

  percent = Math.min(89, Math.floor((state.verseId * 90) / this.referenceMap.totalVerses));
  this._reportProgress(percent);
  this.schedule(function() {
    self._buildVerseBatch(state);
  });
};

SearchIndex.prototype._buildShardBatch = function(state) {
  var self = this;
  var end;
  var key;
  var shardIndex;

  if (state.generation !== this.buildGeneration) {
    return;
  }
  end = Math.min(state.tokenKeys.length, state.tokenKeyIndex + SHARD_TOKENS_PER_TICK);
  while (state.tokenKeyIndex < end) {
    key = state.tokenKeys[state.tokenKeyIndex];
    shardIndex = Math.min(
      state.activeShardCount - 1,
      Math.floor((state.tokenKeyIndex * state.activeShardCount) / state.tokenKeys.length)
    );
    state.shards[shardIndex][key] = state.postings[key].entries.join(";");
    delete state.postings[key];
    state.tokenKeyIndex += 1;
  }
  if (state.tokenKeyIndex < state.tokenKeys.length) {
    this._reportProgress(90 + Math.floor((state.tokenKeyIndex * 7) / state.tokenKeys.length));
    this.schedule(function() {
      self._buildShardBatch(state);
    });
    return;
  }

  state.postings = null;
  state.tokenKeys = null;
  this._reportProgress(97);
  this.schedule(function() {
    self._persistShard(state);
  });
};

SearchIndex.prototype._persistShard = function(state) {
  var self = this;
  var average;
  var completed = false;

  if (state.generation !== this.buildGeneration) {
    return;
  }
  if (!state.storage) {
    this._finishBuild(state, false);
    return;
  }
  try {
    if (state.shardIndex < INDEX_SHARD_COUNT) {
      state.storage.setItem(
        INDEX_SHARD_KEY_PREFIX + String(state.shardIndex),
        encodeStoredJson(state.shards[state.shardIndex])
      );
      state.shardIndex += 1;
    } else if (state.shardIndex === INDEX_SHARD_COUNT) {
      average = state.totalTokens / Math.max(1, state.verseId);
      state.storage.setItem(INDEX_META_KEY, encodeStoredJson({
        averageDocumentLength: average.toFixed(6),
        vocabulary: state.vocabulary,
        shardBoundaries: state.shardBoundaries,
        documentLengths: encodeDocumentLengths(state.documentLengths)
      }));
      state.shardIndex += 1;
    } else {
      state.storage.setItem(INDEX_MARKER_KEY, this.version);
      completed = true;
    }
  } catch (_) {
    this._removePersistentIndex(state.storage);
    this._finishBuild(state, false);
    return;
  }

  if (completed) {
    this._finishBuild(state, true);
    return;
  }

  this._reportProgress(97 + Math.floor((state.shardIndex * 2) / (INDEX_SHARD_COUNT + 1)));
  this.schedule(function() {
    self._persistShard(state);
  });
};

SearchIndex.prototype._finishBuild = function(state) {
  if (state.generation !== this.buildGeneration) {
    return;
  }
  this.averageDocumentLength = state.totalTokens / Math.max(1, state.verseId);
  this.documentLengths = state.documentLengths;
  this._setVocabulary(state.vocabulary, state.shardBoundaries);
  this.memoryShards = state.shards;
  this.ready = true;
  this.building = false;
  this.error = "";
  this._clearCaches();
  this._reportProgress(100);
  this._flushCallbacks(null);
};

SearchIndex.prototype._touchShard = function(index) {
  var position;

  for (position = 0; position < this.shardCacheKeys.length; position += 1) {
    if (this.shardCacheKeys[position] === index) {
      this.shardCacheKeys.splice(position, 1);
      break;
    }
  }
  this.shardCacheKeys.push(index);
  while (this.shardCacheKeys.length > SHARD_CACHE_LIMIT) {
    delete this.shardCache[this.shardCacheKeys.shift()];
  }
};

SearchIndex.prototype._readShard = function(index) {
  var storage;
  var raw;
  var shard;

  if (this.memoryShards) {
    return this.memoryShards[index] || {};
  }
  if (hasOwn(this.shardCache, String(index))) {
    this._touchShard(index);
    return this.shardCache[index];
  }

  storage = this._storage();
  if (!storage) {
    throw new Error("Search index storage is unavailable");
  }
  raw = storage.getItem(INDEX_SHARD_KEY_PREFIX + String(index));
  if (raw == null) {
    throw new Error("Search index shard is missing");
  }
  try {
    shard = decodeStoredJson(raw);
  } catch (_) {
    throw new Error("Search index shard is invalid");
  }
  if (!shard || typeof shard !== "object" || Array.isArray(shard)) {
    throw new Error("Search index shard is invalid");
  }

  this.shardCache[index] = shard;
  this._touchShard(index);
  return shard;
};

SearchIndex.prototype._postingList = function(token) {
  var shard = this._readShard(this._shardIndexForToken(token));
  var key = mapKey(token);

  if (!hasOwn(shard, key)) {
    return { ids: [], positions: [] };
  }
  return decodePostingList(shard[key]);
};

SearchIndex.prototype._expandTerm = function(term, expandExistingTerm) {
  var variants = [];
  var terms = {};
  var seen = {};
  var exactIndex = this.vocabularyMap[mapKey(term)];
  var editDistance = fuzzyEditDistance(term);
  var matchedTerms = [];
  var index;
  var matchedTerm;
  var score;
  var posting;

  function addVariant(token, matchScore, termPosting) {
    var key = mapKey(token);

    if (hasOwn(seen, key) || !termPosting.ids.length) {
      return;
    }
    seen[key] = true;
    terms[key] = true;
    variants.push({
      term: token,
      score: matchScore,
      similarity: Math.max(0, 1 - matchScore),
      ids: termPosting.ids,
      positions: termPosting.positions,
      df: termPosting.ids.length
    });
  }

  if (exactIndex != null) {
    posting = this._postingList(term);
    addVariant(term, 0, posting);
  }
  if ((exactIndex == null || expandExistingTerm) && editDistance > 0) {
    matchedTerms = this.termSet.intersect(
      lunr.TokenSet.fromFuzzyString(term, editDistance)
    ).toArray().map(function(token) {
      var distance = damerauLevenshtein(term, token);

      return {
        term: token,
        distance: distance,
        score: distance / Math.max(1, term.length, token.length)
      };
    });
    matchedTerms.sort(function(left, right) {
      if (left.score !== right.score) {
        return left.score - right.score;
      }
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }
      return left.term < right.term ? -1 : left.term > right.term ? 1 : 0;
    });
  }
  for (index = 0; index < Math.min(matchedTerms.length, FUZZY_VARIANT_LIMIT); index += 1) {
    matchedTerm = matchedTerms[index].term;
    score = matchedTerms[index].score;
    if (matchedTerm === term) {
      continue;
    }
    posting = this._postingList(matchedTerm);
    addVariant(matchedTerm, score, posting);
  }
  return {
    query: term,
    terms: terms,
    variants: variants,
    restrictedExact: exactIndex != null && !expandExistingTerm,
    postingIds: null,
    exactIds: null
  };
};

SearchIndex.prototype._queryData = function(queryTokens, expandExistingTerms) {
  var uniqueGroups = [];
  var phraseGroups = [];
  var byQuery = {};
  var hasRestrictedExact = false;
  var index;
  var key;
  var group;

  for (index = 0; index < queryTokens.length; index += 1) {
    key = mapKey(queryTokens[index]);
    group = byQuery[key];
    if (!group) {
      group = this._expandTerm(queryTokens[index], expandExistingTerms);
      byQuery[key] = group;
      uniqueGroups.push(group);
      hasRestrictedExact = hasRestrictedExact || group.restrictedExact;
    }
    phraseGroups.push(group);
  }
  return {
    uniqueGroups: uniqueGroups,
    phraseGroups: phraseGroups,
    hasRestrictedExact: hasRestrictedExact
  };
};

SearchIndex.prototype._groupPostingIds = function(group) {
  var postingLists = [];
  var variantIndex;

  if (group.postingIds) {
    return group.postingIds;
  }
  for (variantIndex = 0; variantIndex < group.variants.length; variantIndex += 1) {
    postingLists.push(group.variants[variantIndex].ids);
    if (group.variants[variantIndex].term === group.query &&
        group.variants[variantIndex].score === 0) {
      group.exactIds = group.variants[variantIndex].ids;
    }
  }
  group.exactIds = group.exactIds || [];
  group.postingIds = unionSortedPostingLists(postingLists);
  return group.postingIds;
};

SearchIndex.prototype._candidateIds = function(groups, intersectionOnly) {
  var coverage = {};
  var maxExactCoverage = 0;
  var maxFuzzyCoverage = 0;
  var groupIndex;
  var idIndex;
  var groupIds;
  var postingLists = [];
  var intersection = [];
  var exactIdIndex;
  var id;
  var ids = [];

  for (groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    groupIds = this._groupPostingIds(groups[groupIndex]);
    if (!groupIds.length) {
      postingLists = [];
      break;
    }
    postingLists.push(groupIds);
  }
  if (postingLists.length === groups.length && postingLists.length) {
    postingLists.sort(function(left, right) {
      return left.length - right.length;
    });
    intersection = postingLists[0];
    for (groupIndex = 1; groupIndex < postingLists.length && intersection.length; groupIndex += 1) {
      intersection = intersectSortedPostingLists(intersection, postingLists[groupIndex]);
    }
    if (intersection.length || intersectionOnly) {
      return intersection;
    }
  } else if (intersectionOnly) {
    return ids;
  }

  for (groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    groupIds = this._groupPostingIds(groups[groupIndex]);
    exactIdIndex = 0;
    for (idIndex = 0; idIndex < groupIds.length; idIndex += 1) {
      while (exactIdIndex < groups[groupIndex].exactIds.length &&
             groups[groupIndex].exactIds[exactIdIndex] < groupIds[idIndex]) {
        exactIdIndex += 1;
      }
      id = groupIds[idIndex];
      coverage[mapKey(id)] = coverage[mapKey(id)] || { exact: 0, fuzzy: 0 };
      coverage[mapKey(id)].fuzzy += 1;
      if (groups[groupIndex].exactIds[exactIdIndex] === id) {
        coverage[mapKey(id)].exact += 1;
      }
    }
  }
  Object.keys(coverage).forEach(function(idKey) {
    if (coverage[idKey].exact > maxExactCoverage) {
      maxExactCoverage = coverage[idKey].exact;
      maxFuzzyCoverage = coverage[idKey].fuzzy;
    } else if (coverage[idKey].exact === maxExactCoverage &&
               coverage[idKey].fuzzy > maxFuzzyCoverage) {
      maxFuzzyCoverage = coverage[idKey].fuzzy;
    }
  });
  if (!Object.keys(coverage).length) {
    return ids;
  }
  Object.keys(coverage).forEach(function(idKey) {
    if (coverage[idKey].exact === maxExactCoverage &&
        coverage[idKey].fuzzy === maxFuzzyCoverage) {
      id = parseInt(idKey.slice(1), 10);
      if (id === id) {
        ids.push(id);
      }
    }
  });
  ids.sort(function(left, right) {
    return left - right;
  });
  return ids;
};

SearchIndex.prototype._candidateTokens = function(documentId, groups) {
  var documentLength = this.documentLengths[documentId];
  var tokens;
  var groupIndex;
  var variantIndex;
  var variant;
  var postingIndex;
  var positions;
  var positionIndex;

  if (!(documentLength > 0)) {
    return null;
  }
  tokens = new Array(documentLength);
  for (groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    for (variantIndex = 0; variantIndex < groups[groupIndex].variants.length; variantIndex += 1) {
      variant = groups[groupIndex].variants[variantIndex];
      postingIndex = postingIndexForDocument(variant.ids, documentId);
      if (postingIndex < 0) {
        continue;
      }
      positions = variant.positions[postingIndex];
      for (positionIndex = 0; positionIndex < positions.length; positionIndex += 1) {
        tokens[positions[positionIndex]] = variant.term;
      }
    }
  }
  return tokens;
};

SearchIndex.prototype._bm25Score = function(tokens, groups) {
  var counts = {};
  var documentLength = Math.max(1, tokens.length);
  var lengthNormalization = BM25_K1 * (
    1 - BM25_B + BM25_B * documentLength / Math.max(1, this.averageDocumentLength)
  );
  var totalDocuments = this.referenceMap.totalVerses;
  var score = 0;
  var tokenIndex;
  var groupIndex;
  var variantIndex;
  var variant;
  var frequency;
  var idf;
  var contribution;
  var best;

  for (tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    counts[mapKey(tokens[tokenIndex])] = (counts[mapKey(tokens[tokenIndex])] || 0) + 1;
  }
  for (groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    best = 0;
    for (variantIndex = 0; variantIndex < groups[groupIndex].variants.length; variantIndex += 1) {
      variant = groups[groupIndex].variants[variantIndex];
      frequency = counts[mapKey(variant.term)] || 0;
      if (!frequency) {
        continue;
      }
      idf = Math.log(1 + (totalDocuments - variant.df + 0.5) / (variant.df + 0.5));
      contribution = variant.similarity * idf *
        (frequency * (BM25_K1 + 1)) / (frequency + lengthNormalization);
      if (contribution > best) {
        best = contribution;
      }
    }
    score += best;
  }
  return score;
};

SearchIndex.prototype._rank = function(normalizedQuery, queryTokens, getVerseText) {
  var queryData = this._queryData(queryTokens, false);
  var candidates = this._candidateIds(queryData.uniqueGroups, true);
  var ranked = [];
  var index;
  var tokens;
  var match;

  if (!candidates.length && queryData.hasRestrictedExact) {
    queryData = this._queryData(queryTokens, true);
    candidates = this._candidateIds(queryData.uniqueGroups, true);
  }
  if (!candidates.length) {
    candidates = this._candidateIds(queryData.uniqueGroups, false);
  }

  for (index = 0; index < candidates.length; index += 1) {
    tokens = this._candidateTokens(candidates[index], queryData.uniqueGroups);
    if (!tokens) {
      continue;
    }
    match = findMatch(tokens, queryTokens, queryData.phraseGroups);
    if (!match) {
      continue;
    }
    ranked.push({
      id: candidates[index],
      phraseLevel: match.phraseLevel,
      span: match.span,
      score: this._bm25Score(tokens, queryData.uniqueGroups)
    });
  }

  ranked.sort(function(left, right) {
    if (left.phraseLevel !== right.phraseLevel) {
      return right.phraseLevel - left.phraseLevel;
    }
    if (left.span !== right.span) {
      return left.span - right.span;
    }
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    return left.id - right.id;
  });

  this.lastSearch = {
    query: normalizedQuery,
    tokens: queryTokens,
    phraseGroups: queryData.phraseGroups,
    ids: ranked.map(function(entry) {
      return entry.id;
    })
  };
  return this.lastSearch;
};

SearchIndex.prototype.search = function(query, offset, limit, getVerseText, excerptBytes) {
  var normalizedQuery;
  var queryTokens;
  var cached;
  var start;
  var end;
  var hits = [];
  var index;
  var reference;
  var text;
  var tokenized;
  var match;

  if (!this.ready) {
    throw new Error("Search index is not ready");
  }
  if (typeof getVerseText !== "function") {
    throw new Error("Bible text lookup is unavailable");
  }

  normalizedQuery = normalizeQuery(query);
  queryTokens = normalizedQuery ? normalizedQuery.split(" ") : [];
  offset = parseInt(offset, 10);
  limit = parseInt(limit, 10);
  offset = offset === offset && offset > 0 ? offset : 0;
  limit = limit === limit && limit > 0 ? Math.min(limit, 20) : 5;

  if (!queryTokens.length) {
    return { query: normalizedQuery, offset: 0, total: 0, hits: [] };
  }
  try {
    cached = this.lastSearch && this.lastSearch.query === normalizedQuery
      ? this.lastSearch
      : this._rank(normalizedQuery, queryTokens, getVerseText);
  } catch (error) {
    this.invalidate();
    throw error;
  }

  start = Math.min(offset, cached.ids.length);
  end = Math.min(cached.ids.length, start + limit);
  for (index = start; index < end; index += 1) {
    reference = referenceForId(this.referenceMap, cached.ids[index]);
    if (!reference) {
      continue;
    }
    text = getVerseText(reference.bookIndex, reference.chapter, reference.verse);
    if (typeof text !== "string") {
      continue;
    }
    tokenized = tokenizeVerse(text);
    match = findMatch(tokenized.tokens, cached.tokens, cached.phraseGroups);
    hits.push({
      bookIndex: reference.bookIndex,
      chapter: reference.chapter,
      verse: reference.verse,
      excerpt: makeExcerpt(tokenized, match, excerptBytes || DEFAULT_EXCERPT_BYTES)
    });
  }
  return {
    query: normalizedQuery,
    offset: start,
    total: cached.ids.length,
    hits: hits
  };
};

SearchIndex.prototype.isReady = function() {
  return this.ready;
};

SearchIndex.prototype.state = function() {
  if (this.ready) {
    return "ready";
  }
  if (this.building) {
    return "building";
  }
  return this.error ? "error" : "idle";
};

SearchIndex.prototype.lastError = function() {
  return this.error;
};

SearchIndex.normalizeText = normalizeText;
SearchIndex.normalizeQuery = normalizeQuery;
SearchIndex.findMatch = findMatch;
SearchIndex.makeExcerpt = makeExcerpt;
SearchIndex.constants = {
  markerKey: INDEX_MARKER_KEY,
  metaKey: INDEX_META_KEY,
  shardKeyPrefix: INDEX_SHARD_KEY_PREFIX,
  shardCount: INDEX_SHARD_COUNT,
  schemaVersion: INDEX_SCHEMA_VERSION
};

module.exports = SearchIndex;
