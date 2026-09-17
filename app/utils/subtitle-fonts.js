// The fonts the Subtitle Baker can burn in. They ship with the site
// (public/fonts) because libass inside FFmpeg can't see the fonts on your
// machine; each one is open-licensed. `family` must match the name inside
// the file, which is what libass looks for.

export const SUBTITLE_FONTS = [
  {
    id: 'liberation',
    label: 'Liberation Sans',
    family: 'Liberation Sans',
    file: 'LiberationSans-Bold.ttf',
  },
  {
    id: 'opensans',
    label: 'Open Sans',
    family: 'Open Sans',
    file: 'OpenSans.ttf',
  },
  {
    id: 'poppins',
    label: 'Poppins',
    family: 'Poppins',
    file: 'Poppins-Bold.ttf',
  },
  { id: 'oswald', label: 'Oswald', family: 'Oswald', file: 'Oswald.ttf' },
  {
    id: 'robotoslab',
    label: 'Roboto Slab',
    family: 'Roboto Slab',
    file: 'RobotoSlab.ttf',
  },
  {
    id: 'comic',
    label: 'Comic Neue',
    family: 'Comic Neue',
    file: 'ComicNeue-Bold.ttf',
  },
  { id: 'bangers', label: 'Bangers', family: 'Bangers', file: 'Bangers.ttf' },
  { id: 'lobster', label: 'Lobster', family: 'Lobster', file: 'Lobster.ttf' },
  {
    id: 'courier',
    label: 'Courier Prime',
    family: 'Courier Prime',
    file: 'CourierPrime-Bold.ttf',
  },
  {
    id: 'pixel',
    label: 'Press Start 2P',
    family: 'Press Start 2P',
    file: 'PressStart2P.ttf',
  },
];

const loaded = new Set();

// Registers a font with the page so the preview line is drawn in it.
export function loadPreviewFont(family, url) {
  if (loaded.has(family) || typeof FontFace === 'undefined') return;
  loaded.add(family);
  const face = new FontFace(family, `url(${url})`);
  face
    .load()
    .then((f) => document.fonts.add(f))
    .catch(() => loaded.delete(family));
}

// Reads the family name (name ID 1) out of a TrueType/OpenType file.
export function fontFamilyOf(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12) return null;
  let offset = 0;
  // A TrueType collection: take the first font.
  if (view.getUint32(0) === 0x74746366) offset = view.getUint32(12);
  const tables = view.getUint16(offset + 4);
  let name = null;
  for (let i = 0; i < tables; i++) {
    const at = offset + 12 + i * 16;
    if (at + 16 > bytes.byteLength) return null;
    const tag = String.fromCharCode(
      bytes[at],
      bytes[at + 1],
      bytes[at + 2],
      bytes[at + 3],
    );
    if (tag === 'name')
      name = {
        offset: view.getUint32(at + 8),
        length: view.getUint32(at + 12),
      };
  }
  if (!name || name.offset + 6 > bytes.byteLength) return null;
  const count = view.getUint16(name.offset + 2);
  const strings = name.offset + view.getUint16(name.offset + 4);
  let best = null;
  for (let i = 0; i < count; i++) {
    const rec = name.offset + 6 + i * 12;
    const platform = view.getUint16(rec);
    const nameId = view.getUint16(rec + 6);
    const length = view.getUint16(rec + 8);
    const start = strings + view.getUint16(rec + 10);
    if (nameId !== 1 || start + length > bytes.byteLength) continue;
    const slice = bytes.subarray(start, start + length);
    // Windows names are UTF-16BE; Mac names are single-byte.
    const text =
      platform === 3 || platform === 0
        ? new TextDecoder('utf-16be').decode(slice)
        : new TextDecoder('latin1').decode(slice);
    if (platform === 3) return text.trim();
    best ??= text.trim();
  }
  return best;
}
