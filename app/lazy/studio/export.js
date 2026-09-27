// Exporters. Each one is an entry in EXPORTERS with a label, a file
// extension and a `run(ctx, options)` that resolves to a Blob, so adding a
// format is adding an entry. They all start from the same export scene,
// built from the document the way the viewport builds it, minus the
// editor's helpers.
//
// Rigs export as skinned meshes with their skeleton; animation clips are
// sampled every frame with constraints (IK included) solved, so the file
// plays back exactly what the timeline showed, in any program.

import {
  AnimationClip,
  Bone,
  Group,
  Euler,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  QuaternionKeyframeTrack,
  Scene,
  Skeleton,
  SkinnedMesh,
  Vector3,
  Quaternion,
  VectorKeyframeTrack,
  CanvasTexture,
  SRGBColorSpace,
  Texture,
  Color,
} from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { zipSync, strToU8 } from 'fflate';
import { geometryFromMesh, addSkin } from './scene-build';
import { evaluateClip, mergePose } from './anim';
import { solvePose, remapSkin, restMatrix, sortBones } from './rig';
import { worldMatrix } from './doc';

const RAD = Math.PI / 180;

const safe = (name) => String(name).replace(/[^\w.-]+/g, '_') || 'item';

// ─── The export scene ──────────────────────────────────────────────────

function exportMaterial(mat, ctx) {
  const m = new MeshStandardMaterial({
    name: mat.name,
    color: new Color(mat.color),
    roughness: mat.rough,
    metalness: mat.metal,
    emissive: new Color(mat.emissive ?? '#000000'),
    emissiveIntensity: mat.emissiveIntensity ?? 1,
    transparent: (mat.opacity ?? 1) < 1,
    opacity: mat.opacity ?? 1,
    side: mat.doubleSided ? 2 : 0,
  });
  const set = mat.layers?.length ? ctx.textures.get(mat.id) : null;
  const tex = (src, srgb = false) => {
    if (!src) return null;
    const t =
      src instanceof HTMLCanvasElement
        ? new CanvasTexture(src)
        : new Texture(src);
    if (srgb) t.colorSpace = SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  const img = (id) => (id ? (ctx.images.get(id) ?? null) : null);
  if (set?.map) {
    m.color.set('#ffffff');
    m.roughness = 1;
    m.metalness = 1;
    m.map = tex(set.canvases.color, true);
    const orm = tex(set.canvases.orm);
    m.roughnessMap = orm;
    m.metalnessMap = orm;
    if (set.bakedAO) m.aoMap = orm;
  } else {
    m.map = tex(img(mat.maps?.color), true);
    m.roughnessMap = tex(img(mat.maps?.rough));
    m.metalnessMap = tex(img(mat.maps?.metal));
    m.aoMap = tex(img(mat.maps?.ao));
  }
  m.normalMap = tex(img(mat.maps?.normal));
  m.emissiveMap = tex(img(mat.maps?.emissive), true);
  return m;
}

// Builds a clean three.js scene of the document (visible objects, not
// cutters or helpers). Returns the scene and lookups for animation.
export function buildExportScene(
  ctx,
  { selectedOnly = null, applyTransforms = false } = {},
) {
  const { doc, evaluator } = ctx;
  const scene = new Scene();
  const nodes = new Map();
  const bones = new Map(); // armatureId → Map(boneId → Bone)
  const cutters = evaluator.cutters(doc);
  const materials = new Map();
  const matFor = (id) => {
    if (!materials.has(id))
      materials.set(id, exportMaterial(doc.materials[id], ctx));
    return materials.get(id);
  };
  const include = (o) => {
    if (o.visible === false || cutters.has(o.id)) return false;
    if (!selectedOnly) return true;
    return (
      selectedOnly.has(o.id) ||
      [...selectedOnly].some((s) => isAncestor(doc, s, o.id))
    );
  };
  const make = (o, parent) => {
    let node;
    if (o.type === 'mesh') {
      if (!include(o)) return;
      const mesh = evaluator.mesh(doc, o.id);
      if (!mesh.f.length) return;
      const matIds = o.materials?.length ? o.materials : [doc.materialOrder[0]];
      const geometry = geometryFromMesh(mesh, matIds.length);
      const mats = matIds.map(matFor);
      mats.push(
        new MeshStandardMaterial({
          name: `${o.name} outline`,
          color: new Color(doc.materials[matIds[0]]?.outline ?? '#111111'),
        }),
      );
      const arm = o.skin?.armature ? doc.objects[o.skin.armature] : null;
      if (arm?.bones?.length) {
        const skin = remapSkin(o.skin, mesh);
        addSkin(geometry, skin, new Map(arm.bones.map((b, i) => [b.name, i])));
        node = new SkinnedMesh(geometry, mats);
        node.userData.armature = arm.id;
      } else node = new Mesh(geometry, mats);
      // One material means no groups; glTF prefers that.
      if (!geometry.groups.some((g) => g.materialIndex > 0)) {
        geometry.clearGroups();
        node.material = mats[0];
      }
    } else if (o.type === 'armature') {
      node = new Object3D();
      const map = new Map();
      for (const b of sortBones(o.bones)) {
        const tb = new Bone();
        tb.name = b.name;
        map.set(b.id, tb);
      }
      const rest = new Map(o.bones.map((b) => [b.id, restMatrix(b)]));
      for (const b of o.bones) {
        const tb = map.get(b.id);
        const m = rest.get(b.id);
        const parentRest = b.parent ? rest.get(b.parent) : null;
        (parentRest
          ? parentRest.clone().invert().multiply(m)
          : m.clone()
        ).decompose(tb.position, tb.quaternion, tb.scale);
        (b.parent && map.has(b.parent) ? map.get(b.parent) : node).add(tb);
      }
      bones.set(o.id, map);
    } else if (o.type === 'group' || o.type === 'empty') node = new Group();
    else return; // controllers, lights and cameras are editor things here
    node.name = o.name;
    if (applyTransforms && o.type === 'mesh') {
      node.matrixAutoUpdate = false;
      node.matrix.copy(worldMatrix(doc, o.id));
      scene.add(node);
    } else {
      node.position.set(...o.pos);
      node.rotation.set(o.rot[0] * RAD, o.rot[1] * RAD, o.rot[2] * RAD, 'XYZ');
      node.scale.set(...o.scl);
      parent.add(node);
    }
    nodes.set(o.id, node);
    for (const c of o.children)
      make(doc.objects[c], applyTransforms ? scene : node);
  };
  for (const id of doc.roots) make(doc.objects[id], scene);
  scene.updateMatrixWorld(true);
  // Bind skinned meshes to their armature's bones at rest.
  scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const map = bones.get(o.userData.armature);
    const arm = doc.objects[o.userData.armature];
    if (!map) return;
    const skeleton = new Skeleton(arm.bones.map((b) => map.get(b.id)));
    o.bind(skeleton, o.matrixWorld.clone());
  });
  return { scene, nodes, bones };
}

// Samples clips into three.js AnimationClips (one key per frame).
export function bakeClips(ctx, built, clipIds) {
  const { doc } = ctx;
  const fps = doc.fps || 24;
  const out = [];
  for (const cid of clipIds) {
    const clip = doc.clips[cid];
    if (!clip) continue;
    const frames = [];
    for (let f = clip.start; f <= clip.end; f++) frames.push(f);
    const times = frames.map((f) => (f - clip.start) / fps);
    const tracks = [];
    // Objects that move in this clip.
    const objIds = new Set(
      clip.tracks
        .filter((t) => t.target.kind === 'object')
        .map((t) => t.target.id),
    );
    for (const id of objIds) {
      const node = built.nodes.get(id);
      if (!node) continue;
      const pos = [];
      const rot = [];
      const scl = [];
      for (const f of frames) {
        const ov = evaluateClip(clip, f, doc).objects[id] ?? {};
        const o = doc.objects[id];
        pos.push(...(ov.pos ?? o.pos));
        const r = ov.rot ?? o.rot;
        const q = new Quaternion().setFromEuler(
          new Euler(r[0] * RAD, r[1] * RAD, r[2] * RAD, 'XYZ'),
        );
        rot.push(q.x, q.y, q.z, q.w);
        scl.push(...(ov.scl ?? o.scl));
      }
      tracks.push(new VectorKeyframeTrack(`${node.name}.position`, times, pos));
      tracks.push(
        new QuaternionKeyframeTrack(`${node.name}.quaternion`, times, rot),
      );
      tracks.push(new VectorKeyframeTrack(`${node.name}.scale`, times, scl));
    }
    // Every bone of every armature the clip touches, with constraints solved.
    const armIds = new Set(
      clip.tracks
        .filter((t) => t.target.kind === 'bone')
        .map((t) => t.target.arm),
    );
    for (const t of clip.tracks)
      if (
        t.target.kind === 'object' &&
        doc.objects[t.target.id]?.type === 'control'
      )
        armIds.add(doc.objects[t.target.id].parent);
    for (const armId of armIds) {
      const arm = doc.objects[armId];
      const map = built.bones.get(armId);
      if (!arm || !map) continue;
      const series = new Map(
        arm.bones.map((b) => [b.id, { p: [], q: [], s: [] }]),
      );
      for (const f of frames) {
        const ev = evaluateClip(clip, f, doc);
        const pose = mergePose(arm.pose, ev.bones[armId]);
        const armInv = worldMatrix(doc, armId, ev.objects).invert();
        const controls = new Map();
        for (const o of Object.values(doc.objects))
          if (o.type === 'control')
            controls.set(
              o.id,
              armInv.clone().multiply(worldMatrix(doc, o.id, ev.objects)),
            );
        const { world } = solvePose(arm.bones, pose, controls);
        for (const b of arm.bones) {
          const m = world.get(b.id);
          const parent = b.parent ? world.get(b.parent) : null;
          const local = parent
            ? parent.clone().invert().multiply(m)
            : m.clone();
          const p = new Vector3();
          const q = new Quaternion();
          const s = new Vector3();
          local.decompose(p, q, s);
          const rec = series.get(b.id);
          rec.p.push(p.x, p.y, p.z);
          rec.q.push(q.x, q.y, q.z, q.w);
          rec.s.push(s.x, s.y, s.z);
        }
      }
      for (const b of arm.bones) {
        const rec = series.get(b.id);
        const name = map.get(b.id).name;
        tracks.push(new VectorKeyframeTrack(`${name}.position`, times, rec.p));
        tracks.push(
          new QuaternionKeyframeTrack(`${name}.quaternion`, times, rec.q),
        );
        tracks.push(new VectorKeyframeTrack(`${name}.scale`, times, rec.s));
      }
    }
    if (tracks.length)
      out.push(
        new AnimationClip(clip.name, times[times.length - 1] ?? 0, tracks),
      );
  }
  return out;
}

// ─── Formats ───────────────────────────────────────────────────────────

async function gltf(ctx, options, binary) {
  const built = buildExportScene(ctx, options);
  const clips =
    options.animations === false
      ? []
      : bakeClips(ctx, built, options.clips ?? ctx.doc.clipOrder);
  const result = await new GLTFExporter().parseAsync(built.scene, {
    binary,
    animations: clips,
    onlyVisible: true,
    maxTextureSize: 4096,
  });
  return binary
    ? new Blob([result], { type: 'model/gltf-binary' })
    : new Blob([JSON.stringify(result, null, 1)], { type: 'model/gltf+json' });
}

function canvasPng(c) {
  return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png'));
}

async function bytesOf(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

async function imagePng(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  return canvasPng(c);
}

// One grey PNG from a channel of an RGBA canvas (roughness out of ORM…).
async function channelPng(canvas, channel) {
  const c = document.createElement('canvas');
  c.width = canvas.width;
  c.height = canvas.height;
  const src = canvas.getContext('2d').getImageData(0, 0, c.width, c.height);
  const d = src.data;
  for (let i = 0; i < d.length; i += 4)
    d[i] = d[i + 1] = d[i + 2] = d[i + channel];
  c.getContext('2d').putImageData(src, 0, 0);
  return canvasPng(c);
}

// Every material's maps as PNGs: { 'Material_basecolor.png': Uint8Array, … }.
async function textureFiles(ctx, only = null) {
  const files = {};
  for (const id of ctx.doc.materialOrder) {
    if (only && !only.has(id)) continue;
    const mat = ctx.doc.materials[id];
    const name = safe(mat.name);
    const set = mat.layers?.length ? ctx.textures.get(id) : null;
    if (set?.map) {
      files[`${name}_basecolor.png`] = await bytesOf(
        await canvasPng(set.canvases.color),
      );
      files[`${name}_roughness.png`] = await bytesOf(
        await channelPng(set.canvases.orm, 1),
      );
      files[`${name}_metallic.png`] = await bytesOf(
        await channelPng(set.canvases.orm, 2),
      );
      files[`${name}_orm.png`] = await bytesOf(
        await canvasPng(set.canvases.orm),
      );
      if (mat.layers.some((l) => l.channels?.height))
        files[`${name}_height.png`] = await bytesOf(
          await canvasPng(set.canvases.height),
        );
    }
    for (const [slot, tid] of Object.entries(mat.maps ?? {})) {
      const img = tid ? ctx.images.get(tid) : null;
      if (img)
        files[`${name}_${slot}.png`] = await bytesOf(await imagePng(img));
    }
  }
  return files;
}

function materialJson(ctx) {
  return ctx.doc.materialOrder.map((id) => {
    const m = ctx.doc.materials[id];
    return {
      name: m.name,
      baseColor: m.color,
      roughness: m.rough,
      metallic: m.metal,
      emission: m.emissive,
      emissionStrength: m.emissiveIntensity,
      opacity: m.opacity,
      normalStrength: m.normalScale,
      heightScale: m.heightScale,
      doubleSided: m.doubleSided,
      maps: Object.fromEntries(
        Object.entries(m.maps ?? {})
          .filter(([, v]) => v)
          .map(([k]) => [k, `${safe(m.name)}_${k}.png`]),
      ),
      layers: (m.layers ?? []).map((l) => ({
        name: l.name,
        kind: l.kind,
        visible: l.visible,
        opacity: l.opacity,
        blend: l.blend,
        channels: l.channels,
        fill: l.kind === 'fill' ? l.fill : undefined,
        mask: l.mask,
      })),
    };
  });
}

export const EXPORTERS = {
  glb: {
    label: 'GLB',
    about:
      'Binary glTF: meshes, materials and textures, rigs and animation clips in one file. The best choice for most engines, three.js, Blender and Roblox.',
    ext: 'glb',
    options: ['selection', 'animations'],
    run: (ctx, o) => gltf(ctx, o, true),
  },
  gltf: {
    label: 'glTF',
    about: 'The same as GLB as readable JSON, with textures embedded.',
    ext: 'gltf',
    options: ['selection', 'animations'],
    run: (ctx, o) => gltf(ctx, o, false),
  },
  obj: {
    label: 'OBJ + MTL',
    about:
      'Static meshes with a material library and texture maps, zipped. No rigs or animation.',
    ext: 'zip',
    options: ['selection'],
    async run(ctx, o) {
      const built = buildExportScene(ctx, { ...o, applyTransforms: true });
      const base = safe(ctx.doc.name || 'model');
      const obj = `mtllib ${base}.mtl\n${new OBJExporter().parse(built.scene)}`;
      const used = new Set();
      built.scene.traverse((n) => {
        if (!n.isMesh) return;
        for (const m of Array.isArray(n.material) ? n.material : [n.material])
          used.add(m.name);
      });
      const tex = await textureFiles(ctx);
      let mtl = '';
      for (const id of ctx.doc.materialOrder) {
        const m = ctx.doc.materials[id];
        if (!used.has(m.name)) continue;
        const c = new Color(m.color);
        const n = safe(m.name);
        mtl += `newmtl ${m.name}\nKd ${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)}\nNs ${((1 - m.rough) * 900 + 10).toFixed(1)}\nd ${m.opacity ?? 1}\nillum 2\n`;
        mtl += `Pr ${m.rough}\nPm ${m.metal}\n`;
        if (tex[`${n}_basecolor.png`] || tex[`${n}_color.png`])
          mtl += `map_Kd ${tex[`${n}_basecolor.png`] ? `${n}_basecolor.png` : `${n}_color.png`}\n`;
        if (tex[`${n}_roughness.png`]) mtl += `map_Pr ${n}_roughness.png\n`;
        if (tex[`${n}_metallic.png`]) mtl += `map_Pm ${n}_metallic.png\n`;
        if (tex[`${n}_normal.png`]) mtl += `norm ${n}_normal.png\n`;
        mtl += '\n';
      }
      const files = {
        [`${base}.obj`]: strToU8(obj),
        [`${base}.mtl`]: strToU8(mtl),
        ...tex,
      };
      return new Blob([zipSync(files)], { type: 'application/zip' });
    },
  },
  stl: {
    label: 'STL',
    about: 'Geometry only, as a binary STL: for 3D printing.',
    ext: 'stl',
    options: ['selection'],
    run(ctx, o) {
      const built = buildExportScene(ctx, { ...o, applyTransforms: true });
      const data = new STLExporter().parse(built.scene, { binary: true });
      return new Blob([data], { type: 'model/stl' });
    },
  },
  textures: {
    label: 'Texture maps',
    about:
      'Every material’s maps as PNGs: base colour, roughness, metallic, packed ORM, height and any uploaded or baked maps.',
    ext: 'zip',
    options: [],
    async run(ctx) {
      const files = await textureFiles(ctx);
      if (!Object.keys(files).length)
        throw new Error(
          'No textures yet: paint a material or add a layer first.',
        );
      return new Blob([zipSync(files)], { type: 'application/zip' });
    },
  },
  material: {
    label: 'Material data',
    about: 'Each material’s PBR values, maps and layer stack as JSON.',
    ext: 'json',
    options: [],
    run: (ctx) =>
      new Blob([JSON.stringify(materialJson(ctx), null, 2)], {
        type: 'application/json',
      }),
  },
};

function isAncestor(doc, a, b) {
  let p = doc.objects[b]?.parent;
  while (p) {
    if (p === a) return true;
    p = doc.objects[p]?.parent;
  }
  return false;
}
