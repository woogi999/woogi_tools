import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { service } from '@ember/service';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import { LinkTo } from '@ember/routing';
import { pageTitle } from 'ember-page-title';
import Icon from './icon';
import ProjectPanel from './ferrite/project-panel';
import ViewerPanel from './ferrite/viewer-panel';
import InspectorPanel from './ferrite/inspector-panel';
import EffectsPanel from './ferrite/effects-panel';
import EasePanel from './ferrite/ease-panel';
import TimelinePanel from './ferrite/timeline-panel';
import { acceptPastedFiles } from '../utils/paste-files';
import { formatBytes } from '../utils/file-share';
import StartPage from './ferrite/start-page';
import ExportModal from './ferrite/export-modal';
import {
  listProjects,
  loadStored,
  storeProject,
  forgetProject,
  newProject as freshProject,
  readProjectFile,
  saveAs,
} from '../utils/ferrite/projects';
import { renderOut, formatById, sizeFor } from '../utils/ferrite/export';
import { baseName } from '../utils/media-jobs';
import { keepState } from '../utils/tool-state';
import { TOOLS as TOOL_REGISTRY } from '../tools';
import { drawScene, boxOf, handlesOf } from '../utils/ferrite/render';
import { forgetPalette } from '../utils/ferrite/theme';
import { releaseGpu, hasGpu } from '../utils/ferrite/gpu';
import {
  ACTIONS,
  KEY_GROUPS,
  actionFor,
  keyFor,
  loadBindings,
  rebind,
  resetBindings,
  pressLabel,
} from '../utils/ferrite/keymap';
import {
  PROPS,
  KINDS,
  MATTES,
  EASINGS,
  makeProject,
  makeScene,
  makeLayer,
  makeEffect,
  effectDef,
  groupsFor,
  propsIn,
  propAndPair,
  keysFor,
  keyAt,
  isKeyed,
  valueAt,
  putKey,
  dropKey,
  toggleKeyed,
  keyTimes,
  liveAt,
  draws,
  paramAt,
  putParamKey,
  toggleParamKeyed,
  rasterOf,
  fpsOf,
  frameMs,
  frameOf,
  snapFrame,
  timecode,
  contentMs,
  wouldLoop,
  newId,
} from '../utils/ferrite/model';

// A pointer that has already gone throws rather than returning, and optional
// chaining does not help: the method is there, it just refuses. A capture that
// cannot be taken is not worth failing a gesture over.
function grabPointer(element, event) {
  try {
    element?.setPointerCapture?.(event.pointerId);
  } catch {
    // The gesture still works; it just will not follow the pointer off the
    // element.
  }
}

function freePointer(element, event) {
  try {
    element?.releasePointerCapture?.(event.pointerId);
  } catch {
    // Already released.
  }
}

// Ferrite, in the page.
//
// This is a port of Project Ferrite's editor (a native Rust/Iced broadcast
// graphics application) rather than a tool inspired by it. What it keeps is
// the whole authoring half: the menu bar and the keymap, the four docks with
// their tab strips, a project of scenes each with its own raster and rate, ten
// layer kinds with an in and an out, a style whose every number can be
// keyframed on the same seven easing curves, parenting, track mattes, the
// 145-effect catalogue, the After Effects timeline with its twirls and
// stopwatches, and the composition viewer with its handles and anchor point.
//
// What it does not keep is the production half, which the brief put out of
// scope and none of which belongs in a browser tab anyway: the surface host
// process, the engine's WebGPU renderer, the frame bridge, the browser-source
// outputs, the REST control API, the live data gateway, the take-to-program
// bus, and the Live and Automate workspaces. Where Ferrite would hand a frame
// to an output, this writes a file.
//
// One renderer, which is Ferrite's own hardest-won rule: the viewport and the
// written-out file are the same `drawScene`, so a difference between them is a
// bug rather than a setting.

const eq = (a, b) => a === b;
const not = (a) => !a;
// A menu row's label as something a selector can hold on to, so adding a row
// above does not silently move what a test or a shortcut points at.
const slug = (label) =>
  String(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const chipAt = (drag) =>
  htmlSafe(`left:${drag.x + 14}px; top:${drag.y - 10}px`);
const pct = (p) => htmlSafe(`width:${Math.round((p ?? 0) * 100)}%`);

const TOOLS = [
  { id: 'select', label: 'Select', icon: 'mouse-pointer-2', key: 'V' },
  { id: 'hand', label: 'Hand', icon: 'hand', key: 'H' },
  { id: 'rotate', label: 'Rotate', icon: 'rotate-cw', key: 'W' },
  { id: 'anchor', label: 'Anchor point', icon: 'crosshair', key: 'Y' },
];

// The reveal shortcuts: press one and the timeline twirls open just that
// property on every selected layer, which is how anybody actually navigates a
// scene with forty layers in it.
const REVEALS = [
  { id: 'x', label: 'Position', key: 'P', props: ['x', 'y'] },
  { id: 'scale', label: 'Scale', key: 'S', props: ['scale'] },
  { id: 'rotation', label: 'Rotation', key: 'R', props: ['rotation'] },
  { id: 'opacity', label: 'Opacity', key: 'T', props: ['opacity'] },
  { id: 'anchor', label: 'Anchor', key: 'A', props: ['anchorX', 'anchorY'] },
  { id: 'animated', label: 'Animated only', key: 'U', props: null },
  { id: 'effects', label: 'Effects', key: 'E', props: null },
];

const PANELS = {
  project: { title: 'Project', side: 'left', component: ProjectPanel },
  properties: { title: 'Properties', side: 'left', component: InspectorPanel },
  viewer: { title: 'Composition', side: 'centre', component: ViewerPanel },
  effects: { title: 'Effects', side: 'right', component: EffectsPanel },
  ease: { title: 'Ease', side: 'right', component: EasePanel },
  timeline: { title: 'Timeline', side: 'bottom', component: TimelinePanel },
};

const MENUS = ['File', 'Edit', 'Scene', 'Layer', 'View', 'Window', 'Keys'];

const SIZES = [
  { label: '1080p', width: 1920, height: 1080 },
  { label: '720p', width: 1280, height: 720 },
  { label: 'Vertical', width: 1080, height: 1920 },
  { label: 'Square', width: 1080, height: 1080 },
];

const STILL_MS = 4000;

const kindOf = (file) => {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('image/')) return 'image';
  if (/\.(mp4|mkv|mov|webm|avi|m4v)$/i.test(file.name)) return 'video';
  if (/\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(file.name)) return 'audio';
  if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(file.name)) return 'image';
  return null;
};

function loadMedia(kind, url) {
  return new Promise((resolve, reject) => {
    if (kind === 'image') {
      const img = new Image();
      img.onload = () => resolve({ element: img, ms: STILL_MS });
      img.onerror = () => reject(new Error('that picture could not be read'));
      img.src = url;
      return;
    }
    const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
    el.preload = 'auto';
    el.playsInline = true;
    el.crossOrigin = 'anonymous';
    el.onloadedmetadata = () =>
      resolve({ element: el, ms: (el.duration || 0) * 1000 || STILL_MS });
    el.onerror = () => reject(new Error('that file could not be decoded'));
    el.src = url;
  });
}

export default class VideoEditorPage extends Component {
  // The page carries no site chrome, so the one site control worth keeping,
  // which theme it is in, has to live in the editor's own menu bar.
  @service settings;

  /* --------------------------------------------------------- the model */

  @tracked project = makeProject();
  @tracked sceneId = null;
  @tracked selectedIds = [];
  @tracked selectedKeys = [];

  /* --------------------------------------------------------- the clock */

  @tracked timeMs = 0;
  @tracked playing = false;
  @tracked looping = false;

  /* ---------------------------------------------------------- the view */

  @tracked tool = 'select';
  @tracked zoom = 'fit';
  @tracked panX = 0;
  @tracked panY = 0;
  @tracked showSafe = false;
  @tracked showHandles = true;
  @tracked twirls = [];
  @tracked viewStartMs = 0;
  @tracked viewSpanMs = 10000;
  @tracked trackWidth = 900;
  @tracked stageSize = { width: 800, height: 450 };

  /* --------------------------------------------------------- the shell */

  @tracked openMenu = null;
  @tracked leftTab = 'project';
  @tracked rightTab = 'effects';
  @tracked bottomTab = 'timeline';
  @tracked hidden = [];
  @tracked leftW = 300;
  @tracked rightW = 260;
  @tracked bottomH = 300;
  @tracked sceneDialog = false;
  @tracked shortcutsOpen = false;
  @tracked aboutOpen = false;
  @tracked notice = null;
  // The work area: the span the transport loops over and the render writes.
  @tracked inMs = null;
  @tracked outMs = null;

  /* -------------------------------------------------------- the export */

  // Which of the two screens is up. A web editor opens on the start page,
  // because "is my work still here?" is the first question it has to answer
  // and an empty timeline answers it wrongly.
  @tracked view = 'home';
  @tracked recents = [];
  // Where on the shelf this project goes back to. A project opened from a file
  // or freshly made gets its own id the first time it is saved.
  projectId = null;

  @tracked showExport = false;
  @tracked exportSettings = {
    span: 'comp',
    fromSec: 0,
    toSec: 10,
    resolution: 'full',
    customW: 1920,
    customH: 1080,
    fps: 30,
    quality: 'good',
    motionBlur: true,
    effects: true,
    soloOff: false,
    format: 'mp4-h264',
    engine: 'live',
    alpha: false,
    audio: true,
    name: 'composition',
  };
  aborter = null;

  @tracked busy = false;
  @tracked status = '';
  @tracked progress = 0;
  @tracked resultUrl = null;
  @tracked resultSize = 0;
  @tracked resultExt = 'webm';
  @tracked dragging = false;

  tools = TOOLS;
  // The kinds worth a button of their own; the rest stay in the Layer menu.
  quickLayers = ['text', 'box', 'svg', 'null', 'adjustment', 'group'].map(
    (kind) => ({ kind, label: KINDS[kind].label, icon: KINDS[kind].icon }),
  );
  reveals = REVEALS;
  // The three curves worth a button; the rest are on the property row's own
  // dropdown and in the Ease panel.
  easePresets = [
    { id: 'ease-in-out', short: 'Ease', label: 'Ease', key: 'F9' },
    { id: 'linear', short: 'Lin', label: 'Make linear', key: 'Ctrl+Alt+F9' },
    { id: 'hold', short: 'Hold', label: 'Hold', key: 'Ctrl+Alt+H' },
  ];
  menus = MENUS;
  sizes = SIZES;
  easings = EASINGS;
  panelList = Object.entries(PANELS).map(([id, p]) => ({ id, ...p }));

  // layer id -> the element holding its pixels or its sound. Not tracked: the
  // elements never change identity, only what they are showing.
  media = new Map();
  urls = [];
  stage = null;
  repaintTracks = null;
  fileInput = null;
  projectInput = null;
  frame = null;
  lastTick = 0;
  split = null;
  history = [];
  future = [];
  // The sound graph, built once and kept: a clip's element can only ever be
  // handed to createMediaElementSource once, so the export cannot build its
  // own mixer without taking the preview's sound away for good.
  audio = null;
  recordDest = null;
  gains = new Map();

  constructor(owner, args) {
    super(owner, args);
    this.sceneId = this.project.scenes[0].id;
    loadBindings();
    this.recents = listProjects();
    keepState(this, 'video-editor', [
      'leftW',
      'rightW',
      'bottomH',
      'showSafe',
      'showHandles',
    ]);
    registerDestructor(this, () => {
      cancelAnimationFrame(this.frame);
      for (const el of this.media.values()) if (el.pause) el.pause();
      this.audio?.close().catch(() => {});
      for (const url of this.urls) URL.revokeObjectURL(url);
      if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
      forgetPalette();
      releaseGpu();
    });
  }

  /* ------------------------------------------------------- the console */

  // A shader that cannot run reports itself every frame, so the console would
  // fill with one complaint sixty times a second. Each distinct note is said
  // once and then counted.
  noteOnce = (text) => {
    if (this.notedAlready.has(text)) return;
    this.notedAlready.add(text);
    this.say('warn', text);
  };

  notedAlready = new Set();
  noticeTimer = 0;

  // One line at a time, in the status bar. A simple editor does not need a
  // log to scroll through, but it does still owe you the truth when a codec
  // is missing or a shader could not run.
  say(level, text) {
    this.notice = { level, text };
    clearTimeout(this.noticeTimer);
    // Warnings and errors stay put; a plain note fades so the bar goes quiet.
    if (level === 'info')
      this.noticeTimer = setTimeout(() => (this.notice = null), 6000);
  }

  clearNotice = () => (this.notice = null);

  /* --------------------------------------------------------- selectors */

  get scene() {
    return this.project.scenes.find((s) => s.id === this.sceneId) ?? null;
  }

  get layers() {
    return this.scene?.layers ?? [];
  }

  get markers() {
    return this.scene?.markers ?? [];
  }

  get layer() {
    return this.layers.find((l) => l.id === this.selectedIds[0]) ?? null;
  }

  get selection() {
    return this.layers.filter((l) => this.selectedIds.includes(l.id));
  }

  byId = (id) => this.layers.find((l) => l.id === id) ?? null;

  get raster() {
    return this.scene
      ? rasterOf(this.scene, this.project.settings)
      : this.project.settings;
  }

  get fps() {
    return this.scene ? fpsOf(this.scene, this.project.settings) : 30;
  }

  get frameMs() {
    return frameMs(this.fps);
  }

  snap = (ms) => snapFrame(ms, this.fps);

  get durationMs() {
    return this.scene?.durationMs ?? 10000;
  }

  get timecodeNow() {
    return timecode(this.timeMs, this.fps);
  }

  get timecodeEnd() {
    return timecode(this.durationMs, this.fps);
  }

  get frameNow() {
    return frameOf(this.timeMs, this.fps);
  }

  get frameTotal() {
    return frameOf(this.durationMs, this.fps);
  }

  get rasterLabel() {
    return `${this.raster.width}x${this.raster.height} @ ${Math.round(this.fps)}`;
  }

  get effectiveZoom() {
    if (this.zoom !== 'fit') return this.zoom;
    const { width, height } = this.raster;
    return Math.min(
      this.stageSize.width / width,
      this.stageSize.height / height,
      1,
    );
  }

  get zoomLabel() {
    return `${Math.round(this.effectiveZoom * 100)}%`;
  }

  get sceneRows() {
    return this.project.scenes.map((s) => ({
      id: s.id,
      name: s.name,
      animation: Boolean(s.parent),
      selected: s.id === this.sceneId,
      duration: `${(s.durationMs / 1000).toFixed(1)}s`,
      indent: htmlSafe(s.parent ? 'padding-left:16px' : ''),
    }));
  }

  get parentChoices() {
    const self = this.layer;
    if (!self) return [];
    return this.layers.filter(
      (l) => l.id !== self.id && !wouldLoop(this.layers, self, l.id),
    );
  }

  get fillColour() {
    const value = this.layer?.style.background ?? '';
    return /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
  }

  valueOf = (layer, prop) => valueAt(layer, prop, this.timeMs);

  boxOf = (layer) =>
    boxOf(
      layer,
      this.timeMs,
      this.scene,
      this.project.settings,
      this.media.get(layer.id),
    );

  /* ----------------------------------------------------- inspector rows */

  rowsForGroup(group) {
    const layer = this.layer;
    if (!layer) return [];
    return propsIn(layer.kind, group).map((prop) => this.propRow(layer, prop));
  }

  propRow(layer, prop) {
    const spec = PROPS[prop];
    const key = keyAt(layer, prop, this.snap(this.timeMs));
    const pair = spec.pair;
    return {
      pair,
      pairValue: pair ? valueAt(layer, pair, this.timeMs) : null,
      pairUnit: pair ? PROPS[pair].unit : '',
      prop,
      key: `${layer.id}/${prop}`,
      label: spec.label,
      unit: spec.unit,
      step: spec.step,
      min: spec.min,
      max: spec.max,
      keyed: isKeyed(layer, prop),
      onKey: Boolean(key),
      easing: key?.easing ?? 'linear',
      value: valueAt(layer, prop, this.timeMs),
    };
  }

  get transformRows() {
    return this.rowsForGroup('Transform');
  }

  get appearanceRows() {
    return this.rowsForGroup('Appearance');
  }

  get typeRows() {
    return this.rowsForGroup('Type');
  }

  get audioRows() {
    return this.rowsForGroup('Audio');
  }

  get effectRows() {
    const layer = this.layer;
    if (!layer) return [];
    return layer.effects.map((fx) => {
      const def = effectDef(fx.name);
      return {
        id: fx.id,
        name: fx.name,
        enabled: fx.enabled,
        params: (def?.params ?? []).map((param, index) => ({
          index,
          index0: Math.round(paramAt(fx, index, this.timeMs)),
          label: param.label,
          step: param.step,
          min: param.min,
          max: param.max,
          suffix: param.suffix,
          choices: param.choices,
          keyed: (fx.tracks?.[index] ?? []).length > 0,
          value: paramAt(fx, index, this.timeMs),
        })),
        colors: (def?.colors ?? []).map((colour, index) => ({
          index,
          label: colour.label,
          hex: /^#[0-9a-f]{6}$/i.test(fx.colors[index])
            ? fx.colors[index]
            : '#000000',
        })),
      };
    });
  }

  /* ------------------------------------------------------- timeline rows */

  // The flat row list the tree and the canvas both lay themselves out from,
  // so a property's name and its keyframes are always on the same line.
  get rows() {
    const out = [];
    const soloed = this.layers.some((l) => l.solo);
    for (const layer of this.layers) {
      const selected = this.selectedIds.includes(layer.id);
      out.push({
        kind: 'layer',
        id: layer.id,
        key: layer.id,
        layer,
        label: layer.name,
        icon: KINDS[layer.kind]?.icon ?? 'layers',
        depth: 0,
        selected,
        dim: !layer.visible || (soloed && !layer.solo),
        expanded: this.isOpen(layer.id),
        span: [layer.inMs, layer.outMs],
        keys: keyTimes(layer).map((ms) => ({ ms, selected: false })),
        parentChoices: this.layers.filter(
          (l) => l.id !== layer.id && !wouldLoop(this.layers, layer, l.id),
        ),
      });
      if (!this.isOpen(layer.id)) continue;

      for (const group of groupsFor(layer.kind)) {
        if (group === 'Effects') continue;
        const gkey = `${layer.id}/${group}`;
        const props = propsIn(layer.kind, group);
        out.push({
          kind: 'group',
          id: gkey,
          key: gkey,
          layer,
          label: group,
          depth: 1,
          selected,
          expanded: this.isOpen(gkey),
          keys: this.summaryKeys(layer, props),
        });
        if (!this.isOpen(gkey)) continue;
        for (const prop of props)
          out.push(this.timelinePropRow(layer, prop, selected));
      }

      if (!groupsFor(layer.kind).includes('Effects')) continue;
      for (const fx of layer.effects) {
        const fkey = `${layer.id}/fx/${fx.id}`;
        const def = effectDef(fx.name);
        out.push({
          kind: 'effect',
          id: fkey,
          key: fkey,
          layer,
          fxId: fx.id,
          label: fx.name,
          enabled: fx.enabled,
          depth: 1,
          selected,
          expanded: this.isOpen(fkey),
          keys: Object.values(fx.tracks ?? {})
            .flat()
            .map((k) => ({ ms: k.ms, selected: false })),
        });
        if (!this.isOpen(fkey)) continue;
        (def?.params ?? []).forEach((param, index) => {
          const keys = fx.tracks?.[index] ?? [];
          const here = keys.find(
            (k) => Math.abs(k.ms - this.snap(this.timeMs)) <= 1,
          );
          out.push({
            kind: 'prop',
            id: `${fkey}/${index}`,
            key: `${fkey}/${index}`,
            layer,
            fxId: fx.id,
            paramIndex: index,
            label: param.label,
            unit: param.suffix,
            step: param.step,
            min: param.min,
            max: param.max,
            depth: 2,
            selected,
            keyed: keys.length > 0,
            onKey: Boolean(here),
            easing: here?.easing ?? 'linear',
            value: paramAt(fx, index, this.timeMs),
            keys: keys.map((k) => ({
              ms: k.ms,
              selected: this.isKeySelected(
                layer.id,
                `fx:${fx.id}:${index}`,
                k.ms,
              ),
            })),
          });
        });
      }
    }
    return out;
  }

  summaryKeys(layer, props) {
    const times = new Set();
    for (const prop of props)
      for (const k of keysFor(layer, prop)) times.add(k.ms);
    return [...times]
      .sort((a, b) => a - b)
      .map((ms) => ({ ms, selected: false }));
  }

  timelinePropRow(layer, prop, selected) {
    const row = this.propRow(layer, prop);
    return {
      ...row,
      kind: 'prop',
      id: `${layer.id}/${prop}`,
      layer,
      depth: 2,
      selected,
      keys: [
        ...new Set(
          propAndPair(prop).flatMap((p) => keysFor(layer, p).map((k) => k.ms)),
        ),
      ]
        .sort((a, b) => a - b)
        .map((ms) => ({
          ms,
          selected: this.isKeySelected(layer.id, prop, ms),
        })),
    };
  }

  isKeySelected = (layerId, prop, ms) =>
    this.selectedKeys.some(
      (s) => s.layerId === layerId && s.prop === prop && s.ms === ms,
    );

  get selectedKey() {
    const first = this.selectedKeys[0];
    if (!first) return null;
    const layer = this.byId(first.layerId);
    if (!layer) return null;
    let key = null;
    let propLabel = first.prop;
    if (String(first.prop).startsWith('fx:')) {
      const [, fxId, index] = String(first.prop).split(':');
      const fx = layer.effects.find((f) => f.id === fxId);
      key = (fx?.tracks?.[index] ?? []).find((k) => k.ms === first.ms) ?? null;
      propLabel = `${fx?.name ?? ''} · ${effectDef(fx?.name)?.params[index]?.label ?? ''}`;
    } else {
      key = keyAt(layer, first.prop, first.ms) ?? null;
      propLabel = `${layer.name} · ${PROPS[first.prop]?.label ?? first.prop}`;
    }
    if (!key) return null;
    return { key, propLabel, timecode: timecode(first.ms, this.fps) };
  }

  isOpen = (key) => this.twirls.includes(key);

  twirl = (key) => {
    this.twirls = this.isOpen(key)
      ? this.twirls.filter((k) => k !== key)
      : [...this.twirls, key];
  };

  /* ------------------------------------------------------------ editing */

  // Every edit funnels through here so undo is one mechanism rather than
  // thirty.
  snapshot() {
    this.history = [
      ...this.history.slice(-49),
      JSON.stringify({ project: this.project, sceneId: this.sceneId }),
    ];
    this.future = [];
  }

  // A drag calls this once when it is let go, so a hundred pointer moves are
  // one undo step rather than a hundred.
  commit = () => this.snapshot();

  undo = () => {
    const previous = this.history[this.history.length - 1];
    if (!previous) return;
    this.future = [
      ...this.future,
      JSON.stringify({ project: this.project, sceneId: this.sceneId }),
    ];
    this.history = this.history.slice(0, -1);
    this.restore(JSON.parse(previous));
  };

  redo = () => {
    const next = this.future[this.future.length - 1];
    if (!next) return;
    this.history = [
      ...this.history,
      JSON.stringify({ project: this.project, sceneId: this.sceneId }),
    ];
    this.future = this.future.slice(0, -1);
    this.restore(JSON.parse(next));
  };

  restore(state) {
    this.project = state.project;
    this.sceneId = state.sceneId;
    this.paint();
  }

  mutateScene(change) {
    this.project = {
      ...this.project,
      scenes: this.project.scenes.map((s) =>
        s.id === this.sceneId ? change(s) : s,
      ),
    };
    this.paint();
  }

  patch(id, change) {
    if (!id) return;
    this.mutateScene((scene) => ({
      ...scene,
      layers: scene.layers.map((l) =>
        l.id === id
          ? typeof change === 'function'
            ? change(l)
            : { ...l, ...change }
          : l,
      ),
    }));
  }

  patchSelected(change) {
    for (const layer of this.selection) this.patch(layer.id, change);
  }

  /* ------------------------------------------------------------- scenes */

  selectScene = (id) => {
    this.sceneId = id;
    this.selectedIds = [];
    this.selectedKeys = [];
    this.timeMs = 0;
    this.fitTimeView();
    this.paint();
  };

  addScene = () => {
    this.snapshot();
    const scene = makeScene({
      name: `Scene ${this.project.scenes.length + 1}`,
    });
    this.project = { ...this.project, scenes: [...this.project.scenes, scene] };
    this.selectScene(scene.id);
    this.say('info', `Added ${scene.name}.`);
  };

  // A family is one deep, so this always means "another animation of the same
  // scene" wherever it is asked from.
  addSceneAnimation = () => {
    const host = this.scene;
    if (!host) return;
    this.snapshot();
    const parent = host.parent ?? host.id;
    const of = this.project.scenes.find((s) => s.id === parent);
    const scene = makeScene({
      name: `${of?.name ?? 'Scene'} animation`,
      parent,
      durationMs: 2000,
    });
    // Directly after the scene it belongs to and its existing animations, so
    // reading straight down the list is already the right order.
    const scenes = [...this.project.scenes];
    let at = scenes.findIndex((s) => s.id === parent);
    while (at + 1 < scenes.length && scenes[at + 1].parent === parent) at++;
    scenes.splice(at + 1, 0, scene);
    this.project = { ...this.project, scenes };
    this.selectScene(scene.id);
  };

  deleteScene = (id) => {
    if (this.project.scenes.length <= 1) {
      this.say('warn', 'A project needs at least one scene.');
      return;
    }
    this.snapshot();
    // Named for what it takes with it: deleting a scene deletes the animations
    // hanging off it, and finding that out afterwards is not the moment.
    const going = this.project.scenes.filter(
      (s) => s.id === id || s.parent === id,
    );
    const scenes = this.project.scenes.filter((s) => !going.includes(s));
    this.project = { ...this.project, scenes };
    if (going.some((s) => s.id === this.sceneId))
      this.selectScene(scenes[0].id);
    const extra = going.length - 1;
    this.say(
      'info',
      extra > 0
        ? `Deleted the scene and its ${extra} animation${extra === 1 ? '' : 's'}.`
        : 'Deleted the scene.',
    );
  };

  openSceneDialog = (id) => {
    if (id) this.selectScene(id);
    this.sceneDialog = true;
    this.openMenu = null;
  };

  closeSceneDialog = () => (this.sceneDialog = false);

  setSceneField = (field, event) => {
    const raw = event.target.value;
    const words = field === 'name' || field === 'background';
    this.mutateScene((scene) => ({
      ...scene,
      [field]: words ? raw : Number(raw),
    }));
  };

  setSceneSize = (event) => {
    const size = SIZES[Number(event.target.value)];
    if (!size) return;
    this.mutateScene((scene) => ({
      ...scene,
      width: size.width,
      height: size.height,
    }));
  };

  fitDuration = () => {
    this.snapshot();
    this.mutateScene((scene) => ({ ...scene, durationMs: contentMs(scene) }));
    this.fitTimeView();
    this.say('info', 'Scene duration fitted to its content.');
  };

  addMarker = () => {
    this.snapshot();
    const ms = this.snap(this.timeMs);
    this.mutateScene((scene) => ({
      ...scene,
      markers: [
        ...scene.markers.filter((m) => m.ms !== ms),
        { id: newId('m'), ms, name: `${scene.markers.length + 1}` },
      ].sort((a, b) => a.ms - b.ms),
    }));
  };

  /* ------------------------------------------------------------- layers */

  addLayer = (kind) => {
    this.snapshot();
    const layer = makeLayer(kind, {
      inMs: 0,
      outMs: this.durationMs,
      name: KINDS[kind]?.label ?? 'Layer',
    });
    // A neutral mid grey rather than a brand colour: it is the one default
    // that reads against the checkerboard in either theme, and a new solid
    // should not arrive already looking like somebody's decision.
    if (kind === 'box') layer.style.background = '#808080';
    this.mutateScene((scene) => ({
      ...scene,
      layers: [layer, ...scene.layers],
    }));
    this.selectedIds = [layer.id];
    this.openMenu = null;
    this.say('info', `Added a ${KINDS[kind]?.label.toLowerCase()} layer.`);
  };

  selectLayer = (id, event) => {
    if (!id) {
      this.selectedIds = [];
      this.selectedKeys = [];
      this.paint();
      return;
    }
    const additive = event?.shiftKey || event?.metaKey || event?.ctrlKey;
    this.selectedIds = additive
      ? this.selectedIds.includes(id)
        ? this.selectedIds.filter((s) => s !== id)
        : [...this.selectedIds, id]
      : [id];
    this.selectedKeys = [];
    this.paint();
  };

  // Which layers a rubber band on the stage caught. A layer counts if its own
  // box overlaps the band, so brushing the edge of something picks it up the
  // way it does in every other editor.
  selectLayersIn = (band, additive) => {
    const from = {
      x: Math.min(band.x0, band.x1),
      y: Math.min(band.y0, band.y1),
    };
    const to = { x: Math.max(band.x0, band.x1), y: Math.max(band.y0, band.y1) };
    const caught = this.layers
      .filter(
        (l) => liveAt(l, this.timeMs, this.layers) && !l.locked && draws(l),
      )
      .filter((l) => {
        const { corners } = handlesOf(
          l,
          this.scene,
          this.project.settings,
          this.timeMs,
          this.media,
        );
        const xs = corners.map((c) => c.x);
        const ys = corners.map((c) => c.y);
        return (
          Math.max(...xs) >= from.x &&
          Math.min(...xs) <= to.x &&
          Math.max(...ys) >= from.y &&
          Math.min(...ys) <= to.y
        );
      })
      .map((l) => l.id);
    this.selectedIds = additive
      ? [...new Set([...this.selectedIds, ...caught])]
      : caught;
    this.selectedKeys = [];
    this.paint();
  };

  selectAll = () => {
    this.selectedIds = this.layers.map((l) => l.id);
    this.openMenu = null;
  };

  renameLayer = (event) =>
    this.patch(this.layer?.id, { name: event.target.value });

  toggleLayerFlag = (id, flag) => {
    this.snapshot();
    this.patch(id, (l) => ({ ...l, [flag]: !l[flag] }));
  };

  toggleFlag = (flag) => {
    this.snapshot();
    this.patchSelected((l) => ({ ...l, [flag]: !l[flag] }));
  };

  toggleStyleFlag = (flag) => {
    this.snapshot();
    this.patchSelected((l) => ({
      ...l,
      style: { ...l.style, [flag]: !l.style[flag] },
    }));
  };

  deleteSelected = () => {
    if (!this.selectedIds.length) return;
    this.snapshot();
    const going = new Set(this.selectedIds);
    for (const id of going) this.media.delete(id);
    this.mutateScene((scene) => ({
      ...scene,
      layers: scene.layers
        .filter((l) => !going.has(l.id))
        .map((l) => (going.has(l.parent) ? { ...l, parent: null } : l)),
    }));
    this.selectedIds = [];
    this.openMenu = null;
  };

  duplicateSelected = () => {
    if (!this.selectedIds.length) return;
    this.snapshot();
    const copies = this.selection.map((layer) => {
      const copy = {
        ...layer,
        id: newId(),
        name: `${layer.name} copy`,
        style: { ...layer.style },
        tracks: { ...layer.tracks },
        effects: layer.effects.map((fx) => ({ ...fx, id: newId('fx') })),
      };
      this.cloneMedia(layer.id, copy.id);
      return copy;
    });
    this.mutateScene((scene) => ({
      ...scene,
      layers: [...copies, ...scene.layers],
    }));
    this.selectedIds = copies.map((c) => c.id);
    this.openMenu = null;
  };

  // A second copy of a clip needs its own element: one <video> cannot be at
  // two times at once.
  cloneMedia(from, to) {
    const source = this.media.get(from);
    if (!source) return;
    if (source instanceof Image) {
      this.media.set(to, source);
      return;
    }
    const el = document.createElement(source.tagName);
    el.preload = 'auto';
    el.playsInline = true;
    el.src = source.src;
    this.media.set(to, el);
  }

  restack = (by, absolute) => {
    const layer = this.layer;
    if (!layer) return;
    this.snapshot();
    this.mutateScene((scene) => {
      const layers = [...scene.layers];
      const index = layers.indexOf(layer);
      layers.splice(index, 1);
      const to = absolute
        ? by < 0
          ? 0
          : layers.length
        : Math.max(0, Math.min(layers.length, index + by));
      layers.splice(to, 0, layer);
      return { ...scene, layers };
    });
    this.openMenu = null;
  };

  splitAtPlayhead = () => {
    const layer = this.layer;
    const at = this.snap(this.timeMs);
    if (!layer || at <= layer.inMs || at >= layer.outMs) {
      this.say('warn', 'Put the playhead inside the selected layer first.');
      return;
    }
    this.snapshot();
    // Both halves keep the keyframes: trimming never touches them, and a split
    // is a trim that happens twice.
    const tail = {
      ...layer,
      id: newId(),
      inMs: at,
      offsetMs: layer.offsetMs + (at - layer.inMs),
      style: { ...layer.style },
      tracks: { ...layer.tracks },
      effects: layer.effects.map((fx) => ({ ...fx, id: newId('fx') })),
    };
    this.cloneMedia(layer.id, tail.id);
    this.mutateScene((scene) => {
      const layers = [...scene.layers];
      const index = layers.indexOf(layer);
      layers.splice(index, 1, { ...layer, outMs: at }, tail);
      return { ...scene, layers };
    });
    this.selectedIds = [tail.id];
    this.openMenu = null;
  };

  setParent = (event) => this.setParentOf(this.layer?.id, event);

  setParentOf = (id, event) => {
    const to = event.target.value || null;
    const layer = this.byId(id);
    if (to && layer && wouldLoop(this.layers, layer, to)) {
      this.say('warn', 'That would make a layer its own parent.');
      return;
    }
    this.snapshot();
    this.patch(id, { parent: to });
  };

  mattes = MATTES;

  setMatteOf = (id, event) => {
    this.snapshot();
    this.patch(id, { matte: event.target.value });
  };

  setMatte = (event) => {
    this.snapshot();
    this.patch(this.layer?.id, { matte: event.target.value });
  };

  /* --------------------------------------------------------- properties */

  setProp = (id, prop, value) => {
    this.patch(id, (l) =>
      isKeyed(l, prop)
        ? putKey(l, prop, this.snap(this.timeMs), value)
        : { ...l, style: { ...l.style, [prop]: value } },
    );
  };

  setPairValue = (row, value) => {
    if (!row.pair) return;
    this.setSelectedProp(row.pair, value);
  };

  setSelectedProp = (prop, value) => {
    const layer = this.layer;
    if (!layer) return;
    this.setProp(layer.id, prop, value);
  };

  stopwatch = (prop) => {
    this.snapshot();
    // A pair is one idea, so arming it arms both halves: keying X without Y
    // is a position that can only move sideways.
    const at = this.snap(this.timeMs);
    const both = propAndPair(prop);
    const arming = !isKeyed(this.layer ?? {}, prop);
    this.patchSelected((l) =>
      both.reduce(
        (acc, p) =>
          isKeyed(acc, p) === arming ? acc : toggleKeyed(acc, p, at),
        l,
      ),
    );
  };

  setStyle = (patchObject) => {
    this.snapshot();
    this.patchSelected((l) => ({
      ...l,
      style: { ...l.style, ...patchObject },
    }));
  };

  setStyleString = (field, event) =>
    this.setStyle({ [field]: event.target.value });

  setColour = (field, value) => this.setStyle({ [field]: value });

  setString = (field, event) => {
    this.snapshot();
    this.patchSelected({ [field]: event.target.value });
  };

  alignHorizontal = () => this.setSelectedProp('x', 0);

  alignVertical = () => this.setSelectedProp('y', 0);

  centreAnchor = () => {
    this.snapshot();
    this.patchSelected((l) => ({
      ...l,
      style: { ...l.style, anchorX: 50, anchorY: 50 },
    }));
  };

  fitToScene = () => {
    const raster = this.raster;
    this.snapshot();
    this.patchSelected((l) => ({
      ...l,
      style: {
        ...l.style,
        autoSize: false,
        width: raster.width,
        height: raster.height,
        x: 0,
        y: 0,
      },
    }));
  };

  /* ------------------------------------------------------------ effects */

  addEffect = (name) => {
    const layer = this.layer;
    if (!layer) {
      this.say('warn', 'Select a layer first, then pick an effect.');
      return;
    }
    if (!groupsFor(layer.kind).includes('Effects')) {
      this.say('warn', `A ${layer.kind} layer takes no effects.`);
      return;
    }
    this.snapshot();
    this.patch(layer.id, (l) => ({
      ...l,
      effects: [...l.effects, makeEffect(name)],
    }));
    this.say('info', `Applied ${name} to ${layer.name}.`);
  };

  patchEffect(fxId, change) {
    this.patch(this.layer?.id, (l) => ({
      ...l,
      effects: l.effects.map((fx) => (fx.id === fxId ? change(fx) : fx)),
    }));
  }

  toggleEffect = (fxId) => {
    this.snapshot();
    this.patchEffect(fxId, (fx) => ({ ...fx, enabled: !fx.enabled }));
  };

  removeEffect = (fxId) => {
    this.snapshot();
    this.patch(this.layer?.id, (l) => ({
      ...l,
      effects: l.effects.filter((fx) => fx.id !== fxId),
    }));
  };

  moveEffect = (fxId, by) => {
    this.snapshot();
    this.patch(this.layer?.id, (l) => {
      const effects = [...l.effects];
      const index = effects.findIndex((fx) => fx.id === fxId);
      const to = index + by;
      if (index < 0 || to < 0 || to >= effects.length) return l;
      const [fx] = effects.splice(index, 1);
      effects.splice(to, 0, fx);
      return { ...l, effects };
    });
  };

  setParam = (fxId, index, value) => {
    this.patchEffect(fxId, (fx) => {
      if ((fx.tracks?.[index] ?? []).length)
        return putParamKey(fx, index, this.snap(this.timeMs), value);
      const values = [...fx.values];
      values[index] = value;
      return { ...fx, values };
    });
  };

  setParamChoice = (fxId, index, event) =>
    this.setParam(fxId, index, Number(event.target.value));

  paramStopwatch = (fxId, index) => {
    this.snapshot();
    this.patchEffect(fxId, (fx) =>
      toggleParamKeyed(fx, index, this.snap(this.timeMs)),
    );
  };

  setEffectColour = (fxId, index, value) => {
    this.snapshot();
    this.patchEffect(fxId, (fx) => {
      const colors = [...fx.colors];
      colors[index] = value;
      return { ...fx, colors };
    });
  };

  /* ---------------------------------------------------- timeline actions */

  setSpan = (id, inMs, outMs) => this.patch(id, { inMs, outMs });

  trimIn = (id, inMs, offsetMs) =>
    this.patch(id, { inMs, offsetMs: Math.max(0, offsetMs) });

  trimOut = (id, inMs, outMs, offsetMs) => {
    const layer = this.byId(id);
    const limit =
      layer && Number.isFinite(layer.sourceMs)
        ? inMs + (layer.sourceMs - offsetMs)
        : Infinity;
    this.patch(id, {
      outMs: Math.min(limit, Math.max(inMs + this.frameMs, outMs)),
    });
  };

  rowStopwatch = (row) => {
    this.snapshot();
    if (row.fxId)
      this.patchEffect(row.fxId, (fx) =>
        toggleParamKeyed(fx, row.paramIndex, this.snap(this.timeMs)),
      );
    else
      this.patch(row.layer.id, (l) =>
        toggleKeyed(l, row.prop, this.snap(this.timeMs)),
      );
  };

  rowToggleKey = (row) => {
    const at = this.snap(this.timeMs);
    this.snapshot();
    if (row.fxId) {
      this.patchEffect(row.fxId, (fx) => {
        const keys = fx.tracks?.[row.paramIndex] ?? [];
        const here = keys.find((k) => Math.abs(k.ms - at) <= 1);
        if (!here)
          return putParamKey(
            fx,
            row.paramIndex,
            at,
            paramAt(fx, row.paramIndex, at),
          );
        const tracks = { ...fx.tracks };
        tracks[row.paramIndex] = keys.filter((k) => k !== here);
        if (!tracks[row.paramIndex].length) delete tracks[row.paramIndex];
        return { ...fx, tracks };
      });
      return;
    }
    this.patch(row.layer.id, (l) =>
      keyAt(l, row.prop, at)
        ? dropKey(l, row.prop, at)
        : putKey(l, row.prop, at, valueAt(l, row.prop, at)),
    );
  };

  rowSetValue = (row, value) => {
    if (row.fxId) this.setParam(row.fxId, row.paramIndex, value);
    else this.setProp(row.layer.id, row.prop, value);
  };

  rowSetPair = (row, value) => {
    if (!row.pair) return;
    this.setProp(row.layer.id, row.pair, value);
  };

  rowSetEasing = (row, event) => {
    const easing = event.target.value;
    const at = this.snap(this.timeMs);
    this.snapshot();
    if (row.fxId) {
      this.patchEffect(row.fxId, (fx) => {
        const keys = (fx.tracks?.[row.paramIndex] ?? []).map((k) =>
          Math.abs(k.ms - at) <= 1 ? { ...k, easing } : k,
        );
        return { ...fx, tracks: { ...fx.tracks, [row.paramIndex]: keys } };
      });
      return;
    }
    this.patch(row.layer.id, (l) => {
      const key = keyAt(l, row.prop, at);
      return key ? putKey(l, row.prop, key.ms, key.value, easing) : l;
    });
  };

  selectKey = (row, ms, additive) => {
    const prop = row.fxId ? `fx:${row.fxId}:${row.paramIndex}` : row.prop;
    const entry = { layerId: row.layer.id, prop, ms };
    this.selectedKeys = additive ? [...this.selectedKeys, entry] : [entry];
    this.selectedIds = [row.layer.id];
  };

  clearKeySelection = () => (this.selectedKeys = []);

  moveKey = (row, from, to) => {
    if (row.fxId) {
      this.patchEffect(row.fxId, (fx) => {
        const keys = (fx.tracks?.[row.paramIndex] ?? [])
          .map((k) => (Math.abs(k.ms - from) <= 1 ? { ...k, ms: to } : k))
          .sort((a, b) => a.ms - b.ms);
        return { ...fx, tracks: { ...fx.tracks, [row.paramIndex]: keys } };
      });
    } else {
      this.patch(row.layer.id, (l) => {
        const key = keyAt(l, row.prop, from);
        if (!key) return l;
        return putKey(
          dropKey(l, row.prop, from),
          row.prop,
          to,
          key.value,
          key.easing,
        );
      });
    }
    this.selectedKeys = this.selectedKeys.map((s) =>
      s.ms === from ? { ...s, ms: to } : s,
    );
  };

  // A rubber band is one selection change when it is let go, not a stream.
  selectKeysIn = (band, map, rowAtFn) => {
    const from = Math.min(band.x0, band.x1);
    const to = Math.max(band.x0, band.x1);
    const first = rowAtFn(Math.min(band.y0, band.y1));
    const last = rowAtFn(Math.max(band.y0, band.y1));
    const picked = [];
    this.rows.forEach((row, index) => {
      if (index < first || index > last || row.kind !== 'prop') return;
      for (const key of row.keys) {
        const x = map.x(key.ms);
        if (x >= from && x <= to)
          picked.push({
            layerId: row.layer.id,
            prop: row.fxId ? `fx:${row.fxId}:${row.paramIndex}` : row.prop,
            ms: key.ms,
          });
      }
    });
    this.selectedKeys = picked;
  };

  // Dragging a handle in the Ease panel writes the keyframe's own curve. A
  // preset is a name; a bezier is four numbers, and once you have pulled a
  // handle the name no longer describes what the motion does.
  setKeyBezier = (bezier) => {
    const first = this.selectedKeys[0];
    if (!first || String(first.prop).startsWith('fx:')) return;
    this.patch(first.layerId, (l) => {
      const keys = keysFor(l, first.prop).map((k) =>
        Math.abs(k.ms - first.ms) <= 1 ? { ...k, bezier } : k,
      );
      return { ...l, tracks: { ...l.tracks, [first.prop]: keys } };
    });
  };

  clearKeyBezier = () => {
    const first = this.selectedKeys[0];
    if (!first || String(first.prop).startsWith('fx:')) return;
    this.snapshot();
    this.patch(first.layerId, (l) => {
      const keys = keysFor(l, first.prop).map((k) => {
        if (Math.abs(k.ms - first.ms) > 1) return k;
        const { bezier, ...rest } = k;
        void bezier;
        return rest;
      });
      return { ...l, tracks: { ...l.tracks, [first.prop]: keys } };
    });
  };

  setKeyEasing = (easing) => {
    const first = this.selectedKeys[0];
    if (!first) return;
    this.snapshot();
    if (String(first.prop).startsWith('fx:')) {
      const [, fxId, index] = String(first.prop).split(':');
      this.patchEffect(fxId, (fx) => ({
        ...fx,
        tracks: {
          ...fx.tracks,
          [index]: (fx.tracks[index] ?? []).map((k) =>
            k.ms === first.ms ? { ...k, easing } : k,
          ),
        },
      }));
      return;
    }
    this.patch(first.layerId, (l) => {
      const key = keyAt(l, first.prop, first.ms);
      return key ? putKey(l, first.prop, key.ms, key.value, easing) : l;
    });
  };

  deleteKeys = () => {
    if (!this.selectedKeys.length) return;
    this.snapshot();
    for (const s of this.selectedKeys) {
      if (String(s.prop).startsWith('fx:')) continue;
      this.patch(s.layerId, (l) => dropKey(l, s.prop, s.ms));
    }
    this.selectedKeys = [];
  };

  // Shuts every twirled-open group, the counterpart to `reveal`.
  collapseAll = () => {
    this.twirls = [];
  };

  reveal = (id) => {
    const which = REVEALS.find((r) => r.id === id);
    if (!which) return;
    const open = new Set(this.twirls);
    for (const layer of this.selection.length ? this.selection : this.layers) {
      if (which.id === 'effects') {
        open.add(layer.id);
        for (const fx of layer.effects) open.add(`${layer.id}/fx/${fx.id}`);
        continue;
      }
      if (which.id === 'animated') {
        if (!Object.keys(layer.tracks).length) continue;
        open.add(layer.id);
        for (const group of groupsFor(layer.kind))
          if (propsIn(layer.kind, group).some((p) => isKeyed(layer, p)))
            open.add(`${layer.id}/${group}`);
        continue;
      }
      const group = PROPS[which.props[0]]?.group;
      if (!groupsFor(layer.kind).includes(group)) continue;
      open.add(layer.id);
      open.add(`${layer.id}/${group}`);
    }
    this.twirls = [...open];
  };

  /* ----------------------------------------------------------- the view */

  setTool = (id) => (this.tool = id);

  setZoom = (value) => {
    this.zoom = value;
    this.panX = 0;
    this.panY = 0;
  };

  zoomStep = (by) => {
    this.zoom = Math.min(8, Math.max(0.05, this.effectiveZoom * by));
  };

  panBy = (dx, dy) => {
    this.panX += dx;
    this.panY += dy;
  };

  toggleSafe = () => {
    this.showSafe = !this.showSafe;
    this.paint();
  };

  toggleHandles = () => (this.showHandles = !this.showHandles);

  fitTimeView() {
    this.viewStartMs = 0;
    this.viewSpanMs = this.durationMs;
  }

  zoomTime = (by) => {
    const centre = this.timeMs;
    const span = Math.min(
      this.durationMs,
      Math.max(100, this.viewSpanMs * (by > 0 ? 0.6 : 1 / 0.6)),
    );
    this.viewSpanMs = span;
    this.viewStartMs = Math.max(0, centre - span / 2);
  };

  panTime = (by) =>
    (this.viewStartMs = Math.max(0, this.viewStartMs + by * this.viewSpanMs));

  centreView = (ms) =>
    (this.viewStartMs = Math.max(0, ms - this.viewSpanMs / 2));

  /* ---------------------------------------------------------- the clock */

  seek = (ms) => {
    this.timeMs = Math.min(this.durationMs, Math.max(0, ms));
    this.syncMedia();
    this.paint();
  };

  stepFrames = (by) => {
    this.pause();
    this.seek(this.snap(this.timeMs) + by * this.frameMs);
  };

  goToEnd = () => this.seek(this.durationMs);

  stop = () => {
    this.pause();
    this.seek(0);
  };

  toggleLoop = () => (this.looping = !this.looping);

  gotoKeyframe = (direction) => {
    const times = (this.selection.length ? this.selection : this.layers)
      .flatMap((l) => keyTimes(l))
      .sort((a, b) => a - b);
    if (!times.length) return;
    const now = this.timeMs;
    const next =
      direction > 0
        ? times.find((t) => t > now + 0.5)
        : [...times].reverse().find((t) => t < now - 0.5);
    if (next !== undefined) this.seek(next);
  };

  playPause = () => (this.playing ? this.pause() : this.play());

  play() {
    if (!this.layers.length) return;
    if (this.timeMs >= this.durationMs - this.frameMs) this.timeMs = 0;
    this.ensureAudio();
    this.playing = true;
    this.lastTick = performance.now();
    this.syncMedia();
    this.tick();
  }

  pause = () => {
    this.playing = false;
    for (const el of this.media.values()) if (el.pause) el.pause();
  };

  tick = () => {
    if (!this.playing) return;
    const now = performance.now();
    this.timeMs += now - this.lastTick;
    this.lastTick = now;
    if (this.timeMs >= this.durationMs) {
      if (this.looping) this.timeMs = 0;
      else {
        this.timeMs = this.durationMs;
        this.pause();
      }
    }
    this.syncMedia();
    this.paintNow();
    if (this.playing) this.frame = requestAnimationFrame(this.tick);
  };

  // Opens the sound graph and gives any clip that has not got one a gain node
  // feeding both the speakers and the recorder. Browsers will not start an
  // AudioContext without a gesture, so this is only called from one.
  ensureAudio() {
    try {
      if (!this.audio) {
        this.audio = new AudioContext();
        this.recordDest = this.audio.createMediaStreamDestination();
      }
      if (this.audio.state === 'suspended') this.audio.resume();
      for (const [id, el] of this.media)
        if (!(el instanceof Image) && !this.gains.has(id)) {
          const gain = this.audio.createGain();
          this.audio.createMediaElementSource(el).connect(gain);
          gain.connect(this.audio.destination);
          gain.connect(this.recordDest);
          this.gains.set(id, gain);
        }
    } catch {
      // No Web Audio: the clips still play through their own elements.
    }
  }

  // Puts every clip's media where the playhead is. Playing, a clip is left
  // running and only nudged when it has drifted; parked, it is seeked exactly.
  syncMedia() {
    for (const layer of this.layers) {
      const el = this.media.get(layer.id);
      if (!el || el instanceof Image) continue;
      const live =
        layer.visible && this.timeMs >= layer.inMs && this.timeMs < layer.outMs;
      if (!live) {
        if (!el.paused) el.pause();
        continue;
      }
      let local = (this.timeMs - layer.inMs + layer.offsetMs) / 1000;
      if (layer.loop && Number.isFinite(layer.sourceMs) && layer.sourceMs > 0)
        local %= layer.sourceMs / 1000;
      const level = Math.max(0, valueAt(layer, 'volume', this.timeMs) / 100);
      const gain = this.gains.get(layer.id);
      // Past 100% only the graph can help; an element's own volume stops there.
      if (gain) gain.gain.value = level;
      else el.volume = Math.min(1, level);
      if (this.playing) {
        if (Math.abs(el.currentTime - local) > 0.25) el.currentTime = local;
        if (el.paused) el.play().catch(() => {});
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - local) > 0.01) el.currentTime = local;
      }
    }
  }

  /* ----------------------------------------------------------- painting */

  paint() {
    if (this.playing) return;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(this.paintNow);
  }

  paintNow = () => {
    const stage = this.stage;
    if (stage && this.scene) {
      const raster = this.raster;
      if (stage.width !== raster.width) stage.width = raster.width;
      if (stage.height !== raster.height) stage.height = raster.height;
      drawScene(
        stage.getContext('2d'),
        this.scene,
        this.project.settings,
        this.timeMs,
        this.media,
        { safeAreas: this.showSafe, onNote: this.noteOnce },
      );
    }
    this.repaintTracks?.();
  };

  // A ResizeObserver that writes state which can change layout re-triggers
  // itself, and Chrome reports that as "loop completed with undelivered
  // notifications". So: measure, bail out if nothing actually moved, and do the
  // write in an animation frame, outside the observer's own delivery.
  measureStage = modifier((element) => {
    let pending = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        const width = Math.max(80, element.clientWidth - 40);
        const height = Math.max(80, element.clientHeight - 110);
        if (
          Math.abs(width - this.stageSize.width) < 1 &&
          Math.abs(height - this.stageSize.height) < 1
        )
          return;
        this.stageSize = { width, height };
      });
    });
    observer.observe(element);
    return () => {
      cancelAnimationFrame(pending);
      observer.disconnect();
    };
  });

  /* ---------------------------------------------------------- importing */

  addFiles = async (files) => {
    let at = this.snap(this.timeMs);
    for (const file of files) {
      const kind = kindOf(file);
      if (!kind) {
        this.say('warn', `${file.name} is not a picture, a clip or a sound.`);
        continue;
      }
      const url = URL.createObjectURL(file);
      this.urls.push(url);
      try {
        const { element, ms } = await loadMedia(kind, url);
        this.snapshot();
        const layer = makeLayer(kind, {
          name: baseName(file.name),
          src: file.name,
          inMs: at,
          outMs: at + ms,
          sourceMs: ms,
          loop: false,
        });
        this.media.set(layer.id, element);
        this.mutateScene((scene) => ({
          ...scene,
          layers: [layer, ...scene.layers],
          durationMs: Math.max(scene.durationMs, at + ms),
        }));
        this.selectedIds = [layer.id];
        at += ms;
        this.say('info', `Imported ${file.name}.`);
      } catch (error) {
        this.say('error', `${file.name}: ${error.message}`);
      }
    }
    this.fitTimeView();
    this.paint();
  };

  pickFiles = (event) => {
    this.addFiles([...event.target.files]);
    event.target.value = '';
  };

  replaceSource = async (event) => {
    const file = event.target.files?.[0];
    const layer = this.layer;
    if (!file || !layer) return;
    const url = URL.createObjectURL(file);
    this.urls.push(url);
    try {
      const { element, ms } = await loadMedia(kindOf(file), url);
      this.media.set(layer.id, element);
      this.snapshot();
      this.patch(layer.id, { src: file.name, sourceMs: ms });
    } catch (error) {
      this.say('error', `${file.name}: ${error.message}`);
    }
    event.target.value = '';
  };

  pasteFiles = (files) => this.addFiles(files);

  dragOver = (event) => {
    event.preventDefault();
    this.dragging = event.type === 'dragover';
  };

  drop = (event) => {
    event.preventDefault();
    this.dragging = false;
    this.addFiles([...(event.dataTransfer?.files ?? [])]);
  };

  /* ----------------------------------------------------------- the shell */

  toggleMenu = (menu) => (this.openMenu = this.openMenu === menu ? null : menu);

  closeMenu = () => (this.openMenu = null);

  // Menus advertise whatever the keymap says, so a rebound shortcut never
  // leaves a menu quoting the key it used to be.
  get menuRows() {
    switch (this.openMenu) {
      case 'File':
        return [
          { label: 'Start page', run: this.goHome },
          { label: 'New project', run: this.newProject },
          {
            label: 'Save in this browser',
            key: keyFor('save'),
            run: this.saveHere,
          },
          { label: 'Save to disk…', run: this.saveProject },
          {
            label: 'Open project file…',
            key: keyFor('open'),
            run: this.openProject,
          },
          { label: 'Import media…', run: this.browse },
          { label: 'Render…', key: keyFor('render'), run: this.openExport },
          {
            label: 'Keyboard shortcuts…',
            key: keyFor('open-settings'),
            run: this.openShortcuts,
          },
          { label: 'About this editor…', run: this.openAbout },
        ];
      case 'Edit':
        return [
          { label: 'Undo', key: keyFor('undo'), run: this.undo },
          { label: 'Redo', key: keyFor('redo'), run: this.redo },
          {
            label: 'Select all layers',
            key: keyFor('select-all'),
            run: this.selectAll,
          },
          {
            label: 'Deselect all',
            key: keyFor('deselect-all'),
            run: this.deselect,
          },
          {
            label: 'Duplicate selection',
            key: keyFor('duplicate-selected'),
            run: this.duplicateSelected,
          },
          {
            label: 'Delete selection',
            key: keyFor('delete-selected'),
            run: this.deleteSelected,
          },
          { label: 'Split at playhead', run: this.splitAtPlayhead },
          { label: 'Centre horizontally', run: this.alignHorizontal },
          { label: 'Centre vertically', run: this.alignVertical },
          {
            label: 'Centre anchor point',
            key: keyFor('centre-anchor'),
            run: this.centreAnchor,
          },
        ];
      case 'Scene':
        return [
          { label: 'New scene', key: keyFor('new-scene'), run: this.addScene },
          { label: 'New scene animation', run: this.addSceneAnimation },
          {
            label: 'Scene properties…',
            key: keyFor('scene-settings'),
            run: this.openSceneHere,
          },
          { label: 'Fit duration to keyframes', run: this.fitDuration },
          {
            label: 'Add marker at playhead',
            key: keyFor('add-marker'),
            run: this.addMarker,
          },
        ];
      case 'Layer':
        return this.layerMenuRows;
      case 'View':
        return [
          { label: 'Zoom to fit', key: keyFor('zoom-fit'), run: this.zoomFit },
          {
            label: 'Zoom to 100%',
            key: keyFor('zoom-actual'),
            run: this.zoomActual,
          },
          { label: 'Safe areas', tick: this.showSafe, run: this.toggleSafe },
          {
            label: 'Selection handles',
            tick: this.showHandles,
            run: this.toggleHandles,
          },
          {
            label: 'Bring forward',
            key: keyFor('bring-forward'),
            run: this.bringForward,
          },
          {
            label: 'Send backward',
            key: keyFor('send-backward'),
            run: this.sendBackward,
          },
          {
            label: 'Bring to front',
            key: keyFor('bring-front'),
            run: this.bringToFront,
          },
          {
            label: 'Send to back',
            key: keyFor('send-back'),
            run: this.sendToBack,
          },
        ];
      case 'Window':
        return this.panelList.map((p) => ({
          label: p.title,
          tick: !this.hidden.includes(p.id),
          panel: p.id,
        }));
      case 'Keys':
        return [
          ...ACTIONS.filter((a) => a.key)
            .slice(0, 16)
            .map((a) => ({ label: a.label, key: a.key })),
          {
            label: 'All shortcuts…',
            key: keyFor('open-settings'),
            run: this.openShortcuts,
          },
        ];
      default:
        return [];
    }
  }

  get layerMenuRows() {
    return Object.entries(KINDS).map(([id, k]) => ({
      label: k.label,
      kind: id,
    }));
  }

  runMenu = (row) => {
    this.openMenu = null;
    if (row.kind) this.addLayer(row.kind);
    else if (row.panel) this.togglePanel(row.panel);
    else row.run?.();
  };

  deselect = () => this.selectLayer(null);
  openSceneHere = () => this.openSceneDialog(null);
  zoomFit = () => this.setZoom('fit');
  zoomActual = () => this.setZoom(1);
  bringForward = () => this.restack(-1);
  sendBackward = () => this.restack(1);
  bringToFront = () => this.restack(-1, true);
  sendToBack = () => this.restack(1, true);

  togglePanel = (id) => {
    this.hidden = this.hidden.includes(id)
      ? this.hidden.filter((h) => h !== id)
      : [...this.hidden, id];
  };

  shows = (id) => !this.hidden.includes(id);

  tabsFor(side) {
    return this.panelList.filter((p) => p.side === side && this.shows(p.id));
  }

  get leftTabs() {
    return this.tabsFor('left');
  }

  get rightTabs() {
    return this.tabsFor('right');
  }

  get bottomTabs() {
    return this.tabsFor('bottom');
  }

  activeIn(side, chosen) {
    const tabs = this.tabsFor(side);
    return tabs.find((t) => t.id === chosen) ?? tabs[0] ?? null;
  }

  get leftPanel() {
    return this.activeIn('left', this.leftTab);
  }

  get rightPanel() {
    return this.activeIn('right', this.rightTab);
  }

  get bottomPanel() {
    return this.activeIn('bottom', this.bottomTab);
  }

  get showViewer() {
    return this.shows('viewer');
  }

  setTab = (side, id) => {
    if (side === 'left') this.leftTab = id;
    if (side === 'right') this.rightTab = id;
    if (side === 'bottom') this.bottomTab = id;
  };

  get leftStyle() {
    return htmlSafe(`width:${this.leftW}px`);
  }

  get rightStyle() {
    return htmlSafe(`width:${this.rightW}px`);
  }

  get bottomStyle() {
    return htmlSafe(`height:${this.bottomH}px`);
  }

  // A dock is a size the splitter drags. Ferrite keeps a whole rearrangeable
  // workspace; what earns its place here is being able to give the timeline
  // the room when the timeline is what you are working in.
  splitter = modifier((element, [which]) => {
    const down = (event) => {
      grabPointer(element, event);
      this.split = {
        which,
        x: event.clientX,
        y: event.clientY,
        from: this[which],
      };
    };
    const move = (event) => {
      const split = this.split;
      if (!split) return;
      const dx = event.clientX - split.x;
      const dy = event.clientY - split.y;
      if (split.which === 'leftW')
        this.leftW = Math.max(180, Math.min(520, split.from + dx));
      if (split.which === 'rightW')
        this.rightW = Math.max(180, Math.min(520, split.from - dx));
      if (split.which === 'bottomH')
        this.bottomH = Math.max(120, Math.min(700, split.from - dy));
    };
    const up = (event) => {
      freePointer(element, event);
      this.split = null;
    };
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
    return () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
    };
  });

  openShortcuts = () => {
    this.shortcutsOpen = true;
    this.openMenu = null;
  };

  closeShortcuts = () => (this.shortcutsOpen = false);

  openAbout = () => {
    this.aboutOpen = true;
    this.openMenu = null;
  };

  closeAbout = () => (this.aboutOpen = false);

  // The page carries no site chrome, so what the tool is built on has to be
  // reachable from inside it. Read from the registry rather than typed out
  // again here, so there is one copy of the attribution.
  get about() {
    return TOOL_REGISTRY.find((t) => t.route === 'video-editor') ?? null;
  }

  // The effect in flight, and where the cursor has got to with it.
  @tracked effectDrag = null;

  // A pick whip: the gesture whose meaning is entirely in the two points it
  // connects, so it has to draw the line between them. Without the wire the
  // drag is a chip floating over the panel with nothing to say where it came
  // from, and which row it will land on is anybody's guess.
  @tracked whip = null;

  startWhip = (kind, layerId, fromX, fromY) => {
    this.whip = { kind, layerId, fromX, fromY, x: fromX, y: fromY, over: null };
  };

  moveWhip = (x, y) => {
    if (!this.whip) return;
    this.whip = { ...this.whip, x, y, over: this.layerUnder(x, y) };
  };

  endWhip = (x, y) => {
    const whip = this.whip;
    this.whip = null;
    if (!whip) return;
    const onto = this.layerUnder(x, y);
    const layer = this.byId(whip.layerId);
    if (!layer) return;

    // Let go over nothing and the link is cleared, which is how you detach
    // without hunting for a "none" in a dropdown.
    if (!onto || onto === whip.layerId) {
      this.snapshot();
      this.patch(
        whip.layerId,
        whip.kind === 'parent' ? { parent: null } : { matte: 'none' },
      );
      return;
    }

    if (whip.kind === 'parent') {
      if (wouldLoop(this.layers, layer, onto)) {
        this.say('warn', 'That would make a layer its own parent.');
        return;
      }
      this.snapshot();
      this.patch(whip.layerId, { parent: onto });
      return;
    }

    // A matte is always the layer directly above the one it cuts out, so
    // linking one restacks it rather than leaving a setting that cannot apply.
    this.snapshot();
    this.mutateScene((scene) => {
      const layers = [...scene.layers];
      const matte = layers.find((l) => l.id === onto);
      layers.splice(layers.indexOf(matte), 1);
      const at = layers.findIndex((l) => l.id === whip.layerId);
      layers.splice(at, 0, matte);
      return {
        ...scene,
        layers: layers.map((l) =>
          l.id === whip.layerId ? { ...l, matte: 'alpha' } : l,
        ),
      };
    });
  };

  dragEffectTo = (name, x, y) => {
    this.effectDrag = { name, x, y, over: this.layerUnder(x, y) };
  };

  // Which layer row the cursor is over, by asking the document rather than by
  // tracking geometry the timeline would have to keep telling us about.
  layerUnder(x, y) {
    const row = document
      .elementFromPoint(x, y)
      ?.closest?.('.fr-trow.is-layer, .fr-stage');
    if (!row) return null;
    if (row.classList.contains('fr-stage')) return this.layer?.id ?? null;
    const index = [...row.parentElement.querySelectorAll('.fr-trow')].indexOf(
      row,
    );
    return this.rows[index]?.layer?.id ?? null;
  }

  dropEffect = (name, x, y) => {
    const onto = this.layerUnder(x, y);
    this.effectDrag = null;
    if (!onto) {
      this.say('warn', `Drop ${name} on a layer to apply it.`);
      return;
    }
    const was = this.selectedIds;
    this.selectedIds = [onto];
    this.addEffect(name);
    if (!was.includes(onto)) this.selectedIds = was.length ? was : [onto];
  };

  @tracked capturing = null;
  @tracked keySerial = 0;

  startCapture = (id) => (this.capturing = id);

  cancelCapture = () => (this.capturing = null);

  // While a row is armed, the next press becomes its shortcut. Modifier keys
  // on their own are ignored, or you could never bind anything with Ctrl in it.
  captureKey = (event) => {
    if (!this.capturing) return;
    event.preventDefault();
    event.stopPropagation();
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
    if (event.key === 'Escape') {
      this.capturing = null;
      return;
    }
    const displaced = rebind(this.capturing, pressLabel(event));
    this.capturing = null;
    // A shortcut that stops working without a word is the whole problem with
    // rebinding, so say which one lost its key.
    if (displaced) this.say('warn', `${displaced.label} lost that shortcut.`);
    this.keySerial += 1;
  };

  resetKeys = () => {
    resetBindings();
    this.capturing = null;
    this.keySerial += 1;
    this.say('info', 'Shortcuts back to their defaults.');
  };

  get shortcutGroups() {
    void this.keySerial;
    return KEY_GROUPS.map((group) => ({
      group,
      actions: ACTIONS.filter((a) => a.group === group).map((a) => ({
        ...a,
        binding: keyFor(a.id),
        capturing: this.capturing === a.id,
      })),
    })).filter((g) => g.actions.length);
  }

  newProject = () => {
    this.pause();
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls = [];
    this.media = new Map();
    this.gains = new Map();
    this.project = makeProject();
    this.sceneId = this.project.scenes[0].id;
    this.selectedIds = [];
    this.selectedKeys = [];
    this.twirls = [];
    this.timeMs = 0;
    this.history = [];
    this.future = [];
    this.say('info', 'New project.');
    this.paint();
  };

  /* ------------------------------------------------------ the start page */

  refreshRecents = () => (this.recents = listProjects());

  goHome = () => {
    this.pause();
    this.openMenu = null;
    this.refreshRecents();
    this.view = 'home';
  };

  // A new project from the start page, with the size and length it asked for,
  // rather than the 1080p/10s default `newProject` makes from a menu.
  startNew = ({ name, preset, durationMs }) => {
    this.dropMedia();
    this.project = freshProject({ name, preset, durationMs });
    this.adoptProject(`Started ${this.project.name}.`);
  };

  openStored = (id) => {
    const project = loadStored(id);
    if (!project) {
      this.say('error', 'That project is no longer in this browser.');
      this.refreshRecents();
      return;
    }
    this.dropMedia();
    this.project = project;
    this.projectId = id;
    this.adoptProject(`Opened ${project.name}.`);
  };

  forgetStored = (id) => {
    forgetProject(id);
    if (this.projectId === id) this.projectId = null;
    this.refreshRecents();
  };

  // Everything that has to be true after the project object is swapped: the
  // old selection, history and playhead all refer to layers that are gone.
  adoptProject(note) {
    this.sceneId = this.project.scenes[0]?.id ?? null;
    this.selectedIds = [];
    this.selectedKeys = [];
    this.twirls = [];
    this.timeMs = 0;
    this.inMs = null;
    this.outMs = null;
    this.history = [];
    this.future = [];
    this.view = 'editor';
    this.exportSettings = {
      ...this.exportSettings,
      fps: this.fps,
      toSec: this.durationMs / 1000,
      customW: this.raster.width,
      customH: this.raster.height,
      name: this.project.name || 'composition',
    };
    if (note) this.say('info', note);
    this.paint();
  }

  dropMedia() {
    this.pause();
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls = [];
    this.media = new Map();
    this.gains = new Map();
  }

  // "Save" on a web editor means the shelf in this browser; the file on disk
  // is a separate, louder verb. Both are in the File menu and the difference
  // is said on the start page, because it is the one that loses work.
  saveHere = () => {
    this.openMenu = null;
    this.projectId ??= `p-${Date.now().toString(36)}`;
    const ok = storeProject(this.projectId, this.project);
    this.refreshRecents();
    this.say(
      ok ? 'info' : 'error',
      ok
        ? `Saved ${this.project.name} in this browser.`
        : 'This browser has no room left. Save to disk instead.',
    );
  };

  browse = () => this.fileInput?.click();

  bindFileInput = modifier((element) => {
    this.fileInput = element;
    return () => (this.fileInput = null);
  });

  /* ---------------------------------------------------------- the keymap */

  keys = modifier((element) => {
    const handler = (event) => {
      if (this.busy) return;
      // A shortcut must never fire while somebody is typing a layer name.
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName))
        return;
      const action = actionFor(event);
      const run = action && this.actionRunners[action.id];
      if (!run) return;
      event.preventDefault();
      run();
    };
    element.addEventListener('keydown', handler);
    return () => element.removeEventListener('keydown', handler);
  });

  get actionRunners() {
    const nudge = (dx, dy) => () => {
      const layer = this.layer;
      if (!layer) return;
      this.snapshot();
      if (dx) this.setSelectedProp('x', this.valueOf(layer, 'x') + dx);
      if (dy) this.setSelectedProp('y', this.valueOf(layer, 'y') + dy);
    };
    return {
      'play-pause': this.playPause,
      stop: this.stop,
      'go-start': () => this.seek(0),
      'go-end': this.goToEnd,
      'step-forward': () => this.stepFrames(1),
      'step-back': () => this.stepFrames(-1),
      'step-forward-10': () => this.stepFrames(10),
      'step-back-10': () => this.stepFrames(-10),
      'next-key': () => this.gotoKeyframe(1),
      'prev-key': () => this.gotoKeyframe(-1),
      'add-marker': this.addMarker,
      'toggle-loop': this.toggleLoop,
      'tool-select': () => this.setTool('select'),
      'tool-hand': () => this.setTool('hand'),
      'tool-rotate': () => this.setTool('rotate'),
      'tool-anchor': () => this.setTool('anchor'),
      'reveal-position': () => this.reveal('x'),
      'reveal-scale': () => this.reveal('scale'),
      'reveal-rotation': () => this.reveal('rotation'),
      'reveal-opacity': () => this.reveal('opacity'),
      'reveal-anchor': () => this.reveal('anchor'),
      'reveal-animated': () => this.reveal('animated'),
      'reveal-effects': () => this.reveal('effects'),
      'reveal-all': this.collapseAll,
      'nudge-left': nudge(-1, 0),
      'nudge-right': nudge(1, 0),
      'nudge-up': nudge(0, -1),
      'nudge-down': nudge(0, 1),
      'nudge-left-10': nudge(-10, 0),
      'nudge-right-10': nudge(10, 0),
      'nudge-up-10': nudge(0, -10),
      'nudge-down-10': nudge(0, 10),
      'zoom-in': () => this.zoomStep(1.25),
      'zoom-out': () => this.zoomStep(0.8),
      'zoom-fit': this.zoomFit,
      'zoom-actual': this.zoomActual,
      'toggle-safe': this.toggleSafe,
      'select-all': this.selectAll,
      'deselect-all': this.deselect,
      'delete-selected': () =>
        this.selectedKeys.length ? this.deleteKeys() : this.deleteSelected(),
      'duplicate-selected': this.duplicateSelected,
      'centre-anchor': this.centreAnchor,
      'align-h': this.alignHorizontal,
      'align-v': this.alignVertical,
      'new-box': () => this.addLayer('box'),
      'new-text': () => this.addLayer('text'),
      'slide-in': () => this.slideTo('in'),
      'slide-out': () => this.slideTo('out'),
      'trim-in': () => this.trimToPlayhead('in'),
      'trim-out': () => this.trimToPlayhead('out'),
      'bring-forward': this.bringForward,
      'send-backward': this.sendBackward,
      'bring-front': this.bringToFront,
      'send-back': this.sendToBack,
      'fit-to-scene': this.fitToScene,
      'centre-in-scene': () => {
        this.alignHorizontal();
        this.alignVertical();
      },
      undo: this.undo,
      redo: this.redo,
      'new-scene': this.addScene,
      'scene-settings': this.openSceneHere,
      'fit-duration': this.fitDuration,
      'open-settings': this.openShortcuts,
      save: this.saveHere,
      'save-as': this.saveProject,
      open: this.openProject,
      home: this.goHome,
      'go-in': () => this.inMs !== null && this.seek(this.inMs),
      'go-out': () => this.outMs !== null && this.seek(this.outMs),
      'set-in': this.setWorkIn,
      'set-out': this.setWorkOut,
      // ── the timeline
      'scroll-left': () => this.panTime(-0.25),
      'scroll-right': () => this.panTime(0.25),
      'time-zoom-in': () => this.zoomTime(1),
      'time-zoom-out': () => this.zoomTime(-1),
      'time-fit': this.fitTimeViewAction,
      'time-zoom-selection': this.zoomToSelection,
      'next-marker': () => this.gotoMarker(1),
      'prev-marker': () => this.gotoMarker(-1),
      'split-at-playhead': this.splitAtPlayhead,
      'delete-keys': this.deleteKeys,
      'ease-in-out': () => this.easeSelectedKeys('ease-in-out'),
      'ease-linear': () => this.easeSelectedKeys('linear'),
      'ease-hold': () => this.easeSelectedKeys('hold'),
      'toggle-handles': this.toggleHandles,
      'toggle-theme': this.toggleTheme,
      'select-next': () => this.stepSelection(1),
      'select-prev': () => this.stepSelection(-1),
      render: this.render,
    };
  }

  setWorkIn = () => {
    this.inMs = this.snap(this.timeMs);
    if (this.outMs !== null && this.outMs <= this.inMs) this.outMs = null;
    this.say('info', `Work area starts at ${timecode(this.inMs, this.fps)}.`);
  };

  setWorkOut = () => {
    this.outMs = this.snap(this.timeMs);
    if (this.inMs !== null && this.inMs >= this.outMs) this.inMs = null;
    this.say('info', `Work area ends at ${timecode(this.outMs, this.fps)}.`);
  };

  clearWorkArea = () => {
    this.inMs = null;
    this.outMs = null;
  };

  // Saving is a file, because there is no server to keep a project on and a
  // browser's storage is not somewhere anybody should trust a day's work to.
  saveProject = () => {
    saveAs(this.project);
    this.say('info', `Saved ${this.project.name || 'project'}.woogi.json.`);
    this.openMenu = null;
  };

  openProject = () => {
    this.projectInput?.click();
    this.openMenu = null;
  };

  bindProjectInput = modifier((element) => {
    this.projectInput = element;
    return () => (this.projectInput = null);
  });

  loadProject = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const project = readProjectFile(await file.text());
      this.dropMedia();
      this.project = project;
      // A file is not the shelf: saving it in the browser afterwards makes a
      // new entry rather than writing over whichever one was open before.
      this.projectId = null;
      // The media itself is not in the file (a project is the edit, not the
      // footage), so any clip has to be pointed at its file again.
      const clips = project.scenes
        .flatMap((sc) => sc.layers)
        .filter((l) => l.src).length;
      this.adoptProject(
        clips
          ? `Opened. ${clips} clip(s) need their files re-linked: select each and use Browse.`
          : `Opened ${project.name}.`,
      );
      if (clips) this.say('warn', `${clips} clip(s) need their files again.`);
      this.fitTimeView();
    } catch (error) {
      this.say('error', `Could not open that: ${error.message}`);
      this.refreshRecents();
    }
  };

  fitTimeViewAction = () => {
    this.fitTimeView();
    this.repaintTracks?.();
  };

  // Zoom the visible span onto the selected layers, which is the fastest way
  // to get from a ten-minute edit to the two seconds you are working on.
  zoomToSelection = () => {
    const chosen = this.selection.length ? this.selection : this.layers;
    if (!chosen.length) return;
    const from = Math.min(...chosen.map((l) => l.inMs));
    const to = Math.max(...chosen.map((l) => l.outMs));
    const pad = Math.max(100, (to - from) * 0.05);
    this.viewSpanMs = Math.max(100, to - from + pad * 2);
    this.viewStartMs = Math.max(0, from - pad);
    this.repaintTracks?.();
  };

  gotoMarker = (direction) => {
    const times = this.markers.map((m) => m.ms).sort((a, b) => a - b);
    if (!times.length) return;
    const now = this.timeMs;
    const next =
      direction > 0
        ? times.find((t) => t > now + 0.5)
        : [...times].reverse().find((t) => t < now - 0.5);
    if (next !== undefined) this.seek(next);
  };

  stepSelection = (by) => {
    if (!this.layers.length) return;
    const at = this.layers.findIndex((l) => l.id === this.selectedIds[0]);
    const to = Math.max(0, Math.min(this.layers.length - 1, at + by));
    this.selectLayer(this.layers[to].id);
  };

  // The easing shortcuts work on whatever keyframes are selected, which is how
  // you ease a dozen of them at once rather than one dropdown at a time.
  easeSelectedKeys = (easing) => {
    if (!this.selectedKeys.length) {
      this.say('warn', 'Select some keyframes on the timeline first.');
      return;
    }
    this.snapshot();
    for (const s of this.selectedKeys) {
      if (String(s.prop).startsWith('fx:')) {
        const [, fxId, index] = String(s.prop).split(':');
        this.patchEffect(fxId, (fx) => ({
          ...fx,
          tracks: {
            ...fx.tracks,
            [index]: (fx.tracks[index] ?? []).map((k) =>
              k.ms === s.ms ? { ...k, easing } : k,
            ),
          },
        }));
        continue;
      }
      this.patch(s.layerId, (l) => {
        const key = keyAt(l, s.prop, s.ms);
        return key ? putKey(l, s.prop, key.ms, key.value, easing) : l;
      });
    }
    this.say('info', `${this.selectedKeys.length} keyframe(s) eased.`);
  };

  slideTo = (edge) => {
    const layer = this.layer;
    if (!layer) return;
    this.snapshot();
    const at = this.snap(this.timeMs);
    const span = layer.outMs - layer.inMs;
    if (edge === 'in') this.setSpan(layer.id, at, at + span);
    else this.setSpan(layer.id, Math.max(0, at - span), at);
  };

  trimToPlayhead = (edge) => {
    const layer = this.layer;
    if (!layer) return;
    this.snapshot();
    const at = this.snap(this.timeMs);
    if (edge === 'in') {
      const inMs = Math.min(at, layer.outMs - this.frameMs);
      this.trimIn(layer.id, inMs, layer.offsetMs + (inMs - layer.inMs));
    } else {
      this.trimOut(
        layer.id,
        layer.inMs,
        Math.max(at, layer.inMs + this.frameMs),
        layer.offsetMs,
      );
    }
  };

  /* ----------------------------------------------------------- the render */

  // Where Ferrite hands a frame to an output, this writes a file. The whole
  // scene is played through once onto an offscreen canvas while MediaRecorder
  // writes it, with every clip's sound mixed through the same Web Audio graph
  // the preview uses.
  /* ------------------------------------------------------ the render queue */

  openExport = () => {
    this.openMenu = null;
    if (!this.layers.length) {
      this.say('warn', 'There is nothing in the composition to render.');
      return;
    }
    this.pause();
    this.exportSettings = {
      ...this.exportSettings,
      fps: this.exportSettings.fps || this.fps,
      name: this.exportSettings.name || this.scene?.name || 'composition',
    };
    this.showExport = true;
  };

  closeExport = () => {
    if (this.busy) return;
    this.showExport = false;
  };

  // Every field on the modal comes back through here, because they differ only
  // in which key they set and whether the value is a number, a checkbox or a
  // string.
  setExport = (field, event) => {
    const el = event.target;
    const value =
      el.type === 'checkbox'
        ? el.checked
        : el.type === 'number'
          ? Number(el.value)
          : el.value;
    const patch = { [field]: value };
    if (field === 'alpha') patch.alpha = value === 'rgba';
    if (field === 'fps') patch.fps = Math.max(1, Math.min(120, value || 1));
    this.exportSettings = { ...this.exportSettings, ...patch };
    // A format that cannot do the engine currently chosen moves the engine,
    // rather than leaving the panel describing a render it will not do.
    const def = formatById(this.exportSettings.format);
    if (!def.engines.includes(this.exportSettings.engine))
      this.exportSettings = { ...this.exportSettings, engine: def.engines[0] };
    if (!def.alpha && this.exportSettings.alpha)
      this.exportSettings = { ...this.exportSettings, alpha: false };
  };

  setEngine = (id) =>
    (this.exportSettings = { ...this.exportSettings, engine: id });

  useCompFps = () =>
    (this.exportSettings = { ...this.exportSettings, fps: this.fps });

  // The settings, the comp they are for, and the span they work out to, in
  // one object, so the panel and the renderer cannot disagree about any of it.
  get exportOptions() {
    const raster = this.raster;
    return {
      ...this.exportSettings,
      width: raster.width,
      height: raster.height,
      ...this.exportSpan,
    };
  }

  get exportFromSec() {
    return this.exportSettings.fromSec;
  }

  get exportToSec() {
    return this.exportSettings.toSec;
  }

  // The span three ways: the comp, the work area, or the two numbers typed in.
  get exportSpan() {
    const o = this.exportSettings;
    if (o.span === 'work')
      return {
        fromMs: this.inMs ?? 0,
        toMs: this.outMs ?? this.durationMs,
      };
    if (o.span === 'custom')
      return {
        fromMs: Math.max(0, o.fromSec * 1000),
        toMs: Math.max(o.fromSec * 1000 + 1, o.toSec * 1000),
      };
    return { fromMs: 0, toMs: this.durationMs };
  }

  get resultWeight() {
    return formatBytes(this.resultSize);
  }

  get resultName() {
    const o = this.exportSettings;
    return `${o.name || this.scene?.name || 'composition'}.${this.resultExt}`;
  }

  cancelRender = () => {
    this.aborter?.abort();
    this.say('warn', 'Stopping after this frame…');
  };

  // Settling the footage on a time and waiting for it to actually be there.
  //
  // `syncMedia` sets `currentTime` and returns; the frame at that time arrives
  // later. Drawing before it lands is how a frame-accurate render ends up
  // holding the previous frame's picture, which is worse than an inexact one
  // because it looks fine until you step through it.
  seekMediaTo = async (ms) => {
    this.timeMs = ms;
    this.syncMedia();
    const waits = [];
    for (const el of this.media.values()) {
      if (!el || el instanceof Image || el.readyState >= 3) continue;
      waits.push(
        new Promise((resolve) => {
          const done = () => {
            el.removeEventListener('seeked', done);
            el.removeEventListener('canplay', done);
            resolve();
          };
          el.addEventListener('seeked', done, { once: true });
          el.addEventListener('canplay', done, { once: true });
          // Footage that will not seek must not hang the whole render.
          setTimeout(done, 400);
        }),
      );
    }
    await Promise.all(waits);
  };

  render = async () => {
    if (!this.layers.length || this.busy) return;
    this.pause();
    this.openMenu = null;
    if (!this.showExport) {
      this.openExport();
      return;
    }
    this.busy = true;
    this.progress = 0;
    this.status = 'Getting ready…';
    if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
    this.resultUrl = null;
    this.aborter = new AbortController();

    const o = this.exportOptions;
    const wasTime = this.timeMs;

    this.ensureAudio();

    try {
      const { blob, ext } = await renderOut({
        ...o,
        signal: this.aborter.signal,
        audioTracks: this.recordDest?.stream.getAudioTracks() ?? [],
        seekTo: this.seekMediaTo,
        drawAt: (ctx, ms) => {
          this.timeMs = ms;
          if (o.engine === 'live') this.syncMedia();
          drawScene(ctx, this.scene, this.project.settings, ms, this.media, {
            noEffects: !o.effects,
            noMotionBlur: !o.motionBlur,
            ignoreSolo: o.soloOff,
            onNote: this.noteOnce,
          });
        },
        onProgress: (v) => (this.progress = v),
        onStatus: (text) => (this.status = text),
      });
      this.resultExt = ext;
      this.resultUrl = URL.createObjectURL(blob);
      this.resultSize = blob.size;
      this.say('info', `Wrote ${formatBytes(blob.size)} of ${ext}.`);
    } catch (error) {
      this.say('error', error.message ?? 'The render failed.');
    } finally {
      this.aborter = null;
      this.busy = false;
      this.status = '';
      this.progress = 0;
      this.timeMs = wasTime;
      this.syncMedia();
      this.paint();
    }
  };

  get exportSize() {
    return sizeFor(this.exportOptions);
  }

  toggleTheme = () => {
    this.settings.toggleTheme();
    // Every canvas reads its colours off the page, so they are all now stale.
    forgetPalette();
    this.paint();
  };

  get onHome() {
    return this.view === 'home';
  }

  get statusText() {
    const count = this.layers.length;
    const gpu = hasGpu() ? 'GPU effects' : 'no WebGL2, shader effects off';
    return `${count} layer${count === 1 ? '' : 's'} · ${this.rasterLabel} · ${this.timecodeEnd} · ${gpu}`;
  }

  <template>
    {{! template-lint-disable no-pointer-down-event-binding }}
    {{pageTitle "Video Editor"}}
    <div
      class="fr {{if this.dragging 'is-dragging'}}"
      tabindex="-1"
      {{this.keys}}
      {{acceptPastedFiles this.pasteFiles}}
      {{on "dragover" this.dragOver}}
      {{on "dragleave" this.dragOver}}
      {{on "drop" this.drop}}
    >
      <input
        type="file"
        class="sr-only"
        accept="video/*,audio/*,image/*"
        multiple
        aria-label="Import media"
        {{this.bindFileInput}}
        {{on "change" this.pickFiles}}
      />
      <input
        type="file"
        class="sr-only"
        accept=".json,application/json"
        aria-label="Open a project file"
        {{this.bindProjectInput}}
        {{on "change" this.loadProject}}
      />

      {{#if this.onHome}}
        <StartPage @editor={{this}} />
      {{else}}

        <div class="fr-menubar">
          <LinkTo @route="index" class="fr-brand" title="Back to Woogi Tools">
            <img src="/icon_expanded.png" alt="Woogi Tools" />
          </LinkTo>
          {{#each this.menus as |menu|}}
            <button
              type="button"
              class="fr-menu-btn {{if (eq this.openMenu menu) 'is-open'}}"
              data-menu={{menu}}
              {{on "click" (fn this.toggleMenu menu)}}
            >{{menu}}</button>
          {{/each}}
          <span class="fr-spacer"></span>
          <span class="fr-faint">{{this.project.name}}</span>
          <button
            type="button"
            class="fr-icon-btn"
            aria-label="Switch to {{if
              this.settings.isDark
              'light'
              'dark'
            }} mode"
            title="Switch theme"
            {{on "click" this.toggleTheme}}
          ><Icon
              @name={{if this.settings.isDark "moon" "sun"}}
              @size={{13}}
            /></button>
        </div>

        <div class="fr-toolbar">
          <button type="button" class="fr-btn" {{on "click" this.browse}}>
            <Icon @name="plus" @size={{12}} />
            Import</button>
          <span class="fr-sep"></span>
          {{#each this.quickLayers key="kind" as |q|}}
            <button
              type="button"
              class="fr-icon-btn"
              title="New {{q.label}} layer"
              aria-label="New {{q.label}} layer"
              {{on "click" (fn this.addLayer q.kind)}}
            ><Icon @name={{q.icon}} @size={{13}} /></button>
          {{/each}}
          <span class="fr-sep"></span>
          {{#each this.tools key="id" as |t|}}
            <button
              type="button"
              class="fr-icon-btn {{if (eq this.tool t.id) 'is-on'}}"
              title="{{t.label}} ({{t.key}})"
              aria-label={{t.label}}
              {{on "click" (fn this.setTool t.id)}}
            ><Icon @name={{t.icon}} @size={{13}} /></button>
          {{/each}}
          <span class="fr-sep"></span>
          <button
            type="button"
            class="fr-icon-btn"
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            disabled={{not this.history.length}}
            {{on "click" this.undo}}
          ><Icon @name="undo-2" @size={{13}} /></button>
          <button
            type="button"
            class="fr-icon-btn"
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
            disabled={{not this.future.length}}
            {{on "click" this.redo}}
          ><Icon @name="rotate-cw" @size={{13}} /></button>
          <span class="fr-sep"></span>
          <button
            type="button"
            class="fr-icon-btn"
            title="Split at playhead"
            aria-label="Split at playhead"
            {{on "click" this.splitAtPlayhead}}
          ><Icon @name="scissors" @size={{13}} /></button>
          <button
            type="button"
            class="fr-icon-btn"
            title="Add marker (M)"
            aria-label="Add marker"
            {{on "click" this.addMarker}}
          ><Icon @name="flag" @size={{13}} /></button>
          <span class="fr-spacer"></span>
          <button
            type="button"
            class="fr-btn is-accent"
            data-open-export
            disabled={{this.busy}}
            {{on "click" this.openExport}}
          ><Icon @name="download" @size={{12}} />
            {{if this.busy "Rendering…" "Render"}}</button>
        </div>
        {{#if this.busy}}
          <div class="fr-progress"><div
              class="fr-progress-bar"
              style={{pct this.progress}}
            ></div></div>
        {{/if}}

        <div class="fr-body">

          <div class="fr-docks">
            <div class="fr-middle">
              {{#if this.leftTabs.length}}
                <section class="fr-dock" style={{this.leftStyle}}>
                  <div class="fr-tabs-strip">
                    {{#each this.leftTabs key="id" as |t|}}
                      <button
                        type="button"
                        class="fr-tab
                          {{if (eq this.leftPanel.id t.id) 'is-on'}}"
                        {{on "click" (fn this.setTab "left" t.id)}}
                      >{{t.title}}</button>
                    {{/each}}
                  </div>
                  {{#let this.leftPanel.component as |Panel|}}
                    <Panel @editor={{this}} />
                  {{/let}}
                </section>
                <div
                  class="fr-split-v"
                  role="separator"
                  aria-label="Resize the left dock"
                  {{this.splitter "leftW"}}
                ></div>
              {{/if}}

              <section class="fr-centre" {{this.measureStage}}>
                {{#if this.showViewer}}
                  <ViewerPanel @editor={{this}} />
                {{/if}}
              </section>

              {{#if this.rightTabs.length}}
                <div
                  class="fr-split-v"
                  role="separator"
                  aria-label="Resize the right dock"
                  {{this.splitter "rightW"}}
                ></div>
                <section class="fr-dock" style={{this.rightStyle}}>
                  <div class="fr-tabs-strip">
                    {{#each this.rightTabs key="id" as |t|}}
                      <button
                        type="button"
                        class="fr-tab
                          {{if (eq this.rightPanel.id t.id) 'is-on'}}"
                        {{on "click" (fn this.setTab "right" t.id)}}
                      >{{t.title}}</button>
                    {{/each}}
                  </div>
                  {{#let this.rightPanel.component as |Panel|}}
                    <Panel @editor={{this}} />
                  {{/let}}
                </section>
              {{/if}}
            </div>

            {{#if this.bottomTabs.length}}
              <div
                class="fr-split-h"
                role="separator"
                aria-label="Resize the bottom dock"
                {{this.splitter "bottomH"}}
              ></div>
              <section class="fr-dock is-bottom" style={{this.bottomStyle}}>
                <div class="fr-tabs-strip">
                  {{#each this.bottomTabs key="id" as |t|}}
                    <button
                      type="button"
                      class="fr-tab
                        {{if (eq this.bottomPanel.id t.id) 'is-on'}}"
                      {{on "click" (fn this.setTab "bottom" t.id)}}
                    >{{t.title}}</button>
                  {{/each}}
                </div>
                {{#let this.bottomPanel.component as |Panel|}}
                  <Panel @editor={{this}} />
                {{/let}}
              </section>
            {{/if}}
          </div>
        </div>

        <div class="fr-status">
          <span>{{this.scene.name}}</span>
          <span class="fr-faint">{{this.statusText}}</span>
          <span class="fr-spacer"></span>
          <span class="fr-faint">{{this.status}}</span>
          {{#if this.notice}}
            <span class="fr-notice is-{{this.notice.level}}">
              {{this.notice.text}}
              <button
                type="button"
                class="fr-icon-btn"
                aria-label="Dismiss"
                {{on "click" this.clearNotice}}
              ><Icon @name="x" @size={{10}} /></button>
            </span>
          {{else}}
            <span class="fr-faint">Drop media anywhere</span>
          {{/if}}
        </div>

        {{#if this.whip}}
          <svg class="fr-whip" aria-hidden="true">
            <line
              x1={{this.whip.fromX}}
              y1={{this.whip.fromY}}
              x2={{this.whip.x}}
              y2={{this.whip.y}}
            />
            <circle cx={{this.whip.fromX}} cy={{this.whip.fromY}} r="3" />
            <circle cx={{this.whip.x}} cy={{this.whip.y}} r="4" />
          </svg>
        {{/if}}

        {{#if this.effectDrag}}
          <div class="fr-drag-chip" style={{chipAt this.effectDrag}}>
            {{this.effectDrag.name}}
            {{#unless this.effectDrag.over}}
              <span class="fr-faint">or drop on a layer</span>
            {{/unless}}
          </div>
        {{/if}}

        {{#if this.openMenu}}
          <button
            type="button"
            class="fr-backdrop"
            aria-label="Close menu"
            {{on "click" this.closeMenu}}
          ></button>
          <div class="fr-menu">
            {{#each this.menuRows as |row|}}
              <button
                type="button"
                class="fr-menu-row"
                data-row={{slug row.label}}
                {{on "click" (fn this.runMenu row)}}
              >
                {{#if row.tick}}<Icon @name="check" @size={{10}} />{{else}}<i
                    class="fr-tick-gap"
                  ></i>{{/if}}
                <span>{{row.label}}</span>
                <span class="fr-spacer"></span>
                <span class="fr-faint">{{row.key}}</span>
              </button>
            {{/each}}
          </div>
        {{/if}}

        {{#if this.sceneDialog}}
          <div class="fr-modal-wrap">
            <button
              type="button"
              class="fr-backdrop"
              aria-label="Close"
              {{on "click" this.closeSceneDialog}}
            ></button>
            <div class="fr-modal">
              <div class="fr-modal-head">Scene properties<span
                  class="fr-spacer"
                ></span>
                <button
                  type="button"
                  class="fr-icon-btn"
                  aria-label="Close"
                  {{on "click" this.closeSceneDialog}}
                ><Icon @name="x" @size={{12}} /></button></div>
              <div class="fr-row"><span class="fr-label">Name</span>
                <input
                  type="text"
                  class="fr-field"
                  value={{this.scene.name}}
                  aria-label="Scene name"
                  {{on "change" (fn this.setSceneField "name")}}
                /></div>
              <div class="fr-row"><span class="fr-label">Duration (ms)</span>
                <input
                  type="number"
                  class="fr-field"
                  value={{this.scene.durationMs}}
                  aria-label="Duration in milliseconds"
                  {{on "change" (fn this.setSceneField "durationMs")}}
                /></div>
              <div class="fr-row"><span class="fr-label">Resolution</span>
                <select
                  class="fr-field"
                  aria-label="Resolution"
                  {{on "change" this.setSceneSize}}
                >
                  {{#each this.sizes as |s i|}}
                    <option value={{i}}>{{s.label}}
                      ({{s.width}}×{{s.height}})</option>
                  {{/each}}
                </select></div>
              <div class="fr-row"><span class="fr-label">Frame rate</span>
                <input
                  type="number"
                  class="fr-field"
                  value={{this.fps}}
                  aria-label="Frame rate"
                  {{on "change" (fn this.setSceneField "fps")}}
                /></div>
              <div class="fr-row"><span class="fr-label">Background</span>
                <input
                  type="text"
                  class="fr-field fr-mono"
                  placeholder="transparent"
                  value={{this.scene.background}}
                  aria-label="Background"
                  {{on "change" (fn this.setSceneField "background")}}
                /></div>
              <div class="fr-row"><span class="fr-label">Shutter</span>
                <input
                  type="number"
                  class="fr-field"
                  value={{this.scene.shutterAngle}}
                  aria-label="Shutter angle in degrees"
                  {{on "change" (fn this.setSceneField "shutterAngle")}}
                /></div>
              <p class="fr-hint">A scene that has never been told otherwise
                follows the project's raster and rate, so a vertical cut-down
                can live in the same project as the wide version it was made
                from.</p>
            </div>
          </div>
        {{/if}}

        {{#if this.shortcutsOpen}}
          <div class="fr-modal-wrap">
            <button
              type="button"
              class="fr-backdrop"
              aria-label="Close"
              {{on "click" this.closeShortcuts}}
            ></button>
            {{! template-lint-disable no-invalid-interactive }}
            <div
              class="fr-modal is-wide"
              tabindex="-1"
              {{on "keydown" this.captureKey}}
            >
              <div class="fr-modal-head">Keyboard shortcuts<span
                  class="fr-spacer"
                ></span>
                <button
                  type="button"
                  class="fr-icon-btn"
                  aria-label="Close"
                  {{on "click" this.closeShortcuts}}
                ><Icon @name="x" @size={{12}} /></button></div>
              <div class="fr-keys-bar">
                <span class="fr-faint">Click a shortcut, then press the keys you
                  want. Escape cancels.</span>
                <span class="fr-spacer"></span>
                <button
                  type="button"
                  class="fr-btn"
                  {{on "click" this.resetKeys}}
                >Reset all</button>
              </div>
              <div class="fr-keys">
                {{#each this.shortcutGroups key="group" as |g|}}
                  <div class="fr-keys-group">
                    <div class="fr-cat">{{g.group}}</div>
                    {{#each g.actions key="id" as |a|}}
                      <div class="fr-key-row">
                        <span>{{a.label}}</span>
                        <button
                          type="button"
                          class="fr-key-btn {{if a.capturing 'is-capturing'}}"
                          aria-label="Change the shortcut for {{a.label}}"
                          {{on "click" (fn this.startCapture a.id)}}
                        >{{#if a.capturing}}Press a key…{{else if
                            a.binding
                          }}{{a.binding}}{{else}}-{{/if}}</button>
                      </div>
                    {{/each}}
                  </div>
                {{/each}}
              </div>
            </div>
          </div>
        {{/if}}

        {{#if this.aboutOpen}}
          <div class="fr-modal-wrap">
            <button
              type="button"
              class="fr-backdrop"
              aria-label="Close"
              {{on "click" this.closeAbout}}
            ></button>
            <div class="fr-modal">
              <div class="fr-modal-head">About this editor<span
                  class="fr-spacer"
                ></span>
                <button
                  type="button"
                  class="fr-icon-btn"
                  aria-label="Close"
                  {{on "click" this.closeAbout}}
                ><Icon @name="x" @size={{12}} /></button></div>
              <div class="fr-about">
                <p>{{this.about.madeWith}}</p>
                {{#each this.about.credits key="name" as |credit|}}
                  <div class="fr-credit">
                    <strong>{{credit.name}}</strong>
                    <span>by {{credit.author}} · {{credit.license}}</span>
                    <a
                      href={{credit.url}}
                      target="_blank"
                      rel="noopener noreferrer"
                    >{{credit.url}}</a>
                  </div>
                {{/each}}
                <p><LinkTo @route="index">Back to Woogi Tools</LinkTo></p>
              </div>
            </div>
          </div>
        {{/if}}

        {{#if this.showExport}}
          <ExportModal @editor={{this}} />
        {{/if}}
      {{/if}}
    </div>
  </template>
}
