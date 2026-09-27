// 3D Studio's state and actions. The page component owns one of these and
// hands it to every panel as @s, so a panel reads what it shows from here
// and calls back into here to change anything.
//
// The engine (geometry, rendering, painting, rigging…) is loaded on demand
// and kept as `this.E`; nothing here runs before it's in.
//
// Every change to the document goes through commit(), which keeps the undo
// history. Drags and scrubs call it with `merge`, so a whole gesture is one
// undo step however many frames it took.

import { tracked } from '@glimmer/tracking';
import { waitForPromise } from '@ember/test-waiters';
import { idbGet, idbSet, makeShelf } from '../../utils/idb-store';
import modelActions from './state-model';
import paintActions from './state-paint';
import rigActions from './state-rig';
import animActions from './state-anim';

export const WORKSPACES = [
  { id: 'model', label: 'Model', icon: 'box', key: 'F1' },
  { id: 'sculpt', label: 'Sculpt', icon: 'hand', key: 'F2' },
  { id: 'uv', label: 'UV', icon: 'grid-3x3', key: 'F3' },
  { id: 'texture', label: 'Texture', icon: 'brush', key: 'F4' },
  { id: 'material', label: 'Material', icon: 'palette', key: 'F5' },
  { id: 'rig', label: 'Rig', icon: 'bone', key: 'F6' },
  { id: 'animate', label: 'Animate', icon: 'film', key: 'F7' },
];

const AUTOSAVE_KEY = 'woogi-tool:3d-studio';
const HISTORY_LIMIT = 120;
export const shelf = makeShelf('3d-studio');

const isTyping = (el) =>
  el?.isContentEditable ||
  ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName);

export class StudioState {
  E = null;
  @tracked ready = false;
  @tracked loadError = null;
  @tracked doc = null;
  @tracked past = [];
  @tracked future = [];
  @tracked selected = [];
  @tracked active = null;
  @tracked workspace = 'model';
  @tracked mode = 'object';
  @tracked tool = 'move';
  @tracked space = 'world';
  @tracked axes = { x: true, y: true, z: true };
  @tracked snap = {
    grid: false,
    gridSize: 0.25,
    rotate: false,
    rotateStep: 15,
    surface: false,
    vertex: false,
  };
  @tracked status = null;
  @tracked dialog = null;
  @tracked showGrid = true;
  @tracked showBones = true;
  @tracked showControls = true;
  @tracked showHelpers = true;
  @tracked projects = [];
  @tracked projectId = null;
  @tracked dirty = false;
  @tracked busy = null;
  @tracked addMenu = false;
  @tracked renaming = null;
  @tracked images = new Map();
  @tracked rightTab = 'object';
  @tracked camTick = 0;

  // Edit mode
  @tracked edit = {
    mode: 'vert',
    verts: new Set(),
    edges: new Set(),
    faces: new Set(),
    all: new Set(),
    version: 0,
  };
  @tracked editMesh = null;
  @tracked lastOp = null;
  @tracked xray = false;
  @tracked editMeshKey = 0;
  @tracked slotIndex = 0;
  @tracked modMenu = false;
  @tracked uvAngle = 66;
  @tracked uvVersion = 0;
  @tracked maskValue = 1;

  constructor(owner) {
    this.owner = owner;
    // Actions are handed to templates bare, so bind them all once.
    for (
      let proto = Object.getPrototypeOf(this);
      proto && proto !== Object.prototype;
      proto = Object.getPrototypeOf(proto)
    )
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key === 'constructor') continue;
        const d = Object.getOwnPropertyDescriptor(proto, key);
        if (
          typeof d.value === 'function' &&
          !Object.prototype.hasOwnProperty.call(this, key)
        )
          this[key] = d.value.bind(this);
      }
    for (const init of [
      paintActions.init,
      rigActions.init,
      animActions.init,
      modelActions.init,
    ])
      init?.call(this);
  }

  // ─── Start-up ──────────────────────────────────────────────────────

  load() {
    return waitForPromise(
      import('../../lazy/studio/index')
        .then(async (E) => {
          this.E = E;
          this.evaluator = new E.Evaluator();
          this.pixels = new Map();
          this.imageCache = new Map();
          this.textures = new E.TextureEngine({
            pixels: this.pixels,
            images: (id) => this.imageOf(id),
            onUpdate: (matId) => this.textureUpdated(matId),
          });
          let restored = null;
          try {
            restored = E.project.fromRecord(await idbGet(AUTOSAVE_KEY));
          } catch {
            restored = null;
          }
          if (restored) {
            for (const [k, v] of restored.pixels) this.pixels.set(k, v);
            this.doc = restored.doc;
            this.projectId = (await idbGet(`${AUTOSAVE_KEY}:project`)) ?? null;
          } else this.doc = E.docs.starterDoc();
          this.selected = this.doc.roots.slice(0, 1);
          this.active = this.selected[0] ?? null;
          this.loadImages();
          this.ready = true;
          this.refreshProjects();
          this.refreshTextures(true);
        })
        .catch((error) => {
          console.error(error);
          this.loadError = error?.message ?? '3D Studio couldn’t start.';
        }),
    );
  }

  destroy() {
    clearTimeout(this.saveTimer);
    clearTimeout(this.texTimer);
    cancelAnimationFrame(this.playFrame);
    this.view?.dispose();
    this.view = null;
  }

  // ─── Derived ───────────────────────────────────────────────────────

  get obj() {
    return this.active ? (this.doc?.objects[this.active] ?? null) : null;
  }

  get isMesh() {
    return this.obj?.type === 'mesh';
  }

  get selectedObjects() {
    return this.selected.map((id) => this.doc.objects[id]).filter(Boolean);
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  get counts() {
    if (!this.doc) return { objects: 0, verts: 0, faces: 0, tris: 0 };
    let verts = 0,
      faces = 0,
      tris = 0;
    const ids = this.selected.length
      ? this.selected
      : Object.keys(this.doc.objects);
    for (const id of ids) {
      const o = this.doc.objects[id];
      if (o?.type !== 'mesh') continue;
      const c = this.E.mesh.counts(this.evaluator.mesh(this.doc, id));
      verts += c.verts;
      faces += c.faces;
      tris += c.tris;
    }
    return {
      objects: Object.keys(this.doc.objects).length,
      verts,
      faces,
      tris,
      scope: this.selected.length ? 'selected' : 'scene',
    };
  }

  // Everything the viewport needs to draw; reading it inside a modifier
  // is what makes the viewport re-sync whenever any of it changes.
  get viewState() {
    if (!this.ready) return null;
    const editing = this.mode === 'edit';
    return {
      doc: this.doc,
      selected: this.selected,
      active: this.active,
      workspace: this.workspace,
      mode: this.mode,
      tool: this.tool,
      space: this.space,
      axes: this.axes,
      snap: this.snap,
      edit: editing ? this.edit : null,
      editMesh:
        this.mode === 'edit' || this.mode === 'sculpt' ? this.editMesh : null,
      editMeshKey: this.editMeshKey,
      xray: this.xray,
      overrides: this.overrides,
      bones: this.boneSel,
      boneEnd: this.boneEnd,
      weightGroup: this.weightGroup,
      weightVersion: this.weightVersion,
      skinVersion: this.skinVersion,
      onion: this.onionState,
      brushRadius: this.brushRadius,
      images: this.images,
      showGrid: this.showGrid,
      showBones: this.showBones,
      showControls: this.showControls,
      showHelpers: this.showHelpers,
      restPose: this.restPose,
    };
  }

  // ─── History ───────────────────────────────────────────────────────

  // Replaces the document, remembering the old one for undo. `merge` joins
  // this change to the previous one when they share a key (scrubbing a
  // number, dragging a gizmo).
  commit(doc, label = 'Edit', { merge = null } = {}) {
    if (!doc || doc === this.doc) return;
    const last = this.past[this.past.length - 1];
    if (merge && last?.merge === merge && last.kind === 'doc') {
      last.at = Date.now();
    } else {
      const past = [
        ...this.past,
        { kind: 'doc', label, before: this.doc, merge, at: Date.now() },
      ];
      this.past =
        past.length > HISTORY_LIMIT
          ? past.slice(past.length - HISTORY_LIMIT)
          : past;
    }
    this.future = [];
    this.setDoc(doc);
  }

  // Ends a merge group so the next change starts a new undo step.
  seal() {
    const last = this.past[this.past.length - 1];
    if (last) last.merge = null;
  }

  pushPixels(entry) {
    this.past = [...this.past, { kind: 'pixels', ...entry }].slice(
      -HISTORY_LIMIT,
    );
    this.future = [];
    this.dirty = true;
    this.scheduleSave();
  }

  setDoc(doc) {
    this.doc = doc;
    this.dirty = true;
    this.evaluator.prune(doc);
    // Selection can't point at things that are gone.
    const sel = this.selected.filter((id) => doc.objects[id]);
    if (sel.length !== this.selected.length) this.selected = sel;
    if (this.active && !doc.objects[this.active]) this.active = sel[0] ?? null;
    this.scheduleSave();
    this.scheduleTextures();
  }

  undo() {
    const entry = this.past[this.past.length - 1];
    if (!entry) return;
    this.past = this.past.slice(0, -1);
    if (entry.kind === 'pixels') {
      this.applyPixels(entry, 'before');
      this.future = [...this.future, entry];
    } else {
      this.future = [...this.future, { ...entry, after: this.doc }];
      this.setDoc(entry.before);
      this.afterUndo();
    }
    this.flash(`Undid ${entry.label}`);
  }

  redo() {
    const entry = this.future[this.future.length - 1];
    if (!entry) return;
    this.future = this.future.slice(0, -1);
    if (entry.kind === 'pixels') {
      this.applyPixels(entry, 'after');
      this.past = [...this.past, entry];
    } else {
      this.past = [...this.past, { ...entry, before: this.doc, merge: null }];
      this.setDoc(entry.after);
      this.afterUndo();
    }
    this.flash(`Redid ${entry.label}`);
  }

  afterUndo() {
    this.editMesh = null;
    this.lastOp = null;
    if (this.mode === 'edit' && !this.isMesh) this.mode = 'object';
    this.bumpEdit();
  }

  flash(text, kind = 'info') {
    this.status = { text, kind, at: Date.now() };
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(
      () => {
        if (this.status?.text === text) this.status = null;
      },
      kind === 'error' ? 6000 : 2600,
    );
  }

  // ─── Saving ────────────────────────────────────────────────────────

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.autosave(), 1200);
  }

  async autosave() {
    if (!this.doc) return;
    await idbSet(AUTOSAVE_KEY, this.E.project.toRecord(this.doc, this.pixels));
  }

  async refreshProjects() {
    this.projects = await shelf.list();
  }

  async saveProject(asNew = false) {
    const name = this.doc.name?.trim() || 'Untitled';
    const id =
      !asNew && this.projectId ? this.projectId : this.E.docs.newId('prj');
    let thumb = null;
    try {
      thumb =
        this.view?.snapshot(160, 120).toDataURL('image/jpeg', 0.7) ?? null;
    } catch {
      thumb = null;
    }
    const ok = await shelf.store(
      id,
      { name, thumb, objects: Object.keys(this.doc.objects).length },
      this.E.project.toRecord(this.doc, this.pixels),
    );
    if (!ok)
      return this.flash(
        'The browser wouldn’t keep the project (out of space?).',
        'error',
      );
    this.projectId = id;
    await idbSet(`${AUTOSAVE_KEY}:project`, id);
    this.dirty = false;
    this.flash(`Saved “${name}”`);
    this.refreshProjects();
  }

  async openProject(id) {
    const rec = this.E.project.fromRecord(await shelf.load(id));
    if (!rec) return this.flash('That project couldn’t be opened.', 'error');
    this.replaceAll(rec.doc, rec.pixels);
    this.projectId = id;
    await idbSet(`${AUTOSAVE_KEY}:project`, id);
    this.dirty = false;
    this.dialog = null;
    this.flash(`Opened “${rec.doc.name}”`);
  }

  async deleteProject(id) {
    await shelf.forget(id);
    if (this.projectId === id) this.projectId = null;
    this.refreshProjects();
  }

  replaceAll(doc, pixels) {
    this.pixels.clear();
    for (const [k, v] of pixels) this.pixels.set(k, v);
    this.textures.sets.clear();
    this.evaluator.cache.clear();
    this.past = [];
    this.future = [];
    this.mode = 'object';
    this.editMesh = null;
    this.selected = [];
    this.active = null;
    this.doc = doc;
    this.boneSel = null;
    this.loadImages();
    this.refreshTextures(true);
    this.scheduleSave();
    this.view?.focusOn(
      Object.keys(doc.objects).filter((id) => doc.objects[id].type === 'mesh'),
    );
  }

  newProject() {
    this.replaceAll(this.E.docs.starterDoc(), new Map());
    this.projectId = null;
    idbSet(`${AUTOSAVE_KEY}:project`, null);
    this.dirty = false;
    this.flash('New scene');
  }

  downloadProject() {
    const text = this.E.project.toFile(
      this.doc,
      this.E.project.prunePixels(this.doc, new Map(this.pixels)),
    );
    download(
      new Blob([text], { type: 'application/json' }),
      `${safeName(this.doc.name)}.w3d.json`,
    );
  }

  async openFile(file) {
    if (!file) return;
    try {
      if (/\.(glb|gltf|obj|stl)$/i.test(file.name))
        return await this.importModel(file);
      const rec = this.E.project.fromFile(await file.text());
      this.replaceAll(rec.doc, rec.pixels);
      this.projectId = null;
      this.flash(`Opened ${file.name}`);
    } catch (error) {
      this.flash(error.message, 'error');
    }
  }

  // Imported meshes become editable objects (one per mesh in the file).
  async importModel(file) {
    this.busy = `Importing ${file.name}…`;
    try {
      const parts = await this.E.importModel(file);
      if (!parts.length) throw new Error('No meshes in that file.');
      let doc = this.doc;
      const made = [];
      const matIds = new Map();
      for (const p of parts) {
        const mats = [];
        for (const m of p.materials) {
          const key = `${m.name}|${m.color}`;
          if (!matIds.has(key)) {
            const mat = this.E.docs.newMaterial({
              name: m.name,
              color: m.color,
              rough: m.rough,
              metal: m.metal,
            });
            doc = this.E.docs.addMaterial(doc, mat);
            matIds.set(key, mat.id);
          }
          mats.push(matIds.get(key));
        }
        let id;
        [doc, id] = this.E.docs.createObject(doc, 'mesh', {
          name: p.name,
          source: { kind: 'mesh', mesh: p.mesh },
          pos: p.pos,
          rot: p.rot,
          scl: p.scl,
          materials: mats,
        });
        made.push(id);
      }
      this.commit(doc, `Import ${file.name}`);
      this.select(made);
      this.view?.focusOn(made);
      this.flash(
        `Imported ${made.length} mesh${made.length > 1 ? 'es' : ''} from ${file.name}.`,
      );
    } catch (error) {
      this.flash(error.message, 'error');
    } finally {
      this.busy = null;
    }
  }

  async exportAs(kind, options = {}) {
    const ex = this.E.EXPORTERS[kind];
    if (!ex) return;
    this.busy = `Exporting ${ex.label}…`;
    try {
      this.refreshTextures(true);
      const ctx = {
        doc: this.doc,
        evaluator: this.evaluator,
        textures: this.textures,
        images: this.images,
      };
      const sel =
        options.selection && this.selected.length
          ? new Set(this.selected)
          : null;
      const blob = await ex.run(ctx, { ...options, selectedOnly: sel });
      download(blob, `${safeName(this.doc.name)}.${ex.ext}`);
      this.flash(`Exported ${ex.label}`);
    } catch (error) {
      console.error(error);
      this.flash(`Export failed: ${error.message}`, 'error');
    } finally {
      this.busy = null;
    }
  }

  setDocName(e) {
    const name = e.target.value.trim() || 'Untitled';
    if (name !== this.doc.name)
      this.commit({ ...this.doc, name }, 'Rename scene');
  }

  // ─── Images (uploaded maps, stencils) ──────────────────────────────

  imageOf(id) {
    if (this.imageCache.has(id)) return this.imageCache.get(id);
    const tex = this.doc.textures[id];
    const p = new Promise((resolve, reject) => {
      if (!tex) return reject(new Error('Missing texture'));
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Unreadable image'));
      img.src = tex.url;
    });
    this.imageCache.set(id, p);
    return p;
  }

  loadImages() {
    for (const id of Object.keys(this.doc.textures ?? {}))
      if (!this.images.has(id))
        this.imageOf(id)
          .then((img) => {
            const next = new Map(this.images);
            next.set(id, img);
            this.images = next;
          })
          .catch(() => {});
  }

  readImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve({ url: reader.result, img });
        img.onerror = () =>
          reject(new Error('That file isn’t an image the browser can read.'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  // ─── Selection ─────────────────────────────────────────────────────

  select(ids, { add = false, toggle = false } = {}) {
    let next;
    if (toggle) {
      next = [...this.selected];
      for (const id of ids) {
        const at = next.indexOf(id);
        if (at >= 0) next.splice(at, 1);
        else next.push(id);
      }
    } else if (add) next = [...new Set([...this.selected, ...ids])];
    else next = [...ids];
    this.selected = next;
    const last = ids[ids.length - 1];
    this.active = next.includes(last) ? last : (next[next.length - 1] ?? null);
    // Picking a controller (or anything but the armature) while posing hands
    // the gizmo to it rather than to the selected bone.
    if (
      this.boneSel?.active &&
      ids.length &&
      ids.some((id) => this.doc.objects[id]?.type !== 'armature')
    )
      this.boneSel = { ...this.boneSel, active: null, ids: new Set() };
    this.onActiveChanged();
  }

  selectOne(id, e) {
    if (e?.shiftKey || e?.ctrlKey || e?.metaKey)
      this.select([id], { toggle: true });
    else this.select([id]);
  }

  selectAll() {
    if (this.mode === 'edit') return this.selectAllElements();
    const all = Object.keys(this.doc.objects).filter(
      (id) => this.doc.objects[id].visible !== false,
    );
    this.select(this.selected.length === all.length ? [] : all);
  }

  onActiveChanged() {
    if (this.mode === 'edit' && !this.isMesh) this.mode = 'object';
    if (
      (this.mode === 'sculpt' ||
        this.mode === 'paint' ||
        this.mode === 'weight') &&
      !this.isMesh
    )
      this.mode = 'object';
    this.lastOp = null;
    this.scheduleTextures();
    this.pickTabFor();
  }

  pickTabFor() {
    const o = this.obj;
    if (!o) return;
    if (this.workspace === 'model' && this.rightTab === 'bone')
      this.rightTab = 'object';
  }

  // The viewport reports a click.
  onPick(result, mods) {
    if (result.kind === 'bone') return this.pickBone(result, mods);
    if (result.kind === 'object') {
      const o = this.doc.objects[result.id];
      // FK controllers stand in for their bone.
      if (o?.type === 'control' && o.control.role?.kind === 'fk') {
        const arm = this.doc.objects[o.parent];
        if (arm)
          return this.pickBone(
            { arm: arm.id, bone: o.control.role.bone },
            mods,
          );
      }
      if (mods.shift || mods.ctrl) this.select([result.id], { toggle: true });
      else this.select([result.id]);
      return;
    }
    if (!mods.shift && !mods.ctrl) {
      if (this.boneSel && (this.mode === 'pose' || this.mode === 'bones'))
        this.boneSel = { ...this.boneSel, active: null, ids: new Set() };
      else this.select([]);
    }
  }

  onBox(result, mods) {
    if (result.kind === 'elements') return this.editBox(result, mods);
    if (mods.shift) this.select(result.ids, { add: true });
    else this.select(result.ids);
  }

  // ─── Workspaces and modes ──────────────────────────────────────────

  setWorkspace(id) {
    if (id === this.workspace) return;
    this.leaveMode();
    this.workspace = id;
    const o = this.obj;
    if (id === 'sculpt') {
      if (!this.isMesh) this.selectFirstMesh();
      if (this.isMesh) this.mode = 'sculpt';
    } else if (id === 'texture') {
      if (!this.isMesh) this.selectFirstMesh();
      if (this.isMesh) {
        this.mode = 'paint';
        this.ensurePaintMaterial();
      }
    } else if (id === 'uv') {
      if (!this.isMesh) this.selectFirstMesh();
      if (this.isMesh) {
        this.enterEdit('face');
      }
    } else if (id === 'rig') {
      this.mode = o?.type === 'armature' ? 'pose' : 'object';
      this.rightTab = 'rig';
    } else if (id === 'animate') {
      this.mode = this.boneSel?.arm ? 'pose' : 'object';
      this.ensureClip();
    } else if (id === 'material') {
      this.mode = 'object';
      this.rightTab = 'material';
    } else {
      this.mode = 'object';
      if (this.rightTab === 'rig') this.rightTab = 'object';
    }
    if (id === 'model' || id === 'uv')
      this.rightTab =
        this.rightTab === 'material' && id === 'model' ? 'material' : 'object';
    this.tool = ['sculpt', 'texture'].includes(id)
      ? 'select'
      : this.tool === 'select' && id !== 'animate'
        ? 'move'
        : this.tool;
  }

  selectFirstMesh() {
    const id = Object.keys(this.doc.objects).find(
      (k) =>
        this.doc.objects[k].type === 'mesh' &&
        this.doc.objects[k].visible !== false,
    );
    if (id) this.select([id]);
  }

  leaveMode() {
    if (this.mode === 'edit') this.exitEdit();
    this.mode = 'object';
  }

  setMode(mode) {
    if (mode === this.mode) return;
    if (this.mode === 'edit') this.exitEdit();
    if (mode === 'edit') return this.enterEdit();
    if (
      (mode === 'sculpt' || mode === 'paint' || mode === 'weight') &&
      !this.isMesh
    )
      return this.flash('Select a mesh first.');
    if ((mode === 'pose' || mode === 'bones') && !this.currentArmature())
      return this.flash('Select an armature (or add one) first.');
    if (mode === 'pose' || mode === 'bones') this.ensureBoneSel();
    if (mode === 'weight') this.ensureWeightGroup();
    this.mode = mode;
  }

  setTool(tool) {
    this.tool = tool;
  }

  toggleAxis(axis) {
    this.axes = { ...this.axes, [axis]: !this.axes[axis] };
    if (!this.axes.x && !this.axes.y && !this.axes.z)
      this.axes = { x: true, y: true, z: true };
  }

  onlyAxis(axis) {
    const only =
      this.axes[axis] && Object.values(this.axes).filter(Boolean).length === 1;
    this.axes = only
      ? { x: true, y: true, z: true }
      : { x: axis === 'x', y: axis === 'y', z: axis === 'z' };
  }

  setSnap(key, value) {
    this.snap = { ...this.snap, [key]: value };
  }

  toggleSnap(key) {
    this.snap = { ...this.snap, [key]: !this.snap[key] };
  }

  toggle(key) {
    this[key] = !this[key];
  }

  setRightTab(tab) {
    this.rightTab = tab;
  }

  openDialog(name) {
    this.dialog = name;
    this.addMenu = false;
    if (name === 'open') this.refreshProjects();
  }

  closeDialog() {
    this.dialog = null;
  }

  // ─── Viewport hookup ───────────────────────────────────────────────

  attachView(element) {
    this.view = this.E.mountView(element, {
      evaluator: this.evaluator,
      textures: this.textures,
      onPick: (r, m) => this.onPick(r, m),
      onBox: (r, m) => this.onBox(r, m),
      onEditPick: (r, m) => this.editPick(r, m),
      onTransform: (t) => this.onTransform(t),
      onBrush: (phase, hit, extra) => this.onBrush(phase, hit, extra),
      onDragStart: () => {
        this.dragBase = this.doc;
        this.beginAnimDrag();
      },
      onDragEnd: () => this.seal(),
      onCamera: () => {
        if (this.dialog === null && this.brushOverlay) this.camTick++;
      },
    });
    return this.view;
  }

  detachView() {
    this.view?.dispose();
    this.view = null;
  }

  focusSelected() {
    if (this.mode === 'edit' && this.edit.all.size && this.obj) {
      const m = this.E.docs.worldMatrix(this.doc, this.active);
      const mesh = this.editMesh ?? this.evaluator.base(this.doc, this.active);
      const pts = [...this.edit.all].map((i) => mesh.v[i]);
      const c = pts
        .reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0])
        .map((x) => x / pts.length);
      const r = Math.max(
        0.1,
        ...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])),
      );
      const V = this.view.camera.position.constructor;
      const world = new V(...c).applyMatrix4(m);
      return this.view.focusPoint(world, r * 1.3);
    }
    this.view?.focusOn(
      this.selected.length ? this.selected : Object.keys(this.doc.objects),
    );
  }

  setView(name) {
    this.view?.setView(name);
  }

  // A transform from the gizmo (objects, vertices, bones).
  onTransform(t) {
    if (t.kind === 'objects') {
      const doc = this.E.docs.updateObjects(this.doc, t.patches);
      this.commit(doc, 'Transform', { merge: 'gizmo' });
      if (t.final) {
        this.autoKeyObjects(t.patches.map(([id]) => id));
        this.seal();
      }
    } else if (t.kind === 'verts') this.moveVerts(t.mesh, t.final);
    else if (t.kind === 'pose') this.poseBones(t.arm, t.poses, t.final);
    else if (t.kind === 'bones')
      this.moveBoneEnds(t.arm, t.bone, t.head, t.tail, t.final);
  }

  onBrush(phase, hit, extra) {
    if (this.mode === 'sculpt') return this.sculptStroke(phase, hit, extra);
    if (this.mode === 'paint') return this.paintStroke(phase, hit, extra);
    if (this.mode === 'weight') return this.weightStroke(phase, hit, extra);
  }

  // ─── Objects ───────────────────────────────────────────────────────

  // Where new things go: on the ground in front of the camera.
  get placeAt() {
    const v = this.view;
    if (!v) return [0, 0, 0];
    const p = v.fly.pivot;
    const snap = (x) => Math.round(x * 4) / 4;
    return [snap(p.x), 0, snap(p.z)];
  }

  addPrimitive(kind) {
    const def = this.E.PRIMITIVES[kind];
    const mesh = this.E.buildPrimitive(kind);
    const { min, max } = this.E.mesh.bounds(mesh);
    const parent =
      this.mode === 'object' && this.obj?.type === 'group' ? this.active : null;
    const at = this.freeSpot(this.placeAt, min, max);
    let doc = this.doc;
    // A plain material to start with: never one that's been painted on
    // another object (its texture is laid out on that object's UVs).
    let mat = doc.materialOrder.find(
      (m) => !doc.materials[m].layers?.length && !doc.materials[m].outlineOnly,
    );
    if (!mat) {
      const fresh = this.E.docs.newMaterial({
        name: this.uniqueMatName('Material'),
      });
      doc = this.E.docs.addMaterial(doc, fresh);
      mat = fresh.id;
    }
    let id;
    [doc, id] = this.E.docs.addPrimitive(
      doc,
      kind,
      {},
      {
        name: def.label,
        pos: [at[0], -min[1], at[2]],
        parent,
        materials: [mat],
      },
    );
    this.commit(doc, `Add ${def.label}`);
    this.addMenu = false;
    if (this.mode === 'edit') this.exitEdit();
    this.select([id]);
    if (this.workspace === 'sculpt') this.mode = 'sculpt';
  }

  // Slides a new object's spot sideways until it doesn't sit inside
  // something that's already there.
  freeSpot(at, min, max) {
    const boxes = [];
    for (const o of Object.values(this.doc.objects)) {
      if (o.type !== 'mesh' || o.visible === false) continue;
      const mesh = this.evaluator.mesh(this.doc, o.id);
      if (!mesh.v.length) continue;
      const e = this.E.docs.worldMatrix(this.doc, o.id).elements;
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (const [x, y, z] of mesh.v) {
        const p = [
          e[0] * x + e[4] * y + e[8] * z + e[12],
          e[1] * x + e[5] * y + e[9] * z + e[13],
          e[2] * x + e[6] * y + e[10] * z + e[14],
        ];
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], p[k]);
          hi[k] = Math.max(hi[k], p[k]);
        }
      }
      boxes.push([lo, hi]);
    }
    const w = max[0] - min[0];
    const d = max[2] - min[2];
    const pos = [...at];
    for (let tries = 0; tries < 40; tries++) {
      const lo = [pos[0] + min[0], 0, pos[2] + min[2]];
      const hi = [pos[0] + max[0], max[1] - min[1], pos[2] + max[2]];
      const hit = boxes.find(
        ([a, b]) =>
          lo[0] < b[0] &&
          hi[0] > a[0] &&
          lo[1] < b[1] &&
          hi[1] > a[1] &&
          lo[2] < b[2] &&
          hi[2] > a[2],
      );
      if (!hit) break;
      pos[0] =
        Math.round((hit[1][0] - min[0] + Math.max(0.25, w * 0.25)) * 4) / 4;
      if (tries % 8 === 7) pos[2] += d + 0.5;
    }
    return pos;
  }

  addObject(type, props = {}) {
    const at = this.placeAt;
    const defaults = {
      group: { name: 'Group', pos: at },
      empty: { name: 'Empty', pos: [at[0], 0.5, at[2]] },
      camera: {
        name: 'Camera',
        pos: [at[0] + 3, 2, at[2] + 4],
        rot: [-20, 35, 0],
      },
      armature: {
        name: 'Armature',
        pos: at,
        bones: [
          this.E.rig.newBone({
            name: 'Root',
            head: [0, 0, 0],
            tail: [0, 1, 0],
          }),
        ],
      },
    };
    const lights = {
      point: {
        name: 'Point light',
        light: {
          kind: 'point',
          color: '#ffffff',
          intensity: 25,
          range: 0,
          angle: 30,
          shadows: false,
        },
        pos: [at[0], 2.5, at[2]],
      },
      spot: {
        name: 'Spot light',
        light: {
          kind: 'spot',
          color: '#ffffff',
          intensity: 60,
          range: 0,
          angle: 30,
          shadows: true,
        },
        pos: [at[0], 4, at[2] + 2],
        rot: [-60, 0, 0],
      },
      directional: {
        name: 'Sun',
        light: {
          kind: 'directional',
          color: '#fff6e8',
          intensity: 2.2,
          range: 0,
          angle: 30,
          shadows: true,
        },
        pos: [4, 6, 3],
        rot: [-50, 40, 0],
      },
      ambient: {
        name: 'Ambient light',
        light: { kind: 'ambient', color: '#bfcfff', intensity: 0.6 },
        pos: [at[0], 3, at[2]],
      },
    };
    const kind = type.startsWith('light:') ? 'light' : type;
    const base =
      kind === 'light' ? lights[type.slice(6)] : (defaults[type] ?? {});
    const [doc, id] = this.E.docs.createObject(this.doc, kind, {
      ...base,
      ...props,
    });
    this.commit(doc, `Add ${base.name ?? type}`);
    this.addMenu = false;
    this.select([id]);
    if (kind === 'armature') {
      this.boneSel = {
        arm: id,
        active: this.doc.objects[id].bones[0]?.id ?? null,
        ids: new Set(),
      };
      if (this.workspace === 'rig') this.mode = 'bones';
    }
  }

  deleteSelected() {
    if (!this.selected.length) return;
    const n = this.selected.length;
    this.commit(
      this.E.docs.removeObjects(this.doc, this.selected),
      n > 1 ? `Delete ${n} objects` : 'Delete',
    );
    this.select([]);
  }

  duplicateSelected() {
    if (!this.selected.length) return;
    const [doc, made] = this.E.docs.duplicate(this.doc, this.selected);
    this.commit(doc, 'Duplicate');
    this.select(made);
    this.tool = 'move';
  }

  groupSelected() {
    if (!this.selected.length) return;
    const ids = this.selected.filter(
      (id) =>
        !this.E.docs
          .ancestors(this.doc, id)
          .some((a) => this.selected.includes(a)),
    );
    const first = this.doc.objects[ids[0]];
    let [doc, group] = this.E.docs.createObject(
      this.doc,
      'group',
      { name: 'Group', pos: [...first.pos] },
      first.parent,
    );
    for (const id of ids) doc = this.E.docs.reparent(doc, id, group);
    this.commit(doc, 'Group');
    this.select([group]);
  }

  ungroup(id = this.active) {
    const g = this.doc.objects[id];
    if (!g || !g.children.length) return;
    let doc = this.doc;
    const kids = [...g.children];
    for (const c of kids) doc = this.E.docs.reparent(doc, c, g.parent);
    if (g.type === 'group') doc = this.E.docs.removeObjects(doc, [id]);
    this.commit(doc, 'Ungroup');
    this.select(kids);
  }

  // Parents the other selected objects to the active one.
  parentToActive() {
    const others = this.selected.filter((id) => id !== this.active);
    if (!this.active || !others.length)
      return this.flash('Select the children, then the parent last.');
    let doc = this.doc;
    for (const id of others) doc = this.E.docs.reparent(doc, id, this.active);
    this.commit(doc, 'Parent');
  }

  unparentSelected() {
    let doc = this.doc;
    for (const id of this.selected) doc = this.E.docs.reparent(doc, id, null);
    this.commit(doc, 'Clear parent');
  }

  reparent(id, parent, index = -1) {
    const doc = this.E.docs.reparent(this.doc, id, parent, index);
    if (doc !== this.doc) this.commit(doc, 'Move in outliner');
  }

  rename(id, name) {
    const o = this.doc.objects[id];
    this.renaming = null;
    if (!o || !name.trim() || name === o.name) return;
    const unique = this.E.docs.uniqueName(this.doc, name.trim(), id);
    this.commit(
      this.E.docs.updateObject(this.doc, id, { name: unique }),
      'Rename',
    );
  }

  startRename(id) {
    this.renaming = id;
  }

  toggleVisible(id) {
    const o = this.doc.objects[id];
    this.commit(
      this.E.docs.updateObject(this.doc, id, { visible: o.visible === false }),
      o.visible === false ? 'Show' : 'Hide',
    );
  }

  toggleLock(id) {
    const o = this.doc.objects[id];
    this.commit(
      this.E.docs.updateObject(this.doc, id, { locked: !o.locked }),
      o.locked ? 'Unlock' : 'Lock',
    );
  }

  hideSelected() {
    this.commit(
      this.E.docs.updateObjects(
        this.doc,
        this.selected.map((id) => [id, { visible: false }]),
      ),
      'Hide',
    );
    this.select([]);
  }

  unhideAll() {
    const hidden = Object.values(this.doc.objects)
      .filter((o) => o.visible === false)
      .map((o) => [o.id, { visible: true }]);
    if (hidden.length)
      this.commit(this.E.docs.updateObjects(this.doc, hidden), 'Show all');
  }

  setTransform(field, axis, value, final) {
    if (!this.obj) return;
    const next = [...this.obj[field]];
    next[axis] = value;
    const patches = this.selected.map((id) => {
      const o = this.doc.objects[id];
      const v = [...o[field]];
      v[axis] = id === this.active ? value : v[axis];
      return [id, { [field]: id === this.active ? next : v }];
    });
    this.commit(this.E.docs.updateObjects(this.doc, patches), 'Transform', {
      merge: `tf:${field}${axis}`,
    });
    if (final) {
      this.autoKeyObjects([this.active], field);
      this.seal();
    }
  }

  resetTransform(field) {
    const value = field === 'scl' ? [1, 1, 1] : [0, 0, 0];
    this.commit(
      this.E.docs.updateObjects(
        this.doc,
        this.selected.map((id) => [id, { [field]: value }]),
      ),
      `Clear ${field === 'pos' ? 'location' : field === 'rot' ? 'rotation' : 'scale'}`,
    );
  }

  // Sits the selection on the ground (its lowest point at y = 0).
  dropToGround() {
    const patches = [];
    for (const id of this.selected) {
      const o = this.doc.objects[id];
      if (o.type !== 'mesh') continue;
      const m = this.E.docs.worldMatrix(this.doc, id);
      const mesh = this.evaluator.mesh(this.doc, id);
      let low = Infinity;
      const e = m.elements;
      for (const [x, y, z] of mesh.v)
        low = Math.min(low, e[1] * x + e[5] * y + e[9] * z + e[13]);
      if (Number.isFinite(low))
        patches.push([id, { pos: [o.pos[0], o.pos[1] - low, o.pos[2]] }]);
    }
    if (patches.length)
      this.commit(
        this.E.docs.updateObjects(this.doc, patches),
        'Drop to ground',
      );
  }

  setLight(key, value, final) {
    const o = this.obj;
    this.commit(
      this.E.docs.updateObject(this.doc, o.id, {
        light: { ...o.light, [key]: value },
      }),
      'Light',
      { merge: `light:${key}` },
    );
    if (final) this.seal();
  }

  setCamera(key, value, final) {
    const o = this.obj;
    this.commit(
      this.E.docs.updateObject(this.doc, o.id, {
        camera: { ...o.camera, [key]: value },
      }),
      'Camera',
      { merge: `cam:${key}` },
    );
    if (final) this.seal();
  }

  // Puts the viewport where a scene camera is.
  lookThrough() {
    const o = this.obj;
    if (o?.type !== 'camera' || !this.view) return;
    const m = this.E.docs.worldMatrix(this.doc, o.id);
    const V = this.view.camera.position.constructor;
    const pos = new V().setFromMatrixPosition(m);
    const fwd = new V(0, 0, -1).transformDirection(m);
    this.view.fly.lookAt(pos, pos.clone().add(fwd));
    this.view.camera.fov = o.camera.fov;
    this.view.camera.updateProjectionMatrix();
  }

  // ─── Keyboard ──────────────────────────────────────────────────────

  keydown(e) {
    if (!this.ready || isTyping(document.activeElement)) return;
    if (this.dialog) {
      if (e.key === 'Escape') this.closeDialog();
      return;
    }
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    const ws = WORKSPACES.find((w) => w.key === e.key);
    if (ws) {
      e.preventDefault();
      return this.setWorkspace(ws.id);
    }
    if (ctrl && k === 'z') {
      e.preventDefault();
      return e.shiftKey ? this.redo() : this.undo();
    }
    if (ctrl && k === 'y') {
      e.preventDefault();
      return this.redo();
    }
    if (ctrl && k === 's') {
      e.preventDefault();
      return this.saveProject();
    }
    if (ctrl && ['1', '2', '3', '4'].includes(k)) {
      e.preventDefault();
      return this.setTool(
        { 1: 'select', 2: 'move', 3: 'scale', 4: 'rotate' }[k],
      );
    }
    if (this.handleModeKey(e, k, ctrl)) return;
    if (ctrl && k === 'd') {
      e.preventDefault();
      return this.duplicateSelected();
    }
    if (ctrl && k === 'g') {
      e.preventDefault();
      return e.shiftKey ? this.ungroup() : this.groupSelected();
    }
    if (ctrl && k === 'a') {
      e.preventDefault();
      return this.selectAll();
    }
    if (ctrl || e.altKey) {
      if (e.altKey && k === 'h') this.unhideAll();
      return;
    }
    if (k === 'f') return this.focusSelected();
    if (k === 'tab') {
      e.preventDefault();
      return this.setMode(this.mode === 'edit' ? 'object' : 'edit');
    }
    if (k === 'delete' || k === 'backspace' || k === 'x') {
      if (this.mode === 'object') return this.deleteSelected();
    }
    if (k === 'h' && this.mode === 'object') return this.hideSelected();
    if (k === 'escape') {
      this.addMenu = false;
      if (this.mode === 'edit') return this.exitEdit();
      return this.select([]);
    }
    if (k === '?') this.openDialog('help');
  }
}

// Actions from the other files.
for (const part of [modelActions, paintActions, rigActions, animActions])
  // Descriptors, not values: reading a getter here would run it on the wrong object.
  for (const name of Object.keys(part))
    if (name !== 'init')
      Object.defineProperty(
        StudioState.prototype,
        name,
        Object.getOwnPropertyDescriptor(part, name),
      );

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export const safeName = (name) =>
  String(name || 'model').replace(/[^\w.-]+/g, '_');
