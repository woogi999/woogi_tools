// Booleans: union, subtract and intersect between two meshes, by BSP trees
// (the approach of Evan Wallace's csg.js). Each polygon carries its UVs, its
// material slot and its shading along, so a cut through a painted cube is
// still painted, and the cutter's faces keep the cutter's own material.
//
// Inputs are meshes in the same space; the result is welded back into a
// shared-vertex mesh so that bevels, subdivision and edit mode can work on it.

import { weld, triangulateFace, faceNormal } from './mesh';

const EPS = 1e-5;
const COPLANAR = 0;
const FRONT = 1;
const BACK = 2;
const SPANNING = 3;

class Plane {
  constructor(n, w) {
    this.n = n;
    this.w = w;
  }
  static from(a, b, c) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-12) return null;
    n = [n[0] / l, n[1] / l, n[2] / l];
    return new Plane(n, n[0] * a[0] + n[1] * a[1] + n[2] * a[2]);
  }
  flip() {
    this.n = [-this.n[0], -this.n[1], -this.n[2]];
    this.w = -this.w;
  }
  clone() {
    return new Plane([...this.n], this.w);
  }
  // Sorts a polygon into the lists, cutting it in two where it spans the plane.
  split(poly, coFront, coBack, front, back) {
    let type = 0;
    const types = [];
    for (const vx of poly.vs) {
      const t =
        this.n[0] * vx.p[0] +
        this.n[1] * vx.p[1] +
        this.n[2] * vx.p[2] -
        this.w;
      const k = t < -EPS ? BACK : t > EPS ? FRONT : COPLANAR;
      type |= k;
      types.push(k);
    }
    if (type === COPLANAR) {
      const d =
        this.n[0] * poly.plane.n[0] +
        this.n[1] * poly.plane.n[1] +
        this.n[2] * poly.plane.n[2];
      (d > 0 ? coFront : coBack).push(poly);
    } else if (type === FRONT) front.push(poly);
    else if (type === BACK) back.push(poly);
    else {
      const f = [];
      const b = [];
      const n = poly.vs.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ti = types[i];
        const tj = types[j];
        const vi = poly.vs[i];
        const vj = poly.vs[j];
        if (ti !== BACK) f.push(vi);
        if (ti !== FRONT) b.push(ti !== BACK ? vi.clone() : vi);
        if ((ti | tj) === SPANNING) {
          const di =
            this.n[0] * vi.p[0] + this.n[1] * vi.p[1] + this.n[2] * vi.p[2];
          const dj =
            this.n[0] * (vj.p[0] - vi.p[0]) +
            this.n[1] * (vj.p[1] - vi.p[1]) +
            this.n[2] * (vj.p[2] - vi.p[2]);
          const t = (this.w - di) / dj;
          const v = vi.interpolate(vj, t);
          f.push(v);
          b.push(v.clone());
        }
      }
      if (f.length >= 3) front.push(new Poly(f, poly.shared, poly.plane));
      if (b.length >= 3) back.push(new Poly(b, poly.shared, poly.plane));
    }
  }
}

class Vert {
  constructor(p, uv) {
    this.p = p;
    this.uv = uv;
  }
  clone() {
    return new Vert([...this.p], [...this.uv]);
  }
  interpolate(o, t) {
    return new Vert(
      [
        this.p[0] + (o.p[0] - this.p[0]) * t,
        this.p[1] + (o.p[1] - this.p[1]) * t,
        this.p[2] + (o.p[2] - this.p[2]) * t,
      ],
      [
        this.uv[0] + (o.uv[0] - this.uv[0]) * t,
        this.uv[1] + (o.uv[1] - this.uv[1]) * t,
      ],
    );
  }
}

class Poly {
  constructor(vs, shared, plane) {
    this.vs = vs;
    this.shared = shared;
    this.plane = plane ?? Plane.from(vs[0].p, vs[1].p, vs[2].p);
  }
  clone() {
    return new Poly(
      this.vs.map((v) => v.clone()),
      this.shared,
      this.plane.clone(),
    );
  }
  flip() {
    this.vs.reverse();
    this.plane.flip();
  }
}

class Node {
  constructor(polys) {
    this.plane = null;
    this.front = null;
    this.back = null;
    this.polys = [];
    if (polys) this.build(polys);
  }
  clone() {
    const n = new Node();
    n.plane = this.plane?.clone() ?? null;
    n.front = this.front?.clone() ?? null;
    n.back = this.back?.clone() ?? null;
    n.polys = this.polys.map((p) => p.clone());
    return n;
  }
  // Inside ↔ outside. Iterative, since deep trees overflow the stack.
  invert() {
    const stack = [this];
    while (stack.length) {
      const node = stack.pop();
      for (const p of node.polys) p.flip();
      node.plane?.flip();
      const t = node.front;
      node.front = node.back;
      node.back = t;
      if (node.front) stack.push(node.front);
      if (node.back) stack.push(node.back);
    }
  }
  // The parts of `polys` outside this tree's solid.
  clipPolys(polys) {
    if (!this.plane) return [...polys];
    let front = [];
    let back = [];
    for (const p of polys) this.plane.split(p, front, back, front, back);
    if (this.front) front = this.front.clipPolys(front);
    back = this.back ? this.back.clipPolys(back) : [];
    return front.concat(back);
  }
  clipTo(bsp) {
    const stack = [this];
    while (stack.length) {
      const node = stack.pop();
      node.polys = bsp.clipPolys(node.polys);
      if (node.front) stack.push(node.front);
      if (node.back) stack.push(node.back);
    }
  }
  allPolys() {
    const out = [];
    const stack = [this];
    while (stack.length) {
      const node = stack.pop();
      for (const p of node.polys) out.push(p);
      if (node.front) stack.push(node.front);
      if (node.back) stack.push(node.back);
    }
    return out;
  }
  build(polys) {
    const work = [[this, polys]];
    while (work.length) {
      const [node, list] = work.pop();
      if (!list.length) continue;
      if (!node.plane) node.plane = list[0].plane.clone();
      const front = [];
      const back = [];
      for (const p of list)
        node.plane.split(p, node.polys, node.polys, front, back);
      if (front.length) {
        node.front ??= new Node();
        work.push([node.front, front]);
      }
      if (back.length) {
        node.back ??= new Node();
        work.push([node.back, back]);
      }
    }
  }
}

function toPolys(m) {
  const out = [];
  for (const f of m.f) {
    if (f.v.length < 3) continue;
    const shared = { m: f.m ?? 0, s: !!f.s };
    const n = faceNormal(m, f);
    // Non-planar or concave faces go in as triangles; BSP needs flat, convex ones.
    const flat = f.v.length === 3 || isPlanarConvex(m, f, n);
    const groups = flat ? [f.v.map((_, k) => k)] : triangulateFace(m, f);
    for (const corners of groups) {
      const vs = corners.map((k) => new Vert([...m.v[f.v[k]]], [...f.uv[k]]));
      const plane = Plane.from(vs[0].p, vs[1].p, vs[2].p) ?? findPlane(vs);
      if (plane) out.push(new Poly(vs, shared, plane));
    }
  }
  return out;
}

function findPlane(vs) {
  for (let i = 2; i < vs.length; i++) {
    const p = Plane.from(vs[0].p, vs[1].p, vs[i].p);
    if (p) return p;
  }
  return null;
}

function isPlanarConvex(m, f, n) {
  const p0 = m.v[f.v[0]];
  const w = n[0] * p0[0] + n[1] * p0[1] + n[2] * p0[2];
  for (const i of f.v) {
    const p = m.v[i];
    if (Math.abs(n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - w) > EPS * 10)
      return false;
  }
  const c = f.v.length;
  for (let k = 0; k < c; k++) {
    const a = m.v[f.v[k]];
    const b = m.v[f.v[(k + 1) % c]];
    const d = m.v[f.v[(k + 2) % c]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [d[0] - b[0], d[1] - b[1], d[2] - b[2]];
    const x = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    if (x[0] * n[0] + x[1] * n[1] + x[2] * n[2] < -1e-10) return false;
  }
  return true;
}

function fromPolys(polys) {
  const v = [];
  const f = [];
  for (const p of polys) {
    const ids = p.vs.map((vx) => {
      v.push(vx.p);
      return v.length - 1;
    });
    f.push({
      v: ids,
      uv: p.vs.map((vx) => vx.uv),
      m: p.shared.m,
      s: p.shared.s,
    });
  }
  return weld({ v, f }, 1e-5);
}

export function union(a, b) {
  if (!a.f.length) return b;
  if (!b.f.length) return a;
  const A = new Node(toPolys(a));
  const B = new Node(toPolys(b));
  A.clipTo(B);
  B.clipTo(A);
  B.invert();
  B.clipTo(A);
  B.invert();
  A.build(B.allPolys());
  return fromPolys(A.allPolys());
}

export function subtract(a, b) {
  if (!a.f.length || !b.f.length) return a;
  const A = new Node(toPolys(a));
  const B = new Node(toPolys(b));
  A.invert();
  A.clipTo(B);
  B.clipTo(A);
  B.invert();
  B.clipTo(A);
  B.invert();
  A.build(B.allPolys());
  A.invert();
  return fromPolys(A.allPolys());
}

export function intersect(a, b) {
  if (!a.f.length || !b.f.length) return { v: [], f: [] };
  const A = new Node(toPolys(a));
  const B = new Node(toPolys(b));
  A.invert();
  B.clipTo(A);
  B.invert();
  A.clipTo(B);
  B.clipTo(A);
  A.build(B.allPolys());
  A.invert();
  return fromPolys(A.allPolys());
}

export const BOOLEAN_OPS = { union, subtract, intersect };
