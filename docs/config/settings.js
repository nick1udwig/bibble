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
  var FONT_SIZE_14 = "14";
  var FONT_SIZE_18 = "18";
  var FONT_SIZE_24 = "24";
  // Bold faces are slightly wider, so each of the six profiles gets its own
  // conservative page budget. Profile-keyed caching makes subsequent switches cheap.
  var PAGE_CHAR_LIMITS = {
    "14r": 360,
    "14b": 330,
    "18r": 220,
    "18b": 200,
    "24r": 150,
    "24b": 135
  };

  function normalizeFontSize(value) {
    if (value === FONT_SIZE_24 || value === 24) {
      return FONT_SIZE_24;
    }
    if (value === FONT_SIZE_18 || value === 18 || value === "large") {
      return FONT_SIZE_18;
    }
    return FONT_SIZE_14;
  }

  function normalizeBold(value, legacyFontSize) {
    if (value === undefined || value === null) {
      return legacyFontSize === "large";
    }
    return value === true || value === 1 || value === "1" || value === "true" ||
      value === "bold" || value === "yes";
  }

  function normalizeSettings(value) {
    var source = value && typeof value === "object" ? value : {};
    var boldValue = source.bold !== undefined ? source.bold : source.fontBold;

    return {
      fontSize: normalizeFontSize(source.fontSize),
      bold: normalizeBold(boldValue, source.fontSize)
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

  function profileKey(value, bold) {
    var normalized = value && typeof value === "object"
      ? normalizeSettings(value)
      : normalizeSettings({ fontSize: value, bold: bold });

    return normalized.fontSize + (normalized.bold ? "b" : "r");
  }

  function pageCharLimit(value, bold) {
    return PAGE_CHAR_LIMITS[profileKey(value, bold)];
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
      if (response.fontSize !== undefined || response.bold !== undefined ||
          response.fontBold !== undefined) {
        return normalizeSettings(response);
      }
      if (response.response !== undefined && response.response !== null) {
        return parseConfigPageResponse(response.response);
      }
      return null;
    }

    parsed = parseJsonValue(response);
    return parsed && (parsed.fontSize !== undefined || parsed.bold !== undefined ||
      parsed.fontBold !== undefined) ? normalizeSettings(parsed) : null;
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
    FONT_SIZE_14: FONT_SIZE_14,
    FONT_SIZE_18: FONT_SIZE_18,
    FONT_SIZE_24: FONT_SIZE_24,
    PAGE_CHAR_LIMITS: PAGE_CHAR_LIMITS,
    normalizeFontSize: normalizeFontSize,
    normalizeBold: normalizeBold,
    normalizeSettings: normalizeSettings,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    profileKey: profileKey,
    pageCharLimit: pageCharLimit,
    buildConfigPageUrl: buildConfigPageUrl,
    parseConfigPageResponse: parseConfigPageResponse,
    readConfigPageState: readConfigPageState
  };
}));
