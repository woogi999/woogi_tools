// Bringing models in: GLB/glTF, OBJ and STL become editable meshes (welded,
// with their UVs, material slots and shading), one scene object each, with
// their own transforms.

import { Matrix4, Vector3, Quaternion, Euler } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { weld } from './mesh';

const RAD = Math.PI / 180;

// BufferGeometry → studio mesh. Triangles whose corner normals all match
// the face are flat-shaded, the rest smooth.
export function fromGeometry(g) {
  const pos = g.getAttribute('position');
  if (!pos) return { v: [], f: [] };
  const uv = g.getAttribute('uv');
  const nrm = g.getAttribute('normal');
  const index = g.index;
  const v = [];
  for (let i = 0; i < pos.count; i++)
    v.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
  const count = index ? index.count : pos.count;
  const at = (k) => (index ? index.getX(k) : k);
  const slotOf = (k) => {
    for (let gi = 0; gi < g.groups.length; gi++) {
      const grp = g.groups[gi];
      if (k >= grp.start && k < grp.start + grp.count)
        return grp.materialIndex ?? gi;
    }
    return 0;
  };
  const f = [];
  for (let k = 0; k + 2 < count; k += 3) {
    const ids = [at(k), at(k + 1), at(k + 2)];
    let smooth = true;
    if (nrm) {
      const a = new Vector3(...v[ids[0]]);
      const n = new Vector3(...v[ids[1]])
        .sub(a)
        .cross(new Vector3(...v[ids[2]]).sub(a))
        .normalize();
      smooth = ids.some(
        (i) =>
          Math.abs(nrm.getX(i) * n.x + nrm.getY(i) * n.y + nrm.getZ(i) * n.z) <
          0.999,
      );
    }
    f.push({
      v: ids,
      uv: ids.map((i) => (uv ? [uv.getX(i), uv.getY(i)] : [0, 0])),
      m: slotOf(k),
      s: smooth,
    });
  }
  return weld({ v, f }, 1e-6);
}

function trs(m) {
  const p = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  m.decompose(p, q, s);
  const e = new Euler().setFromQuaternion(q, 'XYZ');
  return {
    pos: p.toArray(),
    rot: [e.x / RAD, e.y / RAD, e.z / RAD],
    scl: s.toArray(),
  };
}

function collect(root) {
  root.updateMatrixWorld(true);
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const mesh = fromGeometry(o.geometry);
    if (!mesh.f.length) return;
    const mats = (Array.isArray(o.material) ? o.material : [o.material]).map(
      (m) => ({
        name: m?.name || 'Imported',
        color: m?.color ? `#${m.color.getHexString()}` : '#c8ccd4',
        rough: m?.roughness ?? 0.6,
        metal: m?.metalness ?? 0,
      }),
    );
    out.push({
      name: o.name || 'Imported',
      mesh,
      ...trs(o.matrixWorld),
      materials: mats,
    });
  });
  return out;
}

export async function importModel(file) {
  const name = file.name.replace(/\.[^.]+$/, '');
  if (/\.(glb|gltf)$/i.test(file.name)) {
    const data = /\.glb$/i.test(file.name)
      ? await file.arrayBuffer()
      : await file.text();
    const gltf = await new Promise((resolve, reject) =>
      new GLTFLoader().parse(data, '', resolve, reject),
    );
    return collect(gltf.scene);
  }
  if (/\.obj$/i.test(file.name))
    return collect(new OBJLoader().parse(await file.text()));
  if (/\.stl$/i.test(file.name)) {
    const g = new STLLoader().parse(await file.arrayBuffer());
    return [
      {
        name,
        mesh: fromGeometry(g),
        ...trs(new Matrix4()),
        materials: [{ name, color: '#c8ccd4', rough: 0.6, metal: 0 }],
      },
    ];
  }
  throw new Error('3D Studio can import GLB, glTF, OBJ and STL files.');
}
