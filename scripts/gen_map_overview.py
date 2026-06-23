#!/usr/bin/env python3
"""Generate live-overlay map PNG from pak00 BSP (top-down floors + wall edges)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MAPS_DIR = REPO / "live-overlay" / "maps"
ENTITIES_DIR = MAPS_DIR / "entities"
DEFAULT_PAK00 = Path(r"d:\QuakeLiveData\pak00")
DEFAULT_PAK00_MAPS = DEFAULT_PAK00 / "maps"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bsp_overview_lib import load_bsp, render_overview_png  # noqa: E402
from map_entities_lib import (  # noqa: E402
    build_entity_payload,
    entities_from_bsp_file,
    write_entity_json,
)


def extract_entities(map_name: str, bsp_path: Path) -> Path:
    rows = entities_from_bsp_file(bsp_path)
    payload = build_entity_payload(map_name, rows, source=str(bsp_path))
    out = ENTITIES_DIR / f"{map_name}.json"
    write_entity_json(out, payload)
    return out


def update_entities_index(map_names: list[str]) -> None:
    index_path = ENTITIES_DIR / "index.json"
    if index_path.is_file():
        index = json.loads(index_path.read_text(encoding="utf-8"))
    else:
        index = {"maps": [], "sources": {}}
    merged = sorted(set(index.get("maps") or []) | set(map_names))
    index["maps"] = merged
    index.setdefault("sources", {})
    index["sources"]["pak00"] = str(DEFAULT_PAK00)
    index_path.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("map", help="Map key / BSP stem (e.g. phrantic)")
    parser.add_argument(
        "--pak00",
        type=Path,
        default=DEFAULT_PAK00,
        help="Extracted pak00 root (maps/ + textures/)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="PNG output (default live-overlay/maps/{map}.png)",
    )
    parser.add_argument(
        "--long-edge",
        type=int,
        default=1024,
        help="Longest PNG edge in pixels",
    )
    parser.add_argument(
        "--no-entities",
        action="store_true",
        help="Skip entities/{map}.json extract",
    )
    args = parser.parse_args()

    map_name = args.map.strip().lower()
    bsp_path = args.pak00 / "maps" / f"{map_name}.bsp"
    if not bsp_path.is_file():
        print(f"missing BSP: {bsp_path}", file=sys.stderr)
        return 1

    out_png = args.output or (MAPS_DIR / f"{map_name}.png")
    bsp = load_bsp(bsp_path)
    width, height, min_x, max_x, min_y, max_y = render_overview_png(
        bsp,
        out_png,
        long_edge=args.long_edge,
        pak00=args.pak00 if args.pak00.is_dir() else None,
    )
    print(f"wrote {out_png} ({width}x{height})")
    print(
        f"bounds x=[{min_x:.0f},{max_x:.0f}] "
        f"y=[{min_y:.0f},{max_y:.0f}] (pre-transform pad; run gen_map_transforms.py)"
    )

    if not args.no_entities:
        ent_path = extract_entities(map_name, bsp_path)
        update_entities_index([map_name])
        print(f"wrote {ent_path} ({json.loads(ent_path.read_text())['entity_count']} entities)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
