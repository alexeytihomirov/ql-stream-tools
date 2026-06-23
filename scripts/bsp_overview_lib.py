"""Top-down map overview from Quake Live / Q3 IBSP (version 47)."""
from __future__ import annotations

import struct
from dataclasses import dataclass
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError as raise_import_error:
    raise SystemExit("pip install Pillow") from raise_import_error

# GtkRadiant / ioq3 compiled BSP lump order (QL v47).
LUMP_ENTITIES = 0
LUMP_SHADERS = 1
LUMP_PLANES = 2
LUMP_LEAFS = 4
LUMP_DRAWVERTS = 10
LUMP_SURFACES = 11
LUMP_DRAWINDEXES = 13

DRAWVERT_SIZE = 44
DSURFACE_SIZE = 104
DSHADER_SIZE = 72
DLEAF_SIZE = 48

DEFAULT_LONG_EDGE = 1024
WALL_OUTLINE = (14, 16, 22)


@dataclass(frozen=True)
class BspData:
    drawverts: bytes
    indexes: bytes
    surfaces: bytes
    leafs: bytes
    shaders: list[str]
    vert_bounds: tuple[float, float, float, float, float, float]
    model_bounds: tuple[float, float, float, float, float, float] | None


def _lumps(data: bytes) -> list[tuple[int, int]]:
    if data[:4] != b"IBSP":
        raise ValueError("not IBSP")
    version = struct.unpack_from("<i", data, 4)[0]
    if version != 47:
        raise ValueError(f"unsupported BSP version {version} (expected 47)")
    return [struct.unpack_from("<ii", data, 8 + i * 8) for i in range(17)]


def _lump(data: bytes, lumps: list[tuple[int, int]], index: int) -> bytes:
    off, length = lumps[index]
    return data[off : off + length]


def _read_shader_names(raw: bytes) -> list[str]:
    names: list[str] = []
    for i in range(0, len(raw), DSHADER_SIZE):
        chunk = raw[i : i + 64]
        names.append(chunk.split(b"\0", 1)[0].decode("latin-1", errors="replace"))
    return names


def _vert_xyz(drawverts: bytes, index: int) -> tuple[float, float, float]:
    off = index * DRAWVERT_SIZE
    return struct.unpack_from("<3f", drawverts, off)


def _vert_bounds(drawverts: bytes) -> tuple[float, float, float, float, float, float]:
    count = len(drawverts) // DRAWVERT_SIZE
    xs: list[float] = []
    ys: list[float] = []
    zs: list[float] = []
    for i in range(count):
        x, y, z = _vert_xyz(drawverts, i)
        if abs(x) > 20000 or abs(y) > 20000 or abs(z) > 20000:
            continue
        xs.append(x)
        ys.append(y)
        zs.append(z)
    if not xs:
        raise ValueError("no usable draw vertices")
    return min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)


def _model_bounds(data: bytes, lumps: list[tuple[int, int]]) -> tuple[float, float, float, float, float, float] | None:
    raw = _lump(data, lumps, 7)
    if len(raw) < 48:
        return None
    mins = struct.unpack_from("<3f", raw, 0)
    maxs = struct.unpack_from("<3f", raw, 12)
    if any(abs(v) > 20000 for v in (*mins, *maxs)):
        return None
    return mins[0], maxs[0], mins[1], maxs[1], mins[2], maxs[2]


def load_bsp(bsp_path: Path) -> BspData:
    data = bsp_path.read_bytes()
    lumps = _lumps(data)
    drawverts = _lump(data, lumps, LUMP_DRAWVERTS)
    indexes = _lump(data, lumps, LUMP_DRAWINDEXES)
    surfaces = _lump(data, lumps, LUMP_SURFACES)
    leafs = _lump(data, lumps, LUMP_LEAFS)
    shaders = _read_shader_names(_lump(data, lumps, LUMP_SHADERS))
    if not drawverts or not leafs:
        raise ValueError(f"empty geometry in {bsp_path}")
    return BspData(
        drawverts=drawverts,
        indexes=indexes,
        surfaces=surfaces,
        leafs=leafs,
        shaders=shaders,
        vert_bounds=_vert_bounds(drawverts),
        model_bounds=_model_bounds(data, lumps),
    )


def _iter_walkable_leaves(
    bsp: BspData,
) -> list[tuple[float, float, float, float, float]]:
    """Return walkable leaf volumes as (min_x, min_y, max_x, max_y, avg_z)."""
    out: list[tuple[float, float, float, float, float]] = []
    count = len(bsp.leafs) // DLEAF_SIZE
    for i in range(count):
        off = i * DLEAF_SIZE
        cluster, _area = struct.unpack_from("<2i", bsp.leafs, off)
        if cluster < 0:
            continue
        mins = struct.unpack_from("<3i", bsp.leafs, off + 8)
        maxs = struct.unpack_from("<3i", bsp.leafs, off + 20)
        if mins[0] >= maxs[0] or mins[1] >= maxs[1]:
            continue
        avg_z = (mins[2] + maxs[2]) / 2.0
        out.append((float(mins[0]), float(mins[1]), float(maxs[0]), float(maxs[1]), avg_z))
    return out


def _height_color(avg_z: float, z_min: float, z_max: float) -> tuple[int, int, int]:
    span = max(1.0, z_max - z_min)
    t = (avg_z - z_min) / span
    base = 52 + int(t * 36)
    return (base - 8, base + 24, base + 12)


def _world_to_pixel(
    x: float,
    y: float,
    *,
    min_x: float,
    min_y: float,
    span_x: float,
    span_y: float,
    width: int,
    height: int,
) -> tuple[float, float]:
    px = (x - min_x) / span_x * width
    py = height - (y - min_y) / span_y * height
    return px, py


def fit_aspect_bounds(
    min_x: float,
    max_x: float,
    min_y: float,
    max_y: float,
    width: int,
    height: int,
) -> tuple[float, float, float, float]:
    span_x = max_x - min_x
    span_y = max_y - min_y
    if span_x <= 0 or span_y <= 0:
        return min_x, max_x, min_y, max_y
    target = width / height
    current = span_x / span_y
    if abs(current - target) < 0.02:
        return min_x, max_x, min_y, max_y
    center_y = (min_y + max_y) / 2
    new_span_y = span_x / target
    return min_x, max_x, center_y - new_span_y / 2, center_y + new_span_y / 2


def render_overview_png(
    bsp: BspData,
    out_path: Path,
    *,
    bounds: tuple[float, float, float, float] | None = None,
    pad: float = 96.0,
    long_edge: int = DEFAULT_LONG_EDGE,
    pak00: Path | None = None,
    bg: tuple[int, int, int] = (18, 20, 28),
) -> tuple[int, int, float, float, float, float]:
    del pak00  # reserved for future shader sampling on brush faces
    vx0, vx1, vy0, vy1, vz0, vz1 = bsp.vert_bounds
    min_x = vx0 - pad
    max_x = vx1 + pad
    min_y = vy0 - pad
    max_y = vy1 + pad
    if bounds:
        min_x, max_x, min_y, max_y = bounds

    span_x = max_x - min_x
    span_y = max_y - min_y
    if span_x <= span_y:
        height = long_edge
        width = max(64, int(round(long_edge * span_x / span_y)))
    else:
        width = long_edge
        height = max(64, int(round(long_edge * span_y / span_x)))

    min_x, max_x, min_y, max_y = fit_aspect_bounds(min_x, max_x, min_y, max_y, width, height)
    span_x = max_x - min_x
    span_y = max_y - min_y

    leaves = _iter_walkable_leaves(bsp)
    z_values = [leaf[4] for leaf in leaves] or [vz0, vz1]

    img = Image.new("RGB", (width, height), bg)
    draw = ImageDraw.Draw(img)

    for leaf in sorted(leaves, key=lambda row: row[4]):
        lx0, ly0, lx1, ly1, avg_z = leaf
        fill = _height_color(avg_z, min(z_values), max(z_values))
        poly = [
            _world_to_pixel(lx0, ly0, min_x=min_x, min_y=min_y, span_x=span_x, span_y=span_y, width=width, height=height),
            _world_to_pixel(lx1, ly0, min_x=min_x, min_y=min_y, span_x=span_x, span_y=span_y, width=width, height=height),
            _world_to_pixel(lx1, ly1, min_x=min_x, min_y=min_y, span_x=span_x, span_y=span_y, width=width, height=height),
            _world_to_pixel(lx0, ly1, min_x=min_x, min_y=min_y, span_x=span_x, span_y=span_y, width=width, height=height),
        ]
        draw.polygon(poly, fill=fill, outline=WALL_OUTLINE)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, optimize=True)
    return width, height, min_x, max_x, min_y, max_y
