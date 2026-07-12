import {
  CS_MODELS,
  CS_SOUNDS,
  CS_PLAYERS,
  CS_SERVERINFO,
  CS_STRING_MAP,
  ENTITYNUM_NONE,
  SVC_BASELINE,
  SVC_CONFIGSTRING,
  SVC_EOF,
  SVC_GAMESTATE,
  SVC_SERVERCOMMAND,
  SVC_SNAPSHOT,
  TEAM_SPECTATOR,
  GENTITYNUM_BITS,
  MAX_CLIENTS,
  MAX_GENTITIES,
  PACKET_MASK,
} from "./constants.js";
import {
  cloneEntityState,
  readDeltaEntity,
  readDeltaPlayerState,
} from "./delta.js?v=20260712b";
import { isNewEntityEvent } from "./entity-events.js?v=20260712b";
import {
  createDemoMsgHuffman,
  createMsgReader,
  huffmanReadByte,
  huffmanReadLong,
  huffmanReadShort,
  huffmanReadString,
  huffmanReadBigString,
  readBits,
} from "./huffman.js";

function parseConfigKv(text) {
  const out = {};
  if (!text) return out;
  const parts = text.split("\\");
  const start = parts[0] === "" ? 1 : 0;
  for (let i = start; i + 1 < parts.length; i += 2) out[parts[i]] = parts[i + 1];
  return out;
}

function parseServerinfoKv(text) {
  const out = {};
  if (!text || text[0] !== "\\") return out;
  const parts = text.split("\\");
  for (let i = 1; i + 1 < parts.length; i += 2) out[parts[i]] = parts[i + 1];
  return out;
}

export class QLDemoParser {
  constructor(buffer) {
    this.buffer = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.offset = 0;
    this.huffman = createDemoMsgHuffman();
    this.gamestate = {
      clientNum: 0,
      config: {},
      configstrings: {},
      players: {},
      spectators: {},
      models: {},
    };
    this.snapshots = [];
    this.snapRing = new Array(32).fill(null);
    this.baselines = [];
    this.serverCommands = [];
    this.lastServerTime = 0;
    this.snapshotsParsed = 0;
    this.errors = [];
    this.entityEventTimes = new Int32Array(MAX_GENTITIES);
  }

  readRawLong() {
    if (this.offset + 4 > this.buffer.length) return -1;
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset + this.offset, 4);
    const v = view.getInt32(0, true);
    this.offset += 4;
    return v;
  }

  readPacketBytes(length) {
    if (length < 0 || this.offset + length > this.buffer.length) return null;
    const slice = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  storeConfigString(index, text) {
    this.gamestate.configstrings[index] = text;
    const field = CS_STRING_MAP[index];
    if (field) {
      if (text.startsWith("\\")) this.gamestate.config[field] = parseServerinfoKv(text);
      else this.gamestate.config[field] = text.replace(/^"|"$/g, "");
      return;
    }
    if (index === CS_SERVERINFO) {
      this.gamestate.config.serverinfo = parseServerinfoKv(text);
      return;
    }
    if (index >= CS_PLAYERS && index < CS_PLAYERS + MAX_CLIENTS) {
      const clientNum = index - CS_PLAYERS;
      const row = parseConfigKv(text);
      const dest = row.t === TEAM_SPECTATOR ? this.gamestate.spectators : this.gamestate.players;
      dest[clientNum] = row;
      return;
    }
    if (index >= CS_MODELS && index < CS_SOUNDS) {
      this.gamestate.models[index - CS_MODELS] = text;
    }
  }

  parseGamestate(msg) {
    huffmanReadLong(msg, this.huffman);
    while (true) {
      const cmd = huffmanReadByte(msg, this.huffman);
      if (cmd === SVC_EOF) break;
      if (cmd === SVC_CONFIGSTRING) {
        const idx = huffmanReadShort(msg, this.huffman);
        const text = huffmanReadBigString(msg, this.huffman);
        this.storeConfigString(idx, text);
      } else if (cmd === SVC_BASELINE) {
        const newnum = readBits(msg, this.huffman, GENTITYNUM_BITS);
        const { entity } = readDeltaEntity(msg, this.huffman, null, newnum);
        if (entity) this.baselines[newnum] = entity;
      }
    }
    this.gamestate.clientNum = huffmanReadLong(msg, this.huffman);
    huffmanReadLong(msg, this.huffman);
    return this.gamestate;
  }

  parseServerCommand(msg) {
    const seq = huffmanReadLong(msg, this.huffman);
    const text = huffmanReadString(msg, this.huffman);
    const parts = text.split(/\s+/);
    const cmd = parts[0] || "";
    const rest = parts.slice(1).join(" ");
    if (cmd === "cs" || cmd === "bcs") {
      const ls = rest.split(" ");
      const csNum = parseInt(ls[0], 10);
      const csText = ls.slice(1).join(" ").replace(/^"|"$/g, "");
      if (!isNaN(csNum)) this.storeConfigString(csNum, csText);
    }
    const row = { seq, cmd, text: rest, serverTime: this.lastServerTime };
    this.serverCommands.push(row);
    return row;
  }

  parsePacketEntities(msg, oldSnap, serverTime) {
    const entities = [];
    const changedEntities = [];
    const tagChanged = (ent) => {
      if (!ent) return;
      const newEvent = isNewEntityEvent(ent, serverTime, this.entityEventTimes[ent.number]);
      ent.newEvent = newEvent;
      if (newEvent) this.entityEventTimes[ent.number] = serverTime;
      changedEntities.push(ent);
    };

    let oldIndex = 0;
    let oldNum = 99999;
    let oldState = null;
    if (oldSnap?.entities?.length) {
      oldState = oldSnap.entities[0];
      oldNum = oldState.number;
    }

    while (true) {
      const newNum = readBits(msg, this.huffman, GENTITYNUM_BITS);
      if (newNum === ENTITYNUM_NONE) break;

      while (oldNum < newNum) {
        if (oldState) entities.push(cloneEntityState(oldState));
        oldIndex++;
        if (oldSnap && oldIndex < oldSnap.entities.length) {
          oldState = oldSnap.entities[oldIndex];
          oldNum = oldState.number;
        } else {
          oldNum = 99999;
          oldState = null;
        }
      }

      if (oldNum === newNum) {
        const { entity, changed } = readDeltaEntity(msg, this.huffman, oldState, newNum);
        if (entity) {
          entities.push(entity);
          if (changed) tagChanged(entity);
        }
        oldIndex++;
        if (oldSnap && oldIndex < oldSnap.entities.length) {
          oldState = oldSnap.entities[oldIndex];
          oldNum = oldState.number;
        } else {
          oldNum = 99999;
          oldState = null;
        }
        continue;
      }

      if (oldNum > newNum) {
        const baseline = this.baselines[newNum] || null;
        const { entity, changed } = readDeltaEntity(msg, this.huffman, baseline, newNum);
        if (entity) {
          entities.push(entity);
          if (changed) tagChanged(entity);
        }
        continue;
      }
    }

    while (oldNum !== 99999) {
      if (oldState) entities.push(cloneEntityState(oldState));
      oldIndex++;
      if (oldSnap && oldIndex < oldSnap.entities.length) {
        oldState = oldSnap.entities[oldIndex];
        oldNum = oldState.number;
      } else {
        oldNum = 99999;
        oldState = null;
      }
    }

    return { entities, changedEntities };
  }

  parseSnapshot(msg, packetLen, messageNum) {
    const serverTime = huffmanReadLong(msg, this.huffman);
    const deltaByte = huffmanReadByte(msg, this.huffman);
    huffmanReadByte(msg, this.huffman);
    const areamaskLen = huffmanReadByte(msg, this.huffman);
    for (let i = 0; i < areamaskLen; i++) huffmanReadByte(msg, this.huffman);
    let oldSnap = null;
    if (deltaByte > 0) {
      const deltaNum = messageNum - deltaByte;
      const candidate = this.snapRing[deltaNum & PACKET_MASK];
      if (candidate?.messageNum === deltaNum) oldSnap = candidate;
    }
    const ps = readDeltaPlayerState(msg, this.huffman, oldSnap?.playerState || null, this.gamestate.clientNum);
    let entities = [];
    let changedEntities = [];
    try {
      const parsed = this.parsePacketEntities(msg, oldSnap, serverTime);
      entities = parsed.entities;
      changedEntities = parsed.changedEntities;
    } catch (err) {
      this.errors.push(`entities @${messageNum}: ${err.message || err}`);
      if (packetLen > 0) msg.bit.value = packetLen * 8;
    }
    this.lastServerTime = serverTime;
    const snap = { messageNum, serverTime, delta: deltaByte, playerState: ps, entities, changedEntities };
    this.snapRing[messageNum & PACKET_MASK] = snap;
    this.snapshots.push(snap);
    this.snapshotsParsed++;
    return snap;
  }

  parseAll(options = {}) {
    const maxSnapshots = options.maxSnapshots ?? Infinity;
    while (this.offset + 8 <= this.buffer.length) {
      const seq = this.readRawLong();
      const length = this.readRawLong();
      if (seq === -1 && length === -1) break;
      if (seq === -1 || length === -1 || length <= 0 || length > 0x4000) {
        this.errors.push(`bad packet header seq=${seq} len=${length} @${this.offset}`);
        break;
      }
      const packet = this.readPacketBytes(length);
      if (!packet) break;
      const msg = createMsgReader(packet, this.huffman);
      huffmanReadLong(msg, this.huffman);
      // A single packet can bundle a snapshot preceded/followed by any number
      // of server commands (UDT ParseServerMessage's inner for(;;) loop) — it
      // is not one message per packet. Keep reading commands from this same
      // packet buffer until it's exhausted or we hit the EOF marker.
      const packetBits = packet.length * 8;
      let stop = false;
      try {
        while (!stop && msg.bit.value < packetBits) {
          const cmd = huffmanReadByte(msg, this.huffman);
          if (cmd === SVC_EOF) break;
          if (cmd === SVC_GAMESTATE) this.parseGamestate(msg);
          else if (cmd === SVC_SERVERCOMMAND) this.parseServerCommand(msg);
          else if (cmd === SVC_SNAPSHOT) {
            if (this.snapshotsParsed >= maxSnapshots) {
              stop = true;
              break;
            }
            this.parseSnapshot(msg, packet.length, seq);
          } else {
            break;
          }
        }
      } catch (err) {
        this.errors.push(String(err.message || err));
        break;
      }
      if (stop) break;
    }
    return this;
  }

  mapName() {
    return this.gamestate.config.serverinfo?.mapname || "";
  }

  gametype() {
    return this.gamestate.config.serverinfo?.g_gametype || "";
  }

  playerRows() {
    return Object.keys(this.gamestate.players)
      .map((k) => ({ clientNum: parseInt(k, 10), ...this.gamestate.players[k] }))
      .filter((p) => p.n);
  }
}

export function parseDemoBuffer(buffer, options) {
  return new QLDemoParser(buffer).parseAll(options);
}
