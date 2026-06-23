(function (global) {
  "use strict";

  var STORAGE_KEY = "ql-map-spawns-settings";
  var EXPORT_FILENAME = "ql-map-overlay-settings.json";
  var SETTINGS_VERSION = 14;
  var MAP_BASE_PX = 512;
  var MAP_ZOOM_MIN = 50;
  var MAP_ZOOM_MAX = 150;
  var PLAYER_MARKER_MIN_PX = 4;
  var PLAYER_MARKER_MAX_PX = 32;
  var PLAYER_LABEL_FONT_MIN = 8;
  var PLAYER_LABEL_FONT_MAX = 18;

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
  // Weapons: Duel/FFA ~5s (g_weaponrespawn); TDM map weapons 30s (operator); pak00 items.c 15s.
  // Ammo: pak00 items.c 40s (g_ammorespawn). Prefer payload respawn_sec when present.
  var WEAPON_RESPAWN_SEC_DEFAULT = 5;
  var AMMO_RESPAWN_SEC_DEFAULT = 40;
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

  // Operator-confirmed map-specific Mega Health (default 35s in ITEM_RESPAWN_SEC).
  // Keys: normalizeMapKey(map_name) — lowercase, hyphens removed (pro-q3tourney4 -> proq3tourney4).
  var MEGA_RESPAWN_SEC_BY_MAP = {
    proq3tourney4: 120,
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

  function ammoRespawnSecForGametype(_gametype) {
    return AMMO_RESPAWN_SEC_DEFAULT;
  }

  function itemSupportsRespawn(classname) {
    if (!classname) return false;
    if (classname.indexOf("weapon_") === 0) return true;
    if (classname.indexOf("ammo_") === 0 || classname === "ammo_pack") return true;
    return ITEM_RESPAWN_SEC[classname] != null;
  }

  function respawnSecForClassname(classname, gametype, mapName) {
    if (!classname) return 0;
    if (classname.indexOf("weapon_") === 0) {
      return weaponRespawnSecForGametype(gametype);
    }
    if (classname.indexOf("ammo_") === 0 || classname === "ammo_pack") {
      return ammoRespawnSecForGametype(gametype);
    }
    if (classname === "item_health_mega") {
      return megaRespawnSecForMap(mapName);
    }
    var sec = ITEM_RESPAWN_SEC[classname];
    return sec == null ? 0 : sec;
  }

  var DEFAULT_RESPAWN_TIMERS = {
    weapons: true,
    ammo: true,
    ammo_pack: true,
    health: true,
    armor: true,
    powerups: true,
  };

  var DEFAULT_HUD = {
    showKillfeed: true,
    showPickupToasts: true,
  };

  var DEFAULT_HEATMAP = {
    enabled: false,
    mode: "trail",
    durationSec: 30,
    opacity: 0.45,
    showSelf: true,
    showOpponent: true,
    showOther: true,
    playerHidden: {},
  };

  var ITEM_PICKUP_DISPLAY_MODES = ["timer", "hide", "always"];
  var ITEM_PICKUP_DISPLAY_INHERIT = "inherit";

  var DEFAULT_ITEM_PICKUP_DISPLAY = {
    weapons: "timer",
    ammo: "timer",
    ammo_pack: "hide",
    health: "timer",
    armor: "timer",
    powerups: "timer",
  };

  var ITEM_PICKUP_CLASSNAMES = HEALTH_CLASSNAMES.concat(ARMOR_CLASSNAMES);

  var PRESET_MINIMAL_ITEM_PICKUP_DISPLAY = {
    weapons: "hide",
    ammo: "hide",
    ammo_pack: "hide",
    powerups: "hide",
    health: "timer",
    armor: "timer",
    item_health_small: "hide",
    item_health: "hide",
    item_health_large: "hide",
    item_armor_jacket: "hide",
    item_armor_shard: "hide",
  };

  var PRESET_TEAM_ITEM_PICKUP_DISPLAY = {
    weapons: "timer",
  };

  var HEATMAP_DURATION_MIN = 5;
  var HEATMAP_DURATION_MAX = 120;

  var LAYER_TEMPLATE_IDS = [
    "duel_spawns",
    "items",
    "all_dm_spawns",
    "teleport_exits",
    "teleport_entrances",
  ];

  var DEFAULT_THEME = {
    spawns: {
      activeColor: "#00ff00",
      inactiveColor: "#aa3333",
      activeSpriteUrl: "",
      inactiveSpriteUrl: "",
      cssOverride: "",
    },
    players: {
      fovFill: "rgba(255, 255, 255, 0.1)",
      fovStroke: "rgba(255, 255, 255, 0.28)",
      fovOpacity: 1,
      viewColorStart: "rgba(255, 255, 255, 0.35)",
      viewColorEnd: "rgba(255, 255, 255, 0.95)",
      viewOpacity: 1,
      viewLengthPx: 80,
      arrowHeadColor: "#ffffff",
      arrowSpriteUrl: "",
      selfColor: "#3b82f6",
      opponentColor: "#ef4444",
      otherColor: "#f97316",
    },
    respawn: {
      ringColor: "#4ade80",
      ringBg: "rgba(20, 24, 32, 0.82)",
      countColor: "#f8fafc",
      animationStyle: "conic",
    },
  };

  var PRESET_MINIMAL_ITEM_CATEGORIES = {
    weapons: false,
    ammo: false,
    health: true,
    armor: true,
    powerups: false,
    item_health_small: false,
    item_health: false,
    item_health_large: false,
    item_health_mega: true,
    item_armor_jacket: false,
    item_armor_shard: false,
    item_armor_combat: true,
    item_armor_body: true,
    item_quad: false,
    item_regen: false,
    item_haste: false,
    item_enviro: false,
    item_invis: false,
    item_invulnerability: false,
  };

  var PRESET_MINIMAL = {
    enabled: true,
    showFovWedge: false,
    showDirectionArrow: true,
    playerMarkerStyle: "pin",
    showInactive: false,
    showThreshold: false,
    showKillfeed: false,
    showPickupToasts: true,
    itemCategories: PRESET_MINIMAL_ITEM_CATEGORIES,
    layerTemplate: {
      duel_spawns: false,
      items: true,
      all_dm_spawns: false,
      teleport_exits: false,
      teleport_entrances: false,
    },
  };

  var PRESET_TEAM = {
    itemCategories: Object.assign({}, PRESET_MINIMAL_ITEM_CATEGORIES, {
      weapons: true,
    }),
  };

  var SETTINGS_TABS = ["layers", "players", "items", "hud", "profiles"];

  var PICKUP_MATCH_RADIUS = 128;

  function overlayNowMs() {
    if (global.OverlayApp && typeof global.OverlayApp.overlayNowMs === "function") {
      return global.OverlayApp.overlayNowMs();
    }
    return Date.now();
  }

  function pickupEventTimeMs(data) {
    var replay =
      global.OverlayApp &&
      typeof global.OverlayApp.replayMode === "function" &&
      global.OverlayApp.replayMode();
    if (replay && data && data.t != null && isFinite(Number(data.t))) {
      return Number(data.t);
    }
    return overlayNowMs();
  }

  function pickupCoordsValid(x, y) {
    if (x == null || y == null) return false;
    var wx = Number(x);
    var wy = Number(y);
    return isFinite(wx) && isFinite(wy);
  }
  var _spriteImageCache = {};
  var _jsonAssetCache = {};

  var DEFAULT_ITEM_CATEGORIES = {
    weapons: true,
    ammo: true,
    ammo_pack: false,
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
    layerTemplate: null,
    itemCategories: Object.assign({}, DEFAULT_ITEM_CATEGORIES),
    showFovWedge: true,
    showDirectionArrow: true,
    playerMarkerStyle: "pin",
    showPlayerHealthArmor: true,
    playerMarkerMinPx: 8,
    playerMarkerMaxPx: 14,
    playerLabelFontPx: 11,
    mapZoomPercent: 100,
    showKillfeed: true,
    showPickupToasts: true,
    settingsTab: "layers",
    activePreset: null,
    theme: null,
    customProfiles: [],
    heatmap: Object.assign({}, DEFAULT_HEATMAP),
    itemPickupDisplay: Object.assign({}, DEFAULT_ITEM_PICKUP_DISPLAY),
  };

  function clampHeatmapDuration(sec) {
    var n = Number(sec);
    if (!isFinite(n)) return DEFAULT_HEATMAP.durationSec;
    return Math.max(HEATMAP_DURATION_MIN, Math.min(HEATMAP_DURATION_MAX, Math.round(n)));
  }

  function clampHeatmapOpacity(value) {
    var n = Number(value);
    if (!isFinite(n)) return DEFAULT_HEATMAP.opacity;
    return Math.max(0.05, Math.min(1, n));
  }

  function mergeHeatmap(heatmap) {
    var base = {
      enabled: DEFAULT_HEATMAP.enabled,
      mode: DEFAULT_HEATMAP.mode,
      durationSec: DEFAULT_HEATMAP.durationSec,
      opacity: DEFAULT_HEATMAP.opacity,
      showSelf: DEFAULT_HEATMAP.showSelf,
      showOpponent: DEFAULT_HEATMAP.showOpponent,
      showOther: DEFAULT_HEATMAP.showOther,
      playerHidden: {},
    };
    if (!heatmap || typeof heatmap !== "object") return base;
    base.enabled = heatmap.enabled === true;
    base.mode = heatmap.mode === "aggregate" ? "aggregate" : "trail";
    base.durationSec = clampHeatmapDuration(heatmap.durationSec);
    base.opacity = clampHeatmapOpacity(heatmap.opacity);
    base.showSelf = heatmap.showSelf !== false;
    base.showOpponent = heatmap.showOpponent !== false;
    base.showOther = heatmap.showOther !== false;
    if (heatmap.playerHidden && typeof heatmap.playerHidden === "object") {
      base.playerHidden = Object.assign({}, heatmap.playerHidden);
    }
    return base;
  }

  function normalizePickupDisplayMode(mode, allowInherit) {
    var m = String(mode || "").toLowerCase();
    if (allowInherit && (!m || m === "inherit" || m === "default")) {
      return ITEM_PICKUP_DISPLAY_INHERIT;
    }
    if (ITEM_PICKUP_DISPLAY_MODES.indexOf(m) >= 0) return m;
    return null;
  }

  function mergeItemPickupDisplay(display) {
    var base = Object.assign({}, DEFAULT_ITEM_PICKUP_DISPLAY);
    if (!display || typeof display !== "object") return base;
    var keys = Object.keys(base);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var mode = normalizePickupDisplayMode(display[key], false);
      if (mode) base[key] = mode;
    }
    for (var j = 0; j < ITEM_PICKUP_CLASSNAMES.length; j++) {
      var cn = ITEM_PICKUP_CLASSNAMES[j];
      if (display[cn] == null) continue;
      var cnMode = normalizePickupDisplayMode(display[cn], true);
      if (cnMode && cnMode !== ITEM_PICKUP_DISPLAY_INHERIT) {
        base[cn] = cnMode;
      }
    }
    return base;
  }

  function exportItemPickupDisplay(display) {
    var out = mergeItemPickupDisplay(display);
    if (!display || typeof display !== "object") return out;
    for (var i = 0; i < ITEM_PICKUP_CLASSNAMES.length; i++) {
      var cn = ITEM_PICKUP_CLASSNAMES[i];
      if (display[cn] == null) continue;
      var mode = normalizePickupDisplayMode(display[cn], true);
      if (mode && mode !== ITEM_PICKUP_DISPLAY_INHERIT) out[cn] = mode;
    }
    return out;
  }

  function pickupDisplayForClassname(classname, settings) {
    var raw = settings && settings.itemPickupDisplay;
    if (classname && raw && raw[classname] != null) {
      var explicit = normalizePickupDisplayMode(raw[classname], true);
      if (explicit && explicit !== ITEM_PICKUP_DISPLAY_INHERIT) {
        return explicit;
      }
    }
    var modes = mergeItemPickupDisplay(raw);
    var cat = entityItemCategory(classname);
    if (cat && modes[cat]) return modes[cat];
    return "timer";
  }

  function pickupDisplayOverrideForClassname(classname, settings) {
    var raw = settings && settings.itemPickupDisplay;
    if (!raw || !classname || raw[classname] == null) {
      return ITEM_PICKUP_DISPLAY_INHERIT;
    }
    return (
      normalizePickupDisplayMode(raw[classname], true) ||
      ITEM_PICKUP_DISPLAY_INHERIT
    );
  }

  function migrateRespawnTimersIntoPickupDisplay(settings) {
    var display = mergeItemPickupDisplay(settings.itemPickupDisplay);
    var timers = settings.respawnTimers;
    if (!timers || typeof timers !== "object") return display;
    var cats = Object.keys(DEFAULT_RESPAWN_TIMERS);
    for (var i = 0; i < cats.length; i++) {
      var cat = cats[i];
      if (timers[cat] !== false) continue;
      if (display[cat] !== "timer") continue;
      display[cat] = "always";
    }
    return display;
  }

  function ammoPackVisibleForGametype(ent, gametype) {
    if (!ent || ent.classname !== "ammo_pack") return true;
    var gt = normalizeGametype(gametype);
    var attrs = ent.attrs || {};
    if (attrs.gametype) {
      return gametypeListMatches(attrs.gametype, gt);
    }
    if (attrs.not_gametype) {
      return !gametypeListMatches(attrs.not_gametype, gt);
    }
    if (gt === "duel" || gt === "tdm" || gt === "teamdeathmatch") {
      return false;
    }
    return true;
  }

  function mergeTheme(theme) {
    var base = JSON.parse(JSON.stringify(DEFAULT_THEME));
    if (!theme || typeof theme !== "object") return base;
    var hubOrigin = "";
    try {
      var qBase = new URLSearchParams(window.location.search).get("base") || "";
      if (qBase) hubOrigin = new URL(qBase).origin;
    } catch (_eHub) {
      /* ignore */
    }
    function cleanSpriteUrl(url) {
      if (!url || typeof url !== "string") return url;
      if (!hubOrigin || url.indexOf("http") !== 0) return url;
      try {
        if (new URL(url).origin === hubOrigin) return "";
      } catch (_eUrl) {
        return url;
      }
      return url;
    }
    if (theme.spawns && typeof theme.spawns === "object") {
      Object.assign(base.spawns, theme.spawns);
      base.spawns.activeSpriteUrl = cleanSpriteUrl(base.spawns.activeSpriteUrl);
      base.spawns.inactiveSpriteUrl = cleanSpriteUrl(base.spawns.inactiveSpriteUrl);
    }
    if (theme.players && typeof theme.players === "object") {
      Object.assign(base.players, theme.players);
      base.players.arrowSpriteUrl = cleanSpriteUrl(base.players.arrowSpriteUrl);
    }
    if (theme.respawn && typeof theme.respawn === "object") {
      Object.assign(base.respawn, theme.respawn);
    }
    return base;
  }

  function clampOpacity(value, fallback) {
    var n = Number(value);
    if (!isFinite(n)) return fallback != null ? fallback : 1;
    return Math.max(0, Math.min(1, n));
  }

  function clampViewLength(value) {
    var n = Number(value);
    if (!isFinite(n)) return DEFAULT_THEME.players.viewLengthPx;
    return Math.max(36, Math.min(140, Math.round(n)));
  }

  function normalizeCustomProfiles(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      if (!row || typeof row !== "object") continue;
      var name = String(row.name || "").trim();
      if (!name) continue;
      out.push({
        id: String(row.id || "profile-" + i + "-" + Date.now()),
        name: name,
        savedAt: row.savedAt || new Date().toISOString(),
        settings: row.settings && typeof row.settings === "object" ? row.settings : {},
      });
    }
    return out;
  }

  function settingsPayload(settings) {
    return {
      enabled: settings.enabled,
      anchor: settings.anchor,
      referencePlayerId: settings.referencePlayerId,
      showInactive: settings.showInactive,
      showThreshold: settings.showThreshold,
      middleVal: settings.middleVal,
      layers: settings.layers,
      layerTemplate: settings.layerTemplate || null,
      itemCategories: Object.assign({}, DEFAULT_ITEM_CATEGORIES, settings.itemCategories || {}),
      showFovWedge: settings.showFovWedge !== false,
      showDirectionArrow: settings.showDirectionArrow !== false,
      playerMarkerStyle: normalizePlayerMarkerStyle(settings.playerMarkerStyle),
      showPlayerHealthArmor: settings.showPlayerHealthArmor !== false,
      playerMarkerMinPx: clampPlayerMarkerMinPx(settings.playerMarkerMinPx),
      playerMarkerMaxPx: clampPlayerMarkerMaxPx(
        settings.playerMarkerMaxPx,
        settings.playerMarkerMinPx,
      ),
      playerLabelFontPx: clampPlayerLabelFontPx(settings.playerLabelFontPx),
      mapZoomPercent: clampMapZoom(settings.mapZoomPercent),
      showKillfeed: settings.showKillfeed !== false,
      showPickupToasts: settings.showPickupToasts !== false,
      settingsTab: settings.settingsTab || "layers",
      activePreset: settings.activePreset || null,
      theme: mergeTheme(settings.theme),
      customProfiles: normalizeCustomProfiles(settings.customProfiles),
      heatmap: mergeHeatmap(settings.heatmap),
      itemPickupDisplay: exportItemPickupDisplay(settings.itemPickupDisplay),
      version: SETTINGS_VERSION,
    };
  }

  function applyLayerTemplate(settings, mapName) {
    if (!settings.layerTemplate || !mapName) return;
    if (!settings.layers[mapName]) settings.layers[mapName] = {};
    var tpl = settings.layerTemplate;
    for (var i = 0; i < LAYER_TEMPLATE_IDS.length; i++) {
      var id = LAYER_TEMPLATE_IDS[i];
      if (Object.prototype.hasOwnProperty.call(tpl, id)) {
        settings.layers[mapName][id] = !!tpl[id];
      }
    }
  }

  function applyThemeToDom(theme) {
    var wrap = document.getElementById("map-wrap");
    if (!wrap) return;
    var t = mergeTheme(theme);
    wrap.style.setProperty("--map-spawn-active-color", t.spawns.activeColor);
    wrap.style.setProperty("--map-spawn-inactive-color", t.spawns.inactiveColor);
    wrap.style.setProperty("--map-fov-fill", t.players.fovFill);
    wrap.style.setProperty("--map-fov-stroke", t.players.fovStroke);
    wrap.style.setProperty("--map-fov-opacity", String(clampOpacity(t.players.fovOpacity, 1)));
    wrap.style.setProperty("--map-view-color-start", t.players.viewColorStart);
    wrap.style.setProperty("--map-view-color-end", t.players.viewColorEnd);
    wrap.style.setProperty("--map-view-opacity", String(clampOpacity(t.players.viewOpacity, 1)));
    wrap.style.setProperty(
      "--map-view-length-px",
      clampViewLength(t.players.viewLengthPx) + "px",
    );
    wrap.style.setProperty("--map-view-head-color", t.players.arrowHeadColor);
    wrap.style.setProperty("--map-player-self-color", t.players.selfColor);
    wrap.style.setProperty("--map-player-opponent-color", t.players.opponentColor);
    wrap.style.setProperty("--map-player-other-color", t.players.otherColor);
    wrap.style.setProperty("--map-respawn-ring-color", t.respawn.ringColor);
    wrap.style.setProperty("--map-respawn-ring-bg", t.respawn.ringBg);
    wrap.style.setProperty("--map-respawn-count-color", t.respawn.countColor);
    var anim = t.respawn.animationStyle === "linear" ? "linear" : "conic";
    wrap.setAttribute("data-respawn-animation", anim);
    if (t.spawns.activeSpriteUrl) {
      wrap.style.setProperty(
        "--map-spawn-active-sprite",
        'url("' + String(t.spawns.activeSpriteUrl).replace(/"/g, "") + '")',
      );
    } else {
      wrap.style.removeProperty("--map-spawn-active-sprite");
    }
    if (t.spawns.inactiveSpriteUrl) {
      wrap.style.setProperty(
        "--map-spawn-inactive-sprite",
        'url("' + String(t.spawns.inactiveSpriteUrl).replace(/"/g, "") + '")',
      );
    } else {
      wrap.style.removeProperty("--map-spawn-inactive-sprite");
    }
    if (t.players.arrowSpriteUrl) {
      wrap.style.setProperty(
        "--map-view-sprite",
        'url("' + String(t.players.arrowSpriteUrl).replace(/"/g, "") + '")',
      );
      wrap.classList.add("map-theme-view-sprite");
    } else {
      wrap.style.removeProperty("--map-view-sprite");
      wrap.classList.remove("map-theme-view-sprite");
    }
    if (t.spawns.cssOverride) {
      wrap.setAttribute("data-spawn-css-override", "1");
      var styleId = "map-spawn-theme-override";
      var node = document.getElementById(styleId);
      if (!node) {
        node = document.createElement("style");
        node.id = styleId;
        document.head.appendChild(node);
      }
      node.textContent =
        "#map-wrap[data-spawn-css-override] .map-spawn { " + t.spawns.cssOverride + " }";
    } else {
      wrap.removeAttribute("data-spawn-css-override");
      var old = document.getElementById("map-spawn-theme-override");
      if (old && old.parentNode) old.parentNode.removeChild(old);
    }
  }

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
    if (s.showFovWedge == null) s.showFovWedge = DEFAULTS.showFovWedge;
    if (s.showDirectionArrow == null) s.showDirectionArrow = DEFAULTS.showDirectionArrow;
    normalizePlayerMarkerSettings(s);
    if (s.mapZoomPercent == null) s.mapZoomPercent = DEFAULTS.mapZoomPercent;
    if (s.showKillfeed == null) s.showKillfeed = DEFAULTS.showKillfeed;
    if (s.showPickupToasts == null) s.showPickupToasts = DEFAULTS.showPickupToasts;
    if (!s.settingsTab || SETTINGS_TABS.indexOf(s.settingsTab) < 0) {
      s.settingsTab = DEFAULTS.settingsTab;
    }
    s.theme = mergeTheme(s.theme);
    s.customProfiles = normalizeCustomProfiles(s.customProfiles);
    s.heatmap = mergeHeatmap(s.heatmap);
    s.itemPickupDisplay = mergeItemPickupDisplay(s.itemPickupDisplay);
    if (s.activePreset == null) s.activePreset = DEFAULTS.activePreset;
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
      if (prevVersion < 7) {
        if (s.showFovWedge == null) s.showFovWedge = true;
        if (s.showDirectionArrow == null) s.showDirectionArrow = true;
        if (s.mapZoomPercent == null) s.mapZoomPercent = 100;
      }
      if (prevVersion < 8) {
        s.respawnTimers = Object.assign({}, DEFAULT_RESPAWN_TIMERS, s.respawnTimers || {});
        if (s.showKillfeed == null) s.showKillfeed = true;
        if (s.showPickupToasts == null) s.showPickupToasts = true;
        if (!s.settingsTab || SETTINGS_TABS.indexOf(s.settingsTab) < 0) {
          s.settingsTab = "layers";
        }
      }
      if (prevVersion < 9) {
        s.theme = mergeTheme(s.theme);
        s.customProfiles = normalizeCustomProfiles(s.customProfiles);
        if (s.activePreset == null) s.activePreset = null;
        if (s.layerTemplate == null) s.layerTemplate = null;
      }
      if (prevVersion < 10) {
        s.heatmap = mergeHeatmap(s.heatmap);
        s.theme = mergeTheme(s.theme);
      }
      if (prevVersion < 11) {
        s.itemPickupDisplay = mergeItemPickupDisplay(s.itemPickupDisplay);
        if (s.itemCategories.ammo_pack == null) {
          s.itemCategories = Object.assign({}, s.itemCategories, { ammo_pack: false });
        }
        s.heatmap = mergeHeatmap(s.heatmap);
      }
      if (prevVersion < 12) {
        s.itemPickupDisplay = migrateRespawnTimersIntoPickupDisplay(s);
        delete s.respawnTimers;
      }
      if (prevVersion < 13) {
        normalizePlayerMarkerSettings(s);
      }
      if (prevVersion < 14) {
        s.playerMarkerStyle = "arrow";
      }
      s.version = SETTINGS_VERSION;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settingsPayload(s)));
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settingsPayload(settings)));
    } catch (_e) {
      /* private mode */
    }
    applyThemeToDom(settings.theme);
  }

  function markCustom(settings) {
    if (settings.activePreset && settings.activePreset !== "custom") {
      settings.activePreset = "custom";
      settings.layerTemplate = null;
    }
  }

  function applyPresetToSettings(settings, presetName, mapName) {
    var base = presetName === "team" ? PRESET_TEAM : PRESET_MINIMAL;
    settings.enabled = PRESET_MINIMAL.enabled;
    settings.showFovWedge = PRESET_MINIMAL.showFovWedge;
    settings.showDirectionArrow = PRESET_MINIMAL.showDirectionArrow;
    settings.playerMarkerStyle = PRESET_MINIMAL.playerMarkerStyle;
    settings.showInactive = PRESET_MINIMAL.showInactive;
    settings.showThreshold = PRESET_MINIMAL.showThreshold;
    settings.showKillfeed = PRESET_MINIMAL.showKillfeed;
    settings.showPickupToasts = PRESET_MINIMAL.showPickupToasts;
    settings.itemCategories = Object.assign(
      {},
      DEFAULT_ITEM_CATEGORIES,
      PRESET_MINIMAL.itemCategories,
      base.itemCategories || {},
    );
    settings.itemPickupDisplay = Object.assign(
      {},
      DEFAULT_ITEM_PICKUP_DISPLAY,
      PRESET_MINIMAL_ITEM_PICKUP_DISPLAY,
      presetName === "team" ? PRESET_TEAM_ITEM_PICKUP_DISPLAY : {},
      base.itemPickupDisplay || {},
    );
    settings.layerTemplate = Object.assign({}, PRESET_MINIMAL.layerTemplate);
    settings.activePreset = presetName;
    if (mapName) applyLayerTemplate(settings, mapName);
  }

  function buildExportDocument(settings) {
    return {
      version: SETTINGS_VERSION,
      exportedAt: new Date().toISOString(),
      settings: settingsPayload(settings),
    };
  }

  function validateImportDocument(doc) {
    if (!doc || typeof doc !== "object") return { ok: false, error: "Invalid JSON object" };
    var ver = Number(doc.version);
    if (!isFinite(ver) || ver < 1) {
      return { ok: false, error: "Missing or invalid version field" };
    }
    if (ver > SETTINGS_VERSION) {
      return {
        ok: false,
        error: "Unsupported settings version " + ver + " (max " + SETTINGS_VERSION + ")",
      };
    }
    var raw = doc.settings && typeof doc.settings === "object" ? doc.settings : doc;
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: "Missing settings object" };
    }
    return { ok: true, settings: raw, version: ver };
  }

  function importSettingsDocument(doc) {
    var check = validateImportDocument(doc);
    if (!check.ok) return check;
    var merged = Object.assign({}, DEFAULTS, check.settings);
    merged.version = check.version;
    merged.itemPickupDisplay = mergeItemPickupDisplay(merged.itemPickupDisplay);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settingsPayload(merged)));
    } catch (_e) {
      return { ok: false, error: "Could not write localStorage" };
    }
    return { ok: true, settings: loadSettings() };
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

  function gametypeTokens(value) {
    var raw = String(value || "").trim().toLowerCase();
    if (!raw) return [];
    var parts = raw.split(/[\s,]+/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var token = normalizeGametype(parts[i]);
      if (token && out.indexOf(token) < 0) out.push(token);
    }
    return out;
  }

  function gametypeListMatches(value, gt) {
    var tokens = gametypeTokens(value);
    if (!tokens.length) return false;
    var normalized = normalizeGametype(gt);
    if (!normalized) return false;
    return tokens.indexOf(normalized) >= 0;
  }

  function truthyMapAttr(value) {
    return value === "1" || value === 1 || value === true;
  }

  function legacySpawnFlagsBlockGametype(attrs, gt) {
    if (!attrs || !gt) return false;
    var g = normalizeGametype(gt);
    if (!g) return false;
    if (truthyMapAttr(attrs.notsingle) && g === "duel") return true;
    if (truthyMapAttr(attrs.notfree) && (g === "dm" || g === "duel")) return true;
    if (
      truthyMapAttr(attrs.notteam) &&
      (g === "tdm" || g === "ctf" || g === "ca" || g === "dom")
    ) {
      return true;
    }
    return false;
  }

  function entityMatchesGametype(ent, gametype) {
    var gt = normalizeGametype(gametype);
    if (!gt) return true;
    var attrs = ent.attrs || {};
    if (attrs.gametype && !gametypeListMatches(attrs.gametype, gt)) {
      return false;
    }
    if (attrs.not_gametype && gametypeListMatches(attrs.not_gametype, gt)) {
      return false;
    }
    if (legacySpawnFlagsBlockGametype(attrs, gt)) return false;
    return true;
  }

  function entityIsUniversalGametype(ent) {
    var attrs = (ent && ent.attrs) || {};
    return (
      !attrs.gametype &&
      !attrs.not_gametype &&
      !truthyMapAttr(attrs.notsingle) &&
      !truthyMapAttr(attrs.notfree) &&
      !truthyMapAttr(attrs.notteam)
    );
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
  };

  var POWERUP_CLASSNAMES = {
    item_quad: true,
    item_regen: true,
    item_haste: true,
    item_enviro: true,
    item_invis: true,
    item_invulnerability: true,
  };

  function clampMapZoom(value) {
    var n = Number(value);
    if (!isFinite(n)) return 100;
    return Math.max(MAP_ZOOM_MIN, Math.min(MAP_ZOOM_MAX, Math.round(n)));
  }

  function clampPlayerMarkerMinPx(value) {
    var n = Number(value);
    if (!isFinite(n)) return DEFAULTS.playerMarkerMinPx;
    return Math.max(PLAYER_MARKER_MIN_PX, Math.min(PLAYER_MARKER_MAX_PX, Math.round(n)));
  }

  function clampPlayerMarkerMaxPx(value, minPx) {
    var min = clampPlayerMarkerMinPx(minPx != null ? minPx : DEFAULTS.playerMarkerMinPx);
    var n = Number(value);
    if (!isFinite(n)) return Math.max(min, DEFAULTS.playerMarkerMaxPx);
    return Math.max(min, Math.min(PLAYER_MARKER_MAX_PX, Math.round(n)));
  }

  function clampPlayerLabelFontPx(value) {
    var n = Number(value);
    if (!isFinite(n)) return DEFAULTS.playerLabelFontPx;
    return Math.max(PLAYER_LABEL_FONT_MIN, Math.min(PLAYER_LABEL_FONT_MAX, Math.round(n)));
  }

  function normalizePlayerMarkerStyle(value) {
    return value === "arrow" ? "arrow" : "pin";
  }

  function normalizePlayerMarkerSettings(settings) {
    settings.playerMarkerMinPx = clampPlayerMarkerMinPx(settings.playerMarkerMinPx);
    settings.playerMarkerMaxPx = clampPlayerMarkerMaxPx(
      settings.playerMarkerMaxPx,
      settings.playerMarkerMinPx,
    );
    settings.playerLabelFontPx = clampPlayerLabelFontPx(settings.playerLabelFontPx);
    if (settings.showPlayerHealthArmor == null) {
      settings.showPlayerHealthArmor = DEFAULTS.showPlayerHealthArmor;
    }
    settings.playerMarkerStyle = normalizePlayerMarkerStyle(settings.playerMarkerStyle);
    return settings;
  }

  function applyMapZoom(settings) {
    var wrap = document.getElementById("map-wrap");
    var host = document.getElementById("map-zoom-host");
    if (!wrap || !host) return;
    var pct = clampMapZoom(settings && settings.mapZoomPercent);
    var scale = pct / 100;
    var visual = Math.round(MAP_BASE_PX * scale);
    host.style.width = visual + "px";
    host.style.height = visual + "px";
    wrap.style.transform = scale === 1 ? "none" : "scale(" + scale + ")";
    wrap.style.transformOrigin = "top left";
    wrap.style.width = MAP_BASE_PX + "px";
    wrap.style.height = MAP_BASE_PX + "px";
  }

  function entityItemCategory(classname) {
    if (!classname) return null;
    if (classname === "ammo_pack") return "ammo_pack";
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

  var HEATMAP_TP_NEAR_UNITS = 224;
  var HEATMAP_TP_NEAR_SQ = HEATMAP_TP_NEAR_UNITS * HEATMAP_TP_NEAR_UNITS;
  var HEATMAP_JUMP_FALLBACK_UNITS = 512;
  var HEATMAP_JUMP_FALLBACK_SQ =
    HEATMAP_JUMP_FALLBACK_UNITS * HEATMAP_JUMP_FALLBACK_UNITS;

  function heatmapDistSq(ax, ay, bx, by) {
    var dx = Number(ax) - Number(bx);
    var dy = Number(ay) - Number(by);
    return dx * dx + dy * dy;
  }

  function heatmapNearSq(x, y, px, py, rSq) {
    return heatmapDistSq(x, y, px, py) <= rSq;
  }

  function isHeatmapTeleportJumpInGraph(graph, fromX, fromY, toX, toY) {
    if (
      !isFinite(fromX) ||
      !isFinite(fromY) ||
      !isFinite(toX) ||
      !isFinite(toY)
    ) {
      return false;
    }
    var jumpSq = heatmapDistSq(fromX, fromY, toX, toY);
    if (jumpSq < 48 * 48) return false;

    var pairs = (graph && graph.entrances) || [];
    for (var i = 0; i < pairs.length; i++) {
      var pair = pairs[i];
      var ent = pair.entrance;
      var exit = pair.exit;
      if (!ent || !exit) continue;
      if (
        heatmapNearSq(fromX, fromY, ent.x, ent.y, HEATMAP_TP_NEAR_SQ) &&
        heatmapNearSq(toX, toY, exit.x, exit.y, HEATMAP_TP_NEAR_SQ)
      ) {
        return true;
      }
    }
    return jumpSq >= HEATMAP_JUMP_FALLBACK_SQ;
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

  function fetchJsonAsset(url) {
    if (!url) return Promise.reject(new Error("empty url"));
    if (_jsonAssetCache[url]) return _jsonAssetCache[url];
    _jsonAssetCache[url] = fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .catch(function (err) {
        delete _jsonAssetCache[url];
        throw err;
      });
    return _jsonAssetCache[url];
  }

  function loadCachedSpriteImage(url) {
    if (!url) return Promise.resolve(null);
    if (_spriteImageCache[url]) return _spriteImageCache[url];
    _spriteImageCache[url] = new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        resolve(null);
      };
      img.src = url;
    });
    return _spriteImageCache[url];
  }

  function applySpriteToMarker(dot, spriteRel) {
    if (!spriteRel || !window.MapCoords) return;
    var url = MapCoords.assetUrl(spriteRel);
    var existing = dot.querySelector("img.map-entity-sprite");
    if (existing && existing.getAttribute("data-sprite-url") === url) {
      return;
    }
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
    loadCachedSpriteImage(url).then(function (img) {
      if (!img || !dot.parentNode) return;
      var node = dot.querySelector("img.map-entity-sprite");
      if (node && node.getAttribute("data-sprite-url") === url) return;
      if (node && node.parentNode) node.parentNode.removeChild(node);
      var el = img.cloneNode(false);
      el.className = "map-entity-sprite";
      el.setAttribute("data-sprite-url", url);
      el.alt = dot.title || "";
      dot.appendChild(el);
    });
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
    this._hiddenItems = {};
    this._respawnLoopId = 0;
    this._hiddenLoopId = 0;
    this._staticMarkers = {};
    this._staticMarkersKey = "";
    this._staticLayerDirty = true;
    this._staticLayerEl = null;
    this._dynamicLayerEl = null;
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

  MapSpawns.prototype._markStaticLayerDirty = function () {
    this._staticLayerDirty = true;
  };

  MapSpawns.prototype._staticRenderKey = function () {
    var mapLayers = (this.mapName && this.settings.layers[this.mapName]) || {};
    return [
      this.mapName || "",
      this.gametype || "",
      JSON.stringify(this.settings.itemCategories || {}),
      JSON.stringify(mapLayers),
    ].join("|");
  };

  MapSpawns.prototype._ensureRenderLayers = function () {
    var root = this.layer;
    if (!root) return;
    if (!this._staticLayerEl) {
      this._staticLayerEl = document.createElement("div");
      this._staticLayerEl.className = "map-spawns-static";
      root.appendChild(this._staticLayerEl);
    }
    if (!this._dynamicLayerEl) {
      this._dynamicLayerEl = document.createElement("div");
      this._dynamicLayerEl.className = "map-spawns-dynamic";
      root.appendChild(this._dynamicLayerEl);
    }
  };

  MapSpawns.prototype._clearStaticMarkers = function () {
    for (var key in this._staticMarkers) {
      if (!Object.prototype.hasOwnProperty.call(this._staticMarkers, key)) continue;
      var row = this._staticMarkers[key];
      if (row.el && row.el.parentNode) row.el.parentNode.removeChild(row.el);
    }
    this._staticMarkers = {};
    if (this._staticLayerEl) this._staticLayerEl.innerHTML = "";
    this._staticLayerDirty = true;
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
    this._clearHiddenItems();
  };

  MapSpawns.prototype._clearHiddenItems = function () {
    this._stopHiddenLoop();
    this._hiddenItems = {};
    this._refreshAllEntityVisibility();
  };

  MapSpawns.prototype._stopHiddenLoop = function () {
    if (this._hiddenLoopId) {
      cancelAnimationFrame(this._hiddenLoopId);
      this._hiddenLoopId = 0;
    }
  };

  MapSpawns.prototype._entityUnavailableForDisplay = function (entityId) {
    if (this._itemOnRespawnCooldown(entityId)) return true;
    var row = this._hiddenItems[this._itemRespawnKey(entityId)];
    return !!(row && row.expiresAt > overlayNowMs());
  };

  MapSpawns.prototype._pruneExpiredItemStates = function (now) {
    now = now != null ? now : overlayNowMs();
    for (var key in this._itemRespawns) {
      if (!Object.prototype.hasOwnProperty.call(this._itemRespawns, key)) continue;
      var row = this._itemRespawns[key];
      if (row.expiresAt > now) continue;
      if (row.el && row.el.parentNode) row.el.parentNode.removeChild(row.el);
      delete this._itemRespawns[key];
      if (row.entityId != null) this._refreshEntityHidden(row.entityId);
    }
    for (var hkey in this._hiddenItems) {
      if (!Object.prototype.hasOwnProperty.call(this._hiddenItems, hkey)) continue;
      var hidden = this._hiddenItems[hkey];
      if (hidden.expiresAt > now) continue;
      delete this._hiddenItems[hkey];
      if (hidden.entityId != null) this._refreshEntityHidden(hidden.entityId);
    }
  };

  MapSpawns.prototype._refreshEntityHidden = function (entityId) {
    var row = this._staticMarkers[entityId];
    if (!row || !row.el) return;
    var hidden = this._entityUnavailableForDisplay(entityId);
    row.el.classList.toggle("map-entity-hidden", hidden);
    row.el.classList.toggle(
      "map-entity-respawn-cooldown",
      hidden && !!this._itemRespawns[this._itemRespawnKey(entityId)],
    );
  };

  MapSpawns.prototype._refreshAllEntityVisibility = function () {
    for (var id in this._staticMarkers) {
      if (!Object.prototype.hasOwnProperty.call(this._staticMarkers, id)) continue;
      this._refreshEntityHidden(id);
    }
  };

  MapSpawns.prototype._ensureHiddenExpireLoop = function () {
    var self = this;
    if (this._hiddenLoopId) return;
    function frame() {
      var now = overlayNowMs();
      var active = false;
      for (var key in self._hiddenItems) {
        if (!Object.prototype.hasOwnProperty.call(self._hiddenItems, key)) continue;
        var row = self._hiddenItems[key];
        if (row.expiresAt <= now) {
          delete self._hiddenItems[key];
          self._refreshEntityHidden(row.entityId);
        } else {
          active = true;
        }
      }
      if (active) {
        self._hiddenLoopId = requestAnimationFrame(frame);
      } else {
        self._hiddenLoopId = 0;
      }
    }
    this._hiddenLoopId = requestAnimationFrame(frame);
  };

  MapSpawns.prototype._itemRespawnKey = function (entityId) {
    return (this.mapName || "") + ":" + entityId;
  };

  MapSpawns.prototype._itemOnRespawnCooldown = function (entityId) {
    var row = this._itemRespawns[this._itemRespawnKey(entityId)];
    return !!(row && row.expiresAt > overlayNowMs());
  };

  function formatRespawnCountdown(remainingMs, respawnMs) {
    if (remainingMs <= 0) return "0";
    var totalSec = Math.max(1, Math.round(respawnMs / 1000));
    var sec = Math.floor(remainingMs / 1000);
    if (remainingMs > 0 && sec < 1) sec = 1;
    if (sec > totalSec) sec = totalSec;
    return String(sec);
  }

  MapSpawns.prototype.findNearestItemEntity = function (classname, x, y, maxDist) {
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

    var radius = maxDist != null && isFinite(Number(maxDist)) ? Number(maxDist) : PICKUP_MATCH_RADIUS;
    var best = null;
    var bestD2 = radius * radius;
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

  MapSpawns.prototype._clearEntityPickupState = function (entityId) {
    var key = this._itemRespawnKey(entityId);
    var row = this._itemRespawns[key];
    if (row && row.el && row.el.parentNode) row.el.parentNode.removeChild(row.el);
    delete this._itemRespawns[key];
    delete this._hiddenItems[key];
  };

  MapSpawns.prototype._pickupMatchCoords = function (data) {
    if (pickupCoordsValid(data && data.x, data && data.y)) {
      return { x: Number(data.x), y: Number(data.y) };
    }
    var ref = this.referenceWorld();
    if (ref && isFinite(ref.x) && isFinite(ref.y)) {
      return { x: Number(ref.x), y: Number(ref.y) };
    }
    var live = this.playersWithCoords();
    for (var i = 0; i < live.length; i++) {
      var p = live[i];
      if (p.x == null || p.y == null) continue;
      var px = Number(p.x);
      var py = Number(p.y);
      if (isFinite(px) && isFinite(py)) return { x: px, y: py };
    }
    return null;
  };

  MapSpawns.prototype.findItemEntityForPickup = function (data, maxDist) {
    var item = data && data.item;
    if (!item) return null;
    var matches = [];
    var entities = (this.entityData && this.entityData.entities) || [];
    for (var m = 0; m < entities.length; m++) {
      var candidate = entities[m];
      if (candidate.classname !== item) continue;
      if (isHiddenEntity(candidate)) continue;
      matches.push(candidate);
    }
    if (!matches.length) return null;

    var radius =
      maxDist != null && isFinite(Number(maxDist)) ? Number(maxDist) : PICKUP_MATCH_RADIUS;

    var entityId = data && data.entity_id;
    if (entityId != null && entityId !== "") {
      var wantId = Number(entityId);
      if (isFinite(wantId)) {
        var coordsForId = this._pickupMatchCoords(data);
        for (var i = 0; i < matches.length; i++) {
          if (Number(matches[i].id) !== wantId) continue;
          if (coordsForId) {
            var cdx = Number(matches[i].x) - coordsForId.x;
            var cdy = Number(matches[i].y) - coordsForId.y;
            if (cdx * cdx + cdy * cdy <= radius * radius) return matches[i];
            continue;
          }
          return matches[i];
        }
      }
    }

    var available = [];
    for (var a = 0; a < matches.length; a++) {
      if (!this._entityUnavailableForDisplay(matches[a].id)) {
        available.push(matches[a]);
      }
    }
    var pool = available.length ? available : matches;

    if (pool.length === 1) return pool[0];

    var coords = this._pickupMatchCoords(data);
    if (coords) {
      var wx = coords.x;
      var wy = coords.y;
      var best = null;
      var bestD2 = radius * radius;
      for (var j = 0; j < pool.length; j++) {
        var near = pool[j];
        var dx = Number(near.x) - wx;
        var dy = Number(near.y) - wy;
        var d2 = dx * dx + dy * dy;
        if (d2 <= bestD2) {
          bestD2 = d2;
          best = near;
        }
      }
      if (best) return best;

      best = null;
      bestD2 = Infinity;
      for (var k = 0; k < pool.length; k++) {
        var cand = pool[k];
        var dx2 = Number(cand.x) - wx;
        var dy2 = Number(cand.y) - wy;
        var d2b = dx2 * dx2 + dy2 * dy2;
        if (d2b < bestD2) {
          bestD2 = d2b;
          best = cand;
        }
      }
      if (best) return best;
    }

    return pool[0];
  };

  MapSpawns.prototype.respawnDurationMs = function (item, data, pickedAtMs) {
    if (data && data.respawn_sec != null && isFinite(Number(data.respawn_sec))) {
      return Math.max(500, Number(data.respawn_sec) * 1000);
    }
    if (data && data.respawn_at) {
      try {
        var at = new Date(data.respawn_at).getTime();
        if (isFinite(at)) {
          if (pickedAtMs != null && isFinite(pickedAtMs)) {
            var duration = at - pickedAtMs;
            if (duration > 0) return duration;
          }
          var left = at - overlayNowMs();
          if (left > 0) return left;
        }
      } catch (_e) {
        /* ignore */
      }
    }
    if (item && item.indexOf("weapon_") === 0) {
      return weaponRespawnSecForGametype(this.gametype) * 1000;
    }
    if (
      item &&
      (item.indexOf("ammo_") === 0 || item === "ammo_pack")
    ) {
      return ammoRespawnSecForGametype(this.gametype) * 1000;
    }
    var sec = ITEM_RESPAWN_SEC[item];
    if (item === "item_health_mega") {
      sec = megaRespawnSecForMap(this.mapName);
    }
    if (sec == null) return 0;
    return sec * 1000;
  };

  MapSpawns.prototype._refreshEntityCooldown = function (entityId) {
    this._refreshEntityHidden(entityId);
  };

  MapSpawns.prototype._refreshAllCooldownMarkers = function () {
    for (var id in this._staticMarkers) {
      if (!Object.prototype.hasOwnProperty.call(this._staticMarkers, id)) continue;
      this._refreshEntityCooldown(id);
    }
  };

  MapSpawns.prototype.onPickupEvent = function (data) {
    if (data && String(data.action || "pickup").toLowerCase() === "drop") {
      return;
    }
    var transform =
      this.transform || (this.lastPayload && this.lastPayload.transform);
    if (!this.settings.enabled || !this.entityData || !transform) return;
    if (!this.transform) this.transform = transform;
    var item = data && data.item;
    if (!item || !itemSupportsRespawn(item)) return;
    if (!entityVisibleForCategory(item, this.settings.itemCategories)) return;
    if (!this.layerEnabled("items")) return;
    var displayMode = pickupDisplayForClassname(item, this.settings);
    if (displayMode === "always") return;
    this._pruneExpiredItemStates();
    var ent = this.findItemEntityForPickup(data, PICKUP_MATCH_RADIUS);
    if (!ent) return;
    this._clearEntityPickupState(ent.id);
    var pickedAtMs = pickupEventTimeMs(data);
    var respawnMs = this.respawnDurationMs(item, data, pickedAtMs);
    if (!respawnMs) return;
    var expiresAt = pickedAtMs + respawnMs;
    var key = this._itemRespawnKey(ent.id);
    if (displayMode === "hide") {
      this._hiddenItems[key] = {
        entityId: ent.id,
        expiresAt: expiresAt,
      };
      this._refreshEntityHidden(ent.id);
      this._ensureHiddenExpireLoop();
      return;
    }
    this._itemRespawns[key] = {
      entityId: ent.id,
      classname: item,
      x: Number(ent.x),
      y: Number(ent.y),
      expiresAt: expiresAt,
      respawnMs: respawnMs,
      pickedAtMs: pickedAtMs,
      el: null,
      elRing: null,
      elCount: null,
    };
    this._refreshEntityHidden(ent.id);
    this.renderRespawnOverlays();
    this._ensureRespawnLoop();
  };

  MapSpawns.prototype.renderRespawnOverlays = function () {
    var layer = this.respawnLayer;
    if (!layer || !this.transform) return false;
    var now = overlayNowMs();
    var active = false;
    for (var key in this._itemRespawns) {
      if (!Object.prototype.hasOwnProperty.call(this._itemRespawns, key)) continue;
      var row = this._itemRespawns[key];
      if (row.expiresAt <= now) {
        if (row.el && row.el.parentNode) row.el.parentNode.removeChild(row.el);
        delete this._itemRespawns[key];
        if (row.entityId != null) this._refreshEntityHidden(row.entityId);
        continue;
      }
      active = true;
      var remaining = row.expiresAt - now;
      var progress = 1 - remaining / Math.max(1, row.respawnMs);
      var animStyle = "conic";
      var wrap = document.getElementById("map-wrap");
      if (wrap) {
        animStyle = wrap.getAttribute("data-respawn-animation") || "conic";
      }
      if (!row.el) {
        row.el = document.createElement("div");
        row.el.className = "map-item-respawn";
        if (animStyle === "linear") row.el.classList.add("map-item-respawn--linear");
        var ring = document.createElement("div");
        ring.className = "map-item-respawn-ring";
        if (animStyle === "linear") {
          var fill = document.createElement("div");
          fill.className = "map-item-respawn-fill";
          ring.appendChild(fill);
          row.elFill = fill;
        }
        var count = document.createElement("span");
        count.className = "map-item-respawn-count";
        row.el.appendChild(ring);
        row.el.appendChild(count);
        row.elRing = ring;
        row.elCount = count;
        layer.appendChild(row.el);
      } else if (animStyle === "linear" && !row.elFill) {
        row.el.classList.add("map-item-respawn--linear");
        var fillNode = document.createElement("div");
        fillNode.className = "map-item-respawn-fill";
        row.elRing.appendChild(fillNode);
        row.elFill = fillNode;
      } else if (animStyle !== "linear") {
        row.el.classList.remove("map-item-respawn--linear");
        if (row.elFill && row.elFill.parentNode) row.elFill.parentNode.removeChild(row.elFill);
        row.elFill = null;
      }
      var pos = this.worldToDisplay(row.x, row.y);
      if (!pos) continue;
      row.el.style.left = pos.x + "px";
      row.el.style.top = pos.y + "px";
      var pct = Math.max(0, Math.min(100, progress * 100));
      if (animStyle === "linear" && row.elFill) {
        row.elFill.style.height = pct + "%";
      } else {
        var ringColor =
          getComputedStyle(wrap || document.documentElement)
            .getPropertyValue("--map-respawn-ring-color")
            .trim() || "#4ade80";
        var ringBg =
          getComputedStyle(wrap || document.documentElement)
            .getPropertyValue("--map-respawn-ring-bg")
            .trim() || "rgba(20, 24, 32, 0.82)";
        row.elRing.style.background =
          "conic-gradient(" +
          ringColor +
          " " +
          pct +
          "%, " +
          ringBg +
          " " +
          pct +
          "%)";
      }
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
        self._refreshAllCooldownMarkers();
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
    markCustom(this.settings);
    this.settings.itemCategories[category] = !!enabled;
    saveSettings(this.settings);
    this._markStaticLayerDirty();
    this.render();
    this.syncItemCategoryControls();
    this.syncPickupDisplayControls();
  };

  MapSpawns.prototype.setItemClassnameEnabled = function (classname, enabled) {
    if (!this.settings.itemCategories) {
      this.settings.itemCategories = Object.assign({}, DEFAULT_ITEM_CATEGORIES);
    }
    markCustom(this.settings);
    this.settings.itemCategories[classname] = !!enabled;
    saveSettings(this.settings);
    this._markStaticLayerDirty();
    this.render();
    this.syncItemCategoryControls();
    this.syncPickupDisplayControls();
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
    return fetchJsonAsset(this.spriteMapUrl())
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
    return fetchJsonAsset(this.displayUrl())
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
    markCustom(this.settings);
    if (!this.settings.layers[this.mapName]) {
      this.settings.layers[this.mapName] = {};
    }
    this.settings.layers[this.mapName][layerId] = !!enabled;
    saveSettings(this.settings);
    this._markStaticLayerDirty();
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
    var zoom = clampMapZoom(this.settings.mapZoomPercent) / 100;
    if (zoom > 0 && zoom !== 1) {
      localX /= zoom;
      localY /= zoom;
    }
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
    this._staticLayerEl = null;
    this._dynamicLayerEl = null;
    this._clearStaticMarkers();
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
      if (layer && layer.id === "items" && !ammoPackVisibleForGametype(ent, this.gametype)) {
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

  MapSpawns.prototype.isHeatmapTeleportJump = function (fromX, fromY, toX, toY) {
    return isHeatmapTeleportJumpInGraph(
      this.teleportGraph(),
      fromX,
      fromY,
      toX,
      toY,
    );
  };

  MapSpawns.prototype.renderTeleportLayer = function (layer) {
    var layerEl = this._dynamicLayerEl;
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
    var theme = mergeTheme(this.settings.theme);
    if (className.indexOf("is-active") >= 0 && theme.spawns.activeSpriteUrl) {
      dot.classList.add("map-spawn-has-sprite");
      dot.style.backgroundImage = 'url("' + theme.spawns.activeSpriteUrl + '")';
      dot.style.backgroundSize = "contain";
      dot.style.backgroundRepeat = "no-repeat";
      dot.style.backgroundPosition = "center";
    } else if (className.indexOf("is-inactive") >= 0 && theme.spawns.inactiveSpriteUrl) {
      dot.classList.add("map-spawn-has-sprite");
      dot.style.backgroundImage = 'url("' + theme.spawns.inactiveSpriteUrl + '")';
      dot.style.backgroundSize = "contain";
      dot.style.backgroundRepeat = "no-repeat";
      dot.style.backgroundPosition = "center";
    }
    parent.appendChild(dot);
  };

  MapSpawns.prototype.renderStaticLayer = function (layer, entities, styles) {
    var layerEl = this._staticLayerEl;
    if (!layerEl) return;
    var spriteMap = this.spriteMap;
    var seen = {};
    var renderKey = this._staticRenderKey();
    if (!this._staticLayerDirty && this._staticMarkersKey === renderKey) {
      for (var sk in this._staticMarkers) {
        if (!Object.prototype.hasOwnProperty.call(this._staticMarkers, sk)) continue;
        var srow = this._staticMarkers[sk];
        if (!srow.ent) continue;
        var spos = this.worldToDisplay(srow.ent.x, srow.ent.y);
        if (!spos || !srow.el) continue;
        srow.el.style.left = spos.x + "px";
        srow.el.style.top = spos.y + "px";
        var unavailable = this._entityUnavailableForDisplay(srow.ent.id);
        srow.el.classList.toggle("map-entity-respawn-cooldown", unavailable);
        srow.el.classList.toggle("map-entity-hidden", unavailable);
      }
      return;
    }
    this._clearStaticMarkers();
    this._staticMarkersKey = renderKey;
    this._staticLayerDirty = false;

    for (var i = 0; i < entities.length; i++) {
      var ent = entities[i];
      seen[ent.id] = true;
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
      if (this._entityUnavailableForDisplay(ent.id)) {
        className += " map-entity-respawn-cooldown map-entity-hidden";
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
      if (spriteRel) {
        applySpriteToMarker(dot, spriteRel);
      } else {
        var tag = document.createElement("span");
        tag.className = "map-entity-label";
        tag.textContent = label;
        dot.appendChild(tag);
      }
      layerEl.appendChild(dot);
      this._staticMarkers[ent.id] = { el: dot, ent: ent, spriteRel: spriteRel };
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
    var layerEl = this._dynamicLayerEl;
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

    this._ensureRenderLayers();
    if (this._dynamicLayerEl) this._dynamicLayerEl.innerHTML = "";

    if (!this.mapDisplay || !this.mapDisplay.layers || !this.mapDisplay.layers.length) {
      this._clearStaticMarkers();
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
          if (self.settings.layerTemplate && self.settings.activePreset !== "custom") {
            applyLayerTemplate(self.settings, key);
            saveSettings(self.settings);
          }
          self._markStaticLayerDirty();
          self.updatePanelMeta();
          self.rebuildLayerControls();
          self.render();
          return data;
        })
        .catch(function () {
          self.mapName = key;
          self.entityData = null;
          self._markStaticLayerDirty();
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
    this.syncHeatmapPlayerControls();
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
    this._appendItemCategoryToggle(host, "ammo", "Ammo");
    this._appendItemCategoryToggle(
      host,
      "ammo_pack",
      "Ammo packs (CA/FFA; hidden in duel/TDM)",
    );
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

  MapSpawns.prototype.switchSettingsTab = function (tabId) {
    if (SETTINGS_TABS.indexOf(tabId) < 0) tabId = "layers";
    this.settings.settingsTab = tabId;
    saveSettings(this.settings);
    this.syncSettingsTabs();
  };

  MapSpawns.prototype.syncSettingsTabs = function () {
    var panel = this.panel;
    if (!panel) return;
    var active = this.settings.settingsTab || "layers";
    var tabs = panel.querySelectorAll("[data-settings-tab]");
    for (var i = 0; i < tabs.length; i++) {
      var btn = tabs[i];
      var id = btn.getAttribute("data-settings-tab");
      var on = id === active;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    }
    var panels = panel.querySelectorAll("[data-settings-panel]");
    for (var j = 0; j < panels.length; j++) {
      var pane = panels[j];
      var paneId = pane.getAttribute("data-settings-panel");
      pane.classList.toggle("hidden", paneId !== active);
    }
  };

  MapSpawns.prototype.syncHudControls = function () {
    var killfeed = document.getElementById("spawn-show-killfeed");
    var toasts = document.getElementById("spawn-show-pickup-toasts");
    if (killfeed) killfeed.checked = this.settings.showKillfeed !== false;
    if (toasts) toasts.checked = this.settings.showPickupToasts !== false;
    if (window.OverlayApp && typeof OverlayApp.refreshHud === "function") {
      OverlayApp.refreshHud();
    }
  };

  MapSpawns.prototype.applyPreset = function (presetName) {
    if (presetName !== "minimal" && presetName !== "team") return;
    applyPresetToSettings(this.settings, presetName, this.mapName);
    saveSettings(this.settings);
    applyMapZoom(this.settings);
    applyThemeToDom(this.settings.theme);
    this._markStaticLayerDirty();
    this.render();
    this.syncLayerControls();
    this.syncItemCategoryControls();
    this.syncPickupDisplayControls();
    this.syncHudControls();
    this.syncPlayerControls();
    this.syncHeatmapControls();
    this.syncProfileControls();
    var enabled = document.getElementById("spawn-enabled");
    if (enabled) enabled.checked = this.settings.enabled;
    var inactive = document.getElementById("spawn-show-inactive");
    if (inactive) inactive.checked = this.settings.showInactive;
    var threshold = document.getElementById("spawn-show-threshold");
    if (threshold) threshold.checked = this.settings.showThreshold;
  };

  MapSpawns.prototype.saveNamedProfile = function (name) {
    var trimmed = String(name || "").trim();
    if (!trimmed) return false;
    var snapshot = settingsPayload(this.settings);
    delete snapshot.customProfiles;
    var profiles = normalizeCustomProfiles(this.settings.customProfiles);
    var id = "profile-" + Date.now();
    profiles.push({
      id: id,
      name: trimmed,
      savedAt: new Date().toISOString(),
      settings: snapshot,
    });
    this.settings.customProfiles = profiles;
    this.settings.activePreset = "custom";
    saveSettings(this.settings);
    this.syncProfileControls();
    return id;
  };

  MapSpawns.prototype.deleteNamedProfile = function (profileId) {
    var profiles = normalizeCustomProfiles(this.settings.customProfiles);
    this.settings.customProfiles = profiles.filter(function (row) {
      return row.id !== profileId;
    });
    saveSettings(this.settings);
    this.syncProfileControls();
  };

  MapSpawns.prototype.loadNamedProfile = function (profileId) {
    var profiles = normalizeCustomProfiles(this.settings.customProfiles);
    var found = null;
    for (var i = 0; i < profiles.length; i++) {
      if (profiles[i].id === profileId) {
        found = profiles[i];
        break;
      }
    }
    if (!found || !found.settings) return false;
    var merged = Object.assign({}, DEFAULTS, found.settings);
    merged.customProfiles = this.settings.customProfiles;
    merged.activePreset = "custom";
    merged.theme = mergeTheme(merged.theme);
    merged.heatmap = mergeHeatmap(merged.heatmap);
    Object.assign(this.settings, merged);
    saveSettings(this.settings);
    applyMapZoom(this.settings);
    applyThemeToDom(this.settings.theme);
    this._markStaticLayerDirty();
    this.render();
    this.syncLayerControls();
    this.syncItemCategoryControls();
    this.syncPickupDisplayControls();
    this.syncHudControls();
    this.syncPlayerControls();
    this.syncThemeControls();
    this.syncHeatmapControls();
    this.syncProfileControls();
    return true;
  };

  MapSpawns.prototype.exportSettingsFile = function () {
    var doc = buildExportDocument(this.settings);
    var blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = EXPORT_FILENAME;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  MapSpawns.prototype.importSettingsFile = function (file, callback) {
    var self = this;
    if (!file) {
      if (callback) callback({ ok: false, error: "No file selected" });
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var doc = JSON.parse(String(reader.result || ""));
        var result = importSettingsDocument(doc);
        if (!result.ok) {
          if (callback) callback(result);
          return;
        }
        self.settings = result.settings;
        applyMapZoom(self.settings);
        applyThemeToDom(self.settings.theme);
        self._markStaticLayerDirty();
        self.render();
        self.syncLayerControls();
        self.syncItemCategoryControls();
        self.syncPickupDisplayControls();
        self.syncHudControls();
        self.syncPlayerControls();
        self.syncThemeControls();
        self.syncHeatmapControls();
        self.syncProfileControls();
        self.syncChrome();
        var enabledEl = document.getElementById("spawn-enabled");
        if (enabledEl) enabledEl.checked = self.settings.enabled;
        if (callback) callback({ ok: true });
      } catch (err) {
        if (callback) callback({ ok: false, error: String(err.message || err) });
      }
    };
    reader.onerror = function () {
      if (callback) callback({ ok: false, error: "Could not read file" });
    };
    reader.readAsText(file);
  };

  MapSpawns.prototype.updateThemeField = function (section, field, value) {
    if (!this.settings.theme) this.settings.theme = mergeTheme(null);
    if (!this.settings.theme[section]) this.settings.theme[section] = {};
    this.settings.theme[section][field] = value;
    markCustom(this.settings);
    saveSettings(this.settings);
    applyThemeToDom(this.settings.theme);
    this.renderRespawnOverlays();
    if (
      section === "players" &&
      window.OverlayApp &&
      typeof OverlayApp.refreshHud === "function"
    ) {
      OverlayApp.refreshHud();
    }
  };

  MapSpawns.prototype.updateHeatmapField = function (field, value) {
    if (!this.settings.heatmap) this.settings.heatmap = mergeHeatmap(null);
    this.settings.heatmap[field] = value;
    markCustom(this.settings);
    saveSettings(this.settings);
    this.syncHeatmapControls();
    if (window.OverlayApp && typeof OverlayApp.refreshHud === "function") {
      OverlayApp.refreshHud();
    }
  };

  MapSpawns.prototype.setHeatmapPlayerHidden = function (playerId, hidden) {
    if (!playerId) return;
    if (!this.settings.heatmap) this.settings.heatmap = mergeHeatmap(null);
    if (!this.settings.heatmap.playerHidden) {
      this.settings.heatmap.playerHidden = {};
    }
    if (hidden) this.settings.heatmap.playerHidden[playerId] = true;
    else delete this.settings.heatmap.playerHidden[playerId];
    markCustom(this.settings);
    saveSettings(this.settings);
    this.syncHeatmapPlayerControls();
    if (window.OverlayApp && typeof OverlayApp.refreshHud === "function") {
      OverlayApp.refreshHud();
    }
  };

  MapSpawns.prototype.syncHeatmapPlayerControls = function () {
    var host = document.getElementById("spawn-heatmap-player-toggles");
    if (!host) return;
    var live = this.playersWithCoords();
    var hm = mergeHeatmap(this.settings.heatmap);
    var signature = live
      .map(function (row) {
        return playerMotionId(row.player, row.index);
      })
      .join("|");
    if (host.getAttribute("data-player-sig") !== signature) {
      host.setAttribute("data-player-sig", signature);
      host.innerHTML = "";
      if (!live.length) {
        host.textContent = "Players appear when match telemetry is live.";
        return;
      }
      var self = this;
      for (var i = 0; i < live.length; i++) {
        var row = live[i];
        var id = playerMotionId(row.player, row.index);
        var label = document.createElement("label");
        label.className = "dbg-toggle spawn-heatmap-player-row";
        var input = document.createElement("input");
        input.type = "checkbox";
        input.setAttribute("data-heatmap-player", id);
        input.checked = !hm.playerHidden[id];
        input.addEventListener("change", function () {
          var pid = this.getAttribute("data-heatmap-player");
          self.setHeatmapPlayerHidden(pid, !this.checked);
        });
        label.appendChild(input);
        label.appendChild(
          document.createTextNode(" " + playerDisplayName(row.player, row.index)),
        );
        host.appendChild(label);
      }
      return;
    }
    if (!live.length) return;
    var inputs = host.querySelectorAll("input[data-heatmap-player]");
    for (var j = 0; j < inputs.length; j++) {
      var inp = inputs[j];
      var pid = inp.getAttribute("data-heatmap-player");
      inp.checked = !hm.playerHidden[pid];
    }
  };

  MapSpawns.prototype.syncHeatmapControls = function () {
    var hm = mergeHeatmap(this.settings.heatmap);
    var enabled = document.getElementById("spawn-heatmap-enabled");
    var mode = document.getElementById("spawn-heatmap-mode");
    var duration = document.getElementById("spawn-heatmap-duration");
    var durationVal = document.getElementById("spawn-heatmap-duration-value");
    var opacity = document.getElementById("spawn-heatmap-opacity");
    var opacityVal = document.getElementById("spawn-heatmap-opacity-value");
    if (enabled) enabled.checked = hm.enabled === true;
    if (mode) mode.value = hm.mode === "aggregate" ? "aggregate" : "trail";
    if (duration) duration.value = String(hm.durationSec);
    if (durationVal) durationVal.textContent = hm.durationSec + "s";
    if (duration) {
      duration.disabled = hm.mode === "aggregate";
      if (duration.parentElement) {
        duration.parentElement.classList.toggle("is-disabled", hm.mode === "aggregate");
      }
    }
    if (opacity) opacity.value = String(Math.round(hm.opacity * 100));
    if (opacityVal) opacityVal.textContent = Math.round(hm.opacity * 100) + "%";
    this.syncHeatmapPlayerControls();
  };

  MapSpawns.prototype.setPickupDisplayMode = function (category, mode) {
    if (!this.settings.itemPickupDisplay) {
      this.settings.itemPickupDisplay = mergeItemPickupDisplay(null);
    }
    var m = normalizePickupDisplayMode(mode, false);
    if (!m) return;
    markCustom(this.settings);
    this.settings.itemPickupDisplay[category] = m;
    saveSettings(this.settings);
    this.syncPickupDisplayControls();
  };

  MapSpawns.prototype.setPickupDisplayClassnameMode = function (classname, mode) {
    if (!this.settings.itemPickupDisplay) {
      this.settings.itemPickupDisplay = mergeItemPickupDisplay(null);
    }
    var m = normalizePickupDisplayMode(mode, true);
    if (!m) return;
    markCustom(this.settings);
    if (m === ITEM_PICKUP_DISPLAY_INHERIT) {
      delete this.settings.itemPickupDisplay[classname];
    } else {
      this.settings.itemPickupDisplay[classname] = m;
    }
    saveSettings(this.settings);
    this.syncPickupDisplayControls();
  };

  MapSpawns.prototype._appendPickupDisplayCategoryRow = function (
    host,
    categoryKey,
    labelText,
  ) {
    var modes = mergeItemPickupDisplay(this.settings.itemPickupDisplay);
    var label = document.createElement("label");
    label.className = "dbg-field spawn-pickup-display-parent";
    var select = document.createElement("select");
    select.setAttribute("data-pickup-display-category", categoryKey);
    this._fillPickupDisplaySelect(select, modes[categoryKey] || "timer", false);
    var self = this;
    select.addEventListener("change", function () {
      var c = this.getAttribute("data-pickup-display-category");
      self.setPickupDisplayMode(c, this.value);
    });
    label.appendChild(document.createTextNode(labelText + " "));
    label.appendChild(select);
    host.appendChild(label);
  };

  MapSpawns.prototype._fillPickupDisplaySelect = function (
    select,
    value,
    allowInherit,
  ) {
    select.innerHTML = "";
    if (allowInherit) {
      var inheritOpt = document.createElement("option");
      inheritOpt.value = ITEM_PICKUP_DISPLAY_INHERIT;
      inheritOpt.textContent = "Use group default";
      select.appendChild(inheritOpt);
    }
    var opts = [
      ["timer", "Timer"],
      ["hide", "Hide until respawn"],
      ["always", "Always visible"],
    ];
    for (var j = 0; j < opts.length; j++) {
      var opt = document.createElement("option");
      opt.value = opts[j][0];
      opt.textContent = opts[j][1];
      select.appendChild(opt);
    }
    select.value = value || (allowInherit ? ITEM_PICKUP_DISPLAY_INHERIT : "timer");
  };

  MapSpawns.prototype._appendPickupDisplayClassnameGroup = function (
    host,
    categoryKey,
    categoryLabel,
    classnames,
  ) {
    var group = document.createElement("div");
    group.className = "spawn-pickup-display-group";

    var head = document.createElement("div");
    head.className = "spawn-pickup-display-group-head";
    this._appendPickupDisplayCategoryRow(head, categoryKey, categoryLabel);
    group.appendChild(head);

    if (classnames && classnames.length) {
      var details = document.createElement("details");
      details.className = "spawn-pickup-display-details";
      details.open = true;
      var summary = document.createElement("summary");
      summary.textContent = "Individual types";
      details.appendChild(summary);

      var children = document.createElement("div");
      children.className = "spawn-pickup-display-children";
      var self = this;
      for (var i = 0; i < classnames.length; i++) {
        var cn = classnames[i];
        var childLabel = document.createElement("label");
        childLabel.className = "dbg-field spawn-pickup-display-child";
        childLabel.setAttribute("data-pickup-display-classname-wrap", cn);
        var select = document.createElement("select");
        select.setAttribute("data-pickup-display-classname", cn);
        select.setAttribute("data-pickup-display-parent-category", categoryKey);
        self._fillPickupDisplaySelect(
          select,
          pickupDisplayOverrideForClassname(cn, self.settings),
          true,
        );
        select.addEventListener("change", function () {
          var classname = this.getAttribute("data-pickup-display-classname");
          self.setPickupDisplayClassnameMode(classname, this.value);
        });
        childLabel.appendChild(
          document.createTextNode(itemClassnameLabel(cn) + " "),
        );
        childLabel.appendChild(select);
        children.appendChild(childLabel);
      }
      details.appendChild(children);
      group.appendChild(details);
    }

    host.appendChild(group);
  };

  MapSpawns.prototype.rebuildPickupDisplayControls = function () {
    var host = document.getElementById("spawn-pickup-display-toggles");
    if (!host) return;
    host.innerHTML = "";
    this._appendPickupDisplayCategoryRow(host, "weapons", "Weapons");
    this._appendPickupDisplayCategoryRow(host, "ammo", "Ammo");
    this._appendPickupDisplayCategoryRow(
      host,
      "ammo_pack",
      "Ammo packs",
    );
    this._appendPickupDisplayClassnameGroup(
      host,
      "health",
      "Health (default)",
      HEALTH_CLASSNAMES,
    );
    this._appendPickupDisplayClassnameGroup(
      host,
      "armor",
      "Armor (default)",
      ARMOR_CLASSNAMES,
    );
    this._appendPickupDisplayCategoryRow(host, "powerups", "Powerups");
    this.syncPickupDisplayControls();
  };

  MapSpawns.prototype.syncPickupDisplayControls = function () {
    var host = document.getElementById("spawn-pickup-display-toggles");
    if (!host) return;
    var modes = mergeItemPickupDisplay(this.settings.itemPickupDisplay);
    var cats = this.settings.itemCategories || DEFAULT_ITEM_CATEGORIES;
    var categoryInputs = host.querySelectorAll("select[data-pickup-display-category]");
    for (var i = 0; i < categoryInputs.length; i++) {
      var input = categoryInputs[i];
      var cat = input.getAttribute("data-pickup-display-category");
      input.value = modes[cat] || "timer";
    }
    var classnameInputs = host.querySelectorAll("select[data-pickup-display-classname]");
    for (var j = 0; j < classnameInputs.length; j++) {
      var cInput = classnameInputs[j];
      var cn = cInput.getAttribute("data-pickup-display-classname");
      var parent = cInput.getAttribute("data-pickup-display-parent-category");
      var parentOff = parent && cats[parent] === false;
      var typeOff = cats[cn] === false;
      cInput.value = pickupDisplayOverrideForClassname(cn, this.settings);
      cInput.disabled = !!parentOff || !!typeOff;
      var wrap = cInput.closest("label");
      if (wrap) wrap.classList.toggle("is-disabled", cInput.disabled);
    }
  };

  MapSpawns.prototype.syncProfileControls = function () {
    var select = document.getElementById("spawn-profile-select");
    if (!select) return;
    var current = this.settings.activePreset || "custom";
    var profiles = normalizeCustomProfiles(this.settings.customProfiles);
    var prev = select.value;
    select.innerHTML = "";
    var builtIn = [
      { value: "minimal", label: "Minimal (mega/YA/RA)" },
      { value: "team", label: "Team (+ weapons)" },
      { value: "custom", label: "Custom" },
    ];
    for (var i = 0; i < builtIn.length; i++) {
      var opt = document.createElement("option");
      opt.value = builtIn[i].value;
      opt.textContent = builtIn[i].label;
      select.appendChild(opt);
    }
    if (profiles.length) {
      var sep = document.createElement("optgroup");
      sep.label = "Saved profiles";
      for (var j = 0; j < profiles.length; j++) {
        var pOpt = document.createElement("option");
        pOpt.value = "profile:" + profiles[j].id;
        pOpt.textContent = profiles[j].name;
        sep.appendChild(pOpt);
      }
      select.appendChild(sep);
    }
    if (prev && select.querySelector('option[value="' + prev + '"]')) {
      select.value = prev;
    } else if (current === "minimal" || current === "team") {
      select.value = current;
    } else {
      select.value = "custom";
    }
    var deleteBtn = document.getElementById("spawn-profile-delete");
    if (deleteBtn) {
      var isProfile = select.value.indexOf("profile:") === 0;
      deleteBtn.disabled = !isProfile;
    }
  };

  MapSpawns.prototype.syncThemeControls = function () {
    var theme = mergeTheme(this.settings.theme);
    var map = {
      "spawn-theme-spawn-active": theme.spawns.activeColor,
      "spawn-theme-spawn-inactive": theme.spawns.inactiveColor,
      "spawn-theme-spawn-active-sprite": theme.spawns.activeSpriteUrl,
      "spawn-theme-spawn-inactive-sprite": theme.spawns.inactiveSpriteUrl,
      "spawn-theme-spawn-css": theme.spawns.cssOverride,
      "spawn-theme-fov-fill": theme.players.fovFill,
      "spawn-theme-fov-stroke": theme.players.fovStroke,
      "spawn-theme-view-start": theme.players.viewColorStart,
      "spawn-theme-view-end": theme.players.viewColorEnd,
      "spawn-theme-view-head": theme.players.arrowHeadColor,
      "spawn-theme-view-sprite": theme.players.arrowSpriteUrl,
      "spawn-theme-player-self": theme.players.selfColor,
      "spawn-theme-player-opponent": theme.players.opponentColor,
      "spawn-theme-player-other": theme.players.otherColor,
      "spawn-theme-respawn-color": theme.respawn.ringColor,
      "spawn-theme-respawn-bg": theme.respawn.ringBg,
      "spawn-theme-respawn-count": theme.respawn.countColor,
    };
    for (var id in map) {
      if (!Object.prototype.hasOwnProperty.call(map, id)) continue;
      var el = document.getElementById(id);
      if (el) el.value = map[id] || "";
    }
    var fovOp = document.getElementById("spawn-theme-fov-opacity");
    if (fovOp) fovOp.value = String(Math.round(clampOpacity(theme.players.fovOpacity, 1) * 100));
    var viewOp = document.getElementById("spawn-theme-view-opacity");
    if (viewOp) viewOp.value = String(Math.round(clampOpacity(theme.players.viewOpacity, 1) * 100));
    var viewLen = document.getElementById("spawn-theme-view-length");
    if (viewLen) viewLen.value = String(clampViewLength(theme.players.viewLengthPx));
    var anim = document.getElementById("spawn-theme-respawn-animation");
    if (anim) anim.value = theme.respawn.animationStyle === "linear" ? "linear" : "conic";
  };

  MapSpawns.prototype.syncPlayerControls = function () {
    var fovWedge = document.getElementById("spawn-show-fov-wedge");
    var directionArrow = document.getElementById("spawn-show-direction-arrow");
    var markerStyle = document.getElementById("spawn-player-marker-style");
    var showStats = document.getElementById("spawn-show-player-stats");
    var markerMin = document.getElementById("spawn-marker-min");
    var markerMinVal = document.getElementById("spawn-marker-min-value");
    var markerMax = document.getElementById("spawn-marker-max");
    var markerMaxVal = document.getElementById("spawn-marker-max-value");
    var labelFont = document.getElementById("spawn-label-font");
    var labelFontVal = document.getElementById("spawn-label-font-value");
    var mapZoom = document.getElementById("spawn-map-zoom");
    var mapZoomValue = document.getElementById("spawn-map-zoom-value");
    if (fovWedge) fovWedge.checked = this.settings.showFovWedge !== false;
    if (directionArrow) directionArrow.checked = this.settings.showDirectionArrow !== false;
    if (markerStyle) {
      markerStyle.value = normalizePlayerMarkerStyle(this.settings.playerMarkerStyle);
    }
    if (showStats) showStats.checked = this.settings.showPlayerHealthArmor !== false;
    if (markerMin) markerMin.value = String(clampPlayerMarkerMinPx(this.settings.playerMarkerMinPx));
    if (markerMinVal) {
      markerMinVal.textContent = clampPlayerMarkerMinPx(this.settings.playerMarkerMinPx) + "px";
    }
    if (markerMax) {
      markerMax.value = String(
        clampPlayerMarkerMaxPx(this.settings.playerMarkerMaxPx, this.settings.playerMarkerMinPx),
      );
    }
    if (markerMaxVal) {
      markerMaxVal.textContent =
        clampPlayerMarkerMaxPx(this.settings.playerMarkerMaxPx, this.settings.playerMarkerMinPx) +
        "px";
    }
    if (labelFont) labelFont.value = String(clampPlayerLabelFontPx(this.settings.playerLabelFontPx));
    if (labelFontVal) {
      labelFontVal.textContent = clampPlayerLabelFontPx(this.settings.playerLabelFontPx) + "px";
    }
    if (mapZoom) mapZoom.value = String(clampMapZoom(this.settings.mapZoomPercent));
    if (mapZoomValue) {
      mapZoomValue.textContent = clampMapZoom(this.settings.mapZoomPercent) + "%";
    }
  };

  MapSpawns.prototype.buildPanel = function () {
    var panel = this.panel;
    if (!panel) return;
    panel.innerHTML =
      '<header class="map-spawns-head">' +
      "<h2>Settings</h2>" +
      '<button type="button" id="map-spawns-close" class="map-spawns-close" aria-label="Close settings">×</button>' +
      "</header>" +
      '<nav class="map-spawns-tabs" role="tablist" aria-label="Settings sections">' +
      '<button type="button" class="map-spawns-tab is-active" role="tab" data-settings-tab="layers" aria-selected="true">Layers</button>' +
      '<button type="button" class="map-spawns-tab" role="tab" data-settings-tab="players" aria-selected="false">Players</button>' +
      '<button type="button" class="map-spawns-tab" role="tab" data-settings-tab="items" aria-selected="false">Items</button>' +
      '<button type="button" class="map-spawns-tab" role="tab" data-settings-tab="hud" aria-selected="false">HUD</button>' +
      '<button type="button" class="map-spawns-tab" role="tab" data-settings-tab="profiles" aria-selected="false">Profiles</button>' +
      "</nav>" +
      '<div class="map-spawns-tab-panels">' +
      '<div class="map-spawns-tab-panel" data-settings-panel="layers">' +
      '<section class="map-spawns-section">' +
      '<label class="dbg-toggle"><input type="checkbox" id="spawn-enabled" /> Show overlay</label>' +
      '<div id="spawn-layer-toggles"></div>' +
      "</section>" +
      '<section class="map-spawns-section">' +
      "<h3>Map view</h3>" +
      '<label class="dbg-field">Map zoom <span id="spawn-map-zoom-value" class="map-spawns-zoom-value">100%</span>' +
      '<input type="range" id="spawn-map-zoom" min="' +
      MAP_ZOOM_MIN +
      '" max="' +
      MAP_ZOOM_MAX +
      '" step="5" value="100" /></label>' +
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
      "</div>" +
      '<div class="map-spawns-tab-panel hidden" data-settings-panel="players">' +
      '<section class="map-spawns-section">' +
      "<h3>Player markers</h3>" +
      '<label class="dbg-toggle"><input type="checkbox" id="spawn-show-fov-wedge" /> Show FOV wedge</label>' +
      '<label class="dbg-toggle"><input type="checkbox" id="spawn-show-direction-arrow" /> Show direction</label>' +
      '<label class="dbg-field">Direction style ' +
      '<select id="spawn-player-marker-style">' +
      '<option value="pin">Pin (circle + bump)</option>' +
      '<option value="arrow">Arrow line</option>' +
      "</select></label>" +
      '<label class="dbg-toggle"><input type="checkbox" id="spawn-show-player-stats" /> Show HP / armor above nickname</label>' +
      '<label class="dbg-field">Marker size (low height) <span id="spawn-marker-min-value" class="map-spawns-zoom-value">8px</span>' +
      '<input type="range" id="spawn-marker-min" min="' +
      PLAYER_MARKER_MIN_PX +
      '" max="20" step="1" value="8" /></label>' +
      '<label class="dbg-field">Marker size (high height) <span id="spawn-marker-max-value" class="map-spawns-zoom-value">14px</span>' +
      '<input type="range" id="spawn-marker-max" min="6" max="' +
      PLAYER_MARKER_MAX_PX +
      '" step="1" value="14" /></label>' +
      '<label class="dbg-field">Nickname font <span id="spawn-label-font-value" class="map-spawns-zoom-value">11px</span>' +
      '<input type="range" id="spawn-label-font" min="' +
      PLAYER_LABEL_FONT_MIN +
      '" max="' +
      PLAYER_LABEL_FONT_MAX +
      '" step="1" value="11" /></label>' +
      "</section>" +
      '<section class="map-spawns-section">' +
      "<h3>Heatmap</h3>" +
      '<label class="dbg-field">Mode ' +
      '<select id="spawn-heatmap-mode">' +
      '<option value="trail">Trail (smooth path)</option>' +
      '<option value="aggregate">Aggregate (full match density)</option>' +
      "</select></label>" +
      '<label class="dbg-toggle"><input type="checkbox" id="spawn-heatmap-enabled" /> Show heatmap</label>' +
      '<label class="dbg-field">Trail duration <span id="spawn-heatmap-duration-value" class="map-spawns-zoom-value">30s</span>' +
      '<input type="range" id="spawn-heatmap-duration" min="' +
      HEATMAP_DURATION_MIN +
      '" max="' +
      HEATMAP_DURATION_MAX +
      '" step="5" value="30" /></label>' +
      '<label class="dbg-field">Trail opacity <span id="spawn-heatmap-opacity-value" class="map-spawns-zoom-value">45%</span>' +
      '<input type="range" id="spawn-heatmap-opacity" min="5" max="100" step="5" value="45" /></label>' +
      '<p class="map-spawns-hint">Trails are recorded while the match runs. Uncheck a player to hide their trail. Colors follow player marker colors.</p>' +
      "<h4 class=\"spawn-heatmap-players-head\">Players</h4>" +
      '<div id="spawn-heatmap-player-toggles" class="spawn-heatmap-player-toggles"></div>' +
      "</section>" +
      "</div>" +
      '<div class="map-spawns-tab-panel hidden" data-settings-panel="items">' +
      '<section class="map-spawns-section">' +
      "<h3>Item categories</h3>" +
      '<p class="map-spawns-hint">When the items layer is on — toggle categories; expand Health, Armor, or Powerups for per-type filters. Shards off by default (25 s respawn).</p>' +
      '<div id="spawn-item-category-toggles"></div>' +
      "</section>" +
      '<section class="map-spawns-section">' +
      "<h3>After pickup</h3>" +
      '<p class="map-spawns-hint">Timer = dim + countdown ring. Hide = sprite gone until respawn (no ring). Always = never hide on pickup.</p>' +
      '<div id="spawn-pickup-display-toggles"></div>' +
      "</section>" +
      "</div>" +
      '<div class="map-spawns-tab-panel hidden" data-settings-panel="hud">' +
      '<section class="map-spawns-section">' +
      "<h3>Chrome</h3>" +
      '<label class="dbg-toggle"><input type="checkbox" id="spawn-show-killfeed" /> Show killfeed</label>' +
      '<label class="dbg-toggle"><input type="checkbox" id="spawn-show-pickup-toasts" /> Show pickup toasts on map</label>' +
      '<p class="map-spawns-hint">Pickup history (Pickups button) is always available. Toasts are the short-lived labels on the map stage.</p>' +
      "</section>" +
      "</div>" +
      '<div class="map-spawns-tab-panel hidden" data-settings-panel="profiles">' +
      '<section class="map-spawns-section">' +
      "<h3>Presets &amp; profiles</h3>" +
      '<p class="map-spawns-hint">Minimal: direction arrow + mega/YA/RA timers only. Team: minimal + weapon timers. Tweaking any setting switches to Custom.</p>' +
      '<label class="dbg-field">Profile ' +
      '<select id="spawn-profile-select"></select></label>' +
      '<div class="map-spawns-profile-actions">' +
      '<button type="button" class="overlay-btn" id="spawn-profile-save">Save current…</button>' +
      '<button type="button" class="overlay-btn" id="spawn-profile-delete" disabled>Delete saved</button>' +
      "</div>" +
      '<div class="map-spawns-profile-actions">' +
      '<button type="button" class="overlay-btn" id="spawn-settings-export">Export JSON</button>' +
      '<label class="overlay-btn map-spawns-import-label">Import JSON<input type="file" id="spawn-settings-import" accept="application/json,.json" hidden /></label>' +
      "</div>" +
      '<p id="spawn-import-status" class="map-spawns-hint" aria-live="polite"></p>' +
      "</section>" +
      '<section class="map-spawns-section">' +
      "<h3>Theme — spawns</h3>" +
      '<label class="dbg-field">Active color <input type="color" id="spawn-theme-spawn-active" /></label>' +
      '<label class="dbg-field">Inactive color <input type="color" id="spawn-theme-spawn-inactive" /></label>' +
      '<label class="dbg-field">Active sprite URL <input type="url" id="spawn-theme-spawn-active-sprite" placeholder="https://…/active.png" /></label>' +
      '<label class="dbg-field">Inactive sprite URL <input type="url" id="spawn-theme-spawn-inactive-sprite" placeholder="https://…/inactive.png" /></label>' +
      '<label class="dbg-field">CSS override <input type="text" id="spawn-theme-spawn-css" placeholder="border-radius: 0; opacity: 0.9" /></label>' +
      "</section>" +
      '<section class="map-spawns-section">' +
      "<h3>Theme — players</h3>" +
      '<label class="dbg-field">FOV fill <input type="text" id="spawn-theme-fov-fill" placeholder="rgba(255,255,255,0.1)" /></label>' +
      '<label class="dbg-field">FOV stroke <input type="text" id="spawn-theme-fov-stroke" placeholder="rgba(255,255,255,0.28)" /></label>' +
      '<label class="dbg-field">FOV opacity <span id="spawn-theme-fov-opacity-value">100%</span>' +
      '<input type="range" id="spawn-theme-fov-opacity" min="0" max="100" step="5" value="100" /></label>' +
      '<label class="dbg-field">Arrow gradient start <input type="text" id="spawn-theme-view-start" /></label>' +
      '<label class="dbg-field">Arrow gradient end <input type="text" id="spawn-theme-view-end" /></label>' +
      '<label class="dbg-field">Arrow head color <input type="color" id="spawn-theme-view-head" /></label>' +
      '<label class="dbg-field">Arrow opacity <span id="spawn-theme-view-opacity-value">100%</span>' +
      '<input type="range" id="spawn-theme-view-opacity" min="0" max="100" step="5" value="100" /></label>' +
      '<label class="dbg-field">Arrow length (px) <input type="number" id="spawn-theme-view-length" min="36" max="140" step="4" /></label>' +
      '<label class="dbg-field">Arrow sprite URL <input type="url" id="spawn-theme-view-sprite" placeholder="https://…/arrow.svg" /></label>' +
      '<label class="dbg-field">Self color (duel) <input type="color" id="spawn-theme-player-self" /></label>' +
      '<label class="dbg-field">Opponent color (duel) <input type="color" id="spawn-theme-player-opponent" /></label>' +
      '<label class="dbg-field">Other players color <input type="color" id="spawn-theme-player-other" /></label>' +
      '<p class="map-spawns-hint">Sprite URLs must be reachable from OBS Browser Source (CDN or same host as overlay). Duel / 2-player matches use self vs opponent colors on dots and arrows.</p>' +
      "</section>" +
      '<section class="map-spawns-section">' +
      "<h3>Theme — respawn timer</h3>" +
      '<label class="dbg-field">Ring fill <input type="color" id="spawn-theme-respawn-color" /></label>' +
      '<label class="dbg-field">Ring background <input type="text" id="spawn-theme-respawn-bg" /></label>' +
      '<label class="dbg-field">Countdown text <input type="color" id="spawn-theme-respawn-count" /></label>' +
      '<label class="dbg-field">Animation ' +
      '<select id="spawn-theme-respawn-animation">' +
      '<option value="conic">Conic fill (radial ring)</option>' +
      '<option value="linear">Linear bar (bottom-up)</option>' +
      "</select></label>" +
      "</section>" +
      "</div>" +
      "</div>";

    var self = this;
    var tabButtons = panel.querySelectorAll("[data-settings-tab]");
    for (var ti = 0; ti < tabButtons.length; ti++) {
      tabButtons[ti].addEventListener("click", function () {
        self.switchSettingsTab(this.getAttribute("data-settings-tab"));
      });
    }

    var fovWedge = document.getElementById("spawn-show-fov-wedge");
    var directionArrow = document.getElementById("spawn-show-direction-arrow");
    var mapZoom = document.getElementById("spawn-map-zoom");
    var mapZoomValue = document.getElementById("spawn-map-zoom-value");
    var enabled = document.getElementById("spawn-enabled");
    var inactive = document.getElementById("spawn-show-inactive");
    var threshold = document.getElementById("spawn-show-threshold");
    var middle = document.getElementById("spawn-middle-val");
    var playerSelect = document.getElementById("spawn-reference-player");
    var killfeedToggle = document.getElementById("spawn-show-killfeed");
    var pickupToastsToggle = document.getElementById("spawn-show-pickup-toasts");
    var anchors = panel.querySelectorAll('input[name="spawn-anchor"]');

    function syncMapZoomLabel() {
      if (mapZoomValue) {
        mapZoomValue.textContent = clampMapZoom(self.settings.mapZoomPercent) + "%";
      }
    }

    if (directionArrow) {
      directionArrow.checked = this.settings.showDirectionArrow !== false;
      directionArrow.addEventListener("change", function () {
        markCustom(self.settings);
        self.settings.showDirectionArrow = directionArrow.checked;
        saveSettings(self.settings);
        refreshPlayerMarkers();
      });
    }
    var markerStyleSelect = document.getElementById("spawn-player-marker-style");
    if (markerStyleSelect) {
      markerStyleSelect.value = normalizePlayerMarkerStyle(self.settings.playerMarkerStyle);
      markerStyleSelect.addEventListener("change", function () {
        markCustom(self.settings);
        self.settings.playerMarkerStyle = normalizePlayerMarkerStyle(markerStyleSelect.value);
        saveSettings(self.settings);
        refreshPlayerMarkers();
      });
    }
    var showPlayerStats = document.getElementById("spawn-show-player-stats");
    var markerMin = document.getElementById("spawn-marker-min");
    var markerMinVal = document.getElementById("spawn-marker-min-value");
    var markerMax = document.getElementById("spawn-marker-max");
    var markerMaxVal = document.getElementById("spawn-marker-max-value");
    var labelFont = document.getElementById("spawn-label-font");
    var labelFontVal = document.getElementById("spawn-label-font-value");

    function syncMarkerSizeLabels() {
      var minPx = clampPlayerMarkerMinPx(self.settings.playerMarkerMinPx);
      var maxPx = clampPlayerMarkerMaxPx(self.settings.playerMarkerMaxPx, minPx);
      self.settings.playerMarkerMinPx = minPx;
      self.settings.playerMarkerMaxPx = maxPx;
      if (markerMin) markerMin.value = String(minPx);
      if (markerMinVal) markerMinVal.textContent = minPx + "px";
      if (markerMax) {
        markerMax.min = String(minPx);
        markerMax.value = String(maxPx);
      }
      if (markerMaxVal) markerMaxVal.textContent = maxPx + "px";
      if (labelFontVal) {
        labelFontVal.textContent =
          clampPlayerLabelFontPx(self.settings.playerLabelFontPx) + "px";
      }
    }

    function refreshPlayerMarkers() {
      if (window.OverlayApp && typeof OverlayApp.refreshHud === "function") {
        OverlayApp.refreshHud();
      }
    }

    if (showPlayerStats) {
      showPlayerStats.checked = self.settings.showPlayerHealthArmor !== false;
      showPlayerStats.addEventListener("change", function () {
        markCustom(self.settings);
        self.settings.showPlayerHealthArmor = showPlayerStats.checked;
        saveSettings(self.settings);
        refreshPlayerMarkers();
      });
    }
    if (markerMin) {
      syncMarkerSizeLabels();
      markerMin.addEventListener("input", function () {
        markCustom(self.settings);
        self.settings.playerMarkerMinPx = clampPlayerMarkerMinPx(markerMin.value);
        self.settings.playerMarkerMaxPx = clampPlayerMarkerMaxPx(
          self.settings.playerMarkerMaxPx,
          self.settings.playerMarkerMinPx,
        );
        syncMarkerSizeLabels();
        refreshPlayerMarkers();
      });
      markerMin.addEventListener("change", function () {
        saveSettings(self.settings);
      });
    }
    if (markerMax) {
      markerMax.addEventListener("input", function () {
        markCustom(self.settings);
        self.settings.playerMarkerMaxPx = clampPlayerMarkerMaxPx(
          markerMax.value,
          self.settings.playerMarkerMinPx,
        );
        syncMarkerSizeLabels();
        refreshPlayerMarkers();
      });
      markerMax.addEventListener("change", function () {
        saveSettings(self.settings);
      });
    }
    if (labelFont) {
      labelFont.value = String(clampPlayerLabelFontPx(self.settings.playerLabelFontPx));
      labelFont.addEventListener("input", function () {
        markCustom(self.settings);
        self.settings.playerLabelFontPx = clampPlayerLabelFontPx(labelFont.value);
        if (labelFontVal) {
          labelFontVal.textContent = self.settings.playerLabelFontPx + "px";
        }
        refreshPlayerMarkers();
      });
      labelFont.addEventListener("change", function () {
        saveSettings(self.settings);
      });
    }
    if (fovWedge) {
      fovWedge.checked = this.settings.showFovWedge !== false;
      fovWedge.addEventListener("change", function () {
        markCustom(self.settings);
        self.settings.showFovWedge = fovWedge.checked;
        saveSettings(self.settings);
        refreshPlayerMarkers();
      });
    }
    if (mapZoom) {
      mapZoom.value = String(clampMapZoom(this.settings.mapZoomPercent));
      syncMapZoomLabel();
      mapZoom.addEventListener("input", function () {
        markCustom(self.settings);
        self.settings.mapZoomPercent = clampMapZoom(mapZoom.value);
        applyMapZoom(self.settings);
        syncMapZoomLabel();
      });
      mapZoom.addEventListener("change", function () {
        saveSettings(self.settings);
      });
    }
    applyMapZoom(this.settings);

    var heatmapEnabled = document.getElementById("spawn-heatmap-enabled");
    var heatmapDuration = document.getElementById("spawn-heatmap-duration");
    var heatmapDurationVal = document.getElementById("spawn-heatmap-duration-value");
    var heatmapOpacity = document.getElementById("spawn-heatmap-opacity");
    var heatmapOpacityVal = document.getElementById("spawn-heatmap-opacity-value");
    if (heatmapEnabled) {
      heatmapEnabled.checked = mergeHeatmap(self.settings.heatmap).enabled === true;
      heatmapEnabled.addEventListener("change", function () {
        markCustom(self.settings);
        self.updateHeatmapField("enabled", heatmapEnabled.checked);
      });
    }
    if (heatmapDuration) {
      heatmapDuration.addEventListener("input", function () {
        markCustom(self.settings);
        var sec = clampHeatmapDuration(heatmapDuration.value);
        if (heatmapDurationVal) heatmapDurationVal.textContent = sec + "s";
        self.updateHeatmapField("durationSec", sec);
      });
    }
    if (heatmapOpacity) {
      heatmapOpacity.addEventListener("input", function () {
        markCustom(self.settings);
        var op = clampHeatmapOpacity(Number(heatmapOpacity.value) / 100);
        if (heatmapOpacityVal) heatmapOpacityVal.textContent = Math.round(op * 100) + "%";
        self.updateHeatmapField("opacity", op);
      });
    }
    var heatmapMode = document.getElementById("spawn-heatmap-mode");
    if (heatmapMode) {
      heatmapMode.value =
        mergeHeatmap(self.settings.heatmap).mode === "aggregate" ? "aggregate" : "trail";
      heatmapMode.addEventListener("change", function () {
        markCustom(self.settings);
        self.updateHeatmapField("mode", heatmapMode.value);
        self.syncHeatmapControls();
        if (window.OverlayApp && typeof OverlayApp.clearHeatmap === "function") {
          OverlayApp.clearHeatmap();
        }
      });
    }
    this.syncHeatmapPlayerControls();

    if (enabled) {
      enabled.checked = this.settings.enabled;
      enabled.addEventListener("change", function () {
        markCustom(self.settings);
        self.setEnabled(enabled.checked);
      });
    }
    if (inactive) {
      inactive.checked = this.settings.showInactive;
      inactive.addEventListener("change", function () {
        markCustom(self.settings);
        self.settings.showInactive = inactive.checked;
        saveSettings(self.settings);
        self.render();
      });
    }
    if (threshold) {
      threshold.checked = this.settings.showThreshold;
      threshold.addEventListener("change", function () {
        markCustom(self.settings);
        self.settings.showThreshold = threshold.checked;
        saveSettings(self.settings);
        self.render();
      });
    }
    if (middle) {
      middle.addEventListener("change", function () {
        markCustom(self.settings);
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
        markCustom(self.settings);
        self.settings.anchor = el.value;
        saveSettings(self.settings);
        self.syncAnchorControls();
        self.render();
      });
    });
    if (playerSelect) {
      playerSelect.addEventListener("change", function () {
        markCustom(self.settings);
        self.settings.referencePlayerId = playerSelect.value || null;
        saveSettings(self.settings);
        self.render();
      });
    }
    if (killfeedToggle) {
      killfeedToggle.checked = this.settings.showKillfeed !== false;
      killfeedToggle.addEventListener("change", function () {
        markCustom(self.settings);
        self.settings.showKillfeed = killfeedToggle.checked;
        saveSettings(self.settings);
        self.syncHudControls();
      });
    }
    if (pickupToastsToggle) {
      pickupToastsToggle.checked = this.settings.showPickupToasts !== false;
      pickupToastsToggle.addEventListener("change", function () {
        markCustom(self.settings);
        self.settings.showPickupToasts = pickupToastsToggle.checked;
        saveSettings(self.settings);
        self.syncHudControls();
      });
    }

    var profileSelect = document.getElementById("spawn-profile-select");
    if (profileSelect) {
      profileSelect.addEventListener("change", function () {
        var val = profileSelect.value;
        if (profileDelete) {
          profileDelete.disabled = val.indexOf("profile:") !== 0;
        }
        if (val === "minimal" || val === "team") {
          self.applyPreset(val);
          return;
        }
        if (val.indexOf("profile:") === 0) {
          self.loadNamedProfile(val.slice(8));
          return;
        }
        self.settings.activePreset = "custom";
        saveSettings(self.settings);
        self.syncProfileControls();
      });
    }
    var profileSave = document.getElementById("spawn-profile-save");
    if (profileSave) {
      profileSave.addEventListener("click", function () {
        var name = window.prompt("Profile name:");
        if (!name) return;
        self.saveNamedProfile(name);
      });
    }
    var profileDelete = document.getElementById("spawn-profile-delete");
    if (profileDelete) {
      profileDelete.addEventListener("click", function () {
        var val = profileSelect && profileSelect.value;
        if (!val || val.indexOf("profile:") !== 0) return;
        if (!window.confirm("Delete saved profile?")) return;
        self.deleteNamedProfile(val.slice(8));
      });
    }
    var exportBtn = document.getElementById("spawn-settings-export");
    if (exportBtn) {
      exportBtn.addEventListener("click", function () {
        self.exportSettingsFile();
      });
    }
    var importInput = document.getElementById("spawn-settings-import");
    var importStatus = document.getElementById("spawn-import-status");
    if (importInput) {
      importInput.addEventListener("change", function () {
        var file = importInput.files && importInput.files[0];
        importInput.value = "";
        if (!file) return;
        self.importSettingsFile(file, function (result) {
          if (importStatus) {
            importStatus.textContent = result.ok
              ? "Import OK — settings applied."
              : "Import failed: " + (result.error || "unknown error");
          }
        });
      });
    }

    function bindThemeInput(id, section, field, transform) {
      var node = document.getElementById(id);
      if (!node) return;
      var handler = function () {
        var val = transform ? transform(node.value) : node.value;
        self.updateThemeField(section, field, val);
      };
      node.addEventListener("change", handler);
      if (node.type === "range") node.addEventListener("input", handler);
    }
    bindThemeInput("spawn-theme-spawn-active", "spawns", "activeColor");
    bindThemeInput("spawn-theme-spawn-inactive", "spawns", "inactiveColor");
    bindThemeInput("spawn-theme-spawn-active-sprite", "spawns", "activeSpriteUrl");
    bindThemeInput("spawn-theme-spawn-inactive-sprite", "spawns", "inactiveSpriteUrl");
    bindThemeInput("spawn-theme-spawn-css", "spawns", "cssOverride");
    bindThemeInput("spawn-theme-fov-fill", "players", "fovFill");
    bindThemeInput("spawn-theme-fov-stroke", "players", "fovStroke");
    bindThemeInput("spawn-theme-view-start", "players", "viewColorStart");
    bindThemeInput("spawn-theme-view-end", "players", "viewColorEnd");
    bindThemeInput("spawn-theme-view-head", "players", "arrowHeadColor");
    bindThemeInput("spawn-theme-view-sprite", "players", "arrowSpriteUrl");
    bindThemeInput("spawn-theme-player-self", "players", "selfColor");
    bindThemeInput("spawn-theme-player-opponent", "players", "opponentColor");
    bindThemeInput("spawn-theme-player-other", "players", "otherColor");
    bindThemeInput("spawn-theme-respawn-color", "respawn", "ringColor");
    bindThemeInput("spawn-theme-respawn-bg", "respawn", "ringBg");
    bindThemeInput("spawn-theme-respawn-count", "respawn", "countColor");
    var fovOpacity = document.getElementById("spawn-theme-fov-opacity");
    var fovOpacityVal = document.getElementById("spawn-theme-fov-opacity-value");
    if (fovOpacity) {
      fovOpacity.addEventListener("input", function () {
        if (fovOpacityVal) fovOpacityVal.textContent = fovOpacity.value + "%";
        self.updateThemeField("players", "fovOpacity", Number(fovOpacity.value) / 100);
      });
    }
    var viewOpacity = document.getElementById("spawn-theme-view-opacity");
    var viewOpacityVal = document.getElementById("spawn-theme-view-opacity-value");
    if (viewOpacity) {
      viewOpacity.addEventListener("input", function () {
        if (viewOpacityVal) viewOpacityVal.textContent = viewOpacity.value + "%";
        self.updateThemeField("players", "viewOpacity", Number(viewOpacity.value) / 100);
      });
    }
    var viewLength = document.getElementById("spawn-theme-view-length");
    if (viewLength) {
      viewLength.addEventListener("change", function () {
        self.updateThemeField("players", "viewLengthPx", clampViewLength(viewLength.value));
      });
    }
    var respawnAnim = document.getElementById("spawn-theme-respawn-animation");
    if (respawnAnim) {
      respawnAnim.addEventListener("change", function () {
        self.updateThemeField(
          "respawn",
          "animationStyle",
          respawnAnim.value === "linear" ? "linear" : "conic",
        );
      });
    }

    this.syncPlayerPicker();
    this.syncAnchorControls();
    this.rebuildLayerControls();
    this.rebuildItemCategoryControls();
    this.rebuildPickupDisplayControls();
    this.syncSettingsTabs();
    this.syncHudControls();
    this.syncProfileControls();
    this.syncThemeControls();
    this.syncHeatmapControls();
    this.updatePanelMeta();
    applyThemeToDom(this.settings.theme);

    var closeBtn = document.getElementById("map-spawns-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        self.togglePanel(false);
      });
    }
  };

  MapSpawns.prototype.syncChrome = function () {
    var panel = this.panel;
    var btn = this.toggleBtn;
    if (panel) {
      panel.classList.toggle("hidden", !this.settings.panelOpen);
    }
    if (btn) {
      btn.classList.remove("hidden");
      btn.setAttribute(
        "aria-pressed",
        this.settings.panelOpen ? "true" : "false",
      );
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

    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape" && ev.key !== "Esc") return;
      if (!self.settings.panelOpen) return;
      ev.preventDefault();
      self.togglePanel(false);
    });

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
    getSettings: function () {
      return instance.settings;
    },
    getPlayerDisplay: function () {
      var s = instance.settings;
      var theme = mergeTheme(s.theme);
      return {
        showFovWedge: s.showFovWedge !== false,
        showDirectionArrow: s.showDirectionArrow !== false,
        playerMarkerStyle: normalizePlayerMarkerStyle(s.playerMarkerStyle),
        showPlayerHealthArmor: s.showPlayerHealthArmor !== false,
        playerMarkerMinPx: clampPlayerMarkerMinPx(s.playerMarkerMinPx),
        playerMarkerMaxPx: clampPlayerMarkerMaxPx(
          s.playerMarkerMaxPx,
          s.playerMarkerMinPx,
        ),
        playerLabelFontPx: clampPlayerLabelFontPx(s.playerLabelFontPx),
        mapZoomPercent: clampMapZoom(s.mapZoomPercent),
        viewLengthPx: clampViewLength(theme.players.viewLengthPx),
        fovOpacity: clampOpacity(theme.players.fovOpacity, 1),
        viewOpacity: clampOpacity(theme.players.viewOpacity, 1),
      };
    },
    getHudSettings: function () {
      var s = instance.settings;
      return {
        showKillfeed: s.showKillfeed !== false,
        showPickupToasts: s.showPickupToasts !== false,
      };
    },
    getHeatmapSettings: function () {
      var s = instance.settings;
      var hm = mergeHeatmap(s.heatmap);
      var theme = mergeTheme(s.theme);
      return {
        enabled: hm.enabled === true,
        mode: hm.mode,
        durationSec: hm.durationSec,
        opacity: hm.opacity,
        showSelf: hm.showSelf !== false,
        showOpponent: hm.showOpponent !== false,
        showOther: hm.showOther !== false,
        playerHidden: Object.assign({}, hm.playerHidden || {}),
        selfColor: theme.players.selfColor,
        opponentColor: theme.players.opponentColor,
        otherColor: theme.players.otherColor,
      };
    },
    heatmapPlayerVisible: function (playerId, players, gametype) {
      var hm = mergeHeatmap(instance.settings.heatmap);
      if (hm.playerHidden && hm.playerHidden[playerId]) return false;
      return true;
    },
    resetMatchState: function () {
      instance._clearItemRespawns();
    },
    refreshItemRespawnOverlays: function () {
      instance._pruneExpiredItemStates();
      instance.renderRespawnOverlays();
      instance._refreshAllEntityVisibility();
      instance._ensureRespawnLoop();
      instance._ensureHiddenExpireLoop();
    },
    getPlayerColors: function () {
      var theme = mergeTheme(instance.settings.theme);
      return {
        selfColor: theme.players.selfColor,
        opponentColor: theme.players.opponentColor,
        otherColor: theme.players.otherColor,
      };
    },
    resolveReferencePlayerId: function (players) {
      if (players) instance.players = players;
      return instance.resolveReferencePlayerId();
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
    _test: {
      respawnSecForClassname: respawnSecForClassname,
      normalizeGametype: normalizeGametype,
      weaponRespawnSecForGametype: weaponRespawnSecForGametype,
      ammoRespawnSecForGametype: ammoRespawnSecForGametype,
      itemSupportsRespawn: itemSupportsRespawn,
      entityItemCategory: entityItemCategory,
      megaRespawnSecForMap: megaRespawnSecForMap,
      SETTINGS_VERSION: SETTINGS_VERSION,
      WEAPON_RESPAWN_SEC_DEFAULT: WEAPON_RESPAWN_SEC_DEFAULT,
      AMMO_RESPAWN_SEC_DEFAULT: AMMO_RESPAWN_SEC_DEFAULT,
      mergeTheme: mergeTheme,
      settingsPayload: settingsPayload,
      buildExportDocument: buildExportDocument,
      validateImportDocument: validateImportDocument,
      applyPresetToSettings: applyPresetToSettings,
      mergeHeatmap: mergeHeatmap,
      mergeItemPickupDisplay: mergeItemPickupDisplay,
      ammoPackVisibleForGametype: ammoPackVisibleForGametype,
      entityMatchesGametype: entityMatchesGametype,
      gametypeListMatches: gametypeListMatches,
      clampHeatmapDuration: clampHeatmapDuration,
      PRESET_MINIMAL: PRESET_MINIMAL,
      PRESET_TEAM: PRESET_TEAM,
      DEFAULT_THEME: DEFAULT_THEME,
      buildTeleportGraph: buildTeleportGraph,
      isHeatmapTeleportJumpInGraph: isHeatmapTeleportJumpInGraph,
      HEATMAP_JUMP_FALLBACK_SQ: HEATMAP_JUMP_FALLBACK_SQ,
      pickupDisplayForClassname: pickupDisplayForClassname,
      exportItemPickupDisplay: exportItemPickupDisplay,
      normalizePickupDisplayMode: normalizePickupDisplayMode,
      migrateRespawnTimersIntoPickupDisplay: migrateRespawnTimersIntoPickupDisplay,
      pickupEventTimeMs: pickupEventTimeMs,
      pickupCoordsValid: pickupCoordsValid,
      formatRespawnCountdown: formatRespawnCountdown,
      clampPlayerMarkerMinPx: clampPlayerMarkerMinPx,
      clampPlayerMarkerMaxPx: clampPlayerMarkerMaxPx,
      clampPlayerLabelFontPx: clampPlayerLabelFontPx,
      normalizePlayerMarkerSettings: normalizePlayerMarkerSettings,
    },
  };
})(window);
