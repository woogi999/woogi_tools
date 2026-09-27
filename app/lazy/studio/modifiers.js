// The modifier stack. An object's final mesh is its source (a primitive's
// recipe, or a hand-edited mesh) run through its modifiers from the top of
// the list down. Nothing is baked in: a modifier can be switched off,
// retuned, moved or removed at any time and the mesh is rebuilt from the
// source. Booleans are modifiers too, whose cutter is another object in the
// scene (see evaluate.js for how its mesh is fetched and kept up to date).

import {
  bevel,
  solidify,
  mirror,
  laplacian,
  subdivide,
  decimate,
  outlineShell,
  merge,
  mapVerts,
  weld,
  triangulate,
  weldedNormals,
  bounds,
  add,
  scale,
  OUTLINE_SLOT,
} from './mesh';
import { BOOLEAN_OPS } from './csg';
import { fbm3 } from './noise';

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
const bool = (key, label) => ({ key, label, type: 'bool' });
const pick = (key, label, options) => ({ key, label, type: 'select', options });
const AXES = [
  { value: 0, label: 'X' },
  { value: 1, label: 'Y' },
  { value: 2, label: 'Z' },
];

export const MODIFIERS = {
  boolean: {
    label: 'Boolean',
    icon: 'combine',
    defaults: { op: 'subtract', operand: null, show: true },
    params: [
      pick('op', 'Operation', [
        { value: 'subtract', label: 'Subtract' },
        { value: 'union', label: 'Union' },
        { value: 'intersect', label: 'Intersect' },
      ]),
      { key: 'operand', label: 'Cutter', type: 'object' },
      bool('show', 'Show cutter'),
    ],
    apply(m, p, ctx) {
      if (!p.operand) return m;
      const other = ctx.operand?.(p.operand);
      if (!other) return m;
      return BOOLEAN_OPS[p.op]?.(m, other) ?? m;
    },
  },
  bevel: {
    label: 'Bevel',
    icon: 'squircle',
    defaults: { width: 0.05, segments: 1, angle: 30 },
    params: [
      num('width', 'Width', 0, 10, 0.005),
      int('segments', 'Segments', 1, 4),
      num('angle', 'Angle limit', 0, 180, 1),
    ],
    apply: (m, p) =>
      bevel(m, p.width, { segments: p.segments, angle: p.angle }),
  },
  solidify: {
    label: 'Solidify',
    icon: 'layers-3',
    defaults: { thickness: 0.05 },
    params: [num('thickness', 'Thickness', -10, 10, 0.005)],
    apply: (m, p) => solidify(m, p.thickness),
  },
  mirror: {
    label: 'Mirror',
    icon: 'flip-horizontal-2',
    defaults: { axis: 0, weld: true },
    params: [pick('axis', 'Axis', AXES), bool('weld', 'Merge seam')],
    apply: (m, p) => mirror(m, Number(p.axis), { weld: p.weld }),
  },
  smooth: {
    label: 'Smooth',
    icon: 'waves',
    defaults: { iterations: 2, factor: 0.5 },
    params: [
      int('iterations', 'Iterations', 1, 30),
      num('factor', 'Factor', 0, 1),
    ],
    apply: (m, p) => laplacian(m, p.iterations, p.factor),
  },
  subdivision: {
    label: 'Subdivision',
    icon: 'grid-3x3',
    defaults: { levels: 1, smooth: true, shadeSmooth: true },
    params: [
      int('levels', 'Levels', 1, 4),
      bool('smooth', 'Smooth (Catmull–Clark)'),
      bool('shadeSmooth', 'Shade smooth'),
    ],
    apply(m, p) {
      const out = subdivide(m, p.levels, { smooth: p.smooth });
      return p.shadeSmooth
        ? { v: out.v, f: out.f.map((f) => ({ ...f, s: true })) }
        : out;
    },
  },
  decimate: {
    label: 'Decimate',
    icon: 'shrink',
    defaults: { ratio: 0.5 },
    params: [num('ratio', 'Ratio', 0.02, 1)],
    apply: (m, p) => decimate(m, p.ratio),
  },
  outline: {
    label: 'Outline',
    icon: 'circle-dashed',
    defaults: { thickness: 0.03, smoothness: 1 },
    params: [
      num('thickness', 'Thickness', 0, 5, 0.002),
      int('smoothness', 'Smoothness', 0, 10),
    ],
    apply: (m, p) =>
      merge(
        m,
        outlineShell(m, p.thickness, {
          smoothness: p.smoothness,
          slot: OUTLINE_SLOT,
        }),
      ),
  },
  array: {
    label: 'Array',
    icon: 'copy',
    defaults: { count: 3, x: 1.2, y: 0, z: 0, merge: false },
    params: [
      int('count', 'Count', 1, 100),
      num('x', 'Offset X', -100, 100),
      num('y', 'Offset Y', -100, 100),
      num('z', 'Offset Z', -100, 100),
      bool('merge', 'Merge touching'),
    ],
    apply(m, p) {
      let out = { v: [], f: [] };
      for (let i = 0; i < p.count; i++) {
        const off = [p.x * i, p.y * i, p.z * i];
        out = merge(
          out,
          mapVerts(m, (v) => add(v, off)),
        );
      }
      return p.merge ? weld(out, 1e-4) : out;
    },
  },
  weld: {
    label: 'Weld',
    icon: 'merge',
    defaults: { distance: 0.001 },
    params: [num('distance', 'Distance', 0, 1, 0.0005)],
    apply: (m, p) => weld(m, Math.max(1e-7, p.distance)),
  },
  displace: {
    label: 'Displace',
    icon: 'mountain',
    defaults: { strength: 0.1, scale: 2, octaves: 3, seed: 1 },
    params: [
      num('strength', 'Strength', -5, 5),
      num('scale', 'Noise scale', 0.01, 50, 0.1),
      int('octaves', 'Detail', 1, 6),
      int('seed', 'Seed', 0, 999),
    ],
    apply(m, p) {
      const n = weldedNormals(m);
      return mapVerts(m, (v, i) => {
        const h =
          fbm3(
            v[0] * p.scale,
            v[1] * p.scale,
            v[2] * p.scale,
            p.octaves,
            p.seed,
          ) - 0.5;
        return add(v, scale(n[i], h * 2 * p.strength));
      });
    },
  },
  twist: {
    label: 'Twist',
    icon: 'rotate-3d',
    defaults: { angle: 90, axis: 1 },
    params: [num('angle', 'Angle', -1440, 1440, 1), pick('axis', 'Axis', AXES)],
    apply(m, p) {
      const ax = Number(p.axis);
      const { min, max } = bounds(m);
      const span = max[ax] - min[ax] || 1;
      const [i, j] = [(ax + 1) % 3, (ax + 2) % 3];
      return mapVerts(m, (v) => {
        const t = (v[ax] - min[ax]) / span - 0.5;
        const a = (t * p.angle * Math.PI) / 180;
        const out = [...v];
        out[i] = v[i] * Math.cos(a) - v[j] * Math.sin(a);
        out[j] = v[i] * Math.sin(a) + v[j] * Math.cos(a);
        return out;
      });
    },
  },
  taper: {
    label: 'Taper',
    icon: 'triangle',
    defaults: { factor: 0.5, axis: 1 },
    params: [num('factor', 'Factor', -1, 5), pick('axis', 'Axis', AXES)],
    apply(m, p) {
      const ax = Number(p.axis);
      const { min, max } = bounds(m);
      const span = max[ax] - min[ax] || 1;
      return mapVerts(m, (v) => {
        const t = (v[ax] - min[ax]) / span;
        const s = Math.max(0, 1 - p.factor * t);
        return v.map((x, k) => (k === ax ? x : x * s));
      });
    },
  },
  triangulate: {
    label: 'Triangulate',
    icon: 'triangle',
    defaults: {},
    params: [],
    apply: (m) => triangulate(m),
  },
  flatShade: {
    label: 'Shading',
    icon: 'sun',
    defaults: { smooth: false },
    params: [bool('smooth', 'Smooth')],
    apply: (m, p) => ({ v: m.v, f: m.f.map((f) => ({ ...f, s: p.smooth })) }),
  },
};

export const MODIFIER_ORDER = [
  'boolean',
  'bevel',
  'subdivision',
  'smooth',
  'mirror',
  'solidify',
  'array',
  'decimate',
  'outline',
  'displace',
  'twist',
  'taper',
  'weld',
  'triangulate',
  'flatShade',
];

let seq = 0;
export function newModifier(type, params = {}) {
  const def = MODIFIERS[type];
  return {
    id: `mod${Date.now().toString(36)}${(seq++).toString(36)}`,
    type,
    on: true,
    params: { ...def.defaults, ...params },
  };
}

export function applyStack(mesh, stack, ctx = {}) {
  let m = mesh;
  for (const mod of stack ?? []) {
    if (!mod.on) continue;
    const def = MODIFIERS[mod.type];
    if (!def) continue;
    try {
      m = def.apply(m, { ...def.defaults, ...mod.params }, ctx) ?? m;
    } catch (error) {
      // A modifier that can't cope with this mesh is skipped, not fatal.
      ctx.onError?.(mod, error);
    }
  }
  return m;
}
