# Live match overlays (OBS)

Scoreboard, map positions, and match list — **presentation layer** for ql-stats-hub API.

## OBS setup

Use jsDelivr (after push to `ql-stream-tools`) or open files locally.

```
https://cdn.jsdelivr.net/gh/alexeytihomirov/ql-stream-tools@main/live-overlay/scoreboard.html?base=http://STATS_HOST:8090&match=MATCH_ID
https://cdn.jsdelivr.net/gh/alexeytihomirov/ql-stream-tools@main/live-overlay/map.html?base=http://STATS_HOST:8090&match=MATCH_ID
https://cdn.jsdelivr.net/gh/alexeytihomirov/ql-stream-tools@main/live-overlay/matches.html?base=http://STATS_HOST:8090
```

## Query params

| Param | Required | Description |
|-------|----------|-------------|
| `base` | **yes** | ql-stats-hub root URL (`http://host:8090`) |
| `match` | map/scoreboard | Match id; omit to auto-pick first live match |
| `poll` | no | HTTP fallback interval (ms); scoreboard default 500 |
| `transport` | no | `ws` (default) or `poll` for map overlay |

Map overlay uses WebSocket by default; HTTP poll is fallback only if WS is silent.

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
