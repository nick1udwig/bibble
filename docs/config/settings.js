(function(root, factory) {
  "use strict";

  var api = factory();

  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.BibbleSettings = api;
  }
}(typeof self !== "undefined" ? self : this, function() {
  "use strict";

  var STORAGE_KEY = "bibble.settings.v1";
  var CONFIG_PAGE_URL = "https://nick1udwig.github.io/bibble/config/";
  var FONT_SIZE_NORMAL = "normal";
  var FONT_SIZE_LARGE = "large";
  var PAGE_CHAR_LIMIT_NORMAL = 360;
  // Moving from Gothic 14 to 18 reduces usable line and column capacity together.
  // 220 keeps each logical page at roughly the same rendered height as the 360-character profile.
  var PAGE_CHAR_LIMIT_LARGE = 220;

  function normalizeFontSize(value) {
    return value === FONT_SIZE_LARGE || value === 18 || value === "18"
      ? FONT_SIZE_LARGE
      : FONT_SIZE_NORMAL;
  }

  function normalizeSettings(value) {
    var source = value && typeof value === "object" ? value : {};

    return {
      fontSize: normalizeFontSize(source.fontSize)
    };
  }

  function resolveStorage(storage) {
    if (storage) {
      return storage;
    }
    try {
      if (typeof localStorage !== "undefined" && localStorage) {
        return localStorage;
      }
    } catch (_) {
    }
    return null;
  }

  function loadSettings(storage) {
    var target = resolveStorage(storage);
    var raw;

    if (!target || typeof target.getItem !== "function") {
      return normalizeSettings(null);
    }
    try {
      raw = target.getItem(STORAGE_KEY);
      return normalizeSettings(raw ? JSON.parse(raw) : null);
    } catch (_) {
      return normalizeSettings(null);
    }
  }

  function saveSettings(settings, storage) {
    var normalized = normalizeSettings(settings);
    var target = resolveStorage(storage);

    if (!target || typeof target.setItem !== "function") {
      return normalized;
    }
    try {
      target.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch (_) {
    }
    return normalized;
  }

  function pageCharLimit(fontSize) {
    return normalizeFontSize(fontSize) === FONT_SIZE_LARGE
      ? PAGE_CHAR_LIMIT_LARGE
      : PAGE_CHAR_LIMIT_NORMAL;
  }

  function buildConfigPageUrl(baseUrl, settings, cacheBust) {
    var separator = String(baseUrl || "").indexOf("?") >= 0 ? "&" : "?";
    var encodedState = encodeURIComponent(JSON.stringify(normalizeSettings(settings)));
    var version = cacheBust == null ? Date.now() : cacheBust;

    return String(baseUrl || "") + separator + "state=" + encodedState +
      "&v=" + encodeURIComponent(String(version));
  }

  function parseJsonValue(rawValue) {
    if (!rawValue) {
      return null;
    }
    try {
      return JSON.parse(decodeURIComponent(String(rawValue)));
    } catch (_) {
      try {
        return JSON.parse(String(rawValue));
      } catch (_) {
        return null;
      }
    }
  }

  function parseConfigPageResponse(response) {
    var parsed;

    if (!response || response === "CANCELLED") {
      return null;
    }
    if (typeof response === "object") {
      if (response.fontSize !== undefined) {
        return normalizeSettings(response);
      }
      if (response.response !== undefined && response.response !== null) {
        return parseConfigPageResponse(response.response);
      }
      return null;
    }

    parsed = parseJsonValue(response);
    return parsed && parsed.fontSize !== undefined ? normalizeSettings(parsed) : null;
  }

  function readConfigPageState(search) {
    var query = String(search || "");
    var parts;
    var index;
    var keyValue;
    var key;
    var parsed;

    if (query.indexOf("?") === 0) {
      query = query.slice(1);
    }
    if (!query) {
      return null;
    }

    parts = query.split("&");
    for (index = 0; index < parts.length; index += 1) {
      keyValue = parts[index].split("=");
      key = decodeURIComponent(keyValue[0] || "");
      if (key === "state") {
        parsed = parseJsonValue(keyValue.slice(1).join("="));
        return parsed ? normalizeSettings(parsed) : null;
      }
    }
    return null;
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    CONFIG_PAGE_URL: CONFIG_PAGE_URL,
    FONT_SIZE_NORMAL: FONT_SIZE_NORMAL,
    FONT_SIZE_LARGE: FONT_SIZE_LARGE,
    PAGE_CHAR_LIMIT_NORMAL: PAGE_CHAR_LIMIT_NORMAL,
    PAGE_CHAR_LIMIT_LARGE: PAGE_CHAR_LIMIT_LARGE,
    normalizeFontSize: normalizeFontSize,
    normalizeSettings: normalizeSettings,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    pageCharLimit: pageCharLimit,
    buildConfigPageUrl: buildConfigPageUrl,
    parseConfigPageResponse: parseConfigPageResponse,
    readConfigPageState: readConfigPageState
  };
}));
