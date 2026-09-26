// Finds the picture a Roblox decal shows.
//
// A decal asset's content is a tiny Roblox model: one Decal instance whose
// Texture property points at the image asset ("rbxassetid://123" or
// ".../asset/?id=123"). That image ID is what a game draws with, and it isn't
// the decal's own ID, which is all Roblox's upload API hands back.
//
// The model comes as XML or in Roblox's binary format, whose chunks may be
// LZ4- or Zstandard-compressed. Everything needed to find one string is here.

import { decompressBytes } from './codec';

const latin1 = (bytes) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return text;
};

const TEXTURE = /(?:rbxassetid:\/\/|[?&]id=)(\d+)/i;

// LZ4 block format, as used by binary model chunks.
export function lz4Block(input, size) {
  const out = new Uint8Array(size);
  let i = 0;
  let o = 0;
  while (i < input.length) {
    const token = input[i++];
    let literals = token >> 4;
    if (literals === 15) {
      let b;
      do literals += b = input[i++];
      while (b === 255);
    }
    out.set(input.subarray(i, i + literals), o);
    i += literals;
    o += literals;
    if (i >= input.length) break;
    const offset = input[i] | (input[i + 1] << 8);
    i += 2;
    let match = (token & 15) + 4;
    if ((token & 15) === 15) {
      let b;
      do match += b = input[i++];
      while (b === 255);
    }
    for (let k = 0; k < match; k++, o++) out[o] = out[o - offset];
  }
  return out.subarray(0, o);
}

async function chunkBody(bytes, compressed, size) {
  if (!compressed) return bytes;
  const zstd = bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd;
  return zstd ? decompressBytes(bytes, 'zstd') : lz4Block(bytes, size);
}

/** The image ID a decal's content points at, or null. */
export async function textureIdFrom(content) {
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
  const head = latin1(bytes.subarray(0, 8));
  if (head !== '<roblox!') return TEXTURE.exec(latin1(bytes))?.[1] ?? null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 32;
  while (at + 16 <= bytes.length) {
    const name = latin1(bytes.subarray(at, at + 4));
    const packed = view.getUint32(at + 4, true);
    const size = view.getUint32(at + 8, true);
    const start = at + 16;
    if (name === 'END\0') break;
    const body = await chunkBody(
      bytes.subarray(start, start + (packed || size)),
      packed > 0,
      size,
    );
    if (name === 'PROP') {
      const hit = TEXTURE.exec(latin1(body))?.[1];
      if (hit) return hit;
    }
    at = start + (packed || size);
  }
  return null;
}
