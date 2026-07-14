(function (global) {
  "use strict";

  function stripQuakeColors(text) {
    return String(text || "")
      .replace(/\^[0-9a-zA-Z]/g, "")
      .trim();
  }

  function isSteamId64(text) {
    return /^7656119\d{10}$/.test(String(text || "").trim());
  }

  // Collect steam_id64 -> nickname from every archive/live source so a missing
  // accuracy row nickname can still resolve (e.g. killer name only on deaths).
  function buildNicknameBySteam(archive, livePlayers) {
    var bySteam = {};
    function add(steam, nick) {
      steam = String(steam || "").trim();
      nick = stripQuakeColors(nick);
      if (!steam || !nick || isSteamId64(nick)) return;
      if (!bySteam[steam] || isSteamId64(bySteam[steam])) bySteam[steam] = nick;
    }
    function absorb(list) {
      (list || []).forEach(function (p) {
        add(p.steam_id64, p.nickname || p.name);
      });
    }
    absorb(livePlayers);
    if (archive) {
      absorb(archive.players);
      (archive.deaths || []).forEach(function (d) {
        add(d.killer_steam_id64, d.killer);
        add(d.victim_steam_id64, d.victim);
      });
      (archive.pickups || []).forEach(function (p) {
        add(p.steam_id64, p.nickname);
      });
      (archive.accuracy_summary || [])
        .concat(archive.accuracy_timeline || [])
        .forEach(function (r) {
          add(r.steam_id64, r.nickname);
        });
    }
    return bySteam;
  }

  function displayNickname(row, nickBySteam) {
    var steam = String((row && row.steam_id64) || "").trim();
    var nick = stripQuakeColors((row && (row.nickname || row.player)) || "");
    if ((!nick || isSteamId64(nick)) && steam && nickBySteam && nickBySteam[steam]) {
      nick = nickBySteam[steam];
    }
    if (!nick) nick = steam;
    return nick || "—";
  }

  function titleCase(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/\b([a-z])/g, function (_m, c) {
        return c.toUpperCase();
      });
  }

  // Sprite filenames mirror live-overlay/maps/sprite-map.json (pak00 HUD icons),
  // resolved through MapCoords so the dashboard uses the same asset base as the
  // embedded map widget.
  var SPRITE_FILES = {
    item_health_small: "iconh_green.png",
    item_health: "iconh_yellow.png",
    item_health_large: "iconh_red.png",
    item_health_mega: "iconh_mega.png",
    item_armor_jacket: "iconr_green.png",
    item_armor_shard: "iconr_shard.png",
    item_armor_combat: "iconr_yellow.png",
    item_armor_body: "iconr_red.png",
    item_quad: "quad.png",
    item_regen: "regen.png",
    item_haste: "haste.png",
    item_enviro: "envirosuit.png",
    item_invis: "invis.png",
    item_invulnerability: "invulnerability.png",
    item_flight: "flight.png",
    ammo_bullets: "icona_machinegun.png",
    ammo_cells: "icona_plasma.png",
    ammo_grenades: "icona_grenade.png",
    ammo_lightning: "icona_lightning.png",
    ammo_rockets: "icona_rocket.png",
    ammo_shells: "icona_shotgun.png",
    ammo_slugs: "icona_railgun.png",
    ammo_pack: "ammo_pack.png",
    weapon_bfg: "iconw_bfg.png",
    weapon_gauntlet: "iconw_gauntlet.png",
    weapon_grapple: "iconw_grapple.png",
    weapon_grenadelauncher: "iconw_grenade.png",
    weapon_lightning: "iconw_lightning.png",
    weapon_machinegun: "iconw_machinegun.png",
    weapon_plasmagun: "iconw_plasma.png",
    weapon_railgun: "iconw_railgun.png",
    weapon_rocketlauncher: "iconw_rocket.png",
    weapon_shotgun: "iconw_shotgun.png",
  };

  // Short pickup labels (callouts) per classname; ql-items SKILL abbreviations.
  var ITEM_LABELS = {
    item_health_small: "5HP",
    item_health: "25HP",
    item_health_large: "50HP",
    item_health_mega: "MH",
    item_armor_jacket: "GA",
    item_armor_shard: "Shard",
    item_armor_combat: "YA",
    item_armor_body: "RA",
    item_quad: "Quad",
    item_regen: "Regen",
    item_haste: "Haste",
    item_enviro: "BS",
    item_invis: "Invis",
    item_invulnerability: "Invuln",
    item_flight: "Flight",
    ammo_bullets: "MG ammo",
    ammo_cells: "PG ammo",
    ammo_grenades: "GL ammo",
    ammo_lightning: "LG ammo",
    ammo_rockets: "RL ammo",
    ammo_shells: "SG ammo",
    ammo_slugs: "RG ammo",
    ammo_pack: "Ammo",
    weapon_bfg: "BFG",
    weapon_gauntlet: "Gauntlet",
    weapon_grapple: "Grapple",
    weapon_grenadelauncher: "GL",
    weapon_lightning: "LG",
    weapon_machinegun: "MG",
    weapon_plasmagun: "PG",
    weapon_railgun: "RG",
    weapon_rocketlauncher: "RL",
    weapon_shotgun: "SG",
  };

  // Death `weapon` arrives as the QL MOD with `MOD_` stripped, `_`->space,
  // uppercased (session_events.py); accuracy rows arrive as 2-3 letter abbrs
  // (zmq_weapon_stats.py). Map both token forms to a weapon classname.
  var WEAPON_BY_TOKEN = {
    RL: "weapon_rocketlauncher",
    ROCKET: "weapon_rocketlauncher",
    "ROCKET LAUNCHER": "weapon_rocketlauncher",
    ROCKETLAUNCHER: "weapon_rocketlauncher",
    RG: "weapon_railgun",
    RAIL: "weapon_railgun",
    RAILGUN: "weapon_railgun",
    LG: "weapon_lightning",
    LIGHTNING: "weapon_lightning",
    "LIGHTNING GUN": "weapon_lightning",
    LIGHTNINGGUN: "weapon_lightning",
    PG: "weapon_plasmagun",
    PLASMA: "weapon_plasmagun",
    PLASMAGUN: "weapon_plasmagun",
    "PLASMA GUN": "weapon_plasmagun",
    GL: "weapon_grenadelauncher",
    GRENADE: "weapon_grenadelauncher",
    "GRENADE LAUNCHER": "weapon_grenadelauncher",
    GRENADELAUNCHER: "weapon_grenadelauncher",
    SG: "weapon_shotgun",
    SHOTGUN: "weapon_shotgun",
    MG: "weapon_machinegun",
    MACHINEGUN: "weapon_machinegun",
    "MACHINE GUN": "weapon_machinegun",
    HMG: "weapon_machinegun",
    "HEAVY MACHINEGUN": "weapon_machinegun",
    GA: "weapon_gauntlet",
    G: "weapon_gauntlet",
    GAUNTLET: "weapon_gauntlet",
    BFG: "weapon_bfg",
    NG: "weapon_nailgun",
    NAILGUN: "weapon_nailgun",
    CG: "weapon_chaingun",
    CHAINGUN: "weapon_chaingun",
    GRAPPLE: "weapon_grapple",
    PL: "weapon_proxlauncher",
    PROXLAUNCHER: "weapon_proxlauncher",
  };

  // Display abbreviation by recognized token (kept distinct where the sprite
  // is shared, e.g. HMG reuses the machinegun icon but reads "HMG").
  var WEAPON_ABBR_BY_TOKEN = {
    HMG: "HMG",
    "HEAVY MACHINEGUN": "HMG",
    NG: "NG",
    NAILGUN: "NG",
    CG: "CG",
    CHAINGUN: "CG",
  };

  var WEAPON_ABBR_BY_CLASS = {
    weapon_rocketlauncher: "RL",
    weapon_railgun: "RG",
    weapon_lightning: "LG",
    weapon_plasmagun: "PG",
    weapon_grenadelauncher: "GL",
    weapon_shotgun: "SG",
    weapon_machinegun: "MG",
    weapon_gauntlet: "GA",
    weapon_bfg: "BFG",
    weapon_grapple: "GH",
    weapon_nailgun: "NG",
    weapon_chaingun: "CG",
    weapon_proxlauncher: "PL",
  };

  // Mirror stats_hub/zmq_ingest.py `_NON_COMBAT_WEAPONS` — excluded from weapon stats.
  var NON_COMBAT_DEATH_WEAPONS = {
    SUICIDE: true,
    SUICIDES: true,
    FALLING: true,
    WATER: true,
    SLIME: true,
    LAVA: true,
    CRUSH: true,
    TELEFRAG: true,
    TRIGGER_HURT: true,
    SWITCHTEAM: true,
    SPECTATOR: true,
    WORLD: true,
    ENVIRONMENT: true,
    ENVIRONMENTAL: true,
  };

  function normalizeDeathWeaponToken(raw) {
    if (raw == null || raw === "") return "";
    return String(raw)
      .trim()
      .toUpperCase()
      .replace(/-/g, "_")
      .replace(/ /g, "_")
      .replace(/^MOD_/, "");
  }

  function isNonCombatDeath(d) {
    if (!d) return true;
    var killerSid = String(d.killer_steam_id64 || "").trim();
    var victimSid = String(d.victim_steam_id64 || "").trim();
    if (killerSid && victimSid && killerSid === victimSid) return true;
    var weaponKey = normalizeDeathWeaponToken(d.weapon);
    if (weaponKey && NON_COMBAT_DEATH_WEAPONS[weaponKey]) return true;
    var killer = stripQuakeColors(d.killer).toLowerCase();
    if (killer === "world" || killer === "spectator") return true;
    if (!killerSid && !killer) return true;
    return false;
  }

  function isCombatWeaponInfo(info) {
    return !!(info && info.cls);
  }

  function spriteUrl(file) {
    if (!file) return "";
    if (window.MapCoords && typeof MapCoords.assetUrl === "function") {
      return MapCoords.assetUrl("maps/sprites/" + file);
    }
    return "../maps/sprites/" + file;
  }

  function iconImg(file, alt, extraClass) {
    var url = spriteUrl(file);
    if (!url) return "";
    return (
      '<img class="ql-icon ' +
      (extraClass || "") +
      '" src="' +
      QLDashboard.escapeHtml(url) +
      '" alt="' +
      QLDashboard.escapeHtml(alt || "") +
      '" title="' +
      QLDashboard.escapeHtml(alt || "") +
      '" loading="lazy" onerror="this.style.display=\'none\'" />'
    );
  }

  // Resolve a pickup `item` (classname) to a sprite + short label.
  function itemInfo(item) {
    var key = String(item || "").trim();
    var sprite = SPRITE_FILES[key] || null;
    var label = ITEM_LABELS[key];
    if (!label) {
      var cleaned = key
        .replace(/^item_/, "")
        .replace(/^weapon_/, "")
        .replace(/^ammo_/, "")
        .replace(/_/g, " ")
        .trim();
      label = cleaned ? titleCase(cleaned) : "—";
    }
    return { key: key, sprite: sprite, label: label };
  }

  // Resolve a weapon token (death MOD or accuracy abbr) to sprite + abbr +
  // splash flag. Returns null for empty input.
  function weaponInfo(raw) {
    if (raw == null || raw === "") return null;
    var up = String(raw).toUpperCase().trim();
    var splash = up.indexOf("SPLASH") >= 0;
    var base = up
      .replace(/SPLASH/g, "")
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    var cls = WEAPON_BY_TOKEN[base] || null;
    var abbr = WEAPON_ABBR_BY_TOKEN[base];
    if (!abbr) abbr = cls ? WEAPON_ABBR_BY_CLASS[cls] : null;
    if (!abbr) abbr = base ? titleCase(base) : "—";
    return {
      cls: cls,
      sprite: cls ? SPRITE_FILES[cls] : null,
      abbr: abbr,
      splash: splash,
      label: base ? titleCase(base) : "—",
    };
  }

  function formatGameTime(ms) {
    if (ms == null || isNaN(ms)) return "—";
    var sec = Math.max(0, Math.floor(Number(ms) / 1000));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  // Pre-match countdown lead-in (countdown_start -> match_start wall gap).
  function countdownLeadInMs(archive) {
    var cd = countdownStartWallMs(archive);
    var ms = matchStartWallMs(archive);
    if (cd == null || ms == null) return 0;
    var gap = Math.round(ms - cd);
    return gap > 0 ? gap : 0;
  }

  // Reverse countdown from negative timeline ms (pre-match lead-in before game clock 0).
  function formatCountdownRemainingMs(ms) {
    if (ms == null || isNaN(ms) || Number(ms) >= 0) return null;
    return formatGameTime(Math.max(0, -Number(ms)));
  }

  // Scrub label: negative timeline ms = countdown remaining; >= 0 = game clock.
  function formatTimelineScrubTime(ms, archive) {
    if (ms == null || isNaN(ms)) return "—";
    var minMs = computeTimelineMinMs(archive);
    if (minMs < 0 && Number(ms) < 0) {
      var remaining = formatCountdownRemainingMs(ms);
      if (remaining != null) return remaining;
    }
    return formatGameTime(Math.max(0, Number(ms)));
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

  function parseTsMs(ts) {
    if (!ts) return null;
    var t = Date.parse(ts);
    return isNaN(t) ? null : t;
  }

  function lifecycleMarker(archive, kind) {
    var markers = (archive && archive.markers) || [];
    for (var i = markers.length - 1; i >= 0; i--) {
      var row = markers[i];
      if (row && String(row.kind || "") === kind) return row;
    }
    return null;
  }

  function matchEndGameTimeMs(archive) {
    var row = lifecycleMarker(archive, "match_end");
    if (!row) return null;
    var g = Number(row.game_time_ms);
    if (!isNaN(g) && g >= 0) return g;
    var meta = row.meta || {};
    if (String(meta.end_reason || "").toLowerCase() === "ended" && meta.timelimit_sec != null) {
      var tl = Number(meta.timelimit_sec);
      if (!isNaN(tl) && tl > 0) return Math.round(tl * 1000);
    }
    return null;
  }

  // Wall epoch of game-clock 0 from lifecycle match_start marker.
  function computeCombatClockAnchor(archive) {
    var row = lifecycleMarker(archive, "match_start");
    if (!row) return null;
    return parseTsMs(row.ts);
  }

  function countdownStartWallMs(archive) {
    var row = lifecycleMarker(archive, "countdown_start");
    if (!row) return null;
    return parseTsMs(row.ts);
  }

  function matchStartWallMs(archive) {
    var row = lifecycleMarker(archive, "match_start");
    if (!row) return null;
    return parseTsMs(row.ts);
  }

  function matchEndWallMs(archive) {
    var row = lifecycleMarker(archive, "match_end");
    if (!row) return null;
    return parseTsMs(row.ts);
  }

  function hasLifecycleMarkers(archive) {
    return !!((archive && archive.markers) || []).some(function (row) {
      var k = String((row && row.kind) || "").toLowerCase();
      return (
        k === "countdown_start" ||
        k === "match_start" ||
        k === "match_end" ||
        k === "pause_start" ||
        k === "pause_end"
      );
    });
  }

  function pauseReasonLabel(reason) {
    var key = String(reason || "").toLowerCase();
    if (key === "timeout_vote") return QLDashboard.t("lifecyclePausedTimeout");
    if (key === "admin") return QLDashboard.t("lifecyclePausedAdmin");
    return QLDashboard.t("lifecyclePaused");
  }

  function sortedLifecycleMarkers(archive) {
    var rows = ((archive && archive.markers) || []).slice();
    rows.sort(function (a, b) {
      var ta = parseTsMs(a && a.ts);
      var tb = parseTsMs(b && b.ts);
      if (ta == null && tb == null) return 0;
      if (ta == null) return 1;
      if (tb == null) return -1;
      return ta - tb;
    });
    return rows;
  }

  function pauseIntervalsFromMarkers(archive, liveData) {
    var intervals = [];
    var open = null;
    sortedLifecycleMarkers(archive).forEach(function (row) {
      if (!row) return;
      var kind = String(row.kind || "").toLowerCase();
      if (kind === "pause_start") {
        var startMs = Number(row.game_time_ms);
        if (isNaN(startMs)) startMs = Number((row.meta || {}).elapsed_ms);
        if (isNaN(startMs)) startMs = 0;
        open = {
          startMs: Math.max(0, startMs),
          reason: (row.meta && row.meta.reason) || "admin",
        };
        return;
      }
      if (kind === "pause_end" && open) {
        var durationMs = Number((row.meta || {}).duration_ms);
        if (isNaN(durationMs) || durationMs <= 0) {
          var endMs = Number(row.game_time_ms);
          if (!isNaN(endMs) && endMs > open.startMs) durationMs = endMs - open.startMs;
        }
        if (isNaN(durationMs) || durationMs <= 0) durationMs = 1000;
        intervals.push({
          startMs: open.startMs,
          endMs: open.startMs + durationMs,
          durationMs: durationMs,
          reason: (row.meta && row.meta.reason) || open.reason,
        });
        open = null;
      }
    });
    if (open && liveData && liveData.paused) {
      var liveMs = QLDashboard.computeMatchElapsedSec(liveData);
      var endLive = liveMs != null ? liveMs * 1000 : open.startMs;
      intervals.push({
        startMs: open.startMs,
        endMs: Math.max(open.startMs, endLive),
        durationMs: Math.max(0, endLive - open.startMs),
        reason: open.reason,
        live: true,
      });
    }
    return intervals;
  }

  function lifecycleMarkersOnTimeline(archive) {
    var out = [];
    var minMs = computeTimelineMinMs(archive);
    if (lifecycleMarker(archive, "countdown_start")) {
      out.push({
        kind: "countdown_start",
        gameMs: minMs,
        labelKey: "phaseCountdown",
        css: "countdown",
      });
    }
    if (lifecycleMarker(archive, "match_start")) {
      out.push({
        kind: "match_start",
        gameMs: 0,
        labelKey: "lifecycleMatchStarted",
        css: "started",
      });
    }
    var endMs = matchEndGameTimeMs(archive);
    if (lifecycleMarker(archive, "match_end") && endMs != null) {
      out.push({
        kind: "match_end",
        gameMs: endMs,
        labelKey: "lifecycleMatchEnded",
        css: "ended",
      });
    }
    return out;
  }

  function resolveScrubLifecyclePhase(archive, scrubMs, liveData, opts) {
    opts = opts || {};
    if (liveData) {
      if (QLDashboard.isWarmupPhase(liveData)) {
        return { phase: "warmup", labelKey: "phaseWarmup" };
      }
      if (liveData.phase === "countdown" || liveData.countdown) {
        return { phase: "countdown", labelKey: "phaseCountdown" };
      }
      if (
        liveData.phase === "ended" ||
        String(liveData.status || "").toLowerCase() === "ended"
      ) {
        return { phase: "ended", labelKey: "phaseEnded" };
      }
      if (liveData.phase === "playing" || liveData.phase == null) {
        if (liveData.paused) {
          return { phase: "paused", labelKey: "phasePaused" };
        }
        return { phase: "playing", labelKey: "phaseLive" };
      }
    }
    if (!hasLifecycleMarkers(archive)) return null;

    var replayWallMs = opts.replayWallMs;
    if (replayWallMs != null && isFinite(Number(replayWallMs))) {
      var wall = Number(replayWallMs);
      var cdWall = countdownStartWallMs(archive);
      var msWall = matchStartWallMs(archive);
      var meWall = matchEndWallMs(archive);
      if (meWall != null && wall >= meWall) {
        return { phase: "ended", labelKey: "lifecycleMatchEnded" };
      }
      if (msWall != null && wall >= msWall) {
        if (wall - msWall < 800) {
          return { phase: "started", labelKey: "lifecycleMatchStarted" };
        }
        return { phase: "playing", labelKey: "phaseLive" };
      }
      if (cdWall != null && wall >= cdWall) {
        return { phase: "countdown", labelKey: "phaseCountdown" };
      }
      return null;
    }

    var endMs = matchEndGameTimeMs(archive);
    var ms = scrubMs != null ? Number(scrubMs) : null;
    if (ms == null) return null;
    if (endMs != null && ms >= endMs - 100) {
      return { phase: "ended", labelKey: "lifecycleMatchEnded" };
    }
    if (ms < 0 && lifecycleMarker(archive, "countdown_start")) {
      return { phase: "countdown", labelKey: "phaseCountdown" };
    }
    if (lifecycleMarker(archive, "match_start")) {
      if (ms < 800) {
        return { phase: "started", labelKey: "lifecycleMatchStarted" };
      }
      return { phase: "playing", labelKey: "phaseLive" };
    }
    return null;
  }

  function renderLifecyclePhaseBadge(archive, scrubMs, liveData, opts) {
    var info = resolveScrubLifecyclePhase(archive, scrubMs, liveData, opts);
    if (!info) {
      return (
        '<span id="match-lifecycle-badge" class="match-lifecycle-badge match-lifecycle-badge--hidden" hidden></span>'
      );
    }
    return (
      '<span id="match-lifecycle-badge" class="match-lifecycle-badge match-lifecycle-badge--' +
      info.phase +
      '">' +
      QLDashboard.escapeHtml(QLDashboard.t(info.labelKey)) +
      "</span>"
    );
  }

  function updateLifecyclePhaseBadge(archive, scrubMs, liveData, opts) {
    var el = document.getElementById("match-lifecycle-badge");
    if (!el) return;
    var info = resolveScrubLifecyclePhase(archive, scrubMs, liveData, opts);
    if (!info) {
      el.hidden = true;
      el.className = "match-lifecycle-badge match-lifecycle-badge--hidden";
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.className = "match-lifecycle-badge match-lifecycle-badge--" + info.phase;
    el.textContent = QLDashboard.t(info.labelKey);
  }

  function renderTimelinePauseBands(archive, minMs, maxMs, liveData) {
    var intervals = pauseIntervalsFromMarkers(archive, liveData);
    if (!intervals.length) return "";
    var span = maxMs - minMs;
    if (span <= 0) return "";
    var html = '<div class="match-timeline-pauses" aria-hidden="true">';
    for (var i = 0; i < intervals.length; i++) {
      var iv = intervals[i];
      var start = Math.max(minMs, iv.startMs);
      var end = Math.min(maxMs, iv.endMs);
      if (end <= start) continue;
      var left = ((start - minMs) / span) * 100;
      var width = ((end - start) / span) * 100;
      var title =
        pauseReasonLabel(iv.reason) +
        " · " +
        formatGameTime(start) +
        " (" +
        formatGameTime(iv.durationMs) +
        ")";
      html +=
        '<span class="match-timeline-pause-band' +
        (iv.live ? " match-timeline-pause-band--live" : "") +
        '" style="left:' +
        left.toFixed(2) +
        "%;width:" +
        width.toFixed(2) +
        '%" title="' +
        QLDashboard.escapeHtml(title) +
        '"></span>';
    }
    html += "</div>";
    return html;
  }

  function renderTimelineLifecycleMarkers(archive, minMs, maxMs) {
    var rows = lifecycleMarkersOnTimeline(archive);
    if (!rows.length) return "";
    var span = maxMs - minMs;
    if (span <= 0) return "";
    var html = '<div class="match-timeline-lifecycle" aria-hidden="true">';
    var atZero = 0;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var displayMs = row.gameMs;
      if (displayMs < minMs || displayMs > maxMs) continue;
      var pct = ((displayMs - minMs) / span) * 100;
      if (pct <= 1 && atZero) pct = Math.min(99, pct + atZero * 2.5);
      if (pct <= 1) atZero++;
      var label = QLDashboard.t(row.labelKey);
      html +=
        '<span class="match-timeline-life match-timeline-life--' +
        row.css +
        '" style="left:' +
        pct.toFixed(2) +
        '%" title="' +
        QLDashboard.escapeHtml(label) +
        '"><span class="match-timeline-life-mark"></span></span>';
    }
    html += "</div>";
    return html;
  }

  function renderTimelineLifecycleLegend(archive, liveData) {
    if (!hasLifecycleMarkers(archive)) return "";
    var rows = lifecycleMarkersOnTimeline(archive);
    var pauseBands = pauseIntervalsFromMarkers(archive, liveData);
    if (!rows.length && !pauseBands.length) return "";
    var html = '<div class="match-timeline-legend" aria-hidden="true">';
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      html +=
        '<span class="match-timeline-legend-item match-timeline-legend-item--' +
        row.css +
        '"><span class="match-timeline-legend-dot"></span>' +
        QLDashboard.escapeHtml(QLDashboard.t(row.labelKey)) +
        "</span>";
    }
    if (pauseBands.length) {
      html +=
        '<span class="match-timeline-legend-item match-timeline-legend-item--pause">' +
        '<span class="match-timeline-legend-dot"></span>' +
        QLDashboard.escapeHtml(QLDashboard.t("lifecyclePaused")) +
        "</span>";
    }
    html += "</div>";
    return html;
  }

  function combatGameMsFromRow(row, anchorWall) {
    if (anchorWall != null) {
      var w = parseTsMs(row.ts);
      if (w != null) return Math.max(0, Math.round(w - anchorWall));
    }
    var g = Number(row.game_time_ms);
    return isNaN(g) ? 0 : Math.max(0, g);
  }

  /** Align event clocks to match_start wall anchor when present. */
  function normalizeArchiveCombatClock(archive) {
    if (!archive) return archive;
    var anchor = computeCombatClockAnchor(archive);
    if (anchor == null) return normalizeArchivePickupTimes(archive);

    function alignRow(row) {
      return Object.assign({}, row, {
        game_time_ms: combatGameMsFromRow(row, anchor),
      });
    }

    var next = Object.assign({}, archive);
    ["deaths", "accuracy_timeline", "accuracy_summary"].forEach(function (key) {
      if (next[key] && next[key].length) {
        next[key] = next[key].map(alignRow);
      }
    });
    if (next.pickups && next.pickups.length) {
      next.pickups = next.pickups.map(alignRow);
    }
    return normalizeArchivePickupTimes(next);
  }

  /** Drop pickups outside the match_end game-clock window. */
  function normalizeArchivePickupTimes(archive) {
    if (!archive || !archive.pickups || !archive.pickups.length) return archive;
    var combatMax = matchEndGameTimeMs(archive) || computeTimelineMaxMs(archive, null);
    if (combatMax == null || combatMax <= 0) return archive;
    var pickups = archive.pickups.filter(function (row) {
      var gt = Number(row.game_time_ms);
      return isNaN(gt) || gt <= combatMax;
    });
    return Object.assign({}, archive, { pickups: pickups });
  }

  function replayPickupToArchiveRow(ev, anchorWall, levelBaseMs) {
    var gt;
    if (anchorWall != null) {
      gt = combatGameMsFromRow(
        { ts: ev.time || ev.ts, game_time_ms: ev.game_time_ms },
        anchorWall,
      );
    } else if (levelBaseMs != null && ev.game_time_ms != null) {
      gt = Math.max(0, Number(ev.game_time_ms) - levelBaseMs);
    } else {
      gt = Number(ev.game_time_ms);
      if (isNaN(gt)) gt = 0;
    }
    return {
      ts: ev.time || ev.ts || null,
      kind: "pickup",
      game_time_ms: gt,
      item: ev.item,
      nickname: ev.nickname || ev.player,
      steam_id64: ev.steam_id64,
      x: ev.x,
      y: ev.y,
    };
  }

  /** Saved result snapshots may omit pickups when level.time was never rebased. */
  function enrichArchivePickupsFromReplay(archive, replayPayload) {
    if (!archive || (archive.pickups && archive.pickups.length)) return archive;
    var events = (replayPayload && replayPayload.events) || [];
    var pickupEv = events.filter(function (e) {
      return e && String(e.event || "").toLowerCase() === "pickup";
    });
    if (!pickupEv.length) return archive;
    var anchor = computeCombatClockAnchor(archive);
    var combatMax = matchEndGameTimeMs(archive) || computeTimelineMaxMs(archive, null);
    var maxRaw = 0;
    pickupEv.forEach(function (e) {
      var g = Number(e.game_time_ms);
      if (!isNaN(g) && g > maxRaw) maxRaw = g;
    });
    var needsRebase = combatMax != null && combatMax > 0 && maxRaw > combatMax;
    var levelBaseMs = null;
    if (needsRebase && anchor == null) {
      var mins = pickupEv
        .map(function (e) {
          return Number(e.game_time_ms);
        })
        .filter(function (g) {
          return !isNaN(g);
        });
      if (mins.length) levelBaseMs = Math.min.apply(null, mins);
    }
    var pickups = pickupEv.map(function (e) {
      return replayPickupToArchiveRow(e, anchor, levelBaseMs);
    });
    return normalizeArchivePickupTimes(Object.assign({}, archive, { pickups: pickups }));
  }

  function accuracyAtScrub(timeline, summary, scrubMs) {
    if (scrubMs == null) {
      return summary || [];
    }
    if (!timeline || !timeline.length) {
      return [];
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
    return Object.keys(best).map(function (k) {
      return best[k];
    });
  }

  function combatEventRows(archive) {
    if (!archive) return [];
    return (archive.deaths || [])
      .concat(archive.accuracy_timeline || [])
      .concat(archive.accuracy_summary || []);
  }

  function computeTimelineMinMs(archive) {
    var lead = countdownLeadInMs(archive);
    return lead > 0 ? -lead : 0;
  }

  function computeTimelineMaxMs(archive, liveData) {
    var fromMarker = matchEndGameTimeMs(archive);
    if (fromMarker != null) return fromMarker;
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

  function enrichAccuracyNicknames(archive, livePlayers, nickBySteam) {
    var bySteam = nickBySteam || buildNicknameBySteam(archive, livePlayers);
    return (archive.accuracy_summary || []).map(function (row) {
      var steam = String(row.steam_id64 || "").trim();
      var nick = stripQuakeColors(row.nickname);
      if ((!nick || isSteamId64(nick)) && steam && bySteam[steam]) {
        nick = bySteam[steam];
      }
      return Object.assign({}, row, { nickname: nick || steam || "—" });
    });
  }

  // One row per player+weapon, merging kills (from deaths) with accuracy
  // (hits/shots/acc%). Death weapons ("ROCKET", "ROCKET SPLASH") and accuracy
  // abbrs ("RL") collapse to the same weapon class, so splash + direct kills sit
  // on the same row as that weapon's accuracy.
  function aggregateWeaponStats(deaths, accuracyRows, nickBySteam) {
    var map = {};
    var order = 0;

    function resolvePlayerName(steamId, name, row) {
      var player = stripQuakeColors(name);
      if ((!player || isSteamId64(player)) && steamId && nickBySteam && nickBySteam[steamId]) {
        player = nickBySteam[steamId];
      }
      if ((!player || isSteamId64(player)) && row) {
        player = displayNickname(row, nickBySteam);
      }
      if (!player && steamId) player = steamId;
      return player;
    }

    // Identity = steam_id64 when present on both sides (deaths carry
    // killer_steam_id64, accuracy carries steam_id64, both in the same public
    // form from archive_publish), else fall back to the display name.
    function ensure(steamId, name, info) {
      var clsKey = info ? info.cls || "abbr:" + info.abbr : "unknown";
      var id = steamId ? "id:" + steamId : "name:" + name;
      var key = id + "\0" + clsKey;
      if (!map[key]) {
        map[key] = {
          player: name,
          info: info,
          kills: 0,
          hits: null,
          shots: null,
          pct: null,
          order: order++,
        };
      } else if (
        name &&
        (!map[key].player ||
          map[key].player === "—" ||
          (isSteamId64(map[key].player) && !isSteamId64(name)))
      ) {
        map[key].player = name;
      }
      return map[key];
    }

    (deaths || []).forEach(function (d) {
      if (isNonCombatDeath(d)) return;
      var info = weaponInfo(d.weapon);
      if (!isCombatWeaponInfo(info)) return;
      var steamId = String(d.killer_steam_id64 || "").trim();
      var player = resolvePlayerName(steamId, d.killer, {
        steam_id64: steamId,
        nickname: d.killer,
      });
      if (!player && !steamId) return;
      ensure(steamId, player, info).kills += 1;
    });

    (accuracyRows || []).forEach(function (r) {
      var info = weaponInfo(r.weapon);
      if (!isCombatWeaponInfo(info)) return;
      var steamId = String(r.steam_id64 || "").trim();
      var row = ensure(steamId, displayNickname(r, nickBySteam), info);
      if (r.hits != null) row.hits = Number(r.hits);
      if (r.shots != null) row.shots = Number(r.shots);
      var pct =
        r.accuracy_pct != null
          ? Number(r.accuracy_pct)
          : r.hits != null && r.shots
            ? (Number(r.hits) / Number(r.shots)) * 100
            : null;
      if (pct != null) row.pct = pct;
    });

    return Object.keys(map)
      .map(function (k) {
        return map[k];
      })
      .filter(function (row) {
        var p = String(row.player || "").toLowerCase();
        return (
          isCombatWeaponInfo(row.info) &&
          p !== "world" &&
          p !== "spectator"
        );
      })
      .sort(function (a, b) {
        return (
          a.player.localeCompare(b.player) ||
          b.kills - a.kills ||
          String((a.info && a.info.abbr) || "").localeCompare(
            String((b.info && b.info.abbr) || ""),
          )
        );
      });
  }

  // Compact mod cell: weapon icon (or abbr fallback). Splash and direct hits
  // share the same (direct-hit) weapon icon — splash is not marked separately.
  function killModHtml(weaponRaw) {
    var info = weaponInfo(weaponRaw);
    if (!info) {
      return '<span class="ql-kill-mod-abbr">' + QLDashboard.escapeHtml("—") + "</span>";
    }
    return info.sprite
      ? iconImg(info.sprite, info.label, "ql-kill-mod-icon")
      : '<span class="ql-kill-mod-abbr">' + QLDashboard.escapeHtml(info.abbr) + "</span>";
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
    var html = '<div class="ql-killfeed">';
    for (var i = rows.length - 1; i >= 0; i--) {
      var d = rows[i];
      var killer = stripQuakeColors(d.killer);
      var victim = stripQuakeColors(d.victim) || "—";
      html +=
        '<div class="ql-kill">' +
        '<span class="ql-kill-body">' +
        '<span class="ql-kill-actor ql-kill-killer">' +
        QLDashboard.escapeHtml(killer || QLDashboard.t("matchWorldSuicide")) +
        "</span>" +
        '<span class="ql-kill-mod">' +
        killModHtml(d.weapon) +
        "</span>" +
        '<span class="ql-kill-actor ql-kill-victim">' +
        QLDashboard.escapeHtml(victim) +
        "</span>" +
        "</span>" +
        '<span class="ql-kill-time">' +
        QLDashboard.escapeHtml(formatGameTime(d.game_time_ms)) +
        "</span>" +
        "</div>";
    }
    html += "</div>";
    return html;
  }

  // Pickup quick-filter state. Persisted at module scope so it survives the
  // frequent panel re-renders driven by the timeline scrubber / live updates.
  // null in players/items = all selected (default).
  var _pickupRows = [];
  var _pickupFilterUniverse = "";
  var _pickupFilter = { players: null, items: null };
  var _pickupFiltersOpen = false;

  function pickupFilterPlayersList() {
    var players = [];
    var seen = {};
    for (var i = 0; i < _pickupRows.length; i++) {
      var nick = displayNickname(_pickupRows[i]);
      if (nick && !seen[nick]) {
        seen[nick] = true;
        players.push(nick);
      }
    }
    players.sort(function (a, b) {
      return a.localeCompare(b);
    });
    return players;
  }

  function pickupFilterItemsList() {
    var items = [];
    var seen = {};
    for (var i = 0; i < _pickupRows.length; i++) {
      var info = itemInfo(_pickupRows[i].item || _pickupRows[i].text);
      if (info.label && !seen[info.label]) {
        seen[info.label] = true;
        items.push(info);
      }
    }
    items.sort(function (a, b) {
      return a.label.localeCompare(b.label);
    });
    return items;
  }

  function pickupFilterUniverseSig(rows) {
    var players = {};
    var items = {};
    for (var i = 0; i < (rows || []).length; i++) {
      var nick = displayNickname(rows[i]);
      if (nick) players[nick] = true;
      var label = itemInfo(rows[i].item || rows[i].text).label;
      if (label) items[label] = true;
    }
    return (
      Object.keys(players).sort().join("\0") +
      "|" +
      Object.keys(items).sort().join("\0")
    );
  }

  function pickupFilterChipActive(selected, value) {
    if (selected === null) return true;
    return selected.indexOf(value) >= 0;
  }

  function pickupFilterIsActive() {
    return _pickupFilter.players !== null || _pickupFilter.items !== null;
  }

  function togglePickupFilterKey(selected, value, allValues) {
    if (!allValues.length) return null;
    var active = selected === null ? allValues.slice() : selected.slice();
    var idx = active.indexOf(value);
    if (idx >= 0) {
      if (active.length === 1) return null;
      active.splice(idx, 1);
    } else {
      active.push(value);
    }
    if (active.length >= allValues.length) return null;
    return active;
  }

  function pickupMatchesFilter(p) {
    if (_pickupFilter.players !== null) {
      if (_pickupFilter.players.indexOf(displayNickname(p)) < 0) return false;
    }
    if (_pickupFilter.items !== null) {
      if (_pickupFilter.items.indexOf(itemInfo(p.item || p.text).label) < 0) {
        return false;
      }
    }
    return true;
  }

  function chipHtml(attr, value, labelHtml, active) {
    return (
      '<button type="button" class="ql-chip' +
      (active ? " ql-chip-active" : "") +
      '" ' +
      attr +
      '="' +
      QLDashboard.escapeHtml(value) +
      '">' +
      labelHtml +
      "</button>"
    );
  }

  function renderPickupFilters() {
    var players = pickupFilterPlayersList();
    var items = pickupFilterItemsList();
    if (players.length < 2 && items.length < 2) return "";

    var html = '<div class="ql-pk-filters">';
    if (players.length > 1) {
      html += '<div class="ql-pk-filter-row"><span class="ql-pk-filter-label">';
      html += QLDashboard.escapeHtml(QLDashboard.t("matchColPlayer"));
      html += "</span>";
      for (var j = 0; j < players.length; j++) {
        html += chipHtml(
          "data-ql-pk-player",
          players[j],
          QLDashboard.escapeHtml(players[j]),
          pickupFilterChipActive(_pickupFilter.players, players[j]),
        );
      }
      html += "</div>";
    }
    if (items.length > 1) {
      html += '<div class="ql-pk-filter-row"><span class="ql-pk-filter-label">';
      html += QLDashboard.escapeHtml(QLDashboard.t("matchColItem"));
      html += "</span>";
      for (var k = 0; k < items.length; k++) {
        var it = items[k];
        var inner =
          (it.sprite ? iconImg(it.sprite, it.label, "ql-chip-icon") : "") +
          QLDashboard.escapeHtml(it.label);
        html += chipHtml(
          "data-ql-pk-item",
          it.label,
          inner,
          pickupFilterChipActive(_pickupFilter.items, it.label),
        );
      }
      html += "</div>";
    }
    html += "</div>";
    return html;
  }

  function renderPickupsListHtml() {
    var rows = _pickupRows.filter(pickupMatchesFilter);
    if (!rows.length) {
      return (
        '<p class="match-analytics-empty">' +
        QLDashboard.escapeHtml(QLDashboard.t("matchPickupsFilterEmpty")) +
        "</p>"
      );
    }
    var html = '<div class="ql-pickups-list">';
    for (var i = rows.length - 1; i >= 0; i--) {
      var p = rows[i];
      var info = itemInfo(p.item || p.text);
      html +=
        '<div class="ql-pk-row">' +
        '<span class="ql-pk-time">' +
        QLDashboard.escapeHtml(formatGameTime(p.game_time_ms)) +
        "</span>" +
        '<span class="ql-pk-item">' +
        (info.sprite ? iconImg(info.sprite, info.label, "ql-pk-icon") : "") +
        '<span class="ql-pk-label">' +
        QLDashboard.escapeHtml(info.label) +
        "</span></span>" +
        '<span class="ql-pk-player">' +
        QLDashboard.escapeHtml(displayNickname(p)) +
        "</span>" +
        "</div>";
    }
    html += "</div>";
    return html;
  }

  function renderPickupsList() {
    return renderPickupsListHtml();
  }

  function syncPickupFilterChipStates(root) {
    if (!root) return;
    var pbtns = root.querySelectorAll("[data-ql-pk-player]");
    for (var i = 0; i < pbtns.length; i++) {
      var pv = pbtns[i].getAttribute("data-ql-pk-player");
      pbtns[i].classList.toggle(
        "ql-chip-active",
        pickupFilterChipActive(_pickupFilter.players, pv),
      );
    }
    var ibtns = root.querySelectorAll("[data-ql-pk-item]");
    for (var j = 0; j < ibtns.length; j++) {
      var iv = ibtns[j].getAttribute("data-ql-pk-item");
      ibtns[j].classList.toggle(
        "ql-chip-active",
        pickupFilterChipActive(_pickupFilter.items, iv),
      );
    }
    var toggle = root.querySelector("[data-ql-pk-toggle]");
    if (toggle) {
      toggle.classList.toggle("ql-chip-active", _pickupFiltersOpen || pickupFilterIsActive());
      toggle.textContent =
        QLDashboard.t("matchPickupsFilterToggle") + (pickupFilterIsActive() ? " •" : "");
    }
  }

  function renderPickupsInner() {
    if (!_pickupRows.length) {
      return (
        '<p class="match-analytics-empty">' +
        QLDashboard.escapeHtml(QLDashboard.t("matchAnalyticsEmpty")) +
        "</p>"
      );
    }
    var filters = renderPickupFilters();
    var head = "";
    if (filters) {
      head =
        '<div class="ql-pk-toolbar">' +
        '<button type="button" class="ql-chip ql-pk-toggle' +
        (_pickupFiltersOpen || pickupFilterIsActive() ? " ql-chip-active" : "") +
        '" data-ql-pk-toggle="1">' +
        QLDashboard.escapeHtml(QLDashboard.t("matchPickupsFilterToggle")) +
        (pickupFilterIsActive() ? " •" : "") +
        "</button>" +
        "</div>";
    }
    return (
      head +
      (filters && _pickupFiltersOpen ? filters : "") +
      '<div class="ql-pk-list-mount">' +
      renderPickupsListHtml() +
      "</div>"
    );
  }

  function refreshPickupsPanel(opts) {
    opts = opts || {};
    var el = document.getElementById("ql-pickups-panel");
    if (!el) return;
    if (opts.listOnly && el.querySelector(".ql-pk-list-mount")) {
      var mount = el.querySelector(".ql-pk-list-mount");
      mount.innerHTML = renderPickupsListHtml();
      syncPickupFilterChipStates(el);
      return;
    }
    el.innerHTML = renderPickupsInner();
  }

  function handlePickupFilterPointer(ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var tg = t.closest("[data-ql-pk-toggle]");
    if (tg) {
      ev.preventDefault();
      _pickupFiltersOpen = !_pickupFiltersOpen;
      refreshPickupsPanel();
      return;
    }
    var pb = t.closest("[data-ql-pk-player]");
    if (pb) {
      ev.preventDefault();
      var pv = pb.getAttribute("data-ql-pk-player");
      _pickupFilter.players = togglePickupFilterKey(
        _pickupFilter.players,
        pv,
        pickupFilterPlayersList(),
      );
      refreshPickupsPanel({ listOnly: true });
      return;
    }
    var ib = t.closest("[data-ql-pk-item]");
    if (ib) {
      ev.preventDefault();
      var iv = ib.getAttribute("data-ql-pk-item");
      var labels = pickupFilterItemsList().map(function (it) {
        return it.label;
      });
      _pickupFilter.items = togglePickupFilterKey(_pickupFilter.items, iv, labels);
      refreshPickupsPanel({ listOnly: true });
    }
  }

  function bindPickupFilters() {
    if (global.__qlPickupFilterBound) return;
    global.__qlPickupFilterBound = true;
    document.addEventListener("pointerdown", handlePickupFilterPointer);
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      if (
        t.closest("[data-ql-pk-toggle]") ||
        t.closest("[data-ql-pk-player]") ||
        t.closest("[data-ql-pk-item]")
      ) {
        ev.preventDefault();
      }
    });
  }

  function pruneStalePickupFilter() {
    var players = pickupFilterPlayersList();
    var itemLabels = pickupFilterItemsList().map(function (it) {
      return it.label;
    });
    if (_pickupFilter.players !== null) {
      _pickupFilter.players = _pickupFilter.players.filter(function (p) {
        return players.indexOf(p) >= 0;
      });
      if (!_pickupFilter.players.length || _pickupFilter.players.length >= players.length) {
        _pickupFilter.players = null;
      }
    }
    if (_pickupFilter.items !== null) {
      _pickupFilter.items = _pickupFilter.items.filter(function (l) {
        return itemLabels.indexOf(l) >= 0;
      });
      if (!_pickupFilter.items.length || _pickupFilter.items.length >= itemLabels.length) {
        _pickupFilter.items = null;
      }
    }
  }

  function renderPickups(pickups) {
    bindPickupFilters();
    var uni = pickupFilterUniverseSig(pickups);
    if (uni !== _pickupFilterUniverse) {
      var firstLoad = !_pickupFilterUniverse;
      _pickupFilterUniverse = uni;
      if (firstLoad) {
        _pickupFilter = { players: null, items: null };
      }
    }
    _pickupRows = sortByGameTime(pickups);
    pruneStalePickupFilter();
    return '<div id="ql-pickups-panel">' + renderPickupsInner() + "</div>";
  }

  // Combined hits/shots cell: "219 / 353". Falls back to just hits, or "—".
  function hitsShotsHtml(row) {
    if (row.hits == null && row.shots == null) return "—";
    if (row.shots == null) return String(row.hits);
    if (row.hits == null) return "— / " + row.shots;
    return row.hits + " / " + row.shots;
  }

  var WEAPON_COMPARE_ORDER = [
    "weapon_rocketlauncher",
    "weapon_railgun",
    "weapon_lightning",
    "weapon_plasmagun",
    "weapon_grenadelauncher",
    "weapon_shotgun",
    "weapon_machinegun",
    "weapon_gauntlet",
    "weapon_bfg",
    "weapon_nailgun",
    "weapon_chaingun",
    "weapon_grapple",
  ];

  function weaponCompareSortKey(cls) {
    var i = WEAPON_COMPARE_ORDER.indexOf(cls);
    return i >= 0 ? i : WEAPON_COMPARE_ORDER.length;
  }

  function renderWeaponStats(deaths, accuracyRows, nickBySteam) {
    var rows = aggregateWeaponStats(deaths, accuracyRows, nickBySteam);
    if (!rows.length) {
      return (
        '<p class="match-analytics-empty">' +
        QLDashboard.escapeHtml(QLDashboard.t("matchAnalyticsEmpty")) +
        "</p>"
      );
    }

    var players = [];
    var seenPlayer = {};
    var byPlayer = {};
    var weaponMeta = {};

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var pname = r.player || "—";
      if (!seenPlayer[pname]) {
        seenPlayer[pname] = true;
        players.push(pname);
      }
      var cls = (r.info && r.info.cls) || "abbr:" + ((r.info && r.info.abbr) || "—");
      weaponMeta[cls] = r.info;
      byPlayer[pname] = byPlayer[pname] || {};
      byPlayer[pname][cls] = r;
    }

    var weaponKeys = Object.keys(weaponMeta).sort(function (a, b) {
      var ka = weaponCompareSortKey(a);
      var kb = weaponCompareSortKey(b);
      if (ka !== kb) return ka - kb;
      var aa = (weaponMeta[a] && weaponMeta[a].abbr) || a;
      var ab = (weaponMeta[b] && weaponMeta[b].abbr) || b;
      return String(aa).localeCompare(String(ab));
    });

    var html = '<div class="ql-ws-compare">';
    for (var pi = 0; pi < players.length; pi++) {
      var player = players[pi];
      html +=
        '<div class="ql-ws-player-col"><h4 class="ql-ws-player-title">' +
        QLDashboard.escapeHtml(player) +
        '</h4><table class="data-table ql-ws-table ql-ws-table-compact"><thead><tr><th>' +
        QLDashboard.escapeHtml(QLDashboard.t("matchColWeapon")) +
        '</th><th class="ql-ws-num">' +
        QLDashboard.escapeHtml(QLDashboard.t("matchColKills")) +
        '</th><th class="ql-ws-num">' +
        QLDashboard.escapeHtml(QLDashboard.t("matchColHits")) +
        '</th><th class="ql-ws-num">' +
        QLDashboard.escapeHtml(QLDashboard.t("matchColAccuracy")) +
        "</th></tr></thead><tbody>";

      for (var wi = 0; wi < weaponKeys.length; wi++) {
        var clsKey = weaponKeys[wi];
        var info = weaponMeta[clsKey];
        var row = (byPlayer[player] && byPlayer[player][clsKey]) || null;
        var weaponCell = info
          ? '<span class="ql-ws-weapon">' +
            (info.sprite ? iconImg(info.sprite, info.abbr, "ql-ws-icon") : "") +
            QLDashboard.escapeHtml(info.abbr) +
            "</span>"
          : QLDashboard.escapeHtml("—");
        html +=
          "<tr><td>" +
          weaponCell +
          '</td><td class="ql-ws-num">' +
          (row && row.kills ? row.kills : "—") +
          '</td><td class="ql-ws-num">' +
          (row ? hitsShotsHtml(row) : "—") +
          '</td><td class="ql-ws-num">' +
          (row && row.pct != null ? row.pct.toFixed(1) : "—") +
          "</td></tr>";
      }
      html += "</tbody></table></div>";
    }
    html += "</div>";
    return html;
  }

  // Pick a "nice" tick interval (ms) so the scale shows ~4-8 marks.
  function timelineTickStepMs(spanMs) {
    var candidates = [15000, 30000, 60000, 120000, 180000, 300000, 600000];
    for (var i = 0; i < candidates.length; i++) {
      if (spanMs / candidates[i] <= 8) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }

  // Scale ruler under the range: tick marks at nice intervals with time labels.
  function renderTimelineTicks(minMs, maxMs, archive) {
    var span = maxMs - minMs;
    if (span <= 0) return "";
    var step = timelineTickStepMs(span);
    var html = '<div class="match-timeline-ticks" aria-hidden="true">';
    for (var t = minMs; t <= maxMs + 1; t += step) {
      var pct = ((t - minMs) / span) * 100;
      if (pct > 100) pct = 100;
      var edge = pct <= 0.5 ? " tick-first" : pct >= 99.5 ? " tick-last" : "";
      html +=
        '<span class="match-timeline-tick' +
        edge +
        '" style="left:' +
        pct.toFixed(2) +
        '%"><span class="match-timeline-tick-mark"></span>' +
        '<span class="match-timeline-tick-label">' +
        QLDashboard.escapeHtml(formatTimelineScrubTime(t, archive)) +
        "</span></span>";
    }
    html += "</div>";
    return html;
  }

  // Kill markers above the range: one small weapon icon per death, positioned by
  // game time. Lets the caster see at a glance where the action happened.
  function renderTimelineKills(deaths, minMs, maxMs) {
    var span = maxMs - minMs;
    if (span <= 0) return "";
    var rows = sortByGameTime(deaths).filter(function (d) {
      var gt = Number(d.game_time_ms);
      return !isNaN(gt) && gt >= minMs && gt <= maxMs;
    });
    if (!rows.length) return "";
    var html = '<div class="match-timeline-kills" aria-hidden="true">';
    for (var i = 0; i < rows.length; i++) {
      var d = rows[i];
      var pct = ((Number(d.game_time_ms) - minMs) / span) * 100;
      var info = weaponInfo(d.weapon);
      var marker = info && info.sprite
        ? iconImg(info.sprite, info.label, "match-timeline-kill-icon")
        : '<span class="match-timeline-kill-dot"></span>';
      html +=
        '<span class="match-timeline-kill" style="left:' +
        pct.toFixed(2) +
        '%" title="' +
        QLDashboard.escapeHtml(formatGameTime(d.game_time_ms)) +
        '">' +
        marker +
        "</span>";
    }
    html += "</div>";
    return html;
  }

  function replayControlIcon(name) {
    return "icons/replay/" + name + ".png";
  }

  function renderTimelineScrubber(archive, liveData, scrubGameTimeMs, opts) {
    opts = opts || {};
    var replayControl = !!opts.replayControl;
    var maxMs = computeTimelineMaxMs(archive, liveData);
    if (!maxMs) return "";
    var minMs = computeTimelineMinMs(archive);
    var currentMs = scrubGameTimeMs != null ? scrubGameTimeMs : maxMs;
    if (currentMs < minMs) currentMs = minMs;
    if (currentMs > maxMs) currentMs = maxMs;
    var deaths = filterRowsByGameTime(archive.deaths || [], maxMs);
    var controlsHtml = replayControl
      ? '<div class="match-timeline-controls">' +
        '<button type="button" id="match-timeline-play" class="match-timeline-btn" aria-label="' +
        QLDashboard.escapeHtml(QLDashboard.t("matchReplayPlay")) +
        '">' +
        '<img id="match-timeline-play-icon" class="match-timeline-btn-icon" src="' +
        QLDashboard.escapeHtml(replayControlIcon("play")) +
        '" alt="" /></button>' +
        '<label class="match-timeline-speed-wrap" title="' +
        QLDashboard.escapeHtml(QLDashboard.t("matchReplaySpeed")) +
        '">' +
        '<img class="match-timeline-btn-icon" src="' +
        QLDashboard.escapeHtml(replayControlIcon("speed")) +
        '" alt="" aria-hidden="true" />' +
        '<select id="match-timeline-speed" class="match-timeline-speed" aria-label="' +
        QLDashboard.escapeHtml(QLDashboard.t("matchReplaySpeed")) +
        '">' +
        '<option value="0.25">0.25\u00d7</option>' +
        '<option value="0.5">0.5\u00d7</option>' +
        '<option value="1" selected>1\u00d7</option>' +
        '<option value="1.5">1.5\u00d7</option>' +
        '<option value="2">2\u00d7</option>' +
        '<option value="4">4\u00d7</option>' +
        "</select></label>" +
        '<span id="match-timeline-label" class="match-timeline-label">' +
        QLDashboard.escapeHtml(formatTimelineScrubTime(currentMs, archive)) +
        "</span>" +
        '<button type="button" id="match-timeline-live" class="match-timeline-btn" aria-label="' +
        QLDashboard.escapeHtml(QLDashboard.t("matchTimelineLive")) +
        '" title="' +
        QLDashboard.escapeHtml(QLDashboard.t("matchTimelineLive")) +
        '">' +
        '<img class="match-timeline-btn-icon" src="' +
        QLDashboard.escapeHtml(replayControlIcon("skip-end")) +
        '" alt="" /></button></div>'
      : "";
    var html =
      '<div class="match-timeline-panel">' +
      '<div class="match-timeline-head">' +
      "<h3>" +
      QLDashboard.escapeHtml(QLDashboard.t("matchSectionTimeline")) +
      "</h3>" +
      (replayControl
        ? ""
        : '<span id="match-timeline-label" class="match-timeline-label">' +
          QLDashboard.escapeHtml(formatTimelineScrubTime(currentMs, archive)) +
          "</span>") +
      renderLifecyclePhaseBadge(archive, currentMs, liveData, opts) +
      "</div>" +
      '<div class="match-timeline-track">' +
      renderTimelinePauseBands(archive, minMs, maxMs, liveData) +
      renderTimelineLifecycleMarkers(archive, minMs, maxMs) +
      renderTimelineKills(deaths, minMs, maxMs) +
      '<input type="range" id="match-timeline-scrub" class="match-timeline-scrub" min="' +
      minMs +
      '" max="' +
      maxMs +
      '" step="100" value="' +
      currentMs +
      '" />' +
      renderTimelineTicks(minMs, maxMs, archive) +
      "</div>" +
      renderTimelineLifecycleLegend(archive, liveData) +
      controlsHtml;
    if (!replayControl) {
      html +=
        '<div class="match-timeline-actions">' +
        '<button type="button" id="match-timeline-live" class="control-btn control-btn-sm">' +
        QLDashboard.escapeHtml(QLDashboard.t("matchTimelineLive")) +
        "</button></div>";
    }
    html += "</div>";
    return html;
  }

  function renderAnalyticsPanels(archive, livePlayers, opts) {
    opts = opts || {};
    var debug = !!opts.debug;
    var scrubMs = opts.scrubMs;
    var liveData = opts.liveData || null;
    archive = normalizeArchiveCombatClock(archive);

    var maxMs = computeTimelineMaxMs(archive, liveData);
    var atEnd = scrubMs == null || (maxMs != null && Number(scrubMs) >= maxMs);
    var deaths = filterRowsByGameTime(archive.deaths || [], scrubMs);
    if (liveData && QLDashboard.isWarmupPhase(liveData)) {
      deaths = [];
    }
    var pickups = atEnd
      ? archive.pickups || []
      : filterRowsByGameTime(archive.pickups || [], scrubMs);
    var nickBySteam = buildNicknameBySteam(archive, livePlayers);
    var summary = enrichAccuracyNicknames(archive, livePlayers, nickBySteam);
    var accuracy = atEnd
      ? summary
      : accuracyAtScrub(archive.accuracy_timeline, summary, scrubMs);
    accuracy = enrichAccuracyNicknames(
      { accuracy_summary: accuracy, players: archive.players },
      livePlayers,
      nickBySteam,
    );
    var scrubbing = scrubMs != null;
    var emptyNote =
      !debug &&
      !scrubbing &&
      !deaths.length &&
      !pickups.length &&
      !accuracy.length
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
    html += '<div class="match-analytics-grid">';
    html +=
      '<div class="match-analytics-panel"><h3>' +
      QLDashboard.escapeHtml(QLDashboard.t("matchSectionKillfeed")) +
      '</h3><div class="match-analytics-scroll" data-ql-scroll="killfeed">' +
      renderKillfeed(deaths) +
      "</div></div>";
    html +=
      '<div class="match-analytics-panel"><h3>' +
      QLDashboard.escapeHtml(QLDashboard.t("matchSectionPickups")) +
      '</h3><div class="match-analytics-scroll" data-ql-scroll="pickups">' +
      renderPickups(pickups) +
      "</div></div>";
    html +=
      '<div class="match-analytics-panel match-analytics-span-2"><h3>' +
      QLDashboard.escapeHtml(QLDashboard.t("matchSectionWeapons")) +
      '</h3><div class="match-analytics-scroll" data-ql-scroll="weapons">' +
      renderWeaponStats(deaths, accuracy, nickBySteam) +
      "</div></div>";
    html += "</div>";
    return html;
  }

  function renderAnalytics(archive, livePlayers, opts) {
    opts = opts || {};
    var scrubMs = opts.scrubMs;
    var liveData = opts.liveData || null;
    var showTimeline = opts.showTimeline !== false;
    archive = normalizeArchiveCombatClock(archive);

    var html = "";
    if (showTimeline) {
      html += renderTimelineScrubber(archive, liveData, scrubMs, opts);
    }
    html +=
      '<div id="match-analytics-panels">' +
      renderAnalyticsPanels(archive, livePlayers, opts) +
      "</div>";
    return html;
  }

  // Keep the analytics scroll panels (killfeed/pickups/weapons) visually stable
  // across full innerHTML rebuilds driven by live WS updates. `mutate` does the
  // re-render (e.g. sets innerHTML). For newest-on-top feeds: if the user sits at
  // the live edge (top) we pin to top so new rows stay visible; otherwise we hold
  // their position by offsetting scrollTop by the content height delta (rows are
  // prepended at the top).
  function preserveAnalyticsScroll(container, mutate) {
    if (!container || typeof mutate !== "function") {
      if (typeof mutate === "function") mutate();
      return;
    }
    var prev = {};
    var before = container.querySelectorAll("[data-ql-scroll]");
    for (var i = 0; i < before.length; i++) {
      var key = before[i].getAttribute("data-ql-scroll");
      prev[key] = { top: before[i].scrollTop, height: before[i].scrollHeight };
    }
    mutate();
    var after = container.querySelectorAll("[data-ql-scroll]");
    for (var j = 0; j < after.length; j++) {
      var k = after[j].getAttribute("data-ql-scroll");
      var p = prev[k];
      if (!p) continue;
      if (p.top <= 4) {
        after[j].scrollTop = 0;
        continue;
      }
      var delta = after[j].scrollHeight - p.height;
      after[j].scrollTop = Math.max(0, p.top + delta);
    }
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

  function normalizeDeathWeapon(weapon) {
    var w = String(weapon || "")
      .trim()
      .toUpperCase()
      .replace(/-/g, "_");
    if (w.indexOf("MOD_") === 0) w = w.slice(4);
    return w;
  }

  var DUEL_VICTIM_PENALTY_WEAPONS = {
    SUICIDE: 1,
    SUICIDES: 1,
    FALLING: 1,
    LAVA: 1,
    WATER: 1,
    SLIME: 1,
    CRUSH: 1,
    TRIGGER_HURT: 1,
    WORLD: 1,
  };

  function deathCostsVictimPoint(d, worldLabel) {
    var killerSteam = String(d.killer_steam_id64 || "").trim();
    var victimSteam = String(d.victim_steam_id64 || "").trim();
    var killer = stripQuakeColors(d.killer);
    var weapon = normalizeDeathWeapon(d.weapon);
    if (DUEL_VICTIM_PENALTY_WEAPONS[weapon]) return true;
    if (killerSteam && victimSteam && killerSteam === victimSteam && weapon === "SUICIDE") return true;
    if (!killerSteam && killer && (killer === worldLabel || String(killer).toLowerCase() === "world")) {
      return true;
    }
    return false;
  }

  function deathIsSuicide(d, worldLabel) {
    return deathCostsVictimPoint(d, worldLabel);
  }

  function duelLikeArchive(archive) {
    var gt = String((archive && archive.gametype) || "")
      .trim()
      .toLowerCase();
    return gt === "duel" || gt === "1";
  }

  function applyArchiveDeathToScores(byKey, d, duelLike, rowKey, worldLabel) {
    var gt = Number(d.game_time_ms);
    if (isNaN(gt)) return;
    var killerSteam = String(d.killer_steam_id64 || "").trim();
    var victimSteam = String(d.victim_steam_id64 || "").trim();
    var killer = stripQuakeColors(d.killer);
    var victim = stripQuakeColors(d.victim);
    var suicide = deathIsSuicide(d, worldLabel);
    if (!suicide && killer && killer !== worldLabel) {
      var kr = byKey[rowKey(killerSteam, killer)];
      if (!kr) {
        kr = {
          steam_id64: killerSteam,
          nickname: killer,
          score: 0,
          kills: 0,
          deaths: 0,
        };
        byKey[rowKey(killerSteam, killer)] = kr;
      }
      kr.kills += 1;
      kr.score = Math.max(Number(kr.score || 0), kr.kills);
    }
    if (victim) {
      var vr = byKey[rowKey(victimSteam, victim)];
      if (!vr) {
        vr = {
          steam_id64: victimSteam,
          nickname: victim,
          score: 0,
          kills: 0,
          deaths: 0,
        };
        byKey[rowKey(victimSteam, victim)] = vr;
      }
      vr.deaths += 1;
      if (duelLike && suicide) {
        vr.score = Number(vr.score || 0) - 1;
      }
    }
  }

  // Match score is authoritative; fall back to frags only when SCORE is missing.
  function scoreboardStats(p, duelLike) {
    var kills = Number(p.kills || 0);
    var score = Number(p.score || 0);
    var deaths = Number(p.deaths || 0);
    if (duelLike && score === 0) {
      score = kills;
    }
    if (duelLike && kills <= 0 && score > 0) {
      kills = score;
    }
    return { score: score, kills: kills, deaths: deaths, net: kills - deaths };
  }

  // Archive players often carry 0/0/0 when the snapshot missed the last ZMQ
  // PLAYER_STATS tick; derive final frags from the death log as fallback.
  /** Death windows from replay positions (same model as overlay minimap). */
  function replayEventGameMs(ev) {
    if (!ev) return null;
    var gt = Number(ev.game_time_ms);
    return isNaN(gt) ? null : gt;
  }

  function buildReplayDeathWindowsGameMs(events) {
    var pending = {};
    var windows = {};
    (events || []).forEach(function (ev) {
      if (!ev || typeof ev !== "object") return;
      if (ev.event === "death") {
        var sid = String(ev.victim_steam_id64 || "").trim();
        if (!sid) return;
        var deathGt = replayEventGameMs(ev);
        if (deathGt == null) return;
        windows[sid] = windows[sid] || [];
        windows[sid].push({
          deathGt: deathGt,
          respawnGt: null,
          x: ev.x,
          y: ev.y,
          z: ev.z,
        });
        pending[sid] = windows[sid].length - 1;
        return;
      }
      if (ev.event === "positions") {
        var t = replayEventGameMs(ev);
        if (t == null) return;
        (ev.players || []).forEach(function (p) {
          var psid = String(p.steam_id64 || "").trim();
          if (!psid || pending[psid] == null) return;
          if (p.alive === false) return;
          var hp =
            p.health != null ? Number(p.health) : p.h != null ? Number(p.h) : null;
          if (hp != null && hp <= 0) return;
          windows[psid][pending[psid]].respawnGt = t;
          delete pending[psid];
        });
      }
    });
    return windows;
  }

  function buildReplayPositionTimeline(events) {
    var rows = [];
    (events || []).forEach(function (ev) {
      if (!ev || ev.event !== "positions") return;
      var gt = replayEventGameMs(ev);
      if (gt == null) return;
      rows.push({ game_time_ms: gt, players: ev.players || [] });
    });
    rows.sort(function (a, b) {
      return a.game_time_ms - b.game_time_ms;
    });
    return rows;
  }

  function nearestReplayPositionsAtScrub(timeline, scrubMs) {
    if (!timeline || !timeline.length || scrubMs == null || isNaN(Number(scrubMs))) return null;
    var t = Number(scrubMs);
    var best = null;
    for (var i = 0; i < timeline.length; i++) {
      if (timeline[i].game_time_ms > t) break;
      best = timeline[i];
    }
    return best;
  }

  function attachReplayScrubData(archive, replayPayload) {
    var events = (replayPayload && replayPayload.events) || (archive && archive.events);
    if (!Array.isArray(events) || !events.length) return archive;
    var out = Object.assign({}, archive || {});
    out.deathWindows = buildReplayDeathWindowsGameMs(events);
    out.replayPositions = buildReplayPositionTimeline(events);
    return out;
  }

  function attachReplayDeathWindows(archive, replayPayload) {
    return attachReplayScrubData(archive, replayPayload);
  }

  function hasReplayScrubData(archive) {
    return !!(
      archive &&
      ((archive.replayPositions && archive.replayPositions.length) || archive.deathWindows)
    );
  }

  function playerDeadWindowAtScrub(deathWindows, steamId64, scrubMs) {
    if (!deathWindows || scrubMs == null || isNaN(Number(scrubMs))) return null;
    var want = String(steamId64 || "").trim();
    if (!want) return null;
    var scrub = Number(scrubMs);
    var rows = deathWindows[want];
    if (!rows || !rows.length) return null;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (scrub < row.deathGt) continue;
      if (row.respawnGt != null && scrub >= row.respawnGt) continue;
      return {
        dead: true,
        deathGt: row.deathGt,
        x: row.x,
        y: row.y,
        z: row.z,
      };
    }
    return { alive: true };
  }

  /** Death / respawn at scrub from replay death windows (positions-based respawn). */
  function playerCombatWindowAtScrub(archive, steamId64, scrubMs) {
    if (!archive || scrubMs == null || isNaN(Number(scrubMs))) return null;
    if (archive.deathWindows) {
      return playerDeadWindowAtScrub(archive.deathWindows, steamId64, scrubMs);
    }
    return null;
  }

  function resolveFinalPlayers(archive, livePlayers) {
    var players = Array.isArray(archive.players) ? archive.players.slice() : [];
    var nickBySteam = buildNicknameBySteam(archive, livePlayers);
    var byKey = {};
    function keyOf(p) {
      var steam = String(p.steam_id64 || "").trim();
      return steam ? "id:" + steam : "name:" + (displayNickname(p, nickBySteam) || "—");
    }
    function ensure(steam, nick) {
      if ((!nick || isSteamId64(nick)) && steam && nickBySteam[steam]) {
        nick = nickBySteam[steam];
      }
      var k = steam ? "id:" + steam : "name:" + (nick || "—");
      if (!byKey[k]) {
        byKey[k] = {
          steam_id64: steam || "",
          nickname: nick || "—",
          score: 0,
          kills: 0,
          deaths: 0,
        };
      } else if (
        nick &&
        (!byKey[k].nickname ||
          byKey[k].nickname === "—" ||
          (isSteamId64(byKey[k].nickname) && !isSteamId64(nick)))
      ) {
        byKey[k].nickname = nick;
      }
      return byKey[k];
    }
    for (var i = 0; i < players.length; i++) {
      var playerRow = Object.assign({}, players[i]);
      var resolvedNick = displayNickname(playerRow, nickBySteam);
      if (resolvedNick && resolvedNick !== "—" && !isSteamId64(resolvedNick)) {
        playerRow.nickname = resolvedNick;
      }
      byKey[keyOf(playerRow)] = playerRow;
    }
    var hasStats = players.some(function (p) {
      return Number(p.score) || Number(p.kills) || Number(p.deaths);
    });
    if (!hasStats && archive.deaths && archive.deaths.length) {
      var worldFinal = QLDashboard.t("matchWorldSuicide");
      var duelLikeFinal = duelLikeArchive(archive);
      var byKeyFinal = {};
      function rowKeyFinal(steam, nick) {
        return steam ? "id:" + steam : "name:" + (nick || "—");
      }
      Object.keys(byKey).forEach(function (k) {
        byKeyFinal[k] = Object.assign({}, byKey[k]);
      });
      archive.deaths.forEach(function (d) {
        applyArchiveDeathToScores(byKeyFinal, d, duelLikeFinal, rowKeyFinal, worldFinal);
      });
      return Object.keys(byKeyFinal).map(function (k) {
        return byKeyFinal[k];
      });
    }
    return Object.keys(byKey).map(function (k) {
      return byKey[k];
    });
  }

  // Score at scrub time: count kills/deaths from the feed up to the cursor.
  function resolvePlayersAtScrub(archive, scrubMs, livePlayers) {
    if (!archive) return [];
    var maxMs = computeTimelineMaxMs(archive, null);
    var atEnd =
      scrubMs == null || (maxMs != null && Number(scrubMs) >= maxMs - 500);
    if (atEnd) return resolveFinalPlayers(archive, livePlayers);

    var nickBySteam = buildNicknameBySteam(archive, livePlayers);
    var base = resolveFinalPlayers(archive, livePlayers);
    var byKey = {};
    function rowKey(steam, nick) {
      return steam ? "id:" + steam : "name:" + (nick || "—");
    }
    for (var i = 0; i < base.length; i++) {
      var p = base[i];
      var steam = String(p.steam_id64 || "").trim();
      var nick = displayNickname(p, nickBySteam);
      byKey[rowKey(steam, nick)] = {
        steam_id64: steam,
        nickname: nick,
        score: 0,
        kills: 0,
        deaths: 0,
      };
    }
    var world = QLDashboard.t("matchWorldSuicide");
    var duelLike = duelLikeArchive(archive);
    (archive.deaths || []).forEach(function (d) {
      var gt = Number(d.game_time_ms);
      if (isNaN(gt) || gt > scrubMs) return;
      applyArchiveDeathToScores(byKey, d, duelLike, rowKey, world);
    });
    return Object.keys(byKey).map(function (k) {
      return byKey[k];
    });
  }

  function resolveDisplayPlayers(archive, scrubMs, livePlayers) {
    if (livePlayers && livePlayers.length) return livePlayers;
    return resolvePlayersAtScrub(archive, scrubMs, livePlayers);
  }

  function archiveForScore(archive, scrubMs) {
    return Object.assign({}, archive, {
      players: resolvePlayersAtScrub(archive, scrubMs),
      deaths: filterRowsByGameTime(archive.deaths || [], scrubMs),
    });
  }

  function scoreboardCell(liveData, value) {
    if (liveData && QLDashboard.isWarmupPhase(liveData)) return "—";
    return value != null ? String(value) : "0";
  }

  function playersFromPositionRows(rows) {
    var out = [];
    (rows || []).forEach(function (p) {
      var steam = String((p && p.steam_id64) || "").trim();
      if (!steam) return;
      out.push({
        steam_id64: steam,
        nickname: p.nickname,
        team: p.team,
        score: Number(p.score) || 0,
        kills: Number(p.kills) || 0,
        deaths: Number(p.deaths) || 0,
        x: p.x,
        y: p.y,
        z: p.z,
        health: p.health,
        armor: p.armor,
      });
    });
    return out;
  }

  var RESTORECP_CLIENT_PREFIX = "say !restorecp ";

  function toClientRestoreCfg(text) {
    if (!text) return "";
    return String(text)
      .split("\n")
      .map(function (line) {
        var trimmed = line.trimStart();
        if (!trimmed || trimmed.indexOf("//") === 0) return line;
        if (trimmed.indexOf(RESTORECP_CLIENT_PREFIX) === 0) return line;
        if (trimmed.indexOf("qlx restorecp ") === 0) {
          return RESTORECP_CLIENT_PREFIX + trimmed.slice("qlx restorecp ".length);
        }
        return line;
      })
      .join("\n");
  }

  function pickCfgText(payload) {
    if (!payload) return "";
    if (payload.cfg_client_text) return String(payload.cfg_client_text);
    if (Array.isArray(payload.cfg_client_lines) && payload.cfg_client_lines.length) {
      return payload.cfg_client_lines.join("\n") + "\n";
    }
    if (payload.cfg_text) return toClientRestoreCfg(String(payload.cfg_text));
    if (Array.isArray(payload.cfg_lines) && payload.cfg_lines.length) {
      return toClientRestoreCfg(payload.cfg_lines.join("\n") + "\n");
    }
    return "";
  }

  function renderCheckpointRestorePanel(state) {
    state = state || {};
    var status = state.status || "idle";
    var payload = state.payload;
    var err = state.error || "";
    var tMs = state.tMs;
    var html =
      '<section class="control-section restore-checkpoint-panel" id="restore-checkpoint-panel">' +
      "<h3>" +
      QLDashboard.escapeHtml(QLDashboard.t("restoreCheckpointTitle")) +
      "</h3>" +
      '<p class="control-field-hint">' +
      QLDashboard.escapeHtml(QLDashboard.t("restoreCheckpointHint")) +
      "</p>";
    if (status === "unavailable") {
      html +=
        '<p class="match-analytics-empty">' +
        QLDashboard.escapeHtml(QLDashboard.t("restoreCheckpointNoReplay")) +
        "</p>";
    } else if (status === "loading") {
      html +=
        '<p class="control-status">' +
        QLDashboard.escapeHtml(QLDashboard.t("restoreCheckpointLoading")) +
        "</p>";
    } else if (status === "error") {
      html +=
        '<p class="control-status error">' +
        QLDashboard.escapeHtml(QLDashboard.t("restoreCheckpointError")) +
        ": " +
        QLDashboard.escapeHtml(err) +
        "</p>";
    } else if (payload && payload.checkpoint) {
      var cfgText = pickCfgText(payload);
      var meta =
        QLDashboard.t("restoreCheckpointAt") +
        ": " +
        formatGameTime(tMs != null ? tMs : payload.checkpoint.t_ms) +
        " · " +
        QLDashboard.t("restoreCheckpointMap") +
        ": " +
        String(payload.checkpoint.map || "—");
      html +=
        '<p class="restore-checkpoint-meta">' + QLDashboard.escapeHtml(meta) + "</p>" +
        '<textarea id="restore-checkpoint-cfg" class="restore-checkpoint-json" spellcheck="false" readonly>' +
        QLDashboard.escapeHtml(cfgText) +
        "</textarea>" +
        '<div class="control-actions restore-checkpoint-actions">' +
        '<button type="button" class="control-btn control-btn-sm control-btn-primary" id="restore-checkpoint-copy-cfg">' +
        QLDashboard.escapeHtml(QLDashboard.t("restoreCheckpointCopyCfg")) +
        "</button>" +
        "</div>";
    }
    html += "</section>";
    return html;
  }

  function mergePlayerRosters(matchPlayers, positionPlayers) {
    var bySteam = {};
    function absorb(p) {
      if (!p) return;
      var steam = String(p.steam_id64 || "").trim();
      if (!steam) return;
      var existing = bySteam[steam];
      if (!existing) {
        bySteam[steam] = {
          steam_id64: steam,
          nickname: p.nickname,
          team: p.team,
          score: Number(p.score) || 0,
          kills: Number(p.kills) || 0,
          deaths: Number(p.deaths) || 0,
        };
        return;
      }
      if (p.nickname) existing.nickname = p.nickname;
      if (p.team) existing.team = p.team;
      existing.score = Math.max(existing.score, Number(p.score) || 0);
      existing.kills = Math.max(existing.kills, Number(p.kills) || 0);
      existing.deaths = Math.max(existing.deaths, Number(p.deaths) || 0);
    }
    (matchPlayers || []).forEach(absorb);
    (positionPlayers || []).forEach(absorb);
    return Object.keys(bySteam).map(function (k) {
      return bySteam[k];
    });
  }

  function meaningfulTeam(team) {
    var t = String(team || "").trim().toLowerCase();
    if (!t || t === "free" || t === "spectator" || t === "spec") return "";
    return String(team).trim();
  }

  function isDuelLikeGametype(gametype, playerCount) {
    var gt = String(gametype || "").trim().toLowerCase();
    if (gt === "duel" || gt === "ffa" || gt === "deathmatch") return true;
    return playerCount === 2;
  }

  function sortHeroPlayers(players, nickBySteam, warmup) {
    return players.slice().sort(function (a, b) {
      if (!warmup) {
        var sa = scoreboardStats(a, true).score;
        var sb = scoreboardStats(b, true).score;
        if (sb !== sa) return sb - sa;
      }
      return displayNickname(a, nickBySteam).localeCompare(displayNickname(b, nickBySteam));
    });
  }

  function renderHeroPlayers(players, liveData) {
    if (!players || !players.length) return "";
    var warmup = liveData && QLDashboard.isWarmupPhase(liveData);
    var nickBySteam = buildNicknameBySteam({ players: players }, players);
    var sorted = sortHeroPlayers(players, nickBySteam, warmup);
    var gametype = liveData && liveData.gametype;

    if (isDuelLikeGametype(gametype, sorted.length) && sorted.length === 2) {
      var left = sorted[0];
      var right = sorted[1];
      var ls = scoreboardStats(left, true).score;
      var rs = scoreboardStats(right, true).score;
      var scoreText = warmup ? "— : —" : String(ls) + " : " + String(rs);
      return (
        '<div class="server-hero-matchup">' +
        '<span class="server-hero-matchup-name server-hero-matchup-left">' +
        QLDashboard.escapeHtml(displayNickname(left, nickBySteam)) +
        "</span>" +
        '<span class="server-hero-matchup-score">' +
        QLDashboard.escapeHtml(scoreText) +
        "</span>" +
        '<span class="server-hero-matchup-name server-hero-matchup-right">' +
        QLDashboard.escapeHtml(displayNickname(right, nickBySteam)) +
        "</span></div>"
      );
    }

    var parts = [];
    for (var i = 0; i < sorted.length; i++) {
      var p = sorted[i];
      var name = displayNickname(p, nickBySteam);
      var meta = "";
      if (!warmup) {
        meta =
          '<span class="server-hero-player-meta">' +
          QLDashboard.escapeHtml(String(scoreboardStats(p, true).score)) +
          "</span>";
      } else {
        var team = meaningfulTeam(p.team);
        if (team) {
          meta =
            '<span class="server-hero-player-meta">' +
            QLDashboard.escapeHtml(team) +
            "</span>";
        }
      }
      parts.push(
        '<span class="server-hero-player">' +
          QLDashboard.escapeHtml(name) +
          meta +
          "</span>",
      );
    }
    return (
      '<div class="server-hero-players-line">' + parts.join('<span class="server-hero-sep"> · </span>') + "</div>"
    );
  }

  function renderMatchupBanner(archive, scrubMs, livePlayers, liveData) {
    var players = resolveDisplayPlayers(archive, scrubMs, livePlayers);
    if (players.length !== 2) return "";
    var nickBySteam = buildNicknameBySteam(archive, livePlayers);
    var gt = String(archive.gametype || "").trim().toLowerCase();
    var duelLike = gt === "duel" || gt === "ffa" || gt === "deathmatch";
    if (!duelLike && players.length === 2) duelLike = true;
    if (!duelLike) return "";
    var left = players[0];
    var right = players[1];
    var ls = scoreboardStats(left, true).score;
    var rs = scoreboardStats(right, true).score;
    var scoreText =
      liveData && QLDashboard.isWarmupPhase(liveData)
        ? "— : —"
        : String(ls) + " : " + String(rs);
    return (
      '<div class="results-matchup">' +
      '<span class="results-matchup-name results-matchup-left">' +
      QLDashboard.escapeHtml(displayNickname(left, nickBySteam)) +
      "</span>" +
      '<span class="results-matchup-score">' +
      QLDashboard.escapeHtml(scoreText) +
      "</span>" +
      '<span class="results-matchup-name results-matchup-right">' +
      QLDashboard.escapeHtml(displayNickname(right, nickBySteam)) +
      "</span></div>"
    );
  }

  function renderScoreboard(archive, scrubMs, livePlayers, liveData) {
    var players = resolveDisplayPlayers(archive, scrubMs, livePlayers);
    if (!players.length) return "";
    var nickBySteam = buildNicknameBySteam(archive, livePlayers);
    var rows = players.slice().sort(function (a, b) {
      var sa = scoreboardStats(a, true).score;
      var sb = scoreboardStats(b, true).score;
      if (sb !== sa) return sb - sa;
      return scoreboardStats(b, true).kills - scoreboardStats(a, true).kills;
    });
    var html =
      '<div class="results-scoreboard-wrap"><h3 class="results-scoreboard-title">' +
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
      var st = scoreboardStats(p, true);
      var name = displayNickname(p, nickBySteam);
      var net = st.net > 0 ? "+" + st.net : String(st.net);
      html +=
        "<tr><td>" +
        QLDashboard.escapeHtml(name) +
        '</td><td class="sb-num">' +
        QLDashboard.escapeHtml(scoreboardCell(liveData, st.score)) +
        '</td><td class="sb-num">' +
        QLDashboard.escapeHtml(scoreboardCell(liveData, st.kills)) +
        '</td><td class="sb-num">' +
        QLDashboard.escapeHtml(scoreboardCell(liveData, st.deaths)) +
        '</td><td class="sb-num">' +
        QLDashboard.escapeHtml(
          liveData && QLDashboard.isWarmupPhase(liveData) ? "—" : net,
        ) +
        "</td></tr>";
    }
    html += "</tbody></table></div>";
    return html;
  }

  global.QLDashboardAnalytics = {
    stripQuakeColors: stripQuakeColors,
    isSteamId64: isSteamId64,
    buildNicknameBySteam: buildNicknameBySteam,
    displayNickname: displayNickname,
    formatGameTime: formatGameTime,
    iconImg: iconImg,
    weaponInfo: weaponInfo,
    itemInfo: itemInfo,
    formatTimelineScrubTime: formatTimelineScrubTime,
    formatCountdownRemainingMs: formatCountdownRemainingMs,
    countdownLeadInMs: countdownLeadInMs,
    formatReplayDuration: formatReplayDuration,
    formatWhen: formatWhen,
    computeTimelineMaxMs: computeTimelineMaxMs,
    computeTimelineMinMs: computeTimelineMinMs,
    lifecycleMarker: lifecycleMarker,
    matchEndGameTimeMs: matchEndGameTimeMs,
    countdownStartWallMs: countdownStartWallMs,
    matchStartWallMs: matchStartWallMs,
    matchEndWallMs: matchEndWallMs,
    hasLifecycleMarkers: hasLifecycleMarkers,
    resolveScrubLifecyclePhase: resolveScrubLifecyclePhase,
    renderLifecyclePhaseBadge: renderLifecyclePhaseBadge,
    updateLifecyclePhaseBadge: updateLifecyclePhaseBadge,
    renderTimelineLifecycleMarkers: renderTimelineLifecycleMarkers,
    computeCombatClockAnchor: computeCombatClockAnchor,
    normalizeArchiveCombatClock: normalizeArchiveCombatClock,
    normalizeArchivePickupTimes: normalizeArchivePickupTimes,
    enrichArchivePickupsFromReplay: enrichArchivePickupsFromReplay,
    renderAnalytics: renderAnalytics,
    renderAnalyticsPanels: renderAnalyticsPanels,
    renderTimelineScrubber: renderTimelineScrubber,
    filterRowsByGameTime: filterRowsByGameTime,
    accuracyAtScrub: accuracyAtScrub,
    preserveAnalyticsScroll: preserveAnalyticsScroll,
    scoreboardStats: scoreboardStats,
    resolveFinalPlayers: resolveFinalPlayers,
    resolvePlayersAtScrub: resolvePlayersAtScrub,
    resolveDisplayPlayers: resolveDisplayPlayers,
    buildReplayDeathWindowsGameMs: buildReplayDeathWindowsGameMs,
    buildReplayPositionTimeline: buildReplayPositionTimeline,
    nearestReplayPositionsAtScrub: nearestReplayPositionsAtScrub,
    attachReplayScrubData: attachReplayScrubData,
    attachReplayDeathWindows: attachReplayDeathWindows,
    hasReplayScrubData: hasReplayScrubData,
    playerDeadWindowAtScrub: playerDeadWindowAtScrub,
    playerCombatWindowAtScrub: playerCombatWindowAtScrub,
    archiveForScore: archiveForScore,
    renderMatchupBanner: renderMatchupBanner,
    renderScoreboard: renderScoreboard,
    playersFromPositionRows: playersFromPositionRows,
    mergePlayerRosters: mergePlayerRosters,
    renderHeroPlayers: renderHeroPlayers,
    renderCheckpointRestorePanel: renderCheckpointRestorePanel,
    pickCfgText: pickCfgText,
    toClientRestoreCfg: toClientRestoreCfg,
    RESTORECP_CLIENT_PREFIX: RESTORECP_CLIENT_PREFIX,
  };
})(typeof window !== "undefined" ? window : globalThis);
