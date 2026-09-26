import {
  gzipSync,
  gunzipSync,
  zlibSync,
  unzlibSync,
  deflateSync,
  inflateSync,
} from 'fflate';

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
      if (!ZSTD_MAGIC.every((b, i) => bytes[i] === b))
        throw new Error('Not a zstd frame');
      // ponytail: frames without a stored content size decode into a 1 MiB buffer; use streaming if that's hit
      return (await zstd()).decompress(bytes);
  }
  throw new Error(`Unknown format ${format}`);
}

export async function compress(text, format, level) {
  return (
    await compressBytes(new TextEncoder().encode(text), format, level)
  ).toBase64();
}

export async function decompress(base64, format) {
  const bytes = await decompressBytes(
    Uint8Array.fromBase64(base64.replace(/\s/g, '')),
    format,
  );
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

// Decoded text laid out to be read. Compressed payloads are nearly always
// minified JSON (game exports, API bodies), which arrives as one enormous
// line; that gets indented. Anything else comes back as it was, with Windows
// line endings evened out.
export function prettyText(text) {
  const body = text.replace(/^\uFEFF/, '');
  const trimmed = body.trim();
  if (/^[[{]/.test(trimmed)) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      // looked like JSON, wasn't: leave it alone
    }
  }
  return body.replace(/\r\n?/g, '\n');
}

// ─── Simple text codecs ───────────────────────────────────────────────────
// These encode straight to/from text, unlike the compression formats above
// which pack bytes and print them as base64.

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder('utf-8', { fatal: true });

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function base64ToBytes(text) {
  const clean = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

const NAMED_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function decodeEntities(text) {
  // A detached <textarea> decodes every named entity the browser knows without running any markup.
  const area = document.createElement('textarea');
  area.innerHTML = text;
  return area.value;
}

const MORSE = {
  A: '.-',
  B: '-...',
  C: '-.-.',
  D: '-..',
  E: '.',
  F: '..-.',
  G: '--.',
  H: '....',
  I: '..',
  J: '.---',
  K: '-.-',
  L: '.-..',
  M: '--',
  N: '-.',
  O: '---',
  P: '.--.',
  Q: '--.-',
  R: '.-.',
  S: '...',
  T: '-',
  U: '..-',
  V: '...-',
  W: '.--',
  X: '-..-',
  Y: '-.--',
  Z: '--..',
  0: '-----',
  1: '.----',
  2: '..---',
  3: '...--',
  4: '....-',
  5: '.....',
  6: '-....',
  7: '--...',
  8: '---..',
  9: '----.',
  '.': '.-.-.-',
  ',': '--..--',
  '?': '..--..',
  "'": '.----.',
  '!': '-.-.--',
  '/': '-..-.',
  '(': '-.--.',
  ')': '-.--.-',
  '&': '.-...',
  ':': '---...',
  ';': '-.-.-.',
  '=': '-...-',
  '+': '.-.-.',
  '-': '-....-',
  _: '..--.-',
  '"': '.-..-.',
  $: '...-..-',
  '@': '.--.-.',
};
const MORSE_REVERSE = Object.fromEntries(
  Object.entries(MORSE).map(([k, v]) => [v, k]),
);

export const TEXT_CODECS = [
  {
    id: 'base64',
    label: 'Base64',
    encode: (t) => bytesToBase64(utf8.encode(t)),
    decode: (t) => fromUtf8.decode(base64ToBytes(t)),
  },
  {
    id: 'base64url',
    label: 'Base64 URL',
    encode: (t) =>
      bytesToBase64(utf8.encode(t))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, ''),
    decode: (t) => fromUtf8.decode(base64ToBytes(t)),
  },
  {
    id: 'url',
    label: 'URL',
    encode: (t) => encodeURIComponent(t),
    decode: (t) => decodeURIComponent(t.replace(/\+/g, ' ')),
  },
  {
    id: 'html',
    label: 'HTML entities',
    encode: (t) =>
      t
        .replace(/[&<>"']/g, (c) => NAMED_ENTITIES[c])
        .replace(/[^\x20-\x7e\n\r\t]/gu, (c) => `&#${c.codePointAt(0)};`),
    decode: decodeEntities,
  },
  {
    id: 'hex',
    label: 'Hex',
    encode: (t) =>
      Array.from(utf8.encode(t), (b) => b.toString(16).padStart(2, '0')).join(
        ' ',
      ),
    decode: (t) => {
      const clean = t.replace(/0x|[\s,:]/gi, '');
      if (!/^([0-9a-f]{2})*$/i.test(clean))
        throw new Error('Hex must be pairs of 0-9 and A-F');
      return fromUtf8.decode(
        Uint8Array.from(clean.match(/../g) ?? [], (h) => parseInt(h, 16)),
      );
    },
  },
  {
    id: 'binary',
    label: 'Binary',
    encode: (t) =>
      Array.from(utf8.encode(t), (b) => b.toString(2).padStart(8, '0')).join(
        ' ',
      ),
    decode: (t) => {
      const clean = t.replace(/\s+/g, '');
      if (!/^([01]{8})*$/.test(clean))
        throw new Error('Binary must be groups of 8 bits');
      return fromUtf8.decode(
        Uint8Array.from(clean.match(/.{8}/g) ?? [], (b) => parseInt(b, 2)),
      );
    },
  },
  {
    id: 'unicode',
    label: 'Unicode escapes',
    encode: (t) =>
      [...t]
        .map((c) => {
          const cp = c.codePointAt(0);
          return cp < 128
            ? c
            : cp > 0xffff
              ? `\\u{${cp.toString(16)}}`
              : `\\u${cp.toString(16).padStart(4, '0')}`;
        })
        .join(''),
    decode: (t) =>
      t.replace(
        /\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi,
        (_, a, b, c) => String.fromCodePoint(parseInt(a ?? b ?? c, 16)),
      ),
  },
  {
    id: 'morse',
    label: 'Morse',
    encode: (t) =>
      t
        .toUpperCase()
        .split(/\s+/)
        .filter(Boolean)
        .map((word) =>
          [...word]
            .map((c) => MORSE[c] ?? '')
            .filter(Boolean)
            .join(' '),
        )
        .join(' / '),
    decode: (t) =>
      t
        .trim()
        .split(/\s*\/\s*|\s{3,}/)
        .map((word) =>
          word
            .split(/\s+/)
            .map(
              (code) =>
                MORSE_REVERSE[
                  code.replace(/[·•]/g, '.').replace(/[−—_]/g, '-')
                ] ?? '',
            )
            .join(''),
        )
        .join(' '),
  },
];

// A single list for pickers that offer both compression and simple text
// encodings side by side (the Data Codec page).
export const CODECS = [
  ...FORMATS.map((f) => ({ ...f, kind: 'compress' })),
  ...TEXT_CODECS.map((c) => ({ ...c, kind: 'text' })),
];
