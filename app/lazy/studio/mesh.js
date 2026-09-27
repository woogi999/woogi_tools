// 3D Studio's polygon mesh: the one geometry type every other system works on.
//
//   mesh = { v: [[x, y, z], ...], f: [{ v: [i, j, k, ...], uv: [[u, v], ...], m, s }] }
//
// Faces are polygons of any size, wound counter-clockwise seen from outside.
// UVs live on the face corners (so a seam is just two faces disagreeing about
// a shared vertex), `m` is the face's material slot and `s` whether it's
// shaded smooth. Meshes are treated as values: every operation here returns a
// new mesh and leaves its input alone, which is what lets the document keep
// its undo history by holding on to old ones.

export const EPS = 1e-9;

// ─── Vectors (plain arrays) ────────────────────────────────────────────

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => len(sub(a, b));
export const lerp = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const lerp2 = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
export function norm(a) {
  const l = len(a);
  return l > EPS ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

export const edgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);

// ─── Basics ────────────────────────────────────────────────────────────

export const emptyMesh = () => ({ v: [], f: [] });

export function cloneMesh(m) {
  return {
    v: m.v.map((p) => [p[0], p[1], p[2]]),
    f: m.f.map(cloneFace),
  };
}

export const cloneFace = (f) => ({
  v: [...f.v],
  uv: f.uv.map((t) => [t[0], t[1]]),
  m: f.m ?? 0,
  s: !!f.s,
});

export function face(v, uv, m = 0, s = false) {
  return { v, uv: uv ?? v.map(() => [0, 0]), m, s };
}

export function counts(m) {
  let tris = 0;
  for (const f of m.f) tris += Math.max(0, f.v.length - 2);
  return { verts: m.v.length, faces: m.f.length, tris };
}

// Newell's method: robust for any planar-ish polygon, concave included.
export function faceNormal(m, f) {
  let x = 0,
    y = 0,
    z = 0;
  const n = f.v.length;
  for (let i = 0; i < n; i++) {
    const a = m.v[f.v[i]];
    const b = m.v[f.v[(i + 1) % n]];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return norm([x, y, z]);
}

export function faceCenter(m, f) {
  const c = [0, 0, 0];
  for (const i of f.v) {
    c[0] += m.v[i][0];
    c[1] += m.v[i][1];
    c[2] += m.v[i][2];
  }
  return scale(c, 1 / f.v.length);
}

export function faceArea(m, f) {
  let x = 0,
    y = 0,
    z = 0;
  const p0 = m.v[f.v[0]];
  for (let i = 1; i < f.v.length - 1; i++) {
    const c = cross(sub(m.v[f.v[i]], p0), sub(m.v[f.v[i + 1]], p0));
    x += c[0];
    y += c[1];
    z += c[2];
  }
  return len([x, y, z]) / 2;
}

export function bounds(m) {
  if (!m.v.length) return { min: [0, 0, 0], max: [0, 0, 0] };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of m.v)
    for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
  return { min, max };
}

// Every edge once: key → { a, b, faces: [[faceIndex, cornerIndex]] }, where
// the corner is the one the edge leaves from in that face.
export function edgeMap(m) {
  const map = new Map();
  m.f.forEach((f, fi) => {
    const n = f.v.length;
    for (let k = 0; k < n; k++) {
      const a = f.v[k];
      const b = f.v[(k + 1) % n];
      const key = edgeKey(a, b);
      let e = map.get(key);
      if (!e)
        map.set(key, (e = { a: Math.min(a, b), b: Math.max(a, b), faces: [] }));
      e.faces.push([fi, k]);
    }
  });
  return map;
}

// Vertex → neighbouring vertices, by edges.
export function neighbours(m) {
  const nb = m.v.map(() => new Set());
  for (const f of m.f) {
    const n = f.v.length;
    for (let k = 0; k < n; k++) {
      const a = f.v[k];
      const b = f.v[(k + 1) % n];
      if (a === b) continue;
      nb[a].add(b);
      nb[b].add(a);
    }
  }
  return nb.map((s) => [...s]);
}

// Angle-weighted vertex normals over every face (or, with `smoothOnly`, over
// the smooth faces only).
export function vertexNormals(m, { smoothOnly = false } = {}) {
  const out = m.v.map(() => [0, 0, 0]);
  for (const f of m.f) {
    if (smoothOnly && !f.s) continue;
    const n = faceNormal(m, f);
    const c = f.v.length;
    for (let k = 0; k < c; k++) {
      const p = m.v[f.v[k]];
      const a = norm(sub(m.v[f.v[(k + c - 1) % c]], p));
      const b = norm(sub(m.v[f.v[(k + 1) % c]], p));
      const w = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
      const o = out[f.v[k]];
      o[0] += n[0] * w;
      o[1] += n[1] * w;
      o[2] += n[2] * w;
    }
  }
  return out.map(norm);
}

// Normals averaged over every vertex sharing a position, so a shell pushed
// out along them doesn't tear open at the UV seams and hard edges that split
// a primitive's vertices.
export function weldedNormals(m, eps = 1e-5) {
  const vn = vertexNormals(m);
  const groups = new Map();
  const keyOf = (p) => p.map((x) => Math.round(x / eps)).join(',');
  m.v.forEach((p, i) => {
    const k = keyOf(p);
    const g = groups.get(k);
    if (g) {
      g.n = add(g.n, vn[i]);
      g.list.push(i);
    } else groups.set(k, { n: vn[i], list: [i] });
  });
  const out = new Array(m.v.length);
  for (const g of groups.values()) {
    const n = norm(g.n);
    for (const i of g.list) out[i] = n;
  }
  return out;
}

// ─── Triangulation ─────────────────────────────────────────────────────

// Corner triples for one polygon: fans for convex ones, ear clipping for the
// rest (booleans and hand edits make concave polygons).
export function triangulateFace(m, f) {
  const n = f.v.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];
  const normal = faceNormal(m, f);
  const ax = Math.abs(normal[0]);
  const ay = Math.abs(normal[1]);
  const az = Math.abs(normal[2]);
  // Drop the dominant axis, keeping the polygon counter-clockwise in 2D.
  let pts;
  if (az >= ax && az >= ay) {
    const s = normal[2] >= 0 ? 1 : -1;
    pts = f.v.map((i) => [m.v[i][0] * s, m.v[i][1]]);
  } else if (ax >= ay) {
    const s = normal[0] >= 0 ? 1 : -1;
    pts = f.v.map((i) => [m.v[i][1] * s, m.v[i][2]]);
  } else {
    const s = normal[1] >= 0 ? 1 : -1;
    pts = f.v.map((i) => [m.v[i][2] * s, m.v[i][0]]);
  }
  const area2 = (a, b, c) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let convex = true;
  for (let k = 0; k < n && convex; k++)
    if (area2(pts[k], pts[(k + 1) % n], pts[(k + 2) % n]) < -1e-12)
      convex = false;
  if (convex) {
    const tris = [];
    for (let k = 1; k < n - 1; k++) tris.push([0, k, k + 1]);
    return tris;
  }
  const idx = [...Array(n).keys()];
  const tris = [];
  const inside = (p, a, b, c) =>
    area2(a, b, p) >= 0 && area2(b, c, p) >= 0 && area2(c, a, p) >= 0;
  let guard = n * n;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length];
      const i1 = idx[k];
      const i2 = idx[(k + 1) % idx.length];
      const a = pts[i0],
        b = pts[i1],
        c = pts[i2];
      if (area2(a, b, c) <= 1e-12) continue;
      let blocked = false;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (inside(pts[j], a, b, c)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      tris.push([i0, i1, i2]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  else
    for (let k = 1; k < idx.length - 1; k++)
      tris.push([idx[0], idx[k], idx[k + 1]]);
  return tris;
}

export function triangulate(m) {
  const out = { v: m.v.map((p) => [...p]), f: [] };
  for (const f of m.f)
    for (const [a, b, c] of triangulateFace(m, f))
      out.f.push({
        v: [f.v[a], f.v[b], f.v[c]],
        uv: [[...f.uv[a]], [...f.uv[b]], [...f.uv[c]]],
        m: f.m,
        s: f.s,
      });
  return out;
}

// ─── Buffers for the renderer ──────────────────────────────────────────

// Flattens a mesh into indexed triangle buffers grouped by material slot.
// Smooth faces share a vertex wherever position, UV and slot agree; flat
// faces get their own corners. `vert` maps each buffer vertex back to its
// mesh vertex (skin weights, sculpting and weight colours need it) and
// `face` maps each triangle back to its polygon (picking in edit mode).
export function toBuffers(m) {
  const smooth = vertexNormals(m, { smoothOnly: true });
  const pos = [];
  const nrm = [];
  const uvs = [];
  const vert = [];
  const bySlot = new Map();
  const keyed = new Map();
  const faceNormals = m.f.map((f) => faceNormal(m, f));
  const push = (vi, uv, n) => {
    const p = m.v[vi];
    pos.push(p[0], p[1], p[2]);
    nrm.push(n[0], n[1], n[2]);
    uvs.push(uv[0], uv[1]);
    vert.push(vi);
    return vert.length - 1;
  };
  m.f.forEach((f, fi) => {
    const tris = triangulateFace(m, f);
    if (!tris.length) return;
    const corner = f.v.map((vi, k) => {
      if (f.s) {
        const key = `${vi}|${f.uv[k][0]}|${f.uv[k][1]}`;
        let at = keyed.get(key);
        if (at === undefined) {
          const n = len(smooth[vi]) > 0.5 ? smooth[vi] : faceNormals[fi];
          at = push(vi, f.uv[k], n);
          keyed.set(key, at);
        }
        return at;
      }
      return push(vi, f.uv[k], faceNormals[fi]);
    });
    const slot = f.m ?? 0;
    let list = bySlot.get(slot);
    if (!list) bySlot.set(slot, (list = { idx: [], faces: [] }));
    for (const [a, b, c] of tris) {
      list.idx.push(corner[a], corner[b], corner[c]);
      list.faces.push(fi);
    }
  });
  const index = [];
  const groups = [];
  const triFace = [];
  for (const slot of [...bySlot.keys()].sort((a, b) => a - b)) {
    const { idx, faces } = bySlot.get(slot);
    groups.push({ start: index.length, count: idx.length, slot });
    for (const i of idx) index.push(i);
    for (const f of faces) triFace.push(f);
  }
  const count = vert.length;
  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nrm),
    uv: new Float32Array(uvs),
    index: count > 65535 ? new Uint32Array(index) : new Uint16Array(index),
    groups,
    vert: Int32Array.from(vert),
    triFace: Int32Array.from(triFace),
  };
}

// ─── Clean-up ──────────────────────────────────────────────────────────

// Drops vertices no face uses and renumbers the rest.
export function removeUnused(m) {
  const used = new Int32Array(m.v.length).fill(-1);
  const v = [];
  const f = m.f.map((face) => ({
    ...face,
    v: face.v.map((i) => {
      if (used[i] < 0) {
        used[i] = v.length;
        v.push(m.v[i]);
      }
      return used[i];
    }),
  }));
  return { v, f };
}

// Collapses repeated corners (a face whose vertices were merged) and drops
// faces left with fewer than three.
export function cleanFaces(m) {
  const f = [];
  for (const face of m.f) {
    const v = [];
    const uv = [];
    for (let k = 0; k < face.v.length; k++) {
      if (v.length && v[v.length - 1] === face.v[k]) continue;
      v.push(face.v[k]);
      uv.push(face.uv[k]);
    }
    while (v.length > 1 && v[0] === v[v.length - 1]) {
      v.pop();
      uv.pop();
    }
    if (v.length >= 3 && new Set(v).size === v.length)
      f.push({ ...face, v, uv });
    else if (v.length >= 3) {
      // A face that pinched through itself: keep the first loop only.
      const seen = new Map();
      let cut = null;
      for (let k = 0; k < v.length && !cut; k++) {
        if (seen.has(v[k])) cut = [seen.get(v[k]), k];
        else seen.set(v[k], k);
      }
      if (cut) {
        const a = v.slice(0, cut[0]).concat(v.slice(cut[1]));
        const ua = uv.slice(0, cut[0]).concat(uv.slice(cut[1]));
        if (a.length >= 3) f.push({ ...face, v: a, uv: ua });
      }
    }
  }
  return { v: m.v, f };
}

// Merges vertices closer than `eps` (optionally only those in `only`).
export function weld(m, eps = 1e-4, only = null) {
  const remap = new Int32Array(m.v.length);
  const cells = new Map();
  const cell = (x) => Math.floor(x / eps);
  for (let i = 0; i < m.v.length; i++) {
    remap[i] = i;
    if (only && !only.has(i)) continue;
    const p = m.v[i];
    const c = [cell(p[0]), cell(p[1]), cell(p[2])];
    let found = -1;
    for (let dx = -1; dx <= 1 && found < 0; dx++)
      for (let dy = -1; dy <= 1 && found < 0; dy++)
        for (let dz = -1; dz <= 1 && found < 0; dz++) {
          const list = cells.get(`${c[0] + dx},${c[1] + dy},${c[2] + dz}`);
          if (!list) continue;
          for (const j of list)
            if (dist(m.v[j], p) <= eps) {
              found = j;
              break;
            }
        }
    if (found >= 0) remap[i] = found;
    else {
      const key = c.join(',');
      const list = cells.get(key);
      if (list) list.push(i);
      else cells.set(key, [i]);
    }
  }
  const f = m.f.map((face) => ({ ...face, v: face.v.map((i) => remap[i]) }));
  return removeUnused(cleanFaces({ v: m.v, f }));
}

// ─── Selection helpers ─────────────────────────────────────────────────

// Faces whose every vertex is in the set.
export function facesOfVerts(m, verts) {
  const out = new Set();
  m.f.forEach((f, fi) => {
    if (f.v.every((i) => verts.has(i))) out.add(fi);
  });
  return out;
}

export function vertsOfFaces(m, faces) {
  const out = new Set();
  for (const fi of faces) for (const i of m.f[fi].v) out.add(i);
  return out;
}

export function edgesOfVerts(m, verts) {
  const out = new Set();
  for (const [key, e] of edgeMap(m))
    if (verts.has(e.a) && verts.has(e.b)) out.add(key);
  return out;
}

// Faces joined to the given ones through shared edges, i.e. "select linked".
export function linkedFaces(m, seed) {
  const em = edgeMap(m);
  const byFace = m.f.map(() => []);
  for (const e of em.values())
    for (const [fa] of e.faces)
      for (const [fb] of e.faces) if (fa !== fb) byFace[fa].push(fb);
  const out = new Set(seed);
  const stack = [...seed];
  while (stack.length) {
    const fi = stack.pop();
    for (const n of byFace[fi])
      if (!out.has(n)) {
        out.add(n);
        stack.push(n);
      }
  }
  return out;
}

// ─── Transforming ──────────────────────────────────────────────────────

export function mapVerts(m, fn, only = null) {
  return {
    v: m.v.map((p, i) => (only && !only.has(i) ? p : fn(p, i))),
    f: m.f,
  };
}

export function flip(m, faces = null) {
  return {
    v: m.v,
    f: m.f.map((f, fi) =>
      faces && !faces.has(fi)
        ? f
        : { ...f, v: [...f.v].reverse(), uv: [...f.uv].reverse() },
    ),
  };
}

// Appends b's vertices and faces to a.
export function merge(a, b) {
  const off = a.v.length;
  return {
    v: a.v.concat(b.v),
    f: a.f.concat(b.f.map((f) => ({ ...f, v: f.v.map((i) => i + off) }))),
  };
}

// ─── Deleting and splitting ────────────────────────────────────────────

export function deleteFaces(m, faces) {
  return removeUnused({ v: m.v, f: m.f.filter((_, fi) => !faces.has(fi)) });
}

export function deleteVerts(m, verts) {
  return removeUnused({
    v: m.v,
    f: m.f.filter((f) => !f.v.some((i) => verts.has(i))),
  });
}

export function deleteEdges(m, edges) {
  return removeUnused({
    v: m.v,
    f: m.f.filter((f) => {
      for (let k = 0; k < f.v.length; k++)
        if (edges.has(edgeKey(f.v[k], f.v[(k + 1) % f.v.length]))) return false;
      return true;
    }),
  });
}

// { rest, part }: the selected faces pulled out as a mesh of their own.
export function separate(m, faces) {
  return {
    rest: deleteFaces(m, faces),
    part: removeUnused({ v: m.v, f: m.f.filter((_, fi) => faces.has(fi)) }),
  };
}

// Pulls the vertices together at their centre (or the first one's position).
export function mergeVerts(m, verts, at = 'center') {
  if (verts.size < 2) return m;
  const list = [...verts];
  const target =
    at === 'first'
      ? m.v[list[0]]
      : scale(
          list.reduce((s, i) => add(s, m.v[i]), [0, 0, 0]),
          1 / list.length,
        );
  const keep = list[0];
  const remap = (i) => (verts.has(i) ? keep : i);
  const v = m.v.map((p, i) => (i === keep ? [...target] : p));
  return removeUnused(
    cleanFaces({ v, f: m.f.map((f) => ({ ...f, v: f.v.map(remap) })) }),
  );
}

// ─── Extrude ───────────────────────────────────────────────────────────

// Region extrude: the selected faces move out along their normals as one
// piece and walls are built along the region's border. Returns the new mesh
// and which faces and vertices are now the moved region (to keep them
// selected, as every modeller does).
export function extrudeFaces(m, faces, distance = 0.25) {
  if (!faces.size) return { mesh: m, faces, verts: new Set() };
  const em = edgeMap(m);
  const v = m.v.map((p) => [...p]);
  const f = m.f.map((x) => ({ ...x }));
  const dup = new Map();
  const normals = new Map();
  for (const fi of faces) {
    const n = faceNormal(m, m.f[fi]);
    for (const i of m.f[fi].v)
      normals.set(i, add(normals.get(i) ?? [0, 0, 0], n));
  }
  const twin = (i) => {
    let j = dup.get(i);
    if (j === undefined) {
      j = v.length;
      v.push([...m.v[i]]);
      dup.set(i, j);
    }
    return j;
  };
  for (const fi of faces) {
    const src = m.f[fi];
    const n = src.v.length;
    for (let k = 0; k < n; k++) {
      const a = src.v[k];
      const b = src.v[(k + 1) % n];
      const e = em.get(edgeKey(a, b));
      const inRegion = e.faces.filter(([g]) => faces.has(g)).length;
      if (inRegion > 1) continue;
      f.push({
        v: [a, b, twin(b), twin(a)],
        uv: [
          [...src.uv[k]],
          [...src.uv[(k + 1) % n]],
          [...src.uv[(k + 1) % n]],
          [...src.uv[k]],
        ],
        m: src.m,
        s: false,
      });
    }
    f[fi] = { ...src, v: src.v.map(twin) };
  }
  for (const [i, j] of dup) {
    const n = norm(normals.get(i));
    v[j] = add(v[j], scale(n, distance));
  }
  // Interior vertices of the region are now unused; removeUnused drops them.
  const out = removeUnused({ v, f });
  // removeUnused renumbers in first-use order; rebuild the region's sets.
  const regionVerts = new Set();
  const map = new Map();
  let next = 0;
  for (const x of f) for (const i of x.v) if (!map.has(i)) map.set(i, next++);
  for (const j of dup.values()) regionVerts.add(map.get(j));
  return { mesh: out, faces: new Set(faces), verts: regionVerts };
}

// ─── Inset ─────────────────────────────────────────────────────────────

// Each selected face shrinks into itself by `amount`, joined to its old
// outline by a ring of quads. Returns the inner faces for selection.
export function insetFaces(m, faces, amount = 0.1) {
  const v = m.v.map((p) => [...p]);
  const f = [];
  const inner = new Set();
  m.f.forEach((src, fi) => {
    if (!faces.has(fi)) {
      f.push(src);
      return;
    }
    const n = src.v.length;
    const c = faceCenter(m, src);
    const cuv = src.uv.reduce(
      (s, t) => [s[0] + t[0] / n, s[1] + t[1] / n],
      [0, 0],
    );
    const ids = [];
    const uvs = [];
    for (let k = 0; k < n; k++) {
      const p = m.v[src.v[k]];
      const a = norm(sub(m.v[src.v[(k + n - 1) % n]], p));
      const b = norm(sub(m.v[src.v[(k + 1) % n]], p));
      const bis = norm(add(a, b));
      const half = Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) / 2;
      let d = amount / Math.max(Math.sin(half), 0.05);
      const toC = dist(p, c);
      d = Math.min(d, toC * 0.95);
      const dir = len(bis) > EPS ? bis : norm(sub(c, p));
      // The bisector points inside for convex corners; flip it for reflex ones.
      const inward =
        dot(dir, sub(c, p)) < 0 && Math.abs(dot(a, b)) < 0.999
          ? scale(dir, -1)
          : dir;
      const q = add(p, scale(inward, d));
      ids.push(v.length);
      v.push(q);
      const t = toC > EPS ? Math.min(1, d / toC) : 0;
      uvs.push(lerp2(src.uv[k], cuv, t));
    }
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      f.push({
        v: [src.v[k], src.v[k2], ids[k2], ids[k]],
        uv: [[...src.uv[k]], [...src.uv[k2]], uvs[k2], uvs[k]],
        m: src.m,
        s: src.s,
      });
    }
    inner.add(f.length);
    f.push({ v: ids, uv: uvs, m: src.m, s: src.s });
  });
  return { mesh: { v, f }, faces: inner };
}

// ─── Bevel ─────────────────────────────────────────────────────────────

const dihedral = (m, e, normals) => {
  if (e.faces.length !== 2) return 0;
  const [a, b] = e.faces;
  const d = dot(normals[a[0]], normals[b[0]]);
  return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
};

// Chamfers edges: every face shrinks within its own plane, the beveled edges
// become strips between neighbouring faces, and corners get a cap. Edges are
// chosen explicitly (edit mode) or by how sharp they are (the modifier).
// With `segments` > 1 the strips are rounded by repeated chamfering.
export function bevel(
  m,
  width = 0.1,
  { edges = null, angle = 30, segments = 1 } = {},
) {
  let out = bevelOnce(m, width, { edges, angle });
  for (let s = 1; s < segments; s++)
    out = bevelOnce(out, width / (2 * (s + 1)), {
      edges: null,
      angle: Math.max(angle, 5),
    });
  return out;
}

function bevelOnce(m, width, { edges, angle }) {
  if (width <= 0) return m;
  const em = edgeMap(m);
  const normals = m.f.map((f) => faceNormal(m, f));
  const bev = new Set();
  for (const [key, e] of em) {
    if (e.faces.length !== 2) continue;
    if (edges ? edges.has(key) : dihedral(m, e, normals) > angle) bev.add(key);
  }
  if (!bev.size) return m;
  const v = m.v.map((p) => [...p]);
  // How far along an unbeveled edge its shared corner point sits, from each end.
  const along = new Map();
  const corners = m.f.map((f) =>
    f.v.map((vi, k) => {
      const n = f.v.length;
      const a = f.v[(k + n - 1) % n];
      const b = f.v[(k + 1) % n];
      const p = m.v[vi];
      const la = dist(m.v[a], p);
      const lb = dist(m.v[b], p);
      const u = norm(sub(m.v[a], p));
      const t = norm(sub(m.v[b], p));
      const sin = Math.max(len(cross(u, t)), 0.2);
      const d = Math.min(width / sin, 0.45 * Math.min(la, lb));
      return {
        vi,
        a,
        b,
        u,
        t,
        d,
        la,
        lb,
        prev: bev.has(edgeKey(a, vi)),
        next: bev.has(edgeKey(vi, b)),
      };
    }),
  );
  for (const list of corners)
    for (const c of list) {
      if (c.prev === c.next) continue;
      // Only one side is beveled: the corner slides along the other edge.
      const other = c.prev ? c.b : c.a;
      const key = `${edgeKey(c.vi, other)}@${c.vi}`;
      const len1 = c.prev ? c.lb : c.la;
      const r = along.get(key) ?? { sum: 0, n: 0, max: 0.45 * len1 };
      r.sum += c.d;
      r.n++;
      along.set(key, r);
    }
  const shared = new Map();
  const sharedPoint = (vi, other) => {
    const key = `${edgeKey(vi, other)}@${vi}`;
    let id = shared.get(key);
    if (id === undefined) {
      const r = along.get(key);
      const d = Math.min(r.sum / r.n, r.max);
      id = v.length;
      v.push(add(m.v[vi], scale(norm(sub(m.v[other], m.v[vi])), d)));
      shared.set(key, id);
    }
    return id;
  };
  const f = [];
  const cornerIds = m.f.map((src, fi) => {
    const ids = [];
    const uvs = [];
    const n = src.v.length;
    corners[fi].forEach((c, k) => {
      const uv0 = src.uv[k];
      const uva = src.uv[(k + n - 1) % n];
      const uvb = src.uv[(k + 1) % n];
      if (c.prev && c.next) {
        ids.push(v.length);
        v.push(add(m.v[c.vi], scale(add(c.u, c.t), c.d)));
        uvs.push([
          uv0[0] +
            (uva[0] - uv0[0]) * (c.d / c.la) +
            (uvb[0] - uv0[0]) * (c.d / c.lb),
          uv0[1] +
            (uva[1] - uv0[1]) * (c.d / c.la) +
            (uvb[1] - uv0[1]) * (c.d / c.lb),
        ]);
      } else if (c.prev || c.next) {
        const other = c.prev ? c.b : c.a;
        const id = sharedPoint(c.vi, other);
        ids.push(id);
        const l = c.prev ? c.lb : c.la;
        const t = dist(v[id], m.v[c.vi]) / l;
        uvs.push(lerp2(uv0, c.prev ? uvb : uva, t));
      } else {
        ids.push(c.vi);
        uvs.push([...uv0]);
      }
    });
    f.push({ v: ids, uv: uvs, m: src.m, s: src.s });
    return { ids, uvs };
  });
  const cornerOf = (fi, vi) => {
    const k = m.f[fi].v.indexOf(vi);
    return { id: cornerIds[fi].ids[k], uv: cornerIds[fi].uvs[k] };
  };
  for (const key of bev) {
    const e = em.get(key);
    const [[F, kF], [G]] = e.faces;
    const v1 = m.f[F].v[kF];
    const v2 = m.f[F].v[(kF + 1) % m.f[F].v.length];
    const c = [
      cornerOf(F, v2),
      cornerOf(F, v1),
      cornerOf(G, v1),
      cornerOf(G, v2),
    ];
    f.push({
      v: c.map((x) => x.id),
      uv: c.map((x) => [...x.uv]),
      m: m.f[F].m,
      s: false,
    });
  }
  // Caps: walk the faces around each vertex that has a beveled edge.
  const around = new Map();
  corners.forEach((list, fi) =>
    list.forEach((c) => {
      if (!around.has(c.vi)) around.set(c.vi, new Map());
      around.get(c.vi).set(c.a, { fi, c });
    }),
  );
  for (const [vi, byPrev] of around) {
    const hasBevel = [...byPrev.values()].some(({ c }) => c.prev || c.next);
    if (!hasBevel) continue;
    const start = byPrev.values().next().value;
    const ring = [];
    let cur = start;
    let closed = false;
    for (let guard = 0; guard <= byPrev.size; guard++) {
      ring.push(cornerOf(cur.fi, vi));
      const next = byPrev.get(cur.c.b);
      if (!next) break;
      if (next === start) {
        closed = true;
        break;
      }
      cur = next;
    }
    if (!closed) continue;
    const ids = [];
    const uvs = [];
    for (const r of ring.reverse())
      if (ids[ids.length - 1] !== r.id && ids[0] !== r.id) {
        ids.push(r.id);
        uvs.push([...r.uv]);
      }
    if (ids.length >= 3)
      f.push({ v: ids, uv: uvs, m: m.f[start.fi].m, s: false });
  }
  return removeUnused(cleanFaces({ v, f }));
}

// ─── Loop cut ──────────────────────────────────────────────────────────

// The ring of quads crossing an edge: [{ face, start }] where `start` is the
// corner the cut edge leaves from in that face, plus whether it's closed.
export function edgeRing(m, key) {
  const em = edgeMap(m);
  const e = em.get(key);
  if (!e) return { ring: [], closed: false };
  const ring = [];
  const seen = new Set();
  let closed = false;
  const walk = (fi, k, into) => {
    while (fi !== undefined && !seen.has(fi) && m.f[fi].v.length === 4) {
      seen.add(fi);
      into.push({ face: fi, start: k });
      const f = m.f[fi];
      const a = f.v[(k + 2) % 4];
      const b = f.v[(k + 3) % 4];
      const next = em.get(edgeKey(a, b)).faces.find(([g]) => g !== fi);
      if (!next) return;
      if (seen.has(next[0])) {
        if (next[0] === ring[0]?.face) closed = true;
        return;
      }
      // Entering the next face along its edge b→a: that edge leaves from b there.
      fi = next[0];
      k = next[1];
    }
  };
  const [first, second] = e.faces;
  walk(first[0], first[1], ring);
  if (!closed && second) {
    const back = [];
    walk(second[0], second[1], back);
    // The other direction was walked from the far side: flip its entries so
    // every face's `start` sits on the same side of the cut.
    const flipped = back.map(({ face: fi, start }) => ({
      face: fi,
      start: (start + 2) % 4,
    }));
    ring.unshift(...flipped.reverse());
  }
  return { ring, closed };
}

// Cuts `cuts` evenly spaced loops through the ring of quads across an edge.
// `offset` (-1..1) slides a single cut towards either side.
export function loopCut(m, key, cuts = 1, offset = 0) {
  const { ring } = edgeRing(m, key);
  if (!ring.length) return { mesh: m, edges: new Set() };
  const v = m.v.map((p) => [...p]);
  const ts = [];
  for (let i = 1; i <= cuts; i++) ts.push(i / (cuts + 1));
  if (cuts === 1) ts[0] = 0.5 + offset * 0.45;
  // New points along each cut edge, keyed from the side the ring starts on.
  const points = new Map();
  const pointsOn = (a, b) => {
    const k = `${a}>${b}`;
    let ids = points.get(k);
    if (!ids) {
      const rev = points.get(`${b}>${a}`);
      if (rev) return [...rev].reverse();
      ids = ts.map((t) => {
        v.push(lerp(m.v[a], m.v[b], t));
        return v.length - 1;
      });
      points.set(k, ids);
    }
    return ids;
  };
  const inRing = new Map(ring.map((r) => [r.face, r.start]));
  const f = [];
  const newEdges = new Set();
  m.f.forEach((src, fi) => {
    if (!inRing.has(fi)) return;
    const k = inRing.get(fi);
    const c0 = src.v[k],
      c1 = src.v[(k + 1) % 4],
      c2 = src.v[(k + 2) % 4],
      c3 = src.v[(k + 3) % 4];
    const u0 = src.uv[k],
      u1 = src.uv[(k + 1) % 4],
      u2 = src.uv[(k + 2) % 4],
      u3 = src.uv[(k + 3) % 4];
    const near = pointsOn(c0, c1);
    const far = pointsOn(c3, c2);
    const rowA = [c0, ...near, c1];
    const rowB = [c3, ...far, c2];
    const tt = [0, ...ts, 1];
    for (let i = 0; i < rowA.length - 1; i++) {
      f.push({
        v: [rowA[i], rowA[i + 1], rowB[i + 1], rowB[i]],
        uv: [
          lerp2(u0, u1, tt[i]),
          lerp2(u0, u1, tt[i + 1]),
          lerp2(u3, u2, tt[i + 1]),
          lerp2(u3, u2, tt[i]),
        ],
        m: src.m,
        s: src.s,
      });
      if (i > 0) newEdges.add(edgeKey(rowA[i], rowB[i]));
    }
  });
  // Faces outside the ring that share a cut edge take the new points too.
  const out = [];
  m.f.forEach((src, fi) => {
    if (inRing.has(fi)) return;
    const vs = [];
    const uvs = [];
    const n = src.v.length;
    for (let k = 0; k < n; k++) {
      const a = src.v[k];
      const b = src.v[(k + 1) % n];
      vs.push(a);
      uvs.push(src.uv[k]);
      const ids =
        points.get(`${a}>${b}`) ??
        (points.get(`${b}>${a}`)
          ? [...points.get(`${b}>${a}`)].reverse()
          : null);
      if (ids) {
        const la = dist(m.v[a], m.v[b]);
        for (const id of ids) {
          vs.push(id);
          uvs.push(
            lerp2(
              src.uv[k],
              src.uv[(k + 1) % n],
              la > EPS ? dist(m.v[a], v[id]) / la : 0.5,
            ),
          );
        }
      }
    }
    out.push({ ...src, v: vs, uv: uvs });
  });
  return { mesh: { v, f: out.concat(f) }, edges: newEdges };
}

// ─── Bridge ────────────────────────────────────────────────────────────

// Closed loops (as ordered vertex lists) made by a set of edges.
export function edgeLoops(m, edges) {
  const adj = new Map();
  for (const key of edges) {
    const [a, b] = key.split('_').map(Number);
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  }
  const seen = new Set();
  const loops = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop = [start];
    seen.add(start);
    let prev = -1;
    let cur = start;
    let closed = false;
    for (;;) {
      const next = adj
        .get(cur)
        .find(
          (x) =>
            x !== prev && (!seen.has(x) || (x === start && loop.length > 2)),
        );
      if (next === undefined) break;
      if (next === start) {
        closed = true;
        break;
      }
      seen.add(next);
      loop.push(next);
      prev = cur;
      cur = next;
    }
    loops.push({ verts: loop, closed });
  }
  return loops;
}

// Joins two loops of the same length with a band of quads. The loops are
// the borders of holes (two faces deleted, or two open ends), and the band
// is wound to agree with the faces already on each side.
export function bridgeLoops(m, loopA, loopB) {
  if (loopA.length !== loopB.length || loopA.length < 3)
    throw new Error('Bridging needs two loops with the same number of edges.');
  const em = edgeMap(m);
  // Orient A so its existing faces run a(i+1)→a(i), and B the other way.
  const usesForward = (loop) => {
    const a = loop[0];
    const b = loop[1];
    const e = em.get(edgeKey(a, b));
    if (!e?.faces.length) return null;
    const [fi, k] = e.faces[0];
    return m.f[fi].v[k] === a;
  };
  let A = [...loopA];
  let B = [...loopB];
  if (usesForward(A) === true) A.reverse();
  if (usesForward(B) === false) B.reverse();
  const n = A.length;
  let best = 0;
  let bestCost = Infinity;
  for (let off = 0; off < n; off++) {
    let cost = 0;
    for (let i = 0; i < n; i++) cost += dist(m.v[A[i]], m.v[B[(i + off) % n]]);
    if (cost < bestCost) {
      bestCost = cost;
      best = off;
    }
  }
  B = B.map((_, i) => B[(i + best) % n]);
  // With A running one way, B has to run the opposite way round to face it.
  let costSame = 0;
  let costRev = 0;
  const Brev = B.map((_, i) => B[(n - i) % n]);
  for (let i = 0; i < n; i++) {
    costSame += dist(m.v[A[i]], m.v[B[i]]);
    costRev += dist(m.v[A[i]], m.v[Brev[i]]);
  }
  if (costRev < costSame - 1e-6) B = Brev;
  const f = [...m.f];
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    f.push({
      v: [A[i], A[i2], B[i2], B[i]],
      uv: [
        [i / n, 0],
        [(i + 1) / n, 0],
        [(i + 1) / n, 1],
        [i / n, 1],
      ],
      m: 0,
      s: false,
    });
  }
  return { v: m.v, f };
}

// The border of a set of faces, as loops.
export function regionBorder(m, faces) {
  const em = edgeMap(m);
  const border = new Set();
  for (const [key, e] of em) {
    const inside = e.faces.filter(([fi]) => faces.has(fi)).length;
    if (inside === 1) border.add(key);
  }
  return edgeLoops(m, border);
}

// Bridge two selected faces (or face regions): delete them and join the holes.
export function bridgeFaces(m, faces) {
  const em = edgeMap(m);
  const byFace = new Map([...faces].map((fi) => [fi, []]));
  for (const e of em.values())
    for (const [fa] of e.faces)
      for (const [fb] of e.faces)
        if (fa !== fb && faces.has(fa) && faces.has(fb))
          byFace.get(fa).push(fb);
  const regions = [];
  const seen = new Set();
  for (const fi of faces) {
    if (seen.has(fi)) continue;
    const region = new Set([fi]);
    const stack = [fi];
    seen.add(fi);
    while (stack.length)
      for (const n of byFace.get(stack.pop()))
        if (!seen.has(n)) {
          seen.add(n);
          region.add(n);
          stack.push(n);
        }
    regions.push(region);
  }
  if (regions.length !== 2)
    throw new Error('Select two separate faces (or face regions) to bridge.');
  const [la] = regionBorder(m, regions[0]);
  const [lb] = regionBorder(m, regions[1]);
  const matSlot = m.f[[...faces][0]].m;
  const kept = { v: m.v, f: m.f.filter((_, fi) => !faces.has(fi)) };
  const bridged = bridgeLoops(kept, la.verts, lb.verts);
  const added = bridged.f.length - kept.f.length;
  for (let i = bridged.f.length - added; i < bridged.f.length; i++)
    bridged.f[i].m = matSlot;
  return removeUnused(bridged);
}

// ─── Subdivision (Catmull–Clark) ───────────────────────────────────────

export function subdivide(m, levels = 1, { smooth = true } = {}) {
  let out = m;
  for (let l = 0; l < levels; l++) out = catmullClark(out, smooth);
  return out;
}

function catmullClark(m, smooth) {
  const em = edgeMap(m);
  const nv = m.v.length;
  const v = [];
  const facePts = m.f.map((f) => faceCenter(m, f));
  const edgeIndex = new Map();
  const edgePts = [];
  for (const [key, e] of em) {
    let p;
    if (smooth && e.faces.length === 2)
      p = scale(
        add(
          add(m.v[e.a], m.v[e.b]),
          add(facePts[e.faces[0][0]], facePts[e.faces[1][0]]),
        ),
        0.25,
      );
    else p = lerp(m.v[e.a], m.v[e.b], 0.5);
    edgeIndex.set(key, edgePts.length);
    edgePts.push(p);
  }
  // Vertex points.
  const faceSum = m.v.map(() => [0, 0, 0]);
  const faceCount = new Int32Array(nv);
  m.f.forEach((f, fi) => {
    for (const i of f.v) {
      faceSum[i] = add(faceSum[i], facePts[fi]);
      faceCount[i]++;
    }
  });
  const edgeSum = m.v.map(() => [0, 0, 0]);
  const edgeCount = new Int32Array(nv);
  const boundary = m.v.map(() => []);
  for (const e of em.values()) {
    const mid = lerp(m.v[e.a], m.v[e.b], 0.5);
    edgeSum[e.a] = add(edgeSum[e.a], mid);
    edgeSum[e.b] = add(edgeSum[e.b], mid);
    edgeCount[e.a]++;
    edgeCount[e.b]++;
    if (e.faces.length === 1) {
      boundary[e.a].push(e.b);
      boundary[e.b].push(e.a);
    }
  }
  for (let i = 0; i < nv; i++) {
    const P = m.v[i];
    if (!smooth || !faceCount[i]) v.push([...P]);
    else if (boundary[i].length >= 2) {
      const [a, b] = boundary[i];
      v.push(scale(add(add(m.v[a], m.v[b]), scale(P, 6)), 1 / 8));
    } else {
      const n = faceCount[i];
      const F = scale(faceSum[i], 1 / n);
      const R = scale(edgeSum[i], 1 / edgeCount[i]);
      v.push(scale(add(add(F, scale(R, 2)), scale(P, n - 3)), 1 / n));
    }
  }
  const eBase = v.length;
  for (const p of edgePts) v.push(p);
  const fBase = v.length;
  for (const p of facePts) v.push(p);
  const f = [];
  m.f.forEach((src, fi) => {
    const n = src.v.length;
    const cuv = src.uv.reduce(
      (s, t) => [s[0] + t[0] / n, s[1] + t[1] / n],
      [0, 0],
    );
    for (let k = 0; k < n; k++) {
      const prev = (k + n - 1) % n;
      const next = (k + 1) % n;
      const eNext = eBase + edgeIndex.get(edgeKey(src.v[k], src.v[next]));
      const ePrev = eBase + edgeIndex.get(edgeKey(src.v[prev], src.v[k]));
      f.push({
        v: [src.v[k], eNext, fBase + fi, ePrev],
        uv: [
          [...src.uv[k]],
          lerp2(src.uv[k], src.uv[next], 0.5),
          cuv,
          lerp2(src.uv[prev], src.uv[k], 0.5),
        ],
        m: src.m,
        s: src.s,
      });
    }
  });
  return { v, f };
}

// ─── Smoothing, decimation ─────────────────────────────────────────────

export function laplacian(
  m,
  iterations = 1,
  factor = 0.5,
  { pinBoundary = true, only = null } = {},
) {
  const nb = neighbours(m);
  const pinned = new Set();
  if (pinBoundary)
    for (const e of edgeMap(m).values())
      if (e.faces.length === 1) {
        pinned.add(e.a);
        pinned.add(e.b);
      }
  let v = m.v;
  for (let it = 0; it < iterations; it++) {
    v = v.map((p, i) => {
      if (pinned.has(i) || !nb[i].length || (only && !only.has(i))) return p;
      const avg = scale(
        nb[i].reduce((s, j) => add(s, v[j]), [0, 0, 0]),
        1 / nb[i].length,
      );
      return lerp(p, avg, factor);
    });
  }
  return { v, f: m.f };
}

// Shortest-edge collapse on the triangulated mesh until `ratio` of the
// triangles are left.
export function decimate(m, ratio = 0.5) {
  const tri = triangulate(m);
  const target = Math.max(
    4,
    Math.floor(tri.f.length * Math.min(1, Math.max(0.01, ratio))),
  );
  let v = tri.v.map((p) => [...p]);
  let f = tri.f;
  for (let pass = 0; pass < 40 && f.length > target; pass++) {
    const remap = Int32Array.from(v.keys());
    const edges = [];
    for (const face of f)
      for (let k = 0; k < 3; k++) {
        const a = face.v[k];
        const b = face.v[(k + 1) % 3];
        if (a < b) edges.push([dist(v[a], v[b]), a, b]);
      }
    edges.sort((x, y) => x[0] - y[0]);
    const touched = new Uint8Array(v.length);
    let budget = Math.ceil((f.length - target) / 2);
    for (const [, a, b] of edges) {
      if (budget <= 0) break;
      if (touched[a] || touched[b]) continue;
      touched[a] = touched[b] = 1;
      v[a] = lerp(v[a], v[b], 0.5);
      remap[b] = a;
      budget--;
    }
    const next = [];
    for (const face of f) {
      const vs = face.v.map((i) => remap[i]);
      if (vs[0] === vs[1] || vs[1] === vs[2] || vs[0] === vs[2]) continue;
      next.push({ ...face, v: vs });
    }
    if (next.length === f.length) break;
    f = next;
  }
  return removeUnused({ v, f });
}

// ─── Shells ────────────────────────────────────────────────────────────

// Gives a surface thickness: an inner copy wound the other way, joined at
// any open border.
export function solidify(m, thickness = 0.05) {
  const n = weldedNormals(m);
  const off = m.v.length;
  const v = m.v.concat(m.v.map((p, i) => sub(p, scale(n[i], thickness))));
  const f = [...m.f];
  for (const src of m.f)
    f.push({
      ...src,
      v: [...src.v].reverse().map((i) => i + off),
      uv: [...src.uv].reverse(),
    });
  for (const e of edgeMap(m).values()) {
    if (e.faces.length !== 1) continue;
    const [fi, k] = e.faces[0];
    const src = m.f[fi];
    const a = src.v[k];
    const b = src.v[(k + 1) % src.v.length];
    f.push({
      v: [b, a, a + off, b + off],
      uv: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      m: src.m,
      s: false,
    });
  }
  return { v, f };
}

// The shell an outline is drawn with: every vertex pushed out along its
// (welded, optionally smoothed) normal, faces turned inside out. Drawn with
// front faces culled, only the rim around the silhouette shows.
export const OUTLINE_SLOT = 1000;

export function outlineShell(
  m,
  thickness = 0.03,
  { smoothness = 0, slot = OUTLINE_SLOT } = {},
) {
  let normals = weldedNormals(m);
  if (smoothness > 0) {
    const nb = neighbours(m);
    for (let it = 0; it < smoothness; it++)
      normals = normals.map((n, i) =>
        norm(nb[i].reduce((s, j) => add(s, normals[j]), n)),
      );
  }
  return {
    v: m.v.map((p, i) => add(p, scale(normals[i], thickness))),
    f: m.f.map((src) => ({
      v: [...src.v].reverse(),
      uv: [...src.uv].reverse(),
      m: slot,
      s: true,
    })),
  };
}

export function mirror(m, axis = 0, { weld: doWeld = true, eps = 1e-4 } = {}) {
  const off = m.v.length;
  const v = m.v.concat(
    m.v.map((p) => {
      const q = [...p];
      q[axis] = -q[axis];
      return q;
    }),
  );
  const f = m.f.concat(
    m.f.map((src) => ({
      ...src,
      v: [...src.v].reverse().map((i) => i + off),
      uv: [...src.uv].reverse().map((t) => [1 - t[0], t[1]]),
    })),
  );
  if (!doWeld) return { v, f };
  const onPlane = new Set();
  v.forEach((p, i) => {
    if (Math.abs(p[axis]) <= eps) onPlane.add(i);
  });
  return weld({ v, f }, eps, onPlane);
}
