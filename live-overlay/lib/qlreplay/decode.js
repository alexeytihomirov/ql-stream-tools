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
  coordFromI16,
  readI16,
  readStringTable,
  readU8,
  readU16,
  readU32,
  utf8Text,
} from "./io.js";

function readSample(view, offset) {
  let x;
  [x, offset] = readI16(view, offset);
  let y;
  [y, offset] = readI16(view, offset);
  let z;
  [z, offset] = readI16(view, offset);
  let flags;
  [flags, offset] = readU8(view, offset);
  const sample = {
    x: coordFromI16(x),
    y: coordFromI16(y),
    z: coordFromI16(z),
  };
  if (flags & POS_F_HEALTH) {
    let h;
    [h, offset] = readU8(view, offset);
    sample.health = h;
  }
  if (flags & POS_F_ARMOR) {
    let a;
    [a, offset] = readU8(view, offset);
    sample.armor = a;
  }
  if (flags & POS_F_WEAPON) {
    let w;
    [w, offset] = readU8(view, offset);
    sample.weapon = w;
  }
  if (flags & POS_F_LOADOUT) {
    let lo;
    [lo, offset] = readU16(view, offset);
    sample.loadout = lo;
  }
  if (flags & POS_F_VEL) {
    let vx, vy, vz;
    [vx, offset] = readI16(view, offset);
    [vy, offset] = readI16(view, offset);
    [vz, offset] = readI16(view, offset);
    sample.vx = coordFromI16(vx);
    sample.vy = coordFromI16(vy);
    sample.vz = coordFromI16(vz);
  }
  return [sample, offset];
}

function readTrack(view, offset, rosterByCn) {
  let clientNum;
  [clientNum, offset] = readU8(view, offset);
  let count;
  [count, offset] = readU32(view, offset);
  const samples = [];
  if (!count) return [{ clientNum, samples }, offset];
  let t;
  [t, offset] = readU32(view, offset);
  samples.push({ t, pending: true });
  for (let i = 1; i < count; i++) {
    let dt;
    [dt, offset] = readU16(view, offset);
    if (dt === 0xffff) {
      let wide;
      [wide, offset] = readU32(view, offset);
      dt = wide;
    }
    t += dt;
    samples.push({ t, pending: true });
  }
  for (let i = 0; i < count; i++) {
    let row;
    [row, offset] = readSample(view, offset);
    samples[i] = { ...row, t: samples[i].t };
  }
  const name = rosterByCn.get(clientNum) || `player${clientNum}`;
  for (const s of samples) s.nickname = name;
  return [{ clientNum, samples }, offset];
}

function mergeTracksToPositionEvents(tracks, meta, wallStart, gameStart) {
  const byTime = new Map();
  for (const track of tracks) {
    for (const s of track.samples) {
      const key = s.t;
      if (!byTime.has(key)) byTime.set(key, []);
      const row = {
        clientNum: track.clientNum,
        nickname: s.nickname,
        x: s.x,
        y: s.y,
        z: s.z,
      };
      if (s.health != null) row.health = s.health;
      if (s.armor != null) row.armor = s.armor;
      if (s.weapon != null) row.weapon = s.weapon;
      if (s.loadout != null) row.loadout = s.loadout;
      if (s.vx != null) row.vx = s.vx;
      if (s.vy != null) row.vy = s.vy;
      if (s.vz != null) row.vz = s.vz;
      byTime.get(key).push(row);
    }
  }
  const events = [];
  const times = [...byTime.keys()].sort((a, b) => a - b);
  for (const gameTimeMs of times) {
    events.push({
      t: wallStart + (gameTimeMs - gameStart),
      event: "positions",
      game_time_ms: gameTimeMs,
      map_name: meta.map_name,
      gametype: meta.gametype,
      players: byTime.get(gameTimeMs),
    });
  }
  return events;
}

/**
 * Decode QLRP v1 bytes to canonical replay object ({ meta, events }).
 * @param {ArrayBuffer|Uint8Array} buffer
 */
export function decodeReplay(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  let magic;
  [magic, o] = readU32(view, o);
  if (magic !== QLRP_MAGIC) throw new Error(`bad QLRP magic: 0x${magic.toString(16)}`);
  let version;
  [version, o] = readU8(view, o);
  if (version !== QLRP_VERSION) throw new Error(`unsupported QLRP version: ${version}`);
  let flags;
  [flags, o] = readU8(view, o);
  if (flags & 0xfe) throw new Error(`unsupported QLRP flags: ${flags}`);
  let mapLen;
  [mapLen, o] = readU8(view, o);
  const mapName = utf8Text(bytes, o, mapLen);
  o += mapLen;
  let gtLen;
  [gtLen, o] = readU8(view, o);
  const gametype = utf8Text(bytes, o, gtLen);
  o += gtLen;
  let wallStart;
  [wallStart, o] = readU32(view, o);
  let gameStart;
  [gameStart, o] = readU32(view, o);
  let rosterCount;
  [rosterCount, o] = readU8(view, o);
  const roster = [];
  const rosterByCn = new Map();
  for (let i = 0; i < rosterCount; i++) {
    let cn;
    [cn, o] = readU8(view, o);
    let nameLen;
    [nameLen, o] = readU8(view, o);
    const name = utf8Text(bytes, o, nameLen);
    o += nameLen;
    roster.push({ clientNum: cn, name });
    rosterByCn.set(cn, name);
  }
  const { list: strTable, offset: afterStrings } = readStringTable(view, o);
  o = afterStrings;
  let pickupCount;
  [pickupCount, o] = readU16(view, o);
  const pickupEvents = [];
  for (let i = 0; i < pickupCount; i++) {
    let t;
    [t, o] = readU32(view, o);
    let itemIdx;
    [itemIdx, o] = readU16(view, o);
    let cn;
    [cn, o] = readU8(view, o);
    let x, y, z;
    [x, o] = readI16(view, o);
    [y, o] = readI16(view, o);
    [z, o] = readI16(view, o);
    pickupEvents.push({
      t: wallStart + (t - gameStart),
      event: "pickup",
      action: "pickup",
      game_time_ms: t,
      item: strTable[itemIdx] || "",
      clientNum: cn === 255 ? undefined : cn,
      x: coordFromI16(x),
      y: coordFromI16(y),
      z: coordFromI16(z),
    });
  }
  let trackCount;
  [trackCount, o] = readU8(view, o);
  const tracks = [];
  for (let i = 0; i < trackCount; i++) {
    let track;
    [track, o] = readTrack(view, o, rosterByCn);
    tracks.push(track);
  }
  if (o !== bytes.length) throw new Error(`QLRP trailing bytes: ${bytes.length - o}`);

  const meta = {
    map_name: mapName,
    gametype,
    source: "qlrp",
    format: "qlrp",
    format_version: QLRP_VERSION,
    roster,
    wall_start_ms: wallStart,
    game_start_ms: gameStart,
  };
  const events = [
    {
      t: wallStart,
      event: "match_start",
      game_time_ms: gameStart,
      map_name: mapName,
      gametype,
    },
    ...mergeTracksToPositionEvents(tracks, meta, wallStart, gameStart),
    ...pickupEvents,
  ];
  events.sort((a, b) => {
    const ta = Number(a.t ?? 0);
    const tb = Number(b.t ?? 0);
    if (ta !== tb) return ta - tb;
    const ord = { match_start: 0, positions: 1, pickup: 2 };
    return (ord[a.event] ?? 9) - (ord[b.event] ?? 9);
  });
  let sampleCount = 0;
  for (const tr of tracks) sampleCount += tr.samples.length;
  meta.position_samples = sampleCount;
  meta.track_count = tracks.length;
  return { meta, events };
}
