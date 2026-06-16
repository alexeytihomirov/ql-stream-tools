# ql-stream-tools — development guide

## Layout

| Path | Purpose |
|------|---------|
| `stream-overlay/` | Tournament popup (CDN config today; target WS) |
| `stream-overlay/docs.html` | Operator documentation (stream + live overlays) |
| `live-overlay/` | **Target** home for scoreboard, map, matches (migrate from stats-hub) |
| `player-guide/` | Public HTML: tournament regulations, network cvars, timeNudge |
| `docs/TOURNAMENT-REGULATIONS.md` | Generic technical rules + pointer to event SoT |
| `docs/tournaments/*.md` | Links to `ql-public-data/tournaments/{slug}/regulations.md` |

## Stack

- Static HTML/JS/CSS, no bundler
- OBS Browser Source, chroma key `#00ff00` where documented in README

## WebSocket client rules

- Default transport: WebSocket to stats-hub `/api/ws/live`.
- Implement reconnect with backoff; do not fall back to high-frequency HTTP for map positions.
- Scoreboard/matches: optional HTTP poll fallback at low rate only if WS silent > N seconds.

## Assets

- Map images: fetch once per map change; cache in memory or `sessionStorage` by map key.
- Tournament logos: prefer CDN static URLs; load once per slug/logo id.

## Config

- `localStorage` for stats-hub WS base URL, match id, optional stream token.
- No hub API token in overlay config.

## CDN popup (transitional)

`stream-overlay/` polls `ql-public-data` `overlay-live.json` — **migrate to WS** per BUSINESS.md. Until migrated, keep poll interval ≥ 2000 ms and do not reload logos each tick.

## Branch

Default branch: `main`.

## Skill

`skills/ql-stream-tools/SKILL.md`

## Before PR

- Confirm no new load on game servers (only stats-hub consumer).
- Test in OBS Browser Source at target resolution.
