// Reading and removing the hidden data inside files: EXIF in JPEGs (camera,
// settings, and often exactly where you were standing), text chunks in PNGs,
// and the tags in audio and video. All parsed here, by hand, in your browser.

const TAGS = {
  0x010f: 'Camera make', 0x0110: 'Camera model', 0x0112: 'Orientation', 0x011a: 'X resolution', 0x011b: 'Y resolution',
  0x0131: 'Software', 0x0132: 'Date and time', 0x013b: 'Artist', 0x8298: 'Copyright', 0x010e: 'Description',
  0x829a: 'Exposure time', 0x829d: 'F number', 0x8827: 'ISO', 0x9003: 'Taken on', 0x9004: 'Digitised on',
  0x920a: 'Focal length', 0x9209: 'Flash', 0xa002: 'Width', 0xa003: 'Height', 0xa432: 'Lens', 0xa434: 'Lens model',
  0x9286: 'User comment', 0xa420: 'Image ID', 0x8769: '_exif', 0x8825: '_gps',
};
const GPS_TAGS = { 0x0001: 'Latitude ref', 0x0002: 'Latitude', 0x0003: 'Longitude ref', 0x0004: 'Longitude', 0x0006: 'Altitude', 0x0007: 'GPS time', 0x001d: 'GPS date' };
const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

// ─── JPEG ─────────────────────────────────────────────────────────────

const isJpeg = (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8;
const isPng = (bytes) => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;

// Walks the JPEG's segments: each starts FF, a marker, then its length.
function jpegSegments(bytes) {
  const out = [];
  let at = 2;
  while (at < bytes.length - 1) {
    if (bytes[at] !== 0xff) break;
    const marker = bytes[at + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (marker === 0xda) {
      // Start of the picture data: everything from here is the image itself.
      out.push({ marker, start: at, end: bytes.length, image: true });
      break;
    }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    out.push({ marker, start: at, end: at + 2 + length, dataStart: at + 4, dataEnd: at + 2 + length });
    at += 2 + length;
  }
  return out;
}

function readExif(view, start, tiffEnd) {
  const little = view.getUint16(start) === 0x4949;
  const u16 = (at) => view.getUint16(at, little);
  const u32 = (at) => view.getUint32(at, little);
  if (u16(start + 2) !== 42) return [];
  const found = [];
  const readIfd = (offset, names, prefix = '') => {
    const at = start + offset;
    if (at + 2 > tiffEnd) return;
    const count = u16(at);
    for (let i = 0; i < count; i++) {
      const entry = at + 2 + i * 12;
      if (entry + 12 > tiffEnd) return;
      const tag = u16(entry);
      const type = u16(entry + 2);
      const length = u32(entry + 4);
      const size = (SIZES[type] ?? 1) * length;
      const valueAt = size > 4 ? start + u32(entry + 8) : entry + 8;
      const name = names[tag];
      if (name === '_exif' || name === '_gps') {
        readIfd(u32(entry + 8), name === '_gps' ? GPS_TAGS : TAGS, name === '_gps' ? 'GPS ' : '');
        continue;
      }
      if (!name || valueAt + size > tiffEnd) continue;
      found.push({ name: prefix + name, value: readValue(view, valueAt, type, length, little) });
    }
  };
  readIfd(u32(start + 4), TAGS);
  return found;
}

function readValue(view, at, type, length, little) {
  if (type === 2) {
    let text = '';
    for (let i = 0; i < length && view.getUint8(at + i); i++) text += String.fromCharCode(view.getUint8(at + i));
    return text.trim();
  }
  const numbers = [];
  for (let i = 0; i < Math.min(length, 8); i++) {
    const spot = at + i * (SIZES[type] ?? 1);
    if (type === 1 || type === 7) numbers.push(view.getUint8(spot));
    else if (type === 3) numbers.push(view.getUint16(spot, little));
    else if (type === 4) numbers.push(view.getUint32(spot, little));
    else if (type === 5) numbers.push(view.getUint32(spot, little) / (view.getUint32(spot + 4, little) || 1));
    else if (type === 9) numbers.push(view.getInt32(spot, little));
    else if (type === 10) numbers.push(view.getInt32(spot, little) / (view.getInt32(spot + 4, little) || 1));
  }
  // Latitudes and longitudes come as degrees, minutes and seconds.
  if (type === 5 && numbers.length === 3) return `${numbers[0]}° ${numbers[1]}′ ${numbers[2].toFixed(2)}″`;
  return numbers.map((n) => (Number.isInteger(n) ? n : Number(n.toFixed(4)))).join(', ');
}

// ─── PNG ──────────────────────────────────────────────────────────────

const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'pHYs', 'sPLT']);

function pngChunks(bytes) {
  const out = [];
  let at = 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at);
    const name = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    out.push({ name, start: at, end: at + 12 + length, dataStart: at + 8, length });
    at += 12 + length;
    if (name === 'IEND') break;
  }
  return out;
}

function pngText(bytes, chunk) {
  const raw = bytes.subarray(chunk.dataStart, chunk.dataStart + chunk.length);
  const split = raw.indexOf(0);
  const key = new TextDecoder().decode(raw.subarray(0, split < 0 ? raw.length : split));
  // Text chunks can hold nulls and other control codes; they would make a mess of the list.
  const decoded = new TextDecoder().decode(raw.subarray((split < 0 ? raw.length : split) + 1));
  const value = [...decoded].map((ch) => (ch.codePointAt(0) < 32 ? ' ' : ch)).join('');
  return { name: key || chunk.name, value: value.slice(0, 300).trim() };
}

// ─── What a tool asks for ─────────────────────────────────────────────

export const IMAGE_KINDS = ['jpg', 'jpeg', 'png'];
export const extOf = (name) => (name.split('.').pop() || '').toLowerCase();
export const isStrippableImage = (name) => IMAGE_KINDS.includes(extOf(name));

// Everything hidden inside the file, as a plain list.
export async function readMetadata(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  if (isJpeg(bytes)) {
    const fields = [];
    let extras = 0;
    for (const segment of jpegSegments(bytes)) {
      if (segment.image) continue;
      if (segment.marker === 0xe1) {
        const header = String.fromCharCode(...bytes.subarray(segment.dataStart, segment.dataStart + 4));
        if (header === 'Exif') fields.push(...readExif(view, segment.dataStart + 6, segment.dataEnd));
        else extras++; // XMP and the like
      } else if (segment.marker === 0xed || segment.marker === 0xee || segment.marker === 0xfe) {
        extras++; // Photoshop, Adobe, plain comments
      }
    }
    if (extras) fields.push({ name: 'Other blocks', value: `${extras} (XMP, Photoshop or comments)` });
    return { kind: 'jpeg', fields };
  }
  if (isPng(bytes)) {
    const fields = [];
    for (const chunk of pngChunks(bytes)) {
      if (chunk.name === 'tEXt' || chunk.name === 'iTXt' || chunk.name === 'zTXt') fields.push(pngText(bytes, chunk));
      else if (chunk.name === 'eXIf') fields.push(...readExif(view, chunk.dataStart, chunk.dataStart + chunk.length));
      else if (chunk.name === 'tIME') fields.push({ name: 'Changed on', value: 'yes' });
    }
    return { kind: 'png', fields };
  }
  return { kind: 'other', fields: [] };
}

// Cuts the metadata out without touching the picture itself: no re-encoding,
// so nothing is lost and the file only gets smaller.
export async function stripImage(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isJpeg(bytes)) {
    const keep = [bytes.subarray(0, 2)];
    for (const segment of jpegSegments(bytes)) {
      const drop = segment.marker === 0xe1 || segment.marker === 0xe2 || segment.marker === 0xed || segment.marker === 0xee || segment.marker === 0xfe;
      // APP0 (JFIF) stays: some viewers want it.
      if (!drop) keep.push(bytes.subarray(segment.start, segment.end));
    }
    return new Blob(keep, { type: 'image/jpeg' });
  }
  if (isPng(bytes)) {
    const keep = [bytes.subarray(0, 8)];
    for (const chunk of pngChunks(bytes)) if (PNG_KEEP.has(chunk.name)) keep.push(bytes.subarray(chunk.start, chunk.end));
    return new Blob(keep, { type: 'image/png' });
  }
  return null;
}
