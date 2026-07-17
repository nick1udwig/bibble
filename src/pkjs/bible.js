"use strict";

var KJV_META = require("./bible-meta");
var KJV_SOURCE = require("../common/kjv-source");
var BibbleSettings = require("../common/settings");
var SearchIndex = require("./search-index");
var StorageCodec = require("./storage-codec");

var CHAPTER_PAGE_CACHE_LIMIT = 12;
var TEXT_BOOK_CACHE_LIMIT = 4;
var KJV_DOWNLOAD_TIMEOUT_MS = 30000;
var KJV_STORAGE_VERSION = KJV_SOURCE.storageVersion;
var KJV_STORAGE_MARKER_KEY = "bibble." + KJV_STORAGE_VERSION + ".complete";
var KJV_STORAGE_BOOK_KEY_PREFIX = "bibble." + KJV_STORAGE_VERSION + ".book.";
var SEARCH_RESULT_PAGE_SIZE = 5;
var SEARCH_EXCERPT_BYTES = 64;

var MANUAL_ALIASES = {
  0: ["gen", "gn", "genesys"],
  1: ["exod", "exo", "ex"],
  2: ["lev", "lv"],
  3: ["num", "nm"],
  4: ["deut", "dt"],
  5: ["josh"],
  6: ["judg", "jdg"],
  8: ["1 sam", "first sam", "one samuel"],
  9: ["2 sam", "second sam", "two samuel"],
  10: ["1 kgs", "1 kings", "first kings", "one kings"],
  11: ["2 kgs", "2 kings", "second kings", "two kings"],
  12: ["1 chron", "1 chronicles", "first chronicles", "one chronicles"],
  13: ["2 chron", "2 chronicles", "second chronicles", "two chronicles"],
  15: ["neh"],
  17: ["jobe"],
  18: ["psalm", "psalms", "ps", "psa", "salm", "salms", "soulm", "soulms", "songs"],
  19: ["prov", "proverbs"],
  20: ["eccl", "ecclesiastes"],
  21: ["song", "song of songs", "song of solomon", "songs of solomon", "canticles"],
  22: ["isa"],
  23: ["jer"],
  24: ["lam"],
  25: ["ezek", "ezechiel"],
  26: ["dan"],
  27: ["hos"],
  30: ["obad"],
  31: ["jonas"],
  33: ["nah"],
  34: ["hab"],
  35: ["zeph"],
  36: ["hag"],
  37: ["zech"],
  38: ["mal"],
  39: ["matt"],
  42: ["jn"],
  43: ["acts", "axe"],
  44: ["rom", "romans"],
  45: ["1 cor", "1 corinthians", "first corinthians", "one corinthians"],
  46: ["2 cor", "2 corinthians", "second corinthians", "two corinthians"],
  47: ["gal"],
  48: ["eph"],
  49: ["phil", "philippians"],
  50: ["col", "collosians", "collisions"],
  51: ["1 thess", "1 thessalonians", "first thessalonians", "one thessalonians"],
  52: ["2 thess", "2 thessalonians", "second thessalonians", "two thessalonians"],
  53: ["1 tim", "1 timothy", "first timothy", "one timothy"],
  54: ["2 tim", "2 timothy", "second timothy", "two timothy"],
  56: ["philem", "filemon"],
  57: ["bruce"],
  58: ["jas"],
  59: ["1 pet", "1 peter", "first peter", "one peter"],
  60: ["2 pet", "2 peter", "second peter", "two peter"],
  61: ["1 john", "first john", "one john"],
  62: ["2 john", "second john", "two john"],
  63: ["3 john", "third john", "three john"],
  65: ["rev", "revelation", "revelations"]
};

var NUMBER_WORDS = {
  zero: 0,
  oh: 0,
  o: 0,
  one: 1,
  first: 1,
  two: 2,
  second: 2,
  to: 2,
  too: 2,
  three: 3,
  third: 3,
  four: 4,
  fourth: 4,
  for: 4,
  fore: 4,
  five: 5,
  fifth: 5,
  six: 6,
  sixth: 6,
  seven: 7,
  seventh: 7,
  eight: 8,
  eighth: 8,
  nine: 9,
  ninth: 9,
  ten: 10,
  tenth: 10,
  eleven: 11,
  eleventh: 11,
  twelve: 12,
  twelfth: 12,
  thirteen: 13,
  thirteenth: 13,
  fourteen: 14,
  fourteenth: 14,
  fifteen: 15,
  fifteenth: 15,
  sixteen: 16,
  sixteenth: 16,
  seventeen: 17,
  seventeenth: 17,
  eighteen: 18,
  eighteenth: 18,
  nineteen: 19,
  nineteenth: 19,
  twenty: 20,
  twentieth: 20,
  thirty: 30,
  thirtieth: 30,
  forty: 40,
  fortieth: 40,
  fourty: 40,
  fifty: 50,
  fiftieth: 50,
  sixty: 60,
  sixtieth: 60,
  seventy: 70,
  seventieth: 70,
  eighty: 80,
  eightieth: 80,
  ninety: 90,
  ninetieth: 90
};

var pageCache = {};
var pageCacheKeys = [];
var aliasCache = null;
var kjvBooks = null;
var textBookCacheKeys = [];
var usingPersistentCorpus = false;
var corpusAvailable = false;
var loadStateValue = "idle";
var loadError = "";
var loadCallbacks = [];
var paginationSettings = BibbleSettings.normalizeSettings(null);
var searchIndex = new SearchIndex({
  corpusVersion: KJV_STORAGE_VERSION,
  meta: KJV_META,
  getStorage: persistentStorage
});

function books() {
  return KJV_META;
}

function bookAt(bookIndex) {
  return books()[bookIndex];
}

function touchCacheKey(keys, key, limit, evict) {
  var index;

  for (index = 0; index < keys.length; index += 1) {
    if (keys[index] === key) {
      keys.splice(index, 1);
      break;
    }
  }
  keys.push(key);
  while (keys.length > limit) {
    evict(keys.shift());
  }
}

function resetPageCache() {
  pageCache = {};
  pageCacheKeys = [];
}

function setSettings(settings) {
  var normalized = BibbleSettings.normalizeSettings(settings);
  var changed = BibbleSettings.profileKey(normalized) !==
    BibbleSettings.profileKey(paginationSettings);

  paginationSettings = normalized;
  return changed;
}

function setFontSize(fontSize) {
  return setSettings({
    fontSize: fontSize,
    bold: paginationSettings.bold
  });
}

function fontSize() {
  return paginationSettings.fontSize;
}

function fontBold() {
  return paginationSettings.bold;
}

function fontProfile() {
  return BibbleSettings.profileKey(paginationSettings);
}

function touchPageCache(key) {
  touchCacheKey(pageCacheKeys, key, CHAPTER_PAGE_CACHE_LIMIT, function(evictedKey) {
    delete pageCache[evictedKey];
  });
}

function storePageCache(key, value) {
  pageCache[key] = value;
  touchPageCache(key);
  return value;
}

function touchTextBookCache(bookIndex) {
  if (!usingPersistentCorpus) {
    return;
  }
  touchCacheKey(textBookCacheKeys, bookIndex, TEXT_BOOK_CACHE_LIMIT, function(evictedBookIndex) {
    delete kjvBooks[evictedBookIndex];
  });
}

function cacheInfo() {
  return {
    chapters: pageCacheKeys.length,
    textBooks: usingPersistentCorpus ? textBookCacheKeys.length : 0
  };
}

function getChapterVerses(bookIndex, chapter) {
  var book = loadTextBook(bookIndex);

  if (!book || !book.chapters || !book.chapters[chapter - 1]) {
    return null;
  }

  return book.chapters[chapter - 1];
}

function cleanVerse(value) {
  return String(value == null ? "" : value)
    .replace(/\s*\{([^}]*)\}/g, function(_, inner) {
      var text = String(inner || "").trim();
      if (/^[A-Za-z ]+$/.test(text) && text.length <= 30 && !/^(or|heb|gr|that is)\b/i.test(text)) {
        return " " + text;
      }
      return "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function persistentStorage() {
  try {
    if (typeof localStorage !== "undefined" && localStorage &&
        typeof localStorage.getItem === "function" && typeof localStorage.setItem === "function") {
      return localStorage;
    }
  } catch (_) {
  }
  return null;
}

function storageBookKey(bookIndex) {
  return KJV_STORAGE_BOOK_KEY_PREFIX + String(bookIndex);
}

function encodeStoredChapters(chapters) {
  return StorageCodec.compress(JSON.stringify(chapters));
}

function decodeStoredChapters(value) {
  return JSON.parse(StorageCodec.decompress(value));
}

function validateStoredChapters(chapters, bookIndex) {
  var meta = KJV_META[bookIndex];
  var chapterIndex;
  var verseIndex;

  if (!meta || !Array.isArray(chapters) || chapters.length !== meta.verseCounts.length) {
    return false;
  }
  for (chapterIndex = 0; chapterIndex < chapters.length; chapterIndex += 1) {
    if (!Array.isArray(chapters[chapterIndex]) ||
        chapters[chapterIndex].length !== meta.verseCounts[chapterIndex]) {
      return false;
    }
    for (verseIndex = 0; verseIndex < chapters[chapterIndex].length; verseIndex += 1) {
      if (typeof chapters[chapterIndex][verseIndex] !== "string") {
        return false;
      }
    }
  }
  return true;
}

function invalidatePersistentCorpus(storage) {
  try {
    if (storage && typeof storage.removeItem === "function") {
      storage.removeItem(KJV_STORAGE_MARKER_KEY);
    }
  } catch (_) {
  }
  corpusAvailable = false;
  kjvBooks = null;
  textBookCacheKeys = [];
  usingPersistentCorpus = false;
  resetPageCache();
  searchIndex.invalidate();
  loadStateValue = "error";
  loadError = "Cached KJV data is invalid";
}

function loadTextBook(bookIndex) {
  var storage;
  var stored;
  var chapters;
  var legacyEncoding;

  if (kjvBooks && kjvBooks[bookIndex]) {
    touchTextBookCache(bookIndex);
    return kjvBooks[bookIndex];
  }
  if (!corpusAvailable) {
    return null;
  }

  storage = persistentStorage();
  if (!storage) {
    return null;
  }
  try {
    stored = storage.getItem(storageBookKey(bookIndex));
    legacyEncoding = stored != null && !StorageCodec.isCompressed(stored);
    chapters = stored ? decodeStoredChapters(stored) : null;
  } catch (_) {
    chapters = null;
  }
  if (!validateStoredChapters(chapters, bookIndex)) {
    invalidatePersistentCorpus(storage);
    return null;
  }

  if (legacyEncoding) {
    try {
      storage.setItem(storageBookKey(bookIndex), encodeStoredChapters(chapters));
    } catch (_) {
      // The validated legacy value remains usable if an in-place migration fails.
    }
  }

  kjvBooks = kjvBooks || [];
  kjvBooks[bookIndex] = {
    chapters: chapters
  };
  touchTextBookCache(bookIndex);
  return kjvBooks[bookIndex];
}

function restorePersistentCorpus() {
  var storage = persistentStorage();

  if (!storage) {
    return false;
  }
  try {
    if (storage.getItem(KJV_STORAGE_MARKER_KEY) !== KJV_STORAGE_VERSION) {
      return false;
    }
  } catch (_) {
    return false;
  }

  kjvBooks = [];
  textBookCacheKeys = [];
  usingPersistentCorpus = true;
  corpusAvailable = true;
  loadStateValue = "ready";
  loadError = "";
  return true;
}

function persistNormalizedBooks(normalized) {
  var storage = persistentStorage();
  var written = 0;
  var index;

  if (!storage) {
    return false;
  }
  try {
    if (typeof storage.removeItem === "function") {
      storage.removeItem(KJV_STORAGE_MARKER_KEY);
    }
    for (index = 0; index < normalized.length; index += 1) {
      storage.setItem(storageBookKey(index), encodeStoredChapters(normalized[index].chapters));
      written += 1;
    }
    storage.setItem(KJV_STORAGE_MARKER_KEY, KJV_STORAGE_VERSION);
    return true;
  } catch (_) {
    if (typeof storage.removeItem === "function") {
      try {
        storage.removeItem(KJV_STORAGE_MARKER_KEY);
        for (index = 0; index < written; index += 1) {
          storage.removeItem(storageBookKey(index));
        }
      } catch (_) {
      }
    }
    return false;
  }
}

function normalizeDownloadedBooks(rawBooks) {
  var normalized;

  if (!Array.isArray(rawBooks) || rawBooks.length !== KJV_META.length) {
    throw new Error("Unexpected KJV book count");
  }

  normalized = rawBooks.map(function(book, bookIndex) {
    var meta = KJV_META[bookIndex];
    if (!book || !Array.isArray(book.chapters) || book.chapters.length !== meta.verseCounts.length) {
      throw new Error("Unexpected KJV chapter data for " + meta.name);
    }

    return {
      abbrev: book.abbrev || meta.abbrev,
      name: meta.name,
      verseCounts: meta.verseCounts,
      chapters: book.chapters.map(function(chapter, chapterIndex) {
        var expectedVerses = meta.verseCounts[chapterIndex];
        if (!Array.isArray(chapter) || chapter.length !== expectedVerses) {
          throw new Error("Unexpected KJV verse data for " + meta.name + " " + String(chapterIndex + 1));
        }
        return chapter.map(cleanVerse);
      })
    };
  });

  return normalized;
}

function loadFromBooks(rawBooks) {
  var normalized = normalizeDownloadedBooks(rawBooks);

  searchIndex.invalidate();
  corpusAvailable = true;
  if (persistNormalizedBooks(normalized)) {
    kjvBooks = [];
    textBookCacheKeys = [];
    usingPersistentCorpus = true;
  } else {
    kjvBooks = normalized;
    textBookCacheKeys = [];
    usingPersistentCorpus = false;
  }
  resetPageCache();
  loadStateValue = "ready";
  loadError = "";
  flushLoadCallbacks(null);
}

function loadFromJsonText(text) {
  loadFromBooks(JSON.parse(String(text || "").replace(/^\uFEFF/, "")));
}

function flushLoadCallbacks(error) {
  var callbacks = loadCallbacks;
  var index;

  loadCallbacks = [];
  for (index = 0; index < callbacks.length; index += 1) {
    callbacks[index](error || null);
  }
}

function failLoad(message) {
  loadStateValue = "error";
  loadError = message;
  flushLoadCallbacks(loadError);
}

function ensureLoaded(callback) {
  var request;
  var settled = false;

  function rejectLoad(message) {
    if (settled) {
      return;
    }
    settled = true;
    failLoad(message);
  }

  if (corpusAvailable) {
    if (callback) {
      callback(null);
    }
    return;
  }

  if (callback) {
    loadCallbacks.push(callback);
  }
  if (loadStateValue === "loading") {
    return;
  }

  if (restorePersistentCorpus()) {
    flushLoadCallbacks(null);
    return;
  }

  loadStateValue = "loading";
  loadError = "";

  if (typeof XMLHttpRequest === "undefined") {
    failLoad("Network unavailable");
    return;
  }

  try {
    request = new XMLHttpRequest();
    request.open("GET", KJV_SOURCE.url, true);
    request.timeout = KJV_DOWNLOAD_TIMEOUT_MS;
  } catch (_) {
    rejectLoad("KJV download failed");
    return;
  }

  request.onreadystatechange = function() {
    if (request.readyState !== 4) {
      return;
    }

    if (request.status >= 200 && request.status < 300) {
      if (settled) {
        return;
      }
      settled = true;
      try {
        loadFromJsonText(request.responseText);
      } catch (error) {
        failLoad(error && error.message ? error.message : "KJV parse failed");
      }
      return;
    }

    rejectLoad("KJV download failed");
  };
  request.onerror = function() {
    rejectLoad("KJV download failed");
  };
  request.ontimeout = function() {
    rejectLoad("KJV download timed out");
  };
  request.onabort = function() {
    rejectLoad("KJV download canceled");
  };
  try {
    request.send();
  } catch (_) {
    rejectLoad("KJV download failed");
  }
}

function isLoaded() {
  return corpusAvailable;
}

function searchCorpusSource() {
  return {
    getBookChapters: function(bookIndex) {
      var book = loadTextBook(bookIndex);
      return book && book.chapters ? book.chapters : null;
    }
  };
}

function ensureSearchReady(callback, progress) {
  ensureLoaded(function(error) {
    if (error) {
      if (callback) {
        callback(error);
      }
      return;
    }
    searchIndex.ensureReady(searchCorpusSource(), callback, progress);
  });
}

function isSearchReady() {
  return searchIndex.isReady();
}

function searchState() {
  return searchIndex.state();
}

function lastSearchError() {
  return searchIndex.lastError();
}

function search(query, offset, limit) {
  return searchIndex.search(
    query,
    offset,
    limit || SEARCH_RESULT_PAGE_SIZE,
    function(bookIndex, chapter, verse) {
      var verses = getChapterVerses(bookIndex, chapter);
      return verses && typeof verses[verse - 1] === "string" ? verses[verse - 1] : null;
    },
    SEARCH_EXCERPT_BYTES
  );
}

function loadState() {
  return loadStateValue;
}

function lastLoadError() {
  return loadError;
}

function normalizeWords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\b(\d+)(st|nd|rd|th)\b/g, "$1")
    .replace(/['\u2019]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function replaceNumberWords(text) {
  var tokens = normalizeWords(text).split(" ");
  var output = [];
  var index = 0;
  var parsed;

  while (index < tokens.length) {
    parsed = parseZeroDigitRun(tokens, index);
    if (parsed.count > 0) {
      output.push(String(parsed.value));
      index += parsed.count;
      continue;
    }

    parsed = parseNumberRun(tokens, index);
    if (parsed.count > 0) {
      output.push(String(parsed.value));
      index += parsed.count;
    } else {
      output.push(tokens[index]);
      index += 1;
    }
  }

  return output.join(" ").replace(/\s+/g, " ").trim();
}

function firstToken(text) {
  return String(text || "").split(" ")[0];
}

function startsWithNumberToken(text) {
  var token = firstToken(text);
  return /^\d+(?::\d+)?$/.test(token) || token === "hundred" || NUMBER_WORDS[token] != null;
}

function startsWithOneToken(text) {
  var token = firstToken(text);
  return token === "1" || token === "one" || token === "first";
}

function normalizeSpeechReferenceText(text) {
  var normalized = normalizeWords(text);
  var rest;

  if (normalized === "so im" || normalized === "so im on") {
    return "unparseable " + normalized;
  }

  if (normalized.indexOf("so im on ") === 0) {
    rest = normalized.slice("so im on ".length);
    if (startsWithOneToken(rest)) {
      return "psalm " + rest;
    }
    if (startsWithNumberToken(rest)) {
      return "psalm one " + rest;
    }
    return "unparseable " + normalized;
  }

  if (normalized.indexOf("so im ") === 0) {
    rest = normalized.slice("so im ".length);
    if (startsWithNumberToken(rest)) {
      return "psalm " + rest;
    }
    return "unparseable " + normalized;
  }

  return normalized;
}

function parseZeroDigitRun(tokens, start) {
  var index = start;
  var digits = "";
  var hasZero = false;
  var value;

  while (index < tokens.length) {
    value = NUMBER_WORDS[tokens[index]];
    if (value == null || value < 0 || value > 9) {
      break;
    }
    if (value === 0) {
      hasZero = true;
    }
    digits += String(value);
    index += 1;
  }

  if (!hasZero || index === start || index === start + 1) {
    return {
      value: 0,
      count: 0
    };
  }

  return {
    value: parseInt(digits, 10),
    count: index - start
  };
}

function parseNumberRun(tokens, start) {
  var index = start;
  var total = 0;
  var current = 0;
  var count = 0;
  var token;
  var value;

  while (index < tokens.length) {
    token = tokens[index];
    if (token === "and" && current >= 100 && NUMBER_WORDS[tokens[index + 1]] != null) {
      index += 1;
      count += 1;
      continue;
    }

    if (token === "hundred") {
      if (count === 0) {
        break;
      }
      current = (current || 1) * 100;
      index += 1;
      count += 1;
      continue;
    }

    value = NUMBER_WORDS[token];
    if (value == null) {
      break;
    }

    if (shouldStopNumberRun(count, current, value, tokens[index - 1])) {
      break;
    }

    current += value;
    index += 1;
    count += 1;

    if (value >= 10 && value < 20) {
      break;
    }
  }

  total += current;
  return {
    value: total,
    count: count
  };
}

function shouldStopNumberRun(count, current, value, previousToken) {
  if (count === 0) {
    return false;
  }
  if (current > 0 && current < 10 && value > 0 && value < 10) {
    return true;
  }
  if (current > 20 && current < 100 && current % 10 !== 0 && value > 0 && value < 10) {
    return true;
  }
  return current > 0 && current < 10 && value >= 10 && value < 100 && previousToken !== "hundred";
}

function normalizeReference(text) {
  return replaceNumberWords(normalizeSpeechReferenceText(text))
    .replace(/^(?:please\s+)?(?:(?:go|turn)\s+(?:to|2)|open|show\s+me|show|find|read)\s+/, "")
    .replace(/^(?:the\s+)?book(?:\s+of)?\s+/, "")
    .replace(/^the\s+/, "")
    .replace(/:/g, " ")
    .replace(/\bchapter\b|\bchap\b|\bch\b/gi, " ")
    .replace(/\bverse\b|\bverses\b|\bvs\b|\bv\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildAliases() {
  var aliases = [];
  var seen = {};
  var index;
  var book;
  var name;
  var shortName;

  function add(bookIndex, alias) {
    var seenKey;

    alias = normalizeReference(alias);
    seenKey = String(bookIndex) + "|" + alias;
    if (!alias || seen[seenKey]) {
      return;
    }
    seen[seenKey] = true;
    aliases.push({
      alias: alias,
      bookIndex: bookIndex
    });
  }

  for (index = 0; index < bookCount(); index += 1) {
    book = bookAt(index);
    name = book.name;
    add(index, name);
    if (book.abbrev) {
      add(index, book.abbrev);
    }
    shortName = name.replace(/^First /, "1 ").replace(/^Second /, "2 ").replace(/^Third /, "3 ");
    add(index, shortName);
    add(index, shortName.replace(/\s+of\s+/g, " "));
    add(index, shortName.replace(/\s+the\s+/g, " "));
    if (MANUAL_ALIASES[index]) {
      MANUAL_ALIASES[index].forEach(function(alias) {
        add(index, alias);
      });
    }
  }

  aliases.sort(function(left, right) {
    if (right.alias.length !== left.alias.length) {
      return right.alias.length - left.alias.length;
    }
    return left.bookIndex - right.bookIndex;
  });
  return aliases;
}

function aliases() {
  if (!aliasCache) {
    aliasCache = buildAliases();
  }
  return aliasCache;
}

function parseReference(input) {
  var normalized = normalizeReference(input);
  var allAliases = aliases();
  var index;
  var alias;
  var rest;
  var numbers;
  var explicitVerse = /[:]|(?:^|\s)(verse|verses|vs|v)(?:\s|$)/i.test(String(input || ""));
  var parsed;
  var firstError = null;

  for (index = 0; index < allAliases.length; index += 1) {
    alias = allAliases[index];
    if (normalized === alias.alias || normalized.indexOf(alias.alias + " ") === 0) {
      rest = normalized.slice(alias.alias.length).trim();
      if (rest && !/^\d+(?:\s|$)/.test(rest)) {
        if (!firstError) {
          firstError = "unexpected reference words";
        }
        continue;
      }
      numbers = extractNumbers(rest);
      parsed = resolveNumbers(alias.bookIndex, numbers, explicitVerse);
      if (parsed.ok) {
        return {
          ok: true,
          input: String(input || ""),
          bookIndex: alias.bookIndex,
          bookName: bookName(alias.bookIndex),
          chapter: parsed.chapter,
          verse: parsed.verse,
          reference: formatReference(alias.bookIndex, parsed.chapter, parsed.verse)
        };
      }
      if (!firstError) {
        firstError = parsed.error || "invalid reference";
      }
    }
  }

  if (firstError) {
    return {
      ok: false,
      input: String(input || ""),
      error: firstError
    };
  }

  return {
    ok: false,
    input: String(input || ""),
    error: "no book"
  };
}

function extractNumbers(text) {
  var matches = String(text || "").match(/\d+/g);
  var result = [];
  var index;
  if (!matches) {
    return result;
  }
  for (index = 0; index < matches.length; index += 1) {
    result.push(parseInt(matches[index], 10));
  }
  return result;
}

function resolveNumbers(bookIndex, numbers, explicitVerse) {
  var chapter;
  var verse;
  var combinedChapter;
  var resolved;
  var consumed;

  if (!numbers.length) {
    return {
      ok: true,
      chapter: 0,
      verse: 0
    };
  }

  if (chapterCount(bookIndex) === 1 && numbers.length === 1) {
    chapter = 1;
    verse = numbers[0];
    consumed = 1;
  } else if (numbers.length === 1) {
    chapter = numbers[0];
    verse = 1;
    consumed = 1;
    if (!isValidChapter(bookIndex, chapter)) {
      resolved = resolveMergedChapterVerse(bookIndex, numbers[0]);
      if (resolved) {
        chapter = resolved.chapter;
        verse = resolved.verse;
        consumed = resolved.consumed;
      }
    }
  } else {
    chapter = numbers[0];
    verse = numbers[1];
    consumed = 2;
    combinedChapter = combineChapterParts(numbers[0], numbers[1]);
    if (explicitVerse && numbers.length > 2 && !isValidVerse(bookIndex, chapter, verse)) {
      resolved = resolveSplitExplicitReference(bookIndex, combinedChapter, numbers);
      if (resolved) {
        chapter = resolved.chapter;
        verse = resolved.verse;
        consumed = resolved.consumed;
      }
    } else if (!explicitVerse && !isValidVerse(bookIndex, chapter, verse) && isValidChapter(bookIndex, combinedChapter)) {
      chapter = combinedChapter;
      verse = 1;
      if (numbers.length > 2) {
        resolved = resolveTrailingVerse(bookIndex, chapter, numbers, 2);
        if (resolved) {
          verse = resolved.verse;
          consumed = resolved.consumed;
        }
      }
    }
  }

  if (!isValidChapter(bookIndex, chapter)) {
    return {
      ok: false,
      error: "bad chapter"
    };
  }
  if (!isValidVerse(bookIndex, chapter, verse)) {
    return {
      ok: false,
      error: "bad verse"
    };
  }
  if (consumed < numbers.length) {
    return {
      ok: false,
      error: "extra number"
    };
  }

  return {
    ok: true,
    chapter: chapter,
    verse: verse
  };
}

function resolveMergedChapterVerse(bookIndex, value) {
  var text = String(value);
  var index;
  var chapter;
  var verse;
  var match = null;

  if (text.length < 3) {
    return null;
  }

  for (index = 1; index < text.length; index += 1) {
    chapter = parseInt(text.slice(0, index), 10);
    verse = parseInt(text.slice(index), 10);
    if (isValidVerse(bookIndex, chapter, verse)) {
      if (match) {
        return null;
      }
      match = {
        chapter: chapter,
        verse: verse,
        consumed: 1
      };
    }
  }

  return match;
}

function resolveSplitExplicitReference(bookIndex, chapter, numbers) {
  if (!isValidChapter(bookIndex, chapter)) {
    return null;
  }

  return resolveTrailingVerse(bookIndex, chapter, numbers, 2);
}

function resolveTrailingVerse(bookIndex, chapter, numbers, start) {
  var combinedVerse;

  if (numbers.length > start + 1) {
    combinedVerse = combineNumberParts(numbers[start], numbers[start + 1]);
    if (isValidVerse(bookIndex, chapter, combinedVerse)) {
      return {
        chapter: chapter,
        verse: combinedVerse,
        consumed: start + 2
      };
    }
  }
  if (isValidVerse(bookIndex, chapter, numbers[start])) {
    return {
      chapter: chapter,
      verse: numbers[start],
      consumed: start + 1
    };
  }
  return null;
}

function combineChapterParts(left, right) {
  return parseInt(String(left) + (right < 10 ? "0" : "") + String(right), 10);
}

function combineNumberParts(left, right) {
  return parseInt(String(left) + String(right), 10);
}

function formatReference(bookIndex, chapter, verse) {
  var name = bookName(bookIndex);
  if (!chapter) {
    return name;
  }
  return name + " " + String(chapter) + ":" + String(verse || 1);
}

function chapterCount(bookIndex) {
  var book = bookAt(bookIndex);
  if (book && book.verseCounts) {
    return book.verseCounts.length;
  }
  return book && book.chapters ? book.chapters.length : 0;
}

function verseCount(bookIndex, chapter) {
  var book = bookAt(bookIndex);
  var verses;
  if (book && book.verseCounts) {
    return book.verseCounts[chapter - 1] || 0;
  }
  verses = getChapterVerses(bookIndex, chapter);
  return verses ? verses.length : 0;
}

function isValidChapter(bookIndex, chapter) {
  return bookIndex >= 0 && bookIndex < bookCount() && chapter >= 1 && chapter <= chapterCount(bookIndex);
}

function isValidVerse(bookIndex, chapter, verse) {
  return isValidChapter(bookIndex, chapter) && verse >= 1 && verse <= verseCount(bookIndex, chapter);
}

function getChapterPage(bookIndex, chapter, verse, page) {
  var cache = getChapterCache(bookIndex, chapter);
  var selectedVerse = isValidVerse(bookIndex, chapter, verse) ? verse : 0;
  var selectedPage = page > 0 ? page : cache.versePage[selectedVerse] || 1;
  selectedPage = clampPage(selectedPage, cache.pages.length);
  return {
    bookIndex: bookIndex,
    bookName: bookName(bookIndex),
    chapter: chapter,
    verse: selectedVerse || cache.pageFirstVerse[selectedPage] || 1,
    page: selectedPage,
    pageCount: cache.pages.length,
    text: cache.pages[selectedPage - 1] || ""
  };
}

function getAdjacentPage(bookIndex, chapter, page, delta) {
  var cache;
  var nextPage = page + delta;
  var nextBook = bookIndex;
  var nextChapter = chapter;

  if (!isValidChapter(nextBook, nextChapter)) {
    nextBook = 0;
    nextChapter = 1;
  }

  cache = getChapterCache(nextBook, nextChapter);
  if (delta === 0) {
    return getChapterPage(nextBook, nextChapter, 0, page);
  }
  if (nextPage >= 1 && nextPage <= cache.pages.length) {
    return getChapterPage(nextBook, nextChapter, 0, nextPage);
  }

  if (delta > 0) {
    if (nextChapter < chapterCount(nextBook)) {
      nextChapter += 1;
    } else if (nextBook + 1 < bookCount()) {
      nextBook += 1;
      nextChapter = 1;
    } else {
      return getChapterPage(nextBook, nextChapter, 0, cache.pages.length);
    }
    return getChapterPage(nextBook, nextChapter, 0, 1);
  }

  if (nextChapter > 1) {
    nextChapter -= 1;
  } else if (nextBook > 0) {
    nextBook -= 1;
    nextChapter = chapterCount(nextBook);
  } else {
    return getChapterPage(nextBook, nextChapter, 0, 1);
  }
  cache = getChapterCache(nextBook, nextChapter);
  return getChapterPage(nextBook, nextChapter, 0, cache.pages.length);
}

function getChapterCache(bookIndex, chapter) {
  var pageCharLimit = BibbleSettings.pageCharLimit(paginationSettings);
  var key = fontProfile() + ":" + String(bookIndex) + ":" + String(chapter);
  var verses;
  var pages = [];
  var pageFirstVerse = [];
  var versePage = [];
  var current = "";
  var index;

  if (pageCache[key]) {
    touchPageCache(key);
    return pageCache[key];
  }

  verses = getChapterVerses(bookIndex, chapter);
  if (!verses) {
    return storePageCache(key, {
      pages: [""],
      pageFirstVerse: [1, 1],
      versePage: [0, 1]
    });
  }

  for (index = 0; index < verses.length; index += 1) {
    current = appendVerseLine(pages, pageFirstVerse, versePage, current, index + 1,
                              String(index + 1) + ". " + verses[index], pageCharLimit);
  }
  if (current) {
    if (!pageFirstVerse[pages.length + 1]) {
      pageFirstVerse[pages.length + 1] = 1;
    }
    pages.push(current);
  }
  if (!pages.length) {
    pages.push("");
    pageFirstVerse[1] = 1;
  }

  return storePageCache(key, {
    pages: pages,
    pageFirstVerse: pageFirstVerse,
    versePage: versePage
  });
}

function appendVerseLine(pages, pageFirstVerse, versePage, current, verse, line, pageCharLimit) {
  var chunks;
  var chunkIndex;
  var candidate;

  if (line.length > pageCharLimit) {
    if (current) {
      pages.push(current);
      current = "";
    }
    chunks = splitLongLine(line, pageCharLimit);
    for (chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      versePage[verse] = versePage[verse] || pages.length + 1;
      pageFirstVerse[pages.length + 1] = verse;
      if (chunkIndex + 1 === chunks.length) {
        current = chunks[chunkIndex];
      } else {
        pages.push(chunks[chunkIndex]);
      }
    }
    return current;
  }

  candidate = current ? current + "\n" + line : line;
  if (current && candidate.length > pageCharLimit) {
    pages.push(current);
    current = line;
  } else {
    current = candidate;
  }

  versePage[verse] = versePage[verse] || pages.length + 1;
  pageFirstVerse[pages.length + 1] = pageFirstVerse[pages.length + 1] || verse;
  return current;
}

function splitLongLine(line, maxLength) {
  var words = String(line).split(/\s+/);
  var chunks = [];
  var current = "";
  var index;
  var candidate;
  var word;
  var room;

  for (index = 0; index < words.length; index += 1) {
    word = words[index];
    if (word.length > maxLength) {
      if (current) {
        room = maxLength - current.length - 1;
        if (room > 0) {
          chunks.push(current + " " + word.slice(0, room));
          word = word.slice(room);
        } else {
          chunks.push(current);
        }
        current = "";
      }
      while (word.length > maxLength) {
        chunks.push(word.slice(0, maxLength));
        word = word.slice(maxLength);
      }
      current = word;
      continue;
    }

    candidate = current ? current + " " + word : word;
    if (current && candidate.length > maxLength) {
      chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function clampPage(page, pageCount) {
  if (page < 1) {
    return 1;
  }
  if (page > pageCount) {
    return pageCount;
  }
  return page;
}

function bookCount() {
  return books().length;
}

function bookName(bookIndex) {
  var book = bookAt(bookIndex);
  return book ? book.name : "";
}

module.exports = {
  bookCount: bookCount,
  bookName: bookName,
  chapterCount: chapterCount,
  verseCount: verseCount,
  parseReference: parseReference,
  formatReference: formatReference,
  getChapterPage: getChapterPage,
  getAdjacentPage: getAdjacentPage,
  isValidChapter: isValidChapter,
  isValidVerse: isValidVerse,
  normalizeReference: normalizeReference,
  ensureLoaded: ensureLoaded,
  ensureSearchReady: ensureSearchReady,
  isLoaded: isLoaded,
  isSearchReady: isSearchReady,
  searchState: searchState,
  lastSearchError: lastSearchError,
  search: search,
  loadState: loadState,
  lastLoadError: lastLoadError,
  cacheInfo: cacheInfo,
  setSettings: setSettings,
  setFontSize: setFontSize,
  fontSize: fontSize,
  fontBold: fontBold,
  fontProfile: fontProfile,
  loadFromBooks: loadFromBooks,
  loadFromJsonText: loadFromJsonText
};
