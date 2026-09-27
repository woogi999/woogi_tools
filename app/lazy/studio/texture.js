// Materials as stacks of layers, and the generators that feed them.
//
// A material's layers (bottom first in the document, shown top first) each
// cover some of the surface and say what's there: a colour, a roughness, a
// metalness, a height. Paint layers keep their coverage as pixels (in the
// pixel store, keyed by layer id); fill layers are a flat material or a
// generator; either kind can have a mask, painted or generated. The
// compositor folds the stack into the textures the renderer uses:
//   color  RGBA (sRGB)          → map
//   orm    R = AO, G = rough, B = metal  → aoMap, roughnessMap, metalnessMap
//   height grey                 → bumpMap
// Generators run on the texel map (bake.js) in 3D, so they're seamless.

import { fbm3, ridged3, worley3, noise3, seedCell, rand } from './noise';
import { newId } from './doc';
import { hexToRgb } from './anim';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a || 1e-6));
  return t * t * (3 - 2 * t);
};

// Pushes a 0..1 field towards covering `amount` of the surface with edges
// as sharp as `contrast`.
function level(v, amount, contrast) {
  const t = 1 - amount;
  const w = 0.5 / Math.max(contrast, 0.05);
  return smooth(t - w, t + w, v);
}

// ─── Generators ────────────────────────────────────────────────────────

const num = (key, label, min, max, step = 0.01) => ({
  key,
  label,
  type: 'number',
  min,
  max,
  step,
});
const int = (key, label, min, max) => ({
  key,
  label,
  type: 'int',
  min,
  max,
  step: 1,
});
const AXES = [
  { value: 0, label: 'X' },
  { value: 1, label: 'Y' },
  { value: 2, label: 'Z' },
];

// Each generator: (position 0..1 in the object's box, normal, aux, params, texel) → 0..1.
export const GENERATORS = {
  noise: {
    label: 'Noise',
    defaults: { scale: 6, octaves: 4, amount: 0.5, contrast: 1, seed: 1 },
    params: [
      num('scale', 'Scale', 0.1, 100, 0.1),
      int('octaves', 'Detail', 1, 8),
      num('amount', 'Amount', 0, 1),
      num('contrast', 'Contrast', 0.05, 20, 0.05),
      int('seed', 'Seed', 0, 999),
    ],
    fn: (p, n, aux, g) =>
      level(
        fbm3(p[0] * g.scale, p[1] * g.scale, p[2] * g.scale, g.octaves, g.seed),
        g.amount,
        g.contrast,
      ),
  },
  scratches: {
    label: 'Scratches',
    defaults: { density: 12, length: 0.6, width: 0.012, amount: 0.7, seed: 3 },
    params: [
      num('density', 'Density', 1, 60, 0.5),
      num('length', 'Length', 0.05, 2),
      num('width', 'Width', 0.001, 0.1, 0.001),
      num('amount', 'Amount', 0, 1),
      int('seed', 'Seed', 0, 999),
    ],
    fn(p, n, aux, g) {
      // Each cell of a 3D grid holds two short random strokes; a texel is
      // scratched when it's within `width` (in cell units) of one.
      const s = g.density;
      const x = p[0] * s,
        y = p[1] * s,
        z = p[2] * s;
      const cx = Math.floor(x),
        cy = Math.floor(y),
        cz = Math.floor(z);
      let best = 0;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            const ix = cx + dx,
              iy = cy + dy,
              iz = cz + dz;
            seedCell(ix, iy, iz, g.seed);
            const r = rand;
            for (let k = 0; k < 2; k++) {
              const keep = r() <= g.amount;
              const ox = ix + r(),
                oy = iy + r(),
                oz = iz + r();
              let ux = r() - 0.5,
                uy = (r() - 0.5) * 0.4,
                uz = r() - 0.5;
              const half = (g.length * (0.5 + r())) / 2;
              if (!keep) continue;
              const px = x - ox,
                py = y - oy,
                pz = z - oz;
              // Too far from the stroke's middle to touch it: skip the maths.
              const reach = half + g.width * s;
              if (px * px + py * py + pz * pz > reach * reach) continue;
              const l = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
              ux /= l;
              uy /= l;
              uz /= l;
              const t = Math.max(
                -half,
                Math.min(half, px * ux + py * uy + pz * uz),
              );
              const qx = px - ux * t,
                qy = py - uy * t,
                qz = pz - uz * t;
              const w = g.width * s * (1 - Math.abs(t) / half) + 1e-4;
              const d2 = qx * qx + qy * qy + qz * qz;
              if (d2 < w * w) best = Math.max(best, 1 - Math.sqrt(d2) / w);
            }
          }
      return best;
    },
  },
  dirt: {
    label: 'Dirt',
    uses: ['ao'],
    defaults: { amount: 0.5, contrast: 1.5, scale: 8, upward: 0.3, seed: 5 },
    params: [
      num('amount', 'Amount', 0, 1),
      num('contrast', 'Contrast', 0.05, 20, 0.05),
      num('scale', 'Breakup scale', 0.5, 60, 0.5),
      num('upward', 'Settles on top', 0, 1),
      int('seed', 'Seed', 0, 999),
    ],
    fn(p, n, aux, g, i) {
      const cavity = 1 - (aux.ao ? aux.ao[i] : 1);
      const up = Math.max(0, n[1]) * g.upward;
      const breakup = fbm3(
        p[0] * g.scale,
        p[1] * g.scale,
        p[2] * g.scale,
        4,
        g.seed,
      );
      return level(
        cavity * 1.4 + up * 0.6 + (breakup - 0.5) * 0.6,
        g.amount,
        g.contrast,
      );
    },
  },
  rust: {
    label: 'Rust',
    uses: ['ao', 'curvature'],
    defaults: { amount: 0.45, contrast: 2, scale: 5, seed: 7 },
    params: [
      num('amount', 'Amount', 0, 1),
      num('contrast', 'Contrast', 0.05, 20, 0.05),
      num('scale', 'Scale', 0.5, 60, 0.5),
      int('seed', 'Seed', 0, 999),
    ],
    fn(p, n, aux, g, i) {
      const blotch = fbm3(
        p[0] * g.scale,
        p[1] * g.scale,
        p[2] * g.scale,
        5,
        g.seed,
      );
      const pits = ridged3(
        p[0] * g.scale * 4,
        p[1] * g.scale * 4,
        p[2] * g.scale * 4,
        3,
        g.seed + 3,
      );
      const cavity = 1 - (aux.ao ? aux.ao[i] : 1);
      const edge = aux.curvature ? Math.max(0, aux.curvature[i] - 0.5) * 2 : 0;
      return level(
        blotch * 0.8 + pits * 0.25 + cavity * 0.5 + edge * 0.3 - 0.2,
        g.amount,
        g.contrast,
      );
    },
  },
  edgeWear: {
    label: 'Edge wear',
    uses: ['curvature'],
    defaults: { amount: 0.35, contrast: 3, breakup: 0.5, scale: 12, seed: 11 },
    params: [
      num('amount', 'Amount', 0, 1),
      num('contrast', 'Contrast', 0.05, 20, 0.05),
      num('breakup', 'Breakup', 0, 1),
      num('scale', 'Breakup scale', 0.5, 80, 0.5),
      int('seed', 'Seed', 0, 999),
    ],
    fn(p, n, aux, g, i) {
      const edge = aux.curvature ? Math.max(0, aux.curvature[i] - 0.5) * 2 : 0;
      const b = fbm3(p[0] * g.scale, p[1] * g.scale, p[2] * g.scale, 4, g.seed);
      return level(edge * 1.3 - (b - 0.5) * g.breakup, g.amount, g.contrast);
    },
  },
  grunge: {
    label: 'Grunge',
    defaults: { amount: 0.4, contrast: 2, scale: 10, seed: 13 },
    params: [
      num('amount', 'Amount', 0, 1),
      num('contrast', 'Contrast', 0.05, 20, 0.05),
      num('scale', 'Scale', 0.5, 80, 0.5),
      int('seed', 'Seed', 0, 999),
    ],
    fn(p, n, aux, g) {
      const a = fbm3(p[0] * g.scale, p[1] * g.scale, p[2] * g.scale, 6, g.seed);
      const w = worley3(
        p[0] * g.scale * 2,
        p[1] * g.scale * 2,
        p[2] * g.scale * 2,
        g.seed + 1,
      );
      return level(
        a * 0.75 + (1 - Math.min(1, w.f1)) * 0.35 - 0.1,
        g.amount,
        g.contrast,
      );
    },
  },
  woodGrain: {
    label: 'Wood grain',
    defaults: { rings: 18, distortion: 0.35, axis: 1, streaks: 0.3, seed: 17 },
    params: [
      num('rings', 'Rings', 1, 100, 0.5),
      num('distortion', 'Distortion', 0, 2),
      { key: 'axis', label: 'Grain axis', type: 'select', options: AXES },
      num('streaks', 'Streaks', 0, 1),
      int('seed', 'Seed', 0, 999),
    ],
    fn(p, n, aux, g) {
      const ax = Number(g.axis);
      const [i, j] = [(ax + 1) % 3, (ax + 2) % 3];
      const warp = fbm3(p[0] * 3, p[1] * 3, p[2] * 3, 3, g.seed) - 0.5;
      const r =
        Math.sqrt((p[i] - 0.5) ** 2 + (p[j] - 0.5) ** 2) +
        warp * g.distortion * 0.3;
      const ring = r * g.rings;
      const band = Math.pow(0.5 + 0.5 * Math.sin(ring * Math.PI * 2), 3);
      const streak = noise3(p[i] * 60, p[ax] * 3, p[j] * 60, g.seed + 5);
      return clamp01(band * (1 - g.streaks) + streak * g.streaks);
    },
  },
  stone: {
    label: 'Stone',
    defaults: { cells: 6, cracks: 0.06, variation: 0.5, seed: 19 },
    params: [
      num('cells', 'Stones', 1, 60, 0.5),
      num('cracks', 'Crack width', 0, 0.5),
      num('variation', 'Variation', 0, 1),
      int('seed', 'Seed', 0, 999),
    ],
    fn(p, n, aux, g) {
      const w = worley3(p[0] * g.cells, p[1] * g.cells, p[2] * g.cells, g.seed);
      const crack = smooth(0, g.cracks + 1e-3, w.f2 - w.f1);
      const surface = fbm3(
        p[0] * g.cells * 6,
        p[1] * g.cells * 6,
        p[2] * g.cells * 6,
        3,
        g.seed + 2,
      );
      return clamp01(
        crack *
          (1 - g.variation * 0.5 + w.id * g.variation * 0.5) *
          (0.85 + surface * 0.3),
      );
    },
  },
  colorVariation: {
    label: 'Colour variation',
    defaults: { scale: 3, contrast: 1, seed: 23 },
    params: [
      num('scale', 'Scale', 0.1, 40, 0.1),
      num('contrast', 'Contrast', 0.05, 10, 0.05),
      int('seed', 'Seed', 0, 999),
    ],
    fn: (p, n, aux, g) =>
      clamp01(
        0.5 +
          (fbm3(p[0] * g.scale, p[1] * g.scale, p[2] * g.scale, 3, g.seed) -
            0.5) *
            2 *
            g.contrast,
      ),
  },
  gradient: {
    label: 'Gradient',
    defaults: { axis: 1, from: 0, to: 1 },
    params: [
      { key: 'axis', label: 'Axis', type: 'select', options: AXES },
      num('from', 'From', -1, 2),
      num('to', 'To', -1, 2),
    ],
    fn: (p, n, aux, g) =>
      clamp01((p[Number(g.axis)] - g.from) / (g.to - g.from || 1e-6)),
  },
  ao: {
    label: 'Ambient occlusion',
    uses: ['ao'],
    defaults: { power: 1 },
    params: [num('power', 'Power', 0.1, 8, 0.1)],
    fn: (p, n, aux, g, i) => Math.pow(aux.ao ? aux.ao[i] : 1, g.power),
  },
  curvature: {
    label: 'Curvature',
    uses: ['curvature'],
    defaults: { contrast: 1 },
    params: [num('contrast', 'Contrast', 0.1, 10, 0.1)],
    fn: (p, n, aux, g, i) =>
      clamp01(
        0.5 + ((aux.curvature ? aux.curvature[i] : 0.5) - 0.5) * g.contrast,
      ),
  },
};

// Runs a generator over every covered texel. `aux` holds baked maps some
// generators need (they're asked for through `uses`).
export function runGenerator(
  map,
  gen,
  aux = {},
  {
    from = 0,
    to = map.size * map.size,
    out = new Float32Array(map.size * map.size),
  } = {},
) {
  const def = GENERATORS[gen?.type];
  if (!def) return out;
  const g = { ...def.defaults, ...gen.params };
  const { min, max } = map.surf;
  const span = Math.max(
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2],
    1e-6,
  );
  const p = [0, 0, 0];
  const n = [0, 0, 0];
  for (let i = from; i < to; i++) {
    if (map.tri[i] < 0) continue;
    p[0] = (map.pos[i * 3] - min[0]) / span;
    p[1] = (map.pos[i * 3 + 1] - min[1]) / span;
    p[2] = (map.pos[i * 3 + 2] - min[2]) / span;
    n[0] = map.snrm[i * 3];
    n[1] = map.snrm[i * 3 + 1];
    n[2] = map.snrm[i * 3 + 2];
    out[i] = def.fn(p, n, aux, g, i);
  }
  return out;
}

// ─── Layers ────────────────────────────────────────────────────────────

export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'softLight',
  'add',
  'subtract',
  'darken',
  'lighten',
  'difference',
];

const BLEND = {
  normal: (a, b) => b,
  multiply: (a, b) => a * b,
  screen: (a, b) => 1 - (1 - a) * (1 - b),
  overlay: (a, b) => (a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b)),
  softLight: (a, b) =>
    b < 0.5
      ? a - (1 - 2 * b) * a * (1 - a)
      : a +
        (2 * b - 1) *
          ((a <= 0.25 ? ((16 * a - 12) * a + 4) * a : Math.sqrt(a)) - a),
  add: (a, b) => Math.min(1, a + b),
  subtract: (a, b) => Math.max(0, a - b),
  darken: (a, b) => Math.min(a, b),
  lighten: (a, b) => Math.max(a, b),
  difference: (a, b) => Math.abs(a - b),
};

export function newLayer(kind = 'paint', props = {}) {
  return {
    id: newId('lyr'),
    name: kind === 'paint' ? 'Paint' : 'Fill',
    kind,
    visible: true,
    opacity: 1,
    blend: 'normal',
    channels: {
      color: true,
      rough: kind === 'fill',
      metal: kind === 'fill',
      height: false,
    },
    fill: {
      mode: 'solid',
      color: '#b0b4bc',
      color2: '#40444c',
      rough: 0.5,
      metal: 0,
      height: 0.5,
      gen: { type: 'noise', params: {} },
      image: null,
    },
    mask: null,
    ...props,
  };
}

// Painted layer pixels: colour with coverage in alpha, and material values
// (R rough, G metal, B height) with their own coverage.
export function paintBuffers(size) {
  return {
    size,
    color: new Uint8ClampedArray(size * size * 4),
    pbr: new Uint8ClampedArray(size * size * 4),
  };
}

export function maskBuffer(size, value = 255) {
  return { size, mask: new Uint8ClampedArray(size * size).fill(value) };
}

// The composited textures for a material. `region` = [x0, y0, x1, y1]
// limits the work to a rectangle (a brush dab's), `out` reuses buffers.
// `fields(layer, which)` hands back a generator's or image's per-texel
// values for fill layers and generated masks (cached by the caller).
export function composite(
  mat,
  { size, pixels, fields, ao = null, region = null, out = null },
) {
  const N = size * size;
  out ??= {
    size,
    color: new Uint8ClampedArray(N * 4),
    orm: new Uint8ClampedArray(N * 4),
    height: new Uint8ClampedArray(N * 4),
  };
  const [x0, y0, x1, y1] = region ?? [0, 0, size - 1, size - 1];
  const base = hexToRgb(mat.color);
  const layers = (mat.layers ?? []).filter((l) => l.visible && l.opacity > 0);
  // A field still being computed comes back `false`: its layer waits.
  const prepared = layers
    .map((l) => {
      const px = pixels.get(l.id);
      const mk = l.mask
        ? l.mask.mode === 'paint'
          ? pixels.get(`${l.id}:mask`)
          : null
        : null;
      return {
        l,
        px,
        mask: mk?.mask ?? null,
        maskField: l.mask?.mode === 'generator' ? fields(l, 'mask') : null,
        fill:
          l.kind === 'fill' && l.fill.mode !== 'solid'
            ? fields(l, 'fill')
            : null,
        c1: hexToRgb(l.fill.color),
        c2: hexToRgb(l.fill.color2 ?? '#000000'),
        blend: BLEND[l.blend] ?? BLEND.normal,
      };
    })
    .filter((L) => L.maskField !== false && L.fill !== false);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = y * size + x;
      let r = base[0],
        g = base[1],
        b = base[2];
      let rough = mat.rough,
        metal = mat.metal,
        h = 0.5;
      for (const L of prepared) {
        const { l } = L;
        let m = l.opacity;
        const mv = L.maskField
          ? L.maskField[i]
          : L.mask
            ? L.mask[i] / 255
            : null;
        if (mv !== null) m *= l.mask.invert ? 1 - mv : mv;
        if (m <= 0) continue;
        let cr, cg, cb, ca, lr, lm, lh, pa;
        if (l.kind === 'paint') {
          if (!L.px) continue;
          const c = L.px.color;
          const p = L.px.pbr;
          ca = c[i * 4 + 3] / 255;
          cr = c[i * 4] / 255;
          cg = c[i * 4 + 1] / 255;
          cb = c[i * 4 + 2] / 255;
          pa = p[i * 4 + 3] / 255;
          lr = p[i * 4] / 255;
          lm = p[i * 4 + 1] / 255;
          lh = p[i * 4 + 2] / 255;
        } else {
          ca = pa = 1;
          lr = l.fill.rough;
          lm = l.fill.metal;
          lh = l.fill.height ?? 0.5;
          if (L.fill) {
            const f = L.fill;
            if (l.fill.mode === 'image') {
              cr = f[i * 4] / 255;
              cg = f[i * 4 + 1] / 255;
              cb = f[i * 4 + 2] / 255;
              ca = f[i * 4 + 3] / 255;
              pa = ca;
            } else {
              // A generator mixes between the fill's two colours (and
              // lets roughness follow it a little, as real wear would).
              const v = f[i];
              cr = L.c2[0] + (L.c1[0] - L.c2[0]) * v;
              cg = L.c2[1] + (L.c1[1] - L.c2[1]) * v;
              cb = L.c2[2] + (L.c1[2] - L.c2[2]) * v;
              lh = 0.5 + (v - 0.5) * (l.fill.height ?? 0.5);
            }
          } else {
            [cr, cg, cb] = L.c1;
          }
        }
        const a = ca * m;
        if (l.channels.color && a > 0) {
          r += (L.blend(r, cr) - r) * a;
          g += (L.blend(g, cg) - g) * a;
          b += (L.blend(b, cb) - b) * a;
        }
        const ap = pa * m;
        if (ap > 0) {
          if (l.channels.rough) rough += (lr - rough) * ap;
          if (l.channels.metal) metal += (lm - metal) * ap;
          if (l.channels.height) h += (lh - 0.5) * ap;
        }
      }
      const o = i * 4;
      out.color[o] = r * 255;
      out.color[o + 1] = g * 255;
      out.color[o + 2] = b * 255;
      out.color[o + 3] = 255;
      out.orm[o] = ao ? ao[i] * 255 : 255;
      out.orm[o + 1] = rough * 255;
      out.orm[o + 2] = metal * 255;
      out.orm[o + 3] = 255;
      const hv = Math.max(0, Math.min(1, h)) * 255;
      out.height[o] = out.height[o + 1] = out.height[o + 2] = hv;
      out.height[o + 3] = 255;
    }
  return out;
}

// ─── Smart materials ───────────────────────────────────────────────────

// Recipes for whole layer stacks. Every layer they make is an ordinary,
// editable layer; `material` sets the material's own base values.
const fill = (name, fillProps, props = {}) =>
  newLayer('fill', {
    name,
    channels: {
      color: true,
      rough: true,
      metal: true,
      height: false,
      ...props.channels,
    },
    fill: {
      mode: 'solid',
      color: '#888888',
      color2: '#444444',
      rough: 0.5,
      metal: 0,
      height: 0.5,
      gen: { type: 'noise', params: {} },
      image: null,
      ...fillProps,
    },
    ...props,
  });
const genMask = (type, params = {}, invert = false) => ({
  mode: 'generator',
  gen: { type, params },
  invert,
});
const genFill = (type, params = {}) => ({
  mode: 'generator',
  gen: { type, params },
});

export const SMART_MATERIALS = {
  metal: {
    label: 'Metal',
    swatch: '#a4a8ae',
    material: { color: '#a4a8ae', rough: 0.3, metal: 1 },
    layers: () => [
      fill('Base metal', { color: '#a4a8ae', rough: 0.3, metal: 1 }),
      fill(
        'Roughness breakup',
        { rough: 0.55, metal: 1 },
        {
          opacity: 0.6,
          channels: { color: false },
          mask: genMask('noise', { scale: 9, amount: 0.45, contrast: 0.6 }),
        },
      ),
      fill(
        'Fine scratches',
        { color: '#d4d7dc', rough: 0.2, metal: 1 },
        {
          opacity: 0.7,
          mask: genMask('scratches', { density: 18, amount: 0.6 }),
        },
      ),
    ],
  },
  plastic: {
    label: 'Plastic',
    swatch: '#d8423a',
    material: { color: '#d8423a', rough: 0.4, metal: 0 },
    layers: () => [
      fill('Plastic', { color: '#d8423a', rough: 0.4, metal: 0 }),
      fill(
        'Sheen variation',
        { rough: 0.55 },
        {
          opacity: 0.5,
          channels: { color: false, metal: false },
          mask: genMask('noise', { scale: 4, amount: 0.5, contrast: 0.5 }),
        },
      ),
    ],
  },
  wood: {
    label: 'Wood',
    swatch: '#9a6a3e',
    material: { color: '#9a6a3e', rough: 0.6, metal: 0 },
    layers: () => [
      fill(
        'Grain',
        {
          ...genFill('woodGrain', { rings: 16 }),
          color: '#b98552',
          color2: '#6e4526',
          rough: 0.62,
          metal: 0,
          height: 0.3,
        },
        { channels: { height: true } },
      ),
      fill(
        'Colour variation',
        {
          ...genFill('colorVariation', { scale: 2 }),
          color: '#c89a68',
          color2: '#5a3a20',
        },
        {
          opacity: 0.25,
          blend: 'overlay',
          channels: { rough: false, metal: false },
        },
      ),
    ],
  },
  stone: {
    label: 'Stone',
    swatch: '#8b8780',
    material: { color: '#8b8780', rough: 0.85, metal: 0 },
    layers: () => [
      fill(
        'Stones',
        {
          ...genFill('stone', { cells: 5 }),
          color: '#9b978f',
          color2: '#3b3935',
          rough: 0.85,
          metal: 0,
          height: 0.8,
        },
        { channels: { height: true } },
      ),
      fill(
        'Grit',
        {
          ...genFill('noise', { scale: 40, amount: 0.5, contrast: 1 }),
          color: '#b3aea4',
          color2: '#6b675f',
        },
        {
          opacity: 0.3,
          blend: 'overlay',
          channels: { rough: false, metal: false },
        },
      ),
      fill(
        'Dirt',
        { color: '#4a3d2e', rough: 0.95 },
        { opacity: 0.8, mask: genMask('dirt', { amount: 0.35 }) },
      ),
    ],
  },
  glass: {
    label: 'Glass',
    swatch: '#bfe3f0',
    material: {
      color: '#bfe3f0',
      rough: 0.04,
      metal: 0,
      opacity: 0.35,
      doubleSided: true,
    },
    layers: () => [
      fill('Glass', { color: '#bfe3f0', rough: 0.04, metal: 0 }),
      fill(
        'Smudges',
        { rough: 0.25 },
        {
          opacity: 0.5,
          channels: { color: false, metal: false },
          mask: genMask('grunge', { amount: 0.25, scale: 6 }),
        },
      ),
    ],
  },
  paintedMetal: {
    label: 'Painted metal',
    swatch: '#2f6fb3',
    material: { color: '#2f6fb3', rough: 0.45, metal: 0 },
    layers: () => [
      fill('Bare metal', { color: '#9ea2a8', rough: 0.35, metal: 1 }),
      fill(
        'Paint',
        { color: '#2f6fb3', rough: 0.45, metal: 0 },
        { mask: genMask('edgeWear', { amount: 0.3, contrast: 3 }, true) },
      ),
      fill(
        'Paint scratches',
        { color: '#9ea2a8', rough: 0.35, metal: 1 },
        {
          opacity: 0.9,
          mask: genMask('scratches', {
            density: 10,
            amount: 0.5,
            width: 0.008,
          }),
        },
      ),
      fill(
        'Grime',
        { color: '#3a3128', rough: 0.9, metal: 0 },
        { opacity: 0.55, mask: genMask('dirt', { amount: 0.3 }) },
      ),
    ],
  },
  rust: {
    label: 'Rust',
    swatch: '#8a4a24',
    material: { color: '#8a4a24', rough: 0.85, metal: 0 },
    layers: () => [
      fill('Steel', { color: '#8c8f94', rough: 0.4, metal: 1 }),
      fill(
        'Rust',
        {
          ...genFill('grunge', { amount: 0.6, scale: 14 }),
          color: '#9a5428',
          color2: '#4e2412',
          rough: 0.9,
          metal: 0,
          height: 0.4,
        },
        { mask: genMask('rust', { amount: 0.55 }), channels: { height: true } },
      ),
    ],
  },
  dirt: {
    label: 'Dirt',
    swatch: '#5a4632',
    material: {},
    layers: () => [
      fill(
        'Dirt',
        {
          ...genFill('noise', { scale: 20 }),
          color: '#6a543c',
          color2: '#3a2c1e',
          rough: 0.95,
          metal: 0,
        },
        { mask: genMask('dirt', { amount: 0.45, contrast: 1.5 }) },
      ),
    ],
    // Goes on top of what's there rather than replacing it.
    overlay: true,
  },
  concrete: {
    label: 'Concrete',
    swatch: '#9c9a95',
    material: { color: '#9c9a95', rough: 0.9, metal: 0 },
    layers: () => [
      fill('Concrete', {
        ...genFill('noise', { scale: 24, amount: 0.5, contrast: 0.5 }),
        color: '#a9a7a1',
        color2: '#86847e',
        rough: 0.9,
        metal: 0,
      }),
      fill(
        'Pores',
        { color: '#5f5d58', rough: 1 },
        {
          opacity: 0.7,
          mask: genMask('grunge', { amount: 0.18, contrast: 4, scale: 30 }),
        },
      ),
      fill(
        'Stains',
        {
          ...genFill('colorVariation', { scale: 1.5 }),
          color: '#8e8a80',
          color2: '#6c6860',
        },
        {
          opacity: 0.5,
          blend: 'multiply',
          channels: { rough: false, metal: false },
        },
      ),
    ],
  },
  gold: {
    label: 'Gold',
    swatch: '#e2b54a',
    material: { color: '#e2b54a', rough: 0.25, metal: 1 },
    layers: () => [
      fill('Gold', { color: '#e2b54a', rough: 0.22, metal: 1 }),
      fill(
        'Wear',
        { rough: 0.45 },
        {
          opacity: 0.5,
          channels: { color: false },
          mask: genMask('noise', { scale: 7, amount: 0.4 }),
        },
      ),
    ],
  },
  rubber: {
    label: 'Rubber',
    swatch: '#2b2b2e',
    material: { color: '#2b2b2e', rough: 0.9, metal: 0 },
    layers: () => [
      fill('Rubber', { color: '#2b2b2e', rough: 0.88, metal: 0 }),
      fill(
        'Dust',
        { color: '#6a6660', rough: 1 },
        { opacity: 0.4, mask: genMask('dirt', { amount: 0.3, upward: 0.8 }) },
      ),
    ],
  },
};

// Which fields a layer needs computed (for caching by the caller).
export function layerFieldKey(layer, which) {
  if (which === 'mask')
    return layer.mask?.mode === 'generator'
      ? JSON.stringify(layer.mask.gen)
      : null;
  if (layer.kind !== 'fill' || layer.fill.mode === 'solid') return null;
  return layer.fill.mode === 'image'
    ? `img:${layer.fill.image}`
    : JSON.stringify(layer.fill.gen);
}
