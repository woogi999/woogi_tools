import { hslToRgb, rgbToHsl, toHex, parseHex } from './color';

// Palettes made or extracted here, kept in the browser like everything else
// on the site (and so included in a backup).
const KEY = 'woogi-palettes';
const MAX_SAVED = 200;

export function loadPalettes() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list)
      ? list.filter((p) => p && Array.isArray(p.colours) && p.colours.length)
      : [];
  } catch {
    return [];
  }
}

function store(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_SAVED)));
  } catch {
    // storage blocked or full
  }
}

export function savePalette(colours, name = '') {
  const palette = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || defaultName(colours),
    colours: colours.map((c) => c.toUpperCase()),
    at: new Date().toISOString(),
  };
  store([palette, ...loadPalettes()]);
  return palette;
}

export function removePalette(id) {
  store(loadPalettes().filter((p) => p.id !== id));
}

export function renamePalette(id, name) {
  store(
    loadPalettes().map((p) =>
      p.id === id ? { ...p, name: name.trim() || p.name } : p,
    ),
  );
}

// "Warm sunset" is nicer than nothing, but a plain count will do.
function defaultName(colours) {
  const { h, s, l } = rgbToHsl(...Object.values(parseHex(colours[0])));
  const tone = l < 30 ? 'Dark' : l > 70 ? 'Light' : s < 25 ? 'Muted' : 'Bold';
  const hue =
    s < 12
      ? 'greys'
      : h < 15 || h >= 345
        ? 'reds'
        : h < 45
          ? 'oranges'
          : h < 70
            ? 'yellows'
            : h < 165
              ? 'greens'
              : h < 200
                ? 'teals'
                : h < 260
                  ? 'blues'
                  : h < 300
                    ? 'purples'
                    : 'pinks';
  return `${tone} ${hue}`;
}

// ─── Making palettes ─────────────────────────────────────────────────────

export const HARMONIES = [
  { id: 'random', label: 'Anything goes' },
  { id: 'analogous', label: 'Analogous' },
  { id: 'complementary', label: 'Complementary' },
  { id: 'split', label: 'Split complementary' },
  { id: 'triadic', label: 'Triadic' },
  { id: 'tetradic', label: 'Tetradic' },
  { id: 'monochrome', label: 'Monochrome' },
  { id: 'shades', label: 'Shades' },
];

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const wrap = (h) => ((h % 360) + 360) % 360;
const hex = (h, s, l) => {
  const { r, g, b } = hslToRgb(wrap(h), clamp(s), clamp(l));
  return toHex(r, g, b);
};
const clamp = (n) => Math.max(0, Math.min(100, n));

// `count` colours in the given harmony. Positions in `keep` (a hex or null
// per slot) stay as they are; the base hue is taken from the first kept
// colour so the new ones go with it.
export function generatePalette(count, harmony, keep = []) {
  const kept = keep.find(Boolean);
  const base = kept
    ? rgbToHsl(...Object.values(parseHex(kept)))
    : { h: rand(0, 360), s: rand(45, 85), l: rand(40, 60) };
  const hues = hueSet(harmony, base.h, count);
  return Array.from({ length: count }, (_, i) => {
    if (keep[i]) return keep[i].toUpperCase();
    if (harmony === 'monochrome')
      return hex(
        base.h,
        base.s + rand(-8, 8),
        18 + (i * 64) / Math.max(1, count - 1) + rand(-4, 4),
      );
    if (harmony === 'shades')
      return hex(base.h, base.s, 12 + (i * 76) / Math.max(1, count - 1));
    if (harmony === 'random')
      return hex(rand(0, 360), rand(35, 90), rand(30, 70));
    const jitter = harmony === 'analogous' ? 0 : rand(-6, 6);
    return hex(
      hues[i % hues.length] + jitter,
      base.s + rand(-15, 10),
      base.l + rand(-14, 14),
    );
  });
}

function hueSet(harmony, h, count) {
  switch (harmony) {
    case 'analogous':
      return Array.from(
        { length: count },
        (_, i) => h + (i - (count - 1) / 2) * 25,
      );
    case 'complementary':
      return [h, h + 180, h + 15, h + 195, h - 15, h + 165];
    case 'split':
      return [h, h + 150, h + 210, h + 30, h - 30, h + 180];
    case 'triadic':
      return [h, h + 120, h + 240, h + 20, h + 140, h + 260];
    case 'tetradic':
      return [h, h + 90, h + 180, h + 270, h + 45, h + 225];
    default:
      return [h];
  }
}

// ─── Pulling palettes out of pictures ────────────────────────────────────

// k-means over a shrunken copy of the picture. Returns the colours biggest first,
// with the share of the picture each one covers.
export function extractPalette(bitmap, count = 6) {
  const size = 96;
  const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const pixels = [];
  for (let i = 0; i < data.length; i += 4)
    if (data[i + 3] > 127) pixels.push([data[i], data[i + 1], data[i + 2]]);
  if (!pixels.length) return [];
  const k = Math.min(count, pixels.length);

  // k-means++ seeding: each new centre is picked far from the ones so far.
  const centres = [pixels[Math.floor(Math.random() * pixels.length)]];
  while (centres.length < k) {
    const dists = pixels.map((p) =>
      Math.min(...centres.map((c) => dist(p, c))),
    );
    const total = dists.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let pick = pixels.length - 1;
    for (let i = 0; i < dists.length; i++) {
      r -= dists[i];
      if (r <= 0) {
        pick = i;
        break;
      }
    }
    centres.push(pixels[pick]);
  }

  let assignment = new Array(pixels.length).fill(0);
  for (let round = 0; round < 12; round++) {
    let moved = false;
    for (let i = 0; i < pixels.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centres.length; c++) {
        const d = dist(pixels[i], centres[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assignment[i] !== best) {
        assignment[i] = best;
        moved = true;
      }
    }
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pixels.length; i++) {
      const s = sums[assignment[i]];
      s[0] += pixels[i][0];
      s[1] += pixels[i][1];
      s[2] += pixels[i][2];
      s[3]++;
    }
    for (let c = 0; c < centres.length; c++)
      if (sums[c][3])
        centres[c] = [
          sums[c][0] / sums[c][3],
          sums[c][1] / sums[c][3],
          sums[c][2] / sums[c][3],
        ];
    if (!moved) break;
  }
  const counts = centres.map(() => 0);
  for (const a of assignment) counts[a]++;
  return centres
    .map((c, i) => ({
      hex: toHex(c[0], c[1], c[2]),
      share: counts[i] / pixels.length,
    }))
    .filter((c) => c.share > 0)
    .sort((a, b) => b.share - a.share);
}

function dist(a, b) {
  // Weighted a little towards how eyes see: green counts most.
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
}
