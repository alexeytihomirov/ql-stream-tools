(function () {
  "use strict";

  var pollTimer = null;
  var clockTimer = null;
  var activeMatchId = null;
  var lastLiveData = null;
  var lastArchive = null;
  var scrubGameTimeMs = null;

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
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
      if (lastLiveData) updateMatchHeader(lastLiveData);
    }, 1000);
  }

  function formatGameTime(ms) {
    if (ms == null || isNaN(ms)) return "—";
    var sec = Math.max(0, Math.floor(Number(ms) / 1000));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function sortByGameTime(rows) {
    return (rows || []).slice().sort(function (a, b) {
      return (Number(a.game_time_ms) || 0) - (Number(b.game_time_ms) || 0);
    });
  }

  function mockArchiveSummary(matchId) {
    return {
      session_id: matchId,
      map_name: "bloodrun",
      gametype: "duel",
      status: "live",
      deaths: [
        {
          game_time_ms: 45000,
          killer: "Cypher",
          victim: "rapha",
          weapon: "RL",
        },
        {
          game_time_ms: 78000,
          killer: "rapha",
          victim: "Cypher",
          weapon: "RG",
        },
        {
          game_time_ms: 112000,
          killer: "Cypher",
          victim: "rapha",
          weapon: "LG",
        },
        {
          game_time_ms: 145000,
          killer: "rapha",
          victim: "Cypher",
          weapon: "RL",
        },
        {
          game_time_ms: 180000,
          killer: "Cypher",
          victim: "rapha",
          weapon: "RL",
        },
      ],
      pickups: [
        { game_time_ms: 12000, nickname: "Cypher", item: "megahealth" },
        { game_time_ms: 28000, nickname: "rapha", item: "yellowarmor" },
        { game_time_ms: 52000, nickname: "Cypher", item: "rocketlauncher" },
        { game_time_ms: 65000, nickname: "rapha", item: "railgun" },
        { game_time_ms: 95000, nickname: "Cypher", item: "lightninggun" },
        { game_time_ms: 128000, nickname: "rapha", item: "megahealth" },
        { game_time_ms: 160000, nickname: "Cypher", item: "redarmor" },
      ],
      accuracy_summary: [
        {
          nickname: "Cypher",
          weapon: "RL",
          hits: 18,
          shots: 42,
          accuracy_pct: 42.9,
        },
        {
          nickname: "Cypher",
          weapon: "LG",
          hits: 34,
          shots: 58,
          accuracy_pct: 58.6,
        },
        {
          nickname: "Cypher",
          weapon: "RG",
          hits: 6,
          shots: 11,
          accuracy_pct: 54.5,
        },
        {
          nickname: "rapha",
          weapon: "RL",
          hits: 14,
          shots: 36,
          accuracy_pct: 38.9,
        },
        {
          nickname: "rapha",
          weapon: "RG",
          hits: 9,
          shots: 14,
          accuracy_pct: 64.3,
        },
        {
          nickname: "rapha",
          weapon: "LG",
          hits: 22,
          shots: 48,
          accuracy_pct: 45.8,
        },
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
        {
          nickname: "rapha",
          weapon: "RL",
          hits: 6,
          shots: 18,
          accuracy_pct: 33.3,
          game_time_ms: 60000,
        },
        {
          nickname: "rapha",
          weapon: "RL",
          hits: 14,
          shots: 36,
          accuracy_pct: 38.9,
          game_time_ms: 180000,
        },
      ],
      timeline_max_ms: 180000,
    };
  }

  function filterRowsByGameTime(rows, maxMs) {
    if (maxMs == null) return rows || [];
    return (rows || []).filter(function (row) {
      var gt = row.game_time_ms;
      if (gt == null || gt === "") return true;
      return Number(gt) <= maxMs;
    });
  }

  function accuracyAtScrub(timeline, summary, scrubMs) {
    if (scrubMs == null || !timeline || !timeline.length) {
      return summary || [];
    }
    var best = {};
    timeline.forEach(function (row) {
      var gt = Number(row.game_time_ms);
      if (isNaN(gt) || gt > scrubMs) return;
      var key = String(row.steam_id64 || row.nickname || "") + "\0" + (row.weapon || "");
      if (!best[key] || gt >= Number(best[key].game_time_ms || 0)) {
        best[key] = row;
      }
    });
    var out = Object.keys(best).map(function (k) {
      return best[k];
    });
    if (out.length) return out;
    return summary || [];
  }

  function computeTimelineMaxMs(archive, liveData) {
    var maxMs = Number(archive && archive.timeline_max_ms) || 0;
    function bump(rows) {
      (rows || []).forEach(function (row) {
        var gt = Number(row.game_time_ms);
        if (!isNaN(gt) && gt > maxMs) maxMs = gt;
      });
    }
    if (archive) {
      bump(archive.deaths);
      bump(archive.pickups);
      bump(archive.accuracy_timeline);
    }
    if (liveData) {
      var elapsed = QLDashboard.computeMatchElapsedSec(liveData);
      if (elapsed != null) maxMs = Math.max(maxMs, elapsed * 1000);
    }
    return maxMs > 0 ? maxMs : null;
  }

  function renderMatchClockHtml(liveData) {
    if (!liveData) return "";
    if (liveData.phase === "warmup" || liveData.warmup) {
      return (
        '<span class="match-page-clock match-page-clock-warmup">' +
        QLDashboard.escapeHtml(QLDashboard.t("phaseWarmup")) +
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

  function updateMatchHeader(liveData) {
    var clockEl = document.getElementById("match-clock");
    if (!clockEl) return;
    clockEl.innerHTML = renderMatchClockHtml(liveData);
  }

  function renderTimelineScrubber(archive, liveData) {
    var maxMs = computeTimelineMaxMs(archive, liveData);
    if (!maxMs) return "";
    var currentMs = scrubGameTimeMs != null ? scrubGameTimeMs : maxMs;
    var html =
      '<div class="match-timeline-panel">' +
      '<div class="match-timeline-head">' +
      "<h3>" +
      QLDashboard.escapeHtml(QLDashboard.t("matchSectionTimeline")) +
      "</h3>" +
      '<span id="match-timeline-label" class="match-timeline-label">' +
      QLDashboard.escapeHtml(formatGameTime(currentMs)) +
      "</span>" +
      "</div>" +
      '<input type="range" id="match-timeline-scrub" class="match-timeline-scrub" min="0" max="' +
      maxMs +
      '" step="1000" value="' +
      currentMs +
      '" />' +
      '<div class="match-timeline-actions">' +
      '<button type="button" id="match-timeline-live" class="control-btn control-btn-sm">' +
      QLDashboard.escapeHtml(QLDashboard.t("matchTimelineLive")) +
      "</button>" +
      "</div></div>";
    return html;
  }

  function bindTimelineScrubber(archive, liveData) {
    var scrub = document.getElementById("match-timeline-scrub");
    if (!scrub) return;
    var maxMs = computeTimelineMaxMs(archive, liveData);
    scrub.addEventListener("input", function () {
      scrubGameTimeMs = Number(scrub.value);
      var label = document.getElementById("match-timeline-label");
      if (label) label.textContent = formatGameTime(scrubGameTimeMs);
      refreshAnalyticsPanel();
    });
    var liveBtn = document.getElementById("match-timeline-live");
    if (liveBtn) {
      liveBtn.addEventListener("click", function () {
        scrubGameTimeMs = maxMs;
        scrub.value = String(maxMs);
        var label = document.getElementById("match-timeline-label");
        if (label) label.textContent = formatGameTime(maxMs);
        refreshAnalyticsPanel();
      });
    }
  }

  function refreshAnalyticsPanel() {
    var analyticsWrap = document.getElementById("match-analytics-wrap");
    if (!analyticsWrap || !lastArchive) return;
    analyticsWrap.innerHTML = renderAnalytics(
      lastArchive,
      lastLiveData && lastLiveData.players,
      QLDashboard.debugMode(),
      scrubGameTimeMs,
    );
    bindTimelineScrubber(lastArchive, lastLiveData);
  }

  function enrichAccuracyNicknames(archive, livePlayers) {
    var bySteam = {};
    (livePlayers || []).forEach(function (p) {
      if (p.steam_id64) bySteam[p.steam_id64] = p.nickname || p.steam_id64;
    });
    (archive.players || []).forEach(function (p) {
      if (p.steam_id64) bySteam[p.steam_id64] = p.nickname || p.steam_id64;
    });
    return (archive.accuracy_summary || []).map(function (row) {
      var nick = row.nickname;
      if (!nick && row.steam_id64) nick = bySteam[row.steam_id64];
      return Object.assign({}, row, { nickname: nick || row.steam_id64 || "—" });
    });
  }

  function aggregateWeaponKills(deaths) {
    var map = {};
    sortByGameTime(deaths).forEach(function (d) {
      var killer = d.killer || QLDashboard.t("matchWorldSuicide");
      var weapon = d.weapon || "—";
      var key = killer + "\0" + weapon;
      if (!map[key]) map[key] = { killer: killer, weapon: weapon, kills: 0 };
      map[key].kills += 1;
    });
    return Object.keys(map)
      .map(function (k) {
        return map[k];
      })
      .sort(function (a, b) {
        return b.kills - a.kills || a.killer.localeCompare(b.killer);
      });
  }

  function renderKillfeed(deaths) {
    var rows = sortByGameTime(deaths);
    if (!rows.length) {
      return (
        '<p class="match-analytics-empty">' +
        QLDashboard.escapeHtml(QLDashboard.t("matchAnalyticsEmpty")) +
        "</p>"
      );
    }
    var html =
      '<div class="match-kill-row match-kill-row-head">' +
      "<span>" +
      QLDashboard.escapeHtml(QLDashboard.t("matchColTime")) +
      "</span><span>" +
      QLDashboard.escapeHtml(QLDashboard.t("matchColKiller")) +
      "</span><span>" +
      QLDashboard.escapeHtml(QLDashboard.t("matchColVictim")) +
      "</span><span>" +
      QLDashboard.escapeHtml(QLDashboard.t("matchColWeapon")) +
      "</span></div>";
    for (var i = rows.length - 1; i >= 0; i--) {
      var d = rows[i];
      html +=
        '<div class="match-kill-row">' +
        '<span class="match-kill-time">' +
        QLDashboard.escapeHtml(formatGameTime(d.game_time_ms)) +
        "</span><span>" +
        QLDashboard.escapeHtml(d.killer || QLDashboard.t("matchWorldSuicide")) +
        "</span><span>" +
        QLDashboard.escapeHtml(d.victim || "—") +
        '</span><span class="match-kill-weapon">' +
        QLDashboard.escapeHtml(d.weapon || "—") +
        "</span></div>";
    }
    return html;
  }

  function renderPickups(pickups) {
    var rows = sortByGameTime(pickups);
    if (!rows.length) {
      return (
        '<p class="match-analytics-empty">' +
        QLDashboard.escapeHtml(QLDashboard.t("matchAnalyticsEmpty")) +
        "</p>"
      );
    }
    var html =
      '<table class="data-table"><thead><tr><th>' +
      QLDashboard.escapeHtml(QLDashboard.t("matchColTime")) +
      "</th><th>" +
      QLDashboard.escapeHtml(QLDashboard.t("matchColPlayer")) +
      "</th><th>" +
      QLDashboard.escapeHtml(QLDashboard.t("matchColItem")) +
      "</th></tr></thead><tbody>";
    for (var i = 0; i < rows.length; i++) {
      var p = rows[i];
      html +=
        "<tr><td>" +
        QLDashboard.escapeHtml(formatGameTime(p.game_time_ms)) +
        "</td><td>" +
        QLDashboard.escapeHtml(p.nickname || "—") +
        "</td><td>" +
        QLDashboard.escapeHtml(p.item || p.text || "—") +
        "</td></tr>";
    }
    html += "</tbody></table>";
    return html;
  }

  function renderAccuracy(rows) {
    if (!rows.length) {
      return (
        '<p class="match-analytics-empty">' +
        QLDashboard.escapeHtml(QLDashboard.t("matchAnalyticsEmpty")) +
        "</p>"
      );
    }
    var sorted = rows.slice().sort(function (a, b) {
      return (
        String(a.nickname || "").localeCompare(String(b.nickname || "")) ||
        String(a.weapon || "").localeCompare(String(b.weapon || ""))
      );
    });
    var html =
      '<table class="data-table"><thead><tr><th>' +
      QLDashboard.escapeHtml(QLDashboard.t("matchColPlayer")) +
      "</th><th>" +
      QLDashboard.escapeHtml(QLDashboard.t("matchColWeapon")) +
      "</th><th>" +
      QLDashboard.escapeHtml(QLDashboard.t("matchColHits")) +
      "</th><th>" +
      QLDashboard.escapeHtml(QLDashboard.t("matchColShots")) +
      "</th><th>" +
      QLDashboard.escapeHtml(QLDashboard.t("matchColAccuracy")) +
      "</th></tr></thead><tbody>";
    for (var i = 0; i < sorted.length; i++) {
      var r = sorted[i];
      var pct =
        r.accuracy_pct != null
          ? Number(r.accuracy_pct).toFixed(1)
          : r.hits != null && r.shots
            ? ((Number(r.hits) / Number(r.shots)) * 100).toFixed(1)
            : "—";
      html +=
        "<tr><td>" +
        QLDashboard.escapeHtml(r.nickname || "—") +
        "</td><td>" +
        QLDashboard.escapeHtml(r.weapon || "—") +
        "</td><td>" +
        (r.hits != null ? r.hits : "—") +
        "</td><td>" +
        (r.shots != null ? r.shots : "—") +
        "</td><td>" +
        pct +
        "</td></tr>";
    }
    html += "</tbody></table>";
    return html;
  }

  function renderWeaponKills(deaths) {
    var rows = aggregateWeaponKills(deaths);
    if (!rows.length) {
      return (
        '<p class="match-analytics-empty">' +
        QLDashboard.escapeHtml(QLDashboard.t("matchAnalyticsEmpty")) +
        "</p>"
      );
    }
    var html =
      '<table class="data-table"><thead><tr><th>' +
      QLDashboard.escapeHtml(QLDashboard.t("matchColPlayer")) +
      "</th><th>" +
      QLDashboard.escapeHtml(QLDashboard.t("matchColWeapon")) +
      "</th><th>" +
      QLDashboard.escapeHtml(QLDashboard.t("matchColKills")) +
      "</th></tr></thead><tbody>";
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      html +=
        "<tr><td>" +
        QLDashboard.escapeHtml(r.killer) +
        "</td><td>" +
        QLDashboard.escapeHtml(r.weapon) +
        "</td><td>" +
        r.kills +
        "</td></tr>";
    }
    html += "</tbody></table>";
    return html;
  }

  function renderAnalytics(archive, livePlayers, debug, scrubMs) {
    var deaths = filterRowsByGameTime(archive.deaths || [], scrubMs);
    var pickups = filterRowsByGameTime(archive.pickups || [], scrubMs);
    var summary = enrichAccuracyNicknames(archive, livePlayers);
    var maxMs = computeTimelineMaxMs(archive, lastLiveData);
    var atEnd = scrubMs == null || (maxMs != null && Number(scrubMs) >= maxMs);
    var accuracy = atEnd
      ? summary
      : accuracyAtScrub(archive.accuracy_timeline, summary, scrubMs);
    accuracy = enrichAccuracyNicknames(
      { accuracy_summary: accuracy, players: archive.players },
      livePlayers,
    );
    var emptyNote =
      !debug && !deaths.length && !pickups.length && !accuracy.length
        ? '<p class="match-analytics-empty">' +
          QLDashboard.escapeHtml(QLDashboard.t("matchAnalyticsEmpty")) +
          "<br />" +
          QLDashboard.escapeHtml(QLDashboard.t("matchAnalyticsHint")) +
          "</p>"
        : "";
    var accuracyNote =
      !debug && deaths.length && !accuracy.length
        ? '<p class="match-analytics-empty">' +
          QLDashboard.escapeHtml(QLDashboard.t("matchAnalyticsAccuracyHint")) +
          "</p>"
        : "";

    var html = "";
    if (debug) {
      html +=
        '<p class="match-debug-banner">' +
        QLDashboard.escapeHtml(QLDashboard.t("matchDebugBanner")) +
        "</p>";
    }
    if (emptyNote && !debug) {
      return html + emptyNote;
    }

    if (accuracyNote) {
      html += accuracyNote;
    }

    html += renderTimelineScrubber(archive, lastLiveData);

    html += '<div class="match-analytics-grid">';
    html +=
      '<div class="match-analytics-panel match-analytics-span-2"><h3>' +
      QLDashboard.escapeHtml(QLDashboard.t("matchSectionKillfeed")) +
      '</h3><div class="match-analytics-scroll">' +
      renderKillfeed(deaths) +
      "</div></div>";
    html +=
      '<div class="match-analytics-panel"><h3>' +
      QLDashboard.escapeHtml(QLDashboard.t("matchSectionPickups")) +
      '</h3><div class="match-analytics-scroll">' +
      renderPickups(pickups) +
      "</div></div>";
    html +=
      '<div class="match-analytics-panel"><h3>' +
      QLDashboard.escapeHtml(QLDashboard.t("matchSectionWeaponKills")) +
      '</h3><div class="match-analytics-scroll">' +
      renderWeaponKills(deaths) +
      "</div></div>";
    html +=
      '<div class="match-analytics-panel match-analytics-span-2"><h3>' +
      QLDashboard.escapeHtml(QLDashboard.t("matchSectionAccuracy")) +
      '</h3><div class="match-analytics-scroll">' +
      renderAccuracy(accuracy) +
      "</div></div>";
    html += "</div>";
    return html;
  }

  function formatReplayDuration(ms) {
    if (ms == null || isNaN(ms)) return "—";
    var sec = Math.max(0, Math.floor(Number(ms) / 1000));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function formatReplayWhen(ms) {
    if (ms == null || ms === "") return "—";
    try {
      return new Date(Number(ms)).toLocaleString();
    } catch (_e) {
      return String(ms);
    }
  }

  function filterReplayRows(rows) {
    if (!rows || !rows.length) return [];
    var hasSegments = false;
    for (var j = 0; j < rows.length; j++) {
      var rid = rows[j].recording_id || "";
      if (rid.indexOf("__") >= 0) {
        hasSegments = true;
        break;
      }
    }
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.is_recording) continue;
      if (r.is_complete === false) continue;
      if (hasSegments && r.is_legacy) continue;
      out.push(r);
    }
    return out;
  }

  function renderReplaySection(rows, matchId) {
    rows = filterReplayRows(rows);
    if (!rows || !rows.length) {
      return (
        '<p class="match-analytics-empty">' +
        QLDashboard.escapeHtml(QLDashboard.t("matchReplaysEmpty")) +
        "</p>"
      );
    }
    var html =
      '<table class="data-table"><thead><tr><th>' +
      QLDashboard.escapeHtml(QLDashboard.t("matchReplayColMap")) +
      "</th><th>" +
      QLDashboard.escapeHtml(QLDashboard.t("matchReplayColDuration")) +
      "</th><th>" +
      QLDashboard.escapeHtml(QLDashboard.t("matchReplayColWhen")) +
      "</th><th>" +
      QLDashboard.escapeHtml(QLDashboard.t("matchReplayColAction")) +
      "</th></tr></thead><tbody>";
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var recId = r.recording_id || r.match_id || "";
      var url = QLDashboard.liveOverlayUrl("map", matchId, {
        replay: "1",
        recording: recId,
      });
      html +=
        "<tr><td>" +
        QLDashboard.escapeHtml(r.map_name || "—") +
        "</td><td>" +
        QLDashboard.escapeHtml(formatReplayDuration(r.duration_ms)) +
        "</td><td>" +
        QLDashboard.escapeHtml(formatReplayWhen(r.started_at)) +
        '</td><td><a class="control-btn" href="' +
        QLDashboard.escapeHtml(url) +
        '" target="_blank" rel="noopener noreferrer">' +
        QLDashboard.escapeHtml(QLDashboard.t("matchOpenReplay")) +
        "</a></td></tr>";
    }
    html += "</tbody></table>";
    return html;
  }

  function mount(root, route) {
    stopPoll();
    stopClock();
    scrubGameTimeMs = null;
    lastLiveData = null;
    lastArchive = null;
    var matchId = route.param;
    if (!matchId) {
      root.innerHTML =
        '<section class="control-section"><p class="control-field-hint">' +
        QLDashboard.escapeHtml(QLDashboard.t("matchSelectHint")) +
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
    loadMatch(matchId);
    startClock();
    pollTimer = setInterval(function () {
      if (activeMatchId) loadMatch(activeMatchId);
    }, 3000);
  }

  function unmount() {
    stopPoll();
    stopClock();
  }

  function renderShell(root, matchId) {
    var urlFull = QLDashboard.liveOverlayUrl("match", matchId);
    var urlMap = QLDashboard.liveOverlayUrl("map", matchId);
    var urlReplay = QLDashboard.liveOverlayUrl("map", matchId, { replay: "1" });

    root.innerHTML =
      '<section class="control-section">' +
      '<p id="match-status" class="control-status">' +
      QLDashboard.escapeHtml(QLDashboard.t("matchLoading")) +
      "</p>" +
      '<header class="match-page-header">' +
      '<h1 id="match-title" class="match-page-title">—</h1>' +
      '<p id="match-meta" class="match-page-meta"></p>' +
      '<p id="match-clock" class="match-page-clock-row"></p>' +
      '<p><span id="match-badge" class="badge"></span></p>' +
      "</header>" +
      '<h2 class="match-section-title">' +
      QLDashboard.escapeHtml(QLDashboard.t("matchSectionPlayers")) +
      "</h2>" +
      '<div id="match-players-wrap"></div>' +
      '<div class="control-actions" style="margin-top:12px">' +
      '<a id="match-btn-full" class="control-btn control-btn-primary" href="' +
      QLDashboard.escapeHtml(urlFull) +
      '" target="_blank" rel="noopener noreferrer">' +
      QLDashboard.escapeHtml(QLDashboard.t("matchOpenFull")) +
      "</a>" +
      '<a id="match-btn-map" class="control-btn" href="' +
      QLDashboard.escapeHtml(urlMap) +
      '" target="_blank" rel="noopener noreferrer">' +
      QLDashboard.escapeHtml(QLDashboard.t("matchOpenMap")) +
      "</a>" +
      '<a id="match-btn-replay" class="control-btn" href="' +
      QLDashboard.escapeHtml(urlReplay) +
      '" target="_blank" rel="noopener noreferrer">' +
      QLDashboard.escapeHtml(QLDashboard.t("matchOpenReplay")) +
      "</a>" +
      "</div></section>" +
      '<section class="control-section" id="match-replays-section">' +
      '<h2 class="match-section-title">' +
      QLDashboard.escapeHtml(QLDashboard.t("matchSectionReplays")) +
      "</h2>" +
      '<div id="match-replays-wrap">' +
      QLDashboard.escapeHtml(QLDashboard.t("matchLoading")) +
      "</div></section>" +
      '<section class="control-section" id="match-analytics-section">' +
      '<div id="match-analytics-wrap"></div>' +
      "</section>";
  }

  async function loadMatch(matchId) {
    var statusEl = document.getElementById("match-status");
    var debug = QLDashboard.debugMode();
    var liveData = null;

    try {
      liveData = await QLDashboard.fetchStatsJson(
        "/api/stream/matches/" + encodeURIComponent(matchId),
      );
      if (String(QLDashboard.settings.defaultMatchId || "") !== String(matchId)) {
        QLDashboard.patchSettings({ defaultMatchId: matchId }, { silent: true });
      }

      var title = document.getElementById("match-title");
      var meta = document.getElementById("match-meta");
      var badge = document.getElementById("match-badge");
      if (title) title.textContent = liveData.score_summary || liveData.match_id;
      if (meta) {
        meta.textContent = [liveData.map_name, liveData.gametype, liveData.server_name]
          .filter(Boolean)
          .join(" · ");
      }
      if (badge) {
        badge.className = "badge " + QLDashboard.statusBadgeClass(liveData);
        badge.textContent = QLDashboard.matchPhaseLabel(liveData);
      }
      lastLiveData = liveData;
      updateMatchHeader(liveData);
      if (statusEl) {
        statusEl.textContent = "";
        statusEl.classList.remove("error");
      }

      var wrap = document.getElementById("match-players-wrap");
      if (wrap && Array.isArray(liveData.players)) {
        var html =
          '<table class="data-table"><thead><tr><th>Player</th><th>Score</th><th>K</th><th>D</th></tr></thead><tbody>';
        var sorted = liveData.players.slice().sort(function (a, b) {
          return (b.score || 0) - (a.score || 0);
        });
        for (var i = 0; i < sorted.length; i++) {
          var p = sorted[i];
          html +=
            "<tr><td>" +
            QLDashboard.escapeHtml(p.nickname || p.steam_id64) +
            "</td><td>" +
            (p.score || 0) +
            "</td><td>" +
            (p.kills || 0) +
            "</td><td>" +
            (p.deaths || 0) +
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

    var archive = null;
    if (!debug) {
      archive = await QLDashboard.fetchArchiveSummary(matchId);
    }
    if (debug) {
      archive = mockArchiveSummary(matchId);
    } else if (!archive) {
      archive = { deaths: [], pickups: [], accuracy_summary: [], accuracy_timeline: [], players: [] };
    }
    lastArchive = archive;
    if (scrubGameTimeMs == null) {
      scrubGameTimeMs = computeTimelineMaxMs(archive, liveData);
    }

    var analyticsWrap = document.getElementById("match-analytics-wrap");
    if (analyticsWrap) {
      analyticsWrap.innerHTML = renderAnalytics(
        archive,
        liveData && liveData.players,
        debug,
        scrubGameTimeMs,
      );
      bindTimelineScrubber(archive, liveData);
    }

    var replaysWrap = document.getElementById("match-replays-wrap");
    var replayBtn = document.getElementById("match-btn-replay");
    if (!debug && replaysWrap) {
      try {
        var replays = await QLDashboard.fetchStatsJson(
          "/api/replays?match_id=" + encodeURIComponent(matchId),
        );
        replays = filterReplayRows(replays);
        replaysWrap.innerHTML = renderReplaySection(replays, matchId);
        if (replayBtn && replays.length) {
          var latest = replays[0];
          replayBtn.href = QLDashboard.liveOverlayUrl("map", matchId, {
            replay: "1",
            recording: latest.recording_id || latest.match_id,
          });
        } else if (replayBtn) {
          replayBtn.href = QLDashboard.liveOverlayUrl("map", matchId, { replay: "1" });
        }
      } catch (_replayErr) {
        replaysWrap.innerHTML =
          '<p class="match-analytics-empty">' +
          QLDashboard.escapeHtml(QLDashboard.t("matchReplaysEmpty")) +
          "</p>";
      }
    } else if (replaysWrap && debug) {
      replaysWrap.innerHTML = renderReplaySection([], matchId);
    }
  }

  QLDashboard.registerView("match", {
    mount: mount,
    unmount: unmount,
    onLangChanged: function () {
      var route = QLDashboard.parseRoute();
      var root = document.getElementById("app-main");
      if (root && route.view === "match") mount(root, route);
    },
  });
})();
