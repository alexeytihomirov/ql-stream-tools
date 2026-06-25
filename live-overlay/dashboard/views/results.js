(function () {
  "use strict";

  var A = function () {
    return QLDashboardAnalytics;
  };

  var pollTimer = null;
  var activeRecordingId = null;
  var lastArchive = null;
  var scrubGameTimeMs = null;

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

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    activeRecordingId = null;
  }

  function bindTimelineScrubber() {
    var scrub = document.getElementById("match-timeline-scrub");
    if (!scrub || scrub.dataset.qlBound) return;
    scrub.dataset.qlBound = "1";
    var maxMs = A().computeTimelineMaxMs(lastArchive, null);
    scrub.addEventListener("input", function () {
      scrubGameTimeMs = Number(scrub.value);
      var label = document.getElementById("match-timeline-label");
      if (label) label.textContent = A().formatGameTime(scrubGameTimeMs);
      refreshDetailAnalyticsPanels();
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
        var serverUrl = "#/server/" + encodeURIComponent(matchId);
        var listUrl = matchId
          ? "#/results?server=" + encodeURIComponent(matchId)
          : "#/results";
        actionsEl.innerHTML =
          (replayUrl
            ? '<a class="control-btn control-btn-primary" href="' +
              QLDashboard.escapeHtml(replayUrl) +
              '" target="_blank" rel="noopener noreferrer">' +
              QLDashboard.escapeHtml(QLDashboard.t("matchOpenReplay")) +
              "</a> "
            : "") +
          '<a class="control-btn" href="' +
          QLDashboard.escapeHtml(serverUrl) +
          '">' +
          QLDashboard.escapeHtml(QLDashboard.t("navServer")) +
          '</a> <a class="control-btn" href="' +
          QLDashboard.escapeHtml(listUrl) +
          '">' +
          QLDashboard.escapeHtml(QLDashboard.t("resultsBackList")) +
          "</a>" +
          (QLDashboard.hasStatsApiToken() && recordingId
            ? ' <button type="button" class="control-btn control-btn-danger" data-ql-delete-result="' +
              QLDashboard.escapeHtml(recordingId) +
              '">' +
              QLDashboard.escapeHtml(QLDashboard.t("resultsDelete")) +
              "</button>"
            : "");
        bindDeleteButtons(actionsEl);
      }
      if (analyticsEl) {
        analyticsEl.innerHTML = A().renderAnalytics(archive, archive.players, {
          scrubMs: scrubGameTimeMs,
          liveData: null,
        });
        bindTimelineScrubber();
      }
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = QLDashboard.t("resultsNotFound");
        statusEl.classList.add("error");
      }
      if (analyticsEl) analyticsEl.innerHTML = "";
      if (actionsEl) actionsEl.innerHTML = "";
      if (metaEl) metaEl.textContent = "";
    }
  }

  function mountDetail(root, recordingId) {
    stopPoll();
    activeRecordingId = recordingId;
    lastArchive = null;
    scrubGameTimeMs = null;

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
