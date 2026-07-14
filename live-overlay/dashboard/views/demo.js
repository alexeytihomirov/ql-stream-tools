(function () {
  "use strict";

  var A = function () {
    return QLDashboardAnalytics;
  };

  var lastArchive = null;
  var lastOverlayReplay = null;
  var lastItemRows = null;
  var scrubGameTimeMs = null;
  var parseSummary = null;
  var parseFileName = "";
  var analyticsDragging = false;
  var replayScrubWasPlaying = false;
  var seekReplayTimer = 0;
  var scrubPanelSyncTimer = 0;
  var mapHandle = null;

  function waitQLDemo(timeoutMs) {
    timeoutMs = timeoutMs == null ? 20000 : timeoutMs;
    if (window.QLDemo) return Promise.resolve(window.QLDemo);
    if (window.QLDemoLoadError) {
      return Promise.reject(window.QLDemoLoadError);
    }
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        cleanup();
        reject(new Error(QLDashboard.t("demoParserTimeout")));
      }, timeoutMs);
      function cleanup() {
        clearTimeout(timer);
        window.removeEventListener("qldemo-ready", onReady);
        window.removeEventListener("qldemo-error", onErr);
      }
      function onReady() {
        cleanup();
        resolve(window.QLDemo);
      }
      function onErr(ev) {
        cleanup();
        reject(ev.detail || new Error(QLDashboard.t("demoParserLoadFailed")));
      }
      window.addEventListener("qldemo-ready", onReady);
      window.addEventListener("qldemo-error", onErr);
    });
  }

  function yieldUi() {
    return new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });
  }

  async function fetchMapPickupTable(QLDemo, mapKey) {
    if (!mapKey) return [];
    var base = String(QLDashboard.effectiveAssetsBase() || "").replace(/\/+$/, "");
    if (!base) return [];
    var url = base + "/maps/entities/" + encodeURIComponent(mapKey) + ".json";
    try {
      var res = await fetch(url, { cache: "force-cache" });
      if (!res.ok) return [];
      var data = await res.json();
      return QLDemo.filterPickupEntities(data.entities);
    } catch (_e) {
      return [];
    }
  }

  function waitOverlayReplay(tries) {
    tries = tries == null ? 60 : tries;
    return new Promise(function (resolve) {
      (function poll(n) {
        if (window.OverlayApp && typeof OverlayApp.loadReplayData === "function") {
          resolve();
          return;
        }
        if (n <= 0) {
          resolve();
          return;
        }
        setTimeout(function () {
          poll(n - 1);
        }, 100);
      })(tries);
    });
  }

  function replayInfo() {
    if (window.OverlayApp && typeof OverlayApp.replayProgress === "function") {
      return OverlayApp.replayProgress();
    }
    return null;
  }

  function gameMinMs() {
    return A().computeTimelineMinMs(lastArchive) || 0;
  }

  function gameMaxMs() {
    return A().computeTimelineMaxMs(lastArchive, null) || 0;
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
    var minMs = gameMinMs();
    var maxMs = gameMaxMs();
    var clamped = Math.max(minMs, Math.min(maxMs, Number(timelineMs) || 0));
    if (typeof OverlayApp.seekReplayGameMs === "function") {
      return OverlayApp.seekReplayGameMs(clamped, replaySeekOpts(resume, false));
    }
    if (typeof OverlayApp.seekReplayMs !== "function" || !info) {
      return Promise.resolve();
    }
    var gmax = gameMaxMs();
    var cursor =
      gmax && info.durationMs
        ? Math.round((clamped / gmax) * info.durationMs)
        : clamped;
    return OverlayApp.seekReplayMs(cursor, replaySeekOpts(resume, false));
  }

  function scheduleSeekReplayToGameMs(gameMs, resume, scrubPreview) {
    if (window.OverlayApp && typeof OverlayApp.scheduleSeekReplayGameMs === "function") {
      OverlayApp.scheduleSeekReplayGameMs(gameMs, replaySeekOpts(resume, scrubPreview));
      return;
    }
    if (seekReplayTimer) clearTimeout(seekReplayTimer);
    seekReplayTimer = setTimeout(function () {
      seekReplayTimer = 0;
      seekReplayToGameMs(gameMs, resume);
    }, 40);
  }

  function destroyDemoMapWidget() {
    if (seekReplayTimer) {
      clearTimeout(seekReplayTimer);
      seekReplayTimer = 0;
    }
    if (scrubPanelSyncTimer) {
      clearTimeout(scrubPanelSyncTimer);
      scrubPanelSyncTimer = 0;
    }
    if (window.OverlayApp && typeof OverlayApp.setReplayCursorListener === "function") {
      OverlayApp.setReplayCursorListener(null);
    }
    if (mapHandle && typeof mapHandle.destroy === "function") {
      try {
        mapHandle.destroy();
      } catch (_e) {
        /* ignore */
      }
    }
    mapHandle = null;
    if (typeof MapWidget !== "undefined") {
      try {
        MapWidget.destroy();
      } catch (_e2) {
        /* ignore */
      }
    }
  }

  function mountDemoMapWidget() {
    if (typeof MapWidget === "undefined") return;
    var host = document.getElementById("demo-map-widget");
    if (!host) return;
    destroyDemoMapWidget();
    try {
      mapHandle = MapWidget.mount(host, {
        match: "demo-local",
        replay: "1",
        source: "file",
        embedded: true,
        assets: QLDashboard.effectiveAssetsBase(),
        smooth: "0",
        smooth_ms: "120",
      });
      if (window.OverlayApp && typeof OverlayApp.setReplayCursorListener === "function") {
        OverlayApp.setReplayCursorListener(onReplayCursor);
      }
    } catch (_e) {
      /* optional */
    }
  }

  function onReplayCursor(info) {
    if (!info || analyticsDragging) return;
    var gmin = gameMinMs();
    var gmax = gameMaxMs();
    if (!gmax && gmax !== 0) return;
    var gameMs = info.gameMs != null ? info.gameMs : info.cursorMs;
    if (gameMs == null) return;
    scrubGameTimeMs = Math.max(gmin, Math.min(gmax, Math.round(Number(gameMs))));
    var scrub = document.getElementById("match-timeline-scrub");
    if (scrub) scrub.value = String(scrubGameTimeMs);
    var label = document.getElementById("match-timeline-label");
    if (label) label.textContent = A().formatTimelineScrubTime(scrubGameTimeMs, lastArchive);
    scheduleScrubPanelSync();
    updateReplayControlUi();
  }

  // lastItemRows spans the whole demo (every pickup interval up front); each
  // row's pickup_ms tells us whether that pickup has even happened yet as of
  // scrubT. restore-editor.js's own filterCheckpointItemsForScrub only checks
  // at_ms > t (it assumes the raw list was already trimmed to "picked up by
  // t", true for a real recording's per-t_ms server fetch) so we pre-filter
  // here before handing rows to the editor.
  function itemRowsAtTime(tMs) {
    return (lastItemRows || []).filter(function (row) {
      return row.pickup_ms <= tMs && row.at_ms > tMs;
    });
  }

  // No server round-trip (unlike results.js's real-recording checkpoint
  // fetch): recompute the item slice into a synthetic payload.checkpoint
  // and let QLRestoreEditor's own updateScrub/ensureSnapshot machinery
  // (relation === "exact" since t_ms always matches scrubT here) refresh
  // the cache and re-render — same path results.js uses for real recordings,
  // just fed from local data instead of a server fetch.
  function refreshCheckpointPanel(tMs, forceMount) {
    var host = document.getElementById("restore-checkpoint-host");
    if (!host || typeof QLRestoreEditor === "undefined" || !lastArchive) return;
    var scrubT = tMs != null ? tMs : scrubGameTimeMs;
    var opts = {
      status: "ready",
      payload: {
        checkpoint: {
          v: 2,
          t_ms: scrubT,
          map: lastArchive.map_name || "",
          items: itemRowsAtTime(scrubT),
          players: [],
        },
      },
      tMs: scrubT,
      archive: lastArchive,
      standalone: true,
      refreshPayloadItems: true,
    };
    var hasShell =
      host.querySelector(".ql-restore-shell") || host.querySelector(".ql-restore-editor-body");
    if (forceMount || !hasShell) {
      QLRestoreEditor.mount(host, opts);
      return;
    }
    QLRestoreEditor.updateScrub(host, opts);
  }

  function scheduleScrubPanelSync() {
    if (scrubPanelSyncTimer) return;
    scrubPanelSyncTimer = setTimeout(function () {
      scrubPanelSyncTimer = 0;
      refreshAnalyticsPanels();
      refreshScoreDisplay();
      refreshCheckpointPanel(scrubGameTimeMs);
    }, 100);
  }

  function flushScrubPanelSync() {
    if (scrubPanelSyncTimer) {
      clearTimeout(scrubPanelSyncTimer);
      scrubPanelSyncTimer = 0;
    }
    refreshAnalyticsPanels();
    refreshScoreDisplay();
    refreshCheckpointPanel(scrubGameTimeMs);
  }

  function refreshScoreDisplay() {
    if (!lastArchive) return;
    var view = A().archiveForScore(lastArchive, scrubGameTimeMs);
    var scoreboardEl = document.getElementById("demo-scoreboard");
    if (scoreboardEl) {
      scoreboardEl.innerHTML = A().renderScoreboard(view, scrubGameTimeMs);
    }
    var matchupEl = document.getElementById("demo-matchup");
    if (matchupEl) {
      matchupEl.innerHTML = A().renderMatchupBanner(view, scrubGameTimeMs);
    }
  }

  function refreshAnalyticsPanels() {
    var panels = document.getElementById("match-analytics-panels");
    if (!panels || !lastArchive) return;
    A().preserveAnalyticsScroll(panels, function () {
      panels.innerHTML = A().renderAnalyticsPanels(lastArchive, lastArchive.players, {
        scrubMs: scrubGameTimeMs,
        liveData: null,
      });
    });
  }

  function refreshAnalytics() {
    var wrap = document.getElementById("demo-analytics-wrap");
    if (!wrap || !lastArchive) return;
    wrap.innerHTML = A().renderAnalytics(lastArchive, lastArchive.players, {
      scrubMs: scrubGameTimeMs,
      liveData: null,
      replayControl: true,
    });
    bindTimelineScrubber();
    A().updateLifecyclePhaseBadge(lastArchive, scrubGameTimeMs, null);
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
      playing ? QLDashboard.t("matchReplayPause") : QLDashboard.t("matchReplayPlay"),
    );
    var speedSel = document.getElementById("match-timeline-speed");
    var info = replayInfo();
    if (speedSel && info && info.speed != null) {
      speedSel.value = String(info.speed);
    }
  }

  function bindTimelineScrubber() {
    var scrub = document.getElementById("match-timeline-scrub");
    if (!scrub || scrub.dataset.qlBound) return;
    scrub.dataset.qlBound = "1";

    scrub.addEventListener("pointerdown", function () {
      analyticsDragging = true;
      replayScrubWasPlaying =
        window.OverlayApp &&
        typeof OverlayApp.isReplayPlaying === "function" &&
        OverlayApp.isReplayPlaying();
      if (window.OverlayApp && typeof OverlayApp.pauseReplay === "function") {
        OverlayApp.pauseReplay();
      }
      if (window.OverlayApp && typeof OverlayApp.cancelScheduledSeekReplay === "function") {
        OverlayApp.cancelScheduledSeekReplay();
      }
      updateReplayControlUi();
    });

    scrub.addEventListener("input", function () {
      scrubGameTimeMs = Number(scrub.value);
      var label = document.getElementById("match-timeline-label");
      if (label) label.textContent = A().formatTimelineScrubTime(scrubGameTimeMs, lastArchive);
      A().updateLifecyclePhaseBadge(lastArchive, scrubGameTimeMs, null);
      scheduleSeekReplayToGameMs(scrubGameTimeMs, false, true);
      scheduleScrubPanelSync();
    });

    scrub.addEventListener("change", function () {
      analyticsDragging = false;
      scrubGameTimeMs = Number(scrub.value);
      var resume = replayScrubWasPlaying;
      replayScrubWasPlaying = false;
      seekReplayToGameMs(scrubGameTimeMs, resume);
      flushScrubPanelSync();
      updateReplayControlUi();
    });

    scrub.addEventListener("pointerup", function () {
      analyticsDragging = false;
    });

    var playBtn = document.getElementById("match-timeline-play");
    if (playBtn && !playBtn.dataset.qlBound) {
      playBtn.dataset.qlBound = "1";
      playBtn.addEventListener("click", function () {
        if (!window.OverlayApp || typeof OverlayApp.toggleReplayPlayback !== "function") return;
        OverlayApp.toggleReplayPlayback();
        updateReplayControlUi();
      });
    }

    var speedSel = document.getElementById("match-timeline-speed");
    if (speedSel && !speedSel.dataset.qlBound) {
      speedSel.dataset.qlBound = "1";
      speedSel.addEventListener("change", function () {
        if (window.OverlayApp && typeof OverlayApp.setReplaySpeed === "function") {
          OverlayApp.setReplaySpeed(Number(speedSel.value));
        }
      });
    }

    updateReplayControlUi();
  }

  function renderSummaryHtml(summary) {
    if (!summary) return "";
    var rows = [
      ["map", summary.map],
      ["snapshots", summary.snapshots],
      ["pickups", summary.pickups],
      ["projectile_frames", summary.projectile_frames],
      ["impact_frames", summary.impact_frames],
      ["beam_frames", summary.beam_frames],
      ["duration", A().formatReplayDuration(summary.duration_game_ms)],
      ["players", (summary.players || []).join(", ")],
    ];
    var html = '<dl class="demo-summary-dl">';
    for (var i = 0; i < rows.length; i++) {
      html +=
        "<dt>" +
        QLDashboard.escapeHtml(rows[i][0]) +
        "</dt><dd>" +
        QLDashboard.escapeHtml(String(rows[i][1] == null ? "—" : rows[i][1])) +
        "</dd>";
    }
    if (summary.errors && summary.errors.length) {
      html +=
        "<dt>errors</dt><dd class=\"control-status error\">" +
        QLDashboard.escapeHtml(summary.errors.join("; ")) +
        "</dd>";
    }
    html += "</dl>";
    return html;
  }

  function setParseStatus(text, isError) {
    var el = document.getElementById("demo-parse-status");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("error", !!isError);
  }

  async function handleDemoFile(file) {
    if (!file) return;
    var name = String(file.name || "");
    if (!/\.dm_\d+$/i.test(name)) {
      setParseStatus(QLDashboard.t("demoBadExtension"), true);
      return;
    }
    setParseStatus(QLDashboard.t("demoParsing"), false);
    parseSummary = null;
    lastArchive = null;
    lastOverlayReplay = null;
    lastItemRows = null;
    parseFileName = name;

    try {
      var QLDemo = await waitQLDemo();
      await yieldUi();

      var buffer = new Uint8Array(await file.arrayBuffer());
      setParseStatus(QLDashboard.t("demoParsingSnapshots"), false);
      await yieldUi();

      var parser = QLDemo.parseDemoBuffer(buffer);
      var mapKey = QLDemo.normalizeMapKey(parser.mapName());
      var mapTable = await fetchMapPickupTable(QLDemo, mapKey);
      setParseStatus(QLDashboard.t("demoParsingReplay"), false);
      await yieldUi();

      var replay = QLDemo.demoToReplay(parser, { mapTable: mapTable, includePickups: true });
      parseSummary = QLDemo.replaySummary(replay);
      lastOverlayReplay = QLDemo.replayForOverlay(replay);
      lastItemRows = QLDemo.itemStateRows(replay);
      lastArchive = A().normalizeArchiveCombatClock(QLDemo.archiveFromDemoReplay(replay));
      lastArchive = A().enrichArchivePickupsFromReplay(lastArchive, lastOverlayReplay);
      lastArchive = A().attachReplayScrubData(lastArchive, lastOverlayReplay);
      scrubGameTimeMs = A().computeTimelineMinMs(lastArchive) || 0;

      var summaryEl = document.getElementById("demo-summary");
      if (summaryEl) {
        summaryEl.innerHTML = renderSummaryHtml(parseSummary);
        summaryEl.hidden = false;
      }
      var viewer = document.getElementById("demo-viewer");
      if (viewer) viewer.hidden = false;
      var metaEl = document.getElementById("demo-meta");
      if (metaEl) {
        metaEl.textContent = [parseSummary.map, parseFileName].filter(Boolean).join(" · ");
      }

      mountDemoMapWidget();
      if (window.MapSpawns && typeof MapSpawns.setEnabled === "function") {
        MapSpawns.setEnabled(true);
      }
      await waitOverlayReplay();
      if (window.OverlayApp && typeof OverlayApp.loadReplayData === "function") {
        await OverlayApp.loadReplayData(lastOverlayReplay);
        await seekReplayToGameMs(scrubGameTimeMs, false);
      }

      refreshAnalytics();
      refreshScoreDisplay();
      refreshCheckpointPanel(scrubGameTimeMs, true);
      setParseStatus(QLDashboard.t("demoParsedOk", { file: name }), false);
    } catch (err) {
      setParseStatus(String(err.message || err), true);
      destroyDemoMapWidget();
      var viewerErr = document.getElementById("demo-viewer");
      if (viewerErr) viewerErr.hidden = true;
    }
  }

  function bindUpload(root) {
    var input = root.querySelector("#demo-file-input");
    var drop = root.querySelector("#demo-drop-zone");
    if (input) {
      input.addEventListener("change", function () {
        var file = input.files && input.files[0];
        if (file) handleDemoFile(file);
        input.value = "";
      });
    }
    if (!drop) return;
    drop.addEventListener("dragover", function (ev) {
      ev.preventDefault();
      drop.classList.add("demo-drop-active");
    });
    drop.addEventListener("dragleave", function () {
      drop.classList.remove("demo-drop-active");
    });
    drop.addEventListener("drop", function (ev) {
      ev.preventDefault();
      drop.classList.remove("demo-drop-active");
      var file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (file) handleDemoFile(file);
    });
    drop.addEventListener("click", function () {
      if (input) input.click();
    });
  }

  function mount(root) {
    destroyDemoMapWidget();
    lastArchive = null;
    lastOverlayReplay = null;
    lastItemRows = null;
    scrubGameTimeMs = null;
    parseSummary = null;
    parseFileName = "";

    root.innerHTML =
      '<section class="control-section">' +
      "<h2>" +
      QLDashboard.escapeHtml(QLDashboard.t("demoPageTitle")) +
      "</h2>" +
      '<p class="control-field-hint">' +
      QLDashboard.escapeHtml(QLDashboard.t("demoPageHint")) +
      "</p>" +
      '<div id="demo-drop-zone" class="demo-drop-zone" tabindex="0" role="button">' +
      '<p class="demo-drop-title">' +
      QLDashboard.escapeHtml(QLDashboard.t("demoDropTitle")) +
      "</p>" +
      '<p class="demo-drop-sub">' +
      QLDashboard.escapeHtml(QLDashboard.t("demoDropSub")) +
      "</p>" +
      '<input type="file" id="demo-file-input" accept=".dm_91,.dm_90,.dm_73,.dm_68,application/octet-stream" hidden />' +
      "</div>" +
      '<p id="demo-parse-status" class="control-status"></p>' +
      '<div id="demo-summary" class="demo-summary" hidden></div>' +
      "</section>" +
      '<section id="demo-viewer" class="control-section demo-viewer-section" hidden>' +
      '<div class="results-detail-hero">' +
      '<div class="results-detail-hero-main">' +
      '<p id="demo-meta" class="match-page-meta"></p>' +
      "</div>" +
      '<div id="demo-scoreboard" class="results-scoreboard-side"></div>' +
      "</div>" +
      '<div class="results-map-stack">' +
      '<div id="demo-matchup" class="results-matchup-above-map"></div>' +
      '<div id="demo-map-widget" class="match-map-widget"></div>' +
      "</div>" +
      '<div id="demo-analytics-wrap"></div>' +
      '<p class="control-field-hint">' +
      QLDashboard.escapeHtml(QLDashboard.t("demoCheckpointHint")) +
      "</p>" +
      '<div id="restore-checkpoint-host"></div>' +
      "</section>";

    bindUpload(root);
  }

  function unmount() {
    destroyDemoMapWidget();
  }

  QLDashboard.registerView("demo", {
    mount: mount,
    unmount: unmount,
    onLangChanged: function () {
      var root = document.getElementById("app-main");
      if (!root) return;
      mount(root);
      if (parseFileName) {
        setParseStatus(QLDashboard.t("demoReloadHint"), false);
      }
    },
  });
})();
