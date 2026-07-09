(function () {
  "use strict";

  var A = function () {
    return QLDashboardAnalytics;
  };

  var pollTimer = null;
  var clockTimer = null;
  var wsHandle = null;
  var wsRefreshTimer = null;
  var activeMatchId = null;
  var lastLiveData = null;
  var lastArchive = null;
  var lastPositionPlayers = [];
  var lastPositionRowsRaw = [];
  var scrubGameTimeMs = null;
  var scrubAtLive = true;
  var analyticsDragging = false;
  var scrubPanelSyncTimer = 0;

  function rosterPlayers() {
    return A().mergePlayerRosters(
      lastLiveData && lastLiveData.players,
      lastPositionPlayers,
    );
  }

  function livePlayersForDisplay() {
    if (!scrubAtLive) return null;
    var merged = rosterPlayers();
    return merged.length ? merged : null;
  }

  function refreshRosterDisplay() {
    var players = rosterPlayers();
    var heroPlayers = document.getElementById("server-hero-players");
    if (heroPlayers) {
      heroPlayers.innerHTML = A().renderHeroPlayers(players, lastLiveData);
    }
    refreshScoreDisplay();
  }

  function refreshScoreDisplay() {
    var livePlayers = livePlayersForDisplay();
    var roster = rosterPlayers();
    if (!lastArchive && !roster.length) {
      var scoreboardElEmpty = document.getElementById("server-scoreboard");
      if (scoreboardElEmpty) scoreboardElEmpty.innerHTML = "";
      return;
    }
    var scrubMs = scrubGameTimeMs;
    var baseArchive =
      lastArchive ||
      {
        gametype: lastLiveData && lastLiveData.gametype,
        map_name: lastLiveData && lastLiveData.map_name,
        players: [],
        deaths: [],
        pickups: [],
        accuracy_summary: [],
        accuracy_timeline: [],
      };
    var view = livePlayers
      ? Object.assign({}, baseArchive, { players: livePlayers })
      : A().archiveForScore(baseArchive, scrubMs);
    var scoreboardEl = document.getElementById("server-scoreboard");
    if (scoreboardEl) {
      scoreboardEl.innerHTML = A().renderScoreboard(view, scrubMs, livePlayers, lastLiveData);
    }
  }

  function scheduleScrubPanelSync() {
    if (scrubPanelSyncTimer) return;
    scrubPanelSyncTimer = setTimeout(function () {
      scrubPanelSyncTimer = 0;
      refreshAnalyticsPanels();
      refreshScoreDisplay();
    }, 100);
  }

  function flushScrubPanelSync() {
    if (scrubPanelSyncTimer) {
      clearTimeout(scrubPanelSyncTimer);
      scrubPanelSyncTimer = 0;
    }
    refreshAnalyticsPanels();
    refreshScoreDisplay();
  }

  function stopWs() {
    if (wsRefreshTimer) {
      clearTimeout(wsRefreshTimer);
      wsRefreshTimer = null;
    }
    if (wsHandle) {
      wsHandle.close();
      wsHandle = null;
    }
  }

  function scheduleArchiveRefresh(delayMs) {
    if (wsRefreshTimer) clearTimeout(wsRefreshTimer);
    wsRefreshTimer = setTimeout(function () {
      wsRefreshTimer = null;
      if (activeMatchId) refreshArchive(activeMatchId);
    }, delayMs == null ? 150 : delayMs);
  }

  function mergeWsPickup(msg) {
    if (!lastArchive || !msg) return;
    var row = {
      game_time_ms: msg.game_time_ms,
      nickname: A().displayNickname(msg),
      item: msg.item,
      steam_id64: msg.steam_id64,
    };
    lastArchive.pickups = lastArchive.pickups || [];
    var key =
      String(row.steam_id64 || "") +
      "\0" +
      String(row.item || "") +
      "\0" +
      String(row.game_time_ms || "");
    var seen = false;
    for (var i = 0; i < lastArchive.pickups.length; i++) {
      var p = lastArchive.pickups[i];
      var pkey =
        String(p.steam_id64 || "") +
        "\0" +
        String(p.item || p.text || "") +
        "\0" +
        String(p.game_time_ms || "");
      if (pkey === key) {
        seen = true;
        break;
      }
    }
    if (!seen) lastArchive.pickups.push(row);
  }

  function mergeWsDeath(msg) {
    if (!lastArchive || !msg) return;
    var row = {
      game_time_ms: msg.game_time_ms,
      killer: msg.killer || msg.killer_name,
      victim: msg.victim || msg.victim_name,
      killer_steam_id64: msg.killer_steam_id64,
      victim_steam_id64: msg.victim_steam_id64,
      weapon: msg.weapon,
    };
    lastArchive.deaths = lastArchive.deaths || [];
    lastArchive.deaths.push(row);
  }

  function mergeWsAccuracy(msg) {
    if (!lastArchive || !msg || !msg.accuracy) return;
    var acc = msg.accuracy;
    lastArchive.accuracy_summary = lastArchive.accuracy_summary || [];
    lastArchive.accuracy_timeline = lastArchive.accuracy_timeline || [];
    var key = String(acc.steam_id64 || "") + "\0" + String(acc.weapon || "");
    var merged = false;
    for (var i = 0; i < lastArchive.accuracy_summary.length; i++) {
      var s = lastArchive.accuracy_summary[i];
      if (String(s.steam_id64 || "") + "\0" + String(s.weapon || "") === key) {
        lastArchive.accuracy_summary[i] = Object.assign({}, s, acc);
        merged = true;
        break;
      }
    }
    if (!merged) lastArchive.accuracy_summary.push(Object.assign({}, acc));
    lastArchive.accuracy_timeline.push(Object.assign({}, acc));
  }

  function startWs(matchId) {
    stopWs();
    var url = QLDashboard.statsHubWsUrl(matchId);
    if (!url || typeof WebSocket === "undefined") return;

    wsHandle = window.QLLiveWs.connect(url, {
      backoffMs: 3000,
      onMessage: function (ev) {
        var msg;
        try {
          msg = JSON.parse(ev.data);
        } catch (_e2) {
          return;
        }
        if (!msg || String(msg.match_id || "") !== String(matchId)) return;
        var event = String(msg.event || "");
        if (event === "pickup") {
          mergeWsPickup(msg);
          scheduleArchiveRefresh(200);
          syncScrubToLive();
          refreshAnalyticsOnLiveData();
          return;
        }
        if (event === "death") {
          mergeWsDeath(msg);
          scheduleArchiveRefresh(200);
          syncScrubToLive();
          refreshAnalyticsOnLiveData();
          return;
        }
        if (event === "accuracy_update") {
          mergeWsAccuracy(msg);
          scheduleArchiveRefresh(200);
          syncScrubToLive();
          refreshAnalyticsOnLiveData();
          return;
        }
        if (event === "session_event") {
          scheduleArchiveRefresh(100);
          return;
        }
        if (event === "snapshot" || event === "positions") {
          if (Array.isArray(msg.players)) {
            lastPositionRowsRaw = msg.players.slice();
            lastPositionPlayers = A().playersFromPositionRows(msg.players);
            refreshRosterDisplay();
          }
          if (msg.paused != null) {
            lastLiveData = Object.assign({}, lastLiveData || {}, {
              paused: !!msg.paused,
              pause_accumulated_ms:
                msg.pause_accumulated_ms != null
                  ? Number(msg.pause_accumulated_ms) || 0
                  : lastLiveData && lastLiveData.pause_accumulated_ms,
            });
            updateHeader(lastLiveData);
          }
          return;
        }
        if (event === "match_update") {
          if (msg.match) {
            lastLiveData = msg.match;
            updateHeader(lastLiveData);
            refreshRosterDisplay();
          } else {
            scheduleArchiveRefresh(400);
          }
          return;
        }
      },
    });
  }

  function syncScrubToLive() {
    if (!scrubAtLive || !lastArchive) return;
    var maxMs = A().computeTimelineMaxMs(lastArchive, lastLiveData);
    if (maxMs != null) scrubGameTimeMs = maxMs;
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    stopWs();
    activeMatchId = null;
  }

  function mountMapWidget(matchId) {
    if (typeof MapWidget === "undefined") return;
    var host = document.getElementById("server-map-widget");
    if (!host) return;
    var base = QLDashboard.settings.statsHubBase;
    if (!base) return;
    try {
      MapWidget.mount(host, {
        base: String(base).replace(/\/+$/, ""),
        match: matchId,
        transport: "ws",
        embedded: true,
      });
    } catch (_e) {
      /* map widget is optional enrichment; ignore mount failures */
    }
  }

  function destroyMapWidget() {
    if (typeof MapWidget === "undefined") return;
    try {
      MapWidget.destroy();
    } catch (_e) {
      /* ignore */
    }
  }

  function stopClock() {
    if (clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  }

  function startClock() {
    stopClock();
    clockTimer = setInterval(function () {
      if (lastLiveData) updateHeader(lastLiveData);
    }, 1000);
  }

  function isLiveGamePhase(liveData) {
    if (!liveData) return false;
    if (QLDashboard.isWarmupPhase(liveData)) return false;
    if (liveData.phase === "ended" || String(liveData.status || "").toLowerCase() === "ended") {
      return false;
    }
    return liveData.phase === "playing" || liveData.phase == null;
  }

  function shouldShowLiveAnalytics(liveData, archive) {
    if (QLDashboard.debugMode()) return true;
    if (isLiveGamePhase(liveData)) return true;
    if (!liveData || !archive) return false;
    if (liveData.phase === "ended" || String(liveData.status || "").toLowerCase() === "ended") {
      return false;
    }
    if (QLDashboard.isWarmupPhase(liveData)) {
      return !!(
        (archive.deaths && archive.deaths.length) ||
        (archive.accuracy_summary && archive.accuracy_summary.length) ||
        (archive.pickups && archive.pickups.length)
      );
    }
    return false;
  }

  function mockArchiveSummary(matchId) {
    return {
      session_id: matchId,
      map_name: "bloodrun",
      gametype: "duel",
      status: "live",
      deaths: [
        { game_time_ms: 45000, killer: "Cypher", victim: "rapha", weapon: "ROCKET" },
        { game_time_ms: 61000, killer: "Cypher", victim: "rapha", weapon: "ROCKET_SPLASH" },
        { game_time_ms: 78000, killer: "rapha", victim: "Cypher", weapon: "RAILGUN" },
        { game_time_ms: 95000, killer: "rapha", victim: "Cypher", weapon: "LIGHTNING" },
      ],
      pickups: [
        { game_time_ms: 12000, nickname: "Cypher", item: "item_health_mega" },
        { game_time_ms: 28000, nickname: "rapha", item: "item_armor_combat" },
        { game_time_ms: 40000, nickname: "Cypher", item: "item_armor_body" },
        { game_time_ms: 52000, nickname: "rapha", item: "item_quad" },
      ],
      accuracy_summary: [
        { nickname: "Cypher", weapon: "RL", hits: 18, shots: 42, accuracy_pct: 42.9 },
        { nickname: "rapha", weapon: "RL", hits: 14, shots: 36, accuracy_pct: 38.9 },
      ],
      accuracy_timeline: [
        {
          nickname: "Cypher",
          weapon: "RL",
          hits: 8,
          shots: 20,
          accuracy_pct: 40.0,
          game_time_ms: 60000,
        },
        {
          nickname: "Cypher",
          weapon: "RL",
          hits: 18,
          shots: 42,
          accuracy_pct: 42.9,
          game_time_ms: 180000,
        },
      ],
      timeline_max_ms: 180000,
      duration_ms: 180000,
      markers: [
        {
          kind: "countdown_start",
          ts: "2026-07-01T14:38:50.000Z",
          game_time_ms: 0,
        },
        {
          kind: "match_start",
          ts: "2026-07-01T14:39:00.000Z",
          game_time_ms: 0,
        },
        {
          kind: "match_end",
          ts: "2026-07-01T14:42:00.000Z",
          game_time_ms: 180000,
        },
      ],
    };
  }

  function renderMatchClockHtml(liveData) {
    if (!liveData) return "";
    if (QLDashboard.isWarmupPhase(liveData)) {
      return "";
    }
    if (liveData.phase === "countdown" || liveData.countdown) {
      return (
        '<span class="match-page-clock match-page-clock-warmup">' +
        QLDashboard.escapeHtml(QLDashboard.t("phaseCountdown")) +
        "</span>"
      );
    }
    if (liveData.phase === "ended" || String(liveData.status || "").toLowerCase() === "ended") {
      return "";
    }
    if (liveData.paused) {
      var pausedElapsed = QLDashboard.computeMatchElapsedSec(liveData);
      var pausedLabel = pausedElapsed != null ? QLDashboard.formatClockSec(pausedElapsed) : "";
      return (
        '<span class="match-page-clock match-page-clock-paused">' +
        QLDashboard.escapeHtml(pausedLabel) +
        '</span> <span class="match-page-paused-badge">' +
        QLDashboard.escapeHtml(QLDashboard.t("phasePaused")) +
        "</span>"
      );
    }
    var elapsed = QLDashboard.computeMatchElapsedSec(liveData);
    if (elapsed == null) return "";
    var label = QLDashboard.formatClockSec(elapsed);
    return '<span class="match-page-clock">' + QLDashboard.escapeHtml(label) + "</span>";
  }

  function updateHeader(liveData) {
    var clockEl = document.getElementById("server-clock");
    if (!clockEl) return;
    clockEl.innerHTML = renderMatchClockHtml(liveData);
  }

  function bindTimelineScrubber(archive, liveData) {
    var scrub = document.getElementById("match-timeline-scrub");
    if (!scrub || scrub.dataset.qlBound) return;
    scrub.dataset.qlBound = "1";
    var minMs = A().computeTimelineMinMs(archive);
    var maxMs = A().computeTimelineMaxMs(archive, liveData);
    if (minMs != null) scrub.min = String(minMs);

    scrub.addEventListener("pointerdown", function () {
      analyticsDragging = true;
    });

    scrub.addEventListener("input", function () {
      scrubGameTimeMs = Number(scrub.value);
      maxMs = A().computeTimelineMaxMs(lastArchive, lastLiveData);
      scrubAtLive = maxMs != null && Number(scrubGameTimeMs) >= maxMs - 500;
      var label = document.getElementById("match-timeline-label");
      if (label) {
        label.textContent = A().formatTimelineScrubTime(scrubGameTimeMs, lastArchive);
      }
      A().updateLifecyclePhaseBadge(lastArchive, scrubGameTimeMs, lastLiveData);
      if (analyticsDragging) {
        scheduleScrubPanelSync();
      } else {
        flushScrubPanelSync();
      }
    });

    scrub.addEventListener("change", function () {
      analyticsDragging = false;
      flushScrubPanelSync();
    });

    scrub.addEventListener("pointercancel", function () {
      analyticsDragging = false;
    });

    scrub.addEventListener("pointerup", function () {
      analyticsDragging = false;
    });

    var liveBtn = document.getElementById("match-timeline-live");
    if (liveBtn && !liveBtn.dataset.qlBound) {
      liveBtn.dataset.qlBound = "1";
      liveBtn.addEventListener("click", function () {
        maxMs = A().computeTimelineMaxMs(lastArchive, lastLiveData);
        scrubAtLive = true;
        scrubGameTimeMs = maxMs;
        scrub.value = String(maxMs);
        var label = document.getElementById("match-timeline-label");
        if (label) label.textContent = A().formatTimelineScrubTime(maxMs, lastArchive);
        A().updateLifecyclePhaseBadge(lastArchive, maxMs, lastLiveData);
        flushScrubPanelSync();
      });
    }
  }

  function updateTimelineScrubberBounds() {
    var scrub = document.getElementById("match-timeline-scrub");
    if (!scrub || !lastArchive) return;
    var minMs = A().computeTimelineMinMs(lastArchive);
    var maxMs = A().computeTimelineMaxMs(lastArchive, lastLiveData);
    if (maxMs == null) return;
    scrub.min = String(minMs);
    scrub.max = String(maxMs);
    if (scrubAtLive) {
      scrubGameTimeMs = maxMs;
      scrub.value = String(maxMs);
      var label = document.getElementById("match-timeline-label");
      if (label) label.textContent = A().formatTimelineScrubTime(maxMs, lastArchive);
    } else if (scrubGameTimeMs != null && scrubGameTimeMs < minMs) {
      scrubGameTimeMs = minMs;
      scrub.value = String(minMs);
    }
    A().updateLifecyclePhaseBadge(lastArchive, scrubGameTimeMs, lastLiveData);
    refreshScoreDisplay();
  }

  function refreshAnalyticsPanels() {
    var panels = document.getElementById("match-analytics-panels");
    if (!panels || !lastArchive) return;
    A().preserveAnalyticsScroll(panels, function () {
      panels.innerHTML = A().renderAnalyticsPanels(
        lastArchive,
        lastLiveData && lastLiveData.players,
        {
          debug: QLDashboard.debugMode(),
          scrubMs: scrubGameTimeMs,
          liveData: lastLiveData,
        },
      );
    });
  }

  function refreshAnalyticsOnLiveData() {
    if (!lastArchive) return;
    if (scrubAtLive) {
      updateTimelineScrubberBounds();
    } else {
      refreshScoreDisplay();
    }
    refreshAnalyticsPanels();
  }

  function refreshAnalyticsPanel() {
    var analyticsWrap = document.getElementById("server-analytics-wrap");
    if (!analyticsWrap || !lastArchive) return;
    analyticsWrap.innerHTML = A().renderAnalytics(
      lastArchive,
      lastLiveData && lastLiveData.players,
      {
        debug: QLDashboard.debugMode(),
        scrubMs: scrubGameTimeMs,
        liveData: lastLiveData,
      },
    );
    bindTimelineScrubber(lastArchive, lastLiveData);
  }

  function renderRecentResults(rows, matchId) {
    if (!rows || !rows.length) {
      return (
        '<p class="match-analytics-empty">' +
        QLDashboard.escapeHtml(QLDashboard.t("serverRecentResultsEmpty")) +
        "</p>"
      );
    }
    var html =
      '<table class="data-table"><thead><tr><th>' +
      QLDashboard.escapeHtml(QLDashboard.t("colMap")) +
      "</th><th>" +
      QLDashboard.escapeHtml(QLDashboard.t("resultsColEnded")) +
      "</th><th>" +
      QLDashboard.escapeHtml(QLDashboard.t("matchReplayColDuration")) +
      "</th><th>" +
      QLDashboard.escapeHtml(QLDashboard.t("colActions")) +
      "</th></tr></thead><tbody>";
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var rid = r.recording_id || "";
      var detailUrl = "#/results/" + encodeURIComponent(rid);
      html +=
        "<tr><td>" +
        QLDashboard.escapeHtml(r.map_name || "—") +
        "</td><td>" +
        QLDashboard.escapeHtml(A().formatWhen(r.ended_at || r.started_at)) +
        "</td><td>" +
        QLDashboard.escapeHtml(A().formatReplayDuration(r.duration_ms)) +
        '</td><td><a class="control-btn control-btn-sm" href="' +
        QLDashboard.escapeHtml(detailUrl) +
        '">' +
        QLDashboard.escapeHtml(QLDashboard.t("resultsOpenDetail")) +
        "</a></td></tr>";
    }
    html += "</tbody></table>";
    return html;
  }

  function renderServerPicker(root) {
    var matches = QLDashboard.matches || [];
    var html =
      '<section class="control-section">' +
      "<h2>" +
      QLDashboard.escapeHtml(QLDashboard.t("navServer")) +
      "</h2>" +
      '<p class="control-field-hint">' +
      QLDashboard.escapeHtml(QLDashboard.t("serverSelectHint")) +
      "</p>";
    if (!matches.length) {
      html +=
        '<p class="control-field-hint">' +
        QLDashboard.escapeHtml(QLDashboard.t("matchesEmpty")) +
        "</p>";
    } else {
      html +=
        '<table class="matches-table"><thead><tr><th>' +
        QLDashboard.escapeHtml(QLDashboard.t("colMap")) +
        "</th><th>" +
        QLDashboard.escapeHtml(QLDashboard.t("colStatus")) +
        "</th><th>" +
        QLDashboard.escapeHtml(QLDashboard.t("colServer")) +
        "</th><th>" +
        QLDashboard.escapeHtml(QLDashboard.t("colActions")) +
        '</th></tr></thead><tbody id="server-picker-body">';
      for (var i = 0; i < matches.length; i++) {
        var row = matches[i];
        var mid = row.match_id || "";
        var href = "#/server/" + encodeURIComponent(mid);
        html +=
          "<tr><td>" +
          QLDashboard.escapeHtml([row.map_name, row.gametype].filter(Boolean).join(" · ") || "—") +
          '<div class="match-id">' +
          QLDashboard.escapeHtml(mid) +
          "</div></td><td>" +
          '<span class="badge ' +
          QLDashboard.escapeHtml(QLDashboard.statusBadgeClass(row)) +
          '">' +
          QLDashboard.escapeHtml(QLDashboard.matchPhaseLabel(row)) +
          "</span></td><td>" +
          QLDashboard.serverLocationHtml(row) +
          '</td><td><a class="control-btn control-btn-sm" href="' +
          QLDashboard.escapeHtml(href) +
          '">' +
          QLDashboard.escapeHtml(QLDashboard.t("openServer")) +
          '</a> <button type="button" class="control-btn control-btn-sm" data-map-for="' +
          QLDashboard.escapeHtml(mid) +
          '">' +
          QLDashboard.escapeHtml(QLDashboard.t("openMap")) +
          "</button></td></tr>";
      }
      html += "</tbody></table>";
    }
    html += "</section>";
    root.innerHTML = html;
    root.querySelectorAll("[data-map-for]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-map-for") || "";
        if (!id) return;
        QLDashboard.openWindow(
          QLDashboard.liveOverlayUrl("map", id),
          "ql-map-" + id,
        );
      });
    });
  }

  function mount(root, route) {
    stopPoll();
    stopClock();
    scrubGameTimeMs = null;
    scrubAtLive = true;
    lastLiveData = null;
    lastArchive = null;
    lastPositionPlayers = [];
    lastPositionRowsRaw = [];
    var matchId = route.param;
    if (!matchId) {
      renderServerPicker(root);
      return;
    }

    if (!QLDashboard.settings.statsHubBase) {
      root.innerHTML =
        '<section class="control-section"><p class="control-status error">' +
        QLDashboard.escapeHtml(QLDashboard.t("configureFirst")) +
        "</p></section>";
      return;
    }

    activeMatchId = matchId;
    renderShell(root, matchId);
    mountMapWidget(matchId);
    loadServer(matchId);
    startWs(matchId);
    startClock();
    pollTimer = setInterval(function () {
      if (activeMatchId) loadServer(activeMatchId);
    }, 3000);
  }

  function unmount() {
    if (scrubPanelSyncTimer) {
      clearTimeout(scrubPanelSyncTimer);
      scrubPanelSyncTimer = 0;
    }
    destroyMapWidget();
    stopPoll();
    stopClock();
  }

  function renderShell(root, matchId) {
    var urlFull = QLDashboard.liveOverlayUrl("match", matchId);
    var urlMap = QLDashboard.liveOverlayUrl("map", matchId);

    root.innerHTML =
      '<section class="control-section match-detail-section">' +
      '<p id="server-status" class="control-status">' +
      QLDashboard.escapeHtml(QLDashboard.t("serverLoading")) +
      "</p>" +
      '<div class="results-detail-hero">' +
      '<div class="results-detail-hero-main">' +
      '<header class="match-page-header">' +
      '<h1 id="server-title" class="match-page-title">—</h1>' +
      '<p id="server-meta" class="match-page-meta"></p>' +
      '<p id="server-clock" class="match-page-clock-row"></p>' +
      '<p><span id="server-badge" class="badge"></span></p>' +
      '<div id="server-hero-players" class="server-hero-players"></div>' +
      "</header>" +
      '<div class="control-actions" style="margin-top:12px">' +
      '<a id="server-btn-full" class="control-btn control-btn-primary" href="' +
      QLDashboard.escapeHtml(urlFull) +
      '" target="_blank" rel="noopener noreferrer">' +
      QLDashboard.escapeHtml(QLDashboard.t("matchOpenFull")) +
      "</a>" +
      '<a id="server-btn-map" class="control-btn" href="' +
      QLDashboard.escapeHtml(urlMap) +
      '" target="_blank" rel="noopener noreferrer">' +
      QLDashboard.escapeHtml(QLDashboard.t("matchOpenMap")) +
      "</a>" +
      "</div>" +
      "</div></div>" +
      '<div id="server-scoreboard" class="results-scoreboard-side"></div>' +
      "</div>" +
      '<div class="results-map-stack">' +
      '<div id="server-map-widget" class="match-map-widget"></div>' +
      "</div>" +
      '<div id="server-analytics-wrap"></div>' +
      '<p id="server-analytics-hint" class="control-field-hint" hidden></p>' +
      "</section>" +
      '<section class="control-section" id="server-recent-section">' +
      '<h2 class="match-section-title">' +
      QLDashboard.escapeHtml(QLDashboard.t("serverRecentResults")) +
      "</h2>" +
      '<div id="server-recent-wrap">' +
      QLDashboard.escapeHtml(QLDashboard.t("matchLoading")) +
      "</div></section>";
  }

  async function loadRecentResults(matchId) {
    var wrap = document.getElementById("server-recent-wrap");
    if (!wrap) return;
    try {
      var rows = await QLDashboard.fetchStatsJson(
        "/api/stream/results?server=" + encodeURIComponent(matchId) + "&limit=5",
      );
      if (!Array.isArray(rows)) rows = [];
      wrap.innerHTML = renderRecentResults(rows, matchId);
    } catch (_e) {
      wrap.innerHTML =
        '<p class="match-analytics-empty">' +
        QLDashboard.escapeHtml(QLDashboard.t("serverRecentResultsEmpty")) +
        "</p>";
    }
  }

  async function fetchPositionRoster(matchId) {
    try {
      var data = await QLDashboard.fetchStatsJson(
        "/api/matches/" + encodeURIComponent(matchId) + "/positions?players_only=1",
      );
      if (data && Array.isArray(data.players)) {
        lastPositionRowsRaw = data.players.slice();
        return A().playersFromPositionRows(data.players);
      }
    } catch (_e) {
      /* positions optional when telemetry off */
    }
    return [];
  }

  async function refreshArchive(matchId) {
    if (QLDashboard.debugMode()) return;
    var archive = await QLDashboard.fetchArchiveSummary(matchId);
    if (!archive || activeMatchId !== matchId) return;
    lastArchive = A().normalizeArchiveCombatClock(archive);
    syncScrubToLive();
    refreshAnalyticsOnLiveData();
  }

  async function loadServer(matchId) {
    var statusEl = document.getElementById("server-status");
    var debug = QLDashboard.debugMode();
    var liveData = null;

    try {
      liveData = await QLDashboard.fetchStatsJson(
        "/api/stream/matches/" + encodeURIComponent(matchId),
      );
      try {
        sessionStorage.setItem("ql-dashboard-last-server", String(matchId));
      } catch (_ss) {
        /* ignore */
      }

      var title = document.getElementById("server-title");
      var meta = document.getElementById("server-meta");
      var badge = document.getElementById("server-badge");
      if (title) title.textContent = QLDashboard.matchScoreSummary(liveData);
      if (meta) {
        var metaParts = [liveData.map_name, liveData.gametype, matchId].filter(Boolean);
        meta.innerHTML =
          QLDashboard.escapeHtml(metaParts.join(" · ")) +
          (metaParts.length ? "<br>" : "") +
          QLDashboard.serverLocationHtml(liveData);
      }
      if (badge) {
        badge.className = "badge " + QLDashboard.statusBadgeClass(liveData);
        badge.textContent = QLDashboard.matchPhaseLabel(liveData);
      }
      lastLiveData = liveData;
      updateHeader(liveData);
      A().updateLifecyclePhaseBadge(lastArchive, scrubGameTimeMs, liveData);
      if (statusEl) {
        statusEl.textContent = "";
        statusEl.classList.remove("error");
      }
    } catch (_err) {
      if (statusEl) {
        statusEl.textContent = QLDashboard.t("matchNotFound");
        statusEl.classList.add("error");
      }
    }

    var analyticsHint = document.getElementById("server-analytics-hint");
    var analyticsWrap = document.getElementById("server-analytics-wrap");
    var archive = null;
    if (!debug) {
      archive = await QLDashboard.fetchArchiveSummary(matchId);
    }
    if (debug) {
      archive = mockArchiveSummary(matchId);
    } else if (!archive) {
      archive = {
        deaths: [],
        pickups: [],
        accuracy_summary: [],
        accuracy_timeline: [],
        players: [],
      };
    }
    var showLiveAnalytics = shouldShowLiveAnalytics(liveData, archive);

    if (!showLiveAnalytics) {
      if (analyticsWrap) analyticsWrap.innerHTML = "";
      if (analyticsHint) {
        analyticsHint.hidden = false;
        analyticsHint.textContent = QLDashboard.t("serverAnalyticsLiveOnly");
      }
    } else {
      if (analyticsHint) analyticsHint.hidden = true;
      lastArchive = A().normalizeArchiveCombatClock(archive);
      var prevMax =
        scrubGameTimeMs != null ? scrubGameTimeMs : A().computeTimelineMaxMs(archive, liveData);
      if (scrubGameTimeMs == null) {
        scrubGameTimeMs = A().computeTimelineMaxMs(archive, liveData);
        scrubAtLive = true;
      } else if (scrubAtLive) {
        scrubGameTimeMs = A().computeTimelineMaxMs(archive, liveData);
      } else {
        var newMax = A().computeTimelineMaxMs(archive, liveData);
        if (newMax != null && prevMax != null && Number(prevMax) >= Number(newMax) - 500) {
          scrubGameTimeMs = newMax;
        }
      }
      if (analyticsWrap) {
        analyticsWrap.innerHTML = A().renderAnalytics(archive, liveData && liveData.players, {
          debug: debug,
          scrubMs: scrubGameTimeMs,
          liveData: liveData,
        });
        bindTimelineScrubber(archive, liveData);
        A().updateLifecyclePhaseBadge(archive, scrubGameTimeMs, liveData);
      }
    }

    lastPositionPlayers = await fetchPositionRoster(matchId);

    if (!lastArchive) {
      if (archive && (archive.deaths || archive.pickups || archive.accuracy_summary)) {
        lastArchive = A().normalizeArchiveCombatClock(archive);
      } else if (liveData || lastPositionPlayers.length) {
        lastArchive = {
          gametype: liveData && liveData.gametype,
          map_name: liveData && liveData.map_name,
          players: rosterPlayers(),
          deaths: [],
          pickups: [],
          accuracy_summary: [],
          accuracy_timeline: [],
        };
      }
    } else if (scrubAtLive && rosterPlayers().length) {
      lastArchive = Object.assign({}, lastArchive, { players: rosterPlayers() });
    }

    refreshRosterDisplay();

    await loadRecentResults(matchId);
  }

  var serverView = {
    mount: mount,
    unmount: unmount,
    onMatchesUpdated: function () {
      var route = QLDashboard.parseRoute();
      if ((route.view === "server" || route.view === "match") && !route.param) {
        var root = document.getElementById("app-main");
        if (root) renderServerPicker(root);
        return;
      }
    },
    onLangChanged: function () {
      var route = QLDashboard.parseRoute();
      var matchId = route.param;
      var root = document.getElementById("app-main");
      if (!root) return;
      if ((route.view === "server" || route.view === "match") && !matchId) {
        renderServerPicker(root);
        return;
      }
      if (route.view === "server" || route.view === "match") mount(root, route);
    },
  };

  QLDashboard.registerView("server", serverView);
})();
