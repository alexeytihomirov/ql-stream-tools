# ql-stream-tools — development guide

## Layout

| Path | Purpose |
|------|---------|
| `live-overlay/dashboard/` | **Streamer dashboard** — hash router, settings, views |
| `live-overlay/control/` | Legacy redirect → `dashboard/` |
| `stream-overlay/` | Tournament popup (CDN config today; target WS) |
| `live-overlay/` | OBS pages: scoreboard, map, matches, match.html |
| `stream-overlay/docs.html` | Operator documentation |
| `player-guide/` | Public HTML: tournament regulations, network cvars |
| `docs/TOURNAMENT-REGULATIONS.md` | Generic technical rules + pointer to event SoT |
| `docs/tournaments/*.md` | Links to `ql-public-data/tournaments/{slug}/regulations.md` |

## Dashboard shell

Entry: `live-overlay/dashboard/index.html`

| Hash route | View | Script |
|------------|------|--------|
| `#/` (empty) | Live matches home | `views/home.js` |
| `#/tournament` | Tournament meta, bracket, stats, demos | `views/tournament.js` |
| `#/match/{match_id}` | Match detail (summary, killfeed, pickups, accuracy) | `views/match.js` |

Match analytics: `GET /api/stream/matches/{id}/archive-summary` on stats-hub. Preview layout with sample data: add `?debug=1` to dashboard URL (e.g. `index.html?base=…&debug=1#/match/server-1`).
| `#/overlays` | OBS overlay cards + preview | `views/overlays.js` |
| `#/settings` | Connection form | `views/settings.js` |

Shared: `app.js` (settings, fetch, router, overlay URL builders), `i18n.js`, `dashboard.css`.

Settings key: `ql-dashboard-settings` (falls back to legacy `ql-control-settings`).

Query params on load (merged into settings): `base`, `tournament` / `slug`.

## Stack

- Static HTML/JS/CSS, no bundler
- OBS Browser Source for overlay pages only; dashboard is a normal browser tab
- Chroma key `#00ff00` on overlay pages where documented

## WebSocket client rules

- Default transport: WebSocket to stats-hub `/api/ws/live`.
- Implement reconnect with backoff; do not fall back to high-frequency HTTP for map positions.
- Scoreboard/matches: optional HTTP poll fallback at low rate only if WS silent > N seconds.

## Assets

- Map images: fetch once per map change; cache in memory or `sessionStorage` by map key.
- Tournament logos: prefer CDN static URLs; load once per slug/logo id.

## Config

- Dashboard: `localStorage` `ql-dashboard-settings` — public data base, stats-hub URL, tournament slug, default OBS bg.
- Overlay pages: `?base=` stats-hub URL, optional stream token.
- No hub API token in dashboard or overlay config.

## CDN popup (transitional)

`stream-overlay/` polls `ql-public-data` `overlay-live.json` — **migrate to WS** per BUSINESS.md. Until migrated, keep poll interval ≥ 2000 ms and do not reload logos each tick.

## Match replay and archive

- Live map: `map.html?base=…&match=…` (WS).
- Server replay: `map.html?…&replay=1` via `GET /api/replays/{match_id}`.
- Published archive (after hub publish): `tournaments/{slug}/games/{id}.json` on CDN — dashboard Match view (Phase 3+).

See `live-overlay/SETTINGS.md` for map chrome, killfeed, pickup log.

## Branch

Default branch: `main`.

## Skill

`skills/ql-stream-tools/SKILL.md`

## Before PR

- Confirm no new load on game servers (only stats-hub consumer).
- Test dashboard views at ~1280px width; test overlays in OBS Browser Source at target resolution.
