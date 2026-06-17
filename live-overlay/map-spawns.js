(function (global) {
  "use strict";

  var STORAGE_KEY = "ql-map-spawns-settings";
  var SETTINGS_VERSION = 6;

  var HEALTH_CLASSNAMES = [
    "item_health_small",
    "item_health",
    "item_health_large",
    "item_health_mega",
  ];
  var ARMOR_CLASSNAMES = [
    "item_armor_jacket",
    "item_armor_combat",
    "item_armor_body",
    "item_armor_shard",
  ];
  var POWERUP_CLASSNAME_LIST = [
    "item_quad",
    "item_regen",
    "item_haste",
    "item_enviro",
    "item_invis",
    "item_invulnerability",
  ];

  var CLASSNAME_LABELS = {
    item_health_small: "Green (5 HP)",
    item_health: "25 HP",
    item_health_large: "50 HP",
    item_health_mega: "Mega",
    item_armor_jacket: "Green (GA)",
    item_armor_shard: "Shard",
    item_armor_combat: "Yellow (YA)",
    item_armor_body: "Red (RA)",
    item_quad: "Quad",
    item_regen: "Regen",
    item_haste: "Haste",
    item_enviro: "Battle Suit",
    item_invis: "Invis",
    item_invulnerability: "Invuln",
  };

  // QL default respawn seconds (telemetry has no respawn_at yet).
  // Weapons: Duel (and FFA/CA TBD) map spawns ~5s; TDM map weapons 30s (operator); pak00 items.c 15s.
  // Overlay weapon rings are not wired yet — when added, prefer payload respawn_sec / server cvar.
  var WEAPON_RESPAWN_SEC_DEFAULT = 5;
  var ITEM_RESPAWN_SEC = {
    item_health_small: 35,
    item_health: 35,
    item_health_large: 35,
    item_health_mega: 35,
    item_armor_jacket: 25,
    item_armor_shard: 25,
    item_armor_combat: 25,
    item_armor_body: 25,
    item_quad: 120,
    item_regen: 120,
    item_haste: 120,
    item_enviro: 120,
    item_invis: 120,
    item_invulnerability: 120,
  };

  // Operator-confirmed: Mega 35s default; Bloodrun (and similar) 120s.
  var MEGA_RESPAWN_SEC_BY_MAP = {
    bloodrun: 120,
  };

  function normalizeMapKey(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "");
  }

  function megaRespawnSecForMap(mapName) {
    var key = normalizeMapKey(mapName);
    if (Object.prototype.hasOwnProperty.call(MEGA_RESPAWN_SEC_BY_MAP, key)) {
      return MEGA_RESPAWN_SEC_BY_MAP[key];
    }
    return ITEM_RESPAWN_SEC.item_health_mega;
  }

  function weaponRespawnSecForGametype(gametype) {
    var gt = normalizeGametype(gametype);
    if (gt === "tdm") return 30;
    return WEAPON_RESPAWN_SEC_DEFAULT;
  }
  var PICKUP_MATCH_RADIUS = 128;

  var DEFAULT_ITEM_CATEGORIES = {
    weapons: true,
    ammo: true,
    health: true,
    armor: true,
    powerups: true,
    item_health_small: true,
    item_health: true,
    item_health_large: true,
    item_health_mega: true,
    item_armor_jacket: true,
    item_armor_shard: false,
    item_armor_combat: true,
    item_armor_body: true,
    item_quad: true,
    item_regen: true,
    item_haste: true,
    item_enviro: true,
    item_invis: true,
    item_invulnerability: true,
  };
  var DEFAULTS = {
    version: SETTINGS_VERSION,
    enabled: false,
    anchor: "player",
    referencePlayerId: null,
    showInactive: true,
    showThreshold: true,
    middleVal: null,
    layers: {},
    itemCategories: Object.assign({}, DEFAULT_ITEM_CATEGORIES),
  };

  function qs(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function spawnsParam() {
    return (qs("spawns") || "").toLowerCase();
  }

  function loadSettings() {
    var s = Object.assign({}, DEFAULTS);
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) Object.assign(s, JSON.parse(raw));
    } catch (_e) {
      /* ignore */
    }
    if (!s.layers || typeof s.layers !== "object") s.layers = {};
    if (!s.itemCategories || typeof s.itemCategories !== "object") {
      s.itemCategories = Object.assign({}, DEFAULT_ITEM_CATEGORIES);
    } else {
      s.itemCategories = Object.assign({}, DEFAULT_ITEM_CATEGORIES, s.itemCategories);
    }
    if (Number(s.version) !== SETTINGS_VERSION) {
      var prevVersion = Number(s.version) || 0;
      if (prevVersion < 3) {
        s.itemCategories = Object.assign({}, DEFAULT_ITEM_CATEGORIES);
      } else if (prevVersion < 4) {
        s.itemCategories = migrateItemCategoriesV4(s.itemCategories);
      } else if (prevVersion < 5) {
        s.itemCategories = migrateItemCategoriesV5(s.itemCategories);
      } else if (prevVersion < 6) {
        s.itemCategories = migrateItemCategoriesV6(s.itemCategories);
      }
      s.version = SETTINGS_VERSION;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      } catch (_e2) {
        /* private mode */
      }
    }
    var p = spawnsParam();
    if (p === "1" || p === "true" || p === "on") s.enabled = true;
    if (p === "settings") {
      s.enabled = true;
      s.panelOpen = true;
    }
    if (qs("spawn_anchor") === "cursor" || qs("spawn_anchor") === "player") {
      s.anchor = qs("spawn_anchor");
    }
    var gtParam = qs("gametype");
    if (gtParam) s.gametypeOverride = gtParam;
    return s;
  }

  function migrateItemCategoriesV4(old) {
    old = old || {};
    var next = Object.assign({}, DEFAULT_ITEM_CATEGORIES, old);
    if (old.health === false) {
      for (var hi = 0; hi < HEALTH_CLASSNAMES.length; hi++) {
        next[HEALTH_CLASSNAMES[hi]] = false;
      }
    }
    if (old.armor === false) {
      for (var ai = 0; ai < ARMOR_CLASSNAMES.length; ai++) {
        next[ARMOR_CLASSNAMES[ai]] = false;
      }
    }
    if (old.shards === false) {
      next.item_armor_shard = false;
    }
    if (old.powerups === false) {
      for (var pi = 0; pi < POWERUP_CLASSNAME_LIST.length; pi++) {
        next[POWERUP_CLASSNAME_LIST[pi]] = false;
      }
    }
    return next;
  }

  function migrateItemCategoriesV5(old) {
    old = old || {};
    var next = Object.assign({}, DEFAULT_ITEM_CATEGORIES, old);
    if (old.green == null) {
      next.green = old.health !== false && old.item_health_small !== false;
    }
    if (old.shards == null) {
      next.shards = old.armor !== false && old.item_armor_shard !== false;
    }
    return next;
  }

  function migrateItemCategoriesV6(old) {
    old = old || {};
    var next = migrateItemCategoriesV5(old);
    if (old.green === false) {
      next.item_health_small = false;
    } else if (old.green === true) {
      next.item_health_small = old.item_health_small !== false;
    }
    if (old.shards === false) {
      next.item_armor_shard = false;
    } else if (old.shards === true) {
      next.item_armor_shard = true;
    }
    delete next.green;
    delete next.shards;
    return next;
  }

  function itemClassnameLabel(classname) {
    if (CLASSNAME_LABELS[classname]) return CLASSNAME_LABELS[classname];
    return String(classname || "").replace(/^item_/, "");
  }

  function saveSettings(settings) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          enabled: settings.enabled,
          anchor: settings.anchor,
          referencePlayerId: settings.referencePlayerId,
          showInactive: settings.showInactive,
          showThreshold: settings.showThreshold,
          middleVal: settings.middleVal,
          layers: settings.layers,
          itemCategories: settings.itemCategories,
          version: SETTINGS_VERSION,
        }),
      );
    } catch (_e) {
      /* private mode */
    }
  }

  function autoMiddleVal(spawnCount) {
    var n = Number(spawnCount) || 0;
    if (n <= 0) return 0;
    return Math.floor(n / 2);
  }

  function stripQuakeColors(text) {
    return String(text || "")
      .replace(/\^[0-9a-zA-Z]/g, "")
      .trim();
  }

  function playerMotionId(p, index) {
    if (p.steam_id64 != null && String(p.steam_id64).trim() !== "") {
      return String(p.steam_id64).trim();
    }
    return String(p.nickname || "p" + index);
  }

  function playerDisplayName(p, index) {
    var label = stripQuakeColors(p.nickname || "");
    if (label) return label;
    if (p.steam_id64) return String(p.steam_id64);
    return "Player " + (index + 1);
  }

  function classifySpawns(refX, refY, spawns, middleVal) {
    var n = spawns.length;
    if (!n || middleVal == null || middleVal < 0 || middleVal >= n) {
      return { possible: {}, thresholdMax: null, rejectMax: null };
    }

    var dist = [];
    for (var i = 0; i < n; i++) {
      var s = spawns[i];
      var dx = Math.abs(refX - s.x);
      var dy = Math.abs(refY - s.y);
      dist.push({ idx: i, max: Math.max(dx, dy), min: Math.min(dx, dy) });
    }

    var sorted = dist.slice().sort(function (a, b) {
      if (a.max === b.max) return b.idx - a.idx;
      return a.max - b.max;
    });

    var threshold = sorted[middleVal].max;
    var possCount = n - middleVal;
    var possible = {};
    var c = 0;
    for (var j = n - 1; j >= 0; j--) {
      var d = sorted[j];
      if (d.max >= threshold && c < possCount) {
        possible[d.idx] = true;
        c++;
      }
    }

    return {
      possible: possible,
      thresholdMax: threshold,
      rejectMax: sorted[middleVal - 1] ? sorted[middleVal - 1].max : null,
    };
  }

  function wildcardMatch(pattern, value) {
    if (!pattern) return true;
    if (Array.isArray(pattern)) {
      for (var i = 0; i < pattern.length; i++) {
        if (wildcardMatch(pattern[i], value)) return true;
      }
      return false;
    }
    var p = String(pattern);
    if (p.indexOf("*") < 0) return p === value;
    if (p.slice(-1) === "*") return value.indexOf(p.slice(0, -1)) === 0;
    return p === value;
  }

  function normalizeGametype(gt) {
    var g = String(gt || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    if (!g) return "";
    if (
      g === "1v1" ||
      g === "1on1" ||
      g === "oneonone" ||
      g === "one_on_one" ||
      g === "duel" ||
      g === "duels"
    ) {
      return "duel";
    }
    if (
      g === "ffa" ||
      g === "freeforall" ||
      g === "free_for_all" ||
      g === "deathmatch" ||
      g === "dm"
    ) {
      return "dm";
    }
    if (
      g === "tdm" ||
      g === "team_deathmatch" ||
      g === "teamdeathmatch" ||
      g === "team_dm"
    ) {
      return "tdm";
    }
    if (g === "tourney" || g === "tournament") {
      return "duel";
    }
    return g;
  }

  function resolvePayloadGametype(payload, gametypeOverride) {
    if (gametypeOverride) return gametypeOverride;
    var gtParam = qs("gametype");
    if (gtParam) return gtParam;
    if (payload && payload.gametype != null && payload.gametype !== "") {
      return payload.gametype;
    }
    return null;
  }

  function entityMatchesGametype(ent, gametype) {
    var gt = normalizeGametype(gametype);
    if (!gt) return true;
    var attrs = ent.attrs || {};
    if (attrs.gametype && normalizeGametype(attrs.gametype) !== gt) {
      return false;
    }
    if (attrs.not_gametype && normalizeGametype(attrs.not_gametype) === gt) {
      return false;
    }
    return true;
  }

  function entityIsUniversalGametype(ent) {
    var attrs = (ent && ent.attrs) || {};
    return !attrs.gametype && !attrs.not_gametype;
  }

  function entityVisibleForGametypeFilter(ent, gametype, filterGametype) {
    if (!filterGametype) return true;
    var gt = normalizeGametype(gametype);
    if (!gt) return entityIsUniversalGametype(ent);
    return entityMatchesGametype(ent, gametype);
  }

  function entityMatchesFilter(ent, filter) {
    if (!filter) return true;
    if (filter.classname && !wildcardMatch(filter.classname, ent.classname)) {
      return false;
    }
    if (filter.entity_ids && filter.entity_ids.length) {
      if (filter.entity_ids.indexOf(ent.id) < 0) return false;
    }
    if (filter.attrs) {
      var attrs = ent.attrs || {};
      for (var key in filter.attrs) {
        if (!Object.prototype.hasOwnProperty.call(filter.attrs, key)) continue;
        if (String(attrs[key]) !== String(filter.attrs[key])) return false;
      }
    }
    return true;
  }

  var TELEPORT_EXIT_CLASSNAMES = {
    target_position: true,
    misc_teleporter_dest: true,
  };

  var TELEPORT_ENTRANCE_CLASSNAMES = {
    trigger_teleport: true,
    misc_teleporter: true,
  };

  var HIDDEN_ENTITY_CLASSNAMES = {
    trigger_push: true,
    ammo_pack: true,
  };

  var POWERUP_CLASSNAMES = {
    item_quad: true,
    item_regen: true,
    item_haste: true,
    item_enviro: true,
    item_invis: true,
    item_invulnerability: true,
  };

  function entityItemCategory(classname) {
    if (!classname) return null;
    if (classname.indexOf("weapon_") === 0) return "weapons";
    if (classname.indexOf("ammo_") === 0) return "ammo";
    if (classname.indexOf("item_health") === 0) return "health";
    if (classname.indexOf("item_armor") === 0) return "armor";
    if (POWERUP_CLASSNAMES[classname]) return "powerups";
    return null;
  }

  function entityVisibleForCategory(classname, itemCategories) {
    var cat = entityItemCategory(classname);
    if (!cat) return true;
    var cats = itemCategories || DEFAULT_ITEM_CATEGORIES;
    if (cats[cat] === false) return false;
    if (
      classname &&
      Object.prototype.hasOwnProperty.call(cats, classname)
    ) {
      return cats[classname] !== false;
    }
    return true;
  }

  function entityPassesItemCategory(ent, settings) {
    return entityVisibleForCategory(
      ent && ent.classname,
      settings && settings.itemCategories,
    );
  }

  function isTeleportExit(ent) {
    return !!(ent && TELEPORT_EXIT_CLASSNAMES[ent.classname]);
  }

  function isTeleportEntrance(ent) {
    return !!(ent && TELEPORT_ENTRANCE_CLASSNAMES[ent.classname]);
  }

  function isHiddenEntity(ent) {
    return !!(ent && HIDDEN_ENTITY_CLASSNAMES[ent.classname]);
  }

  function buildTeleportGraph(entities) {
    var byName = {};
    var entrances = [];
    var linkedExitIds = {};
    for (var i = 0; i < entities.length; i++) {
      var ent = entities[i];
      var attrs = ent.attrs || {};
      if (attrs.targetname) byName[attrs.targetname] = ent;
    }
    for (var j = 0; j < entities.length; j++) {
      var src = entities[j];
      if (!isTeleportEntrance(src)) continue;
      var srcAttrs = src.attrs || {};
      var targetKey = srcAttrs.target;
      if (!targetKey) continue;
      var dest = byName[targetKey];
      if (!dest || !isTeleportExit(dest)) continue;
      linkedExitIds[dest.id] = true;
      entrances.push({ entrance: src, exit: dest });
    }
    var exits = [];
    for (var k = 0; k < entities.length; k++) {
      var candidate = entities[k];
      if (isTeleportExit(candidate) && linkedExitIds[candidate.id]) {
        exits.push(candidate);
      }
    }
    return { entrances: entrances, exits: exits };
  }

  function resolveStyle(classname, styles) {
    if (!styles) return { color: "#cbd5e1", shape: "circle" };
    var keys = Object.keys(styles);
    for (var i = 0; i < keys.length; i++) {
      if (wildcardMatch(keys[i], classname)) return styles[keys[i]];
    }
    return { color: "#cbd5e1", shape: "circle" };
  }

  function resolveSprite(classname, spriteMap) {
    if (!spriteMap || !classname) return null;
    var classnames = spriteMap.classnames || spriteMap;
    if (classnames[classname]) return classnames[classname];
    return null;
  }

  function shortLabel(classname) {
    if (!classname) return "?";
    if (classname.indexOf("weapon_") === 0) {
      return classname.slice(7, 10).toUpperCase();
    }
    if (classname.indexOf("item_health") === 0) return "HP";
    if (classname.indexOf("item_armor") === 0) return "AR";
    if (classname.indexOf("ammo_") === 0) {
      return classname.slice(5, 8).toUpperCase();
    }
    if (classname.indexOf("info_player_") === 0) return "S";
    return classname.slice(0, 3).toUpperCase();
  }

  function MapSpawns() {
    this.settings = loadSettings();
    this.mapName = null;
    this.entityData = null;
    this.displayConfig = null;
    this.spriteMap = null;
    this.mapDisplay = null;
    this.transform = null;
    this.players = [];
    this.gametype = null;
    this.lastGametype = null;
    this.lastMatchId = null;
    this.lastPayload = null;
    this.cursorWorld = null;
    this.layer = null;
    this.thresholdEl = null;
    this.refEl = null;
    this.panel = null;
    this.toggleBtn = null;
    this.cursorCaptureEl = null;
    this.respawnLayer = null;
    this._itemRespawns = {};
    this._respawnLoopId = 0;
    this._anchorMotion = {
      ref: null,
      threshold: null,
      loopId: 0,
    };
    this._boundMove = this.onPointerMove.bind(this);
    this._boundLeave = this.onPointerLeave.bind(this);
  }

  MapSpawns.prototype._smoothAlpha = function () {
    if (window.OverlayApp && typeof OverlayApp.mapSmoothAlpha === "function") {
      if (
        typeof OverlayApp.mapSmoothEnabled === "function" &&
        !OverlayApp.mapSmoothEnabled()
      ) {
        return 1;
      }
      return OverlayApp.mapSmoothAlpha();
    }
    return 0.12;
  };

  MapSpawns.prototype._lerpNum = function (a, b, t) {
    if (window.OverlayApp && typeof OverlayApp.lerpNum === "function") {
      return OverlayApp.lerpNum(a, b, t);
    }
    return a + (b - a) * t;
  };

  MapSpawns.prototype._stopRespawnLoop = function () {
    if (this._respawnLoopId) {
      cancelAnimationFrame(this._respawnLoopId);
      this._respawnLoopId = 0;
    }
  };

  MapSpawns.prototype._clearItemRespawns = function () {
    this._stopRespawnLoop();
    for (var key in this._itemRespawns) {
      var row = this._itemRespawns[key];
      if (row.el && row.el.parentNode) row.el.parentNode.removeChild(row.el);
    }
    this._itemRespawns = {};
    if (this.respawnLayer) this.respawnLayer.innerHTML = "";
  };

  MapSpawns.prototype._itemRespawnKey = function (entityId) {
    return (this.mapName || "") + ":" + entityId;
  };

  MapSpawns.prototype._itemOnRespawnCooldown = function (entityId) {
    var row = this._itemRespawns[this._itemRespawnKey(entityId)];
    return !!(row && row.expiresAt > Date.now());
  };

  function formatRespawnCountdown(remainingMs, respawnMs) {
    var totalSec = Math.max(1, Math.round(respawnMs / 1000));
    if (remainingMs <= 0) return "0";
    var sec = Math.round(remainingMs / 1000);
    if (sec < 1) sec = 1;
    if (sec > totalSec) sec = totalSec;
    return String(sec);
  }

  MapSpawns.prototype.findNearestItemEntity = function (classname, x, y) {
    var entities = (this.entityData && this.entityData.entities) || [];
    if (!classname) return null;

    var matches = [];
    for (var i = 0; i < entities.length; i++) {
      var ent = entities[i];
      if (ent.classname !== classname) continue;
      if (isHiddenEntity(ent)) continue;
      matches.push(ent);
    }
    if (!matches.length) return null;
    if (matches.length === 1) return matches[0];

    if (x == null || y == null) return matches[0];

    var wx = Number(x);
    var wy = Number(y);
    if (!isFinite(wx) || !isFinite(wy)) return matches[0];

    var maxDist = PICKUP_MATCH_RADIUS;
    var best = null;
    var bestD2 = maxDist * maxDist;
    for (var j = 0; j < matches.length; j++) {
      var near = matches[j];
      var dx = Number(near.x) - wx;
      var dy = Number(near.y) - wy;
      var d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = near;
      }
    }
    return best;
  };

  MapSpawns.prototype.respawnDurationMs = function (item, data) {
    if (data && data.respawn_sec != null && isFinite(Number(data.respawn_sec))) {
      return Math.max(500, Number(data.respawn_sec) * 1000);
    }
    if (data && data.respawn_at) {
      try {
        var at = new Date(data.respawn_at).getTime();
        var left = at - Date.now();
        if (isFinite(at) && left > 0) return left;
      } catch (_e) {
        /* ignore */
      }
    }
    var sec = ITEM_RESPAWN_SEC[item];
    if (item === "item_health_mega") {
      sec = megaRespawnSecForMap(this.mapName);
    }
    if (sec == null) return 0;
    return sec * 1000;
  };

  MapSpawns.prototype.onPickupEvent = function (data) {
    var transform =
      this.transform || (this.lastPayload && this.lastPayload.transform);
    if (!this.settings.enabled || !this.entityData || !transform) return;
    if (!this.transform) this.transform = transform;
    var item = data && data.item;
    if (!item || !ITEM_RESPAWN_SEC[item]) return;
    if (!entityVisibleForCategory(item, this.settings.itemCategories)) return;
    if (!this.layerEnabled("items")) return;
    var ent = this.findNearestItemEntity(item, data.x, data.y);
    if (!ent) return;
    var respawnMs = this.respawnDurationMs(item, data);
    if (!respawnMs) return;
    var key = this._itemRespawnKey(ent.id);
    var existing = this._itemRespawns[key];
    if (existing && existing.el && existing.el.parentNode) {
      existing.el.parentNode.removeChild(existing.el);
    }
    this._itemRespawns[key] = {
      entityId: ent.id,
      classname: item,
      x: Number(ent.x),
      y: Number(ent.y),
      expiresAt: Date.now() + respawnMs,
      respawnMs: respawnMs,
      el: null,
      elRing: null,
      elCount: null,
    };
    this.render();
    this.renderRespawnOverlays();
    this._ensureRespawnLoop();
  };

  MapSpawns.prototype.renderRespawnOverlays = function () {
    var layer = this.respawnLayer;
    if (!layer || !this.transform) return false;
    var now = Date.now();
    var active = false;
    for (var key in this._itemRespawns) {
      if (!Object.prototype.hasOwnProperty.call(this._itemRespawns, key)) continue;
      var row = this._itemRespawns[key];
      if (row.expiresAt <= now) {
        if (row.el && row.el.parentNode) row.el.parentNode.removeChild(row.el);
        delete this._itemRespawns[key];
        continue;
      }
      active = true;
      var remaining = row.expiresAt - now;
      var progress = 1 - remaining / Math.max(1, row.respawnMs);
      if (!row.el) {
        row.el = document.createElement("div");
        row.el.className = "map-item-respawn";
        var ring = document.createElement("div");
        ring.className = "map-item-respawn-ring";
        var count = document.createElement("span");
        count.className = "map-item-respawn-count";
        row.el.appendChild(ring);
        row.el.appendChild(count);
        row.elRing = ring;
        row.elCount = count;
        layer.appendChild(row.el);
      }
      var pos = this.worldToDisplay(row.x, row.y);
      if (!pos) continue;
      row.el.style.left = pos.x + "px";
      row.el.style.top = pos.y + "px";
      var pct = Math.max(0, Math.min(100, progress * 100));
      row.elRing.style.background =
        "conic-gradient(#4ade80 " +
        pct +
        "%, rgba(20, 24, 32, 0.82) " +
        pct +
        "%)";
      row.elCount.textContent = formatRespawnCountdown(remaining, row.respawnMs);
    }
    if (!active && !Object.keys(this._itemRespawns).length) {
      layer.innerHTML = "";
    }
    return active;
  };

  MapSpawns.prototype._ensureRespawnLoop = function () {
    var self = this;
    if (this._respawnLoopId) return;

    function frame() {
      var stillActive = self.renderRespawnOverlays();
      if (stillActive) {
        self._respawnLoopId = requestAnimationFrame(frame);
      } else {
        self._respawnLoopId = 0;
        self.render();
      }
    }

    this._respawnLoopId = requestAnimationFrame(frame);
  };

  MapSpawns.prototype._stopAnchorMotionLoop = function () {
    if (this._anchorMotion.loopId) {
      cancelAnimationFrame(this._anchorMotion.loopId);
      this._anchorMotion.loopId = 0;
    }
  };

  MapSpawns.prototype._ensureAnchorMotionLoop = function () {
    var self = this;
    if (this._anchorMotion.loopId) return;

    function frame() {
      var motion = self._anchorMotion;
      var alpha = self._smoothAlpha();
      var active = false;

      if (motion.ref && motion.ref.el) {
        active = true;
        motion.ref.display.x = self._lerpNum(
          motion.ref.display.x,
          motion.ref.target.x,
          alpha,
        );
        motion.ref.display.y = self._lerpNum(
          motion.ref.display.y,
          motion.ref.target.y,
          alpha,
        );
        motion.ref.el.style.left = motion.ref.display.x + "px";
        motion.ref.el.style.top = motion.ref.display.y + "px";
      }

      if (motion.threshold && motion.threshold.el) {
        active = true;
        var th = motion.threshold;
        th.display.x = self._lerpNum(th.display.x, th.target.x, alpha);
        th.display.y = self._lerpNum(th.display.y, th.target.y, alpha);
        th.display.size = self._lerpNum(th.display.size, th.target.size, alpha);
        var half = th.display.size / 2;
        th.el.style.left = th.display.x - half + "px";
        th.el.style.top = th.display.y - half + "px";
        th.el.style.width = th.display.size + "px";
        th.el.style.height = th.display.size + "px";
      }

      if (active) {
        motion.loopId = requestAnimationFrame(frame);
      } else {
        motion.loopId = 0;
      }
    }

    this._anchorMotion.loopId = requestAnimationFrame(frame);
  };

  MapSpawns.prototype._setAnchorRefTarget = function (pos, instant) {
    if (!this.refEl || !pos) {
      if (this.refEl) this.refEl.style.display = "none";
      this._anchorMotion.ref = null;
      return;
    }
    this.refEl.style.display = "";
    var motion = this._anchorMotion;
    if (!motion.ref || motion.ref.el !== this.refEl) {
      motion.ref = {
        el: this.refEl,
        display: { x: pos.x, y: pos.y },
        target: { x: pos.x, y: pos.y },
      };
    }
    motion.ref.target.x = pos.x;
    motion.ref.target.y = pos.y;
    if (instant) {
      motion.ref.display.x = pos.x;
      motion.ref.display.y = pos.y;
      this.refEl.style.left = pos.x + "px";
      this.refEl.style.top = pos.y + "px";
    }
    this._ensureAnchorMotionLoop();
  };

  MapSpawns.prototype._setThresholdTarget = function (pos, size, instant) {
    var motion = this._anchorMotion;
    if (!this.thresholdEl) return;
    if (!pos || size == null || !this.settings.showThreshold) {
      if (motion.threshold && motion.threshold.el) {
        motion.threshold.el.style.display = "none";
      }
      motion.threshold = null;
      return;
    }
    if (!motion.threshold || !motion.threshold.el) {
      var box = document.createElement("div");
      box.className = "map-spawn-threshold";
      this.thresholdEl.innerHTML = "";
      this.thresholdEl.appendChild(box);
      motion.threshold = {
        el: box,
        display: { x: pos.x, y: pos.y, size: size },
        target: { x: pos.x, y: pos.y, size: size },
      };
    }
    motion.threshold.el.style.display = "";
    motion.threshold.target.x = pos.x;
    motion.threshold.target.y = pos.y;
    motion.threshold.target.size = size;
    if (instant) {
      motion.threshold.display.x = pos.x;
      motion.threshold.display.y = pos.y;
      motion.threshold.display.size = size;
      var half = size / 2;
      motion.threshold.el.style.left = pos.x - half + "px";
      motion.threshold.el.style.top = pos.y - half + "px";
      motion.threshold.el.style.width = size + "px";
      motion.threshold.el.style.height = size + "px";
    }
    this._ensureAnchorMotionLoop();
  };

  MapSpawns.prototype._clearAnchorMotion = function () {
    this._stopAnchorMotionLoop();
    this._anchorMotion.ref = null;
    this._anchorMotion.threshold = null;
    if (this.thresholdEl) this.thresholdEl.innerHTML = "";
    if (this.refEl) this.refEl.style.display = "none";
  };

  MapSpawns.prototype.setItemCategoryEnabled = function (category, enabled) {
    if (!this.settings.itemCategories) {
      this.settings.itemCategories = Object.assign({}, DEFAULT_ITEM_CATEGORIES);
    }
    this.settings.itemCategories[category] = !!enabled;
    saveSettings(this.settings);
    this.render();
    this.syncItemCategoryControls();
  };

  MapSpawns.prototype.setItemClassnameEnabled = function (classname, enabled) {
    if (!this.settings.itemCategories) {
      this.settings.itemCategories = Object.assign({}, DEFAULT_ITEM_CATEGORIES);
    }
    this.settings.itemCategories[classname] = !!enabled;
    saveSettings(this.settings);
    this.render();
    this.syncItemCategoryControls();
  };

  MapSpawns.prototype.syncItemCategoryControls = function () {
    var host = document.getElementById("spawn-item-category-toggles");
    if (!host) return;
    var cats = this.settings.itemCategories || DEFAULT_ITEM_CATEGORIES;
    var categoryInputs = host.querySelectorAll("input[data-item-category]");
    for (var i = 0; i < categoryInputs.length; i++) {
      var input = categoryInputs[i];
      var cat = input.getAttribute("data-item-category");
      input.checked = cats[cat] !== false;
    }
    var classnameInputs = host.querySelectorAll("input[data-item-classname]");
    for (var j = 0; j < classnameInputs.length; j++) {
      var cInput = classnameInputs[j];
      var cn = cInput.getAttribute("data-item-classname");
      var parent = cInput.getAttribute("data-item-parent-category");
      var parentOff = parent && cats[parent] === false;
      cInput.checked = !parentOff && cats[cn] !== false;
      cInput.disabled = !!parentOff;
      var wrap = cInput.closest("label");
      if (wrap) wrap.classList.toggle("is-disabled", !!parentOff);
    }
  };

  MapSpawns.prototype.entitiesUrl = function (mapName) {
    if (!window.MapCoords) return "";
    return MapCoords.assetUrl("maps/entities/" + mapName + ".json");
  };

  MapSpawns.prototype.displayUrl = function () {
    if (!window.MapCoords) return "";
    return MapCoords.assetUrl("maps/entity-display.json");
  };

  MapSpawns.prototype.spriteMapUrl = function () {
    if (!window.MapCoords) return "";
    return MapCoords.assetUrl("maps/sprite-map.json");
  };

  MapSpawns.prototype.ensureSpriteMap = function () {
    var self = this;
    if (this.spriteMap) return Promise.resolve(this.spriteMap);
    return fetch(this.spriteMapUrl(), { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        self.spriteMap = data;
        return data;
      })
      .catch(function () {
        self.spriteMap = { version: 1, classnames: {} };
        return self.spriteMap;
      });
  };

  MapSpawns.prototype.ensureDisplayConfig = function () {
    var self = this;
    if (this.displayConfig) return Promise.resolve(this.displayConfig);
    return fetch(this.displayUrl(), { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        self.displayConfig = data;
        return data;
      })
      .catch(function () {
        self.displayConfig = { version: 1, maps: {}, classname_styles: {} };
        return self.displayConfig;
      });
  };

  MapSpawns.prototype.layerEnabled = function (layerId) {
    var mapLayers = this.settings.layers[this.mapName];
    if (mapLayers && Object.prototype.hasOwnProperty.call(mapLayers, layerId)) {
      return !!mapLayers[layerId];
    }
    if (!this.mapDisplay || !this.mapDisplay.layers) return false;
    for (var i = 0; i < this.mapDisplay.layers.length; i++) {
      var layer = this.mapDisplay.layers[i];
      if (layer.id === layerId) return !!layer.default;
    }
    return false;
  };

  MapSpawns.prototype.setLayerEnabled = function (layerId, enabled) {
    if (!this.mapName) return;
    if (!this.settings.layers[this.mapName]) {
      this.settings.layers[this.mapName] = {};
    }
    this.settings.layers[this.mapName][layerId] = !!enabled;
    saveSettings(this.settings);
    this.render();
    this.syncLayerControls();
  };

  MapSpawns.prototype.effectiveMiddleVal = function (layer, entityCount) {
    if (this.settings.middleVal != null && this.settings.middleVal !== "") {
      var raw = String(this.settings.middleVal).trim().toLowerCase();
      if (raw === "auto" || raw === "") {
        /* fall through */
      } else {
        var n = Number(this.settings.middleVal);
        if (isFinite(n) && n >= 0) return Math.floor(n);
      }
    }
    if (layer && layer.middle_val != null) {
      var layerN = Number(layer.middle_val);
      if (isFinite(layerN) && layerN >= 0) return Math.floor(layerN);
    }
    if (entityCount != null && entityCount > 0) return autoMiddleVal(entityCount);
    return null;
  };

  MapSpawns.prototype.playersWithCoords = function () {
    var out = [];
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (p.x != null && p.y != null) out.push({ player: p, index: i });
    }
    return out;
  };

  MapSpawns.prototype.resolveReferencePlayerId = function () {
    var live = this.playersWithCoords();
    if (!live.length) return null;
    var wanted = this.settings.referencePlayerId;
    if (wanted) {
      for (var i = 0; i < live.length; i++) {
        if (playerMotionId(live[i].player, live[i].index) === wanted) {
          return wanted;
        }
      }
    }
    return playerMotionId(live[0].player, live[0].index);
  };

  MapSpawns.prototype.referencePlayer = function () {
    var live = this.playersWithCoords();
    if (!live.length) return null;
    var wanted = this.resolveReferencePlayerId();
    for (var i = 0; i < live.length; i++) {
      var id = playerMotionId(live[i].player, live[i].index);
      if (id === wanted) return live[i].player;
    }
    return live[0].player;
  };

  MapSpawns.prototype.referenceWorld = function () {
    if (this.settings.anchor === "cursor") {
      return this.cursorWorld || null;
    }
    if (this.settings.anchor === "player") {
      var p = this.referencePlayer();
      if (p) return { x: Number(p.x), y: Number(p.y) };
    }
    return null;
  };

  MapSpawns.prototype.worldToDisplay = function (x, y) {
    if (!this.transform || !window.MapCoords) return null;
    var wrap = document.getElementById("map-wrap");
    if (!wrap) return null;
    var pixel = MapCoords.worldToPixel(this.transform, x, y);
    var rect = MapCoords.imageDisplayRect(
      wrap,
      this.transform.image_width,
      this.transform.image_height,
    );
    return MapCoords.pixelToDisplay(rect, pixel);
  };

  MapSpawns.prototype.displayToWorld = function (clientX, clientY) {
    if (!this.transform || !window.MapCoords) return null;
    var wrap = document.getElementById("map-wrap");
    if (!wrap) return null;
    var rect = wrap.getBoundingClientRect();
    var localX = clientX - rect.left;
    var localY = clientY - rect.top;
    var imageRect = MapCoords.imageDisplayRect(
      wrap,
      this.transform.image_width,
      this.transform.image_height,
    );
    var pixel = MapCoords.displayToPixel(imageRect, localX, localY);
    return MapCoords.pixelToWorld(this.transform, pixel.x, pixel.y);
  };

  MapSpawns.prototype.clearLayer = function () {
    if (this.layer) this.layer.innerHTML = "";
    this._clearAnchorMotion();
  };

  MapSpawns.prototype.entitiesForLayer = function (layer) {
    var entities = (this.entityData && this.entityData.entities) || [];
    var out = [];
    var filterGametype = !!(layer && layer.gametype_filter);
    for (var i = 0; i < entities.length; i++) {
      var ent = entities[i];
      if (isHiddenEntity(ent)) continue;
      if (layer && layer.id === "items" && !entityPassesItemCategory(ent, this.settings)) {
        continue;
      }
      if (!entityVisibleForGametypeFilter(ent, this.gametype, filterGametype)) continue;
      if (entityMatchesFilter(ent, layer.filter)) out.push(ent);
    }
    return out;
  };

  MapSpawns.prototype.gametypeFilterStats = function () {
    var entities = (this.entityData && this.entityData.entities) || [];
    var gt = normalizeGametype(this.gametype);
    var stats = {
      total: entities.length,
      duelTagged: 0,
      notDuelTagged: 0,
      universal: 0,
      shown: 0,
      hidden: 0,
    };
    for (var i = 0; i < entities.length; i++) {
      var ent = entities[i];
      if (isHiddenEntity(ent)) continue;
      var attrs = ent.attrs || {};
      if (attrs.gametype && normalizeGametype(attrs.gametype) === "duel") {
        stats.duelTagged++;
      } else if (attrs.not_gametype && normalizeGametype(attrs.not_gametype) === "duel") {
        stats.notDuelTagged++;
      } else if (!attrs.gametype && !attrs.not_gametype) {
        stats.universal++;
      }
      if (entityVisibleForGametypeFilter(ent, this.gametype, true)) {
        stats.shown++;
      } else {
        stats.hidden++;
      }
    }
    return stats;
  };

  MapSpawns.prototype.debugState = function () {
    var duel = this.duelLayerConfig();
    var duelEntities = duel ? this.entitiesForLayer(duel) : [];
    var ref = this.referenceWorld();
    var graph = this.teleportGraph();
    var layerRows = [];
    if (this.mapDisplay && this.mapDisplay.layers) {
      for (var i = 0; i < this.mapDisplay.layers.length; i++) {
        var layer = this.mapDisplay.layers[i];
        var ents = this.entitiesForLayer(layer);
        layerRows.push({
          id: layer.id,
          enabled: this.layerEnabled(layer.id),
          mode: layer.mode,
          gametype_filter: !!layer.gametype_filter,
          count: ents.length,
        });
      }
    }
    var motionKeys =
      window.OverlayApp && typeof OverlayApp.getMapMotionKeys === "function"
        ? OverlayApp.getMapMotionKeys()
        : [];
    var overlayDebug =
      window.OverlayApp && typeof OverlayApp.getMapDebugState === "function"
        ? OverlayApp.getMapDebugState()
        : null;
    var players = this.players || [];
    var playerRows = [];
    for (var p = 0; p < players.length; p++) {
      var row = players[p];
      var pid = playerMotionId(row, p);
      playerRows.push({
        id: pid,
        nick: stripQuakeColors(row.nickname || "") || row.steam_id64 || "?",
        x: row.x,
        y: row.y,
        inMapMotion: motionKeys.indexOf(pid) >= 0,
        alive: row.alive,
      });
    }
    var orphanKeys = motionKeys.filter(function (key) {
      for (var j = 0; j < playerRows.length; j++) {
        if (playerRows[j].id === key) return false;
      }
      return true;
    });
    var teleportPairs = graph.entrances.map(function (pair) {
      return {
        entrance_id: pair.entrance.id,
        exit_id: pair.exit.id,
        exit_classname: pair.exit.classname,
      };
    });
    return {
      map_name: this.mapName,
      gametype_raw: this.gametype,
      gametype_normalized: normalizeGametype(this.gametype),
      gametype_override: this.settings.gametypeOverride || qs("gametype") || null,
      last_match_id: this.lastMatchId,
      anchor: this.settings.anchor,
      reference_world: ref,
      middle_val_effective: duel
        ? this.effectiveMiddleVal(duel, duelEntities.length)
        : null,
      layers: layerRows,
      gametype_filter: this.gametypeFilterStats(),
      players: playerRows,
      map_motion_keys: motionKeys,
      orphan_motion_keys: orphanKeys,
      teleport_pairs: teleportPairs,
      teleport_exit_count: graph.exits.length,
      overlay: overlayDebug,
      entity_overlay_enabled: !!this.settings.enabled,
      last_payload_event: this.lastPayload && this.lastPayload.event,
    };
  };

  MapSpawns.prototype.teleportGraph = function () {
    return buildTeleportGraph((this.entityData && this.entityData.entities) || []);
  };

  MapSpawns.prototype.renderTeleportLayer = function (layer) {
    var layerEl = this.layer;
    if (!layerEl) return;
    var graph = this.teleportGraph();
    var mode = layer.id === "teleport_entrances" ? "entrance" : "exit";

    if (mode === "exit") {
      var seenExit = {};
      for (var i = 0; i < graph.exits.length; i++) {
        var exit = graph.exits[i];
        if (seenExit[exit.id]) continue;
        seenExit[exit.id] = true;
        this.renderTeleportMarker(layerEl, exit, "exit", layer);
      }
      return;
    }

    var seenEnt = {};
    for (var j = 0; j < graph.entrances.length; j++) {
      var pair = graph.entrances[j];
      var ent = pair.entrance;
      if (seenEnt[ent.id]) continue;
      seenEnt[ent.id] = true;
      this.renderTeleportMarker(layerEl, ent, "entrance", layer);
    }
  };

  MapSpawns.prototype.renderTeleportMarker = function (parent, ent, kind, layer) {
    var pos = this.worldToDisplay(ent.x, ent.y);
    if (!pos) return;
    var dot = document.createElement("div");
    dot.className =
      "map-teleport map-teleport-" +
      kind +
      " layer-" +
      (layer && layer.id ? layer.id : kind);
    dot.style.left = pos.x + "px";
    dot.style.top = pos.y + "px";
    dot.title =
      (kind === "exit" ? "Teleport exit" : "Teleport entrance") +
      " #" +
      ent.id +
      " (" +
      Math.round(ent.x) +
      ", " +
      Math.round(ent.y) +
      ")";
    if (kind === "exit") {
      var mark = document.createElement("span");
      mark.className = "map-teleport-x";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = "×";
      dot.appendChild(mark);
    }
    parent.appendChild(dot);
  };

  MapSpawns.prototype.renderMarker = function (
    parent,
    ent,
    className,
    title,
    size,
  ) {
    var pos = this.worldToDisplay(ent.x, ent.y);
    if (!pos) return;
    var dot = document.createElement("div");
    dot.className = className;
    dot.style.width = size + "px";
    dot.style.height = size + "px";
    dot.style.left = pos.x + "px";
    dot.style.top = pos.y + "px";
    dot.title = title;
    parent.appendChild(dot);
  };

  MapSpawns.prototype.renderStaticLayer = function (layer, entities, styles) {
    var layerEl = this.layer;
    if (!layerEl) return;
    var spriteMap = this.spriteMap;
    for (var i = 0; i < entities.length; i++) {
      var ent = entities[i];
      var style = resolveStyle(ent.classname, styles);
      var size = 16;
      var label = shortLabel(ent.classname);
      var spriteRel = resolveSprite(ent.classname, spriteMap);
      var className =
        "map-entity map-entity-" +
        (style.shape || "circle") +
        " map-entity-static";
      className += " layer-" + layer.id;
      if (spriteRel) className += " map-entity-has-sprite";
      if (this._itemOnRespawnCooldown(ent.id)) {
        className += " map-entity-respawn-cooldown";
      }
      var dot = document.createElement("div");
      dot.className = className;
      dot.style.width = size + "px";
      dot.style.height = size + "px";
      if (!spriteRel) dot.style.background = style.color || "#cbd5e1";
      var pos = this.worldToDisplay(ent.x, ent.y);
      if (!pos) continue;
      dot.style.left = pos.x + "px";
      dot.style.top = pos.y + "px";
      dot.title =
        "#" +
        ent.id +
        " " +
        ent.classname +
        " (" +
        Math.round(ent.x) +
        ", " +
        Math.round(ent.y) +
        ", z " +
        Math.round(ent.z) +
        ")";
      if (spriteRel && window.MapCoords) {
        var img = document.createElement("img");
        img.className = "map-entity-sprite";
        img.src = MapCoords.assetUrl(spriteRel);
        img.alt = ent.classname;
        dot.appendChild(img);
      } else {
        var tag = document.createElement("span");
        tag.className = "map-entity-label";
        tag.textContent = label;
        dot.appendChild(tag);
      }
      layerEl.appendChild(dot);
    }
  };

  MapSpawns.prototype.renderDuelLayer = function (layer, entities) {
    // Duel spawn pool: same info_player_deathmatch points as all_dm_spawns, but
    // classifySpawns marks green (active pool) vs red (rejected) from anchor.
    var ref = this.referenceWorld();
    if (!ref) return;

    var spawns = entities.map(function (ent) {
      return { x: ent.x, y: ent.y, z: ent.z, id: ent.id };
    });
    var middleVal = this.effectiveMiddleVal(layer, spawns.length);
    var status = classifySpawns(ref.x, ref.y, spawns, middleVal);
    var layerEl = this.layer;
    var thresholdEl = this.thresholdEl;
    if (!layerEl || !thresholdEl) return;

    var refPos = this.worldToDisplay(ref.x, ref.y);
    var instant = this._smoothAlpha() >= 0.999;
    this._setAnchorRefTarget(refPos, instant);

    if (refPos && status.rejectMax != null) {
      var half = this.worldToDisplay(ref.x + status.rejectMax, ref.y);
      if (half) {
        var size = Math.max(4, (half.x - refPos.x) * 2);
        this._setThresholdTarget(refPos, size, instant);
      } else {
        this._setThresholdTarget(null, null, instant);
      }
    } else {
      this._setThresholdTarget(null, null, instant);
    }

    for (var i = 0; i < spawns.length; i++) {
      var s = spawns[i];
      var active = !!status.possible[i];
      if (!active && !this.settings.showInactive) continue;
      var ent = entities[i];
      var zWeight =
        s.z != null ? Math.max(0, Math.min(1, (Number(s.z) - 24) / 512)) : 0;
      var size = 10 + zWeight * 6;
      this.renderMarker(
        layerEl,
        ent,
        "map-spawn" + (active ? " is-active" : " is-inactive"),
        "#" +
          ent.id +
          " spawn (" +
          Math.round(s.x) +
          ", " +
          Math.round(s.y) +
          ")",
        size,
      );
    }
  };

  MapSpawns.prototype.render = function () {
    if (!this.settings.enabled || !this.entityData || !this.transform) {
      this.clearLayer();
      return;
    }

    var layerEl = this.layer;
    var thresholdEl = this.thresholdEl;
    if (!layerEl || !thresholdEl) return;

    layerEl.innerHTML = "";

    if (!this.mapDisplay || !this.mapDisplay.layers || !this.mapDisplay.layers.length) {
      this._clearAnchorMotion();
      return;
    }

    var styles =
      (this.displayConfig && this.displayConfig.classname_styles) || {};
    var anyDuel = false;

    for (var i = 0; i < this.mapDisplay.layers.length; i++) {
      var layer = this.mapDisplay.layers[i];
      if (!this.layerEnabled(layer.id)) continue;
      if (layer.mode === "teleport") {
        this.renderTeleportLayer(layer);
        continue;
      }
      var entities = this.entitiesForLayer(layer);
      if (!entities.length) continue;
      if (layer.mode === "duel") {
        anyDuel = true;
        this.renderDuelLayer(layer, entities);
      } else {
        // all_dm_spawns and items: static markers (no green/red duel logic).
        this.renderStaticLayer(layer, entities, styles);
      }
    }

    if (!anyDuel) {
      this._clearAnchorMotion();
    } else if (this.refEl) {
      this.refEl.style.display = "";
    }
  };

  MapSpawns.prototype.loadEntities = function (mapName) {
    var self = this;
    var key = (mapName || "").trim().toLowerCase();
    if (!key) {
      this.entityData = null;
      this.mapDisplay = null;
      this.render();
      return Promise.resolve(null);
    }

    return this.ensureDisplayConfig().then(function (cfg) {
      self.mapDisplay = (cfg.maps && cfg.maps[key]) || null;

      if (self.mapName === key && self.entityData) {
        self.updatePanelMeta();
        self.render();
        return self.entityData;
      }

      return fetch(self.entitiesUrl(key), { cache: "no-store" })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .then(function (data) {
          self.mapName = key;
          self.entityData = data;
          self.updatePanelMeta();
          self.rebuildLayerControls();
          self.render();
          return data;
        })
        .catch(function () {
          self.mapName = key;
          self.entityData = null;
          self.updatePanelMeta();
          self.rebuildLayerControls();
          self.render();
          return null;
        });
    });
  };

  MapSpawns.prototype.onMapPayload = function (payload) {
    this.lastPayload = payload;
    if (payload.match_id && payload.match_id !== this.lastMatchId) {
      this.lastMatchId = payload.match_id;
      this.lastGametype = null;
      this._clearItemRespawns();
    }
    this.transform = payload.transform || null;
    this.players = Array.isArray(payload.players) ? payload.players : [];
    var resolvedGt = resolvePayloadGametype(payload, this.settings.gametypeOverride);
    if (resolvedGt != null && resolvedGt !== "") {
      this.lastGametype = resolvedGt;
    }
    this.gametype = this.lastGametype || null;
    var mapName = (payload.map_name || "").trim().toLowerCase();
    var resolvedId = this.resolveReferencePlayerId();
    if (resolvedId && resolvedId !== this.settings.referencePlayerId) {
      this.settings.referencePlayerId = resolvedId;
      saveSettings(this.settings);
    }
    this.syncPlayerPicker();
    this.syncCursorCapture();
    if (mapName && mapName !== this.mapName) {
      this._clearItemRespawns();
      this.loadEntities(mapName);
    } else {
      this.render();
    }
  };

  MapSpawns.prototype.onPointerMove = function (ev) {
    if (!this.settings.enabled || this.settings.anchor !== "cursor") return;
    var world = this.displayToWorld(ev.clientX, ev.clientY);
    if (!world) return;
    this.cursorWorld = world;
    this.render();
  };

  MapSpawns.prototype.onPointerLeave = function () {
    if (this.settings.anchor !== "cursor") return;
    this.cursorWorld = null;
    this.render();
  };

  MapSpawns.prototype.setEnabled = function (enabled) {
    this.settings.enabled = !!enabled;
    saveSettings(this.settings);
    this.syncChrome();
    this.syncCursorCapture();
    this.render();
  };

  MapSpawns.prototype.togglePanel = function (open) {
    this.settings.panelOpen = open != null ? !!open : !this.settings.panelOpen;
    this.syncChrome();
  };

  MapSpawns.prototype.duelLayerConfig = function () {
    if (!this.mapDisplay || !this.mapDisplay.layers) return null;
    for (var i = 0; i < this.mapDisplay.layers.length; i++) {
      if (this.mapDisplay.layers[i].mode === "duel") {
        return this.mapDisplay.layers[i];
      }
    }
    return null;
  };

  MapSpawns.prototype.updatePanelMeta = function () {
    var meta = document.getElementById("spawn-meta");
    if (!meta) return;
    if (!this.mapName) {
      meta.textContent = "No map loaded";
      return;
    }
    if (!this.entityData) {
      meta.textContent =
        this.mapName +
        " — no entity dump (run batch_extract_map_entities.py on pak00/packs)";
      return;
    }
    var layerCount = (this.mapDisplay && this.mapDisplay.layers) || [];
    var duel = this.duelLayerConfig();
    var bits = [
      this.mapName,
      (this.entityData.entities || []).length + " entities",
      layerCount.length + " configured layers",
    ];
    if (duel) {
      var duelEntities = this.entitiesForLayer(duel);
      bits.push(
        "duel middle_val " +
          this.effectiveMiddleVal(duel, duelEntities.length),
      );
    }
    meta.textContent = bits.join(" · ");
  };

  MapSpawns.prototype.syncLayerControls = function () {
    var host = document.getElementById("spawn-layer-toggles");
    if (!host || !this.mapDisplay || !this.mapDisplay.layers) return;
    var inputs = host.querySelectorAll('input[type="checkbox"][data-layer-id]');
    inputs.forEach(
      function (el) {
        var id = el.getAttribute("data-layer-id");
        el.checked = this.layerEnabled(id);
      }.bind(this),
    );
  };

  MapSpawns.prototype.syncPlayerPicker = function () {
    var select = document.getElementById("spawn-reference-player");
    var field = document.getElementById("spawn-reference-player-field");
    if (!select) return;

    var live = this.playersWithCoords();
    var prev = select.value;
    select.innerHTML = "";

    if (!live.length) {
      var empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "No players on map";
      select.appendChild(empty);
      select.disabled = true;
      if (field) field.classList.add("is-disabled");
      return;
    }

    select.disabled = false;
    if (field) field.classList.remove("is-disabled");

    var resolved = this.resolveReferencePlayerId();
    for (var i = 0; i < live.length; i++) {
      var p = live[i].player;
      var idx = live[i].index;
      var id = playerMotionId(p, idx);
      var opt = document.createElement("option");
      opt.value = id;
      opt.textContent = playerDisplayName(p, idx);
      select.appendChild(opt);
    }
    select.value = resolved || "";
    if (select.value !== prev && resolved) {
      this.settings.referencePlayerId = resolved;
      saveSettings(this.settings);
    }
  };

  MapSpawns.prototype.syncAnchorControls = function () {
    var playerField = document.getElementById("spawn-reference-player-field");
    if (playerField) {
      playerField.classList.toggle("hidden", this.settings.anchor !== "player");
    }
    this.syncCursorCapture();
  };

  MapSpawns.prototype.syncCursorCapture = function () {
    var el = this.cursorCaptureEl;
    if (!el) return;
    var active =
      !!this.settings.enabled &&
      this.settings.anchor === "cursor" &&
      !!this.transform;
    el.classList.toggle("hidden", !active);
  };

  MapSpawns.prototype.rebuildLayerControls = function () {
    var host = document.getElementById("spawn-layer-toggles");
    if (!host) return;
    host.innerHTML = "";
    if (!this.mapDisplay || !this.mapDisplay.layers || !this.mapDisplay.layers.length) {
      host.textContent = "No display config for this map — edit maps/entity-display.json";
      return;
    }

    var self = this;
    for (var i = 0; i < this.mapDisplay.layers.length; i++) {
      var layer = this.mapDisplay.layers[i];
      var label = document.createElement("label");
      label.className = "dbg-toggle";
      var input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("data-layer-id", layer.id);
      input.checked = this.layerEnabled(layer.id);
      input.addEventListener("change", function () {
        var layerId = this.getAttribute("data-layer-id");
        self.setLayerEnabled(layerId, this.checked);
      });
      label.appendChild(input);
      label.appendChild(document.createTextNode(" " + (layer.label || layer.id)));
      host.appendChild(label);
    }
  };

  MapSpawns.prototype._appendItemCategoryToggle = function (host, categoryKey, labelText) {
    var label = document.createElement("label");
    label.className = "dbg-toggle spawn-item-category-parent";
    var input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("data-item-category", categoryKey);
    input.checked = this.settings.itemCategories[categoryKey] !== false;
    var self = this;
    input.addEventListener("change", function () {
      self.setItemCategoryEnabled(categoryKey, this.checked);
    });
    label.appendChild(input);
    label.appendChild(document.createTextNode(" " + labelText));
    host.appendChild(label);
  };

  MapSpawns.prototype._appendItemClassnameGroup = function (
    host,
    categoryKey,
    categoryLabel,
    classnames,
  ) {
    var group = document.createElement("div");
    group.className = "spawn-item-category-group";

    var head = document.createElement("div");
    head.className = "spawn-item-category-group-head";
    this._appendItemCategoryToggle(head, categoryKey, categoryLabel);
    group.appendChild(head);

    if (classnames && classnames.length) {
      var details = document.createElement("details");
      details.className = "spawn-item-category-details";
      details.open = true;
      var summary = document.createElement("summary");
      summary.textContent = "Individual types";
      details.appendChild(summary);

      var children = document.createElement("div");
      children.className = "spawn-item-category-children";
      var self = this;
      for (var i = 0; i < classnames.length; i++) {
        var cn = classnames[i];
        var childLabel = document.createElement("label");
        childLabel.className = "dbg-toggle spawn-item-category-child";
        var childInput = document.createElement("input");
        childInput.type = "checkbox";
        childInput.setAttribute("data-item-classname", cn);
        childInput.setAttribute("data-item-parent-category", categoryKey);
        childInput.checked = self.settings.itemCategories[cn] !== false;
        childInput.addEventListener("change", function () {
          var classname = this.getAttribute("data-item-classname");
          self.setItemClassnameEnabled(classname, this.checked);
        });
        childLabel.appendChild(childInput);
        childLabel.appendChild(
          document.createTextNode(" " + itemClassnameLabel(cn)),
        );
        children.appendChild(childLabel);
      }
      details.appendChild(children);
      group.appendChild(details);
    }

    host.appendChild(group);
  };

  MapSpawns.prototype.rebuildItemCategoryControls = function () {
    var host = document.getElementById("spawn-item-category-toggles");
    if (!host) return;
    host.innerHTML = "";

    this._appendItemCategoryToggle(host, "weapons", "Weapons");
    this._appendItemCategoryToggle(host, "ammo", "Ammo (excl. ammo_pack)");
    this._appendItemClassnameGroup(host, "health", "Health", HEALTH_CLASSNAMES);
    this._appendItemClassnameGroup(host, "armor", "Armor", ARMOR_CLASSNAMES);
    this._appendItemClassnameGroup(
      host,
      "powerups",
      "Powerups",
      POWERUP_CLASSNAME_LIST,
    );
    this.syncItemCategoryControls();
  };

  MapSpawns.prototype.buildPanel = function () {
    var panel = this.panel;
    if (!panel) return;
    panel.innerHTML =
      '<header class="map-spawns-head">' +
      "<h2>Settings</h2>" +
      '<p class="map-spawns-hint">Map entities · duel spawn pool · per-category item filters · threshold follows anchor with smooth motion</p>' +
      "</header>" +
      '<section class="map-spawns-section">' +
      '<label class="dbg-toggle"><input type="checkbox" id="spawn-enabled" /> Show overlay</label>' +
      '<div id="spawn-layer-toggles"></div>' +
      "</section>" +
      '<section class="map-spawns-section">' +
      "<h3>Item categories</h3>" +
      '<p class="map-spawns-hint">When the items layer is on — toggle categories; expand Health, Armor, or Powerups for per-type filters. Shards off by default (25 s respawn per pak00; ring hidden).</p>' +
      '<div id="spawn-item-category-toggles"></div>' +
      "</section>" +
      '<section class="map-spawns-section">' +
      "<h3>Duel layer</h3>" +
      '<label class="dbg-toggle"><input type="radio" name="spawn-anchor" value="player" /> Anchor: player</label>' +
      '<label class="dbg-field" id="spawn-reference-player-field">' +
      "Reference player " +
      '<select id="spawn-reference-player"></select>' +
      "</label>" +
      '<label class="dbg-toggle"><input type="radio" name="spawn-anchor" value="cursor" /> Anchor: mouse</label>' +
      '<label class="dbg-toggle"><input type="checkbox" id="spawn-show-inactive" /> Show rejected spawns</label>' +
      '<label class="dbg-toggle"><input type="checkbox" id="spawn-show-threshold" /> Show threshold square</label>' +
      '<label class="dbg-field">middle_val override <input type="number" id="spawn-middle-val" min="0" step="1" placeholder="auto" /></label>' +
      '<div id="spawn-meta" class="dbg-meta"></div>' +
      "</section>" +
      '<section class="map-spawns-section map-spawns-credit">' +
      "<p>Extract: <code>batch_extract_map_entities.py</code> + <code>extract_item_sprites.py</code> (pak00). Config: <code>build_entity_display.py</code>.</p>" +
      "</section>";

    var self = this;
    var enabled = document.getElementById("spawn-enabled");
    var inactive = document.getElementById("spawn-show-inactive");
    var threshold = document.getElementById("spawn-show-threshold");
    var middle = document.getElementById("spawn-middle-val");
    var playerSelect = document.getElementById("spawn-reference-player");
    var anchors = panel.querySelectorAll('input[name="spawn-anchor"]');

    if (enabled) {
      enabled.checked = this.settings.enabled;
      enabled.addEventListener("change", function () {
        self.setEnabled(enabled.checked);
      });
    }
    if (inactive) {
      inactive.checked = this.settings.showInactive;
      inactive.addEventListener("change", function () {
        self.settings.showInactive = inactive.checked;
        saveSettings(self.settings);
        self.render();
      });
    }
    if (threshold) {
      threshold.checked = this.settings.showThreshold;
      threshold.addEventListener("change", function () {
        self.settings.showThreshold = threshold.checked;
        saveSettings(self.settings);
        self.render();
      });
    }
    if (middle) {
      middle.addEventListener("change", function () {
        var v = middle.value.trim();
        self.settings.middleVal = v === "" ? null : Number(v);
        saveSettings(self.settings);
        self.updatePanelMeta();
        self.render();
      });
    }
    anchors.forEach(function (el) {
      el.checked = el.value === self.settings.anchor;
      el.addEventListener("change", function () {
        if (!el.checked) return;
        self.settings.anchor = el.value;
        saveSettings(self.settings);
        self.syncAnchorControls();
        self.render();
      });
    });
    if (playerSelect) {
      playerSelect.addEventListener("change", function () {
        self.settings.referencePlayerId = playerSelect.value || null;
        saveSettings(self.settings);
        self.render();
      });
    }

    this.syncPlayerPicker();
    this.syncAnchorControls();
    this.rebuildLayerControls();
    this.rebuildItemCategoryControls();
    this.updatePanelMeta();
  };

  MapSpawns.prototype.syncChrome = function () {
    var panel = this.panel;
    var btn = this.toggleBtn;
    if (panel) {
      panel.classList.toggle("hidden", !this.settings.panelOpen);
    }
    if (btn) {
      btn.classList.remove("hidden");
      btn.setAttribute("aria-pressed", this.settings.enabled ? "true" : "false");
    }
    document.body.classList.toggle("map-spawns-mode", !!this.settings.panelOpen);
  };

  MapSpawns.prototype.init = function () {
    this.layer = document.getElementById("map-spawns");
    this.respawnLayer = document.getElementById("map-item-respawns");
    this.thresholdEl = document.getElementById("map-spawn-threshold");
    this.refEl = document.getElementById("map-spawn-ref");
    this.panel = document.getElementById("map-spawns-panel");
    this.toggleBtn = document.getElementById("map-spawns-toggle");
    this.cursorCaptureEl = document.getElementById("map-spawn-cursor");

    if (!this.layer) return;

    var self = this;

    if (window.OverlayApp && typeof OverlayApp.onPickup === "function") {
      OverlayApp.onPickup(function (data) {
        self.onPickupEvent(data);
      });
    }

    this.buildPanel();
    this.syncChrome();
    this.syncCursorCapture();

    if (this.toggleBtn) {
      this.toggleBtn.addEventListener("click", function () {
        self.togglePanel();
      });
    }

    var capture = this.cursorCaptureEl;
    if (capture) {
      capture.addEventListener("pointermove", this._boundMove);
      capture.addEventListener("pointerleave", this._boundLeave);
    }

    if (window.OverlayApp && typeof OverlayApp.onMapPayload === "function") {
      OverlayApp.onMapPayload(function (payload) {
        self.onMapPayload(payload);
        if (window.MapSpawns && typeof MapSpawns.refreshDebugPanel === "function") {
          MapSpawns.refreshDebugPanel();
        }
      });
    }

    this.ensureDisplayConfig();
    this.ensureSpriteMap().then(function () {
      self.render();
    });
  };

  var instance = new MapSpawns();

  global.MapSpawns = {
    init: function () {
      instance.init();
    },
    classifySpawns: classifySpawns,
    autoMiddleVal: autoMiddleVal,
    normalizeGametype: normalizeGametype,
    entityMatchesGametype: entityMatchesGametype,
    entityVisibleForGametypeFilter: entityVisibleForGametypeFilter,
    debugState: function () {
      return instance.debugState();
    },
    refreshDebugPanel: function () {
      if (window.MapDebug && typeof MapDebug.renderEntityOverlay === "function") {
        MapDebug.renderEntityOverlay();
      }
    },
  };
})(window);
