(function () {
  "use strict";

  var A = function () {
    return QLDashboardAnalytics;
  };

  var pollTimer = null;
  var clockTimer = null;
  var ws = null;
  var wsRefreshTimer = null;
  var activeMatchId = null;
  var lastLiveData = null;
  var lastArchive = null;
  var scrubGameTimeMs = null;
  var scrubAtLive = true;

  function stopWs() {
    if (wsRefreshTimer) {
      clearTimeout(wsRefreshTimer);
      wsRefreshTimer = null;
    }
    if (ws) {
      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      } catch (_e) {
        /* ignore */
      }
      ws = null;
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
    try {
      ws = new WebSocket(url);
    } catch (_e) {
      ws = null;
      return;
    }
    ws.onmessage = function (ev) {
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
      if (event === "match_update") {
        scheduleArchiveRefresh(400);
      }
    };
    ws.onclose = function () {
      if (activeMatchId === matchId) {
        setTimeout(function () {
          if (activeMatchId === matchId) startWs(matchId);
        }, 3000);
      }
    };
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
        { game_time_ms: 45000, killer: "Cypher", victim: "rapha", weapon: "RL" },
        { game_time_ms: 78000, killer: "rapha", victim: "Cypher", weapon: "RG" },
      ],
      pickups: [
        { game_time_ms: 12000, nickname: "Cypher", item: "megahealth" },
        { game_time_ms: 28000, nickname: "rapha", item: "yellowarmor" },
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
    };
  }

  function renderMatchClockHtml(liveData) {
    if (!liveData) return "";
    if (QLDashboard.isWarmupPhase(liveData)) {
      var phaseKey =
        String(liveData.phase || "").toLowerCase() === "countdown" || liveData.countdown
          ? "phaseCountdown"
          : "phaseWarmup";
      return (
        '<span class="match-page-clock match-page-clock-warmup">' +
        QLDashboard.escapeHtml(QLDashboard.t(phaseKey)) +
        "</span>"
      );
    }
    if (liveData.phase === "ended" || String(liveData.status || "").toLowerCase() === "ended") {
      return "";
    }
    var elapsed = QLDashboard.computeMatchElapsedSec(liveData);
    if (elapsed == null) return "";
    var label = QLDashboard.formatClockSec(elapsed);
    if (liveData.timelimit_sec) {
      label += " / " + QLDashboard.formatClockSec(liveData.timelimit_sec);
    }
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
    var maxMs = A().computeTimelineMaxMs(archive, liveData);
    scrub.addEventListener("input", function () {
      scrubGameTimeMs = Number(scrub.value);
      maxMs = A().computeTimelineMaxMs(lastArchive, lastLiveData);
      scrubAtLive = maxMs != null && Number(scrubGameTimeMs) >= maxMs - 500;
      var label = document.getElementById("match-timeline-label");
      if (label) label.textContent = A().formatGameTime(scrubGameTimeMs);
      refreshAnalyticsPanels();
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
        if (label) label.textContent = A().formatGameTime(maxMs);
        refreshAnalyticsPanels();
      });
    }
  }

  function updateTimelineScrubberBounds() {
    var scrub = document.getElementById("match-timeline-scrub");
    if (!scrub || !lastArchive) return;
    var maxMs = A().computeTimelineMaxMs(lastArchive, lastLiveData);
    if (maxMs == null) return;
    scrub.max = String(maxMs);
    if (scrubAtLive) {
      scrubGameTimeMs = maxMs;
      scrub.value = String(maxMs);
      var label = document.getElementById("match-timeline-label");
      if (label) label.textContent = A().formatGameTime(maxMs);
    }
  }

  function refreshAnalyticsPanels() {
    var panels = document.getElementById("match-analytics-panels");
    if (!panels || !lastArchive) return;
    panels.innerHTML = A().renderAnalyticsPanels(
      lastArchive,
      lastLiveData && lastLiveData.players,
      {
        debug: QLDashboard.debugMode(),
        scrubMs: scrubGameTimeMs,
        liveData: lastLiveData,
      },
    );
  }

  function refreshAnalyticsOnLiveData() {
    if (!lastArchive) return;
    if (scrubAtLive) {
      updateTimelineScrubberBounds();
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

  function mount(root, route) {
    stopPoll();
    stopClock();
    scrubGameTimeMs = null;
    scrubAtLive = true;
    lastLiveData = null;
    lastArchive = null;
    var matchId = route.param;
    if (!matchId) {
      root.innerHTML =
        '<section class="control-section"><p class="control-field-hint">' +
        QLDashboard.escapeHtml(QLDashboard.t("serverSelectHint")) +
        "</p></section>";
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
    loadServer(matchId);
    startWs(matchId);
    startClock();
    pollTimer = setInterval(function () {
      if (activeMatchId) loadServer(activeMatchId);
    }, 3000);
  }

  function unmount() {
    stopPoll();
    stopClock();
  }

  function renderShell(root, matchId) {
    var urlFull = QLDashboard.liveOverlayUrl("match", matchId);
    var urlMap = QLDashboard.liveOverlayUrl("map", matchId);

    root.innerHTML =
      '<section class="control-section">' +
      '<p id="server-status" class="control-status">' +
      QLDashboard.escapeHtml(QLDashboard.t("serverLoading")) +
      "</p>" +
      '<header class="match-page-header">' +
      '<h1 id="server-title" class="match-page-title">—</h1>' +
      '<p id="server-meta" class="match-page-meta"></p>' +
      '<p id="server-clock" class="match-page-clock-row"></p>' +
      '<p><span id="server-badge" class="badge"></span></p>' +
      "</header>" +
      '<h2 class="match-section-title">' +
      QLDashboard.escapeHtml(QLDashboard.t("matchSectionPlayers")) +
      "</h2>" +
      '<div id="server-players-wrap"></div>' +
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
      "</div></section>" +
      '<section class="control-section" id="server-analytics-section">' +
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

  async function refreshArchive(matchId) {
    if (QLDashboard.debugMode()) return;
    var archive = await QLDashboard.fetchArchiveSummary(matchId);
    if (!archive || activeMatchId !== matchId) return;
    lastArchive = A().normalizeArchivePickupTimes(archive);
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
      if (String(QLDashboard.settings.defaultMatchId || "") !== String(matchId)) {
        QLDashboard.patchSettings({ defaultMatchId: matchId }, { silent: true });
      }

      var title = document.getElementById("server-title");
      var meta = document.getElementById("server-meta");
      var badge = document.getElementById("server-badge");
      if (title) title.textContent = QLDashboard.matchScoreSummary(liveData);
      if (meta) {
        meta.textContent = [liveData.map_name, liveData.gametype, liveData.server_name, matchId]
          .filter(Boolean)
          .join(" · ");
      }
      if (badge) {
        badge.className = "badge " + QLDashboard.statusBadgeClass(liveData);
        badge.textContent = QLDashboard.matchPhaseLabel(liveData);
      }
      lastLiveData = liveData;
      updateHeader(liveData);
      if (statusEl) {
        statusEl.textContent = "";
        statusEl.classList.remove("error");
      }

      var wrap = document.getElementById("server-players-wrap");
      if (wrap && Array.isArray(liveData.players)) {
        var html =
          '<table class="data-table"><thead><tr><th>Player</th><th>Score</th><th>K</th><th>D</th></tr></thead><tbody>';
        var sorted = liveData.players.slice().sort(function (a, b) {
          if (QLDashboard.isWarmupPhase(liveData)) {
            return String(A().displayNickname(a)).localeCompare(String(A().displayNickname(b)));
          }
          return (b.score || 0) - (a.score || 0);
        });
        for (var i = 0; i < sorted.length; i++) {
          var p = sorted[i];
          html +=
            "<tr><td>" +
            QLDashboard.escapeHtml(A().displayNickname(p)) +
            "</td><td>" +
            QLDashboard.playerStatDisplay(liveData, p.score) +
            "</td><td>" +
            QLDashboard.playerStatDisplay(liveData, p.kills) +
            "</td><td>" +
            QLDashboard.playerStatDisplay(liveData, p.deaths) +
            "</td></tr>";
        }
        html += "</tbody></table>";
        wrap.innerHTML = html;
      }
    } catch (_err) {
      if (statusEl) {
        statusEl.textContent = QLDashboard.t("matchNotFound");
        statusEl.classList.add("error");
      }
    }

    var analyticsSection = document.getElementById("server-analytics-section");
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
      if (analyticsSection) analyticsSection.style.display = "";
    } else {
      if (analyticsHint) analyticsHint.hidden = true;
      lastArchive = A().normalizeArchivePickupTimes(archive);
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
      }
    }

    await loadRecentResults(matchId);
  }

  var serverView = {
    mount: mount,
    unmount: unmount,
    onLangChanged: function () {
      var route = QLDashboard.parseRoute();
      var root = document.getElementById("app-main");
      if (root && (route.view === "server" || route.view === "match")) mount(root, route);
    },
  };

  QLDashboard.registerView("server", serverView);
  QLDashboard.registerView("match", serverView);
})();
