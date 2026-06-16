#!/usr/bin/env python3
"""Generate stub map PNGs for live-overlay (ql-stream-tools)."""

from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    raise SystemExit("pip install Pillow")

OUT = Path(__file__).resolve().parents[1] / "live-overlay" / "maps"
OUT.mkdir(parents=True, exist_ok=True)

for name, color in (
    ("placeholder", (40, 44, 58)),
    ("bloodrun", (72, 28, 28)),
    ("aerowalk", (28, 52, 72)),
):
    img = Image.new("RGB", (512, 512), color)
    draw = ImageDraw.Draw(img)
    draw.rectangle((32, 32, 480, 480), outline=(200, 200, 200), width=2)
    draw.text((180, 240), name, fill=(230, 230, 230))
    path = OUT / f"{name}.png"
    img.save(path)
    print("wrote", path)
