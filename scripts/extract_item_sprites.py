#!/usr/bin/env python3
"""Copy Quake Live HUD item/weapon icons from pak00 into live-overlay sprites."""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

# classname -> pak00/icons filename (under pak00 root)
CLASSNAME_SPRITES: dict[str, str] = {
  # weapons
  "weapon_shotgun": "icons/iconw_shotgun.png",
  "weapon_plasmagun": "icons/iconw_plasma.png",
  "weapon_rocketlauncher": "icons/iconw_rocket.png",
  "weapon_lightning": "icons/iconw_lightning.png",
  "weapon_railgun": "icons/iconw_railgun.png",
  "weapon_grenadelauncher": "icons/iconw_grenade.png",
  "weapon_machinegun": "icons/iconw_machinegun.png",
  "weapon_bfg": "icons/iconw_bfg.png",
  "weapon_gauntlet": "icons/iconw_gauntlet.png",
  "weapon_grapple": "icons/iconw_grapple.png",
  # ammo
  "ammo_bullets": "icons/icona_machinegun.png",
  "ammo_shells": "icons/icona_shotgun.png",
  "ammo_cells": "icons/icona_plasma.png",
  "ammo_lightning": "icons/icona_lightning.png",
  "ammo_rockets": "icons/icona_rocket.png",
  "ammo_grenades": "icons/icona_grenade.png",
  "ammo_slugs": "icons/icona_railgun.png",
  "ammo_pack": "icons/ammo_pack.png",
  # health (QL HUD: green=5, yellow=25, red=50, mega=M)
  "item_health_small": "icons/iconh_green.png",
  "item_health": "icons/iconh_yellow.png",
  "item_health_large": "icons/iconh_red.png",
  "item_health_mega": "icons/iconh_mega.png",
  # armor (QL: shard = plate tiles, YA = yellow/combat, RA = red/body)
  "item_armor_shard": "icons/iconr_shard.png",
  "item_armor_combat": "icons/iconr_yellow.png",
  "item_armor_body": "icons/iconr_red.png",
  # powerups
  "item_quad": "icons/quad.png",
  "item_haste": "icons/haste.png",
  "item_regen": "icons/regen.png",
  "item_invis": "icons/invis.png",
  "item_enviro": "icons/envirosuit.png",
  "item_flight": "icons/flight.png",
  "item_invulnerability": "icons/invulnerability.png",
}


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
        "--output-dir",
        type=Path,
        default=repo / "live-overlay" / "maps" / "sprites",
    )
    parser.add_argument(
        "--sprite-map",
        type=Path,
        default=repo / "live-overlay" / "maps" / "sprite-map.json",
    )
    args = parser.parse_args()

    if not args.pak00.is_dir():
        print(f"pak00 missing: {args.pak00}", file=sys.stderr)
        return 1

    args.output_dir.mkdir(parents=True, exist_ok=True)
    sprite_map: dict[str, str] = {}
    copied = 0
    missing: list[str] = []

    for classname, rel in sorted(CLASSNAME_SPRITES.items()):
        src = args.pak00 / rel
        if not src.is_file():
            missing.append(f"{classname}: {rel}")
            continue
        dest_name = Path(rel).name
        dest = args.output_dir / dest_name
        if not dest.exists() or src.stat().st_mtime > dest.stat().st_mtime:
            shutil.copy2(src, dest)
            copied += 1
        sprite_map[classname] = f"maps/sprites/{dest_name}"

    payload = {
        "version": 1,
        "source": str(args.pak00),
        "classnames": sprite_map,
    }
    args.sprite_map.parent.mkdir(parents=True, exist_ok=True)
    args.sprite_map.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    print(f"wrote {args.sprite_map} ({len(sprite_map)} classnames, {copied} copied)")
    if missing:
        print(f"warn: {len(missing)} missing sources", file=sys.stderr)
        for line in missing:
            print(f"  {line}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
