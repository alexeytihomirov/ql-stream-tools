# ql-stream-tools

**Frontier Gaming Panel** — streamer dashboard for live matches, tournament data, and match analytics.

## Packages

| Path | Purpose |
|------|---------|
| `live-overlay/dashboard/` | **Frontier Gaming Panel** — matches, tournament, results, server analytics |
| `live-overlay/` | Map viewer and legacy OBS pages (scoreboard, matches list) |
| `player-guide/` | Tournament regulations + network settings (HTML for players / stream link) |

## Frontier Gaming Panel

Central tool (connection, tournaments from ql-public-data, live matches, results):

```
# CDN
https://cdn.jsdelivr.net/gh/owner/ql-stream-tools@main/live-overlay/dashboard/index.html?base=http://STATS_HOST:8090

# Local (overlay-serve.cmd)
http://127.0.0.1:8787/live-overlay/dashboard/index.html?base=http://STATS_HOST:8090
```

Hash routes: `#/` (dashboard), `#/results`, `#/tournament`, `#/server/{id}`, `#/settings`.

Legacy `live-overlay/control/` and `viewer.html` redirect to `dashboard/`.

## Live map (`live-overlay/`)

Map page for live/replay — require `?base=http://STATS_HOST:8090` (ql-stats-hub).

```
https://cdn.jsdelivr.net/gh/alexeytihomirov/ql-stream-tools@main/live-overlay/map.html?base=http://HOST:8090&match=MATCH_ID
```

See `live-overlay/README.md`.

## Player guide (regulations)

Tournament rules template, `cl_timeNudge` explanation, recommended client cvars:

```
player-guide/index.html
```

CDN: `https://cdn.jsdelivr.net/gh/alexeytihomirov/ql-stream-tools@main/player-guide/index.html`

Operator source: `docs/TOURNAMENT-REGULATIONS.md`. See `player-guide/README.md`.

## AI / project requirements

- `docs/BUSINESS.md` (RU) — dashboard rules, WebSocket policy
- `docs/DEVELOPMENT.md` (EN) — layout, hash router, development conventions
