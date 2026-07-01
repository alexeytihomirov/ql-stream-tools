(function () {
  "use strict";

  var clockTimer = null;

  function mount(root) {
    root.innerHTML =
      '<section class="control-section">' +
      "<h2>" +
      QLDashboard.t("sectionMatches") +
      "</h2>" +
      '<p id="home-status" class="control-status" role="status"></p>' +
      '<table class="matches-table"><thead><tr>' +
      "<th>" +
      QLDashboard.t("colScore") +
      "</th><th>" +
      QLDashboard.t("colMap") +
      "</th><th>" +
      QLDashboard.t("colStatus") +
      "</th><th>" +
      QLDashboard.t("colServer") +
      "</th><th>" +
      QLDashboard.t("colActions") +
      "</th></tr></thead>" +
      '<tbody id="home-matches-body"></tbody></table>' +
      "</section>";

    QLDashboard.setStatusHandler(function (text, kind) {
      var el = document.getElementById("home-status");
      if (!el) return;
      el.textContent = text || "";
      el.classList.remove("error", "ok");
      if (kind) el.classList.add(kind);
    });

    renderMatches();
    startClock();
  }

  function unmount() {
    stopClock();
    QLDashboard.setStatusHandler(null);
  }

  function startClock() {
    stopClock();
    clockTimer = setInterval(function () {
      if (document.getElementById("home-matches-body")) renderMatches();
    }, 1000);
  }

  function stopClock() {
    if (clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  }

  function renderMatches() {
    var body = document.getElementById("home-matches-body");
    if (!body) return;
    var matches = QLDashboard.matches;
    body.innerHTML = "";

    if (!matches.length) {
      var tr = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 5;
      td.textContent = QLDashboard.t("matchesEmpty");
      td.className = "control-field-hint";
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }

    for (var i = 0; i < matches.length; i++) {
      var row = matches[i];
      var mid = row.match_id || "";
      var connect = QLDashboard.connectForMatch(mid);
      var tr2 = document.createElement("tr");

      var scoreCell = document.createElement("td");
      scoreCell.innerHTML =
        "<strong>" +
        QLDashboard.escapeHtml(QLDashboard.matchScoreSummary(row)) +
        "</strong>" +
        (connect
          ? '<div class="match-id">/connect ' + QLDashboard.escapeHtml(connect) + "</div>"
          : "") +
        '<div class="match-id">' +
        QLDashboard.escapeHtml(mid) +
        "</div>";

      var mapCell = document.createElement("td");
      mapCell.textContent = [row.map_name, row.gametype].filter(Boolean).join(" · ") || "—";

      var statusCell = document.createElement("td");
      var badge = document.createElement("span");
      badge.className = "badge " + QLDashboard.statusBadgeClass(row);
      badge.textContent = QLDashboard.matchPhaseLabel(row);
      statusCell.appendChild(badge);
      var elapsed = QLDashboard.computeMatchElapsedSec(row);
      if (elapsed != null) {
        var clock = document.createElement("span");
        clock.className = "match-clock";
        clock.textContent = QLDashboard.formatClockSec(elapsed);
        statusCell.appendChild(clock);
      }

      var serverCell = document.createElement("td");
      serverCell.innerHTML = QLDashboard.serverLocationHtml(row);

      var actionsCell = document.createElement("td");
      var actions = document.createElement("div");
      actions.className = "match-actions";
      (function (boundMatchId) {
        actions.appendChild(
          QLDashboard.makeActionBtn(QLDashboard.t("openServer"), function () {
            QLDashboard.navigate("#/server/" + encodeURIComponent(boundMatchId));
          }),
        );
        actions.appendChild(
          QLDashboard.makeActionBtn(QLDashboard.t("openMap"), function () {
            QLDashboard.openWindow(
              QLDashboard.liveOverlayUrl("map", boundMatchId),
              "ql-map-" + boundMatchId,
            );
          }),
        );
      })(mid);
      actionsCell.appendChild(actions);

      tr2.appendChild(scoreCell);
      tr2.appendChild(mapCell);
      tr2.appendChild(statusCell);
      tr2.appendChild(serverCell);
      tr2.appendChild(actionsCell);
      body.appendChild(tr2);
    }
  }

  QLDashboard.registerView("home", {
    mount: mount,
    unmount: unmount,
    onMatchesUpdated: renderMatches,
    onLangChanged: function () {
      var root = document.getElementById("app-main");
      if (root) mount(root);
    },
  });
})();
