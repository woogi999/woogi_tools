// The joints behind the Pose Reference tool, as plain data, so a pose is a
// small object that can be saved, shared and checked, and lazy/pose-scene.js
// only has to turn it into bone rotations on the model.
//
// Every joint turns by up to three angles in degrees, measured from a figure
// standing with its arms down: x swings forward and back, y twists along the
// limb, z swings sideways. Sided joints carry a `sign`, and the scene mirrors
// their y and z through it, so the same numbers mean the same thing on either
// side: a raise of 90 is a T-pose arm whether it is the left or the right.
// `offset` is where the joint sits on such a figure, in metres.

export const JOINTS = [
  {
    id: 'hips',
    label: 'Hips',
    group: 'Body',
    parent: null,
    offset: [0, 0.98, 0],
    axes: [
      { key: 'x', label: 'Bow', min: -60, max: 90 },
      { key: 'y', label: 'Turn', min: -180, max: 180 },
      { key: 'z', label: 'Lean', min: -45, max: 45 },
    ],
  },
  {
    id: 'spine',
    label: 'Waist',
    group: 'Body',
    parent: 'hips',
    offset: [0, 0.12, 0],
    axes: [
      { key: 'x', label: 'Bend', min: -35, max: 45 },
      { key: 'y', label: 'Twist', min: -45, max: 45 },
      { key: 'z', label: 'Side', min: -35, max: 35 },
    ],
  },
  {
    id: 'chest',
    label: 'Chest',
    group: 'Body',
    parent: 'spine',
    offset: [0, 0.2, 0],
    axes: [
      { key: 'x', label: 'Bend', min: -30, max: 35 },
      { key: 'y', label: 'Twist', min: -40, max: 40 },
      { key: 'z', label: 'Side', min: -25, max: 25 },
    ],
  },
  {
    id: 'neck',
    label: 'Neck',
    group: 'Body',
    parent: 'chest',
    offset: [0, 0.24, 0],
    axes: [
      { key: 'x', label: 'Nod', min: -30, max: 35 },
      { key: 'y', label: 'Turn', min: -50, max: 50 },
      { key: 'z', label: 'Tilt', min: -30, max: 30 },
    ],
  },
  {
    id: 'head',
    label: 'Head',
    group: 'Body',
    parent: 'neck',
    offset: [0, 0.08, 0],
    axes: [
      { key: 'x', label: 'Nod', min: -35, max: 40 },
      { key: 'y', label: 'Turn', min: -60, max: 60 },
      { key: 'z', label: 'Tilt', min: -40, max: 40 },
    ],
  },
  ...side('L', 1),
  ...side('R', -1),
];

// The joints of one side, mirrored by `sign` (+1 is the figure's left, which
// is on the right of the screen when it faces you).
function side(tag, sign) {
  const name = tag === 'L' ? 'Left' : 'Right';
  return [
    {
      id: `arm${tag}`,
      label: `${name} arm`,
      group: 'Arms',
      parent: 'chest',
      offset: [0.2 * sign, 0.19, 0],
      sign,
      axes: [
        { key: 'x', label: 'Swing', min: -180, max: 90 },
        { key: 'y', label: 'Twist', min: -90, max: 90 },
        { key: 'z', label: 'Raise', min: -20, max: 180 },
      ],
    },
    {
      id: `elbow${tag}`,
      label: `${name} elbow`,
      group: 'Arms',
      parent: `arm${tag}`,
      offset: [0, -0.29, 0],
      sign,
      axes: [
        { key: 'x', label: 'Bend', min: -150, max: 0 },
        { key: 'y', label: 'Twist', min: -90, max: 90 },
      ],
    },
    {
      id: `hand${tag}`,
      label: `${name} hand`,
      group: 'Arms',
      parent: `elbow${tag}`,
      offset: [0, -0.26, 0],
      sign,
      axes: [
        { key: 'x', label: 'Bend', min: -70, max: 80 },
        { key: 'z', label: 'Tilt', min: -30, max: 30 },
      ],
    },
    {
      id: `leg${tag}`,
      label: `${name} leg`,
      group: 'Legs',
      parent: 'hips',
      offset: [0.1 * sign, -0.05, 0],
      sign,
      axes: [
        { key: 'x', label: 'Swing', min: -130, max: 40 },
        { key: 'y', label: 'Twist', min: -60, max: 60 },
        { key: 'z', label: 'Spread', min: -20, max: 90 },
      ],
    },
    {
      id: `knee${tag}`,
      label: `${name} knee`,
      group: 'Legs',
      parent: `leg${tag}`,
      offset: [0, -0.44, 0],
      sign,
      axes: [{ key: 'x', label: 'Bend', min: 0, max: 150 }],
    },
    {
      id: `foot${tag}`,
      label: `${name} foot`,
      group: 'Legs',
      parent: `knee${tag}`,
      offset: [0, -0.43, 0],
      sign,
      axes: [
        { key: 'x', label: 'Flex', min: -40, max: 50 },
        { key: 'z', label: 'Tilt', min: -25, max: 25 },
      ],
    },
  ];
}

export const JOINT_GROUPS = ['Body', 'Arms', 'Legs'];

export const jointById = (id) => JOINTS.find((joint) => joint.id === id);

// ─── Poses ─────────────────────────────────────────────────────────────

const zero = (joint) =>
  Object.fromEntries(joint.axes.map((axis) => [axis.key, 0]));

// A relaxed stand: arms slightly out from the sides, elbows a touch bent.
export const DEFAULT_POSE = Object.freeze({
  ...Object.fromEntries(JOINTS.map((joint) => [joint.id, zero(joint)])),
  armL: { x: 0, y: 0, z: 8 },
  armR: { x: 0, y: 0, z: 8 },
  elbowL: { x: -10, y: 0 },
  elbowR: { x: -10, y: 0 },
});

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.max(min, Math.min(max, n)));
};

// Anything from storage or a link is untrusted: keep only known joints and
// angles inside their limits.
export function normalisePose(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const pose = {};
  for (const joint of JOINTS) {
    const values =
      raw[joint.id] && typeof raw[joint.id] === 'object' ? raw[joint.id] : {};
    pose[joint.id] = Object.fromEntries(
      joint.axes.map((axis) => [
        axis.key,
        clamp(
          values[axis.key],
          axis.min,
          axis.max,
          DEFAULT_POSE[joint.id][axis.key],
        ),
      ]),
    );
  }
  return pose;
}

export const poseKey = (pose) => {
  const p = normalisePose(pose);
  return JOINTS.flatMap((joint) =>
    joint.axes.map((axis) => p[joint.id][axis.key]),
  ).join(',');
};

export function setAngle(pose, jointId, axisKey, value) {
  const p = normalisePose(pose);
  return normalisePose({
    ...p,
    [jointId]: { ...p[jointId], [axisKey]: value },
  });
}

// Swap left and right. Limb angles are already mirrored by their side, so
// they swap as they are; the body's twists and leans flip sign.
export function mirrorPose(pose) {
  const p = normalisePose(pose);
  const out = {};
  for (const joint of JOINTS) {
    if (joint.sign) {
      const other = joint.id.slice(0, -1) + (joint.sign > 0 ? 'R' : 'L');
      out[joint.id] = { ...p[other] };
      continue;
    }
    const source = p[joint.id];
    out[joint.id] = {
      ...source,
      ...(source.y !== undefined ? { y: -source.y } : {}),
      ...(source.z !== undefined ? { z: -source.z } : {}),
    };
  }
  return normalisePose(out);
}

function merge(patch) {
  const out = {};
  for (const joint of JOINTS)
    out[joint.id] = { ...DEFAULT_POSE[joint.id], ...(patch[joint.id] ?? {}) };
  return normalisePose(out);
}

// Both sides at once.
const both = (name, values) => ({
  [`${name}L`]: values,
  [`${name}R`]: values,
});

const preset = (id, label, patch) => ({ id, label, pose: merge(patch) });

export const POSE_PRESETS = [
  preset('stand', 'Standing', {}),
  preset('tpose', 'T-pose', {
    ...both('arm', { z: 90 }),
    ...both('elbow', { x: 0 }),
  }),
  preset('apose', 'A-pose', {
    ...both('arm', { z: 40 }),
    ...both('elbow', { x: 0 }),
  }),
  preset('walk', 'Walking', {
    hips: { x: 0, y: -10, z: 0 },
    chest: { x: 0, y: 12, z: 0 },
    armL: { x: 35, y: 0, z: 6 },
    armR: { x: -35, y: 0, z: 6 },
    elbowL: { x: -25, y: 0 },
    elbowR: { x: -40, y: 0 },
    legL: { x: -25, y: 0, z: 2 },
    legR: { x: 22, y: 0, z: 2 },
    kneeL: { x: 10 },
    kneeR: { x: 25 },
    footL: { x: 10, z: 0 },
    footR: { x: -15, z: 0 },
  }),
  preset('run', 'Running', {
    hips: { x: 12, y: -14, z: 0 },
    spine: { x: 10, y: 0, z: 0 },
    chest: { x: 5, y: 18, z: 0 },
    neck: { x: -10, y: 0, z: 0 },
    armL: { x: 60, y: 0, z: 10 },
    armR: { x: -55, y: 0, z: 12 },
    elbowL: { x: -100, y: 0 },
    elbowR: { x: -95, y: 0 },
    handL: { x: 20, z: 0 },
    handR: { x: 20, z: 0 },
    legL: { x: -60, y: 0, z: 3 },
    legR: { x: 40, y: 0, z: 3 },
    kneeL: { x: 40 },
    kneeR: { x: 110 },
    footL: { x: 25, z: 0 },
    footR: { x: -20, z: 0 },
  }),
  preset('sit', 'Sitting', {
    hips: { x: 8, y: 0, z: 0 },
    spine: { x: -4, y: 0, z: 0 },
    ...both('leg', { x: -85, y: 0, z: 8 }),
    ...both('knee', { x: 85 }),
    ...both('arm', { x: -20, y: 0, z: 10 }),
    ...both('elbow', { x: -70, y: 0 }),
    ...both('hand', { x: 0, z: 0 }),
  }),
  preset('crouch', 'Crouching', {
    hips: { x: 35, y: 0, z: 0 },
    spine: { x: 10, y: 0, z: 0 },
    neck: { x: -20, y: 0, z: 0 },
    ...both('leg', { x: -120, y: 0, z: 18 }),
    ...both('knee', { x: 140 }),
    ...both('foot', { x: -15, z: 0 }),
    ...both('arm', { x: 40, y: 0, z: 12 }),
    ...both('elbow', { x: -90, y: 0 }),
  }),
  preset('jump', 'Jumping', {
    hips: { x: -5, y: 0, z: 0 },
    chest: { x: -8, y: 0, z: 0 },
    head: { x: -15, y: 0, z: 0 },
    ...both('arm', { x: -30, y: 0, z: 150 }),
    ...both('elbow', { x: -30, y: 0 }),
    legL: { x: -70, y: 0, z: 10 },
    legR: { x: -20, y: 0, z: 10 },
    kneeL: { x: 110 },
    kneeR: { x: 60 },
    ...both('foot', { x: 30, z: 0 }),
  }),
  // The upper arm goes out to the side and twists so the elbow folds the
  // forearm up beside the head, palm forward.
  preset('wave', 'Waving', {
    head: { x: 0, y: 0, z: 8 },
    armR: { x: 0, y: 90, z: 95 },
    elbowR: { x: -100, y: 0 },
    handR: { x: 0, z: 15 },
    armL: { x: 0, y: 0, z: 8 },
    hips: { x: 0, y: 0, z: 3 },
  }),
  preset('punch', 'Punching', {
    hips: { x: 5, y: 35, z: 0 },
    chest: { x: 0, y: 30, z: 0 },
    neck: { x: 0, y: -40, z: 0 },
    armR: { x: -90, y: 0, z: 10 },
    elbowR: { x: -5, y: 0 },
    handR: { x: 0, z: 0 },
    armL: { x: 40, y: 0, z: 25 },
    elbowL: { x: -130, y: 0 },
    handL: { x: 20, z: 0 },
    legL: { x: -30, y: 0, z: 15 },
    legR: { x: 30, y: 0, z: 15 },
    kneeL: { x: 30 },
    kneeR: { x: 25 },
  }),
  preset('think', 'Thinking', {
    head: { x: 12, y: 10, z: -8 },
    armR: { x: 45, y: -55, z: 12 },
    elbowR: { x: -140, y: 0 },
    handR: { x: 40, z: 0 },
    armL: { x: 20, y: -60, z: 10 },
    elbowL: { x: -95, y: 0 },
    hips: { x: 0, y: 0, z: -4 },
  }),
  preset('point', 'Pointing', {
    chest: { x: 0, y: -15, z: 0 },
    armR: { x: -80, y: 0, z: 20 },
    elbowR: { x: -10, y: 0 },
    armL: { x: 5, y: 0, z: 10 },
    elbowL: { x: -20, y: 0 },
    legR: { x: 10, y: 0, z: 5 },
    legL: { x: -5, y: 0, z: 5 },
  }),
  // Twisted so the elbows point out and back, forearms folding in to the waist.
  preset('hands-hips', 'Hands on hips', {
    ...both('arm', { x: 15, y: -80, z: 35 }),
    ...both('elbow', { x: -100, y: 0 }),
    ...both('hand', { x: 20, z: 10 }),
    hips: { x: 0, y: 0, z: 4 },
    ...both('leg', { x: 0, y: 0, z: 6 }),
  }),
  preset('lie', 'Lying down', {
    hips: { x: -88, y: 0, z: 0 },
    neck: { x: 20, y: 0, z: 0 },
    ...both('arm', { x: 10, y: 0, z: 20 }),
    ...both('elbow', { x: -30, y: 0 }),
    ...both('leg', { x: -10, y: 0, z: 8 }),
    ...both('knee', { x: 20 }),
  }),
];

export function randomPose() {
  const pose = {};
  const between = (min, max) => min + Math.random() * (max - min);
  for (const joint of JOINTS) {
    pose[joint.id] = {};
    for (const axis of joint.axes) {
      // Full-range randomness looks broken; a third of the range looks like a
      // person mid-gesture.
      const span = (axis.max - axis.min) / 3;
      const base = DEFAULT_POSE[joint.id][axis.key];
      pose[joint.id][axis.key] = between(base - span / 2, base + span / 2);
    }
  }
  // Feet stay on the floor more often than not.
  pose.hips = { x: between(-8, 12), y: between(-40, 40), z: between(-6, 6) };
  return normalisePose(pose);
}

// ─── Everything the scene needs, checked ───────────────────────────────

export const SHADING = [
  { id: 'clay', label: 'Clay' },
  { id: 'toon', label: 'Toon' },
  { id: 'wire', label: 'Wireframe' },
  { id: 'xray', label: 'X-ray' },
];

export const DEFAULT_SETTINGS = Object.freeze({
  shading: 'clay',
  colour: '#D8D2C4',
  background: '#2B2B30',
  grid: true,
  shadows: true,
  dots: true,
  lightAngle: 35,
  lightHeight: 45,
  lightPower: 100,
  fov: 35,
});

const oneOf = (list, value, fallback) =>
  list.some((item) => item.id === value) ? value : fallback;
const hexOr = (value, fallback) =>
  /^#[0-9a-f]{6}$/i.test(String(value))
    ? String(value).toUpperCase()
    : fallback;
const num = (value, min, max, fallback) => clamp(value, min, max, fallback);

export function normaliseSettings(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const d = DEFAULT_SETTINGS;
  return {
    shading: oneOf(SHADING, raw.shading, d.shading),
    colour: hexOr(raw.colour, d.colour),
    background: hexOr(raw.background, d.background),
    grid: raw.grid === undefined ? d.grid : Boolean(raw.grid),
    shadows: raw.shadows === undefined ? d.shadows : Boolean(raw.shadows),
    dots: raw.dots === undefined ? d.dots : Boolean(raw.dots),
    lightAngle: num(raw.lightAngle, -180, 180, d.lightAngle),
    lightHeight: num(raw.lightHeight, -10, 89, d.lightHeight),
    lightPower: num(raw.lightPower, 0, 200, d.lightPower),
    fov: num(raw.fov, 12, 100, d.fov),
  };
}

// ─── Saved poses ───────────────────────────────────────────────────────

const SAVES_KEY = 'woogi-pose-saves';
const STATE_KEY = 'woogi-pose-state';

export function loadSaves() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVES_KEY));
    if (!Array.isArray(saved)) return [];
    return saved
      .filter((save) => save?.id && save?.pose)
      .map((save) => ({
        id: String(save.id),
        label: String(save.label ?? 'Pose').slice(0, 40) || 'Pose',
        pose: normalisePose(save.pose),
        at: Number(save.at) || 0,
      }));
  } catch {
    return [];
  }
}

export function storeSaves(saves) {
  try {
    localStorage.setItem(SAVES_KEY, JSON.stringify(saves));
  } catch {
    // storage blocked: saves last until the tab closes
  }
  return saves;
}

// The pose and settings you had last time, so closing the tab loses nothing.
export function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY));
    return {
      pose: normalisePose(saved?.pose),
      settings: normaliseSettings(saved?.settings),
    };
  } catch {
    return { pose: normalisePose(null), settings: normaliseSettings(null) };
  }
}

export function storeState(state) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // storage blocked
  }
}
