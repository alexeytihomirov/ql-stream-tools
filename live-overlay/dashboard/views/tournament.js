(function () {
  "use strict";

  var playerMap = {};

  function mount(root) {
    root.innerHTML =
      '<section class="control-section" id="tournament-meta-section">' +
      "<h2>" +
      QLDashboard.t("sectionTournament") +
      "</h2>" +
      '<div id="tournament-meta" class="tournament-meta"><p class="control-field-hint">' +
      QLDashboard.t("tournamentMetaLoading") +
      "</p></div>" +
      "</section>" +
      '<section class="control-section" id="tournament-players-section">' +
      "<h2>" +
      QLDashboard.t("tournamentPlayers") +
      "</h2>" +
      '<div id="tournament-players"></div>' +
      "</section>" +
      '<section class="control-section" id="tournament-bracket-section">' +
      "<h2>" +
      QLDashboard.t("tournamentBracket") +
      "</h2>" +
      '<div id="tournament-bracket"></div>' +
      "</section>" +
      '<section class="control-section" id="tournament-stats-section">' +
      "<h2>" +
      QLDashboard.t("tournamentStats") +
      "</h2>" +
      '<div id="tournament-stats"></div>' +
      "</section>" +
      '<section class="control-section" id="tournament-demos-section">' +
      "<h2>" +
      QLDashboard.t("tournamentDemos") +
      "</h2>" +
      '<div id="tournament-demos"></div>' +
      "</section>" +
      '<section class="control-section">' +
      "<h2>" +
      QLDashboard.t("tournamentRegulations") +
      "</h2>" +
      '<p class="control-field-hint">' +
      QLDashboard.t("linkPlayerGuideHint") +
      "</p>" +
      '<button type="button" id="tournament-guide-btn" class="control-btn">' +
      QLDashboard.t("tournamentOpenGuide") +
      "</button>" +
      "</section>";

    document.getElementById("tournament-guide-btn").addEventListener("click", function () {
      QLDashboard.openWindow(QLDashboard.playerGuideUrl(), "ql-player-guide");
    });

    loadAll();
  }

  function playerNickname(id) {
    if (playerMap[id]) return playerMap[id];
    return id || "—";
  }

  function renderMeta() {
    var el = document.getElementById("tournament-meta");
    if (!el) return;
    var slug = QLDashboard.settings.tournamentSlug;
    if (!slug) {
      el.innerHTML =
        '<p class="control-field-hint">' + QLDashboard.escapeHtml(QLDashboard.t("tournamentEmpty")) + "</p>";
      return;
    }
    var meta = QLDashboard.tournamentMeta;
    var name = QLDashboard.tournamentName();
    var status = meta && meta.status ? meta.status : "";
    var html =
      '<div class="tournament-meta-name">' +
      QLDashboard.escapeHtml(name) +
      "</div>" +
      '<div class="tournament-meta-slug">' +
      QLDashboard.escapeHtml(slug) +
      "</div>";
    if (status) {
      html +=
        ' <span class="badge ' +
        QLDashboard.statusBadgeClass(status) +
        '">' +
        QLDashboard.escapeHtml(status) +
        "</span>";
    }
    el.innerHTML = html;
  }

  function renderPlayers(data) {
    var el = document.getElementById("tournament-players");
    if (!el) return;
    playerMap = {};
    if (!data || !Array.isArray(data.players) || !data.players.length) {
      el.innerHTML =
        '<p class="control-field-hint">' + QLDashboard.escapeHtml(QLDashboard.t("tournamentNoPlayers")) + "</p>";
      return;
    }
    var html = '<table class="data-table"><thead><tr><th>#</th><th>Nick</th><th>Country</th></tr></thead><tbody>';
    for (var i = 0; i < data.players.length; i++) {
      var p = data.players[i];
      playerMap[p.id] = p.nickname || p.id;
      html +=
        "<tr><td>" +
        (i + 1) +
        "</td><td>" +
        QLDashboard.escapeHtml(p.nickname || p.id) +
        "</td><td>" +
        QLDashboard.escapeHtml(p.country || "—") +
        "</td></tr>";
    }
    html += "</tbody></table>";
    el.innerHTML = html;
  }

  function renderBracket(data) {
    var el = document.getElementById("tournament-bracket");
    if (!el) return;
    if (!data || !Array.isArray(data.matches) || !data.matches.length) {
      el.innerHTML =
        '<p class="control-field-hint">' + QLDashboard.escapeHtml(QLDashboard.t("tournamentNoBracket")) + "</p>";
      return;
    }
    var html = '<div class="bracket-list">';
    var list = data.matches.slice().sort(function (a, b) {
      return (a.round || 0) - (b.round || 0) || (a.slot || 0) - (b.slot || 0);
    });
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      var p1 = playerNickname(m.player1_id);
      var p2 = playerNickname(m.player2_id);
      var label =
        m.match_label ||
        QLDashboard.t("bracketMatch", { id: m.id }) +
          (m.round != null ? " · R" + m.round : "");
      var games = "";
      if (Array.isArray(m.games) && m.games.length) {
        games = m.games
          .map(function (g) {
            return (g.map_name || "?") + (g.score_text ? " " + g.score_text : "");
          })
          .join(", ");
      }
      html +=
        '<div class="bracket-row"><strong>' +
        QLDashboard.escapeHtml(label) +
        "</strong> · " +
        QLDashboard.escapeHtml(p1) +
        " vs " +
        QLDashboard.escapeHtml(p2) +
        (m.status ? ' <span class="badge badge-other">' + QLDashboard.escapeHtml(m.status) + "</span>" : "") +
        (games ? '<div class="control-field-hint">' + QLDashboard.escapeHtml(games) + "</div>" : "") +
        "</div>";
    }
    html += "</div>";
    el.innerHTML = html;
  }

  function renderStats(summary, players) {
    var el = document.getElementById("tournament-stats");
    if (!el) return;
    if (!summary && (!players || !players.players || !players.players.length)) {
      el.innerHTML =
        '<p class="control-field-hint">' + QLDashboard.escapeHtml(QLDashboard.t("tournamentNoStats")) + "</p>";
      return;
    }
    var html = "";
    if (summary) {
      html += '<div class="stats-grid">';
      if (summary.matches_ended != null) {
        html +=
          '<div class="stat-card"><div class="stat-card-value">' +
          summary.matches_ended +
          '</div><div class="stat-card-label">' +
          QLDashboard.escapeHtml(QLDashboard.t("statsMatches")) +
          "</div></div>";
      }
      if (summary.maps_played != null) {
        html +=
          '<div class="stat-card"><div class="stat-card-value">' +
          summary.maps_played +
          '</div><div class="stat-card-label">' +
          QLDashboard.escapeHtml(QLDashboard.t("statsMaps")) +
          "</div></div>";
      }
      if (summary.total_kills != null) {
        html +=
          '<div class="stat-card"><div class="stat-card-value">' +
          summary.total_kills +
          '</div><div class="stat-card-label">' +
          QLDashboard.escapeHtml(QLDashboard.t("statsKills")) +
          "</div></div>";
      }
      if (summary.total_deaths != null) {
        html +=
          '<div class="stat-card"><div class="stat-card-value">' +
          summary.total_deaths +
          '</div><div class="stat-card-label">' +
          QLDashboard.escapeHtml(QLDashboard.t("statsDeaths")) +
          "</div></div>";
      }
      html += "</div>";
    }
    if (players && Array.isArray(players.players) && players.players.length) {
      html += '<table class="data-table" style="margin-top:12px"><thead><tr><th>Player</th><th>W</th><th>K</th><th>D</th></tr></thead><tbody>';
      var sorted = players.players.slice().sort(function (a, b) {
        return (b.wins || 0) - (a.wins || 0);
      });
      for (var i = 0; i < sorted.length; i++) {
        var p = sorted[i];
        html +=
          "<tr><td>" +
          QLDashboard.escapeHtml(p.nickname || playerNickname(p.id)) +
          "</td><td>" +
          (p.wins || 0) +
          "</td><td>" +
          (p.kills || 0) +
          "</td><td>" +
          (p.deaths || 0) +
          "</td></tr>";
      }
      html += "</tbody></table>";
    }
    el.innerHTML = html;
  }

  function renderDemos(data) {
    var el = document.getElementById("tournament-demos");
    if (!el) return;
    if (!data || !Array.isArray(data.demos) || !data.demos.length) {
      el.innerHTML =
        '<p class="control-field-hint">' + QLDashboard.escapeHtml(QLDashboard.t("tournamentNoDemos")) + "</p>";
      return;
    }
    var html = '<table class="data-table"><thead><tr><th>' +
      QLDashboard.escapeHtml(QLDashboard.t("demoMap")) +
      "</th><th>" +
      QLDashboard.escapeHtml(QLDashboard.t("demoPlayers")) +
      "</th><th></th></tr></thead><tbody>";
    for (var i = 0; i < data.demos.length; i++) {
      var d = data.demos[i];
      var players = "";
      if (Array.isArray(d.player_ids)) {
        players = d.player_ids.map(playerNickname).join(" vs ");
      } else if (Array.isArray(d.players)) {
        players = d.players.join(" vs ");
      }
      var link = d.url
        ? '<a href="' +
          QLDashboard.escapeHtml(d.url) +
          '" target="_blank" rel="noopener">' +
          QLDashboard.escapeHtml(QLDashboard.t("demoDownload")) +
          "</a>"
        : "—";
      html +=
        "<tr><td>" +
        QLDashboard.escapeHtml(d.map_name || d.filename || "—") +
        "</td><td>" +
        QLDashboard.escapeHtml(players || "—") +
        "</td><td>" +
        link +
        "</td></tr>";
    }
    html += "</tbody></table>";
    el.innerHTML = html;
  }

  async function loadAll() {
    renderMeta();
    var players = await QLDashboard.fetchTournamentFile("players.json");
    renderPlayers(players);
    var bracket = await QLDashboard.fetchTournamentFile("bracket.json");
    renderBracket(bracket);
    var summary = await QLDashboard.fetchTournamentFile("stats/summary.json");
    var statsPlayers = await QLDashboard.fetchTournamentFile("stats/players.json");
    renderStats(summary, statsPlayers);
    var demos = await QLDashboard.fetchTournamentFile("demos.json");
    renderDemos(demos);
  }

  QLDashboard.registerView("tournament", {
    mount: mount,
    onDataUpdated: function () {
      var root = document.getElementById("app-main");
      if (root && root.querySelector("#tournament-meta-section")) loadAll();
    },
    onLangChanged: function () {
      var root = document.getElementById("app-main");
      if (root) mount(root);
    },
  });
})();
