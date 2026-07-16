(function () {
  "use strict";

  var STORAGE_KEY = "ql-live-overlay-base";

  // Widget config injection: when the map runs embedded (dashboard) instead of as
  // a standalone OBS page, parameters come from an opts object rather than the URL.
  var configOverride = null;
  function setConfigOverride(opts) {
    configOverride = opts || null;
  }

  // Map-scoped teardown registry so the embedded widget can stop WS/loops/RAF/
  // observers on unmount (OBS page never unmounts; SPA navigation does).
  var mapWidgetCleanups = [];
  var mapSnapshotQueue = Promise.resolve();
  function registerMapCleanup(fn) {
    if (typeof fn === "function") mapWidgetCleanups.push(fn);
  }
  function runMapCleanups() {
    while (mapWidgetCleanups.length) {
      var fn = mapWidgetCleanups.pop();
      try {
        fn();
      } catch (_e) {
        /* ignore cleanup errors */
      }
    }
    // Listener arrays are re-populated on the next mount (MapSpawns.init /
    // initMap); reset to avoid duplicate handlers across re-mounts.
    if (mapPayloadListeners) mapPayloadListeners.length = 0;
    if (pickupListeners) pickupListeners.length = 0;
    // Dashboard re-registers this after each mount; drop the stale closure so a
    // previous results view does not keep receiving replay cursor updates.
    replayCursorListener = null;
    // These guard one-time event binding, but SPA re-mount rebuilds the replay
    // bar DOM. Without resetting, bindReplayBar()/segment/record controls skip
    // re-binding and the freshly-created Play/scrub/segment buttons stay dead
    // (works on the standalone OBS page, which never unmounts; breaks embedded).
    replayControlsBound = false;
    replaySelectBound = false;
    recordControlsBound = false;
    stopReplayPlayback();
    replayState = null;
    replayClock.active = false;
    replayClock.epochMs = 0;
    replayClock.cursorMs = 0;
    if (document.body) document.body.classList.remove("map-replay-mode");
    // Map render caches are module-scoped (shared with the OBS page, which never
    // unmounts). SPA re-mount rebuilds the DOM with a fresh empty <img>, so these
    // caches must be cleared: otherwise applyMapImage() sees url === currentImageSrc
    // and ensureReplayMapFromPositions() sees a cached transform, both skip loading
    // the image, and the stage stays black until a full page reload.
    cachedMapKey = "";
    cachedTransform = null;
    currentImageSrc = "";
    mapImageLoaded = false;
    lastMapContext.map_name = null;
    lastMapContext.gametype = null;
    lastMapContext.match_id = null;
    lastMapContext.warmup = null;
    lastMapContext.phase = null;
    lastMapContext._overlay_map = null;
    lastMapContext.players = [];
    mapLiveMatchRow = null;
    mapPauseStartedWallMs = null;
    mapPauseFrozenOverlayMs = null;
    mapLifecycleWalls.countdownWallT = null;
    mapLifecycleWalls.matchStartWallT = null;
    mapLifecycleWalls.countdownLeadMs = null;
    mapArchiveMarkers = null;
    mapArchiveFetchPromise = null;
    stopMapTimerTicker();
    mapSnapshotQueue = Promise.resolve();
  }

  function qs(name, fallback) {
    if (
      configOverride &&
      Object.prototype.hasOwnProperty.call(configOverride, name)
    ) {
      var cv = configOverride[name];
      return cv == null ? fallback || "" : String(cv);
    }
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

  function recordingIdParam() {
    return qs("recording") || qs("replay_id") || "";
  }

  function replaySegmentParam() {
    if (!qs("segment")) return null;
    var n = Number(qs("segment"));
    return isFinite(n) ? Math.max(0, Math.floor(n)) : null;
  }

  var REPLAY_SEGMENT_GAP_MS = 10 * 60 * 1000;
  var REPLAY_SEGMENT_MIN_MS = 30 * 1000;
  var REPLAY_RESERVED_PLAYER_NAMES = {
    victim: true,
    picker: true,
    killer: true,
    world: true,
    spec: true,
    spectator: true,
  };

  function isValidReplaySteamId64(value) {
    var id = normalizeSteamId64(value);
    if (!id) return false;
    if (id.length < 16 || id.length > 20) return false;
    return id.indexOf("7656119") === 0;
  }

  function isReservedReplayPlayerName(name) {
    var key = stripQuakeColors(name).toLowerCase();
    return !!REPLAY_RESERVED_PLAYER_NAMES[key];
  }

  function isReplayMapPlayer(p) {
    if (!p) return false;
    return isValidReplaySteamId64(p.steam_id64);
  }

  function filterReplayPlayers(players) {
    var list = normalizePlayersList(players);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (isReplayMapPlayer(list[i])) out.push(list[i]);
    }
    return out;
  }

  function sanitizeReplayEvents(events) {
    return (events || []).map(function (ev) {
      if (ev.event !== "positions" || !ev.players) return ev;
      return Object.assign({}, ev, { players: filterReplayPlayers(ev.players) });
    });
  }

  function buildReplaySegments(events) {
    var segments = [];
    var current = null;
    var lastPosT = null;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var t = ev.t || 0;
      if (ev.event === "match_status" && ev.status === "ended") {
        if (current) {
          current.endT = t;
          segments.push(current);
          current = null;
        }
        lastPosT = null;
        continue;
      }
      if (ev.event !== "positions") continue;
      if (lastPosT != null && t - lastPosT >= REPLAY_SEGMENT_GAP_MS) {
        if (current) {
          current.endT = lastPosT;
          segments.push(current);
        }
        current = { startT: t, endT: t };
      } else if (!current) {
        current = { startT: t, endT: t };
      } else {
        current.endT = t;
      }
      lastPosT = t;
    }
    if (current) segments.push(current);
    var out = [];
    for (var si = 0; si < segments.length; si++) {
      var seg = segments[si];
      var durationMs = Math.max(0, (seg.endT || seg.startT) - seg.startT);
      if (durationMs < REPLAY_SEGMENT_MIN_MS) continue;
      out.push({
        index: out.length,
        startT: seg.startT,
        endT: seg.endT,
        durationMs: durationMs,
        label:
          "Game " +
          (out.length + 1) +
          " · " +
          fmtReplayClock(durationMs),
      });
    }
    return out;
  }

  function sliceReplayEvents(events, segment) {
    if (!segment) return events;
    return events.filter(function (ev) {
      var t = ev.t || 0;
      return t >= segment.startT && t <= segment.endT;
    });
  }

  function formatRecordingOptionLabel(row) {
    var parts = [];
    if (row.map_name) parts.push(row.map_name);
    if (row.duration_ms != null) parts.push(fmtReplayClock(row.duration_ms));
    if (row.started_at) {
      try {
        parts.push(new Date(Number(row.started_at)).toLocaleString());
      } catch (_e0) {
        parts.push(String(row.started_at));
      }
    }
    if (!parts.length) parts.push(row.recording_id || row.match_id || "?");
    return parts.join(" · ");
  }

  function populateReplaySelect(rows, selectedId) {
    var wrap = document.getElementById("map-replay-select-wrap");
    var sel = document.getElementById("map-replay-select");
    if (!sel) return;
    sel.innerHTML = "";
    if (!rows.length) {
      if (wrap) wrap.classList.add("hidden");
      return;
    }
    if (wrap) wrap.classList.toggle("hidden", rows.length <= 1);
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var opt = document.createElement("option");
      opt.value = row.recording_id || row.match_id || "";
      opt.textContent = formatRecordingOptionLabel(row);
      if (opt.value === selectedId) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  function populateSegmentSelect(segments, selectedIndex) {
    var wrap = document.getElementById("map-replay-segment-wrap");
    var sel = document.getElementById("map-replay-segment-select");
    if (!sel) return;
    sel.innerHTML = "";
    if (!segments.length || segments.length <= 1) {
      if (wrap) wrap.classList.add("hidden");
      return;
    }
    if (wrap) wrap.classList.remove("hidden");
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var opt = document.createElement("option");
      opt.value = String(seg.index);
      opt.textContent = seg.label;
      if (seg.index === selectedIndex) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  function updateReplayUrlParams(params) {
    try {
      var url = new URL(window.location.href);
      Object.keys(params).forEach(function (k) {
        if (params[k] == null || params[k] === "") url.searchParams.delete(k);
        else url.searchParams.set(k, String(params[k]));
      });
      window.history.replaceState(null, "", url.pathname + url.search);
    } catch (_e1) {
      /* ignore */
    }
  }

  var replayCatalogRows = [];
  var replaySelectBound = false;

  function bindReplaySelectHandlers() {
    if (replaySelectBound) return;
    replaySelectBound = true;
    var sel = document.getElementById("map-replay-select");
    var segSel = document.getElementById("map-replay-segment-select");
    if (sel) {
      sel.addEventListener("change", function () {
        var rid = sel.value;
        updateReplayUrlParams({ recording: rid, segment: null });
        setStatus("Loading replay…");
        loadServerReplay(rid, null).catch(function (err) {
          setStatus(String(err.message || err), true);
        });
      });
    }
    if (segSel) {
      segSel.addEventListener("change", function () {
        var rid = sel && sel.value ? sel.value : recordingIdParam() || matchId();
        var seg = Number(segSel.value) || 0;
        updateReplayUrlParams({ recording: rid, segment: seg });
        loadServerReplay(rid, seg).catch(function (err) {
          setStatus(String(err.message || err), true);
        });
      });
    }
  }

  async function fetchReplayCatalog(forMatchId) {
    var path = "/api/replays";
    if (forMatchId) path += "?match_id=" + encodeURIComponent(forMatchId);
    return fetchJson(path);
  }

  async function loadServerReplay(recordingId, segmentIndex) {
    var data = await fetchJson("/api/replays/" + encodeURIComponent(recordingId));
    var events = sanitizeReplayEvents(data.events || []);
    var segments = buildReplaySegments(events);
    var segIdx = segmentIndex;
    if (segIdx == null) segIdx = segments.length > 1 ? segments.length - 1 : 0;
    populateSegmentSelect(segments, segIdx);
    var segment = segments.length ? segments[segIdx] : null;
    if (segment) {
      events = sliceReplayEvents(events, segment);
      data.meta = Object.assign({}, data.meta || {});
      data.meta.started_at = segment.startT;
      data.meta.duration_ms = segment.durationMs;
    }
    data.events = events;
    await activateReplayData(data);
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
  var mapPauseStartedWallMs = null;
  var mapPauseFrozenOverlayMs = null;

  function livePauseAccumulatedMs() {
    return Number(mapLiveMatchRow && mapLiveMatchRow.pause_accumulated_ms) || 0;
  }

  function livePauseOffsetMs() {
    if (replayClock.active) return 0;
    var row = mapLiveMatchRow;
    if (!row) return 0;
    var pauseMs = livePauseAccumulatedMs();
    if (!row.paused) return pauseMs;
    var segmentStart = null;
    if (row.pause_started_at) {
      var parsed = Date.parse(row.pause_started_at);
      if (!isNaN(parsed)) segmentStart = parsed;
    }
    if (segmentStart == null && mapPauseStartedWallMs != null) {
      segmentStart = mapPauseStartedWallMs;
    }
    if (segmentStart != null) {
      pauseMs += Math.max(0, Date.now() - segmentStart);
    }
    return pauseMs;
  }

  function overlayNowMs() {
    if (replayClock.active) return replayClock.epochMs + replayClock.cursorMs;
    if (mapPauseFrozenOverlayMs != null) return mapPauseFrozenOverlayMs;
    return Date.now() - livePauseOffsetMs();
  }

  function refreshPauseSensitiveOverlays() {
    updateMapMatchTimer();
    if (
      window.MapSpawns &&
      typeof MapSpawns.refreshItemRespawnOverlays === "function"
    ) {
      MapSpawns.refreshItemRespawnOverlays();
    }
  }

  function syncPauseOverlayClock(isPaused) {
    if (isPaused) {
      if (mapPauseFrozenOverlayMs == null) {
        mapPauseFrozenOverlayMs = Date.now() - livePauseAccumulatedMs();
      }
    } else {
      mapPauseFrozenOverlayMs = null;
    }
  }

  function applyMapPauseFields(source, opts) {
    opts = opts || {};
    if (!source) return;
    var authoritative = opts.authoritative !== false;
    if (source.paused == null && source.pause_accumulated_ms == null) return;
    if (!mapLiveMatchRow) mapLiveMatchRow = {};
    var wasPaused = !!mapLiveMatchRow.paused;
    if (source.paused != null) {
      var nextPaused = !!source.paused;
      if (!authoritative && !nextPaused && wasPaused) {
        /* positions can lag match_update — ignore stale unpauses */
      } else {
        mapLiveMatchRow.paused = nextPaused;
      }
    }
    if (source.pause_accumulated_ms != null) {
      mapLiveMatchRow.pause_accumulated_ms = Number(source.pause_accumulated_ms) || 0;
    }
    if (source.pause_started_at) {
      mapLiveMatchRow.pause_started_at = source.pause_started_at;
    }
    var isPaused = !!mapLiveMatchRow.paused;
    if (isPaused && !wasPaused) {
      mapPauseStartedWallMs = Date.now();
      syncPauseOverlayClock(true);
    } else if (!isPaused && wasPaused) {
      mapPauseStartedWallMs = null;
      syncPauseOverlayClock(false);
    } else if (isPaused && mapPauseFrozenOverlayMs == null) {
      syncPauseOverlayClock(true);
    }
    if (isPaused !== wasPaused) {
      refreshPauseSensitiveOverlays();
    }
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
    return window.QLSettingsStore.readJsonKeys(["ql-dashboard-settings", "ql-control-settings"]);
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
    if (score !== 0) return score;
    var gt = String(gametype || (p && p.gametype) || "").toLowerCase();
    if (gt === "duel" || gt === "ffa" || gt === "deathmatch") {
      return kills;
    }
    return score;
  }

  function replayScorePlayerKey(steam, nick) {
    return steam ? "id:" + steam : "name:" + (nick || "?");
  }

  function collectReplayScoreRoster(events) {
    var byKey = {};
    var order = [];
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.event !== "positions") continue;
      var players = ev.players || [];
      for (var j = 0; j < players.length; j++) {
        var p = players[j];
        if (!isReplayMapPlayer(p)) continue;
        var steam = normalizeSteamId64(p.steam_id64);
        var nick = stripQuakeColors(p.nickname || p.name || "");
        var key = replayScorePlayerKey(steam, nick);
        if (!byKey[key]) {
          byKey[key] = {
            steam_id64: steam,
            nickname: nick || steam || "?",
            kills: 0,
            deaths: 0,
            score: 0,
          };
          order.push(key);
        }
      }
    }
    return { byKey: byKey, order: order };
  }

  function replayScoresAtTime(targetT) {
    if (!replayState) return [];
    var events = replayState.events || [];
    var roster = collectReplayScoreRoster(events);
    var byKey = roster.byKey;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.event !== "death") continue;
      if ((ev.t || 0) > targetT) break;
      var killerSteam = normalizeSteamId64(ev.killer_steam_id64);
      var victimSteam = normalizeSteamId64(ev.victim_steam_id64);
      var killer = stripQuakeColors(ev.killer_name || "");
      var victim = stripQuakeColors(ev.victim_name || "");
      var suicide =
        !killer ||
        killerSteam === victimSteam ||
        normalizeWeaponToken(ev.weapon) === "SUICIDE";
      if (!suicide && killer) {
        var krKey = replayScorePlayerKey(killerSteam, killer);
        if (!byKey[krKey]) {
          byKey[krKey] = {
            steam_id64: killerSteam,
            nickname: killer,
            kills: 0,
            deaths: 0,
            score: 0,
          };
          roster.order.push(krKey);
        }
        byKey[krKey].kills += 1;
        byKey[krKey].score = Math.max(byKey[krKey].score, byKey[krKey].kills);
      }
      if (victim) {
        var vrKey = replayScorePlayerKey(victimSteam, victim);
        if (!byKey[vrKey]) {
          byKey[vrKey] = {
            steam_id64: victimSteam,
            nickname: victim,
            kills: 0,
            deaths: 0,
            score: 0,
          };
          roster.order.push(vrKey);
        }
        byKey[vrKey].deaths += 1;
      }
    }
    return roster.order.map(function (k) {
      return byKey[k];
    });
  }

  function renderMapScoreHud(players, gametype) {
    var el = document.getElementById("map-score");
    if (!el) return;
    if (hudSettings().showMapScore === false) {
      el.classList.add("hidden");
      return;
    }
    if (!replayState) {
      var phase = mapLivePhase();
      if (phase === "warmup" || phase === "countdown" || phase === "ended") {
        el.classList.add("hidden");
        el.innerHTML = "";
        return;
      }
    }
    players = players || [];
    if (!players.length) {
      el.classList.add("hidden");
      el.innerHTML = "";
      return;
    }
    gametype = String(gametype || lastMapContext.gametype || "").toLowerCase();
    el.classList.remove("hidden");
    if (players.length === 2) {
      var left = players[0];
      var right = players[1];
      var ls = playerDisplayScore(left, gametype);
      var rs = playerDisplayScore(right, gametype);
      el.innerHTML =
        '<div class="map-score-duel">' +
        '<span class="map-score-name map-score-left">' +
        escapeHtmlText(left.nickname) +
        "</span>" +
        '<span class="map-score-mid">' +
        escapeHtmlText(String(ls) + " : " + String(rs)) +
        "</span>" +
        '<span class="map-score-name map-score-right">' +
        escapeHtmlText(right.nickname) +
        "</span></div>";
      return;
    }
    var sorted = players.slice().sort(function (a, b) {
      return playerDisplayScore(b, gametype) - playerDisplayScore(a, gametype);
    });
    var rows = "";
    for (var i = 0; i < sorted.length; i++) {
      var p = sorted[i];
      rows +=
        '<div class="map-score-row"><span class="map-score-name">' +
        escapeHtmlText(p.nickname) +
        '</span><span class="map-score-val">' +
        escapeHtmlText(String(playerDisplayScore(p, gametype))) +
        "</span></div>";
    }
    el.innerHTML = '<div class="map-score-list">' + rows + "</div>";
  }

  function renderReplayScoreHud(targetT) {
    if (!replayState) return;
    renderMapScoreHud(
      replayScoresAtTime(targetT),
      replayState.meta.gametype || lastMapContext.gametype,
    );
  }

  var liveMapScoreFetchTimer = 0;
  var liveMapScoreFetchInFlight = false;

  function scheduleLiveMapScoreFetch() {
    if (replayState) return;
    if (liveMapScoreFetchTimer) return;
    liveMapScoreFetchTimer = setTimeout(function () {
      liveMapScoreFetchTimer = 0;
      ensureLiveMapScoreFromHttp();
    }, 400);
  }

  async function ensureLiveMapScoreFromHttp() {
    if (replayState || liveMapScoreFetchInFlight) return;
    if (lastMapContext.players && lastMapContext.players.length) return;
    var id = lastMapContext.match_id || matchId();
    if (!id) return;
    try {
      requireApiBase();
    } catch (_e) {
      return;
    }
    liveMapScoreFetchInFlight = true;
    try {
      var row = await fetchJson("/api/stream/matches/" + encodeURIComponent(id));
      if (!row) return;
      syncMapLivePhase(row);
      if (Array.isArray(row.players) && row.players.length) {
        lastMapContext.players = row.players;
      }
      if (row.gametype) lastMapContext.gametype = row.gametype;
      renderLiveMapScoreHud();
    } catch (_err) {
      /* stream match optional until hub has roster */
    } finally {
      liveMapScoreFetchInFlight = false;
    }
  }

  function renderLiveMapScoreHud() {
    if (replayState) return;
    renderMapScoreHud(lastMapContext.players, lastMapContext.gametype);
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

  var scoreboardWsState = { handle: null };

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

    scoreboardWsState.handle = window.QLLiveWs.connect(
      function () {
        var wsProto = base.indexOf("https") === 0 ? "wss" : "ws";
        var hostPath = base.replace(/^https?:\/\//, "");
        return wsProto + "://" + hostPath + "/api/ws/live?match=" + encodeURIComponent(id);
      },
      {
        backoffMs: 2500,
        onMessage: function (ev) {
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
        },
      },
    );
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
    wsHandle: null,
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
    if (row.countdown) return "countdown";
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
    if (phase === "countdown") return operatorT("phaseCountdown");
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
    if (typeof QLDashboard !== "undefined" && QLDashboard.computeMatchElapsedSec) {
      return QLDashboard.computeMatchElapsedSec(row);
    }
    if (row.paused && row.elapsed_sec != null) return row.elapsed_sec;
    var now = Date.now();
    if (!row.paused && row.elapsed_sec != null && row.clock_at) {
      var atElapsed = Date.parse(row.clock_at);
      if (!isNaN(atElapsed)) {
        return row.elapsed_sec + Math.floor((now - atElapsed) / 1000);
      }
      return row.elapsed_sec;
    }
    if (row.started_at) {
      var startedAt = Date.parse(row.started_at);
      if (!isNaN(startedAt)) {
        var wallSec = Math.max(0, Math.floor((now - startedAt) / 1000));
        var pauseMs = Number(row.pause_accumulated_ms) || 0;
        if (row.paused) {
          var pauseStart = null;
          if (row.pause_started_at) {
            pauseStart = Date.parse(row.pause_started_at);
            if (isNaN(pauseStart)) pauseStart = null;
          }
          if (pauseStart == null && mapPauseStartedWallMs != null) {
            pauseStart = mapPauseStartedWallMs;
          }
          if (pauseStart != null) {
            pauseMs += Math.max(0, now - pauseStart);
          }
        }
        return Math.max(0, wallSec - Math.floor(pauseMs / 1000));
      }
    }
    if (!row.paused && row.game_time_ms != null && row.game_time_ms > 0 && row.clock_at) {
      var at = Date.parse(row.clock_at);
      if (!isNaN(at)) {
        return Math.floor((row.game_time_ms + (now - at)) / 1000);
      }
      return Math.floor(row.game_time_ms / 1000);
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
    if (phase === "countdown") {
      el.textContent = operatorT("phaseCountdown");
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
    if (typeof QLDashboard !== "undefined" && QLDashboard.t) {
      return QLDashboard.t(key);
    }
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

    matchesListState.wsHandle = window.QLLiveWs.connect(
      function () {
        var wsProto = base.indexOf("https") === 0 ? "wss" : "ws";
        var hostPath = base.replace(/^https?:\/\//, "");
        return wsProto + "://" + hostPath + "/api/ws/live";
      },
      {
        backoffMs: 2500,
        onMessage: function (ev) {
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
        },
      },
    );
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

    window.QLLiveWs.connect(
      function () {
        var wsProto = base.indexOf("https") === 0 ? "wss" : "ws";
        var hostPath = base.replace(/^https?:\/\//, "");
        return wsProto + "://" + hostPath + "/api/ws/live?match=" + encodeURIComponent(id);
      },
      {
        backoffMs: 2500,
        onMessage: function (ev) {
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
        },
      },
    );
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
  var lastMapContext = {
    map_name: null,
    gametype: null,
    match_id: null,
    warmup: null,
    phase: null,
    players: [],
  };
  var mapLiveMatchRow = null;
  var mapLifecycleWalls = {
    countdownWallT: null,
    matchStartWallT: null,
    countdownLeadMs: null,
  };
  var mapArchiveMarkers = null;
  var mapArchiveFetchPromise = null;
  var mapTimerTicker = null;

  function mapLivePhase() {
    if (lastMapContext.phase) return lastMapContext.phase;
    if (lastMapContext.warmup === true) return "warmup";
    return null;
  }

  function mapPositionsVisible() {
    if (replayMode()) return true;
    var phase = mapLivePhase();
    if (phase === "ended") return false;
    // Pre-match warmup/countdown + in-progress; post-game warmup gets empty players from API.
    return (
      phase === "playing" ||
      phase === "warmup" ||
      phase === "countdown" ||
      phase == null
    );
  }

  function syncMapLivePhase(matchRow) {
    if (!matchRow) return;
    applyMapPauseFields(matchRow, { authoritative: true });
    mapLiveMatchRow = Object.assign({}, mapLiveMatchRow || {}, matchRow);
    if (mapLiveMatchRow.paused) {
      syncPauseOverlayClock(true);
    }
    var phase = matchRow.phase
      ? String(matchRow.phase).toLowerCase()
      : matchPhase(matchRow);
    lastMapContext.phase = phase;
    lastMapContext.warmup = phase === "warmup";
    if (phase === "countdown" || matchRow.countdown) {
      ensureMapArchiveMarkers(matchRow.match_id || lastMapContext.match_id);
    }
    updateLiveLifecycleBanner();
    ensureMapTimerTicker();
  }

  function mapClockFormatSec(sec) {
    if (typeof QLDashboard !== "undefined" && QLDashboard.formatClockSec) {
      return QLDashboard.formatClockSec(sec);
    }
    return formatClockSec(sec);
  }

  function mapClockElapsedSec(row) {
    if (typeof QLDashboard !== "undefined" && QLDashboard.computeMatchElapsedSec) {
      return QLDashboard.computeMatchElapsedSec(row);
    }
    return computeMatchElapsedSec(row);
  }

  function parseLifecycleTsMs(ts) {
    if (!ts) return null;
    var t = Date.parse(ts);
    return isNaN(t) ? null : t;
  }

  function syncMapLifecycleWallsFromMarkers(markers) {
    if (!markers || !markers.length) return;
    var A =
      typeof QLDashboardAnalytics !== "undefined" ? QLDashboardAnalytics : null;
    var cd = A ? A.countdownStartWallMs({ markers: markers }) : null;
    var ms = A ? A.matchStartWallMs({ markers: markers }) : null;
    if (cd == null || ms == null) {
      for (var i = markers.length - 1; i >= 0; i--) {
        var row = markers[i];
        if (!row) continue;
        var kind = String(row.kind || "").toLowerCase();
        var ts = parseLifecycleTsMs(row.ts);
        if (kind === "countdown_start" && cd == null && ts != null) cd = ts;
        if (kind === "match_start" && ms == null && ts != null) ms = ts;
      }
    }
    if (cd != null) mapLifecycleWalls.countdownWallT = cd;
    if (ms != null) mapLifecycleWalls.matchStartWallT = ms;
    if (cd != null && ms != null) {
      mapLifecycleWalls.countdownLeadMs = Math.max(0, Math.round(ms - cd));
    }
  }

  function ensureMapArchiveMarkers(matchId) {
    if (mapArchiveMarkers || !matchId) return mapArchiveFetchPromise;
    if (mapArchiveFetchPromise) return mapArchiveFetchPromise;
    mapArchiveFetchPromise = fetchJson(
      "/api/stream/matches/" + encodeURIComponent(matchId) + "/archive-summary",
    )
      .then(function (arch) {
        mapArchiveMarkers = (arch && arch.markers) || [];
        syncMapLifecycleWallsFromMarkers(mapArchiveMarkers);
        updateMapMatchTimer();
      })
      .catch(function () {
        mapArchiveMarkers = [];
      })
      .finally(function () {
        mapArchiveFetchPromise = null;
      });
    return mapArchiveFetchPromise;
  }

  function noteMapLifecycleFromSession(ev) {
    if (!ev) return;
    var kind = String(ev.kind || "").toLowerCase();
    var ts = parseLifecycleTsMs(ev.ts) || Date.now();
    if (kind === "countdown_start") {
      mapLifecycleWalls.countdownWallT = ts;
    } else if (kind === "match_start") {
      mapLifecycleWalls.matchStartWallT = ts;
      if (mapLifecycleWalls.countdownWallT != null) {
        mapLifecycleWalls.countdownLeadMs = Math.max(
          0,
          ts - mapLifecycleWalls.countdownWallT,
        );
      }
    } else if (kind === "pause_start") {
      applyMapPauseFields(
        {
          paused: true,
          pause_accumulated_ms: livePauseAccumulatedMs(),
        },
        { authoritative: true },
      );
    } else if (kind === "pause_end") {
      var meta = ev.meta && typeof ev.meta === "object" ? ev.meta : {};
      var acc = livePauseAccumulatedMs();
      if (meta.duration_ms != null && isFinite(Number(meta.duration_ms))) {
        acc += Math.max(0, Number(meta.duration_ms));
      }
      applyMapPauseFields(
        {
          paused: false,
          pause_accumulated_ms: acc,
        },
        { authoritative: true },
      );
    }
  }

  function countdownRemainingMsLive(nowMs) {
    var cd = mapLifecycleWalls.countdownWallT;
    var ms = mapLifecycleWalls.matchStartWallT;
    if (ms != null && nowMs < ms) {
      return Math.max(0, ms - nowMs);
    }
    if (cd != null && mapLifecycleWalls.countdownLeadMs != null) {
      return Math.max(0, mapLifecycleWalls.countdownLeadMs - (nowMs - cd));
    }
    return null;
  }

  function buildReplayPauseIntervals(events) {
    var out = [];
    var open = null;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var kind = String(ev.event || "").toLowerCase();
      if (kind === "pause_start") {
        open = {
          wallStart: ev.t || 0,
          gameMs: replayGameTimeFieldMs(ev),
        };
      } else if (kind === "pause_end" && open) {
        out.push({
          wallStart: open.wallStart,
          wallEnd: ev.t || open.wallStart,
          gameMs: open.gameMs,
        });
        open = null;
      }
    }
    return out;
  }

  function replayPausedAtWall(wallT) {
    if (!replayState) return null;
    if (!replayState.pauseIntervals) {
      replayState.pauseIntervals = buildReplayPauseIntervals(replayState.events || []);
    }
    var rows = replayState.pauseIntervals;
    for (var i = 0; i < rows.length; i++) {
      var iv = rows[i];
      if (wallT >= iv.wallStart && wallT < iv.wallEnd) return iv;
    }
    return null;
  }

  // Position telemetry rarely carries its own game_time_ms (the backend only
  // refreshes the match's game clock alongside less-frequent events like
  // kills - stats_hub.store.update_positions falls back to that stale
  // per-match value), so death/pickup samples can be minutes apart. Returning
  // the last sample's raw value verbatim made the on-map clock visibly freeze
  // between them and jump only when a new sample arrived. Interpolate forward
  // by the elapsed wall-time since that sample instead, so it ticks smoothly
  // every second like a real clock; replayPausedAtWall() above already
  // short-circuits this while an actual pause is in effect.
  function replayGameClockMsAtWall(wallT) {
    if (!replayState) return null;
    var paused = replayPausedAtWall(wallT);
    if (paused && paused.gameMs != null) return Math.max(0, paused.gameMs);
    var events = replayState.events || [];
    var best = null;
    var bestEventT = null;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if ((ev.t || 0) > wallT) break;
      var g = replayGameTimeFieldMs(ev);
      if (g != null) {
        best = g;
        bestEventT = ev.t || 0;
      }
    }
    if (best != null) {
      return Math.max(0, best + Math.max(0, wallT - bestEventT));
    }
    if (replayState.gameStartWall != null && wallT >= replayState.gameStartWall) {
      return Math.max(0, wallT - replayState.gameStartWall);
    }
    return null;
  }

  function replayTimelimitSec() {
    if (!replayState) return null;
    var events = replayState.events || [];
    for (var i = events.length - 1; i >= 0; i--) {
      var ev = events[i];
      if (ev.event === "match_start" && ev.meta && ev.meta.timelimit_sec != null) {
        var tl = Number(ev.meta.timelimit_sec);
        if (!isNaN(tl) && tl > 0) return tl;
      }
      if (ev.event === "match_end" && ev.meta && ev.meta.timelimit_sec != null) {
        var tl2 = Number(ev.meta.timelimit_sec);
        if (!isNaN(tl2) && tl2 > 0) return tl2;
      }
    }
    if (replayState.meta && replayState.meta.timelimit_sec != null) {
      var tl3 = Number(replayState.meta.timelimit_sec);
      if (!isNaN(tl3) && tl3 > 0) return tl3;
    }
    return null;
  }

  function resolveLiveMapTimerState() {
    var row = mapLiveMatchRow;
    if (!row) return null;
    var phase = mapLivePhase() || matchPhase(row);
    if (phase === "warmup" || phase === "ended") return null;
    if (phase === "countdown" || row.countdown) {
      var remMs = countdownRemainingMsLive(Date.now());
      if (remMs == null) return null;
      return {
        show: true,
        phase: "countdown",
        text: mapClockFormatSec(Math.ceil(remMs / 1000)),
        paused: false,
      };
    }
    if (phase === "playing" || phase == null) {
      if (row.paused) {
        var pausedElapsed = mapClockElapsedSec(row);
        var pausedLabel =
          pausedElapsed != null ? mapClockFormatSec(pausedElapsed) : "—";
        pausedLabel += " · " + operatorT("phasePaused");
        return {
          show: true,
          phase: "paused",
          text: pausedLabel,
          paused: true,
        };
      }
      var elapsed = mapClockElapsedSec(row);
      if (elapsed == null) return null;
      var label = mapClockFormatSec(elapsed);
      return { show: true, phase: "playing", text: label, paused: false };
    }
    return null;
  }

  function resolveReplayMapTimerState() {
    if (!replayState) return null;
    var wallT = replayState.startMs + replayState.cursorMs;
    var info = resolveReplayLifecyclePhase(wallT);
    var cd = replayState.countdownWallT;
    var ms = replayState.matchStartWallT;
    var me = replayState.matchEndWallT;
    if (info && info.phase === "ended") return null;
    if (ms != null && cd != null && wallT >= cd && wallT < ms) {
      var rem = Math.max(0, ms - wallT);
      return {
        show: true,
        phase: "countdown",
        text: mapClockFormatSec(Math.ceil(rem / 1000)),
        paused: false,
      };
    }
    if (info && info.phase === "countdown") {
      var lead =
        cd != null && ms != null ? Math.max(0, ms - cd) : mapLifecycleWalls.countdownLeadMs;
      if (lead != null && cd != null) {
        var elapsed = wallT - cd;
        var rem2 = Math.max(0, lead - elapsed);
        return {
          show: true,
          phase: "countdown",
          text: mapClockFormatSec(Math.ceil(rem2 / 1000)),
          paused: false,
        };
      }
    }
    if (ms != null && wallT >= ms && (me == null || wallT < me)) {
      var pausedIv = replayPausedAtWall(wallT);
      var gameMs = replayGameClockMsAtWall(wallT);
      if (gameMs == null) return null;
      var gameLabel = mapClockFormatSec(Math.floor(gameMs / 1000));
      if (pausedIv) gameLabel += " · " + operatorT("phasePaused");
      return {
        show: true,
        phase: pausedIv ? "paused" : "playing",
        text: gameLabel,
        paused: !!pausedIv,
      };
    }
    return null;
  }

  function resolveMapTimerState() {
    if (replayState) return resolveReplayMapTimerState();
    return resolveLiveMapTimerState();
  }

  function updateMapMatchTimer() {
    var el = document.getElementById("map-match-timer");
    if (!el) return;
    var state = resolveMapTimerState();
    if (!state || !state.show) {
      el.classList.add("hidden");
      el.textContent = "";
      el.className = "map-match-timer hidden";
      return;
    }
    el.classList.remove("hidden");
    el.className =
      "map-match-timer map-match-timer--" +
      state.phase +
      (state.paused ? " map-match-timer--paused" : "");
    el.textContent = state.text;
  }

  function tickMapMatchTimer() {
    updateMapMatchTimer();
  }

  function ensureMapTimerTicker() {
    if (mapTimerTicker) return;
    mapTimerTicker = setInterval(tickMapMatchTimer, 1000);
    registerMapCleanup(function () {
      if (mapTimerTicker) {
        clearInterval(mapTimerTicker);
        mapTimerTicker = null;
      }
    });
  }

  function stopMapTimerTicker() {
    if (mapTimerTicker) {
      clearInterval(mapTimerTicker);
      mapTimerTicker = null;
    }
  }

  function replayLifecycleLabels() {
    if (typeof QLDashboard !== "undefined" && QLDashboard.t) {
      return {
        countdown: QLDashboard.t("phaseCountdown"),
        started: QLDashboard.t("lifecycleMatchStarted"),
        ended: QLDashboard.t("lifecycleMatchEnded"),
        playing: QLDashboard.t("phaseLive"),
        warmup: QLDashboard.t("phaseWarmup"),
      };
    }
    return {
      countdown: "Countdown",
      started: "Match started",
      ended: "Match ended",
      playing: "Live",
      warmup: "Warmup",
    };
  }

  function updateLiveLifecycleBanner() {
    if (replayState) return;
    var banner = document.getElementById("map-lifecycle-banner");
    if (!banner) {
      updateMapMatchTimer();
      return;
    }
    var phase = mapLivePhase();
    var labels = replayLifecycleLabels();
    var label = "";
    if (phase === "countdown") label = labels.countdown;
    else if (phase === "warmup") label = labels.warmup;
    else if (phase === "ended") label = labels.ended;
    else {
      banner.classList.add("hidden");
      banner.textContent = "";
      updateMapMatchTimer();
      return;
    }
    banner.classList.remove("hidden");
    banner.className = "map-lifecycle-banner map-lifecycle-banner--" + phase;
    banner.textContent = label;
    updateMapMatchTimer();
  }

  function replayLifecycleCursorMs(wallT) {
    if (!replayState || wallT == null || !isFinite(Number(wallT))) return null;
    return Number(wallT) - replayState.startMs;
  }

  function buildReplayLifecycleMarkers() {
    var layer = document.getElementById("map-replay-lifecycle");
    if (!layer || !replayState) return;
    var dur = replayState.durationMs || 0;
    if (dur <= 0) {
      layer.classList.add("hidden");
      layer.innerHTML = "";
      return;
    }
    var labels = replayLifecycleLabels();
    var defs = [
      { key: "countdownWallT", css: "countdown", label: labels.countdown },
      { key: "matchStartWallT", css: "started", label: labels.started },
      { key: "matchEndWallT", css: "ended", label: labels.ended },
    ];
    var html = "";
    var any = false;
    for (var i = 0; i < defs.length; i++) {
      var wallT = replayState[defs[i].key];
      if (wallT == null || !isFinite(Number(wallT))) continue;
      var cursor = replayLifecycleCursorMs(wallT);
      if (cursor == null || cursor < 0 || cursor > dur) continue;
      any = true;
      var pct = (cursor / dur) * 100;
      html +=
        '<span class="map-replay-life map-replay-life--' +
        defs[i].css +
        '" style="left:' +
        pct.toFixed(2) +
        '%" title="' +
        escapeHtmlText(defs[i].label) +
        '"><span class="map-replay-life-mark"></span></span>';
    }
    if (!any) {
      layer.classList.add("hidden");
      layer.innerHTML = "";
      return;
    }
    layer.classList.remove("hidden");
    layer.innerHTML = html;
  }

  function resolveReplayLifecyclePhase(wallT) {
    if (!replayState || wallT == null || !isFinite(Number(wallT))) return null;
    var labels = replayLifecycleLabels();
    var w = Number(wallT);
    var me = replayState.matchEndWallT;
    var ms = replayState.matchStartWallT;
    var cd = replayState.countdownWallT;
    if (me != null && w >= me) return { phase: "ended", label: labels.ended };
    if (ms != null && w >= ms) {
      if (w - ms < 800) return { phase: "started", label: labels.started };
      return { phase: "playing", label: labels.playing };
    }
    if (cd != null && w >= cd) return { phase: "countdown", label: labels.countdown };
    return null;
  }

  function updateReplayLifecycleBanner() {
    var banner = document.getElementById("map-lifecycle-banner");
    if (!banner || !replayState) {
      updateMapMatchTimer();
      return;
    }
    var wallT = replayState.startMs + replayState.cursorMs;
    var info = resolveReplayLifecyclePhase(wallT);
    if (!info) {
      banner.classList.add("hidden");
      banner.textContent = "";
      updateMapMatchTimer();
      return;
    }
    banner.classList.remove("hidden");
    banner.className = "map-lifecycle-banner map-lifecycle-banner--" + info.phase;
    banner.textContent = info.label;
    updateMapMatchTimer();
  }

  function clearLiveMapPlayers() {
    clearMapMotion();
    applyMapDotsPreview({
      match_id: lastMapContext.match_id,
      map_name: lastMapContext.map_name,
      gametype: lastMapContext.gametype,
      players: [],
      transform: cachedTransform,
    });
  }
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
  var mapImpactMarkers = [];
  var mapBeamMarkers = {};
  var mapProjectileMarkers = {};

  function deathMarkerSec() {
    return Math.max(2, Math.min(120, Number(qs("death_sec", "4")) || 4));
  }

  var deathSpriteUrl = "";

  function ensureMapAssetsInUrl() {
    // Embedded widget: do not touch the host page URL. Assets resolve via
    // MapCoords.pageOverlayAssetsRoot() (the /live-overlay/ root), so no param
    // is needed and mutating the URL would clobber the dashboard hash route.
    if (configOverride) return;
    if (qs("assets")) return;
    if (!window.MapCoords || typeof MapCoords.overlayAssetsRoot !== "function") return;
    var root = MapCoords.overlayAssetsRoot();
    if (!root) return;
    var pageRoot = new URL("./", window.location.href).href;
    if (root === pageRoot) return;
    var params = new URLSearchParams(window.location.search);
    params.set("assets", root.replace(/\/+$/, ""));
    var next =
      window.location.pathname + "?" + params.toString() + window.location.hash;
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

  // Raw dm_91 weapon index (qldemo/weapons.js WEAPON_SLUG) -> our own existing
  // pickup sprite file. Used for the killfeed/pickup log and as a fallback for
  // weapons the imported UDT set doesn't cover (BFG, grapple).
  var WEAPON_ICON_FILE = {
    1: "iconw_gauntlet.png",
    2: "iconw_machinegun.png",
    3: "iconw_shotgun.png",
    4: "iconw_grenade.png",
    5: "iconw_rocket.png",
    6: "iconw_lightning.png",
    7: "iconw_railgun.png",
    8: "iconw_plasma.png",
    9: "iconw_bfg.png",
    10: "iconw_grapple.png",
  };
  var weaponIconUrlCache = {};

  function weaponIconUrlById(weaponId) {
    var file = WEAPON_ICON_FILE[Number(weaponId)];
    return weaponIconUrlByFile(file);
  }

  var WEAPON_ICON_FILE_BY_SLUG = {
    gauntlet: "iconw_gauntlet.png",
    machinegun: "iconw_machinegun.png",
    shotgun: "iconw_shotgun.png",
    grenadelauncher: "iconw_grenade.png",
    rocketlauncher: "iconw_rocket.png",
    lightninggun: "iconw_lightning.png",
    railgun: "iconw_railgun.png",
    plasmagun: "iconw_plasma.png",
    bfg: "iconw_bfg.png",
    grapple: "iconw_grapple.png",
  };

  function weaponIconUrlBySlug(slug) {
    var file = WEAPON_ICON_FILE_BY_SLUG[String(slug || "").toLowerCase()];
    return weaponIconUrlByFile(file);
  }

  function weaponIconUrlByFile(file) {
    if (!file) return "";
    if (!weaponIconUrlCache[file]) {
      weaponIconUrlCache[file] = resolveOverlayAsset("maps/sprites/" + file);
    }
    return weaponIconUrlCache[file];
  }

  // Sprites imported from the UDT viewer's own asset pack (maps/sprites/udt/,
  // see SOURCE.txt there) — in-hand weapons, projectiles, impact marks and
  // explosion frames, used with the project owner's sign-off.
  var udtSpriteUrlCache = {};
  function udtSpriteUrl(file) {
    if (!file) return "";
    if (!udtSpriteUrlCache[file]) {
      udtSpriteUrlCache[file] = resolveOverlayAsset("maps/sprites/udt/" + file);
    }
    return udtSpriteUrlCache[file];
  }

  // Weapon id -> UDT in-hand sprite (DrawPlayerWeapon in the UDT viewer).
  // BFG (9) and grapple (10) aren't in UDT's bundled set — fall back to our
  // own flat pickup icon so something still renders.
  var WEAPON_HAND_SPRITE_FILE = {
    1: "gauntlet.png",
    2: "mg.png",
    3: "sg.png",
    4: "gl.png",
    5: "rl.png",
    6: "lg.png",
    7: "rg.png",
    8: "pg.png",
  };

  function weaponHandSpriteUrlById(weaponId) {
    var file = WEAPON_HAND_SPRITE_FILE[Number(weaponId)];
    if (file) return udtSpriteUrl(file);
    return weaponIconUrlById(weaponId);
  }

  function createDeathCrossMarker() {
    var marker = document.createElement("div");
    marker.className = "map-death-marker map-death-marker-cross";
    marker.setAttribute("aria-hidden", "true");
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "map-death-marker-cross-svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    var lineA = document.createElementNS("http://www.w3.org/2000/svg", "line");
    lineA.setAttribute("x1", "6");
    lineA.setAttribute("y1", "6");
    lineA.setAttribute("x2", "18");
    lineA.setAttribute("y2", "18");
    var lineB = document.createElementNS("http://www.w3.org/2000/svg", "line");
    lineB.setAttribute("x1", "18");
    lineB.setAttribute("y1", "6");
    lineB.setAttribute("x2", "6");
    lineB.setAttribute("y2", "18");
    svg.appendChild(lineA);
    svg.appendChild(lineB);
    marker.appendChild(svg);
    return marker;
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
      showWeaponInHand: false,
      playerMarkerMinPx: 8,
      playerMarkerMaxPx: 14,
      playerLabelFontPx: 11,
      mapZoomPercent: 100,
    };
  }

  // rockets/grenades: "hide" | "show" | "splash" (splash = explosion sprite on
  // impact, show = projectile only with a plain impact mark).
  // railgun/lightninggun: "hide" | "show" (beam line).
  // machinegun: "hide" | "show" (bullet impact marks — MG and SG hits share
  // the same network event with no reliable per-weapon tag in this protocol,
  // so this also covers SG marks; see WP_ROCKET/WP_GRENADE comment below).
  function weaponFxSettings() {
    if (window.MapSpawns && typeof MapSpawns.getWeaponFxSettings === "function") {
      return MapSpawns.getWeaponFxSettings();
    }
    return {
      rockets: "splash",
      grenades: "splash",
      railgun: "show",
      lightninggun: "show",
      machinegun: "show",
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
      selfColor: "#ef4444",
      opponentColor: "#3b82f6",
      otherColor: "#f97316",
    };
  }

  function playerColorSettings() {
    if (window.MapSpawns && typeof MapSpawns.getPlayerColors === "function") {
      return MapSpawns.getPlayerColors();
    }
    return {
      selfColor: "#ef4444",
      opponentColor: "#3b82f6",
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

  function normalizeTeamName(team) {
    var t = String(team == null ? "" : team)
      .trim()
      .toLowerCase();
    if (t === "1") return "red";
    if (t === "2") return "blue";
    return t;
  }

  function findPlayerById(players, playerId) {
    var list = normalizePlayersList(players);
    for (var i = 0; i < list.length; i++) {
      if (playerMotionId(list[i], i) === playerId) return list[i];
    }
    return null;
  }

  // Role -> color mapping (see theme.players): "self" = color 1 (Team Red /
  // Opponent 1), "opponent" = color 2 (Team Blue / Opponent 2), "other" = hidden
  // fallback for 3+ / unteamed players. There is no local "self" in demos, so we
  // color by actual team; a 2-player duel without teams falls back to the
  // reference player vs the other.
  function playerMarkerRole(playerId, players, gametype) {
    var p = findPlayerById(players, playerId);
    var team = p ? normalizeTeamName(p.team) : "";
    if (team === "red") return "self";
    if (team === "blue") return "opponent";
    if (isDuelLikeContext(players, gametype)) {
      var refId = resolveReferencePlayerId(players);
      if (refId) return playerId === refId ? "self" : "opponent";
    }
    return "other";
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

  function clearPickupOverlayState() {
    mapPickupToasts = [];
    mapPickupLog = [];
    if (pickupToastLoopId) {
      cancelAnimationFrame(pickupToastLoopId);
      pickupToastLoopId = 0;
    }
    var pickupsEl = document.getElementById("map-pickups");
    if (pickupsEl) pickupsEl.innerHTML = "";
    renderPickupLog();
  }

  function resetMatchOverlayState(reason, payload) {
    clearHeatmap();
    mapDeathMarkers = [];
    var deathLayer = document.getElementById("map-deaths");
    if (deathLayer) deathLayer.innerHTML = "";
    mapImpactMarkers = [];
    var impactLayer = document.getElementById("map-impacts");
    if (impactLayer) impactLayer.innerHTML = "";
    mapBeamMarkers = {};
    var beamLayer = document.getElementById("map-beams");
    if (beamLayer) beamLayer.innerHTML = "";
    clearProjectileMarkers();
    mapKillFeed = [];
    mapKillFeedDedup = [];
    renderKillFeed();
    if (
      reason === "match_end" ||
      reason === "replay_seek" ||
      reason === "game_start" ||
      reason === "match_id" ||
      reason === "map"
    ) {
      clearPickupOverlayState();
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

  function handleGameStartedEvent(data) {
    if (!data) return;
    resetMatchOverlayState("game_start", {
      match_id: data.match_id || matchId(),
      map_name: (data.match && data.match.map_name) || lastMapContext.map_name,
    });
  }

  function handleMatchUpdateEvent(data) {
    var matchRow = data && data.match;
    if (!matchRow) return;
    var prevPhase = mapLivePhase();
    syncMapLivePhase(matchRow);
    var nextPhase = mapLivePhase();
    if (prevPhase === "warmup" && nextPhase === "playing") {
      handleGameStartedEvent(data);
    } else if (prevPhase === "playing" && nextPhase !== "playing") {
      resetMatchOverlayState("match_end", {
        match_id: matchRow.match_id || lastMapContext.match_id,
        map_name: matchRow.map_name || lastMapContext.map_name,
      });
      clearLiveMapPlayers();
    }
    if (matchRow.gametype) {
      lastMapContext.gametype = matchRow.gametype;
    }
    if (matchRow.map_name) {
      lastMapContext.map_name = matchRow.map_name;
    }
    if (Array.isArray(matchRow.players) && matchRow.players.length) {
      lastMapContext.players = matchRow.players;
    }
    renderLiveMapScoreHud();
    if (!lastMapContext.players || !lastMapContext.players.length) {
      scheduleLiveMapScoreFetch();
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

  function replayPositionTeleport(pp, npp) {
    if (!pp || !npp) return false;
    if (pp.x == null || pp.y == null || npp.x == null || npp.y == null) {
      return false;
    }
    return heatmapTeleportJump(
      Number(pp.x),
      Number(pp.y),
      Number(npp.x),
      Number(npp.y),
    );
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
    if (el._mapMarkerRole === role) return;
    el._mapMarkerRole = role;
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
      if (st.el) st.el._mapMarkerRole = null;
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
    return { showKillfeed: true, showPickupToasts: true, showMapScore: true };
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

  function pickupLogRowFromEvent(ev) {
    if (!ev || ev.event !== "pickup") return null;
    if (String(ev.action || "pickup").toLowerCase() === "drop") return null;
    return {
      item: ev.item,
      player: ev.nickname || ev.player || ev.steam_id64 || "?",
      time: ev.time || null,
      loggedAt: ev.t || 0,
    };
  }

  function rebuildPickupLogUpTo(targetT) {
    mapPickupLog = [];
    if (!replayState) {
      renderPickupLog();
      return;
    }
    var events = replayState.events;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.event !== "pickup") continue;
      if ((ev.t || 0) > targetT) break;
      var row = pickupLogRowFromEvent(ev);
      if (row) mapPickupLog.unshift(row);
    }
    if (mapPickupLog.length > PICKUP_LOG_MAX) {
      mapPickupLog.length = PICKUP_LOG_MAX;
    }
    renderPickupLog();
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

  function handlePickupEvent(data, opts) {
    if (!data || typeof data !== "object") return;
    if (
      replayState &&
      data.steam_id64 &&
      !isValidReplaySteamId64(data.steam_id64)
    ) {
      return;
    }
    var action = String(data.action || "pickup").toLowerCase();
    // "respawn" is a synthetic, internal-only signal (item entity reappeared
    // in a demo replay snapshot) — it drives MapSpawns' visibility only, not
    // the killfeed-style pickup log/toast/client recording a real pickup gets.
    if (action === "respawn") {
      notifyPickup(data);
      return;
    }
    var silent = !!(opts && opts.silent) || replaySeeking;
    if (!silent) recordClientPickup(data);
    if (action === "drop") return;
    if (!silent) pushPickupFeed(data);
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
        var marker = createDeathCrossMarker();
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
    var expiresAt;
    if (replayState && data.t != null && isFinite(Number(data.t))) {
      expiresAt = Number(data.t) + ttl;
    } else {
      expiresAt = overlayNowMs() + ttl;
    }
    mapDeathMarkers.push({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      victim_name: data.victim_name,
      victim_steam_id64: data.victim_steam_id64,
      expiresAt: expiresAt,
      el: null,
    });
    renderDeathMarkers();
  }

  var HIT_OUTLINE_FLASH_MS = 450;

  function flashHitOutline(steamId64) {
    var id = normalizeSteamId64(steamId64);
    var st = id ? mapMotion.byId[id] : null;
    if (!st || !st.el) return;
    var dot = st.el.dot;
    var pinOutline = st.el.pinOutline;
    if (dot) dot.classList.add("map-dot--hit");
    if (pinOutline) pinOutline.classList.add("map-pin-outline--hit");
    setTimeout(function () {
      if (dot) dot.classList.remove("map-dot--hit");
      if (pinOutline) pinOutline.classList.remove("map-pin-outline--hit");
    }, HIT_OUTLINE_FLASH_MS);
  }

  function handleDeathEvent(data, opts) {
    if (
      replayState &&
      data.victim_steam_id64 &&
      !isValidReplaySteamId64(data.victim_steam_id64)
    ) {
      return;
    }
    if ((opts && opts.silent) || replaySeeking) return;
    recordClientDeath(data);
    pushKillFeed(data);
    addDeathMarker(data);
    flashHitOutline(data.victim_steam_id64);
    if (typeof console !== "undefined" && console.info) {
      console.info("[overlay] death", data);
    }
  }

  var IMPACT_BULLET_FILES = ["impact_bullet_0.png", "impact_bullet_1.png", "impact_bullet_2.png"];
  var EXPLOSION_FRAME_COUNT = 8;

  // Fade/lifetime for map FX markers, in ms — one place to tune all of them.
  var EFFECT_FADE_MS = { explosion: 220, impact: 120, beam: 260 };

  function impactMarkerTtlMs(kind) {
    return kind === "explosion" ? EFFECT_FADE_MS.explosion : EFFECT_FADE_MS.impact;
  }

  // variant: "splash" (full explosion flipbook) or "plain" (small dot) — only
  // meaningful for kind "explosion" (rockets/grenades); everything else has a
  // single look.
  function createImpactMarker(kind, variant) {
    if (kind === "explosion" && variant === "splash") {
      var eimg = document.createElement("img");
      eimg.className = "map-fx-impact-sprite map-fx-impact-explosion-sprite";
      eimg.setAttribute("aria-hidden", "true");
      eimg._frame = -1;
      eimg.src = udtSpriteUrl("explosion_0.png");
      return eimg;
    }
    if (kind === "bullet") {
      var bimg = document.createElement("img");
      bimg.className = "map-fx-impact-sprite map-fx-impact-bullet-sprite";
      bimg.setAttribute("aria-hidden", "true");
      bimg.src = udtSpriteUrl(IMPACT_BULLET_FILES[(Math.random() * IMPACT_BULLET_FILES.length) | 0]);
      return bimg;
    }
    if (kind === "plasma") {
      var pimg = document.createElement("img");
      pimg.className = "map-fx-impact-sprite map-fx-impact-plasma-sprite";
      pimg.setAttribute("aria-hidden", "true");
      pimg.src = udtSpriteUrl("impact_plasma.png");
      return pimg;
    }
    var marker = document.createElement("div");
    marker.className = "map-fx-marker map-fx-impact map-fx-impact-" + (kind || "impact");
    marker.setAttribute("aria-hidden", "true");
    return marker;
  }

  // Raw dm_91 weapon ids (qldemo/entity-events.js WP_ROCKET=5/WP_GRENADE=4) —
  // the only two impact "kind: explosion" causes, and each has its own
  // rockets/grenades display mode.
  function impactVariant(impact) {
    if (impact.kind !== "explosion") return null;
    var mode = Number(impact.weapon) === 5 ? weaponFxSettings().rockets : weaponFxSettings().grenades;
    return mode === "splash" ? "splash" : "plain";
  }

  function addImpactMarker(impact, evT) {
    if (!impact || impact.x == null || impact.y == null) return;
    var fx = weaponFxSettings();
    if (Number(impact.weapon) === 5 && fx.rockets === "hide") return;
    if (Number(impact.weapon) === 4 && fx.grenades === "hide") return;
    if (impact.kind === "bullet" && fx.machinegun === "hide") return;
    if (impact.kind === "shaft" && fx.lightninggun === "hide") return;
    var variant = impactVariant(impact);
    var ttl = impactMarkerTtlMs(impact.kind);
    var expiresAt =
      replayState && evT != null && isFinite(Number(evT)) ? Number(evT) + ttl : overlayNowMs() + ttl;
    mapImpactMarkers.push({
      x: impact.x,
      y: impact.y,
      kind: impact.kind,
      variant: variant,
      expiresAt: expiresAt,
      el: null,
    });
  }

  function pruneImpactMarkers() {
    var now = overlayNowMs();
    var layer = document.getElementById("map-impacts");
    if (!layer) return;
    var kept = [];
    for (var i = 0; i < mapImpactMarkers.length; i++) {
      var row = mapImpactMarkers[i];
      if (row.expiresAt <= now) {
        if (row.el && row.el.parentNode) row.el.parentNode.removeChild(row.el);
        continue;
      }
      kept.push(row);
    }
    mapImpactMarkers = kept;
    if (!mapImpactMarkers.length) layer.innerHTML = "";
  }

  function renderImpactMarkers() {
    var layer = document.getElementById("map-impacts");
    var wrap = document.getElementById("map-wrap");
    var transform = mapMotion.renderTransform || cachedTransform;
    if (!layer || !wrap || !transform) return;
    pruneImpactMarkers();
    var now = overlayNowMs();
    for (var i = 0; i < mapImpactMarkers.length; i++) {
      var row = mapImpactMarkers[i];
      if (!row.el) {
        row.el = createImpactMarker(row.kind, row.variant);
        layer.appendChild(row.el);
      }
      var pos = worldToDisplayPos(transform, wrap, row.x, row.y);
      if (!pos) continue;
      var ttl = impactMarkerTtlMs(row.kind);
      var opacity = Math.max(0, Math.min(1, (row.expiresAt - now) / ttl));
      row.el.style.left = pos.x + "px";
      row.el.style.top = pos.y + "px";
      row.el.style.opacity = String(opacity);
      if (row.variant === "splash" && row.el.tagName === "IMG") {
        var elapsed = ttl - (row.expiresAt - now);
        var frame = Math.max(
          0,
          Math.min(EXPLOSION_FRAME_COUNT - 1, Math.floor((elapsed / ttl) * EXPLOSION_FRAME_COUNT)),
        );
        if (row.el._frame !== frame) {
          row.el._frame = frame;
          row.el.src = udtSpriteUrl("explosion_" + frame + ".png");
        }
      }
    }
  }

  function handleImpactsEvent(payload) {
    if (replaySeeking) return;
    var list = (payload && payload.impacts) || [];
    if (!list.length) return;
    for (var i = 0; i < list.length; i++) addImpactMarker(list[i], payload.t);
    renderImpactMarkers();
  }

  function beamMarkerTtlMs() {
    return EFFECT_FADE_MS.beam;
  }

  function createBeamMarker(weaponSlug) {
    var line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("class", "map-fx-beam-line map-fx-beam-" + (weaponSlug || "railgun"));
    return line;
  }

  function beamMarkerKey(beam) {
    return beam.clientNum != null ? "c" + beam.clientNum : "s" + (beam.weapon_slug || "?");
  }

  function addBeamMarker(beam, evT) {
    if (!beam || beam.x0 == null || beam.x1 == null) return;
    var fx = weaponFxSettings();
    if (beam.weapon_slug === "railgun" && fx.railgun === "hide") return;
    if (beam.weapon_slug === "lightninggun" && fx.lightninggun === "hide") return;
    var ttl = beamMarkerTtlMs();
    var expiresAt =
      replayState && evT != null && isFinite(Number(evT)) ? Number(evT) + ttl : overlayNowMs() + ttl;
    // Keyed by shooter (not appended as a new element per snapshot): a
    // continuous lightninggun burst emits one beam event per demo snapshot,
    // and pushing a fresh fading line for each one drew a "fan" of several
    // overlapping, slightly-different-angle beams instead of one crisp line.
    var key = beamMarkerKey(beam);
    var row = mapBeamMarkers[key];
    if (!row) {
      row = mapBeamMarkers[key] = { el: null };
    }
    row.x0 = beam.x0;
    row.y0 = beam.y0;
    row.x1 = beam.x1;
    row.y1 = beam.y1;
    row.weapon_slug = beam.weapon_slug;
    row.expiresAt = expiresAt;
  }

  function pruneBeamMarkers() {
    var now = overlayNowMs();
    var layer = document.getElementById("map-beams");
    if (!layer) return;
    var any = false;
    for (var key in mapBeamMarkers) {
      if (!Object.prototype.hasOwnProperty.call(mapBeamMarkers, key)) continue;
      var row = mapBeamMarkers[key];
      if (row.expiresAt <= now) {
        if (row.el && row.el.parentNode) row.el.parentNode.removeChild(row.el);
        delete mapBeamMarkers[key];
        continue;
      }
      any = true;
    }
    if (!any) layer.innerHTML = "";
  }

  function renderBeamMarkers() {
    var layer = document.getElementById("map-beams");
    var wrap = document.getElementById("map-wrap");
    var transform = mapMotion.renderTransform || cachedTransform;
    if (!layer || !wrap || !transform) return;
    pruneBeamMarkers();
    var now = overlayNowMs();
    var ttl = beamMarkerTtlMs();
    for (var key in mapBeamMarkers) {
      if (!Object.prototype.hasOwnProperty.call(mapBeamMarkers, key)) continue;
      var row = mapBeamMarkers[key];
      if (!row.el) {
        row.el = createBeamMarker(row.weapon_slug);
        layer.appendChild(row.el);
      }
      var p0 = worldToDisplayPos(transform, wrap, row.x0, row.y0);
      var p1 = worldToDisplayPos(transform, wrap, row.x1, row.y1);
      if (!p0 || !p1) continue;
      // Lightning gun beam disappears instantly (no fade-out tail) - confirmed
      // by user; railgun keeps the fading trail.
      var opacity =
        row.weapon_slug === "lightninggun"
          ? 1
          : Math.max(0, Math.min(1, (row.expiresAt - now) / ttl));
      row.el.setAttribute("x1", String(p0.x));
      row.el.setAttribute("y1", String(p0.y));
      row.el.setAttribute("x2", String(p1.x));
      row.el.setAttribute("y2", String(p1.y));
      row.el.style.opacity = String(opacity);
    }
  }

  function handleBeamsEvent(payload) {
    if (replaySeeking) return;
    var list = (payload && payload.beams) || [];
    if (!list.length) return;
    for (var i = 0; i < list.length; i++) addBeamMarker(list[i], payload.t);
    renderBeamMarkers();
  }

  function createProjectileMarker(slug) {
    if (slug === "rocketlauncher") {
      var rimg = document.createElement("img");
      rimg.className = "map-fx-projectile-sprite";
      rimg.setAttribute("aria-hidden", "true");
      rimg.src = udtSpriteUrl("rocket.png");
      return rimg;
    }
    if (slug === "plasmagun") {
      var pimg = document.createElement("img");
      pimg.className = "map-fx-projectile-sprite map-fx-projectile-plasma-sprite";
      pimg.setAttribute("aria-hidden", "true");
      pimg.src = udtSpriteUrl("projectile_plasma.png");
      return pimg;
    }
    if (slug === "grenadelauncher") {
      // UDT draws the grenade itself as a plain green circle, not a sprite.
      var marker = document.createElement("div");
      marker.className = "map-fx-marker map-fx-projectile map-fx-projectile-grenadelauncher";
      marker.setAttribute("aria-hidden", "true");
      return marker;
    }
    var iconUrl = weaponIconUrlBySlug(slug);
    if (iconUrl) {
      var img = document.createElement("img");
      img.className = "map-fx-projectile-sprite";
      img.setAttribute("aria-hidden", "true");
      img.src = iconUrl;
      return img;
    }
    var fallback = document.createElement("div");
    fallback.className = "map-fx-marker map-fx-projectile map-fx-projectile-" + (slug || "default");
    fallback.setAttribute("aria-hidden", "true");
    return fallback;
  }

  function clearProjectileMarkers() {
    var layer = document.getElementById("map-projectiles");
    if (layer) layer.innerHTML = "";
    mapProjectileMarkers = {};
  }

  function renderProjectileMarkers() {
    var layer = document.getElementById("map-projectiles");
    var wrap = document.getElementById("map-wrap");
    var transform = mapMotion.renderTransform || cachedTransform;
    if (!layer || !wrap || !transform) return;
    for (var eid in mapProjectileMarkers) {
      var row = mapProjectileMarkers[eid];
      if (!row.el) {
        row.el = createProjectileMarker(row.weapon_slug);
        layer.appendChild(row.el);
      }
      var pos = worldToDisplayPos(transform, wrap, row.x, row.y);
      if (!pos) continue;
      row.el.style.left = pos.x + "px";
      row.el.style.top = pos.y + "px";
      // No sign flip here (unlike the player/weapon rotations, which negate
      // their Quake-yaw-convention angle): UDT's own ComputeProjectileAngle
      // (atan2(trDelta.x, trDelta.y), same formula as projectileYawDeg below)
      // is used completely unrotated in DrawMapSpriteAt — it's already in
      // screen/nanovg convention. Negating it here mirrored the sprite
      // left-right (e.g. a rocket flying toward ~1 o'clock rendered facing
      // ~11 o'clock instead).
      row.el.style.transform = "translate(-50%, -50%) rotate(" + (row.yaw || 0) + "deg)";
    }
  }

  /** UDT viewer (ComputeProjectileAngle): atan2(vx, vy) — same convention as player yaw. */
  function projectileYawDeg(vx, vy) {
    if (!vx && !vy) return null;
    return (Math.atan2(vx, vy) * 180) / Math.PI;
  }

  function handleProjectilesEvent(payload) {
    if (replaySeeking) return;
    var list = (payload && payload.projectiles) || [];
    var fx = weaponFxSettings();
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.eid == null) continue;
      if (p.weapon_slug === "rocketlauncher" && fx.rockets === "hide") continue;
      if (p.weapon_slug === "grenadelauncher" && fx.grenades === "hide") continue;
      seen[p.eid] = true;
      var st = mapProjectileMarkers[p.eid];
      if (!st) st = mapProjectileMarkers[p.eid] = { el: null };
      st.x = p.x;
      st.y = p.y;
      st.yaw = projectileYawDeg(p.vx, p.vy) ?? st.yaw ?? 0;
      st.weapon_slug = p.weapon_slug;
    }
    for (var eid in mapProjectileMarkers) {
      if (seen[eid]) continue;
      var gone = mapProjectileMarkers[eid];
      if (gone.el && gone.el.parentNode) gone.el.parentNode.removeChild(gone.el);
      delete mapProjectileMarkers[eid];
    }
    renderProjectileMarkers();
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
    if (replayState && !isReplayMapPlayer(p)) return false;
    if (p.connected === false || p.online === false) return false;
    // Hide a dead player's dot until respawn (avoids a stale marker at the
    // death spot); the map-death-marker cross covers the death location for
    // a few seconds instead. Applies to live and demo replay alike.
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
    var weaponIcon = document.createElement("img");
    weaponIcon.className = "map-weapon-icon";
    weaponIcon.setAttribute("aria-hidden", "true");
    weaponIcon.style.display = "none";
    marker.appendChild(label);
    marker.appendChild(fov);
    marker.appendChild(pin);
    marker.appendChild(dot);
    marker.appendChild(view);
    marker.appendChild(weaponIcon);
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
      weaponIcon: weaponIcon,
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
    if (hasYaw) {
      el._lastYaw = yaw;
    } else if (el._lastYaw != null && !isNaN(el._lastYaw)) {
      yaw = el._lastYaw;
      hasYaw = true;
    }
    var fovDeg = fov != null && !isNaN(fov) ? Number(fov) : defaultMapFov();
    if (hasYaw && display.showFovWedge && el.fov && el.fovPath) {
      el.fov.style.display = "";
      el.fov.style.transform = "rotate(" + -yaw + "deg)";
      el.fovPath.setAttribute("d", fovWedgePath(fovDeg, fovConeLengthPx()));
    } else if (el.fov) {
      el.fov.style.display = "none";
    }
    if (el.weaponIcon) {
      var weaponPlayer = playerId ? findPlayerForMotionId(players, playerId) : null;
      var iconUrl = display.showWeaponInHand && weaponPlayer ? weaponHandSpriteUrlById(weaponPlayer.weapon) : "";
      if (iconUrl) {
        if (el.weaponIcon.getAttribute("data-src") !== iconUrl) {
          el.weaponIcon.setAttribute("data-src", iconUrl);
          el.weaponIcon.src = iconUrl;
        }
        el.weaponIcon.style.display = "";
        // UDT DrawPlayerWeapon (nanovg_drawing.cpp): a = -playerAngle + PI/2;
        // sprite center offset 1.5*r from the dot along (a - PI/8), then the
        // sprite itself is drawn centered on that offset point rotated by a
        // — this is what makes the weapon read as held to the side rather
        // than pointing straight out from the dot.
        var weapADeg = -(yaw || 0) + 90;
        var weapOffsetRad = ((weapADeg - 22.5) * Math.PI) / 180;
        var weapOffsetPx = 1.5 * (size / 2);
        var weapDx = weapOffsetPx * Math.cos(weapOffsetRad);
        var weapDy = weapOffsetPx * Math.sin(weapOffsetRad);
        el.weaponIcon.style.transform =
          "translate(" + weapDx.toFixed(2) + "px, " + weapDy.toFixed(2) + "px) rotate(" + weapADeg.toFixed(2) + "deg)";
      } else {
        el.weaponIcon.style.display = "none";
      }
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
    var modeKey = usePin
      ? "pin"
      : hasYaw && display.showDirectionArrow && el.view
        ? "arrow"
        : "dot";
    if (el._markerMode !== modeKey) {
      el._markerMode = modeKey;
      if (usePin) {
        if (el.view) el.view.style.display = "none";
        el.dot.style.display = "none";
        el.pin.style.display = "";
      } else {
        if (el.pin) el.pin.style.display = "none";
        el.dot.style.display = "";
        if (hasYaw && display.showDirectionArrow && el.view) {
          el.view.style.display = "";
        } else if (el.view) {
          el.view.style.display = "none";
        }
      }
    }
    if (usePin) {
      var layout = pinLayoutForDotSize(size);
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
    } else if (hasYaw && display.showDirectionArrow && el.view) {
      el.view.style.transform = "rotate(" + -yaw + "deg)";
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
      renderImpactMarkers();
      renderBeamMarkers();
      if (!replayState) {
        renderHeatmap(mapMotion.currentPlayers, mapMotion.currentGametype);
      }

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
    if (!replayState) {
      recordHeatmapPositions(players, mapMotion.currentGametype);
    }
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
    if (!replayState) {
      if (!lastMapContext.players || !lastMapContext.players.length) {
        scheduleLiveMapScoreFetch();
      } else {
        renderLiveMapScoreHud();
      }
    }
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
      if (
        url &&
        (url !== currentImageSrc ||
          !image.getAttribute("src") ||
          !image.complete ||
          image.naturalWidth === 0)
      ) {
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
    var incomingPlayers = normalizePlayersList(data.players);
    if (
      mapPositionsVisible() &&
      !incomingPlayers.length &&
      mapMotion.currentPlayers &&
      mapMotion.currentPlayers.length
    ) {
      data = Object.assign({}, data, { players: mapMotion.currentPlayers });
    }
    if (!mapPositionsVisible()) {
      data = Object.assign({}, data, { players: [] });
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

  function scheduleMapSnapshot(data, opts) {
    mapSnapshotQueue = mapSnapshotQueue
      .then(function () {
        return handleMapSnapshot(data, opts);
      })
      .catch(function (err) {
        setStatus(String(err.message || err), true);
      });
    return mapSnapshotQueue;
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
      try {
        var matchRow = await fetchJson(
          "/api/stream/matches/" + encodeURIComponent(id),
        );
        if (matchRow) {
          syncMapLivePhase(matchRow);
          if (Array.isArray(matchRow.players) && matchRow.players.length) {
            lastMapContext.players = matchRow.players;
          }
          if (matchRow.gametype) {
            lastMapContext.gametype = matchRow.gametype;
          }
          renderLiveMapScoreHud();
          if (!lastMapContext.players || !lastMapContext.players.length) {
            scheduleLiveMapScoreFetch();
          }
        }
      } catch (_matchErr) {
        /* phase optional */
      }
      var data = await fetchJson(
        "/api/matches/" + encodeURIComponent(id) + "/positions",
      );
      await scheduleMapSnapshot(data);
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
        weapon: p.weapon,
        alive: p.alive,
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
      if (replayPositionTeleport(pp, npp)) {
        out.push(clonePlayerPoseForReplay(npp));
        delete nextById[id];
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
            weapon: npp.weapon != null ? npp.weapon : pp.weapon,
            alive: npp.alive != null ? npp.alive : pp.alive,
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

  function computeReplayPositionsEndT(events, meta) {
    for (var i = events.length - 1; i >= 0; i--) {
      var ev = events[i];
      if (ev.event === "match_end" && ev.t != null && isFinite(Number(ev.t))) {
        return Number(ev.t);
      }
    }
    var endT = null;
    for (var j = 0; j < events.length; j++) {
      var stEv = events[j];
      if (stEv.event !== "match_status") continue;
      var st = String(stEv.status || "").toLowerCase();
      if (st === "ended" || st === "aborted") {
        endT = stEv.t || 0;
      }
    }
    if (endT == null && meta && meta.ended_at != null) {
      endT = Number(meta.ended_at);
    }
    return endT != null && isFinite(endT) ? endT : null;
  }

  function filterReplayPlayersAtTime(players, targetT) {
    if (!replayState || !replayState.deathWindows) return players;
    return players.filter(function (p) {
      var sid = normalizeSteamId64(p.steam_id64);
      return !isReplayPlayerDeadAt(sid, targetT, replayState.deathWindows);
    });
  }

  function replayPlayersAtTime(targetT) {
    if (!replayState) return [];
    if (
      replayState.positionsEndT != null &&
      targetT > replayState.positionsEndT
    ) {
      return [];
    }
    var bounds = replayPositionsBoundsAtTime(targetT);
    var prev = bounds.prev;
    var next = bounds.next;
    if (!prev && !next) return [];
    if (!prev) {
      return filterReplayPlayersAtTime(normalizePlayersList(next.players || []), targetT);
    }
    if (!next) {
      return filterReplayPlayersAtTime(normalizePlayersList(prev.players || []), targetT);
    }
    var prevT = prev.t || 0;
    var nextT = next.t || 0;
    if (nextT <= prevT) {
      return filterReplayPlayersAtTime(normalizePlayersList(prev.players || []), targetT);
    }
    var frac = (targetT - prevT) / (nextT - prevT);
    return filterReplayPlayersAtTime(
      lerpReplayPlayers(
        normalizePlayersList(prev.players || []),
        normalizePlayersList(next.players || []),
        frac,
      ),
      targetT,
    );
  }

  function rebuildReplayHeatmapTrails(targetT, settings) {
    mapHeatmap.byId = {};
    if (!replayState) return;
    var isAggregate = settings.mode === "aggregate";
    var maxAge = isAggregate
      ? 0
      : clampHeatmapDurationSec(settings.durationSec) * 1000;
    var minT = isAggregate ? -Infinity : targetT - maxAge;
    var events = replayState.events;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.event !== "positions") continue;
      var t = ev.t || 0;
      if (t > targetT) break;
      if (t < minT) continue;
      var list = normalizePlayersList(ev.players || []);
      for (var j = 0; j < list.length; j++) {
        var p = list[j];
        if (!playerShouldRenderOnMap(p)) continue;
        if (p.x == null || p.y == null) continue;
        var id = playerMotionId(p, j);
        if (!mapHeatmap.byId[id]) mapHeatmap.byId[id] = [];
        var trail = mapHeatmap.byId[id];
        var last = trail.length ? trail[trail.length - 1] : null;
        trail.push({
          x: Number(p.x),
          y: Number(p.y),
          t: t,
          breakBefore:
            !!last &&
            heatmapTeleportJump(last.x, last.y, Number(p.x), Number(p.y)),
        });
      }
    }
  }

  function renderReplayHeatmap(players, gametype, targetT) {
    var settings = heatmapSettings();
    if (settings.enabled) {
      rebuildReplayHeatmapTrails(targetT, settings);
    }
    renderHeatmap(players, gametype);
  }

  function applyReplayFramePositions() {
    if (!replayState) return;
    var targetT = replayState.startMs + replayState.cursorMs;
    var players = replayPlayersAtTime(targetT);
    var payload = {
      match_id: replayState.matchId,
      map_name: replayState.meta.map_name || lastMapContext.map_name,
      gametype: replayState.meta.gametype || lastMapContext.gametype,
      players: players,
      transform: cachedTransform,
    };
    if (!cachedTransform && payload.map_name) {
      ensureReplayMapFromPositions(payload).then(function () {
        applyReplayFramePositions();
      });
      return;
    }
    setMapSnapshot(payload, { instant: !mapSmoothEnabled() });
    notifyMapPayload(payload);
    if (window.MapSpawns && typeof MapSpawns.refreshItemRespawnOverlays === "function") {
      MapSpawns.refreshItemRespawnOverlays();
    }
    renderReplayHeatmap(players, payload.gametype, targetT);
    renderReplayScoreHud(targetT);
  }

  function fmtReplayClock(ms) {
    ms = Math.max(0, Math.floor(Number(ms) || 0));
    var sec = Math.floor(ms / 1000);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  var replayState = null;
  var replayCursorListener = null;
  var replaySeeking = false;
  var replaySeekRaf = 0;
  var replaySeekPendingMs = null;
  var replaySeekPendingGame = null;
  var replaySeekPendingPreview = false;
  var replayScrubWasPlaying = false;

  function replayLastEventIndexAtOrBefore(targetT) {
    if (!replayState) return -1;
    var events = replayState.events;
    var lo = 0;
    var hi = events.length - 1;
    var best = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      var t = events[mid].t || 0;
      if (t <= targetT) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  function buildPositionsIndex(events) {
    var index = [];
    for (var i = 0; i < events.length; i++) {
      if (events[i].event !== "positions") continue;
      index.push({ t: events[i].t || 0, i: i });
    }
    return index;
  }

  function replayPositionsBoundsAtTime(targetT) {
    if (!replayState) return { prev: null, next: null };
    if (
      replayState.positionsEndT != null &&
      targetT > replayState.positionsEndT
    ) {
      targetT = replayState.positionsEndT;
    }
    var index = replayState.positionsIndex;
    if (!index || !index.length) return { prev: null, next: null };
    var lo = 0;
    var hi = index.length - 1;
    var best = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (index[mid].t <= targetT) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best < 0) {
      return {
        prev: null,
        next: replayState.events[index[0].i] || null,
      };
    }
    return {
      prev: replayState.events[index[best].i] || null,
      next:
        best + 1 < index.length
          ? replayState.events[index[best + 1].i] || null
          : null,
    };
  }

  function replayLastPositionsEventAtOrBefore(targetT) {
    return replayPositionsBoundsAtTime(targetT).prev;
  }

  function cancelScheduledSeekReplay() {
    if (replaySeekRaf) {
      cancelAnimationFrame(replaySeekRaf);
      replaySeekRaf = 0;
    }
    replaySeekPendingMs = null;
    replaySeekPendingGame = null;
    replaySeekPendingPreview = false;
  }

  function flushScheduledSeekReplay() {
    replaySeekRaf = 0;
    if (replaySeekPendingMs != null) {
      var ms = replaySeekPendingMs;
      var preview = !!replaySeekPendingPreview;
      replaySeekPendingMs = null;
      replaySeekPendingGame = null;
      replaySeekPendingPreview = false;
      if (!replayState) return;
      seekReplay(ms, { scrubPreview: preview }).catch(function (err) {
        setStatus(String(err.message || err), true);
      });
      return;
    }
    if (replaySeekPendingGame) {
      var pending = replaySeekPendingGame;
      replaySeekPendingGame = null;
      if (!replayState) return;
      var cursor = replayGameMsToCursor(pending.gameMs, pending.opts);
      if (cursor == null) return;
      seekReplay(cursor, { scrubPreview: !!pending.opts.scrubPreview }).catch(
        function (err) {
          setStatus(String(err.message || err), true);
        },
      );
    }
  }

  function scheduleSeekReplay(cursorMs, opts) {
    opts = opts || {};
    replaySeekPendingMs = cursorMs;
    replaySeekPendingGame = null;
    replaySeekPendingPreview = !!opts.scrubPreview;
    if (replaySeekRaf) return;
    replaySeekRaf = requestAnimationFrame(flushScheduledSeekReplay);
  }

  function scheduleSeekReplayGameMs(gameMs, opts) {
    replaySeekPendingGame = { gameMs: Number(gameMs) || 0, opts: opts || {} };
    replaySeekPendingMs = null;
    replaySeekPendingPreview = false;
    if (replaySeekRaf) return;
    replaySeekRaf = requestAnimationFrame(flushScheduledSeekReplay);
  }

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
    var embedded = !!(window.MapWidget && window.MapWidget.embedded);
    if (bar) bar.classList.toggle("hidden", embedded || mode === "none");
    if (recordControls) {
      recordControls.classList.toggle("hidden", mode !== "record" || embedded);
    }
    if (playback) {
      // Embedded dashboard uses the page-level timeline controls instead.
      playback.classList.toggle("hidden", mode !== "replay" || embedded);
    }
    if (loadWrap) {
      // Load-file belongs to the standalone replay player. The embedded results
      // widget plays only the server replay tied to that result, so hide its
      // file picker (will live on a dedicated Replays player page later).
      loadWrap.classList.toggle("hidden", mode !== "replay" || embedded);
    }
  }

  function initClientRecordingUi() {
    showReplayMediaBar("record");
    bindClientRecordControls();
    if (clientRecordAutoStart()) {
      startClientRecording();
    }
  }

  // game_time_ms is the canonical clock (always ms, both live qlrp decode and
  // demo-derived replay-v2 — see lib/qlreplay/decode.js and
  // lib/qldemo/replay-for-overlay.js). Death/pickup events also carry a legacy
  // `time` field for old renderers, already in ms too, so it must never be
  // re-guessed as seconds when game_time_ms is missing. The *1000 guess below
  // only fires for genuinely old client-recorded files that predate
  // game_time_ms and only ever had `time` in seconds.
  function replayGameTimeFieldMs(ev) {
    if (!ev) return null;
    if (ev.game_time_ms != null && isFinite(Number(ev.game_time_ms))) {
      return Number(ev.game_time_ms);
    }
    if (ev.time == null || !isFinite(Number(ev.time))) return null;
    var g = Number(ev.time);
    return g < 100000 ? g * 1000 : g;
  }

  function replayPositionsTimeSpan(events) {
    var min = null;
    var max = null;
    for (var i = 0; i < events.length; i++) {
      if (events[i].event !== "positions") continue;
      var t = events[i].t || 0;
      if (min == null || t < min) min = t;
      if (max == null || t > max) max = t;
    }
    return min != null && max != null ? { min: min, max: max } : null;
  }

  function normalizeLegacyReplayEventTimes(events, meta) {
    var span = replayPositionsTimeSpan(events);
    if (!span) return events;
    var wallMin = Number(meta.started_at || events[0].t || span.min);
    var wallMax = wallMin + (span.max - span.min);
    var legacyBase = null;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.event !== "pickup" && ev.event !== "death") continue;
      var g = replayGameTimeFieldMs(ev);
      if (g != null && (legacyBase == null || g < legacyBase)) legacyBase = g;
    }
    return events.map(function (ev) {
      if (ev.event !== "pickup" && ev.event !== "death") return ev;
      var t = ev.t || 0;
      if (t <= wallMax + 120000 && t >= wallMin - 120000) return ev;
      var g = replayGameTimeFieldMs(ev);
      if (g != null && legacyBase != null) {
        return Object.assign({}, ev, {
          t: wallMin + Math.max(0, g - legacyBase),
        });
      }
      return ev;
    });
  }

  function buildReplayDeathWindows(events) {
    var pending = {};
    var windows = {};
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.event === "death") {
        var sid = normalizeSteamId64(ev.victim_steam_id64);
        if (!sid) continue;
        windows[sid] = windows[sid] || [];
        windows[sid].push({ deathT: ev.t || 0, respawnT: null });
        pending[sid] = windows[sid].length - 1;
        continue;
      }
      if (ev.event === "positions") {
        var t = ev.t || 0;
        var players = ev.players || [];
        for (var pi = 0; pi < players.length; pi++) {
          var p = players[pi];
          var psid = normalizeSteamId64(p.steam_id64);
          if (!psid || pending[psid] == null) continue;
          var hp = p.health != null ? Number(p.health) : null;
          if ((hp != null && hp > 0) || p.alive === true) {
            windows[psid][pending[psid]].respawnT = t;
            delete pending[psid];
          }
        }
      }
    }
    return windows;
  }

  function isReplayPlayerDeadAt(sid, targetT, deathWindows) {
    if (!sid || !deathWindows) return false;
    var rows = deathWindows[sid];
    if (!rows || !rows.length) return false;
    for (var wi = 0; wi < rows.length; wi++) {
      var row = rows[wi];
      if (targetT < row.deathT) continue;
      if (row.respawnT == null || targetT < row.respawnT) return true;
    }
    return false;
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
    events = sanitizeReplayEvents(events);
    var meta = raw.meta && typeof raw.meta === "object" ? Object.assign({}, raw.meta) : {};
    if (!meta.started_at) meta.started_at = events[0].t;
    events = normalizeLegacyReplayEventTimes(events, meta);
    if (!events.length) {
      throw new Error("Replay has no events");
    }
    var matchIdValue =
      raw.match_id || meta.match_id || events[0].match_id || matchId() || "local";
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

  // Absolute wall epoch (ms) of game-clock 0, supplied by the dashboard so the
  // embedded replay can drop the pre-match countdown lead-in and start at the
  // fight (cursor 0 == match start). Events before it are kept for state
  // baseline but are not reachable by the scrubber.
  function replayTrimStartMs() {
    var v = Number(qs("replay_trim_start_ms", ""));
    return isFinite(v) && v > 0 ? v : null;
  }

  // Optional caller-supplied wall-ms epoch of game-clock 0 (results.js has a
  // more precise anchor - archive.markers' own match_start row - than this
  // replay engine can derive from raw events alone; see
  // computeReplayGameStartWall()'s median-of-samples fallback below, which is
  // only an estimate and can disagree with the archive's real anchor by a few
  // seconds, enough to visibly desync the on-map timer from the (correctly
  // anchored) results.js scrubber/restore-checkpoint values).
  function replayMatchStartWallMsOverride() {
    var v = Number(qs("replay_match_start_wall_ms", ""));
    return isFinite(v) && v > 0 ? v : null;
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
    var positionsEndT = computeReplayPositionsEndT(events, meta);
    if (positionsEndT != null) {
      durationMs = Math.min(durationMs, Math.max(0, positionsEndT - startMs));
    }
    var countdownWallT = replayLifecycleWallT(events, "countdown_start");
    var matchStartWallT =
      replayMatchStartWallMsOverride() ||
      replayLifecycleWallT(events, "match_start") ||
      computeReplayGameStartWall(events);
    var matchEndWallT = replayLifecycleWallT(events, "match_end");
    if (matchEndWallT == null && positionsEndT != null) {
      matchEndWallT = positionsEndT;
    }
    if (typeof console !== "undefined" && console.info) {
      console.info("[overlay] replay game-clock anchor", {
        startMs: startMs,
        matchStartWallT: matchStartWallT,
        matchStartWallOverride: replayMatchStartWallMsOverride(),
        matchStartWallFromLifecycle: replayLifecycleWallT(events, "match_start"),
        matchStartWallEstimated: computeReplayGameStartWall(events),
        countdownWallT: countdownWallT,
        matchEndWallT: matchEndWallT,
      });
    }
    var trimStartMs = replayTrimStartMs();
    if (trimStartMs != null) {
      var endT = startMs + durationMs;
      if (trimStartMs > startMs && trimStartMs < endT) {
        durationMs = endT - trimStartMs;
        startMs = trimStartMs;
      }
    }

    stopReplayPlayback();
    replayClock.active = true;
    replayClock.epochMs = startMs;
    replayClock.cursorMs = 0;

    replayState = {
      matchId: normalized.match_id,
      meta: meta,
      events: events,
      positionsIndex: buildPositionsIndex(events),
      startMs: startMs,
      durationMs: durationMs,
      positionsEndT: positionsEndT,
      cursorMs: 0,
      playing: false,
      speed: replaySpeedDefault(),
      lastAppliedIndex: -1,
      rafId: 0,
      lastTickMs: 0,
      source: normalized.source,
      // Demo-derived replays already carry a reliable per-entity alive flag
      // (world entities of dead-but-settled players report themselves as
      // dead, not just briefly-missing); the health>0-based respawn-window
      // heuristic below is for stats-hub telemetry, where opponents may
      // never post a positive health while genuinely alive and would then
      // stay hidden for the rest of the match after their first death.
      deathWindows: normalized.source === "qldemo" ? null : buildReplayDeathWindows(events),
      gameStartWall: computeReplayGameStartWall(events),
      countdownWallT: countdownWallT,
      matchStartWallT: matchStartWallT,
      matchEndWallT: matchEndWallT,
    };

    if (countdownWallT != null) mapLifecycleWalls.countdownWallT = countdownWallT;
    if (matchStartWallT != null) mapLifecycleWalls.matchStartWallT = matchStartWallT;
    if (countdownWallT != null && matchStartWallT != null) {
      mapLifecycleWalls.countdownLeadMs = Math.max(0, matchStartWallT - countdownWallT);
    }
    replayState.pauseIntervals = null;

    var speedSel = document.getElementById("map-replay-speed");
    if (speedSel) speedSel.value = String(replayState.speed);

    await seekReplay(0);
    var embedded = !!(window.MapWidget && window.MapWidget.embedded);
    if (!embedded) {
      var src =
        normalized.source === "ql-overlay-client"
          ? "client file"
          : normalized.source || "replay";
      setStatus("Replay loaded (" + src + ", " + events.length + " events)");
    } else {
      setStatus("");
    }
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
        players: filterReplayPlayers(ev.players || []),
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
        t: ev.t,
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
    if (ev.event === "impacts") {
      return { event: "impacts", t: ev.t, impacts: ev.impacts || [] };
    }
    if (ev.event === "beams") {
      return { event: "beams", t: ev.t, beams: ev.beams || [] };
    }
    if (ev.event === "projectiles") {
      return { event: "projectiles", t: ev.t, projectiles: ev.projectiles || [] };
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

  async function ensureReplayMapFromPositions(payload) {
    if (!payload) return;
    if (payload.map_name) lastMapContext.map_name = payload.map_name;
    if (payload.gametype != null && payload.gametype !== "") {
      lastMapContext.gametype = payload.gametype;
    }
    if (payload.match_id) lastMapContext.match_id = payload.match_id;
    var mapName = payload.map_name || lastMapContext.map_name || "";
    var needBootstrap =
      !cachedTransform ||
      (mapName && mapName !== lastMapContext._overlay_map);
    if (!needBootstrap) return;
    await handleMapSnapshot(
      Object.assign({}, payload, {
        map_name: mapName,
        gametype:
          payload.gametype != null ? payload.gametype : lastMapContext.gametype,
      }),
      { instant: true },
    );
  }

  async function applyReplayEvent(ev) {
    if (!ev || !ev.event) return false;
    if (
      ev.event === "match_status" ||
      ev.event === "countdown_start" ||
      ev.event === "match_start" ||
      ev.event === "match_end"
    ) {
      return false;
    }
    var payload = replayPayloadFromEvent(ev);
    if (!payload) return false;
    if (payload.event === "positions") {
      if (replayState) {
        await ensureReplayMapFromPositions(payload);
        return true;
      }
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
    if (payload.event === "impacts") {
      handleImpactsEvent(payload);
      return true;
    }
    if (payload.event === "beams") {
      handleBeamsEvent(payload);
      return true;
    }
    if (payload.event === "projectiles") {
      handleProjectilesEvent(payload);
      return true;
    }
    return false;
  }

  // Replay scrub is wall-clock offset (cursorMs); the dashboard match timeline is
  // game-clock (game_time_ms). death/pickup events carry both a wall `t` and a
  // game `time`, so the median (t - game_time) is the wall epoch of game start.
  function replayLifecycleWallT(events, kind) {
    for (var i = events.length - 1; i >= 0; i--) {
      var ev = events[i];
      if (ev.event !== kind) continue;
      var t = ev.t;
      if (t != null && isFinite(Number(t))) return Number(t);
    }
    return null;
  }

  function computeReplayGameStartWall(events) {
    var fromLifecycle = replayLifecycleWallT(events, "match_start");
    if (fromLifecycle != null) return fromLifecycle;
    var diffs = [];
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.event !== "death" && ev.event !== "pickup") continue;
      var g = replayGameTimeFieldMs(ev);
      if (g == null) continue;
      var t = ev.t;
      if (t == null || !isFinite(Number(t))) continue;
      diffs.push(Number(t) - g);
    }
    if (!diffs.length) return null;
    diffs.sort(function (a, b) {
      return a - b;
    });
    return diffs[Math.floor(diffs.length / 2)];
  }

  function replayCursorToGameMs(cursorMs) {
    if (!replayState || replayState.gameStartWall == null) return null;
    return replayState.startMs + (Number(cursorMs) || 0) - replayState.gameStartWall;
  }

  function replayGameMaxMs(opts) {
    if (!replayState) return null;
    opts = opts || {};
    var events = replayState.events || [];
    var endRow = null;
    for (var i = events.length - 1; i >= 0; i--) {
      if (events[i].event === "match_end") {
        endRow = events[i];
        break;
      }
    }
    if (endRow && endRow.game_time_ms != null && isFinite(Number(endRow.game_time_ms))) {
      return Math.max(0, Number(endRow.game_time_ms));
    }
    if (endRow && endRow.meta && String(endRow.meta.end_reason || "").toLowerCase() === "ended") {
      var tl = Number(endRow.meta.timelimit_sec);
      if (isFinite(tl) && tl > 0) return Math.round(tl * 1000);
    }
    if (endRow && endRow.timelimit_sec != null) {
      var tl2 = Number(endRow.timelimit_sec);
      if (isFinite(tl2) && tl2 > 0) return Math.round(tl2 * 1000);
    }
    var fromCursor = replayCursorToGameMs(replayState.durationMs);
    if (fromCursor != null && fromCursor > 0) return fromCursor;
    var ext = Number(opts.gameMaxMs);
    if (isFinite(ext) && ext > 0) return ext;
    var maxG = 0;
    var events = replayState.events || [];
    for (var i = 0; i < events.length; i++) {
      var g = replayGameTimeFieldMs(events[i]);
      if (g != null && g > maxG) maxG = g;
    }
    return maxG > 0 ? maxG : null;
  }

  function replayGameMsToCursor(gameMs, opts) {
    if (!replayState) return null;
    opts = opts || {};
    var dur = replayState.durationMs || 0;
    if (replayState.gameStartWall != null) {
      var c = replayState.gameStartWall + (Number(gameMs) || 0) - replayState.startMs;
      if (c < 0) c = 0;
      if (c > dur) c = dur;
      return c;
    }
    var gmax = replayGameMaxMs(opts);
    if (gmax && gmax > 0 && dur) {
      var c2 = (Number(gameMs) / gmax) * dur;
      if (c2 < 0) c2 = 0;
      if (c2 > dur) c2 = dur;
      return c2;
    }
    return null;
  }

  function notifyReplayCursorListeners() {
    if (!replayCursorListener || !replayState) return;
    var cursorMs = replayState.cursorMs;
    var durationMs = replayState.durationMs || 0;
    try {
      replayCursorListener({
        cursorMs: cursorMs,
        durationMs: durationMs,
        startMs: replayState.startMs,
        playing: !!replayState.playing,
        gameMs: replayCursorToGameMs(cursorMs),
        gameMaxMs: replayCursorToGameMs(durationMs),
      });
    } catch (_e) {
      /* listener errors must not break replay playback */
    }
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
      playBtn.setAttribute("aria-pressed", replayState.playing ? "true" : "false");
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
    buildReplayLifecycleMarkers();
    updateReplayLifecycleBanner();
    notifyReplayCursorListeners();
  }

  function stopReplayPlayback() {
    if (!replayState) return;
    replayState.playing = false;
    if (replayState.rafId) {
      cancelAnimationFrame(replayState.rafId);
      replayState.rafId = 0;
    }
  }

  async function reapplyReplayPickupsUpTo(targetT, opts) {
    if (!replayState) return;
    var events = replayState.events;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.event !== "pickup") continue;
      if ((ev.t || 0) > targetT) break;
      var payload = replayPayloadFromEvent(ev);
      if (payload) handlePickupEvent(payload, opts);
    }
  }

  async function seekReplay(cursorMs, opts) {
    opts = opts || {};
    if (opts.scrubPreview) {
      seekReplayScrub(cursorMs);
      return;
    }
    if (!replayState) return;
    cancelScheduledSeekReplay();
    stopReplayPlayback();
    var dur = replayState.durationMs || 0;
    replayState.cursorMs = Math.max(0, Math.min(dur, Number(cursorMs) || 0));
    replayClock.cursorMs = replayState.cursorMs;
    var targetT = replayState.startMs + replayState.cursorMs;
    replaySeeking = true;
    try {
      resetReplayVisualState({
        match_id: replayState.matchId,
        map_name: replayState.meta.map_name || lastMapContext.map_name,
      });
      var posEv = replayLastPositionsEventAtOrBefore(targetT);
      if (posEv) {
        await ensureReplayMapFromPositions(replayPayloadFromEvent(posEv));
      }
      replayState.lastAppliedIndex = replayLastEventIndexAtOrBefore(targetT);
      await reapplyReplayPickupsUpTo(targetT, { silent: true });
      rebuildPickupLogUpTo(targetT);
      applyReplayFramePositions();
      ensureMotionLoop();
      updateReplayBarUi();
    } finally {
      replaySeeking = false;
    }
  }

  // Live scrub preview: move interpolated player dots without rebuilding overlay
  // state (deaths/pickups/killfeed). Full seekReplay() runs on scrub release.
  function seekReplayScrub(cursorMs) {
    if (!replayState) return;
    var dur = replayState.durationMs || 0;
    replayState.cursorMs = Math.max(0, Math.min(dur, Number(cursorMs) || 0));
    replayClock.cursorMs = replayState.cursorMs;
    applyReplayFramePositions();
    updateReplayLifecycleBanner();
  }

  function applyReplayEventsIncremental() {
    if (!replayState) return;
    var targetT = replayState.startMs + replayState.cursorMs;
    replayClock.cursorMs = replayState.cursorMs;
    var events = replayState.events;
    var i = replayState.lastAppliedIndex + 1;
    while (i < events.length && (events[i].t || 0) <= targetT) {
      var ev = events[i];
      if (
        replayState.positionsEndT != null &&
        (ev.t || 0) > replayState.positionsEndT &&
        ev.event !== "match_status" &&
        ev.event !== "match_end"
      ) {
        break;
      }
      if (
        ev.event === "match_status" ||
        ev.event === "countdown_start" ||
        ev.event === "match_start" ||
        ev.event === "match_end"
      ) {
        replayState.lastAppliedIndex = i;
        i++;
        continue;
      }
      applyReplayEvent(ev).catch(function (err) {
        setStatus(String(err.message || err), true);
      });
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
        replayScrubWasPlaying = !!(replayState && replayState.playing);
        stopReplayPlayback();
      });
      scrub.addEventListener("input", function () {
        scheduleSeekReplay(Number(scrub.value), { scrubPreview: true });
      });
      scrub.addEventListener("change", function () {
        cancelScheduledSeekReplay();
        var resume = replayScrubWasPlaying;
        replayScrubWasPlaying = false;
        seekReplay(Number(scrub.value))
          .then(function () {
            if (resume) startReplayPlayback();
          })
          .catch(function (err) {
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

  function pickDefaultRecording(rows) {
    if (!rows || !rows.length) return "";
    var hasSegments = false;
    for (var j = 0; j < rows.length; j++) {
      if (rows[j].recording_id && String(rows[j].recording_id).indexOf("__") >= 0) {
        hasSegments = true;
        break;
      }
    }
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.is_recording) continue;
      if (row.is_complete === false) continue;
      if (hasSegments && row.is_legacy) continue;
      return row.recording_id || row.match_id || "";
    }
    return "";
  }

  async function initMapReplay() {
    document.body.classList.add("map-replay-mode");
    showReplayMediaBar("replay");
    bindReplayBar();
    bindReplaySelectHandlers();

    if (replaySourceFileOnly()) {
      setStatus("Load a replay file (.json or .jsonl)");
      return;
    }

    setStatus("Loading replay…");

    var mid = matchId();
    replayCatalogRows = [];
    try {
      replayCatalogRows = await fetchReplayCatalog(mid);
    } catch (_eList) {
      /* list unavailable */
    }

    var wantRecording = recordingIdParam();
    if (!wantRecording && replayCatalogRows.length) {
      wantRecording = pickDefaultRecording(replayCatalogRows);
    }

    populateReplaySelect(replayCatalogRows, wantRecording);

    if (!wantRecording) {
      setStatus("Pick a server replay (?match=ID) or Load file", true);
      return;
    }

    try {
      await loadServerReplay(wantRecording, replaySegmentParam());
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
      await scheduleMapSnapshot(data);
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
    var stopped = false;

    registerMapCleanup(function () {
      stopped = true;
      clearSilentTimer();
      stopHttpPoll();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
        try {
          ws.close();
        } catch (_e) {
          /* ignore */
        }
        ws = null;
      }
    });

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
      if (reconnectTimer || stopped) return;
      reconnectTimer = setTimeout(function () {
        reconnectTimer = null;
        connect();
      }, ms || 2000);
    }

    function connect() {
      if (stopped) return;
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
              applyMapPauseFields(data, { authoritative: false });
              scheduleMapSnapshot(data);
            } else if (data.event === "match_status") {
              recordClientMatchStatus(data);
              if (data.status === "ended" || data.status === "aborted") {
                lastMapContext.phase = "ended";
                renderLiveMapScoreHud();
                resetMatchOverlayState("match_end", {
                  match_id: data.match_id,
                  map_name: lastMapContext.map_name,
                });
                clearMapMotion();
                scheduleMapSnapshot({
                  event: data.event,
                  match_id: data.match_id,
                  map_name: lastMapContext.map_name,
                  gametype: lastMapContext.gametype,
                  players: [],
                });
              }
            } else if (data.event === "game_started") {
              lastMapContext.phase = "playing";
              mapLifecycleWalls.matchStartWallT = Date.now();
              if (mapLifecycleWalls.countdownWallT != null) {
                mapLifecycleWalls.countdownLeadMs = Math.max(
                  0,
                  mapLifecycleWalls.matchStartWallT - mapLifecycleWalls.countdownWallT,
                );
              }
              handleGameStartedEvent(data);
            } else if (data.event === "match_update") {
              handleMatchUpdateEvent(data);
              var matchRow = data.match;
              if (matchRow && matchRow.gametype) {
                lastMapContext.gametype = matchRow.gametype;
              }
            } else if (data.event === "session_event" && data.session_event) {
              noteMapLifecycleFromSession(data.session_event);
              updateLiveLifecycleBanner();
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
    return setInterval(function () {
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
          var ro = new ResizeObserver(function () {
            ensureMotionLoop();
          });
          ro.observe(resizeTarget);
          registerMapCleanup(function () {
            ro.disconnect();
          });
        }
        registerMapCleanup(function () {
          if (mapMotion && mapMotion.loopId) {
            cancelAnimationFrame(mapMotion.loopId);
            mapMotion.loopId = null;
          }
          if (pickupToastLoopId) {
            cancelAnimationFrame(pickupToastLoopId);
            pickupToastLoopId = null;
          }
          if (replayState && replayState.rafId) {
            cancelAnimationFrame(replayState.rafId);
            replayState.rafId = null;
          }
        });
        loadPickupSpriteMap().then(function () {
          return loadPickupSpriteImage(resolveDeathSpriteUrl());
        });
        initPickupLogUi();
        ensureMapTimerTicker();
        if (replayMode()) {
          initMapReplay();
        } else {
          if (useWebSocket()) {
            initMapWebSocket();
          } else {
            var mapLoopId = loop(refreshMap, mapPollMs());
            registerMapCleanup(function () {
              clearInterval(mapLoopId);
            });
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
    // Embedded views (e.g. #/demo) normally use their own page-level replay
    // controls and leave the widget's built-in #map-replay-bar unbound
    // (initMapReplay(), the only other caller, is standalone-only). Fullscreen
    // has no room for that page-level UI, so the embedded view can opt into
    // wiring the built-in bar too (dashboard.css shows it only while
    // :fullscreen) - idempotent, safe to call once after loadReplayData.
    ensureReplayBarBound: function () {
      bindReplayBar();
    },
    onPickup: function (fn) {
      pickupListeners.push(fn);
    },
    replayProgress: function () {
      if (!replayState) return null;
      var durationMs = replayState.durationMs || 0;
      return {
        cursorMs: replayState.cursorMs,
        durationMs: durationMs,
        startMs: replayState.startMs,
        playing: !!replayState.playing,
        speed: replayState.speed,
        gameMs: replayCursorToGameMs(replayState.cursorMs),
        gameMaxMs: replayCursorToGameMs(durationMs),
      };
    },
    isReplayPlaying: function () {
      return !!(replayState && replayState.playing);
    },
    pauseReplay: function () {
      stopReplayPlayback();
      updateReplayBarUi();
    },
    playReplay: function () {
      startReplayPlayback();
    },
    toggleReplayPlayback: function () {
      toggleReplayPlayback();
    },
    setReplaySpeed: function (speed) {
      if (!replayState) return;
      var n = Number(speed);
      replayState.speed = isFinite(n) && n > 0 ? n : 1;
      var speedSel = document.getElementById("map-replay-speed");
      if (speedSel) speedSel.value = String(replayState.speed);
    },
    seekReplayMs: function (cursorMs, opts) {
      if (!replayState) return Promise.resolve();
      opts = opts || {};
      var resume = !!opts.resume;
      if (!resume) stopReplayPlayback();
      cancelScheduledSeekReplay();
      return seekReplay(Number(cursorMs) || 0)
        .then(function () {
          if (resume) startReplayPlayback();
        })
        .catch(function (err) {
          setStatus(String(err.message || err), true);
        });
    },
    seekReplayGameMs: function (gameMs, opts) {
      if (!replayState) return Promise.resolve();
      opts = opts || {};
      var c = replayGameMsToCursor(Number(gameMs) || 0, opts);
      if (c == null) return Promise.resolve();
      return window.OverlayApp.seekReplayMs(c, opts);
    },
    scheduleSeekReplayGameMs: scheduleSeekReplayGameMs,
    cancelScheduledSeekReplay: cancelScheduledSeekReplay,
    setReplayCursorListener: function (fn) {
      replayCursorListener = typeof fn === "function" ? fn : null;
    },
    _setConfig: setConfigOverride,
    _teardownMap: runMapCleanups,
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
      if (replayState) {
        renderReplayScoreHud(replayState.startMs + replayState.cursorMs);
      } else {
        renderLiveMapScoreHud();
      }
    },
    clearHeatmap: clearHeatmap,
    resetMatchOverlayState: resetMatchOverlayState,
    _mapKey: mapKey,
    _resolveImageUrl: resolveImageUrl,
    useWebSocket: useWebSocket,
    replayMode: replayMode,
    loadReplayData: function (data) {
      return activateReplayData(data);
    },
    parseReplayFileContent: parseReplayFileContent,
    overlayNowMs: overlayNowMs,
    playerMarkerRole: playerMarkerRole,
    mapPollMs: mapPollMs,
  };
})();
