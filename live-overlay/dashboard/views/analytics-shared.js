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
    RG: "weapon_railgun",
    RAIL: "weapon_railgun",
    RAILGUN: "weapon_railgun",
    LG: "weapon_lightning",
    LIGHTNING: "weapon_lightning",
    "LIGHTNING GUN": "weapon_lightning",
    PG: "weapon_plasmagun",
    PLASMA: "weapon_plasmagun",
    PLASMAGUN: "weapon_plasmagun",
    "PLASMA GUN": "weapon_plasmagun",
    GL: "weapon_grenadelauncher",
    GRENADE: "weapon_grenadelauncher",
    "GRENADE LAUNCHER": "weapon_grenadelauncher",
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
  };

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

  /** Legacy archives: warmup pickups carry ~15min game_time_ms; remap into combat window. */
  function normalizeArchivePickupTimes(archive) {
    if (!archive || !archive.pickups || !archive.pickups.length) return archive;
    var combatMax = computeTimelineMaxMs(archive, null);
    if (combatMax == null || combatMax <= 0) return archive;
    var combatMin = computeTimelineMinMs(archive);
    var staleSlack = 60000;
    var stale = [];
    var fresh = [];
    for (var i = 0; i < archive.pickups.length; i++) {
      var row = archive.pickups[i];
      var gt = Number(row.game_time_ms);
      if (!isNaN(gt) && gt > combatMax + staleSlack) stale.push(row);
      else fresh.push(row);
    }
    if (!stale.length) return archive;
    stale.sort(function (a, b) {
      var ta = a.ts || a.game_time_ms || 0;
      var tb = b.ts || b.game_time_ms || 0;
      return String(ta).localeCompare(String(tb));
    });
    var span = Math.max(combatMax - (combatMin != null ? combatMin : 0), 1000);
    var step = Math.max(1000, Math.floor(span / Math.max(stale.length, 1)));
    var base = combatMin != null ? combatMin : 0;
    var normalizedStale = stale.map(function (row, idx) {
      return Object.assign({}, row, { game_time_ms: base + idx * step });
    });
    return Object.assign({}, archive, {
      pickups: fresh.concat(normalizedStale),
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

  function computeTimelineMinMs(_archive) {
    return 0;
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

  // One row per player+weapon, merging kills (from deaths) with accuracy
  // (hits/shots/acc%). Death weapons ("ROCKET", "ROCKET SPLASH") and accuracy
  // abbrs ("RL") collapse to the same weapon class, so splash + direct kills sit
  // on the same row as that weapon's accuracy.
  function aggregateWeaponStats(deaths, accuracyRows) {
    var map = {};
    var order = 0;

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
      } else if (name && (!map[key].player || map[key].player === "—")) {
        map[key].player = name;
      }
      return map[key];
    }

    (deaths || []).forEach(function (d) {
      var steamId = String(d.killer_steam_id64 || "").trim();
      var player = stripQuakeColors(d.killer) || QLDashboard.t("matchWorldSuicide");
      ensure(steamId, player, weaponInfo(d.weapon)).kills += 1;
    });

    (accuracyRows || []).forEach(function (r) {
      var steamId = String(r.steam_id64 || "").trim();
      var row = ensure(steamId, displayNickname(r), weaponInfo(r.weapon));
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
        '<span class="ql-kill-time">' +
        QLDashboard.escapeHtml(formatGameTime(d.game_time_ms)) +
        "</span>" +
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
        "</div>";
    }
    html += "</div>";
    return html;
  }

  // Pickup quick-filter state. Persisted at module scope so it survives the
  // frequent panel re-renders driven by the timeline scrubber / live updates.
  var _pickupRows = [];
  var _pickupFilter = { player: "", item: "" };
  var _pickupFiltersOpen = false;

  function pickupMatchesFilter(p) {
    if (_pickupFilter.player && displayNickname(p) !== _pickupFilter.player) {
      return false;
    }
    if (_pickupFilter.item && itemInfo(p.item || p.text).label !== _pickupFilter.item) {
      return false;
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
    var players = [];
    var seenPlayer = {};
    var items = [];
    var seenItem = {};
    for (var i = 0; i < _pickupRows.length; i++) {
      var p = _pickupRows[i];
      var nick = displayNickname(p);
      if (nick && !seenPlayer[nick]) {
        seenPlayer[nick] = true;
        players.push(nick);
      }
      var info = itemInfo(p.item || p.text);
      if (info.label && !seenItem[info.label]) {
        seenItem[info.label] = true;
        items.push(info);
      }
    }
    players.sort(function (a, b) {
      return a.localeCompare(b);
    });
    items.sort(function (a, b) {
      return a.label.localeCompare(b.label);
    });
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
          _pickupFilter.player === players[j],
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
        html += chipHtml("data-ql-pk-item", it.label, inner, _pickupFilter.item === it.label);
      }
      html += "</div>";
    }
    html += "</div>";
    return html;
  }

  function renderPickupsList() {
    var rows = _pickupRows.filter(pickupMatchesFilter);
    if (!rows.length) {
      return (
        '<p class="match-analytics-empty">' +
        QLDashboard.escapeHtml(QLDashboard.t("matchPickupsFilterEmpty")) +
        "</p>"
      );
    }
    var html = '<div class="ql-pickups-list">';
    for (var i = 0; i < rows.length; i++) {
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
      var active = !!(_pickupFilter.player || _pickupFilter.item);
      head =
        '<div class="ql-pk-toolbar">' +
        '<button type="button" class="ql-chip ql-pk-toggle' +
        (_pickupFiltersOpen || active ? " ql-chip-active" : "") +
        '" data-ql-pk-toggle="1">' +
        QLDashboard.escapeHtml(QLDashboard.t("matchPickupsFilterToggle")) +
        (active ? " •" : "") +
        "</button>" +
        "</div>";
    }
    return head + (filters && _pickupFiltersOpen ? filters : "") + renderPickupsList();
  }

  function refreshPickupsPanel() {
    var el = document.getElementById("ql-pickups-panel");
    if (el) el.innerHTML = renderPickupsInner();
  }

  function bindPickupFilters() {
    if (global.__qlPickupFilterBound) return;
    global.__qlPickupFilterBound = true;
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var tg = t.closest("[data-ql-pk-toggle]");
      if (tg) {
        _pickupFiltersOpen = !_pickupFiltersOpen;
        refreshPickupsPanel();
        return;
      }
      var pb = t.closest("[data-ql-pk-player]");
      if (pb) {
        var pv = pb.getAttribute("data-ql-pk-player");
        _pickupFilter.player = _pickupFilter.player === pv ? "" : pv;
        refreshPickupsPanel();
        return;
      }
      var ib = t.closest("[data-ql-pk-item]");
      if (ib) {
        var iv = ib.getAttribute("data-ql-pk-item");
        _pickupFilter.item = _pickupFilter.item === iv ? "" : iv;
        refreshPickupsPanel();
      }
    });
  }

  // Drop a filter whose target is no longer present (e.g. after switching match),
  // so the user is never stuck with an empty list and no chip to clear it.
  function pruneStalePickupFilter() {
    if (_pickupFilter.player) {
      var hasPlayer = _pickupRows.some(function (p) {
        return displayNickname(p) === _pickupFilter.player;
      });
      if (!hasPlayer) _pickupFilter.player = "";
    }
    if (_pickupFilter.item) {
      var hasItem = _pickupRows.some(function (p) {
        return itemInfo(p.item || p.text).label === _pickupFilter.item;
      });
      if (!hasItem) _pickupFilter.item = "";
    }
  }

  function renderPickups(pickups) {
    bindPickupFilters();
    _pickupRows = sortByGameTime(pickups);
    pruneStalePickupFilter();
    return '<div id="ql-pickups-panel">' + renderPickupsInner() + "</div>";
  }

  function renderWeaponStats(deaths, accuracyRows) {
    var rows = aggregateWeaponStats(deaths, accuracyRows);
    if (!rows.length) {
      return (
        '<p class="match-analytics-empty">' +
        QLDashboard.escapeHtml(QLDashboard.t("matchAnalyticsEmpty")) +
        "</p>"
      );
    }
    var html =
      '<table class="data-table ql-ws-table"><thead><tr><th>' +
      QLDashboard.escapeHtml(QLDashboard.t("matchColPlayer")) +
      "</th><th>" +
      QLDashboard.escapeHtml(QLDashboard.t("matchColWeapon")) +
      '</th><th class="ql-ws-num">' +
      QLDashboard.escapeHtml(QLDashboard.t("matchColKills")) +
      '</th><th class="ql-ws-num">' +
      QLDashboard.escapeHtml(QLDashboard.t("matchColHits")) +
      '</th><th class="ql-ws-num">' +
      QLDashboard.escapeHtml(QLDashboard.t("matchColShots")) +
      '</th><th class="ql-ws-num">' +
      QLDashboard.escapeHtml(QLDashboard.t("matchColAccuracy")) +
      "</th></tr></thead><tbody>";
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var info = r.info;
      var weaponCell = info
        ? '<span class="ql-ws-weapon">' +
          (info.sprite ? iconImg(info.sprite, info.abbr, "ql-ws-icon") : "") +
          QLDashboard.escapeHtml(info.abbr) +
          "</span>"
        : QLDashboard.escapeHtml("—");
      html +=
        "<tr><td>" +
        QLDashboard.escapeHtml(r.player) +
        "</td><td>" +
        weaponCell +
        '</td><td class="ql-ws-num">' +
        (r.kills ? r.kills : "—") +
        '</td><td class="ql-ws-num">' +
        (r.hits != null ? r.hits : "—") +
        '</td><td class="ql-ws-num">' +
        (r.shots != null ? r.shots : "—") +
        '</td><td class="ql-ws-num">' +
        (r.pct != null ? r.pct.toFixed(1) : "—") +
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

  function renderAnalyticsPanels(archive, livePlayers, opts) {
    opts = opts || {};
    var debug = !!opts.debug;
    var scrubMs = opts.scrubMs;
    var liveData = opts.liveData || null;
    archive = normalizeArchivePickupTimes(archive);

    var maxMs = computeTimelineMaxMs(archive, liveData);
    var atEnd = scrubMs == null || (maxMs != null && Number(scrubMs) >= maxMs);
    var deaths = filterRowsByGameTime(archive.deaths || [], scrubMs);
    if (liveData && QLDashboard.isWarmupPhase(liveData)) {
      deaths = [];
    }
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
      '<div class="match-analytics-panel match-analytics-span-2"><h3>' +
      QLDashboard.escapeHtml(QLDashboard.t("matchSectionWeapons")) +
      '</h3><div class="match-analytics-scroll">' +
      renderWeaponStats(deaths, accuracy) +
      "</div></div>";
    html += "</div>";
    return html;
  }

  function renderAnalytics(archive, livePlayers, opts) {
    opts = opts || {};
    var scrubMs = opts.scrubMs;
    var liveData = opts.liveData || null;
    var showTimeline = opts.showTimeline !== false;
    archive = normalizeArchivePickupTimes(archive);

    var html = "";
    if (showTimeline) {
      html += renderTimelineScrubber(archive, liveData, scrubMs);
    }
    html +=
      '<div id="match-analytics-panels">' +
      renderAnalyticsPanels(archive, livePlayers, opts) +
      "</div>";
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
    normalizeArchivePickupTimes: normalizeArchivePickupTimes,
    renderAnalytics: renderAnalytics,
    renderAnalyticsPanels: renderAnalyticsPanels,
    renderTimelineScrubber: renderTimelineScrubber,
    filterRowsByGameTime: filterRowsByGameTime,
    accuracyAtScrub: accuracyAtScrub,
  };
})(typeof window !== "undefined" ? window : globalThis);
