#!/usr/bin/env node
/**
 * Dev CLI: parse a .dm_91 demo and print replay summary JSON.
 * Usage: node tools/qldemo-dump.mjs demos/foo.dm_91 [--full] [--json] [--max N]
 *
 * --full: write compact .qlrp next to the demo
 * --json: write verbose .replay.json (debug / checkpoint_builder)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { demoToReplay, parseDemoBuffer, replaySummary } from "../live-overlay/lib/qldemo/index.js";
import { loadMapPickupTableFromDisk } from "../live-overlay/lib/qldemo/map-item-resolve.node.js";
import { decodeReplay, encodeReplay } from "../live-overlay/lib/qlreplay/index.js";

const args = process.argv.slice(2);
const full = args.includes("--full");
const writeJson = args.includes("--json");
const maxIdx = args.indexOf("--max");
const maxSnapshots = maxIdx >= 0 ? parseInt(args[maxIdx + 1], 10) : undefined;
const fileArg = args.find((a) => !a.startsWith("--") && a !== String(maxSnapshots));

if (!fileArg) {
  console.error("Usage: node tools/qldemo-dump.mjs <demo.dm_91> [--full] [--json] [--max N]");
  process.exit(1);
}

const demoPath = resolve(fileArg);
const buffer = readFileSync(demoPath);
const parser = parseDemoBuffer(buffer, { maxSnapshots: maxSnapshots || Infinity });
const replay = demoToReplay(parser, {
  mapTable: loadMapPickupTableFromDisk(parser.mapName()),
});
const summary = replaySummary(replay);

const out = {
  file: basename(demoPath),
  bytes: buffer.length,
  ...summary,
  roster: parser.playerRows().map((p) => ({ clientNum: p.clientNum, name: p.n })),
};

if (full) {
  const qlrpBytes = encodeReplay(replay);
  const qlrpPath = demoPath.replace(/\.dm_\d+$/i, ".qlrp");
  writeFileSync(qlrpPath, qlrpBytes);
  out.qlrp_written = qlrpPath;
  out.qlrp_bytes = qlrpBytes.length;

  const roundtrip = decodeReplay(qlrpBytes);
  const rtSummary = replaySummary(roundtrip);
  out.qlrp_roundtrip_positions = rtSummary.position_events;
  out.qlrp_roundtrip_pickups = rtSummary.pickups;
}

if (writeJson) {
  const jsonPath = demoPath.replace(/\.dm_\d+$/i, ".replay.json");
  const jsonText = JSON.stringify(replay, null, 2);
  writeFileSync(jsonPath, jsonText);
  out.replay_json_written = jsonPath;
  out.replay_json_bytes = Buffer.byteLength(jsonText);
}

console.log(JSON.stringify(out, null, 2));

if (!summary.map) {
  console.error("WARN: map_name empty — parser may have failed early");
  process.exit(2);
}
