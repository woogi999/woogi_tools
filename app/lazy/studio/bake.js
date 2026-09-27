// Surfaces in texture space, and the bakers that read them.
//
// `surface()` flattens a mesh into triangles; `texelMap()` rasterises those
// triangles into UV space so every texel knows which triangle it's on, where
// that is in 3D and which way it faces. That one map is what makes painting
// work in 3D (a brush reaches the texels near it in space, so strokes cross
// UV seams), what procedural generators sample (in 3D, so no seams either)
// and what every baker starts from.

import {
  triangulateFace,
  faceNormal,
  weldedNormals,
  edgeMap,
  sub,
  dot,
  len,
} from './mesh';
import { uvIslands } from './uv';

// ─── Surfaces ──────────────────────────────────────────────────────────

// Triangles with per-corner position, smooth normal and UV. `slot` keeps
// only faces of one material slot.
export function surface(mesh, { slot = null } = {}) {
  const smooth = weldedNormals(mesh);
  const tris = [];
  const faceOf = [];
  mesh.f.forEach((f, fi) => {
    if (slot !== null && (f.m ?? 0) !== slot) return;
    const flat = faceNormal(mesh, f);
    for (const [a, b, c] of triangulateFace(mesh, f)) {
      tris.push(
        [a, b, c].map((k) => ({
          p: mesh.v[f.v[k]],
          n: f.s ? smooth[f.v[k]] : flat,
          s: smooth[f.v[k]],
          uv: f.uv[k],
          vi: f.v[k],
        })),
      );
      faceOf.push(fi);
    }
  });
  const n = tris.length;
  const pos = new Float32Array(n * 9);
  const nrm = new Float32Array(n * 9);
  const snrm = new Float32Array(n * 9);
  const uv = new Float32Array(n * 6);
  const vid = new Int32Array(n * 3);
  tris.forEach((t, i) =>
    t.forEach((c, k) => {
      pos.set(c.p, i * 9 + k * 3);
      nrm.set(c.n, i * 9 + k * 3);
      snrm.set(c.s, i * 9 + k * 3);
      uv.set(c.uv, i * 6 + k * 2);
      vid[i * 3 + k] = c.vi;
    }),
  );
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], pos[i + k]);
      max[k] = Math.max(max[k], pos[i + k]);
    }
  return {
    count: n,
    pos,
    nrm,
    snrm,
    uv,
    vid,
    faceOf: Int32Array.from(faceOf),
    min,
    max,
    mesh,
  };
}

// ─── Texel maps ────────────────────────────────────────────────────────

// Rasterises the surface's triangles into a size×size map. Row 0 is the top
// of the image, i.e. v = 1 (textures are uploaded flipped). Empty texels
// near an island are filled from their neighbours (`dilate` pixels) so
// filtering never pulls in the background along a seam.
export function texelMap(surf, size, { dilate = 3 } = {}) {
  const N = size * size;
  const tri = new Int32Array(N).fill(-1);
  const bary = new Float32Array(N * 3);
  for (let t = 0; t < surf.count; t++) {
    const u0 = surf.uv[t * 6] * size,
      v0 = (1 - surf.uv[t * 6 + 1]) * size;
    const u1 = surf.uv[t * 6 + 2] * size,
      v1 = (1 - surf.uv[t * 6 + 3]) * size;
    const u2 = surf.uv[t * 6 + 4] * size,
      v2 = (1 - surf.uv[t * 6 + 5]) * size;
    const area = (u1 - u0) * (v2 - v0) - (v1 - v0) * (u2 - u0);
    if (Math.abs(area) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(u0, u1, u2)));
    const x1 = Math.min(size - 1, Math.ceil(Math.max(u0, u1, u2)));
    const y0 = Math.max(0, Math.floor(Math.min(v0, v1, v2)));
    const y1 = Math.min(size - 1, Math.ceil(Math.max(v0, v1, v2)));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5,
          py = y + 0.5;
        const w0 = ((u1 - px) * (v2 - py) - (v1 - py) * (u2 - px)) / area;
        const w1 = ((u2 - px) * (v0 - py) - (v2 - py) * (u0 - px)) / area;
        const w2 = 1 - w0 - w1;
        const e = -1e-4;
        if (w0 < e || w1 < e || w2 < e) continue;
        const i = y * size + x;
        tri[i] = t;
        bary[i * 3] = w0;
        bary[i * 3 + 1] = w1;
        bary[i * 3 + 2] = w2;
      }
  }
  const covered = new Uint8Array(N);
  for (let i = 0; i < N; i++) covered[i] = tri[i] >= 0 ? 1 : 0;
  // Grow islands outwards by copying a neighbour's triangle and weights.
  for (let pass = 0; pass < dilate; pass++) {
    const add = [];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (tri[i] >= 0) continue;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [-1, -1],
          [1, -1],
          [-1, 1],
        ]) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const j = ny * size + nx;
          if (tri[j] >= 0) {
            add.push([i, j]);
            break;
          }
        }
      }
    for (const [i, j] of add) {
      tri[i] = tri[j];
      bary[i * 3] = bary[j * 3];
      bary[i * 3 + 1] = bary[j * 3 + 1];
      bary[i * 3 + 2] = bary[j * 3 + 2];
    }
  }
  const pos = new Float32Array(N * 3);
  const nrm = new Float32Array(N * 3);
  const snrm = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const t = tri[i];
    if (t < 0) continue;
    const w = [bary[i * 3], bary[i * 3 + 1], bary[i * 3 + 2]];
    for (let k = 0; k < 3; k++) {
      pos[i * 3 + k] =
        surf.pos[t * 9 + k] * w[0] +
        surf.pos[t * 9 + 3 + k] * w[1] +
        surf.pos[t * 9 + 6 + k] * w[2];
      nrm[i * 3 + k] =
        surf.nrm[t * 9 + k] * w[0] +
        surf.nrm[t * 9 + 3 + k] * w[1] +
        surf.nrm[t * 9 + 6 + k] * w[2];
      snrm[i * 3 + k] =
        surf.snrm[t * 9 + k] * w[0] +
        surf.snrm[t * 9 + 3 + k] * w[1] +
        surf.snrm[t * 9 + 6 + k] * w[2];
    }
    normalizeAt(nrm, i);
    normalizeAt(snrm, i);
  }
  // Island ids per texel, for the fill tool.
  const faceIsland = new Int32Array(surf.mesh.f.length).fill(-1);
  const faces = new Set(surf.faceOf);
  uvIslands(surf.mesh, faces).forEach((isl, k) => {
    for (const fi of isl) faceIsland[fi] = k;
  });
  const island = new Int32Array(N).fill(-1);
  for (let i = 0; i < N; i++)
    if (tri[i] >= 0) island[i] = faceIsland[surf.faceOf[tri[i]]];
  // A spatial grid of triangles, for finding what a brush can reach.
  const grid = triangleGrid(surf);
  return { size, tri, bary, pos, nrm, snrm, covered, island, surf, grid };
}

function normalizeAt(a, i) {
  const l = Math.hypot(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]) || 1;
  a[i * 3] /= l;
  a[i * 3 + 1] /= l;
  a[i * 3 + 2] /= l;
}

// Triangles bucketed into a coarse grid over the surface's bounds.
function triangleGrid(surf) {
  const span = Math.max(
    surf.max[0] - surf.min[0],
    surf.max[1] - surf.min[1],
    surf.max[2] - surf.min[2],
    1e-6,
  );
  const cell = span / 24;
  const cells = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  for (let t = 0; t < surf.count; t++) {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 3; c++)
      for (let k = 0; k < 3; k++) {
        const v = surf.pos[t * 9 + c * 3 + k];
        lo[k] = Math.min(lo[k], v);
        hi[k] = Math.max(hi[k], v);
      }
    for (let x = Math.floor(lo[0] / cell); x <= Math.floor(hi[0] / cell); x++)
      for (let y = Math.floor(lo[1] / cell); y <= Math.floor(hi[1] / cell); y++)
        for (
          let z = Math.floor(lo[2] / cell);
          z <= Math.floor(hi[2] / cell);
          z++
        ) {
          const k = key(x, y, z);
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(t);
        }
  }
  return {
    near(p, r) {
      const out = new Set();
      for (
        let x = Math.floor((p[0] - r) / cell);
        x <= Math.floor((p[0] + r) / cell);
        x++
      )
        for (
          let y = Math.floor((p[1] - r) / cell);
          y <= Math.floor((p[1] + r) / cell);
          y++
        )
          for (
            let z = Math.floor((p[2] - r) / cell);
            z <= Math.floor((p[2] + r) / cell);
            z++
          ) {
            const list = cells.get(key(x, y, z));
            if (list) for (const t of list) out.add(t);
          }
      return out;
    },
  };
}

// The texels within `r` of point `p`, facing `facing` (if given):
// calls fn(texelIndex, distance). Uses the triangle grid and each triangle's
// UV box, so a small brush on a big texture only touches a few texels.
export function texelsNear(map, p, r, fn, facing = null) {
  const { size, surf } = map;
  const r2 = r * r;
  const pad = 4;
  for (const t of map.grid.near(p, r)) {
    // Skip triangles wholly outside the sphere.
    let close = false;
    for (let c = 0; c < 3 && !close; c++) {
      const dx = surf.pos[t * 9 + c * 3] - p[0];
      const dy = surf.pos[t * 9 + c * 3 + 1] - p[1];
      const dz = surf.pos[t * 9 + c * 3 + 2] - p[2];
      if (dx * dx + dy * dy + dz * dz <= r2) close = true;
    }
    if (!close && !triangleNearSphere(surf, t, p, r)) continue;
    const us = [surf.uv[t * 6], surf.uv[t * 6 + 2], surf.uv[t * 6 + 4]].map(
      (u) => u * size,
    );
    const vs = [surf.uv[t * 6 + 1], surf.uv[t * 6 + 3], surf.uv[t * 6 + 5]].map(
      (v) => (1 - v) * size,
    );
    const x0 = Math.max(0, Math.floor(Math.min(...us)) - pad);
    const x1 = Math.min(size - 1, Math.ceil(Math.max(...us)) + pad);
    const y0 = Math.max(0, Math.floor(Math.min(...vs)) - pad);
    const y1 = Math.min(size - 1, Math.ceil(Math.max(...vs)) + pad);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * size + x;
        if (map.tri[i] !== t) continue;
        const dx = map.pos[i * 3] - p[0];
        const dy = map.pos[i * 3 + 1] - p[1];
        const dz = map.pos[i * 3 + 2] - p[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;
        if (
          facing &&
          map.nrm[i * 3] * facing[0] +
            map.nrm[i * 3 + 1] * facing[1] +
            map.nrm[i * 3 + 2] * facing[2] <
            -0.05
        )
          continue;
        fn(i, Math.sqrt(d2));
      }
  }
}

function triangleNearSphere(surf, t, p, r) {
  const a = [surf.pos[t * 9], surf.pos[t * 9 + 1], surf.pos[t * 9 + 2]];
  const b = [surf.pos[t * 9 + 3], surf.pos[t * 9 + 4], surf.pos[t * 9 + 5]];
  const c = [surf.pos[t * 9 + 6], surf.pos[t * 9 + 7], surf.pos[t * 9 + 8]];
  const q = closestOnTriangle(p, a, b, c);
  return len(sub(q, p)) <= r;
}

// Ericson's closest point on a triangle.
function closestOnTriangle(p, a, b, c) {
  const ab = sub(b, a),
    ac = sub(c, a),
    ap = sub(p, a);
  const d1 = dot(ab, ap),
    d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp),
    d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v];
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp),
    d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return [
      b[0] + (c[0] - b[0]) * w,
      b[1] + (c[1] - b[1]) * w,
      b[2] + (c[2] - b[2]) * w,
    ];
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom,
    w = vc * denom;
  return [
    a[0] + ab[0] * v + ac[0] * w,
    a[1] + ab[1] * v + ac[1] * w,
    a[2] + ab[2] * v + ac[2] * w,
  ];
}

// ─── Ray casting ───────────────────────────────────────────────────────

// A bounding volume hierarchy over a surface's triangles.
export function buildBVH(surf) {
  const n = surf.count;
  const order = Int32Array.from({ length: n }, (_, i) => i);
  const cent = new Float32Array(n * 3);
  for (let t = 0; t < n; t++)
    for (let k = 0; k < 3; k++)
      cent[t * 3 + k] =
        (surf.pos[t * 9 + k] +
          surf.pos[t * 9 + 3 + k] +
          surf.pos[t * 9 + 6 + k]) /
        3;
  const nodes = [];
  const build = (start, end) => {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i++) {
      const t = order[i];
      for (let c = 0; c < 3; c++)
        for (let k = 0; k < 3; k++) {
          const v = surf.pos[t * 9 + c * 3 + k];
          if (v < lo[k]) lo[k] = v;
          if (v > hi[k]) hi[k] = v;
        }
    }
    const node = { lo, hi, start, end, left: -1, right: -1 };
    const id = nodes.length;
    nodes.push(node);
    if (end - start > 4) {
      const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
      const ax =
        ext[0] > ext[1] ? (ext[0] > ext[2] ? 0 : 2) : ext[1] > ext[2] ? 1 : 2;
      const sub_ = Array.from(order.subarray(start, end)).sort(
        (a, b) => cent[a * 3 + ax] - cent[b * 3 + ax],
      );
      order.set(sub_, start);
      const mid = (start + end) >> 1;
      node.left = build(start, mid);
      node.right = build(mid, end);
    }
    return id;
  };
  if (n) build(0, n);
  return { nodes, order, surf };
}

// Nearest hit along a ray within `tmax`: { t, tri, u, v } or null.
export function raycast(
  bvh,
  o,
  d,
  tmax = Infinity,
  { any = false, skip = -1 } = {},
) {
  if (!bvh.nodes.length) return null;
  const { nodes, order, surf } = bvh;
  const inv = [1 / d[0], 1 / d[1], 1 / d[2]];
  let best = null;
  let bestT = tmax;
  const stack = [0];
  while (stack.length) {
    const node = nodes[stack.pop()];
    let t0 = 0,
      t1 = bestT;
    let miss = false;
    for (let k = 0; k < 3 && !miss; k++) {
      let a = (node.lo[k] - o[k]) * inv[k];
      let b = (node.hi[k] - o[k]) * inv[k];
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) miss = true;
    }
    if (miss) continue;
    if (node.left < 0) {
      for (let i = node.start; i < node.end; i++) {
        const t = order[i];
        if (t === skip) continue;
        const hit = rayTri(surf.pos, t, o, d);
        if (hit && hit.t > 1e-6 && hit.t < bestT) {
          bestT = hit.t;
          best = { ...hit, tri: t };
          if (any) return best;
        }
      }
    } else stack.push(node.left, node.right);
  }
  return best;
}

function rayTri(pos, t, o, d) {
  const ax = pos[t * 9],
    ay = pos[t * 9 + 1],
    az = pos[t * 9 + 2];
  const e1 = [pos[t * 9 + 3] - ax, pos[t * 9 + 4] - ay, pos[t * 9 + 5] - az];
  const e2 = [pos[t * 9 + 6] - ax, pos[t * 9 + 7] - ay, pos[t * 9 + 8] - az];
  const p = [
    d[1] * e2[2] - d[2] * e2[1],
    d[2] * e2[0] - d[0] * e2[2],
    d[0] * e2[1] - d[1] * e2[0],
  ];
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const s = [o[0] - ax, o[1] - ay, o[2] - az];
  const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv;
  if (u < 0 || u > 1) return null;
  const q = [
    s[1] * e1[2] - s[2] * e1[1],
    s[2] * e1[0] - s[0] * e1[2],
    s[0] * e1[1] - s[1] * e1[0],
  ];
  const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv;
  if (v < 0 || u + v > 1) return null;
  return { t: (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv, u, v };
}

// ─── Bakers ────────────────────────────────────────────────────────────

// Each baker fills a Float32Array (one value per texel, or three for
// vectors) and yields to the page every few thousand texels so a long bake
// never freezes it. `progress` gets 0..1.
const tick = () => new Promise((r) => setTimeout(r, 0));

async function perTexel(map, fn, progress, channels = 1) {
  const N = map.size * map.size;
  const out = new Float32Array(N * channels);
  const batch = 4096;
  for (let i0 = 0; i0 < N; i0 += batch) {
    const i1 = Math.min(N, i0 + batch);
    for (let i = i0; i < i1; i++) if (map.tri[i] >= 0) fn(i, out);
    progress?.(i1 / N);
    await tick();
  }
  return out;
}

// Directions spread over the hemisphere around +Z (cosine-weighted), rotated per texel.
function hemisphere(count) {
  const dirs = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt((i + 0.5) / count);
    const a = i * golden;
    dirs.push([
      Math.cos(a) * r,
      Math.sin(a) * r,
      Math.sqrt(Math.max(0, 1 - r * r)),
    ]);
  }
  return dirs;
}

function frame(n) {
  const up = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const t = [
    up[1] * n[2] - up[2] * n[1],
    up[2] * n[0] - up[0] * n[2],
    up[0] * n[1] - up[1] * n[0],
  ];
  const l = Math.hypot(...t) || 1;
  t[0] /= l;
  t[1] /= l;
  t[2] /= l;
  const b = [
    n[1] * t[2] - n[2] * t[1],
    n[2] * t[0] - n[0] * t[2],
    n[0] * t[1] - n[1] * t[0],
  ];
  return [t, b];
}

const at3 = (a, i) => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];

export async function bakeAO(
  map,
  bvh,
  { samples = 24, distance = null, progress } = {},
) {
  const span = Math.max(
    map.surf.max[0] - map.surf.min[0],
    map.surf.max[1] - map.surf.min[1],
    map.surf.max[2] - map.surf.min[2],
  );
  const reach = distance ?? span * 0.25;
  const dirs = hemisphere(samples);
  return perTexel(
    map,
    (i, out) => {
      const n = at3(map.snrm, i);
      const p = at3(map.pos, i);
      const o = [
        p[0] + n[0] * reach * 1e-3,
        p[1] + n[1] * reach * 1e-3,
        p[2] + n[2] * reach * 1e-3,
      ];
      const [t, b] = frame(n);
      // A per-texel twist so neighbouring texels don't share the same rays.
      const twist = ((i * 2654435761) >>> 0) / 4294967296;
      const c = Math.cos(twist * 6.283),
        s = Math.sin(twist * 6.283);
      let hits = 0;
      for (const [x0, y0, z] of dirs) {
        const x = x0 * c - y0 * s,
          y = x0 * s + y0 * c;
        const d = [
          t[0] * x + b[0] * y + n[0] * z,
          t[1] * x + b[1] * y + n[1] * z,
          t[2] * x + b[2] * y + n[2] * z,
        ];
        if (raycast(bvh, o, d, reach, { any: true })) hits++;
      }
      out[i] = 1 - hits / dirs.length;
    },
    progress,
  );
}

export async function bakeThickness(
  map,
  bvh,
  { samples = 16, distance = null, progress } = {},
) {
  const span = Math.max(
    map.surf.max[0] - map.surf.min[0],
    map.surf.max[1] - map.surf.min[1],
    map.surf.max[2] - map.surf.min[2],
  );
  const reach = distance ?? span * 0.5;
  const dirs = hemisphere(samples);
  return perTexel(
    map,
    (i, out) => {
      const n = at3(map.snrm, i).map((x) => -x);
      const p = at3(map.pos, i);
      const o = [
        p[0] + n[0] * reach * 1e-3,
        p[1] + n[1] * reach * 1e-3,
        p[2] + n[2] * reach * 1e-3,
      ];
      const [t, b] = frame(n);
      let sum = 0;
      for (const [x, y, z] of dirs) {
        const d = [
          t[0] * x + b[0] * y + n[0] * z,
          t[1] * x + b[1] * y + n[1] * z,
          t[2] * x + b[2] * y + n[2] * z,
        ];
        const hit = raycast(bvh, o, d, reach);
        sum += hit ? hit.t / reach : 1;
      }
      out[i] = sum / dirs.length;
    },
    progress,
  );
}

// Curvature from how normals turn along the mesh's edges: convex edges > 0.5,
// cavities < 0.5. Worked out per vertex and blended across each triangle.
export function vertexCurvature(mesh) {
  const n = weldedNormals(mesh);
  const sum = new Float32Array(mesh.v.length);
  const cnt = new Float32Array(mesh.v.length);
  for (const e of edgeMap(mesh).values()) {
    const d = sub(mesh.v[e.b], mesh.v[e.a]);
    const l2 = dot(d, d);
    if (l2 < 1e-12) continue;
    const k = dot(sub(n[e.b], n[e.a]), d) / Math.sqrt(l2);
    sum[e.a] += k;
    sum[e.b] += k;
    cnt[e.a]++;
    cnt[e.b]++;
  }
  return Array.from(sum, (s, i) => (cnt[i] ? s / cnt[i] : 0));
}

// Curvature, as edge-wear and dirt masks want it: near a sharp convex edge
// → towards 1, near a sharp crease → towards 0, flat → 0.5. Hard-surface
// models have their curvature at their edges (a cube's faces are flat), so
// distance to the nearest sharp edge is combined with the smooth
// curvature of rounded surfaces.
export async function bakeCurvature(
  map,
  { contrast = 1, width = 0.035, angle = 25, progress } = {},
) {
  const mesh = map.surf.mesh;
  const k = vertexCurvature(mesh);
  const vid = map.surf.vid;
  const span = Math.max(
    map.surf.max[0] - map.surf.min[0],
    map.surf.max[1] - map.surf.min[1],
    map.surf.max[2] - map.surf.min[2],
    1e-6,
  );
  const R = span * width;
  const edges = sharpEdges(mesh, angle);
  const cell = R;
  const grid = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  edges.forEach((e, idx) => {
    const lo = [0, 1, 2].map((a) =>
      Math.floor((Math.min(e.a[a], e.b[a]) - R) / cell),
    );
    const hi = [0, 1, 2].map((a) =>
      Math.floor((Math.max(e.a[a], e.b[a]) + R) / cell),
    );
    for (let x = lo[0]; x <= hi[0]; x++)
      for (let y = lo[1]; y <= hi[1]; y++)
        for (let z = lo[2]; z <= hi[2]; z++) {
          const kk = key(x, y, z);
          if (!grid.has(kk)) grid.set(kk, []);
          grid.get(kk).push(idx);
        }
  });
  return perTexel(
    map,
    (i, out) => {
      const t = map.tri[i];
      const smoothK =
        k[vid[t * 3]] * map.bary[i * 3] +
        k[vid[t * 3 + 1]] * map.bary[i * 3 + 1] +
        k[vid[t * 3 + 2]] * map.bary[i * 3 + 2];
      let edge = 0;
      const p = at3(map.pos, i);
      const list = grid.get(
        key(
          Math.floor(p[0] / cell),
          Math.floor(p[1] / cell),
          Math.floor(p[2] / cell),
        ),
      );
      if (list)
        for (const idx of list) {
          const e = edges[idx];
          const d = segmentDist(p, e.a, e.b);
          if (d >= R) continue;
          const f = (1 - d / R) ** 2 * e.sign;
          if (Math.abs(f) > Math.abs(edge)) edge = f;
        }
      out[i] = Math.max(
        0,
        Math.min(1, 0.5 + (edge * 0.5 + smoothK * 0.25) * contrast),
      );
    },
    progress,
  );
}

// Edges sharper than `angle`, with +1 for convex and −1 for creases.
export function sharpEdges(mesh, angle = 25) {
  const cos = Math.cos((angle * Math.PI) / 180);
  const out = [];
  const normals = mesh.f.map((f) => faceNormal(mesh, f));
  for (const e of edgeMap(mesh).values()) {
    if (e.faces.length !== 2) continue;
    const [[fa], [fb]] = e.faces;
    const na = normals[fa],
      nb = normals[fb];
    if (dot(na, nb) > cos) continue;
    // Convex when the other face's centre lies behind this face's plane.
    const cb = faceCentroid(mesh, mesh.f[fb]);
    const convex = dot(na, sub(cb, mesh.v[e.a])) < 0;
    out.push({ a: mesh.v[e.a], b: mesh.v[e.b], sign: convex ? 1 : -1 });
  }
  return out;
}

function faceCentroid(mesh, f) {
  const c = [0, 0, 0];
  for (const i of f.v)
    for (let k = 0; k < 3; k++) c[k] += mesh.v[i][k] / f.v.length;
  return c;
}

function segmentDist(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 1e-12 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  return len(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]));
}

export async function bakePosition(map, { progress } = {}) {
  const { min, max } = map.surf;
  const span = [
    max[0] - min[0] || 1,
    max[1] - min[1] || 1,
    max[2] - min[2] || 1,
  ];
  return perTexel(
    map,
    (i, out) => {
      for (let k = 0; k < 3; k++)
        out[i * 3 + k] = (map.pos[i * 3 + k] - min[k]) / span[k];
    },
    progress,
    3,
  );
}

export async function bakeWorldNormal(map, { progress } = {}) {
  return perTexel(
    map,
    (i, out) => {
      for (let k = 0; k < 3; k++)
        out[i * 3 + k] = map.nrm[i * 3 + k] * 0.5 + 0.5;
    },
    progress,
    3,
  );
}

// A flat colour per material slot (or per UV island), for masking by part.
export async function bakeID(map, { by = 'material', progress } = {}) {
  const hue = (k) => {
    const h = (k * 0.618034) % 1;
    const f = (n) => {
      const x = (n + h * 6) % 6;
      return Math.max(0, Math.min(1, Math.abs(x - 3) - 1)) * 0.75 + 0.2;
    };
    return [f(5), f(3), f(1)];
  };
  return perTexel(
    map,
    (i, out) => {
      const fi = map.surf.faceOf[map.tri[i]];
      const k = by === 'island' ? map.island[i] : (map.surf.mesh.f[fi].m ?? 0);
      out.set(hue(k + 1), i * 3);
    },
    progress,
    3,
  );
}

// Tangent frames per triangle from how UVs run across it: the world
// directions of +u and +v, which is what three.js's normal mapping expects.
function tangents(surf, t) {
  const p = (c) => [
    surf.pos[t * 9 + c * 3],
    surf.pos[t * 9 + c * 3 + 1],
    surf.pos[t * 9 + c * 3 + 2],
  ];
  const uv = (c) => [surf.uv[t * 6 + c * 2], surf.uv[t * 6 + c * 2 + 1]];
  const e1 = sub(p(1), p(0));
  const e2 = sub(p(2), p(0));
  const [du1, dv1] = [uv(1)[0] - uv(0)[0], uv(1)[1] - uv(0)[1]];
  const [du2, dv2] = [uv(2)[0] - uv(0)[0], uv(2)[1] - uv(0)[1]];
  const r = du1 * dv2 - du2 * dv1;
  if (Math.abs(r) < 1e-12)
    return [
      [1, 0, 0],
      [0, 1, 0],
    ];
  const f = 1 / r;
  const T = [
    (e1[0] * dv2 - e2[0] * dv1) * f,
    (e1[1] * dv2 - e2[1] * dv1) * f,
    (e1[2] * dv2 - e2[2] * dv1) * f,
  ];
  const B = [
    (e2[0] * du1 - e1[0] * du2) * f,
    (e2[1] * du1 - e1[1] * du2) * f,
    (e2[2] * du1 - e1[2] * du2) * f,
  ];
  return [T, B];
}

// Normals of a detailed mesh, written into the low one's tangent space: for
// each texel, a ray from just outside the low surface back along its normal
// finds the high surface. Without a high mesh, the low mesh's own smooth
// normals are baked onto its flat faces.
export async function bakeNormal(
  map,
  highBvh = null,
  { cage = null, progress } = {},
) {
  const span = Math.max(
    map.surf.max[0] - map.surf.min[0],
    map.surf.max[1] - map.surf.min[1],
    map.surf.max[2] - map.surf.min[2],
  );
  const reach = cage ?? span * 0.05;
  const frames = new Map();
  return perTexel(
    map,
    (i, out) => {
      const t = map.tri[i];
      let fr = frames.get(t);
      if (!fr) frames.set(t, (fr = tangents(map.surf, t)));
      const n = at3(map.nrm, i);
      let h = at3(map.snrm, i);
      if (highBvh) {
        const p = at3(map.pos, i);
        const o = [
          p[0] + n[0] * reach,
          p[1] + n[1] * reach,
          p[2] + n[2] * reach,
        ];
        const hit = raycast(highBvh, o, [-n[0], -n[1], -n[2]], reach * 2);
        if (hit) {
          const s = highBvh.surf;
          const w = [1 - hit.u - hit.v, hit.u, hit.v];
          h = [0, 1, 2].map(
            (k) =>
              s.snrm[hit.tri * 9 + k] * w[0] +
              s.snrm[hit.tri * 9 + 3 + k] * w[1] +
              s.snrm[hit.tri * 9 + 6 + k] * w[2],
          );
          const l = Math.hypot(...h) || 1;
          h = h.map((x) => x / l);
        }
      }
      // Gram–Schmidt the UV directions against this texel's normal.
      let [T, B] = fr;
      T = sub(
        T,
        n.map((x) => x * dot(T, n)),
      );
      const lt = Math.hypot(...T) || 1;
      T = T.map((x) => x / lt);
      B = sub(
        B,
        n.map((x) => x * dot(B, n)),
      );
      B = sub(
        B,
        T.map((x) => x * dot(B, T)),
      );
      const lb = Math.hypot(...B) || 1;
      B = B.map((x) => x / lb);
      out[i * 3] = dot(h, T) * 0.5 + 0.5;
      out[i * 3 + 1] = dot(h, B) * 0.5 + 0.5;
      out[i * 3 + 2] = dot(h, n) * 0.5 + 0.5;
    },
    progress,
    3,
  );
}

export const BAKERS = {
  ao: { label: 'Ambient occlusion', channels: 1 },
  normal: { label: 'Normal map', channels: 3 },
  curvature: { label: 'Curvature', channels: 1 },
  position: { label: 'Position', channels: 3 },
  thickness: { label: 'Thickness', channels: 1 },
  worldNormal: { label: 'World-space normals', channels: 3 },
  id: { label: 'ID map', channels: 3 },
};

// Float map → RGBA bytes (grey for one channel), empty texels transparent
// unless `fill` is given.
export function toImageBytes(map, values, channels, { fill = null } = {}) {
  const N = map.size * map.size;
  const out = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    if (map.tri[i] < 0) {
      if (fill) out.set(fill, i * 4);
      continue;
    }
    if (channels === 1) {
      const g = values[i] * 255;
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = g;
    } else {
      out[i * 4] = values[i * 3] * 255;
      out[i * 4 + 1] = values[i * 3 + 1] * 255;
      out[i * 4 + 2] = values[i * 3 + 2] * 255;
    }
    out[i * 4 + 3] = 255;
  }
  return out;
}
