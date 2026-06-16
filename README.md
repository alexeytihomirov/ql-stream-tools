# ql-stream-tools

OBS/browser overlays for casters.

## Packages

| Path | Purpose |
|------|---------|
| `stream-overlay/` | Tournament popup (logo, live match card) — **WebSocket** to ql-stats-hub + CDN meta |
| `live-overlay/` | Scoreboard, map positions, match list — **WebSocket** (map) / HTTP poll fallback |
| `player-guide/` | Tournament regulations + network settings (HTML for players / stream link) |

## Documentation (overlays)

HTML guide for casters/operators (stream + live overlays, map calibration, smooth):

```
stream-overlay/docs.html
```

CDN: `https://cdn.jsdelivr.net/gh/alexeytihomirov/ql-stream-tools@main/stream-overlay/docs.html`

## Tournament popup (`stream-overlay/`)

1. Open `stream-overlay/index.html` in OBS Browser Source.
2. Set **public data base** (jsDelivr URL for ql-public-data) and **tournament slug**.
3. Set **stats hub URL** for live scores via WebSocket (`/api/ws/live`).
4. See `stream-overlay/README.md`.

## Live match overlays (`live-overlay/`)

Scoreboard / map / matches — require `?base=http://STATS_HOST:8090` (ql-stats-hub).

```
https://cdn.jsdelivr.net/gh/alexeytihomirov/ql-stream-tools@main/live-overlay/map.html?base=http://HOST:8090&match=MATCH_ID
```

See `live-overlay/README.md`. Hub Statistics tab copies ready-made URLs.

## Player guide (regulations)

Tournament rules template, `cl_timeNudge` explanation, recommended client cvars:

```
player-guide/index.html
```

CDN: `https://cdn.jsdelivr.net/gh/alexeytihomirov/ql-stream-tools@main/player-guide/index.html`

Operator source: `docs/TOURNAMENT-REGULATIONS.md`. See `player-guide/README.md`.

## AI / project requirements

- `docs/BUSINESS.md` (RU) — presentation layer rules, WebSocket policy
- `docs/DEVELOPMENT.md` (EN) — overlay development conventions
