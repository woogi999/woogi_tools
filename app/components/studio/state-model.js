// Modelling: primitive recipes, the modifier stack, booleans and outlines,
// materials, edit mode and UVs. Mixed into StudioState (state.js).

const setOf = (x) => (x instanceof Set ? x : new Set(x ?? []));

export default {
  // ─── Primitive recipes ─────────────────────────────────────────────

  get primDef() {
    const src = this.obj?.source;
    return src?.kind === 'primitive' ? this.E.PRIMITIVES[src.prim] : null;
  },

  get primValues() {
    const src = this.obj?.source;
    if (src?.kind !== 'primitive') return {};
    return { ...this.E.PRIMITIVES[src.prim].defaults, ...src.params };
  },

  setPrimParam(key, value, final) {
    const o = this.obj;
    if (o?.source?.kind !== 'primitive') return;
    const def = this.E.PRIMITIVES[o.source.prim];
    const params = { ...o.source.params, [key]: value };
    // A cylinder's "radius" moves both ends together.
    if (key === 'radius' && def.radius)
      for (const k of def.radius) params[k] = value;
    this.commit(
      this.E.docs.updateObject(this.doc, o.id, {
        source: { ...o.source, params },
      }),
      `${def.label} ${key}`,
      { merge: `prim:${o.id}:${key}` },
    );
    if (final) this.seal();
  },

  resetPrim() {
    const o = this.obj;
    if (o?.source?.kind !== 'primitive') return;
    this.commit(
      this.E.docs.updateObject(this.doc, o.id, {
        source: { ...o.source, params: {} },
      }),
      'Reset shape',
    );
  },

  // Freezes the recipe into an editable mesh (modifiers stay live).
  convertToMesh(id = this.active, { silent = false } = {}) {
    const o = this.doc.objects[id];
    if (o?.type !== 'mesh' || o.source?.kind === 'mesh') return;
    const mesh = this.evaluator.base(this.doc, id);
    const origin =
      o.source?.kind === 'primitive'
        ? { prim: o.source.prim, params: o.source.params }
        : null;
    this.commit(
      this.E.docs.updateObject(this.doc, id, {
        source: { kind: 'mesh', mesh, origin },
      }),
      'Convert to mesh',
    );
    if (!silent)
      this.flash('Converted to an editable mesh. Modifiers are still live.');
  },

  // Bakes the whole stack into the mesh.
  applyAll(id = this.active) {
    const o = this.doc.objects[id];
    if (o?.type !== 'mesh') return;
    const mesh = this.evaluator.mesh(this.doc, id);
    const cutters = (o.stack ?? [])
      .filter((m) => m.type === 'boolean' && m.params.operand)
      .map((m) => m.params.operand);
    let doc = this.E.docs.updateObject(this.doc, id, {
      source: { kind: 'mesh', mesh },
      stack: [],
    });
    // Cutters that were only there for this object go too.
    if (cutters.length)
      doc = this.E.docs.removeObjects(
        doc,
        cutters.filter((c) => doc.objects[c]?.cutter),
      );
    this.commit(doc, 'Apply modifiers');
  },

  // ─── Modifiers ─────────────────────────────────────────────────────

  get modifierTypes() {
    return this.E.MODIFIER_ORDER.map((type) => ({
      type,
      ...this.E.MODIFIERS[type],
    }));
  },

  get stackRows() {
    const o = this.obj;
    if (o?.type !== 'mesh') return [];
    return (o.stack ?? []).map((m, i, list) => {
      const def = this.E.MODIFIERS[m.type];
      return {
        mod: m,
        def,
        first: i === 0,
        last: i === list.length - 1,
        values: { ...def.defaults, ...m.params },
      };
    });
  },

  get objectChoices() {
    return Object.values(this.doc.objects)
      .filter((o) => o.type === 'mesh' && o.id !== this.active)
      .map((o) => [o.id, o.name]);
  },

  addModifier(type) {
    const o = this.obj;
    if (o?.type !== 'mesh') return;
    if (type === 'boolean') return this.addBoolean('subtract');
    const mod = this.E.newModifier(type);
    this.commit(
      this.E.docs.updateObject(this.doc, o.id, {
        stack: [...(o.stack ?? []), mod],
      }),
      `Add ${this.E.MODIFIERS[type].label}`,
    );
    this.modMenu = false;
  },

  patchMod(modId, fn, label, merge) {
    const o = this.obj;
    const stack = o.stack.map((m) => (m.id === modId ? fn(m) : m));
    this.commit(this.E.docs.updateObject(this.doc, o.id, { stack }), label, {
      merge,
    });
  },

  setModParam(modId, key, value, final) {
    this.patchMod(
      modId,
      (m) => ({ ...m, params: { ...m.params, [key]: value } }),
      'Modifier',
      `mod:${modId}:${key}`,
    );
    if (final) this.seal();
    const err = this.evaluator.errors.get(this.active);
    if (err && final) this.flash(`A modifier couldn’t run (${err}).`, 'error');
  },

  toggleMod(modId) {
    this.patchMod(modId, (m) => ({ ...m, on: !m.on }), 'Toggle modifier');
  },

  moveMod(modId, dir) {
    const o = this.obj;
    const stack = [...o.stack];
    const i = stack.findIndex((m) => m.id === modId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= stack.length) return;
    [stack[i], stack[j]] = [stack[j], stack[i]];
    this.commit(
      this.E.docs.updateObject(this.doc, o.id, { stack }),
      'Reorder modifiers',
    );
  },

  removeMod(modId) {
    const o = this.obj;
    const mod = o.stack.find((m) => m.id === modId);
    let doc = this.E.docs.updateObject(this.doc, o.id, {
      stack: o.stack.filter((m) => m.id !== modId),
    });
    // A cutter made for this boolean goes with it.
    const cutter =
      mod?.type === 'boolean' ? doc.objects[mod.params.operand] : null;
    if (cutter?.cutter && cutter.parent === o.id)
      doc = this.E.docs.removeObjects(doc, [cutter.id]);
    this.commit(doc, 'Remove modifier');
  },

  // Applies the stack up to and including this modifier into the mesh.
  applyMod(modId) {
    const o = this.obj;
    const at = o.stack.findIndex((m) => m.id === modId);
    if (at < 0) return;
    const head = { ...o, stack: o.stack.slice(0, at + 1) };
    const probe = this.E.docs.updateObject(this.doc, o.id, {
      stack: head.stack,
    });
    const mesh = this.evaluator.mesh(probe, o.id);
    this.evaluator.cache.delete(o.id);
    this.commit(
      this.E.docs.updateObject(this.doc, o.id, {
        source: { kind: 'mesh', mesh },
        stack: o.stack.slice(at + 1),
      }),
      `Apply ${this.E.MODIFIERS[o.stack[at].type].label}`,
    );
  },

  // ─── Booleans and outlines ─────────────────────────────────────────

  // A new cutter (a primitive, parented to the target) with a boolean for it.
  addBoolean(op, prim = 'cylinder') {
    const o = this.obj;
    if (o?.type !== 'mesh') return this.flash('Select the mesh to cut first.');
    const [doc, cutter] = this.E.docs.addBoolean(this.doc, o.id, op, prim);
    this.commit(doc, `Boolean ${op}`);
    this.select([cutter]);
    this.tool = 'move';
    this.flash(
      `Move, scale or reshape “${doc.objects[cutter].name}”: the ${op} updates as you go.`,
    );
  },

  // The active object takes the other selected meshes as cutters.
  booleanFromSelection(op) {
    const target = this.active;
    const others = this.selected.filter(
      (id) => id !== target && this.doc.objects[id]?.type === 'mesh',
    );
    if (this.doc.objects[target]?.type !== 'mesh' || !others.length)
      return this.flash('Select the cutters, then the object to cut last.');
    let doc = this.doc;
    const mods = [];
    for (const id of others) {
      doc = this.E.docs.reparent(doc, id, target);
      doc = this.E.docs.updateObject(doc, id, { cutter: true });
      mods.push(this.E.newModifier('boolean', { op, operand: id }));
    }
    const t = doc.objects[target];
    doc = this.E.docs.updateObject(doc, target, {
      stack: [...(t.stack ?? []), ...mods],
    });
    this.commit(doc, `Boolean ${op}`);
    this.select([target]);
  },

  createOutline() {
    const o = this.obj;
    if (o?.type !== 'mesh') return this.flash('Select a mesh to outline.');
    const [doc, id] = this.E.docs.addOutline(this.doc, o.id);
    this.commit(doc, 'Create outline');
    this.select([id]);
    this.flash(
      'Outline created. It follows the model; tune its thickness here.',
    );
  },

  setOutline(key, value, final) {
    const o = this.obj;
    if (o?.source?.kind !== 'outline') return;
    this.commit(
      this.E.docs.updateObject(this.doc, o.id, {
        source: { ...o.source, [key]: value },
      }),
      'Outline',
      { merge: `outline:${key}` },
    );
    if (final) this.seal();
  },

  // ─── Materials ─────────────────────────────────────────────────────

  get materials() {
    return this.doc.materialOrder
      .map((id) => this.doc.materials[id])
      .filter((m) => !m.outlineOnly);
  },

  get slots() {
    const o = this.obj;
    if (o?.type !== 'mesh') return [];
    return (
      o.materials?.length ? o.materials : [this.doc.materialOrder[0]]
    ).map((id, i) => ({ index: i, id, mat: this.doc.materials[id] }));
  },

  get activeMaterialId() {
    const slots = this.slots;
    const slot = slots[Math.min(this.slotIndex ?? 0, slots.length - 1)];
    return slot?.id ?? this.doc.materialOrder[0];
  },

  get mat() {
    return this.doc.materials[this.activeMaterialId] ?? null;
  },

  pickSlot(i) {
    this.slotIndex = i;
    this.activeLayer = null;
    this.scheduleTextures();
  },

  addMaterial(props = {}) {
    const mat = this.E.docs.newMaterial({
      ...props,
      name: this.uniqueMatName(props.name ?? 'Material'),
    });
    let doc = this.E.docs.addMaterial(this.doc, mat);
    const o = this.obj;
    if (o?.type === 'mesh') {
      const mats = [
        ...(o.materials?.length ? o.materials : [this.doc.materialOrder[0]]),
      ];
      mats[this.slotIndex ?? 0] = mat.id;
      doc = this.E.docs.updateObject(doc, o.id, { materials: mats });
    }
    this.commit(doc, 'New material');
    return mat.id;
  },

  uniqueMatName(name) {
    const taken = new Set(Object.values(this.doc.materials).map((m) => m.name));
    if (!taken.has(name)) return name;
    for (let i = 1; ; i++)
      if (!taken.has(`${name}.${String(i).padStart(3, '0')}`))
        return `${name}.${String(i).padStart(3, '0')}`;
  },

  duplicateMaterial() {
    const src = this.mat;
    if (!src) return;
    const copy = structuredClone(src);
    delete copy.id;
    copy.layers = (copy.layers ?? []).map((l) => {
      const id = this.E.docs.newId('lyr');
      const px = this.pixels.get(l.id);
      if (px)
        this.pixels.set(id, {
          size: px.size,
          color: new Uint8ClampedArray(px.color),
          pbr: new Uint8ClampedArray(px.pbr),
        });
      const mk = this.pixels.get(`${l.id}:mask`);
      if (mk)
        this.pixels.set(`${id}:mask`, {
          size: mk.size,
          mask: new Uint8ClampedArray(mk.mask),
        });
      return { ...l, id };
    });
    this.addMaterial({ ...copy, name: `${src.name} copy` });
  },

  assignMaterial(matId, slot = this.slotIndex ?? 0) {
    const o = this.obj;
    if (o?.type !== 'mesh') return;
    const mats = [
      ...(o.materials?.length ? o.materials : [this.doc.materialOrder[0]]),
    ];
    mats[slot] = matId;
    this.commit(
      this.E.docs.updateObject(this.doc, o.id, { materials: mats }),
      'Assign material',
    );
  },

  assignToSelection(matId) {
    const patches = this.selected
      .filter((id) => this.doc.objects[id]?.type === 'mesh')
      .map((id) => {
        const o = this.doc.objects[id];
        const mats = [
          ...(o.materials?.length ? o.materials : [this.doc.materialOrder[0]]),
        ];
        mats[0] = matId;
        return [id, { materials: mats }];
      });
    if (patches.length)
      this.commit(
        this.E.docs.updateObjects(this.doc, patches),
        'Assign material',
      );
  },

  addSlot() {
    const o = this.obj;
    if (o?.type !== 'mesh') return;
    const mats = [
      ...(o.materials?.length ? o.materials : [this.doc.materialOrder[0]]),
    ];
    mats.push(mats[mats.length - 1]);
    this.commit(
      this.E.docs.updateObject(this.doc, o.id, { materials: mats }),
      'Add material slot',
    );
    this.slotIndex = mats.length - 1;
  },

  removeSlot(i) {
    const o = this.obj;
    const mats = [...(o.materials ?? [])];
    if (mats.length <= 1) return;
    mats.splice(i, 1);
    // Faces on the removed slot fall back to the first; later ones shift down.
    let doc = this.E.docs.updateObject(this.doc, o.id, { materials: mats });
    if (o.source?.kind === 'mesh') {
      const mesh = o.source.mesh;
      const f = mesh.f.map((face) =>
        (face.m ?? 0) === i
          ? { ...face, m: 0 }
          : (face.m ?? 0) > i
            ? { ...face, m: face.m - 1 }
            : face,
      );
      doc = this.E.docs.updateObject(doc, o.id, {
        source: { ...o.source, mesh: { v: mesh.v, f } },
      });
    }
    this.commit(doc, 'Remove material slot');
    this.slotIndex = 0;
  },

  // Edit mode: gives the selected faces the active slot's material.
  assignSlotToFaces(slot = this.slotIndex ?? 0) {
    if (this.mode !== 'edit' || !this.edit.faces.size)
      return this.flash('Select faces in edit mode first.');
    const mesh = this.baseMesh;
    const f = mesh.f.map((face, fi) =>
      this.edit.faces.has(fi) ? { ...face, m: slot } : face,
    );
    this.commitMesh({ v: mesh.v, f }, 'Assign material to faces');
  },

  setMat(key, value, final) {
    const m = this.mat;
    if (!m) return;
    this.commit(
      this.E.docs.updateMaterial(this.doc, m.id, { [key]: value }),
      `Material ${key}`,
      { merge: `mat:${m.id}:${key}` },
    );
    if (final) this.seal();
    if (['color', 'rough', 'metal'].includes(key)) this.scheduleTextures();
  },

  renameMaterial(e) {
    const name = e.target.value.trim();
    if (name && name !== this.mat.name)
      this.setMat('name', this.uniqueMatName(name), true);
  },

  async uploadMap(slot, file) {
    if (!file) return;
    try {
      const { url, img } = await this.readImageFile(file);
      const id = this.E.docs.newId('tex');
      const textures = {
        ...this.doc.textures,
        [id]: { id, name: file.name, url, w: img.width, h: img.height },
      };
      const m = this.mat;
      const doc = this.E.docs.updateMaterial({ ...this.doc, textures }, m.id, {
        maps: { ...m.maps, [slot]: id },
      });
      this.imageCache.set(id, Promise.resolve(img));
      const images = new Map(this.images);
      images.set(id, img);
      this.images = images;
      this.commit(doc, `Load ${slot} map`);
    } catch (error) {
      this.flash(error.message, 'error');
    }
  },

  clearMap(slot) {
    const m = this.mat;
    const maps = { ...m.maps };
    delete maps[slot];
    this.commit(
      this.E.docs.updateMaterial(this.doc, m.id, { maps }),
      `Clear ${slot} map`,
    );
  },

  // Stores a canvas (a bake) as a texture and puts it in a map slot.
  canvasToMap(canvas, slot, name) {
    const url = canvas.toDataURL('image/png');
    const id = this.E.docs.newId('tex');
    const img = new Image();
    img.src = url;
    const m = this.mat;
    const textures = {
      ...this.doc.textures,
      [id]: { id, name, url, w: canvas.width, h: canvas.height },
    };
    this.imageCache.set(id, new Promise((r) => (img.onload = () => r(img))));
    img.onload = () => {
      const images = new Map(this.images);
      images.set(id, img);
      this.images = images;
    };
    this.commit(
      this.E.docs.updateMaterial({ ...this.doc, textures }, m.id, {
        maps: { ...m.maps, [slot]: id },
      }),
      `Bake ${name}`,
    );
  },

  // ─── Edit mode ─────────────────────────────────────────────────────

  get baseMesh() {
    return this.editMesh ?? this.evaluator.base(this.doc, this.active);
  },

  enterEdit(selectMode) {
    const o = this.obj;
    if (o?.type !== 'mesh') return this.flash('Select a mesh to edit.');
    if (o.source?.kind === 'outline')
      return this.flash(
        'An outline follows its model: edit the model instead.',
      );
    if (o.source?.kind !== 'mesh') this.convertToMesh(o.id, { silent: true });
    this.editMesh = null;
    this.mode = 'edit';
    this.lastOp = null;
    this.edit = {
      mode: selectMode ?? this.edit.mode,
      verts: new Set(),
      edges: new Set(),
      faces: new Set(),
      all: new Set(),
      version: (this.edit.version ?? 0) + 1,
    };
    if (selectMode === 'face' || this.workspace === 'uv')
      this.selectAllElements();
  },

  exitEdit() {
    this.editMesh = null;
    this.lastOp = null;
    if (this.mode === 'edit') this.mode = 'object';
  },

  setSelectMode(m) {
    const e = this.edit;
    const mesh = this.baseMesh;
    const M = this.E.mesh;
    let verts = e.all;
    this.edit = this.withSel({
      mode: m,
      verts: m === 'vert' ? verts : new Set(),
      edges: m === 'edge' ? M.edgesOfVerts(mesh, verts) : new Set(),
      faces: m === 'face' ? M.facesOfVerts(mesh, verts) : new Set(),
    });
  },

  // Fills in `all` (the vertices a selection moves) and bumps the version.
  withSel({ mode, verts, edges, faces }) {
    const mesh = this.baseMesh;
    const all = new Set(verts);
    for (const k of edges) for (const x of k.split('_')) all.add(Number(x));
    for (const fi of faces) for (const v of mesh.f[fi]?.v ?? []) all.add(v);
    return {
      mode,
      verts,
      edges,
      faces,
      all,
      version: (this.edit.version ?? 0) + 1,
    };
  },

  bumpEdit() {
    if (this.mode !== 'edit') return;
    const e = this.edit;
    const mesh = this.baseMesh;
    const ok = (i) => i < mesh.v.length;
    this.edit = this.withSel({
      mode: e.mode,
      verts: new Set([...e.verts].filter(ok)),
      edges: new Set(
        [...e.edges].filter((k) => k.split('_').every((x) => ok(Number(x)))),
      ),
      faces: new Set([...e.faces].filter((f) => f < mesh.f.length)),
    });
  },

  editPick(el, mods) {
    const e = this.edit;
    const add = mods.shift || mods.ctrl;
    const verts = add ? new Set(e.verts) : new Set();
    const edges = add ? new Set(e.edges) : new Set();
    const faces = add ? new Set(e.faces) : new Set();
    if (el) {
      const set =
        el.kind === 'vert' ? verts : el.kind === 'edge' ? edges : faces;
      const key = el.kind === 'edge' ? el.key : el.index;
      if (add && set.has(key)) set.delete(key);
      else set.add(key);
    }
    this.edit = this.withSel({ mode: e.mode, verts, edges, faces });
    this.lastOp = null;
  },

  editBox(res, mods) {
    const e = this.edit;
    const pick =
      e.mode === 'vert' ? res.verts : e.mode === 'edge' ? res.edges : res.faces;
    const cur =
      e.mode === 'vert' ? e.verts : e.mode === 'edge' ? e.edges : e.faces;
    const next = mods.shift
      ? new Set([...cur, ...pick])
      : mods.ctrl
        ? new Set([...cur].filter((x) => !pick.includes(x)))
        : new Set(pick);
    this.edit = this.withSel({
      mode: e.mode,
      verts: e.mode === 'vert' ? next : new Set(),
      edges: e.mode === 'edge' ? next : new Set(),
      faces: e.mode === 'face' ? next : new Set(),
    });
  },

  selectAllElements() {
    const mesh = this.baseMesh;
    const e = this.edit;
    const everything =
      e.mode === 'vert'
        ? mesh.v.length
        : e.mode === 'edge'
          ? null
          : mesh.f.length;
    const already =
      e.mode === 'vert'
        ? e.verts.size === everything
        : e.mode === 'face'
          ? e.faces.size === everything
          : false;
    if (already && this.mode === 'edit' && this.workspace !== 'uv')
      return (this.edit = this.withSel({
        mode: e.mode,
        verts: new Set(),
        edges: new Set(),
        faces: new Set(),
      }));
    this.edit = this.withSel({
      mode: e.mode,
      verts: e.mode === 'vert' ? new Set(mesh.v.keys()) : new Set(),
      edges:
        e.mode === 'edge'
          ? new Set(this.E.mesh.edgeMap(mesh).keys())
          : new Set(),
      faces: e.mode === 'face' ? new Set(mesh.f.keys()) : new Set(),
    });
  },

  selectLinked() {
    const mesh = this.baseMesh;
    const M = this.E.mesh;
    const seed = this.edit.faces.size
      ? this.edit.faces
      : M.facesOfVerts(mesh, this.edit.all).size
        ? M.facesOfVerts(mesh, this.edit.all)
        : new Set(
            [...mesh.f.keys()].filter((fi) =>
              mesh.f[fi].v.some((v) => this.edit.all.has(v)),
            ),
          );
    const faces = M.linkedFaces(mesh, seed);
    const verts = M.vertsOfFaces(mesh, faces);
    const e = this.edit;
    this.edit = this.withSel({
      mode: e.mode,
      verts: e.mode === 'vert' ? verts : new Set(),
      edges: e.mode === 'edge' ? M.edgesOfVerts(mesh, verts) : new Set(),
      faces: e.mode === 'face' ? faces : new Set(),
    });
  },

  invertSelection() {
    const mesh = this.baseMesh;
    const e = this.edit;
    const inv = (all, cur) => new Set([...all].filter((x) => !cur.has(x)));
    this.edit = this.withSel({
      mode: e.mode,
      verts: e.mode === 'vert' ? inv(mesh.v.keys(), e.verts) : new Set(),
      edges:
        e.mode === 'edge'
          ? inv(this.E.mesh.edgeMap(mesh).keys(), e.edges)
          : new Set(),
      faces: e.mode === 'face' ? inv(mesh.f.keys(), e.faces) : new Set(),
    });
  },

  // The faces a face-based operation should act on, whatever the select mode.
  get selFaces() {
    const e = this.edit;
    if (e.faces.size) return e.faces;
    return this.E.mesh.facesOfVerts(this.baseMesh, e.all);
  },

  get selEdges() {
    const e = this.edit;
    if (e.edges.size) return e.edges;
    return this.E.mesh.edgesOfVerts(this.baseMesh, e.all);
  },

  commitMesh(mesh, label, { merge = null } = {}) {
    const o = this.obj;
    this.editMesh = null;
    this.commit(
      this.E.docs.updateObject(this.doc, o.id, {
        source: { ...o.source, kind: 'mesh', mesh },
      }),
      label,
      { merge },
    );
  },

  // Vertex drags from the gizmo: shown live, committed on release.
  moveVerts(mesh, final) {
    if (!final) {
      this.editMesh = mesh;
      this.editMeshKey = (this.editMeshKey ?? 0) + 1;
      return;
    }
    this.commitMesh(mesh, 'Move vertices');
    this.bumpEdit();
  },

  // Runs a mesh operation with parameters that can be retuned afterwards
  // from the "last operation" panel (redone from the mesh as it was).
  runOp(name, params = {}) {
    const before = this.baseMesh;
    const sel = this.edit;
    try {
      this.applyOp(name, before, sel, params);
      this.lastOp = { name, params, before, sel };
    } catch (error) {
      this.flash(error.message, 'error');
    }
  },

  retuneOp(key, value, final) {
    const op = this.lastOp;
    if (!op) return;
    const params = { ...op.params, [key]: value };
    try {
      this.applyOp(op.name, op.before, op.sel, params, { merge: 'lastop' });
      this.lastOp = { ...op, params };
      if (final) this.seal();
    } catch (error) {
      this.flash(error.message, 'error');
    }
  },

  applyOp(name, mesh, sel, p, { merge = null } = {}) {
    const M = this.E.mesh;
    const faces = sel.faces.size ? sel.faces : M.facesOfVerts(mesh, sel.all);
    const edges = sel.edges.size ? sel.edges : M.edgesOfVerts(mesh, sel.all);
    const label = OPS[name]?.label ?? name;
    let out;
    let next = null;
    switch (name) {
      case 'extrude': {
        if (!faces.size) throw new Error('Select faces to extrude.');
        const r = M.extrudeFaces(mesh, faces, p.distance);
        out = r.mesh;
        next = { faces: new Set(faces) };
        break;
      }
      case 'inset': {
        if (!faces.size) throw new Error('Select faces to inset.');
        const r = M.insetFaces(mesh, faces, p.amount);
        out = r.mesh;
        // Face indices shift: the inset faces are what's selected after.
        next = { faces: r.faces };
        break;
      }
      case 'bevel': {
        if (!edges.size && !faces.size)
          throw new Error('Select edges (or faces) to bevel.');
        const set = edges.size
          ? edges
          : M.edgesOfVerts(mesh, M.vertsOfFaces(mesh, faces));
        out = M.bevel(mesh, p.width, { edges: set, segments: p.segments });
        next = { clear: true };
        break;
      }
      case 'merge':
        if (sel.all.size < 2)
          throw new Error('Select two or more vertices to merge.');
        out = M.mergeVerts(mesh, sel.all, p.at);
        next = { clear: true };
        break;
      case 'weld':
        out = M.weld(mesh, p.distance, sel.all.size ? sel.all : null);
        next = { clear: true };
        this.flash(`Welded: ${mesh.v.length - out.v.length} vertices merged.`);
        break;
      case 'delete':
        if (sel.mode === 'vert') out = M.deleteVerts(mesh, sel.verts);
        else if (sel.mode === 'edge') out = M.deleteEdges(mesh, sel.edges);
        else out = M.deleteFaces(mesh, sel.faces);
        next = { clear: true };
        break;
      case 'deleteFacesOnly':
        out = M.deleteFaces(mesh, faces);
        next = { clear: true };
        break;
      case 'bridge': {
        if (faces.size >= 2) out = M.bridgeFaces(mesh, faces);
        else {
          const loops = M.edgeLoops(mesh, edges).filter((l) => l.closed);
          if (loops.length !== 2)
            throw new Error(
              'Select two faces, or two closed edge loops, to bridge.',
            );
          out = M.bridgeLoops(mesh, loops[0].verts, loops[1].verts);
        }
        next = { clear: true };
        break;
      }
      case 'loopcut': {
        const key = [...edges][0];
        if (!key)
          throw new Error('Select an edge across the ring to cut (edge mode).');
        const r = M.loopCut(mesh, key, p.cuts, p.offset);
        out = r.mesh;
        next = { edges: r.edges };
        break;
      }
      case 'flip':
        out = M.flip(mesh, faces.size ? faces : null);
        break;
      case 'subdivide':
        out = M.subdivide(mesh, p.levels, { smooth: p.smooth });
        next = { clear: true };
        break;
      case 'smooth':
        out = M.laplacian(mesh, p.iterations, p.factor, {
          only: sel.all.size ? sel.all : null,
        });
        break;
      case 'triangulate':
        out = M.triangulate(mesh);
        next = { clear: true };
        break;
      case 'shade':
        out = {
          v: mesh.v,
          f: mesh.f.map((f, fi) =>
            !faces.size || faces.has(fi) ? { ...f, s: p.smooth } : f,
          ),
        };
        break;
      default:
        throw new Error(`Unknown operation ${name}`);
    }
    this.commitMesh(out, label, { merge });
    const e = this.edit;
    if (next?.clear)
      this.edit = this.withSel({
        mode: e.mode,
        verts: new Set(),
        edges: new Set(),
        faces: new Set(),
      });
    else if (next?.faces)
      this.edit = this.withSel({
        mode: 'face',
        verts: new Set(),
        edges: new Set(),
        faces: next.faces,
      });
    else if (next?.edges)
      this.edit = this.withSel({
        mode: 'edge',
        verts: new Set(),
        edges: next.edges,
        faces: new Set(),
      });
    else this.bumpEdit();
  },

  // Pulls the selected faces out into an object of their own.
  separateSel() {
    const mesh = this.baseMesh;
    const faces = this.selFaces;
    if (!faces.size) return this.flash('Select the faces to separate.');
    const { rest, part } = this.E.mesh.separate(mesh, faces);
    const o = this.obj;
    let doc = this.E.docs.updateObject(this.doc, o.id, {
      source: { kind: 'mesh', mesh: rest },
    });
    const props = {
      ...structuredClone({
        pos: o.pos,
        rot: o.rot,
        scl: o.scl,
        materials: o.materials,
      }),
      name: `${o.name} part`,
      source: { kind: 'mesh', mesh: part },
    };
    let id;
    [doc, id] = this.E.docs.createObject(doc, 'mesh', props, o.parent);
    this.editMesh = null;
    this.commit(doc, 'Separate');
    this.exitEdit();
    this.select([id]);
  },

  get opDefs() {
    return OPS;
  },

  get lastOpDef() {
    return this.lastOp ? OPS[this.lastOp.name] : null;
  },

  // Edit-mode keys: 1/2/3 select modes, E I B M etc. (returns true if taken).
  handleModeKey(e, k, ctrl) {
    if (this.mode === 'edit') {
      if (!ctrl && ['1', '2', '3'].includes(k)) {
        this.setSelectMode({ 1: 'vert', 2: 'edge', 3: 'face' }[k]);
        return true;
      }
      if (ctrl && k === 'r') {
        e.preventDefault();
        this.runOp('loopcut', { cuts: 1, offset: 0 });
        return true;
      }
      if (ctrl && k === 'b') {
        e.preventDefault();
        this.runOp('bevel', { width: 0.05, segments: 1 });
        return true;
      }
      if (ctrl && k === 'i') {
        e.preventDefault();
        this.invertSelection();
        return true;
      }
      if (ctrl && k === 'l') {
        e.preventDefault();
        this.selectLinked();
        return true;
      }
      if (ctrl) return false;
      const map = {
        i: ['inset', { amount: 0.08 }],
        m: ['merge', { at: 'center' }],
        n: ['flip', {}],
        b: ['bridge', {}],
      };
      if (k === 'e' && !this.view?.fly.hover) {
        this.runOp('extrude', { distance: 0.25 });
        return true;
      }
      if (map[k]) {
        this.runOp(...map[k]);
        return true;
      }
      if (k === 'delete' || k === 'x' || k === 'backspace') {
        this.runOp('delete', {});
        return true;
      }
      if (k === 'p') {
        this.separateSel();
        return true;
      }
      if (k === 'l') {
        this.selectLinked();
        return true;
      }
    }
    return this.handleOtherModeKey?.(e, k, ctrl) ?? false;
  },

  // ─── UVs ───────────────────────────────────────────────────────────

  // UV operations work on the selected faces in edit mode, else the whole mesh.
  uvOp(name, arg) {
    const o = this.obj;
    if (o?.type !== 'mesh') return this.flash('Select a mesh first.');
    if (o.source?.kind === 'primitive')
      this.convertToMesh(o.id, { silent: true });
    const mesh = this.baseMesh;
    const U = this.E.uv;
    const faces =
      this.mode === 'edit' && this.selFaces.size
        ? this.selFaces
        : new Set(mesh.f.keys());
    let out;
    const label = UV_LABELS[name] ?? 'UVs';
    switch (name) {
      case 'auto':
        out = U.autoUnwrap(mesh, faces, { angle: this.uvAngle ?? 66 });
        break;
      case 'planar':
        out = U.projectPlanar(mesh, faces, arg ?? null);
        break;
      case 'view': {
        const inv = this.E.docs.worldMatrix(this.doc, o.id).invert();
        const V = this.view.camera.position.constructor;
        const dir = new V(0, 0, 1)
          .applyQuaternion(this.view.camera.quaternion)
          .transformDirection(inv);
        out = U.projectPlanar(mesh, faces, dir.toArray());
        break;
      }
      case 'box':
        out = U.projectBox(mesh, faces);
        break;
      case 'cylinder':
        out = U.packIslands(U.projectCylinder(mesh, faces, arg ?? 1), faces);
        break;
      case 'sphere':
        out = U.projectSphere(mesh, faces);
        break;
      case 'pack':
        out = U.packIslands(mesh, faces, { margin: 0.01 });
        break;
      case 'relax':
        out = U.relaxUvs(mesh, faces, 30);
        break;
      case 'rotate':
        out = U.transformUvs(mesh, faces, { rotate: arg ?? 90 });
        break;
      case 'flipU':
        out = U.transformUvs(mesh, faces, { scale: [-1, 1] });
        break;
      case 'flipV':
        out = U.transformUvs(mesh, faces, { scale: [1, -1] });
        break;
      case 'grow':
        out = U.transformUvs(mesh, faces, { scale: [1.1, 1.1] });
        break;
      case 'shrink':
        out = U.transformUvs(mesh, faces, { scale: [1 / 1.1, 1 / 1.1] });
        break;
      case 'fit':
        out = U.packIslands(mesh, faces, { margin: 0.01, islands: [faces] });
        break;
      default:
        return;
    }
    this.commitMesh(out, label);
    this.uvVersion = (this.uvVersion ?? 0) + 1;
  },

  // Live drags from the UV editor.
  uvTransform(faces, t, final) {
    const mesh = this.lastUvBase && !final ? this.lastUvBase : this.baseMesh;
    if (!this.lastUvBase) this.lastUvBase = mesh;
    const out = this.E.uv.transformUvs(this.lastUvBase, faces, t);
    if (final) {
      this.lastUvBase = null;
      this.commitMesh(out, 'Move UVs', { merge: null });
      this.seal();
    } else {
      this.editMesh = out;
      this.editMeshKey = (this.editMeshKey ?? 0) + 1;
    }
    this.uvVersion = (this.uvVersion ?? 0) + 1;
  },

  get uvStats() {
    if (!this.isMesh) return null;
    const mesh = this.baseMesh;
    const s = this.E.uv.uvStats(mesh);
    return {
      islands: this.E.uv.uvIslands(mesh).length,
      coverage: Math.round(s.coverage * 100),
      overlap: Math.round(s.overlap * 1000) / 10,
    };
  },
};

const UV_LABELS = {
  auto: 'Auto unwrap',
  planar: 'Planar projection',
  view: 'Project from view',
  box: 'Box projection',
  cylinder: 'Cylindrical projection',
  sphere: 'Spherical projection',
  pack: 'Pack UVs',
  relax: 'Relax UVs',
  rotate: 'Rotate UVs',
  flipU: 'Flip UVs',
  flipV: 'Flip UVs',
  grow: 'Scale UVs',
  shrink: 'Scale UVs',
  fit: 'Fit UVs',
};

const num = (key, label, min, max, step = 0.01) => ({
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

// Edit operations, with the parameters the "last operation" panel offers.
export const OPS = {
  extrude: {
    label: 'Extrude',
    icon: 'arrow-up-from-line',
    key: 'E',
    params: [num('distance', 'Distance', -10, 10)],
  },
  inset: {
    label: 'Inset',
    icon: 'square-dot',
    key: 'I',
    params: [num('amount', 'Amount', 0, 5, 0.005)],
  },
  bevel: {
    label: 'Bevel',
    icon: 'squircle',
    key: 'Ctrl B',
    params: [
      num('width', 'Width', 0, 5, 0.005),
      int('segments', 'Segments', 1, 4),
    ],
  },
  merge: {
    label: 'Merge',
    icon: 'merge',
    key: 'M',
    params: [
      {
        key: 'at',
        label: 'At',
        type: 'select',
        options: [
          { value: 'center', label: 'Centre' },
          { value: 'first', label: 'First' },
        ],
      },
    ],
  },
  weld: {
    label: 'Weld',
    icon: 'magnet',
    params: [num('distance', 'Distance', 0.00001, 1, 0.0005)],
  },
  delete: { label: 'Delete', icon: 'trash-2', key: 'X', params: [] },
  bridge: { label: 'Bridge', icon: 'git-merge', key: 'B', params: [] },
  loopcut: {
    label: 'Loop cut',
    icon: 'slice',
    key: 'Ctrl R',
    params: [int('cuts', 'Cuts', 1, 32), num('offset', 'Slide', -1, 1)],
  },
  flip: { label: 'Flip normals', icon: 'flip-vertical', key: 'N', params: [] },
  subdivide: {
    label: 'Subdivide',
    icon: 'grid-3x3',
    params: [
      int('levels', 'Levels', 1, 3),
      { key: 'smooth', label: 'Smooth', type: 'bool' },
    ],
  },
  smooth: {
    label: 'Smooth vertices',
    icon: 'waves',
    params: [
      int('iterations', 'Iterations', 1, 50),
      num('factor', 'Factor', 0, 1),
    ],
  },
  triangulate: { label: 'Triangulate', icon: 'triangle', params: [] },
  shade: {
    label: 'Shading',
    icon: 'sun',
    params: [{ key: 'smooth', label: 'Smooth', type: 'bool' }],
  },
};

export { setOf };
