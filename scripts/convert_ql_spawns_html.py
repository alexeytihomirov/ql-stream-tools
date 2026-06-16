#!/usr/bin/env python3
"""Convert Memento_Mori ql-spawns/*.html duel spawn data to live-overlay JSON."""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

_SPAWN_LINE = re.compile(
    r"spawns\[(?P<idx>\d+)\]\s*=\s*\[(?P<coords>[^\]]+)\]",
    re.MULTILINE,
)
_SPAWN_COUNT = re.compile(r"var\s+spawnCount\s*=\s*(?P<n>\d+)")
_MIDDLE_VAL = re.compile(r"var\s+middleVal\s*=\s*(?P<n>\d+)")


def parse_ql_spawns_html(text: str, *, map_name: str) -> dict:
    count_m = _SPAWN_COUNT.search(text)
    middle_m = _MIDDLE_VAL.search(text)
    if not count_m or not middle_m:
        raise ValueError(f"{map_name}: spawnCount/middleVal not found")

    spawn_count = int(count_m.group("n"))
    middle_val = int(middle_m.group("n"))
    by_idx: dict[int, dict[str, float]] = {}

    for m in _SPAWN_LINE.finditer(text):
        idx = int(m.group("idx"))
        parts = [float(p.strip()) for p in m.group("coords").split(",")]
        if len(parts) < 3:
            continue
        by_idx[idx] = {"x": parts[0], "y": parts[1], "z": parts[2]}

    spawns = [by_idx[i] for i in sorted(by_idx) if i in by_idx]
    if len(spawns) != spawn_count:
        print(
            f"warn: {map_name}: expected {spawn_count} spawns, parsed {len(spawns)}",
            file=sys.stderr,
        )

    return {
        "map_name": map_name,
        "source": "ql-spawns/Memento_Mori",
        "middle_val": middle_val,
        "spawns": spawns,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=Path(r"d:\QuakeLiveData\ql-spawns"),
        help="Directory with *.html spawn visualizations",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "live-overlay" / "maps" / "spawns",
    )
    args = parser.parse_args()

    if not args.input_dir.is_dir():
        print(f"input dir missing: {args.input_dir}", file=sys.stderr)
        return 1

    args.output_dir.mkdir(parents=True, exist_ok=True)
    written = 0
    for html in sorted(args.input_dir.glob("*.html")):
        map_name = html.stem.lower()
        text = html.read_text(encoding="utf-8", errors="replace")
        if not _SPAWN_COUNT.search(text) or not _MIDDLE_VAL.search(text):
            print(f"skip {html.name} (not a spawn map)")
            continue
        payload = parse_ql_spawns_html(text, map_name=map_name)
        out = args.output_dir / f"{map_name}.json"
        out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {out.name} ({len(payload['spawns'])} spawns)")
        written += 1

    index = {
        "maps": sorted(p.stem for p in args.output_dir.glob("*.json") if p.name != "index.json"),
        "source": "ql-spawns/Memento_Mori",
    }
    (args.output_dir / "index.json").write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    print(f"done: {written} maps -> {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
