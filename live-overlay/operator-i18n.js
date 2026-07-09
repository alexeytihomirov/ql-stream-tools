(function (global) {
  "use strict";

  var STRINGS = {
    en: {
      all: "All",
      live: "Live",
      ended: "Ended",
      layoutCards: "Cards",
      layoutCompact: "Compact ticker",
      filterStatus: "Status",
      filterGametype: "Gametype",
      anyGametype: "Any gametype",
      openControl: "Control panel",
      openMatch: "Match page",
      noMatches: "No matches",
      scoreboard: "Scoreboard",
      map: "Map",
      replay: "Replay",
      copyUrl: "Copy URL",
      copied: "Copied",
      backMatches: "All matches",
      backControl: "Control",
      connect: "Connect",
      players: "Players",
      actions: "Actions",
      debugCalib: "Map calibration",
      tournament: "Tournament",
      loading: "Loading…",
      matchNotFound: "Match not found",
      phaseWarmup: "Warmup",
      phaseLive: "Live",
      phaseEnded: "Ended",
    },
    ru: {
      all: "Все",
      live: "Live",
      ended: "Завершённые",
      layoutCards: "Карточки",
      layoutCompact: "Компактный ticker",
      filterStatus: "Статус",
      filterGametype: "Gametype",
      anyGametype: "Любой gametype",
      openControl: "Control panel",
      openMatch: "Страница матча",
      noMatches: "Нет матчей",
      scoreboard: "Табло",
      map: "Карта",
      replay: "Replay",
      copyUrl: "Copy URL",
      copied: "Скопировано",
      backMatches: "Все матчи",
      backControl: "Control",
      connect: "Connect",
      players: "Игроки",
      actions: "Действия",
      debugCalib: "Калибровка карты",
      tournament: "Турнир",
      loading: "Загрузка…",
      matchNotFound: "Матч не найден",
      phaseWarmup: "Warmup",
      phaseLive: "Live",
      phaseEnded: "Завершён",
    },
  };

  function operatorLang() {
    var lang = global.QLSettingsStore.readField(["ql-control-settings"], "lang", null);
    if (lang === "ru") return "ru";
    var q = new URLSearchParams(window.location.search).get("lang");
    return q === "ru" ? "ru" : "en";
  }

  function ot(key, vars) {
    return global.QLI18nCore.translate(STRINGS, operatorLang(), key, vars);
  }

  global.QLOperatorI18n = { t: ot, lang: operatorLang };
})(typeof window !== "undefined" ? window : globalThis);
