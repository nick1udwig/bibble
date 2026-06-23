"use strict";

var KJV_META = require("./bible-meta");

var PAGE_CHAR_LIMIT = 360;
var KJV_SOURCE_URL = "https://raw.githubusercontent.com/thiagobodruk/bible/master/json/en_kjv.json";

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

var SMALL_NUMBER_WORDS = {
  one: true,
  first: true,
  two: true,
  second: true,
  three: true,
  third: true,
  four: true,
  fourth: true,
  five: true,
  fifth: true,
  six: true,
  sixth: true,
  seven: true,
  seventh: true,
  eight: true,
  eighth: true,
  nine: true,
  ninth: true
};

var pageCache = {};
var aliasCache = null;
var kjvBooks = null;
var loadStateValue = "idle";
var loadError = "";
var loadCallbacks = [];

function books() {
  return kjvBooks || KJV_META;
}

function bookAt(bookIndex) {
  return books()[bookIndex];
}

function getChapterVerses(bookIndex, chapter) {
  var book = bookAt(bookIndex);

  if (!kjvBooks || !book || !book.chapters || !book.chapters[chapter - 1]) {
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
  kjvBooks = normalizeDownloadedBooks(rawBooks);
  pageCache = {};
  loadStateValue = "ready";
  loadError = "";
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

function ensureLoaded(callback) {
  var request;

  if (kjvBooks) {
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

  loadStateValue = "loading";
  loadError = "";

  if (typeof XMLHttpRequest === "undefined") {
    loadStateValue = "error";
    loadError = "Network unavailable";
    flushLoadCallbacks(loadError);
    return;
  }

  request = new XMLHttpRequest();
  request.open("GET", KJV_SOURCE_URL, true);
  request.onreadystatechange = function() {
    if (request.readyState !== 4) {
      return;
    }

    if (request.status >= 200 && request.status < 300) {
      try {
        loadFromJsonText(request.responseText);
        flushLoadCallbacks(null);
      } catch (error) {
        loadStateValue = "error";
        loadError = error && error.message ? error.message : "KJV parse failed";
        flushLoadCallbacks(loadError);
      }
      return;
    }

    loadStateValue = "error";
    loadError = "KJV download failed";
    flushLoadCallbacks(loadError);
  };
  request.send();
}

function isLoaded() {
  return !!kjvBooks;
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

function parseNumberRun(tokens, start) {
  var index = start;
  var total = 0;
  var current = 0;
  var count = 0;
  var token;
  var value;

  while (index < tokens.length) {
    token = tokens[index];
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

    if (count > 0 && current > 0 && current < 10 && value > 0 && value < 10) {
      break;
    }
    if (count > 0 && current > 20 && current < 100 && current % 10 !== 0 && value > 0 && value < 10) {
      break;
    }
    if (count > 0 && current > 0 && current < 10 && value >= 10 && value < 20 && tokens[index - 1] !== "hundred") {
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

function normalizeReference(text) {
  return replaceNumberWords(text)
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
    alias = normalizeReference(alias);
    if (!alias || seen[alias]) {
      return;
    }
    seen[alias] = true;
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
    return right.alias.length - left.alias.length;
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

  for (index = 0; index < allAliases.length; index += 1) {
    alias = allAliases[index];
    if (normalized === alias.alias || normalized.indexOf(alias.alias + " ") === 0) {
      rest = normalized.slice(alias.alias.length).trim();
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
      return {
        ok: false,
        input: String(input || ""),
        error: parsed.error || "invalid reference"
      };
    }
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
  } else if (numbers.length === 1) {
    chapter = numbers[0];
    verse = 1;
  } else {
    chapter = numbers[0];
    verse = numbers[1];
    combinedChapter = parseInt(String(numbers[0]) + (numbers[1] < 10 ? "0" : "") + String(numbers[1]), 10);
    if (!explicitVerse && !isValidVerse(bookIndex, chapter, verse) && isValidChapter(bookIndex, combinedChapter)) {
      chapter = combinedChapter;
      verse = 1;
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

  return {
    ok: true,
    chapter: chapter,
    verse: verse
  };
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
  var selectedPage = page > 0 ? page : cache.versePage[verse] || 1;
  selectedPage = clampPage(selectedPage, cache.pages.length);
  return {
    bookIndex: bookIndex,
    bookName: bookName(bookIndex),
    chapter: chapter,
    verse: verse || cache.pageFirstVerse[selectedPage] || 1,
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
      return getChapterPage(bookIndex, chapter, 0, cache.pages.length);
    }
    return getChapterPage(nextBook, nextChapter, 0, 1);
  }

  if (nextChapter > 1) {
    nextChapter -= 1;
  } else if (nextBook > 0) {
    nextBook -= 1;
    nextChapter = chapterCount(nextBook);
  } else {
    return getChapterPage(bookIndex, chapter, 0, 1);
  }
  cache = getChapterCache(nextBook, nextChapter);
  return getChapterPage(nextBook, nextChapter, 0, cache.pages.length);
}

function getChapterCache(bookIndex, chapter) {
  var key = String(bookIndex) + ":" + String(chapter);
  var verses;
  var pages = [];
  var pageFirstVerse = [];
  var versePage = [];
  var current = "";
  var index;

  if (pageCache[key]) {
    return pageCache[key];
  }

  verses = getChapterVerses(bookIndex, chapter);
  if (!verses) {
    pageCache[key] = {
      pages: [""],
      pageFirstVerse: [1, 1],
      versePage: [0, 1]
    };
    return pageCache[key];
  }

  for (index = 0; index < verses.length; index += 1) {
    current = appendVerseLine(pages, pageFirstVerse, versePage, current, index + 1, String(index + 1) + ". " + verses[index]);
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

  pageCache[key] = {
    pages: pages,
    pageFirstVerse: pageFirstVerse,
    versePage: versePage
  };
  return pageCache[key];
}

function appendVerseLine(pages, pageFirstVerse, versePage, current, verse, line) {
  var chunks;
  var chunkIndex;
  var candidate;

  if (line.length > PAGE_CHAR_LIMIT) {
    if (current) {
      pages.push(current);
      current = "";
    }
    chunks = splitLongLine(line, PAGE_CHAR_LIMIT);
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
  if (current && candidate.length > PAGE_CHAR_LIMIT) {
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

  for (index = 0; index < words.length; index += 1) {
    candidate = current ? current + " " + words[index] : words[index];
    if (current && candidate.length > maxLength) {
      chunks.push(current);
      current = words[index];
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
  isLoaded: isLoaded,
  loadState: loadState,
  lastLoadError: lastLoadError,
  loadFromBooks: loadFromBooks,
  loadFromJsonText: loadFromJsonText
};
