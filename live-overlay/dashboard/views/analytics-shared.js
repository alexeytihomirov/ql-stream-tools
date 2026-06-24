(function (global) {
  "use strict";

  function stripQuakeColors(text) {
    return String(text || "")
      .replace(/\^[0-9a-zA-Z]/g, "")
      .trim();
  }

  function displayNickname(row) {
    var nick = stripQuakeColors(row.nickname || row.player || row.steam_id64);
    return nick || "—";
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

  function combatEventRows(archive) {
    if (!archive) return [];
    return (archive.deaths || [])
      .concat(archive.accuracy_timeline || [])
      .concat(archive.accuracy_summary || []);
  }

  function computeTimelineMinMs(archive) {
    var minMs = Number(archive && archive.timeline_min_ms);
    if (!isNaN(minMs) && minMs >= 0) return minMs;
    var min = null;
    combatEventRows(archive).forEach(function (row) {
      var gt = Number(row.game_time_ms);
      if (isNaN(gt) || gt < 0) return;
      if (min == null || gt < min) min = gt;
    });
    (archive && archive.pickups || []).forEach(function (row) {
      var gt = Number(row.game_time_ms);
      if (isNaN(gt) || gt < 0) return;
      if (min == null || gt < min) min = gt;
    });
    return min != null ? min : 0;
  }

  function computeTimelineMaxMs(archive, liveData) {
    var maxMs = Number(archive && archive.timeline_max_ms);
    if (isNaN(maxMs) || maxMs <= 0) {
      maxMs = 0;
      combatEventRows(archive).forEach(function (row) {
        var gt = Number(row.game_time_ms);
        if (!isNaN(gt) && gt > maxMs) maxMs = gt;
      });
    }
    if (liveData && liveData.phase === "playing" && !liveData.warmup && !liveData.countdown) {
      var elapsed = QLDashboard.computeMatchElapsedSec(liveData);
      if (elapsed != null) maxMs = Math.max(maxMs, elapsed * 1000);
    }
    return maxMs > 0 ? maxMs : null;
  }

  function enrichAccuracyNicknames(archive, livePlayers) {
    var bySteam = {};
    (livePlayers || []).forEach(function (p) {
      if (p.steam_id64) {
        bySteam[p.steam_id64] =
          stripQuakeColors(p.nickname) || p.steam_id64;
      }
    });
    (archive.players || []).forEach(function (p) {
      if (p.steam_id64) {
        bySteam[p.steam_id64] =
          stripQuakeColors(p.nickname) || p.steam_id64;
      }
    });
    return (archive.accuracy_summary || []).map(function (row) {
      var nick = stripQuakeColors(row.nickname);
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
        QLDashboard.escapeHtml(
          stripQuakeColors(d.killer) || QLDashboard.t("matchWorldSuicide"),
        ) +
        "</span><span>" +
        QLDashboard.escapeHtml(stripQuakeColors(d.victim) || "—") +
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
        QLDashboard.escapeHtml(displayNickname(p)) +
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
        QLDashboard.escapeHtml(displayNickname(r)) +
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
        QLDashboard.escapeHtml(stripQuakeColors(r.killer) || "—") +
        "</td><td>" +
        QLDashboard.escapeHtml(r.weapon) +
        "</td><td>" +
        r.kills +
        "</td></tr>";
    }
    html += "</tbody></table>";
    return html;
  }

  function renderTimelineScrubber(archive, liveData, scrubGameTimeMs) {
    var maxMs = computeTimelineMaxMs(archive, liveData);
    if (!maxMs) return "";
    var minMs = computeTimelineMinMs(archive);
    var currentMs = scrubGameTimeMs != null ? scrubGameTimeMs : maxMs;
    if (currentMs < minMs) currentMs = minMs;
    if (currentMs > maxMs) currentMs = maxMs;
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
      '<input type="range" id="match-timeline-scrub" class="match-timeline-scrub" min="' +
      minMs +
      '" max="' +
      maxMs +
      '" step="100" value="' +
      currentMs +
      '" />' +
      '<div class="match-timeline-actions">' +
      '<button type="button" id="match-timeline-live" class="control-btn control-btn-sm">' +
      QLDashboard.escapeHtml(QLDashboard.t("matchTimelineLive")) +
      "</button>" +
      "</div></div>";
    return html;
  }

  function renderAnalytics(archive, livePlayers, opts) {
    opts = opts || {};
    var debug = !!opts.debug;
    var scrubMs = opts.scrubMs;
    var liveData = opts.liveData || null;
    var showTimeline = opts.showTimeline !== false;

    var maxMs = computeTimelineMaxMs(archive, liveData);
    var atEnd = scrubMs == null || (maxMs != null && Number(scrubMs) >= maxMs);
    var deaths = filterRowsByGameTime(archive.deaths || [], scrubMs);
    // Combat-only timeline_max can sit before last pickup; show full snapshot at end.
    var pickups = atEnd
      ? archive.pickups || []
      : filterRowsByGameTime(archive.pickups || [], scrubMs);
    var summary = enrichAccuracyNicknames(archive, livePlayers);
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

    if (showTimeline) {
      html += renderTimelineScrubber(archive, liveData, scrubMs);
    }

    if (emptyNote && !debug) {
      html += emptyNote;
      return html;
    }

    if (accuracyNote) {
      html += accuracyNote;
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

  function formatReplayDuration(ms) {
    if (ms == null || isNaN(ms)) return "—";
    var sec = Math.max(0, Math.floor(Number(ms) / 1000));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function formatWhen(isoOrMs) {
    if (isoOrMs == null || isoOrMs === "") return "—";
    try {
      var d = typeof isoOrMs === "number" ? new Date(isoOrMs) : new Date(String(isoOrMs));
      if (isNaN(d.getTime())) return String(isoOrMs);
      return d.toLocaleString();
    } catch (_e) {
      return String(isoOrMs);
    }
  }

  global.QLDashboardAnalytics = {
    stripQuakeColors: stripQuakeColors,
    displayNickname: displayNickname,
    formatGameTime: formatGameTime,
    formatReplayDuration: formatReplayDuration,
    formatWhen: formatWhen,
    computeTimelineMaxMs: computeTimelineMaxMs,
    computeTimelineMinMs: computeTimelineMinMs,
    renderAnalytics: renderAnalytics,
    renderTimelineScrubber: renderTimelineScrubber,
    filterRowsByGameTime: filterRowsByGameTime,
    accuracyAtScrub: accuracyAtScrub,
  };
})(typeof window !== "undefined" ? window : globalThis);
