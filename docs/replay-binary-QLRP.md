# QLRP — Quake Live Replay Packed (v1)

Compact on-disk replay format for stats-hub storage and demo import.
Human-readable JSON remains available for debug (`--json`, API expand).

## Why

| Source | Size (bloodrun POV duel, ~10 min) |
|--------|-----------------------------------|
| `.dm_91` | ~1.8 MB |
| `.replay.json` (full snapshot rate) | ~11 MB |
| `.qlrp` v1 | ~0.5 MB (see `qldemo-dump --full`) |

Live path today: stats-hub `ReplayRecorder` → `.jsonl` / `.jsonl.gz` (verbose keys per line).
Checkpoint builder and restore editor consume **expanded** event arrays — not raw files.

QLRP is an internal storage codec. Producers encode; consumers decode to the same canonical
`{ meta, events }` shape used by `checkpoint_builder.py` and dashboard replay scrub.

## File layout (little-endian)

```
Header
  magic       u32   "QLRP"
  version     u8    1
  flags       u8    reserved (0)
  map_len     u8    + map_name utf8
  gt_len      u8    + gametype utf8
  wall_start  u32   wall ms anchor (match_start.t)
  game_start  u32   game ms anchor (match_start.game_time_ms)
  roster_cnt  u8
  roster[]    u8 cn, u8 name_len, name utf8

String table (pickup classnames)
  count u16
  strings: u8 len + utf8

Pickups
  count u16
  row: u32 game_time_ms, u16 str_idx, u8 client_num (255=unknown), i16 x,y,z (0.1 qu)

Position tracks
  track_count u8
  per track:
    u8  client_num
    u32 sample_count
    u32 first_game_time_ms
    (count-1) deltas: u16 dt_ms, or u16 0xFFFF + u32 wide dt
    samples: i16 x,y,z (0.1 qu), u8 flags, optional h,a,w,lo,vx,vy,vz
```

Coords and velocity use **fixed 0.1 qu** scale (`i16`).

## Decode → canonical events

Decoder emits:

1. `match_start` from header anchors
2. `positions` — merged across tracks by `game_time_ms` (duel players in one row)
3. `pickup` rows
4. *(replay-v2 / demo import only)* `projectiles` — sparse frames with `weapon`, `weapon_slug`, trajectory

### replay-v2 JSON (`meta.schema`)

| Event | Key fields |
|-------|------------|
| `match_start` | `map_name`, `gametype`, `game_time_ms` |
| `positions` | `players[]`: `clientNum`, `nickname`, `x/y/z`, `health`, `armor`, `weapon`, `vx/vy/vz`, optional `powerups[]` |
| `pickup` | `item` (restore classname), `x/y/z`, `action`, `game_time_ms` — keyed by classname+coords, not entity_id |
| `projectiles` | `projectiles[]`: `eid`, `weapon`, `weapon_slug`, `clientNum`, `x/y/z`, `vx/vy/vz` (RL/GL/PG only, UDT-aligned) |
| `impacts` | `impacts[]`: `kind` (`bullet`/`shaft`/`explosion`/`plasma`/`missile`), `weapon`, `weapon_slug`, `x/y/z` |
| `beams` | `beams[]`: rail `x0/y0/z0` → `x1/y1/z1`, `clientNum`, `weapon_slug` |

Entity events in dm_91 are often encoded in `eType` (not `event` field); decoder normalizes per UDT `plug_in_custom_parser`.

Wall `t` on expanded events: `wall_start + (game_time_ms - game_start)`.

## Code (ql-stream-tools)

| Path | Role |
|------|------|
| `live-overlay/lib/qlreplay/` | encode/decode |
| `tools/qldemo-dump.mjs` | `--full` → `.qlrp`, `--json` → debug JSON |

## Rollout (planned)

| Phase | Repo | Work |
|-------|------|------|
| **1** | ql-stream-tools | QLRP v1 encode/decode, demo CLI (this doc) |
| **2** | ql-stats-hub | `ReplayRecorder` write `.qlrp` or `.qlrp.gz`; API decode on read |
| **3** | ql-stream-tools | dashboard: accept qlrp upload; worker decode |
| **4** | ql-stream-tools | QLRP v2: projectile tracks (after parser stable) |
| **5** | optional | subsample positions to 10 Hz on encode (live parity) |

## Alternatives considered

| Option | Verdict |
|--------|---------|
| MessagePack/CBOR | smaller than JSON, still verbose keys; no columnar win |
| protobuf | schema rigidity + codegen; overkill for 3 event kinds |
| gzip JSONL only | helps; QLRP smaller + faster decode |
| reuse `.dm_91` | wrong abstraction; scrub needs derived timeline |

## Debug

```bash
node tools/qldemo-dump.mjs demos/foo.dm_91 --full --json
```

Compare `qlrp_bytes` vs `replay_json_bytes`; `qlrp_roundtrip_positions` must match source position count.
