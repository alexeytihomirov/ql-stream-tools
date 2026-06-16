#!/usr/bin/env python3
"""Deprecated wrapper — use extract_map_entities.py instead."""
from __future__ import annotations

import sys

from extract_map_entities import main

if __name__ == "__main__":
    print("note: extract_map_spawns.py -> extract_map_entities.py", file=sys.stderr)
    raise SystemExit(main())
