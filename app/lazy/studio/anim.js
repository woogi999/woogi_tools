// Animation: clips of keyframed tracks, played over the document without
// changing it.
//
//   clip  = { id, name, start, end, loop, tracks: [track] }
//   track = { id, target, prop, keys: [key] }
//     target: { kind: 'object', id } | { kind: 'bone', arm, bone } | { kind: 'material', id }
//     prop:   'pos' | 'rot' | 'scl' | 'visible' | 'color' | 'rough' | 'metal' | …
//   key   = { f, v: [numbers], i: 'bezier' | 'linear' | 'constant',
//             e: 'auto' | 'ease-in' | 'ease-out' | 'ease' | 'custom',
//             tin: [slopes], tout: [slopes] }   (slopes per component, value per frame)
//
// A bezier segment is a cubic Hermite curve between two keys, with each
// key's slope set by its ease: 'auto' is clamped Catmull–Rom (no overshoot
// at a peak), 'ease-in' flattens the curve arriving at the key, 'ease-out'
// leaving it, 'custom' uses the handles dragged in the graph editor.

import { newId } from './doc';
import { mirrorName } from './rig';

export const PROPS = {
  pos: { label: 'Location', size: 3, comps: ['X', 'Y', 'Z'] },
  rot: { label: 'Rotation', size: 3, comps: ['X', 'Y', 'Z'] },
  scl: { label: 'Scale', size: 3, comps: ['X', 'Y', 'Z'] },
  visible: { label: 'Visible', size: 1, comps: [''], step: true },
  color: { label: 'Base colour', size: 3, comps: ['R', 'G', 'B'] },
  rough: { label: 'Roughness', size: 1, comps: [''] },
  metal: { label: 'Metallic', size: 1, comps: [''] },
  opacity: { label: 'Opacity', size: 1, comps: [''] },
  emissiveIntensity: { label: 'Emission', size: 1, comps: [''] },
  influence: { label: 'IK/FK', size: 1, comps: [''] },
};

export const MATERIAL_PROPS = [
  'color',
  'rough',
  'metal',
  'opacity',
  'emissiveIntensity',
];

export function newClip(name = 'Clip', { start = 0, end = 48 } = {}) {
  return {
    id: newId('clip'),
    name,
    start,
    end,
    loop: true,
    speed: 1,
    tracks: [],
  };
}

export const sameTarget = (a, b) =>
  a.kind === b.kind && a.id === b.id && a.arm === b.arm && a.bone === b.bone;

export const trackLabel = (track, doc) => {
  const t = track.target;
  const prop = PROPS[track.prop]?.label ?? track.prop;
  if (t.kind === 'bone') {
    const bone = doc?.objects[t.arm]?.bones?.find((b) => b.id === t.bone);
    return `${bone?.name ?? 'Bone'} · ${prop}`;
  }
  if (t.kind === 'material')
    return `${doc?.materials[t.id]?.name ?? 'Material'} · ${prop}`;
  return `${doc?.objects[t.id]?.name ?? 'Object'} · ${prop}`;
};

// ─── Hex ↔ colour vectors ──────────────────────────────────────────────

export function hexToRgb(hex) {
  const n = parseInt(
    String(hex).replace('#', '').padEnd(6, '0').slice(0, 6),
    16,
  );
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex([r, g, b]) {
  const c = (x) =>
    Math.round(Math.max(0, Math.min(1, x)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

// ─── Keys ──────────────────────────────────────────────────────────────

const asArray = (v) => (Array.isArray(v) ? v : [v]);

function sortKeys(keys) {
  return [...keys].sort((a, b) => a.f - b.f);
}

// Sets (or replaces) the key at `frame` on the track for target+prop,
// creating the track if needed.
export function setKey(clip, target, prop, frame, value, opts = {}) {
  const f = Math.round(frame);
  const v = asArray(value).map(Number);
  const tracks = [...clip.tracks];
  let at = tracks.findIndex(
    (t) => t.prop === prop && sameTarget(t.target, target),
  );
  if (at < 0) {
    tracks.push({ id: newId('trk'), target: { ...target }, prop, keys: [] });
    at = tracks.length - 1;
  }
  const track = tracks[at];
  const old = track.keys.find((k) => k.f === f);
  const key = {
    f,
    v,
    i: opts.i ?? old?.i ?? (PROPS[prop]?.step ? 'constant' : 'bezier'),
    e: opts.e ?? old?.e ?? 'auto',
    tin: old?.tin ?? v.map(() => 0),
    tout: old?.tout ?? v.map(() => 0),
  };
  tracks[at] = {
    ...track,
    keys: sortKeys([...track.keys.filter((k) => k.f !== f), key]),
  };
  return { ...clip, tracks };
}

// A key selection is a Set of "trackId@frame".
export const keyRef = (track, key) => `${track.id}@${key.f}`;

export function deleteKeys(clip, selection) {
  return {
    ...clip,
    tracks: clip.tracks
      .map((t) => ({
        ...t,
        keys: t.keys.filter((k) => !selection.has(keyRef(t, k))),
      }))
      .filter((t) => t.keys.length),
  };
}

// Moves selected keys by `df` frames; a moved key replaces one it lands on.
// Returns the clip and the selection's new refs.
export function moveKeys(clip, selection, df, { copy = false } = {}) {
  const moved = new Set();
  const tracks = clip.tracks.map((t) => {
    const picked = t.keys.filter((k) => selection.has(keyRef(t, k)));
    if (!picked.length) return t;
    const shifted = picked.map((k) => ({ ...k, f: Math.round(k.f + df) }));
    const landing = new Set(shifted.map((k) => k.f));
    const keep = t.keys.filter(
      (k) => (copy || !selection.has(keyRef(t, k))) && !landing.has(k.f),
    );
    for (const k of shifted) moved.add(`${t.id}@${k.f}`);
    return { ...t, keys: sortKeys([...keep, ...shifted]) };
  });
  return { clip: { ...clip, tracks }, selection: moved };
}

export function setKeyProps(clip, selection, patch) {
  return {
    ...clip,
    tracks: clip.tracks.map((t) => ({
      ...t,
      keys: t.keys.map((k) =>
        selection.has(keyRef(t, k)) ? { ...k, ...patch } : k,
      ),
    })),
  };
}

// Copied keys remember their track's target and prop, and their frame
// relative to the first copied key.
export function copyKeys(clip, selection) {
  let first = Infinity;
  const tracks = [];
  for (const t of clip.tracks) {
    const keys = t.keys.filter((k) => selection.has(keyRef(t, k)));
    if (!keys.length) continue;
    first = Math.min(first, keys[0].f);
    tracks.push({
      target: t.target,
      prop: t.prop,
      keys: structuredClone(keys),
    });
  }
  for (const t of tracks) for (const k of t.keys) k.f -= first;
  return tracks.length ? { tracks } : null;
}

export function pasteKeys(clip, buffer, frame) {
  let out = clip;
  const selection = new Set();
  for (const t of buffer?.tracks ?? [])
    for (const k of t.keys) {
      out = setKey(out, t.target, t.prop, frame + k.f, k.v, { i: k.i, e: k.e });
      const track = out.tracks.find(
        (x) => x.prop === t.prop && sameTarget(x.target, t.target),
      );
      selection.add(`${track.id}@${frame + k.f}`);
    }
  return { clip: out, selection };
}

// ─── Evaluating ────────────────────────────────────────────────────────

// Slope of component `c` at key index `k` on the side `side` ('in'|'out').
export function slopeAt(keys, k, c, side) {
  const key = keys[k];
  if (key.e === 'custom') return (side === 'in' ? key.tin : key.tout)?.[c] ?? 0;
  if ((key.e === 'ease-in' || key.e === 'ease') && side === 'in') return 0;
  if ((key.e === 'ease-out' || key.e === 'ease') && side === 'out') return 0;
  const prev = keys[k - 1];
  const next = keys[k + 1];
  if (!prev || !next) return 0;
  const a = prev.v[c],
    b = key.v[c],
    d = next.v[c];
  // A peak or a valley stays flat, so curves never overshoot a key.
  if ((b - a) * (d - b) <= 0) return 0;
  return (d - a) / (next.f - prev.f);
}

export function sampleKeys(keys, frame, c) {
  if (!keys.length) return 0;
  if (frame <= keys[0].f) return keys[0].v[c] ?? 0;
  const last = keys[keys.length - 1];
  if (frame >= last.f) return last.v[c] ?? 0;
  let k = 0;
  while (k < keys.length - 1 && keys[k + 1].f <= frame) k++;
  const a = keys[k];
  const b = keys[k + 1];
  const span = b.f - a.f;
  const t = (frame - a.f) / span;
  if (a.i === 'constant') return a.v[c];
  if (a.i === 'linear') return a.v[c] + (b.v[c] - a.v[c]) * t;
  const m0 = slopeAt(keys, k, c, 'out') * span;
  const m1 = slopeAt(keys, k + 1, c, 'in') * span;
  const t2 = t * t,
    t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * a.v[c] +
    (t3 - 2 * t2 + t) * m0 +
    (-2 * t3 + 3 * t2) * b.v[c] +
    (t3 - t2) * m1
  );
}

export function sampleTrack(track, frame) {
  const size = track.keys[0]?.v.length ?? 0;
  const out = [];
  for (let c = 0; c < size; c++) out.push(sampleKeys(track.keys, frame, c));
  return out;
}

// Wraps a playhead into the clip for looping playback.
export function clipFrame(clip, frame) {
  const len = clip.end - clip.start;
  if (!clip.loop || len <= 0)
    return Math.min(Math.max(frame, clip.start), clip.end);
  return clip.start + ((((frame - clip.start) % len) + len) % len);
}

// What the clip says at a frame, as overrides the renderer lays over the
// document: { objects: { id: { pos, rot, scl, visible } },
//             bones: { armatureId: { boneId: { p, r, s } } },
//             materials: { id: { prop: value } }, influence: { armId: { boneId: n } } }
export function evaluateClip(clip, frame, doc) {
  const out = { objects: {}, bones: {}, materials: {}, influence: {} };
  if (!clip) return out;
  for (const t of clip.tracks) {
    if (!t.keys.length) continue;
    const v = sampleTrack(t, frame);
    const tg = t.target;
    if (tg.kind === 'object') {
      if (!doc?.objects[tg.id]) continue;
      const o = (out.objects[tg.id] ??= {});
      o[t.prop] = t.prop === 'visible' ? v[0] >= 0.5 : v;
    } else if (tg.kind === 'bone') {
      if (t.prop === 'influence') {
        (out.influence[tg.arm] ??= {})[tg.bone] = v[0];
        continue;
      }
      const arm = (out.bones[tg.arm] ??= {});
      const b = (arm[tg.bone] ??= {});
      b[{ pos: 'p', rot: 'r', scl: 's' }[t.prop] ?? t.prop] = v;
    } else if (tg.kind === 'material') {
      const m = (out.materials[tg.id] ??= {});
      m[t.prop] = t.prop === 'color' ? rgbToHex(v) : v[0];
    }
  }
  return out;
}

// Fills each bone's pose from animated values, falling back to the stored pose.
export function mergePose(stored = {}, animated = {}) {
  const out = { ...stored };
  for (const [id, a] of Object.entries(animated)) {
    const s = stored[id] ?? { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] };
    out[id] = { p: a.p ?? s.p, r: a.r ?? s.r, s: a.s ?? s.s };
  }
  return out;
}

// Frames that hold a key on any track of the given targets (for the
// timeline's summary row and for "next key" stepping).
export function keyFrames(clip, filter = () => true) {
  const frames = new Set();
  for (const t of clip?.tracks ?? [])
    if (filter(t)) for (const k of t.keys) frames.add(k.f);
  return [...frames].sort((a, b) => a - b);
}

// ─── Poses ─────────────────────────────────────────────────────────────

// A saved pose names bones rather than ids so it can go on another rig.
export function capturePose(arm) {
  const bones = {};
  for (const b of arm.bones) {
    const p = arm.pose?.[b.id];
    if (p) bones[b.name] = structuredClone(p);
  }
  return bones;
}

export function applyPose(arm, saved, { mirror = false, only = null } = {}) {
  const byName = new Map(arm.bones.map((b) => [b.name, b]));
  const pose = { ...arm.pose };
  for (const [name, p] of Object.entries(saved)) {
    const to = byName.get(mirror ? mirrorName(name) : name);
    if (!to || (only && !only.has(to.id))) continue;
    pose[to.id] = mirror ? mirrorTransform(p) : structuredClone(p);
  }
  return pose;
}

// Reflects a bone-local transform across the character's middle (X).
export const mirrorTransform = (p) => ({
  p: [-p.p[0], p.p[1], p.p[2]],
  r: [p.r[0], -p.r[1], -p.r[2]],
  s: [...p.s],
});

// Swaps left and right across the whole rig.
export function mirrorPose(arm) {
  return applyPose({ ...arm, pose: {} }, capturePose(arm), { mirror: true });
}

// ─── Retargeting ───────────────────────────────────────────────────────

// Most specific first: "forearm" also ends in "arm".
const SYNONYMS = [
  [/lowerarm|forearm/, 'forearm'],
  [/upperarm|arm$/, 'arm'],
  [/lowerleg|calf|shin|knee/, 'shin'],
  [/upperleg|thigh|leg$/, 'leg'],
  [/chest|spine2|upperchest|ribs/, 'chest'],
  [/torso|spine1|spine$/, 'spine'],
  [/pelvis|hip(s)?$/, 'hips'],
  [/wrist|hand$/, 'hand'],
  [/ankle|foot$/, 'foot'],
  [/head$/, 'head'],
  [/neck/, 'neck'],
];

export function canonicalBone(name) {
  let n = name.toLowerCase().replace(/mixamorig:?|bip0?1_?|def[-_]?/g, '');
  let side = '';
  if (/(^|[^a-z])l([^a-z]|$)|left|\.l$|_l$/.test(n)) side = 'l';
  if (/(^|[^a-z])r([^a-z]|$)|right|\.r$|_r$/.test(n)) side = side ? side : 'r';
  n = n
    .replace(/left|right|\.l$|\.r$|_l$|_r$|(^|[^a-z])[lr]([^a-z]|$)/g, '')
    .replace(/[^a-z0-9]/g, '');
  for (const [re, to] of SYNONYMS)
    if (re.test(n)) {
      n = to;
      break;
    }
  return side + n;
}

// Pairs up bones by what they're for rather than exactly what they're called.
export function autoBoneMap(srcBones, dstBones) {
  const dst = new Map();
  for (const b of dstBones)
    if (!dst.has(canonicalBone(b.name))) dst.set(canonicalBone(b.name), b.name);
  const out = {};
  for (const b of srcBones) {
    const exact = dstBones.find((d) => d.name === b.name);
    const to = exact?.name ?? dst.get(canonicalBone(b.name));
    if (to) out[b.name] = to;
  }
  return out;
}

// Copies a clip's bone tracks from one rig to another through a name map.
// Rotations carry over as they are (rigs built the same way share rest
// frames); moves are scaled by the rigs' relative height so a walk's root
// motion fits the new character.
export function retargetClip(
  clip,
  srcArm,
  dstArm,
  map,
  { heightRatio = 1 } = {},
) {
  const srcById = new Map(srcArm.bones.map((b) => [b.id, b]));
  const dstByName = new Map(dstArm.bones.map((b) => [b.name, b]));
  const tracks = [];
  for (const t of clip.tracks) {
    if (t.target.kind !== 'bone' || t.target.arm !== srcArm.id) continue;
    const src = srcById.get(t.target.bone);
    const dst = src && dstByName.get(map[src.name]);
    if (!dst) continue;
    const keys = t.keys.map((k) => ({
      ...structuredClone(k),
      v: t.prop === 'pos' ? k.v.map((x) => x * heightRatio) : [...k.v],
    }));
    tracks.push({
      id: newId('trk'),
      target: { kind: 'bone', arm: dstArm.id, bone: dst.id },
      prop: t.prop,
      keys,
    });
  }
  return {
    ...newClip(`${clip.name} → ${dstArm.name}`, {
      start: clip.start,
      end: clip.end,
    }),
    loop: clip.loop,
    tracks,
  };
}
