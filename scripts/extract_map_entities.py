#!/usr/bin/env python3
"""Extract all positioned entities from a .map file or pk3 archive."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from map_entities_lib import (
    build_entity_payload,
    entities_from_map_text,
    normalize_map_name,
    read_map_text_from_file,
    read_map_text_from_pk3,
    write_entity_json,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "source",
        type=Path,
        help="Path to .map file or .pk3 archive",
    )
    parser.add_argument(
        "map_name",
        nargs="?",
        help="Map name when source is pk3 (e.g. bloodrun)",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Write JSON (default: stdout)",
    )
    args = parser.parse_args()

    src = args.source
    if not src.is_file():
        print(f"not found: {src}", file=sys.stderr)
        return 1

    if src.suffix.lower() == ".pk3":
        if not args.map_name:
            print("map_name required for pk3 input", file=sys.stderr)
            return 1
        map_name = normalize_map_name(args.map_name)
        text = read_map_text_from_pk3(src, map_name)
        if text is None:
            print(f"maps/{map_name}.map not in {src}", file=sys.stderr)
            return 1
        source_label = f"pk3:{src.name}"
    else:
        map_name = normalize_map_name(args.map_name or src.stem)
        text = read_map_text_from_file(src)
        source_label = str(src)

    entities = entities_from_map_text(text)
    payload = build_entity_payload(map_name, entities, source=source_label)
    out_text = __import__("json").dumps(payload, indent=2) + "\n"

    if args.output:
        write_entity_json(args.output, payload)
        print(f"wrote {args.output} ({len(entities)} entities)")
    else:
        sys.stdout.write(out_text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
