#!/usr/bin/env node
"use strict";

/**
 * Sanity checks for map_transforms.json (world bounds + PNG dimensions).
 * Run: node scripts/test_map_transforms_sanity.js
 */

const fs = require("fs");
const path = require("path");

const transformsPath = path.join(__dirname, "../live-overlay/maps/map_transforms.json");
const mapsDir = path.join(__dirname, "../live-overlay/maps");
const spawnsDir = path.join(mapsDir, "spawns");

const data = JSON.parse(fs.readFileSync(transformsPath, "utf8"));
const maps = data.maps || {};

let failed = 0;
let checks = 0;

function assert(cond, msg) {
  checks += 1;
  if (!cond) {
    console.error("FAIL:", msg);
    failed += 1;
  }
}

assert(maps._default, "_default transform present");

const skip = new Set(["placeholder", "blender_icons"]);
const pngMaps = fs
  .readdirSync(mapsDir)
  .filter((f) => f.endsWith(".png"))
  .map((f) => f.replace(/\.png$/, ""))
  .filter((name) => !skip.has(name));

for (const mapName of pngMaps) {
  assert(maps[mapName], `transform row for ${mapName}`);
}

for (const [mapName, row] of Object.entries(maps)) {
  if (mapName === "_default") continue;
  const spanX = row.world_max_x - row.world_min_x;
  const spanY = row.world_max_y - row.world_min_y;
  assert(spanX > 0, `${mapName}: spanX > 0`);
  assert(spanY > 0, `${mapName}: spanY > 0`);
  assert(row.image_width > 0 && row.image_height > 0, `${mapName}: image size`);
  assert(String(row.image_url || "").includes(mapName + ".png"), `${mapName}: image_url`);
  const pngPath = path.join(mapsDir, mapName + ".png");
  if (fs.existsSync(pngPath)) {
    // PNG header: width/height at bytes 16-24 (big-endian IHDR)
    const buf = fs.readFileSync(pngPath);
    if (buf.length >= 24 && buf[0] === 0x89) {
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      assert(row.image_width === w, `${mapName}: image_width matches PNG (${w})`);
      assert(row.image_height === h, `${mapName}: image_height matches PNG (${h})`);
    }
  }
}

function worldToPixel(row, x, y) {
  const spanX = row.world_max_x - row.world_min_x;
  const spanY = row.world_max_y - row.world_min_y;
  return {
    x: ((x - row.world_min_x) / spanX) * row.image_width,
    y: row.image_height - ((y - row.world_min_y) / spanY) * row.image_height,
  };
}

for (const spawnFile of fs.readdirSync(spawnsDir)) {
  if (!spawnFile.endsWith(".json") || spawnFile === "index.json") continue;
  const mapName = spawnFile.replace(/\.json$/, "");
  const row = maps[mapName];
  if (!row) continue;
  const payload = JSON.parse(fs.readFileSync(path.join(spawnsDir, spawnFile), "utf8"));
  for (const sp of payload.spawns || []) {
    const px = worldToPixel(row, Number(sp.x), Number(sp.y));
    assert(
      px.x >= -8 && px.x <= row.image_width + 8 && px.y >= -8 && px.y <= row.image_height + 8,
      `${mapName}: spawn (${sp.x}, ${sp.y}) in bounds`,
    );
  }
}

console.log(`map transforms sanity: ${checks} checks, ${failed} failed, ${pngMaps.length} PNG maps`);
process.exit(failed ? 1 : 0);
