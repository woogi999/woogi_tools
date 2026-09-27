// Texturing (layers, painting, smart materials, bakes) and sculpting.
// Mixed into StudioState (state.js).

import { tracked } from '@glimmer/tracking';

// Brush settings live in small tracked holders so panels update as they change.
class Brush {
  @tracked tool = 'brush';
  @tracked size = 40;
  @tracked hardness = 0.4;
  @tracked opacity = 1;
  @tracked flow = 0.6;
  @tracked spacing = 0.2;
  @tracked falloff = 'smooth';
  @tracked color = '#e0503a';
  @tracked color2 = '#2a2a2e';
  @tracked rough = 0.5;
  @tracked metal = 0;
  @tracked height = 0.7;
  @tracked channels = {
    color: true,
    rough: false,
    metal: false,
    height: false,
  };
  @tracked backfaces = false;
  @tracked fillIsland = true;
  @tracked image = null; // { name, data: ImageData, url }
  @tracked overlayOpacity = 0.45;
  @tracked decalSize = 0.3;
  @tracked decalRotation = 0;
}

class SculptBrush {
  @tracked tool = 'draw';
  @tracked size = 50;
  @tracked strength = 0.5;
  @tracked hardness = 0.2;
  @tracked falloff = 'smooth';
  @tracked symmetry = [true, false, false];
  @tracked invert = false;
}

class WeightBrush {
  @tracked tool = 'add';
  @tracked size = 40;
  @tracked strength = 0.5;
  @tracked value = 1;
  @tracked hardness = 0.3;
  @tracked falloff = 'smooth';
  @tracked symmetry = [false, false, false];
  @tracked autoNormalize = true;
}

class PaintState {
  @tracked activeLayer = null;
  @tracked maskEdit = false;
  @tracked bakeProgress = null;
  @tracked texTick = 0;
}

const hexRgb = (hex) => {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const rgbHex = (r, g, b) =>
  `#${[r, g, b]
    .map((x) =>
      Math.round(Math.max(0, Math.min(1, x)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

export default {
  init() {
    this.brush = new Brush();
    this.sculptBrush = new SculptBrush();
    this.weightBrush = new WeightBrush();
    this.paintState = new PaintState();
  },

  get brushRadius() {
    if (this.mode === 'sculpt') return this.sculptBrush.size;
    if (this.mode === 'weight') return this.weightBrush.size;
    return this.brush.size;
  },

  // Whether the projection/stencil image is drawn over the viewport.
  get brushOverlay() {
    return (
      this.mode === 'paint' &&
      ['projection', 'stencil'].includes(this.brush.tool) &&
      this.brush.image
    );
  },

  setBrush(which, key, value) {
    const b =
      which === 'sculpt'
        ? this.sculptBrush
        : which === 'weight'
          ? this.weightBrush
          : this.brush;
    b[key] = value;
  },

  toggleBrushChannel(ch) {
    this.brush.channels = {
      ...this.brush.channels,
      [ch]: !this.brush.channels[ch],
    };
  },

  toggleSymmetry(which, axis) {
    const b = which === 'weight' ? this.weightBrush : this.sculptBrush;
    const s = [...b.symmetry];
    s[axis] = !s[axis];
    b.symmetry = s;
  },

  // ─── Texture sets ──────────────────────────────────────────────────

  scheduleTextures() {
    clearTimeout(this.texTimer);
    this.texTimer = setTimeout(
      () => this.refreshTextures(),
      this.painting ? 400 : 120,
    );
  },

  // Binds every layered material to the object it's painted on and
  // recomposites whatever changed since last time.
  refreshTextures(force = false) {
    if (!this.doc || !this.textures) return;
    this.lastMats ??= new Map();
    for (const id of this.doc.materialOrder) {
      const mat = this.doc.materials[id];
      if (!mat.layers?.length) {
        if (this.textures.get(id)) this.textures.drop(id);
        continue;
      }
      const user = this.paintTargetFor(id);
      if (!user) continue;
      const mesh = this.evaluator.mesh(this.doc, user.id);
      const set = this.textures.bind(mat, user.id, mesh, user.slot);
      const key = `${set.map ? set.key : 'none'}|${set.mesh?.v.length}`;
      if (
        force ||
        this.lastMats.get(id)?.mat !== mat ||
        this.lastMats.get(id)?.key !== key ||
        this.lastMats.get(id)?.set !== set
      ) {
        this.textures.composite(mat, set);
        this.lastMats.set(id, { mat, key, set });
        this.view?.touchTextures(set);
      }
    }
    this.paintState.texTick++;
  },

  textureUpdated(matId) {
    const mat = this.doc.materials[matId];
    const set = this.textures.get(matId);
    if (!mat || !set) return;
    this.textures.composite(mat, set);
    this.view?.touchTextures(set);
    this.paintState.texTick++;
  },

  // The object (and slot) a material's texture set is painted on: the
  // active object if it uses it, else the first that does.
  paintTargetFor(matId) {
    const pick = (o) => {
      if (o?.type !== 'mesh' || o.source?.kind === 'outline') return null;
      const mats = o.materials?.length
        ? o.materials
        : [this.doc.materialOrder[0]];
      const slot = mats.indexOf(matId);
      return slot >= 0 ? { id: o.id, slot } : null;
    };
    // A painted material stays on the object it was painted on, so its
    // texture keeps that object's UV layout whatever is selected.
    const owner = this.doc.materials[matId]?.owner;
    return (
      pick(this.doc.objects[owner]) ??
      pick(this.obj) ??
      Object.values(this.doc.objects).map(pick).find(Boolean) ??
      null
    );
  },

  // Before layers go on a material, make sure it belongs to the active
  // object alone: a texture is laid out on one object's UVs, so another
  // object sharing it would show someone else's paint. Returns the id.
  ownMaterial() {
    const o = this.obj;
    let m = this.mat;
    if (!m || o?.type !== 'mesh') return m?.id ?? null;
    const owner = m.owner && this.doc.objects[m.owner] ? m.owner : null;
    const users = Object.values(this.doc.objects).filter((x) =>
      x.materials?.includes(m.id),
    );
    if (
      (owner && owner !== o.id) ||
      (!owner && users.length > 1 && m.layers?.length)
    ) {
      const copy = structuredClone(m);
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
      const id = this.addMaterial({
        ...copy,
        name: this.uniqueMatName(`${m.name} (${o.name})`),
        owner: o.id,
      });
      this.flash(
        `“${o.name}” now has its own copy of the material, so it can be painted on its own.`,
      );
      return id;
    }
    if (!owner)
      this.commit(
        this.E.docs.updateMaterial(this.doc, m.id, { owner: o.id }),
        'Paint material',
        { merge: 'own' },
      );
    return m.id;
  },

  get texSet() {
    void this.paintState.texTick;
    return this.mat ? this.textures.get(this.mat.id) : null;
  },

  // ─── Layers ────────────────────────────────────────────────────────

  get layerRows() {
    const m = this.mat;
    if (!m) return [];
    void this.paintState.texTick;
    return [...(m.layers ?? [])].reverse().map((l) => ({
      layer: l,
      active: l.id === this.currentLayerId,
      swatch: l.kind === 'fill' ? l.fill.color : null,
    }));
  },

  get currentLayerId() {
    const layers = this.mat?.layers ?? [];
    if (layers.some((l) => l.id === this.paintState.activeLayer))
      return this.paintState.activeLayer;
    return layers[layers.length - 1]?.id ?? null;
  },

  get layer() {
    return this.mat?.layers?.find((l) => l.id === this.currentLayerId) ?? null;
  },

  setActiveLayer(id) {
    this.paintState.activeLayer = id;
    this.paintState.maskEdit = false;
  },

  setLayers(layers, label, merge = null) {
    this.commit(
      this.E.docs.updateMaterial(this.doc, this.mat.id, { layers }),
      label,
      { merge },
    );
  },

  // Makes sure the active mesh has a material that can be painted.
  ensurePaintMaterial() {
    const o = this.obj;
    if (o?.type !== 'mesh') return;
    if (!o.materials?.length) this.assignMaterial(this.doc.materialOrder[0], 0);
  },

  addLayer(kind = 'paint') {
    this.ownMaterial();
    const m = this.mat;
    if (!m) return;
    const layer = this.E.tex.newLayer(kind, {
      name:
        kind === 'paint'
          ? `Paint ${(m.layers?.length ?? 0) + 1}`
          : `Fill ${(m.layers?.length ?? 0) + 1}`,
    });
    if (kind === 'fill')
      layer.fill = {
        ...layer.fill,
        color: m.color,
        rough: m.rough,
        metal: m.metal,
      };
    const layers = [...(m.layers ?? [])];
    const at = layers.findIndex((l) => l.id === this.currentLayerId);
    layers.splice(at < 0 ? layers.length : at + 1, 0, layer);
    this.setLayers(layers, `Add ${kind} layer`);
    this.paintState.activeLayer = layer.id;
    this.refreshTextures();
  },

  removeLayer(id = this.currentLayerId) {
    const m = this.mat;
    this.setLayers(
      m.layers.filter((l) => l.id !== id),
      'Delete layer',
    );
    this.refreshTextures();
  },

  duplicateLayer(id = this.currentLayerId) {
    const m = this.mat;
    const src = m.layers.find((l) => l.id === id);
    if (!src) return;
    const copy = {
      ...structuredClone(src),
      id: this.E.docs.newId('lyr'),
      name: `${src.name} copy`,
    };
    const px = this.pixels.get(src.id);
    if (px)
      this.pixels.set(copy.id, {
        size: px.size,
        color: new Uint8ClampedArray(px.color),
        pbr: new Uint8ClampedArray(px.pbr),
      });
    const mk = this.pixels.get(`${src.id}:mask`);
    if (mk)
      this.pixels.set(`${copy.id}:mask`, {
        size: mk.size,
        mask: new Uint8ClampedArray(mk.mask),
      });
    const layers = [...m.layers];
    layers.splice(layers.indexOf(src) + 1, 0, copy);
    this.setLayers(layers, 'Duplicate layer');
    this.paintState.activeLayer = copy.id;
  },

  // Up the list is up the stack (drawn on top).
  moveLayer(id, dir) {
    const layers = [...this.mat.layers];
    const i = layers.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= layers.length) return;
    [layers[i], layers[j]] = [layers[j], layers[i]];
    this.setLayers(layers, 'Reorder layers');
  },

  // Drag-and-drop in the layer list: put `id` where `target` is.
  dropLayer(id, target) {
    const layers = [...this.mat.layers];
    const from = layers.findIndex((l) => l.id === id);
    const to = layers.findIndex((l) => l.id === target);
    if (from < 0 || to < 0 || from === to) return;
    const [l] = layers.splice(from, 1);
    layers.splice(to, 0, l);
    this.setLayers(layers, 'Reorder layers');
  },

  patchLayer(id, patch, label = 'Layer', merge = null) {
    const layers = this.mat.layers.map((l) =>
      l.id === id ? { ...l, ...patch } : l,
    );
    this.setLayers(layers, label, merge);
  },

  setLayerProp(key, value, final) {
    this.patchLayer(
      this.currentLayerId,
      { [key]: value },
      'Layer',
      `layer:${this.currentLayerId}:${key}`,
    );
    if (final) this.seal();
  },

  renameLayer(id, e) {
    const name = e.target.value.trim();
    if (name) this.patchLayer(id, { name }, 'Rename layer');
  },

  toggleLayerVisible(id) {
    const l = this.mat.layers.find((x) => x.id === id);
    this.patchLayer(
      id,
      { visible: !l.visible },
      l.visible ? 'Hide layer' : 'Show layer',
    );
  },

  toggleLayerChannel(ch) {
    const l = this.layer;
    this.patchLayer(
      l.id,
      { channels: { ...l.channels, [ch]: !l.channels[ch] } },
      'Layer channels',
    );
  },

  setFill(key, value, final) {
    const l = this.layer;
    this.patchLayer(
      l.id,
      { fill: { ...l.fill, [key]: value } },
      'Fill',
      `fill:${l.id}:${key}`,
    );
    if (final) this.seal();
  },

  setFillGen(type) {
    const l = this.layer;
    this.patchLayer(
      l.id,
      {
        fill: {
          ...l.fill,
          mode: type === 'solid' ? 'solid' : 'generator',
          gen: type === 'solid' ? l.fill.gen : { type, params: {} },
        },
      },
      'Fill source',
    );
  },

  setFillGenParam(key, value, final) {
    const l = this.layer;
    this.patchLayer(
      l.id,
      {
        fill: {
          ...l.fill,
          gen: {
            ...l.fill.gen,
            params: { ...l.fill.gen.params, [key]: value },
          },
        },
      },
      'Generator',
      `gen:${l.id}:${key}`,
    );
    if (final) this.seal();
  },

  async setFillImage(file) {
    if (!file) return;
    try {
      const { url, img } = await this.readImageFile(file);
      const id = this.E.docs.newId('tex');
      const textures = {
        ...this.doc.textures,
        [id]: { id, name: file.name, url, w: img.width, h: img.height },
      };
      this.imageCache.set(id, Promise.resolve(img));
      const l = this.layer;
      const layers = this.mat.layers.map((x) =>
        x.id === l.id
          ? { ...x, fill: { ...x.fill, mode: 'image', image: id } }
          : x,
      );
      this.commit(
        this.E.docs.updateMaterial({ ...this.doc, textures }, this.mat.id, {
          layers,
        }),
        'Image fill',
      );
    } catch (error) {
      this.flash(error.message, 'error');
    }
  },

  addMask(mode = 'paint') {
    const l = this.layer;
    if (!l) return;
    const mask =
      mode === 'paint'
        ? { mode: 'paint', invert: false }
        : { mode: 'generator', gen: { type: mode, params: {} }, invert: false };
    if (mode === 'paint')
      this.textures.maskPixels(l.id, this.mat.texSize ?? 1024);
    this.patchLayer(l.id, { mask }, 'Add mask');
    this.paintState.maskEdit = mode === 'paint';
  },

  removeMask() {
    this.patchLayer(this.currentLayerId, { mask: null }, 'Remove mask');
    this.paintState.maskEdit = false;
  },

  setMaskGen(type) {
    const l = this.layer;
    this.patchLayer(
      l.id,
      { mask: { ...l.mask, mode: 'generator', gen: { type, params: {} } } },
      'Mask source',
    );
  },

  setMaskParam(key, value, final) {
    const l = this.layer;
    this.patchLayer(
      l.id,
      {
        mask: {
          ...l.mask,
          gen: {
            ...l.mask.gen,
            params: { ...l.mask.gen.params, [key]: value },
          },
        },
      },
      'Mask',
      `mask:${l.id}:${key}`,
    );
    if (final) this.seal();
  },

  toggleMaskInvert() {
    const l = this.layer;
    this.patchLayer(
      l.id,
      { mask: { ...l.mask, invert: !l.mask.invert } },
      'Invert mask',
    );
  },

  toggleMaskEdit() {
    this.paintState.maskEdit = !this.paintState.maskEdit;
  },

  // Wipes a paint layer (or its mask) — undoable like a stroke.
  clearLayer() {
    const l = this.layer;
    const set = this.texSet;
    if (!l || !set) return;
    const size = set.size;
    const target =
      this.paintState.maskEdit && l.mask?.mode === 'paint'
        ? { kind: 'mask', ...this.textures.maskPixels(l.id, size) }
        : { kind: 'paint', ...this.textures.layerPixels(l.id, size) };
    const stroke = new this.E.paint.Stroke(set.map, target, {
      ...this.brushSnapshot(),
      tool: 'eraser',
      opacity: 1,
    });
    for (let i = 0; i < size * size; i++) {
      stroke.apply(i, 1, [0, 0, 0], target.kind === 'paint');
      if (target.kind === 'mask') target.mask[i] = 255;
      stroke.dirty.add(i, size);
    }
    this.finishStroke(stroke, l, target, 'Clear layer');
  },

  setTexSize(size) {
    const m = this.mat;
    this.commit(
      this.E.docs.updateMaterial(this.doc, m.id, { texSize: Number(size) }),
      'Texture size',
    );
    this.refreshTextures(true);
  },

  // ─── Smart materials ───────────────────────────────────────────────

  get smartMaterials() {
    return Object.entries(this.E.tex.SMART_MATERIALS).map(([key, v]) => ({
      key,
      ...v,
    }));
  },

  applySmartMaterial(key) {
    const sm = this.E.tex.SMART_MATERIALS[key];
    if (!this.mat) return;
    // Shared with other objects? This object gets a material of its own.
    const users = Object.values(this.doc.objects).filter((o) =>
      o.materials?.includes(this.mat.id),
    ).length;
    if (users > 1 && this.isMesh)
      this.addMaterial({ name: sm.label, owner: this.active });
    else this.ownMaterial();
    const m = this.mat;
    const layers = sm.overlay
      ? [...(m.layers ?? []), ...sm.layers()]
      : sm.layers();
    const patch = { ...sm.material, layers };
    if (!sm.overlay && m.name.startsWith('Material'))
      patch.name = this.uniqueMatName(sm.label);
    this.commit(
      this.E.docs.updateMaterial(this.doc, m.id, patch),
      `Smart material: ${sm.label}`,
    );
    this.paintState.activeLayer = layers[layers.length - 1].id;
    this.refreshTextures(true);
    this.flash(
      `${sm.label}: ${layers.length} editable layers. Generators refine once the shape has been analysed.`,
    );
  },

  // Brush presets from the same library (material painting).
  brushFromSmart(key) {
    const sm = this.E.tex.SMART_MATERIALS[key];
    const b = this.brush;
    b.color = sm.material.color ?? sm.swatch;
    b.rough = sm.material.rough ?? b.rough;
    b.metal = sm.material.metal ?? b.metal;
    b.channels = {
      color: true,
      rough: true,
      metal: true,
      height: b.channels.height,
    };
    this.flash(`Brush loaded with ${sm.label}.`);
  },

  // ─── Painting ──────────────────────────────────────────────────────

  brushSnapshot() {
    const b = this.brush;
    return {
      tool: b.tool,
      size: b.size,
      hardness: b.hardness,
      opacity: b.opacity,
      flow:
        b.tool === 'projection' || b.tool === 'stencil'
          ? Math.max(b.flow, 0.9)
          : b.flow,
      falloff: b.falloff,
      color: hexRgb(b.color),
      rough: b.rough,
      metal: b.metal,
      height: b.height,
      channels: { ...b.channels },
      backfaces: b.backfaces,
      maskValue: this.maskValue ?? 1,
    };
  },

  // The layer and buffers a stroke goes into, creating a paint layer if the
  // material has none (or a fill layer is active).
  strokeTarget() {
    this.ownMaterial();
    let m = this.mat;
    if (!m) return null;
    let l = this.layer;
    if (
      !l ||
      (l.kind !== 'paint' &&
        !(this.paintState.maskEdit && l.mask?.mode === 'paint'))
    ) {
      if (
        [
          'fill',
          'gradient',
          'decal',
          'projection',
          'stencil',
          'brush',
          'smudge',
          'blur',
          'eraser',
        ].includes(this.brush.tool)
      ) {
        this.addLayer('paint');
        m = this.mat;
        l = this.layer;
      }
    }
    this.refreshTextures();
    const set = this.textures.get(m.id);
    if (!set?.map) {
      this.flash(
        'This material isn’t on any faces of the selected mesh.',
        'error',
      );
      return null;
    }
    const size = set.size;
    const target =
      this.paintState.maskEdit && l.mask?.mode === 'paint'
        ? { kind: 'mask', ...this.textures.maskPixels(l.id, size) }
        : { kind: 'paint', ...this.textures.layerPixels(l.id, size) };
    return { mat: m, layer: l, set, target };
  },

  paintStroke(phase, hit, extra) {
    const b = this.brush;
    const tool = b.tool;
    if (phase === 'start') {
      if (tool === 'picker') return hit && this.pickColor(hit);
      if (tool === 'gradient') {
        this.gradient = { a: extra.screen, b: extra.screen };
        return;
      }
      if (!hit) return;
      const t = this.strokeTarget();
      if (!t) return;
      if (tool === 'fill') return this.fillAt(t, hit);
      if (tool === 'decal') return this.decalAt(t, hit);
      if ((tool === 'projection' || tool === 'stencil') && !b.image)
        return this.flash('Load an image for this tool first.', 'error');
      this.painting = {
        ...t,
        stroke: new this.E.paint.Stroke(
          t.set.map,
          t.target,
          this.brushSnapshot(),
        ),
        last: null,
        project: this.view.projector(this.active),
      };
      this.paintDab(hit);
      return;
    }
    if (phase === 'move') {
      if (this.gradient) {
        this.gradient = { ...this.gradient, b: extra.screen };
        return;
      }
      if (this.painting && hit) this.paintDab(hit);
      return;
    }
    if (phase === 'end') {
      if (this.gradient) {
        const g = this.gradient;
        this.gradient = null;
        return this.applyGradient(g);
      }
      const p = this.painting;
      this.painting = null;
      if (p) this.finishStroke(p.stroke, p.layer, p.target, 'Paint');
    }
  },

  // Lays dabs from the last one to this hit, spaced by the brush's spacing.
  paintDab(hit) {
    const p = this.painting;
    const r = this.brush.size * hit.localPerPx;
    const step = Math.max(r * this.brush.spacing, 1e-5);
    const from = p.last?.point;
    const to = hit.point;
    const points = [];
    if (!from) points.push(to);
    else {
      const d = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
      if (d < step) return;
      const n = Math.min(64, Math.floor(d / step));
      for (let i = 1; i <= n; i++) {
        const t = (i * step) / d;
        points.push([
          from[0] + (to[0] - from[0]) * t,
          from[1] + (to[1] - from[1]) * t,
          from[2] + (to[2] - from[2]) * t,
        ]);
      }
    }
    const texel = hit.uv ? this.E.paint.texelAt(p.set.map, hit.uv) : null;
    const project = p.project;
    const map = p.set.map;
    const ctx = {
      facing: hit.facing,
      texel,
      image: this.brush.image?.data,
      project: (i) =>
        project(map.pos[i * 3], map.pos[i * 3 + 1], map.pos[i * 3 + 2]),
    };
    const rect = new this.E.paint.DirtyRect();
    for (const pt of points) rect.merge(p.stroke.dab(pt, r, ctx));
    p.last = { point: points[points.length - 1] };
    if (!rect.empty) this.recomposite(p.mat.id, rect.rect);
  },

  recomposite(matId, region) {
    const mat = this.doc.materials[matId];
    const set = this.textures.get(matId);
    if (!mat || !set) return;
    this.textures.composite(mat, set, region);
    this.view?.touchTextures(set);
  },

  finishStroke(stroke, layer, target, label) {
    const rec = stroke.finish();
    if (!rec) return;
    this.pushPixels({
      label,
      key: target.kind === 'mask' ? `${layer.id}:mask` : layer.id,
      matId: this.mat.id,
      size: stroke.map.size,
      ...rec,
    });
    this.recomposite(this.mat.id, rec.rect);
    this.paintState.texTick++;
  },

  // Undo/redo of a stroke: puts the rectangle back as it was (or after).
  applyPixels(entry, which) {
    const px = this.pixels.get(entry.key);
    if (!px || px.size !== entry.size) return;
    const target = entry.key.endsWith(':mask')
      ? { mask: px.mask }
      : { color: px.color, pbr: px.pbr };
    this.E.paint.restoreRect(target, entry.size, entry.rect, entry[which]);
    this.recomposite(entry.matId, entry.rect);
    this.paintState.texTick++;
  },

  fillAt(t, hit) {
    const map = t.set.map;
    const texel = hit.uv ? this.E.paint.texelAt(map, hit.uv) : -1;
    const island =
      this.brush.fillIsland && texel >= 0 ? map.island[texel] : null;
    const stroke = this.E.paint.fillTexels(
      map,
      t.target,
      this.brushSnapshot(),
      { island: island >= 0 ? island : null },
    );
    this.finishStroke(
      stroke,
      t.layer,
      t.target,
      island !== null ? 'Fill island' : 'Fill',
    );
  },

  decalAt(t, hit) {
    const b = this.brush;
    if (!b.image)
      return this.flash('Load an image to use as a decal.', 'error');
    const stroke = this.E.paint.decalTexels(
      t.set.map,
      t.target,
      this.brushSnapshot(),
      b.image.data,
      hit.point,
      hit.normal,
      hit.up,
      b.decalSize,
      (b.decalRotation * Math.PI) / 180,
    );
    this.finishStroke(stroke, t.layer, t.target, 'Decal');
  },

  applyGradient(g) {
    const t = this.strokeTarget();
    if (!t) return;
    if (Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) < 0.01)
      return this.flash('Drag across the model to lay a gradient.');
    const project = this.view.projector(this.active);
    const map = t.set.map;
    const stroke = this.E.paint.gradientTexels(
      map,
      t.target,
      this.brushSnapshot(),
      g.a,
      g.b,
      hexRgb(this.brush.color2),
      (i) => project(map.pos[i * 3], map.pos[i * 3 + 1], map.pos[i * 3 + 2]),
    );
    this.finishStroke(stroke, t.layer, t.target, 'Gradient');
  },

  // Colour picker: reads the composited texture under the cursor.
  pickColor(hit) {
    this.refreshTextures();
    const set = this.texSet;
    if (!set?.out || !hit.uv) return;
    const i = this.E.paint.texelAt(set.map, hit.uv);
    const c = set.out.color;
    const orm = set.out.orm;
    this.brush.color = rgbHex(
      c[i * 4] / 255,
      c[i * 4 + 1] / 255,
      c[i * 4 + 2] / 255,
    );
    this.brush.rough = Math.round((orm[i * 4 + 1] / 255) * 100) / 100;
    this.brush.metal = Math.round((orm[i * 4 + 2] / 255) * 100) / 100;
    this.brush.tool = 'brush';
    this.flash(`Picked ${this.brush.color}`);
  },

  async loadBrushImage(file) {
    if (!file) return;
    try {
      const { url, img } = await this.readImageFile(file);
      const c = document.createElement('canvas');
      const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, c.width, c.height);
      this.brush.image = {
        name: file.name,
        url,
        data: ctx.getImageData(0, 0, c.width, c.height),
      };
    } catch (error) {
      this.flash(error.message, 'error');
    }
  },

  clearBrushImage() {
    this.brush.image = null;
  },

  // ─── Baking ────────────────────────────────────────────────────────

  get bakers() {
    return Object.entries(this.E.BAKERS).map(([key, v]) => ({ key, ...v }));
  },

  // Bakes a map for the active material. Normal maps can take a detailed
  // mesh (the other selected mesh) as the source.
  async bake(kind, { samples = 32, toSlot = true } = {}) {
    this.refreshTextures();
    const m = this.mat;
    let set = this.texSet;
    if (!set?.map) {
      // Unlayered materials still bake: bind a set just for the bake.
      const user = this.paintTargetFor(m.id);
      if (!user)
        return this.flash('Put this material on a mesh first.', 'error');
      set = this.textures.bind(
        { ...m, layers: [{}] },
        user.id,
        this.evaluator.mesh(this.doc, user.id),
        user.slot,
      );
    }
    let high = null;
    const other = this.selected.find(
      (id) => id !== this.active && this.doc.objects[id]?.type === 'mesh',
    );
    if (kind === 'normal' && other) {
      const rel = this.E.docs
        .worldMatrix(this.doc, this.active)
        .invert()
        .multiply(this.E.docs.worldMatrix(this.doc, other));
      high = this.E.transformMesh(this.evaluator.mesh(this.doc, other), rel);
    }
    this.paintState.bakeProgress = { kind, value: 0 };
    try {
      const canvas = await this.textures.bake(set, kind, {
        high,
        samples,
        progress: (v) => (this.paintState.bakeProgress = { kind, value: v }),
      });
      const slot = {
        ao: 'ao',
        normal: 'normal',
        curvature: null,
        position: null,
        thickness: null,
        worldNormal: null,
        id: null,
      }[kind];
      if (toSlot && slot)
        this.canvasToMap(
          canvas,
          slot,
          `${m.name} ${this.E.BAKERS[kind].label}`,
        );
      else this.keepBake(canvas, kind);
      this.flash(
        `Baked ${this.E.BAKERS[kind].label.toLowerCase()}${high ? ' from the detailed mesh' : ''}.`,
      );
      this.refreshTextures(true);
    } catch (error) {
      this.flash(error.message, 'error');
    } finally {
      this.paintState.bakeProgress = null;
    }
  },

  // Maps without a material slot are kept as textures (and downloaded).
  keepBake(canvas, kind) {
    const url = canvas.toDataURL('image/png');
    const id = this.E.docs.newId('tex');
    const name = `${this.mat.name} ${this.E.BAKERS[kind].label}`;
    this.commit(
      {
        ...this.doc,
        textures: {
          ...this.doc.textures,
          [id]: { id, name, url, w: canvas.width, h: canvas.height },
        },
      },
      `Bake ${kind}`,
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/[^\w.-]+/g, '_')}.png`;
    a.click();
  },

  // ─── Sculpting ─────────────────────────────────────────────────────

  sculptStroke(phase, hit, extra) {
    if (phase === 'start') {
      if (!hit) return;
      const o = this.obj;
      if (o.source?.kind !== 'mesh') this.convertToMesh(o.id, { silent: true });
      const base = this.evaluator.base(this.doc, o.id);
      if (base.v.length < 200)
        this.flash(
          'Few vertices to sculpt with: “Subdivide” adds detail to work with.',
        );
      const b = this.sculptBrush;
      this.sculpting = {
        stroke: new this.E.sculpt.SculptStroke(base, {
          tool: b.tool,
          strength: b.strength,
          hardness: b.hardness,
          falloff: b.falloff,
          symmetry: b.symmetry,
        }),
        last: hit.point,
        plane: null,
        invert: b.invert !== !!(extra.event?.ctrlKey || extra.event?.metaKey),
        smooth: extra.event?.shiftKey,
      };
      this.sculptDab(hit, extra);
      return;
    }
    const s = this.sculpting;
    if (!s) return;
    if (phase === 'move') {
      if (this.sculptBrush.tool === 'grab') {
        if (!extra.plane) return;
        const p = extra.plane.local;
        const prev = s.plane ?? s.last;
        const delta = [p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]];
        s.plane = p;
        const r =
          this.sculptBrush.size *
          (s.lastHit?.localPerPx ?? hit?.localPerPx ?? 0.01);
        const moved = s.stroke.dab(s.last, r, { delta });
        this.view.previewPositions(this.active, s.stroke.mesh, moved);
        return;
      }
      if (hit) this.sculptDab(hit, extra);
      return;
    }
    if (phase === 'end') {
      this.sculpting = null;
      const o = this.obj;
      this.view.forgetPreview(o.id);
      this.commit(
        this.E.docs.updateObject(this.doc, o.id, {
          source: { ...o.source, kind: 'mesh', mesh: s.stroke.mesh },
        }),
        `Sculpt ${this.E.sculpt.SCULPT_BRUSHES[this.sculptBrush.tool].label}`,
      );
    }
  },

  sculptDab(hit, extra) {
    const s = this.sculpting;
    s.lastHit = hit;
    const r = this.sculptBrush.size * hit.localPerPx;
    if (this.sculptBrush.tool === 'grab') {
      s.last = hit.point;
      return;
    }
    const from = s.last;
    const to = hit.point;
    const d = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const step = r * 0.25;
    const n = s.first ? Math.max(1, Math.min(16, Math.floor(d / step))) : 1;
    s.first = true;
    const moved = new Set();
    // Shift temporarily smooths, as in most sculpting tools.
    const b = s.stroke.brush;
    const tool = b.tool;
    if (extra.event?.shiftKey) b.tool = 'smooth';
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const p = [
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t,
      ];
      for (const v of s.stroke.dab(p, r, { invert: s.invert })) moved.add(v);
    }
    b.tool = tool;
    s.last = to;
    this.view.previewPositions(this.active, s.stroke.mesh, moved);
  },

  // Adds detail for sculpting: Catmull–Clark on the whole mesh.
  sculptSubdivide(levels = 1) {
    const o = this.obj;
    if (o?.type !== 'mesh') return;
    const base = this.evaluator.base(this.doc, o.id);
    const faces = base.f.length * 4 ** levels;
    if (faces > 400000)
      return this.flash(
        'That would be too many faces to sculpt smoothly.',
        'error',
      );
    const mesh = this.E.mesh.subdivide(base, levels, { smooth: true });
    const smooth = { v: mesh.v, f: mesh.f.map((f) => ({ ...f, s: true })) };
    this.commit(
      this.E.docs.updateObject(this.doc, o.id, {
        source: { kind: 'mesh', mesh: smooth },
      }),
      'Subdivide for sculpting',
    );
    this.flash(`${smooth.f.length.toLocaleString()} faces to sculpt with.`);
  },

  sculptSmoothAll() {
    const o = this.obj;
    if (o?.type !== 'mesh') return;
    const base = this.evaluator.base(this.doc, o.id);
    this.commit(
      this.E.docs.updateObject(this.doc, o.id, {
        source: { kind: 'mesh', mesh: this.E.mesh.laplacian(base, 2, 0.5) },
      }),
      'Smooth',
    );
  },

  sculptDecimate() {
    const o = this.obj;
    if (o?.type !== 'mesh') return;
    const base = this.evaluator.base(this.doc, o.id);
    this.commit(
      this.E.docs.updateObject(this.doc, o.id, {
        source: { kind: 'mesh', mesh: this.E.mesh.decimate(base, 0.5) },
      }),
      'Decimate',
    );
  },
};
