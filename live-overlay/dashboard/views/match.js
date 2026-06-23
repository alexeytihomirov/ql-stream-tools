(function () {
  "use strict";

  var pollTimer = null;
  var activeMatchId = null;

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    activeMatchId = null;
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
    };
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

  function renderAnalytics(archive, livePlayers, debug) {
    var deaths = archive.deaths || [];
    var pickups = archive.pickups || [];
    var accuracy = enrichAccuracyNicknames(archive, livePlayers);
    var emptyNote =
      !debug && !deaths.length && !pickups.length && !accuracy.length
        ? '<p class="match-analytics-empty">' +
          QLDashboard.escapeHtml(QLDashboard.t("matchAnalyticsEmpty")) +
          "<br />" +
          QLDashboard.escapeHtml(QLDashboard.t("matchAnalyticsHint")) +
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

  function mount(root, route) {
    stopPoll();
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
    pollTimer = setInterval(function () {
      if (activeMatchId) loadMatch(activeMatchId);
    }, 3000);
  }

  function unmount() {
    stopPoll();
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
      archive = { deaths: [], pickups: [], accuracy_summary: [], players: [] };
    }

    var analyticsWrap = document.getElementById("match-analytics-wrap");
    if (analyticsWrap) {
      analyticsWrap.innerHTML = renderAnalytics(
        archive,
        liveData && liveData.players,
        debug,
      );
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
