// The Image Editor's darkroom: every adjustment is plain maths over the pixels
// of an ImageData, so the small preview and the full-size export come out
// identical. The order matters and is the same one Lightroom-style editors
// use: tone first, then colour, then detail, then the creative effects.

export const DEFAULT_EDITS = {
  exposure: 0, // -100..100
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  vibrance: 0,
  saturation: 0,
  hue: 0, // -180..180
  sharpen: 0, // 0..100
  blur: 0, // 0..100
  grain: 0,
  vignette: 0,
  fade: 0,
  grayscale: false,
  sepia: false,
  invert: false,
  posterize: 0, // 0 = off, otherwise levels 2..16
  pixelate: 0, // 0 = off, otherwise block size
  threshold: 0, // 0 = off, otherwise 1..255
  dither: 'none', // 'none' | 'floyd' | 'bayer' | 'atkinson'
  ditherColours: 2, // levels per channel for dithering
  rotate: 0, // 0, 90, 180, 270
  flipH: false,
  flipV: false,
};

export const PRESETS = [
  { id: 'none', label: 'As shot', edits: {} },
  {
    id: 'punch',
    label: 'Punch',
    edits: { contrast: 25, vibrance: 35, sharpen: 20 },
  },
  {
    id: 'matte',
    label: 'Matte',
    edits: { fade: 35, contrast: -10, saturation: -15 },
  },
  {
    id: 'warm',
    label: 'Golden',
    edits: { temperature: 35, tint: 5, exposure: 8, vignette: 25 },
  },
  {
    id: 'cool',
    label: 'Cool',
    edits: { temperature: -35, saturation: -10, contrast: 10 },
  },
  {
    id: 'bw',
    label: 'Black & white',
    edits: { grayscale: true, contrast: 20, grain: 15 },
  },
  {
    id: 'film',
    label: 'Film',
    edits: {
      grain: 35,
      fade: 20,
      vignette: 30,
      saturation: -10,
      temperature: 10,
    },
  },
  {
    id: 'sepia',
    label: 'Sepia',
    edits: { sepia: true, fade: 10, vignette: 20 },
  },
  {
    id: 'gameboy',
    label: 'Game Boy',
    edits: { pixelate: 4, dither: 'bayer', ditherColours: 2, grayscale: true },
  },
  {
    id: 'newsprint',
    label: 'Newsprint',
    edits: { dither: 'floyd', ditherColours: 2, grayscale: true, contrast: 15 },
  },
  {
    id: 'poster',
    label: 'Poster',
    edits: { posterize: 4, saturation: 30, contrast: 15 },
  },
];

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

// Luminance weights (Rec. 601), what "how bright is this pixel" means below.
const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

// Builds a 256-entry lookup table for the per-pixel tone curve: exposure,
// contrast, highlights, shadows, whites and blacks all fold into one table.
function toneTable(e) {
  const table = new Uint8ClampedArray(256);
  const exposure = 2 ** (e.exposure / 50);
  const contrast = 1 + e.contrast / 100;
  for (let i = 0; i < 256; i++) {
    let v = (i / 255) * exposure;
    // Contrast pivots around middle grey.
    v = (v - 0.5) * contrast + 0.5;
    // Highlights and shadows only touch their own end of the range.
    if (e.highlights)
      v +=
        (e.highlights / 100) * 0.5 * Math.max(0, v - 0.5) * 2 * (1 - v) * 1.5;
    if (e.shadows)
      v += (e.shadows / 100) * 0.5 * Math.max(0, 0.5 - v) * 2 * v * 1.5;
    // Whites and blacks move the end points themselves.
    if (e.whites) v += (e.whites / 100) * 0.25 * v * v;
    if (e.blacks) v -= (e.blacks / 100) * 0.25 * (1 - v) * (1 - v);
    if (e.fade) v = v * (1 - e.fade / 400) + e.fade / 400;
    table[i] = clamp(Math.round(v * 255));
  }
  return table;
}

function applyColour(data, e) {
  const doTemp = e.temperature || e.tint;
  const doSat = e.saturation || e.vibrance;
  const doHue = e.hue;
  const sat = 1 + e.saturation / 100;
  const vib = e.vibrance / 100;
  const hue = (e.hue * Math.PI) / 180;
  const cosH = Math.cos(hue);
  const sinH = Math.sin(hue);
  const tempR = (e.temperature / 100) * 30;
  const tempB = -(e.temperature / 100) * 30;
  const tintG = -(e.tint / 100) * 25;
  const tintRB = (e.tint / 100) * 12;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    if (doTemp) {
      r += tempR + tintRB;
      g += tintG;
      b += tempB + tintRB;
    }
    if (doHue) {
      // Rotation around the grey axis in YIQ space.
      const y = luma(r, g, b);
      const iq = 0.596 * r - 0.274 * g - 0.322 * b;
      const q = 0.211 * r - 0.523 * g + 0.312 * b;
      const i2 = iq * cosH - q * sinH;
      const q2 = iq * sinH + q * cosH;
      r = y + 0.956 * i2 + 0.621 * q2;
      g = y - 0.272 * i2 - 0.647 * q2;
      b = y - 1.106 * i2 + 1.703 * q2;
    }
    if (doSat) {
      const l = luma(r, g, b);
      let s = sat;
      if (vib) {
        // Vibrance boosts the dull colours more than the already vivid ones.
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const already = (max - min) / 255;
        s += vib * (1 - already);
      }
      r = l + (r - l) * s;
      g = l + (g - l) * s;
      b = l + (b - l) * s;
    }
    data[i] = clamp(r);
    data[i + 1] = clamp(g);
    data[i + 2] = clamp(b);
  }
}

// A separable box blur run three times is a close enough gaussian, and quick.
function boxBlur(src, width, height, radius) {
  const out = new Float32Array(src.length);
  const tmp = new Float32Array(src.length);
  const size = radius * 2 + 1;
  // Horizontal
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++)
        sum += src[row + Math.min(width - 1, Math.max(0, x)) * 4 + c];
      for (let x = 0; x < width; x++) {
        tmp[row + x * 4 + c] = sum / size;
        const add = Math.min(width - 1, x + radius + 1);
        const sub = Math.max(0, x - radius);
        sum += src[row + add * 4 + c] - src[row + sub * 4 + c];
      }
    }
  }
  // Vertical
  for (let x = 0; x < width; x++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++)
        sum += tmp[(Math.min(height - 1, Math.max(0, y)) * width + x) * 4 + c];
      for (let y = 0; y < height; y++) {
        out[(y * width + x) * 4 + c] = sum / size;
        const add = Math.min(height - 1, y + radius + 1);
        const sub = Math.max(0, y - radius);
        sum += tmp[(add * width + x) * 4 + c] - tmp[(sub * width + x) * 4 + c];
      }
    }
  }
  return out;
}

export function gaussian(data, width, height, radius) {
  let blurred = boxBlur(data, width, height, radius);
  blurred = boxBlur(blurred, width, height, radius);
  blurred = boxBlur(blurred, width, height, Math.max(1, radius - 1));
  return blurred;
}

// Unsharp mask: the picture minus its blur is the detail; add some back.
function sharpen(data, width, height, amount) {
  const blurred = gaussian(data, width, height, 1);
  const k = amount / 50;
  for (let i = 0; i < data.length; i += 4)
    for (let c = 0; c < 3; c++)
      data[i + c] = clamp(data[i + c] + (data[i + c] - blurred[i + c]) * k);
}

export function pixelate(data, width, height, size) {
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      const yEnd = Math.min(height, y + size);
      const xEnd = Math.min(width, x + size);
      for (let yy = y; yy < yEnd; yy++)
        for (let xx = x; xx < xEnd; xx++) {
          const i = (yy * width + xx) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n++;
        }
      r /= n;
      g /= n;
      b /= n;
      for (let yy = y; yy < yEnd; yy++)
        for (let xx = x; xx < xEnd; xx++) {
          const i = (yy * width + xx) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
        }
    }
  }
}

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

// Dithering to `levels` shades per channel. Error diffusion (Floyd–Steinberg,
// Atkinson) pushes each pixel's rounding error onto its neighbours; ordered
// (Bayer) compares against a repeating threshold pattern instead.
function dither(data, width, height, mode, levels) {
  const step = 255 / (levels - 1);
  const quant = (v) => Math.round(clamp(v) / step) * step;
  if (mode === 'bayer') {
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const t = ((BAYER[y & 3][x & 3] + 0.5) / 16 - 0.5) * step;
        for (let c = 0; c < 3; c++) data[i + c] = quant(data[i + c] + t);
      }
    return;
  }
  const buf = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) buf[i] = data[i];
  const spread = (i, err, share) => {
    if (i >= 0 && i < buf.length) buf[i] += err * share;
  };
  const w4 = width * 4;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const old = buf[i + c];
        const next = quant(old);
        const err = old - next;
        data[i + c] = next;
        if (mode === 'atkinson') {
          const s = 1 / 8;
          if (x + 1 < width) spread(i + 4 + c, err, s);
          if (x + 2 < width) spread(i + 8 + c, err, s);
          if (x > 0) spread(i + w4 - 4 + c, err, s);
          spread(i + w4 + c, err, s);
          if (x + 1 < width) spread(i + w4 + 4 + c, err, s);
          spread(i + 2 * w4 + c, err, s);
        } else {
          if (x + 1 < width) spread(i + 4 + c, err, 7 / 16);
          if (x > 0) spread(i + w4 - 4 + c, err, 3 / 16);
          spread(i + w4 + c, err, 5 / 16);
          if (x + 1 < width) spread(i + w4 + 4 + c, err, 1 / 16);
        }
      }
    }
}

// A small deterministic noise so the grain doesn't crawl between redraws.
export function noise(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 0xffffffff) * 2 - 1;
  };
}

// Applies every edit to `image` (an ImageData) in place and returns it.
export function develop(image, edits) {
  const e = { ...DEFAULT_EDITS, ...edits };
  const { width, height, data } = image;

  if (e.pixelate > 0)
    pixelate(data, width, height, Math.max(2, Math.round(e.pixelate)));

  // Tone
  const table = toneTable(e);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = table[data[i]];
    data[i + 1] = table[data[i + 1]];
    data[i + 2] = table[data[i + 2]];
  }

  // Colour
  if (e.temperature || e.tint || e.saturation || e.vibrance || e.hue)
    applyColour(data, e);
  if (e.grayscale || e.sepia) {
    for (let i = 0; i < data.length; i += 4) {
      const l = luma(data[i], data[i + 1], data[i + 2]);
      if (e.sepia) {
        data[i] = clamp(l * 1.07 + 20);
        data[i + 1] = clamp(l * 0.95 + 5);
        data[i + 2] = clamp(l * 0.75 - 10);
      } else data[i] = data[i + 1] = data[i + 2] = l;
    }
  }

  // Detail
  if (e.blur > 0) {
    const radius = Math.max(
      1,
      Math.round((e.blur / 100) * Math.max(2, Math.min(width, height) / 40)),
    );
    const blurred = gaussian(data, width, height, radius);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = blurred[i];
      data[i + 1] = blurred[i + 1];
      data[i + 2] = blurred[i + 2];
    }
  }
  if (e.sharpen > 0) sharpen(data, width, height, e.sharpen);

  // Effects
  if (e.posterize >= 2) {
    const step = 255 / (e.posterize - 1);
    for (let i = 0; i < data.length; i += 4)
      for (let c = 0; c < 3; c++)
        data[i + c] = Math.round(data[i + c] / step) * step;
  }
  if (e.threshold > 0) {
    for (let i = 0; i < data.length; i += 4) {
      const v =
        luma(data[i], data[i + 1], data[i + 2]) >= e.threshold ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
  }
  if (e.dither !== 'none')
    dither(
      data,
      width,
      height,
      e.dither,
      Math.max(2, Math.min(16, e.ditherColours)),
    );
  if (e.invert)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i];
      data[i + 1] = 255 - data[i + 1];
      data[i + 2] = 255 - data[i + 2];
    }
  if (e.grain > 0) {
    const rand = noise(width * 31 + height);
    const amount = (e.grain / 100) * 60;
    for (let i = 0; i < data.length; i += 4) {
      const n = rand() * amount;
      data[i] = clamp(data[i] + n);
      data[i + 1] = clamp(data[i + 1] + n);
      data[i + 2] = clamp(data[i + 2] + n);
    }
  }
  if (e.vignette !== 0) {
    const cx = width / 2;
    const cy = height / 2;
    const maxD = Math.sqrt(cx * cx + cy * cy);
    const strength = e.vignette / 100;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / maxD;
        const k = 1 - strength * Math.max(0, d - 0.3) * 1.4;
        const i = (y * width + x) * 4;
        data[i] = clamp(data[i] * k);
        data[i + 1] = clamp(data[i + 1] * k);
        data[i + 2] = clamp(data[i + 2] * k);
      }
  }
  return image;
}

// Draws `source` onto a canvas with the rotation and flips applied, at most
// `maxSide` pixels on the long side (0 for full size), and returns the canvas.
export function orient(source, edits, maxSide = 0) {
  const e = { ...DEFAULT_EDITS, ...edits };
  const turned = e.rotate === 90 || e.rotate === 270;
  let w = source.width;
  let h = source.height;
  const scale =
    maxSide && Math.max(w, h) > maxSide ? maxSide / Math.max(w, h) : 1;
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = turned ? h : w;
  canvas.height = turned ? w : h;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((e.rotate * Math.PI) / 180);
  ctx.scale(e.flipH ? -1 : 1, e.flipV ? -1 : 1);
  ctx.drawImage(source, -w / 2, -h / 2, w, h);
  return canvas;
}

// The whole job: orient, then develop the pixels, on a fresh canvas.
export function render(source, edits, maxSide = 0) {
  const canvas = orient(source, edits, maxSide);
  const ctx = canvas.getContext('2d');
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  develop(image, edits);
  ctx.putImageData(image, 0, 0);
  return canvas;
}
