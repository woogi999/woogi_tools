// The scene document. It is plain data, and it is never changed in place:
// every edit makes a new document that shares everything it didn't touch
// with the old one. That makes undo a list of old documents, and lets the
// renderer and the mesh cache see what changed by comparing references.
//
//   doc.objects    id → object (mesh, group, armature, camera, light, control)
//   doc.roots      top-level object ids, in outliner order
//   doc.materials  id → PBR material with its texture layers
//   doc.clips      id → animation clip
//
// Model data (recipes and stacks), geometry (evaluate.js), UVs, materials,
// textures (the pixel store, outside the document), rigs and animation are
// kept apart and joined only by ids.

import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { newModifier } from './modifiers';

const RAD = Math.PI / 180;
let seq = 0;
export const newId = (prefix = 'o') =>
  `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const DEFAULT_MATERIAL = {
  name: 'Material',
  color: '#c8ccd4',
  rough: 0.55,
  metal: 0,
  emissive: '#000000',
  emissiveIntensity: 1,
  opacity: 1,
  normalScale: 1,
  aoIntensity: 1,
  heightScale: 0.02,
  doubleSided: false,
  flat: false,
  maps: {},
  layers: [],
  texSize: 1024,
  outline: '#111111',
};

export function newMaterial(props = {}) {
  return { ...structuredClone(DEFAULT_MATERIAL), id: newId('mat'), ...props };
}

export function newDoc() {
  let doc = {
    version: 1,
    name: 'Untitled',
    objects: {},
    roots: [],
    materials: {},
    materialOrder: [],
    textures: {},
    clips: {},
    clipOrder: [],
    poses: [],
    activeClip: null,
    fps: 24,
  };
  const mat = newMaterial({ name: 'Default' });
  doc = addMaterial(doc, mat);
  return doc;
}

// A new scene with something to look at: a cube on the grid and a sun.
export function starterDoc() {
  let doc = newDoc();
  const mat = doc.materialOrder[0];
  [doc] = createObject(doc, 'mesh', {
    name: 'Cube',
    source: { kind: 'primitive', prim: 'cube', params: {} },
    pos: [0, 0.5, 0],
    materials: [mat],
  });
  [doc] = createObject(doc, 'light', {
    name: 'Sun',
    ...aim([4, 6, 3], [0, 0, 0]),
    light: {
      kind: 'directional',
      color: '#ffffff',
      intensity: 2.2,
      range: 0,
      angle: 30,
      shadows: true,
    },
  });
  [doc] = createObject(doc, 'camera', {
    name: 'Camera',
    camera: { fov: 50, near: 0.05, far: 500 },
    ...aim([-4.5, 2.6, 4.5], [0, 0.5, 0]),
  });
  return doc;
}

const BASE = {
  mesh: () => ({
    source: { kind: 'primitive', prim: 'cube', params: {} },
    stack: [],
    materials: [],
    skin: null,
    geo: 0,
  }),
  group: () => ({}),
  empty: () => ({}),
  armature: () => ({ bones: [], pose: {}, geo: 0, showNames: false }),
  camera: () => ({ camera: { fov: 50, near: 0.05, far: 500 } }),
  light: () => ({
    light: {
      kind: 'point',
      color: '#ffffff',
      intensity: 20,
      range: 0,
      angle: 30,
      shadows: false,
    },
  }),
  control: () => ({
    control: { shape: 'circle', size: 0.3, color: '#ff9a3c', role: null },
  }),
};

export function createObject(doc, type, props = {}, parent = null) {
  const id = props.id ?? newId(type === 'mesh' ? 'm' : type[0]);
  const obj = {
    id,
    name: props.name ?? type[0].toUpperCase() + type.slice(1),
    type,
    parent,
    children: [],
    pos: [0, 0, 0],
    rot: [0, 0, 0],
    scl: [1, 1, 1],
    visible: true,
    locked: false,
    ...BASE[type](),
    ...props,
  };
  obj.id = id;
  obj.parent = parent;
  obj.name = uniqueName(doc, obj.name);
  if (type === 'mesh' && !obj.materials.length && doc.materialOrder[0])
    obj.materials = [doc.materialOrder[0]];
  let next = { ...doc, objects: { ...doc.objects, [id]: obj } };
  next = parent
    ? {
        ...next,
        objects: {
          ...next.objects,
          [parent]: {
            ...next.objects[parent],
            children: [...next.objects[parent].children, id],
          },
        },
      }
    : { ...next, roots: [...next.roots, id] };
  return [next, id];
}

export function uniqueName(doc, name, except = null) {
  const taken = new Set(
    Object.values(doc.objects)
      .filter((o) => o.id !== except)
      .map((o) => o.name),
  );
  if (!taken.has(name)) return name;
  const base = name.replace(/\.\d+$/, '');
  for (let i = 1; ; i++) {
    const n = `${base}.${String(i).padStart(3, '0')}`;
    if (!taken.has(n)) return n;
  }
}

// Changing an object's source or modifiers bumps its geometry revision,
// which is what the mesh cache keys on.
export function updateObject(doc, id, patch) {
  const obj = doc.objects[id];
  if (!obj) return doc;
  const next = { ...obj, ...patch };
  if ('source' in patch || 'stack' in patch || 'bones' in patch)
    next.geo = (obj.geo ?? 0) + 1;
  return { ...doc, objects: { ...doc.objects, [id]: next } };
}

export function updateObjects(doc, patches) {
  let out = doc;
  for (const [id, patch] of patches) out = updateObject(out, id, patch);
  return out;
}

export function addMaterial(doc, mat) {
  return {
    ...doc,
    materials: { ...doc.materials, [mat.id]: mat },
    materialOrder: [...doc.materialOrder, mat.id],
  };
}

export function updateMaterial(doc, id, patch) {
  const mat = doc.materials[id];
  if (!mat) return doc;
  return {
    ...doc,
    materials: { ...doc.materials, [id]: { ...mat, ...patch } },
  };
}

// ─── The tree ──────────────────────────────────────────────────────────

export function descendants(doc, id) {
  const out = [];
  const stack = [...(doc.objects[id]?.children ?? [])];
  while (stack.length) {
    const c = stack.pop();
    out.push(c);
    stack.push(...(doc.objects[c]?.children ?? []));
  }
  return out;
}

export function ancestors(doc, id) {
  const out = [];
  let p = doc.objects[id]?.parent;
  while (p) {
    out.push(p);
    p = doc.objects[p]?.parent;
  }
  return out;
}

// Depth-first, in outliner order.
export function walk(doc, fn) {
  const visit = (id, depth) => {
    const o = doc.objects[id];
    if (!o) return;
    fn(o, depth);
    for (const c of o.children) visit(c, depth + 1);
  };
  for (const id of doc.roots) visit(id, 0);
}

function detach(doc, id) {
  const obj = doc.objects[id];
  if (!obj) return doc;
  if (obj.parent) {
    const p = doc.objects[obj.parent];
    return {
      ...doc,
      objects: {
        ...doc.objects,
        [p.id]: { ...p, children: p.children.filter((c) => c !== id) },
      },
    };
  }
  return { ...doc, roots: doc.roots.filter((r) => r !== id) };
}

// Moves an object under a new parent (null for the top level) at `index`,
// keeping where it is in the world, as Blender and Roblox Studio both do.
export function reparent(
  doc,
  id,
  parent,
  index = -1,
  { keepWorld = true } = {},
) {
  if (id === parent || (parent && ancestors(doc, parent).includes(id)))
    return doc;
  const obj = doc.objects[id];
  if (!obj) return doc;
  let world = keepWorld ? worldMatrix(doc, id) : null;
  let next = detach(doc, id);
  const insert = (list) => {
    const out = [...list];
    out.splice(index < 0 || index > out.length ? out.length : index, 0, id);
    return out;
  };
  if (parent) {
    const p = next.objects[parent];
    next = {
      ...next,
      objects: {
        ...next.objects,
        [parent]: { ...p, children: insert(p.children) },
      },
    };
  } else next = { ...next, roots: insert(next.roots) };
  let patch = { parent };
  if (world) {
    const parentWorld = parent ? worldMatrix(next, parent) : new Matrix4();
    const local = parentWorld.invert().multiply(world);
    patch = { ...patch, ...trsOf(local) };
  }
  return updateObject(next, id, patch);
}

export function removeObjects(doc, ids) {
  const gone = new Set();
  for (const id of ids) {
    if (!doc.objects[id]) continue;
    gone.add(id);
    for (const d of descendants(doc, id)) gone.add(d);
  }
  let next = doc;
  for (const id of gone)
    if (!gone.has(doc.objects[id].parent)) next = detach(next, id);
  const objects = { ...next.objects };
  for (const id of gone) delete objects[id];
  // Drop references to what was removed.
  for (const [id, o] of Object.entries(objects)) {
    let patch = null;
    if (
      o.stack?.some((m) => m.type === 'boolean' && gone.has(m.params.operand))
    )
      patch = {
        ...patch,
        stack: o.stack.map((m) =>
          m.type === 'boolean' && gone.has(m.params.operand)
            ? { ...m, params: { ...m.params, operand: null } }
            : m,
        ),
      };
    if (o.source?.kind === 'outline' && gone.has(o.source.of))
      patch = { ...patch, visible: false };
    if (o.skin && gone.has(o.skin.armature)) patch = { ...patch, skin: null };
    if (patch) objects[id] = { ...o, ...patch, geo: (o.geo ?? 0) + 1 };
  }
  return { ...next, objects };
}

// Copies objects (and their children); returns the new document and the copies' ids.
export function duplicate(doc, ids) {
  let next = doc;
  const made = [];
  const map = new Map();
  const top = ids.filter(
    (id) => !ancestors(doc, id).some((a) => ids.includes(a)),
  );
  const copy = (id, parent) => {
    const src = doc.objects[id];
    const rest = { ...src };
    delete rest.id;
    delete rest.children;
    delete rest.parent;
    let copyId;
    [next, copyId] = createObject(
      next,
      src.type,
      { ...structuredClone(rest), name: src.name },
      parent,
    );
    map.set(id, copyId);
    for (const c of src.children) copy(c, copyId);
    return copyId;
  };
  for (const id of top) made.push(copy(id, doc.objects[id].parent));
  // Copies point at each other's copies (a cutter, an outline's source), not the originals.
  for (const copyId of map.values()) {
    const o = next.objects[copyId];
    const patch = {};
    if (o.stack?.some((m) => map.has(m.params?.operand)))
      patch.stack = o.stack.map((m) =>
        map.has(m.params?.operand)
          ? {
              ...m,
              params: { ...m.params, operand: map.get(m.params.operand) },
            }
          : m,
      );
    if (o.source?.kind === 'outline' && map.has(o.source.of))
      patch.source = { ...o.source, of: map.get(o.source.of) };
    if (o.skin && map.has(o.skin.armature))
      patch.skin = { ...o.skin, armature: map.get(o.skin.armature) };
    if (Object.keys(patch).length) next = updateObject(next, copyId, patch);
  }
  return [next, made];
}

// ─── Transforms ────────────────────────────────────────────────────────

const _e = new Euler();
const _q = new Quaternion();

export function localMatrix(o, override) {
  const pos = override?.pos ?? o.pos;
  const rot = override?.rot ?? o.rot;
  const scl = override?.scl ?? o.scl;
  _e.set(rot[0] * RAD, rot[1] * RAD, rot[2] * RAD, 'XYZ');
  _q.setFromEuler(_e);
  return new Matrix4().compose(
    new Vector3(...pos),
    _q.clone(),
    new Vector3(...scl),
  );
}

// `overrides` (id → { pos, rot, scl }) lets animation playback be seen
// without writing it into the document.
export function worldMatrix(doc, id, overrides = null) {
  const chain = [];
  let cur = doc.objects[id];
  while (cur) {
    chain.push(cur);
    cur = cur.parent ? doc.objects[cur.parent] : null;
  }
  const m = new Matrix4();
  for (let i = chain.length - 1; i >= 0; i--)
    m.multiply(localMatrix(chain[i], overrides?.[chain[i].id]));
  return m;
}

export function trsOf(matrix) {
  const p = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  matrix.decompose(p, q, s);
  const e = new Euler().setFromQuaternion(q, 'XYZ');
  const r = (x) => Math.round(x * 1e5) / 1e5;
  return {
    pos: [r(p.x), r(p.y), r(p.z)],
    rot: [r(e.x / RAD), r(e.y / RAD), r(e.z / RAD)],
    scl: [r(s.x), r(s.y), r(s.z)],
  };
}

// Position and rotation for something at `eye` facing `target` (cameras
// and lights look down their −Z).
export function aim(eye, target) {
  const m = new Matrix4().lookAt(
    new Vector3(...eye),
    new Vector3(...target),
    new Vector3(0, 1, 0),
  );
  m.setPosition(...eye);
  const { pos, rot } = trsOf(m);
  return { pos, rot };
}

// ─── Convenience makers ────────────────────────────────────────────────

export function addPrimitive(doc, prim, params = {}, props = {}) {
  return createObject(
    doc,
    'mesh',
    {
      name: props.name ?? prim[0].toUpperCase() + prim.slice(1),
      source: { kind: 'primitive', prim, params },
      ...props,
    },
    props.parent ?? null,
  );
}

// Adds a boolean modifier to `target` that uses a new primitive as its
// cutter. The cutter becomes the target's child so it moves with it.
export function addBoolean(doc, target, op, prim = 'cylinder', params = {}) {
  const t = doc.objects[target];
  const [d1, cutter] = createObject(
    doc,
    'mesh',
    {
      name: `${op[0].toUpperCase() + op.slice(1)} ${prim}`,
      source: { kind: 'primitive', prim, params },
      pos: [0.35, 0.35, 0.35],
      scl: [0.6, 1.4, 0.6],
      materials: [...(t.materials ?? [])],
      cutter: true,
    },
    target,
  );
  const mod = newModifier('boolean', { op, operand: cutter });
  return [
    updateObject(d1, target, { stack: [...(t.stack ?? []), mod] }),
    cutter,
    mod.id,
  ];
}

// A linked outline: its own object (so it can have its own colour and be
// hidden separately), whose mesh follows the source object's.
export function addOutline(
  doc,
  target,
  { thickness = 0.03, smoothness = 1, color = '#111111' } = {},
) {
  const t = doc.objects[target];
  let next = doc;
  const mat = newMaterial({
    name: `${t.name} outline`,
    color,
    rough: 1,
    outlineOnly: true,
  });
  next = addMaterial(next, mat);
  return createObject(
    next,
    'mesh',
    {
      name: `${t.name} Outline`,
      source: {
        kind: 'outline',
        of: target,
        thickness,
        smoothness,
        invert: true,
      },
      materials: [mat.id],
    },
    target,
  );
}
