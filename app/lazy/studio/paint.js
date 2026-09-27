// Texture painting. A brush dab is a sphere in the painted object's own
// space: every texel whose surface point is inside it is painted, weighted
// by distance. Because texels are found through the texel map (bake.js)
// rather than in UV space, one stroke paints straight across UV seams and
// never bleeds onto a part of the texture that's elsewhere on the model.
//
// A stroke works against a snapshot taken when it starts, and keeps the
// strongest coverage each texel has been given so far, so going over the
// same spot twice within a stroke doesn't pile up past the brush's opacity
// (how Substance and Photoshop brushes behave).

import { texelsNear } from './bake';

export const FALLOFFS = {
  smooth: (x) => 1 - x * x * (3 - 2 * x),
  linear: (x) => 1 - x,
  sharp: (x) => (1 - x) ** 3,
  soft: (x) => Math.cos((x * Math.PI) / 2) ** 2,
  constant: () => 1,
};

export function brushWeight(d, r, hardness = 0.5, falloff = 'smooth') {
  const t = d / r;
  if (t >= 1) return 0;
  if (t <= hardness) return 1;
  return (FALLOFFS[falloff] ?? FALLOFFS.smooth)(
    (t - hardness) / (1 - hardness || 1e-6),
  );
}

// A rectangle of texels that grows to cover whatever it's told about.
export class DirtyRect {
  x0 = Infinity;
  y0 = Infinity;
  x1 = -Infinity;
  y1 = -Infinity;
  add(i, size) {
    const x = i % size;
    const y = (i - x) / size;
    if (x < this.x0) this.x0 = x;
    if (y < this.y0) this.y0 = y;
    if (x > this.x1) this.x1 = x;
    if (y > this.y1) this.y1 = y;
  }
  merge(r) {
    this.x0 = Math.min(this.x0, r.x0);
    this.y0 = Math.min(this.y0, r.y0);
    this.x1 = Math.max(this.x1, r.x1);
    this.y1 = Math.max(this.y1, r.y1);
  }
  get empty() {
    return this.x1 < this.x0;
  }
  get rect() {
    return [this.x0, this.y0, this.x1, this.y1];
  }
}

// Copies a rectangle out of (or back into) an RGBA or single-channel buffer.
export function cropBuffer(buf, size, [x0, y0, x1, y1], channels) {
  const w = x1 - x0 + 1;
  const out = new Uint8ClampedArray(w * (y1 - y0 + 1) * channels);
  for (let y = y0; y <= y1; y++)
    out.set(
      buf.subarray((y * size + x0) * channels, (y * size + x1 + 1) * channels),
      (y - y0) * w * channels,
    );
  return out;
}

export function pasteBuffer(buf, size, [x0, y0, x1, y1], data, channels) {
  const w = x1 - x0 + 1;
  for (let y = y0; y <= y1; y++)
    buf.set(
      data.subarray((y - y0) * w * channels, (y - y0 + 1) * w * channels),
      (y * size + x0) * channels,
    );
}

// Samples an ImageData at (u, v) in 0..1 (v down), bilinear. Null outside.
export function sampleImage(img, u, v) {
  if (!img || u < 0 || v < 0 || u > 1 || v > 1) return null;
  const x = u * (img.width - 1);
  const y = v * (img.height - 1);
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  const x1 = Math.min(img.width - 1, x0 + 1),
    y1 = Math.min(img.height - 1, y0 + 1);
  const fx = x - x0,
    fy = y - y0;
  const d = img.data;
  const out = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const a =
      d[(y0 * img.width + x0) * 4 + k] * (1 - fx) +
      d[(y0 * img.width + x1) * 4 + k] * fx;
    const b =
      d[(y1 * img.width + x0) * 4 + k] * (1 - fx) +
      d[(y1 * img.width + x1) * 4 + k] * fx;
    out[k] = (a * (1 - fy) + b * fy) / 255;
  }
  return out;
}

// ─── Strokes ───────────────────────────────────────────────────────────

// target: { kind: 'paint', color, pbr } | { kind: 'mask', mask }
export class Stroke {
  constructor(map, target, brush) {
    this.map = map;
    this.target = target;
    this.brush = brush;
    const N = map.size * map.size;
    this.reach = new Float32Array(N);
    this.dirty = new DirtyRect();
    if (target.kind === 'paint') {
      this.before = {
        color: new Uint8ClampedArray(target.color),
        pbr: new Uint8ClampedArray(target.pbr),
      };
    } else this.before = { mask: new Uint8ClampedArray(target.mask) };
    this.last = null;
  }

  // Lays one dab at P (object space) with radius r. `ctx` carries the
  // camera-facing direction and, for projection and stencils, a way to find
  // each texel on screen.
  dab(P, r, ctx = {}) {
    const b = this.brush;
    const { map } = this;
    const size = map.size;
    const dab = new DirtyRect();
    const tool = b.tool;
    // Smudge drags colour along the stroke: how far this dab moved, in texels.
    let shift = null;
    if (tool === 'smudge' && this.last && ctx.texel != null) {
      const lx = this.last % size,
        ly = (this.last - lx) / size;
      const cx = ctx.texel % size,
        cy = (ctx.texel - cx) / size;
      shift = [cx - lx, cy - ly];
      if (Math.abs(shift[0]) > r * size || Math.abs(shift[1]) > r * size)
        shift = null;
    }
    const touched = [];
    texelsNear(
      map,
      P,
      r,
      (i, d) => {
        const w = brushWeight(d, r, b.hardness, b.falloff) * b.flow;
        if (w <= 0) return;
        touched.push([i, w]);
        dab.add(i, size);
      },
      b.backfaces ? null : ctx.facing,
    );
    if (!touched.length) return dab;
    if (tool === 'blur' || tool === 'smudge') this.filter(touched, tool, shift);
    else
      for (const [i, w] of touched) {
        let a = w;
        let color = b.color;
        if (tool === 'projection' || tool === 'stencil') {
          const s = ctx.project?.(i);
          const px = s ? sampleImage(ctx.image, s[0], s[1]) : null;
          if (!px) continue;
          if (tool === 'projection') {
            color = [px[0], px[1], px[2]];
            a *= px[3];
          } else a *= px[3] * ((px[0] + px[1] + px[2]) / 3);
        }
        const reach = Math.max(this.reach[i], a);
        if (reach <= this.reach[i] && tool !== 'projection') continue;
        this.reach[i] = reach;
        this.apply(i, reach * b.opacity, color, tool === 'eraser');
      }
    if (ctx.texel != null) this.last = ctx.texel;
    this.dirty.merge(dab);
    return dab;
  }

  // Writes the stroke's coverage at texel i over the snapshot.
  apply(i, A, color, erase) {
    const { target, before, brush } = this;
    if (target.kind === 'mask') {
      const v0 = before.mask[i] / 255;
      const goal = erase ? 0 : (brush.maskValue ?? 1);
      target.mask[i] = (v0 + (goal - v0) * A) * 255;
      return;
    }
    const c0 = before.color;
    const o = i * 4;
    const ch = brush.channels;
    if (erase) {
      target.color[o + 3] = c0[o + 3] * (1 - A);
      target.pbr[o + 3] = before.pbr[o + 3] * (1 - A);
      return;
    }
    if (ch.color) {
      const a0 = c0[o + 3] / 255;
      const a1 = a0 + A * (1 - a0);
      if (a1 > 0)
        for (let k = 0; k < 3; k++)
          target.color[o + k] =
            (((c0[o + k] / 255) * a0 * (1 - A) + color[k] * A) / a1) * 255;
      target.color[o + 3] = a1 * 255;
    }
    if (ch.rough || ch.metal || ch.height) {
      const p0 = before.pbr;
      const a0 = p0[o + 3] / 255;
      const a1 = a0 + A * (1 - a0);
      const vals = [brush.rough, brush.metal, brush.height ?? 0.5];
      const on = [ch.rough, ch.metal, ch.height];
      for (let k = 0; k < 3; k++) {
        const old = p0[o + k] / 255;
        // A channel the brush isn't painting keeps what was there.
        const v = on[k] ? vals[k] : a0 > 0 ? old : vals[k];
        target.pbr[o + k] =
          a1 > 0 ? ((old * a0 * (1 - A) + v * A) / a1) * 255 : 0;
      }
      target.pbr[o + 3] = a1 * 255;
    }
  }

  // Blur averages each texel with its neighbours in texture space; smudge
  // pulls colour from where the brush just was.
  filter(touched, tool, shift) {
    const { target, map } = this;
    const size = map.size;
    const bufs =
      target.kind === 'mask'
        ? [[target.mask, 1]]
        : [
            [target.color, 4],
            [target.pbr, 4],
          ];
    for (const [buf, ch] of bufs) {
      const src = new Uint8ClampedArray(buf);
      for (const [i, w] of touched) {
        const x = i % size,
          y = (i - x) / size;
        const acc = new Float32Array(ch);
        let n = 0;
        if (tool === 'blur') {
          for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++) {
              const nx = x + dx,
                ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
              const j = ny * size + nx;
              if (map.tri[j] < 0) continue;
              for (let k = 0; k < ch; k++) acc[k] += src[j * ch + k];
              n++;
            }
        } else if (shift) {
          const nx = Math.round(x - shift[0]),
            ny = Math.round(y - shift[1]);
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const j = ny * size + nx;
          if (map.tri[j] < 0) continue;
          for (let k = 0; k < ch; k++) acc[k] = src[j * ch + k];
          n = 1;
        }
        if (!n) continue;
        const f = Math.min(
          1,
          w * (tool === 'smudge' ? 0.9 : 1) * this.brush.opacity,
        );
        for (let k = 0; k < ch; k++)
          buf[i * ch + k] =
            src[i * ch + k] + (acc[k] / n - src[i * ch + k]) * f;
      }
    }
  }

  // Before/after copies of just the rectangle the stroke touched, for undo.
  finish() {
    if (this.dirty.empty) return null;
    const rect = this.dirty.rect;
    const { size } = this.map;
    const t = this.target;
    if (t.kind === 'mask')
      return {
        rect,
        before: { mask: cropBuffer(this.before.mask, size, rect, 1) },
        after: { mask: cropBuffer(t.mask, size, rect, 1) },
      };
    return {
      rect,
      before: {
        color: cropBuffer(this.before.color, size, rect, 4),
        pbr: cropBuffer(this.before.pbr, size, rect, 4),
      },
      after: {
        color: cropBuffer(t.color, size, rect, 4),
        pbr: cropBuffer(t.pbr, size, rect, 4),
      },
    };
  }
}

export function restoreRect(target, size, rect, data) {
  if (data.mask) pasteBuffer(target.mask, size, rect, data.mask, 1);
  if (data.color) pasteBuffer(target.color, size, rect, data.color, 4);
  if (data.pbr) pasteBuffer(target.pbr, size, rect, data.pbr, 4);
}

// ─── Whole-layer operations ────────────────────────────────────────────

// Bucket fill: the UV island under the cursor, or everything.
export function fillTexels(map, target, brush, { island = null } = {}) {
  const stroke = new Stroke(map, target, brush);
  const N = map.size * map.size;
  for (let i = 0; i < N; i++) {
    if (map.tri[i] < 0) continue;
    if (island !== null && map.island[i] !== island) continue;
    stroke.reach[i] = 1;
    stroke.apply(i, brush.opacity, brush.color, false);
    stroke.dirty.add(i, map.size);
  }
  return stroke;
}

// A gradient laid across the screen from a to b (0..1 screen coordinates);
// `project(i)` places each texel on screen.
export function gradientTexels(
  map,
  target,
  brush,
  a,
  b,
  colorB,
  project,
  facing = null,
) {
  const stroke = new Stroke(map, target, brush);
  const N = map.size * map.size;
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1e-9;
  for (let i = 0; i < N; i++) {
    if (map.tri[i] < 0) continue;
    if (
      facing &&
      map.nrm[i * 3] * facing[0] +
        map.nrm[i * 3 + 1] * facing[1] +
        map.nrm[i * 3 + 2] * facing[2] <
        0
    )
      continue;
    const s = project(i);
    if (!s) continue;
    const t = Math.max(
      0,
      Math.min(1, ((s[0] - a[0]) * dx + (s[1] - a[1]) * dy) / l2),
    );
    const c = [0, 1, 2].map(
      (k) => brush.color[k] + (colorB[k] - brush.color[k]) * t,
    );
    stroke.apply(i, brush.opacity, c, false);
    stroke.dirty.add(i, map.size);
  }
  return stroke;
}

// A decal: an image stuck flat onto the surface at P, facing along n, `size`
// across, turned so its top follows `up`.
export function decalTexels(
  map,
  target,
  brush,
  image,
  P,
  n,
  up,
  size,
  rotation = 0,
) {
  const stroke = new Stroke(map, target, brush);
  let t = [
    up[1] * n[2] - up[2] * n[1],
    up[2] * n[0] - up[0] * n[2],
    up[0] * n[1] - up[1] * n[0],
  ];
  const lt = Math.hypot(...t) || 1;
  t = t.map((x) => x / lt);
  let bt = [
    n[1] * t[2] - n[2] * t[1],
    n[2] * t[0] - n[0] * t[2],
    n[0] * t[1] - n[1] * t[0],
  ];
  const c = Math.cos(rotation),
    s = Math.sin(rotation);
  const T = t.map((x, k) => x * c + bt[k] * s);
  bt = bt.map((x, k) => -t[k] * s + x * c);
  const aspect = image ? image.width / image.height : 1;
  const w = size * Math.max(1, aspect);
  const h = size / Math.min(1, aspect);
  texelsNear(map, P, Math.hypot(w, h) / 2, (i) => {
    if (
      map.nrm[i * 3] * n[0] +
        map.nrm[i * 3 + 1] * n[1] +
        map.nrm[i * 3 + 2] * n[2] <
      0.2
    )
      return;
    const d = [
      map.pos[i * 3] - P[0],
      map.pos[i * 3 + 1] - P[1],
      map.pos[i * 3 + 2] - P[2],
    ];
    const u = (d[0] * T[0] + d[1] * T[1] + d[2] * T[2]) / w + 0.5;
    const v = 0.5 - (d[0] * bt[0] + d[1] * bt[1] + d[2] * bt[2]) / h;
    const px = sampleImage(image, u, v);
    if (!px || px[3] <= 0) return;
    stroke.apply(i, px[3] * brush.opacity, [px[0], px[1], px[2]], false);
    stroke.dirty.add(i, map.size);
  });
  return stroke;
}

// Nearest covered texel to a UV coordinate (for the colour picker).
export function texelAt(map, uv) {
  const x = Math.max(0, Math.min(map.size - 1, Math.floor(uv[0] * map.size)));
  const y = Math.max(
    0,
    Math.min(map.size - 1, Math.floor((1 - uv[1]) * map.size)),
  );
  return y * map.size + x;
}
