// Turns objects into meshes, rebuilding only what changed.
//
// An object's mesh depends on its own recipe and modifiers (its `geo`
// revision) and, through booleans and linked outlines, on other objects'
// meshes and where they sit relative to it. That is exactly the cache key:
// moving a cutter re-runs the boolean it feeds, moving the whole model
// doesn't, and changing a material or a pose touches no geometry at all.

import { Matrix4, Vector3 } from 'three';
import { buildPrimitive } from './primitives';
import { applyStack } from './modifiers';
import { outlineShell, flip } from './mesh';
import { worldMatrix } from './doc';

const IDENTITY = new Matrix4();

export function transformMesh(m, matrix) {
  if (matrix.equals(IDENTITY)) return m;
  const e = matrix.elements;
  const v = m.v.map(([x, y, z]) => [
    e[0] * x + e[4] * y + e[8] * z + e[12],
    e[1] * x + e[5] * y + e[9] * z + e[13],
    e[2] * x + e[6] * y + e[10] * z + e[14],
  ]);
  const out = { v, f: m.f };
  return matrix.determinant() < 0 ? flip(out) : out;
}

const matKey = (m) => m.elements.map((x) => Math.round(x * 1e5)).join(',');

export class Evaluator {
  cache = new Map();
  prims = new WeakMap();
  errors = new Map();

  relative(doc, from, to) {
    return worldMatrix(doc, from).invert().multiply(worldMatrix(doc, to));
  }

  key(doc, id, seen = new Set()) {
    const o = doc.objects[id];
    if (!o || o.type !== 'mesh') return 'none';
    if (seen.has(id)) return 'cycle';
    seen.add(id);
    let k = `${id}:${o.geo ?? 0}`;
    if (o.source?.kind === 'outline') {
      const of = o.source.of;
      k += `<${this.key(doc, of, seen)}@${matKey(this.relative(doc, id, of))}>`;
    }
    for (const mod of o.stack ?? [])
      if (mod.on && mod.type === 'boolean' && mod.params.operand) {
        const op = mod.params.operand;
        k += `[${this.key(doc, op, seen)}@${matKey(this.relative(doc, id, op))}]`;
      }
    seen.delete(id);
    return k;
  }

  // The source before any modifiers: what edit mode and sculpting work on.
  base(doc, id) {
    const o = doc.objects[id];
    if (!o || o.type !== 'mesh') return { v: [], f: [] };
    const src = o.source;
    if (src?.kind === 'mesh') return src.mesh;
    if (src?.kind === 'primitive') {
      let m = this.prims.get(src);
      if (!m) {
        m = buildPrimitive(src.prim, src.params);
        this.prims.set(src, m);
      }
      return m;
    }
    if (src?.kind === 'outline') {
      const target = this.mesh(doc, src.of, new Set([id]));
      const local = transformMesh(target, this.relative(doc, id, src.of));
      const shell = outlineShell(local, src.thickness ?? 0.03, {
        smoothness: src.smoothness ?? 0,
        slot: 0,
      });
      return src.invert === false ? flip(shell) : shell;
    }
    return { v: [], f: [] };
  }

  mesh(doc, id, seen = new Set()) {
    const o = doc.objects[id];
    if (!o || o.type !== 'mesh' || seen.has(id)) return { v: [], f: [] };
    const key = this.key(doc, id);
    const hit = this.cache.get(id);
    if (hit && hit.key === key) return hit.mesh;
    seen.add(id);
    this.errors.delete(id);
    const mesh = applyStack(this.base(doc, id), o.stack, {
      operand: (op) => {
        if (!doc.objects[op] || seen.has(op)) return null;
        return transformMesh(
          this.mesh(doc, op, seen),
          this.relative(doc, id, op),
        );
      },
      onError: (mod, error) =>
        this.errors.set(id, `${mod.type}: ${error.message}`),
    });
    seen.delete(id);
    this.cache.set(id, { key, mesh });
    return mesh;
  }

  // Objects used as boolean cutters, which are drawn as wireframes (or not at all).
  cutters(doc) {
    const out = new Map();
    for (const o of Object.values(doc.objects))
      for (const mod of o.stack ?? [])
        if (mod.type === 'boolean' && mod.params.operand)
          out.set(mod.params.operand, mod.on && mod.params.show !== false);
    return out;
  }

  prune(doc) {
    for (const id of this.cache.keys())
      if (!doc.objects[id]) this.cache.delete(id);
  }
}

// World-space bounds of a mesh under a matrix.
export function worldBounds(mesh, matrix) {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const p = new Vector3();
  for (const v of mesh.v) {
    p.set(v[0], v[1], v[2]).applyMatrix4(matrix);
    min.min(p);
    max.max(p);
  }
  return { min, max, empty: !mesh.v.length };
}
