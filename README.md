# ql-stream-tools

Local OBS/browser overlay for casters (`stream-overlay/`).

## Setup

1. Open `stream-overlay/index.html` in OBS Browser Source or locally.
2. Enter **public data base** (jsDelivr URL for ql-public-data) and **tournament slug**.
3. See `stream-overlay/README.md` for full setup.

No Hub URL or overlay token — overlay reads published JSON from CDN.

## Live match stats / map overlay

For real-time scoreboard and player positions on a map, use sibling repo **`ql-stats-hub`**:

- OBS scoreboard: `http://STATS_HOST:8090/overlay/scoreboard.html?match=MATCH_ID`
- OBS map overlay: `http://STATS_HOST:8090/overlay/map.html?match=MATCH_ID`

Enable `stream_telemetry` minqlx plugin on game servers (see `ql-stats-hub/README.md`).

## AI / project requirements

- `docs/BUSINESS.md` (RU) — presentation layer rules, WebSocket policy
- `docs/DEVELOPMENT.md` (EN) — overlay development conventions
