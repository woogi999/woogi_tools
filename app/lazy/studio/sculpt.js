// Brushes that move vertices (sculpting) or paint per-vertex values (skin
// weights). Both work on an object's own mesh in its own space, reaching
// every vertex within the brush radius and weighting by distance.
//
// Sculpting changes vertex positions in place on a working copy made when
// the stroke starts; the page commits that copy as the object's new mesh
// when the stroke ends (one undo step per stroke).

import { vertexNormals, neighbours, sub, add, scale, dot, norm } from './mesh';
import { brushWeight } from './paint';

export const SCULPT_BRUSHES = {
  draw: { label: 'Draw', icon: 'pencil' },
  clay: { label: 'Clay', icon: 'brush' },
  inflate: { label: 'Inflate', icon: 'circle' },
  smooth: { label: 'Smooth', icon: 'waves' },
  flatten: { label: 'Flatten', icon: 'minus' },
  grab: { label: 'Grab', icon: 'hand' },
  pinch: { label: 'Pinch', icon: 'shrink' },
  crease: { label: 'Crease', icon: 'slice' },
};

// Points to act on: the hit, plus its mirror images for each symmetry axis.
function mirrored(p, sym) {
  let pts = [[p, [1, 1, 1]]];
  for (let ax = 0; ax < 3; ax++) {
    if (!sym[ax]) continue;
    pts = pts.concat(
      pts.map(([q, s]) => {
        const m = [...q];
        m[ax] = -m[ax];
        const ms = [...s];
        ms[ax] = -ms[ax];
        return [m, ms];
      }),
    );
  }
  return pts;
}

export class SculptStroke {
  constructor(mesh, brush) {
    this.mesh = { v: mesh.v.map((p) => [...p]), f: mesh.f };
    this.brush = brush;
    this.nb = neighbours(this.mesh);
    this.normals = vertexNormals(this.mesh);
    this.grabbed = null;
    this.dabs = 0;
  }

  near(p, r) {
    const out = [];
    const r2 = r * r;
    const v = this.mesh.v;
    for (let i = 0; i < v.length; i++) {
      const dx = v[i][0] - p[0],
        dy = v[i][1] - p[1],
        dz = v[i][2] - p[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < r2) out.push([i, Math.sqrt(d2)]);
    }
    return out;
  }

  // One dab at P (object space) of radius r. `delta` is how far the cursor
  // moved in object space since the last dab (grab uses it). `invert` digs
  // instead of building up (Ctrl while sculpting).
  dab(P, r, { delta = [0, 0, 0], invert = false } = {}) {
    const b = this.brush;
    const v = this.mesh.v;
    const strength = b.strength * (invert ? -1 : 1);
    const moved = new Set();
    if (b.tool === 'grab') {
      if (!this.grabbed) {
        this.grabbed = mirrored(P, b.symmetry).map(([q, s]) => ({
          s,
          list: this.near(q, r).map(([i, d]) => [
            i,
            brushWeight(d, r, b.hardness, b.falloff),
          ]),
        }));
      }
      for (const { s, list } of this.grabbed)
        for (const [i, w] of list) {
          v[i] = add(
            v[i],
            scale([delta[0] * s[0], delta[1] * s[1], delta[2] * s[2]], w),
          );
          moved.add(i);
        }
      return moved;
    }
    for (const [q] of mirrored(P, b.symmetry)) {
      const hits = this.near(q, r);
      if (!hits.length) continue;
      // The area's average normal and centre: draw, clay and flatten work
      // relative to the patch of surface under the brush.
      let an = [0, 0, 0];
      let ac = [0, 0, 0];
      let wsum = 0;
      for (const [i, d] of hits) {
        const w = brushWeight(d, r, b.hardness, b.falloff);
        an = add(an, scale(this.normals[i], w));
        ac = add(ac, scale(v[i], w));
        wsum += w;
      }
      an = norm(an);
      ac = wsum > 0 ? scale(ac, 1 / wsum) : q;
      const step = r * 0.08 * strength;
      const updates = [];
      for (const [i, d] of hits) {
        const w = brushWeight(d, r, b.hardness, b.falloff);
        if (w <= 0) continue;
        const p = v[i];
        let np = p;
        switch (b.tool) {
          case 'draw':
            np = add(p, scale(an, step * w));
            break;
          case 'inflate':
            np = add(p, scale(this.normals[i], step * w));
            break;
          case 'clay': {
            // Builds towards a plane just above the surface, so it fills
            // dips before it raises peaks.
            const plane = add(ac, scale(an, step * 2));
            const h = dot(sub(plane, p), an);
            if (h * Math.sign(step) > 0)
              np = add(p, scale(an, h * Math.min(1, Math.abs(strength)) * w));
            break;
          }
          case 'flatten': {
            const h = dot(sub(ac, p), an);
            np = add(
              p,
              scale(an, h * Math.min(1, Math.abs(strength)) * w * 0.5),
            );
            break;
          }
          case 'smooth': {
            const nb = this.nb[i];
            if (!nb.length) break;
            const avg = scale(
              nb.reduce((s, j) => add(s, v[j]), [0, 0, 0]),
              1 / nb.length,
            );
            np = add(
              p,
              scale(sub(avg, p), Math.min(1, Math.abs(strength)) * w),
            );
            break;
          }
          case 'pinch':
            np = add(p, scale(sub(q, p), 0.15 * strength * w));
            break;
          case 'crease': {
            const pinched = add(
              p,
              scale(sub(q, p), 0.12 * Math.abs(strength) * w),
            );
            np = add(pinched, scale(an, -step * w * 0.6));
            break;
          }
        }
        updates.push([i, np]);
      }
      for (const [i, np] of updates) {
        v[i] = np;
        moved.add(i);
      }
    }
    // Normals drift as the surface moves; refresh them now and then.
    if (++this.dabs % 6 === 0) this.normals = vertexNormals(this.mesh);
    return moved;
  }
}

// ─── Weight painting ───────────────────────────────────────────────────

export const WEIGHT_TOOLS = {
  add: { label: 'Add', icon: 'plus' },
  subtract: { label: 'Remove', icon: 'minus' },
  smooth: { label: 'Smooth', icon: 'waves' },
  blur: { label: 'Blur', icon: 'droplet' },
};

// Paints one group's weights around P. Returns the new array (the input
// isn't touched) so each stroke can be undone.
export function weightDab(
  mesh,
  weights,
  nb,
  P,
  r,
  brush,
  symmetry = [false, false, false],
) {
  const out = new Float32Array(weights);
  for (const [q] of mirrored(P, symmetry)) {
    const r2 = r * r;
    for (let i = 0; i < mesh.v.length; i++) {
      const p = mesh.v[i];
      const d2 = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
      if (d2 >= r2) continue;
      const w =
        brushWeight(Math.sqrt(d2), r, brush.hardness, brush.falloff) *
        brush.strength;
      const cur = out[i];
      if (brush.tool === 'add') out[i] = cur + (brush.value - cur) * w;
      else if (brush.tool === 'subtract') out[i] = cur * (1 - w);
      else {
        const list = nb[i];
        if (!list?.length) continue;
        let s = 0;
        for (const j of list) s += weights[j];
        const avg = s / list.length;
        out[i] = cur + (avg - cur) * w * (brush.tool === 'blur' ? 1 : 0.5);
      }
      out[i] = Math.max(0, Math.min(1, out[i]));
    }
  }
  return out;
}
