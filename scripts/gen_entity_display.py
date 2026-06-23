#!/usr/bin/env python3
"""Generate entity-display.json layer configs for overlay maps with entity dumps."""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ENTITIES_DIR = REPO / "live-overlay" / "maps" / "entities"
DISPLAY_PATH = REPO / "live-overlay" / "maps" / "entity-display.json"
TRANSFORMS_PATH = REPO / "live-overlay" / "maps" / "map_transforms.json"

STANDARD_LAYERS = [
    {
        "id": "duel_spawns",
        "label": "Duel spawn pool",
        "mode": "duel",
        "filter": {"classname": "info_player_deathmatch"},
        "gametype_filter": False,
        "default": False,
    },
    {
        "id": "items",
        "label": "Items, weapons, ammo",
        "mode": "static",
        "filter": {"classname": ["weapon_*", "item_*", "ammo_*"]},
        "gametype_filter": True,
        "default": True,
    },
    {
        "id": "all_dm_spawns",
        "label": "All deathmatch spawns",
        "mode": "static",
        "filter": {"classname": ["info_player_deathmatch"]},
        "gametype_filter": False,
        "default": False,
    },
    {
        "id": "teleport_exits",
        "label": "Teleport exits",
        "mode": "teleport",
        "default": False,
    },
    {
        "id": "teleport_entrances",
        "label": "Teleport entrances",
        "mode": "teleport",
        "default": False,
    },
]


def spawn_count(entity_path: Path) -> int:
    data = json.loads(entity_path.read_text(encoding="utf-8"))
    by_cls = data.get("by_classname") or {}
    ids = by_cls.get("info_player_deathmatch") or []
    if ids:
        return len(ids)
    count = 0
    for ent in data.get("entities") or []:
        if ent.get("classname") == "info_player_deathmatch":
            count += 1
    return count


def layers_for_map(entity_path: Path) -> list[dict]:
    layers = [dict(layer) for layer in STANDARD_LAYERS]
    spawns = spawn_count(entity_path)
    if spawns > 0:
        for layer in layers:
            if layer["id"] == "duel_spawns":
                layer["middle_val"] = max(1, math.floor(spawns / 2))
                break
    return layers


def overlay_map_names() -> list[str]:
    if not TRANSFORMS_PATH.is_file():
        return sorted(p.stem for p in ENTITIES_DIR.glob("*.json") if p.name != "index.json")
    data = json.loads(TRANSFORMS_PATH.read_text(encoding="utf-8"))
    maps_obj = data.get("maps") or {}
    return sorted(
        name
        for name in maps_obj
        if name and not str(name).startswith("_")
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--display-path",
        type=Path,
        default=DISPLAY_PATH,
    )
    parser.add_argument(
        "--entities-dir",
        type=Path,
        default=ENTITIES_DIR,
    )
    args = parser.parse_args()

    if args.display_path.is_file():
        display = json.loads(args.display_path.read_text(encoding="utf-8"))
    else:
        display = {"version": 1, "classname_styles": {}, "maps": {}}

    if not display.get("classname_styles"):
        default_styles_path = DISPLAY_PATH
        if default_styles_path.is_file():
            base = json.loads(default_styles_path.read_text(encoding="utf-8"))
            display["classname_styles"] = base.get("classname_styles") or {}

    maps_out = display.setdefault("maps", {})
    written: list[str] = []
    missing: list[str] = []
    new_maps: dict = {}

    for map_name in overlay_map_names():
        entity_path = args.entities_dir / f"{map_name}.json"
        if not entity_path.is_file():
            missing.append(map_name)
            continue
        new_maps[map_name] = {"layers": layers_for_map(entity_path)}
        written.append(map_name)

    display["maps"] = new_maps

    args.display_path.parent.mkdir(parents=True, exist_ok=True)
    args.display_path.write_text(json.dumps(display, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {args.display_path} ({len(written)} maps)")
    for name in missing:
        print(f"missing entities: {name}", file=sys.stderr)
    return 0 if written else 1


if __name__ == "__main__":
    raise SystemExit(main())
