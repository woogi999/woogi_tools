// Saving and opening projects. A project is the document plus the pixel
// store (painted layers and masks). In IndexedDB it's stored as it is (typed
// arrays and all); as a file it's JSON, with typed arrays deflated and
// base64'd so a painted model stays a reasonable size.

import { deflateSync, inflateSync } from 'fflate';

export const FORMAT = 'woogi-3d-studio-1';

function toBase64(bytes) {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  return btoa(s);
}

function fromBase64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const KINDS = {
  Float32Array,
  Uint8ClampedArray,
  Uint8Array,
  Int32Array,
  Uint16Array,
};

// Deep copy with typed arrays turned into { $t, z } records.
function pack(value) {
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    );
    return {
      $t: value.constructor.name,
      z: toBase64(deflateSync(bytes, { level: 6 })),
    };
  }
  if (Array.isArray(value)) return value.map(pack);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = pack(v);
    return out;
  }
  return value;
}

function unpack(value) {
  if (Array.isArray(value)) return value.map(unpack);
  if (value && typeof value === 'object') {
    if (value.$t && typeof value.z === 'string' && KINDS[value.$t]) {
      const bytes = inflateSync(fromBase64(value.z));
      const Kind = KINDS[value.$t];
      return new Kind(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength / Kind.BYTES_PER_ELEMENT,
      );
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = unpack(v);
    return out;
  }
  return value;
}

export function toFile(doc, pixels) {
  return JSON.stringify({
    format: FORMAT,
    savedAt: Date.now(),
    doc: pack(doc),
    pixels: pack(Object.fromEntries(pixels)),
  });
}

export function fromFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file isn’t a 3D Studio project.');
  }
  if (data?.format !== FORMAT || !data.doc?.objects)
    throw new Error('That file isn’t a 3D Studio project.');
  return {
    doc: unpack(data.doc),
    pixels: new Map(Object.entries(unpack(data.pixels ?? {}))),
  };
}

// For IndexedDB, which clones typed arrays itself.
export function toRecord(doc, pixels) {
  return { format: FORMAT, doc, pixels: Object.fromEntries(pixels) };
}

export function fromRecord(rec) {
  if (rec?.format !== FORMAT || !rec.doc?.objects) return null;
  return { doc: rec.doc, pixels: new Map(Object.entries(rec.pixels ?? {})) };
}

// Drops pixel buffers no layer uses any more.
export function prunePixels(doc, pixels) {
  const used = new Set();
  for (const m of Object.values(doc.materials))
    for (const l of m.layers ?? []) {
      used.add(l.id);
      used.add(`${l.id}:mask`);
    }
  for (const k of pixels.keys()) if (!used.has(k)) pixels.delete(k);
  return pixels;
}
