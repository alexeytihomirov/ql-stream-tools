import { POS_SCALE } from "./constants.js";

export function utf8Bytes(text) {
  return new TextEncoder().encode(String(text || ""));
}

export function utf8Text(bytes, offset, length) {
  return new TextDecoder().decode(bytes.subarray(offset, offset + length));
}

export function writeU8(view, offset, value) {
  view.setUint8(offset, value & 0xff);
  return offset + 1;
}

export function writeU16(view, offset, value) {
  view.setUint16(offset, value & 0xffff, true);
  return offset + 2;
}

export function writeU32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
  return offset + 4;
}

export function writeI16(view, offset, value) {
  const clamped = Math.max(-32768, Math.min(32767, Math.round(value)));
  view.setInt16(offset, clamped, true);
  return offset + 2;
}

export function readU8(view, offset) {
  return [view.getUint8(offset), offset + 1];
}

export function readU16(view, offset) {
  return [view.getUint16(offset, true), offset + 2];
}

export function readU32(view, offset) {
  return [view.getUint32(offset, true), offset + 4];
}

export function readI16(view, offset) {
  return [view.getInt16(offset, true), offset + 2];
}

export function coordToI16(value) {
  return Math.max(-32768, Math.min(32767, Math.round(Number(value || 0) * POS_SCALE)));
}

export function coordFromI16(value) {
  return Math.round(value) / POS_SCALE;
}

export function buildStringTable(strings) {
  const list = [];
  const index = new Map();
  for (const raw of strings) {
    const s = String(raw || "");
    if (!s || index.has(s)) continue;
    index.set(s, list.length);
    list.push(s);
  }
  return { list, index };
}

export function sizeStringTable(list) {
  let n = 2;
  for (const s of list) n += 1 + utf8Bytes(s).length;
  return n;
}

export function writeStringTable(view, offset, list) {
  offset = writeU16(view, offset, list.length);
  for (const s of list) {
    const bytes = utf8Bytes(s);
    if (bytes.length > 255) throw new Error(`QLRP string too long: ${s.slice(0, 40)}`);
    offset = writeU8(view, offset, bytes.length);
    for (let i = 0; i < bytes.length; i++) view.setUint8(offset + i, bytes[i]);
    offset += bytes.length;
  }
  return offset;
}

export function readStringTable(view, offset) {
  let count;
  [count, offset] = readU16(view, offset);
  const list = [];
  for (let i = 0; i < count; i++) {
    let len;
    [len, offset] = readU8(view, offset);
    list.push(utf8Text(view.buffer instanceof ArrayBuffer ? new Uint8Array(view.buffer) : view.buffer, offset, len));
    offset += len;
  }
  return { list, offset };
}
