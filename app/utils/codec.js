import { gzipSync, gunzipSync, zlibSync, unzlibSync, deflateSync, inflateSync } from 'fflate';

// Wasm codecs load on first use so other formats don't pay for them.
const brotli = () => import('brotli-wasm').then((m) => m.default);
let zstdReady;
const zstd = () =>
  (zstdReady ??= import('@bokuweb/zstd-wasm').then(async (m) => {
    await m.init();
    return m;
  }));

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

export const FORMATS = [
  { id: 'gzip', label: 'gzip', min: 0, max: 9, level: 6 },
  { id: 'deflate', label: 'deflate (zlib)', min: 0, max: 9, level: 6 },
  { id: 'deflate-raw', label: 'deflate (raw)', min: 0, max: 9, level: 6 },
  { id: 'brotli', label: 'brotli', min: 0, max: 11, level: 11 },
  { id: 'zstd', label: 'zstandard', min: 1, max: 22, level: 3 },
];

export async function compressBytes(bytes, format, level) {
  switch (format) {
    case 'gzip':
      return gzipSync(bytes, { level });
    case 'deflate':
      return zlibSync(bytes, { level });
    case 'deflate-raw':
      return deflateSync(bytes, { level });
    case 'brotli':
      return (await brotli()).compress(bytes, { quality: level });
    case 'zstd':
      return (await zstd()).compress(bytes, level);
  }
  throw new Error(`Unknown format ${format}`);
}

export async function decompressBytes(bytes, format) {
  switch (format) {
    case 'gzip':
      return gunzipSync(bytes);
    case 'deflate':
      return unzlibSync(bytes);
    case 'deflate-raw':
      return inflateSync(bytes);
    case 'brotli':
      return (await brotli()).decompress(bytes);
    case 'zstd':
      if (!ZSTD_MAGIC.every((b, i) => bytes[i] === b)) throw new Error('Not a zstd frame');
      // ponytail: frames without a stored content size decode into a 1 MiB buffer; use streaming if that's hit
      return (await zstd()).decompress(bytes);
  }
  throw new Error(`Unknown format ${format}`);
}

export async function compress(text, format, level) {
  return (await compressBytes(new TextEncoder().encode(text), format, level)).toBase64();
}

export async function decompress(base64, format) {
  const bytes = await decompressBytes(Uint8Array.fromBase64(base64.replace(/\s/g, '')), format);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
