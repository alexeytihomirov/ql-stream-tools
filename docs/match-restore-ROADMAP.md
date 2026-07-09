# Match restore — roadmap (checkpoint / cfg / overlay)

Living backlog for checkpoint generation, dashboard editor, and in-game restore.
Verified restore apply path: `ql-server-core` minqlx v57+ (`match_restore_lab.py`).

## Done (2026-07)

| Area | Status |
|------|--------|
| Restore apply order | pickup lock → time → player state → items → pause → velocity |
| Live HUD before pause | brief unpause + `setmatchtime` before final pause |
| Item resolve | fresh `find_map_item_entity` scan per apply (no stale runtime cache) |
| Pending items | hide + `qlhub_item_respawn_think` schedule (v57) |
| Client cfg | `!restorecp` without `say` (`checkpoint_codec.cfg_client_text`) |
| Dashboard cfg parse | `QLRestoreEditor.parseCfgTextToDraft` + **Sync form from cfg** |
| Telemetry → checkpoint | `stream_telemetry`: weapon, loadout, ammo, vx/vy/vz → replay → builder |

## Item pickup — game time

**Already in pipeline** (not wall clock for restore):

| Stage | Field |
|-------|--------|
| minqlx `pickup_telemetry` | `game_time` (ms, level.time at pickup) |
| stats-hub ingest | `ItemEventIn.game_time` → replay `game_time_ms` |
| checkpoint builder | `pickup_ms` internal → `at_ms = pickup_ms + respawn_ms` |

Legacy replays with raw `level.time` in pickup rows are rebased via `_resolve_pickup_game_time_ms()`.
No separate `pickup_ms` column in JSONL — use `game_time_ms` on `event=pickup`.

## Open / next

### Minimap / replay scrub (ql-stream-tools)

- **Kinematics on minimap:** when scrubbing timeline, interpolate position between telemetry samples and **extrapolate** with `vx/vy/vz` between posts (10 Hz active / 1 Hz idle). Reduces “steppy” dots without faking data outside velocity cone.
- Optional: show velocity vector on hover (debug overlay only).

### Telemetry gaps (needs ql-server-core deploy)

- Powerups in checkpoint (`quad`, `haste`, …) — out of scope v1 restore apply; document only.
- Bot flag in replay positions for restore slot remap hints.

### Dashboard editor

- Bidirectional sync: form edit → cfg textarea live (today: encode API + `buildCfgTextFromState`; cfg manual edit → **Sync form from cfg**).
- Item rows in form (today: items only in cfg + scrub filter).
- Validate parsed cfg against `POST /api/checkpoint/encode` before copy.

### stats-hub

- Archive merge: final score / loadout from match summary when replay position row missing fields.
- Unit test fixture with full inventory + velocity replay row.

## Related docs

- `ql-server-core/docs/match-restore-format.md` — QLR2 + cfg lines
- `ql-server-core/docs/match-restore-REQUIREMENTS.md` — acceptance
- `ql-stats-hub/stats_hub/checkpoint_builder.py` — replay → checkpoint
- `live-overlay/dashboard/views/restore-editor.js` — dashboard widget
