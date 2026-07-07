(function () {
  "use strict";

  var A = function () {
    return QLDashboardAnalytics;
  };

  var checkpointPayload = null;
  var checkpointStatus = "idle";
  var checkpointError = "";
  var lastArchive = null;
  var activeRecordingId = null;

  function parseTimeMs() {
    var raw = QLDashboard.qsParam("t_ms");
    if (raw == null || raw === "") return null;
    var n = Number(raw);
    return isNaN(n) ? null : Math.max(0, Math.round(n));
  }

  async function loadFromRecording(recordingId, tMs) {
    checkpointStatus = "loading";
    checkpointError = "";
    checkpointPayload = null;
    refreshPanel(tMs);
    try {
      var archive = await QLDashboard.fetchStatsJson(
        "/api/stream/results/" + encodeURIComponent(recordingId),
      );
      lastArchive = A().normalizeArchiveCombatClock(archive);
      if (tMs == null) {
        tMs = A().computeTimelineMaxMs(lastArchive, null);
      }
      var data = await QLDashboard.fetchStatsJson(
        "/api/replays/" +
          encodeURIComponent(recordingId) +
          "/checkpoint?t_ms=" +
          encodeURIComponent(String(tMs || 0)),
      );
      checkpointPayload = data;
      checkpointStatus = "ready";
      checkpointError = "";
    } catch (err) {
      checkpointPayload = null;
      checkpointStatus = "error";
      checkpointError = String((err && err.message) || err);
    }
    refreshPanel(tMs);
  }

  function refreshPanel(tMs) {
    var host = document.getElementById("restore-editor-host");
    if (!host || typeof QLRestoreEditor === "undefined") return;
    QLRestoreEditor.mount(host, {
      status: checkpointStatus,
      payload: checkpointPayload,
      error: checkpointError,
      tMs: tMs,
      archive: lastArchive,
      standalone: true,
      onPayload: function (payload) {
        checkpointPayload = payload;
        checkpointStatus = "ready";
      },
    });
  }

  function mountEmpty(root) {
    activeRecordingId = null;
    lastArchive = null;
    checkpointPayload = null;
    checkpointStatus = "ready";
    checkpointError = "";
    root.innerHTML =
      '<section class="control-section">' +
      "<h2>" +
      QLDashboard.escapeHtml(QLDashboard.t("restorePageTitle")) +
      "</h2>" +
      '<p class="control-field-hint">' +
      QLDashboard.escapeHtml(QLDashboard.t("restorePageHint")) +
      "</p>" +
      '<div id="restore-editor-host"></div>' +
      "</section>";
    refreshPanel(parseTimeMs() || 0);
  }

  function mountFromRecording(root, recordingId) {
    activeRecordingId = recordingId;
    root.innerHTML =
      '<section class="control-section">' +
      "<h2>" +
      QLDashboard.escapeHtml(QLDashboard.t("restorePageTitle")) +
      "</h2>" +
      '<p class="control-field-hint">' +
      QLDashboard.escapeHtml(QLDashboard.t("restorePageFromResult")) +
      ' <a href="#/results/' +
      QLDashboard.escapeHtml(encodeURIComponent(recordingId)) +
      '">' +
      QLDashboard.escapeHtml(recordingId) +
      "</a></p>" +
      '<div id="restore-editor-host"></div>' +
      "</section>";
    loadFromRecording(recordingId, parseTimeMs());
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
      mountFromRecording(root, route.param);
      return;
    }
    mountEmpty(root);
  }

  QLDashboard.registerView("restore", {
    mount: mount,
    onLangChanged: function () {
      var route = QLDashboard.parseRoute();
      var root = document.getElementById("app-main");
      if (root && route.view === "restore") mount(root, route);
    },
  });
})();
