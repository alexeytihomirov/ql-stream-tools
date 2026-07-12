import { parseDemoBuffer } from "../live-overlay/lib/qldemo/index.js";
import { readFileSync } from "node:fs";

const p = parseDemoBuffer(readFileSync("demos/Input(POV)-vs-a3-bloodrun-2026_06_29-21_28_44.dm_91"));
const s0 = p.snapshots[0].serverTime;
const lst = Number(String(p.gamestate.config.level_start_time || "0").replace(/"/g, ""));
console.log("first snap", s0, "level_start", lst, "fight offset ms", lst - s0);
for (const c of p.serverCommands) {
  if (/kill|death|obit|score/i.test(c.cmd + c.text)) console.log("cmd", c);
}
const evPick = [];
for (const snap of p.snapshots) {
  for (const ent of snap.changedEntities || []) {
    if (ent.eType >= 13 && ent.newEvent) {
      const ev = ent.event & ~0xc0;
      if (ev === 15 || ev === 16) evPick.push({ t: snap.serverTime - s0, ev });
    }
  }
}
console.log("item pickup events", evPick.length);
console.log("sample hp", p.snapshots[400].playerState.stats.slice(0, 3));
