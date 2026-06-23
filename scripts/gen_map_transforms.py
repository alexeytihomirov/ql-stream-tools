#!/usr/bin/env python3
"""Generate live-overlay/maps/map_transforms.json from map PNGs and bounds sources.

Primary bounds: Memento_Mori ql-spawns HTML (mapOrigin / mapEnd).
Fallback: BSP entity origins from pak00 + median padding learned from ql-spawns maps.
Aspect fix: when overlay PNG aspect differs from ql-spawns visSize, expand world Y span.
"""
from __future__ import annotations

import argparse
import json
import re
import statistics
import struct
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    raise SystemExit("pip install Pillow")

REPO = Path(__file__).resolve().parents[1]
MAPS_DIR = REPO / "live-overlay" / "maps"
TRANSFORMS_PATH = MAPS_DIR / "map_transforms.json"
SPAWNS_DIR = MAPS_DIR / "spawns"

DEFAULT_QL_SPAWNS = Path(r"d:\QuakeLiveData\ql-spawns")
DEFAULT_PAK00 = Path(r"d:\QuakeLiveData\pak00\maps")

SKIP_PNG = frozenset({"placeholder", "blender_icons"})

_ORIGIN_RE = re.compile(r"var mapOrigin\s*=\s*\[([^\]]+)\]")
_END_RE = re.compile(r"var mapEnd\s*=\s*\[([^\]]+)\]")
_VIS_RE = re.compile(r"var visSize\s*=\s*\[([^\]]+)\]")
_ORIGIN_ENTITY_RE = re.compile(r'"origin"\s+"([^"]+)"')


def _parse_float_triplet(raw: str) -> tuple[float, float, float]:
    parts = [float(x.strip()) for x in raw.split(",")]
    if len(parts) < 3:
        raise ValueError(f"expected 3 floats, got {raw!r}")
    return parts[0], parts[1], parts[2]


def parse_ql_spawns_html(path: Path) -> dict | None:
    text = path.read_text(encoding="utf-8", errors="replace")
    om = _ORIGIN_RE.search(text)
    em = _END_RE.search(text)
    if not om or not em:
        return None
    origin = _parse_float_triplet(om.group(1))
    end = _parse_float_triplet(em.group(1))
    vis = None
    vm = _VIS_RE.search(text)
    if vm:
        vis_parts = [float(x.strip()) for x in vm.group(1).split(",")]
        if len(vis_parts) >= 2:
            vis = (vis_parts[0], vis_parts[1])
    return {
        "world_min_x": origin[0],
        "world_max_x": end[0],
        "world_min_y": end[1],
        "world_max_y": origin[1],
        "world_z_min": origin[2],
        "world_z_max": end[2],
        "vis_size": vis,
        "source": f"ql-spawns:{path.name}",
    }


def entity_bounds_from_bsp(bsp_path: Path) -> tuple[float, float, float, float, float, float] | None:
    data = bsp_path.read_bytes()
    if data[:4] != b"IBSP":
        return None
    lumps = [struct.unpack_from("<ii", data, 8 + i * 8) for i in range(17)]
    loc, length = lumps[0]
    text = data[loc : loc + length].decode("latin-1", errors="replace")
    origins: list[tuple[float, float, float]] = []
    for match in _ORIGIN_ENTITY_RE.finditer(text):
        parts = match.group(1).split()
        if len(parts) >= 3:
            origins.append((float(parts[0]), float(parts[1]), float(parts[2])))
    if not origins:
        return None
    xs = [p[0] for p in origins]
    ys = [p[1] for p in origins]
    zs = [p[2] for p in origins]
    return min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)


def learn_median_padding(
    ql_spawns_dir: Path,
    pak00_maps_dir: Path,
) -> tuple[float, float, float, float, float, float]:
    pads: list[tuple[float, float, float, float, float, float]] = []
    for html in sorted(ql_spawns_dir.glob("*.html")):
        bounds = parse_ql_spawns_html(html)
        if not bounds:
            continue
        bsp = pak00_maps_dir / f"{html.stem}.bsp"
        if not bsp.is_file():
            continue
        ent = entity_bounds_from_bsp(bsp)
        if not ent:
            continue
        pads.append(
            (
                bounds["world_min_x"] - ent[0],
                bounds["world_max_x"] - ent[1],
                bounds["world_min_y"] - ent[2],
                bounds["world_max_y"] - ent[3],
                bounds["world_z_min"] - ent[4],
                bounds["world_z_max"] - ent[5],
            )
        )
    if not pads:
        return (-320.0, 324.0, -228.0, 191.0, 8.0, -192.0)
    return tuple(statistics.median(col) for col in zip(*pads))  # type: ignore[return-value]


def fit_aspect(
    *,
    world_min_x: float,
    world_max_x: float,
    world_min_y: float,
    world_max_y: float,
    image_width: int,
    image_height: int,
) -> tuple[float, float, float, float]:
    span_x = world_max_x - world_min_x
    span_y = world_max_y - world_min_y
    if span_x <= 0 or span_y <= 0 or image_width <= 0 or image_height <= 0:
        return world_min_x, world_max_x, world_min_y, world_max_y
    target = image_width / image_height
    current = span_x / span_y
    if abs(current - target) < 0.02:
        return world_min_x, world_max_x, world_min_y, world_max_y
    center_y = (world_min_y + world_max_y) / 2
    new_span_y = span_x / target
    return (
        world_min_x,
        world_max_x,
        center_y - new_span_y / 2,
        center_y + new_span_y / 2,
    )


def round_bounds(row: dict) -> dict:
    out = dict(row)
    for key in (
        "world_min_x",
        "world_max_x",
        "world_min_y",
        "world_max_y",
        "world_z_span",
    ):
        if key in out and out[key] is not None:
            out[key] = round(float(out[key]))
    return out


def build_transform_row(
    map_name: str,
    image_path: Path,
    *,
    ql_spawns_dir: Path,
    pak00_maps_dir: Path,
    median_pad: tuple[float, float, float, float, float, float],
    preserve: dict | None,
) -> tuple[dict, str]:
    if preserve:
        row = dict(preserve)
        with Image.open(image_path) as im:
            row["image_width"] = im.size[0]
            row["image_height"] = im.size[1]
        row["image_url"] = f"maps/{map_name}.png"
        return round_bounds(row), "preserved"

    with Image.open(image_path) as im:
        image_width, image_height = im.size

    html = ql_spawns_dir / f"{map_name}.html"
    bounds = parse_ql_spawns_html(html) if html.is_file() else None
    source = "default"

    if bounds:
        world_min_x = bounds["world_min_x"]
        world_max_x = bounds["world_max_x"]
        world_min_y = bounds["world_min_y"]
        world_max_y = bounds["world_max_y"]
        world_z_span = bounds["world_z_max"] - bounds["world_z_min"]
        source = bounds["source"]
        vis = bounds.get("vis_size")
        if vis and vis[0] > 0 and vis[1] > 0:
            vis_aspect = vis[0] / vis[1]
            img_aspect = image_width / image_height
            if abs(vis_aspect - img_aspect) >= 0.02:
                world_min_x, world_max_x, world_min_y, world_max_y = fit_aspect(
                    world_min_x=world_min_x,
                    world_max_x=world_max_x,
                    world_min_y=world_min_y,
                    world_max_y=world_max_y,
                    image_width=image_width,
                    image_height=image_height,
                )
                source += "+aspect_fit"
    else:
        bsp = pak00_maps_dir / f"{map_name}.bsp"
        ent = entity_bounds_from_bsp(bsp) if bsp.is_file() else None
        if not ent:
            raise ValueError(f"no ql-spawns HTML or BSP entities for {map_name}")
        px, py, pz, pw, pmin_z, pmax_z = median_pad
        world_min_x = ent[0] + px
        world_max_x = ent[1] + py
        world_min_y = ent[2] + pz
        world_max_y = ent[3] + pw
        world_z_span = (ent[5] + pmax_z) - (ent[4] + pmin_z)
        source = f"bsp_entities+median_pad:{bsp.name}"
        world_min_x, world_max_x, world_min_y, world_max_y = fit_aspect(
            world_min_x=world_min_x,
            world_max_x=world_max_x,
            world_min_y=world_min_y,
            world_max_y=world_max_y,
            image_width=image_width,
            image_height=image_height,
        )

    row = {
        "image_url": f"maps/{map_name}.png",
        "world_min_x": world_min_x,
        "world_max_x": world_max_x,
        "world_min_y": world_min_y,
        "world_max_y": world_max_y,
        "image_width": image_width,
        "image_height": image_height,
    }
    if world_z_span > 0:
        row["world_z_span"] = world_z_span
    return round_bounds(row), source


def discover_map_pngs() -> list[str]:
    names: list[str] = []
    for path in sorted(MAPS_DIR.glob("*.png")):
        key = path.stem.lower()
        if key in SKIP_PNG:
            continue
        names.append(key)
    return names


def load_existing() -> dict:
    if not TRANSFORMS_PATH.is_file():
        return {"maps": {"_default": _default_row()}}
    data = json.loads(TRANSFORMS_PATH.read_text(encoding="utf-8"))
    if "maps" not in data:
        data["maps"] = {}
    if "_default" not in data["maps"]:
        data["maps"]["_default"] = _default_row()
    return data


def _default_row() -> dict:
    return {
        "image_url": "maps/placeholder.png",
        "world_min_x": -4096,
        "world_max_x": 4096,
        "world_min_y": -4096,
        "world_max_y": 4096,
        "image_width": 512,
        "image_height": 512,
    }


def validate_spawns(maps: dict) -> list[str]:
    warnings: list[str] = []
    for spawn_file in sorted(SPAWNS_DIR.glob("*.json")):
        if spawn_file.name == "index.json":
            continue
        map_name = spawn_file.stem
        row = maps.get(map_name)
        if not row:
            continue
        payload = json.loads(spawn_file.read_text(encoding="utf-8"))
        span_x = row["world_max_x"] - row["world_min_x"]
        span_y = row["world_max_y"] - row["world_min_y"]
        if span_x <= 0 or span_y <= 0:
            warnings.append(f"{map_name}: invalid span")
            continue
        for sp in payload.get("spawns") or []:
            px = ((float(sp["x"]) - row["world_min_x"]) / span_x) * row["image_width"]
            py = (
                row["image_height"]
                - ((float(sp["y"]) - row["world_min_y"]) / span_y) * row["image_height"]
            )
            if px < -8 or px > row["image_width"] + 8 or py < -8 or py > row["image_height"] + 8:
                warnings.append(
                    f"{map_name}: spawn ({sp['x']}, {sp['y']}) -> pixel ({px:.1f}, {py:.1f}) out of bounds"
                )
                break
    return warnings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ql-spawns", type=Path, default=DEFAULT_QL_SPAWNS)
    parser.add_argument("--pak00-maps", type=Path, default=DEFAULT_PAK00)
    parser.add_argument(
        "--preserve",
        action="append",
        default=["bloodrun"],
        help="Keep existing transform rows (repeatable; default: bloodrun manual tune)",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--check", action="store_true", help="Validate only; exit 1 on spawn OOB")
    args = parser.parse_args()

    existing = load_existing()
    median_pad = learn_median_padding(args.ql_spawns, args.pak00_maps)
    preserve_set = {name.strip().lower() for name in args.preserve if name.strip()}

    out_maps: dict[str, dict] = {"_default": existing["maps"]["_default"]}
    sources: dict[str, str] = {"_default": "builtin"}
    blockers: list[str] = []

    for map_name in discover_map_pngs():
        image_path = MAPS_DIR / f"{map_name}.png"
        preserve_row = existing["maps"].get(map_name) if map_name in preserve_set else None
        try:
            row, source = build_transform_row(
                map_name,
                image_path,
                ql_spawns_dir=args.ql_spawns,
                pak00_maps_dir=args.pak00_maps,
                median_pad=median_pad,
                preserve=preserve_row,
            )
        except ValueError as exc:
            blockers.append(f"{map_name}: {exc}")
            continue
        out_maps[map_name] = row
        sources[map_name] = source

    payload = {"maps": out_maps}
    warnings = validate_spawns(out_maps)

    print(f"maps with PNG: {len(discover_map_pngs())}")
    print(f"transform rows: {len(out_maps) - 1}")
    print(f"median padding: {tuple(round(x) for x in median_pad)}")
    for name in sorted(sources):
        if name == "_default":
            continue
        print(f"  {name}: {sources[name]}")
    if blockers:
        print("blockers:", file=sys.stderr)
        for line in blockers:
            print(f"  {line}", file=sys.stderr)
    if warnings:
        print("spawn warnings:", file=sys.stderr)
        for line in warnings:
            print(f"  {line}", file=sys.stderr)

    if args.check:
        return 1 if blockers or warnings else 0

    if args.dry_run:
        print(json.dumps(payload, indent=2))
        return 1 if blockers else 0

    TRANSFORMS_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {TRANSFORMS_PATH}")
    return 1 if blockers else 0


if __name__ == "__main__":
    raise SystemExit(main())
