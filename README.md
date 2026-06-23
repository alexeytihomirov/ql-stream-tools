# ql-stream-tools

Streamer dashboard + OBS/browser overlays for casters.

## Packages

| Path | Purpose |
|------|---------|
| `live-overlay/dashboard/` | **Streamer dashboard** — matches, tournament, match detail, overlay setup |
| `stream-overlay/` | Tournament popup (logo, live match card) — **WebSocket** to ql-stats-hub + CDN meta |
| `live-overlay/` | OBS pages: scoreboard, map positions, match list |
| `player-guide/` | Tournament regulations + network settings (HTML for players / stream link) |

## Streamer dashboard

Central tool (connection, tournaments from ql-public-data, live matches, overlay URLs):

```
# CDN
https://cdn.jsdelivr.net/gh/owner/ql-stream-tools@main/live-overlay/dashboard/index.html?base=http://STATS_HOST:8090

# Local (overlay-serve.cmd)
http://127.0.0.1:8787/live-overlay/dashboard/index.html?base=http://STATS_HOST:8090
```

Hash routes: `#/` (dashboard), `#/tournament`, `#/match/{id}`, `#/overlays`, `#/settings`.

Legacy `live-overlay/control/` and `viewer.html` redirect to `dashboard/`.

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

- `docs/BUSINESS.md` (RU) — dashboard + overlay rules, WebSocket policy
- `docs/DEVELOPMENT.md` (EN) — layout, hash router, development conventions
