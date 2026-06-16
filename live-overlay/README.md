# Live match overlays (OBS)

Scoreboard, map positions, and match list — **presentation layer** for ql-stats-hub API.

**Full documentation:** [`../stream-overlay/docs.html`](../stream-overlay/docs.html) (map calibration, smooth, hub, troubleshooting).

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
| `assets` | no | Overlay static root (transforms + map PNGs); auto CDN when opened via `file://` |
| `match` | map/scoreboard | Match id; omit to auto-pick first live match |
| `poll` | no | HTTP fallback interval (ms); scoreboard default 500 |
| `transport` | no | `ws` (default) or `poll` for map overlay |
| `smooth` | map only | `1` (default) — EMA smoothing between telemetry; `0` = snap each frame |
| `smooth_ms` | map only | Smoothing time constant in ms (default `180`; try `250` if still jittery) |
| `debug` | map only | `1` — calibration panel (world/pixel coords, click sampler, JSON snippet) |

Map overlay uses WebSocket by default; HTTP poll is fallback only if WS is silent.

### Map calibration debug (`map.html?debug=1`)

Workflow: **grid → scale → offset**

1. Enable grid (128/256/512 world units) and walk on server — match grid to map features
2. **Scale** — slider «world width» or mouse wheel on map
3. **Offset** — drag map layer (center X/Y = world position at image center)
4. Copy JSON → `maps/map_transforms.json`

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

Tune bounds in-game: compare telemetry `x`/`y` with dot position on the image.

Hub **Statistics** tab generates ready-made URLs when stats-hub is deployed.
