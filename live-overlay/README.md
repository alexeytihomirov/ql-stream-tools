# Live match overlays (OBS)

Scoreboard, map positions, and match list — **presentation layer** for ql-stats-hub API.

## Frontier Gaming Panel

Central streamer dashboard (connection, tournaments from ql-public-data, live matches, results):

```
# CDN
https://cdn.jsdelivr.net/gh/owner/ql-stream-tools@main/live-overlay/dashboard/index.html?base=http://STATS_HOST:8090

# Local (overlay-serve.cmd)
http://127.0.0.1:8787/live-overlay/dashboard/index.html?base=http://STATS_HOST:8090
```

Hash routes: `#/` · `#/results` · `#/tournament` · `#/server/{id}` · `#/settings`.

Legacy `control/` and `viewer.html` redirect to `dashboard/`. Operator pages: `match.html`, `matches.html?mode=operator`.

| Param | Pages | Description |
|-------|-------|-------------|
| `mode` | matches | `overlay` (OBS, default) or `operator` (toolbar + actions) |
| `layout` | matches | `cards` (default) or `compact` (ticker) |
| `status` | matches | `all`, `live`, `ended` (client filter + WS cache) |
| `bg` | overlays | `transparent`, `chroma`, `checkerboard`, or `#hex` |

Settings: `localStorage` key `ql-control-settings`.

## OBS setup

Use jsDelivr (recommended) or serve `live-overlay/` over HTTP. Opening `file://` HTML works for stats-hub API (`?base=…`) but map assets load from jsDelivr automatically; override with `?assets=http://127.0.0.1:8787/live-overlay/` when testing local PNG/transform edits.

```
https://cdn.jsdelivr.net/gh/alexeytihomirov/ql-stream-tools@main/live-overlay/scoreboard.html?base=http://STATS_HOST:8090&match=MATCH_ID
https://cdn.jsdelivr.net/gh/alexeytihomirov/ql-stream-tools@main/live-overlay/map.html?base=http://STATS_HOST:8090&match=MATCH_ID
https://cdn.jsdelivr.net/gh/alexeytihomirov/ql-stream-tools@main/live-overlay/matches.html?base=http://STATS_HOST:8090
```

## Query params

| Param | Required | Description |
|-------|----------|-------------|
| `base` | **yes** | ql-stats-hub root URL (`http://host:8090`) |
| `assets` | no | CDN / page dir | Map PNGs, transforms, sprites. Auto CDN when origin matches stats-hub `base`. |
| `match` | map/scoreboard | Match id; omit to auto-pick first live match |
| `poll` | no | HTTP fallback interval (ms); scoreboard default 500 |
| `transport` | no | `ws` (default) or `poll` for map overlay |
| `smooth` | map only | `1` (default) — EMA smoothing between telemetry; `0` = snap each frame |
| `smooth_ms` | map only | Smoothing time constant in ms (default `180`; try `250` if still jittery) |
| `death_sec` | map only | Death marker lifetime on map in seconds (default `4`) |
| `debug` | map only | `1` — calibration panel (world/pixel coords, click sampler, JSON snippet) |

Map overlay uses WebSocket by default; HTTP poll is fallback only if WS is silent.

### Map overlay settings (`map.html` → **Settings**)

- Layer toggles per map (duel spawns, items, DM spawns, teleports) — persisted in `localStorage`
- **Item categories** (when items layer is on): weapons, ammo, health (5/25/50/mega), armor (GA/YA/RA/shards; shards off by default), powerups
- Duel anchor (player / mouse), threshold square, rejected spawns — threshold and ref marker use the same smooth motion as player dots (`smooth` / `smooth_ms`)
- Death markers: `medal_excellent` sprite at victim position from WS `death` event (fade out; `death_sec` URL param)
- Item respawn: on WS `pickup`, nearest item sprite within 128 world units dims with radial fill + countdown (QL default respawn times; items layer must be on; shards hidden unless enabled in settings)
- Player labels: `Nick [health/armor]` plus active powerups
- Pickup toasts (`#map-pickups`): transient messages with item sprite, auto-fade ~4.5s
- Pickup log (**Pickups** button): scrollable full history with sprites from WS `pickup` events

### Map calibration debug (`map.html?debug=1`)

Workflow: **contour trace → grid → scale → offset**

1. **Contour trace** — enable *Record movement*, walk along all walls hugging geometry; export `{map}-contour.png` (transparent) and overlay on your map PNG in an editor to check alignment
2. Enable grid (128/256/512 world units) and match grid to map features
3. **Scale** — slider «world width» or mouse wheel on map
4. **Offset** — drag map layer (center X/Y = world position at image center)
5. Copy JSON → `maps/map_transforms.json`

Trail points persist in `sessionStorage` per map until **Clear trail**. Teleports break the line (same as heatmap). *Hide map image* shows a checkerboard so only the cyan trace is visible while tuning scale/offset.

```
http://127.0.0.1:8787/map.html?base=http://STATS_HOST:8090&debug=1
```

## Map calibration (world → minimap pixels)

Edit **`live-overlay/maps/map_transforms.json`** (key = lowercase `map_name` from stats-hub).

| Field | Meaning |
|-------|---------|
| `world_min_x` / `world_max_x` | Left/right world bounds on the PNG |
| `world_min_y` / `world_max_y` | Bottom/top world bounds |
| `image_width` / `image_height` | PNG size in pixels |
| `image_url` | Path relative to overlay, e.g. `maps/bloodrun.png` |

Place PNG in `live-overlay/maps/`. Regenerate placeholders:

```bash
python scripts/gen_map_placeholders.py
```

Regenerate transforms for all map PNGs (ql-spawns `mapOrigin`/`mapEnd` when available; else BSP entity bounds + median padding from `pak00/maps/`):

```bash
python scripts/gen_map_transforms.py
node scripts/test_map_transforms_sanity.js
```

Extract item/weapon/spawn entities from `pak00/maps/*.bsp` for overlay maps listed in `map_transforms.json`, then generate layer configs (`items` layer on by default):

```bash
python scripts/batch_extract_map_entities.py --only-maps live-overlay/maps/map_transforms.json
python scripts/gen_entity_display.py
```

Generate overview PNG from BSP (floor textures + wall outline) when no ql-spawns art exists:

```bash
python scripts/gen_map_overview.py phrantic
python scripts/gen_map_transforms.py
python scripts/gen_entity_display.py
```

Without `maps/entities/{map}.json` and a matching entry in `entity-display.json`, the overlay shows no static items (panel meta: «no entity dump»).

Tune bounds in-game: compare telemetry `x`/`y` with dot position on the image (`?debug=1`). Maps without ql-spawns HTML may need manual calibration.

Hub **Statistics** tab generates ready-made URLs when stats-hub is deployed.
