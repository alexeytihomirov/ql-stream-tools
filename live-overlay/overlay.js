(function () {
  "use strict";

  var STORAGE_KEY = "ql-live-overlay-base";

  function qs(name, fallback) {
    var params = new URLSearchParams(window.location.search);
    if (!params.has(name)) return fallback || "";
    var v = params.get(name);
    return v === null ? fallback || "" : v;
  }

  function apiBase() {
    var explicit = qs("base");
    if (explicit) return explicit.replace(/\/+$/, "");
    var ctrl = readControlSettings();
    if (ctrl && ctrl.statsHubBase) {
      return String(ctrl.statsHubBase).replace(/\/+$/, "");
    }
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return stored.replace(/\/+$/, "");
    } catch (_e) {
      /* private mode */
    }
    return "";
  }

  function requireApiBase() {
    var base = apiBase();
    if (!base) {
      throw new Error(
        "Missing stats hub URL — add ?base=http://HOST:8090 to the OBS URL",
      );
    }
    return base;
  }

  function pollMs() {
    return Math.max(500, Number(qs("poll", "500")) || 500);
  }

  function mapPollMs() {
    return Math.max(500, Number(qs("poll", "100")) || 100);
  }

  function mapSmoothEnabled() {
    if (replayMode()) return false;
    var v = String(qs("smooth", "1")).toLowerCase();
    return v !== "0" && v !== "false" && v !== "off";
  }

  function mapSmoothMs() {
    return Math.max(40, Math.min(800, Number(qs("smooth_ms", "180")) || 180));
  }

  function mapSmoothAlpha() {
    // Per-frame blend (~60fps); higher smooth_ms = slower catch-up.
    return 1 - Math.exp(-16.67 / mapSmoothMs());
  }

  function useWebSocket() {
    if (replayMode()) return false;
    return qs("transport", "ws") !== "poll";
  }

  function replayMode() {
    var v = String(qs("replay", "0")).toLowerCase();
    return v === "1" || v === "true" || v === "on";
  }

  function replaySpeedDefault() {
    var n = Number(qs("speed", "1"));
    if (!isFinite(n) || n <= 0) return 1;
    return Math.max(0.25, Math.min(8, n));
  }

  function clientRecordEnabled() {
    var v = String(qs("record", "0")).toLowerCase();
    return v === "1" || v === "true" || v === "on";
  }

  function clientRecordAutoStart() {
    var v = String(qs("record_auto", "0")).toLowerCase();
    return v === "1" || v === "true" || v === "on";
  }

  function replaySourceFileOnly() {
    var v = String(qs("source", "")).toLowerCase();
    return v === "file" || v === "local";
  }

  var CLIENT_RECORD_VERSION = 1;
  var clientRecorder = {
    active: false,
    events: [],
    matchId: null,
    meta: {},
  };

  var replayControlsBound = false;
  var recordControlsBound = false;

  var replayClock = { active: false, epochMs: 0, cursorMs: 0 };

  function overlayNowMs() {
    if (replayClock.active) return replayClock.epochMs + replayClock.cursorMs;
    return Date.now();
  }

  function debugPickups() {
    var v = String(qs("debug_pickups", "0")).toLowerCase();
    return v === "1" || v === "true" || v === "on";
  }

  function matchId() {
    return qs("match");
  }

  function obsBgParam() {
    return String(qs("bg", "transparent") || "transparent").toLowerCase();
  }

  function applyObsBackground() {
    var body = document.body;
    if (!body) return;
    if (!qs("bg") && body.classList.contains("match-page-body")) return;
    var mode = obsBgParam();
    body.classList.remove(
      "obs-bg-transparent",
      "obs-bg-chroma",
      "obs-bg-checkerboard",
    );
    if (mode === "chroma" || mode === "green" || mode === "00ff00") {
      body.classList.add("obs-bg-chroma");
      body.style.background = "#00ff00";
      return;
    }
    if (mode === "checkerboard" || mode === "checker") {
      body.classList.add("obs-bg-checkerboard");
      body.style.background = "";
      return;
    }
    if (mode.charAt(0) === "#") {
      body.style.background = mode;
      return;
    }
    body.classList.add("obs-bg-transparent");
    body.style.background = "transparent";
  }

  function matchesMode() {
    var v = String(qs("mode", "overlay") || "overlay").toLowerCase();
    return v === "operator" ? "operator" : "overlay";
  }

  function matchesLayout() {
    var v = String(qs("layout", "cards") || "cards").toLowerCase();
    return v === "compact" ? "compact" : "cards";
  }

  function matchesStatusFilter() {
    return String(qs("status", "all") || "all").toLowerCase();
  }

  function matchesGametypeFilter() {
    return String(qs("gametype", "") || "").toLowerCase();
  }

  function readControlSettings() {
    var keys = ["ql-dashboard-settings", "ql-control-settings"];
    for (var i = 0; i < keys.length; i++) {
      try {
        var raw = localStorage.getItem(keys[i]);
        if (raw) return JSON.parse(raw);
      } catch (_e) {
        /* ignore */
      }
    }
    return null;
  }

  function publicDataBaseUrl() {
    var fromQs = qs("publicDataBase") || qs("public");
    if (fromQs) return fromQs.replace(/\/+$/, "");
    var ctrl = readControlSettings();
    if (ctrl && ctrl.publicDataBase) {
      return String(ctrl.publicDataBase).replace(/\/+$/, "");
    }
    return "";
  }

  function tournamentSlugUrl() {
    var fromQs = qs("tournament") || qs("slug");
    if (fromQs) return fromQs.toLowerCase();
    var ctrl = readControlSettings();
    if (ctrl && ctrl.tournamentSlug) return String(ctrl.tournamentSlug).toLowerCase();
    return "";
  }

  async function fetchPublicDataJson(path) {
    var base = publicDataBaseUrl();
    if (!base) return null;
    var res = await fetch(base + path, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return res.json();
  }

  async function fetchTournamentOverlayLive() {
    var slug = tournamentSlugUrl();
    if (!slug) return null;
    return fetchPublicDataJson(
      "/tournaments/" + encodeURIComponent(slug) + "/overlay-live.json",
    );
  }

  async function fetchTournamentMeta() {
    var slug = tournamentSlugUrl();
    if (!slug) return null;
    return fetchPublicDataJson(
      "/tournaments/" + encodeURIComponent(slug) + "/meta.json",
    );
  }

  function connectHintFromOverlayLive(overlayLive, matchIdValue) {
    if (!overlayLive || !Array.isArray(overlayLive.matches)) return null;
    var id = String(matchIdValue);
    for (var i = 0; i < overlayLive.matches.length; i++) {
      var row = overlayLive.matches[i];
      if (String(row.match_id) === id && row.connect) return row.connect;
    }
    if (overlayLive.matches.length && overlayLive.matches[0].connect) {
      return overlayLive.matches[0].connect;
    }
    return null;
  }

  function appendQueryParam(url, key, value) {
    if (!value) return url;
    var u = new URL(url, window.location.href);
    u.searchParams.set(key, value);
    return u.pathname + u.search;
  }

  function overlayPageUrl(page, id, extraParams) {
    var base = apiBase();
    var params = new URLSearchParams(window.location.search);
    if (base && !params.get("base")) {
      params.set("base", base);
    }
    if (id) {
      params.set("match", id);
    } else {
      params.delete("match");
    }
    if (extraParams) {
      Object.keys(extraParams).forEach(function (k) {
        if (extraParams[k] != null && extraParams[k] !== "") {
          params.set(k, extraParams[k]);
        }
      });
    }
    var path = page + ".html";
    var query = params.toString();
    return query ? path + "?" + query : path;
  }

  function openOverlayWindow(page, id, features) {
    var url = overlayPageUrl(page, id);
    var name = "ql-overlay-" + page + (id ? "-" + id : "");
    window.open(
      url,
      name,
      features || "noopener,noreferrer,width=960,height=720",
    );
  }

  function setStatus(text, isError) {
    var el = document.getElementById("status");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("error", !!isError);
  }

  async function fetchJson(path) {
    var base = requireApiBase();
    var res = await fetch(base + path, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function fetchLiveMatchRows() {
    var rows = await fetchJson("/api/stream/matches");
    if (rows.length) return rows;
    var all = await fetchJson("/api/matches");
    if (!Array.isArray(all)) return [];
    return all.filter(function (m) {
      return String(m.status || "").toLowerCase() === "live";
    });
  }

  function playerDisplayScore(p, gametype) {
    var score = Number(p && p.score) || 0;
    var kills = Number(p && p.kills) || 0;
    var gt = String(gametype || (p && p.gametype) || "").toLowerCase();
    if (gt === "duel" || gt === "ffa" || gt === "deathmatch") {
      return Math.max(score, kills);
    }
    return score;
  }

  function renderPlayers(players, gametype) {
    var body = document.getElementById("players-body");
    if (!body) return;
    body.innerHTML = "";
    var sorted = (players || []).slice().sort(function (a, b) {
      return playerDisplayScore(b, gametype) - playerDisplayScore(a, gametype);
    });
    for (var i = 0; i < sorted.length; i++) {
      var p = sorted[i];
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" +
        (p.nickname || p.steam_id64) +
        "</td><td>" +
        playerDisplayScore(p, gametype) +
        "</td><td>" +
        (p.kills || 0) +
        "</td><td>" +
        (p.deaths || 0) +
        "</td>";
      body.appendChild(tr);
    }
  }

  async function refreshScoreboard() {
    var id = matchId();
    if (!id) {
      var rows = await fetchLiveMatchRows();
      if (!rows.length) {
        setStatus("No live matches");
        return;
      }
      return refreshScoreboardFor(rows[0].match_id);
    }
    return refreshScoreboardFor(id);
  }

  async function refreshScoreboardFor(id) {
    var data = await fetchJson("/api/stream/matches/" + encodeURIComponent(id));
    var board = document.getElementById("scoreboard");
    var title = document.getElementById("match-title");
    var meta = document.getElementById("match-meta");
    if (board) board.classList.remove("hidden");
    if (title) title.textContent = data.score_summary || data.match_id;
    if (meta)
      meta.textContent = [data.map_name, data.gametype, data.server_name]
        .filter(Boolean)
        .join(" · ");
    renderPlayers(data.players, data.gametype);
    scoreboardClockRow = data;
    renderMatchClockEl(document.getElementById("match-clock"), data);
    ensureMatchClockTicker();
    setStatus("");
  }

  var scoreboardWsState = { ws: null, timer: null };

  function applyScoreboardMatch(data) {
    if (!data) return;
    var board = document.getElementById("scoreboard");
    var title = document.getElementById("match-title");
    var meta = document.getElementById("match-meta");
    if (board) board.classList.remove("hidden");
    if (title) title.textContent = data.score_summary || data.match_id;
    if (meta) {
      meta.textContent = [data.map_name, data.gametype, data.server_name]
        .filter(Boolean)
        .join(" · ");
    }
    renderPlayers(data.players, data.gametype);
    scoreboardClockRow = data;
    renderMatchClockEl(document.getElementById("match-clock"), data);
    ensureMatchClockTicker();
  }

  function initScoreboardWebSocket() {
    if (!useWebSocket()) return;
    var id = matchId();
    if (!id) return;
    var base = apiBase();
    if (!base) return;

    function scheduleReconnect(ms) {
      if (scoreboardWsState.timer) clearTimeout(scoreboardWsState.timer);
      scoreboardWsState.timer = setTimeout(connect, ms || 2500);
    }

    function connect() {
      if (scoreboardWsState.ws) {
        scoreboardWsState.ws.onclose = null;
        scoreboardWsState.ws.close();
        scoreboardWsState.ws = null;
      }
      var wsProto = base.indexOf("https") === 0 ? "wss" : "ws";
      var hostPath = base.replace(/^https?:\/\//, "");
      var ws = new WebSocket(
        wsProto + "://" + hostPath + "/api/ws/live?match=" + encodeURIComponent(id),
      );
      scoreboardWsState.ws = ws;
      ws.onmessage = function (ev) {
        var data;
        try {
          data = JSON.parse(ev.data);
        } catch (_e) {
          return;
        }
        if (data.event === "match_update" && data.match) {
          var row = data.match;
          row.score_summary =
            row.score_summary || buildScoreSummary(row.players, row.gametype);
          applyScoreboardMatch(row);
        }
      };
      ws.onclose = function () {
        scheduleReconnect(2500);
      };
      ws.onerror = function () {
        if (ws) ws.close();
      };
    }

    connect();
  }

  function buildScoreSummary(players, gametype) {
    var rows = players || [];
    if (!rows.length) return "";
    if (rows.length === 2) {
      var a = rows[0];
      var b = rows[1];
      return (
        (a.nickname || a.steam_id64) +
        " " +
        playerDisplayScore(a, gametype) +
        " — " +
        playerDisplayScore(b, gametype) +
        " " +
        (b.nickname || b.steam_id64)
      );
    }
    var top = rows.slice().sort(function (x, y) {
      return playerDisplayScore(y, gametype) - playerDisplayScore(x, gametype);
    })[0];
    return (top.nickname || top.steam_id64) + ": " + playerDisplayScore(top, gametype);
  }

  var matchesListState = {
    rows: [],
    endedCache: {},
    ws: null,
    wsTimer: null,
  };

  function isEndedStatus(status) {
    var s = String(status || "").toLowerCase();
    return s === "ended" || s === "aborted";
  }

  function isLiveStatus(status) {
    var s = String(status || "live").toLowerCase();
    return s === "live" || s === "active" || s === "in_progress";
  }

  function matchPhase(row) {
    if (!row) return "ended";
    if (row.phase) return String(row.phase).toLowerCase();
    if (isEndedStatus(row.status)) return "ended";
    if (row.warmup) return "warmup";
    return "playing";
  }

  function matchPhaseBadgeClass(row) {
    var phase = matchPhase(row);
    if (phase === "warmup") return "is-warmup";
    if (phase === "playing") return "is-live";
    return "is-ended";
  }

  function matchPhaseLabel(row) {
    var phase = matchPhase(row);
    if (phase === "warmup") return operatorT("phaseWarmup");
    if (phase === "playing") return operatorT("phaseLive");
    return operatorT("phaseEnded");
  }

  function formatClockSec(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function computeMatchElapsedSec(row) {
    if (!row || matchPhase(row) !== "playing") return null;
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

  function renderMatchClockEl(el, row) {
    if (!el) return;
    var phase = matchPhase(row);
    if (phase === "warmup") {
      el.textContent = operatorT("phaseWarmup");
      el.classList.remove("hidden");
      return;
    }
    if (phase !== "playing") {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    var elapsed = computeMatchElapsedSec(row);
    if (elapsed == null) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.textContent = formatClockSec(elapsed);
    el.classList.remove("hidden");
  }

  function applyMatchPhaseBadge(el, row) {
    if (!el) return;
    el.textContent = matchPhaseLabel(row);
    el.className = "match-status-badge " + matchPhaseBadgeClass(row);
  }

  function findCachedMatchRow(matchId) {
    if (!matchId) return null;
    for (var i = 0; i < matchesListState.rows.length; i++) {
      if (matchesListState.rows[i].match_id === matchId) {
        return matchesListState.rows[i];
      }
    }
    if (matchesListState.endedCache[matchId]) {
      return matchesListState.endedCache[matchId];
    }
    return null;
  }

  var matchClockTicker = null;
  var scoreboardClockRow = null;
  var matchPageClockRow = null;

  function tickMatchClocks() {
    document.querySelectorAll(".match-clock[data-match-id]").forEach(function (el) {
      renderMatchClockEl(el, findCachedMatchRow(el.getAttribute("data-match-id")));
    });
    renderMatchClockEl(document.getElementById("match-clock"), scoreboardClockRow);
    renderMatchClockEl(document.getElementById("match-page-clock"), matchPageClockRow);
  }

  function ensureMatchClockTicker() {
    if (matchClockTicker) return;
    matchClockTicker = setInterval(tickMatchClocks, 1000);
  }

  function mergeMatchRow(row) {
    if (!row || !row.match_id) return;
    var id = row.match_id;
    if (isEndedStatus(row.status)) {
      matchesListState.endedCache[id] = row;
      matchesListState.rows = matchesListState.rows.filter(function (r) {
        return r.match_id !== id;
      });
      return;
    }
    delete matchesListState.endedCache[id];
    var idx = -1;
    for (var i = 0; i < matchesListState.rows.length; i++) {
      if (matchesListState.rows[i].match_id === id) {
        idx = i;
        break;
      }
    }
    if (idx >= 0) {
      matchesListState.rows[idx] = row;
    } else {
      matchesListState.rows.push(row);
    }
  }

  function allMatchRowsForDisplay() {
    var out = matchesListState.rows.slice();
    Object.keys(matchesListState.endedCache).forEach(function (id) {
      out.push(matchesListState.endedCache[id]);
    });
    return out;
  }

  function filterMatchRows(rows) {
    var statusF = matchesStatusFilter();
    var gt = matchesGametypeFilter();
    return rows.filter(function (row) {
      if (statusF === "live" && !isLiveStatus(row.status)) return false;
      if (statusF === "ended" && !isEndedStatus(row.status)) return false;
      if (gt && String(row.gametype || "").toLowerCase() !== gt) return false;
      return true;
    });
  }

  function escapeHtmlText(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function operatorT(key) {
    if (typeof QLOperatorI18n !== "undefined") return QLOperatorI18n.t(key);
    return key;
  }

  function syncMatchesOperatorUi() {
    var bar = document.getElementById("matches-operator");
    var isOperator = matchesMode() === "operator";
    if (bar) bar.classList.toggle("hidden", !isOperator);
    document.body.classList.toggle("matches-operator-mode", isOperator);
    if (!isOperator) return;

    var statusSel = document.getElementById("matches-filter-status");
    var gtSel = document.getElementById("matches-filter-gametype");
    var layoutSel = document.getElementById("matches-layout");

    if (statusSel) statusSel.value = matchesStatusFilter();
    if (layoutSel) layoutSel.value = matchesLayout();
    if (gtSel) {
      var prev = gtSel.value;
      var types = {};
      allMatchRowsForDisplay().forEach(function (r) {
        if (r.gametype) types[String(r.gametype).toLowerCase()] = r.gametype;
      });
      gtSel.innerHTML =
        '<option value="">' + escapeHtmlText(operatorT("anyGametype")) + "</option>";
      Object.keys(types)
        .sort()
        .forEach(function (k) {
          var opt = document.createElement("option");
          opt.value = k;
          opt.textContent = types[k];
          gtSel.appendChild(opt);
        });
      if (prev) gtSel.value = prev;
    }

    var lblStatus = document.getElementById("lbl-filter-status");
    var lblGt = document.getElementById("lbl-filter-gametype");
    var lblLayout = document.getElementById("lbl-layout");
    var linkCtrl = document.getElementById("matches-link-control");
    if (lblStatus) lblStatus.textContent = operatorT("filterStatus");
    if (lblGt) lblGt.textContent = operatorT("filterGametype");
    if (lblLayout) lblLayout.textContent = operatorT("layoutCards").split(" ")[0];
    if (linkCtrl) {
      linkCtrl.textContent = operatorT("openControl");
      linkCtrl.href = overlayPageUrl("control/index", null);
    }
  }

  function pushMatchesUrlState() {
    if (matchesMode() !== "operator") return;
    var params = new URLSearchParams(window.location.search);
    params.set("mode", "operator");
    params.set("layout", matchesLayout());
    params.set("status", matchesStatusFilter());
    var gt = matchesGametypeFilter();
    if (gt) params.set("gametype", gt);
    else params.delete("gametype");
    var next = window.location.pathname + "?" + params.toString();
    window.history.replaceState(null, "", next);
  }

  function renderMatchListDom(rows) {
    var list = document.getElementById("match-list");
    if (!list) return;
    var layout = matchesLayout();
    var isOperator = matchesMode() === "operator";
    list.className = "match-list layout-" + layout;
    list.innerHTML = "";

    if (!rows.length) {
      setStatus(operatorT("noMatches"));
      return;
    }

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var card = document.createElement("div");
      card.className = "match-card";
      if (isEndedStatus(row.status)) card.classList.add("match-card-ended");
      var mid = row.match_id || "";
      var meta = [row.map_name, row.gametype, row.server_name]
        .filter(Boolean)
        .join(" · ");
      var statusHtml =
        '<span class="match-status-badge ' +
        matchPhaseBadgeClass(row) +
        '">' +
        escapeHtmlText(matchPhaseLabel(row)) +
        '</span><span class="match-clock" data-match-id="' +
        escapeHtmlText(mid) +
        '"></span>';

      if (layout === "compact") {
        card.innerHTML =
          '<div class="match-card-compact-main">' +
          "<h3>" +
          escapeHtmlText(row.score_summary || mid) +
          "</h3>" +
          '<p class="match-card-compact-meta">' +
          escapeHtmlText(meta) +
          "</p>" +
          "</div>" +
          statusHtml;
      } else {
        card.innerHTML =
          "<h3>" +
          escapeHtmlText(row.score_summary || mid) +
          "</h3>" +
          "<p>" +
          escapeHtmlText(meta) +
          "</p>" +
          statusHtml +
          '<p class="match-card-id">' +
          escapeHtmlText(mid) +
          "</p>";
      }

      if (isOperator) {
        var actions = document.createElement("div");
        actions.className = "match-card-actions";
        actions.innerHTML =
          '<button type="button" class="overlay-btn" data-open="match" data-match="' +
          escapeHtmlText(mid) +
          '">' +
          escapeHtmlText(operatorT("openMatch")) +
          '</button><button type="button" class="overlay-btn" data-open="scoreboard" data-match="' +
          escapeHtmlText(mid) +
          '">' +
          escapeHtmlText(operatorT("scoreboard")) +
          '</button><button type="button" class="overlay-btn" data-open="map" data-match="' +
          escapeHtmlText(mid) +
          '">' +
          escapeHtmlText(operatorT("map")) +
          "</button>";
        card.appendChild(actions);
      }

      list.appendChild(card);
    }

    list.querySelectorAll(".match-clock[data-match-id]").forEach(function (el) {
      renderMatchClockEl(el, findCachedMatchRow(el.getAttribute("data-match-id")));
    });
    ensureMatchClockTicker();

    list.querySelectorAll("[data-open]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var page = btn.getAttribute("data-open");
        var id = btn.getAttribute("data-match");
        if (page === "match") {
          window.location.href = overlayPageUrl("match", id, {
            mode: "operator",
          });
          return;
        }
        openOverlayWindow(page, id);
      });
    });
    setStatus(rows.length + " match(es)");
  }

  async function refreshMatchList() {
    var rows = await fetchLiveMatchRows();
    if (!Array.isArray(rows)) rows = [];
    matchesListState.rows = rows;
    syncMatchesOperatorUi();
    var filtered = filterMatchRows(allMatchRowsForDisplay());
    renderMatchListDom(filtered);
  }

  function initMatchesWebSocket() {
    if (!useWebSocket()) return;
    var base = apiBase();
    if (!base) return;

    function scheduleReconnect(ms) {
      if (matchesListState.wsTimer) clearTimeout(matchesListState.wsTimer);
      matchesListState.wsTimer = setTimeout(connect, ms || 2500);
    }

    function connect() {
      if (matchesListState.ws) {
        matchesListState.ws.onclose = null;
        matchesListState.ws.close();
        matchesListState.ws = null;
      }
      var wsProto = base.indexOf("https") === 0 ? "wss" : "ws";
      var hostPath = base.replace(/^https?:\/\//, "");
      var ws = new WebSocket(wsProto + "://" + hostPath + "/api/ws/live");
      matchesListState.ws = ws;
      ws.onmessage = function (ev) {
        var data;
        try {
          data = JSON.parse(ev.data);
        } catch (_e) {
          return;
        }
        if (data.event === "match_update" && data.match) {
          mergeMatchRow(data.match);
          renderMatchListDom(filterMatchRows(allMatchRowsForDisplay()));
        }
        if (data.event === "match_status") {
          var id = data.match_id;
          if (!id) return;
          if (isEndedStatus(data.status)) {
            fetchJson("/api/stream/matches/" + encodeURIComponent(id))
              .then(function (m) {
                mergeMatchRow(Object.assign({}, m, { status: data.status }));
                renderMatchListDom(filterMatchRows(allMatchRowsForDisplay()));
              })
              .catch(function () {
                mergeMatchRow({
                  match_id: id,
                  status: data.status,
                  score_summary: id,
                  players: [],
                });
                renderMatchListDom(filterMatchRows(allMatchRowsForDisplay()));
              });
          } else {
            refreshMatchList().catch(function () {});
          }
        }
      };
      ws.onclose = function () {
        scheduleReconnect(2500);
      };
      ws.onerror = function () {
        if (ws) ws.close();
      };
    }

    connect();
  }

  function bindMatchesOperatorControls() {
    if (matchesMode() !== "operator") return;

    function navigateWith(param, value) {
      var params = new URLSearchParams(window.location.search);
      params.set("mode", "operator");
      if (value) params.set(param, value);
      else params.delete(param);
      window.location.search = params.toString();
    }

    var statusSel = document.getElementById("matches-filter-status");
    var gtSel = document.getElementById("matches-filter-gametype");
    var layoutSel = document.getElementById("matches-layout");

    if (statusSel) {
      statusSel.addEventListener("change", function () {
        navigateWith("status", statusSel.value);
      });
    }
    if (gtSel) {
      gtSel.addEventListener("change", function () {
        navigateWith("gametype", gtSel.value);
      });
    }
    if (layoutSel) {
      layoutSel.addEventListener("change", function () {
        navigateWith("layout", layoutSel.value);
      });
    }
  }

  function initMatchPageNav() {
    var baseParams = overlayQueryParamsForPage();
    var ctrl = document.getElementById("match-link-control");
    var matches = document.getElementById("match-link-matches");
    if (ctrl) ctrl.href = overlayPageUrl("dashboard/index", null, baseParams);
    if (matches) {
      matches.href = overlayPageUrl("matches", null, Object.assign({}, baseParams, {
        mode: "operator",
      }));
    }
    var hPlayers = document.getElementById("match-players-heading");
    var hActions = document.getElementById("match-actions-heading");
    if (hPlayers) hPlayers.textContent = operatorT("players");
    if (hActions) hActions.textContent = operatorT("actions");
    var linkCtrl = document.getElementById("match-link-control");
    var linkMatches = document.getElementById("match-link-matches");
    if (linkCtrl) linkCtrl.textContent = operatorT("backControl");
    if (linkMatches) linkMatches.textContent = operatorT("backMatches");
  }

  function overlayQueryParamsForPage() {
    var params = {};
    var base = apiBase();
    if (base) params.base = base;
    var assets = qs("assets");
    if (assets) params.assets = assets;
    var bg = qs("bg");
    if (bg) params.bg = bg;
    return params;
  }

  function renderMatchPageActions(id) {
    var root = document.getElementById("match-page-actions");
    if (!root) return;
    root.innerHTML = "";
    var items = [
      { page: "scoreboard", label: operatorT("scoreboard") },
      { page: "map", label: operatorT("map") },
      {
        page: "map",
        label: operatorT("replay"),
        extra: { replay: "1" },
      },
      { page: "map", label: operatorT("debugCalib"), extra: { debug: "1" } },
    ];
    items.forEach(function (item) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "overlay-btn overlay-btn-primary";
      btn.textContent = item.label;
      btn.addEventListener("click", function () {
        var extra = Object.assign({}, item.extra || {});
        var url = overlayPageUrl(item.page, id, extra);
        window.open(url, "ql-match-" + item.page, "noopener,noreferrer,width=960,height=720");
      });
      root.appendChild(btn);

      var copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "overlay-btn";
      copyBtn.textContent = operatorT("copyUrl");
      copyBtn.addEventListener("click", function () {
        var url = new URL(
          overlayPageUrl(item.page, id, item.extra || {}),
          window.location.href,
        ).href;
        navigator.clipboard.writeText(url).then(function () {
          setStatus(operatorT("copied"));
        });
      });
      root.appendChild(copyBtn);
    });
  }

  function renderMatchPagePlayers(players, gametype) {
    var body = document.getElementById("match-players-body");
    if (!body) return;
    body.innerHTML = "";
    var sorted = (players || []).slice().sort(function (a, b) {
      return playerDisplayScore(b, gametype) - playerDisplayScore(a, gametype);
    });
    for (var i = 0; i < sorted.length; i++) {
      var p = sorted[i];
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" +
        escapeHtmlText(p.nickname || p.steam_id64) +
        "</td><td>" +
        playerDisplayScore(p, gametype) +
        "</td><td>" +
        (p.kills || 0) +
        "</td><td>" +
        (p.deaths || 0) +
        "</td>";
      body.appendChild(tr);
    }
  }

  async function refreshMatchPage() {
    var id = matchId();
    if (!id) {
      setStatus("Missing ?match=MATCH_ID", true);
      return;
    }
    var data;
    try {
      data = await fetchJson("/api/stream/matches/" + encodeURIComponent(id));
    } catch (err) {
      setStatus(operatorT("matchNotFound"), true);
      return;
    }
    var title = document.getElementById("match-page-title");
    var meta = document.getElementById("match-page-meta");
    var statusEl = document.getElementById("match-page-status");
    var connectEl = document.getElementById("match-page-connect");
    var tournamentEl = document.getElementById("match-tournament");

    if (title) title.textContent = data.score_summary || data.match_id;
    if (meta) {
      meta.textContent = [data.map_name, data.gametype, data.server_name]
        .filter(Boolean)
        .join(" · ");
    }
    if (statusEl) {
      applyMatchPhaseBadge(statusEl, data);
    }
    matchPageClockRow = data;
    renderMatchClockEl(document.getElementById("match-page-clock"), data);
    ensureMatchClockTicker();

    var metaJson = await fetchTournamentMeta();
    var overlayLive = await fetchTournamentOverlayLive();
    if (tournamentEl) {
      var tname =
        (metaJson && metaJson.name) ||
        (overlayLive && overlayLive.tournament_name) ||
        tournamentSlugUrl() ||
        "";
      tournamentEl.textContent = tname ? operatorT("tournament") + ": " + tname : "";
    }

    var connect = connectHintFromOverlayLive(overlayLive, id);
    if (connectEl) {
      if (connect) {
        connectEl.textContent = operatorT("connect") + ": /connect " + connect;
        connectEl.classList.remove("hidden");
      } else {
        connectEl.classList.add("hidden");
      }
    }

    renderMatchPagePlayers(data.players, data.gametype);
    renderMatchPageActions(id);
    setStatus("");
  }

  function initMatchPageWs() {
    if (!useWebSocket()) return;
    var id = matchId();
    if (!id) return;
    var base = apiBase();
    var wsProto = base.indexOf("https") === 0 ? "wss" : "ws";
    var hostPath = base.replace(/^https?:\/\//, "");
    var ws = new WebSocket(
      wsProto + "://" + hostPath + "/api/ws/live?match=" + encodeURIComponent(id),
    );
    ws.onmessage = function (ev) {
      var data;
      try {
        data = JSON.parse(ev.data);
      } catch (_e) {
        return;
      }
      if (data.event === "match_update" && data.match) {
        var matchRow = data.match;
        renderMatchPagePlayers(matchRow.players, matchRow.gametype);
        matchPageClockRow = matchRow;
        applyMatchPhaseBadge(
          document.getElementById("match-page-status"),
          matchRow,
        );
        renderMatchClockEl(
          document.getElementById("match-page-clock"),
          matchRow,
        );
        var title = document.getElementById("match-page-title");
        if (title) {
          title.textContent =
            matchRow.score_summary ||
            buildScoreSummary(matchRow.players, matchRow.gametype) ||
            matchRow.match_id;
        }
      }
      if (data.event === "session_event" && data.session_event) {
        appendMatchArchiveEvent(data.session_event);
      }
      if (data.event === "accuracy_update" && data.accuracy) {
        renderMatchArchiveAccuracy(data.accuracy);
      }
    };
  }

  var matchArchiveAccuracy = {};

  function appendMatchArchiveEvent(row) {
    var list = document.getElementById("match-archive-events");
    if (!list || !row) return;
    var li = document.createElement("li");
    var who = row.nickname || row.steam_id64 || "—";
    var text = row.text ? ": " + row.text : "";
    li.textContent = "[" + (row.kind || "event") + "] " + who + text;
    list.appendChild(li);
    while (list.children.length > 120) {
      list.removeChild(list.firstChild);
    }
  }

  function renderMatchArchiveAccuracy(row) {
    if (!row || !row.steam_id64 || !row.weapon) return;
    var key = row.steam_id64 + ":" + row.weapon;
    matchArchiveAccuracy[key] = row;
    var root = document.getElementById("match-archive-accuracy");
    if (!root) return;
    var parts = [];
    Object.keys(matchArchiveAccuracy)
      .sort()
      .forEach(function (k) {
        var r = matchArchiveAccuracy[k];
        var pct =
          r.accuracy_pct != null
            ? r.accuracy_pct.toFixed(1) + "%"
            : r.hits != null && r.shots != null
              ? r.hits + "/" + r.shots
              : "—";
        parts.push(r.weapon + " " + pct);
      });
    root.textContent = parts.join(" · ");
  }

  var cachedMapKey = "";
  var cachedTransform = null;
  var currentImageSrc = "";
  var mapImageLoaded = false;
  var lastMapContext = { map_name: null, gametype: null, match_id: null };
  var mapDebugState = {
    lastPayload: null,
    lastWsMessage: null,
    lastWsEvent: null,
    wsFrameCount: 0,
  };
  var mapMotion = {
    byId: {},
    loopId: 0,
    renderTransform: null,
    zFloor: null,
    zCeiling: null,
    zSpanMin: 48,
    currentPlayers: [],
    currentGametype: null,
  };

  var mapHeatmap = {
    byId: {},
  };

  var mapKillFeed = [];
  var mapKillFeedDedup = [];
  var KILLFEED_DEDUP_MS = 2000;
  var KILLFEED_MAX = 5;
  var mapPickupToasts = [];
  var mapPickupLog = [];
  var pickupSpriteMap = null;
  var pickupSpriteImageCache = {};
  var pickupSpriteLoaded = {};
  var pickupSpriteBlobUrl = {};
  var pickupIconTemplates = {};
  var pickupToastLoopId = 0;
  var pickupToastSeq = 0;
  var PICKUP_TOAST_MS = 4500;
  var PICKUP_LOG_MAX = 200;
  var mapDeathMarkers = [];
  var mapLastKnownPos = {};

  function deathMarkerSec() {
    return Math.max(2, Math.min(120, Number(qs("death_sec", "4")) || 4));
  }

  var deathSpriteUrl = "";

  function ensureMapAssetsInUrl() {
    if (qs("assets")) return;
    if (!window.MapCoords || typeof MapCoords.overlayAssetsRoot !== "function") return;
    var root = MapCoords.overlayAssetsRoot();
    if (!root) return;
    var pageRoot = new URL("./", window.location.href).href;
    if (root === pageRoot) return;
    var params = new URLSearchParams(window.location.search);
    params.set("assets", root.replace(/\/+$/, ""));
    var next = window.location.pathname + "?" + params.toString();
    window.history.replaceState(null, "", next);
  }

  function resolveOverlayAsset(relative) {
    if (window.MapCoords && typeof MapCoords.assetUrl === "function") {
      return MapCoords.assetUrl(relative);
    }
    var root = "https://cdn.jsdelivr.net/gh/alexeytihomirov/ql-stream-tools@main/live-overlay/";
    return new URL(relative, root).href;
  }

  function resolveDeathSpriteUrl() {
    if (deathSpriteUrl) return deathSpriteUrl;
    deathSpriteUrl = resolveOverlayAsset("maps/sprites/medal_excellent.png");
    return deathSpriteUrl;
  }

  function fmtPickupTime(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    } catch (_e) {
      return "";
    }
  }

  var PICKUP_LABELS = {
    item_armor_jacket: "GA",
    item_armor_body: "RA",
    item_armor_combat: "YA",
    item_armor_shard: "Shard",
    item_health_small: "5hp",
    item_health_mega: "Mega",
    item_health_large: "50hp",
    item_health: "25hp",
    item_quad: "Quad",
    item_regen: "Regen",
    item_haste: "Haste",
    item_enviro: "BS",
    item_invis: "Invis",
    item_invulnerability: "Invuln",
    weapon_railgun: "Rail",
    weapon_rocketlauncher: "RL",
    weapon_lightning: "LG",
    weapon_plasmagun: "PG",
    weapon_shotgun: "SG",
    weapon_grenadelauncher: "GL",
    weapon_machinegun: "MG",
    weapon_gauntlet: "Gauntlet",
    weapon_hmg: "HMG",
    weapon_nailgun: "NG",
    weapon_chaingun: "CG",
    weapon_bfg: "BFG",
  };

  var WEAPON_EVENT_SPRITES = {
    GAUNTLET: "weapon_gauntlet",
    MACHINEGUN: "weapon_machinegun",
    MG: "weapon_machinegun",
    SHOTGUN: "weapon_shotgun",
    SG: "weapon_shotgun",
    GRENADE: "weapon_grenadelauncher",
    GRENADELAUNCHER: "weapon_grenadelauncher",
    GL: "weapon_grenadelauncher",
    ROCKET: "weapon_rocketlauncher",
    ROCKETLAUNCHER: "weapon_rocketlauncher",
    RL: "weapon_rocketlauncher",
    LIGHTNING: "weapon_lightning",
    LG: "weapon_lightning",
    RAILGUN: "weapon_railgun",
    RAIL: "weapon_railgun",
    RG: "weapon_railgun",
    PLASMA: "weapon_plasmagun",
    PLASMAGUN: "weapon_plasmagun",
    PG: "weapon_plasmagun",
    BFG: "weapon_bfg",
    HMG: "weapon_hmg",
    NAILGUN: "weapon_nailgun",
    NG: "weapon_nailgun",
    CHAINGUN: "weapon_chaingun",
    CG: "weapon_chaingun",
  };

  var WEAPON_EVENT_LABELS = {
    GAUNTLET: "Gauntlet",
    MACHINEGUN: "MG",
    MG: "MG",
    SHOTGUN: "SG",
    SG: "SG",
    GRENADE: "GL",
    GRENADELAUNCHER: "GL",
    GL: "GL",
    ROCKET: "RL",
    ROCKETLAUNCHER: "RL",
    RL: "RL",
    LIGHTNING: "LG",
    LG: "LG",
    RAILGUN: "RG",
    RAIL: "RG",
    RG: "RG",
    PLASMA: "PG",
    PLASMAGUN: "PG",
    PG: "PG",
    BFG: "BFG",
    HMG: "HMG",
    NAILGUN: "NG",
    NG: "NG",
    CHAINGUN: "CG",
    CG: "CG",
    SUICIDE: "Suicide",
    WORLD: "World",
  };

  var TEAM_KILLFEED_CLASS = {
    red: "map-killfeed-killer",
    blue: "map-killfeed-victim",
  };

  function playerDisplaySettings() {
    if (window.MapSpawns && typeof MapSpawns.getPlayerDisplay === "function") {
      return MapSpawns.getPlayerDisplay();
    }
    return {
      showFovWedge: true,
      showDirectionArrow: true,
      playerMarkerStyle: "pin",
      showPlayerHealthArmor: true,
      playerMarkerMinPx: 8,
      playerMarkerMaxPx: 14,
      playerLabelFontPx: 11,
      mapZoomPercent: 100,
    };
  }

  function heatmapSettings() {
    if (window.MapSpawns && typeof MapSpawns.getHeatmapSettings === "function") {
      return MapSpawns.getHeatmapSettings();
    }
    return {
      enabled: false,
      mode: "trail",
      durationSec: 30,
      opacity: 0.45,
      showSelf: true,
      showOpponent: true,
      showOther: true,
      playerHidden: {},
      selfColor: "#3b82f6",
      opponentColor: "#ef4444",
      otherColor: "#f97316",
    };
  }

  function playerColorSettings() {
    if (window.MapSpawns && typeof MapSpawns.getPlayerColors === "function") {
      return MapSpawns.getPlayerColors();
    }
    return {
      selfColor: "#3b82f6",
      opponentColor: "#ef4444",
      otherColor: "#f97316",
    };
  }

  function resolveReferencePlayerId(players) {
    if (window.MapSpawns && typeof MapSpawns.resolveReferencePlayerId === "function") {
      return MapSpawns.resolveReferencePlayerId(players);
    }
    return null;
  }

  function normalizeGametypeLabel(gametype) {
    return String(gametype || "")
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "");
  }

  function countRenderablePlayers(players) {
    var list = normalizePlayersList(players);
    var count = 0;
    for (var i = 0; i < list.length; i++) {
      if (playerShouldRenderOnMap(list[i])) count++;
    }
    return count;
  }

  function isDuelLikeContext(players, gametype) {
    if (normalizeGametypeLabel(gametype) === "duel") return true;
    return countRenderablePlayers(players) === 2;
  }

  function playerMarkerRole(playerId, players, gametype) {
    if (!isDuelLikeContext(players, gametype)) return "other";
    var refId = resolveReferencePlayerId(players);
    if (!refId) return "other";
    if (playerId === refId) return "self";
    return "opponent";
  }

  function colorForPlayerRole(role) {
    var colors = playerColorSettings();
    if (role === "self") return colors.selfColor;
    if (role === "opponent") return colors.opponentColor;
    return colors.otherColor;
  }

  function colorWithAlpha(color, alpha) {
    var c = String(color || "#f97316").trim();
    if (c.indexOf("rgba(") === 0) return c;
    if (c.indexOf("rgb(") === 0) {
      return c.replace("rgb(", "rgba(").replace(")", ", " + alpha + ")");
    }
    if (c.charAt(0) === "#" && c.length >= 7) {
      var r = parseInt(c.slice(1, 3), 16);
      var g = parseInt(c.slice(3, 5), 16);
      var b = parseInt(c.slice(5, 7), 16);
      if (!isFinite(r) || !isFinite(g) || !isFinite(b)) return c;
      return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
    }
    return c;
  }

  function clampHeatmapDurationSec(sec) {
    return Math.max(5, Math.min(120, Number(sec) || 30));
  }

  function clampHeatmapOpacityValue(op) {
    var n = Number(op);
    if (!isFinite(n)) return 0.45;
    return Math.max(0.05, Math.min(1, n));
  }

  function clearHeatmap() {
    mapHeatmap.byId = {};
    var canvas = document.getElementById("map-heatmap");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.classList.add("hidden");
  }

  function resetMatchOverlayState(reason, payload) {
    clearHeatmap();
    mapDeathMarkers = [];
    var deathLayer = document.getElementById("map-deaths");
    if (deathLayer) deathLayer.innerHTML = "";
    mapKillFeed = [];
    mapKillFeedDedup = [];
    renderKillFeed();
    if (reason === "match_end" || reason === "replay_seek") {
      mapPickupLog = [];
      renderPickupLog();
    }
    if (window.MapSpawns && typeof MapSpawns.resetMatchState === "function") {
      MapSpawns.resetMatchState();
    }
    if (payload && payload.match_id) {
      lastMapContext.match_id = payload.match_id;
    }
    if (payload && payload.map_name) {
      lastMapContext._overlay_map = payload.map_name;
    }
  }

  function heatmapTeleportJump(fromX, fromY, toX, toY) {
    if (
      window.MapSpawns &&
      typeof MapSpawns.isHeatmapTeleportJump === "function"
    ) {
      return MapSpawns.isHeatmapTeleportJump(fromX, fromY, toX, toY);
    }
    return heatmapDistSq(fromX, fromY, toX, toY) >= 512 * 512;
  }

  function heatmapDistSq(ax, ay, bx, by) {
    var dx = Number(ax) - Number(bx);
    var dy = Number(ay) - Number(by);
    return dx * dx + dy * dy;
  }

  function heatmapVisibleForPlayer(id, players, gametype, settings) {
    if (
      window.MapSpawns &&
      typeof MapSpawns.heatmapPlayerVisible === "function"
    ) {
      return MapSpawns.heatmapPlayerVisible(id, players, gametype);
    }
    if (settings.playerHidden && settings.playerHidden[id]) return false;
    return true;
  }

  function recordHeatmapPositions(players, gametype) {
    var settings = heatmapSettings();
    var now = overlayNowMs();
    var isAggregate = settings.mode === "aggregate";
    var maxAge = isAggregate
      ? 0
      : clampHeatmapDurationSec(settings.durationSec) * 1000;
    var minDistSq = 12 * 12;
    var minStepMs = 80;
    var list = normalizePlayersList(players);
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!playerShouldRenderOnMap(p)) continue;
      var id = playerMotionId(p, i);
      if (!mapHeatmap.byId[id]) mapHeatmap.byId[id] = [];
      var trail = mapHeatmap.byId[id];
      var last = trail.length ? trail[trail.length - 1] : null;
      var dx = last ? Number(p.x) - last.x : minDistSq + 1;
      var dy = last ? Number(p.y) - last.y : 0;
      if (
        !last ||
        dx * dx + dy * dy >= minDistSq ||
        now - last.t >= minStepMs
      ) {
        trail.push({
          x: Number(p.x),
          y: Number(p.y),
          t: now,
          breakBefore:
            !!last &&
            heatmapTeleportJump(last.x, last.y, Number(p.x), Number(p.y)),
        });
      }
    }
    if (isAggregate) {
      if (settings.enabled) renderHeatmap(players, gametype);
      return;
    }
    var ids = Object.keys(mapHeatmap.byId);
    for (var j = 0; j < ids.length; j++) {
      var keptTrail = mapHeatmap.byId[ids[j]];
      var kept = [];
      for (var k = 0; k < keptTrail.length; k++) {
        if (now - keptTrail[k].t <= maxAge) kept.push(keptTrail[k]);
      }
      if (kept.length) mapHeatmap.byId[ids[j]] = kept;
      else delete mapHeatmap.byId[ids[j]];
    }
    if (settings.enabled) renderHeatmap(players, gametype);
  }

  function heatmapTrailAlpha(baseOpacity, age, maxAge, mode) {
    if (mode === "aggregate") {
      return baseOpacity * 0.28;
    }
    var fade = 1 - age / Math.max(1, maxAge);
    return baseOpacity * fade * fade;
  }

  function drawHeatmapTrail(ctx, trail, transform, wrap, color, baseOpacity, maxAge, now, mode) {
    if (!trail.length) return;
    if (trail.length === 1 || mode === "aggregate") {
      for (var j = 0; j < trail.length; j++) {
        var pt = trail[j];
        var age = now - pt.t;
        if (mode !== "aggregate" && age > maxAge) continue;
        var pos = worldToDisplayPos(transform, wrap, pt.x, pt.y);
        if (!pos) continue;
        ctx.beginPath();
        ctx.fillStyle = colorWithAlpha(color, heatmapTrailAlpha(baseOpacity, age, maxAge, mode));
        ctx.arc(pos.x, pos.y, mode === "aggregate" ? 2.5 : 3, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (var i = 0; i < trail.length - 1; i++) {
      var a = trail[i];
      var b = trail[i + 1];
      if (b.breakBefore) continue;
      var ageB = now - b.t;
      if (ageB > maxAge) continue;
      var posA = worldToDisplayPos(transform, wrap, a.x, a.y);
      var posB = worldToDisplayPos(transform, wrap, b.x, b.y);
      if (!posA || !posB) continue;
      var dist = Math.hypot(posB.x - posA.x, posB.y - posA.y);
      var steps = Math.max(2, Math.ceil(dist / 6));
      for (var s = 0; s < steps; s++) {
        var t0 = s / steps;
        var t1 = (s + 1) / steps;
        var x0 = posA.x + (posB.x - posA.x) * t0;
        var y0 = posA.y + (posB.y - posA.y) * t0;
        var x1 = posA.x + (posB.x - posA.x) * t1;
        var y1 = posA.y + (posB.y - posA.y) * t1;
        var timeMid = a.t + (b.t - a.t) * ((t0 + t1) * 0.5);
        var age = now - timeMid;
        if (age > maxAge) continue;
        ctx.beginPath();
        ctx.strokeStyle = colorWithAlpha(
          color,
          heatmapTrailAlpha(baseOpacity, age, maxAge, mode),
        );
        ctx.lineWidth = 4;
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    }
  }

  function renderHeatmap(players, gametype) {
    var settings = heatmapSettings();
    var canvas = document.getElementById("map-heatmap");
    var wrap = document.getElementById("map-wrap");
    var transform = mapMotion.renderTransform || cachedTransform;
    if (!canvas || !wrap || !transform) return;

    if (!settings.enabled) {
      canvas.classList.add("hidden");
      return;
    }
    canvas.classList.remove("hidden");

    var w = wrap.clientWidth;
    var h = wrap.clientHeight;
    if (w <= 0 || h <= 0) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    var playerList = players || mapMotion.currentPlayers || [];
    var gt = gametype != null ? gametype : mapMotion.currentGametype;
    var now = overlayNowMs();
    var isAggregate = settings.mode === "aggregate";
    var maxAge = isAggregate
      ? Number.MAX_SAFE_INTEGER
      : clampHeatmapDurationSec(settings.durationSec) * 1000;
    var baseOpacity = clampHeatmapOpacityValue(settings.opacity);
    if (isAggregate) {
      ctx.globalCompositeOperation = "lighter";
    }
    var ids = Object.keys(mapHeatmap.byId);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (!heatmapVisibleForPlayer(id, playerList, gt, settings)) continue;
      var trail = mapHeatmap.byId[id];
      var color = colorForPlayerRole(playerMarkerRole(id, playerList, gt));
      drawHeatmapTrail(
        ctx,
        trail,
        transform,
        wrap,
        color,
        baseOpacity,
        maxAge,
        now,
        isAggregate ? "aggregate" : "trail",
      );
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function applyPlayerMarkerStyle(el, playerId, players, gametype) {
    if (!el || !el.dot || !el.marker) return;
    var role = playerMarkerRole(playerId, players, gametype);
    var color = colorForPlayerRole(role);
    el.dot.style.background = color;
    if (el.pinFill) el.pinFill.setAttribute("fill", color);
    if (el.pinSpike) el.pinSpike.setAttribute("fill", color);
    el.marker.classList.remove("map-marker--self", "map-marker--opponent", "map-marker--other");
    el.marker.classList.add("map-marker--" + role);
    if (isDuelLikeContext(players, gametype) && el.view) {
      el.view.style.setProperty("--map-view-color-end", color);
      el.view.style.setProperty("--map-view-head-color", color);
    } else if (el.view) {
      el.view.style.removeProperty("--map-view-color-end");
      el.view.style.removeProperty("--map-view-head-color");
    }
  }

  function refreshPlayerMarkerColors() {
    var players = mapMotion.currentPlayers || [];
    var gametype = mapMotion.currentGametype;
    var ids = Object.keys(mapMotion.byId);
    for (var i = 0; i < ids.length; i++) {
      var st = mapMotion.byId[ids[i]];
      applyPlayerMarkerStyle(st.el, ids[i], players, gametype);
    }
    renderHeatmap(players, gametype);
  }

  function normalizeWeaponToken(value) {
    return String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
  }

  function weaponSpriteClassname(weapon) {
    var key = normalizeWeaponToken(weapon);
    if (!key) return "";
    if (WEAPON_EVENT_SPRITES[key]) return WEAPON_EVENT_SPRITES[key];
    if (key.indexOf("WEAPON_") === 0) return key.toLowerCase();
    return "";
  }

  function weaponLabel(weapon) {
    var key = normalizeWeaponToken(weapon);
    if (!key) return "";
    if (WEAPON_EVENT_LABELS[key]) return WEAPON_EVENT_LABELS[key];
    return key.replace(/_/g, " ");
  }

  function killfeedTeamClass(team, fallback) {
    var t = String(team || "")
      .trim()
      .toLowerCase();
    return TEAM_KILLFEED_CLASS[t] || fallback || "";
  }

  function killfeedDedupKey(row) {
    var victim = row.victim_steam_id64 || stripQuakeColors(row.victim_name) || "?";
    var killer = row.killer_steam_id64 || stripQuakeColors(row.killer_name) || "";
    return victim + "|" + killer;
  }

  function pruneKillfeedDedup(now) {
    var kept = [];
    for (var i = 0; i < mapKillFeedDedup.length; i++) {
      if (now - mapKillFeedDedup[i].at <= KILLFEED_DEDUP_MS) {
        kept.push(mapKillFeedDedup[i]);
      }
    }
    mapKillFeedDedup = kept;
  }

  function isDuplicateKillFeed(entry) {
    var now = overlayNowMs();
    pruneKillfeedDedup(now);
    var key = killfeedDedupKey(entry);
    for (var i = 0; i < mapKillFeedDedup.length; i++) {
      if (mapKillFeedDedup[i].key === key) return true;
    }
    mapKillFeedDedup.push({ key: key, at: now });
    return false;
  }

  function pickupLabel(item) {
    return PICKUP_LABELS[item] || String(item || "item").replace(/^item_/, "");
  }

  function pickupSpriteUrl(item) {
    if (!item || !pickupSpriteMap) return "";
    var classnames = pickupSpriteMap.classnames || pickupSpriteMap;
    var rel = classnames[item];
    if (!rel) return "";
    if (window.MapCoords && typeof MapCoords.assetUrl === "function") {
      return MapCoords.assetUrl(rel);
    }
    return rel;
  }

  function loadPickupSpriteImage(url) {
    if (!url) return Promise.resolve(null);
    if (pickupSpriteBlobUrl[url] && pickupSpriteLoaded[url]) {
      return Promise.resolve(pickupSpriteLoaded[url]);
    }
    if (pickupSpriteImageCache[url]) return pickupSpriteImageCache[url];
    pickupSpriteImageCache[url] = fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error("sprite HTTP " + res.status);
        return res.blob();
      })
      .then(function (blob) {
        pickupSpriteBlobUrl[url] = URL.createObjectURL(blob);
        return new Promise(function (resolve) {
          var img = new Image();
          img.onload = function () {
            pickupSpriteLoaded[url] = img;
            ensurePickupIconTemplate(url);
            resolve(img);
          };
          img.onerror = function () {
            resolve(null);
          };
          img.src = pickupSpriteBlobUrl[url];
        });
      })
      .catch(function () {
        delete pickupSpriteImageCache[url];
        return null;
      });
    return pickupSpriteImageCache[url];
  }

  function preloadPickupSprites() {
    if (!pickupSpriteMap) return;
    var classnames = pickupSpriteMap.classnames || pickupSpriteMap;
    for (var key in classnames) {
      if (!Object.prototype.hasOwnProperty.call(classnames, key)) continue;
      var url = pickupSpriteUrl(key);
      if (url) loadPickupSpriteImage(url);
    }
    var deathUrl = resolveDeathSpriteUrl();
    if (deathUrl) loadPickupSpriteImage(deathUrl);
  }

  function ensurePickupIconTemplate(url) {
    if (!url || !pickupSpriteBlobUrl[url]) return null;
    if (pickupIconTemplates[url]) return pickupIconTemplates[url];
    var img = document.createElement("img");
    img.src = pickupSpriteBlobUrl[url];
    img.setAttribute("data-sprite-url", url);
    pickupIconTemplates[url] = img;
    return img;
  }

  function appendPickupIcon(parent, item, iconClass) {
    var icon = document.createElement("img");
    icon.className = iconClass || "map-pickup-icon";
    icon.alt = pickupLabel(item);
    var url = pickupSpriteUrl(item);
    if (!url) {
      icon.style.display = "none";
      parent.appendChild(icon);
      return icon;
    }
    var template = ensurePickupIconTemplate(url);
    if (template) {
      icon.src = template.src;
      icon.setAttribute("data-sprite-url", url);
      parent.appendChild(icon);
      return icon;
    }
    parent.appendChild(icon);
    loadPickupSpriteImage(url).then(function (cached) {
      if (!cached || !icon.parentNode) return;
      if (icon.getAttribute("data-sprite-url") === url) return;
      ensurePickupIconTemplate(url);
      icon.src = pickupSpriteBlobUrl[url];
      icon.setAttribute("data-sprite-url", url);
    });
    return icon;
  }

  function loadPickupSpriteMap() {
    if (pickupSpriteMap) {
      preloadPickupSprites();
      return Promise.resolve(pickupSpriteMap);
    }
    var url = resolveOverlayAsset("maps/sprite-map.json");
    return fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error("sprite-map HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        pickupSpriteMap = data || { classnames: {} };
        preloadPickupSprites();
        return pickupSpriteMap;
      })
      .catch(function () {
        pickupSpriteMap = { classnames: {} };
        return pickupSpriteMap;
      });
  }

  function prunePickupToasts() {
    var now = overlayNowMs();
    var kept = [];
    var el = document.getElementById("map-pickups");
    for (var i = 0; i < mapPickupToasts.length; i++) {
      var toast = mapPickupToasts[i];
      if (toast.expiresAt > now) {
        kept.push(toast);
        continue;
      }
      if (el) {
        var expired = el.querySelector(
          ".map-pickup-line[data-toast-id=\"" + toast.id + "\"]",
        );
        if (expired && expired.parentNode) expired.parentNode.removeChild(expired);
      }
    }
    mapPickupToasts = kept;
  }

  function updatePickupToastFade() {
    var el = document.getElementById("map-pickups");
    if (!el || hudSettings().showPickupToasts === false) return;
    var now = overlayNowMs();
    var children = el.children;
    for (var i = 0; i < mapPickupToasts.length && i < children.length; i++) {
      children[i].classList.toggle("is-fading", now >= mapPickupToasts[i].fadeAt);
    }
  }

  function ensurePickupToastLoop() {
    if (pickupToastLoopId) return;
    function frame() {
      prunePickupToasts();
      updatePickupToastFade();
      if (mapPickupToasts.length) {
        pickupToastLoopId = requestAnimationFrame(frame);
      } else {
        pickupToastLoopId = 0;
        var el = document.getElementById("map-pickups");
        if (el) el.innerHTML = "";
      }
    }
    pickupToastLoopId = requestAnimationFrame(frame);
  }

  function appendPickupToastRow(toast) {
    var el = document.getElementById("map-pickups");
    if (!el || hudSettings().showPickupToasts === false || !toast) return;
    var row = toast.data;
    var line = document.createElement("div");
    line.className = "map-pickup-line";
    line.setAttribute("data-toast-id", String(toast.id));
    if (overlayNowMs() >= toast.fadeAt) line.classList.add("is-fading");
    appendPickupIcon(line, row.item, "map-pickup-icon");
    var text = document.createElement("span");
    text.className = "map-pickup-text";
    var who = stripQuakeColors(row.player || row.nickname || row.steam_id64 || "?");
    var when = fmtPickupTime(row.time);
    text.textContent =
      who + " · " + pickupLabel(row.item) + (when ? " · " + when : "");
    line.appendChild(text);
    el.insertBefore(line, el.firstChild);
    while (el.children.length > mapPickupToasts.length) {
      el.removeChild(el.lastChild);
    }
  }

  function hudSettings() {
    if (window.MapSpawns && typeof MapSpawns.getHudSettings === "function") {
      return MapSpawns.getHudSettings();
    }
    return { showKillfeed: true, showPickupToasts: true };
  }

  function pushPickupLog(entry) {
    mapPickupLog.unshift({
      item: entry.item,
      player: entry.player || entry.nickname || entry.steam_id64 || "?",
      time: entry.time || null,
      loggedAt: overlayNowMs(),
    });
    if (mapPickupLog.length > PICKUP_LOG_MAX) {
      mapPickupLog.length = PICKUP_LOG_MAX;
    }
    appendPickupLogRow(mapPickupLog[0]);
  }

  function appendPickupLogRow(row) {
    var list = document.getElementById("map-pickup-log-list");
    if (!list || !row) return;
    var line = document.createElement("div");
    line.className = "map-pickup-log-line";
    appendPickupIcon(line, row.item, "map-pickup-log-icon");
    var text = document.createElement("span");
    text.className = "map-pickup-log-text";
    var who = stripQuakeColors(row.player || "?");
    var when = fmtPickupTime(row.time);
    text.textContent =
      who + " · " + pickupLabel(row.item) + (when ? " · " + when : "");
    line.appendChild(text);
    list.insertBefore(line, list.firstChild);
    while (list.children.length > PICKUP_LOG_MAX) {
      list.removeChild(list.lastChild);
    }
  }

  function pushPickupToast(entry) {
    pickupToastSeq += 1;
    var now = overlayNowMs();
    mapPickupToasts.unshift({
      id: pickupToastSeq,
      data: entry,
      expiresAt: now + PICKUP_TOAST_MS,
      fadeAt: now + PICKUP_TOAST_MS - 700,
    });
    if (mapPickupToasts.length > 6) mapPickupToasts.length = 6;
    appendPickupToastRow(mapPickupToasts[0]);
    ensurePickupToastLoop();
  }

  function renderPickupLog() {
    var list = document.getElementById("map-pickup-log-list");
    if (!list) return;
    list.innerHTML = "";
    for (var i = 0; i < mapPickupLog.length; i++) {
      var row = mapPickupLog[i];
      var line = document.createElement("div");
      line.className = "map-pickup-log-line";
      appendPickupIcon(line, row.item, "map-pickup-log-icon");
      var text = document.createElement("span");
      text.className = "map-pickup-log-text";
      var who = stripQuakeColors(row.player || "?");
      var when = fmtPickupTime(row.time);
      text.textContent =
        who + " · " + pickupLabel(row.item) + (when ? " · " + when : "");
      line.appendChild(text);
      list.appendChild(line);
    }
  }

  function setPickupLogOpen(open) {
    var panel = document.getElementById("map-pickup-log");
    if (!panel) return;
    panel.classList.toggle("hidden", !open);
    document.body.classList.toggle("map-pickup-log-open", !!open);
  }

  function initPickupLogUi() {
    var btn = document.getElementById("map-pickup-log-btn");
    var closeBtn = document.getElementById("map-pickup-log-close");
    if (btn) {
      btn.classList.remove("hidden");
      btn.addEventListener("click", function () {
        var panel = document.getElementById("map-pickup-log");
        setPickupLogOpen(panel && panel.classList.contains("hidden"));
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        setPickupLogOpen(false);
      });
    }
    loadPickupSpriteMap().then(function () {
      renderPickupLog();
    });
  }

  function pushPickupFeed(entry) {
    pushPickupLog(entry);
    if (hudSettings().showPickupToasts !== false) {
      pushPickupToast(entry);
    }
  }

  function renderPickupFeed() {
    var el = document.getElementById("map-pickups");
    if (!el) return;
    if (hudSettings().showPickupToasts === false) {
      el.innerHTML = "";
      return;
    }
    prunePickupToasts();
    el.innerHTML = "";
    var now = overlayNowMs();
    for (var i = 0; i < mapPickupToasts.length; i++) {
      var toast = mapPickupToasts[i];
      var row = toast.data;
      var line = document.createElement("div");
      line.className = "map-pickup-line";
      if (now >= toast.fadeAt) line.classList.add("is-fading");
      appendPickupIcon(line, row.item, "map-pickup-icon");
      var text = document.createElement("span");
      text.className = "map-pickup-text";
      var who = stripQuakeColors(row.player || row.nickname || row.steam_id64 || "?");
      var when = fmtPickupTime(row.time);
      text.textContent =
        who + " · " + pickupLabel(row.item) + (when ? " · " + when : "");
      line.appendChild(text);
      el.appendChild(line);
    }
  }

  var pickupListeners = [];

  function notifyPickup(data) {
    for (var i = 0; i < pickupListeners.length; i++) {
      try {
        pickupListeners[i](data);
      } catch (err) {
        if (typeof console !== "undefined" && console.warn) {
          console.warn("[overlay] pickup hook failed", err);
        }
      }
    }
  }

  function handlePickupEvent(data) {
    if (!data || typeof data !== "object") return;
    recordClientPickup(data);
    if (String(data.action || "pickup").toLowerCase() === "drop") return;
    pushPickupFeed(data);
    notifyPickup(data);
    if (debugPickups() && typeof console !== "undefined" && console.info) {
      console.info(
        "[pickup-debug] source=%s entity_id=%s item=%s action=%s match=%s",
        data.source || "?",
        data.entity_id != null ? data.entity_id : "?",
        data.item || "?",
        data.action || "pickup",
        data.match_id || "?",
        data,
      );
    }
  }

  function pushKillFeed(entry) {
    if (hudSettings().showKillfeed === false) return;
    if (isDuplicateKillFeed(entry)) return;
    mapKillFeed.unshift(entry);
    if (mapKillFeed.length > KILLFEED_MAX) mapKillFeed.length = KILLFEED_MAX;
    renderKillFeed();
  }

  function renderKillFeed() {
    var el = document.getElementById("map-killfeed");
    if (!el) return;
    if (hudSettings().showKillfeed === false) {
      el.innerHTML = "";
      el.classList.add("hidden");
      return;
    }
    el.classList.remove("hidden");
    el.innerHTML = "";
    for (var i = 0; i < mapKillFeed.length; i++) {
      var row = mapKillFeed[i];
      var line = document.createElement("div");
      line.className = "map-killfeed-line";

      var killerId = row.killer_steam_id64 || "";
      var victimId = row.victim_steam_id64 || "";
      var killer = stripQuakeColors(row.killer_name || killerId || "");
      var victim = stripQuakeColors(row.victim_name || victimId || "?");
      var suicide =
        !killer ||
        killerId === victimId ||
        normalizeWeaponToken(row.weapon) === "SUICIDE";

      var spriteClass = weaponSpriteClassname(row.weapon);
      if (spriteClass) {
        appendPickupIcon(line, spriteClass, "map-killfeed-weapon");
      } else if (row.weapon) {
        var weaponText = document.createElement("span");
        weaponText.className = "map-killfeed-weapon-text";
        weaponText.textContent = weaponLabel(row.weapon);
        line.appendChild(weaponText);
      }

      var names = document.createElement("span");
      names.className = "map-killfeed-names";
      if (suicide) {
        var victimSpan = document.createElement("span");
        victimSpan.className = killfeedTeamClass(row.victim_team, "map-killfeed-victim");
        victimSpan.textContent = victim;
        names.appendChild(victimSpan);
        var diedText = document.createElement("span");
        diedText.textContent = " died";
        names.appendChild(diedText);
      } else {
        var killerSpan = document.createElement("span");
        killerSpan.className = killfeedTeamClass(row.killer_team, "map-killfeed-killer");
        killerSpan.textContent = killer;
        names.appendChild(killerSpan);
        var sep = document.createElement("span");
        sep.className = "map-killfeed-sep";
        sep.textContent = " → ";
        names.appendChild(sep);
        var victimSpan2 = document.createElement("span");
        victimSpan2.className = killfeedTeamClass(row.victim_team, "map-killfeed-victim");
        victimSpan2.textContent = victim;
        names.appendChild(victimSpan2);
      }
      line.appendChild(names);
      el.appendChild(line);
    }
  }

  function rememberPlayerPositions(players) {
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      var sid = normalizeSteamId64(p.steam_id64);
      if (!sid || p.x == null || p.y == null) continue;
      mapLastKnownPos[sid] = {
        x: Number(p.x),
        y: Number(p.y),
        z: p.z != null ? Number(p.z) : null,
        nickname: p.nickname,
      };
    }
  }

  function deathPositionFromEvent(data) {
    if (data.x != null && data.y != null) {
      return {
        x: Number(data.x),
        y: Number(data.y),
        z: data.z != null ? Number(data.z) : null,
      };
    }
    var sid = normalizeSteamId64(data.victim_steam_id64);
    if (sid && mapLastKnownPos[sid]) {
      var row = mapLastKnownPos[sid];
      return { x: row.x, y: row.y, z: row.z };
    }
    return null;
  }

  function pruneDeathMarkers() {
    var now = overlayNowMs();
    var layer = document.getElementById("map-deaths");
    if (!layer) return;
    var kept = [];
    for (var i = 0; i < mapDeathMarkers.length; i++) {
      var row = mapDeathMarkers[i];
      if (row.expiresAt <= now) {
        if (row.el && row.el.parentNode) row.el.parentNode.removeChild(row.el);
        continue;
      }
      kept.push(row);
    }
    mapDeathMarkers = kept;
    if (!mapDeathMarkers.length) layer.innerHTML = "";
  }

  function renderDeathMarkers() {
    var layer = document.getElementById("map-deaths");
    var wrap = document.getElementById("map-wrap");
    var transform = mapMotion.renderTransform || cachedTransform;
    if (!layer || !wrap || !transform) return;
    pruneDeathMarkers();
    var now = overlayNowMs();
    for (var i = 0; i < mapDeathMarkers.length; i++) {
      var row = mapDeathMarkers[i];
      if (!row.el) {
        var marker = document.createElement("div");
        marker.className = "map-death-marker map-death-marker-sprite";
        marker.setAttribute("aria-hidden", "true");
        var deathImg = document.createElement("img");
        deathImg.className = "map-death-marker-img";
        deathImg.src = resolveDeathSpriteUrl();
        deathImg.alt = "";
        marker.appendChild(deathImg);
        marker.title = stripQuakeColors(
          row.victim_name || row.victim_steam_id64 || "death",
        );
        layer.appendChild(marker);
        row.el = marker;
      }
      var pos = worldToDisplayPos(transform, wrap, row.x, row.y);
      if (!pos) continue;
      var life = row.expiresAt - now;
      var fadeStart = Math.min(3000, deathMarkerSec() * 1000 * 0.35);
      var opacity =
        life <= fadeStart ? Math.max(0.2, life / Math.max(1, fadeStart)) : 0.72;
      row.el.style.left = pos.x + "px";
      row.el.style.top = pos.y + "px";
      row.el.style.opacity = String(opacity);
    }
  }

  function addDeathMarker(data) {
    var pos = deathPositionFromEvent(data);
    if (!pos) return;
    var layer = document.getElementById("map-deaths");
    if (!layer) return;
    var ttl = deathMarkerSec() * 1000;
    mapDeathMarkers.push({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      victim_name: data.victim_name,
      victim_steam_id64: data.victim_steam_id64,
      expiresAt: overlayNowMs() + ttl,
      el: null,
    });
    renderDeathMarkers();
  }

  function handleDeathEvent(data) {
    recordClientDeath(data);
    pushKillFeed(data);
    addDeathMarker(data);
    if (typeof console !== "undefined" && console.info) {
      console.info("[overlay] death", data);
    }
  }

  function stripQuakeColors(text) {
    return String(text || "")
      .replace(/\^[0-9a-zA-Z]/g, "")
      .trim();
  }

  function fmtCoord(v) {
    if (v == null) return "?";
    return Math.round(Number(v) * 10) / 10;
  }

  function lerpNum(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpYaw(a, b, t) {
    var delta = ((b - a + 540) % 360) - 180;
    return a + delta * t;
  }

  function defaultMapFov() {
    return Math.max(70, Math.min(130, Number(qs("fov", "100")) || 100));
  }

  function fovConeLengthPx() {
    var display = playerDisplaySettings();
    if (display.viewLengthPx != null) {
      return Math.max(36, Math.min(140, Number(display.viewLengthPx) || 80));
    }
    return Math.max(36, Math.min(140, Number(qs("fov_px", "80")) || 80));
  }

  function fovWedgePath(fovDeg, length) {
    var half = ((fovDeg || 100) * Math.PI) / 360;
    var x1 = Math.cos(-half) * length;
    var y1 = Math.sin(-half) * length;
    var x2 = Math.cos(half) * length;
    var y2 = Math.sin(half) * length;
    return "M 0 0 L " + x1 + " " + y1 + " L " + x2 + " " + y2 + " Z";
  }

  function cloneWorldPose(p) {
    return {
      x: p.x,
      y: p.y,
      z: p.z != null ? p.z : null,
      yaw: p.yaw != null ? p.yaw : null,
      fov: p.fov != null ? p.fov : null,
    };
  }

  function noteZExtent(z) {
    if (z == null || !isFinite(Number(z))) return;
    var v = Number(z);
    if (mapMotion.zFloor == null || v < mapMotion.zFloor) {
      mapMotion.zFloor = v;
    }
    if (mapMotion.zCeiling == null || v > mapMotion.zCeiling) {
      mapMotion.zCeiling = v;
    }
  }

  function dotSizeFromZ(z, display) {
    display = display || playerDisplaySettings();
    var base =
      display.playerMarkerMinPx != null ? Number(display.playerMarkerMinPx) : 8;
    var maxPx =
      display.playerMarkerMaxPx != null ? Number(display.playerMarkerMaxPx) : 14;
    if (!isFinite(base)) base = 8;
    if (!isFinite(maxPx)) maxPx = 14;
    if (maxPx < base) maxPx = base;
    var extra = maxPx - base;
    if (z == null) return base;
    var floor = mapMotion.zFloor;
    var ceil = mapMotion.zCeiling;
    if (floor == null || ceil == null) return base;
    var span = ceil - floor;
    if (span < mapMotion.zSpanMin) {
      return base + extra * 0.5;
    }
    var t = Math.max(0, Math.min(1, (Number(z) - floor) / span));
    return base + t * extra;
  }

  function directionalPinGeometry(r) {
    var cosA = Math.cos(Math.PI / 4);
    var sinA = Math.sin(Math.PI / 4);
    var cx = r * cosA;
    var cyTop = -r * sinA;
    var cyBot = r * sinA;
    var tipX = r / cosA;
    var f = function (n) {
      return Number(n).toFixed(3);
    };
    var outline =
      "M " +
      f(cx) +
      " " +
      f(cyTop) +
      " A " +
      f(r) +
      " " +
      f(r) +
      " 0 1 0 " +
      f(cx) +
      " " +
      f(cyBot) +
      " L " +
      f(tipX) +
      " 0 L " +
      f(cx) +
      " " +
      f(cyTop);
    var spikeFill =
      "M " +
      f(tipX) +
      " 0 L " +
      f(cx) +
      " " +
      f(cyTop) +
      " L " +
      f(cx) +
      " " +
      f(cyBot) +
      " Z";
    return { outline: outline, spikeFill: spikeFill, tipX: tipX };
  }

  function pinLayoutForDotSize(dotSize) {
    var r = dotSize / 2;
    var geom = directionalPinGeometry(r);
    var pad = 2;
    var extent = geom.tipX + pad;
    return {
      r: r,
      viewBox:
        (-extent).toFixed(1) +
        " " +
        (-extent).toFixed(1) +
        " " +
        (extent * 2).toFixed(1) +
        " " +
        (extent * 2).toFixed(1),
      sizePx: Math.ceil(extent * 2),
      strokeWidth: Math.max(1.5, dotSize * 0.22),
      outline: geom.outline,
      spikeFill: geom.spikeFill,
    };
  }

  function playerMotionId(p, index) {
    var steam = normalizeSteamId64(p.steam_id64);
    if (steam) return steam;
    return String(p.nickname || "p" + index);
  }

  function normalizeSteamId64(value) {
    if (value == null || value === "") return "";
    if (typeof value === "number" && isFinite(value)) {
      return String(Math.trunc(value));
    }
    var text = String(value).trim();
    if (!text) return "";
    if (text.indexOf(".") >= 0) text = text.split(".", 1)[0];
    return text;
  }

  function playerShouldRenderOnMap(p) {
    if (!p) return false;
    if (p.connected === false || p.online === false) return false;
    if (p.alive === false) return false;
    var team = String(p.team || "")
      .trim()
      .toLowerCase();
    if (team === "spectator" || team === "spec") return false;
    if (p.x == null || p.y == null) return false;
    return true;
  }

  function normalizePlayersList(raw) {
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [];
  }

  function prunePlayerMarkers(layer, seen) {
    for (var key in mapMotion.byId) {
      if (seen[key]) continue;
      var gone = mapMotion.byId[key];
      if (gone.el && gone.el.marker && gone.el.marker.parentNode) {
        gone.el.marker.parentNode.removeChild(gone.el.marker);
      }
      delete mapMotion.byId[key];
    }
    if (!Object.keys(mapMotion.byId).length) {
      stopMotionLoop();
    }
  }

  function stopMotionLoop() {
    if (mapMotion.loopId) {
      cancelAnimationFrame(mapMotion.loopId);
      mapMotion.loopId = 0;
    }
  }

  function clearMapMotion() {
    stopMotionLoop();
    for (var id in mapMotion.byId) {
      var st = mapMotion.byId[id];
      if (st.el.marker && st.el.marker.parentNode)
        st.el.marker.parentNode.removeChild(st.el.marker);
    }
    mapMotion.byId = {};
    mapMotion.renderTransform = null;
    mapMotion.zFloor = null;
    mapMotion.zCeiling = null;
    mapMotion.currentPlayers = [];
    mapMotion.currentGametype = null;
    clearHeatmap();
  }

  function playerLabelText(p, display) {
    display = display || playerDisplaySettings();
    var base = stripQuakeColors(p.nickname || p.steam_id64 || "");
    var powerupSuffix =
      p.powerups && p.powerups.length ? " · " + p.powerups.join("+") : "";
    if (display.showPlayerHealthArmor === false || p.health == null) {
      if (!base && !powerupSuffix) return "";
      return base + powerupSuffix;
    }
    var hp = Math.round(Number(p.health));
    if (!isFinite(hp)) return base + powerupSuffix;
    var ar =
      p.armor != null && isFinite(Number(p.armor))
        ? Math.round(Number(p.armor))
        : 0;
    return base + " [" + hp + "/" + ar + "]" + powerupSuffix;
  }

  function createPlayerElements(layer, p) {
    var marker = document.createElement("div");
    marker.className = "map-marker";
    var label = document.createElement("div");
    label.className = "map-label";
    var labelText = playerLabelText(p);
    label.textContent = labelText;
    if (!labelText) label.style.display = "none";
    var display = playerDisplaySettings();
    var fontPx =
      display.playerLabelFontPx != null ? Number(display.playerLabelFontPx) : 11;
    if (isFinite(fontPx)) {
      label.style.fontSize = fontPx + "px";
    }
    var dot = document.createElement("div");
    dot.className = "map-dot";
    var pin = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    pin.setAttribute("class", "map-pin");
    pin.setAttribute("aria-hidden", "true");
    var pinFill = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    pinFill.setAttribute("class", "map-pin-fill");
    pinFill.setAttribute("cx", "0");
    pinFill.setAttribute("cy", "0");
    var pinSpike = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pinSpike.setAttribute("class", "map-pin-spike");
    var pinOutline = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pinOutline.setAttribute("class", "map-pin-outline");
    pinOutline.setAttribute("fill", "none");
    pin.appendChild(pinFill);
    pin.appendChild(pinSpike);
    pin.appendChild(pinOutline);
    var fov = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    fov.setAttribute("class", "map-fov");
    fov.setAttribute("viewBox", "-100 -100 200 200");
    fov.setAttribute("aria-hidden", "true");
    var fovPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    fovPath.setAttribute("class", "map-fov-fill");
    fov.appendChild(fovPath);
    var view = document.createElement("div");
    view.className = "map-view";
    view.setAttribute("aria-hidden", "true");
    marker.appendChild(label);
    marker.appendChild(fov);
    marker.appendChild(pin);
    marker.appendChild(dot);
    marker.appendChild(view);
    layer.appendChild(marker);
    marker.title =
      playerLabelText(p) +
      " (" +
      fmtCoord(p.x) +
      ", " +
      fmtCoord(p.y) +
      ", z " +
      fmtCoord(p.z) +
      ")";
    return {
      marker: marker,
      label: label,
      dot: dot,
      pin: pin,
      pinFill: pinFill,
      pinSpike: pinSpike,
      pinOutline: pinOutline,
      fov: fov,
      fovPath: fovPath,
      view: view,
    };
  }

  function updatePlayerTitle(el, p, display) {
    if (!el || !el.marker) return;
    var text = playerLabelText(p, display);
    if (el.label) {
      el.label.textContent = text;
      el.label.style.display = text ? "" : "none";
    }
    el.marker.title =
      text +
      " (" +
      fmtCoord(p.x) +
      ", " +
      fmtCoord(p.y) +
      ", z " +
      fmtCoord(p.z) +
      ")";
  }

  function findPlayerForMotionId(players, id) {
    for (var i = 0; i < players.length; i++) {
      if (playerMotionId(players[i], i) === id) return players[i];
    }
    return null;
  }

  function refreshPlayerMarkerPresentation() {
    var display = playerDisplaySettings();
    var players = mapMotion.currentPlayers || [];
    var gametype = mapMotion.currentGametype;
    var transform = mapMotion.renderTransform;
    var wrap = document.getElementById("map-wrap");
    var ids = Object.keys(mapMotion.byId);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var st = mapMotion.byId[id];
      if (!st || !st.el) continue;
      var p = findPlayerForMotionId(players, id);
      if (p) updatePlayerTitle(st.el, p, display);
      if (st.el.label) {
        var fontPx =
          display.playerLabelFontPx != null ? Number(display.playerLabelFontPx) : 11;
        if (isFinite(fontPx)) {
          st.el.label.style.fontSize = fontPx + "px";
        }
      }
      applyPlayerMarkerStyle(st.el, id, players, gametype);
      if (transform && wrap) {
        var pos = worldToDisplayPos(transform, wrap, st.display.x, st.display.y);
        if (pos) {
          placePlayerElement(
            st.el,
            pos,
            st.display.yaw,
            dotSizeFromZ(st.display.z, display),
            st.display.fov,
            id,
            players,
            gametype,
          );
        }
      }
    }
  }

  function placePlayerElement(el, pos, yaw, dotSize, fov, playerId, players, gametype) {
    if (!el || !el.marker) return;
    el.marker.style.left = pos.x + "px";
    el.marker.style.top = pos.y + "px";
    var size = dotSize != null ? dotSize : 8;
    el.dot.style.width = size + "px";
    el.dot.style.height = size + "px";
    if (playerId) {
      applyPlayerMarkerStyle(el, playerId, players, gametype);
    }
    var display = playerDisplaySettings();
    if (el.label) {
      var fontPx =
        display.playerLabelFontPx != null ? Number(display.playerLabelFontPx) : 11;
      if (isFinite(fontPx)) {
        el.label.style.fontSize = fontPx + "px";
      }
    }
    var hasYaw = yaw != null && !isNaN(yaw);
    var fovDeg = fov != null && !isNaN(fov) ? Number(fov) : defaultMapFov();
    if (hasYaw && display.showFovWedge && el.fov && el.fovPath) {
      el.fov.style.display = "";
      el.fov.style.transform = "rotate(" + -yaw + "deg)";
      el.fovPath.setAttribute("d", fovWedgePath(fovDeg, fovConeLengthPx()));
    } else if (el.fov) {
      el.fov.style.display = "none";
    }
    var markerStyle =
      display.playerMarkerStyle === "arrow" ? "arrow" : "pin";
    var usePin =
      markerStyle === "pin" &&
      hasYaw &&
      display.showDirectionArrow &&
      el.pin &&
      el.pinFill &&
      el.pinOutline &&
      el.pinSpike;
    if (usePin) {
      var layout = pinLayoutForDotSize(size);
      el.pin.style.display = "";
      el.pin.setAttribute("viewBox", layout.viewBox);
      el.pin.style.width = layout.sizePx + "px";
      el.pin.style.height = layout.sizePx + "px";
      el.pin.style.marginLeft = -layout.sizePx / 2 + "px";
      el.pin.style.marginTop = -layout.sizePx / 2 + "px";
      el.pin.style.transform = "rotate(" + -yaw + "deg)";
      el.pinFill.setAttribute("r", String(layout.r));
      el.pinSpike.setAttribute("d", layout.spikeFill);
      el.pinOutline.setAttribute("d", layout.outline);
      el.pinOutline.setAttribute("stroke-width", String(layout.strokeWidth));
      el.dot.style.display = "none";
      if (el.view) el.view.style.display = "none";
    } else {
      if (el.pin) el.pin.style.display = "none";
      el.dot.style.display = "";
      if (hasYaw && display.showDirectionArrow && el.view) {
        el.view.style.display = "";
        el.view.style.transform = "rotate(" + -yaw + "deg)";
      } else if (el.view) {
        el.view.style.display = "none";
      }
    }
  }

  function worldToDisplayPos(transform, wrap, x, y) {
    if (!transform || !wrap || !window.MapCoords) return null;
    var pixel = MapCoords.worldToPixel(transform, x, y);
    var rect = MapCoords.imageDisplayRect(
      wrap,
      transform.image_width,
      transform.image_height,
    );
    return MapCoords.pixelToDisplay(rect, pixel);
  }

  function ensureMotionLoop() {
    if (mapMotion.loopId) return;

    function frame() {
      var wrap = document.getElementById("map-wrap");
      var transform = mapMotion.renderTransform || cachedTransform;
      if (!wrap || !transform || !window.MapCoords) {
        mapMotion.loopId = 0;
        return;
      }

      var ids = Object.keys(mapMotion.byId);
      if (!ids.length) {
        mapMotion.loopId = 0;
        return;
      }

      var smooth = mapSmoothEnabled();
      var alpha = smooth ? mapSmoothAlpha() : 1;

      for (var i = 0; i < ids.length; i++) {
        var st = mapMotion.byId[ids[i]];
        var d = st.display;
        var tg = st.target;
        d.x = lerpNum(d.x, tg.x, alpha);
        d.y = lerpNum(d.y, tg.y, alpha);
        if (tg.z != null) {
          d.z = d.z == null ? tg.z : lerpNum(d.z, tg.z, alpha);
        } else {
          d.z = null;
        }
        if (tg.yaw != null) {
          d.yaw = d.yaw == null ? tg.yaw : lerpYaw(d.yaw, tg.yaw, alpha);
        } else {
          d.yaw = null;
        }
        if (tg.fov != null) {
          d.fov = d.fov == null ? tg.fov : lerpNum(d.fov, tg.fov, alpha);
        } else {
          d.fov = null;
        }
        var pos = worldToDisplayPos(transform, wrap, d.x, d.y);
        if (pos) {
          placePlayerElement(
            st.el,
            pos,
            d.yaw,
            dotSizeFromZ(d.z),
            d.fov,
            ids[i],
            mapMotion.currentPlayers,
            mapMotion.currentGametype,
          );
        }
      }

      renderDeathMarkers();
      renderHeatmap(mapMotion.currentPlayers, mapMotion.currentGametype);

      mapMotion.loopId = requestAnimationFrame(frame);
    }

    mapMotion.loopId = requestAnimationFrame(frame);
  }

  function setMapSnapshot(payload, opts) {
    opts = opts || {};
    var instant = !!opts.instant || !mapSmoothEnabled();
    var layer = document.getElementById("map-players");
    var wrap = document.getElementById("map-wrap");
    var meta = document.getElementById("map-meta");
    if (!layer) return;

    mapDebugState.lastPayload = payload;

    if (payload.match_id && payload.match_id !== lastMapContext.match_id) {
      clearMapMotion();
      resetMatchOverlayState("match_id", payload);
    } else if (
      payload.map_name &&
      payload.map_name !== lastMapContext._overlay_map
    ) {
      clearMapMotion();
      resetMatchOverlayState("map", payload);
    }

    var players = normalizePlayersList(payload.players);
    mapMotion.currentPlayers = players;
    mapMotion.currentGametype =
      payload.gametype != null ? payload.gametype : lastMapContext.gametype;
    rememberPlayerPositions(players);
    recordHeatmapPositions(players, mapMotion.currentGametype);
    var seen = {};
    for (var i = 0; i < players.length; i++) {
      var probe = players[i];
      if (!playerShouldRenderOnMap(probe)) continue;
      seen[playerMotionId(probe, i)] = true;
    }
    prunePlayerMarkers(layer, seen);

    var transform = payload.transform || cachedTransform;
    if (!transform || !wrap) return;
    mapMotion.renderTransform = transform;

    if (payload.transform && payload.transform.world_z_span != null) {
      mapMotion.zSpanMin =
        Number(payload.transform.world_z_span) || mapMotion.zSpanMin;
    }

    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      if (p.z != null) noteZExtent(Number(p.z));
    }

    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      if (!playerShouldRenderOnMap(p)) continue;
      var id = playerMotionId(p, i);
      var target = {
        x: Number(p.x),
        y: Number(p.y),
        z: p.z != null ? Number(p.z) : null,
        yaw: p.yaw != null ? Number(p.yaw) : null,
        fov: p.fov != null ? Number(p.fov) : null,
      };

      var st = mapMotion.byId[id];
      if (!st) {
        st = mapMotion.byId[id] = {
          el: createPlayerElements(layer, p),
          display: cloneWorldPose(target),
          target: cloneWorldPose(target),
        };
        applyPlayerMarkerStyle(st.el, id, players, mapMotion.currentGametype);
      } else {
        updatePlayerTitle(st.el, p);
        st.target = cloneWorldPose(target);
        if (instant) {
          st.display = cloneWorldPose(target);
        }
      }
    }

    if (meta) {
      meta.textContent = [payload.map_name, players.length + " players"].join(
        " · ",
      );
    }

    ensureMotionLoop();
  }

  function mapKey(payload) {
    var t = payload.transform;
    var name = payload.map_name || "";
    if (!t) return name;
    return name + "|" + (t.image_url || "");
  }

  function resolveImageUrl(transform) {
    if (window.MapCoords) {
      return MapCoords.resolveImageUrl(transform);
    }
    return "";
  }

  function applyMapImage(payload) {
    var transform = payload.transform;
    if (!transform) return;

    var key = mapKey(payload);
    var image = document.getElementById("map-image");
    var wrap = document.getElementById("map-wrap");
    if (!image || !wrap) return;

    var url = resolveImageUrl(transform);
    if (key !== cachedMapKey || url !== currentImageSrc) {
      if (key !== cachedMapKey) {
        clearMapMotion();
        mapMotion.zFloor = null;
        mapMotion.zCeiling = null;
        resetMatchOverlayState("map_image", {
          match_id: lastMapContext.match_id,
          map_name: payload.map_name,
        });
      }
      cachedMapKey = key;
      cachedTransform = transform;
      if (url && url !== currentImageSrc) {
        currentImageSrc = url;
        image.src = url;
      }
    }
    wrap.classList.remove("hidden");
  }

  function applyMapDots(payload) {
    setMapSnapshot(payload, { instant: false });
  }

  function applyMapDotsPreview(payload) {
    setMapSnapshot(payload, { instant: true });
  }

  function applyMapPayload(payload, opts) {
    applyMapImage(payload);
    if (opts && opts.instant) {
      applyMapDotsPreview(payload);
    } else {
      applyMapDots(payload);
    }
    notifyMapPayload(payload);
  }

  var mapPayloadListeners = [];

  function notifyMapPayload(payload) {
    for (var i = 0; i < mapPayloadListeners.length; i++) {
      try {
        mapPayloadListeners[i](payload);
      } catch (_err) {
        /* debug hook */
      }
    }
  }

  function showNoMatchStatus(id) {
    setStatus("No data for " + id, true);
  }

  async function loadDefaultTransform() {
    try {
      await handleMapSnapshot({ map_name: "_default", players: [] });
    } catch (_err) {
      /* placeholder unavailable */
    }
  }

  async function handleMapSnapshot(data, opts) {
    opts = opts || {};
    if (!window.MapCoords) {
      setStatus("map-coords.js missing", true);
      return;
    }
    if (data.map_name) {
      lastMapContext.map_name = data.map_name;
    } else if (lastMapContext.map_name) {
      data.map_name = lastMapContext.map_name;
    }
    if (data.gametype != null && data.gametype !== "") {
      lastMapContext.gametype = data.gametype;
    }
    if (data.match_id) {
      lastMapContext.match_id = data.match_id;
    }

    var prepared = await MapCoords.prepareMapPayload(
      data.map_name,
      normalizePlayersList(data.players),
    );
    var merged = Object.assign({}, data, prepared);
    if (merged.gametype == null || merged.gametype === "") {
      merged.gametype = lastMapContext.gametype;
    }
    if (
      window.MapDebug &&
      typeof window.MapDebug.applyTransform === "function"
    ) {
      merged.transform =
        window.MapDebug.applyTransform(merged.transform) || merged.transform;
    }
    if (merged.transform) {
      mapImageLoaded = true;
    }
    applyMapPayload(merged, opts);
    if (data.status === "no_match") {
      showNoMatchStatus(data.match_id || matchId());
      return;
    }
    recordClientPositions(data);
    setStatus("");
  }

  async function resolveMapMatchId() {
    var id = matchId();
    if (!id) {
      var rows = await fetchLiveMatchRows();
      if (!rows.length) throw new Error("No live matches");
      return rows[0].match_id;
    }
    return id;
  }

  async function prefetchMapHttp(id) {
    try {
      var data = await fetchJson(
        "/api/matches/" + encodeURIComponent(id) + "/positions",
      );
      await handleMapSnapshot(data);
    } catch (err) {
      if (String(err.message || err).indexOf("404") >= 0) {
        showNoMatchStatus(id);
        await loadDefaultTransform();
      } else {
        throw err;
      }
    }
  }

  function replayVitalsFromSnapshots(pp, npp, frac) {
    var primary = frac >= 1 ? npp : pp;
    var fallback = frac >= 1 ? pp : npp;
    var vitals = {};
    if (primary.health != null) vitals.health = primary.health;
    else if (fallback.health != null) vitals.health = fallback.health;
    if (primary.armor != null) vitals.armor = primary.armor;
    else if (fallback.armor != null) vitals.armor = fallback.armor;
    var powerups =
      primary.powerups && primary.powerups.length
        ? primary.powerups
        : fallback.powerups;
    if (powerups && powerups.length) vitals.powerups = powerups.slice();
    return vitals;
  }

  function clonePlayerPoseForReplay(p) {
    return Object.assign(
      {
        steam_id64: p.steam_id64,
        nickname: p.nickname,
        x: Number(p.x),
        y: Number(p.y),
        z: p.z != null ? Number(p.z) : null,
        yaw: p.yaw != null ? Number(p.yaw) : null,
        fov: p.fov != null ? Number(p.fov) : null,
        team: p.team,
      },
      replayVitalsFromSnapshots(p, p, 0),
    );
  }

  function lerpReplayPlayers(prevPlayers, nextPlayers, frac) {
    frac = Math.max(0, Math.min(1, Number(frac) || 0));
    var nextById = {};
    for (var ni = 0; ni < nextPlayers.length; ni++) {
      var np = nextPlayers[ni];
      nextById[playerMotionId(np, ni)] = np;
    }
    var out = [];
    for (var pi = 0; pi < prevPlayers.length; pi++) {
      var pp = prevPlayers[pi];
      var id = playerMotionId(pp, pi);
      var npp = nextById[id];
      if (!npp) {
        out.push(clonePlayerPoseForReplay(pp));
        continue;
      }
      out.push(
        Object.assign(
          {
            steam_id64: pp.steam_id64,
            nickname: pp.nickname != null ? pp.nickname : npp.nickname,
            x: lerpNum(Number(pp.x), Number(npp.x), frac),
            y: lerpNum(Number(pp.y), Number(npp.y), frac),
            z:
              pp.z != null && npp.z != null
                ? lerpNum(Number(pp.z), Number(npp.z), frac)
                : npp.z != null
                  ? npp.z
                  : pp.z,
            yaw:
              pp.yaw != null && npp.yaw != null
                ? lerpYaw(Number(pp.yaw), Number(npp.yaw), frac)
                : npp.yaw != null
                  ? npp.yaw
                  : pp.yaw,
            fov:
              pp.fov != null && npp.fov != null
                ? lerpNum(Number(pp.fov), Number(npp.fov), frac)
                : npp.fov != null
                  ? npp.fov
                  : pp.fov,
            team: npp.team != null ? npp.team : pp.team,
          },
          replayVitalsFromSnapshots(pp, npp, frac),
        ),
      );
      delete nextById[id];
    }
    for (var leftover in nextById) {
      if (!Object.prototype.hasOwnProperty.call(nextById, leftover)) continue;
      out.push(clonePlayerPoseForReplay(nextById[leftover]));
    }
    return out;
  }

  function replayPlayersAtTime(targetT) {
    if (!replayState) return [];
    var events = replayState.events;
    var prev = null;
    var next = null;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.event !== "positions") continue;
      var t = ev.t || 0;
      if (t <= targetT) prev = ev;
      else {
        next = ev;
        break;
      }
    }
    if (!prev && !next) return [];
    if (!prev) return normalizePlayersList(next.players || []);
    if (!next) return normalizePlayersList(prev.players || []);
    var prevT = prev.t || 0;
    var nextT = next.t || 0;
    if (nextT <= prevT) return normalizePlayersList(prev.players || []);
    var frac = (targetT - prevT) / (nextT - prevT);
    return lerpReplayPlayers(
      normalizePlayersList(prev.players || []),
      normalizePlayersList(next.players || []),
      frac,
    );
  }

  function applyReplayFramePositions() {
    if (!replayState) return;
    var targetT = replayState.startMs + replayState.cursorMs;
    var players = replayPlayersAtTime(targetT);
    applyMapDotsPreview({
      match_id: replayState.matchId,
      map_name: replayState.meta.map_name || lastMapContext.map_name,
      gametype: replayState.meta.gametype || lastMapContext.gametype,
      players: players,
      transform: cachedTransform,
    });
    if (window.MapSpawns && typeof MapSpawns.refreshItemRespawnOverlays === "function") {
      MapSpawns.refreshItemRespawnOverlays();
    }
  }

  function fmtReplayClock(ms) {
    ms = Math.max(0, Math.floor(Number(ms) || 0));
    var sec = Math.floor(ms / 1000);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  var replayState = null;

  function resetClientRecorder() {
    clientRecorder.active = false;
    clientRecorder.events = [];
    clientRecorder.matchId = null;
    clientRecorder.meta = {};
    updateClientRecordUi();
  }

  function clientRecorderMatchSwitch(nextId) {
    if (!nextId || !clientRecorder.matchId || clientRecorder.matchId === nextId) {
      return;
    }
    stopClientRecording(false);
  }

  function appendClientRecordEvent(event, matchId, fields) {
    if (!clientRecorder.active || replayMode()) return;
    var mid = (matchId || clientRecorder.matchId || lastMapContext.match_id || "")
      .trim();
    if (!mid) return;
    clientRecorderMatchSwitch(mid);
    clientRecorder.matchId = mid;
    var t = overlayNowMs();
    if (!clientRecorder.meta.started_at) {
      clientRecorder.meta.started_at = t;
      clientRecorder.meta.match_id = mid;
    }
    var row = Object.assign({ t: t, event: event, match_id: mid }, fields || {});
    clientRecorder.events.push(row);
    clientRecorder.meta.event_count = clientRecorder.events.length;
    clientRecorder.meta.updated_at = new Date(t).toISOString();
    if (fields && fields.map_name) clientRecorder.meta.map_name = fields.map_name;
    if (fields && fields.gametype) clientRecorder.meta.gametype = fields.gametype;
    if (event === "match_status" && fields && fields.status) {
      clientRecorder.meta.status = fields.status;
      if (fields.status === "ended" || fields.status === "aborted") {
        clientRecorder.meta.ended_at = t;
      }
    }
    updateClientRecordUi();
  }

  function recordClientPositions(data) {
    if (!clientRecorder.active || replayMode()) return;
    if (!data || data.players === undefined) return;
    appendClientRecordEvent("positions", data.match_id, {
      map_name: data.map_name || lastMapContext.map_name,
      gametype: data.gametype != null ? data.gametype : lastMapContext.gametype,
      players: normalizePlayersList(data.players),
    });
  }

  function recordClientDeath(data) {
    if (!data) return;
    appendClientRecordEvent("death", data.match_id, {
      victim_steam_id64: data.victim_steam_id64,
      victim_name: data.victim_name,
      killer_steam_id64: data.killer_steam_id64,
      killer_name: data.killer_name,
      weapon: data.weapon,
      x: data.x,
      y: data.y,
      z: data.z,
      time: data.time,
    });
  }

  function recordClientPickup(data) {
    if (!data) return;
    appendClientRecordEvent("pickup", data.match_id, {
      steam_id64: data.steam_id64,
      nickname: data.nickname,
      player: data.player,
      item: data.item,
      gametype: data.gametype,
      x: data.x,
      y: data.y,
      z: data.z,
      entity_id: data.entity_id,
      source: data.source,
      action: data.action,
      time: data.time,
    });
  }

  function recordClientMatchStatus(data) {
    if (!data) return;
    appendClientRecordEvent("match_status", data.match_id, {
      status: data.status,
    });
    if (data.status === "ended" || data.status === "aborted") {
      stopClientRecording(false);
    }
  }

  function buildClientRecordingExport() {
    var events = clientRecorder.events.slice();
    var meta = Object.assign({}, clientRecorder.meta);
    if (meta.started_at && events.length) {
      var endT = meta.ended_at || events[events.length - 1].t;
      meta.duration_ms = Math.max(0, Number(endT) - Number(meta.started_at));
    }
    return {
      version: CLIENT_RECORD_VERSION,
      source: "ql-overlay-client",
      match_id: clientRecorder.matchId,
      meta: meta,
      events: events,
    };
  }

  function downloadClientRecording() {
    var doc = buildClientRecordingExport();
    if (!doc.events.length) {
      setStatus("Nothing recorded yet", true);
      return;
    }
    var safeId = String(doc.match_id || "match").replace(/[^\w\-]+/g, "_");
    var stamp = new Date().toISOString().replace(/[:.]/g, "-");
    var blob = new Blob([JSON.stringify(doc, null, 2)], {
      type: "application/json",
    });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "ql-replay-" + safeId + "-" + stamp + ".json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setStatus("Saved " + doc.events.length + " events");
  }

  function updateClientRecordUi() {
    var startBtn = document.getElementById("map-record-start");
    var stopBtn = document.getElementById("map-record-stop");
    var saveBtn = document.getElementById("map-record-save");
    var statusEl = document.getElementById("map-record-status");
    if (startBtn) startBtn.disabled = !!clientRecorder.active;
    if (stopBtn) stopBtn.disabled = !clientRecorder.active;
    if (saveBtn) {
      saveBtn.disabled = !clientRecorder.events.length;
    }
    if (statusEl) {
      var label = clientRecorder.active ? "REC · " : "";
      statusEl.textContent = label + clientRecorder.events.length + " events";
    }
  }

  function startClientRecording() {
    if (replayMode()) return;
    resetClientRecorder();
    clientRecorder.active = true;
    updateClientRecordUi();
    setStatus("Client recording…");
  }

  function stopClientRecording(clearStatus) {
    if (!clientRecorder.active && !clientRecorder.events.length) return;
    clientRecorder.active = false;
    updateClientRecordUi();
    if (clearStatus !== false) {
      setStatus(
        clientRecorder.events.length
          ? "Recording stopped (" + clientRecorder.events.length + " events)"
          : "",
      );
    }
  }

  function bindClientRecordControls() {
    if (recordControlsBound) return;
    recordControlsBound = true;
    var startBtn = document.getElementById("map-record-start");
    var stopBtn = document.getElementById("map-record-stop");
    var saveBtn = document.getElementById("map-record-save");
    if (startBtn) startBtn.addEventListener("click", startClientRecording);
    if (stopBtn) stopBtn.addEventListener("click", function () {
      stopClientRecording(true);
    });
    if (saveBtn) saveBtn.addEventListener("click", downloadClientRecording);
    updateClientRecordUi();
  }

  function showReplayMediaBar(mode) {
    var bar = document.getElementById("map-replay-bar");
    var recordControls = document.getElementById("map-record-controls");
    var playback = document.getElementById("map-replay-playback");
    var loadWrap = document.getElementById("map-replay-load-wrap");
    if (bar) bar.classList.remove("hidden");
    if (recordControls) {
      recordControls.classList.toggle("hidden", mode !== "record");
    }
    if (playback) {
      playback.classList.toggle("hidden", mode !== "replay");
    }
    if (loadWrap) {
      loadWrap.classList.toggle("hidden", mode !== "replay");
    }
  }

  function initClientRecordingUi() {
    showReplayMediaBar("record");
    bindClientRecordControls();
    if (clientRecordAutoStart()) {
      startClientRecording();
    }
  }

  function normalizeReplayDocument(raw) {
    if (!raw || typeof raw !== "object") {
      throw new Error("Invalid replay file");
    }
    var events = [];
    if (Array.isArray(raw.events)) {
      events = raw.events.slice();
    } else if (Array.isArray(raw)) {
      events = raw.slice();
    } else {
      throw new Error("Replay file has no events array");
    }
    events.sort(function (a, b) {
      return (a.t || 0) - (b.t || 0);
    });
    if (!events.length) {
      throw new Error("Replay has no events");
    }
    var meta = raw.meta && typeof raw.meta === "object" ? Object.assign({}, raw.meta) : {};
    var matchIdValue =
      raw.match_id || meta.match_id || events[0].match_id || matchId() || "local";
    if (!meta.started_at) meta.started_at = events[0].t;
    if (!meta.duration_ms && events.length) {
      meta.duration_ms = Math.max(
        0,
        (events[events.length - 1].t || meta.started_at) - meta.started_at,
      );
    }
    return {
      match_id: matchIdValue,
      meta: meta,
      events: events,
      source: raw.source || null,
    };
  }

  function parseReplayFileContent(text, filename) {
    var trimmed = String(text || "").trim();
    if (!trimmed) throw new Error("Empty replay file");
    var name = String(filename || "").toLowerCase();
    if (name.endsWith(".jsonl") || (trimmed.indexOf("\n") >= 0 && trimmed.indexOf('"events"') < 0)) {
      var events = [];
      trimmed.split(/\r?\n/).forEach(function (line) {
        line = line.trim();
        if (!line) return;
        events.push(JSON.parse(line));
      });
      return normalizeReplayDocument({ events: events });
    }
    return normalizeReplayDocument(JSON.parse(trimmed));
  }

  async function activateReplayData(data) {
    var normalized = normalizeReplayDocument(data);
    var events = normalized.events;
    var meta = normalized.meta;
    var startMs = Number(meta.started_at || events[0].t || 0);
    var durationMs = Number(meta.duration_ms);
    if (!isFinite(durationMs) || durationMs <= 0) {
      durationMs = Math.max(0, (events[events.length - 1].t || startMs) - startMs);
    }

    stopReplayPlayback();
    replayClock.active = true;
    replayClock.epochMs = startMs;
    replayClock.cursorMs = 0;

    replayState = {
      matchId: normalized.match_id,
      meta: meta,
      events: events,
      startMs: startMs,
      durationMs: durationMs,
      cursorMs: 0,
      playing: false,
      speed: replaySpeedDefault(),
      lastAppliedIndex: -1,
      rafId: 0,
      lastTickMs: 0,
      source: normalized.source,
    };

    var speedSel = document.getElementById("map-replay-speed");
    if (speedSel) speedSel.value = String(replayState.speed);

    await seekReplay(0);
    var src =
      normalized.source === "ql-overlay-client"
        ? "client file"
        : normalized.source || "replay";
    setStatus("Replay loaded (" + src + ", " + events.length + " events)");
  }

  function bindReplayFileLoad() {
    var input = document.getElementById("map-replay-file");
    if (!input || input._qlReplayBound) return;
    input._qlReplayBound = true;
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var doc = parseReplayFileContent(String(reader.result || ""), file.name);
          activateReplayData(doc).catch(function (err) {
            setStatus(String(err.message || err), true);
          });
        } catch (err) {
          setStatus(String(err.message || err), true);
        }
        input.value = "";
      };
      reader.onerror = function () {
        setStatus("Could not read replay file", true);
        input.value = "";
      };
      reader.readAsText(file);
    });
  }

  function replayPayloadFromEvent(ev) {
    if (ev.event === "positions") {
      return {
        event: "positions",
        match_id: ev.match_id,
        map_name: ev.map_name,
        gametype: ev.gametype,
        players: ev.players || [],
      };
    }
    if (ev.event === "death") {
      return {
        event: "death",
        match_id: ev.match_id,
        victim_steam_id64: ev.victim_steam_id64,
        victim_name: ev.victim_name,
        killer_steam_id64: ev.killer_steam_id64,
        killer_name: ev.killer_name,
        weapon: ev.weapon,
        x: ev.x,
        y: ev.y,
        z: ev.z,
        time: ev.time,
      };
    }
    if (ev.event === "pickup") {
      return {
        event: "pickup",
        match_id: ev.match_id,
        steam_id64: ev.steam_id64,
        nickname: ev.nickname,
        player: ev.player,
        item: ev.item,
        gametype: ev.gametype,
        x: ev.x,
        y: ev.y,
        z: ev.z,
        entity_id: ev.entity_id,
        source: ev.source,
        action: ev.action,
        time: ev.time,
        t: ev.t,
        respawn_sec: ev.respawn_sec,
        respawn_at: ev.respawn_at,
      };
    }
    return null;
  }

  function resetReplayVisualState(payload) {
    clearMapMotion();
    resetMatchOverlayState("replay_seek", payload || {});
    mapKillFeedDedup = [];
    mapPickupToasts = [];
    renderPickupFeed();
  }

  async function applyReplayEvent(ev) {
    if (!ev || !ev.event || ev.event === "match_status") return false;
    var payload = replayPayloadFromEvent(ev);
    if (!payload) return false;
    if (payload.event === "positions") {
      await handleMapSnapshot(payload);
      return true;
    }
    if (payload.event === "death") {
      handleDeathEvent(payload);
      return true;
    }
    if (payload.event === "pickup") {
      handlePickupEvent(payload);
      return true;
    }
    return false;
  }

  function updateReplayBarUi() {
    if (!replayState) return;
    var scrub = document.getElementById("map-replay-scrub");
    var timeEl = document.getElementById("map-replay-time");
    var playBtn = document.getElementById("map-replay-play");
    var dur = replayState.durationMs || 0;
    if (scrub) {
      scrub.max = String(Math.max(0, dur));
      scrub.value = String(Math.min(dur, replayState.cursorMs));
    }
    if (timeEl) {
      timeEl.textContent =
        fmtReplayClock(replayState.cursorMs) + " / " + fmtReplayClock(dur);
    }
    if (playBtn) {
      playBtn.textContent = replayState.playing ? "Pause" : "Play";
      playBtn.setAttribute(
        "aria-label",
        replayState.playing ? "Pause replay" : "Play replay",
      );
    }
    var meta = document.getElementById("map-meta");
    if (meta) {
      var bits = ["REPLAY"];
      if (replayState.meta.map_name) bits.push(replayState.meta.map_name);
      if (replayState.meta.gametype) bits.push(replayState.meta.gametype);
      if (replayState.matchId) bits.push(replayState.matchId);
      meta.textContent = bits.join(" · ");
    }
  }

  function stopReplayPlayback() {
    if (!replayState) return;
    replayState.playing = false;
    if (replayState.rafId) {
      cancelAnimationFrame(replayState.rafId);
      replayState.rafId = 0;
    }
  }

  async function seekReplay(cursorMs) {
    if (!replayState) return;
    stopReplayPlayback();
    var dur = replayState.durationMs || 0;
    replayState.cursorMs = Math.max(0, Math.min(dur, Number(cursorMs) || 0));
    replayClock.cursorMs = replayState.cursorMs;
    var targetT = replayState.startMs + replayState.cursorMs;
    resetReplayVisualState({
      match_id: replayState.matchId,
      map_name: replayState.meta.map_name || lastMapContext.map_name,
    });
    replayState.lastAppliedIndex = -1;
    var events = replayState.events;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if ((ev.t || 0) > targetT) break;
      if (ev.event === "match_status") continue;
      await applyReplayEvent(ev);
      replayState.lastAppliedIndex = i;
    }
    applyReplayFramePositions();
    ensureMotionLoop();
    updateReplayBarUi();
  }

  function applyReplayEventsIncremental() {
    if (!replayState) return;
    var targetT = replayState.startMs + replayState.cursorMs;
    replayClock.cursorMs = replayState.cursorMs;
    var events = replayState.events;
    var i = replayState.lastAppliedIndex + 1;
    while (i < events.length && (events[i].t || 0) <= targetT) {
      var ev = events[i];
      if (ev.event !== "match_status") {
        applyReplayEvent(ev).catch(function (err) {
          setStatus(String(err.message || err), true);
        });
      }
      replayState.lastAppliedIndex = i;
      i++;
    }
    applyReplayFramePositions();
  }

  function replayTick(now) {
    if (!replayState || !replayState.playing) return;
    if (!replayState.lastTickMs) replayState.lastTickMs = now;
    var dt = now - replayState.lastTickMs;
    replayState.lastTickMs = now;
    replayState.cursorMs += dt * replayState.speed;
    if (replayState.cursorMs >= replayState.durationMs) {
      replayState.cursorMs = replayState.durationMs;
      replayState.playing = false;
    }
    applyReplayEventsIncremental();
    applyReplayFramePositions();
    updateReplayBarUi();
    if (replayState.playing) {
      replayState.rafId = requestAnimationFrame(replayTick);
    } else {
      replayState.rafId = 0;
    }
  }

  function startReplayPlayback() {
    if (!replayState) return;
    if (replayState.cursorMs >= replayState.durationMs) {
      seekReplay(0)
        .then(function () {
          replayState.playing = true;
          replayState.lastTickMs = 0;
          replayState.rafId = requestAnimationFrame(replayTick);
          updateReplayBarUi();
        })
        .catch(function (err) {
          setStatus(String(err.message || err), true);
        });
      return;
    }
    replayState.playing = true;
    replayState.lastTickMs = 0;
    replayState.rafId = requestAnimationFrame(replayTick);
    updateReplayBarUi();
  }

  function toggleReplayPlayback() {
    if (!replayState) return;
    if (replayState.playing) stopReplayPlayback();
    else startReplayPlayback();
    updateReplayBarUi();
  }

  function bindReplayBar() {
    if (replayControlsBound) {
      bindReplayFileLoad();
      return;
    }
    replayControlsBound = true;
    var playBtn = document.getElementById("map-replay-play");
    var scrub = document.getElementById("map-replay-scrub");
    var speedSel = document.getElementById("map-replay-speed");
    if (playBtn) {
      playBtn.addEventListener("click", toggleReplayPlayback);
    }
    if (scrub) {
      scrub.addEventListener("pointerdown", function () {
        stopReplayPlayback();
      });
      scrub.addEventListener("input", function () {
        seekReplay(Number(scrub.value)).catch(function (err) {
          setStatus(String(err.message || err), true);
        });
      });
    }
    if (speedSel) {
      speedSel.value = String(replaySpeedDefault());
      speedSel.addEventListener("change", function () {
        if (!replayState) return;
        var n = Number(speedSel.value);
        replayState.speed = isFinite(n) && n > 0 ? n : 1;
      });
    }
    bindReplayFileLoad();
  }

  async function initMapReplay() {
    document.body.classList.add("map-replay-mode");
    showReplayMediaBar("replay");
    bindReplayBar();

    if (replaySourceFileOnly()) {
      setStatus("Load a replay file (.json or .jsonl)");
      return;
    }

    setStatus("Loading replay…");

    var id = matchId();
    if (!id) {
      try {
        var rows = await fetchJson("/api/replays");
        if (rows.length) id = rows[0].match_id;
      } catch (_e) {
        /* list unavailable */
      }
    }
    if (!id) {
      setStatus("Pick a server replay (?match=ID) or Load file", true);
      return;
    }

    try {
      var data = await fetchJson("/api/replays/" + encodeURIComponent(id));
      await activateReplayData(data);
    } catch (err) {
      setStatus("Server replay not found — use Load file", true);
    }
  }

  async function refreshMap() {
    var id = await resolveMapMatchId();
    var suffix = mapImageLoaded ? "?players_only=1" : "";
    try {
      var data = await fetchJson(
        "/api/matches/" + encodeURIComponent(id) + "/positions" + suffix,
      );
      await handleMapSnapshot(data);
    } catch (err) {
      if (String(err.message || err).indexOf("404") >= 0) {
        showNoMatchStatus(id);
        await loadDefaultTransform();
        return;
      }
      throw err;
    }
  }

  function wsUrlForMatch(id) {
    var base = requireApiBase();
    var wsProto = base.startsWith("https") ? "wss" : "ws";
    var hostPath = base.replace(/^https?:\/\//, "");
    return (
      wsProto +
      "://" +
      hostPath +
      "/api/ws/live?match=" +
      encodeURIComponent(id)
    );
  }

  function initMapWebSocket() {
    var ws = null;
    var reconnectTimer = null;
    var silentTimer = null;
    var httpPollTimer = null;
    var gotWsFrame = false;

    function clearSilentTimer() {
      if (silentTimer) {
        clearTimeout(silentTimer);
        silentTimer = null;
      }
    }

    function stopHttpPoll() {
      if (httpPollTimer) {
        clearInterval(httpPollTimer);
        httpPollTimer = null;
      }
    }

    function startHttpPoll() {
      if (httpPollTimer) return;
      refreshMap().catch(function (err) {
        setStatus(String(err.message || err), true);
      });
      httpPollTimer = setInterval(function () {
        refreshMap().catch(function (err) {
          setStatus(String(err.message || err), true);
        });
      }, mapPollMs());
    }

    function scheduleReconnect(ms) {
      if (reconnectTimer) return;
      reconnectTimer = setTimeout(function () {
        reconnectTimer = null;
        connect();
      }, ms || 2000);
    }

    function connect() {
      clearSilentTimer();
      stopHttpPoll();
      gotWsFrame = false;

      resolveMapMatchId()
        .then(function (id) {
          prefetchMapHttp(id).catch(function (err) {
            setStatus(String(err.message || err), true);
          });

          if (ws) {
            ws.onclose = null;
            ws.close();
          }
          ws = new WebSocket(wsUrlForMatch(id));
          ws.onopen = function () {
            setStatus("Connecting…");
            silentTimer = setTimeout(function () {
              if (!gotWsFrame) {
                setStatus("WS silent, using HTTP…", true);
                startHttpPoll();
              }
            }, 2000);
          };
          ws.onmessage = function (ev) {
            gotWsFrame = true;
            clearSilentTimer();
            stopHttpPoll();
            var data = JSON.parse(ev.data);
            mapDebugState.lastWsMessage = data;
            mapDebugState.lastWsEvent = data.event || null;
            mapDebugState.wsFrameCount += 1;
            if (data.event === "positions" || data.event === "snapshot") {
              handleMapSnapshot(data).catch(function (err) {
                setStatus(String(err.message || err), true);
              });
            } else if (data.event === "match_status") {
              recordClientMatchStatus(data);
              if (data.status === "ended" || data.status === "aborted") {
                resetMatchOverlayState("match_end", {
                  match_id: data.match_id,
                  map_name: lastMapContext.map_name,
                });
                clearMapMotion();
                handleMapSnapshot({
                  event: data.event,
                  match_id: data.match_id,
                  map_name: lastMapContext.map_name,
                  gametype: lastMapContext.gametype,
                  players: [],
                }).catch(function (err) {
                  setStatus(String(err.message || err), true);
                });
              }
            } else if (data.event === "match_update") {
              var matchRow = data.match;
              if (matchRow && matchRow.gametype) {
                lastMapContext.gametype = matchRow.gametype;
              }
              var lastPayload = mapDebugState.lastPayload;
              if (lastPayload && matchRow && matchRow.gametype) {
                handleMapSnapshot(
                  Object.assign({}, lastPayload, {
                    gametype: matchRow.gametype,
                    match_id: matchRow.match_id || lastPayload.match_id,
                  }),
                ).catch(function (err) {
                  setStatus(String(err.message || err), true);
                });
              }
            } else if (data.event === "death") {
              handleDeathEvent(data);
            } else if (data.event === "pickup") {
              handlePickupEvent(data);
            }
          };
          ws.onclose = function () {
            clearSilentTimer();
            setStatus("WS disconnected, reconnecting…", true);
            scheduleReconnect(2000);
          };
          ws.onerror = function () {
            if (ws) ws.close();
          };
        })
        .catch(function (err) {
          setStatus(String(err.message || err), true);
          scheduleReconnect(3000);
        });
    }

    if (matchId()) {
      setStatus("Connecting…");
    }
    connect();
  }

  function loop(fn, intervalMs) {
    var ms = intervalMs || pollMs();
    fn().catch(function (err) {
      setStatus(String(err.message || err), true);
    });
    setInterval(function () {
      fn().catch(function (err) {
        setStatus(String(err.message || err), true);
      });
    }, ms);
  }

  function boot(fn) {
    try {
      requireApiBase();
      fn();
    } catch (err) {
      setStatus(String(err.message || err), true);
    }
  }

  function initViewer() {
    var select = document.getElementById("viewer-match");
    var openScoreboard = document.getElementById("viewer-open-scoreboard");
    var openMap = document.getElementById("viewer-open-map");
    var openMatches = document.getElementById("viewer-open-matches");

    function selectedMatchId() {
      return select && select.value ? select.value : "";
    }

    function bindOpen(btn, page) {
      if (!btn) return;
      btn.addEventListener("click", function () {
        try {
          requireApiBase();
          openOverlayWindow(page, selectedMatchId());
        } catch (err) {
          setStatus(String(err.message || err), true);
        }
      });
    }

    bindOpen(openScoreboard, "scoreboard");
    bindOpen(openMap, "map");
    bindOpen(openMatches, "matches");

    async function refreshViewer() {
      try {
        requireApiBase();
        var rows = await fetchJson("/api/stream/matches");
        if (!select) return;
        var prev = select.value;
        select.innerHTML = "";
        var auto = document.createElement("option");
        auto.value = "";
        auto.textContent = rows.length
          ? "First live match (auto)"
          : "No live matches";
        select.appendChild(auto);
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          var opt = document.createElement("option");
          opt.value = row.match_id;
          opt.textContent =
            (row.score_summary || row.match_id) +
            (row.map_name ? " · " + row.map_name : "");
          select.appendChild(opt);
        }
        if (prev && select.querySelector('option[value="' + prev + '"]')) {
          select.value = prev;
        }
        setStatus(
          rows.length ? rows.length + " live match(es)" : "No live matches",
        );
      } catch (err) {
        setStatus(String(err.message || err), true);
      }
    }

    boot(function () {
      refreshViewer();
      setInterval(refreshViewer, pollMs());
    });
  }

  window.OverlayApp = {
    initScoreboard: function () {
      boot(function () {
        applyObsBackground();
        ensureMatchClockTicker();
        initScoreboardWebSocket();
        loop(refreshScoreboard);
      });
    },
    initMatchList: function () {
      boot(function () {
        applyObsBackground();
        syncMatchesOperatorUi();
        bindMatchesOperatorControls();
        pushMatchesUrlState();
        refreshMatchList().catch(function (err) {
          setStatus(String(err.message || err), true);
        });
        initMatchesWebSocket();
        loop(refreshMatchList, Math.max(3000, pollMs()));
      });
    },
    initMatchPage: function () {
      boot(function () {
        applyObsBackground();
        initMatchPageNav();
        refreshMatchPage().catch(function (err) {
          setStatus(String(err.message || err), true);
        });
        loop(refreshMatchPage, Math.max(3000, pollMs()));
        initMatchPageWs();
      });
    },
    initMap: function () {
      boot(function () {
        ensureMapAssetsInUrl();
        if (qs("debug") === "1" && window.MapCoords) {
          setStatus("Assets root: " + MapCoords.overlayAssetsRoot(), false);
        }
        var wrap = document.getElementById("map-wrap");
        var zoomHost = document.getElementById("map-zoom-host");
        if (wrap && window.ResizeObserver) {
          var resizeTarget = zoomHost || wrap;
          new ResizeObserver(function () {
            ensureMotionLoop();
          }).observe(resizeTarget);
        }
        loadPickupSpriteMap().then(function () {
          return loadPickupSpriteImage(resolveDeathSpriteUrl());
        });
        initPickupLogUi();
        if (replayMode()) {
          initMapReplay();
        } else {
          if (useWebSocket()) {
            initMapWebSocket();
          } else {
            loop(refreshMap, mapPollMs());
          }
          if (clientRecordEnabled()) {
            initClientRecordingUi();
          }
        }
      });
    },
    initViewer: initViewer,
    onMapPayload: function (fn) {
      mapPayloadListeners.push(fn);
    },
    onPickup: function (fn) {
      pickupListeners.push(fn);
    },
    _applyMapDotsPreview: applyMapDotsPreview,
    getMapMotionKeys: function () {
      return Object.keys(mapMotion.byId);
    },
    getMapDebugState: function () {
      return {
        last_ws_event: mapDebugState.lastWsEvent,
        ws_frame_count: mapDebugState.wsFrameCount,
        last_ws_player_count: mapDebugState.lastWsMessage
          ? (mapDebugState.lastWsMessage.players || []).length
          : null,
        last_ws_snippet: mapDebugState.lastWsMessage
          ? {
              event: mapDebugState.lastWsMessage.event,
              match_id: mapDebugState.lastWsMessage.match_id,
              map_name: mapDebugState.lastWsMessage.map_name,
              gametype: mapDebugState.lastWsMessage.gametype,
              player_count: (mapDebugState.lastWsMessage.players || []).length,
            }
          : null,
        map_motion_count: Object.keys(mapMotion.byId).length,
      };
    },
    overlayPageUrl: overlayPageUrl,
    openOverlayWindow: openOverlayWindow,
    mapSmoothEnabled: mapSmoothEnabled,
    mapSmoothAlpha: mapSmoothAlpha,
    lerpNum: lerpNum,
    refreshHud: function () {
      renderKillFeed();
      prunePickupToasts();
      renderPickupFeed();
      refreshPlayerMarkerPresentation();
      renderHeatmap(mapMotion.currentPlayers, mapMotion.currentGametype);
    },
    clearHeatmap: clearHeatmap,
    resetMatchOverlayState: resetMatchOverlayState,
    _mapKey: mapKey,
    _resolveImageUrl: resolveImageUrl,
    useWebSocket: useWebSocket,
    replayMode: replayMode,
    overlayNowMs: overlayNowMs,
    playerMarkerRole: playerMarkerRole,
    mapPollMs: mapPollMs,
  };
})();
