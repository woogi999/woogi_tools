import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { array, concat, fn, get } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor, isDestroyed } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';
import ColourField from './colour-field';
import PbLayerProps from './pb-layer-props';
import { acceptPastedFiles } from '../utils/paste-files';
import { canvasBlob } from '../utils/watermark';
import { keepState } from '../utils/tool-state';
import { makeShelf } from '../utils/idb-store';
import { strokesFor } from '../utils/kanji-strokes';
import {
  CLIENT_ID as ROBLOX_CLIENT_ID,
  currentSession,
  imageIdOf,
  signIn,
  signOut,
  uploadDecal,
} from '../utils/roblox';
import { buildSkill, encodeSkill, parseIds } from '../utils/jjs-skill';
import {
  MAX_FRAMES,
  TEMPLATES,
  frameName,
  newBar,
  newDoc,
  newImage,
  newPaint,
  newRing,
  newShape,
  newText,
  normaliseDoc,
  newJjs,
  drawingFingerprint,
  render,
  setIn,
} from '../utils/progress-bar';

// JJS Progress Bar Maker. Jujutsu Shenanigans can't draw a bar that fills
// up, so you upload one picture per step and swap between them. This lays a
// bar out in a small image editor (layers, shapes, text, pictures, a brush,
// clipping) and writes out every step from empty to full in one go.
//
// The editor is a fixed grid the height of the window: every panel keeps its
// box and scrolls inside itself, so nothing shifts about while you work.

const eq = (a, b) => a === b;
const not = (v) => !v;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const THUMB_HEIGHT = 44;

const TOOLS = [
  { id: 'move', icon: 'mouse-pointer-2', label: 'Move and resize (V)' },
  { id: 'brush', icon: 'brush', label: 'Brush (B)' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser (E)' },
  { id: 'shape', icon: 'shapes', label: 'Shapes and progress bars (U)' },
  { id: 'text', icon: 'type', label: 'Text (T)' },
];

// What the shape tool draws. The bar and ring come first: they're what the
// page is for.
const SHAPE_KINDS = [
  { id: 'bar', icon: 'battery-medium', label: 'Progress bar' },
  { id: 'ring', icon: 'circle-dot', label: 'Progress ring' },
  { id: 'textbar', icon: 'languages', label: 'Text bar' },
  { id: 'rect', icon: 'square', label: 'Rectangle' },
  { id: 'ellipse', icon: 'circle', label: 'Ellipse' },
  { id: 'triangle', icon: 'triangle', label: 'Triangle' },
  { id: 'diamond', icon: 'diamond', label: 'Diamond' },
];

// A click without a drag gets a shape this big, centred on the click.
const CLICK_SIZES = {
  bar: [800, 100],
  ring: [600, 600],
  textbar: [600, 300],
};

// Designs saved inside the site, in IndexedDB.
const shelf = makeShelf('progress-bar');
const TOOL_KEYS = {
  v: 'move',
  b: 'brush',
  e: 'eraser',
  u: 'shape',
  t: 'text',
};

const STARTS = [
  { id: 'bar', label: 'A bar' },
  { id: 'ring', label: 'A ring' },
  { id: 'empty', label: 'Nothing' },
];

const TYPE_ICONS = {
  bar: 'battery-medium',
  shape: 'shapes',
  text: 'type',
  image: 'image',
  paint: 'brush',
};

const iconOf = (layer) =>
  layer.type !== 'bar'
    ? TYPE_ICONS[layer.type]
    : ({ ring: 'circle-dot', text: 'languages' }[layer.shape] ??
      TYPE_ICONS.bar);

// How long ago, for the saved designs list.
function whenSaved(at) {
  if (!at) return '';
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(at).toLocaleDateString();
}

// The Properties panel's tabs for each kind of layer.
const TABS = {
  bar: [
    ['shape', 'Shape'],
    ['fill', 'Fill'],
    ['track', 'Back'],
    ['stroke', 'Stroke'],
    ['effects', 'Effects'],
    ['layer', 'Layer'],
  ],
  shape: [
    ['shape', 'Shape'],
    ['effects', 'Effects'],
    ['layer', 'Layer'],
  ],
  text: [
    ['text', 'Text'],
    ['effects', 'Effects'],
    ['layer', 'Layer'],
  ],
  image: [
    ['effects', 'Effects'],
    ['layer', 'Layer'],
  ],
  paint: [
    ['effects', 'Effects'],
    ['layer', 'Layer'],
  ],
};

const HINTS = {
  move: 'Click a layer to pick it, drag to move it, drag a corner to resize (Shift keeps its shape). Arrow keys nudge.',
  text: 'Click on the picture to place text. {percent} in it counts up with the steps.',
};

const isTyping = (el) =>
  el?.isContentEditable ||
  ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName);

function save(blob, name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const sizeLabel = (bytes) =>
  bytes > 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const centred = (doc, w, h) => ({
  w: Math.round(w),
  h: Math.round(h),
  x: Math.round((doc.width - w) / 2),
  y: Math.round((doc.height - h) / 2),
});

// A plain bar or ring that fits the picture it's going on.
function barFor(doc) {
  const h = Math.round(doc.height * 0.1);
  return newBar({
    ...centred(doc, doc.width * 0.875, h),
    radius: Math.round(h / 2),
  });
}

function ringFor(doc) {
  const side = Math.min(doc.width, doc.height) * 0.78;
  return newRing({
    ...centred(doc, side, side),
    thickness: Math.max(4, Math.round(side / 9)),
  });
}

// Settings that follow a shape's size while it's being drawn: a bar stays a
// pill, a ring's band stays in proportion.
function shaped(kind, box) {
  if (kind === 'bar')
    return { ...box, radius: Math.round(Math.min(box.w, box.h) / 2) };
  if (kind === 'ring')
    return {
      ...box,
      thickness: Math.max(2, Math.round(Math.min(box.w, box.h) / 9)),
    };
  return box;
}

function makeShape(kind, box) {
  if (kind === 'textbar')
    return newBar({ ...box, name: 'Text', shape: 'text', direction: 'ltr' });
  if (kind === 'bar') return newBar(shaped(kind, box));
  if (kind === 'ring') return newRing(shaped(kind, box));
  return newShape(kind, box);
}

function startingDoc() {
  const doc = newDoc();
  return { ...doc, layers: [barFor(doc)] };
}

export default class JjsProgressBarMakerPage extends Component {
  @tracked doc = startingDoc();
  @tracked selectedId = this.doc.layers[0]?.id ?? null;
  @tracked frame = 13;
  @tracked tool = 'move';
  @tracked brushSize = 24;
  @tracked shapeKind = 'bar';
  @tracked brushColor = '#FFFFFF';
  @tracked brushAlpha = 100;
  @tracked past = [];
  @tracked future = [];
  @tracked playing = false;
  @tracked fps = 12;
  @tracked exportName = 'progress';
  @tracked thumbs = [];
  @tracked busy = false;
  @tracked status = null;
  @tracked error = null;
  @tracked dragging = false;
  @tracked propTab = 'shape';
  // 0 fits the picture to the workspace; anything else is a fixed scale.
  @tracked zoom = 0;
  @tracked viewScale = 1;
  @tracked dialog = null;
  @tracked newSteps = 20;
  @tracked newStart = 'bar';
  // The saved design this is, if it's been saved, and whether it's changed since.
  @tracked designId = null;
  @tracked dirty = false;
  @tracked designs = [];
  // The Export dialog's JJS tab: the Roblox account, the upload in progress,
  // and the skill code made from the image IDs.
  @tracked exportTab = 'pictures';
  @tracked robloxUser = null;
  @tracked robloxBusy = false;
  @tracked uploadRows = [];
  @tracked uploading = false;
  @tracked uploadError = null;
  @tracked skillCode = '';
  @tracked skillNote = null;
  @tracked copied = false;
  robloxReady = Boolean(ROBLOX_CLIENT_ID);
  signInAbort = null;

  examples = TEMPLATES;
  starts = STARTS;
  shapeKinds = SHAPE_KINDS;
  maxFrames = MAX_FRAMES;
  canvas = null;
  overlay = null;
  // Decoded pictures by src (data URL), shared by every render.
  drawables = new Map();
  override = null;
  stroke = null;
  drag = null;
  lastKey = null;
  lastAt = 0;

  constructor(owner, args) {
    super(owner, args);
    keepState(
      this,
      'jjs-progress-bar-maker',
      [
        'doc',
        'frame',
        'exportName',
        'brushSize',
        'brushColor',
        'brushAlpha',
        'fps',
        'propTab',
        'shapeKind',
        'designId',
        'dirty',
      ],
      (restored) => {
        if (!restored) return;
        this.doc = normaliseDoc(this.doc) ?? startingDoc();
        this.frame = clamp(this.frame, 0, this.doc.frames);
        this.selectedId = this.doc.layers.at(-1)?.id ?? null;
        this.fetchStrokes();
        this.draw();
      },
    );
    const onKey = (event) => this.key(event);
    document.addEventListener('keydown', onKey);
    registerDestructor(this, () => {
      document.removeEventListener('keydown', onKey);
      cancelAnimationFrame(this.frameRequest);
      clearTimeout(this.thumbTimer);
      clearInterval(this.player);
    });
  }

  // ─── Derived ─────────────────────────────────────────────────────────

  get selected() {
    return this.doc.layers.find((l) => l.id === this.selectedId) ?? null;
  }

  // Top of the stack first, as layer panels always are.
  get layerRows() {
    return this.doc.layers
      .map((layer) => ({
        layer,
        icon: iconOf(layer),
        active: layer.id === this.selectedId,
      }))
      .reverse();
  }

  get tabs() {
    const list = TABS[this.selected?.type] ?? [];
    return list.map(([id, label]) => ({ id, label }));
  }

  // The tab you last picked, if this kind of layer has it.
  get activeTab() {
    const tabs = this.tabs;
    return (tabs.find((t) => t.id === this.propTab) ?? tabs[0])?.id;
  }

  get panelTitle() {
    return this.selected?.name ?? 'Canvas';
  }

  get panelIcon() {
    return this.selected ? iconOf(this.selected) : 'frame';
  }

  get pictures() {
    return this.doc.frames + 1;
  }

  get percent() {
    return Math.round((this.frame / this.doc.frames) * 100);
  }

  get frameLabel() {
    const pad = String(this.doc.frames).length;
    return `${String(this.frame).padStart(pad, '0')}/${this.doc.frames}`;
  }

  get hasPictures() {
    return this.doc.layers.some((l) => l.src);
  }

  get cannotUndo() {
    return !this.past.length;
  }

  get cannotRedo() {
    return !this.future.length;
  }

  get isBrush() {
    return this.tool === 'brush' || this.tool === 'eraser';
  }

  get showPlacement() {
    return this.tool === 'move' && this.selected && this.selected.type !== 'paint';
  }

  get hint() {
    return HINTS[this.tool] ?? '';
  }

  // The shape tool's button shows what it will draw.
  get tools() {
    const kind = SHAPE_KINDS.find((k) => k.id === this.shapeKind);
    return TOOLS.map((t) =>
      t.id === 'shape' && kind
        ? { ...t, icon: kind.icon, label: `${kind.label} (U)` }
        : t,
    );
  }

  get zoomLabel() {
    return `${Math.round((this.zoom || this.viewScale) * 100)}%`;
  }

  get boxStyle() {
    const { width, height } = this.doc;
    if (this.zoom)
      return htmlSafe(
        `width:${width * this.zoom}px;height:${height * this.zoom}px;`,
      );
    // Fits the workspace either way round, using its container size.
    return htmlSafe(
      `aspect-ratio:${width}/${height};width:min(calc(100cqw - 48px), calc((100cqh - 48px) * ${width / height}));`,
    );
  }

  get firstName() {
    return frameName(this.exportName, 0, this.doc.frames);
  }

  get lastName() {
    return frameName(this.exportName, this.doc.frames, this.doc.frames);
  }

  // ─── Drawing ─────────────────────────────────────────────────────────

  resolve = (src) => this.picture(src)?.image ?? null;

  picture(src) {
    if (!src) return null;
    let entry = this.drawables.get(src);
    if (!entry) {
      const image = new Image();
      entry = { image: null };
      entry.ready = new Promise((resolve) => {
        image.onload = () => {
          entry.image = image;
          this.draw();
          resolve();
        };
        image.onerror = () => resolve();
      });
      image.src = src;
      this.drawables.set(src, entry);
    }
    return entry;
  }

  // Everything a render needs decoded, before an export reads it.
  async loadAll() {
    await Promise.all(
      this.doc.layers.map((l) => l.src && this.picture(l.src)?.ready),
    );
  }

  bindCanvas = modifier((element) => {
    this.canvas = element;
    this.draw();
    return () => (this.canvas = null);
  });

  // The overlay takes the pointer and draws the selection. It is watched for
  // size so the handles stay the same size on screen at any zoom.
  bindOverlay = modifier((element) => {
    this.overlay = element;
    const watcher = new ResizeObserver(() => this.measure());
    watcher.observe(element);
    this.draw();
    return () => {
      watcher.disconnect();
      this.overlay = null;
    };
  });

  measure() {
    const width = this.overlay?.getBoundingClientRect().width;
    if (!width) return;
    const scale = width / this.doc.width;
    if (Math.abs(scale - this.viewScale) > 0.001) this.viewScale = scale;
    this.drawSelection();
  }

  // Redraws on the next frame: a slider sends dozens of changes a second and
  // only the last one needs painting.
  draw() {
    cancelAnimationFrame(this.frameRequest);
    this.frameRequest = requestAnimationFrame(() => {
      const { canvas, doc } = this;
      if (!canvas) return;
      const out = render(doc, this.frame, {
        resolve: this.resolve,
        override: this.override,
      });
      for (const c of [canvas, this.overlay]) {
        if (!c) continue;
        if (c.width !== doc.width) c.width = doc.width;
        if (c.height !== doc.height) c.height = doc.height;
      }
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(out, 0, 0);
      this.measure();
    });
    if (!this.playing) this.queueThumbs();
  }

  // Doc pixels per screen pixel.
  get unit() {
    return 1 / (this.viewScale || 1);
  }

  drawSelection() {
    const c = this.overlay;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    const layer = this.selected;
    if (
      !layer ||
      layer.type === 'paint' ||
      this.playing ||
      this.tool !== 'move'
    )
      return;
    const k = this.unit;
    // eslint-disable-next-line warp-drive/no-legacy-request-patterns -- a canvas state push, not a data request
    ctx.save();
    ctx.translate(layer.x + layer.w / 2, layer.y + layer.h / 2);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    ctx.lineWidth = 3 * k;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeRect(-layer.w / 2, -layer.h / 2, layer.w, layer.h);
    ctx.lineWidth = 1.5 * k;
    ctx.strokeStyle = '#38BDF8';
    ctx.strokeRect(-layer.w / 2, -layer.h / 2, layer.w, layer.h);
    const s = 8 * k;
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect((sx * layer.w) / 2 - s / 2, (sy * layer.h) / 2 - s / 2, s, s);
      ctx.strokeRect((sx * layer.w) / 2 - s / 2, (sy * layer.h) / 2 - s / 2, s, s);
    }
    ctx.restore();
  }

  // The strip of every step, redone a moment after you stop changing things.
  queueThumbs() {
    clearTimeout(this.thumbTimer);
    this.thumbTimer = setTimeout(() => {
      const doc = this.doc;
      const scale = Math.min(1, THUMB_HEIGHT / doc.height, 140 / doc.width);
      const list = [];
      for (let k = 0; k <= doc.frames; k++)
        list.push({
          frame: k,
          url: render(doc, k, { scale, resolve: this.resolve }).toDataURL(),
        });
      this.thumbs = list;
    }, 350);
  }

  // ─── History ─────────────────────────────────────────────────────────
  // Changes to the same thing close together (a slider being dragged, a
  // colour picker being swept) are one undo step, not a hundred.

  remember(key = null) {
    const now = performance.now();
    const same = key && key === this.lastKey && now - this.lastAt < 1000;
    this.lastKey = key;
    this.lastAt = now;
    if (same) return;
    this.past = [...this.past.slice(-79), this.doc];
    this.future = [];
  }

  change(next, key) {
    this.remember(key);
    this.commit(next);
  }

  // Without an undo step: for the middle of a drag, whose step was taken at the start.
  commit(next) {
    this.doc = next;
    this.dirty = true;
    this.status = null;
    if (this.frame > next.frames) this.frame = next.frames;
    this.draw();
  }

  undo = () => {
    if (!this.past.length) return;
    this.future = [this.doc, ...this.future];
    this.doc = this.past.at(-1);
    this.past = this.past.slice(0, -1);
    this.afterHistory();
  };

  redo = () => {
    if (!this.future.length) return;
    this.past = [...this.past, this.doc];
    this.doc = this.future[0];
    this.future = this.future.slice(1);
    this.afterHistory();
  };

  afterHistory() {
    this.lastKey = null;
    if (this.selectedId && !this.selected)
      this.selectedId = this.doc.layers.at(-1)?.id ?? null;
    this.frame = Math.min(this.frame, this.doc.frames);
    this.draw();
  }

  // ─── Editing the design ──────────────────────────────────────────────

  indexOf(id) {
    return this.doc.layers.findIndex((l) => l.id === id);
  }

  patchLayer(id, patch) {
    const i = this.indexOf(id);
    if (i < 0) return this.doc;
    const layers = [...this.doc.layers];
    layers[i] = { ...layers[i], ...patch };
    return { ...this.doc, layers };
  }

  setLayer = (path, value) => {
    const layer = this.selected;
    if (!layer) return;
    const i = this.indexOf(layer.id);
    let next = setIn(this.doc, ['layers', i, ...path.split('.')], value);
    // A ring reads directions differently from a bar.
    if (path === 'shape' && layer.type === 'bar')
      next = setIn(next, ['layers', i, 'direction'], value === 'ring' ? 'cw' : 'ltr');
    if (path === 'textMode' || path === 'text' || path === 'shape')
      queueMicrotask(() => this.fetchStrokes());
    this.change(next, `${layer.id}:${path}`);
  };

  // Reads whatever kind of input sent the event.
  valueOf(event) {
    const el = event.target;
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'range' || el.type === 'number') {
      const n = Number(el.value);
      return Number.isFinite(n) ? n : 0;
    }
    return el.value;
  }

  layerField = (path, event) => {
    let value = this.valueOf(event);
    if ((path === 'w' || path === 'h') && typeof value === 'number')
      value = Math.max(1, value);
    this.setLayer(path, value);
  };

  docField = (path, event) => {
    let value = this.valueOf(event);
    if (path === 'frames') value = clamp(Math.round(value) || 1, 1, MAX_FRAMES);
    this.change(setIn(this.doc, path, value), `doc:${path}`);
  };

  setBackground = (hex) =>
    this.change(setIn(this.doc, 'background.color', hex), 'doc:background');

  matchSteps = () => {
    const n = this.selected?.segments;
    if (n) this.change({ ...this.doc, frames: clamp(n, 1, MAX_FRAMES) });
  };

  pickTab = (id) => (this.propTab = id);

  // New layers go straight above the one picked.
  addLayer(layer) {
    const i = this.indexOf(this.selectedId);
    const layers = [...this.doc.layers];
    layers.splice(i < 0 ? layers.length : i + 1, 0, layer);
    this.change({ ...this.doc, layers });
    this.selectedId = layer.id;
  }

  addDrawing = () => this.addLayer(newPaint());

  pickShapeKind = (id) => {
    this.shapeKind = id;
    this.pickTool('shape');
  };

  async addPictures(files) {
    for (const file of files) {
      if (!file?.type.startsWith('image/')) continue;
      try {
        const src = await readAsDataUrl(file);
        const entry = this.picture(src);
        await entry.ready;
        if (!entry.image) throw new Error();
        const { naturalWidth: w, naturalHeight: h } = entry.image;
        // Fits inside the picture, keeping its shape.
        const k = Math.min(1, this.doc.width / w, this.doc.height / h);
        this.addLayer(
          newImage(src, w * k, h * k, {
            ...centred(this.doc, w * k, h * k),
            name: file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Picture',
          }),
        );
        this.tool = 'move';
      } catch {
        this.error = `${file.name} couldn’t be read as a picture`;
      }
    }
  }

  pickPictures = (event) => {
    this.addPictures([...(event.target.files ?? [])]);
    event.target.value = '';
  };

  pasteFiles = (files) => this.addPictures(files);

  dragOver = (event) => {
    event.preventDefault();
    this.dragging = event.type === 'dragover';
  };

  drop = (event) => {
    event.preventDefault();
    this.dragging = false;
    this.addPictures([...(event.dataTransfer?.files ?? [])]);
  };

  select = (id) => {
    this.selectedId = id;
    this.draw();
  };

  toggleLayer = (id, key) => {
    const layer = this.doc.layers.find((l) => l.id === id);
    if (layer) this.change(this.patchLayer(id, { [key]: !layer[key] }));
  };

  moveLayer = (step) => {
    const i = this.indexOf(this.selectedId);
    const j = i + step;
    if (i < 0 || j < 0 || j >= this.doc.layers.length) return;
    const layers = [...this.doc.layers];
    [layers[i], layers[j]] = [layers[j], layers[i]];
    this.change({ ...this.doc, layers });
  };

  duplicateLayer = () => {
    const layer = this.selected;
    if (!layer) return;
    const copy = structuredClone(layer);
    copy.id = `${layer.id}-${Date.now().toString(36)}`;
    copy.name = `${layer.name} copy`;
    if (copy.type !== 'paint') {
      copy.x += 10;
      copy.y += 10;
    }
    this.addLayer(copy);
  };

  deleteLayer = () => {
    const i = this.indexOf(this.selectedId);
    if (i < 0) return;
    const layers = this.doc.layers.filter((_, j) => j !== i);
    this.change({ ...this.doc, layers });
    this.selectedId = layers[Math.max(0, i - 1)]?.id ?? null;
    this.draw();
  };

  // ─── New, open, save ─────────────────────────────────────────────────

  openDialog = (name) => {
    this.stop();
    if (name === 'new') this.newSteps = this.doc.frames;
    if (name === 'export' && this.exportTab === 'jjs') {
      this.refreshRoblox();
      this.refreshSkill();
    }
    this.dialog = name;
  };

  closeDialog = () => (this.dialog = null);

  // Only a click on the dimmed backdrop itself closes it.
  backdrop = (event) => {
    if (event.target === event.currentTarget) this.closeDialog();
  };

  setNew = (key, event) => {
    const n = Math.round(Number(event.target.value)) || 1;
    this[key] = clamp(n, 1, MAX_FRAMES);
  };

  setNewStart = (id) => (this.newStart = id);

  replaceDoc(doc, frame, designId = null) {
    this.stop();
    this.change(doc);
    this.designId = designId;
    this.dirty = false;
    this.selectedId = doc.layers.at(-1)?.id ?? null;
    this.frame = frame ?? Math.round(doc.frames * 0.65);
    this.zoom = 0;
    this.dialog = null;
    this.error = null;
    this.draw();
  }

  createNew = () => {
    const doc = newDoc({ frames: this.newSteps });
    const first = { bar: barFor, ring: ringFor }[this.newStart];
    this.replaceDoc({ ...doc, layers: first ? [first(doc)] : [] });
  };

  useExample = (example) => this.replaceDoc(example.make());

  // Downloads the design as a file: the copy that survives the browser's
  // site data being cleared.
  downloadDesign = () => {
    const blob = new Blob([JSON.stringify(this.doc)], {
      type: 'application/json',
    });
    save(blob, `${this.doc.name || 'progress'}.progressbar.json`);
    this.status = 'Downloaded the design. Open it here again to carry on.';
  };

  setName = (event) => {
    const name = event.target.value.trim().slice(0, 80) || 'Untitled bar';
    this.change({ ...this.doc, name }, 'doc:name');
  };

  // Saves inside the site. The first save gives the design an id; after
  // that, saving replaces it.
  saveHere = async () => {
    await this.loadAll();
    this.designId ??= `pb-${Date.now().toString(36)}`;
    const thumb = render(this.doc, this.doc.frames, {
      scale: 160 / Math.max(this.doc.width, this.doc.height),
      resolve: this.resolve,
    }).toDataURL();
    const ok = await shelf.store(
      this.designId,
      { name: this.doc.name, frames: this.doc.frames, thumb },
      this.doc,
    );
    if (ok) this.dirty = false;
    this.error = ok ? null : 'This browser wouldn’t keep it: download it as a file instead.';
    this.status = ok ? `Saved “${this.doc.name}” in this browser.` : null;
    if (this.dialog === 'open') this.refreshDesigns();
  };

  refreshDesigns = async () => {
    const designs = await shelf.list();
    this.designs = designs.map((d) => ({
      ...d,
      when: whenSaved(d.savedAt),
      current: d.id === this.designId,
    }));
  };

  openDesigns = () => {
    this.openDialog('open');
    this.refreshDesigns();
  };

  openSaved = async (id) => {
    const doc = normaliseDoc(await shelf.load(id));
    if (!doc) {
      this.error = 'That design is no longer in this browser.';
      return this.refreshDesigns();
    }
    this.replaceDoc(doc, Math.round(doc.frames * 0.65), id);
    this.fetchStrokes();
  };

  deleteSaved = async (id) => {
    await shelf.forget(id);
    if (this.designId === id) {
      this.designId = null;
      this.dirty = true;
    }
    this.refreshDesigns();
  };

  // ─── JJS skill export ────────────────────────────────────────────────
  // Every step uploaded to the person's Roblox account as a decal, the image
  // behind each decal found, and the lot written into a Skill Builder skill
  // that flips between them on a tag.

  get jjs() {
    return { ...newJjs(), ...this.doc.jjs };
  }

  get jjsIds() {
    return parseIds(this.jjs.ids);
  }

  // Whether the uploaded pictures were made from the design as it is now.
  get uploadsStale() {
    const { uploadedFor, uploads } = this.jjs;
    return Boolean(uploads?.length && uploadedFor && uploadedFor !== drawingFingerprint(this.doc));
  }

  get uploadCount() {
    return this.pictures;
  }

  pickExportTab = (tab) => {
    this.exportTab = tab;
    if (tab === 'jjs') {
      this.refreshRoblox();
      this.refreshSkill();
    }
  };

  refreshRoblox = async () => {
    if (!this.robloxReady) return;
    const session = await currentSession();
    if (!isDestroyed(this)) this.robloxUser = session?.user ?? null;
  };

  robloxSignIn = async () => {
    this.robloxBusy = true;
    this.uploadError = null;
    this.signInAbort = new AbortController();
    try {
      const session = await signIn({ signal: this.signInAbort.signal });
      this.robloxUser = session.user;
    } catch (error) {
      this.uploadError = error.message;
    } finally {
      this.robloxBusy = false;
      this.signInAbort = null;
    }
  };

  cancelSignIn = () => this.signInAbort?.abort();

  robloxSignOut = async () => {
    await signOut();
    this.robloxUser = null;
  };

  setJjs = (key, event) => {
    let value =
      event.target.type === 'checkbox'
        ? event.target.checked
        : event.target.type === 'number'
          ? Number(event.target.value) || 0
          : event.target.value;
    if (key === 'size') value = Math.max(0.1, value);
    if (key === 'showFor' || key === 'waitFor') value = Math.max(0, value);
    if (key === 'regenEvery') value = Math.max(0.05, value);
    this.change(setIn(this.doc, ['jjs', key], value), `doc:jjs:${key}`);
    this.refreshSkill();
  };

  setJjsStart = (start) => {
    this.change(setIn(this.doc, ['jjs', 'start'], start));
    this.refreshSkill();
  };

  // The skill code, remade whenever the IDs or settings change.
  refreshSkill = async () => {
    const ids = this.jjsIds;
    const want = this.pictures;
    this.copied = false;
    if (ids.length !== want) {
      this.skillCode = '';
      this.skillNote = ids.length
        ? `The skill needs ${want} image IDs, one for each step from 0 (empty) to ${this.doc.frames} (full); there are ${ids.length}.`
        : null;
      return;
    }
    const { name, tag, start, size, position, showFor, waitFor, rails, regen, regenAmount, regenEvery } = this.jjs;
    const code = await encodeSkill(
      buildSkill({
        textures: ids,
        name: name.trim() || this.doc.name,
        tag: tag.trim() || 'Bar',
        start,
        size,
        position: position.trim() || '0, 0, 0',
        showFor,
        waitFor,
        rails,
        regen: regen ? { amount: regenAmount, every: regenEvery } : null,
      }),
    );
    if (isDestroyed(this)) return;
    this.skillCode = code;
    this.skillNote = null;
  };

  copySkill = async () => {
    try {
      await navigator.clipboard.writeText(this.skillCode);
      this.copied = true;
    } catch {
      this.copied = false;
    }
  };

  // Uploads every step, one after another (Roblox rate-limits uploads), and
  // stops at the first failure so a problem doesn't cost twenty uploads.
  // Steps already uploaded for this same drawing are skipped on a retry.
  uploadToRoblox = async () => {
    if (this.uploading) return;
    this.stop();
    this.uploading = true;
    this.uploadError = null;
    const doc = this.doc;
    const fingerprint = drawingFingerprint(doc);
    const kept = this.jjs.uploadedFor === fingerprint ? [...this.jjs.uploads] : [];
    const rows = Array.from({ length: doc.frames + 1 }, (_, step) => ({
      step,
      state: kept[step]?.imageId ? 'done' : 'waiting',
      ...kept[step],
    }));
    const show = () => (this.uploadRows = rows.map((r) => ({ ...r })));
    show();
    try {
      await this.loadAll();
      const session = await currentSession();
      if (!session) throw new Error('Sign in with Roblox first');
      this.robloxUser = session.user;
      for (const row of rows) {
        if (row.state === 'done') continue;
        row.state = 'uploading';
        show();
        const blob = await canvasBlob(render(doc, row.step, { resolve: this.resolve }));
        const { decalId, moderation } = await uploadDecal(blob, {
          name: `${doc.name} ${row.step}/${doc.frames}`,
          description: `Step ${row.step} of ${doc.frames} of a progress bar, made with Woogi Tools' JJS Progress Bar Maker.`,
          userId: session.user.id,
        });
        row.decalId = decalId;
        row.moderation = moderation;
        row.state = 'finding';
        show();
        row.imageId = await imageIdOf(decalId);
        row.state = 'done';
        show();
        kept[row.step] = { decalId, imageId: row.imageId, moderation };
        // Kept as it goes, so a failure part-way loses nothing.
        this.commit(
          setIn(setIn(this.doc, ['jjs', 'uploads'], [...kept]), ['jjs', 'uploadedFor'], fingerprint),
        );
      }
      const ids = rows.map((r) => r.imageId).join('\n');
      this.commit(setIn(this.doc, ['jjs', 'ids'], ids));
      this.refreshSkill();
    } catch (error) {
      const failed = rows.find((r) => r.state === 'uploading' || r.state === 'finding');
      if (failed) {
        failed.state = 'failed';
        failed.error = error.message;
      }
      show();
      this.uploadError = error.message;
    } finally {
      this.uploading = false;
    }
  };

  // ─── Stroke order ────────────────────────────────────────────────────
  // Text bars drawn in stroke order need each character's strokes. They're
  // fetched once and written into the layer, so the design carries them.

  strokeJobs = new Set();

  fetchStrokes() {
    for (const layer of this.doc.layers) {
      if (layer.shape !== 'text' || layer.textMode !== 'strokes') continue;
      for (const char of new Set([...String(layer.text ?? '')])) {
        if (!char.trim() || char in (layer.strokeData ?? {})) continue;
        const job = `${layer.id}:${char}`;
        if (this.strokeJobs.has(job)) continue;
        this.strokeJobs.add(job);
        this.status = `Getting the stroke order for ${char}…`;
        strokesFor(char).then((strokes) => {
          this.strokeJobs.delete(job);
          if (isDestroyed(this)) return;
          const i = this.indexOf(layer.id);
          if (i < 0) return;
          // Written straight in, not as an undo step: it's data, not an edit.
          this.doc = setIn(this.doc, ['layers', i, 'strokeData', char], strokes);
          if (!this.strokeJobs.size) this.status = null;
          this.draw();
        });
      }
    }
  }

  openProject = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const doc = normaliseDoc(JSON.parse(await file.text()));
      if (!doc) throw new Error();
      this.replaceDoc(doc, Math.min(this.frame, doc.frames));
      this.dirty = true;
    } catch {
      this.error = `${file.name} isn’t a design saved from here`;
    }
  };

  // ─── Pointer on the picture ──────────────────────────────────────────

  pickTool = (id) => {
    this.tool = id;
    this.draw();
  };

  toDoc(event) {
    const r = this.overlay.getBoundingClientRect();
    return {
      x: ((event.clientX - r.left) * this.doc.width) / r.width,
      y: ((event.clientY - r.top) * this.doc.height) / r.height,
    };
  }

  // A point in a layer's own unrotated frame, measured from its middle.
  local(layer, p) {
    const a = (-layer.rotation * Math.PI) / 180;
    const dx = p.x - (layer.x + layer.w / 2);
    const dy = p.y - (layer.y + layer.h / 2);
    return {
      x: dx * Math.cos(a) - dy * Math.sin(a),
      y: dx * Math.sin(a) + dy * Math.cos(a),
    };
  }

  world(layer, q) {
    const a = (layer.rotation * Math.PI) / 180;
    return {
      x: layer.x + layer.w / 2 + q.x * Math.cos(a) - q.y * Math.sin(a),
      y: layer.y + layer.h / 2 + q.x * Math.sin(a) + q.y * Math.cos(a),
    };
  }

  handleAt(p) {
    const layer = this.selected;
    if (!layer || layer.type === 'paint') return null;
    const q = this.local(layer, p);
    const reach = 10 * this.unit;
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ])
      if (
        Math.abs(q.x - (sx * layer.w) / 2) < reach &&
        Math.abs(q.y - (sy * layer.h) / 2) < reach
      )
        return { sx, sy };
    return null;
  }

  // The top visible layer under the point. Drawings cover everything, so
  // they're only picked from the layers panel.
  layerAt(p) {
    for (let i = this.doc.layers.length - 1; i >= 0; i--) {
      const layer = this.doc.layers[i];
      if (!layer.visible || layer.type === 'paint') continue;
      const q = this.local(layer, p);
      if (Math.abs(q.x) <= layer.w / 2 && Math.abs(q.y) <= layer.h / 2)
        return layer;
    }
    return null;
  }

  pointerDown = (event) => {
    if (event.button > 0 || !this.overlay) return;
    this.stop();
    event.preventDefault();
    try {
      this.overlay.setPointerCapture(event.pointerId);
    } catch {
      // a pointer the browser no longer knows about; the drag still works
    }
    const p = this.toDoc(event);
    const tool = this.tool;
    if (tool === 'brush' || tool === 'eraser') return this.startStroke(p);
    if (tool === 'text') {
      const h = Math.round(this.doc.height * 0.14);
      const w = Math.round(this.doc.width * 0.6);
      this.addLayer(
        newText({
          x: Math.round(p.x - w / 2),
          y: Math.round(p.y - h / 2),
          w,
          h,
          size: Math.round(h * 0.75),
        }),
      );
      this.tool = 'move';
      return this.draw();
    }
    if (tool === 'shape') {
      const kind = this.shapeKind;
      const layer = makeShape(kind, { x: p.x, y: p.y, w: 1, h: 1 });
      this.addLayer(layer);
      this.drag = { kind: 'create', shape: kind, id: layer.id, start: p };
      return;
    }
    const handle = this.handleAt(p);
    if (handle) {
      const layer = this.selected;
      this.drag = {
        kind: 'resize',
        id: layer.id,
        ...handle,
        fixed: this.world(layer, {
          x: (-handle.sx * layer.w) / 2,
          y: (-handle.sy * layer.h) / 2,
        }),
        remembered: false,
      };
      return;
    }
    const layer = this.layerAt(p);
    this.selectedId = layer?.id ?? null;
    this.draw();
    if (layer)
      this.drag = {
        kind: 'move',
        id: layer.id,
        start: p,
        from: { x: layer.x, y: layer.y },
        remembered: false,
      };
  };

  pointerMove = (event) => {
    if (!this.overlay) return;
    if (this.stroke) return this.strokeTo(this.toDoc(event));
    const drag = this.drag;
    if (!drag) return;
    const p = this.toDoc(event);
    const layer = this.doc.layers.find((l) => l.id === drag.id);
    if (!layer) return;
    if (drag.remembered === false) {
      this.remember();
      drag.remembered = true;
    }
    if (drag.kind === 'move') {
      const x = Math.round(drag.from.x + p.x - drag.start.x);
      const y = Math.round(drag.from.y + p.y - drag.start.y);
      this.commit(this.patchLayer(drag.id, { x, y }));
    } else if (drag.kind === 'create') {
      let w = Math.abs(p.x - drag.start.x);
      let h = Math.abs(p.y - drag.start.y);
      // Rings are round; Shift makes anything square.
      if (drag.shape === 'ring' || event.shiftKey) w = h = Math.max(w, h);
      const box = {
        x: Math.round(p.x < drag.start.x ? drag.start.x - w : drag.start.x),
        y: Math.round(p.y < drag.start.y ? drag.start.y - h : drag.start.y),
        w: Math.max(1, Math.round(w)),
        h: Math.max(1, Math.round(h)),
      };
      this.commit(this.patchLayer(drag.id, shaped(drag.shape, box)));
    } else {
      // The opposite corner stays put, whatever the rotation.
      const a = (-layer.rotation * Math.PI) / 180;
      const dx = p.x - drag.fixed.x;
      const dy = p.y - drag.fixed.y;
      const vx = dx * Math.cos(a) - dy * Math.sin(a);
      const vy = dx * Math.sin(a) + dy * Math.cos(a);
      let w = Math.max(1, drag.sx * vx);
      let h = Math.max(1, drag.sy * vy);
      if (event.shiftKey && layer.w && layer.h) {
        const k = Math.max(w / layer.w, h / layer.h);
        w = layer.w * k;
        h = layer.h * k;
      }
      const b = (layer.rotation * Math.PI) / 180;
      const hx = (drag.sx * w) / 2;
      const hy = (drag.sy * h) / 2;
      const cx = drag.fixed.x + hx * Math.cos(b) - hy * Math.sin(b);
      const cy = drag.fixed.y + hx * Math.sin(b) + hy * Math.cos(b);
      this.commit(
        this.patchLayer(drag.id, {
          w: Math.round(w),
          h: Math.round(h),
          x: Math.round(cx - w / 2),
          y: Math.round(cy - h / 2),
        }),
      );
    }
  };

  pointerUp = () => {
    if (this.stroke) return this.endStroke();
    const drag = this.drag;
    this.drag = null;
    // A click with the shape tool, not a drag: a shape you can see.
    if (drag?.kind === 'create') {
      const layer = this.doc.layers.find((l) => l.id === drag.id);
      if (layer && layer.w < 4 && layer.h < 4) {
        const [w, h] = CLICK_SIZES[drag.shape] ?? [300, 200];
        this.commit(
          this.patchLayer(
            drag.id,
            shaped(drag.shape, {
              x: Math.round(drag.start.x - w / 2),
              y: Math.round(drag.start.y - h / 2),
              w,
              h,
            }),
          ),
        );
      }
      this.tool = 'move';
      this.draw();
    }
  };

  // Ctrl + wheel zooms, as in every image editor.
  wheel = (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    this.zoomBy(event.deltaY < 0 ? 1.25 : 0.8);
  };

  zoomBy = (k) => {
    this.zoom = clamp((this.zoom || this.viewScale || 1) * k, 0.1, 16);
    this.draw();
  };

  zoomFit = () => {
    this.zoom = 0;
    this.draw();
  };

  zoomActual = () => {
    this.zoom = 1;
    this.draw();
  };

  // ─── Brush ───────────────────────────────────────────────────────────
  // The stroke is drawn opaque on its own canvas and laid over the layer at
  // the brush's opacity, so a see-through brush doesn't darken where the
  // stroke crosses itself.

  startStroke(p) {
    let layer = this.selected;
    if (layer?.type !== 'paint') {
      if (this.tool === 'eraser') return;
      layer = newPaint();
      this.addLayer(layer);
    } else this.remember();
    const make = () => {
      const c = document.createElement('canvas');
      c.width = this.doc.width;
      c.height = this.doc.height;
      return c;
    };
    const base = make();
    const existing = this.resolve(layer.src);
    if (existing)
      base.getContext('2d').drawImage(existing, 0, 0, base.width, base.height);
    const lines = make().getContext('2d');
    lines.strokeStyle = lines.fillStyle = this.brushColor;
    lines.lineWidth = this.brushSize;
    lines.lineCap = lines.lineJoin = 'round';
    this.stroke = { base, lines, last: p, erase: this.tool === 'eraser' };
    this.override = { id: layer.id, canvas: make() };
    lines.beginPath();
    lines.arc(p.x, p.y, this.brushSize / 2, 0, Math.PI * 2);
    lines.fill();
    this.composeStroke();
  }

  strokeTo(p) {
    const { lines, last } = this.stroke;
    lines.beginPath();
    lines.moveTo(last.x, last.y);
    lines.lineTo(p.x, p.y);
    lines.stroke();
    this.stroke.last = p;
    this.composeStroke();
  }

  composeStroke() {
    const { base, lines, erase } = this.stroke;
    const ctx = this.override.canvas.getContext('2d');
    ctx.clearRect(0, 0, base.width, base.height);
    ctx.drawImage(base, 0, 0);
    ctx.globalAlpha = this.brushAlpha / 100;
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    ctx.drawImage(lines.canvas, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.draw();
  }

  endStroke() {
    const { id, canvas } = this.override;
    const src = canvas.toDataURL('image/png');
    this.drawables.set(src, { image: canvas, ready: Promise.resolve() });
    this.stroke = null;
    this.override = null;
    this.commit(this.patchLayer(id, { src }));
  }

  setBrushSize = (event) => (this.brushSize = Number(event.target.value) || 1);
  setBrushAlpha = (event) =>
    (this.brushAlpha = Number(event.target.value) || 0);
  setBrushColor = (hex) => (this.brushColor = hex);

  // ─── Keys ────────────────────────────────────────────────────────────

  key(event) {
    if (this.dialog) {
      if (event.key === 'Escape') this.closeDialog();
      return;
    }
    if (isTyping(event.target) || event.altKey) return;
    const mod = event.ctrlKey || event.metaKey;
    const k = event.key.toLowerCase();
    if (mod && k === 'z') {
      event.preventDefault();
      return event.shiftKey ? this.redo() : this.undo();
    }
    if (mod && k === 'y') {
      event.preventDefault();
      return this.redo();
    }
    if (mod && k === 's') {
      event.preventDefault();
      return this.saveHere();
    }
    if (mod && k === '0') {
      event.preventDefault();
      return this.zoomFit();
    }
    if (mod) return;
    if ((k === 'delete' || k === 'backspace') && this.selected) {
      event.preventDefault();
      return this.deleteLayer();
    }
    const nudge = {
      arrowleft: [-1, 0],
      arrowright: [1, 0],
      arrowup: [0, -1],
      arrowdown: [0, 1],
    }[k];
    if (nudge && this.selected && this.selected.type !== 'paint') {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const layer = this.selected;
      return this.change(
        this.patchLayer(layer.id, {
          x: layer.x + nudge[0] * step,
          y: layer.y + nudge[1] * step,
        }),
        `${layer.id}:nudge`,
      );
    }
    if (TOOL_KEYS[k]) this.pickTool(TOOL_KEYS[k]);
  }

  // ─── Preview ─────────────────────────────────────────────────────────

  setFrame = (event) => {
    this.stop();
    this.frame = clamp(Number(event.target.value) || 0, 0, this.doc.frames);
    this.draw();
  };

  showFrame = (frame) => {
    this.stop();
    this.frame = frame;
    this.draw();
  };

  setFps = (event) => {
    this.fps = clamp(Number(event.target.value) || 12, 1, 60);
    if (this.playing) {
      this.stop();
      this.play();
    }
  };

  play = () => {
    if (this.playing) return this.stop();
    this.playing = true;
    if (this.frame >= this.doc.frames) this.frame = 0;
    this.player = setInterval(() => {
      this.frame = this.frame >= this.doc.frames ? 0 : this.frame + 1;
      this.draw();
    }, 1000 / this.fps);
    this.draw();
  };

  stop() {
    if (!this.playing) return;
    clearInterval(this.player);
    this.playing = false;
    this.draw();
  }

  // ─── Export ──────────────────────────────────────────────────────────

  setExportName = (event) => (this.exportName = event.target.value);

  async withBusy(job) {
    if (this.busy) return;
    this.stop();
    this.busy = true;
    this.error = null;
    this.status = null;
    try {
      await this.loadAll();
      await job();
    } catch (error) {
      this.error = error?.message ?? 'Couldn’t write the pictures out';
    } finally {
      this.busy = false;
    }
  }

  saveZip = () =>
    this.withBusy(async () => {
      const doc = this.doc;
      const entries = {};
      for (let k = 0; k <= doc.frames; k++) {
        const blob = await canvasBlob(render(doc, k, { resolve: this.resolve }));
        entries[frameName(this.exportName, k, doc.frames)] = new Uint8Array(
          await blob.arrayBuffer(),
        );
      }
      const { zipSync } = await import('fflate');
      // PNGs are compressed already; zipping them again only costs time.
      const zip = new Blob([zipSync(entries, { level: 0 })], {
        type: 'application/zip',
      });
      save(zip, `${this.exportName || 'progress'}.zip`);
      this.status = `Saved ${doc.frames + 1} pictures, ${this.firstName} (empty) to ${this.lastName} (full): ${sizeLabel(zip.size)}`;
    });

  saveFrame = () =>
    this.withBusy(async () => {
      const blob = await canvasBlob(
        render(this.doc, this.frame, { resolve: this.resolve }),
      );
      const name = frameName(this.exportName, this.frame, this.doc.frames);
      save(blob, name);
      this.status = `Saved ${name}: ${sizeLabel(blob.size)}`;
    });

  // Every step on one picture, left to right then down.
  saveSheet = () =>
    this.withBusy(async () => {
      const doc = this.doc;
      const count = doc.frames + 1;
      const columns = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / columns);
      const sheet = document.createElement('canvas');
      sheet.width = columns * doc.width;
      sheet.height = rows * doc.height;
      const ctx = sheet.getContext('2d');
      for (let k = 0; k < count; k++)
        ctx.drawImage(
          render(doc, k, { resolve: this.resolve }),
          (k % columns) * doc.width,
          Math.floor(k / columns) * doc.height,
        );
      const blob = await canvasBlob(sheet);
      if (!blob)
        throw new Error(
          'That sheet is too big for the browser to save; try fewer steps or a smaller size',
        );
      save(blob, `${this.exportName || 'progress'}-sheet.png`);
      this.status = `Saved a ${columns}×${rows} sheet, ${sheet.width}×${sheet.height}: ${sizeLabel(blob.size)}`;
    });

  <template>
    {{! template-lint-disable no-pointer-down-event-binding }}
    <ToolPage
      @route="jjs-progress-bar-maker"
      @game={{true}}
      @busy={{this.busy}}
      @subtitle="Design a progress bar and save one picture per step, from empty to full, ready to upload to JJS."
    >
      <div class="pb-app" {{acceptPastedFiles this.pasteFiles}}>

        {{! ── Top bar: the file, history, export ── }}
        <header class="pb-menubar">
          <div class="pb-cluster">
            <button
              type="button"
              class="pb-menu-btn pb-new"
              {{on "click" (fn this.openDialog "new")}}
            ><Icon @name="file-plus" @size={{14}} /><span>New</span></button>
            <button
              type="button"
              class="pb-menu-btn pb-open"
              {{on "click" this.openDesigns}}
            ><Icon @name="folder" @size={{14}} /><span>Open</span></button>
            <button
              type="button"
              class="pb-menu-btn pb-save"
              title="Save in this browser (Ctrl+S)"
              {{on "click" this.saveHere}}
            ><Icon @name="save" @size={{14}} /><span>Save</span></button>
          </div>
          <span class="pb-sep"></span>
          <div class="pb-name">
            <input
              type="text"
              class="pb-name-input"
              aria-label="Design name"
              maxlength="80"
              spellcheck="false"
              value={{this.doc.name}}
              {{on "change" this.setName}}
            />
            <span
              class="pb-dirty {{if this.dirty 'is-dirty'}}"
              title={{if
                this.dirty
                "Changed since it was last saved"
                "Saved in this browser"
              }}
            ></span>
          </div>
          <span class="pb-sep"></span>
          <div class="pb-cluster">
            <button
              type="button"
              class="pb-menu-btn"
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
              disabled={{this.cannotUndo}}
              {{on "click" this.undo}}
            ><Icon @name="undo-2" @size={{14}} /></button>
            <button
              type="button"
              class="pb-menu-btn"
              title="Redo (Ctrl+Y)"
              aria-label="Redo"
              disabled={{this.cannotRedo}}
              {{on "click" this.redo}}
            ><Icon @name="rotate-cw" @size={{14}} /></button>
          </div>
          <span class="pb-spacer"></span>
          <button
            type="button"
            class="pb-export-btn"
            {{on "click" (fn this.openDialog "export")}}
          ><Icon @name="download" @size={{14}} /><span>Export</span></button>
        </header>

        {{! ── Options for the tool in hand. Always one line high. ── }}
        <div class="pb-options">
          {{#if (eq this.tool "shape")}}
            <div class="pb-kinds" role="group" aria-label="Shape to draw">
              {{#each this.shapeKinds as |k|}}
                <button
                  type="button"
                  class={{if (eq this.shapeKind k.id) "active"}}
                  aria-pressed={{if (eq this.shapeKind k.id) "true" "false"}}
                  {{on "click" (fn this.pickShapeKind k.id)}}
                ><Icon @name={{k.icon}} @size={{14}} /><span
                  >{{k.label}}</span></button>
              {{/each}}
            </div>
            <span class="pb-opt-hint">Drag on the picture to draw it. Shift
              keeps it square.</span>
          {{else if this.isBrush}}
            {{#unless (eq this.tool "eraser")}}
              <ColourField
                @label="Brush"
                @value={{this.brushColor}}
                @onChange={{this.setBrushColor}}
              />
            {{/unless}}
            <label class="pb-opt">
              <span>Size</span>
              <input
                type="range"
                min="1"
                max="120"
                value={{this.brushSize}}
                {{on "input" this.setBrushSize}}
              />
              <output>{{this.brushSize}}</output>
            </label>
            <label class="pb-opt">
              <span>Opacity</span>
              <input
                type="range"
                min="1"
                max="100"
                value={{this.brushAlpha}}
                {{on "input" this.setBrushAlpha}}
              />
              <output>{{this.brushAlpha}}%</output>
            </label>
            <span class="pb-opt-hint">{{if
                (eq this.tool "eraser")
                "Erases from the picked drawing layer."
                "Draws on the picked drawing layer, or starts a new one."
              }}</span>
          {{else if this.showPlacement}}
            <span class="pb-opt-title">
              <Icon @name={{this.panelIcon}} @size={{13}} />
              {{this.selected.name}}
            </span>
            {{#each (array "x" "y" "w" "h") as |key|}}
              <label class="pb-opt pb-opt-num">
                <span>{{key}}</span>
                <input
                  type="number"
                  class="math-input"
                  value={{get this.selected key}}
                  {{on "change" (fn this.layerField key)}}
                />
              </label>
            {{/each}}
            <label class="pb-opt pb-opt-num">
              <span>°</span>
              <input
                type="number"
                class="math-input"
                value={{this.selected.rotation}}
                {{on "change" (fn this.layerField "rotation")}}
              />
            </label>
          {{else}}
            <span class="pb-opt-hint">{{this.hint}}</span>
          {{/if}}
        </div>

        {{! ── Tools ── }}
        <nav class="pb-rail" aria-label="Tools">
          {{#each this.tools as |t|}}
            <button
              type="button"
              class="pb-rail-btn {{if (eq this.tool t.id) 'active'}}"
              title={{t.label}}
              aria-label={{t.label}}
              aria-pressed={{if (eq this.tool t.id) "true" "false"}}
              {{on "click" (fn this.pickTool t.id)}}
            ><Icon @name={{t.icon}} @size={{16}} /></button>
          {{/each}}
          <span class="pb-rail-sep"></span>
          <label
            class="pb-rail-btn"
            title="Add a picture (or drop / paste one)"
            aria-label="Add a picture"
          >
            <Icon @name="image-plus" @size={{16}} />
            <input
              type="file"
              accept="image/*"
              multiple
              class="sr-only"
              {{on "change" this.pickPictures}}
            />
          </label>
        </nav>

        {{! ── The picture ── }}
        <div
          class="pb-workspace {{if this.dragging 'is-dragging'}}"
          {{on "dragover" this.dragOver}}
          {{on "dragleave" this.dragOver}}
          {{on "drop" this.drop}}
          {{on "wheel" this.wheel}}
        >
          <div class="pb-canvas-box checkerboard" style={{this.boxStyle}}>
            <canvas class="pb-canvas" {{this.bindCanvas}}></canvas>
            <canvas
              class="pb-overlay"
              data-tool={{this.tool}}
              {{this.bindOverlay}}
              {{on "pointerdown" this.pointerDown}}
              {{on "pointermove" this.pointerMove}}
              {{on "pointerup" this.pointerUp}}
              {{on "pointercancel" this.pointerUp}}
            ></canvas>
          </div>
        </div>

        {{! ── Steps ── }}
        <section class="pb-timeline" aria-label="Steps">
          <div class="pb-timeline-bar">
            <button
              type="button"
              class="pb-menu-btn"
              title={{if this.playing "Pause" "Play every step"}}
              aria-label={{if this.playing "Pause" "Play"}}
              {{on "click" this.play}}
            ><Icon
                @name={{if this.playing "pause" "play"}}
                @size={{14}}
              /></button>
            <input
              type="range"
              min="0"
              max={{this.doc.frames}}
              value={{this.frame}}
              aria-label="Step"
              class="pb-frame-range"
              {{on "input" this.setFrame}}
            />
            <span class="pb-frame-label">
              <span>{{this.frameLabel}}</span>
              <span class="pb-frame-pct">{{this.percent}}%</span>
            </span>
            <span class="pb-sep"></span>
            <label class="pb-opt pb-opt-num">
              <span>Steps</span>
              <input
                type="number"
                min="1"
                max={{this.maxFrames}}
                class="math-input pb-steps"
                value={{this.doc.frames}}
                {{on "change" (fn this.docField "frames")}}
              />
            </label>
            <label class="pb-opt pb-opt-num">
              <span>fps</span>
              <input
                type="number"
                min="1"
                max="60"
                class="math-input"
                value={{this.fps}}
                {{on "change" this.setFps}}
              />
            </label>
          </div>
          <div class="pb-strip">
            {{#each this.thumbs key="frame" as |t|}}
              <button
                type="button"
                class="pb-thumb checkerboard
                  {{if (eq t.frame this.frame) 'active'}}"
                title="Step {{t.frame}}"
                {{on "click" (fn this.showFrame t.frame)}}
              ><img src={{t.url}} alt="Step {{t.frame}}" /><span
                >{{t.frame}}</span></button>
            {{/each}}
          </div>
        </section>

        {{! ── Panels ── }}
        <aside class="pb-dock">
          <section class="pb-panel pb-panel-props">
            <div class="pb-panel-head">
              <Icon @name={{this.panelIcon}} @size={{13}} />
              <h3>{{this.panelTitle}}</h3>
            </div>
            {{#if this.selected}}
              <div class="pb-tabs" role="tablist" aria-label="Properties">
                {{#each this.tabs as |t|}}
                  <button
                    type="button"
                    role="tab"
                    class={{if (eq this.activeTab t.id) "active"}}
                    aria-selected={{if (eq this.activeTab t.id) "true" "false"}}
                    {{on "click" (fn this.pickTab t.id)}}
                  >{{t.label}}</button>
                {{/each}}
              </div>
            {{/if}}
            <div class="pb-panel-body">
              {{#if this.selected}}
                <PbLayerProps
                  @layer={{this.selected}}
                  @tab={{this.activeTab}}
                  @onSet={{this.setLayer}}
                  @onField={{this.layerField}}
                  @onMatchSteps={{this.matchSteps}}
                />
              {{else}}
                <div class="pb-props">
                  <section class="pb-group">
                    <h4 class="pb-group-title">Size</h4>
                    <p class="pb-hint">Always 1024 × 1024: the biggest a
                      Roblox decal keeps as it is, and square, so nothing is
                      shrunk or squashed when you upload it.</p>
                  </section>
                  <section class="pb-group">
                    <h4 class="pb-group-title">Steps</h4>
                    <label class="pb-row">
                      <span class="pb-row-label">Full at step</span>
                      <input
                        type="number"
                        min="1"
                        max={{this.maxFrames}}
                        class="math-input"
                        value={{this.doc.frames}}
                        {{on "change" (fn this.docField "frames")}}
                      />
                    </label>
                    <p class="pb-hint pb-count">{{this.pictures}}
                      pictures: 0 is empty,
                      {{this.doc.frames}}
                      is full.</p>
                  </section>
                  <section class="pb-group">
                    <h4 class="pb-group-title">Background</h4>
                    <label class="math-check"><input
                        type="checkbox"
                        checked={{this.doc.background.on}}
                        {{on "change" (fn this.docField "background.on")}}
                      />
                      Fill behind everything</label>
                    <div class="pb-stop">
                      <ColourField
                        @label="Background"
                        @value={{this.doc.background.color}}
                        @onChange={{this.setBackground}}
                      />
                    </div>
                    <p class="pb-hint">Leave it off to keep the picture
                      see-through around the bar.</p>
                  </section>
                </div>
              {{/if}}
            </div>
          </section>

          <section class="pb-panel pb-panel-layers">
            <div class="pb-panel-head">
              <Icon @name="layers" @size={{13}} />
              <h3>Layers</h3>
            </div>
            <ul class="pb-panel-body pb-layers">
              {{#each this.layerRows key="layer.id" as |row|}}
                <li
                  class="pb-layer
                    {{if row.active 'is-active'}}
                    {{if row.layer.clip 'is-clipped'}}
                    {{unless row.layer.visible 'is-hidden'}}"
                >
                  <button
                    type="button"
                    class="pb-layer-eye"
                    title={{if row.layer.visible "Hide" "Show"}}
                    aria-label={{if
                      row.layer.visible
                      "Hide layer"
                      "Show layer"
                    }}
                    {{on "click" (fn this.toggleLayer row.layer.id "visible")}}
                  ><Icon
                      @name={{if row.layer.visible "eye" "eye-off"}}
                      @size={{13}}
                    /></button>
                  <button
                    type="button"
                    class="pb-layer-name"
                    {{on "click" (fn this.select row.layer.id)}}
                  >
                    {{#if row.layer.clip}}<span
                        class="pb-clip-mark"
                        aria-hidden="true"
                      >↳</span>{{/if}}
                    <Icon @name={{row.icon}} @size={{13}} />
                    <span>{{row.layer.name}}</span>
                  </button>
                  <button
                    type="button"
                    class="pb-layer-clip {{if row.layer.clip 'active'}}"
                    title="Clip to the layer below"
                    aria-label="Clip to the layer below"
                    aria-pressed={{if row.layer.clip "true" "false"}}
                    {{on "click" (fn this.toggleLayer row.layer.id "clip")}}
                  ><Icon @name="link" @size={{12}} /></button>
                </li>
              {{/each}}
              <li class="pb-layer pb-layer-canvas {{unless this.selected 'is-active'}}">
                <span class="pb-layer-eye"></span>
                <button
                  type="button"
                  class="pb-layer-name"
                  {{on "click" (fn this.select null)}}
                >
                  <Icon @name="frame" @size={{13}} />
                  <span>Canvas · {{this.doc.width}}×{{this.doc.height}}</span>
                </button>
              </li>
            </ul>
            <div class="pb-panel-foot">
              <button
                type="button"
                title="New drawing layer"
                aria-label="New drawing layer"
                {{on "click" this.addDrawing}}
              ><Icon @name="brush" @size={{13}} /></button>
              <button
                type="button"
                title="Move up"
                aria-label="Move layer up"
                disabled={{not this.selected}}
                {{on "click" (fn this.moveLayer 1)}}
              ><Icon @name="arrow-up" @size={{13}} /></button>
              <button
                type="button"
                title="Move down"
                aria-label="Move layer down"
                disabled={{not this.selected}}
                {{on "click" (fn this.moveLayer -1)}}
              ><Icon @name="arrow-down" @size={{13}} /></button>
              <button
                type="button"
                title="Duplicate"
                aria-label="Duplicate layer"
                disabled={{not this.selected}}
                {{on "click" this.duplicateLayer}}
              ><Icon @name="copy" @size={{13}} /></button>
              <span class="pb-spacer"></span>
              <button
                type="button"
                title="Delete"
                aria-label="Delete layer"
                disabled={{not this.selected}}
                {{on "click" this.deleteLayer}}
              ><Icon @name="trash-2" @size={{13}} /></button>
            </div>
          </section>
        </aside>

        {{! ── Status ── }}
        <footer class="pb-status">
          <span class="pb-status-msg {{if this.error 'is-error'}}" role="status">
            {{#if this.error}}
              {{this.error}}
            {{else if this.status}}
              {{this.status}}
            {{else if this.hasPictures}}
              Designs with pictures may be too big to keep after a refresh:
              Save to be sure.
            {{else}}
              {{this.pictures}}
              pictures, 0 (empty) to
              {{this.doc.frames}}
              (full)
            {{/if}}
          </span>
          <span class="pb-zoom">
            <button
              type="button"
              title="Zoom out"
              aria-label="Zoom out"
              {{on "click" (fn this.zoomBy 0.8)}}
            ><Icon @name="zoom-out" @size={{12}} /></button>
            <button
              type="button"
              class="pb-zoom-label"
              title="Fit to the window (Ctrl+0)"
              {{on "click" this.zoomFit}}
            >{{this.zoomLabel}}</button>
            <button
              type="button"
              title="Zoom in"
              aria-label="Zoom in"
              {{on "click" (fn this.zoomBy 1.25)}}
            ><Icon @name="zoom-in" @size={{12}} /></button>
            <button
              type="button"
              title="Actual size"
              {{on "click" this.zoomActual}}
            >1:1</button>
          </span>
        </footer>

        {{! ── Dialogs ── }}
        {{#if (eq this.dialog "new")}}
          {{! a click on the dim backdrop closes it; Esc and the close
          button are the keyboard ways out }}
          {{! template-lint-disable no-invalid-interactive }}
          <div class="pb-dialog-backdrop" {{on "click" this.backdrop}}>
            {{! template-lint-enable no-invalid-interactive }}
            <div
              class="pb-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="New design"
            >
              <div class="pb-dialog-head">
                <h3>New design</h3>
                <button
                  type="button"
                  class="pb-menu-btn"
                  aria-label="Close"
                  {{on "click" this.closeDialog}}
                ><Icon @name="x" @size={{14}} /></button>
              </div>
              <div class="pb-dialog-body">
                <section class="pb-group">
                  <h4 class="pb-group-title">Steps</h4>
                  <label class="pb-row">
                    <span class="pb-row-label">Full at step</span>
                    <input
                      type="number"
                      min="1"
                      max={{this.maxFrames}}
                      class="math-input pb-new-steps"
                      value={{this.newSteps}}
                      {{on "change" (fn this.setNew "newSteps")}}
                    />
                  </label>
                  <p class="pb-hint">1024 × 1024, like every design here.</p>
                </section>
                <section class="pb-group">
                  <h4 class="pb-group-title">Start with</h4>
                  <div class="pb-seg" role="group" aria-label="Start with">
                    {{#each this.starts as |s|}}
                      <button
                        type="button"
                        class={{if (eq this.newStart s.id) "active"}}
                        {{on "click" (fn this.setNewStart s.id)}}
                      >{{s.label}}</button>
                    {{/each}}
                  </div>
                </section>
                <button
                  type="button"
                  class="pb-export-btn pb-create"
                  {{on "click" this.createNew}}
                >Create</button>

                <section class="pb-group pb-examples">
                  <h4 class="pb-group-title">Or pull apart an example</h4>
                  <div class="pb-chips" role="group" aria-label="Examples">
                    {{#each this.examples as |t|}}
                      <button
                        type="button"
                        {{on "click" (fn this.useExample t)}}
                      >{{t.label}}</button>
                    {{/each}}
                  </div>
                </section>
              </div>
            </div>
          </div>
        {{/if}}

        {{#if (eq this.dialog "open")}}
          {{! a click on the dim backdrop closes it; Esc and the close
          button are the keyboard ways out }}
          {{! template-lint-disable no-invalid-interactive }}
          <div class="pb-dialog-backdrop" {{on "click" this.backdrop}}>
            {{! template-lint-enable no-invalid-interactive }}
            <div
              class="pb-dialog pb-dialog-wide"
              role="dialog"
              aria-modal="true"
              aria-label="Open a design"
            >
              <div class="pb-dialog-head">
                <h3>Your designs</h3>
                <button
                  type="button"
                  class="pb-menu-btn"
                  aria-label="Close"
                  {{on "click" this.closeDialog}}
                ><Icon @name="x" @size={{14}} /></button>
              </div>
              <div class="pb-dialog-body">
                {{#if this.designs.length}}
                  <ul class="pb-designs">
                    {{#each this.designs key="id" as |d|}}
                      <li class="pb-design {{if d.current 'is-current'}}">
                        <button
                          type="button"
                          class="pb-design-open"
                          {{on "click" (fn this.openSaved d.id)}}
                        >
                          <span class="pb-design-thumb checkerboard">
                            {{#if d.thumb}}<img src={{d.thumb}} alt="" />{{/if}}
                          </span>
                          <span class="pb-design-text">
                            <strong>{{d.name}}</strong>
                            <span>{{d.frames}} steps · {{d.when}}</span>
                          </span>
                        </button>
                        <button
                          type="button"
                          class="pb-menu-btn"
                          title="Delete from this browser"
                          aria-label="Delete {{d.name}}"
                          {{on "click" (fn this.deleteSaved d.id)}}
                        ><Icon @name="trash-2" @size={{13}} /></button>
                      </li>
                    {{/each}}
                  </ul>
                {{else}}
                  <p class="pb-hint pb-empty">Nothing saved in this browser yet.
                    Press Save (or Ctrl+S) and your design will be here.</p>
                {{/if}}
                <section class="pb-group pb-files">
                  <h4 class="pb-group-title">Files</h4>
                  <p class="pb-hint">Designs saved here live in this browser
                    only; clearing its site data deletes them. A file keeps one
                    anywhere.</p>
                  <div class="pb-actions">
                    <label class="btn">
                      <Icon @name="upload" @size={{13}} />
                      Open a design file
                      <input
                        type="file"
                        accept=".json,application/json"
                        class="sr-only"
                        {{on "change" this.openProject}}
                      />
                    </label>
                    <button
                      type="button"
                      class="btn"
                      {{on "click" this.downloadDesign}}
                    ><Icon @name="download" @size={{13}} />
                      Download this design</button>
                  </div>
                </section>
              </div>
            </div>
          </div>
        {{/if}}

        {{#if (eq this.dialog "export")}}
          {{! a click on the dim backdrop closes it; Esc and the close
          button are the keyboard ways out }}
          {{! template-lint-disable no-invalid-interactive }}
          <div class="pb-dialog-backdrop" {{on "click" this.backdrop}}>
            {{! template-lint-enable no-invalid-interactive }}
            <div
              class="pb-dialog pb-dialog-wide"
              role="dialog"
              aria-modal="true"
              aria-label="Export"
            >
              <div class="pb-dialog-head">
                <h3>Export</h3>
                <button
                  type="button"
                  class="pb-menu-btn"
                  aria-label="Close"
                  {{on "click" this.closeDialog}}
                ><Icon @name="x" @size={{14}} /></button>
              </div>
              <div class="pb-dialog-body">
                <div class="pb-tabs pb-export-tabs" role="tablist" aria-label="Export as">
                  <button
                    type="button"
                    role="tab"
                    class={{if (eq this.exportTab "pictures") "active"}}
                    aria-selected={{if (eq this.exportTab "pictures") "true" "false"}}
                    {{on "click" (fn this.pickExportTab "pictures")}}
                  >Pictures</button>
                  <button
                    type="button"
                    role="tab"
                    class="pb-jjs-tab {{if (eq this.exportTab 'jjs') 'active'}}"
                    aria-selected={{if (eq this.exportTab "jjs") "true" "false"}}
                    {{on "click" (fn this.pickExportTab "jjs")}}
                  >JJS skill</button>
                </div>
                {{#if (eq this.exportTab "pictures")}}
                <label class="pb-row">
                  <span class="pb-row-label">File names</span>
                  <input
                    type="text"
                    class="math-input"
                    value={{this.exportName}}
                    spellcheck="false"
                    {{on "input" this.setExportName}}
                  />
                </label>
                <p class="pb-hint">{{this.pictures}}
                  pictures, from
                  <code>{{this.firstName}}</code>
                  (empty) to
                  <code>{{this.lastName}}</code>
                  (full),
                  {{this.doc.width}}×{{this.doc.height}}
                  each.</p>
                <div class="pb-export-list">
                  <button
                    type="button"
                    class="pb-export-btn pb-save-zip"
                    disabled={{this.busy}}
                    {{on "click" this.saveZip}}
                  ><Icon @name="file-archive" @size={{14}} /><span>Every step
                      (.zip)</span></button>
                  <button
                    type="button"
                    class="btn"
                    disabled={{this.busy}}
                    {{on "click" this.saveFrame}}
                  >Step {{this.frame}} only (.png)</button>
                  <button
                    type="button"
                    class="btn"
                    disabled={{this.busy}}
                    {{on "click" this.saveSheet}}
                  >Sprite sheet (.png)</button>
                </div>
                <p
                  class="pb-status-line {{if this.error 'is-error'}}"
                  role="status"
                >{{#if this.busy}}Drawing every step…{{else if
                    this.error
                  }}{{this.error}}{{else}}{{this.status}}{{/if}}</p>
                {{else}}
                  <section class="pb-group">
                    <h4 class="pb-group-title">1 · Upload to Roblox</h4>
                    {{#if this.robloxReady}}
                      {{#if this.robloxUser}}
                        <div class="pb-roblox-account">
                          <Icon @name="user-round" @size={{14}} />
                          <span>Signed in as
                            <strong>{{this.robloxUser.name}}</strong></span>
                          <button
                            type="button"
                            class="btn"
                            disabled={{this.uploading}}
                            {{on "click" this.robloxSignOut}}
                          >Sign out</button>
                        </div>
                      {{else if this.robloxBusy}}
                        <div class="pb-roblox-account">
                          <span>Finish signing in in the Roblox window…</span>
                          <button
                            type="button"
                            class="btn"
                            {{on "click" this.cancelSignIn}}
                          >Cancel</button>
                        </div>
                      {{else}}
                        <button
                          type="button"
                          class="pb-export-btn pb-roblox-sign-in"
                          {{on "click" this.robloxSignIn}}
                        ><Icon @name="log-out" @size={{14}} /><span>Sign in with
                            Roblox</span></button>
                      {{/if}}
                      <div class="pb-callout">
                        <Icon @name="triangle-alert" @size={{14}} />
                        <p>JJS can only show pictures that are
                          <strong>Open Use</strong>. Newer Roblox accounts keep
                          uploads private, and Roblox doesn’t let apps change
                          that, so before uploading open
                          <a
                            href="https://create.roblox.com/settings/advanced"
                            target="_blank"
                            rel="noopener noreferrer"
                          >Creator Hub → Settings → Advanced</a>
                          and turn off “Opt-in to restrict assets on creation”.
                          Already uploaded? Set each decal to Open Use from its
                          page in the Creator Dashboard.</p>
                      </div>
                      {{#if this.robloxUser}}
                        <button
                          type="button"
                          class="pb-export-btn pb-upload"
                          disabled={{this.uploading}}
                          {{on "click" this.uploadToRoblox}}
                        ><Icon @name="upload" @size={{14}} /><span>{{if
                              this.uploading
                              "Uploading…"
                              (concat "Upload " this.uploadCount " pictures as decals")
                            }}</span></button>
                      {{/if}}
                      {{#if this.uploadsStale}}
                        <p class="pb-hint pb-warn"><Icon
                            @name="triangle-alert"
                            @size={{12}}
                          />
                          The design has changed since these were uploaded:
                          upload again to match it.</p>
                      {{/if}}
                      {{#if this.uploadRows.length}}
                        <ol class="pb-uploads">
                          {{#each this.uploadRows key="step" as |row|}}
                            <li class="pb-upload-row is-{{row.state}}">
                              <span class="pb-upload-step">{{row.step}}</span>
                              <span class="pb-upload-state">
                                {{#if (eq row.state "done")}}
                                  <Icon @name="check" @size={{12}} />
                                  image
                                  <code>{{row.imageId}}</code>
                                {{else if (eq row.state "uploading")}}
                                  Uploading…
                                {{else if (eq row.state "finding")}}
                                  Finding its picture…
                                {{else if (eq row.state "failed")}}
                                  {{row.error}}
                                {{else}}
                                  Waiting
                                {{/if}}
                              </span>
                              {{#if row.decalId}}
                                <a
                                  class="pb-upload-link"
                                  href="https://create.roblox.com/dashboard/creations/store/{{row.decalId}}/configure"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="Open decal {{row.decalId}} in the Creator Dashboard"
                                >decal {{row.decalId}}</a>
                              {{/if}}
                            </li>
                          {{/each}}
                        </ol>
                      {{/if}}
                      {{#if this.uploadError}}
                        <p class="tool-error">{{this.uploadError}}</p>
                      {{/if}}
                    {{else}}
                      <p class="pb-hint">Uploading straight to Roblox isn’t
                        switched on for this copy of the site: it needs a Roblox
                        OAuth app. You can still save the pictures, upload them
                        yourself, and paste their image IDs below.</p>
                    {{/if}}
                  </section>

                  <section class="pb-group">
                    <h4 class="pb-group-title">2 · Image IDs</h4>
                    <textarea
                      class="math-input pb-ids"
                      rows="4"
                      spellcheck="false"
                      aria-label="Image IDs, one per step"
                      placeholder="One image ID per step, step 0 (empty) first"
                      value={{this.jjs.ids}}
                      {{on "input" (fn this.setJjs "ids")}}
                    ></textarea>
                    <p class="pb-hint">{{this.jjsIds.length}}
                      of
                      {{this.pictures}}
                      IDs. Filled in by the upload; image (texture) IDs, not
                      decal IDs.</p>
                  </section>

                  <section class="pb-group">
                    <h4 class="pb-group-title">3 · Skill</h4>
                    <div class="pb-nums pb-skill-fields">
                      <label class="pb-num"><span>Name</span><input
                          type="text"
                          class="math-input"
                          placeholder={{this.doc.name}}
                          value={{this.jjs.name}}
                          {{on "change" (fn this.setJjs "name")}}
                        /></label>
                      <label class="pb-num"><span>Tag</span><input
                          type="text"
                          class="math-input pb-skill-tag"
                          value={{this.jjs.tag}}
                          {{on "change" (fn this.setJjs "tag")}}
                        /></label>
                      <label class="pb-num"><span>Size</span><input
                          type="number"
                          step="0.1"
                          min="0.1"
                          class="math-input"
                          value={{this.jjs.size}}
                          {{on "change" (fn this.setJjs "size")}}
                        /></label>
                      <label class="pb-num"><span>Offset (x, y, z)</span><input
                          type="text"
                          class="math-input"
                          value={{this.jjs.position}}
                          {{on "change" (fn this.setJjs "position")}}
                        /></label>
                      <label class="pb-num"><span>Shown for (s)</span><input
                          type="number"
                          step="0.01"
                          min="0"
                          class="math-input pb-skill-show"
                          value={{this.jjs.showFor}}
                          {{on "change" (fn this.setJjs "showFor")}}
                        /></label>
                      <label class="pb-num"><span>Wait (s)</span><input
                          type="number"
                          step="0.01"
                          min="0"
                          class="math-input pb-skill-wait"
                          value={{this.jjs.waitFor}}
                          {{on "change" (fn this.setJjs "waitFor")}}
                        /></label>
                    </div>
                    <div class="pb-row">
                      <span class="pb-row-label">Starts</span>
                      <div class="pb-seg" role="group" aria-label="Starts">
                        <button
                          type="button"
                          class={{if (eq this.jjs.start "full") "active"}}
                          {{on "click" (fn this.setJjsStart "full")}}
                        >Full</button>
                        <button
                          type="button"
                          class={{if (eq this.jjs.start "empty") "active"}}
                          {{on "click" (fn this.setJjsStart "empty")}}
                        >Empty</button>
                      </div>
                    </div>
                    <label class="math-check"><input
                        type="checkbox"
                        class="pb-skill-rails"
                        checked={{this.jjs.rails}}
                        {{on "change" (fn this.setJjs "rails")}}
                      />
                      Add Safety Rails</label>
                    <p class="pb-hint">Keeps the tag between 0 and
                      {{this.doc.frames}}: anything that pushes it past either
                      end is put back at that end.</p>
                    <div class="pb-inline">
                      <label class="math-check"><input
                          type="checkbox"
                          class="pb-skill-regen"
                          checked={{this.jjs.regen}}
                          {{on "change" (fn this.setJjs "regen")}}
                        />
                        Regenerate</label>
                      {{#if this.jjs.regen}}
                        <label class="pb-opt pb-opt-num"><span>Add</span><input
                            type="number"
                            class="math-input"
                            value={{this.jjs.regenAmount}}
                            {{on "change" (fn this.setJjs "regenAmount")}}
                          /></label>
                        <label class="pb-opt pb-opt-num"><span>every (s)</span><input
                            type="number"
                            step="0.1"
                            min="0.05"
                            class="math-input"
                            value={{this.jjs.regenEvery}}
                            {{on "change" (fn this.setJjs "regenEvery")}}
                          /></label>
                      {{/if}}
                    </div>
                    <p class="pb-hint">Two debug skills come with it: key 1
                      adds a step, key 2 takes one away.</p>
                    <p class="pb-hint">The skill shows step N while the
                      <code>{{if this.jjs.tag this.jjs.tag "Bar"}}</code>
                      tag is N (0 to
                      {{this.doc.frames}}): set that tag from your other skills
                      to move the bar.</p>
                    {{#if this.skillCode}}
                      <textarea
                        class="math-input pb-skill-code"
                        rows="4"
                        readonly
                        spellcheck="false"
                        aria-label="Skill code"
                        value={{this.skillCode}}
                      ></textarea>
                      <button
                        type="button"
                        class="pb-export-btn pb-copy-skill"
                        {{on "click" this.copySkill}}
                      ><Icon
                          @name={{if this.copied "check" "copy"}}
                          @size={{14}}
                        /><span>{{if
                            this.copied
                            "Copied: paste it into the Skill Builder"
                            "Copy skill code"
                          }}</span></button>
                    {{else if this.skillNote}}
                      <p class="pb-hint pb-warn">{{this.skillNote}}</p>
                    {{/if}}
                  </section>
                {{/if}}
              </div>
            </div>
          </div>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}
