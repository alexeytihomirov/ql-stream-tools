(function (global) {
  "use strict";

  // Operator VPS / QL server labels (e.g. "EU Germany 1", "FI Helsinki").
  var LABEL_ALIASES = {
    germany: "DE",
    deutschland: "DE",
    finland: "FI",
    suomi: "FI",
    netherlands: "NL",
    holland: "NL",
    france: "FR",
    sweden: "SE",
    norway: "NO",
    poland: "PL",
    austria: "AT",
    switzerland: "CH",
    spain: "ES",
    italy: "IT",
    belgium: "BE",
    denmark: "DK",
    ireland: "IE",
    "united kingdom": "GB",
    uk: "GB",
    "united states": "US",
    "united states of america": "US",
    usa: "US",
    canada: "CA",
    australia: "AU",
    singapore: "SG",
    japan: "JP",
    brazil: "BR",
    india: "IN",
    russia: "RU",
    "россия": "RU",
    ukraine: "UA",
    "украина": "UA",
    kazakhstan: "KZ",
    "казахстан": "KZ",
  };

  function normalizeCountryCode(code) {
    var u = String(code || "")
      .trim()
      .toUpperCase();
    if (!u) return "";
    if (u === "EU") return "EU";
    if (/^[A-Z]{2}$/.test(u)) return u;
    return "";
  }

  function countryFlagEmoji(code) {
    var c = normalizeCountryCode(code);
    if (!c) return "";
    try {
      return String.fromCodePoint.apply(
        String,
        c.split("").map(function (ch) {
          return 0x1f1e6 + ch.charCodeAt(0) - 65;
        }),
      );
    } catch (_e) {
      return "";
    }
  }

  /** ISO alpha-2 (or EU) from host/server label — mirrors ql-hub hostCountryCode. */
  function countryCodeFromLabel(label) {
    var text = String(label || "").trim();
    if (!text) return "";
    var direct = normalizeCountryCode(text);
    if (direct) return direct;

    var tokens = text.split(/[\s,/|–—-]+/).filter(Boolean);
    var regionCode = "";
    var countryCode = "";
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      if (/^\d+$/.test(tok)) continue;
      var norm = normalizeCountryCode(tok);
      if (!norm) continue;
      if (norm === "EU") regionCode = "EU";
      else countryCode = norm;
    }
    if (countryCode) return countryCode;

    var labelKey = text.toLowerCase().replace(/\s+/g, " ");
    if (LABEL_ALIASES[labelKey]) return LABEL_ALIASES[labelKey];

    for (var j = tokens.length - 1; j >= 0; j--) {
      var key = tokens[j].toLowerCase();
      if (LABEL_ALIASES[key]) return LABEL_ALIASES[key];
    }

    for (var name in LABEL_ALIASES) {
      if (name.length >= 4 && labelKey.indexOf(name) >= 0) return LABEL_ALIASES[name];
    }

    if (regionCode) return regionCode;

    var last = tokens[tokens.length - 1];
    if (last && /^[A-Za-z]{2,3}$/.test(last)) {
      return normalizeCountryCode(last.slice(0, 2));
    }
    return "";
  }

  global.QLDashboardCountries = {
    normalizeCountryCode: normalizeCountryCode,
    countryFlagEmoji: countryFlagEmoji,
    countryCodeFromLabel: countryCodeFromLabel,
  };
})(typeof window !== "undefined" ? window : globalThis);
