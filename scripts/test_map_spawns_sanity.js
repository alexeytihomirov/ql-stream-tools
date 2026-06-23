#!/usr/bin/env node
"use strict";

/**
 * Sanity checks for map-spawns (Phase 2 respawn + Phase 3 presets/theme/export).
 * Run: node scripts/test_map_spawns_sanity.js
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const srcPath = path.join(__dirname, "../live-overlay/map-spawns.js");
const src = fs.readFileSync(srcPath, "utf8");
const window = {
  location: { search: "" },
};
const context = { window, console, URLSearchParams };
vm.createContext(context);
vm.runInContext(src, context);

const t = window.MapSpawns && window.MapSpawns._test;
if (!t) {
  console.error("FAIL: MapSpawns._test export missing");
  process.exit(1);
}

let failed = 0;
let checks = 0;

function assert(cond, msg) {
  checks += 1;
  if (!cond) {
    console.error("FAIL:", msg);
    failed += 1;
  }
}

assert(t.SETTINGS_VERSION === 13, "SETTINGS_VERSION should be 13");
assert(t.WEAPON_RESPAWN_SEC_DEFAULT === 5, "weapon default 5s");
assert(t.AMMO_RESPAWN_SEC_DEFAULT === 40, "ammo default 40s");
assert(t.weaponRespawnSecForGametype("duel") === 5, "duel weapons 5s");
assert(t.weaponRespawnSecForGametype("tdm") === 30, "TDM weapons 30s");
assert(t.weaponRespawnSecForGametype("team_deathmatch") === 30, "TDM alias");
assert(t.ammoRespawnSecForGametype("duel") === 40, "ammo 40s duel");
assert(t.itemSupportsRespawn("weapon_railgun"), "weapon supports respawn");
assert(t.itemSupportsRespawn("ammo_cells"), "ammo supports respawn");
assert(t.itemSupportsRespawn("ammo_pack"), "ammo_pack supports respawn");
assert(t.itemSupportsRespawn("item_armor_combat"), "armor supports respawn");
assert(!t.itemSupportsRespawn("info_player_deathmatch"), "spawn not respawnable");
assert(
  t.respawnSecForClassname("weapon_lightning", "duel", "bloodrun") === 5,
  "weapon_lightning duel",
);
assert(
  t.respawnSecForClassname("weapon_lightning", "tdm", "bloodrun") === 30,
  "weapon_lightning tdm",
);
assert(
  t.respawnSecForClassname("ammo_rockets", "duel", "bloodrun") === 40,
  "ammo_rockets",
);
assert(
  t.respawnSecForClassname("item_health_mega", "duel", "bloodrun") === 35,
  "mega bloodrun default",
);
assert(
  t.respawnSecForClassname("item_health_mega", "duel", "pro-q3tourney4") === 120,
  "mega bloodrun map override",
);
assert(t.entityItemCategory("ammo_pack") === "ammo_pack", "ammo_pack category");
assert(t.ammoPackVisibleForGametype({ classname: "ammo_pack" }, "duel") === false, "ammo_pack hidden duel");
assert(t.mergeItemPickupDisplay(null).ammo_pack === "hide", "ammo_pack default hide mode");

assert(
  t.entityMatchesGametype(
    { id: 15, classname: "item_armor_combat", attrs: { notteam: "1" } },
    "duel",
  ),
  "campgrounds duel YA (notteam) visible in duel",
);
assert(
  !t.entityMatchesGametype(
    { id: 15, classname: "item_armor_combat", attrs: { notteam: "1" } },
    "tdm",
  ),
  "campgrounds duel YA (notteam) hidden in tdm",
);
assert(
  !t.entityMatchesGametype(
    { id: 152, classname: "item_health", attrs: { notfree: "1" } },
    "duel",
  ),
  "campgrounds tdm medkit (notfree) hidden in duel",
);
assert(
  t.entityMatchesGametype(
    { id: 152, classname: "item_health", attrs: { notfree: "1" } },
    "tdm",
  ),
  "campgrounds tdm medkit (notfree) visible in tdm",
);
assert(
  t.entityMatchesGametype(
    { id: 22, classname: "item_health", attrs: {} },
    "duel",
  ),
  "campgrounds duel medkit (no flags) visible in duel",
);
assert(
  !t.entityMatchesGametype(
    { id: 163, classname: "item_armor_body", attrs: { notsingle: "1", notfree: "1" } },
    "duel",
  ),
  "campgrounds tdm RA (notsingle) hidden in duel",
);
assert(
  t.entityMatchesGametype(
    { id: 163, classname: "item_armor_body", attrs: { notsingle: "1", notfree: "1" } },
    "tdm",
  ),
  "campgrounds tdm RA (notsingle) visible in tdm",
);
assert(
  t.entityMatchesGametype(
    { classname: "weapon_grenadelauncher", attrs: { gametype: "tdm ft" } },
    "tdm",
  ),
  "multi-token gametype tdm ft matches tdm",
);
assert(
  !t.entityMatchesGametype(
    { classname: "item_quad", attrs: { not_gametype: "ffa duel ca" } },
    "duel",
  ),
  "multi-token not_gametype blocks duel",
);

// Phase 3: theme defaults
const theme = t.mergeTheme(null);
assert(theme.spawns.activeColor === "#00ff00", "default spawn active color");
assert(theme.respawn.animationStyle === "conic", "default respawn animation conic");
assert(theme.players.viewLengthPx === 80, "default arrow length 80px");

assert(theme.players.selfColor === "#3b82f6", "default self color");
assert(theme.players.opponentColor === "#ef4444", "default opponent color");
assert(theme.players.otherColor === "#f97316", "default other color");

// Phase 4: heatmap defaults
const hm = t.mergeHeatmap(null);
assert(hm.enabled === false, "heatmap disabled by default");
assert(hm.durationSec === 30, "heatmap duration 30s default");
assert(hm.mode === "trail", "heatmap trail mode default");
assert(hm.opacity === 0.45, "heatmap opacity default");
assert(hm.playerHidden && typeof hm.playerHidden === "object", "heatmap playerHidden object");
assert(t.clampHeatmapDuration(200) === 120, "heatmap duration max 120");
assert(t.clampHeatmapDuration(1) === 5, "heatmap duration min 5");

// Phase 3: preset apply
const minimalSettings = { version: 8, enabled: false, layers: {} };
t.applyPresetToSettings(minimalSettings, "minimal", "bloodrun");
assert(minimalSettings.activePreset === "minimal", "minimal preset sets activePreset");
assert(minimalSettings.showFovWedge === false, "minimal hides FOV wedge");
assert(minimalSettings.showDirectionArrow === true, "minimal keeps direction arrow");
assert(
  minimalSettings.itemCategories.item_health_mega === true,
  "minimal keeps mega",
);
assert(
  minimalSettings.itemCategories.weapons === false,
  "minimal hides weapons",
);
assert(
  minimalSettings.layers.bloodrun && minimalSettings.layers.bloodrun.items === true,
  "minimal applies items layer on map",
);
assert(
  minimalSettings.layers.bloodrun &&
    minimalSettings.layers.bloodrun.duel_spawns === false,
  "minimal disables duel spawns layer",
);

const teamSettings = { version: 8, enabled: false, layers: {} };
t.applyPresetToSettings(teamSettings, "team", "bloodrun");
assert(teamSettings.activePreset === "team", "team preset sets activePreset");
assert(teamSettings.itemCategories.weapons === true, "team enables weapons");
assert(teamSettings.itemPickupDisplay.weapons === "timer", "team enables weapon pickup timers");

// Phase 3: export document shape
const exportDoc = t.buildExportDocument({
  enabled: true,
  anchor: "player",
  referencePlayerId: null,
  showInactive: true,
  showThreshold: true,
  middleVal: null,
  layers: {},
  layerTemplate: null,
  itemCategories: {},
  showFovWedge: true,
  showDirectionArrow: true,
  mapZoomPercent: 100,
  showKillfeed: true,
  showPickupToasts: true,
  settingsTab: "profiles",
  activePreset: "minimal",
  theme: null,
  customProfiles: [],
  heatmap: { enabled: true, durationSec: 45, opacity: 0.5 },
});
assert(exportDoc.settings.heatmap && exportDoc.settings.heatmap.enabled === true, "export heatmap");
assert(exportDoc.version === 13, "export wrapper version 13");
assert(exportDoc.settings && exportDoc.settings.version === 13, "export settings version 13");
assert(exportDoc.settings.activePreset === "minimal", "export preserves activePreset");
assert(exportDoc.exportedAt, "export has exportedAt timestamp");
assert(
  exportDoc.settings.theme && exportDoc.settings.theme.respawn,
  "export includes merged theme",
);

const validImport = t.validateImportDocument(exportDoc);
assert(validImport.ok === true, "validate accepts export document");

const bareV8 = t.validateImportDocument({ version: 8, enabled: true });
assert(bareV8.ok === true, "validate accepts bare v8 settings");

const badImport = t.validateImportDocument({ version: 99 });
assert(badImport.ok === false, "validate rejects future version");

assert(
  t.pickupDisplayForClassname("item_health_mega", {
    itemPickupDisplay: { health: "timer", item_health_mega: "always" },
  }) === "always",
  "pickup display per health classname override",
);
assert(
  t.pickupDisplayForClassname("item_health", {
    itemPickupDisplay: { health: "hide", item_health: "inherit" },
  }) === "hide",
  "pickup display inherit uses group default",
);
assert(
  t.pickupDisplayForClassname("item_armor_combat", {
    itemPickupDisplay: { armor: "timer", item_armor_combat: "hide" },
  }) === "hide",
  "pickup display per armor classname override",
);
const pickupExport = t.exportItemPickupDisplay({
  health: "timer",
  item_health_small: "hide",
  item_armor_shard: "inherit",
});
assert(pickupExport.item_health_small === "hide", "export keeps classname override");
assert(pickupExport.item_armor_shard == null, "export omits inherit override");

const mergedPickup = t.mergeItemPickupDisplay({
  health: "hide",
  item_health_mega: "always",
  item_armor_combat: "hide",
});
assert(mergedPickup.health === "hide", "merge keeps category mode");
assert(mergedPickup.item_health_mega === "always", "merge keeps classname override");
assert(mergedPickup.item_armor_combat === "hide", "merge keeps armor classname override");
const pickupRoundtrip = t.mergeItemPickupDisplay(
  t.exportItemPickupDisplay({
    armor: "timer",
    item_armor_shard: "hide",
    item_health: "inherit",
  }),
);
assert(pickupRoundtrip.item_armor_shard === "hide", "export->merge roundtrip classname");

const livePickupAt = t.pickupEventTimeMs({
  t: 12345,
  time: "2099-01-01T00:00:00.000Z",
});
assert(Math.abs(livePickupAt - Date.now()) < 100, "live pickup time ignores event t/time");
assert(t.formatRespawnCountdown(25000, 25000) === "25", "countdown at start");
assert(t.formatRespawnCountdown(24500, 25000) === "24", "countdown floors partial second");
assert(t.formatRespawnCountdown(500, 25000) === "1", "countdown last second");
assert(t.pickupCoordsValid(100, 200) === true, "pickup coords valid");
assert(t.pickupCoordsValid(null, 0) === false, "pickup coords invalid when x missing");
assert(t.pickupCoordsValid(0, 0) === true, "pickup coords allow world origin");

const migratedPickup = t.migrateRespawnTimersIntoPickupDisplay({
  itemPickupDisplay: { health: "timer", weapons: "timer" },
  respawnTimers: { health: true, weapons: false },
});
assert(migratedPickup.weapons === "always", "v12 migration: disabled timer -> always");
assert(migratedPickup.health === "timer", "v12 migration: enabled timer unchanged");

const bloodrunPath = path.join(__dirname, "../live-overlay/maps/entities/bloodrun.json");
const bloodrun = JSON.parse(fs.readFileSync(bloodrunPath, "utf8"));
const tpGraph = t.buildTeleportGraph(bloodrun.entities);
assert(
  t.isHeatmapTeleportJumpInGraph(tpGraph, 668, -1300, -576, 368),
  "bloodrun teleport entrance to exit",
);
assert(
  !t.isHeatmapTeleportJumpInGraph(tpGraph, 668, -1300, 670, -1290),
  "small move near teleport entrance is not a TP",
);
assert(
  t.isHeatmapTeleportJumpInGraph(tpGraph, 0, 0, 600, 0),
  "large unexplained jump uses fallback threshold",
);

const markerDefaults = { version: 12 };
t.normalizePlayerMarkerSettings(markerDefaults);
assert(markerDefaults.showPlayerHealthArmor === true, "marker stats default on");
assert(markerDefaults.playerMarkerMinPx === 8, "marker min default 8");
assert(markerDefaults.playerMarkerMaxPx === 14, "marker max default 14");
assert(markerDefaults.playerLabelFontPx === 11, "label font default 11");
assert(t.clampPlayerMarkerMaxPx(6, 10) === 10, "marker max clamped to min");
assert(t.clampPlayerLabelFontPx(99) === 18, "label font max 18");

const payload = t.settingsPayload({ version: 12, playerMarkerMinPx: 5, playerMarkerMaxPx: 20 });
assert(payload.version === 13, "settingsPayload bumps version to 13");
assert(payload.playerMarkerMinPx === 5, "settingsPayload preserves marker min");
assert(payload.showPlayerHealthArmor === true, "settingsPayload exports showPlayerHealthArmor");

if (failed) {
  console.error(failed + " assertion(s) failed");
  process.exit(1);
}

console.log("OK: map-spawns sanity (" + checks + " checks)");
