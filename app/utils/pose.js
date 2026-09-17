// Poses for avatars: a handful of joints, each turned by a few angles in
// degrees, plus a facial expression. Plain data, so it can be saved, sent to
// other players and checked like the avatar itself; lazy/avatar-model.js
// turns it into rotations on the 3D rig.

export const JOINTS = [
  {
    id: 'root',
    label: 'Whole body',
    axes: [
      { key: 'turn', label: 'Turn', min: -180, max: 180 },
      { key: 'lean', label: 'Lean', min: -30, max: 30 },
      { key: 'bow', label: 'Bow', min: -25, max: 35 },
    ],
  },
  {
    id: 'head',
    label: 'Head',
    axes: [
      { key: 'nod', label: 'Nod', min: -35, max: 40 },
      { key: 'turn', label: 'Turn', min: -70, max: 70 },
      { key: 'tilt', label: 'Tilt', min: -40, max: 40 },
    ],
  },
  {
    id: 'armL',
    label: 'Left arm',
    axes: [
      { key: 'raise', label: 'Raise', min: -20, max: 175 },
      { key: 'swing', label: 'Swing', min: -90, max: 180 },
    ],
  },
  {
    id: 'armR',
    label: 'Right arm',
    axes: [
      { key: 'raise', label: 'Raise', min: -20, max: 175 },
      { key: 'swing', label: 'Swing', min: -90, max: 180 },
    ],
  },
  {
    id: 'legL',
    label: 'Left leg',
    axes: [
      { key: 'swing', label: 'Swing', min: -70, max: 90 },
      { key: 'spread', label: 'Spread', min: -15, max: 50 },
    ],
  },
  {
    id: 'legR',
    label: 'Right leg',
    axes: [
      { key: 'swing', label: 'Swing', min: -70, max: 90 },
      { key: 'spread', label: 'Spread', min: -15, max: 50 },
    ],
  },
];

export const EXPRESSIONS = [
  { id: 'neutral', label: 'Neutral' },
  { id: 'joy', label: 'Happy' },
  { id: 'cheer', label: 'Excited' },
  { id: 'smug', label: 'Smug' },
  { id: 'shocked', label: 'Shocked' },
  { id: 'sad', label: 'Sad' },
  { id: 'angry', label: 'Angry' },
  { id: 'annoyed', label: 'Annoyed' },
  { id: 'stunned', label: 'Dizzy' },
];

const joint = (values = {}) => values;

export const DEFAULT_POSE = {
  expression: 'neutral',
  root: joint({ turn: 0, lean: 0, bow: 0 }),
  head: joint({ nod: 0, turn: 0, tilt: 0 }),
  armL: joint({ raise: 14, swing: 0 }),
  armR: joint({ raise: 14, swing: 0 }),
  legL: joint({ swing: 0, spread: 0 }),
  legR: joint({ swing: 0, spread: 0 }),
};

function preset(id, label, patch) {
  return { id, label, pose: normalisePose(mergePose(DEFAULT_POSE, patch)) };
}

function mergePose(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch))
    out[key] = typeof value === 'object' ? { ...base[key], ...value } : value;
  return out;
}

export const POSE_PRESETS = [
  preset('idle', 'Relaxed', {}),
  preset('wave', 'Wave', {
    expression: 'joy',
    head: { tilt: 10 },
    armR: { raise: 115, swing: 10 },
  }),
  preset('cheer', 'Cheer', {
    expression: 'cheer',
    head: { nod: -12 },
    armL: { raise: 125, swing: 10 },
    armR: { raise: 125, swing: 10 },
  }),
  preset('point', 'Point', {
    expression: 'smug',
    root: { turn: -15 },
    head: { turn: 10 },
    armR: { raise: 10, swing: 90 },
  }),
  preset('hips', 'Hands on hips', {
    expression: 'smug',
    head: { tilt: -6 },
    armL: { raise: 50, swing: -35 },
    armR: { raise: 50, swing: -35 },
    legL: { spread: 12 },
    legR: { spread: 12 },
  }),
  preset('think', 'Thinking', {
    head: { nod: 12, tilt: 14, turn: -10 },
    armR: { raise: -5, swing: 125 },
    armL: { raise: 20, swing: 40 },
  }),
  preset('shrug', 'Shrug', {
    expression: 'annoyed',
    head: { tilt: -14 },
    armL: { raise: 70, swing: 30 },
    armR: { raise: 70, swing: 30 },
  }),
  preset('flex', 'Victory', {
    expression: 'joy',
    armL: { raise: 95, swing: 0 },
    armR: { raise: 95, swing: 0 },
    legL: { spread: 10 },
    legR: { spread: 10 },
  }),
  preset('run', 'Running', {
    expression: 'cheer',
    root: { bow: 12 },
    armL: { raise: 10, swing: 60 },
    armR: { raise: 10, swing: -50 },
    legL: { swing: -40 },
    legR: { swing: 55 },
  }),
  preset('kick', 'Kick', {
    expression: 'angry',
    root: { lean: -8 },
    armL: { raise: 60, swing: -20 },
    armR: { raise: 40, swing: 30 },
    legR: { swing: 85 },
  }),
  preset('sad', 'Gloomy', {
    expression: 'sad',
    root: { bow: 8 },
    head: { nod: 28 },
    armL: { raise: 4 },
    armR: { raise: 4 },
  }),
  preset('shocked', 'Shocked', {
    expression: 'shocked',
    root: { bow: -10 },
    head: { nod: -10 },
    armL: { raise: 105, swing: 40 },
    armR: { raise: 105, swing: 40 },
    legL: { spread: 18 },
    legR: { spread: 18 },
  }),
];

// A declaration, not an arrow: the presets above use it while the module is still loading.
function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n)
    ? Math.max(min, Math.min(max, Math.round(n)))
    : fallback;
}

// Anything from storage or another player is untrusted: known joints and expressions only, angles in range.
export function normalisePose(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const pose = {
    expression: EXPRESSIONS.some((e) => e.id === raw.expression)
      ? raw.expression
      : DEFAULT_POSE.expression,
  };
  for (const j of JOINTS) {
    const values = raw[j.id] && typeof raw[j.id] === 'object' ? raw[j.id] : {};
    pose[j.id] = Object.fromEntries(
      j.axes.map((a) => [
        a.key,
        clamp(values[a.key], a.min, a.max, DEFAULT_POSE[j.id][a.key]),
      ]),
    );
  }
  return pose;
}

export const poseKey = (pose) => {
  const p = normalisePose(pose);
  return [
    p.expression,
    ...JOINTS.flatMap((j) => j.axes.map((a) => p[j.id][a.key])),
  ].join(',');
};

export function setPoseAngle(pose, jointId, axisKey, value) {
  const p = normalisePose(pose);
  return normalisePose({
    ...p,
    [jointId]: { ...p[jointId], [axisKey]: value },
  });
}

// Left for right: mirrors a pose, for posing one side and copying it.
export function mirrorPose(pose) {
  const p = normalisePose(pose);
  return normalisePose({
    ...p,
    root: { ...p.root, turn: -p.root.turn, lean: -p.root.lean },
    head: { ...p.head, turn: -p.head.turn, tilt: -p.head.tilt },
    armL: p.armR,
    armR: p.armL,
    legL: p.legR,
    legR: p.legL,
  });
}

export function randomPose() {
  const pose = {
    expression: EXPRESSIONS[Math.floor(Math.random() * EXPRESSIONS.length)].id,
  };
  for (const j of JOINTS) {
    pose[j.id] = Object.fromEntries(
      j.axes.map((a) => [
        a.key,
        j.id === 'root' && a.key === 'turn'
          ? Math.round(Math.random() * 60 - 30)
          : Math.round(a.min * 0.5 + Math.random() * (a.max - a.min) * 0.5),
      ]),
    );
  }
  return normalisePose(pose);
}
