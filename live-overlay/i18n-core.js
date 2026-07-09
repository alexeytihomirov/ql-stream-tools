(function (global) {
  "use strict";

  function translate(stringsTable, lang, key, vars) {
    var bag = stringsTable[lang] || stringsTable.en;
    var text = bag[key] != null ? bag[key] : stringsTable.en[key] || key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        text = text.replace("{" + k + "}", String(vars[k]));
      });
    }
    return text;
  }

  global.QLI18nCore = { translate: translate };
})(typeof window !== "undefined" ? window : globalThis);
