#!/usr/bin/env python3
"""Build / merge entity-display.json from extracted entities + ql-spawns duel pools."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from map_entities_lib import match_coords

ITEM_FILTER = {
    "classname": [
        "weapon_*",
        "item_*",
        "ammo_*",
    ]
}

ALL_SPAWN_FILTER = {"classname": ["info_player_deathmatch"]}


def auto_middle_val(spawn_count: int) -> int:
    """QL duel pools: reject floor(n/2) closest spawns (green = n - middle_val)."""
    if spawn_count <= 0:
        return 0
    return spawn_count // 2


def duel_layer(map_name: str, entity_ids: list[int], middle_val: int | None) -> dict:
    layer: dict = {
        "id": "duel_spawns",
        "label": "Duel spawn pool",
        "mode": "duel",
        "filter": {
            "classname": "info_player_deathmatch",
            "entity_ids": entity_ids,
        },
        "default": True,
    }
    if middle_val is not None:
        layer["middle_val"] = middle_val
    return layer


def items_layer() -> dict:
    return {
        "id": "items",
        "label": "Items, weapons, ammo",
        "mode": "static",
        "filter": ITEM_FILTER,
        "gametype_filter": True,
        "default": False,
    }


def teleport_exit_layer() -> dict:
    return {
        "id": "teleport_exits",
        "label": "Teleport exits",
        "mode": "teleport",
        "default": False,
    }


def teleport_entrance_layer() -> dict:
    return {
        "id": "teleport_entrances",
        "label": "Teleport entrances",
        "mode": "teleport",
        "default": False,
    }


def all_spawns_layer() -> dict:
    return {
        "id": "all_dm_spawns",
        "label": "All deathmatch spawns",
        "mode": "static",
        "filter": ALL_SPAWN_FILTER,
        "default": False,
    }


def main() -> int:
    repo = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--entities-dir",
        type=Path,
        default=repo / "live-overlay" / "maps" / "entities",
    )
    parser.add_argument(
        "--spawns-dir",
        type=Path,
        default=repo / "live-overlay" / "maps" / "spawns",
        help="Legacy ql-spawns JSON (duel coords + middle_val)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=repo / "live-overlay" / "maps" / "entity-display.json",
    )
    parser.add_argument(
        "--merge",
        action="store_true",
        help="Merge into existing entity-display.json instead of replacing maps",
    )
    args = parser.parse_args()

    display: dict = {
        "version": 1,
        "classname_styles": {
            "weapon_*": {"color": "#60a5fa", "shape": "diamond"},
            "ammo_*": {"color": "#fb923c", "shape": "square"},
            "item_health*": {"color": "#4ade80", "shape": "circle"},
            "item_armor*": {"color": "#a78bfa", "shape": "circle"},
            "item_*": {"color": "#facc15", "shape": "circle"},
            "info_player_deathmatch": {"color": "#22c55e", "shape": "circle"},
        },
        "maps": {},
    }

    if args.merge and args.output.is_file():
        display = json.loads(args.output.read_text(encoding="utf-8"))
        display.setdefault("maps", {})

    if not args.entities_dir.is_dir():
        print(f"entities dir missing: {args.entities_dir}", file=sys.stderr)
        return 1

    for ent_path in sorted(args.entities_dir.glob("*.json")):
        if ent_path.name == "index.json":
            continue
        map_name = ent_path.stem
        ent_data = json.loads(ent_path.read_text(encoding="utf-8"))
        entities = ent_data.get("entities") or []

        layers = [items_layer(), all_spawns_layer(), teleport_exit_layer(), teleport_entrance_layer()]
        spawn_path = args.spawns_dir / f"{map_name}.json"
        if spawn_path.is_file():
            spawn_data = json.loads(spawn_path.read_text(encoding="utf-8"))
            coords = spawn_data.get("spawns") or []
            middle_val = spawn_data.get("middle_val")
            if coords:
                try:
                    entity_ids = match_coords(entities, coords)
                except ValueError as exc:
                    print(f"warn: {map_name}: {exc}", file=sys.stderr)
                    entity_ids = []
                if entity_ids:
                    mv = int(middle_val) if middle_val is not None else auto_middle_val(len(entity_ids))
                    layers.insert(0, duel_layer(map_name, entity_ids, mv))

        display["maps"][map_name] = {"layers": layers}

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(display, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {args.output} ({len(display['maps'])} maps)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
