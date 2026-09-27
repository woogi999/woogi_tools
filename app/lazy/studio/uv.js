// UV tools. UVs live on face corners (mesh.js), so an island is a set of
// faces joined through edges whose two ends have the same UVs on both sides.
// Every function takes a mesh and the faces to work on, and returns a mesh
// with just those faces' UVs changed.

import {
  faceNormal,
  edgeMap,
  edgeKey,
  sub,
  dot,
  cross,
  norm,
  len,
  add,
  scale,
} from './mesh';

const UV_EPS = 1e-6;
const sameUv = (a, b) =>
  Math.abs(a[0] - b[0]) < UV_EPS && Math.abs(a[1] - b[1]) < UV_EPS;
const allFaces = (m) => new Set(m.f.keys());

function withUvs(m, updates) {
  const f = m.f.map((face, fi) =>
    updates.has(fi) ? { ...face, uv: updates.get(fi) } : face,
  );
  return { v: m.v, f };
}

// ─── Islands ───────────────────────────────────────────────────────────

export function uvIslands(m, faces = allFaces(m)) {
  const parent = new Map([...faces].map((f) => [f, f]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  for (const e of edgeMap(m).values()) {
    if (e.faces.length !== 2) continue;
    const [[fa, ka], [fb, kb]] = e.faces;
    if (!faces.has(fa) || !faces.has(fb)) continue;
    const A = m.f[fa];
    const B = m.f[fb];
    // Edge a→b in A is b→a in B.
    const a0 = A.uv[ka];
    const a1 = A.uv[(ka + 1) % A.v.length];
    const b0 = B.uv[kb];
    const b1 = B.uv[(kb + 1) % B.v.length];
    if (sameUv(a0, b1) && sameUv(a1, b0)) parent.set(find(fa), find(fb));
  }
  const groups = new Map();
  for (const f of faces) {
    const r = find(f);
    if (!groups.has(r)) groups.set(r, new Set());
    groups.get(r).add(f);
  }
  return [...groups.values()];
}

function islandBox(m, island) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const fi of island)
    for (const [u, v] of m.f[fi].uv) {
      if (u < x0) x0 = u;
      if (v < y0) y0 = v;
      if (u > x1) x1 = u;
      if (v > y1) y1 = v;
    }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

// ─── Projections ───────────────────────────────────────────────────────

function basis(n) {
  const up = Math.abs(n[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  const t = norm(cross(up, n));
  const b = cross(n, t);
  return [t, b];
}

// Projects faces flat along a direction (their average normal by default).
function planarUvs(m, faces, normal) {
  let n = normal;
  if (!n) {
    n = [0, 0, 0];
    for (const fi of faces) n = add(n, scale(faceNormal(m, m.f[fi]), 1));
    n = len(n) > 1e-9 ? norm(n) : [0, 1, 0];
  }
  const [t, b] = basis(n);
  const out = new Map();
  for (const fi of faces)
    out.set(
      fi,
      m.f[fi].v.map((vi) => [dot(m.v[vi], t), dot(m.v[vi], b)]),
    );
  return out;
}

// Fits a set of UV lists into the unit square, keeping their proportions.
function normalise(map, margin = 0.02) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const uvs of map.values())
    for (const [u, v] of uvs) {
      x0 = Math.min(x0, u);
      y0 = Math.min(y0, v);
      x1 = Math.max(x1, u);
      y1 = Math.max(y1, v);
    }
  const s = (1 - 2 * margin) / Math.max(x1 - x0, y1 - y0, 1e-9);
  for (const [fi, uvs] of map)
    map.set(
      fi,
      uvs.map(([u, v]) => [margin + (u - x0) * s, margin + (v - y0) * s]),
    );
  return map;
}

export function projectPlanar(m, faces = allFaces(m), normal = null) {
  return withUvs(m, normalise(planarUvs(m, faces, normal)));
}

// Each face takes the side of a box it faces most, then the sides are packed.
export function projectBox(m, faces = allFaces(m)) {
  const sides = new Map();
  for (const fi of faces) {
    const n = faceNormal(m, m.f[fi]);
    const ax = [0, 1, 2].reduce(
      (best, k) => (Math.abs(n[k]) > Math.abs(n[best]) ? k : best),
      0,
    );
    const key = ax * 2 + (n[ax] >= 0 ? 0 : 1);
    if (!sides.has(key)) sides.set(key, new Set());
    sides.get(key).add(fi);
  }
  const all = new Map();
  for (const [key, set] of sides) {
    const ax = Math.floor(key / 2);
    const dir = [0, 0, 0];
    dir[ax] = key % 2 ? -1 : 1;
    for (const [fi, uvs] of planarUvs(m, set, dir)) all.set(fi, uvs);
  }
  return packIslands(withUvs(m, all), faces);
}

// Around an axis: u follows the angle, v the height. Faces straddling the
// seam are unwrapped on one side of it.
export function projectCylinder(m, faces = allFaces(m), axis = 1) {
  const [i, j] = [(axis + 1) % 3, (axis + 2) % 3];
  let lo = Infinity,
    hi = -Infinity;
  for (const fi of faces)
    for (const vi of m.f[fi].v) {
      lo = Math.min(lo, m.v[vi][axis]);
      hi = Math.max(hi, m.v[vi][axis]);
    }
  const span = hi - lo || 1;
  const out = new Map();
  for (const fi of faces) {
    const uvs = m.f[fi].v.map((vi) => {
      const p = m.v[vi];
      return [
        0.5 + Math.atan2(p[j], p[i]) / (2 * Math.PI),
        (p[axis] - lo) / span,
      ];
    });
    fixSeam(uvs);
    out.set(fi, uvs);
  }
  return withUvs(m, out);
}

export function projectSphere(m, faces = allFaces(m)) {
  const out = new Map();
  for (const fi of faces) {
    const uvs = m.f[fi].v.map((vi) => {
      const p = norm(m.v[vi]);
      return [
        0.5 + Math.atan2(p[0], p[2]) / (2 * Math.PI),
        0.5 + Math.asin(Math.max(-1, Math.min(1, p[1]))) / Math.PI,
      ];
    });
    fixSeam(uvs);
    out.set(fi, uvs);
  }
  return withUvs(m, out);
}

function fixSeam(uvs) {
  const us = uvs.map((t) => t[0]);
  if (Math.max(...us) - Math.min(...us) > 0.5)
    for (const t of uvs) if (t[0] < 0.5) t[0] += 1;
}

// ─── Automatic unwrap ──────────────────────────────────────────────────

// Grows charts of connected faces facing roughly the same way (within
// `angle` of the chart's first face), flattens each along its average
// normal, turns it to its tightest box and packs the lot.
export function autoUnwrap(
  m,
  faces = allFaces(m),
  { angle = 66, margin = 0.01 } = {},
) {
  const em = edgeMap(m);
  const normals = new Map([...faces].map((fi) => [fi, faceNormal(m, m.f[fi])]));
  const nbrs = new Map([...faces].map((fi) => [fi, []]));
  for (const e of em.values())
    if (e.faces.length === 2) {
      const [[a], [b]] = e.faces;
      if (faces.has(a) && faces.has(b)) {
        nbrs.get(a).push(b);
        nbrs.get(b).push(a);
      }
    }
  const cos = Math.cos((angle * Math.PI) / 180);
  const seen = new Set();
  const charts = [];
  // Seed from the biggest faces first so charts start somewhere sensible.
  const order = [...faces].sort((a, b) => m.f[b].v.length - m.f[a].v.length);
  for (const seed of order) {
    if (seen.has(seed)) continue;
    const n0 = normals.get(seed);
    let sum = [...n0];
    const chart = new Set([seed]);
    seen.add(seed);
    const queue = [seed];
    while (queue.length) {
      const fi = queue.shift();
      for (const nb of nbrs.get(fi)) {
        if (seen.has(nb)) continue;
        const nn = normals.get(nb);
        if (dot(nn, n0) < cos || dot(nn, norm(sum)) < cos) continue;
        seen.add(nb);
        chart.add(nb);
        sum = add(sum, nn);
        queue.push(nb);
      }
    }
    charts.push({ faces: chart, normal: norm(sum) });
  }
  const all = new Map();
  for (const chart of charts) {
    const uvs = planarUvs(m, chart.faces, chart.normal);
    rotateToFit(uvs);
    for (const [fi, list] of uvs) all.set(fi, list);
  }
  return packIslands(withUvs(m, all), faces, {
    margin,
    islands: charts.map((c) => c.faces),
  });
}

// Turns a chart so its bounding box is as small as it gets (to 3°).
function rotateToFit(uvs) {
  const pts = [];
  for (const list of uvs.values()) for (const p of list) pts.push(p);
  let best = 0;
  let bestArea = Infinity;
  for (let a = 0; a < 90; a += 3) {
    const r = (a * Math.PI) / 180;
    const c = Math.cos(r),
      s = Math.sin(r);
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const [u, v] of pts) {
      const x = u * c - v * s;
      const y = u * s + v * c;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const area = (x1 - x0) * (y1 - y0);
    if (area < bestArea - 1e-12) {
      bestArea = area;
      best = r;
    }
  }
  const c = Math.cos(best),
    s = Math.sin(best);
  for (const [fi, list] of uvs)
    uvs.set(
      fi,
      list.map(([u, v]) => [u * c - v * s, u * s + v * c]),
    );
}

// ─── Packing ───────────────────────────────────────────────────────────

// Shelf-packs islands into the unit square, all scaled by the same factor so
// texel density stays even; the factor is the largest that still fits.
export function packIslands(
  m,
  faces = allFaces(m),
  { margin = 0.01, islands = null } = {},
) {
  const list = (islands ?? uvIslands(m, faces)).map((isl) => ({
    faces: isl,
    box: islandBox(m, isl),
  }));
  if (!list.length) return m;
  // Tall islands lie down: shelves pack wide things better.
  for (const it of list)
    if (it.box.h > it.box.w * 1.2) {
      it.rotate = true;
      it.box = { ...it.box, w: it.box.h, h: it.box.w };
    }
  list.sort((a, b) => b.box.h - a.box.h);
  const tryPack = (s) => {
    const placed = [];
    let x = margin,
      y = margin,
      row = 0;
    for (const it of list) {
      const w = it.box.w * s;
      const h = it.box.h * s;
      if (x + w > 1 - margin + 1e-9) {
        x = margin;
        y += row + margin;
        row = 0;
      }
      if (w > 1 - 2 * margin + 1e-9 || y + h > 1 - margin + 1e-9) return null;
      placed.push({ it, x, y });
      x += w + margin;
      row = Math.max(row, h);
    }
    return placed;
  };
  const area = list.reduce((s, it) => s + it.box.w * it.box.h, 0) || 1;
  let hi = Math.sqrt(1 / area) * 1.2;
  let lo = 0;
  let best = null;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const p = tryPack(mid);
    if (p) {
      best = { p, s: mid };
      lo = mid;
    } else hi = mid;
  }
  if (!best) best = { p: tryPack(1e-3) ?? [], s: 1e-3 };
  const updates = new Map();
  for (const { it, x, y } of best.p) {
    const { x0, y0 } = islandBox(m, it.faces);
    const bw = it.rotate ? it.box.h : it.box.w;
    for (const fi of it.faces)
      updates.set(
        fi,
        m.f[fi].uv.map(([u, v]) => {
          let lu = u - x0;
          let lv = v - y0;
          if (it.rotate) [lu, lv] = [lv, bw - lu];
          return [x + lu * best.s, y + lv * best.s];
        }),
      );
  }
  return withUvs(m, updates);
}

// ─── Relax ─────────────────────────────────────────────────────────────

// Evens out each island's interior with its border pinned, weighting by
// the real edge lengths so stretched areas even out towards the model's
// proportions.
export function relaxUvs(m, faces = allFaces(m), iterations = 20) {
  const updates = new Map();
  for (const island of uvIslands(m, faces)) {
    const uv = new Map();
    const nbrs = new Map();
    const edgeUse = new Map();
    for (const fi of island) {
      const f = m.f[fi];
      const n = f.v.length;
      for (let k = 0; k < n; k++) {
        const a = f.v[k];
        const b = f.v[(k + 1) % n];
        if (!uv.has(a)) uv.set(a, [...f.uv[k]]);
        const key = edgeKey(a, b);
        edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
        if (!nbrs.has(a)) nbrs.set(a, new Set());
        if (!nbrs.has(b)) nbrs.set(b, new Set());
        nbrs.get(a).add(b);
        nbrs.get(b).add(a);
      }
    }
    const pinned = new Set();
    for (const [key, count] of edgeUse)
      if (count === 1) for (const x of key.split('_')) pinned.add(Number(x));
    if (pinned.size === uv.size) continue;
    for (let it = 0; it < iterations; it++)
      for (const [vi, list] of nbrs) {
        if (pinned.has(vi)) continue;
        let su = 0,
          sv = 0,
          sw = 0;
        for (const nb of list) {
          const w = 1 / Math.max(len(sub(m.v[vi], m.v[nb])), 1e-6);
          const t = uv.get(nb);
          su += t[0] * w;
          sv += t[1] * w;
          sw += w;
        }
        const t = uv.get(vi);
        t[0] = t[0] * 0.3 + (su / sw) * 0.7;
        t[1] = t[1] * 0.3 + (sv / sw) * 0.7;
      }
    for (const fi of island)
      updates.set(
        fi,
        m.f[fi].v.map((vi) => [...uv.get(vi)]),
      );
  }
  return withUvs(m, updates);
}

// ─── Moving islands ────────────────────────────────────────────────────

export function uvCenter(m, faces) {
  let u = 0,
    v = 0,
    n = 0;
  for (const fi of faces)
    for (const t of m.f[fi].uv) {
      u += t[0];
      v += t[1];
      n++;
    }
  return n ? [u / n, v / n] : [0.5, 0.5];
}

// Moves, turns (degrees) and scales the faces' UVs about a pivot.
export function transformUvs(
  m,
  faces,
  { move = [0, 0], rotate = 0, scale: s = [1, 1], pivot = null } = {},
) {
  const [px, py] = pivot ?? uvCenter(m, faces);
  const r = (rotate * Math.PI) / 180;
  const c = Math.cos(r),
    sn = Math.sin(r);
  const updates = new Map();
  for (const fi of faces)
    updates.set(
      fi,
      m.f[fi].uv.map(([u, v]) => {
        const x = (u - px) * s[0];
        const y = (v - py) * s[1];
        return [px + x * c - y * sn + move[0], py + x * sn + y * c + move[1]];
      }),
    );
  return withUvs(m, updates);
}

// How much of the unit square the faces' UVs cover, and whether any overlap
// (sampled on a coarse grid), for the UV editor's status line.
export function uvStats(m, faces = allFaces(m)) {
  const N = 128;
  const grid = new Uint8Array(N * N);
  const owner = new Int32Array(N * N).fill(-1);
  let overlap = 0;
  let covered = 0;
  for (const fi of faces) {
    const f = m.f[fi];
    for (let k = 1; k < f.uv.length - 1; k++) {
      const a = f.uv[0],
        b = f.uv[k],
        c = f.uv[k + 1];
      const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]) * N));
      const x1 = Math.min(N - 1, Math.ceil(Math.max(a[0], b[0], c[0]) * N));
      const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]) * N));
      const y1 = Math.min(N - 1, Math.ceil(Math.max(a[1], b[1], c[1]) * N));
      const area =
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(area) < 1e-12) continue;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const px = (x + 0.5) / N,
            py = (y + 0.5) / N;
          const w0 =
            ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
          const w1 =
            ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const i = y * N + x;
          // Only a texel well inside a second face counts as overlap: one on
          // an edge two neighbouring faces share is just the seam between them.
          const inner = w0 > 0.02 && w1 > 0.02 && w2 > 0.02;
          if (owner[i] === -1) {
            owner[i] = fi;
            covered++;
          } else if (inner && owner[i] !== fi && grid[i] === 0) {
            grid[i] = 1;
            overlap++;
          }
        }
    }
  }
  return { coverage: covered / (N * N), overlap: overlap / (N * N) };
}
