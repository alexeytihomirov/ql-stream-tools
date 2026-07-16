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
  // Wall epoch of game-clock 0 from lifecycle match_start marker.
  var matchStartWall = null;
  var syncEngaged = false;
  var replayScrubWasPlaying = false;
  var seekReplayTimer = 0;
  var scrubPanelSyncTimer = 0;
  var checkpointFetchTimer = 0;
  var checkpointFetchSeq = 0;
  var checkpointPayload = null;
  var checkpointStatus = "idle";
  var checkpointError = "";
  var checkpointReplayAvailable = false;
  var selectedRecordingIds = {};

  function stopCheckpointFetch() {
    if (checkpointFetchTimer) {
      clearTimeout(checkpointFetchTimer);
      checkpointFetchTimer = 0;
    }
  }

  function scheduleCheckpointFetch(recordingId, tMs) {
    if (!checkpointReplayAvailable || !recordingId || tMs == null || isNaN(tMs)) return;
    stopCheckpointFetch();
    checkpointFetchTimer = setTimeout(function () {
      checkpointFetchTimer = 0;
      fetchCheckpoint(recordingId, Math.max(0, Math.round(Number(tMs))));
    }, 200);
  }

  function flushCheckpointPanelSync() {
    refreshCheckpointPanel(scrubGameTimeMs, false);
    scheduleCheckpointFetch(activeRecordingId, scrubGameTimeMs);
  }

  async function fetchCheckpoint(recordingId, tMs) {
    if (!recordingId || tMs == null) return;
    var seq = ++checkpointFetchSeq;
    var hadPayload = checkpointStatus === "ready" && checkpointPayload;
    var payloadT =
      checkpointPayload &&
      checkpointPayload.checkpoint &&
      checkpointPayload.checkpoint.t_ms != null
        ? Number(checkpointPayload.checkpoint.t_ms)
        : null;
    var scrubBackward = payloadT != null && Number(tMs) < payloadT - 500;
    if (!hadPayload || scrubBackward) {
      checkpointStatus = "loading";
      checkpointError = "";
      refreshCheckpointPanel(scrubGameTimeMs, !hadPayload);
    } else {
      refreshCheckpointPanel(scrubGameTimeMs, false);
    }
    try {
      var data = await QLDashboard.fetchStatsJson(
        "/api/replays/" +
          encodeURIComponent(recordingId) +
          "/checkpoint?t_ms=" +
          encodeURIComponent(String(tMs)),
      );
      if (seq !== checkpointFetchSeq) return;
      checkpointPayload = data;
      checkpointStatus = "ready";
      checkpointError = "";
    } catch (err) {
      if (seq !== checkpointFetchSeq) return;
      checkpointPayload = null;
      checkpointStatus = "error";
      checkpointError = String((err && err.message) || err);
    }
    if (seq !== checkpointFetchSeq) return;
    refreshCheckpointPanel(scrubGameTimeMs, false);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return Promise.reject(new Error("clipboard unavailable"));
  }

  function refreshCheckpointPanel(tMs, forceMount) {
    var host = document.getElementById("restore-checkpoint-host");
    if (!host || typeof QLRestoreEditor === "undefined") return;
    var scrubT = tMs != null ? tMs : scrubGameTimeMs;
    var opts = {
      status: checkpointStatus,
      payload: checkpointPayload,
      error: checkpointError,
      tMs: scrubT,
      archive: lastArchive,
      refreshPayloadItems: checkpointStatus === "ready" && !!checkpointPayload,
      onPayload: function (payload) {
        checkpointPayload = payload;
        checkpointStatus = "ready";
        checkpointError = "";
      },
    };
    if (host.querySelector(".ql-restore-shell") || host.querySelector(".ql-restore-editor-body")) {
      QLRestoreEditor.updateScrub(host, opts);
      if (typeof QLRestoreEditor.bindRestoreActions === "function") {
        QLRestoreEditor.bindRestoreActions(host);
      }
      return;
    }
    QLRestoreEditor.mount(host, opts);
  }

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

  async function downloadReplay(recordingId) {
    if (!recordingId) return;
    try {
      var data = await QLDashboard.fetchStatsJson(
        "/api/replays/" + encodeURIComponent(recordingId) + "?limit=10000",
      );
      QLDashboard.downloadJson(recordingId + ".json", data);
    } catch (err) {
      window.alert(String((err && err.message) || err));
    }
  }

  function bindDownloadReplayButtons(scope) {
    if (!scope || !scope.querySelectorAll) return;
    var nodes = scope.querySelectorAll("[data-ql-download-replay]");
    for (var i = 0; i < nodes.length; i++) {
      (function (btn) {
        if (btn.dataset.qlBound) return;
        btn.dataset.qlBound = "1";
        btn.addEventListener("click", function (ev) {
          ev.preventDefault();
          downloadReplay(btn.getAttribute("data-ql-download-replay"));
        });
      })(nodes[i]);
    }
  }

  function updateDownloadSelectedButton() {
    var btn = document.getElementById("results-download-selected");
    if (!btn) return;
    var n = Object.keys(selectedRecordingIds).length;
    btn.disabled = n === 0;
    btn.textContent =
      n > 0
        ? QLDashboard.t("resultsDownloadSelectedCount", { n: n })
        : QLDashboard.t("resultsDownloadSelected");
  }

  function bindResultsSelectionCheckboxes(scope) {
    if (!scope || !scope.querySelectorAll) return;
    var boxes = scope.querySelectorAll("[data-ql-select-recording]");
    for (var i = 0; i < boxes.length; i++) {
      (function (cb) {
        if (cb.dataset.qlBound) return;
        cb.dataset.qlBound = "1";
        cb.addEventListener("change", function () {
          var id = cb.getAttribute("data-ql-select-recording");
          if (cb.checked) selectedRecordingIds[id] = true;
          else delete selectedRecordingIds[id];
          updateDownloadSelectedButton();
        });
      })(boxes[i]);
    }
    var selectAll = document.getElementById("results-select-all");
    if (selectAll && !selectAll.dataset.qlBound) {
      selectAll.dataset.qlBound = "1";
      selectAll.addEventListener("change", function () {
        var checked = selectAll.checked;
        var allBoxes = document.querySelectorAll("[data-ql-select-recording]");
        for (var j = 0; j < allBoxes.length; j++) {
          allBoxes[j].checked = checked;
          var id = allBoxes[j].getAttribute("data-ql-select-recording");
          if (checked) selectedRecordingIds[id] = true;
          else delete selectedRecordingIds[id];
        }
        updateDownloadSelectedButton();
      });
    }
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  async function downloadSelectedReplays() {
    var ids = Object.keys(selectedRecordingIds);
    for (var i = 0; i < ids.length; i++) {
      await downloadReplay(ids[i]);
      if (i < ids.length - 1) await delay(400);
    }
  }

  function refreshScoreDisplay() {
    if (!lastArchive) return;
    var scrubMs = scrubGameTimeMs;
    var view = A().archiveForScore(lastArchive, scrubMs);
    var matchupEl = document.getElementById("results-matchup");
    if (matchupEl) matchupEl.innerHTML = A().renderMatchupBanner(view, scrubMs);
    var scoreboardEl = document.getElementById("results-scoreboard");
    if (scoreboardEl) scoreboardEl.innerHTML = A().renderScoreboard(view, scrubMs);
  }

  function formatMatchupLabel(row) {
    if (!row || typeof row !== "object") return "—";
    var resolved = A().resolveFinalPlayers({
      players: row.players || [],
      deaths: row.deaths || [],
    });
    if (!resolved.length) return "—";
    var nickBySteam = A().buildNicknameBySteam(row, null);
    var gt = String(row.gametype || "").trim().toLowerCase();
    var duelLike =
      gt === "duel" || gt === "ffa" || gt === "deathmatch" || resolved.length === 2;
    if (duelLike && resolved.length === 2) {
      resolved.sort(function (a, b) {
        return A().scoreboardStats(b, true).score - A().scoreboardStats(a, true).score;
      });
    }
    var names = resolved
      .map(function (p) {
        return A().displayNickname(p, nickBySteam);
      })
      .filter(function (n) {
        return n && n !== "—";
      });
    if (!names.length) return "—";
    if (names.length === 2) {
      return names[0] + " " + QLDashboard.t("resultsVs") + " " + names[1];
    }
    return names.join(", ");
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
      // Drop the pre-match countdown lead-in (lifecycle countdown_start).
      var trimWall = A().countdownStartWallMs(lastArchive);
      if (trimWall == null) trimWall = matchStartWall;
      if (trimWall != null && isFinite(trimWall)) {
        mountOpts.replay_trim_start_ms = Math.round(trimWall);
      }
      // The map widget's own replay engine only has the raw replay events to
      // derive a game-start anchor from (a same-order-of-magnitude estimate,
      // computeReplayGameStartWall in overlay.js) - archive.markers' match_start
      // row (matchStartWall here) is the precise one already validated by the
      // restore-checkpoint panel, so hand it over instead of letting the map
      // widget's on-map timer re-derive (and potentially disagree with) it.
      if (matchStartWall != null && isFinite(matchStartWall)) {
        mountOpts.replay_match_start_wall_ms = Math.round(matchStartWall);
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
    stopCheckpointFetch();
    if (panelSyncTimer) {
      clearTimeout(panelSyncTimer);
      panelSyncTimer = 0;
    }
    if (seekReplayTimer) {
      clearTimeout(seekReplayTimer);
      seekReplayTimer = 0;
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

  // Wall epoch of game-clock 0 from lifecycle match_start marker.
  function computeMatchStartWall(archive) {
    return A().computeCombatClockAnchor(archive);
  }

  // Replay wall cursor -> dashboard timeline ms (negative = pre-match countdown).
  function cursorToTimelineMs(info) {
    if (!info) return null;
    var minMs = A().computeTimelineMinMs(lastArchive);
    var gmax = gameMaxMs();
    if (minMs < 0 && info.startMs != null) {
      var t = minMs + Number(info.cursorMs || 0);
      if (gmax && t > gmax) t = gmax;
      return Math.round(t);
    }
    if (matchStartWall != null && info.startMs != null) {
      var g = info.startMs + info.cursorMs - matchStartWall;
      if (g < 0) g = 0;
      if (gmax && g > gmax) g = gmax;
      return Math.round(g);
    }
    if (!info.durationMs || !gmax) return null;
    return Math.round((info.cursorMs / info.durationMs) * gmax);
  }

  function timelineMsToCursor(timelineMs, info) {
    if (!info) return null;
    var minMs = A().computeTimelineMinMs(lastArchive);
    if (minMs < 0 && info.startMs != null) {
      var c = Number(timelineMs) - minMs;
      if (c < 0) c = 0;
      if (info.durationMs && c > info.durationMs) c = info.durationMs;
      return Math.round(c);
    }
    if (matchStartWall != null && info.startMs != null) {
      var c2 = matchStartWall + Number(timelineMs) - info.startMs;
      if (c2 < 0) c2 = 0;
      if (info.durationMs && c2 > info.durationMs) c2 = info.durationMs;
      return Math.round(c2);
    }
    var gmax = gameMaxMs();
    if (!info.durationMs || !gmax) return null;
    return Math.round((Number(timelineMs) / gmax) * info.durationMs);
  }

  function schedulePanelSync() {
    if (panelSyncTimer) return;
    panelSyncTimer = setTimeout(function () {
      panelSyncTimer = 0;
      refreshDetailAnalyticsPanels();
      refreshScoreDisplay();
    }, 180);
  }

  function onReplayCursor(info) {
    if (!info) return;
    if (analyticsDragging) return;
    if (!syncEngaged) {
      // Ignore the replay's idle start position; engage only once the user
      // actually plays or scrubs it.
      if (!(info.playing || info.cursorMs > 0)) return;
      syncEngaged = true;
    }
    var timelineMs = cursorToTimelineMs(info);
    if (timelineMs == null) return;
    syncingFromReplay = true;
    scrubGameTimeMs = timelineMs;
    var scrub = document.getElementById("match-timeline-scrub");
    if (scrub) scrub.value = String(timelineMs);
    var label = document.getElementById("match-timeline-label");
    if (label) label.textContent = A().formatTimelineScrubTime(timelineMs, lastArchive);
    var replayWallMs =
      info.startMs != null && info.cursorMs != null
        ? Number(info.startMs) + Number(info.cursorMs)
        : null;
    A().updateLifecyclePhaseBadge(lastArchive, timelineMs, null, {
      replayWallMs: replayWallMs,
    });
    syncingFromReplay = false;
    schedulePanelSync();
    updateReplayControlUi();
    refreshCheckpointPanel(timelineMs, false);
    scheduleCheckpointFetch(activeRecordingId, timelineMs);
  }

  function updateReplayControlUi() {
    var playBtn = document.getElementById("match-timeline-play");
    if (!playBtn) return;
    var playing =
      window.OverlayApp &&
      typeof OverlayApp.isReplayPlaying === "function" &&
      OverlayApp.isReplayPlaying();
    var icon = document.getElementById("match-timeline-play-icon");
    if (icon) {
      icon.src = playing ? "icons/replay/pause.png" : "icons/replay/play.png";
    }
    playBtn.setAttribute(
      "aria-label",
      playing
        ? QLDashboard.t("matchReplayPause")
        : QLDashboard.t("matchReplayPlay"),
    );
    var speedSel = document.getElementById("match-timeline-speed");
    var info = replayInfo();
    if (speedSel && info && info.speed != null) {
      speedSel.value = String(info.speed);
    }
  }

  function replaySeekOpts(resume, scrubPreview) {
    return {
      resume: !!resume,
      gameMaxMs: gameMaxMs(),
      scrubPreview: !!scrubPreview,
    };
  }

  function seekReplayToGameMs(timelineMs, resume) {
    if (!window.OverlayApp) return Promise.resolve();
    var info = replayInfo();
    if (typeof OverlayApp.seekReplayMs === "function") {
      var cursor = timelineMsToCursor(timelineMs, info);
      if (cursor == null) {
        var gmax = gameMaxMs();
        if (!gmax || !info || !info.durationMs) return Promise.resolve();
        cursor = Math.round((Number(timelineMs) / gmax) * info.durationMs);
      }
      return OverlayApp.seekReplayMs(cursor, replaySeekOpts(resume, false));
    }
    if (typeof OverlayApp.seekReplayGameMs !== "function") return Promise.resolve();
    return OverlayApp.seekReplayGameMs(
      Math.max(0, Number(timelineMs) || 0),
      replaySeekOpts(resume, false),
    );
  }

  function scheduleSeekReplayToGameMs(gameMs, resume, scrubPreview) {
    if (
      window.OverlayApp &&
      typeof OverlayApp.scheduleSeekReplayGameMs === "function"
    ) {
      OverlayApp.scheduleSeekReplayGameMs(
        gameMs,
        replaySeekOpts(resume, scrubPreview),
      );
      return;
    }
    if (seekReplayTimer) clearTimeout(seekReplayTimer);
    seekReplayTimer = setTimeout(function () {
      seekReplayTimer = 0;
      seekReplayToGameMs(gameMs, resume);
    }, 40);
  }

  function scheduleScrubPanelSync() {
    if (scrubPanelSyncTimer) return;
    scrubPanelSyncTimer = setTimeout(function () {
      scrubPanelSyncTimer = 0;
      refreshDetailAnalyticsPanels();
      refreshScoreDisplay();
    }, 100);
  }

  function flushScrubPanelSync() {
    if (scrubPanelSyncTimer) {
      clearTimeout(scrubPanelSyncTimer);
      scrubPanelSyncTimer = 0;
    }
    refreshDetailAnalyticsPanels();
    refreshScoreDisplay();
  }

  function applyTimelineScrubValue(fromReplay) {
    var scrub = document.getElementById("match-timeline-scrub");
    if (!scrub) return;
    scrubGameTimeMs = Number(scrub.value);
    var label = document.getElementById("match-timeline-label");
    if (label) label.textContent = A().formatTimelineScrubTime(scrubGameTimeMs, lastArchive);
    A().updateLifecyclePhaseBadge(lastArchive, scrubGameTimeMs, null);
    if (!fromReplay) {
      syncEngaged = true;
      scheduleSeekReplayToGameMs(scrubGameTimeMs, false, analyticsDragging);
    }
    if (analyticsDragging) {
      scheduleScrubPanelSync();
      var restoreHost = document.getElementById("restore-checkpoint-host");
      if (restoreHost && typeof QLRestoreEditor !== "undefined" && QLRestoreEditor.updateScrubLight) {
        QLRestoreEditor.updateScrubLight(restoreHost, { tMs: scrubGameTimeMs });
      }
      scheduleCheckpointFetch(activeRecordingId, scrubGameTimeMs);
    } else {
      flushScrubPanelSync();
      flushCheckpointPanelSync();
    }
  }

  function bindTimelineScrubber() {
    var scrub = document.getElementById("match-timeline-scrub");
    if (!scrub || scrub.dataset.qlBound) return;
    scrub.dataset.qlBound = "1";

    scrub.addEventListener("pointerdown", function () {
      syncEngaged = true;
      analyticsDragging = true;
      replayScrubWasPlaying =
        window.OverlayApp &&
        typeof OverlayApp.isReplayPlaying === "function" &&
        OverlayApp.isReplayPlaying();
      if (window.OverlayApp && typeof OverlayApp.pauseReplay === "function") {
        OverlayApp.pauseReplay();
      }
      if (
        window.OverlayApp &&
        typeof OverlayApp.cancelScheduledSeekReplay === "function"
      ) {
        OverlayApp.cancelScheduledSeekReplay();
      }
      if (seekReplayTimer) {
        clearTimeout(seekReplayTimer);
        seekReplayTimer = 0;
      }
      updateReplayControlUi();
    });

    scrub.addEventListener("input", function () {
      applyTimelineScrubValue(false);
    });

    scrub.addEventListener("change", function () {
      analyticsDragging = false;
      scrubGameTimeMs = Number(scrub.value);
      var label = document.getElementById("match-timeline-label");
      if (label) label.textContent = A().formatTimelineScrubTime(scrubGameTimeMs, lastArchive);
      if (
        window.OverlayApp &&
        typeof OverlayApp.cancelScheduledSeekReplay === "function"
      ) {
        OverlayApp.cancelScheduledSeekReplay();
      }
      if (seekReplayTimer) {
        clearTimeout(seekReplayTimer);
        seekReplayTimer = 0;
      }
      syncEngaged = true;
      var resume = replayScrubWasPlaying;
      replayScrubWasPlaying = false;
      seekReplayToGameMs(scrubGameTimeMs, resume);
      flushScrubPanelSync();
      flushCheckpointPanelSync();
      updateReplayControlUi();
    });

    scrub.addEventListener("pointercancel", function () {
      analyticsDragging = false;
      flushScrubPanelSync();
      flushCheckpointPanelSync();
    });

    scrub.addEventListener("pointerup", function () {
      if (!analyticsDragging) return;
      analyticsDragging = false;
      flushScrubPanelSync();
      flushCheckpointPanelSync();
    });
    var playBtn = document.getElementById("match-timeline-play");
    if (playBtn && !playBtn.dataset.qlBound) {
      playBtn.dataset.qlBound = "1";
      playBtn.addEventListener("click", function () {
        if (!window.OverlayApp || typeof OverlayApp.toggleReplayPlayback !== "function") return;
        syncEngaged = true;
        OverlayApp.toggleReplayPlayback();
        updateReplayControlUi();
      });
    }
    var speedSel = document.getElementById("match-timeline-speed");
    if (speedSel && !speedSel.dataset.qlBound) {
      speedSel.dataset.qlBound = "1";
      var info = replayInfo();
      if (info && info.speed != null) speedSel.value = String(info.speed);
      speedSel.addEventListener("change", function () {
        if (window.OverlayApp && typeof OverlayApp.setReplaySpeed === "function") {
          OverlayApp.setReplaySpeed(Number(speedSel.value));
        }
      });
    }
    var liveBtn = document.getElementById("match-timeline-live");
    if (liveBtn && !liveBtn.dataset.qlBound) {
      liveBtn.dataset.qlBound = "1";
      liveBtn.addEventListener("click", function () {
        var maxMs = A().computeTimelineMaxMs(lastArchive, null);
        scrubGameTimeMs = maxMs;
        scrub.value = String(maxMs);
        var label = document.getElementById("match-timeline-label");
        if (label) label.textContent = A().formatGameTime(maxMs);
        refreshDetailAnalyticsPanels();
        refreshScoreDisplay();
        syncEngaged = true;
        var resume =
          window.OverlayApp &&
          typeof OverlayApp.isReplayPlaying === "function" &&
          OverlayApp.isReplayPlaying();
        seekReplayToGameMs(maxMs, resume);
        updateReplayControlUi();
      });
    }
    updateReplayControlUi();
  }

  function refreshDetailAnalyticsPanels() {
    var panels = document.getElementById("match-analytics-panels");
    if (!panels || !lastArchive) return;
    A().preserveAnalyticsScroll(panels, function () {
      panels.innerHTML = A().renderAnalyticsPanels(lastArchive, lastArchive.players, {
        scrubMs: scrubGameTimeMs,
        liveData: null,
      });
    });
  }

  function refreshDetailAnalytics() {
    var wrap = document.getElementById("results-detail-analytics");
    if (!wrap || !lastArchive) return;
    wrap.innerHTML = A().renderAnalytics(lastArchive, lastArchive.players, {
      scrubMs: scrubGameTimeMs,
      liveData: null,
      replayControl: true,
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
      '<table class="data-table"><thead><tr><th><input type="checkbox" id="results-select-all" aria-label="' +
      QLDashboard.escapeHtml(QLDashboard.t("resultsSelectAll")) +
      '" /></th><th>' +
      QLDashboard.escapeHtml(QLDashboard.t("colServer")) +
      "</th><th>" +
      QLDashboard.escapeHtml(QLDashboard.t("resultsColPlayers")) +
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
        "<tr><td>" +
        (rid && r.replay_available !== false
          ? '<input type="checkbox" data-ql-select-recording="' +
            QLDashboard.escapeHtml(rid) +
            '" aria-label="' +
            QLDashboard.escapeHtml(QLDashboard.t("resultsSelectRow")) +
            '"' +
            (selectedRecordingIds[rid] ? " checked" : "") +
            " />"
          : "") +
        '</td><td><a href="' +
        QLDashboard.escapeHtml(serverUrl) +
        '">' +
        QLDashboard.escapeHtml(r.session_id || r.match_id || "—") +
        "</a></td><td>" +
        QLDashboard.escapeHtml(formatMatchupLabel(r)) +
        "</td><td>" +
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
        (rid && r.replay_available !== false
          ? ' <button type="button" class="control-btn control-btn-sm" data-ql-download-replay="' +
            QLDashboard.escapeHtml(rid) +
            '">' +
            QLDashboard.escapeHtml(QLDashboard.t("resultsDownloadReplay")) +
            "</button>"
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
      bindDownloadReplayButtons(bodyEl);
      bindResultsSelectionCheckboxes(bodyEl);
      updateDownloadSelectedButton();
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
    selectedRecordingIds = {};
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
      '<div class="control-actions">' +
      '<button type="button" id="results-download-selected" class="control-btn control-btn-sm" disabled>' +
      QLDashboard.escapeHtml(QLDashboard.t("resultsDownloadSelected")) +
      "</button>" +
      "</div>" +
      '<div id="results-list-wrap"></div>' +
      "</section>";

    var downloadSelectedBtn = document.getElementById("results-download-selected");
    if (downloadSelectedBtn && !downloadSelectedBtn.dataset.qlBound) {
      downloadSelectedBtn.dataset.qlBound = "1";
      downloadSelectedBtn.addEventListener("click", downloadSelectedReplays);
    }

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
      if (
        archive.replay_available !== false &&
        (!archive.pickups || !archive.pickups.length)
      ) {
        try {
          var replayPayload = await QLDashboard.fetchStatsJson(
            "/api/replays/" + encodeURIComponent(recordingId) + "?limit=10000",
          );
          archive = A().enrichArchivePickupsFromReplay(archive, replayPayload);
          archive = A().attachReplayScrubData(archive, replayPayload);
        } catch (_replayErr) {
          /* keep archive without pickups */
        }
      } else if (archive.replay_available !== false) {
        try {
          var replayForDeath = await QLDashboard.fetchStatsJson(
            "/api/replays/" + encodeURIComponent(recordingId) + "?limit=10000",
          );
          archive = A().attachReplayScrubData(archive, replayForDeath);
        } catch (_replayErr2) {
          /* deaths-only fallback */
        }
      }
      lastArchive = A().normalizeArchiveCombatClock(archive);
      matchStartWall = computeMatchStartWall(archive);
      syncEngaged = false;
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
          (archive.replay_available !== false && recordingId
            ? '<button type="button" class="control-btn control-btn-sm" data-ql-download-replay="' +
              QLDashboard.escapeHtml(recordingId) +
              '">' +
              QLDashboard.escapeHtml(QLDashboard.t("resultsDownloadReplay")) +
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
        bindDownloadReplayButtons(actionsEl);
      }
      var matchupEl = document.getElementById("results-matchup");
      if (matchupEl) {
        matchupEl.innerHTML = A().renderMatchupBanner(lastArchive, scrubGameTimeMs);
      }
      var scoreboardEl = document.getElementById("results-scoreboard");
      if (scoreboardEl) {
        scoreboardEl.innerHTML = A().renderScoreboard(lastArchive, scrubGameTimeMs);
      }
      if (analyticsEl) {
        analyticsEl.innerHTML = A().renderAnalytics(archive, archive.players, {
          scrubMs: scrubGameTimeMs,
          liveData: null,
          replayControl: true,
        });
        bindTimelineScrubber();
        A().updateLifecyclePhaseBadge(lastArchive, scrubGameTimeMs, null);
      }
      if (archive.replay_available !== false && recordingId && matchId) {
        checkpointReplayAvailable = true;
        scheduleCheckpointFetch(recordingId, scrubGameTimeMs);
        mountResultsMapWidget(matchId, recordingId);
        if (scrubGameTimeMs != null) {
          (function waitReplay(tries) {
            if (replayInfo()) {
              seekReplayToGameMs(scrubGameTimeMs, false);
              return;
            }
            if (tries > 0) {
              setTimeout(function () {
                waitReplay(tries - 1);
              }, 200);
            }
          })(40);
        }
      } else {
        checkpointReplayAvailable = false;
        checkpointPayload = null;
        checkpointStatus = "unavailable";
        refreshCheckpointPanel(scrubGameTimeMs);
      }
    } catch (err) {
      checkpointReplayAvailable = false;
      checkpointPayload = null;
      checkpointStatus = "unavailable";
      refreshCheckpointPanel(null);
      if (statusEl) {
        statusEl.textContent = QLDashboard.t("resultsNotFound");
        statusEl.classList.add("error");
      }
      destroyResultsMapWidget();
      if (analyticsEl) analyticsEl.innerHTML = "";
      if (actionsEl) actionsEl.innerHTML = "";
      if (metaEl) metaEl.textContent = "";
      var matchupClear = document.getElementById("results-matchup");
      if (matchupClear) matchupClear.innerHTML = "";
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
    checkpointPayload = null;
    checkpointStatus = "idle";
    checkpointError = "";
    checkpointReplayAvailable = false;
    stopCheckpointFetch();

    root.innerHTML =
      '<section class="control-section results-detail-section">' +
      '<div class="results-detail-hero">' +
      '<div class="results-detail-hero-main">' +
      "<h2>" +
      QLDashboard.escapeHtml(QLDashboard.t("resultsDetailTitle")) +
      "</h2>" +
      '<p id="results-detail-status" class="control-status">' +
      QLDashboard.escapeHtml(QLDashboard.t("resultsLoading")) +
      "</p>" +
      '<p id="results-detail-meta" class="match-page-meta"></p>' +
      '<div id="results-detail-actions" class="control-actions"></div>' +
      "</div>" +
      '<div id="results-scoreboard" class="results-scoreboard-side"></div>' +
      "</div>" +
      '<div class="results-map-stack">' +
      '<div id="results-matchup" class="results-matchup-above-map"></div>' +
      '<div id="results-map-widget" class="match-map-widget"></div>' +
      "</div>" +
      '<div id="results-detail-analytics"></div>' +
      '<button type="button" id="restore-toggle-btn" class="control-btn control-btn-sm" aria-expanded="false" aria-controls="restore-checkpoint-host">' +
      QLDashboard.escapeHtml(QLDashboard.t("restoreToggleShow")) +
      "</button>" +
      '<div id="restore-checkpoint-host" class="hidden"></div>' +
      "</section>";

    bindRestoreToggle(root);
    loadResultDetail(root, recordingId);
  }

  function bindRestoreToggle(root) {
    var btn = root.querySelector("#restore-toggle-btn");
    var host = root.querySelector("#restore-checkpoint-host");
    if (!btn || !host) return;
    btn.addEventListener("click", function () {
      var show = host.classList.contains("hidden");
      host.classList.toggle("hidden", !show);
      btn.setAttribute("aria-expanded", show ? "true" : "false");
      btn.textContent = QLDashboard.t(show ? "restoreToggleHide" : "restoreToggleShow");
      if (show) refreshCheckpointPanel(scrubGameTimeMs, false);
    });
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
