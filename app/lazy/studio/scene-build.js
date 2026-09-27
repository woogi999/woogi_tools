// Turning 3D Studio's data into three.js objects: geometry from meshes,
// materials from PBR settings and texture sets, and the shapes that draw
// bones, controllers, lights and cameras. Shared by the viewport and the
// exporters so what you export is what you see.

import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  Vector2,
} from 'three';
import { toBuffers, OUTLINE_SLOT } from './mesh';
import { topInfluences } from './rig';

// ─── Geometry ──────────────────────────────────────────────────────────

// Slot → material index: real slots map to themselves, the outline slot
// goes after them.
export function geometryFromMesh(mesh, slotCount = 1) {
  const b = toBuffers(mesh);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(b.position, 3));
  g.setAttribute('normal', new BufferAttribute(b.normal, 3));
  g.setAttribute('uv', new BufferAttribute(b.uv, 2));
  g.setIndex(new BufferAttribute(b.index, 1));
  for (const grp of b.groups) {
    const index =
      grp.slot === OUTLINE_SLOT ? slotCount : Math.min(grp.slot, slotCount - 1);
    g.addGroup(grp.start, grp.count, index);
  }
  g.computeBoundingSphere();
  g.computeBoundingBox();
  g.userData.buffers = b;
  return g;
}

// Adds skinning attributes from a skin keyed to the mesh's vertices.
export function addSkin(geometry, skin, boneIndex) {
  const b = geometry.userData.buffers;
  const { idx, w } = topInfluences(skin, boneIndex);
  const n = b.vert.length;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const v = b.vert[i];
    for (let k = 0; k < 4; k++) {
      si[i * 4 + k] = idx[v * 4 + k];
      sw[i * 4 + k] = w[v * 4 + k];
    }
  }
  geometry.setAttribute('skinIndex', new BufferAttribute(si, 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(sw, 4));
}

// Per-vertex colours (e.g. the weight ramp) on a geometry built by geometryFromMesh.
export function setVertexColors(geometry, colorOfVertex) {
  const b = geometry.userData.buffers;
  const n = b.vert.length;
  let attr = geometry.getAttribute('color');
  if (!attr || attr.count !== n) {
    attr = new BufferAttribute(new Float32Array(n * 3), 3);
    geometry.setAttribute('color', attr);
  }
  for (let i = 0; i < n; i++) {
    const c = colorOfVertex(b.vert[i]);
    attr.array[i * 3] = c[0];
    attr.array[i * 3 + 1] = c[1];
    attr.array[i * 3 + 2] = c[2];
  }
  attr.needsUpdate = true;
}

// ─── Materials ─────────────────────────────────────────────────────────

// Standard rather than physical: every map and setting used here is in it,
// and its shader compiles several times faster.
export function makeMaterial() {
  return new MeshStandardMaterial({
    color: 0xcccccc,
    roughness: 0.5,
    metalness: 0,
  });
}

// Applies a document material (plus animated overrides and texture
// sources) to a three.js material. `maps` has canvases or images per
// channel: color, orm, height (from a texture set) or the uploaded ones.
export function applyMaterial(
  tm,
  mat,
  { overrides = null, maps = {}, version = 0, flat = false } = {},
) {
  const m = { ...mat, ...(overrides ?? {}) };
  tm.color.set(m.color);
  tm.roughness = m.rough;
  tm.metalness = m.metal;
  tm.emissive.set(m.emissive ?? '#000000');
  tm.emissiveIntensity = m.emissiveIntensity ?? 1;
  const opacity = m.opacity ?? 1;
  tm.transparent = opacity < 1;
  tm.opacity = opacity;
  tm.depthWrite = opacity >= 0.98;
  tm.side = m.doubleSided ? DoubleSide : FrontSide;
  tm.flatShading = !!flat;
  tm.aoMapIntensity = m.aoIntensity ?? 1;
  tm.bumpScale = (m.heightScale ?? 0.02) * 40;
  tm.normalScale = new Vector2(m.normalScale ?? 1, m.normalScale ?? 1);
  const layered = maps.layered;
  setMap(tm, 'map', maps.color, version, true);
  if (layered) {
    // Colour already includes the base colour; roughness and metalness
    // maps multiply the scalars, so those go to 1.
    tm.color.set('#ffffff');
    tm.roughness = 1;
    tm.metalness = 1;
    setMap(tm, 'roughnessMap', maps.orm, version);
    setMap(tm, 'metalnessMap', maps.orm, version);
    setMap(tm, 'aoMap', maps.ao ?? (maps.bakedAO ? maps.orm : null), version);
  } else {
    setMap(tm, 'roughnessMap', maps.rough, version);
    setMap(tm, 'metalnessMap', maps.metal, version);
    setMap(tm, 'aoMap', maps.ao, version);
  }
  setMap(tm, 'bumpMap', maps.height, version);
  setMap(tm, 'normalMap', maps.normal, version);
  setMap(tm, 'emissiveMap', maps.emissive, version, true);
  setMap(tm, 'alphaMap', maps.opacity, version);
  if (maps.opacity) tm.transparent = true;
  tm.needsUpdate = true;
}

function setMap(tm, slot, source, version, srgb = false) {
  if (!source) {
    if (tm[slot]) {
      tm[slot] = null;
      tm.needsUpdate = true;
    }
    return;
  }
  let tex = tm[slot];
  if (!tex || tex.image !== source) {
    tex =
      source instanceof HTMLCanvasElement
        ? new CanvasTexture(source)
        : new Texture(source);
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.anisotropy = 4;
    if (srgb) tex.colorSpace = SRGBColorSpace;
    tex.userData.version = -1;
    tm[slot] = tex;
  }
  if (tex.userData.version !== version) {
    tex.needsUpdate = true;
    tex.userData.version = version;
  }
}

export function outlineMaterial(color = '#111111') {
  return new MeshBasicMaterial({ color: new Color(color), side: FrontSide });
}

export const cutterMaterial = () =>
  new MeshBasicMaterial({
    color: 0x66b3ff,
    wireframe: true,
    transparent: true,
    opacity: 0.55,
    depthTest: true,
  });

// ─── Shapes ────────────────────────────────────────────────────────────

// Blender's octahedral bone, one unit long up +Y.
export function boneGeometry() {
  const w = 0.1;
  const r = 0.12;
  const pts = [
    [0, 0, 0],
    [w * r * 10, r, w * r * 10],
    [-w * r * 10, r, w * r * 10],
    [-w * r * 10, r, -w * r * 10],
    [w * r * 10, r, -w * r * 10],
    [0, 1, 0],
  ];
  const tris = [
    [0, 2, 1],
    [0, 3, 2],
    [0, 4, 3],
    [0, 1, 4],
    [5, 1, 2],
    [5, 2, 3],
    [5, 3, 4],
    [5, 4, 1],
  ];
  const pos = [];
  for (const t of tris) for (const i of t) pos.push(...pts[i]);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function circle(n, r, axis = 'y') {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const p = (a) =>
      axis === 'y'
        ? [Math.cos(a) * r, 0, Math.sin(a) * r]
        : axis === 'x'
          ? [0, Math.cos(a) * r, Math.sin(a) * r]
          : [Math.cos(a) * r, Math.sin(a) * r, 0];
    out.push(...p(a0), ...p(a1));
  }
  return out;
}

// Line shapes for controllers.
export function controlGeometry(shape, size = 0.3) {
  const s = size;
  let pos = [];
  if (shape === 'circle') pos = circle(32, s);
  else if (shape === 'square') {
    const c = [
      [-s, 0, -s],
      [s, 0, -s],
      [s, 0, s],
      [-s, 0, s],
    ];
    for (let i = 0; i < 4; i++) pos.push(...c[i], ...c[(i + 1) % 4]);
  } else if (shape === 'diamond') {
    const p = [
      [s, 0, 0],
      [0, s, 0],
      [-s, 0, 0],
      [0, -s, 0],
      [0, 0, s],
      [0, 0, -s],
    ];
    const edges = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 0],
      [4, 1],
      [4, 2],
      [4, 3],
      [5, 0],
      [5, 1],
      [5, 2],
      [5, 3],
    ];
    for (const [a, b] of edges) pos.push(...p[a], ...p[b]);
  } else if (shape === 'cube') {
    const c = [];
    for (const x of [-s, s])
      for (const y of [-s, s]) for (const z of [-s, s]) c.push([x, y, z]);
    const edges = [
      [0, 1],
      [2, 3],
      [4, 5],
      [6, 7],
      [0, 2],
      [1, 3],
      [4, 6],
      [5, 7],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ];
    for (const [a, b] of edges) pos.push(...c[a], ...c[b]);
  } else if (shape === 'sphere')
    pos = [...circle(24, s, 'y'), ...circle(24, s, 'x'), ...circle(24, s, 'z')];
  else if (shape === 'arrow') {
    pos = [
      0,
      0,
      -s,
      0,
      0,
      s,
      0,
      0,
      s,
      s * 0.4,
      0,
      s * 0.5,
      0,
      0,
      s,
      -s * 0.4,
      0,
      s * 0.5,
    ];
  } else if (shape === 'cross')
    pos = [-s, 0, 0, s, 0, 0, 0, -s, 0, 0, s, 0, 0, 0, -s, 0, 0, s];
  else pos = circle(32, s);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

export const CONTROL_SHAPES = [
  'circle',
  'square',
  'diamond',
  'cube',
  'sphere',
  'arrow',
  'cross',
];

export function lineObject(positions, color) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return new LineSegments(
    g,
    new LineBasicMaterial({ color, transparent: true, opacity: 0.9 }),
  );
}

// A small lamp or camera drawn in lines, and an invisible body to click.
export function lightGizmo(kind) {
  const pos = [
    ...circle(16, 0.15, 'y'),
    ...circle(16, 0.15, 'x'),
    ...circle(16, 0.15, 'z'),
  ];
  if (kind === 'directional' || kind === 'spot') pos.push(0, 0, 0, 0, 0, -0.8);
  return lineObject(pos, 0xffd23c);
}

export function cameraGizmo(fov = 50, aspect = 1.6) {
  const d = 0.6;
  const h = Math.tan((fov * Math.PI) / 360) * d;
  const w = h * aspect;
  const c = [
    [-w, -h, -d],
    [w, -h, -d],
    [w, h, -d],
    [-w, h, -d],
  ];
  const pos = [];
  for (let i = 0; i < 4; i++)
    pos.push(0, 0, 0, ...c[i], ...c[i], ...c[(i + 1) % 4]);
  pos.push(
    -w * 0.4,
    h * 1.1,
    -d,
    w * 0.4,
    h * 1.1,
    -d,
    w * 0.4,
    h * 1.1,
    -d,
    0,
    h * 1.5,
    -d,
    0,
    h * 1.5,
    -d,
    -w * 0.4,
    h * 1.1,
    -d,
  );
  return lineObject(pos, 0xb0b8c8);
}

export function pickBody(radius = 0.25) {
  const g = new BufferGeometry();
  // An octahedron is enough to click on.
  const r = radius;
  const p = [
    [r, 0, 0],
    [-r, 0, 0],
    [0, r, 0],
    [0, -r, 0],
    [0, 0, r],
    [0, 0, -r],
  ];
  const tris = [
    [0, 2, 4],
    [2, 1, 4],
    [1, 3, 4],
    [3, 0, 4],
    [2, 0, 5],
    [1, 2, 5],
    [3, 1, 5],
    [0, 3, 5],
  ];
  const pos = [];
  for (const t of tris) for (const i of t) pos.push(...p[i]);
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return new Mesh(
    g,
    new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
}
