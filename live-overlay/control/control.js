(function () {
  "use strict";

  var STORAGE_KEY = "ql-control-settings";
  var LEGACY_BASE_KEY = "ql-live-overlay-base";
  var SETTINGS_VERSION = 1;
  var DEFAULT_PUBLIC_DATA_BASE =
    "https://cdn.jsdelivr.net/gh/alexeytihomirov/ql-public-data@main";
  var MATCH_POLL_MS = 3000;
  var DEFAULT_OVERLAY_ASSETS =
    "https://cdn.jsdelivr.net/gh/alexeytihomirov/ql-stream-tools@main/live-overlay/";

  var settings = null;
  var tournaments = [];
  var tournamentMeta = null;
  var overlayLive = null;
  var matches = [];
  var pollTimer = null;
  var lang = "en";

  var els = {};

  function t(key, vars) {
    return QLControlI18n.t(lang, key, vars);
  }

  function trim(v) {
    return String(v || "").trim();
  }

  function normalizeSettings(raw) {
    var publicDataBase = trim(raw.publicDataBase || DEFAULT_PUBLIC_DATA_BASE).replace(
      /\/+$/,
      "",
    );
    var statsHubBase = trim(raw.statsHubBase || raw.base || "").replace(/\/+$/, "");
    var assetsBase = trim(raw.assetsBase || "").replace(/\/+$/, "");
    if (assetsBase && statsHubBase) {
      try {
        if (new URL(assetsBase).origin === new URL(statsHubBase).origin) {
          assetsBase = "";
        }
      } catch (_e0) {
        /* ignore */
      }
    }
    var tournamentSlug = trim(raw.tournamentSlug || "").toLowerCase();
    var defaultBg = trim(raw.defaultBg || "transparent") || "transparent";
    var pickedLang = trim(raw.lang || "en").toLowerCase();
    if (pickedLang !== "ru") pickedLang = "en";

    return {
      version: SETTINGS_VERSION,
      publicDataBase: publicDataBase,
      statsHubBase: statsHubBase,
      assetsBase: assetsBase,
      tournamentSlug: tournamentSlug,
      defaultBg: defaultBg,
      lang: pickedLang,
    };
  }

  function loadSettings() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return normalizeSettings(JSON.parse(stored));
      }
    } catch (_e) {
      /* ignore */
    }
    try {
      var legacyBase = localStorage.getItem(LEGACY_BASE_KEY);
      if (legacyBase) {
        return normalizeSettings({ statsHubBase: legacyBase });
      }
    } catch (_e2) {
      /* ignore */
    }
    return normalizeSettings({});
  }

  function saveSettings(next) {
    settings = normalizeSettings(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    try {
      if (settings.statsHubBase) {
        localStorage.setItem(LEGACY_BASE_KEY, settings.statsHubBase);
      }
    } catch (_e) {
      /* private mode */
    }
    lang = settings.lang;
    applyLangToDom();
    updateLangButtons();
  }

  function qsParam(name) {
    return new URLSearchParams(window.location.search).get(name) || "";
  }

  function mergeQueryIntoSettings() {
    var base = trim(qsParam("base"));
    var slug = trim(qsParam("tournament") || qsParam("slug"));
    var patch = {};
    if (base) patch.statsHubBase = base;
    if (slug) patch.tournamentSlug = slug.toLowerCase();
    if (Object.keys(patch).length) {
      saveSettings(Object.assign({}, settings, patch));
    }
  }

  function setStatus(text, kind) {
    if (!els.status) return;
    els.status.textContent = text || "";
    els.status.classList.remove("error", "ok");
    if (kind) els.status.classList.add(kind);
  }

  async function fetchPublicJson(url) {
    var res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function fetchStatsJson(path) {
    if (!settings.statsHubBase) throw new Error(t("errorMissingBase"));
    return fetchPublicJson(settings.statsHubBase + path);
  }

  function tournamentUrl(path) {
    return (
      settings.publicDataBase +
      "/tournaments/" +
      encodeURIComponent(settings.tournamentSlug) +
      "/" +
      path
    );
  }

  function connectForMatch(matchId) {
    if (!overlayLive || !Array.isArray(overlayLive.matches)) return null;
    var id = String(matchId);
    for (var i = 0; i < overlayLive.matches.length; i++) {
      var row = overlayLive.matches[i];
      if (String(row.match_id) === id && row.connect) {
        return row.connect;
      }
    }
    return null;
  }

  function tournamentName() {
    if (tournamentMeta && tournamentMeta.name) return tournamentMeta.name;
    for (var i = 0; i < tournaments.length; i++) {
      if (tournaments[i].slug === settings.tournamentSlug) {
        return tournaments[i].name || settings.tournamentSlug;
      }
    }
    return settings.tournamentSlug || "—";
  }

  function statusBadgeClass(rowOrStatus) {
    if (rowOrStatus && typeof rowOrStatus === "object") {
      var row = rowOrStatus;
      if (row.phase) {
        var phase = String(row.phase).toLowerCase();
        if (phase === "warmup") return "badge-warmup";
        if (phase === "playing") return "badge-live";
        if (phase === "ended") return "badge-ended";
      }
      if (row.warmup) return "badge-warmup";
      var rowStatus = String(row.status || "").toLowerCase();
      if (rowStatus === "live" || rowStatus === "active" || rowStatus === "in_progress") {
        return "badge-live";
      }
      if (rowStatus === "ended" || rowStatus === "aborted") return "badge-ended";
      return "badge-other";
    }
    var s = String(rowOrStatus || "").toLowerCase();
    if (s === "live" || s === "active" || s === "in_progress") return "badge-live";
    if (s === "ended" || s === "aborted") return "badge-ended";
    return "badge-other";
  }

  function matchPhaseLabel(row) {
    if (!row) return "—";
    if (row.phase === "warmup" || row.warmup) return t("phaseWarmup");
    if (row.phase === "ended" || String(row.status || "").toLowerCase() === "ended") {
      return t("phaseEnded");
    }
    return t("phaseLive");
  }

  function formatClockSec(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function computeMatchElapsedSec(row) {
    if (!row) return null;
    if (row.phase === "warmup" || row.warmup) return null;
    if (row.phase === "ended") return null;
    var now = Date.now();
    if (row.game_time_ms != null && row.game_time_ms > 0 && row.clock_at) {
      var at = Date.parse(row.clock_at);
      if (!isNaN(at)) {
        return Math.floor((row.game_time_ms + (now - at)) / 1000);
      }
      return Math.floor(row.game_time_ms / 1000);
    }
    if (row.elapsed_sec != null && row.clock_at) {
      var at2 = Date.parse(row.clock_at);
      if (!isNaN(at2)) {
        return row.elapsed_sec + Math.floor((now - at2) / 1000);
      }
      return row.elapsed_sec;
    }
    if (row.started_at) {
      var started = Date.parse(row.started_at);
      if (!isNaN(started)) {
        return Math.max(0, Math.floor((now - started) / 1000));
      }
    }
    return null;
  }

  function buildUrl(relativePath, params) {
    var url = new URL(relativePath, window.location.href);
    var search = new URLSearchParams(params || {});
    url.search = search.toString();
    return url.href;
  }

  function effectiveAssetsBase() {
    if (settings && settings.assetsBase) {
      var candidate = String(settings.assetsBase).replace(/\/+$/, "");
      if (settings.statsHubBase) {
        try {
          if (new URL(candidate).origin === new URL(settings.statsHubBase).origin) {
            candidate = "";
          }
        } catch (_e) {
          /* ignore */
        }
      }
      if (candidate) return candidate;
    }
    try {
      var loc = window.location;
      if (loc.pathname && loc.pathname.indexOf("/live-overlay/") >= 0) {
        var idx = loc.pathname.indexOf("/live-overlay/");
        return loc.origin + loc.pathname.slice(0, idx + "/live-overlay".length);
      }
      if (loc.port === "8787") {
        return loc.origin + "/live-overlay";
      }
    } catch (_e2) {
      /* ignore */
    }
    return DEFAULT_OVERLAY_ASSETS.replace(/\/+$/, "");
  }

  function overlayQueryParams(matchId) {
    var params = {};
    if (settings.statsHubBase) params.base = settings.statsHubBase;
    params.assets = effectiveAssetsBase();
    if (matchId) params.match = matchId;
    if (settings.defaultBg && settings.defaultBg !== "transparent") {
      params.bg = settings.defaultBg;
    }
    return params;
  }

  function liveOverlayUrl(page, matchId, extra) {
    var params = overlayQueryParams(matchId);
    if (extra) {
      Object.keys(extra).forEach(function (k) {
        if (extra[k] != null && extra[k] !== "") params[k] = extra[k];
      });
    }
    var file = page.indexOf(".html") >= 0 ? page : page + ".html";
    return buildUrl("../" + file, params);
  }

  function streamOverlayUrl() {
    return buildUrl("../../stream-overlay/index.html", {});
  }

  function docsUrl() {
    return buildUrl("../../stream-overlay/docs.html", {});
  }

  function playerGuideUrl() {
    return buildUrl("../../player-guide/index.html", {});
  }

  function openWindow(url, name) {
    window.open(url, name || "_blank", "noopener,noreferrer,width=960,height=720");
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_e) {
      return false;
    }
  }

  function renderTournamentSelect() {
    if (!els.tournamentSelect) return;
    var prev = els.tournamentSelect.value;
    els.tournamentSelect.innerHTML = "";

    var empty = document.createElement("option");
    empty.value = "";
    empty.textContent = tournaments.length ? "—" : t("tournamentEmpty");
    els.tournamentSelect.appendChild(empty);

    for (var i = 0; i < tournaments.length; i++) {
      var row = tournaments[i];
      var opt = document.createElement("option");
      opt.value = row.slug;
      opt.textContent = (row.name || row.slug) + " (" + row.slug + ")";
      els.tournamentSelect.appendChild(opt);
    }

    if (prev && els.tournamentSelect.querySelector('option[value="' + prev + '"]')) {
      els.tournamentSelect.value = prev;
    } else if (
      settings.tournamentSlug &&
      els.tournamentSelect.querySelector(
        'option[value="' + settings.tournamentSlug + '"]',
      )
    ) {
      els.tournamentSelect.value = settings.tournamentSlug;
    }
  }

  function renderTournamentMeta() {
    if (!els.tournamentMeta) return;
    if (!settings.tournamentSlug) {
      els.tournamentMeta.innerHTML =
        '<p class="control-field-hint">' + escapeHtml(t("tournamentEmpty")) + "</p>";
      return;
    }
    var name = tournamentName();
    var status = tournamentMeta && tournamentMeta.status ? tournamentMeta.status : "";
    var html =
      '<div class="tournament-meta-name">' +
      escapeHtml(name) +
      "</div>" +
      '<div class="tournament-meta-slug">' +
      escapeHtml(settings.tournamentSlug) +
      "</div>";
    if (status) {
      html +=
        ' <span class="badge ' +
        statusBadgeClass(status) +
        '">' +
        escapeHtml(status) +
        "</span>";
    }
    els.tournamentMeta.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderMatches() {
    if (!els.matchesBody) return;
    els.matchesBody.innerHTML = "";

    if (!matches.length) {
      var tr = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 5;
      td.textContent = t("matchesEmpty");
      td.className = "control-field-hint";
      tr.appendChild(td);
      els.matchesBody.appendChild(tr);
      return;
    }

    for (var i = 0; i < matches.length; i++) {
      var row = matches[i];
      var mid = row.match_id || "";
      var connect = connectForMatch(mid);
      var tr2 = document.createElement("tr");

      var scoreCell = document.createElement("td");
      scoreCell.innerHTML =
        "<strong>" +
        escapeHtml(row.score_summary || mid) +
        "</strong>" +
        (connect
          ? '<div class="match-id">/connect ' + escapeHtml(connect) + "</div>"
          : "") +
        '<div class="match-id">' +
        escapeHtml(mid) +
        "</div>";

      var mapCell = document.createElement("td");
      mapCell.textContent = [row.map_name, row.gametype].filter(Boolean).join(" · ") || "—";

      var statusCell = document.createElement("td");
      var badge = document.createElement("span");
      badge.className = "badge " + statusBadgeClass(row);
      badge.textContent = matchPhaseLabel(row);
      statusCell.appendChild(badge);
      var elapsed = computeMatchElapsedSec(row);
      if (elapsed != null) {
        var clock = document.createElement("span");
        clock.className = "match-clock";
        clock.textContent = formatClockSec(elapsed);
        statusCell.appendChild(clock);
      }

      var serverCell = document.createElement("td");
      serverCell.textContent = row.server_name || "—";

      var actionsCell = document.createElement("td");
      var actions = document.createElement("div");
      actions.className = "match-actions";

      actions.appendChild(
        makeActionBtn(t("openMatch"), function () {
          openWindow(liveOverlayUrl("match", mid, { mode: "operator" }), "ql-match-" + mid);
        }),
      );
      actions.appendChild(
        makeActionBtn(t("openScoreboard"), function () {
          openWindow(liveOverlayUrl("scoreboard", mid), "ql-scoreboard-" + mid);
        }),
      );
      actions.appendChild(
        makeActionBtn(t("openMap"), function () {
          openWindow(liveOverlayUrl("map", mid), "ql-map-" + mid);
        }),
      );
      actions.appendChild(
        makeActionBtn(t("copyUrl"), function () {
          copyText(liveOverlayUrl("scoreboard", mid)).then(function (ok) {
            if (ok) setStatus(t("copied"), "ok");
          });
        }),
      );
      actionsCell.appendChild(actions);

      tr2.appendChild(scoreCell);
      tr2.appendChild(mapCell);
      tr2.appendChild(statusCell);
      tr2.appendChild(serverCell);
      tr2.appendChild(actionsCell);
      els.matchesBody.appendChild(tr2);
    }
  }

  function makeActionBtn(label, onClick) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "control-btn control-btn-sm";
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function bindOverlayCard(rootId, page, needsMatch) {
    var root = document.getElementById(rootId);
    if (!root) return;
    var openBtn = root.querySelector("[data-action=open]");
    var windowBtn = root.querySelector("[data-action=window]");
    var copyBtn = root.querySelector("[data-action=copy]");

    function urlForMatch() {
      var sel = els.defaultMatchSelect && els.defaultMatchSelect.value;
      var extra = null;
      if (page === "matches") {
        extra = { mode: "overlay", layout: "cards" };
      }
      return liveOverlayUrl(page, needsMatch ? sel || undefined : undefined, extra);
    }

    if (openBtn) {
      openBtn.addEventListener("click", function () {
        openWindow(urlForMatch(), "ql-" + page);
      });
    }
    if (windowBtn) {
      windowBtn.addEventListener("click", function () {
        openWindow(urlForMatch(), "ql-" + page + "-win");
      });
    }
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        copyText(urlForMatch()).then(function (ok) {
          if (ok) setStatus(t("copied"), "ok");
        });
      });
    }
  }

  function renderDefaultMatchSelect() {
    if (!els.defaultMatchSelect) return;
    var prev = els.defaultMatchSelect.value;
    els.defaultMatchSelect.innerHTML = "";
    var auto = document.createElement("option");
    auto.value = "";
    auto.textContent = matches.length ? t("defaultMatchAuto") : t("matchesEmpty");
    els.defaultMatchSelect.appendChild(auto);
    for (var i = 0; i < matches.length; i++) {
      var row = matches[i];
      var opt = document.createElement("option");
      opt.value = row.match_id;
      opt.textContent =
        (row.score_summary || row.match_id) +
        (row.map_name ? " · " + row.map_name : "");
      els.defaultMatchSelect.appendChild(opt);
    }
    if (prev && els.defaultMatchSelect.querySelector('option[value="' + prev + '"]')) {
      els.defaultMatchSelect.value = prev;
    }
  }

  async function loadTournaments() {
    if (!settings.publicDataBase) {
      tournaments = [];
      renderTournamentSelect();
      return;
    }
    try {
      var index = await fetchPublicJson(settings.publicDataBase + "/index.json");
      tournaments = Array.isArray(index.tournaments) ? index.tournaments : [];
      if (
        settings.tournamentSlug &&
        !tournaments.some(function (x) {
          return x.slug === settings.tournamentSlug;
        })
      ) {
        tournaments.unshift({
          slug: settings.tournamentSlug,
          name: settings.tournamentSlug,
          status: "unknown",
        });
      }
      renderTournamentSelect();
    } catch (err) {
      tournaments = [];
      renderTournamentSelect();
      throw err;
    }
  }

  async function loadTournamentMeta() {
    tournamentMeta = null;
    overlayLive = null;
    if (!settings.tournamentSlug || !settings.publicDataBase) {
      renderTournamentMeta();
      return;
    }
    try {
      tournamentMeta = await fetchPublicJson(tournamentUrl("meta.json"));
    } catch (_e) {
      tournamentMeta = null;
    }
    try {
      overlayLive = await fetchPublicJson(tournamentUrl("overlay-live.json"));
    } catch (_e2) {
      overlayLive = null;
    }
    renderTournamentMeta();
  }

  async function probeStatsHub() {
    if (!settings.statsHubBase) return false;
    try {
      var health = await fetchStatsJson("/api/health");
      return health && health.ok === true;
    } catch (_e) {
      return false;
    }
  }

  async function refreshMatches() {
    if (!settings.statsHubBase) {
      matches = [];
      renderMatches();
      renderDefaultMatchSelect();
      setStatus(t("errorMissingBase"), "error");
      return;
    }
    try {
      matches = await fetchStatsJson("/api/stream/matches");
      if (!Array.isArray(matches)) matches = [];
      if (!matches.length) {
        var all = await fetchStatsJson("/api/matches");
        if (Array.isArray(all)) {
          matches = all.filter(function (m) {
            return String(m.status || "").toLowerCase() === "live";
          });
        }
      }
      renderMatches();
      renderDefaultMatchSelect();
      var ok = await probeStatsHub();
      setStatus(
        t("matchesCount", { n: matches.length }) +
          " · " +
          (ok ? t("healthOk") : t("healthFail")),
        ok ? "ok" : "",
      );
    } catch (err) {
      matches = [];
      renderMatches();
      renderDefaultMatchSelect();
      setStatus(t("errorFetchMatches") + ": " + (err.message || err), "error");
    }
  }

  async function refreshAll() {
    if (!settings.publicDataBase) {
      setStatus(t("errorMissingPublic"), "error");
      return;
    }
    try {
      await loadTournaments();
      await loadTournamentMeta();
      await refreshMatches();
    } catch (err) {
      setStatus(t("errorFetchTournaments") + ": " + (err.message || err), "error");
    }
  }

  function readForm() {
    return {
      publicDataBase: trim(els.publicDataBase && els.publicDataBase.value),
      statsHubBase: trim(els.statsHubBase && els.statsHubBase.value),
      assetsBase: trim(els.assetsBase && els.assetsBase.value),
      tournamentSlug: trim(els.tournamentSelect && els.tournamentSelect.value).toLowerCase(),
      defaultBg: trim(els.defaultBg && els.defaultBg.value) || "transparent",
      lang: lang,
    };
  }

  function fillForm() {
    if (els.publicDataBase) els.publicDataBase.value = settings.publicDataBase;
    if (els.statsHubBase) els.statsHubBase.value = settings.statsHubBase;
    if (els.assetsBase) els.assetsBase.value = settings.assetsBase;
    if (els.defaultBg) els.defaultBg.value = settings.defaultBg || "transparent";
    if (els.previewBg) els.previewBg.value = settings.defaultBg || "transparent";
    if (els.tournamentSelect) els.tournamentSelect.value = settings.tournamentSlug || "";
  }

  function applyLangToDom() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(function (node) {
      var key = node.getAttribute("data-i18n");
      if (key) node.textContent = t(key);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (node) {
      var key = node.getAttribute("data-i18n-placeholder");
      if (key) node.setAttribute("placeholder", t(key));
    });
    if (els.defaultBg) {
      var opts = els.defaultBg.options;
      for (var o = 0; o < opts.length; o++) {
        var ok = opts[o].getAttribute("data-i18n");
        if (ok) opts[o].textContent = t(ok);
      }
    }
    if (els.pageTitle) document.title = t("pageTitle");
    renderTournamentMeta();
    renderMatches();
    renderDefaultMatchSelect();
  }

  function updateLangButtons() {
    document.querySelectorAll("[data-lang]").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-lang") === lang);
    });
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(refreshMatches, MATCH_POLL_MS);
  }

  function onSave(ev) {
    if (ev) ev.preventDefault();
    saveSettings(readForm());
    refreshAll();
    startPolling();
  }

  function bindPreview() {
    if (!els.previewFrame || !els.previewSelect) return;

    function previewBgClass(mode) {
      var wrap = document.getElementById("preview-frame-wrap");
      if (!wrap) return;
      wrap.classList.remove(
        "preview-bg-transparent",
        "preview-bg-chroma",
        "preview-bg-checkerboard",
      );
      if (mode === "chroma") wrap.classList.add("preview-bg-chroma");
      else if (mode === "checkerboard") wrap.classList.add("preview-bg-checkerboard");
      else wrap.classList.add("preview-bg-transparent");
    }

    function refreshPreview() {
      var kind = els.previewSelect.value;
      var matchId = els.defaultMatchSelect && els.defaultMatchSelect.value;
      var bg =
        (els.previewBg && els.previewBg.value) || settings.defaultBg || "transparent";
      var scale = els.previewScale ? Number(els.previewScale.value) || 70 : 70;
      previewBgClass(bg);
      if (els.previewFrameWrap) {
        els.previewFrameWrap.style.transform = "scale(" + scale / 100 + ")";
      }

      var params = overlayQueryParams(matchId || undefined);
      params.bg = bg;
      var url;
      if (kind === "scoreboard") url = buildUrl("../scoreboard.html", params);
      else if (kind === "map") url = buildUrl("../map.html", params);
      else if (kind === "matches") {
        params.mode = "overlay";
        params.layout = "cards";
        url = buildUrl("../matches.html", params);
      } else if (kind === "matches-compact") {
        params.mode = "overlay";
        params.layout = "compact";
        url = buildUrl("../matches.html", params);
      } else {
        url = buildUrl("../../stream-overlay/index.html", { bg: bg });
      }
      els.previewFrame.src = url;
    }

    ["change", "input"].forEach(function (ev) {
      if (els.previewSelect) els.previewSelect.addEventListener(ev, refreshPreview);
      if (els.previewBg) els.previewBg.addEventListener(ev, refreshPreview);
      if (els.previewScale) els.previewScale.addEventListener(ev, refreshPreview);
    });
    if (els.previewRefresh) {
      els.previewRefresh.addEventListener("click", refreshPreview);
    }
    refreshPreview();
  }

  function bindMatchesOperatorLink() {
    var btn = document.getElementById("open-matches-operator");
    if (!btn) return;
    btn.addEventListener("click", function () {
      openWindow(
        liveOverlayUrl("matches", undefined, { mode: "operator", layout: "cards" }),
        "ql-matches-operator",
      );
    });
  }

  function bindPopupCard() {
    var root = document.getElementById("overlay-popup");
    if (!root) return;
    var setupBtn = root.querySelector("[data-action=setup]");
    var openBtn = root.querySelector("[data-action=open]");
    if (setupBtn) {
      setupBtn.addEventListener("click", function () {
        openWindow(streamOverlayUrl(), "ql-stream-popup-setup");
      });
    }
    if (openBtn) {
      openBtn.addEventListener("click", function () {
        openWindow(streamOverlayUrl(), "ql-stream-popup");
      });
    }
  }

  function bindLinks() {
    var docs = document.getElementById("link-docs");
    var guide = document.getElementById("link-player-guide");
    if (docs) {
      docs.addEventListener("click", function (ev) {
        ev.preventDefault();
        openWindow(docsUrl(), "ql-docs");
      });
    }
    if (guide) {
      guide.addEventListener("click", function (ev) {
        ev.preventDefault();
        openWindow(playerGuideUrl(), "ql-player-guide");
      });
    }
  }

  function init() {
    els = {
      form: document.getElementById("control-form"),
      publicDataBase: document.getElementById("public-data-base"),
      statsHubBase: document.getElementById("stats-hub-base"),
      assetsBase: document.getElementById("assets-base"),
      tournamentSelect: document.getElementById("tournament-select"),
      defaultBg: document.getElementById("default-bg"),
      tournamentMeta: document.getElementById("tournament-meta"),
      matchesBody: document.getElementById("matches-body"),
      defaultMatchSelect: document.getElementById("default-match"),
      previewSelect: document.getElementById("preview-select"),
      previewBg: document.getElementById("preview-bg"),
      previewScale: document.getElementById("preview-scale"),
      previewFrame: document.getElementById("preview-frame"),
      previewFrameWrap: document.getElementById("preview-frame-inner"),
      previewRefresh: document.getElementById("preview-refresh"),
      status: document.getElementById("control-status"),
      pageTitle: document.querySelector(".control-title"),
    };

    settings = loadSettings();
    lang = settings.lang;
    fillForm();
    applyLangToDom();
    updateLangButtons();
    mergeQueryIntoSettings();
    fillForm();

    if (els.form) els.form.addEventListener("submit", onSave);

    document.querySelectorAll("[data-lang]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        lang = btn.getAttribute("data-lang") || "en";
        saveSettings(Object.assign({}, settings, { lang: lang }));
        applyLangToDom();
        updateLangButtons();
      });
    });

    if (els.tournamentSelect) {
      els.tournamentSelect.addEventListener("change", function () {
        settings.tournamentSlug = trim(els.tournamentSelect.value).toLowerCase();
        loadTournamentMeta();
      });
    }

    bindOverlayCard("overlay-scoreboard", "scoreboard", true);
    bindOverlayCard("overlay-map", "map", true);
    bindOverlayCard("overlay-matches", "matches", false);
    bindPopupCard();
    bindLinks();
    bindPreview();
    bindMatchesOperatorLink();

    refreshAll();
    startPolling();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
