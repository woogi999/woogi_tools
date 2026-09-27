// Animation: clips, playback, keyframes, onion skinning and retargeting.
// Mixed into StudioState (state.js).

import { tracked } from '@glimmer/tracking';

class AnimState {
  @tracked frame = 0;
  @tracked playing = false;
  @tracked speed = 1;
  @tracked autoKey = true;
  @tracked keySel = new Set();
  @tracked clipboard = null;
  @tracked view = 'dope';
  @tracked onion = { on: false, before: 2, after: 2, step: 3 };
  @tracked onlySelected = false;
  @tracked retarget = null;
  @tracked graphComps = null;
  @tracked dragging = null; // { objects: Set, bones: Set } hidden from playback while dragged
}

const PROP_OF_TOOL = { move: 'pos', rotate: 'rot', scale: 'scl' };

export default {
  init() {
    this.anim = new AnimState();
  },

  get frame() {
    return this.anim.frame;
  },
  get playing() {
    return this.anim.playing;
  },
  get autoKey() {
    return this.anim.autoKey;
  },

  get clip() {
    const id = this.doc?.activeClip;
    return id ? (this.doc.clips[id] ?? null) : null;
  },

  get clips() {
    return (this.doc?.clipOrder ?? [])
      .map((id) => this.doc.clips[id])
      .filter(Boolean);
  },

  // Animation shows in the Animate workspace; elsewhere you see (and edit)
  // the scene as it's stored.
  get animating() {
    return this.workspace === 'animate' && !!this.clip;
  },

  get overrides() {
    if (!this.animating) return null;
    const ev = this.E.anim.evaluateClip(this.clip, this.anim.frame, this.doc);
    const d = this.anim.dragging;
    if (d) {
      for (const id of d.objects ?? []) delete ev.objects[id];
      for (const [arm, ids] of Object.entries(d.bones ?? {}))
        for (const id of ids) delete ev.bones[arm]?.[id];
    }
    return ev;
  },

  get onionState() {
    const o = this.anim.onion;
    if (!o.on || !this.animating || this.anim.playing) return null;
    const frames = [];
    const clip = this.clip;
    for (let i = 1; i <= o.before; i++) {
      const f = this.anim.frame - i * o.step;
      if (f < clip.start && !clip.loop) break;
      frames.push({
        frame: f,
        overrides: this.E.anim.evaluateClip(
          clip,
          this.E.anim.clipFrame(clip, f),
          this.doc,
        ),
        tint: '#ff5c72',
        opacity: 0.28 / i,
      });
    }
    for (let i = 1; i <= o.after; i++) {
      const f = this.anim.frame + i * o.step;
      if (f > clip.end && !clip.loop) break;
      frames.push({
        frame: f,
        overrides: this.E.anim.evaluateClip(
          clip,
          this.E.anim.clipFrame(clip, f),
          this.doc,
        ),
        tint: '#3ad29f',
        opacity: 0.28 / i,
      });
    }
    return {
      key: `${refKey(clip)}|${refKey(this.doc)}|${this.anim.frame}|${o.before}|${o.after}|${o.step}`,
      frames,
    };
  },

  // ─── Clips ─────────────────────────────────────────────────────────

  ensureClip() {
    if (this.clip) return;
    if (this.clips.length) return this.setActiveClip(this.clips[0].id);
    this.addClip('Action');
  },

  addClip(name) {
    const clip = this.E.anim.newClip(
      typeof name === 'string' ? name : `Clip ${this.clips.length + 1}`,
    );
    this.commit(
      {
        ...this.doc,
        clips: { ...this.doc.clips, [clip.id]: clip },
        clipOrder: [...this.doc.clipOrder, clip.id],
        activeClip: clip.id,
      },
      'New clip',
    );
    this.anim.frame = clip.start;
    this.anim.keySel = new Set();
  },

  duplicateClip() {
    const src = this.clip;
    if (!src) return;
    const clip = {
      ...structuredClone(src),
      id: this.E.docs.newId('clip'),
      name: `${src.name} copy`,
    };
    this.commit(
      {
        ...this.doc,
        clips: { ...this.doc.clips, [clip.id]: clip },
        clipOrder: [...this.doc.clipOrder, clip.id],
        activeClip: clip.id,
      },
      'Duplicate clip',
    );
  },

  deleteClip(id = this.doc.activeClip) {
    if (!id) return;
    const clips = { ...this.doc.clips };
    delete clips[id];
    const clipOrder = this.doc.clipOrder.filter((c) => c !== id);
    this.commit(
      { ...this.doc, clips, clipOrder, activeClip: clipOrder[0] ?? null },
      'Delete clip',
    );
    this.anim.keySel = new Set();
  },

  setActiveClip(id) {
    if (id === this.doc.activeClip) return;
    this.stop();
    this.doc = { ...this.doc, activeClip: id };
    this.anim.keySel = new Set();
    const c = this.doc.clips[id];
    if (c)
      this.anim.frame = Math.max(c.start, Math.min(c.end, this.anim.frame));
  },

  pickClip(e) {
    this.setActiveClip(e.target.value);
  },

  setClip(key, value, final = true) {
    const c = this.clip;
    if (!c) return;
    let v = value;
    if (key === 'start') v = Math.min(Math.round(value), c.end - 1);
    if (key === 'end') v = Math.max(Math.round(value), c.start + 1);
    this.putClip({ ...c, [key]: v }, 'Clip settings', `clip:${key}`);
    if (final) this.seal();
  },

  renameClip(e) {
    const name = e.target.value.trim();
    if (name && this.clip) this.putClip({ ...this.clip, name }, 'Rename clip');
  },

  putClip(clip, label, merge = null) {
    this.commit(
      { ...this.doc, clips: { ...this.doc.clips, [clip.id]: clip } },
      label,
      { merge },
    );
  },

  setFps(value, final) {
    this.commit(
      { ...this.doc, fps: Math.max(1, Math.round(value)) },
      'Frame rate',
      { merge: 'fps' },
    );
    if (final) this.seal();
  },

  // ─── Playback ──────────────────────────────────────────────────────

  setFrame(f) {
    const c = this.clip;
    this.anim.frame = c
      ? Math.max(c.start, Math.min(c.end, Math.round(f)))
      : Math.round(f);
  },

  stepFrame(d) {
    const c = this.clip;
    if (!c) return;
    let f = this.anim.frame + d;
    if (c.loop) f = this.E.anim.clipFrame(c, f);
    this.setFrame(f);
  },

  jump(where) {
    const c = this.clip;
    if (!c) return;
    if (where === 'start') this.setFrame(c.start);
    else if (where === 'end') this.setFrame(c.end);
    else {
      const frames = this.E.anim.keyFrames(c);
      const f = this.anim.frame;
      const next =
        where === 'next'
          ? frames.find((x) => x > f)
          : [...frames].reverse().find((x) => x < f);
      if (next !== undefined) this.setFrame(next);
    }
  },

  togglePlay() {
    if (this.anim.playing) this.stop();
    else this.play();
  },

  play() {
    const c = this.clip;
    if (!c) return;
    if (!c.loop && this.anim.frame >= c.end) this.anim.frame = c.start;
    this.anim.playing = true;
    let t = this.anim.frame;
    let last = performance.now();
    const tick = (now) => {
      if (!this.anim.playing) return;
      const clip = this.clip;
      if (!clip) return this.stop();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      t += dt * (this.doc.fps || 24) * this.anim.speed * (clip.speed ?? 1);
      if (!clip.loop && t >= clip.end) {
        this.anim.frame = clip.end;
        return this.stop();
      }
      const f = Math.round(this.E.anim.clipFrame(clip, t));
      if (f !== this.anim.frame) this.anim.frame = f;
      this.playFrame = requestAnimationFrame(tick);
    };
    this.playFrame = requestAnimationFrame(tick);
  },

  stop() {
    this.anim.playing = false;
    cancelAnimationFrame(this.playFrame);
  },

  setSpeed(v) {
    this.anim.speed = Number(v);
  },

  toggleAutoKey() {
    this.anim.autoKey = !this.anim.autoKey;
  },

  // ─── Keys ──────────────────────────────────────────────────────────

  // What an object shows right now (animation included).
  shown(o, prop) {
    return this.overrides?.objects?.[o.id]?.[prop] ?? o[prop];
  },

  hasTrack(target, prop) {
    return !!this.clip?.tracks.some(
      (t) => t.prop === prop && this.E.anim.sameTarget(t.target, target),
    );
  },

  // Keys the selection (bones in pose mode, else objects) at the playhead.
  insertKeys(props = ['pos', 'rot', 'scl']) {
    if (!this.clip) this.ensureClip();
    let clip = this.clip;
    const f = this.anim.frame;
    let n = 0;
    if (
      (this.mode === 'pose' || this.boneSel?.ids?.size) &&
      this.boneSel?.arm
    ) {
      const arm = this.doc.objects[this.boneSel.arm];
      const ids = this.boneSel.ids.size
        ? [...this.boneSel.ids]
        : this.boneSel.active
          ? [this.boneSel.active]
          : [];
      const animated = this.overrides?.bones?.[arm.id] ?? {};
      for (const id of ids) {
        const p = {
          ...this.E.rig.EMPTY_POSE,
          ...arm.pose?.[id],
          ...animated[id],
        };
        for (const prop of props) {
          clip = this.E.anim.setKey(
            clip,
            { kind: 'bone', arm: arm.id, bone: id },
            prop,
            f,
            p[{ pos: 'p', rot: 'r', scl: 's' }[prop]],
          );
          n++;
        }
      }
    } else {
      for (const o of this.selectedObjects) {
        for (const prop of props) {
          clip = this.E.anim.setKey(
            clip,
            { kind: 'object', id: o.id },
            prop,
            f,
            this.shown(o, prop),
          );
          n++;
        }
      }
    }
    if (!n) return this.flash('Select objects or bones to key.');
    this.putClip(clip, 'Insert keys');
    this.flash(`Keyed ${n} channel${n > 1 ? 's' : ''} at frame ${f}.`);
  },

  // After a transform in the Animate workspace: key what moved, if auto-key
  // is on or that channel is already animated.
  autoKeyObjects(ids, prop = PROP_OF_TOOL[this.tool] ?? 'pos') {
    this.anim.dragging = null;
    if (!this.animating) return;
    let clip = this.clip;
    let n = 0;
    for (const id of ids) {
      const o = this.doc.objects[id];
      const target = { kind: 'object', id };
      if (!o || !(this.anim.autoKey || this.hasTrack(target, prop))) continue;
      clip = this.E.anim.setKey(clip, target, prop, this.anim.frame, o[prop]);
      n++;
    }
    if (n) this.putClip(clip, 'Auto key', 'gizmo');
  },

  autoKeyBones(armId, ids, props = null) {
    this.anim.dragging = null;
    if (!this.animating) return;
    const arm = this.doc.objects[armId];
    const want = props ?? [
      this.tool === 'move' ? 'pos' : this.tool === 'scale' ? 'scl' : 'rot',
    ];
    let clip = this.clip;
    let n = 0;
    for (const id of ids) {
      const p = { ...this.E.rig.EMPTY_POSE, ...arm.pose?.[id] };
      for (const prop of want) {
        const target = { kind: 'bone', arm: armId, bone: id };
        if (!(this.anim.autoKey || this.hasTrack(target, prop))) continue;
        clip = this.E.anim.setKey(
          clip,
          target,
          prop,
          this.anim.frame,
          p[{ pos: 'p', rot: 'r', scl: 's' }[prop]],
        );
        n++;
      }
    }
    if (n) this.putClip(clip, 'Auto key', 'gizmo');
  },

  // While a gizmo drags something, playback lets go of it so it can move.
  beginAnimDrag() {
    if (!this.animating) return;
    const bones = {};
    if (this.boneSel?.arm && (this.mode === 'pose' || this.mode === 'bones'))
      bones[this.boneSel.arm] = this.boneSel.ids.size
        ? [...this.boneSel.ids]
        : [this.boneSel.active];
    this.anim.dragging = {
      objects: this.mode === 'object' ? [...this.selected] : [],
      bones,
    };
  },

  keyVisibility(id = this.active) {
    const o = this.doc.objects[id];
    if (!o) return;
    if (!this.clip) this.ensureClip();
    const vis = this.shown(o, 'visible') !== false;
    this.putClip(
      this.E.anim.setKey(
        this.clip,
        { kind: 'object', id },
        'visible',
        this.anim.frame,
        [vis ? 1 : 0],
        { i: 'constant' },
      ),
      'Key visibility',
    );
  },

  keyMaterial(prop) {
    const m = this.mat;
    if (!m) return;
    if (!this.clip) this.ensureClip();
    const shown = this.overrides?.materials?.[m.id]?.[prop] ?? m[prop];
    const value = prop === 'color' ? this.E.anim.hexToRgb(shown) : [shown];
    this.putClip(
      this.E.anim.setKey(
        this.clip,
        { kind: 'material', id: m.id },
        prop,
        this.anim.frame,
        value,
      ),
      `Key ${prop}`,
    );
    this.flash(`Keyed ${m.name} ${prop} at frame ${this.anim.frame}.`);
  },

  keyInfluence(boneId, value) {
    const arm = this.armature;
    if (!arm) return;
    if (!this.clip) this.ensureClip();
    this.putClip(
      this.E.anim.setKey(
        this.clip,
        { kind: 'bone', arm: arm.id, bone: boneId },
        'influence',
        this.anim.frame,
        [value],
      ),
      'Key IK/FK',
    );
  },

  // ─── Dope sheet and graph ──────────────────────────────────────────

  get timelineRows() {
    const clip = this.clip;
    if (!clip) return [];
    const A = this.E.anim;
    const sel = new Set(this.selected);
    const bones = this.boneSel;
    const rows = [];
    const groups = new Map();
    for (const t of clip.tracks) {
      const tg = t.target;
      if (this.anim.onlySelected) {
        const on =
          tg.kind === 'object'
            ? sel.has(tg.id)
            : tg.kind === 'bone'
              ? bones?.arm === tg.arm &&
                (bones.ids.has(tg.bone) || bones.active === tg.bone)
              : tg.id === this.mat?.id;
        if (!on) continue;
      }
      const gk =
        tg.kind === 'bone' ? `b:${tg.arm}:${tg.bone}` : `${tg.kind}:${tg.id}`;
      if (!groups.has(gk)) {
        const name = A.trackLabel(t, this.doc).split(' · ')[0];
        groups.set(gk, { key: gk, name, kind: tg.kind, tracks: [] });
      }
      groups.get(gk).tracks.push(t);
    }
    for (const g of groups.values()) {
      rows.push({
        kind: 'group',
        key: g.key,
        label: g.name,
        type: g.kind,
        keys: [...new Set(g.tracks.flatMap((t) => t.keys.map((k) => k.f)))],
        tracks: g.tracks,
      });
      for (const t of g.tracks)
        rows.push({
          kind: 'track',
          key: t.id,
          label: A.PROPS[t.prop]?.label ?? t.prop,
          track: t,
        });
    }
    return rows;
  },

  selectKeys(refs, { add = false, toggle = false } = {}) {
    let next = add || toggle ? new Set(this.anim.keySel) : new Set();
    for (const r of refs) {
      if (toggle && next.has(r)) next.delete(r);
      else next.add(r);
    }
    this.anim.keySel = next;
  },

  selectAllKeys() {
    const refs = [];
    for (const t of this.clip?.tracks ?? [])
      for (const k of t.keys) refs.push(this.E.anim.keyRef(t, k));
    this.anim.keySel =
      this.anim.keySel.size === refs.length ? new Set() : new Set(refs);
  },

  // Dragging keys along the timeline: `df` is from where the drag started.
  dragKeys(df, final, { copy = false } = {}) {
    if (!this.keyDrag)
      this.keyDrag = { clip: this.clip, sel: this.anim.keySel };
    const { clip, sel } = this.keyDrag;
    const r = this.E.anim.moveKeys(clip, sel, df, { copy });
    this.putClip(r.clip, copy ? 'Duplicate keys' : 'Move keys', 'keydrag');
    this.anim.keySel = r.selection;
    if (final) {
      this.keyDrag = null;
      this.seal();
    }
  },

  deleteKeys() {
    if (!this.anim.keySel.size || !this.clip) return;
    this.putClip(
      this.E.anim.deleteKeys(this.clip, this.anim.keySel),
      'Delete keys',
    );
    this.anim.keySel = new Set();
  },

  copyKeys() {
    this.anim.clipboard = this.E.anim.copyKeys(this.clip, this.anim.keySel);
    if (this.anim.clipboard) this.flash('Keys copied.');
  },

  pasteKeys() {
    if (!this.anim.clipboard || !this.clip) return;
    const r = this.E.anim.pasteKeys(
      this.clip,
      this.anim.clipboard,
      this.anim.frame,
    );
    this.putClip(r.clip, 'Paste keys');
    this.anim.keySel = r.selection;
  },

  duplicateKeys() {
    this.copyKeys();
    this.pasteKeys();
  },

  setKeyInterp(i) {
    if (!this.anim.keySel.size) return this.flash('Select keys first.');
    this.putClip(
      this.E.anim.setKeyProps(this.clip, this.anim.keySel, { i }),
      'Interpolation',
    );
  },

  setKeyEase(e) {
    if (!this.anim.keySel.size) return this.flash('Select keys first.');
    this.putClip(
      this.E.anim.setKeyProps(this.clip, this.anim.keySel, { e, i: 'bezier' }),
      'Easing',
    );
  },

  setTimelineView(v) {
    this.anim.view = v;
  },

  toggleOnlySelected() {
    this.anim.onlySelected = !this.anim.onlySelected;
  },

  // Graph editor: moves one key in time and value.
  graphMoveKey(trackId, frame, comp, newFrame, value, final) {
    if (!this.graphDrag) this.graphDrag = { clip: this.clip };
    const clip = this.graphDrag.clip;
    const tracks = clip.tracks.map((t) => {
      if (t.id !== trackId) return t;
      const keys = t.keys.map((k) => {
        if (k.f !== frame) return k;
        const v = [...k.v];
        v[comp] = value;
        return { ...k, f: Math.round(newFrame), v };
      });
      // Don't let two keys share a frame.
      const seen = new Set();
      const kept = keys.filter(
        (k) =>
          (k.f === Math.round(newFrame) || !seen.has(k.f)) &&
          (seen.add(k.f), true),
      );
      return { ...t, keys: kept.sort((a, b) => a.f - b.f) };
    });
    this.putClip({ ...clip, tracks }, 'Edit curve', 'graph');
    this.anim.keySel = new Set([`${trackId}@${Math.round(newFrame)}`]);
    if (final) {
      this.graphDrag = null;
      this.seal();
    }
  },

  // Graph editor: drags a tangent handle (slope in value per frame).
  graphSetTangent(trackId, frame, comp, side, slope, final) {
    const clip = this.clip;
    const tracks = clip.tracks.map((t) => {
      if (t.id !== trackId) return t;
      return {
        ...t,
        keys: t.keys.map((k, i) => {
          if (k.f !== frame) return k;
          // Handles take over from automatic easing: start from the current slopes.
          const tin = k.v.map((_, c) =>
            k.e === 'custom'
              ? (k.tin?.[c] ?? 0)
              : this.E.anim.slopeAt(t.keys, i, c, 'in'),
          );
          const tout = k.v.map((_, c) =>
            k.e === 'custom'
              ? (k.tout?.[c] ?? 0)
              : this.E.anim.slopeAt(t.keys, i, c, 'out'),
          );
          (side === 'in' ? tin : tout)[comp] = slope;
          // Aligned handles, as by default in Blender.
          (side === 'in' ? tout : tin)[comp] = slope;
          return { ...k, e: 'custom', i: 'bezier', tin, tout };
        }),
      };
    });
    this.putClip({ ...clip, tracks }, 'Edit tangent', 'tangent');
    if (final) this.seal();
  },

  toggleGraphComp(key) {
    const cur = new Set(this.anim.graphComps ?? []);
    if (cur.has(key)) cur.delete(key);
    else cur.add(key);
    this.anim.graphComps = cur;
  },

  // ─── Onion skin ────────────────────────────────────────────────────

  toggleOnion() {
    this.anim.onion = { ...this.anim.onion, on: !this.anim.onion.on };
  },

  setOnion(key, value) {
    this.anim.onion = {
      ...this.anim.onion,
      [key]: Math.max(key === 'step' ? 1 : 0, Math.round(value)),
    };
  },

  // ─── Retargeting ───────────────────────────────────────────────────

  get armatures() {
    return Object.values(this.doc.objects).filter((o) => o.type === 'armature');
  },

  openRetarget() {
    const arms = this.armatures;
    if (arms.length < 2)
      return this.flash(
        'Retargeting needs two armatures: one with the animation, one to receive it.',
      );
    const clip = this.clip ?? this.clips[0];
    const src =
      arms.find((a) => clip?.tracks.some((t) => t.target.arm === a.id)) ??
      arms[0];
    const dst = arms.find((a) => a.id !== src.id);
    this.anim.retarget = {
      src: src.id,
      dst: dst.id,
      clip: clip?.id ?? null,
      map: this.E.anim.autoBoneMap(src.bones, dst.bones),
    };
    this.dialog = 'retarget';
  },

  setRetarget(key, value) {
    const r = { ...this.anim.retarget, [key]: value };
    if (key === 'src' || key === 'dst') {
      const s = this.doc.objects[r.src];
      const d = this.doc.objects[r.dst];
      r.map = s && d ? this.E.anim.autoBoneMap(s.bones, d.bones) : {};
    }
    this.anim.retarget = r;
  },

  setRetargetBone(srcName, e) {
    const map = { ...this.anim.retarget.map };
    if (e.target.value) map[srcName] = e.target.value;
    else delete map[srcName];
    this.anim.retarget = { ...this.anim.retarget, map };
  },

  runRetarget() {
    const r = this.anim.retarget;
    const clip = this.doc.clips[r.clip];
    const src = this.doc.objects[r.src];
    const dst = this.doc.objects[r.dst];
    if (!clip || !src || !dst)
      return this.flash('Pick a clip and two armatures.');
    const height = (arm) => {
      const ys = arm.bones.flatMap((b) => [b.head[1], b.tail[1]]);
      return Math.max(...ys) - Math.min(...ys) || 1;
    };
    const out = this.E.anim.retargetClip(clip, src, dst, r.map, {
      heightRatio: height(dst) / height(src),
    });
    if (!out.tracks.length)
      return this.flash('No bones matched, so nothing was copied.', 'error');
    this.commit(
      {
        ...this.doc,
        clips: { ...this.doc.clips, [out.id]: out },
        clipOrder: [...this.doc.clipOrder, out.id],
        activeClip: out.id,
      },
      'Retarget',
    );
    this.dialog = null;
    this.flash(`“${out.name}”: ${out.tracks.length} tracks on ${dst.name}.`);
  },

  handleOtherModeKey(e, k, ctrl) {
    if (this.workspace === 'animate' || this.workspace === 'rig') {
      if (k === ' ' && this.workspace === 'animate') {
        e.preventDefault();
        this.togglePlay();
        return true;
      }
      if (!ctrl && k === 'i') {
        this.insertKeys();
        return true;
      }
      if (
        this.workspace === 'animate' &&
        !ctrl &&
        (k === 'arrowleft' || k === 'arrowright')
      ) {
        e.preventDefault();
        if (e.shiftKey) this.jump(k === 'arrowleft' ? 'start' : 'end');
        else this.stepFrame(k === 'arrowleft' ? -1 : 1);
        return true;
      }
      if (
        this.workspace === 'animate' &&
        (k === 'arrowup' || k === 'arrowdown')
      ) {
        e.preventDefault();
        this.jump(k === 'arrowup' ? 'next' : 'prev');
        return true;
      }
      if (this.anim.keySel.size && this.workspace === 'animate') {
        if (k === 'delete' || k === 'backspace' || k === 'x') {
          this.deleteKeys();
          return true;
        }
        if (ctrl && k === 'c') {
          this.copyKeys();
          return true;
        }
        if (ctrl && k === 'd') {
          e.preventDefault();
          this.duplicateKeys();
          return true;
        }
      }
      if (
        ctrl &&
        k === 'v' &&
        this.anim.clipboard &&
        this.workspace === 'animate'
      ) {
        this.pasteKeys();
        return true;
      }
      if (this.mode === 'pose' && ctrl && k === 'c') {
        this.copyPose();
        return true;
      }
      if (this.mode === 'pose' && ctrl && k === 'v') {
        this.pastePose(e.shiftKey);
        return true;
      }
      if (
        (this.mode === 'bones' || this.mode === 'pose') &&
        !ctrl &&
        (k === 'delete' || k === 'x') &&
        this.mode === 'bones'
      ) {
        this.deleteBone();
        return true;
      }
      if (this.mode === 'bones' && !ctrl && k === 'e') {
        this.extrudeBone();
        return true;
      }
    }
    if (
      this.mode === 'sculpt' ||
      this.mode === 'paint' ||
      this.mode === 'weight'
    ) {
      if (k === '[' || k === ']') {
        const which =
          this.mode === 'sculpt'
            ? this.sculptBrush
            : this.mode === 'weight'
              ? this.weightBrush
              : this.brush;
        which.size = Math.max(
          2,
          Math.min(400, Math.round(which.size * (k === ']' ? 1.15 : 1 / 1.15))),
        );
        return true;
      }
    }
    return false;
  },
};

// A stable number per object reference.
const refs = new WeakMap();
let refSeq = 0;
function refKey(o) {
  if (!o) return 0;
  let id = refs.get(o);
  if (id === undefined) refs.set(o, (id = ++refSeq));
  return id;
}
