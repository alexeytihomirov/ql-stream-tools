import { parseDemoBuffer } from "../live-overlay/lib/qldemo/index.js";
import { readFileSync } from "node:fs";
import { ET_EVENTS } from "../live-overlay/lib/qldemo/entity-events.js";

const p = parseDemoBuffer(readFileSync("demos/Input(POV)-vs-a3-bloodrun-2026_06_29-21_28_44.dm_91"));
const s0 = p.snapshots[0].serverTime;
const fight = 9062800;

for (const snap of p.snapshots) {
  for (const ent of snap.changedEntities || []) {
    if (!ent.newEvent) continue;
    const evType = ent.eType > ET_EVENTS ? ent.eType - ET_EVENTS : -1;
    if (evType === 58) {
      console.log("OBIT", {
        t: snap.serverTime - s0,
        gt: snap.serverTime - fight,
        o1: ent.otherEntityNum,
        o2: ent.otherEntityNum2,
        ep: ent.eventParm,
      });
    }
  }
}

let last = "";
for (const c of p.serverCommands) {
  if (c.cmd !== "scores_duel") continue;
  const parts = c.text.trim().split(/\s+/);
  const score = parts[0] + "-" + parts[1];
  if (score !== last) {
    console.log("score", c.seq, score);
    last = score;
  }
}
