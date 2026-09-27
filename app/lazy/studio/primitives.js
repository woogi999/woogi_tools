// Procedural primitives. Each is a recipe (a kind and its parameters) rather
// than a pile of vertices: objects keep the recipe, so a cylinder can be
// given more sides or a narrower top at any time, and its mesh is rebuilt
// from the new numbers. Every primitive comes out welded (one vertex per
// position, UV seams carried by the face corners) and laid out on its own
// area of the texture, so it can be painted without further unwrapping.

import { weld } from './mesh';

const TAU = Math.PI * 2;

// Collects loose polygons; `done()` welds them into one mesh.
function builder() {
  const v = [];
  const f = [];
  const api = {
    poly(points, uvs, { m = 0, s = false } = {}) {
      const ids = points.map((p) => {
        v.push([p[0], p[1], p[2]]);
        return v.length - 1;
      });
      f.push({ v: ids, uv: uvs.map((t) => [t[0], t[1]]), m, s });
    },
    // A grid of quads from corner `o` along axes `a` (nu cells) and `b`
    // (nv cells), filling the UV rectangle `r` = [u0, v0, u1, v1].
    grid(o, a, b, nu, nv, r, opts) {
      const at = (i, j) => [
        o[0] + (a[0] * i) / nu + (b[0] * j) / nv,
        o[1] + (a[1] * i) / nu + (b[1] * j) / nv,
        o[2] + (a[2] * i) / nu + (b[2] * j) / nv,
      ];
      const uv = (i, j) => [
        r[0] + ((r[2] - r[0]) * i) / nu,
        r[1] + ((r[3] - r[1]) * j) / nv,
      ];
      for (let j = 0; j < nv; j++)
        for (let i = 0; i < nu; i++)
          api.poly(
            [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)],
            [uv(i, j), uv(i + 1, j), uv(i + 1, j + 1), uv(i, j + 1)],
            opts,
          );
    },
    done: (eps = 1e-6) => weld({ v, f }, eps),
  };
  return api;
}

// Revolves a profile ([radius, y] from bottom to top) around Y. Rings of
// radius 0 collapse to a pole when welded. UVs span `r`.
function lathe(b, profile, sides, r, { s = true, m = 0, arc = TAU } = {}) {
  const lengths = [0];
  for (let i = 1; i < profile.length; i++)
    lengths.push(
      lengths[i - 1] +
        Math.hypot(
          profile[i][0] - profile[i - 1][0],
          profile[i][1] - profile[i - 1][1],
        ),
    );
  const total = lengths[lengths.length - 1] || 1;
  const point = (i, k) => {
    const a = (k / sides) * arc;
    const [rad, y] = profile[i];
    return [Math.sin(a) * rad, y, Math.cos(a) * rad];
  };
  const uv = (i, k) => [
    r[0] + ((r[2] - r[0]) * k) / sides,
    r[1] + ((r[3] - r[1]) * lengths[i]) / total,
  ];
  for (let i = 0; i < profile.length - 1; i++)
    for (let k = 0; k < sides; k++) {
      const p = [
        point(i, k),
        point(i, k + 1),
        point(i + 1, k + 1),
        point(i + 1, k),
      ];
      const t = [uv(i, k), uv(i, k + 1), uv(i + 1, k + 1), uv(i + 1, k)];
      b.poly(p, t, { s, m });
    }
}

// A flat disc cap as one polygon (or a fan), UVs in the circle inside `r`.
function cap(b, y, radius, sides, r, up, { fan = false, m = 0 } = {}) {
  if (radius <= 1e-9) return;
  const cx = (r[0] + r[2]) / 2;
  const cy = (r[1] + r[3]) / 2;
  const hw = (r[2] - r[0]) / 2;
  const hh = (r[3] - r[1]) / 2;
  const ring = [];
  for (let k = 0; k < sides; k++) {
    const a = (k / sides) * TAU;
    ring.push({
      p: [Math.sin(a) * radius, y, Math.cos(a) * radius],
      t: [cx + Math.sin(a) * hw, cy + Math.cos(a) * hh * (up ? -1 : 1)],
    });
  }
  // Increasing angle winds counter-clockwise seen from above, so the ring
  // as it is faces up and the bottom cap takes it reversed.
  const order = up ? ring : [...ring].reverse();
  if (!fan) {
    b.poly(
      order.map((c) => c.p),
      order.map((c) => c.t),
      { m },
    );
    return;
  }
  for (let k = 0; k < sides; k++) {
    const c0 = order[k];
    const c1 = order[(k + 1) % sides];
    b.poly([[0, y, 0], c0.p, c1.p], [[cx, cy], c0.t, c1.t], { m });
  }
}

// ─── The primitives ────────────────────────────────────────────────────

function cube({ width, height, depth, segments }) {
  const b = builder();
  const [w, h, d] = [width / 2, height / 2, depth / 2];
  const n = Math.max(1, Math.round(segments));
  // A 3×2 atlas: +X −X +Y / −Y +Z −Z.
  const cell = (c, r) => [
    c / 3 + 0.005,
    r / 2 + 0.005,
    (c + 1) / 3 - 0.005,
    (r + 1) / 2 - 0.005,
  ];
  b.grid([w, -h, d], [0, 0, -2 * d], [0, 2 * h, 0], n, n, cell(0, 1)); // +X
  b.grid([-w, -h, -d], [0, 0, 2 * d], [0, 2 * h, 0], n, n, cell(1, 1)); // −X
  b.grid([-w, h, d], [2 * w, 0, 0], [0, 0, -2 * d], n, n, cell(2, 1)); // +Y
  b.grid([-w, -h, -d], [2 * w, 0, 0], [0, 0, 2 * d], n, n, cell(0, 0)); // −Y
  b.grid([-w, -h, d], [2 * w, 0, 0], [0, 2 * h, 0], n, n, cell(1, 0)); // +Z
  b.grid([w, -h, -d], [-2 * w, 0, 0], [0, 2 * h, 0], n, n, cell(2, 0)); // −Z
  return b.done();
}

function sphere({ radius, segments, rings, smooth }) {
  const b = builder();
  const nr = Math.max(2, Math.round(rings));
  const profile = [];
  for (let i = 0; i <= nr; i++) {
    const a = Math.PI * (i / nr);
    profile.push([Math.sin(a) * radius, -Math.cos(a) * radius]);
  }
  lathe(b, profile, Math.max(3, Math.round(segments)), [0, 0, 1, 1], {
    s: smooth,
  });
  return b.done();
}

function icosphere({ radius, detail, smooth }) {
  const t = (1 + Math.sqrt(5)) / 2;
  let v = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ].map((p) => {
    const l = Math.hypot(...p);
    return p.map((x) => x / l);
  });
  let faces = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  for (let d = 0; d < Math.min(5, Math.max(0, Math.round(detail))); d++) {
    const mids = new Map();
    const mid = (a, c) => {
      const key = a < c ? `${a}_${c}` : `${c}_${a}`;
      let i = mids.get(key);
      if (i === undefined) {
        const p = [
          (v[a][0] + v[c][0]) / 2,
          (v[a][1] + v[c][1]) / 2,
          (v[a][2] + v[c][2]) / 2,
        ];
        const l = Math.hypot(...p);
        i = v.length;
        v.push(p.map((x) => x / l));
        mids.set(key, i);
      }
      return i;
    };
    const next = [];
    for (const [a, c, e] of faces) {
      const ab = mid(a, c);
      const bc = mid(c, e);
      const ca = mid(e, a);
      next.push([a, ab, ca], [c, bc, ab], [e, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const b = builder();
  const uvOf = (p) => [
    0.5 + Math.atan2(p[0], p[2]) / TAU,
    0.5 + Math.asin(Math.max(-1, Math.min(1, p[1]))) / Math.PI,
  ];
  for (const tri of faces) {
    const pts = tri.map((i) => v[i]);
    const uvs = pts.map(uvOf);
    const us = uvs.map((t) => t[0]);
    if (Math.max(...us) - Math.min(...us) > 0.5)
      for (const t of uvs) if (t[0] < 0.5) t[0] += 1;
    b.poly(
      pts.map((p) => p.map((x) => x * radius)),
      uvs,
      { s: smooth },
    );
  }
  return b.done();
}

function cylinder({
  radiusTop,
  radiusBottom,
  height,
  sides,
  rings,
  smooth,
  caps,
}) {
  const b = builder();
  const n = Math.max(3, Math.round(sides));
  const h = height / 2;
  const nr = Math.max(1, Math.round(rings));
  const profile = [];
  for (let i = 0; i <= nr; i++) {
    const t = i / nr;
    profile.push([
      radiusBottom + (radiusTop - radiusBottom) * t,
      -h + height * t,
    ]);
  }
  lathe(b, profile, n, [0, 0, 1, 0.5], { s: smooth });
  if (caps) {
    cap(b, -h, radiusBottom, n, [0.02, 0.52, 0.48, 0.98], false);
    cap(b, h, radiusTop, n, [0.52, 0.52, 0.98, 0.98], true);
  }
  return b.done();
}

function cone({ radius, height, sides, smooth, caps }) {
  return cylinder({
    radiusTop: 0,
    radiusBottom: radius,
    height,
    sides,
    rings: 1,
    smooth,
    caps,
  });
}

function wedge({ width, height, depth }) {
  const b = builder();
  const [w, h, d] = [width / 2, height / 2, depth / 2];
  const cell = (c, r) => [
    c / 3 + 0.005,
    r / 2 + 0.005,
    (c + 1) / 3 - 0.005,
    (r + 1) / 2 - 0.005,
  ];
  const quad = (p, r) =>
    b.poly(p, [
      [r[0], r[1]],
      [r[2], r[1]],
      [r[2], r[3]],
      [r[0], r[3]],
    ]);
  // Bottom, back and the slope, which runs from the front-bottom edge up to the back-top edge.
  quad(
    [
      [-w, -h, -d],
      [w, -h, -d],
      [w, -h, d],
      [-w, -h, d],
    ],
    cell(0, 0),
  );
  quad(
    [
      [w, -h, -d],
      [-w, -h, -d],
      [-w, h, -d],
      [w, h, -d],
    ],
    cell(1, 0),
  );
  quad(
    [
      [-w, -h, d],
      [w, -h, d],
      [w, h, -d],
      [-w, h, -d],
    ],
    cell(2, 0),
  );
  const r = cell(0, 1);
  b.poly(
    [
      [w, -h, d],
      [w, -h, -d],
      [w, h, -d],
    ],
    [
      [r[0], r[1]],
      [r[2], r[1]],
      [r[2], r[3]],
    ],
  );
  const q = cell(1, 1);
  b.poly(
    [
      [-w, -h, -d],
      [-w, -h, d],
      [-w, h, -d],
    ],
    [
      [q[0], q[1]],
      [q[2], q[1]],
      [q[0], q[3]],
    ],
  );
  return b.done();
}

function plane({ width, depth, segments }) {
  const b = builder();
  const n = Math.max(1, Math.round(segments));
  b.grid(
    [-width / 2, 0, depth / 2],
    [width, 0, 0],
    [0, 0, -depth],
    n,
    n,
    [0, 0, 1, 1],
  );
  return b.done();
}

function torus({ radius, tube, segments, sides, smooth }) {
  const b = builder();
  const ns = Math.max(3, Math.round(sides));
  const nm = Math.max(3, Math.round(segments));
  const profile = [];
  for (let i = 0; i <= ns; i++) {
    const a = (i / ns) * TAU;
    profile.push([radius - Math.cos(a) * tube, -Math.sin(a) * tube]);
  }
  lathe(b, profile, nm, [0, 0, 1, 1], { s: smooth });
  return b.done();
}

function capsule({ radius, length, sides, rings, smooth }) {
  const b = builder();
  const nr = Math.max(2, Math.round(rings));
  const h = length / 2;
  const profile = [];
  for (let i = 0; i <= nr; i++) {
    const a = (Math.PI / 2) * (i / nr);
    profile.push([Math.sin(a) * radius, -h - Math.cos(a) * radius]);
  }
  for (let i = 0; i <= nr; i++) {
    const a = (Math.PI / 2) * (i / nr);
    profile.push([Math.cos(a) * radius, h + Math.sin(a) * radius]);
  }
  lathe(b, profile, Math.max(3, Math.round(sides)), [0, 0, 1, 1], {
    s: smooth,
  });
  return b.done();
}

function pyramid({ width, height, depth }) {
  const b = builder();
  const [w, d] = [width / 2, depth / 2];
  const y0 = -height / 2;
  const top = [0, height / 2, 0];
  const base = [
    [-w, y0, d],
    [w, y0, d],
    [w, y0, -d],
    [-w, y0, -d],
  ];
  b.poly(
    [...base].reverse(),
    [
      [0, 0.5],
      [0.5, 0.5],
      [0.5, 0],
      [0, 0],
    ].reverse(),
  );
  for (let k = 0; k < 4; k++) {
    const u = 0.5 + (k % 2) * 0.25;
    const v = k < 2 ? 0 : 0.25;
    b.poly(
      [base[k], base[(k + 1) % 4], top],
      [
        [u, v],
        [u + 0.24, v],
        [u + 0.12, v + 0.24],
      ],
    );
  }
  return b.done();
}

function tube({ outer, inner, height, sides, smooth }) {
  const b = builder();
  const n = Math.max(3, Math.round(sides));
  const h = height / 2;
  const ri = Math.min(inner, outer - 1e-3);
  lathe(
    b,
    [
      [outer, -h],
      [outer, h],
    ],
    n,
    [0, 0, 1, 0.3],
    { s: smooth },
  );
  lathe(
    b,
    [
      [ri, h],
      [ri, -h],
    ],
    n,
    [0, 0.3, 1, 0.6],
    { s: smooth },
  );
  lathe(
    b,
    [
      [ri, -h],
      [outer, -h],
    ],
    n,
    [0, 0.6, 1, 0.8],
  );
  lathe(
    b,
    [
      [outer, h],
      [ri, h],
    ],
    n,
    [0, 0.8, 1, 1],
  );
  return b.done();
}

function stairs({ width, height, depth, steps }) {
  const b = builder();
  const n = Math.max(1, Math.round(steps));
  const w = width / 2;
  const sh = height / n;
  const sd = depth / n;
  const z0 = depth / 2;
  const y0 = -height / 2;
  // The side profile, in (z, y), counter-clockwise seen from +X.
  const prof = [
    [z0, y0],
    [-z0, y0],
  ];
  // Treads from the back (tallest) step down towards the front; each riser
  // is the edge to the next tread, and the last one closes at the start.
  for (let i = n; i >= 1; i--) {
    const zA = -z0 + (n - i) * sd;
    prof.push([zA, y0 + i * sh], [zA + sd, y0 + i * sh]);
  }
  const toUv = (z, y) => [
    ((z + z0) / depth) * 0.45 + 0.02,
    ((y - y0) / height) * 0.45 + 0.02,
  ];
  b.poly(
    prof.map(([z, y]) => [w, y, z]),
    prof.map(([z, y]) => toUv(z, y)),
  );
  b.poly(
    prof.map(([z, y]) => [-w, y, z]).reverse(),
    prof.map(([z, y]) => [toUv(z, y)[0] + 0.5, toUv(z, y)[1]]).reverse(),
  );
  const perim = prof.length;
  for (let k = 0; k < perim; k++) {
    const [za, ya] = prof[k];
    const [zb, yb] = prof[(k + 1) % perim];
    const u0 = 0.02 + (0.96 * k) / perim;
    const u1 = 0.02 + (0.96 * (k + 1)) / perim;
    b.poly(
      [
        [-w, ya, za],
        [-w, yb, zb],
        [w, yb, zb],
        [w, ya, za],
      ],
      [
        [u0, 0.52],
        [u1, 0.52],
        [u1, 0.98],
        [u0, 0.98],
      ],
    );
  }
  return b.done();
}

// ─── The catalogue the UI is built from ────────────────────────────────

const num = (key, label, min, max, step = 0.05) => ({
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

export const PRIMITIVES = {
  cube: {
    label: 'Cube',
    icon: 'box',
    build: cube,
    defaults: { width: 1, height: 1, depth: 1, segments: 1 },
    params: [
      num('width', 'Width', 0.01, 100),
      num('height', 'Height', 0.01, 100),
      num('depth', 'Depth', 0.01, 100),
      int('segments', 'Segments', 1, 32),
    ],
  },
  sphere: {
    label: 'Sphere',
    icon: 'circle',
    build: sphere,
    defaults: { radius: 0.5, segments: 24, rings: 14, smooth: true },
    params: [
      num('radius', 'Radius', 0.01, 100),
      int('segments', 'Segments', 3, 128),
      int('rings', 'Rings', 2, 64),
      bool('smooth', 'Smooth'),
    ],
  },
  icosphere: {
    label: 'Ico Sphere',
    icon: 'globe',
    build: icosphere,
    defaults: { radius: 0.5, detail: 2, smooth: true },
    params: [
      num('radius', 'Radius', 0.01, 100),
      int('detail', 'Detail', 0, 5),
      bool('smooth', 'Smooth'),
    ],
  },
  cylinder: {
    label: 'Cylinder',
    icon: 'cylinder',
    build: cylinder,
    defaults: {
      radiusTop: 0.5,
      radiusBottom: 0.5,
      height: 1,
      sides: 24,
      rings: 1,
      smooth: true,
      caps: true,
    },
    params: [
      num('radiusTop', 'Top radius', 0, 100),
      num('radiusBottom', 'Bottom radius', 0, 100),
      num('height', 'Height', 0.01, 100),
      int('sides', 'Sides', 3, 128),
      int('rings', 'Height segments', 1, 64),
      bool('smooth', 'Smooth'),
      bool('caps', 'Caps'),
    ],
    // "Radius" moves both ends together, the way people usually mean it.
    radius: ['radiusTop', 'radiusBottom'],
  },
  cone: {
    label: 'Cone',
    icon: 'cone',
    build: cone,
    defaults: { radius: 0.5, height: 1, sides: 24, smooth: true, caps: true },
    params: [
      num('radius', 'Radius', 0.01, 100),
      num('height', 'Height', 0.01, 100),
      int('sides', 'Sides', 3, 128),
      bool('smooth', 'Smooth'),
      bool('caps', 'Cap'),
    ],
  },
  wedge: {
    label: 'Wedge',
    icon: 'triangle-right',
    build: wedge,
    defaults: { width: 1, height: 1, depth: 1 },
    params: [
      num('width', 'Width', 0.01, 100),
      num('height', 'Height', 0.01, 100),
      num('depth', 'Depth', 0.01, 100),
    ],
  },
  plane: {
    label: 'Plane',
    icon: 'square',
    build: plane,
    defaults: { width: 2, depth: 2, segments: 1 },
    params: [
      num('width', 'Width', 0.01, 1000),
      num('depth', 'Depth', 0.01, 1000),
      int('segments', 'Subdivisions', 1, 128),
    ],
  },
  torus: {
    label: 'Torus',
    icon: 'torus',
    build: torus,
    defaults: {
      radius: 0.5,
      tube: 0.18,
      segments: 32,
      sides: 14,
      smooth: true,
    },
    params: [
      num('radius', 'Radius', 0.01, 100),
      num('tube', 'Tube radius', 0.005, 50),
      int('segments', 'Segments', 3, 128),
      int('sides', 'Sides', 3, 64),
      bool('smooth', 'Smooth'),
    ],
  },
  capsule: {
    label: 'Capsule',
    icon: 'pill',
    build: capsule,
    defaults: { radius: 0.3, length: 0.6, sides: 20, rings: 6, smooth: true },
    params: [
      num('radius', 'Radius', 0.01, 100),
      num('length', 'Length', 0, 100),
      int('sides', 'Sides', 3, 128),
      int('rings', 'Cap rings', 2, 32),
      bool('smooth', 'Smooth'),
    ],
  },
  pyramid: {
    label: 'Pyramid',
    icon: 'pyramid',
    build: pyramid,
    defaults: { width: 1, height: 1, depth: 1 },
    params: [
      num('width', 'Width', 0.01, 100),
      num('height', 'Height', 0.01, 100),
      num('depth', 'Depth', 0.01, 100),
    ],
  },
  tube: {
    label: 'Tube',
    icon: 'circle-dot',
    build: tube,
    defaults: { outer: 0.5, inner: 0.35, height: 1, sides: 24, smooth: true },
    params: [
      num('outer', 'Outer radius', 0.01, 100),
      num('inner', 'Inner radius', 0.005, 100),
      num('height', 'Height', 0.01, 100),
      int('sides', 'Sides', 3, 128),
      bool('smooth', 'Smooth'),
    ],
  },
  stairs: {
    label: 'Stairs',
    icon: 'blocks',
    build: stairs,
    defaults: { width: 1, height: 1, depth: 1, steps: 4 },
    params: [
      num('width', 'Width', 0.01, 100),
      num('height', 'Height', 0.01, 100),
      num('depth', 'Depth', 0.01, 100),
      int('steps', 'Steps', 1, 64),
    ],
  },
};

export function buildPrimitive(kind, params = {}) {
  const def = PRIMITIVES[kind];
  if (!def) throw new Error(`Unknown primitive "${kind}"`);
  return def.build({ ...def.defaults, ...params });
}
