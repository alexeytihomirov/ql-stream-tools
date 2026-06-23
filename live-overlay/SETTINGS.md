# Map overlay settings (`map.html`)

Operator reference for URL parameters, browser storage, presets, theme, and OBS examples.

Phase 1: chrome layout (killfeed/log outside map), FOV toggles, map zoom, QL-style killfeed, server-side death dedup (stats-hub).

Phase 2: tabbed settings panel, weapon/ammo respawn rings, per-category respawn timer toggles, HUD killfeed/toast toggles.

Phase 3: built-in presets (minimal / team), named profiles, JSON import/export, theme engine (CSS variables on `#map-wrap`).

## URL parameters

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `base` | **yes** | — | ql-stats-hub root URL (`http://host:8090`) |
| `match` | no | first live match | Match id for WS + REST |
| `assets` | no | jsDelivr when `file://` | Static overlay root (maps, sprites) |
| `transport` | no | `ws` | `ws` or `poll` (map telemetry should stay on WS) |
| `poll` | no | `100` | HTTP fallback interval (ms) when WS silent |
| `smooth` | no | `1` | Player dot EMA smoothing (`0` = snap) |
| `smooth_ms` | no | `180` | Smoothing time constant (ms) |
| `death_sec` | no | `4` | Death marker lifetime on map (seconds) |
| `fov` | no | `100` | Fallback FOV (deg) when telemetry has no `p.fov` |
| `fov_px` | no | `80` | FOV wedge length in pixels (overridden by theme `viewLengthPx` when set) |
| `spawns` | no | off | `1` / `settings` — enable entity overlay + open Settings |
| `spawn_anchor` | no | `player` | Duel anchor: `player` or `cursor` |
| `gametype` | no | from match | Override gametype for entity filters |
| `debug` | no | off | `1` — calibration panel |
| `debug_pickups` | no | off | `1` — console pickup debug |

## localStorage

All overlay UI settings use one key (schema **v11**):

| Key | Type | Description |
|-----|------|-------------|
| `ql-map-spawns-settings` | JSON object | Unified map overlay settings (see below) |
| `ql-live-overlay-base` | string | Optional default stats-hub `base` URL (viewer) |

### `ql-map-spawns-settings` (version 13)

| Field | Type | Default | Phase |
|-------|------|---------|-------|
| `version` | number | `13` | — |
| `enabled` | boolean | `false` | 1 |
| `panelOpen` | boolean | `false` | 1 (not exported) |
| `showFovWedge` | boolean | `true` | 1 |
| `showDirectionArrow` | boolean | `true` | 1 |
| `showPlayerHealthArmor` | boolean | `true` | 13 |
| `playerMarkerMinPx` | number | `8` | 13 (4–20, low Z dot size) |
| `playerMarkerMaxPx` | number | `14` | 13 (6–32, high Z dot size) |
| `playerLabelFontPx` | number | `11` | 13 (8–18, nickname label) |
| `mapZoomPercent` | number | `100` | 1 (50–150) |
| `anchor` | string | `"player"` | 1 |
| `referencePlayerId` | string \| null | auto | 1 |
| `showInactive` | boolean | `true` | 1 |
| `showThreshold` | boolean | `true` | 1 |
| `middleVal` | number \| null | auto | 1 |
| `layers` | object | `{}` | 1 per-map layer toggles |
| `layerTemplate` | object \| null | `null` | 3 preset layer flags applied on map load |
| `itemCategories` | object | see `map-spawns.js` | 1 (`ammo_pack` default **off**) |
| `itemPickupDisplay` | object | per-category + optional per-type overrides | 11 |
| `showKillfeed` | boolean | `true` | 2 |
| `showPickupToasts` | boolean | `true` | 2 |
| `settingsTab` | string | `"layers"` | 2 |
| `activePreset` | null \| `"minimal"` \| `"team"` \| `"custom"` | `null` | 3 |
| `theme` | object | see **Theme object** | 3 |
| `customProfiles` | array | `[]` | 3 named saved profiles |
| `heatmap` | object | see **Heatmap object** | 4 |

`itemPickupDisplay` modes (Items → **After pickup**):

| Mode | Behavior |
|------|----------|
| `timer` | Dim sprite + respawn countdown ring |
| `hide` | Hide sprite until respawn (no ring) |
| `always` | Never hide on pickup |

Per-type keys (optional, Items → **After pickup** → expand Health / Armor):

| Classname | Label |
|-----------|--------|
| `item_health_small` | Green (5 HP) |
| `item_health` | 25 HP |
| `item_health_large` | 50 HP |
| `item_health_mega` | Mega |
| `item_armor_jacket` | Green (GA) |
| `item_armor_shard` | Shard |
| `item_armor_combat` | Yellow (YA) |
| `item_armor_body` | Red (RA) |

Override value `inherit` (UI: **Use group default**) falls back to the parent `health` or `armor` mode. **Item categories** (same tab, above) still control whether a type is shown on the map at all.

**Minimal preset** pickup defaults: mega + YA + RA use group timer; small/medium/large health and GA/shard hidden on pickup.

**Ammo packs:** category `ammo_pack` is off by default. In duel/TDM, map entities without `attrs.gametype` are hidden; entities tagged `gametype: duel` show only in duel.

Migration: older v1–v12 objects are upgraded in place on load (`map-spawns.js`). v12 removes legacy `respawnTimers`; categories where timers were off become `always` in `itemPickupDisplay` when the group mode was still `timer`. v13 adds player marker label/size fields with defaults above.

## Heatmap

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `heatmap.enabled` | boolean | `false` | Show/hide heatmap layer (recording continues while off) |
| `heatmap.mode` | string | `"trail"` | `trail` = smooth path; `aggregate` = full-match density (resets on match end) |
| `heatmap.durationSec` | number | `30` | Trail window 5–120 s (ignored in aggregate mode) |
| `heatmap.opacity` | number | `0.45` | Peak opacity (0.05–1) |
| `heatmap.playerHidden` | object | `{}` | Per steam/nickname id → `true` to hide trail on map |

Per-player checkboxes (Players tab → Heatmap → **Players** list) control visibility only; trails keep recording in the background until match/map reset.

Legacy keys `showSelf`, `showOpponent`, `showOther` are ignored (kept in old exports for compatibility).

Trail mode skips drawing a line segment when the player **teleports** (matched entrance→exit from map entities, or a large position jump ≥512 world units as fallback). Dots at entry and exit are still recorded.

Heatmap, item respawn rings, killfeed, and pickup log **reset** on: new `match_id`, map change, `match_status` ended/aborted.

Trail colors use `theme.players.selfColor`, `opponentColor`, `otherColor` (duel / 2-player: self vs opponent).

Settings → **Players** tab → **Heatmap** subsection.

### Duel player colors (Phase 4)

When gametype is **duel** or exactly **2** live players on the map:

| Theme field | Default | Used for |
|-------------|---------|----------|
| `theme.players.selfColor` | `#3b82f6` | Reference player dot / arrow |
| `theme.players.opponentColor` | `#ef4444` | Other duelist |
| `theme.players.otherColor` | `#f97316` | FFA / team modes (3+ players) |

Reference player: `referencePlayerId` or first player with coords (same as duel spawn anchor).

Configure in Settings → **Profiles** → Theme — players (self / opponent / other colors).

## Presets (Phase 3)

Built-in presets apply layer template, item filters, after-pickup display, and player/HUD toggles. Any manual tweak after applying a preset sets `activePreset` to `"custom"`.

| Preset | Player markers | Items shown | After pickup |
|--------|----------------|-------------|--------------|
| **minimal** | Direction arrow only (no FOV wedge) | Mega, YA, RA only | Health + armor timers; weapons/ammo hidden |
| **team** | Same as minimal | + all weapons | + weapon timers |

Layer template (applied per map when preset is active): **items** on; duel spawns, all DM spawns, teleports off.

### Example — minimal preset (effective values)

```json
{
  "version": 10,
  "activePreset": "minimal",
  "enabled": true,
  "showFovWedge": false,
  "showDirectionArrow": true,
  "showInactive": false,
  "showThreshold": false,
  "showKillfeed": false,
  "showPickupToasts": true,
  "layerTemplate": {
    "duel_spawns": false,
    "items": true,
    "all_dm_spawns": false,
    "teleport_exits": false,
    "teleport_entrances": false
  },
  "itemCategories": {
    "weapons": false,
    "ammo": false,
    "health": true,
    "armor": true,
    "powerups": false,
    "item_health_mega": true,
    "item_armor_combat": true,
    "item_armor_body": true
  },
  "itemPickupDisplay": {
    "weapons": "hide",
    "ammo": "hide",
    "health": "timer",
    "armor": "timer",
    "powerups": "hide",
    "item_health_small": "hide",
    "item_health": "hide",
    "item_health_large": "hide",
    "item_armor_jacket": "hide",
    "item_armor_shard": "hide"
  }
}
```

### Example — team preset (diff vs minimal)

```json
{
  "activePreset": "team",
  "itemCategories": {
    "weapons": true
  },
  "itemPickupDisplay": {
    "weapons": "timer"
  }
}
```

Team inherits all other minimal fields when applied via Settings → **Profiles**.

## Theme object (Phase 3)

Applied as CSS custom properties on `#map-wrap`. Sprite URLs must be reachable from the OBS Browser Source (CDN, same host as overlay, or `?assets=` local server).

```json
{
  "theme": {
    "spawns": {
      "activeColor": "#00ff00",
      "inactiveColor": "#aa3333",
      "activeSpriteUrl": "",
      "inactiveSpriteUrl": "",
      "cssOverride": ""
    },
    "players": {
      "fovFill": "rgba(255, 255, 255, 0.1)",
      "fovStroke": "rgba(255, 255, 255, 0.28)",
      "fovOpacity": 1,
      "viewColorStart": "rgba(255, 255, 255, 0.35)",
      "viewColorEnd": "rgba(255, 255, 255, 0.95)",
      "viewOpacity": 1,
      "viewLengthPx": 80,
      "arrowHeadColor": "#ffffff",
      "arrowSpriteUrl": "",
      "selfColor": "#3b82f6",
      "opponentColor": "#ef4444",
      "otherColor": "#f97316"
    },
    "respawn": {
      "ringColor": "#4ade80",
      "ringBg": "rgba(20, 24, 32, 0.82)",
      "countColor": "#f8fafc",
      "animationStyle": "conic"
    }
  }
}
```

| CSS variable | Theme field | Notes |
|--------------|-------------|-------|
| `--map-spawn-active-color` | `spawns.activeColor` | Duel spawn pool (active) |
| `--map-spawn-inactive-color` | `spawns.inactiveColor` | Rejected spawns |
| `--map-spawn-active-sprite` | `spawns.activeSpriteUrl` | Optional PNG/SVG |
| `--map-fov-fill` / `--map-fov-stroke` | `players.fovFill`, `fovStroke` | FOV wedge |
| `--map-view-length-px` | `players.viewLengthPx` | Direction arrow length |
| `--map-player-self-color` | `players.selfColor` | Duel reference player |
| `--map-player-opponent-color` | `players.opponentColor` | Duel opponent |
| `--map-player-other-color` | `players.otherColor` | FFA / team default dot |
| `--map-respawn-ring-color` | `respawn.ringColor` | Countdown ring fill |
| `--map-respawn-ring-bg` | `respawn.ringBg` | Ring background |

`respawn.animationStyle`: `"conic"` (radial ring, default) or `"linear"` (bottom-up bar on `.map-item-respawn--linear`).

### Example — custom theme snippet (purple FOV, linear respawn)

```json
{
  "theme": {
    "players": {
      "fovFill": "rgba(168, 85, 247, 0.15)",
      "fovStroke": "rgba(168, 85, 247, 0.5)",
      "viewLengthPx": 96
    },
    "respawn": {
      "ringColor": "#a855f7",
      "animationStyle": "linear"
    }
  }
}
```

## Import / export (Phase 3)

Settings → **Profiles** tab:

1. **Export JSON** — downloads `ql-map-overlay-settings.json`
2. **Import JSON** — file picker; validates `version` (1–10), migrates on load
3. **Save current…** — prompt for name; adds to `customProfiles`
4. **Profile** dropdown — Minimal / Team / Custom / saved profiles

### Export file shape

```json
{
  "version": 10,
  "exportedAt": "2026-06-18T12:00:00.000Z",
  "settings": {
    "version": 10,
    "enabled": true,
    "activePreset": "team",
    "theme": { },
    "customProfiles": [
      {
        "id": "profile-1718700000000",
        "name": "TDM stream",
        "savedAt": "2026-06-18T11:00:00.000Z",
        "settings": { }
      }
    ]
  }
}
```

Import accepts either the wrapper above or a bare settings object with a valid `version` field.

### Example stored JSON (full v10)

```json
{
  "version": 10,
  "enabled": true,
  "activePreset": "custom",
  "showFovWedge": true,
  "showDirectionArrow": true,
  "mapZoomPercent": 110,
  "anchor": "player",
  "referencePlayerId": "76561198000000001",
  "showInactive": true,
  "showThreshold": true,
  "middleVal": null,
  "layers": {
    "bloodrun": {
      "duel_spawns": true,
      "items": true
    }
  },
  "layerTemplate": null,
  "itemCategories": {
    "weapons": true,
    "ammo": false,
    "health": true,
    "armor": true,
    "powerups": false
  },
  "itemPickupDisplay": {
    "weapons": "timer",
    "ammo": "hide",
    "health": "timer",
    "armor": "timer",
    "powerups": "hide"
  },
  "showKillfeed": true,
  "showPickupToasts": true,
  "settingsTab": "profiles",
  "heatmap": {
    "enabled": true,
    "durationSec": 45,
    "opacity": 0.5
  },
  "theme": {
    "spawns": { "activeColor": "#00ff00", "inactiveColor": "#aa3333" },
    "players": {
      "viewLengthPx": 80,
      "selfColor": "#3b82f6",
      "opponentColor": "#ef4444",
      "otherColor": "#f97316"
    },
    "respawn": { "animationStyle": "conic" }
  },
  "customProfiles": []
}
```

## Settings panel tabs

| Tab | Contents |
|-----|----------|
| **Layers** | Show overlay, per-map layer toggles, **map zoom** (50–150%), duel anchor / threshold / `middle_val`, map meta |
| **Players** | FOV wedge, direction arrow, HP/armor label toggle, marker size (low/high Z), nickname font, **heatmap** (mode, duration, opacity, who to show) |
| **Items** | Item category filters, respawn timer enable per category |
| **HUD** | Killfeed on/off, pickup toasts on/off |
| **Profiles** | Presets, save/delete profiles, import/export, theme (spawns / players incl. duel colors / respawn) |

Active tab is stored in `settingsTab` and restored on reload.

## After pickup / respawn rings (Phase 2 + 11)

When the **items** layer is on and a category’s **After pickup** mode is `timer`:

- On WS `pickup`, the overlay matches the map entity and starts a countdown ring (conic or linear per theme).
- Partial ammo touches do not start a ring unless the entity actually disappears.

Modes `hide` and `always` replace the old per-category **Respawn timers** on/off toggles (removed in settings v12). Ring colors and animation remain under Theme → respawn.

Default seconds (when telemetry has no `respawn_sec`):

| Category | Duel / FFA | TDM | Notes |
|----------|------------|-----|-------|
| Weapons | **5** | **30** | `g_weaponrespawn` on duel servers |
| Ammo + `ammo_pack` | **40** | **40** | pak00 / `g_ammorespawn` |
| Health | 35 | 35 | Mega **120** on `pro-q3tourney4` (Bloodrun) |
| Armor | 25 | 25 | Shards off by default in category filters |
| Powerups | 120 | 120 | |

Prefer server `respawn_sec` in the pickup payload when present.

## Layout (Phase 1)

| Region | DOM | Contents |
|--------|-----|----------|
| Map frame | `#map-stage-frame` | Wrapper sized to `#map-zoom-host` (zoom only) |
| Map stage | `#map-zoom-host` → `#map-wrap` | Map image, players, deaths, entity layers, pickup **toasts** |
| Page overlays | `#map-page-overlays` (fixed, full viewport) | Killfeed, Pickups/Settings buttons, pickup **log**, settings panel |
| Settings overlay | `#map-spawns-panel` (inside page overlays) | Tabbed settings UI (scrollable) |

Map zoom applies `transform: scale()` on `#map-wrap`; `#map-zoom-host` resizes to the visual size (512 × zoom%). Chrome and settings are **not** children of the map frame, so zoom does not move UI controls. Meta/status/replay bar remain in document flow below the map for OBS sizing.

## Killfeed

- Data: WS `event: "death"` from stats-hub.
- Server dedup: same `match_id` + `victim_steam_id64` within **2 s**.
- Client fallback dedup: `(victim, killer)` within **2 s**.
- Toggle: Settings → **HUD** → Show killfeed.

## OBS examples

**Minimal map (auto match, WS):**

```
https://cdn.jsdelivr.net/gh/alexeytihomirov/ql-stream-tools@main/live-overlay/map.html?base=http://STATS_HOST:8090
```

**Tournament match with entity overlay pre-enabled:**

```
https://cdn.jsdelivr.net/gh/alexeytihomirov/ql-stream-tools@main/live-overlay/map.html?base=http://STATS_HOST:8090&match=MATCH_ID&spawns=1
```

**Open settings on Profiles tab (apply minimal preset manually):**

```
http://127.0.0.1:8787/map.html?base=http://127.0.0.1:8090&match=MATCH_ID&spawns=settings
```

**Local dev:**

```
http://127.0.0.1:8787/map.html?base=http://127.0.0.1:8090&match=MATCH_ID&spawns=settings
```

**Calibration:**

```
http://127.0.0.1:8787/map.html?base=http://STATS_HOST:8090&debug=1
```

Chroma key: use transparent page background; map PNG has dark fill — see main [README](README.md).

## Maintenance (Phase 4)

### Removed from stats-hub (safe cleanup)

- `pickup_detect.py`, `pickup_zmq.py` — moved to `stats_hub/_reference/` (vitals-delta / ZMQ counter inference; **not** used in production; pickups come from minqlx item-events only).
- `_zmq_pickup_snapshots` in-memory state and `clear_zmq_pickup_snapshots()` — dead after minqlx-only pickup path.

Death dedup (Phase 1) and minqlx ingest are unchanged.

### Performance tips

- **Heatmap:** caps trail at 120 s per player; disable when not needed. Canvas redraw runs on the motion loop (~60 fps) — keep `durationSec` modest (30 s default) on low-end OBS machines.
- **Map zoom:** `#map-zoom-host` grows/shrinks with zoom; `#map-wrap` scales inside it; page overlays (settings, pickups, killfeed) stay fixed to the viewport.
- **WS transport:** map telemetry should stay on WebSocket; HTTP poll is a fallback only.

### Security notes

- Overlay loads map PNGs and theme sprite URLs from configured `assets` / CDN — use trusted hosts only (OBS Browser Source has full fetch access to those URLs).
- Stats-hub `base` URL is operator-controlled; do not embed ingest tokens in overlay URLs (stream read is separate).
- Import JSON in Settings applies to `localStorage` only; validate files before sharing profiles.

## Match recording and replay

### stats-hub (recorder)

Enable on the stats-hub host:

```env
STATS_HUB_RECORD_MATCHES=1
STATS_HUB_REPLAY_DIR=data/replays
```

During live matches the hub appends JSONL + `.meta.json` per `match_id`:

| Event | Content |
|-------|---------|
| `positions` | map, gametype, player positions (~ingest rate) |
| `death` | kill feed + marker data |
| `pickup` | item pickup |
| `match_status` | `ended` / `aborted` on finalize |

API (read-only, no token):

- `GET /api/replays` - list recordings (empty when `RECORD_MATCHES=0`)
- `GET /api/replays/{match_id}` - `{ match_id, meta, events[] }`

Health exposes `record_matches: true|false`.

### Overlay replay mode

Live overlay is unchanged when `replay` is **not** set (WebSocket + HTTP fallback as today).

Replay URL (OBS Browser Source or browser tab):

```text
map.html?base=http://STATS_HOST:8090&match=server-1&replay=1
```

Optional query params:

| Param | Default | Notes |
|-------|---------|-------|
| `speed` | `1` | Initial playback speed (0.25-8) |
| `smooth` | off in replay | Motion smoothing disabled in replay |

UI under the map: **Play/Pause**, timeline scrubber, elapsed/total time, speed selector.

On scrub the overlay resets killfeed, deaths, pickups, heatmap, and item timers for that point in time, then reapplies events up to the cursor. Heatmap trail/aggregate uses replay clock time (not wall clock).

If `match` is omitted, the overlay tries the newest entry from `GET /api/replays`.

### Client-side recording (browser)

Record in the **live** overlay without stats-hub `RECORD_MATCHES` (complements server recordings):

```text
map.html?base=http://STATS_HOST:8090&match=server-1&record=1
```

| Param | Default | Notes |
|-------|---------|-------|
| `record` | off | Show **Rec / Stop / Save** bar under the map |
| `record_auto` | off | Start recording on page load |

While **Rec** is active, the overlay appends WS events (`positions`, `death`, `pickup`, `match_status`) into memory. **Save** downloads `ql-replay-{match_id}-{timestamp}.json` — same shape as `GET /api/replays/{id}` plus `"source": "ql-overlay-client"`.

Requires **WebSocket** transport (default). HTTP poll records positions only (no death/pickup stream).

Recording stops automatically on `match_status` ended/aborted.

### Load replay from file

In replay mode (`replay=1`), use **Load file** on the bar below the map:

- `.json` — export from client **Save** or stats-hub API response
- `.jsonl` — raw stats-hub JSONL (one event per line)

File-only replay (skip server fetch):

```text
map.html?base=http://STATS_HOST:8090&replay=1&source=file
```

Server replay still works when `match` is set and `source=file` is omitted.

### Deploy notes

- **ql-stats-hub:** redeploy with `STATS_HUB_RECORD_MATCHES=1` on Finland (or any stats host that should record).
- **ql-stream-tools:** push `live-overlay/*` for replay UI (CDN/jsDelivr on `main`).

Heatmap PNG/export is **not** implemented (by design).

## Deploy notes

- **ql-stream-tools:** push `live-overlay/*` (CDN/jsDelivr picks up `main`). No stats-hub redeploy for Phase 4 overlay-only changes.
- **ql-stats-hub:** optional redeploy if pickup cleanup is deployed (removes dead ZMQ snapshot state only; no ingest behavior change).
