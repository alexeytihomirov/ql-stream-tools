(function (global) {
  "use strict";

  var STORAGE_KEY = "ql-dashboard-settings";
  var LEGACY_STORAGE_KEY = "ql-control-settings";
  var LEGACY_BASE_KEY = "ql-live-overlay-base";
  var SETTINGS_VERSION = 2;
  var DEFAULT_PUBLIC_DATA_BASE =
    "https://cdn.jsdelivr.net/gh/alexeytihomirov/ql-public-data@main";
  var MATCH_POLL_MS = 3000;
  var OVERLAYS_POLL_MS = 15000;
  var PREVIEW_POLL_MS = 10000;
  var HEALTH_PROBE_EVERY = 10;
  var DEFAULT_OVERLAY_ASSETS =
    "https://cdn.jsdelivr.net/gh/alexeytihomirov/ql-stream-tools@main/live-overlay/";

  var settings = null;
  var lang = "en";
  var tournaments = [];
  var tournamentMeta = null;
  var overlayLive = null;
  var matches = [];
  var pollTimer = null;
  var pollHealthTick = 0;
  var views = {};
  var currentView = null;
  var statusCallback = null;

  function t(key, vars) {
    return QLDashboardI18n.t(lang, key, vars);
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
    var defaultMatchId = trim(raw.defaultMatchId || "");
    var pickedLang = trim(raw.lang || "en").toLowerCase();
    if (pickedLang !== "ru") pickedLang = "en";

    return {
      version: SETTINGS_VERSION,
      publicDataBase: publicDataBase,
      statsHubBase: statsHubBase,
      assetsBase: assetsBase,
      statsHubApiToken: trim(raw.statsHubApiToken || ""),
      tournamentSlug: tournamentSlug,
      defaultBg: defaultBg,
      defaultMatchId: defaultMatchId,
      lang: pickedLang,
    };
  }

  function loadSettings() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return normalizeSettings(JSON.parse(stored));
    } catch (_e) {
      /* ignore */
    }
    try {
      var legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) return normalizeSettings(JSON.parse(legacy));
    } catch (_e2) {
      /* ignore */
    }
    try {
      var legacyBase = localStorage.getItem(LEGACY_BASE_KEY);
      if (legacyBase) return normalizeSettings({ statsHubBase: legacyBase });
    } catch (_e3) {
      /* ignore */
    }
    return normalizeSettings({});
  }

  function saveSettings(next, opts) {
    var prevLang = lang;
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
    updateLangButtons();
    document.documentElement.lang = lang;
    if (opts && opts.silent) return;
    if (lang !== prevLang) {
      applyLangToDom();
    }
  }

  function patchSettings(patch, opts) {
    saveSettings(Object.assign({}, settings, patch), opts);
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

  function mergeQueryMatchRoute() {
    var match = trim(qsParam("match"));
    if (!match) return;
    var hash = location.hash || "";
    if (/#\/(?:server|match)\//.test(hash)) return;
    navigate("#/server/" + encodeURIComponent(match));
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function hasStatsApiToken() {
    return !!trim(settings.statsHubApiToken);
  }

  async function deleteStatsResult(recordingId) {
    if (!settings.statsHubBase) throw new Error(t("errorMissingBase"));
    if (!hasStatsApiToken()) throw new Error(t("errorMissingApiToken"));
    var res = await fetch(
      settings.statsHubBase + "/api/stream/results/" + encodeURIComponent(recordingId),
      {
        method: "DELETE",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer " + trim(settings.statsHubApiToken),
        },
      },
    );
    if (!res.ok) {
      var detail = "HTTP " + res.status;
      try {
        var body = await res.json();
        if (body && body.detail) detail = String(body.detail);
      } catch (_e) {
        /* ignore */
      }
      throw new Error(detail);
    }
    return res.json();
  }

  async function fetchArchiveSummary(matchId) {
    if (!settings.statsHubBase || !matchId) return null;
    try {
      return await fetchStatsJson(
        "/api/stream/matches/" + encodeURIComponent(matchId) + "/archive-summary",
      );
    } catch (_e) {
      return null;
    }
  }

  function debugMode() {
    var v = String(qsParam("debug") || "").toLowerCase();
    return v === "1" || v === "true" || v === "on";
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
      if (String(row.match_id) === id && row.connect) return row.connect;
    }
    return null;
  }

  function overlayMatchFor(matchId) {
    if (!overlayLive || !Array.isArray(overlayLive.matches)) return null;
    var id = String(matchId || "");
    if (!id) return null;
    for (var i = 0; i < overlayLive.matches.length; i++) {
      var row = overlayLive.matches[i];
      if (String(row.match_id) === id) return row;
    }
    return null;
  }

  function resolveServerCountryCode(row) {
    if (!row) return "";
    var C = global.QLDashboardCountries;
    if (!C) return "";
    var direct = C.normalizeCountryCode(
      row.server_country || row.host_country || row.country || row.location,
    );
    if (direct) return direct;
    var overlay = overlayMatchFor(row.match_id);
    if (overlay) {
      direct = C.normalizeCountryCode(
        overlay.server_country || overlay.host_country || overlay.country || overlay.location,
      );
      if (direct) return direct;
    }
    var fromName = C.countryCodeFromLabel(row.server_name);
    if (fromName) return fromName;
    if (overlay && overlay.server_name) {
      fromName = C.countryCodeFromLabel(overlay.server_name);
      if (fromName) return fromName;
    }
    return "";
  }

  function serverLocationHtml(row) {
    if (!row) return escapeHtml("—");
    var code = resolveServerCountryCode(row);
    var name = trim(row.server_name || "");
    if (!code && !name) return escapeHtml("—");
    var C = global.QLDashboardCountries;
    var html = "";
    if (code) {
      var flag = C ? C.countryFlagEmoji(code) : "";
      html +=
        '<span class="server-location" title="' +
        escapeHtml(code) +
        '">' +
        (flag ? '<span class="server-location-flag" aria-hidden="true">' + escapeHtml(flag) + "</span>" : "") +
        '<span class="server-location-code">' +
        escapeHtml(code) +
        "</span></span>";
    }
    if (name) {
      html +=
        (html ? " " : "") +
        '<span class="server-location-name">' +
        escapeHtml(name) +
        "</span>";
    }
    return html || escapeHtml("—");
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
        if (phase === "countdown") return "badge-warmup";
        if (phase === "playing") return "badge-live";
        if (phase === "ended") return "badge-ended";
      }
      if (row.warmup || row.countdown) return "badge-warmup";
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

  function isWarmupPhase(row) {
    if (!row) return false;
    if (row.warmup) return true;
    if (row.countdown) return true;
    var phase = String(row.phase || "").toLowerCase();
    return phase === "warmup" || phase === "countdown";
  }

  function matchScoreSummary(row) {
    if (!row) return "—";
    if (isWarmupPhase(row)) return "—";
    return row.score_summary || row.match_id || "—";
  }

  function playerStatDisplay(liveData, value) {
    if (isWarmupPhase(liveData)) return "—";
    return value != null ? value : 0;
  }

  function matchPhaseLabel(row) {
    if (!row) return "—";
    if (row.phase === "warmup" || row.warmup) return t("phaseWarmup");
    if (row.phase === "countdown" || row.countdown) return t("phaseCountdown");
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
    if (row.phase === "countdown" || row.countdown) return null;
    if (row.phase === "ended") return null;
    var now = Date.now();
    if (row.game_time_ms != null && row.game_time_ms > 0 && row.clock_at) {
      var at = Date.parse(row.clock_at);
      if (!isNaN(at)) return Math.floor((row.game_time_ms + (now - at)) / 1000);
      return Math.floor(row.game_time_ms / 1000);
    }
    if (row.elapsed_sec != null && row.clock_at) {
      var at2 = Date.parse(row.clock_at);
      if (!isNaN(at2)) return row.elapsed_sec + Math.floor((now - at2) / 1000);
      return row.elapsed_sec;
    }
    return null;
  }

  function statsHubWsUrl(matchId) {
    if (!settings.statsHubBase) return null;
    var base = String(settings.statsHubBase).replace(/\/+$/, "");
    var wsBase = base.replace(/^http/i, "ws");
    var url = wsBase + "/api/ws/live";
    if (matchId) url += "?match=" + encodeURIComponent(matchId);
    return url;
  }

  function buildUrl(relativePath, params) {
    var url = new URL(relativePath, window.location.href);
    var search = new URLSearchParams(params || {});
    url.search = search.toString();
    return url.href;
  }

  function resolveLiveOverlayRoot() {
    try {
      var loc = window.location;
      var path = loc.pathname || "";
      var marker = "/live-overlay/";
      var idx = path.indexOf(marker);
      if (idx >= 0) {
        return loc.origin + path.slice(0, idx + marker.length);
      }
      if (loc.port === "8787") {
        return loc.origin + "/live-overlay/";
      }
    } catch (_e) {
      /* ignore */
    }
    return DEFAULT_OVERLAY_ASSETS.replace(/\/+$/, "") + "/";
  }

  function applyParamsToUrl(url, params) {
    if (!params) return url.href;
    Object.keys(params).forEach(function (k) {
      var v = params[k];
      if (v != null && v !== "") url.searchParams.set(k, String(v));
    });
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
      if (loc.port === "8787") return loc.origin + "/live-overlay";
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
    return applyParamsToUrl(new URL(file, resolveLiveOverlayRoot()), params);
  }

  function liveOverlayPreviewUrl(page, matchId, extra) {
    var previewExtra = Object.assign({ poll: String(PREVIEW_POLL_MS) }, extra || {});
    return liveOverlayUrl(page, matchId, previewExtra);
  }

  function streamOverlayUrl() {
    return new URL("../stream-overlay/index.html", resolveLiveOverlayRoot()).href;
  }

  function docsUrl() {
    return new URL("../stream-overlay/docs.html", resolveLiveOverlayRoot()).href;
  }

  function playerGuideUrl() {
    return new URL("../player-guide/index.html", resolveLiveOverlayRoot()).href;
  }

  function openWindow(url, windowName) {
    var target = windowName || "_blank";
    var w = window.open(url, target, "noopener,noreferrer");
    if (w) {
      try {
        w.opener = null;
      } catch (_e) {
        /* cross-origin */
      }
    }
    return w;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_e) {
      return false;
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

  function lastVisitedServerId() {
    try {
      return trim(sessionStorage.getItem("ql-dashboard-last-server") || "");
    } catch (_e) {
      return "";
    }
  }

  function resolveOverlayMatchId(preferred) {
    var id = trim(preferred || "");
    if (id) return id;
    id = lastVisitedServerId();
    if (id) return id;
    id = trim(settings.defaultMatchId || "");
    if (id) return id;
    return matches[0] && matches[0].match_id ? String(matches[0].match_id) : "";
  }

  function setStatus(text, kind) {
    if (statusCallback) statusCallback(text, kind);
  }

  async function loadTournaments() {
    if (!settings.publicDataBase) {
      tournaments = [];
      return;
    }
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
  }

  async function loadTournamentMeta() {
    tournamentMeta = null;
    overlayLive = null;
    if (!settings.tournamentSlug || !settings.publicDataBase) return;
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
  }

  async function fetchTournamentFile(path) {
    if (!settings.tournamentSlug || !settings.publicDataBase) return null;
    try {
      return await fetchPublicJson(tournamentUrl(path));
    } catch (_e) {
      return null;
    }
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

  async function refreshMatches(opts) {
    opts = opts || {};
    if (!settings.statsHubBase) {
      matches = [];
      if (opts.notify) setStatus(t("errorMissingBase"), "error");
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
      var statusLine = t("matchesCount", { n: matches.length });
      if (opts.probeHealth) {
        var ok = await probeStatsHub();
        statusLine += " · " + (ok ? t("healthOk") : t("healthFail"));
        if (opts.notify) setStatus(statusLine, ok ? "ok" : "");
      } else if (opts.notify) {
        setStatus(statusLine, "ok");
      }
    } catch (err) {
      matches = [];
      if (opts.notify) setStatus(t("errorFetchMatches") + ": " + (err.message || err), "error");
    }
    if (currentView && currentView.onMatchesUpdated) currentView.onMatchesUpdated();
  }

  async function refreshAll() {
    if (!settings.publicDataBase) {
      setStatus(t("errorMissingPublic"), "error");
      return;
    }
    try {
      await loadTournaments();
      await loadTournamentMeta();
      var route = parseRoute();
      var onHome = route.view === "home";
      await refreshMatches({ probeHealth: true, notify: onHome });
    } catch (err) {
      setStatus(t("errorFetchTournaments") + ": " + (err.message || err), "error");
    }
    if (currentView && currentView.onDataUpdated) currentView.onDataUpdated();
  }

  function syncPolling() {
    stopPolling();
    var route = parseRoute();
    var viewName = route.view;

    if (viewName === "home") {
      pollTimer = setInterval(function () {
        pollHealthTick += 1;
        refreshMatches({
          probeHealth: pollHealthTick % HEALTH_PROBE_EVERY === 1,
          notify: true,
        });
      }, MATCH_POLL_MS);
      return;
    }

    if (viewName === "server" || viewName === "results") {
      pollTimer = setInterval(function () {
        refreshMatches({ probeHealth: false, notify: false });
      }, MATCH_POLL_MS);
      return;
    }

    if (viewName === "overlays") {
      pollTimer = setInterval(function () {
        refreshMatches({ probeHealth: false, notify: false });
      }, OVERLAYS_POLL_MS);
    }
  }

  function startPolling() {
    syncPolling();
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function parseRoute() {
    var hash = (location.hash || "#/").replace(/^#\/?/, "");
    var parts = hash.split("/").filter(Boolean);
    var view = parts[0] || "home";
    if (view === "dashboard") view = "home";
    if (view === "match") view = "server";
    var param = null;
    if (parts.length > 1) {
      param = parts
        .slice(1)
        .map(function (seg) {
          try {
            return decodeURIComponent(seg);
          } catch (_e) {
            return seg;
          }
        })
        .join("/");
    }
    return { view: view, param: param, rawView: parts[0] || "home" };
  }

  function navigate(path) {
    if (!path) path = "#/";
    else if (path.charAt(0) !== "#") path = "#/" + path.replace(/^\//, "");
    if (location.hash !== path) location.hash = path;
    else renderRoute();
  }

  function legacyMatchRedirect(route) {
    if (route.rawView === "match" && route.param) {
      var target = "#/server/" + route.param
        .split("/")
        .map(function (seg) {
          return encodeURIComponent(seg);
        })
        .join("/");
      if (location.hash !== target) {
        location.replace(target);
        return true;
      }
    }
    return false;
  }

  function registerView(name, view) {
    views[name] = view;
  }

  function updateNavActive(route) {
    document.querySelectorAll("[data-route]").forEach(function (link) {
      var r = link.getAttribute("data-route");
      var active = r === route.view || (route.view === "home" && r === "home");
      if (r === "server" && (route.view === "server" || route.rawView === "match")) active = true;
      link.classList.toggle("active", active);
    });
  }

  function renderRoute() {
    var route = parseRoute();
    if (legacyMatchRedirect(route)) return;
    if (currentView && currentView.unmount) currentView.unmount();
    currentView = null;

    var mount = document.getElementById("app-main");
    if (!mount) return;
    mount.innerHTML = "";

    var viewName = route.view;

    var view = views[viewName] || views.home;
    if (!view) return;

    currentView = view;
    updateNavActive(route);
    if (view.mount) view.mount(mount, route);
    syncPolling();
  }

  function applyLangToDom() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(function (node) {
      var key = node.getAttribute("data-i18n");
      if (key) node.textContent = t(key);
    });
    if (document.querySelector(".app-title")) {
      document.title = t("pageTitle");
    }
    if (currentView && currentView.onLangChanged) currentView.onLangChanged();
  }

  function updateLangButtons() {
    document.querySelectorAll("[data-lang]").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-lang") === lang);
    });
  }

  function bindShell() {
    document.querySelectorAll("[data-route]").forEach(function (link) {
      link.addEventListener("click", function (ev) {
        ev.preventDefault();
        var r = link.getAttribute("data-route");
        if (r === "home") navigate("#/");
        else navigate("#/" + r);
      });
    });

    document.querySelectorAll("[data-lang]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        lang = btn.getAttribute("data-lang") || "en";
        saveSettings(Object.assign({}, settings, { lang: lang }));
      });
    });

    window.addEventListener("hashchange", renderRoute);
  }

  function init() {
    settings = loadSettings();
    lang = settings.lang;
    mergeQueryIntoSettings();
    mergeQueryMatchRoute();
    applyLangToDom();
    updateLangButtons();
    bindShell();
    renderRoute();
    refreshAll();
    syncPolling();
  }

  global.QLDashboard = {
    init: init,
    t: t,
    escapeHtml: escapeHtml,
    get settings() {
      return settings;
    },
    saveSettings: saveSettings,
    patchSettings: patchSettings,
    refreshAll: refreshAll,
    refreshMatches: refreshMatches,
    registerView: registerView,
    navigate: navigate,
    parseRoute: parseRoute,
    setStatusHandler: function (fn) {
      statusCallback = fn;
    },
    get tournaments() {
      return tournaments;
    },
    get tournamentMeta() {
      return tournamentMeta;
    },
    get overlayLive() {
      return overlayLive;
    },
    get matches() {
      return matches;
    },
    tournamentName: tournamentName,
    tournamentUrl: tournamentUrl,
    fetchTournamentFile: fetchTournamentFile,
    connectForMatch: connectForMatch,
    overlayMatchFor: overlayMatchFor,
    resolveServerCountryCode: resolveServerCountryCode,
    serverLocationHtml: serverLocationHtml,
    statusBadgeClass: statusBadgeClass,
    isWarmupPhase: isWarmupPhase,
    matchScoreSummary: matchScoreSummary,
    playerStatDisplay: playerStatDisplay,
    matchPhaseLabel: matchPhaseLabel,
    formatClockSec: formatClockSec,
    computeMatchElapsedSec: computeMatchElapsedSec,
    statsHubWsUrl: statsHubWsUrl,
    liveOverlayUrl: liveOverlayUrl,
    liveOverlayPreviewUrl: liveOverlayPreviewUrl,
    streamOverlayUrl: streamOverlayUrl,
    docsUrl: docsUrl,
    playerGuideUrl: playerGuideUrl,
    openWindow: openWindow,
    copyText: copyText,
    makeActionBtn: makeActionBtn,
    lastVisitedServerId: lastVisitedServerId,
    resolveOverlayMatchId: resolveOverlayMatchId,
    overlayQueryParams: overlayQueryParams,
    buildUrl: buildUrl,
    fetchStatsJson: fetchStatsJson,
    fetchArchiveSummary: fetchArchiveSummary,
    hasStatsApiToken: hasStatsApiToken,
    deleteStatsResult: deleteStatsResult,
    debugMode: debugMode,
    qsParam: qsParam,
    effectiveAssetsBase: effectiveAssetsBase,
    stopPolling: stopPolling,
    startPolling: startPolling,
    syncPolling: syncPolling,
  };
})(typeof window !== "undefined" ? window : globalThis);
