(function () {
  "use strict";

  var A = function () {
    return QLDashboardAnalytics;
  };

  var pollTimer = null;
  var activeRecordingId = null;
  var lastArchive = null;
  var scrubGameTimeMs = null;
  // Timeline sync (replay scrubber <-> match analytics scrubber).
  var syncingFromReplay = false;
  var analyticsDragging = false;
  var panelSyncTimer = 0;
  // Wall-clock epoch (ms) of game-clock 0. Derived from archive combat events,
  // each of which carries both `ts` (wall) and `game_time_ms`. Lets us convert
  // the replay wall cursor to/from match game time accurately (slope 1; the
  // replay starts a few seconds before game 0 because recording begins at the
  // pre-match countdown).
  var matchStartWall = null;
  // Sync stays dormant until the user plays/scrubs, so opening a result still
  // shows the full match analytics instead of snapping to the replay's start.
  var syncEngaged = false;
  // One-shot correction of an overshooting timeline_max_ms in already-saved
  // snapshots (older stats-hub left the warmup/countdown lead-in in the match
  // clock). The replay stops at match end, so its game coverage is the true
  // match length.
  var timelineCapped = false;

  function serverFilter() {
    return QLDashboard.qsParam("server") || "";
  }

  async function confirmDeleteResult(recordingId) {
    if (!recordingId) return;
    if (!QLDashboard.hasStatsApiToken()) {
      window.alert(QLDashboard.t("resultsDeleteNeedToken"));
      return;
    }
    if (!window.confirm(QLDashboard.t("resultsDeleteConfirm"))) return;
    try {
      await QLDashboard.deleteStatsResult(recordingId);
      var route = QLDashboard.parseRoute();
      var root = document.getElementById("app-main");
      if (root && route.view === "results") {
        if (route.param) {
          QLDashboard.navigate("#/results");
        } else {
          mountList(root);
        }
      }
    } catch (err) {
      window.alert(String(err.message || err));
    }
  }

  function bindDeleteButtons(scope) {
    if (!scope || !scope.querySelectorAll) return;
    var nodes = scope.querySelectorAll("[data-ql-delete-result]");
    for (var i = 0; i < nodes.length; i++) {
      (function (btn) {
        if (btn.dataset.qlBound) return;
        btn.dataset.qlBound = "1";
        btn.addEventListener("click", function (ev) {
          ev.preventDefault();
          confirmDeleteResult(btn.getAttribute("data-ql-delete-result"));
        });
      })(nodes[i]);
    }
  }

  function bindReplayWindowButtons(scope) {
    if (!scope || !scope.querySelectorAll) return;
    var nodes = scope.querySelectorAll("[data-ql-replay-window]");
    for (var i = 0; i < nodes.length; i++) {
      (function (btn) {
        if (btn.dataset.qlBound) return;
        btn.dataset.qlBound = "1";
        btn.addEventListener("click", function (ev) {
          ev.preventDefault();
          var url = btn.getAttribute("data-ql-replay-window");
          if (!url) return;
          window.open(
            url,
            "ql-replay",
            "noopener,width=1280,height=820,menubar=no,toolbar=no,location=no",
          );
        });
      })(nodes[i]);
    }
  }

  // Mirror stats-hub stream_player_dict: duel/ffa often report SCORE without
  // KILLS, so use frags for both to keep K and net meaningful.
  function scoreboardStats(p, duelLike) {
    var kills = Number(p.kills || 0);
    var score = Number(p.score || 0);
    var deaths = Number(p.deaths || 0);
    if (duelLike) {
      kills = Math.max(kills, score);
      score = Math.max(score, kills);
    }
    return { score: score, kills: kills, deaths: deaths, net: kills - deaths };
  }

  function renderScoreboard(players, gametype) {
    if (!Array.isArray(players) || !players.length) return "";
    var gt = String(gametype || "").trim().toLowerCase();
    var duelLike = gt === "duel" || gt === "ffa" || gt === "deathmatch";
    var rows = players.slice().sort(function (a, b) {
      var sa = scoreboardStats(a, duelLike).score;
      var sb = scoreboardStats(b, duelLike).score;
      if (sb !== sa) return sb - sa;
      return (
        scoreboardStats(b, duelLike).kills - scoreboardStats(a, duelLike).kills
      );
    });
    var A0 = A();
    var html =
      '<section class="control-section results-scoreboard-section"><h3>' +
      QLDashboard.escapeHtml(QLDashboard.t("resultsScoreboardTitle")) +
      "</h3>" +
      '<table class="data-table results-scoreboard-table"><thead><tr><th>' +
      QLDashboard.escapeHtml(QLDashboard.t("sbColPlayer")) +
      '</th><th class="sb-num">' +
      QLDashboard.escapeHtml(QLDashboard.t("sbColScore")) +
      '</th><th class="sb-num">' +
      QLDashboard.escapeHtml(QLDashboard.t("sbColKills")) +
      '</th><th class="sb-num">' +
      QLDashboard.escapeHtml(QLDashboard.t("sbColDeaths")) +
      '</th><th class="sb-num">' +
      QLDashboard.escapeHtml(QLDashboard.t("sbColNet")) +
      "</th></tr></thead><tbody>";
    for (var i = 0; i < rows.length; i++) {
      var p = rows[i];
      var st = scoreboardStats(p, duelLike);
      var name = A0.displayNickname
        ? A0.displayNickname(p)
        : p.nickname || p.steam_id64 || "—";
      html +=
        "<tr><td>" +
        QLDashboard.escapeHtml(name) +
        '</td><td class="sb-num">' +
        QLDashboard.escapeHtml(String(st.score)) +
        '</td><td class="sb-num">' +
        st.kills +
        '</td><td class="sb-num">' +
        st.deaths +
        '</td><td class="sb-num">' +
        (st.net > 0 ? "+" + st.net : String(st.net)) +
        "</td></tr>";
    }
    html += "</tbody></table></section>";
    return html;
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    activeRecordingId = null;
  }

  function mountResultsMapWidget(matchId, recordingId) {
    if (typeof MapWidget === "undefined") return;
    var host = document.getElementById("results-map-widget");
    if (!host) return;
    var base = QLDashboard.settings.statsHubBase;
    if (!base || !matchId || !recordingId) return;
    try {
      var mountOpts = {
        base: String(base).replace(/\/+$/, ""),
        match: matchId,
        recording: recordingId,
        replay: "1",
        embedded: true,
      };
      // Drop the pre-match countdown lead-in so the replay starts at the fight
      // (cursor 0 == game 0) and its clock matches the match timeline 1:1.
      if (matchStartWall != null && isFinite(matchStartWall)) {
        mountOpts.replay_trim_start_ms = Math.round(matchStartWall);
      }
      MapWidget.mount(host, mountOpts);
      if (window.OverlayApp && typeof OverlayApp.setReplayCursorListener === "function") {
        OverlayApp.setReplayCursorListener(onReplayCursor);
      }
    } catch (_e) {
      /* map widget is optional enrichment; ignore mount failures */
    }
  }

  function destroyResultsMapWidget() {
    if (panelSyncTimer) {
      clearTimeout(panelSyncTimer);
      panelSyncTimer = 0;
    }
    if (window.OverlayApp && typeof OverlayApp.setReplayCursorListener === "function") {
      OverlayApp.setReplayCursorListener(null);
    }
    if (typeof MapWidget === "undefined") return;
    try {
      MapWidget.destroy();
    } catch (_e) {
      /* ignore */
    }
  }

  function gameMaxMs() {
    return A().computeTimelineMaxMs(lastArchive, null) || 0;
  }

  function replayInfo() {
    if (window.OverlayApp && typeof OverlayApp.replayProgress === "function") {
      return OverlayApp.replayProgress();
    }
    return null;
  }

  function parseTsMs(ts) {
    if (!ts) return null;
    var t = Date.parse(ts);
    return isNaN(t) ? null : t;
  }

  // Median of (wall ts - game_time_ms) over combat events = wall epoch of game 0.
  function computeMatchStartWall(archive) {
    if (!archive) return null;
    var diffs = [];
    // Deaths and accuracy carry exact game clocks; pickups get warmup-normalized
    // server-side (unreliable as a wall/game anchor), so exclude them here.
    ["deaths", "accuracy_timeline"].forEach(function (key) {
      var rows = archive[key] || [];
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (!row || row.game_time_ms == null) continue;
        var w = parseTsMs(row.ts);
        if (w == null) continue;
        diffs.push(w - Number(row.game_time_ms));
      }
    });
    if (!diffs.length) return null;
    diffs.sort(function (a, b) {
      return a - b;
    });
    return diffs[Math.floor(diffs.length / 2)];
  }

  // Replay wall cursor -> match game time. Accurate via matchStartWall + replay
  // startMs (slope 1); proportional fallback only when the archive has no combat
  // events to anchor the wall/game offset.
  function cursorToGameMs(info) {
    if (!info) return null;
    var gmax = gameMaxMs();
    if (matchStartWall != null && info.startMs != null) {
      var g = info.startMs + info.cursorMs - matchStartWall;
      if (g < 0) g = 0;
      if (gmax && g > gmax) g = gmax;
      return Math.round(g);
    }
    if (!info.durationMs || !gmax) return null;
    return Math.round((info.cursorMs / info.durationMs) * gmax);
  }

  function gameMsToCursor(gameMs, info) {
    if (!info) return null;
    if (matchStartWall != null && info.startMs != null) {
      var c = matchStartWall + gameMs - info.startMs;
      if (c < 0) c = 0;
      if (info.durationMs && c > info.durationMs) c = info.durationMs;
      return Math.round(c);
    }
    var gmax = gameMaxMs();
    if (!info.durationMs || !gmax) return null;
    return Math.round((gameMs / gmax) * info.durationMs);
  }

  function schedulePanelSync() {
    if (panelSyncTimer) return;
    panelSyncTimer = setTimeout(function () {
      panelSyncTimer = 0;
      refreshDetailAnalyticsPanels();
    }, 180);
  }

  // Correct a saved snapshot whose timeline_max_ms overshoots the real match
  // (warmup/countdown lead-in left in the match clock by older stats-hub). The
  // replay's game coverage = match length; cap the analytics timeline to it.
  function maybeCorrectTimelineMax(info) {
    if (timelineCapped) return;
    if (!lastArchive || matchStartWall == null) return;
    if (!info || info.startMs == null || !info.durationMs) return;
    timelineCapped = true;
    var coverage = Math.round(info.startMs + info.durationMs - matchStartWall);
    var cur = gameMaxMs();
    if (coverage > 1000 && cur && cur > coverage + 3000) {
      lastArchive.timeline_max_ms = coverage;
      if (scrubGameTimeMs == null || scrubGameTimeMs > coverage) {
        scrubGameTimeMs = coverage;
      }
      refreshDetailAnalytics();
    }
  }

  // Replay -> analytics: move the match timeline thumb live, throttle the heavier
  // panel re-render so 60fps playback stays smooth. The replay bar keeps its own
  // wall-clock readout (full recording incl. the ~10s countdown lead-in at the
  // start); the match timeline shows game time. They stay positionally synced,
  // but each reads its own honest clock so the countdown stays at the start.
  function onReplayCursor(info) {
    if (!info) return;
    maybeCorrectTimelineMax(info);
    if (analyticsDragging) return;
    if (!syncEngaged) {
      // Ignore the replay's idle start position; engage only once the user
      // actually plays or scrubs it.
      if (!(info.playing || info.cursorMs > 0)) return;
      syncEngaged = true;
    }
    var gameMs = cursorToGameMs(info);
    if (gameMs == null) return;
    syncingFromReplay = true;
    scrubGameTimeMs = gameMs;
    var scrub = document.getElementById("match-timeline-scrub");
    if (scrub) scrub.value = String(gameMs);
    var label = document.getElementById("match-timeline-label");
    if (label) label.textContent = A().formatGameTime(gameMs);
    syncingFromReplay = false;
    schedulePanelSync();
  }

  // Analytics -> replay: seek the embedded replay to the scrubbed game time.
  function seekReplayToGameMs(gameMs) {
    if (!window.OverlayApp || typeof OverlayApp.seekReplayMs !== "function") return;
    var info = replayInfo();
    var cursor = gameMsToCursor(gameMs, info);
    if (cursor == null) return;
    OverlayApp.seekReplayMs(cursor);
  }

  function bindTimelineScrubber() {
    var scrub = document.getElementById("match-timeline-scrub");
    if (!scrub || scrub.dataset.qlBound) return;
    scrub.dataset.qlBound = "1";
    var maxMs = A().computeTimelineMaxMs(lastArchive, null);
    scrub.addEventListener("pointerdown", function () {
      analyticsDragging = true;
    });
    var endDrag = function () {
      analyticsDragging = false;
    };
    scrub.addEventListener("pointerup", endDrag);
    scrub.addEventListener("pointercancel", endDrag);
    scrub.addEventListener("change", endDrag);
    scrub.addEventListener("input", function () {
      scrubGameTimeMs = Number(scrub.value);
      var label = document.getElementById("match-timeline-label");
      if (label) label.textContent = A().formatGameTime(scrubGameTimeMs);
      refreshDetailAnalyticsPanels();
      if (!syncingFromReplay) {
        syncEngaged = true;
        seekReplayToGameMs(scrubGameTimeMs);
      }
    });
    var liveBtn = document.getElementById("match-timeline-live");
    if (liveBtn && !liveBtn.dataset.qlBound) {
      liveBtn.dataset.qlBound = "1";
      liveBtn.addEventListener("click", function () {
        maxMs = A().computeTimelineMaxMs(lastArchive, null);
        scrubGameTimeMs = maxMs;
        scrub.value = String(maxMs);
        var label = document.getElementById("match-timeline-label");
        if (label) label.textContent = A().formatGameTime(maxMs);
        refreshDetailAnalyticsPanels();
        syncEngaged = true;
        seekReplayToGameMs(maxMs);
      });
    }
  }

  function refreshDetailAnalyticsPanels() {
    var panels = document.getElementById("match-analytics-panels");
    if (!panels || !lastArchive) return;
    panels.innerHTML = A().renderAnalyticsPanels(lastArchive, lastArchive.players, {
      scrubMs: scrubGameTimeMs,
      liveData: null,
    });
  }

  function refreshDetailAnalytics() {
    var wrap = document.getElementById("results-detail-analytics");
    if (!wrap || !lastArchive) return;
    wrap.innerHTML = A().renderAnalytics(lastArchive, lastArchive.players, {
      scrubMs: scrubGameTimeMs,
      liveData: null,
    });
    bindTimelineScrubber();
  }

  function renderResultsTable(rows) {
    if (!rows.length) {
      return (
        '<p class="match-analytics-empty">' +
        QLDashboard.escapeHtml(QLDashboard.t("resultsEmpty")) +
        "</p>"
      );
    }
    var html =
      '<table class="data-table"><thead><tr><th>' +
      QLDashboard.escapeHtml(QLDashboard.t("colServer")) +
      "</th><th>" +
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
      var serverUrl = "#/server/" + encodeURIComponent(r.session_id || r.match_id || "");
      var replayUrl = "";
      if (rid && r.replay_available !== false) {
        replayUrl = QLDashboard.liveOverlayUrl("map", r.session_id || r.match_id || "", {
          replay: "1",
          recording: rid,
        });
      }
      html +=
        "<tr><td><a href=\"" +
        QLDashboard.escapeHtml(serverUrl) +
        '">' +
        QLDashboard.escapeHtml(r.session_id || r.match_id || "—") +
        "</a></td><td>" +
        QLDashboard.escapeHtml([r.map_name, r.gametype].filter(Boolean).join(" · ") || "—") +
        "</td><td>" +
        QLDashboard.escapeHtml(A().formatWhen(r.ended_at || r.started_at)) +
        "</td><td>" +
        QLDashboard.escapeHtml(A().formatReplayDuration(r.duration_ms)) +
        '</td><td><a class="control-btn control-btn-sm" href="' +
        QLDashboard.escapeHtml(detailUrl) +
        '">' +
        QLDashboard.escapeHtml(QLDashboard.t("resultsOpenDetail")) +
        "</a>" +
        (replayUrl
          ? ' <a class="control-btn control-btn-sm" href="' +
            QLDashboard.escapeHtml(replayUrl) +
            '" target="_blank" rel="noopener noreferrer">' +
            QLDashboard.escapeHtml(QLDashboard.t("matchOpenReplay")) +
            "</a>"
          : "") +
        (QLDashboard.hasStatsApiToken() && rid
          ? ' <button type="button" class="control-btn control-btn-sm control-btn-danger" data-ql-delete-result="' +
            QLDashboard.escapeHtml(rid) +
            '">' +
            QLDashboard.escapeHtml(QLDashboard.t("resultsDelete")) +
            "</button>"
          : "") +
        "</td></tr>";
    }
    html += "</tbody></table>";
    return html;
  }

  async function loadResultsList(root) {
    var statusEl = document.getElementById("results-status");
    var bodyEl = document.getElementById("results-list-wrap");
    if (!bodyEl) return;
    var filter = serverFilter();
    if (statusEl) statusEl.textContent = QLDashboard.t("resultsLoading");
    try {
      var path = "/api/stream/results?limit=100";
      if (filter) path += "&server=" + encodeURIComponent(filter);
      var rows = await QLDashboard.fetchStatsJson(path);
      if (!Array.isArray(rows)) rows = [];
      bodyEl.innerHTML = renderResultsTable(rows);
      bindDeleteButtons(bodyEl);
      if (statusEl) {
        statusEl.textContent = filter
          ? QLDashboard.t("resultsCountFiltered", { server: filter, n: rows.length })
          : QLDashboard.t("resultsCount", { n: rows.length });
        statusEl.classList.remove("error");
      }
    } catch (err) {
      bodyEl.innerHTML = "";
      if (statusEl) {
        statusEl.textContent = QLDashboard.t("resultsLoadError") + ": " + (err.message || err);
        statusEl.classList.add("error");
      }
    }
  }

  function mountList(root) {
    stopPoll();
    destroyResultsMapWidget();
    var filter = serverFilter();
    var filterNote = filter
      ? '<p class="control-field-hint">' +
        QLDashboard.escapeHtml(QLDashboard.t("resultsFilterServer", { server: filter })) +
        ' <a href="#/results">' +
        QLDashboard.escapeHtml(QLDashboard.t("resultsClearFilter")) +
        "</a></p>"
      : "";

    root.innerHTML =
      '<section class="control-section">' +
      "<h2>" +
      QLDashboard.escapeHtml(QLDashboard.t("resultsTitle")) +
      "</h2>" +
      filterNote +
      '<p id="results-status" class="control-status">' +
      QLDashboard.escapeHtml(QLDashboard.t("resultsLoading")) +
      "</p>" +
      '<div id="results-list-wrap"></div>' +
      "</section>";

    loadResultsList(root);
    pollTimer = setInterval(function () {
      loadResultsList(root);
    }, 15000);
  }

  async function loadResultDetail(root, recordingId) {
    var statusEl = document.getElementById("results-detail-status");
    var metaEl = document.getElementById("results-detail-meta");
    var actionsEl = document.getElementById("results-detail-actions");
    var analyticsEl = document.getElementById("results-detail-analytics");
    try {
      var archive = await QLDashboard.fetchStatsJson(
        "/api/stream/results/" + encodeURIComponent(recordingId),
      );
      lastArchive = A().normalizeArchivePickupTimes(archive);
      matchStartWall = computeMatchStartWall(lastArchive);
      syncEngaged = false;
      timelineCapped = false;
      scrubGameTimeMs = A().computeTimelineMaxMs(archive, null);
      var matchId = archive.session_id || archive.match_id || "";
      if (statusEl) {
        statusEl.textContent = "";
        statusEl.classList.remove("error");
      }
      if (metaEl) {
        metaEl.textContent = [
          matchId,
          archive.map_name,
          archive.gametype,
          A().formatWhen(archive.ended_at || archive.started_at),
        ]
          .filter(Boolean)
          .join(" · ");
      }
      if (actionsEl) {
        var replayUrl = "";
        if (archive.replay_available !== false && recordingId) {
          replayUrl = QLDashboard.liveOverlayUrl("map", matchId, {
            replay: "1",
            recording: recordingId,
          });
        }
        // Server / All results links are dropped here: both are already reachable
        // from the top navigation. Replay opens in a separate window.
        actionsEl.innerHTML =
          (replayUrl
            ? '<button type="button" class="control-btn control-btn-primary" data-ql-replay-window="' +
              QLDashboard.escapeHtml(replayUrl) +
              '">' +
              QLDashboard.escapeHtml(QLDashboard.t("resultsReplayWindow")) +
              "</button> "
            : "") +
          (QLDashboard.hasStatsApiToken() && recordingId
            ? '<button type="button" class="control-btn control-btn-danger" data-ql-delete-result="' +
              QLDashboard.escapeHtml(recordingId) +
              '">' +
              QLDashboard.escapeHtml(QLDashboard.t("resultsDelete")) +
              "</button>"
            : "");
        bindDeleteButtons(actionsEl);
        bindReplayWindowButtons(actionsEl);
      }
      var scoreboardEl = document.getElementById("results-scoreboard");
      if (scoreboardEl) {
        scoreboardEl.innerHTML = renderScoreboard(
          archive.players || [],
          archive.gametype,
        );
      }
      if (analyticsEl) {
        analyticsEl.innerHTML = A().renderAnalytics(archive, archive.players, {
          scrubMs: scrubGameTimeMs,
          liveData: null,
        });
        bindTimelineScrubber();
      }
      if (archive.replay_available !== false && recordingId && matchId) {
        mountResultsMapWidget(matchId, recordingId);
      }
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = QLDashboard.t("resultsNotFound");
        statusEl.classList.add("error");
      }
      destroyResultsMapWidget();
      if (analyticsEl) analyticsEl.innerHTML = "";
      if (actionsEl) actionsEl.innerHTML = "";
      if (metaEl) metaEl.textContent = "";
      var sbEl = document.getElementById("results-scoreboard");
      if (sbEl) sbEl.innerHTML = "";
    }
  }

  function mountDetail(root, recordingId) {
    stopPoll();
    destroyResultsMapWidget();
    activeRecordingId = recordingId;
    lastArchive = null;
    scrubGameTimeMs = null;
    matchStartWall = null;
    syncEngaged = false;
    timelineCapped = false;

    root.innerHTML =
      '<section class="control-section">' +
      "<h2>" +
      QLDashboard.escapeHtml(QLDashboard.t("resultsDetailTitle")) +
      "</h2>" +
      '<p id="results-detail-status" class="control-status">' +
      QLDashboard.escapeHtml(QLDashboard.t("resultsLoading")) +
      "</p>" +
      '<p id="results-detail-meta" class="match-page-meta"></p>' +
      '<div id="results-detail-actions" class="control-actions" style="margin:12px 0"></div>' +
      '<div id="results-scoreboard"></div>' +
      '<div id="results-map-widget" class="match-map-widget"></div>' +
      '<div id="results-detail-analytics"></div>' +
      "</section>";

    loadResultDetail(root, recordingId);
  }

  function mount(root, route) {
    if (!QLDashboard.settings.statsHubBase) {
      root.innerHTML =
        '<section class="control-section"><p class="control-status error">' +
        QLDashboard.escapeHtml(QLDashboard.t("configureFirst")) +
        "</p></section>";
      return;
    }
    if (route.param) {
      mountDetail(root, route.param);
      return;
    }
    mountList(root);
  }

  function unmount() {
    destroyResultsMapWidget();
    stopPoll();
  }

  QLDashboard.registerView("results", {
    mount: mount,
    unmount: unmount,
    onLangChanged: function () {
      var route = QLDashboard.parseRoute();
      var root = document.getElementById("app-main");
      if (root && route.view === "results") mount(root, route);
    },
  });
})();
