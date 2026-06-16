# QL Tournament Stream Overlay

Local HTML overlay for OBS (or similar). **Live scores** via WebSocket to **ql-stats-hub**; tournament meta/logos from **ql-public-data** CDN — **no connection to QL Hub**.

**Documentation (HTML):** [`docs.html`](docs.html) — full guide for `stream-overlay` + `live-overlay` (map calibration, smooth, hub).  
CDN: `https://cdn.jsdelivr.net/gh/owner/ql-stream-tools@main/stream-overlay/docs.html`

Hub publishes `tournaments/{slug}/overlay-live.json` and logo assets when tournament data is synced to GitHub (jsDelivr).

## Requirements

- Tournament published from Hub to ql-public-data (`HUB_PUBLIC_PUBLISH_ENABLED=true`)
- **Tournament slug** (same as in Hub / `tournaments/{slug}/` in the repo)
- At least one **live** match (minqlx ingest / ZMQ stats on Hub)

## Quick setup

1. Open `index.html` locally (double-click or `file:///.../stream-overlay/index.html`).

2. On first load, fill in **Overlay settings** and click **Save & start**. Values are stored in **localStorage** (key `ql-overlay-config`).

3. **Public data base** — jsDelivr URL, e.g. `https://cdn.jsdelivr.net/gh/owner/ql-public-data@main`

4. **Tournament slug** — e.g. `spring-cup-2026`

5. Pick a logo from the CDN catalog (organizer adds files in Hub `overlay-logos/` and publishes).

6. Use **Edit settings** (top-right) to change values later.

### Logos (for organizers)

Drop PNG or SVG files into:

```text
ql-hub/hub/app/static/overlay-logos/
```

Hub copies them to ql-public-data on publish:

- `assets/overlay-logos.json` — catalog `[{ "id", "name", "url" }]`
- `assets/overlay-logos/{filename}` — image files

### Config fields

See `config.example.json`. Primary storage is **localStorage** (works from `file://`).

| Field | Description |
| ----- | ----------- |
| `publicDataBase` | jsDelivr / GitHub raw base URL for ql-public-data |
| `tournamentSlug` | Tournament slug (required) |
| `statsHubBase` | ql-stats-hub root URL for WebSocket live scores (recommended) |
| `pollIntervalMs` | CDN `overlay-live.json` refresh for `/connect` hints (default 30000; `0` = off) |
| `logoId` | Selected logo id from CDN catalog |
| `logoUrl` | Full CDN URL to logo image |
| `showConnect` | Show `/connect host:port` in popup |
| `popupAutoHideMs` | Auto-hide popup after N ms (`0` = stay until API says hide) |

Legacy `logoFile` (local path under `assets/logos/`) is still honored if present in saved config.

## Migration from Hub overlay API

If you previously used `apiBaseUrl` + `overlayToken`:

1. Clear overlay localStorage or open setup and re-save.
2. Set **public data base** + **tournament slug** instead of Hub URL/token.
3. Remove `HUB_OVERLAY_TOKEN` from Hub `.env` (optional — API returns 410 Gone).

## OBS Browser Source

1. **Sources** → **Browser** → create source.
2. **Local file**: browse to `stream-overlay/index.html`
3. Width **1920**, height **1080**
4. **Refresh** browser source after changing settings.

### Chroma key

The match popup uses **#00ff00** outside the card for OBS Color/Chroma Key.

## Popup behaviour

- With **stats hub URL**: WebSocket `/api/ws/live` for scores; CDN `overlay-live.json` only for `/connect` / `show_popup` (slow poll).
- Without stats hub URL: polls `overlay-live.json` every `pollIntervalMs` (legacy CDN-only mode).
- **Shows** when `show_popup: true` or **`match_id` changes**.
- **Hides** when `show_popup` is false (same match).

## Troubleshooting

| Symptom | Check |
| ------- | ----- |
| Setup form on every load | OBS isolated profile; re-save settings |
| Logo picker empty | Hub published to ql-public-data; CDN URL correct |
| 404 overlay-live.json | Tournament slug correct; Hub publish enabled; live match exists |
| “No live matches” | Match status `live` in Hub for this tournament |
| Deprecated Hub config error | Clear localStorage; use CDN fields only |

## Tournament regulations

Official event rules live in **ql-public-data**, not in this folder:

```text
tournaments/{slug}/regulations.md
```

Example (Fast Learning Cup):

```text
https://cdn.jsdelivr.net/gh/alexeytihomirov/ql-public-data@main/tournaments/fast-learning-cup/regulations.md
```

Generic network/cvars guide: `ql-stream-tools/player-guide/`.

## Architecture

```text
Game VPS ──telemetry──► ql-stats-hub ◄── WebSocket ── OBS stream-overlay
              │
              └── ZMQ ──► QL Hub ──git push──► ql-public-data ──CDN──► meta / connect hints
```
