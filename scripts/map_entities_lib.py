"""Parse Quake 3 / Quake Live .map entity lumps (pk3, extracted pak dirs)."""
from __future__ import annotations

import json
import re
import struct
import zipfile
from pathlib import Path

_PAIR = re.compile(r'"([^"]+)"\s+"([^"]*)"')
_ENTITY_MARKER = re.compile(r"// entity (\d+)\s*\r?\n")
# Three world-space points per brush plane (ignore texture coordinate tuples).
_BRUSH_PLANE = re.compile(
    r"\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)"
    r"\s*\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)"
    r"\s*\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)",
    re.MULTILINE,
)

# Overlay-relevant defaults; extract keeps every entity with origin.
ITEM_CLASS_PREFIXES = ("weapon_", "item_", "ammo_")
SPAWN_CLASSNAMES = frozenset(
    {
        "info_player_deathmatch",
        "info_player_start",
        "info_player_team_red",
        "info_player_team_blue",
        "info_player_team_yellow",
        "info_player_intermission",
    }
)

TELEPORT_EXIT_CLASSNAMES = frozenset({"target_position", "misc_teleporter_dest"})
TELEPORT_TRIGGER_CLASSNAMES = frozenset({"trigger_teleport", "misc_teleporter"})


def normalize_map_name(name: str) -> str:
    key = name.strip().lower()
    if key.endswith("_converted"):
        key = key[: -len("_converted")]
    if key.endswith(".map"):
        key = key[: -len(".map")]
    return key


def map_name_from_path(path: Path) -> str:
    return normalize_map_name(path.stem)


def _brace_block(text: str, start: int = 0) -> tuple[str, int] | None:
    open_idx = text.find("{", start)
    if open_idx < 0:
        return None
    depth = 0
    for i in range(open_idx, len(text)):
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[open_idx + 1 : i], i + 1
    return None


def read_entity_lump_from_bsp(bsp_path: Path) -> str | None:
    data = bsp_path.read_bytes()
    if len(data) < 8 or data[:4] != b"IBSP":
        return None
    lumps = [struct.unpack_from("<ii", data, 8 + i * 8) for i in range(17)]
    loc, length = lumps[0]
    if loc < 0 or length <= 0 or loc + length > len(data):
        return None
    return data[loc : loc + length].decode("latin-1", errors="replace")


def parse_bsp_entity_blocks(text: str) -> list[tuple[int, dict[str, str], str]]:
    """Parse IBSP entity lump ({ key value } blocks without // entity markers)."""
    out: list[tuple[int, dict[str, str], str]] = []
    pos = 0
    ent_id = 0
    while pos < len(text):
        block = _brace_block(text, pos)
        if not block:
            break
        inner, next_pos = block
        pairs = dict(_PAIR.findall(inner))
        if pairs:
            ent_id += 1
            out.append((ent_id, pairs, inner))
        pos = next_pos
    return out


def parse_entity_blocks(text: str) -> list[tuple[int, dict[str, str], str]]:
    markers = list(_ENTITY_MARKER.finditer(text))
    if not markers:
        return []

    out: list[tuple[int, dict[str, str], str]] = []
    for idx, match in enumerate(markers):
        ent_id = int(match.group(1))
        body_start = match.end()
        body_end = markers[idx + 1].start() if idx + 1 < len(markers) else len(text)
        chunk = text[body_start:body_end]
        block = _brace_block(chunk)
        if not block:
            continue
        inner, _ = block
        pairs = dict(_PAIR.findall(inner))
        if pairs:
            out.append((ent_id, pairs, chunk))
    return out


def brush_centroid(chunk: str) -> tuple[float, float, float] | None:
    """Approximate center of a brushDef volume from its plane corner points."""
    points: list[tuple[float, float, float]] = []
    for match in _BRUSH_PLANE.finditer(chunk):
        for group in (1, 4, 7):
            points.append(
                (float(match.group(group)), float(match.group(group + 1)), float(match.group(group + 2)))
            )
    if not points:
        return None
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    zs = [p[2] for p in points]
    return (sum(xs) / len(xs), sum(ys) / len(ys), sum(zs) / len(zs))


def _entity_attrs(pairs: dict[str, str]) -> dict[str, str]:
    attrs = {k: v for k, v in pairs.items() if k not in {"classname", "origin"}}
    return _enrich_gametype_attrs(attrs)


def _enrich_gametype_attrs(attrs: dict[str, str]) -> dict[str, str]:
    """Derive overlay not_gametype tokens from Q3 notsingle/notfree/notteam spawn keys."""
    if not attrs:
        return attrs
    blocked: list[str] = []
    if attrs.get("notsingle") == "1":
        blocked.append("duel")
    if attrs.get("notfree") == "1":
        blocked.extend(["ffa", "dm", "duel"])
    if attrs.get("notteam") == "1":
        blocked.extend(["tdm", "ctf", "ca"])
    if not blocked:
        return attrs
    out = dict(attrs)
    tokens = out.get("not_gametype", "").split()
    for token in blocked:
        if token not in tokens:
            tokens.append(token)
    out["not_gametype"] = " ".join(tokens)
    return out


def entity_row(ent_id: int, pairs: dict[str, str], *, x: float, y: float, z: float) -> dict:
    classname = pairs.get("classname", "")
    attrs = _entity_attrs(pairs)
    row: dict = {
        "id": ent_id,
        "classname": classname,
        "x": x,
        "y": y,
        "z": z,
    }
    if attrs:
        row["attrs"] = attrs
    return row


def entity_row_from_pairs(ent_id: int, pairs: dict[str, str]) -> dict | None:
    origin = pairs.get("origin")
    if not origin:
        return None
    try:
        x, y, z = (float(v) for v in origin.split())
    except ValueError:
        return None
    return entity_row(ent_id, pairs, x=x, y=y, z=z)


def entities_from_bsp_file(bsp_path: Path) -> list[dict]:
    text = read_entity_lump_from_bsp(bsp_path)
    if text is None:
        return []
    rows: list[dict] = []
    for ent_id, pairs, _chunk in parse_bsp_entity_blocks(text):
        row = entity_row_from_pairs(ent_id, pairs)
        if row:
            rows.append(row)
    return rows


def entities_from_map_text(text: str) -> list[dict]:
    """Extract overlay entities: origin-based points + brush trigger_teleport centroids.

    trigger_push / jumppads are intentionally omitted (not overlay markers).
    """
    rows: list[dict] = []
    for ent_id, pairs, chunk in parse_entity_blocks(text):
        classname = pairs.get("classname", "")
        row = entity_row_from_pairs(ent_id, pairs)
        if row:
            rows.append(row)
            continue
        if classname not in TELEPORT_TRIGGER_CLASSNAMES:
            continue
        centroid = brush_centroid(chunk)
        if not centroid:
            continue
        rows.append(entity_row(ent_id, pairs, x=centroid[0], y=centroid[1], z=centroid[2]))
    return rows


def index_by_classname(entities: list[dict]) -> dict[str, list[int]]:
    out: dict[str, list[int]] = {}
    for ent in entities:
        cls = ent.get("classname") or ""
        out.setdefault(cls, []).append(int(ent["id"]))
    for cls in out:
        out[cls].sort()
    return out


def read_map_text_from_pk3(pk3_path: Path, map_name: str) -> str | None:
    map_entry = f"maps/{map_name}.map"
    with zipfile.ZipFile(pk3_path) as zf:
        names = {n.replace("\\", "/").lower(): n for n in zf.namelist()}
        key = map_entry.lower()
        if key not in names:
            # try _converted variant inside pk3
            alt = f"maps/{map_name}_converted.map".lower()
            if alt not in names:
                return None
            key = alt
        raw = zf.read(names[key])
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1", errors="replace")


def read_map_text_from_file(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="latin-1", errors="replace")


def discover_map_files(
    *,
    pak00: Path | None = None,
    packs: Path | None = None,
    extra_pk3_dirs: list[Path] | None = None,
) -> dict[str, Path]:
    """Return map_name -> .map or .bsp file path (.map wins over .bsp)."""
    found: dict[str, Path] = {}

    def add(path: Path, *, prefer: bool = False) -> None:
        if not path.is_file():
            return
        suffix = path.suffix.lower()
        if suffix not in {".map", ".bsp"}:
            return
        key = map_name_from_path(path)
        if prefer or key not in found or found[key].suffix.lower() == ".bsp":
            found[key] = path

    if pak00:
        maps_dir = pak00 / "maps"
        if maps_dir.is_dir():
            for path in sorted(maps_dir.glob("*.bsp")):
                add(path)
            for path in sorted(maps_dir.glob("*.map")):
                add(path, prefer=True)

    if packs:
        for pack_dir in sorted(packs.iterdir()):
            if not pack_dir.is_dir():
                continue
            maps_dir = pack_dir / "maps"
            if maps_dir.is_dir():
                for path in sorted(maps_dir.glob("*.map")):
                    add(path)
            for path in sorted(pack_dir.glob("*.map")):
                add(path)

    if extra_pk3_dirs:
        for root in extra_pk3_dirs:
            if not root.is_dir():
                continue
            for pk3 in sorted(root.rglob("*.pk3")):
                key = normalize_map_name(pk3.stem)
                found.setdefault(key, pk3)

    return found


def build_entity_payload(
    map_name: str,
    entities: list[dict],
    *,
    source: str,
) -> dict:
    return {
        "map_name": normalize_map_name(map_name),
        "source": source,
        "entity_count": len(entities),
        "entities": entities,
        "by_classname": index_by_classname(entities),
        "teleports": build_teleport_graph(entities),
    }


def write_entity_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def match_coords(
    entities: list[dict],
    coords: list[dict],
    *,
    epsilon: float = 2.0,
) -> list[int]:
    ids: list[int] = []
    used: set[int] = set()
    for target in coords:
        tx, ty, tz = float(target["x"]), float(target["y"]), float(target["z"])
        best_id = None
        best_d = None
        for ent in entities:
            eid = int(ent["id"])
            if eid in used:
                continue
            dx = abs(float(ent["x"]) - tx)
            dy = abs(float(ent["y"]) - ty)
            dz = abs(float(ent["z"]) - tz)
            if dx <= epsilon and dy <= epsilon and dz <= epsilon:
                d = dx + dy + dz
                if best_d is None or d < best_d:
                    best_d = d
                    best_id = eid
        if best_id is None:
            raise ValueError(f"no entity match for ({tx}, {ty}, {tz})")
        used.add(best_id)
        ids.append(best_id)
    return ids


def classify_prefix(classname: str) -> str:
    if classname in SPAWN_CLASSNAMES:
        return "spawn"
    for prefix in ITEM_CLASS_PREFIXES:
        if classname.startswith(prefix):
            return "item"
    return "other"


def build_teleport_graph(entities: list[dict]) -> dict:
    """Link trigger_teleport / misc_teleporter entrances to exit targetnames.

    target_position entities used only as jumppad landings (trigger_push) must not
    appear as teleport exits unless linked from a teleport entrance.
    """
    by_name: dict[str, dict] = {}
    pairs: list[dict] = []
    linked_exit_ids: set[int] = set()

    for ent in entities:
        attrs = ent.get("attrs") or {}
        targetname = attrs.get("targetname")
        if targetname:
            by_name[str(targetname)] = ent

    for ent in entities:
        if ent.get("classname") not in TELEPORT_TRIGGER_CLASSNAMES:
            continue
        attrs = ent.get("attrs") or {}
        target_key = attrs.get("target")
        if not target_key:
            continue
        dest = by_name.get(str(target_key))
        if not dest or dest.get("classname") not in TELEPORT_EXIT_CLASSNAMES:
            continue
        exit_id = int(dest["id"])
        linked_exit_ids.add(exit_id)
        pairs.append(
            {
                "entrance_id": int(ent["id"]),
                "exit_id": exit_id,
                "entrance_classname": ent.get("classname"),
                "exit_classname": dest.get("classname"),
            }
        )

    exits = [
        ent
        for ent in entities
        if int(ent["id"]) in linked_exit_ids
    ]

    return {
        "exit_count": len(exits),
        "pair_count": len(pairs),
        "pairs": pairs,
        "exits": [{"id": int(e["id"]), "classname": e.get("classname")} for e in exits],
    }
