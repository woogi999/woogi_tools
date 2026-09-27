// Rigging: armatures, bones, controllers, constraints, skin weights and
// posing. Mixed into StudioState (state.js).

import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';

class RigState {
  @tracked boneSel = null; // { arm, active, ids: Set }
  @tracked boneEnd = 'both';
  @tracked weightGroup = null;
  @tracked weightVersion = 0;
  @tracked skinVersion = 0;
  @tracked restPose = false;
  @tracked poseClipboard = null;
  @tracked template = 'humanoid';
}

export default {
  init() {
    this.rig = new RigState();
  },

  get boneSel() {
    return this.rig.boneSel;
  },
  set boneSel(v) {
    this.rig.boneSel = v;
  },
  get boneEnd() {
    return this.rig.boneEnd;
  },
  get weightGroup() {
    return this.rig.weightGroup;
  },
  get weightVersion() {
    return this.rig.weightVersion;
  },
  get skinVersion() {
    return this.rig.skinVersion;
  },
  get restPose() {
    return this.rig.restPose;
  },

  // The armature being worked on: the selected one, the one whose bones are
  // selected, or the one the selected mesh is skinned to.
  currentArmature() {
    const o = this.obj;
    if (o?.type === 'armature') return o;
    if (this.rig.boneSel?.arm && this.doc.objects[this.rig.boneSel.arm])
      return this.doc.objects[this.rig.boneSel.arm];
    if (
      o?.type === 'control' &&
      this.doc.objects[o.parent]?.type === 'armature'
    )
      return this.doc.objects[o.parent];
    if (o?.skin?.armature) return this.doc.objects[o.skin.armature] ?? null;
    return (
      Object.values(this.doc.objects).find((x) => x.type === 'armature') ?? null
    );
  },

  get armature() {
    return this.currentArmature();
  },

  get bone() {
    const arm = this.armature;
    const sel = this.rig.boneSel;
    if (!arm || sel?.arm !== arm.id) return null;
    return arm.bones.find((b) => b.id === sel.active) ?? null;
  },

  get boneRows() {
    const arm = this.armature;
    if (!arm) return [];
    const sel = this.rig.boneSel;
    const out = [];
    const walk = (parent, depth) => {
      for (const b of arm.bones.filter((x) => (x.parent ?? null) === parent)) {
        out.push({
          bone: b,
          depth,
          active: sel?.arm === arm.id && sel.active === b.id,
          selected: sel?.arm === arm.id && sel.ids.has(b.id),
          indent: htmlSafe(`padding-left:${6 + depth * 12}px`),
        });
        walk(b.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  },

  get controlChoices() {
    const arm = this.armature;
    return Object.values(this.doc.objects)
      .filter((o) => o.type === 'control' && (!arm || o.parent === arm.id))
      .map((o) => ({ value: o.id, label: o.name }));
  },

  ensureBoneSel() {
    const arm = this.currentArmature();
    if (!arm) return;
    if (this.rig.boneSel?.arm !== arm.id)
      this.rig.boneSel = {
        arm: arm.id,
        active: arm.bones[0]?.id ?? null,
        ids: new Set(),
      };
  },

  pickBone({ arm, bone }, mods = {}) {
    const cur = this.rig.boneSel;
    let ids = cur?.arm === arm ? new Set(cur.ids) : new Set();
    if (mods.shift || mods.ctrl) {
      if (ids.has(bone)) ids.delete(bone);
      else ids.add(bone);
    } else ids = new Set([bone]);
    this.rig.boneSel = { arm, active: bone, ids };
    if (this.mode !== 'bones' && this.mode !== 'pose' && this.mode !== 'weight')
      this.mode = 'pose';
    if (this.active !== arm && this.mode !== 'weight') {
      this.selected = [arm];
      this.active = arm;
    }
    // Picking a bone shows what it moves.
    const b = this.doc.objects[arm]?.bones.find((x) => x.id === bone);
    if (b) this.rig.weightGroup = b.name;
    this.rightTab = 'rig';
  },

  selectBone(id, e) {
    this.pickBone(
      { arm: this.armature.id, bone: id },
      { shift: e?.shiftKey, ctrl: e?.ctrlKey },
    );
  },

  setBoneEnd(end) {
    this.rig.boneEnd = end;
  },

  toggleRestPose() {
    this.rig.restPose = !this.rig.restPose;
  },

  setTemplate(e) {
    this.rig.template = e.target.value;
  },

  // ─── Editing bones ─────────────────────────────────────────────────

  updateBones(arm, bones, label, merge = null) {
    this.commit(this.E.docs.updateObject(this.doc, arm.id, { bones }), label, {
      merge,
    });
  },

  addBone() {
    const arm = this.armature;
    if (!arm) return this.addObject('armature');
    const parent = this.bone;
    const head = parent ? [...parent.tail] : [0, 0, 0];
    const b = this.E.rig.newBone({
      name: this.uniqueBoneName(arm, 'Bone'),
      parent: parent?.id ?? null,
      head,
      tail: [head[0], head[1] + 0.5, head[2]],
    });
    this.updateBones(arm, [...arm.bones, b], 'Add bone');
    this.rig.boneSel = { arm: arm.id, active: b.id, ids: new Set([b.id]) };
    if (this.mode !== 'bones') this.mode = 'bones';
  },

  // A new bone continuing the active one: how chains (tails, spines) are made.
  extrudeBone() {
    const arm = this.armature;
    const parent = this.bone;
    if (!arm || !parent) return this.flash('Select a bone to extrude from.');
    const dir = parent.tail.map((x, k) => x - parent.head[k]);
    const tail = parent.tail.map((x, k) => x + dir[k]);
    const b = this.E.rig.newBone({
      name: this.uniqueBoneName(arm, parent.name.replace(/\.?\d+$/, '')),
      parent: parent.id,
      head: [...parent.tail],
      tail,
    });
    this.updateBones(arm, [...arm.bones, b], 'Extrude bone');
    this.rig.boneSel = { arm: arm.id, active: b.id, ids: new Set([b.id]) };
  },

  // Mirrors the selected bones to the other side (Left ↔ Right).
  symmetrizeBones() {
    const arm = this.armature;
    if (!arm) return;
    const ids = this.rig.boneSel?.ids.size
      ? this.rig.boneSel.ids
      : new Set(this.bone ? [this.bone.id] : []);
    const byName = new Map(arm.bones.map((b) => [b.name, b]));
    const added = [];
    const idMap = new Map();
    for (const b of arm.bones.filter((x) => ids.has(x.id))) {
      const name = this.E.rig.mirrorName(b.name);
      if (name === b.name || byName.has(name)) continue;
      const copy = this.E.rig.newBone({
        name,
        head: [-b.head[0], b.head[1], b.head[2]],
        tail: [-b.tail[0], b.tail[1], b.tail[2]],
        roll: -b.roll,
        deform: b.deform,
        parent: b.parent,
      });
      idMap.set(b.id, copy.id);
      added.push(copy);
    }
    for (const c of added) {
      const src = arm.bones.find((b) => idMap.get(b.id) === c.id);
      const parent = arm.bones.find((b) => b.id === src.parent);
      if (parent) {
        const mirrored =
          idMap.get(parent.id) ??
          byName.get(this.E.rig.mirrorName(parent.name))?.id;
        c.parent = mirrored ?? parent.id;
      }
    }
    if (!added.length)
      return this.flash(
        'Nothing to mirror: select bones with Left or Right in their names.',
      );
    this.updateBones(arm, [...arm.bones, ...added], 'Symmetrize bones');
  },

  deleteBone() {
    const arm = this.armature;
    const sel = this.rig.boneSel;
    if (!arm || !sel?.active) return;
    const gone = sel.ids.size ? sel.ids : new Set([sel.active]);
    const bones = arm.bones
      .filter((b) => !gone.has(b.id))
      .map((b) => {
        if (!gone.has(b.parent)) return b;
        // Children of a removed bone attach to its parent.
        let p = arm.bones.find((x) => x.id === b.parent);
        while (p && gone.has(p.id))
          p = arm.bones.find((x) => x.id === p.parent);
        return { ...b, parent: p?.id ?? null };
      });
    this.updateBones(arm, bones, 'Delete bone');
    this.rig.boneSel = {
      arm: arm.id,
      active: bones[0]?.id ?? null,
      ids: new Set(),
    };
  },

  uniqueBoneName(arm, base) {
    const taken = new Set(arm.bones.map((b) => b.name));
    if (!taken.has(base)) return base;
    for (let i = 1; ; i++)
      if (!taken.has(`${base}.${String(i).padStart(3, '0')}`))
        return `${base}.${String(i).padStart(3, '0')}`;
  },

  setBone(key, value, final) {
    const arm = this.armature;
    const b = this.bone;
    if (!arm || !b) return;
    let v = value;
    let doc = this.doc;
    if (key === 'name') {
      v = value.trim();
      if (!v || v === b.name) return;
      v = this.uniqueBoneName(
        { bones: arm.bones.filter((x) => x.id !== b.id) },
        v,
      );
      doc = this.renameGroup(doc, arm, b.name, v);
    }
    if (
      key === 'parent' &&
      v &&
      (v === b.id || this.boneDescends(arm, v, b.id))
    )
      return this.flash('A bone can’t be parented to its own child.');
    const bones = arm.bones.map((x) =>
      x.id === b.id ? { ...x, [key]: v } : x,
    );
    this.commit(this.E.docs.updateObject(doc, arm.id, { bones }), 'Bone', {
      merge: `bone:${b.id}:${key}`,
    });
    if (final) this.seal();
  },

  setBoneVec(key, axis, value, final) {
    const b = this.bone;
    if (!b) return;
    const v = [...b[key]];
    v[axis] = value;
    this.setBone(key, v, final);
  },

  boneDescends(arm, id, ancestor) {
    let p = arm.bones.find((b) => b.id === id);
    while (p) {
      if (p.parent === ancestor) return true;
      p = arm.bones.find((b) => b.id === p.parent);
    }
    return false;
  },

  // Skin weight groups follow a bone's new name.
  renameGroup(doc, arm, from, to) {
    const patches = [];
    for (const o of Object.values(doc.objects)) {
      if (o.skin?.armature !== arm.id || !o.skin.groups[from]) continue;
      const groups = { ...o.skin.groups, [to]: o.skin.groups[from] };
      delete groups[from];
      patches.push([o.id, { skin: { ...o.skin, groups } }]);
    }
    if (this.rig.weightGroup === from) this.rig.weightGroup = to;
    return patches.length ? this.E.docs.updateObjects(doc, patches) : doc;
  },

  // Gizmo drags in bone-edit mode.
  moveBoneEnds(armId, boneId, head, tail, final) {
    const arm = this.doc.objects[armId];
    // Connected children follow the tail.
    const oldTail = arm.bones.find((b) => b.id === boneId).tail;
    const moved = tail.map((x, k) => x - oldTail[k]);
    const bones = arm.bones.map((b) => {
      if (b.id === boneId) return { ...b, head, tail };
      if (
        b.parent === boneId &&
        b.head.every((x, k) => Math.abs(x - oldTail[k]) < 1e-5)
      )
        return {
          ...b,
          head: b.head.map((x, k) => x + moved[k]),
          tail: b.tail.map((x, k) => x + moved[k]),
        };
      return b;
    });
    this.commit(
      this.E.docs.updateObject(this.doc, armId, { bones }),
      'Move bone',
      { merge: 'gizmo' },
    );
    if (final) this.seal();
  },

  // ─── Templates ─────────────────────────────────────────────────────

  get templates() {
    return Object.entries(this.E.rig.RIG_TEMPLATES).map(([value, label]) => ({
      value,
      label,
    }));
  },

  // Builds a template rig fitted to the selected mesh (or a default size),
  // with controllers for hands, feet, elbows, knees, head, spine and hips.
  generateRig(kind = this.rig.template) {
    const target = this.isMesh ? this.obj : null;
    let box = { min: [-0.5, 0, -0.3], max: [0.5, 2, 0.3] };
    let at = [0, 0, 0];
    if (target) {
      const m = this.E.docs.worldMatrix(this.doc, target.id);
      const mesh = this.evaluator.mesh(this.doc, target.id);
      const e = m.elements;
      const pts = mesh.v.map(([x, y, z]) => [
        e[0] * x + e[4] * y + e[8] * z + e[12],
        e[1] * x + e[5] * y + e[9] * z + e[13],
        e[2] * x + e[6] * y + e[10] * z + e[14],
      ]);
      const min = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k])));
      const max = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])));
      at = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
      box = {
        min: [min[0] - at[0], 0, min[2] - at[2]],
        max: [max[0] - at[0], max[1] - min[1], max[2] - at[2]],
      };
    }
    const { bones, controls, follows } = this.E.rig.buildTemplate(kind, box);
    let [doc, armId] = this.E.docs.createObject(this.doc, 'armature', {
      name: `${this.E.rig.RIG_TEMPLATES[kind]} rig`,
      pos: at,
      bones,
    });
    const byRole = new Map();
    for (const c of controls) {
      let id;
      [doc, id] = this.E.docs.createObject(
        doc,
        'control',
        {
          name: c.name,
          pos: c.pos,
          control: {
            shape: c.shape,
            size: c.size,
            color: c.color,
            role: c.role,
          },
        },
        armId,
      );
      byRole.set(`${c.role.kind}:${c.role.bone}`, id);
    }
    // IK on each limb's lower bone, with its pole; hands and feet turn
    // with the limb's target.
    const withIK = bones.map((b) => {
      const target = byRole.get(`ik:${b.id}`);
      const follow = follows.find((f) => f.bone === b.id);
      if (follow)
        return {
          ...b,
          constraints: [
            {
              type: 'copyRotation',
              target: byRole.get(`ik:${follow.ikBone}`),
              influence: 1,
              on: true,
            },
          ],
        };
      if (!target) return b;
      const role = controls.find(
        (c) => c.role.kind === 'ik' && c.role.bone === b.id,
      ).role;
      return {
        ...b,
        constraints: [
          {
            type: 'ik',
            target,
            pole: byRole.get(`pole:${b.id}`) ?? null,
            chain: role.chain ?? 2,
            influence: 1,
            on: true,
          },
        ],
      };
    });
    doc = this.E.docs.updateObject(doc, armId, { bones: withIK });
    this.commit(doc, `Generate ${this.E.rig.RIG_TEMPLATES[kind]} rig`);
    this.select([armId]);
    this.rig.boneSel = { arm: armId, active: withIK[0].id, ids: new Set() };
    if (target) {
      this.bindSkin(target.id, armId);
      this.select([armId]);
      this.flash(
        `Rig fitted and bound to “${target.name}”. Drag the coloured controllers to pose it.`,
      );
    } else
      this.flash('Rig added. Select a mesh first to fit and bind a rig to it.');
    if (this.workspace === 'rig' || this.workspace === 'animate')
      this.mode = 'pose';
  },

  // ─── Controllers and constraints ───────────────────────────────────

  // An IK target at the bone's tip (and a pole in front of the chain's middle).
  addIK() {
    const arm = this.armature;
    const b = this.bone;
    if (!arm || !b)
      return this.flash('Select the bone at the end of the chain.');
    const parent = arm.bones.find((x) => x.id === b.parent);
    const len = this.E.rig.boneLength(b);
    let [doc, target] = this.E.docs.createObject(
      this.doc,
      'control',
      {
        name: `${b.name}.IK`,
        pos: [...b.tail],
        control: {
          shape: 'cube',
          size: Math.max(0.05, len * 0.3),
          color: '#ffd23c',
          role: { kind: 'ik', bone: b.id },
        },
      },
      arm.id,
    );
    let pole = null;
    if (parent) {
      const mid = parent.tail;
      [doc, pole] = this.E.docs.createObject(
        doc,
        'control',
        {
          name: `${b.name}.Pole`,
          pos: [mid[0], mid[1], mid[2] + len * 2],
          control: {
            shape: 'diamond',
            size: Math.max(0.03, len * 0.15),
            color: '#b36bff',
            role: { kind: 'pole', bone: b.id },
          },
        },
        arm.id,
      );
    }
    const bones = doc.objects[arm.id].bones.map((x) =>
      x.id === b.id
        ? {
            ...x,
            constraints: [
              ...(x.constraints ?? []),
              { type: 'ik', target, pole, chain: 2, influence: 1, on: true },
            ],
          }
        : x,
    );
    this.commit(this.E.docs.updateObject(doc, arm.id, { bones }), 'Add IK');
  },

  addFKControl() {
    const arm = this.armature;
    const b = this.bone;
    if (!arm || !b) return;
    const len = this.E.rig.boneLength(b);
    const [doc] = this.E.docs.createObject(
      this.doc,
      'control',
      {
        name: `${b.name}.FK`,
        pos: [...b.head],
        control: {
          shape: 'circle',
          size: Math.max(0.05, len * 0.6),
          color: '#ffd23c',
          role: { kind: 'fk', bone: b.id },
        },
      },
      arm.id,
    );
    this.commit(doc, 'Add FK control');
  },

  addConstraint(type) {
    const b = this.bone;
    if (!b) return;
    const c =
      type === 'ik'
        ? { type, target: null, pole: null, chain: 2, influence: 1, on: true }
        : { type, target: null, influence: 1, on: true };
    this.setBone('constraints', [...(b.constraints ?? []), c], true);
  },

  setConstraint(index, key, value, final) {
    const b = this.bone;
    const constraints = b.constraints.map((c, i) =>
      i === index ? { ...c, [key]: value } : c,
    );
    this.setBone('constraints', constraints, final);
  },

  removeConstraint(index) {
    const b = this.bone;
    this.setBone(
      'constraints',
      b.constraints.filter((_, i) => i !== index),
      true,
    );
  },

  setControl(key, value, final) {
    const o = this.obj;
    if (o?.type !== 'control') return;
    this.commit(
      this.E.docs.updateObject(this.doc, o.id, {
        control: { ...o.control, [key]: value },
      }),
      'Controller',
      { merge: `ctl:${key}` },
    );
    if (final) this.seal();
  },

  // Snaps the IK chain's result into the bones' FK pose (so switching to FK
  // doesn't jump).
  ikToFK() {
    const arm = this.armature;
    if (!arm || !this.view) return;
    const n = this.view.nodes.get(arm.id);
    if (!n?.posed) return;
    const pose = { ...arm.pose };
    for (const b of this.E.rig.sortBones(arm.bones)) {
      const m = n.posed.get(b.id);
      const parent = b.parent ? n.posed.get(b.parent) : null;
      pose[b.id] = this.E.rig.poseFromWorld(b, arm.bones, m, parent);
    }
    this.commit(
      this.E.docs.updateObject(this.doc, arm.id, { pose }),
      'IK to FK',
    );
  },

  // ─── Posing ────────────────────────────────────────────────────────

  poseBones(armId, poses, final) {
    const arm = this.doc.objects[armId];
    const pose = { ...arm.pose, ...poses };
    this.commit(this.E.docs.updateObject(this.doc, armId, { pose }), 'Pose', {
      merge: 'gizmo',
    });
    if (final) {
      this.autoKeyBones(armId, Object.keys(poses));
      this.seal();
    }
  },

  resetPose(all = false) {
    const arm = this.armature;
    if (!arm) return;
    const ids = all
      ? null
      : this.rig.boneSel?.ids.size
        ? this.rig.boneSel.ids
        : this.bone
          ? new Set([this.bone.id])
          : null;
    const pose = ids
      ? Object.fromEntries(
          Object.entries(arm.pose ?? {}).filter(([id]) => !ids.has(id)),
        )
      : {};
    this.commit(
      this.E.docs.updateObject(this.doc, arm.id, { pose }),
      all || !ids ? 'Reset pose' : 'Reset bones',
    );
    if (this.workspace === 'animate' && this.autoKey)
      this.autoKeyBones(arm.id, ids ? [...ids] : arm.bones.map((b) => b.id));
  },

  copyPose() {
    const arm = this.armature;
    if (!arm) return;
    this.rig.poseClipboard = this.E.anim.capturePose(arm);
    this.flash('Pose copied.');
  },

  pastePose(mirror = false) {
    const arm = this.armature;
    if (!arm || !this.rig.poseClipboard) return;
    const pose = this.E.anim.applyPose(arm, this.rig.poseClipboard, { mirror });
    this.commit(
      this.E.docs.updateObject(this.doc, arm.id, { pose }),
      mirror ? 'Paste mirrored pose' : 'Paste pose',
    );
    if (this.workspace === 'animate' && this.autoKey)
      this.autoKeyBones(
        arm.id,
        arm.bones.map((b) => b.id),
      );
  },

  mirrorPose() {
    const arm = this.armature;
    if (!arm) return;
    this.commit(
      this.E.docs.updateObject(this.doc, arm.id, {
        pose: this.E.anim.mirrorPose(arm),
      }),
      'Mirror pose',
    );
  },

  get poseLibrary() {
    return this.doc.poses ?? [];
  },

  savePose() {
    const arm = this.armature;
    if (!arm) return;
    const name = `Pose ${(this.doc.poses?.length ?? 0) + 1}`;
    let thumb = null;
    try {
      thumb = this.view?.snapshot(96, 96).toDataURL('image/jpeg', 0.6) ?? null;
    } catch {
      thumb = null;
    }
    const entry = {
      id: this.E.docs.newId('pose'),
      name,
      bones: this.E.anim.capturePose(arm),
      thumb,
    };
    this.commit(
      { ...this.doc, poses: [...(this.doc.poses ?? []), entry] },
      'Save pose',
    );
  },

  applyLibraryPose(id, mirror = false) {
    const arm = this.armature;
    const entry = this.doc.poses.find((p) => p.id === id);
    if (!arm || !entry) return;
    const pose = this.E.anim.applyPose(arm, entry.bones, { mirror });
    this.commit(
      this.E.docs.updateObject(this.doc, arm.id, { pose }),
      `Apply ${entry.name}`,
    );
    if (this.workspace === 'animate' && this.autoKey)
      this.autoKeyBones(
        arm.id,
        arm.bones.map((b) => b.id),
      );
  },

  renamePose(id, e) {
    const name = e.target.value.trim();
    if (!name) return;
    this.commit(
      {
        ...this.doc,
        poses: this.doc.poses.map((p) => (p.id === id ? { ...p, name } : p)),
      },
      'Rename pose',
    );
  },

  deletePose(id) {
    this.commit(
      { ...this.doc, poses: this.doc.poses.filter((p) => p.id !== id) },
      'Delete pose',
    );
  },

  // ─── Skinning and weights ──────────────────────────────────────────

  // Binds a mesh to an armature with automatic weights.
  bindSkin(meshId = this.active, armId = this.armature?.id) {
    const o = this.doc.objects[meshId];
    const arm = this.doc.objects[armId];
    if (o?.type !== 'mesh' || !arm)
      return this.flash('Select a mesh (and have an armature) to bind.');
    const mesh = this.evaluator.mesh(this.doc, meshId);
    const toArm = this.E.docs
      .worldMatrix(this.doc, armId)
      .invert()
      .multiply(this.E.docs.worldMatrix(this.doc, meshId));
    const e = toArm.elements;
    const skin = this.E.rig.autoWeights(mesh, arm.bones, ([x, y, z]) => [
      e[0] * x + e[4] * y + e[8] * z + e[12],
      e[1] * x + e[5] * y + e[9] * z + e[13],
      e[2] * x + e[6] * y + e[10] * z + e[14],
    ]);
    this.commit(
      this.E.docs.updateObject(this.doc, meshId, {
        skin: { armature: armId, ...skin },
      }),
      'Bind with automatic weights',
    );
    this.rig.skinVersion++;
  },

  bindSelected() {
    const arm =
      this.selectedObjects.find((o) => o.type === 'armature') ?? this.armature;
    const meshes = this.selectedObjects.filter((o) => o.type === 'mesh');
    if (!arm || !meshes.length)
      return this.flash('Select the mesh(es) and the armature, then bind.');
    for (const m of meshes) this.bindSkin(m.id, arm.id);
    this.flash(
      `Bound ${meshes.length} mesh${meshes.length > 1 ? 'es' : ''} to “${arm.name}”.`,
    );
  },

  unbindSkin() {
    const o = this.obj;
    if (!o?.skin) return;
    this.commit(
      this.E.docs.updateObject(this.doc, o.id, { skin: null }),
      'Unbind',
    );
  },

  get skinnedMesh() {
    const o = this.obj;
    if (o?.type === 'mesh' && o.skin) return o;
    return null;
  },

  get weightGroups() {
    const o = this.skinnedMesh;
    if (!o) return [];
    const arm = this.doc.objects[o.skin.armature];
    return (arm?.bones ?? [])
      .filter((b) => b.deform !== false)
      .map((b) => ({ name: b.name, active: b.name === this.rig.weightGroup }));
  },

  ensureWeightGroup() {
    const o = this.obj;
    if (!o?.skin) return;
    const arm = this.doc.objects[o.skin.armature];
    if (
      !this.rig.weightGroup ||
      !arm?.bones.some((b) => b.name === this.rig.weightGroup)
    )
      this.rig.weightGroup =
        arm?.bones.find((b) => b.deform !== false)?.name ?? null;
  },

  setWeightGroup(name) {
    this.rig.weightGroup = name;
    const arm = this.skinnedMesh
      ? this.doc.objects[this.skinnedMesh.skin.armature]
      : null;
    const b = arm?.bones.find((x) => x.name === name);
    if (b)
      this.rig.boneSel = { arm: arm.id, active: b.id, ids: new Set([b.id]) };
  },

  // Enters weight painting on a skinned mesh.
  paintWeights() {
    const o = this.obj;
    if (o?.type !== 'mesh') {
      // From the armature: pick the first mesh skinned to it.
      const arm = this.armature;
      const m = Object.values(this.doc.objects).find(
        (x) => x.skin?.armature === arm?.id,
      );
      if (!m) return this.flash('Bind a mesh to the armature first.');
      this.select([m.id]);
    }
    if (!this.obj.skin)
      return this.flash('Bind this mesh to an armature first.');
    this.ensureWeightGroup();
    this.mode = 'weight';
  },

  currentSkin() {
    const o = this.obj;
    if (!o?.skin) return null;
    const mesh = this.evaluator.mesh(this.doc, o.id);
    return { o, mesh, skin: this.E.rig.remapSkin(o.skin, mesh) };
  },

  commitSkin(skin, label, merge = null) {
    const o = this.obj;
    this.commit(
      this.E.docs.updateObject(this.doc, o.id, {
        skin: { ...o.skin, ...skin },
      }),
      label,
      { merge },
    );
    this.rig.weightVersion++;
    this.rig.skinVersion++;
  },

  weightStroke(phase, hit) {
    if (phase === 'start') {
      const cur = this.currentSkin();
      if (!cur || !hit || !this.rig.weightGroup) return;
      this.weighting = {
        ...cur,
        nb: this.E.mesh.neighbours(cur.mesh),
        last: null,
        id: this.E.docs.newId('ws'),
      };
    }
    const w = this.weighting;
    if (!w) return;
    if ((phase === 'start' || phase === 'move') && hit) {
      const b = this.weightBrush;
      const r = b.size * hit.localPerPx;
      if (
        w.last &&
        Math.hypot(
          hit.point[0] - w.last[0],
          hit.point[1] - w.last[1],
          hit.point[2] - w.last[2],
        ) <
          r * 0.2
      )
        return;
      w.last = hit.point;
      const name = this.rig.weightGroup;
      const arr = w.skin.groups[name] ?? new Float32Array(w.skin.n);
      const next = this.E.sculpt.weightDab(
        w.mesh,
        arr,
        w.nb,
        hit.point,
        r,
        {
          tool: b.tool,
          strength: b.strength,
          value: b.value,
          hardness: b.hardness,
          falloff: b.falloff,
        },
        b.symmetry,
      );
      w.skin = { ...w.skin, groups: { ...w.skin.groups, [name]: next } };
      this.commitSkin(w.skin, 'Paint weights', `weights:${w.id}`);
    }
    if (phase === 'end') {
      if (this.weightBrush.autoNormalize && w.skin)
        this.commitSkin(
          this.E.rig.normalizeSkin(w.skin, new Set([this.rig.weightGroup])),
          'Paint weights',
          `weights:${w.id}`,
        );
      this.weighting = null;
      this.seal();
    }
  },

  normalizeWeights() {
    const cur = this.currentSkin();
    if (!cur) return;
    this.commitSkin(this.E.rig.normalizeSkin(cur.skin), 'Normalize weights');
  },

  mirrorWeights(fromPositive = true) {
    const cur = this.currentSkin();
    if (!cur) return;
    this.commitSkin(
      this.E.rig.mirrorSkin(cur.skin, cur.mesh, { fromPositive }),
      'Mirror weights',
    );
  },

  autoWeightsAgain() {
    const o = this.obj;
    if (!o?.skin) return;
    this.bindSkin(o.id, o.skin.armature);
  },

  smoothWeights() {
    const cur = this.currentSkin();
    if (!cur || !this.rig.weightGroup) return;
    const nb = this.E.mesh.neighbours(cur.mesh);
    const next = this.E.rig.smoothGroup(cur.skin, this.rig.weightGroup, nb, {
      strength: 0.5,
      iterations: 3,
    });
    this.commitSkin(next, 'Smooth weights');
  },

  clearGroup() {
    const cur = this.currentSkin();
    if (!cur || !this.rig.weightGroup) return;
    this.commitSkin(
      {
        ...cur.skin,
        groups: {
          ...cur.skin.groups,
          [this.rig.weightGroup]: new Float32Array(cur.skin.n),
        },
      },
      'Clear weights',
    );
  },

  // Copies weights from another selected, skinned mesh onto this one.
  transferWeights() {
    const to = this.obj;
    const from = this.selectedObjects.find(
      (o) => o.id !== to?.id && o.type === 'mesh' && o.skin,
    );
    if (to?.type !== 'mesh' || !from)
      return this.flash(
        'Select the skinned source mesh, then the target mesh last.',
      );
    const world = (id) => {
      const m = this.E.docs.worldMatrix(this.doc, id).elements;
      return this.evaluator
        .mesh(this.doc, id)
        .v.map(([x, y, z]) => [
          m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14],
        ]);
    };
    const fromMesh = this.evaluator.mesh(this.doc, from.id);
    const fromSkin = this.E.rig.remapSkin(from.skin, fromMesh);
    const toMesh = this.evaluator.mesh(this.doc, to.id);
    const skin = this.E.rig.transferSkin(
      fromSkin,
      world(from.id),
      toMesh,
      world(to.id),
    );
    this.commit(
      this.E.docs.updateObject(this.doc, to.id, {
        skin: { armature: from.skin.armature, ...skin },
      }),
      'Transfer weights',
    );
    this.rig.skinVersion++;
  },
};
