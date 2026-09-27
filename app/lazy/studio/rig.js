// Rigging: armatures, posing, IK, controllers and skin weights.
//
// An armature object holds its bones in armature space:
//   bone = { id, name, parent, head: [x,y,z], tail: [x,y,z], roll, deform, constraints: [] }
// A bone's rest frame sits at its head with +Y pointing down the bone (as in
// Blender), turned about that axis by `roll`. A pose is, per bone, a move,
// an Euler rotation (degrees) and a scale in that rest frame.
//
// Controllers are scene objects of type 'control' parented to the armature.
// IK targets and poles are moved like any object; FK controllers stand in
// for a bone (clicking one selects its bone). Bone constraints point at
// controllers by id.

import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { newId } from './doc';
import { dist, sub, dot, bounds } from './mesh';

const RAD = Math.PI / 180;
const Y = new Vector3(0, 1, 0);

export function newBone(props = {}) {
  return {
    id: newId('b'),
    name: 'Bone',
    parent: null,
    head: [0, 0, 0],
    tail: [0, 1, 0],
    roll: 0,
    deform: true,
    constraints: [],
    ...props,
  };
}

export const EMPTY_POSE = { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] };

// ─── Rest and posed matrices ───────────────────────────────────────────

export function restMatrix(bone) {
  const h = new Vector3(...bone.head);
  const dir = new Vector3(...bone.tail).sub(h);
  const q = new Quaternion();
  if (dir.lengthSq() > 1e-12) q.setFromUnitVectors(Y, dir.normalize());
  if (bone.roll)
    q.multiply(new Quaternion().setFromAxisAngle(Y, bone.roll * RAD));
  return new Matrix4().compose(h, q, new Vector3(1, 1, 1));
}

export function boneLength(bone) {
  return dist(bone.head, bone.tail);
}

export function byId(bones) {
  return new Map(bones.map((b) => [b.id, b]));
}

// Parents before children.
export function sortBones(bones) {
  const map = byId(bones);
  const out = [];
  const seen = new Set();
  const visit = (b) => {
    if (seen.has(b.id)) return;
    seen.add(b.id);
    if (b.parent && map.has(b.parent)) visit(map.get(b.parent));
    out.push(b);
  };
  for (const b of bones) visit(b);
  return out;
}

export function childrenOf(bones, id) {
  return bones.filter((b) => b.parent === id);
}

function poseMatrix(p = EMPTY_POSE) {
  const q = new Quaternion().setFromEuler(
    new Euler(p.r[0] * RAD, p.r[1] * RAD, p.r[2] * RAD, 'XYZ'),
  );
  return new Matrix4().compose(new Vector3(...p.p), q, new Vector3(...p.s));
}

// Armature-space matrices for every bone: forward kinematics from the pose,
// then constraints (IK with poles, copy rotation, track) in hierarchy order.
// `controls` maps a controller id to its matrix in armature space.
export function solvePose(bones, pose = {}, controls = new Map()) {
  const sorted = sortBones(bones);
  const map = byId(bones);
  const rest = new Map(sorted.map((b) => [b.id, restMatrix(b)]));
  const local = new Map();
  for (const b of sorted) {
    const parentRest =
      b.parent && rest.has(b.parent) ? rest.get(b.parent) : new Matrix4();
    const restLocal = parentRest.clone().invert().multiply(rest.get(b.id));
    local.set(b.id, restLocal.multiply(poseMatrix(pose[b.id])));
  }
  const world = new Map();
  const computeWorld = (list) => {
    for (const b of list) {
      const parentWorld =
        b.parent && world.has(b.parent) ? world.get(b.parent) : new Matrix4();
      world.set(b.id, parentWorld.clone().multiply(local.get(b.id)));
    }
  };
  computeWorld(sorted);
  const below = (id) => {
    const out = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop();
      for (const c of sorted)
        if (c.parent === cur) {
          out.push(c);
          stack.push(c.id);
        }
    }
    return sortBones(out.map((b) => map.get(b.id)));
  };
  // Re-derive a bone's local matrix from a new world matrix, then refresh everything below it.
  const setWorld = (b, m) => {
    const parentWorld =
      b.parent && world.has(b.parent) ? world.get(b.parent) : new Matrix4();
    local.set(b.id, parentWorld.clone().invert().multiply(m));
    world.set(b.id, m);
    computeWorld(below(b.id));
  };
  for (const b of sorted)
    for (const c of b.constraints ?? []) {
      if (c.on === false) continue;
      const target = controls.get(c.target);
      if (c.type === 'ik' && target)
        solveIK(b, c, target, controls.get(c.pole), {
          map,
          world,
          local,
          setWorld,
        });
      else if (c.type === 'copyRotation' && target) {
        const m = world.get(b.id);
        const pos = new Vector3().setFromMatrixPosition(m);
        // With an offset, the bone keeps its rest orientation relative to
        // the controller (which starts unrotated), so turning the
        // controller turns the bone by the same amount.
        const q = new Quaternion().setFromRotationMatrix(target);
        if (c.offset !== false)
          q.multiply(new Quaternion().setFromRotationMatrix(rest.get(b.id)));
        const cur = new Quaternion().setFromRotationMatrix(m);
        cur.slerp(q, c.influence ?? 1);
        setWorld(b, new Matrix4().compose(pos, cur, new Vector3(1, 1, 1)));
      } else if (c.type === 'track' && target) {
        const m = world.get(b.id);
        const pos = new Vector3().setFromMatrixPosition(m);
        const aim = new Vector3().setFromMatrixPosition(target).sub(pos);
        if (aim.lengthSq() < 1e-10) continue;
        const cur = new Quaternion().setFromRotationMatrix(m);
        const yNow = Y.clone().applyQuaternion(cur);
        const turn = new Quaternion().setFromUnitVectors(yNow, aim.normalize());
        const q = turn.multiply(cur);
        const blended = cur.clone().slerp(q, c.influence ?? 1);
        setWorld(b, new Matrix4().compose(pos, blended, new Vector3(1, 1, 1)));
      }
    }
  return { world, rest };
}

// Cyclic coordinate descent from the chain's end bone up `chain` bones,
// then the whole chain swung about the root→target line to face the pole.
// `influence` blends between the FK pose (0) and the IK result (1): the
// IK/FK switch.
function solveIK(end, c, target, pole, { map, world, setWorld }) {
  const chain = [];
  let b = end;
  for (let i = 0; i < Math.max(1, c.chain ?? 2) && b; i++) {
    chain.push(b);
    b = b.parent ? map.get(b.parent) : null;
  }
  const influence = c.influence ?? 1;
  if (influence <= 0) return;
  const before = chain.map((x) => world.get(x.id).clone());
  const goal = new Vector3().setFromMatrixPosition(target);
  const tipOf = () => {
    const m = world.get(end.id);
    return new Vector3(0, boneLength(end), 0).applyMatrix4(m);
  };
  const rotateAbout = (bone, pivot, q) => {
    const m = world.get(bone.id);
    const t = new Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z);
    const r = new Matrix4().makeRotationFromQuaternion(q);
    const back = new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
    setWorld(bone, t.multiply(r).multiply(back).multiply(m));
  };
  for (let it = 0; it < 16; it++) {
    for (const bone of chain) {
      const pivot = new Vector3().setFromMatrixPosition(world.get(bone.id));
      const toTip = tipOf().sub(pivot);
      const toGoal = goal.clone().sub(pivot);
      if (toTip.lengthSq() < 1e-12 || toGoal.lengthSq() < 1e-12) continue;
      const q = new Quaternion().setFromUnitVectors(
        toTip.normalize(),
        toGoal.normalize(),
      );
      rotateAbout(bone, pivot, q);
    }
    if (tipOf().distanceTo(goal) < 1e-4) break;
  }
  if (pole && chain.length >= 2) {
    const root = chain[chain.length - 1];
    const rootPos = new Vector3().setFromMatrixPosition(world.get(root.id));
    const axis = goal.clone().sub(rootPos);
    if (axis.lengthSq() > 1e-10) {
      axis.normalize();
      const mid = new Vector3()
        .setFromMatrixPosition(world.get(chain[chain.length - 2].id))
        .sub(rootPos);
      const polePos = new Vector3().setFromMatrixPosition(pole).sub(rootPos);
      const flat = (v) =>
        v.clone().sub(axis.clone().multiplyScalar(v.dot(axis)));
      const a = flat(mid);
      const p = flat(polePos);
      if (a.lengthSq() > 1e-10 && p.lengthSq() > 1e-10) {
        a.normalize();
        p.normalize();
        let angle = Math.acos(Math.max(-1, Math.min(1, a.dot(p))));
        if (new Vector3().crossVectors(a, p).dot(axis) < 0) angle = -angle;
        const q = new Quaternion().setFromAxisAngle(axis, angle);
        rotateAbout(root, rootPos, q);
      }
    }
  }
  if (influence < 1) {
    // Blend each bone's world rotation back towards FK, top of the chain first.
    for (let i = chain.length - 1; i >= 0; i--) {
      const bone = chain[i];
      const fk = before[i];
      const ik = world.get(bone.id);
      const pos = new Vector3().setFromMatrixPosition(ik);
      const qf = new Quaternion().setFromRotationMatrix(fk);
      const qi = new Quaternion().setFromRotationMatrix(ik);
      setWorld(
        bone,
        new Matrix4().compose(
          pos,
          qf.slerp(qi, influence),
          new Vector3(1, 1, 1),
        ),
      );
    }
  }
}

// The pose (bone-local move/rotate/scale) that puts a bone at an
// armature-space matrix, given its parent's posed matrix. Used to bake IK
// into FK and to drag bones directly.
export function poseFromWorld(bone, bones, worldMatrix, parentWorld) {
  const map = byId(bones);
  const parent = bone.parent ? map.get(bone.parent) : null;
  const rest = restMatrix(bone);
  const parentRest = parent ? restMatrix(parent) : new Matrix4();
  const restLocal = parentRest.clone().invert().multiply(rest);
  const localNow = (parentWorld ?? new Matrix4())
    .clone()
    .invert()
    .multiply(worldMatrix);
  const delta = restLocal.invert().multiply(localNow);
  const p = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  delta.decompose(p, q, s);
  const e = new Euler().setFromQuaternion(q, 'XYZ');
  const r = (x) => Math.round(x * 1e4) / 1e4;
  return {
    p: [r(p.x), r(p.y), r(p.z)],
    r: [r(e.x / RAD), r(e.y / RAD), r(e.z / RAD)],
    s: [r(s.x), r(s.y), r(s.z)],
  };
}

// ─── Templates ─────────────────────────────────────────────────────────

// Joints in a unit box (x −0.5..0.5, y 0..1, z −0.5..0.5, facing +Z),
// stretched over the mesh being rigged. `ik` marks the lower bone of a
// two-bone limb: it gets an IK target at its tip (wrist, ankle) and a pole
// (elbow, knee). `follow` bones (hands, feet) turn with that limb's
// target. `fk` bones get a ring controller.
const T = {
  humanoid: {
    label: 'Humanoid',
    bones: [
      ['Root', null, [0, 0, 0], [0, 0.1, 0], { deform: false }],
      ['Hips', 'Root', [0, 0.5, 0], [0, 0.58, 0], { fk: 'hips' }],
      ['Spine', 'Hips', [0, 0.58, 0], [0, 0.68, 0], { fk: 'spine' }],
      ['Chest', 'Spine', [0, 0.68, 0], [0, 0.8, 0], { fk: 'spine' }],
      ['Neck', 'Chest', [0, 0.8, 0], [0, 0.86, 0]],
      ['Head', 'Neck', [0, 0.86, 0], [0, 1, 0], { fk: 'head' }],
      ['LeftArm', 'Chest', [0.1, 0.8, 0], [0.26, 0.8, -0.01]],
      [
        'LeftForeArm',
        'LeftArm',
        [0.26, 0.8, -0.01],
        [0.4, 0.8, 0],
        { ik: 'hand', pole: [0.26, 0.8, -0.3] },
      ],
      [
        'LeftHand',
        'LeftForeArm',
        [0.4, 0.8, 0],
        [0.48, 0.8, 0],
        { follow: 'LeftForeArm' },
      ],
      ['RightArm', 'Chest', [-0.1, 0.8, 0], [-0.26, 0.8, -0.01]],
      [
        'RightForeArm',
        'RightArm',
        [-0.26, 0.8, -0.01],
        [-0.4, 0.8, 0],
        { ik: 'hand', pole: [-0.26, 0.8, -0.3] },
      ],
      [
        'RightHand',
        'RightForeArm',
        [-0.4, 0.8, 0],
        [-0.48, 0.8, 0],
        { follow: 'RightForeArm' },
      ],
      ['LeftLeg', 'Hips', [0.07, 0.5, 0], [0.07, 0.27, 0.01]],
      [
        'LeftShin',
        'LeftLeg',
        [0.07, 0.27, 0.01],
        [0.07, 0.04, 0],
        { ik: 'foot', pole: [0.07, 0.27, 0.4] },
      ],
      [
        'LeftFoot',
        'LeftShin',
        [0.07, 0.04, 0],
        [0.07, 0, 0.12],
        { follow: 'LeftShin' },
      ],
      ['RightLeg', 'Hips', [-0.07, 0.5, 0], [-0.07, 0.27, 0.01]],
      [
        'RightShin',
        'RightLeg',
        [-0.07, 0.27, 0.01],
        [-0.07, 0.04, 0],
        { ik: 'foot', pole: [-0.07, 0.27, 0.4] },
      ],
      [
        'RightFoot',
        'RightShin',
        [-0.07, 0.04, 0],
        [-0.07, 0, 0.12],
        { follow: 'RightShin' },
      ],
    ],
  },
  quadruped: {
    label: 'Four-legged',
    bones: [
      ['Root', null, [0, 0, 0], [0, 0.1, 0], { deform: false }],
      ['Hips', 'Root', [0, 0.6, -0.3], [0, 0.62, -0.1], { fk: 'hips' }],
      ['Spine', 'Hips', [0, 0.62, -0.1], [0, 0.63, 0.12], { fk: 'spine' }],
      ['Chest', 'Spine', [0, 0.63, 0.12], [0, 0.64, 0.3], { fk: 'spine' }],
      ['Neck', 'Chest', [0, 0.64, 0.3], [0, 0.8, 0.4]],
      ['Head', 'Neck', [0, 0.8, 0.4], [0, 0.82, 0.5], { fk: 'head' }],
      ['Tail1', 'Hips', [0, 0.6, -0.3], [0, 0.58, -0.4]],
      ['Tail2', 'Tail1', [0, 0.58, -0.4], [0, 0.52, -0.5]],
      ...['Left', 'Right'].flatMap((side) => {
        const x = side === 'Left' ? 0.15 : -0.15;
        return [
          [`${side}FrontLeg`, 'Chest', [x, 0.58, 0.28], [x, 0.3, 0.3]],
          [
            `${side}FrontShin`,
            `${side}FrontLeg`,
            [x, 0.3, 0.3],
            [x, 0.05, 0.28],
            { ik: 'foot', pole: [x, 0.3, 0.7] },
          ],
          [
            `${side}FrontFoot`,
            `${side}FrontShin`,
            [x, 0.05, 0.28],
            [x, 0, 0.34],
            { follow: `${side}FrontShin` },
          ],
          [`${side}BackLeg`, 'Hips', [x, 0.56, -0.28], [x, 0.3, -0.22]],
          [
            `${side}BackShin`,
            `${side}BackLeg`,
            [x, 0.3, -0.22],
            [x, 0.05, -0.3],
            { ik: 'foot', pole: [x, 0.3, -0.7] },
          ],
          [
            `${side}BackFoot`,
            `${side}BackShin`,
            [x, 0.05, -0.3],
            [x, 0, -0.24],
            { follow: `${side}BackShin` },
          ],
        ];
      }),
    ],
  },
  bird: {
    label: 'Bird',
    bones: [
      ['Root', null, [0, 0, 0], [0, 0.1, 0], { deform: false }],
      ['Body', 'Root', [0, 0.4, -0.15], [0, 0.45, 0.15], { fk: 'hips' }],
      ['Neck', 'Body', [0, 0.45, 0.15], [0, 0.7, 0.2]],
      ['Head', 'Neck', [0, 0.7, 0.2], [0, 0.8, 0.35], { fk: 'head' }],
      ['Tail', 'Body', [0, 0.4, -0.15], [0, 0.38, -0.45]],
      ...['Left', 'Right'].flatMap((side) => {
        const s = side === 'Left' ? 1 : -1;
        return [
          [`${side}Wing`, 'Body', [0.1 * s, 0.5, 0.05], [0.3 * s, 0.52, 0]],
          [
            `${side}WingTip`,
            `${side}Wing`,
            [0.3 * s, 0.52, 0],
            [0.5 * s, 0.5, -0.1],
          ],
          [`${side}Leg`, 'Body', [0.06 * s, 0.35, 0], [0.06 * s, 0.15, 0.02]],
          [
            `${side}Foot`,
            `${side}Leg`,
            [0.06 * s, 0.15, 0.02],
            [0.06 * s, 0, 0.1],
            { ik: 'foot', pole: [0.06 * s, 0.2, 0.5] },
          ],
        ];
      }),
    ],
  },
  snake: {
    label: 'Snake / tail',
    bones: [
      ['Root', null, [0, 0, 0.5], [0, 0.05, 0.5], { deform: false }],
      ...Array.from({ length: 8 }, (_, i) => [
        `Segment${i + 1}`,
        i ? `Segment${i}` : 'Root',
        [0, 0.1, 0.5 - i / 8],
        [0, 0.1, 0.5 - (i + 1) / 8],
        i === 0 ? { fk: 'head' } : {},
      ]),
    ],
  },
  spider: {
    label: 'Spider',
    bones: [
      ['Root', null, [0, 0, 0], [0, 0.1, 0], { deform: false }],
      ['Body', 'Root', [0, 0.35, -0.1], [0, 0.36, 0.15], { fk: 'hips' }],
      ['Abdomen', 'Body', [0, 0.35, -0.1], [0, 0.4, -0.4]],
      ...['Left', 'Right'].flatMap((side) => {
        const s = side === 'Left' ? 1 : -1;
        return [0.1, 0.02, -0.06, -0.14].flatMap((z, i) => [
          [
            `${side}Leg${i + 1}`,
            'Body',
            [0.05 * s, 0.35, z],
            [0.28 * s, 0.5, z * 1.8],
          ],
          [
            `${side}Leg${i + 1}Tip`,
            `${side}Leg${i + 1}`,
            [0.28 * s, 0.5, z * 1.8],
            [0.46 * s, 0, z * 2.6],
            { ik: 'foot', pole: [0.3 * s, 0.9, z * 1.8] },
          ],
        ]);
      }),
    ],
  },
};

export const RIG_TEMPLATES = Object.fromEntries(
  Object.entries(T).map(([k, v]) => [k, v.label]),
);

// Builds a template's bones (and the controllers it wants) fitted to a box.
// Returns { bones, controls: [{ name, shape, role, pos, color, size }] }.
export function buildTemplate(
  kind,
  box = { min: [-0.5, 0, -0.5], max: [0.5, 2, 0.5] },
) {
  const t = T[kind];
  if (!t) throw new Error(`Unknown rig template "${kind}"`);
  const size = [0, 1, 2].map((k) => Math.max(box.max[k] - box.min[k], 1e-3));
  const at = (p) => [
    (box.min[0] + box.max[0]) / 2 + p[0] * size[0],
    box.min[1] + p[1] * size[1],
    (box.min[2] + box.max[2]) / 2 + p[2] * size[2],
  ];
  const ids = new Map();
  const bones = t.bones.map(([name, parent, head, tail, opts = {}]) => {
    const b = newBone({
      name,
      head: at(head),
      tail: at(tail),
      deform: opts.deform ?? true,
    });
    ids.set(name, b.id);
    b.parent = parent;
    b.meta = opts;
    return b;
  });
  for (const b of bones) b.parent = b.parent ? ids.get(b.parent) : null;
  const scaleRef = size[1];
  const controls = [];
  const follows = [];
  const metas = new Map(bones.map((b) => [b.id, b.meta]));
  for (const b of bones) delete b.meta;
  const byName = new Map(bones.map((b) => [b.name, b]));
  for (const b of bones) {
    const o = metas.get(b.id);
    if (o.ik) {
      // Named after what you grab: the hand or foot that follows the target.
      const follower = bones.find((x) => metas.get(x.id).follow === b.name);
      const side = b.name.startsWith('Left')
        ? '#3aa0ff'
        : b.name.startsWith('Right')
          ? '#ff4d6d'
          : '#ffd23c';
      controls.push({
        name: `${(follower ?? b).name}.IK`,
        shape: o.ik === 'hand' ? 'cube' : 'square',
        role: { kind: 'ik', bone: b.id, chain: o.chain ?? 2 },
        pos: [...b.tail],
        size: scaleRef * 0.05,
        color: side,
      });
      if (o.pole)
        controls.push({
          name: `${b.name}.Pole`,
          shape: 'diamond',
          role: { kind: 'pole', bone: b.id },
          pos: at(o.pole),
          size: scaleRef * 0.03,
          color: '#b36bff',
        });
    }
    if (o.follow && byName.has(o.follow))
      follows.push({ bone: b.id, ikBone: byName.get(o.follow).id });
    if (o.fk)
      controls.push({
        name: `${b.name}.FK`,
        shape: 'circle',
        role: { kind: 'fk', bone: b.id },
        pos: [...b.head],
        size: scaleRef * (o.fk === 'head' ? 0.08 : 0.14),
        color: '#ffd23c',
      });
  }
  return { bones, controls, follows };
}

// ─── Skin weights ──────────────────────────────────────────────────────

function segmentDistance(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 1e-12 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
}

// Automatic weights: each vertex listens to the bones nearest it, strongly
// to the nearest, blending across joints; at most four, summing to one.
// `toArmature` maps mesh-local positions into armature space.
export function autoWeights(mesh, bones, toArmature = (p) => p) {
  const deform = bones.filter((b) => b.deform !== false);
  const n = mesh.v.length;
  const groups = Object.fromEntries(
    deform.map((b) => [b.name, new Float32Array(n)]),
  );
  if (!deform.length) return makeSkin(mesh, groups);
  const { min, max } = bounds(mesh);
  const scaleRef = Math.max(dist(min, max), 1e-3);
  for (let i = 0; i < n; i++) {
    const p = toArmature(mesh.v[i]);
    const ds = deform.map((b) => [b.name, segmentDistance(p, b.head, b.tail)]);
    ds.sort((a, b) => a[1] - b[1]);
    const nearest = ds[0][1];
    const top = ds
      .slice(0, 4)
      .filter(([, d]) => d <= nearest + scaleRef * 0.06);
    let sum = 0;
    const ws = top.map(([name, d]) => {
      const w = 1 / Math.pow(d / scaleRef + 0.01, 4);
      sum += w;
      return [name, w];
    });
    for (const [name, w] of ws) groups[name][i] = w / sum;
  }
  return makeSkin(mesh, groups);
}

export function makeSkin(mesh, groups) {
  return {
    n: mesh.v.length,
    rest: Float32Array.from(mesh.v.flat()),
    groups,
  };
}

// Carries weights over to a mesh whose vertices changed (a modifier was
// retuned, the mesh was edited) by nearest rest position.
export function remapSkin(skin, mesh) {
  if (!skin) return null;
  const n = mesh.v.length;
  if (skin.n === n) {
    let same = true;
    for (let i = 0; i < n && same; i++) {
      const p = mesh.v[i];
      if (
        Math.abs(p[0] - skin.rest[i * 3]) > 1e-5 ||
        Math.abs(p[1] - skin.rest[i * 3 + 1]) > 1e-5 ||
        Math.abs(p[2] - skin.rest[i * 3 + 2]) > 1e-5
      )
        same = false;
    }
    if (same) return skin;
  }
  const nearest = nearestFinder(skin.rest, skin.n);
  const groups = {};
  for (const name of Object.keys(skin.groups))
    groups[name] = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = nearest(mesh.v[i]);
    if (j < 0) continue;
    for (const [name, arr] of Object.entries(skin.groups))
      groups[name][i] = arr[j];
  }
  return makeSkin(mesh, groups);
}

// A grid lookup for the closest of `count` points in a flat array.
export function nearestFinder(flat, count) {
  let min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], flat[i * 3 + k]);
      max[k] = Math.max(max[k], flat[i * 3 + k]);
    }
  const span = Math.max(
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2],
    1e-6,
  );
  const cell = span / Math.max(4, Math.cbrt(count) * 1.5);
  const key = (x, y, z) => `${x},${y},${z}`;
  const grid = new Map();
  for (let i = 0; i < count; i++) {
    const k = key(
      Math.floor(flat[i * 3] / cell),
      Math.floor(flat[i * 3 + 1] / cell),
      Math.floor(flat[i * 3 + 2] / cell),
    );
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  return (p) => {
    const cx = Math.floor(p[0] / cell),
      cy = Math.floor(p[1] / cell),
      cz = Math.floor(p[2] / cell);
    let best = -1;
    let bestD = Infinity;
    for (let r = 0; r < 64; r++) {
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++)
          for (let dz = -r; dz <= r; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r)
              continue;
            const list = grid.get(key(cx + dx, cy + dy, cz + dz));
            if (!list) continue;
            for (const i of list) {
              const d =
                (flat[i * 3] - p[0]) ** 2 +
                (flat[i * 3 + 1] - p[1]) ** 2 +
                (flat[i * 3 + 2] - p[2]) ** 2;
              if (d < bestD) {
                bestD = d;
                best = i;
              }
            }
          }
      // Anything in a farther shell is at least (r)·cell away.
      if (best >= 0 && Math.sqrt(bestD) <= r * cell) break;
    }
    return best;
  };
}

// The four strongest influences per vertex, for the GPU.
export function topInfluences(skin, boneIndex) {
  const n = skin.n;
  const idx = new Uint16Array(n * 4);
  const w = new Float32Array(n * 4);
  const entries = Object.entries(skin.groups).filter(([name]) =>
    boneIndex.has(name),
  );
  for (let i = 0; i < n; i++) {
    const list = [];
    for (const [name, arr] of entries)
      if (arr[i] > 1e-4) list.push([boneIndex.get(name), arr[i]]);
    list.sort((a, b) => b[1] - a[1]);
    const top = list.slice(0, 4);
    const sum = top.reduce((s, x) => s + x[1], 0);
    top.forEach(([bi, wi], k) => {
      idx[i * 4 + k] = bi;
      w[i * 4 + k] = sum > 0 ? wi / sum : 0;
    });
    if (!top.length) w[i * 4] = 1; // unweighted: follows bone 0 (the root)
  }
  return { idx, w };
}

// ─── Weight tools ──────────────────────────────────────────────────────

const sideSwap = [
  [/Left/g, 'Right', /Right/g, 'Left'],
  [/left/g, 'right', /right/g, 'left'],
  [/\.L$/, '.R', /\.R$/, '.L'],
  [/_L$/, '_R', /_R$/, '_L'],
  [/_l$/, '_r', /_r$/, '_l'],
];

export function mirrorName(name) {
  for (const [a, ra, b, rb] of sideSwap) {
    if (a.test(name)) return name.replace(a, ra);
    if (b.test(name)) return name.replace(b, rb);
  }
  return name;
}

// Adds up to one across groups for every vertex (keeping `locked` groups as they are).
export function normalizeSkin(skin, locked = new Set()) {
  const groups = Object.fromEntries(
    Object.entries(skin.groups).map(([k, v]) => [k, new Float32Array(v)]),
  );
  const names = Object.keys(groups);
  for (let i = 0; i < skin.n; i++) {
    let lockedSum = 0;
    let free = 0;
    for (const nm of names)
      locked.has(nm) ? (lockedSum += groups[nm][i]) : (free += groups[nm][i]);
    const room = Math.max(0, 1 - lockedSum);
    if (free <= 1e-8) continue;
    for (const nm of names)
      if (!locked.has(nm)) groups[nm][i] = (groups[nm][i] / free) * room;
  }
  return { ...skin, groups };
}

// Copies each side's weights to the other: the vertex mirrored across X
// takes the mirrored bone's weight.
export function mirrorSkin(skin, mesh, { axis = 0, fromPositive = true } = {}) {
  const nearest = nearestFinder(skin.rest, skin.n);
  const groups = Object.fromEntries(
    Object.entries(skin.groups).map(([k, v]) => [k, new Float32Array(v)]),
  );
  for (let i = 0; i < skin.n; i++) {
    const p = mesh.v[i];
    const onTarget = fromPositive ? p[axis] < -1e-5 : p[axis] > 1e-5;
    if (!onTarget) continue;
    const q = [...p];
    q[axis] = -q[axis];
    const j = nearest(q);
    if (j < 0) continue;
    for (const name of Object.keys(groups)) groups[name][i] = 0;
    for (const [name, arr] of Object.entries(skin.groups)) {
      const to = mirrorName(name);
      if (groups[to]) groups[to][i] += arr[j];
    }
  }
  return { ...skin, groups };
}

// Averages a group's weights with their neighbours' (`only` limits it to some vertices).
export function smoothGroup(
  skin,
  name,
  neighbours,
  { strength = 0.5, iterations = 1, only = null } = {},
) {
  let arr = new Float32Array(skin.groups[name] ?? new Float32Array(skin.n));
  for (let it = 0; it < iterations; it++) {
    const next = new Float32Array(arr);
    for (let i = 0; i < skin.n; i++) {
      if (only && !only.has(i)) continue;
      const nb = neighbours[i];
      if (!nb?.length) continue;
      let s = 0;
      for (const j of nb) s += arr[j];
      const f = only instanceof Map ? only.get(i) * strength : strength;
      next[i] = arr[i] + (s / nb.length - arr[i]) * f;
    }
    arr = next;
  }
  return { ...skin, groups: { ...skin.groups, [name]: arr } };
}

// Takes weights from another skinned mesh by nearest vertex, both given in
// a shared space (`here` and `there` are the two meshes' positions in it).
export function transferSkin(fromSkin, fromPositions, toMesh, toPositions) {
  const flat = Float32Array.from(fromPositions.flat());
  const nearest = nearestFinder(flat, fromPositions.length);
  const groups = {};
  for (const name of Object.keys(fromSkin.groups))
    groups[name] = new Float32Array(toMesh.v.length);
  toPositions.forEach((p, i) => {
    const j = nearest(p);
    if (j < 0) return;
    for (const [name, arr] of Object.entries(fromSkin.groups))
      groups[name][i] = arr[j];
  });
  return makeSkin(toMesh, groups);
}

// Weight (0..1) → the familiar blue–green–yellow–red ramp.
export function weightColor(w) {
  const t = Math.max(0, Math.min(1, w));
  const stops = [
    [0, [0.05, 0.05, 0.45]],
    [0.25, [0, 0.45, 1]],
    [0.5, [0.1, 0.9, 0.3]],
    [0.75, [1, 0.9, 0.1]],
    [1, [1, 0.15, 0.1]],
  ];
  for (let i = 1; i < stops.length; i++)
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const k = (t - t0) / (t1 - t0);
      return [
        c0[0] + (c1[0] - c0[0]) * k,
        c0[1] + (c1[1] - c0[1]) * k,
        c0[2] + (c1[2] - c0[2]) * k,
      ];
    }
  return stops[stops.length - 1][1];
}
