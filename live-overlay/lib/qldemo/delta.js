import {
  GENTITYNUM_BITS,
  MAX_PERSISTANT,
  MAX_POWERUPS,
  MAX_STATS,
  MAX_WEAPONS,
} from "./constants.js";
import {
  ENTITY_BITS_91,
  applyEntityField91,
  cloneEntityState,
  createEntityState,
} from "./entity-state.js?v=20260712b";
import {
  createMsgReader,
  huffmanReadByte,
  huffmanReadLong,
  huffmanReadShort,
  readBits,
} from "./huffman.js?v=20260712b";
import { readField } from "./read-field.js?v=20260712b";

/** dm_91 playerstate net fields (UDT PlayerStateFields91). */
export const PLAYER_BITS_91 = [
  32, 0, 0, 8, 0, 0, 0, 0, -16, 0, 0, 8, -16, 16, 8, 4, 8, 8, 8, 24, GENTITYNUM_BITS, 4, 16, 10, 16, 16, 16, 8, -8,
  8, 8, 8, 8, 8, 8, 16, 16, 12, 8, 8, 8, 5, 8, 0, 0, 0, 0, 10, 16, 32, 1, 32, 32, 8, 8, 8, 8, 8,
];

export function createPlayerState() {
  return {
    commandTime: 0,
    origin: [0, 0, 0],
    velocity: [0, 0, 0],
    viewangles: [0, 0, 0],
    clientNum: 0,
    weapon: 0,
    weaponPrimary: 0,
    eFlags: 0,
    stats: new Array(MAX_STATS).fill(0),
    persistant: new Array(MAX_PERSISTANT).fill(0),
    ammo: new Array(MAX_WEAPONS).fill(0),
    powerups: new Array(MAX_POWERUPS).fill(0),
  };
}

function applyPlayerField91(ps, index, value) {
  switch (index) {
    case 0:
      ps.commandTime = value;
      return;
    case 1:
      ps.origin[0] = value;
      return;
    case 2:
      ps.origin[1] = value;
      return;
    case 4:
      ps.velocity[0] = value;
      return;
    case 5:
      ps.velocity[1] = value;
      return;
    case 6:
      ps.viewangles[1] = value;
      return;
    case 7:
      ps.viewangles[0] = value;
      return;
    case 9:
      ps.origin[2] = value;
      return;
    case 10:
      ps.velocity[2] = value;
      return;
    case 40:
      ps.clientNum = value;
      return;
    case 41:
      ps.weapon = value;
      return;
    case 42:
      ps.weaponPrimary = value;
      return;
    case 22:
      ps.eFlags = value;
      return;
    case 43:
      ps.viewangles[2] = value;
      return;
    default:
      return;
  }
}

/** dm_91 entity delta (UDT RealReadDeltaEntity). Returns { entity, changed } or { entity: null, changed: true }. */
export function readDeltaEntity(msg, huffman, from, number) {
  const base = from ? cloneEntityState(from) : createEntityState();

  if (readBits(msg, huffman, 1) === 1) return { entity: null, changed: true };

  if (readBits(msg, huffman, 1) === 0) {
    const ent = cloneEntityState(base);
    ent.number = number;
    return { entity: ent, changed: false };
  }

  const ent = cloneEntityState(base);
  ent.number = number;
  const lc = huffmanReadByte(msg, huffman);
  if (lc < 0 || lc > ENTITY_BITS_91.length) {
    throw new Error(`entity lc=${lc} max=${ENTITY_BITS_91.length}`);
  }

  for (let i = 0; i < lc; i++) {
    if (readBits(msg, huffman, 1) === 0) continue;
    if (readBits(msg, huffman, 1) === 0) {
      applyEntityField91(ent, i, 0);
      continue;
    }
    applyEntityField91(ent, i, readField(msg, huffman, ENTITY_BITS_91[i]));
  }

  return { entity: ent, changed: true };
}

/**
 * dm_91 playerstate delta (UDT RealReadDeltaPlayer).
 *
 * `from` is legitimately null for the first snapshot(s) after `record` starts
 * mid-connection: the server's delta reference predates what the demo file
 * captured. clientNum almost never gets explicitly redelta'd afterwards
 * (a connected client's own slot doesn't change), so seeding it from a blank
 * `createPlayerState()` (clientNum 0) would leave a wrong clientNum "stuck"
 * for the rest of the demo via clone-forward — fixed by seeding the blank
 * baseline with the connection's real identity instead of 0.
 */
export function readDeltaPlayerState(msg, huffman, from, fallbackClientNum) {
  const ps = from ? clonePlayerState(from) : createPlayerState();
  if (!from && fallbackClientNum != null && fallbackClientNum >= 0) {
    ps.clientNum = fallbackClientNum;
  }
  const lc = huffmanReadByte(msg, huffman);
  if (lc < 0 || lc > PLAYER_BITS_91.length) {
    throw new Error(`playerstate lc=${lc} max=${PLAYER_BITS_91.length}`);
  }

  for (let i = 0; i < lc; i++) {
    if (readBits(msg, huffman, 1) === 0) continue;
    applyPlayerField91(ps, i, readField(msg, huffman, PLAYER_BITS_91[i]));
  }

  if (readBits(msg, huffman, 1)) {
    if (readBits(msg, huffman, 1)) {
      const mask = readBits(msg, huffman, MAX_STATS);
      for (let i = 0; i < MAX_STATS; i++) {
        if (mask & (1 << i)) ps.stats[i] = readBits(msg, huffman, -16);
      }
    }
    if (readBits(msg, huffman, 1)) {
      const mask = readBits(msg, huffman, MAX_PERSISTANT);
      for (let i = 0; i < MAX_PERSISTANT; i++) {
        if (mask & (1 << i)) ps.persistant[i] = huffmanReadShort(msg, huffman);
      }
    }
    if (readBits(msg, huffman, 1)) {
      const mask = readBits(msg, huffman, 16);
      for (let i = 0; i < MAX_WEAPONS; i++) {
        if (mask & (1 << i)) ps.ammo[i] = huffmanReadShort(msg, huffman);
      }
    }
    if (readBits(msg, huffman, 1)) {
      const mask = readBits(msg, huffman, MAX_POWERUPS);
      for (let i = 0; i < MAX_POWERUPS; i++) {
        if (mask & (1 << i)) ps.powerups[i] = huffmanReadLong(msg, huffman);
      }
    }
  }
  return ps;
}

export function clonePlayerState(ps) {
  return {
    ...ps,
    origin: ps.origin.slice(),
    velocity: (ps.velocity || [0, 0, 0]).slice(),
    viewangles: ps.viewangles.slice(),
    stats: ps.stats.slice(),
    persistant: ps.persistant.slice(),
    ammo: ps.ammo.slice(),
    powerups: ps.powerups.slice(),
  };
}

export { cloneEntityState, createEntityState } from "./entity-state.js";
export { createMsgReader };
