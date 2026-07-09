(function (global) {
  "use strict";

  function readJsonKeys(keys) {
    for (var i = 0; i < keys.length; i++) {
      try {
        var raw = localStorage.getItem(keys[i]);
        if (raw) return JSON.parse(raw);
      } catch (_e) {
        /* ignore parse/private-mode errors */
      }
    }
    return null;
  }

  function readField(keys, field, fallback) {
    var obj = readJsonKeys(keys);
    return obj && obj[field] != null ? obj[field] : fallback;
  }

  global.QLSettingsStore = { readJsonKeys: readJsonKeys, readField: readField };
})(typeof window !== "undefined" ? window : globalThis);
