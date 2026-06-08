# QL Tournament Stream Overlay

Local HTML overlay for OBS (or similar). Polls **QL Hub** `GET /api/overlay/live` when an overlay token is configured — not part of the Hub admin UI.

Official logos are served by the Hub **without a token** (`GET /api/overlay/logos`).

## Requirements

- QL Hub running (logos work with Hub URL only)
- **Live match popups** need `HUB_OVERLAY_TOKEN` on the Hub and the same token in overlay settings (see `ql-hub/.env.example`)
- At least one **live** match in the tournament (ingest / Hub bracket) for popups

## Quick setup

1. Open `index.html` locally (double-click or `file:///.../stream-overlay/index.html`).

2. On first load, fill in the **Overlay settings** form and click **Save & start**. Values are stored in **localStorage** (key `ql-overlay-config`) in that browser — no `config.json` file is loaded.

3. Enter **Hub URL** — the form loads official logos from the Hub (no token). Pick one from the thumbnails.

4. **Overlay token** is optional: leave empty to show only the logo/branding; add a token from the organizer for live match popups.

5. Use **Edit settings** (top-right) to change values later.

### Hub logos (for organizers)

Drop PNG or SVG files into:

```text
ql-hub/hub/app/static/overlay-logos/
```

They appear automatically at:

- `GET /api/overlay/logos` — JSON `[{ "id", "name", "url" }]`
- `GET /overlay-logos/{filename}` — direct image URL (used by the overlay)

Restart Hub after adding files. Example placeholder: `ql-hub-default.svg`.

### Config fields

See `config.example.json` for the same field names and example values. You can copy values from that file into the setup form manually.

| Field | Description |
| ----- | ----------- |
| `apiBaseUrl` | Hub URL, e.g. `http://77.42.69.119:8080` |
| `overlayToken` | Optional; same as `HUB_OVERLAY_TOKEN` on the Hub for live popups |
| `tournamentId` | Optional; leave empty for all live matches |
| `pollIntervalMs` | Poll interval (default 2000) |
| `logoId` | Selected logo id from Hub catalog |
| `logoUrl` | Full Hub URL to logo image (`/overlay-logos/...`) |
| `showConnect` | Show `/connect host:port` in popup |
| `popupAutoHideMs` | Auto-hide popup after N ms (`0` = stay until API says hide) |

**Note:** `config.example.json` is reference only. Primary storage is **localStorage** so the overlay works from `file://` without a local web server.

Legacy `logoFile` (local path under `assets/logos/`) is still honored if present in saved config.

## OBS Browser Source

1. **Sources** → **Browser** → create source.
2. **Local file**: browse to `stream-overlay/index.html`  
   Or **URL**: `file:///D:/QuakeLiveData/QL%20Server/stream-overlay/index.html` (encode spaces).
3. Width **1920**, height **1080** (matches `overlay.css` layout).
4. Check **Shutdown source when not visible** off if you want polling while hidden.
5. **Refresh** browser source after changing settings (or use **Edit settings** in the overlay).

### Chroma key (green popup border)

The match popup uses **#00ff00** outside the card so OBS can key it:

1. Add a **Color Key** or **Chroma Key** filter on the browser source.
2. Key color: `#00ff00` (green).
3. Tune similarity/smoothness until the green frame is gone and the dark card remains.

The page background stays **transparent**; only the popup frame is green.

## Popup behaviour

- When `overlayToken` is set, polls `/api/overlay/live?token=…&tournament_id=…` every `pollIntervalMs`.
- **Shows** when Hub sets `show_popup: true` on the live match, or when **`match_id` changes** (new match).
- **Hides** when `show_popup` is false (same match).
- Player lines: nickname, score, kills, deaths from Hub live stats.
- Without a token, no polling — logo/branding only.

## Troubleshooting

| Symptom | Check |
| ------- | ----- |
| Setup form on every load | OBS may use an isolated profile; save settings once per browser source / clear site data resets localStorage |
| Logo picker empty | Hub URL correct; files in `ql-hub/hub/app/static/overlay-logos/`; Hub restarted |
| Could not load logos / CORS | Hub CORS allows `*` origins (default); Hub reachable from browser |
| 401 / Invalid overlay token | `overlayToken` matches Hub `HUB_OVERLAY_TOKEN` |
| 503 overlay token not configured | Set `HUB_OVERLAY_TOKEN` in Hub `.env` and restart Hub |
| “Logo only” status | Normal when token is empty; add token for live popups |
| “No live matches” | Match status `live` in Hub DB for your `tournamentId` |
| Logo missing | Pick a logo in settings or check `logoUrl` loads in browser |

## Files

```text
stream-overlay/
  index.html
  overlay.css
  overlay.js
  config.example.json   ← field reference (not loaded at runtime)
  assets/logos/         ← optional local logos (legacy logoFile)
  README.md

ql-hub/hub/app/static/overlay-logos/   ← official Hub logos (PNG/SVG)
```
