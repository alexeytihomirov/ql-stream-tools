#!/usr/bin/env python3
"""Batch-extract map entities from pak00, packs/, and optional pk3 dirs."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from map_entities_lib import (
    build_entity_payload,
    discover_map_files,
    entities_from_bsp_file,
    entities_from_map_text,
    normalize_map_name,
    read_map_text_from_file,
    read_map_text_from_pk3,
    write_entity_json,
)


def main() -> int:
    repo = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--pak00",
        type=Path,
        default=Path(r"d:\QuakeLiveData\pak00"),
        help="Extracted pak00 directory",
    )
    parser.add_argument(
        "--packs",
        type=Path,
        default=Path(r"d:\QuakeLiveData\packs"),
        help="Directory with custom map pack folders",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=repo / "live-overlay" / "maps" / "entities",
    )
    parser.add_argument(
        "--pk3-dir",
        action="append",
        default=[],
        type=Path,
        help="Extra directory to scan for *.pk3 (repeatable)",
    )
    parser.add_argument(
        "--only-maps",
        type=Path,
        default=None,
        help="JSON with map keys to extract (e.g. live-overlay/maps/map_transforms.json)",
    )
    args = parser.parse_args()

    discovered = discover_map_files(
        pak00=args.pak00 if args.pak00.is_dir() else None,
        packs=args.packs if args.packs.is_dir() else None,
        extra_pk3_dirs=args.pk3_dir or None,
    )
    if not discovered:
        print("no map files found", file=sys.stderr)
        return 1

    only: set[str] | None = None
    if args.only_maps:
        data = json.loads(args.only_maps.read_text(encoding="utf-8"))
        maps_obj = data.get("maps") if isinstance(data, dict) else None
        if isinstance(maps_obj, dict):
            only = {
                normalize_map_name(name)
                for name in maps_obj
                if name and not str(name).startswith("_")
            }

    args.output_dir.mkdir(parents=True, exist_ok=True)
    written: list[str] = []
    skipped: list[str] = []

    for map_name in sorted(discovered):
        if only is not None and map_name not in only:
            continue
        path = discovered[map_name]
        if path.suffix.lower() == ".pk3":
            text = read_map_text_from_pk3(path, map_name)
            source = f"pk3:{path.name}"
            if text is None:
                print(f"skip {map_name}: map lump missing in {path}", file=sys.stderr)
                skipped.append(map_name)
                continue
            entities = entities_from_map_text(text)
        elif path.suffix.lower() == ".bsp":
            entities = entities_from_bsp_file(path)
            source = str(path)
        else:
            text = read_map_text_from_file(path)
            source = str(path)
            if text is None:
                print(f"skip {map_name}: unreadable {path}", file=sys.stderr)
                skipped.append(map_name)
                continue
            entities = entities_from_map_text(text)
        payload = build_entity_payload(map_name, entities, source=source)
        out = args.output_dir / f"{map_name}.json"
        write_entity_json(out, payload)
        written.append(map_name)
        print(f"wrote {out.name} ({len(entities)} entities)")

    index = {
        "maps": sorted(written),
        "sources": {
            "pak00": str(args.pak00) if args.pak00.is_dir() else None,
            "packs": str(args.packs) if args.packs.is_dir() else None,
        },
    }
    (args.output_dir / "index.json").write_text(
        json.dumps(index, indent=2) + "\n",
        encoding="utf-8",
    )
    if only:
        missing = sorted(name for name in only if name not in written)
        for name in missing:
            print(f"missing {name}: no .map/.bsp source", file=sys.stderr)
    print(f"done: {len(written)} maps -> {args.output_dir}")
    return 0 if written else 1


if __name__ == "__main__":
    raise SystemExit(main())
