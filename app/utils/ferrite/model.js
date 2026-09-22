// Ferrite's scene model, rewritten for the browser.
//
// Ferrite is a native broadcast-graphics application: an Iced editor over a
// Rust scene graph that a separate process renders through WebGPU. Its
// production half (the output surfaces, the browser sources, the REST control
// API, the live data gateway, the take-to-program bus) is out of scope here
// and none of it is ported. Everything that makes it an *editor* is:
//
//   a project of scenes, each with its own raster, rate, background and
//   shutter; layers of ten kinds with an in and an out; a style with forty
//   properties, any number of which can be keyframed on seven easing curves; a
//   parent link that carries a transform down a chain; a track matte that cuts
//   one layer out with another; an effect stack; and markers on the ruler.
//
// Plain data and plain maths. Nothing here touches the DOM.

import { effectDef, SLOTS } from './effects.js';
import { shaderFor, packColours } from './shader-map.js';

export {
  CATALOG,
  CATEGORIES,
  SLOTS,
  makeEffect,
  effectDef,
} from './effects.js';

/* ------------------------------------------------------------- easing */

// The seven curves Ferrite offers, in one object so the editor and the sampler
// can never drift apart the way two copies of them would. Ferrite keeps the
// editor's and the engine's as the same object for exactly this reason: when
// they were typed twice, the inspector read one position and the picture
// showed another.
const BACK = 1.70158;
const CURVES = {
  linear: (k) => k,
  'ease-in': (k) => k * k,
  'ease-out': (k) => k * (2 - k),
  'ease-in-out': (k) => (k < 0.5 ? 2 * k * k : -1 + (4 - 2 * k) * k),
  expo: (k) => (k === 0 ? 0 : Math.pow(2, 10 * (k - 1))),
  back: (k) => k * k * ((BACK + 1) * k - BACK),
  // A hold keeps the value of the keyframe it is on until the next one lands.
  hold: () => 0,
};

export const EASINGS = [
  { id: 'linear', label: 'Linear' },
  { id: 'ease-in', label: 'Ease in' },
  { id: 'ease-out', label: 'Ease out' },
  { id: 'ease-in-out', label: 'Ease in and out' },
  { id: 'expo', label: 'Exponential' },
  { id: 'back', label: 'Back' },
  { id: 'hold', label: 'Hold' },
];

export const ease = (id, k) => (CURVES[id] ?? CURVES.linear)(k);

// A cubic bezier from (0,0) to (1,1), the way CSS writes one. Solved by
// bisection on x, which is plenty for a curve being drawn at editor rates.
export function cubic(x1, y1, x2, y2, k) {
  const bez = (a, b, t) =>
    3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (bez(x1, x2, mid) < k) lo = mid;
    else hi = mid;
  }
  return bez(y1, y2, (lo + hi) / 2);
}

/* ---------------------------------------------------------- properties */

// Ferrite's `Prop` enum and the `Style` struct behind it. `group` is what the
// timeline twirls the row under and what the inspector puts it beneath.
export const PROPS = {
  x: {
    label: 'Position',
    group: 'Transform',
    unit: 'px',
    value: 0,
    step: 1,
    pair: 'y',
  },
  y: { label: 'Position Y', group: 'Transform', unit: 'px', value: 0, step: 1 },
  width: {
    label: 'Size',
    group: 'Transform',
    unit: 'px',
    value: 400,
    step: 1,
    min: 0,
    pair: 'height',
  },
  height: {
    label: 'Height',
    group: 'Transform',
    unit: 'px',
    value: 200,
    step: 1,
    min: 0,
  },
  rotation: {
    label: 'Rotation',
    group: 'Transform',
    unit: '°',
    value: 0,
    step: 1,
  },
  scale: {
    label: 'Scale',
    group: 'Transform',
    unit: '%',
    value: 100,
    step: 1,
    min: 0,
    max: 400,
  },
  skewX: { label: 'Skew', group: 'Transform', unit: '°', value: 0, step: 0.5 },
  anchorX: {
    label: 'Anchor',
    group: 'Transform',
    unit: '%',
    value: 50,
    step: 1,
    pair: 'anchorY',
  },
  anchorY: {
    label: 'Anchor Y',
    group: 'Transform',
    unit: '%',
    value: 50,
    step: 1,
  },

  opacity: {
    label: 'Opacity',
    group: 'Appearance',
    unit: '%',
    value: 100,
    step: 1,
    min: 0,
    max: 100,
  },
  borderRadius: {
    label: 'Corner',
    group: 'Appearance',
    unit: 'px',
    value: 0,
    step: 1,
    min: 0,
  },
  borderWidth: {
    label: 'Border',
    group: 'Appearance',
    unit: 'px',
    value: 0,
    step: 0.5,
    min: 0,
  },
  padding: {
    label: 'Padding',
    group: 'Appearance',
    unit: 'px',
    value: 0,
    step: 1,
    min: 0,
  },
  blur: {
    label: 'Blur',
    group: 'Appearance',
    unit: 'px',
    value: 0,
    step: 0.5,
    min: 0,
  },
  backdropBlur: {
    label: 'Backdrop blur',
    group: 'Appearance',
    unit: 'px',
    value: 0,
    step: 0.5,
    min: 0,
  },

  fontSize: {
    label: 'Size',
    group: 'Type',
    unit: 'px',
    value: 64,
    step: 1,
    min: 1,
  },
  fontWeight: {
    label: 'Weight',
    group: 'Type',
    unit: '',
    value: 700,
    step: 100,
    min: 100,
    max: 900,
  },
  letterSpacing: {
    label: 'Tracking',
    group: 'Type',
    unit: 'px',
    value: 0,
    step: 0.5,
  },
  lineHeight: {
    label: 'Line height',
    group: 'Type',
    unit: '',
    value: 1.2,
    step: 0.05,
    min: 0,
  },

  volume: {
    label: 'Level',
    group: 'Audio',
    unit: '%',
    value: 100,
    step: 1,
    min: 0,
    max: 200,
  },
};

export const GROUPS = ['Transform', 'Appearance', 'Type', 'Audio', 'Effects'];

// Words rather than numbers: the style fields that are not keyable.
export const STRING_PROPS = {
  background: { label: 'Fill', value: 'transparent' },
  color: { label: 'Colour', value: '#ffffff' },
  borderColor: { label: 'Border colour', value: '#ffffff' },
  shadow: { label: 'Shadow', value: 'none' },
  mixBlendMode: { label: 'Blend', value: 'normal' },
  fontFamily: { label: 'Font', value: 'system-ui' },
  fontStyle: { label: 'Style', value: 'normal' },
  textAlign: { label: 'Align', value: 'center' },
  textTransform: { label: 'Case', value: 'none' },
  objectFit: { label: 'Fit', value: 'contain' },
};

export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
];

export const FITS = ['fill', 'contain', 'cover', 'none'];
export const ALIGNS = ['left', 'center', 'right'];
export const CASES = ['none', 'uppercase', 'lowercase', 'capitalize'];

// Which groups a layer kind actually has. An audio layer has no appearance and
// a video has no typography, so neither is offered the rows.
const GROUPS_FOR = {
  text: ['Transform', 'Appearance', 'Type', 'Effects'],
  box: ['Transform', 'Appearance', 'Effects'],
  image: ['Transform', 'Appearance', 'Effects'],
  video: ['Transform', 'Appearance', 'Audio', 'Effects'],
  audio: ['Audio'],
  svg: ['Transform', 'Appearance', 'Effects'],
  html: ['Transform', 'Appearance', 'Effects'],
  null: ['Transform'],
  adjustment: ['Transform', 'Appearance', 'Effects'],
  group: ['Transform', 'Appearance', 'Effects'],
};

export const groupsFor = (kind) => GROUPS_FOR[kind] ?? ['Transform'];

const PAIRED = new Set(
  Object.values(PROPS)
    .map((p) => p.pair)
    .filter(Boolean),
);

export const propsIn = (kind, group) =>
  groupsFor(kind).includes(group)
    ? Object.keys(PROPS).filter(
        (p) => PROPS[p].group === group && !PAIRED.has(p),
      )
    : [];

// Both halves, for anything that has to touch the whole pair at once: the
// stopwatch, a reset, the keyframe summary.
export const propAndPair = (prop) =>
  PROPS[prop]?.pair ? [prop, PROPS[prop].pair] : [prop];

/* -------------------------------------------------------------- layers */

// The ten layer kinds, as Ferrite's Layer menu lists them.
export const KINDS = {
  text: { label: 'Text', icon: 'type', draws: true },
  box: { label: 'Box', icon: 'square', draws: true },
  image: { label: 'Image', icon: 'image', draws: true },
  video: { label: 'Video', icon: 'film', draws: true },
  audio: { label: 'Audio', icon: 'volume-2', draws: false },
  svg: { label: 'Shape (SVG)', icon: 'pen-tool', draws: true },
  html: { label: 'Raw HTML', icon: 'code', draws: true },
  // A layer that exists only to be a parent: it has a position, a rotation, a
  // scale and an anchor, and it draws nothing at all.
  null: { label: 'Null', icon: 'crosshair', draws: false },
  // Draws nothing and filters everything beneath it.
  adjustment: { label: 'Adjustment', icon: 'sliders-horizontal', draws: false },
  group: { label: 'Group', icon: 'folder', draws: false },
};

export const MATTES = [
  { id: 'none', label: 'No matte' },
  { id: 'alpha', label: 'Alpha matte' },
  { id: 'alpha-inverted', label: 'Alpha inverted' },
  { id: 'luma', label: 'Luma matte' },
  { id: 'luma-inverted', label: 'Luma inverted' },
];

let nextId = 1;
export const newId = (prefix = 'l') => `${prefix}${nextId++}`;

export function defaultStyle() {
  const style = {};
  for (const [name, spec] of Object.entries(PROPS)) style[name] = spec.value;
  for (const [name, spec] of Object.entries(STRING_PROPS))
    style[name] = spec.value;
  style.autoSize = true;
  style.clip = false;
  return style;
}

export function makeLayer(kind, patch = {}) {
  return {
    id: newId(),
    kind,
    name: KINDS[kind]?.label ?? 'Layer',
    visible: true,
    locked: false,
    solo: false,
    // Whether the layer is smeared along the way it is moving. The only switch
    // there is: the layer asks, and the scene's shutter says how much.
    motionBlur: false,
    expanded: false,
    // The layer's bar on the timeline, trimmed the way After Effects trims a
    // layer: the keyframes are untouched, the layer simply is not there
    // outside its own span.
    inMs: 0,
    outMs: 5000,
    // How far into its own media the bar starts: a slip, not a trim.
    offsetMs: 0,
    sourceMs: Infinity,
    style: defaultStyle(),
    // prop name -> [{ ms, value, easing }], kept sorted by ms.
    tracks: {},
    // The effect stack, applied in order.
    effects: [],
    // A link, not a nesting: a parented layer keeps its own row at its own
    // depth and what travels down the chain is the transform, and only that.
    parent: null,
    matte: 'none',
    content: 'Text',
    src: '',
    markup: '',
    loop: true,
    ...patch,
  };
}

export const spanMs = (layer) => Math.max(0, layer.outMs - layer.inMs);
export const draws = (layer) => KINDS[layer.kind]?.draws ?? false;

export function liveAt(layer, ms, layers) {
  if (!layer.visible || ms < layer.inMs || ms >= layer.outMs) return false;
  // Solo is exclusive: the moment anything is soloed, everything that is not
  // is off, which is the whole point of the switch.
  const soloed = layers?.some((l) => l.solo);
  return !soloed || layer.solo;
}

/* -------------------------------------------------------------- scenes */

export function makeScene(patch = {}) {
  return {
    id: newId('s'),
    name: 'Scene',
    // A scene that has never been told otherwise follows the project's raster
    // and rate, so a vertical cut-down can live beside the wide version.
    width: null,
    height: null,
    fps: null,
    durationMs: 10000,
    background: 'transparent',
    // How much of each frame the shutter is open for.
    shutterAngle: 180,
    layers: [],
    markers: [],
    parent: null,
    ...patch,
  };
}

export function makeProject(patch = {}) {
  const scene = makeScene({ name: 'Scene 1' });
  return {
    name: 'Untitled',
    settings: { width: 1920, height: 1080, fps: 30 },
    scenes: [scene],
    ...patch,
  };
}

export const rasterOf = (scene, settings) => ({
  width: scene.width ?? settings.width,
  height: scene.height ?? settings.height,
});

export const fpsOf = (scene, settings) => scene.fps ?? settings.fps;

export const isAnimation = (scene) => Boolean(scene.parent);

/* ---------------------------------------------------------- keyframes */

const sortKeys = (keys) => [...keys].sort((a, b) => a.ms - b.ms);

export const keysFor = (layer, prop) => layer.tracks[prop] ?? [];

export const keyAt = (layer, prop, ms, slop = 1) =>
  keysFor(layer, prop).find((k) => Math.abs(k.ms - ms) <= slop) ?? null;

export const isKeyed = (layer, prop) => keysFor(layer, prop).length > 0;

// The value of a property at a time: the keyframes either side, eased between.
// With no keyframes it is whatever the style says, which is what makes the
// stopwatch a switch rather than a mode.
export function valueAt(layer, prop, ms) {
  const keys = keysFor(layer, prop);
  if (!keys.length) return layer.style?.[prop] ?? PROPS[prop]?.value ?? 0;
  if (ms <= keys[0].ms) return keys[0].value;
  const last = keys[keys.length - 1];
  if (ms >= last.ms) return last.value;
  let i = 1;
  while (keys[i].ms < ms) i++;
  const a = keys[i - 1];
  const b = keys[i];
  const k = (ms - a.ms) / (b.ms - a.ms || 1);
  const eased = a.bezier
    ? cubic(...a.bezier, k)
    : ease(a.easing ?? 'linear', k);
  return a.value + (b.value - a.value) * eased;
}

export function putKey(layer, prop, ms, value, easing) {
  const existing = keyAt(layer, prop, ms);
  const keys = keysFor(layer, prop).filter((k) => k !== existing);
  // Naming a preset throws away a curve that was dragged by hand: otherwise
  // the bezier keeps winning and the preset looks broken.
  const next = { ms, value, easing: easing ?? existing?.easing ?? 'linear' };
  if (!easing && existing?.bezier) next.bezier = existing.bezier;
  return {
    ...layer,
    tracks: { ...layer.tracks, [prop]: sortKeys([...keys, next]) },
  };
}

export function dropKey(layer, prop, ms) {
  const keys = keysFor(layer, prop).filter((k) => Math.abs(k.ms - ms) > 1);
  const tracks = { ...layer.tracks };
  if (keys.length) tracks[prop] = keys;
  else delete tracks[prop];
  return { ...layer, tracks };
}

// The stopwatch. Turning it on keys the value where the playhead is; turning
// it off throws the track away and keeps the value that was on screen.
export function toggleKeyed(layer, prop, ms) {
  if (!isKeyed(layer, prop))
    return putKey(layer, prop, ms, valueAt(layer, prop, ms));
  const held = valueAt(layer, prop, ms);
  const tracks = { ...layer.tracks };
  delete tracks[prop];
  return { ...layer, tracks, style: { ...layer.style, [prop]: held } };
}

export function keyTimes(layer) {
  const out = new Set();
  for (const keys of Object.values(layer.tracks))
    for (const k of keys) out.add(k.ms);
  for (const fx of layer.effects ?? [])
    for (const keys of Object.values(fx.tracks ?? {}))
      for (const k of keys) out.add(k.ms);
  return [...out].sort((a, b) => a - b);
}

/* ----------------------------------------------------- effect sampling */

// An effect parameter is keyable exactly as a layer property is, and samples
// the same way: the track lives on the effect rather than the layer because
// two copies of Gaussian Blur on one layer are two independent knobs.
export function paramAt(fx, index, ms) {
  const keys = fx.tracks?.[index] ?? [];
  if (!keys.length) return fx.values[index];
  if (ms <= keys[0].ms) return keys[0].value;
  const last = keys[keys.length - 1];
  if (ms >= last.ms) return last.value;
  let i = 1;
  while (keys[i].ms < ms) i++;
  const a = keys[i - 1];
  const b = keys[i];
  const k = (ms - a.ms) / (b.ms - a.ms || 1);
  return a.value + (b.value - a.value) * ease(a.easing ?? 'linear', k);
}

export function putParamKey(fx, index, ms, value, easing) {
  const keys = (fx.tracks?.[index] ?? []).filter(
    (k) => Math.abs(k.ms - ms) > 1,
  );
  return {
    ...fx,
    tracks: {
      ...fx.tracks,
      [index]: sortKeys([...keys, { ms, value, easing: easing ?? 'linear' }]),
    },
  };
}

export function toggleParamKeyed(fx, index, ms) {
  const keyed = (fx.tracks?.[index] ?? []).length > 0;
  if (!keyed) return putParamKey(fx, index, ms, paramAt(fx, index, ms));
  const held = paramAt(fx, index, ms);
  const tracks = { ...fx.tracks };
  delete tracks[index];
  const values = [...fx.values];
  values[index] = held;
  return { ...fx, tracks, values };
}

// The layer's effect stack, in author order, as the steps needed to apply it.
//
// A stack mixes effects CSS can express with effects only a shader can, and
// the order in the list is the order they apply. So this walks the stack once
// and flushes: consecutive CSS fragments accumulate, and the moment a shader
// effect is reached the accumulated CSS is emitted as a step of its own before
// the shader's. Batching all the CSS and then all the shaders would be simpler
// and would silently reorder the stack, which is the kind of difference that
// only shows up in the finished file.
export function effectSteps(layer, ms, size) {
  const steps = [];
  let pending = {};

  const flush = () => {
    const slots = Object.keys(pending);
    if (!slots.length) return;
    const out = {};
    for (const [slot, parts] of Object.entries(pending))
      out[slot] = parts.join(SLOTS[slot].separator);
    steps.push({ kind: 'css', declarations: out });
    pending = {};
  };

  for (const fx of layer.effects ?? []) {
    if (!fx.enabled) continue;
    const def = effectDef(fx.name);
    if (!def) continue;
    const values = def.params.map((_, i) => paramAt(fx, i, ms));

    const gpu = shaderFor(fx.name);
    if (gpu) {
      flush();
      steps.push({
        kind: 'shader',
        name: fx.name,
        shader: gpu.shader,
        params: gpu.pack(values, fx.colors, size),
        colours: gpu.colours?.(fx.colors) ?? packColours(fx.colors),
        timeMs: ms,
      });
      continue;
    }

    let fragment;
    try {
      fragment = def.render(values, fx.colors);
    } catch {
      // An effect that cannot express itself contributes nothing rather than
      // taking the frame down with it.
      continue;
    }
    if (!fragment) continue;
    (pending[def.slot] ??= []).push(fragment);
  }
  flush();
  return steps;
}

// Every declaration the layer's effect stack contributes, by CSS property.
// Effects in the same slot are joined in stack order, which is what makes the
// stack an After Effects stack.
export function effectDeclarations(layer, ms) {
  const bySlot = {};
  for (const fx of layer.effects ?? []) {
    if (!fx.enabled) continue;
    const def = effectDef(fx.name);
    if (!def) continue;
    const values = def.params.map((_, i) => paramAt(fx, i, ms));
    let fragment;
    try {
      fragment = def.render(values, fx.colors);
    } catch {
      // An effect that cannot express itself contributes nothing rather than
      // taking the frame down with it.
      continue;
    }
    if (!fragment) continue;
    (bySlot[def.slot] ??= []).push(fragment);
  }
  const out = {};
  for (const [slot, parts] of Object.entries(bySlot))
    out[slot] = parts.join(SLOTS[slot].separator);
  return out;
}

/* -------------------------------------------------------- the transform */

// A layer's transform at a time, with its parent chain folded in.
export function transformAt(layer, ms, byId, seen = new Set()) {
  const own = {
    x: valueAt(layer, 'x', ms),
    y: valueAt(layer, 'y', ms),
    scale: valueAt(layer, 'scale', ms) / 100,
    rotation: (valueAt(layer, 'rotation', ms) * Math.PI) / 180,
    skewX: (valueAt(layer, 'skewX', ms) * Math.PI) / 180,
  };
  const parent =
    layer.parent && !seen.has(layer.id) ? byId(layer.parent) : null;
  if (!parent) return own;
  seen.add(layer.id);
  const up = transformAt(parent, ms, byId, seen);
  const cos = Math.cos(up.rotation);
  const sin = Math.sin(up.rotation);
  return {
    x: up.x + (own.x * cos - own.y * sin) * up.scale,
    y: up.y + (own.x * sin + own.y * cos) * up.scale,
    scale: up.scale * own.scale,
    rotation: up.rotation + own.rotation,
    skewX: own.skewX,
  };
}

// Opacity multiplies down the chain the way it does in a real compositor.
export function opacityAt(layer, ms, byId, seen = new Set()) {
  let out = valueAt(layer, 'opacity', ms) / 100;
  const parent =
    layer.parent && !seen.has(layer.id) ? byId(layer.parent) : null;
  if (parent) {
    seen.add(layer.id);
    out *= opacityAt(parent, ms, byId, seen);
  }
  return Math.max(0, Math.min(1, out));
}

// Whether making `candidate` the parent of `layer` would close a loop.
export function wouldLoop(layers, layer, candidate) {
  let at = layers.find((l) => l.id === candidate);
  const seen = new Set();
  while (at) {
    if (at.id === layer.id) return true;
    if (seen.has(at.id)) return true;
    seen.add(at.id);
    at = layers.find((l) => l.id === at.parent);
  }
  return false;
}

/* ------------------------------------------------------------ the clock */

export const frameMs = (fps) => 1000 / Math.max(1, fps);

export const snapFrame = (ms, fps) => {
  const f = frameMs(fps);
  return Math.round(ms / f) * f;
};

export const frameOf = (ms, fps) => Math.round(ms / frameMs(fps));

// Ferrite's timecode: minutes, seconds and the frame within the second.
export function timecode(ms, fps) {
  const frames = Math.round(Math.max(0, ms) / frameMs(fps));
  const whole = Math.round(fps);
  const s = Math.floor(frames / whole);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}.${pad(frames % whole)}`;
}

// The duration a scene needs to hold every keyframe and every layer's out.
export function contentMs(scene) {
  let end = 0;
  for (const layer of scene.layers) {
    end = Math.max(end, layer.outMs);
    for (const ms of keyTimes(layer)) end = Math.max(end, ms);
  }
  return Math.max(1000, end);
}
