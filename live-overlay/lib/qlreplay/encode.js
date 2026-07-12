import {
  POS_F_ARMOR,
  POS_F_HEALTH,
  POS_F_LOADOUT,
  POS_F_VEL,
  POS_F_WEAPON,
  QLRP_MAGIC,
  QLRP_VERSION,
} from "./constants.js";
import {
  buildStringTable,
  coordToI16,
  sizeStringTable,
  utf8Bytes,
  writeI16,
  writeStringTable,
  writeU8,
  writeU16,
  writeU32,
} from "./io.js";

function collectRoster(replay) {
  const roster = new Map();
  const meta = replay.meta || {};
  if (Array.isArray(meta.roster)) {
    for (const row of meta.roster) {
      if (row == null) continue;
      const cn = row.clientNum ?? row.cn;
      if (cn == null) continue;
      roster.set(Number(cn), String(row.name || row.n || row.nickname || `player${cn}`));
    }
  }
  for (const ev of replay.events || []) {
    if (ev?.event !== "positions") continue;
    for (const p of ev.players || []) {
      const cn = p.clientNum ?? p.cn;
      if (cn == null) continue;
      if (!roster.has(Number(cn)) && p.nickname) roster.set(Number(cn), String(p.nickname));
    }
  }
  return [...roster.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([clientNum, name]) => ({ clientNum, name }));
}

function collectTracks(replay) {
  const tracks = new Map();
  for (const ev of replay.events || []) {
    if (ev?.event !== "positions") continue;
    const t = Number(ev.game_time_ms);
    if (!Number.isFinite(t)) continue;
    for (const p of ev.players || []) {
      const cn = Number(p.clientNum ?? p.cn ?? 0);
      if (!tracks.has(cn)) tracks.set(cn, []);
      const row = {
        t,
        x: p.x,
        y: p.y,
        z: p.z,
        health: p.health ?? p.h,
        armor: p.armor ?? p.a,
        weapon: p.weapon ?? p.w,
        loadout: p.loadout ?? p.lo,
        vx: p.vx,
        vy: p.vy,
        vz: p.vz,
        nickname: p.nickname,
      };
      const list = tracks.get(cn);
      if (!list.length || list[list.length - 1].t !== t) list.push(row);
    }
  }
  for (const list of tracks.values()) list.sort((a, b) => a.t - b.t);
  return tracks;
}

function collectPickups(replay) {
  const rows = [];
  for (const ev of replay.events || []) {
    if (ev?.event !== "pickup") continue;
    rows.push({
      t: Number(ev.game_time_ms ?? 0),
      item: String(ev.item || ""),
      cn: Number(ev.clientNum ?? ev.cn ?? 255),
      x: ev.x,
      y: ev.y,
      z: ev.z,
    });
  }
  rows.sort((a, b) => a.t - b.t);
  return rows;
}

function anchorTimes(replay) {
  let wallStart = 0;
  let gameStart = 0;
  for (const ev of replay.events || []) {
    const kind = String(ev?.event || "");
    if (kind !== "match_start" && kind !== "countdown_start") continue;
    wallStart = Number(ev.t ?? 0);
    gameStart = Number(ev.game_time_ms ?? 0);
    break;
  }
  return { wallStart, gameStart };
}

function sampleByteSize(sample) {
  let n = 6 + 1; // xyz i16*3 + flags
  if (sample.health != null) n += 1;
  if (sample.armor != null) n += 1;
  if (sample.weapon != null) n += 1;
  if (sample.loadout != null) n += 2;
  if (sample.vx != null || sample.vy != null || sample.vz != null) n += 6;
  return n;
}

function writeSample(view, offset, sample) {
  offset = writeI16(view, offset, coordToI16(sample.x));
  offset = writeI16(view, offset, coordToI16(sample.y));
  offset = writeI16(view, offset, coordToI16(sample.z));
  let flags = 0;
  if (sample.health != null) flags |= POS_F_HEALTH;
  if (sample.armor != null) flags |= POS_F_ARMOR;
  if (sample.weapon != null) flags |= POS_F_WEAPON;
  if (sample.loadout != null) flags |= POS_F_LOADOUT;
  if (sample.vx != null || sample.vy != null || sample.vz != null) flags |= POS_F_VEL;
  offset = writeU8(view, offset, flags);
  if (flags & POS_F_HEALTH) offset = writeU8(view, offset, Number(sample.health) & 0xff);
  if (flags & POS_F_ARMOR) offset = writeU8(view, offset, Number(sample.armor) & 0xff);
  if (flags & POS_F_WEAPON) offset = writeU8(view, offset, Number(sample.weapon) & 0xff);
  if (flags & POS_F_LOADOUT) offset = writeU16(view, offset, Number(sample.loadout) & 0xffff);
  if (flags & POS_F_VEL) {
    offset = writeI16(view, offset, coordToI16(sample.vx ?? 0));
    offset = writeI16(view, offset, coordToI16(sample.vy ?? 0));
    offset = writeI16(view, offset, coordToI16(sample.vz ?? 0));
  }
  return offset;
}

function trackBodySize(samples) {
  if (!samples.length) return 0;
  let n = 1 + 4 + 4; // cn + count + first_t
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].t - samples[i - 1].t;
    n += dt <= 0xffff ? 2 : 6;
  }
  for (const s of samples) n += sampleByteSize(s);
  return n;
}

function writeTrack(view, offset, clientNum, samples) {
  offset = writeU8(view, offset, clientNum & 0xff);
  offset = writeU32(view, offset, samples.length);
  if (!samples.length) return offset;
  offset = writeU32(view, offset, samples[0].t >>> 0);
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].t - samples[i - 1].t;
    if (dt <= 0xffff) offset = writeU16(view, offset, dt);
    else {
      offset = writeU16(view, offset, 0xffff);
      offset = writeU32(view, offset, dt >>> 0);
    }
  }
  for (const s of samples) offset = writeSample(view, offset, s);
  return offset;
}

function estimateSize(replay, roster, tracks, pickups, strTable) {
  const meta = replay.meta || {};
  const mapBytes = utf8Bytes(meta.map_name || "");
  const gtBytes = utf8Bytes(meta.gametype || "");
  let n = 4 + 1 + 1 + 1 + mapBytes.length + 1 + gtBytes.length + 4 + 4 + 1;
  for (const row of roster) {
    const nb = utf8Bytes(row.name);
    n += 2 + nb.length;
  }
  n += sizeStringTable(strTable.list);
  n += 2 + pickups.length * (4 + 2 + 1 + 6);
  n += 1;
  for (const [, samples] of tracks) n += trackBodySize(samples);
  return n;
}

/**
 * Encode canonical replay object ({ meta, events }) to QLRP v1 bytes.
 * @param {object} replay
 * @returns {Uint8Array}
 */
export function encodeReplay(replay) {
  const meta = replay.meta || {};
  const roster = collectRoster(replay);
  const tracks = collectTracks(replay);
  const pickups = collectPickups(replay);
  const { wallStart, gameStart } = anchorTimes(replay);
  const strTable = buildStringTable(pickups.map((p) => p.item).filter(Boolean));

  const mapBytes = utf8Bytes(meta.map_name || "");
  const gtBytes = utf8Bytes(meta.gametype || "");
  if (mapBytes.length > 255 || gtBytes.length > 255) throw new Error("QLRP map/gametype too long");

  const size = estimateSize(replay, roster, tracks, pickups, strTable);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let o = 0;
  o = writeU32(view, o, QLRP_MAGIC);
  o = writeU8(view, o, QLRP_VERSION);
  o = writeU8(view, o, 0);
  o = writeU8(view, o, mapBytes.length);
  for (let i = 0; i < mapBytes.length; i++) view.setUint8(o + i, mapBytes[i]);
  o += mapBytes.length;
  o = writeU8(view, o, gtBytes.length);
  for (let i = 0; i < gtBytes.length; i++) view.setUint8(o + i, gtBytes[i]);
  o += gtBytes.length;
  o = writeU32(view, o, wallStart >>> 0);
  o = writeU32(view, o, gameStart >>> 0);
  o = writeU8(view, o, roster.length);
  for (const row of roster) {
    const nb = utf8Bytes(row.name);
    o = writeU8(view, o, row.clientNum & 0xff);
    o = writeU8(view, o, nb.length);
    for (let i = 0; i < nb.length; i++) view.setUint8(o + i, nb[i]);
    o += nb.length;
  }
  o = writeStringTable(view, o, strTable.list);
  o = writeU16(view, o, pickups.length);
  for (const p of pickups) {
    const idx = strTable.index.get(p.item);
    if (idx == null) throw new Error(`missing pickup item in string table: ${p.item}`);
    o = writeU32(view, o, p.t >>> 0);
    o = writeU16(view, o, idx);
    o = writeU8(view, o, p.cn & 0xff);
    o = writeI16(view, o, coordToI16(p.x));
    o = writeI16(view, o, coordToI16(p.y));
    o = writeI16(view, o, coordToI16(p.z));
  }
  o = writeU8(view, o, tracks.size);
  const sortedTracks = [...tracks.entries()].sort((a, b) => a[0] - b[0]);
  for (const [cn, samples] of sortedTracks) o = writeTrack(view, o, cn, samples);
  if (o !== size) throw new Error(`QLRP size mismatch wrote=${o} expected=${size}`);
  return out;
}
