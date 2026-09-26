// Ready-made Skill Builder skills for JJS Stuff's Templates tab. Each one is
// a form (`fields`) and a `build` that turns its values into skills, as JJS
// has them with DATA parsed; `encodeMoveset` makes the code to paste in.
//
// Each template is lifted from a real export, node for node, so with its
// defaults it builds what the export had (tests/unit/jjs-templates-test.js):
//
//   Progress bar        the JJS Progress Bar Maker's skill (utils/jjs-skill.js)
//   Auto-sheathing      "SheathPassive" from a katana moveset (KATANA)
//   Accurate M1s        the four M1s from a hand-to-hand moveset (GON)
//   Accurate dash       its chase, without the blink it had as a variant
//
// The page never says where a template came from: `from` is a tagline.
//
// docs/jjs-skill-builder.md explains the nodes, and how each of these works.

import { buildSkill, parseIds } from './jjs-skill';

const FOREVER = 1e38;

// ─── Values from the form ───────────────────────────────────────────────

const id = (value) => Number(parseIds(value)[0] ?? 0);
const text = (value, fallback) => String(value ?? '').trim() || fallback;
// "11, 8" → [11, 8], JJS's own library; anything else is an animation's name.
function anim(value) {
  const nums = String(value ?? '').match(/-?\d+/g);
  return nums?.length === 2 && /^[\d\s,[\]]+$/.test(String(value).trim())
    ? nums.map(Number)
    : String(value ?? '').trim();
}

// ─── Nodes, with every field JJS writes for them ────────────────────────

const wait = (time) => ({ TIME: time, K_NAME: 'WAIT' });
const branch = (name) => ({ 'LAST HIT': -1, BRANCH: name, K_NAME: 'BRANCH' });

function visual(fields) {
  return {
    SIZE: 1,
    'RELATIVE FROM BRANCH': false,
    'CAN COLLIDE': false,
    OPACITY: 0,
    TEXTURE: 0,
    'ALT COLOR': '255, 255, 255',
    COLOR: '255, 255, 255',
    AMOUNT: 1,
    'ALT ROTATION': '0, 0, 0',
    POSITION: '0, 0, 0',
    'EASING DIRECTION': 'In',
    'EASING STYLE': 'Linear',
    'ALT SIZE': 1,
    TIME: 1,
    'CANCEL ON INTERRUPT': false,
    'ALT POSITION': '0, 0, 0',
    'BODY PART': 'HumanoidRootPart',
    ROTATION: '0, 0, 0',
    'LAST HIT': -1,
    'RUN ON SERVER': false,
    'ALT OPACITY': 1,
    K_NAME: 'VISUAL',
    ...fields,
  };
}

// The same, as the Skill Builder writes it now (with the SIZE 2 pair).
const visual2 = (fields) =>
  visual({
    'ALT SIZE 2': '-1, -1, -1',
    'SIZE 2': '-1, -1, -1',
    'CLIENT SIDED': false,
    ...fields,
  });

const sfx = (fields) => ({
  END: 500,
  'FADE OUT': 0,
  VOLUME: 1,
  GLOBAL: false,
  'FADE IN': 0,
  K_NAME: 'SFX',
  ID: 0,
  START: 0,
  CANCEL: false,
  SPEED: 1,
  ...fields,
});

const animation = (use, preview, fields = {}) => ({
  'FADE OUT': 0.1,
  PREVIEW: preview,
  K_NAME: 'ANIM',
  'FADE IN': 0.1,
  'LAST HIT': -1,
  SPEED: 1,
  LOOPED: false,
  ANIM_USE: use,
  ...fields,
});

const state = (name, time, value = 1) => ({
  'DISABLE BURST': false,
  'CANCEL ON END': false,
  TIME: time,
  K_NAME: 'STATE',
  'LAST HIT': -1,
  STATE: name,
  VALUE: value,
  CHECK: false,
});

const tagCheck = (tag, value, then) => ({
  'ADD/REMOVE': false,
  TIME: 1,
  TAG: tag,
  VALUE: value,
  K_NAME: 'TAG',
  'LAST HIT': -1,
  BRANCH: then,
  CHECK: true,
  SET: false,
});

const tagSet = (tag, value, time) => ({
  'ADD/REMOVE': true,
  TIME: time,
  TAG: tag,
  SET: true,
  'LAST HIT': -1,
  VALUE: value,
  CHECK: false,
  K_NAME: 'TAG',
});

const hitbox = (fields) => ({
  DAMAGE: 0,
  'SINGLE TARGET': false,
  'CANCEL ENEMY': false,
  BLOCKABLE: false,
  'ATTACK TYPE': 'Melee',
  PREVIEW: [0, 15],
  STUN: 0,
  DEBREE: 0,
  'STUN ANIM': false,
  POSITION: '0, 0.7, 4',
  'BRANCH TARGET': '',
  'HIT RAGDOLL': false,
  SIZE: '7, 7, 6',
  'LINK USER': 0,
  '360 BLOCK': false,
  K_NAME: 'HITBOX',
  'HIT USER': false,
  'CLEAR KNOCKBACK': false,
  ROTATION: '0, 0, 0',
  BRANCH: '',
  'CAN KILL': false,
  'IGNORE WAKEUP': false,
  ...fields,
});

const push = (force, lastHit, ragdoll = 0, fields = {}) => ({
  'RELATIVE FROM BRANCH': true,
  TRACK: false,
  TIME: 0.2,
  'TRUE RAGDOLL': false,
  FORCE: force,
  RAGDOLL: ragdoll,
  K_NAME: 'VELO',
  'LAST HIT': lastHit,
  FADE: false,
  ...fields,
});

// A one-shot burst from a Roblox ParticleEmitter.
const particle = (fields) => ({
  SIZE: '1',
  'PART SIZE': '0, 0, 0',
  'EMIT COUNT': 1,
  TEXTURE: 0,
  'FLIPBOOK SIZE': '0, 0',
  ZOFFSET: 3,
  'LIGHT INFLUENCE': 1,
  'FLIPBOOK FRAMERATE': '10, 10',
  SHAPE: 'Box',
  RATE: 0,
  'ROT SPEED': '0, 0',
  'CLIENT SIDED': false,
  'LOCK TO PART': false,
  'SPREAD ANGLE': '0, 0, 0',
  'FLIPBOOK MODE': 'OneShot',
  CANCEL: false,
  SPEED: '0, 0',
  'LIGHT EMISSION': 1,
  'ORIENTATION TYPE': 'FacingCamera',
  DURATION: 0,
  COLOR: '255,255,255',
  ACCELERATION: '0, 0, 0',
  SQUASH: '0, 0',
  POSITION: '0, 0, 0',
  DRAG: 0,
  'EMISSION DIRECTION': 'Top',
  BRIGHTNESS: 1,
  TRANSPARENCY: '0, 1',
  'BODY PART': 'HumanoidRootPart',
  'LAST HIT': -1,
  K_NAME: 'PARTICLE',
  LIFETIME: '0.05, 0.05',
  'SHAPE INOUT': 'Outward',
  ROTATION: '0, 360',
  'PROJECTILE TAG': 'nil',
  'SHAPE PARTIAL': 0,
  'RUN ON SERVER': false,
  'CANCEL ON INTERRUPT': false,
  ...fields,
});

// JJS writes an empty table as [], a Branch with none in it too.
const program = (Line, Branch = {}, Prop = [], Req = []) => ({
  Req,
  Line,
  Prop,
  Branch: Object.keys(Branch).length ? Branch : [],
});
const line = (Line, Req = []) => ({ Req, Line });

// Runs by itself, all the time, through stuns and awakenings.
const PASSIVE = {
  USE: true,
  AWK: true,
  NOSTUN: true,
  AWK2: true,
  NOCANCEL: true,
};

const skill = (name, key, data) => ({
  ADD: true,
  NAME: name,
  K_NAME: 'SKILL',
  KEY: key,
  'TOOL TIP': '',
  COOLDOWN: 0,
  DATA: data,
});

// ─── 1. Progress bar ────────────────────────────────────────────────────

function progressBar(v) {
  const textures = parseIds(v.ids);
  if (textures.length < 2)
    throw new Error(
      `A bar needs an image ID for every step, empty to full: at least 2 (there ${textures.length === 1 ? 'is 1' : `are ${textures.length}`}).`,
    );
  return buildSkill({
    textures,
    name: text(v.name, 'Bar'),
    tag: text(v.tag, 'Bar'),
    start: v.start,
    size: Math.max(0.1, Number(v.size) || 2),
    position: text(v.position, '0, 0, 0'),
    showFor: Math.max(0, Number(v.showFor) || 0),
    waitFor: Math.max(0, Number(v.waitFor) || 0),
    rails: v.rails,
    regen: v.regen
      ? {
          amount: Number(v.regenAmount) || 0,
          every: Math.max(0.05, Number(v.regenEvery) || 1),
        }
      : null,
  }).map((s) => ({ ...s, DATA: JSON.parse(s.DATA) }));
}

// ─── 2. Auto-sheathing ──────────────────────────────────────────────────
// A passive with two loops on one tag. Sheathed, it waits for the tag to be
// set, then moves the weapon from its holster to the hand. Drawn, it waits
// for the tag to run out, then puts it back with a sound, an animation and
// a flash. Every move that uses the weapon sets the tag for a few seconds,
// so the weapon comes out with the first swing and goes away once idle.

// The flash at the holster as the weapon goes home.
const SHEATH_FLASH = [
  visual({ SIZE: 0.2, OPACITY: 0, AMOUNT: 0.4, TIME: 0.1, EFFECT: 'Clash' }),
  visual({
    SIZE: 0.5,
    OPACITY: 0.9,
    'ALT COLOR': '0, 0, 0',
    COLOR: '199, 42, 42',
    AMOUNT: 0.4,
    TIME: 1,
    'ALT POSITION': '0, 0.001, 0',
    EFFECT: 'Burst',
  }),
  visual({
    SIZE: 0.2,
    'ALT COLOR': '0, 0, 0',
    COLOR: '0, 0, 0',
    AMOUNT: 0.4,
    TIME: 0.1,
    EFFECT: 'Clash',
  }),
  visual({ SIZE: 0.4, AMOUNT: 7, TIME: 0.2, EFFECT: 'Sparks' }),
  visual({ SIZE: 0.1, 'ALT SIZE': 0, AMOUNT: 1, TIME: 0.1, EFFECT: 'Star' }),
  visual({
    SIZE: 0.1,
    'ALT COLOR': '0, 0, 0',
    COLOR: '0, 0, 0',
    AMOUNT: 0.03,
    TIME: 1,
    'ALT POSITION': '0, 0, 1',
    EFFECT: 'Mass Hit',
  }),
  visual({
    SIZE: 0.1,
    'ALT COLOR': '0, 0, 0',
    COLOR: '0, 0, 0',
    AMOUNT: 0.03,
    TIME: 1,
    'ALT POSITION': '0, 0, 1',
    EFFECT: 'Mass Hit',
  }),
];

function autoSheath(v) {
  const tag = text(v.tag, 'UseKatana');
  const weapon = text(v.weapon, 'Katana');
  const hand = `${weapon}Hand`;
  const scale = Number(v.scale) || 0.12;
  const mesh = { AMOUNT: id(v.mesh), TEXTURE: id(v.texture) };
  const onBack = {
    ...mesh,
    POSITION: text(v.holsterPosition, '0, 0, 0'),
    'BODY PART': v.holsterPart,
    ROTATION: text(v.holsterRotation, '0, 0, 0'),
  };
  const inHand = {
    ...mesh,
    POSITION: text(v.handPosition, '0, 0, 0'),
    'BODY PART': v.handPart,
    ROTATION: text(v.handRotation, '0, 0, 0'),
  };
  // Worn for good; a Cancel with the same VISUAL TAG takes it off.
  const worn = (visualTag, at) =>
    visual({
      SIZE: scale,
      'VISUAL TAG': visualTag,
      TIME: FOREVER,
      'CANCEL ON INTERRUPT': true,
      EFFECT: 'Mesh',
      'ALT OPACITY': 0,
      ...at,
    });
  const takeOff = (visualTag, part) =>
    visual({
      SIZE: scale,
      'VISUAL TAG': visualTag,
      TIME: FOREVER,
      'CANCEL ON INTERRUPT': true,
      'BODY PART': part,
      ROTATION: '3, 0, 0',
      EFFECT: 'Cancel',
      'ALT OPACITY': 0,
    });
  // The first nodes are written the way the Skill Builder first saved them:
  // only the fields that were changed.
  const sparse = (visualTag, at) => ({
    SIZE: scale,
    TEXTURE: at.TEXTURE,
    'CANCEL ON INTERRUPT': true,
    AMOUNT: at.AMOUNT,
    POSITION: at.POSITION,
    'VISUAL TAG': visualTag,
    TIME: FOREVER,
    K_NAME: 'VISUAL',
    'BODY PART': at['BODY PART'],
    EFFECT: 'Mesh',
    ROTATION: at.ROTATION,
  });

  const start = [sparse(weapon, onBack)];
  if (v.scabbard)
    start.push(
      sparse('Scabbard', {
        AMOUNT: id(v.scabbardMesh),
        TEXTURE: id(v.scabbardTexture),
        POSITION: text(v.scabbardPosition, '0, 0, 0'),
        'BODY PART': v.holsterPart,
        ROTATION: text(v.scabbardRotation, '0, 0, 0'),
      }),
    );
  start.push({ BRANCH: 'Looper', K_NAME: 'BRANCH' });

  const sheathe = [];
  if (id(v.sound))
    sheathe.push(
      sfx({ VOLUME: 0.8, 'FADE IN': 0.2, ID: id(v.sound), START: 0.2 }),
    );
  const sheatheAnim = anim(v.anim);
  if (sheatheAnim.length)
    sheathe.push(
      animation(sheatheAnim, [0, Number(v.animLength) || 0.4], {
        'FADE OUT': 0,
      }),
    );
  sheathe.push(
    wait(Math.max(0, Number(v.sheatheAfter) || 0)),
    takeOff(hand, v.handPart),
    worn(weapon, onBack),
  );
  if (v.flash)
    sheathe.push(
      ...SHEATH_FLASH.map((node) => ({
        ...node,
        POSITION: text(v.flashPosition, '0, 0, 0'),
        'BODY PART': v.holsterPart,
      })),
    );
  sheathe.push(branch('Looper'));

  const skills = [
    skill(
      text(v.name, 'SheathPassive'),
      9,
      program(
        start,
        {
          Looper: line([
            wait(0.02),
            tagCheck(tag, 'True', 'Unsheath'),
            branch('Looper'),
          ]),
          Sheath: line(sheathe),
          KeepKatana: line([
            wait(0.02),
            tagCheck(tag, 'True', 'KeepKatana'),
            branch('Sheath'),
          ]),
          Unsheath: line([
            takeOff(weapon, v.holsterPart),
            worn(hand, inHand),
            branch('KeepKatana'),
          ]),
        },
        PASSIVE,
      ),
    ),
  ];
  if (v.debug)
    skills.push(
      skill(
        `Debug: Draw ${weapon}`,
        1,
        program([tagSet(tag, 'True', Number(v.drawnFor) || 4)]),
      ),
    );
  return skills;
}

// ─── 3. Accurate M1s ────────────────────────────────────────────────────
// A four-hit M1 string timed like JJS's own: each hit comes out 0.2 s after
// the press, stuns for 0.75 s and carries you both forward a little, and a
// blocked hit leaves you open while the swing plays out at half speed. The
// fourth hit is a finisher that knocks back; jumping makes it an uppercut
// and in the air it's a downslam.

const HIT_FLASH = [
  visual2({
    SIZE: 0.9,
    OPACITY: 0.8,
    'ALT COLOR': '0, 0, 0',
    'EASING DIRECTION': 'Out',
    TIME: 0.3,
    EFFECT: 'Glow',
  }),
  ...[
    ['2', 8214517543],
    ['1, 6', 426653646],
    ['0, 6', 10365552890],
    ['2, 8', 10365553480, '0.7, 1', '0.2, 0.2'],
  ].map(([size, texture, transparency = '0, 1', lifetime = '0.05, 0.05']) =>
    particle({
      SIZE: size,
      TEXTURE: texture,
      TRANSPARENCY: transparency,
      LIFETIME: lifetime,
    }),
  ),
];

// A shockwave ring on the one launched.
const launchRing = (rotation) =>
  visual2({
    SIZE: 0.01,
    OPACITY: 0.01,
    TEXTURE: 643064975,
    AMOUNT: 643098245,
    'ALT ROTATION': '0, 90, 0',
    'EASING DIRECTION': 'Out',
    'EASING STYLE': 'Exponential',
    'ALT SIZE': 7,
    TIME: 1,
    'LAST HIT': 0.2,
    ROTATION: rotation,
    EFFECT: 'Mesh',
    'ALT POSITION': '0, 0.001, 0',
  });

// Startup: the move's animation, a trail on the swinging limb, the whoosh.
function windUp(use, length, limb, v) {
  const out = [
    animation(use, [0, length]),
    state('NoJump', 0.4),
    state('NoDash', 0.4),
    state('SpeedMultiplier', 0.5, '0.75'),
    visual2({
      SIZE: 0.7,
      OPACITY: 0.5,
      'ALT COLOR': '255, 255, 255',
      TIME: 0.4,
      'BODY PART': limb,
      EFFECT: 'Melee Trail',
    }),
  ];
  if (id(v.swingSound))
    out.push(
      sfx({
        VOLUME: 2,
        'CLIENT SIDED': false,
        'LAST HIT': -1,
        ID: id(v.swingSound),
      }),
    );
  out.push(wait(0.2));
  return out;
}

function onHitTarget(v) {
  const out = [];
  if (id(v.hitSound))
    out.push(
      sfx({
        VOLUME: 1.7,
        'CLIENT SIDED': false,
        'LAST HIT': -1,
        ID: id(v.hitSound),
      }),
    );
  if (v.hitFlash) out.push(...HIT_FLASH);
  return line(out);
}

function m1(n, v) {
  const use = anim(v[`anim${n}`]);
  const length = Number(v[`length${n}`]) || 0.35;
  const damage = Number(v.damage) || 0;
  return {
    NAME: String(n),
    K_NAME: 'MELEE',
    DATA: program([{ BRANCH: 'Base', K_NAME: 'BRANCH' }], {
      OnHitTarget: onHitTarget(v),
      OnHit: line([push('0, 0, 10', -1), push('0, 0, 10', 0.1), wait(0.14)]),
      Base: line([
        ...windUp(use, length, v[`limb${n}`], v),
        hitbox({
          DAMAGE: damage,
          'CANCEL ENEMY': true,
          BLOCKABLE: true,
          STUN: Number(v.stun) || 0,
          'STUN ANIM': true,
          'BRANCH TARGET': 'OnHitTarget',
          BRANCH: 'OnHit',
          'CAN KILL': true,
        }),
        // Hits anything there, blocking or not: if the swing above was
        // blocked, this is what's left to play out.
        hitbox({ BRANCH: 'Blocked' }),
        wait(0.16),
      ]),
      Blocked: line([
        state('NoJump', 0.5, '1'),
        state('NoDash', 0.3, '1'),
        animation(use, [0.2, length], { SPEED: 0.5 }),
        wait(0.3),
      ]),
    }),
  };
}

function finisher(v) {
  const damage = Number(v.finisherDamage) || 0;
  const variant = (use, length, box, after) => [
    ...windUp(use, length, v.limb4, v),
    hitbox({
      DAMAGE: damage,
      'CANCEL ENEMY': true,
      BLOCKABLE: true,
      STUN: 1,
      DEBREE: 2,
      'STUN ANIM': true,
      'BRANCH TARGET': 'OnHitTarget',
      'CLEAR KNOCKBACK': true,
      'CAN KILL': true,
      BRANCH: after,
      ...box,
    }),
    // The recovery: the swing plays out at half speed while you're stuck.
    animation(use, [0.2, length], { SPEED: 0.5 }),
    state('Stun', 0.75, '1'),
    wait(0.8),
  ];
  const base = anim(v.anim4);
  const Line = [{ BRANCH: 'Base', K_NAME: 'BRANCH' }];
  const Branch = {
    OnHitTarget: onHitTarget(v),
    OnHitBase: line([push(text(v.knockback, '0, 0, 40'), 0.2, 1), wait(0.16)]),
    Base: line(variant(base, Number(v.length4) || 0.35, {}, 'OnHitBase')),
  };
  if (v.variants) {
    // Tried in this order: in the air it's a downslam, jumping an uppercut.
    Line.unshift(
      { BRANCH: 'Down', K_NAME: 'BRANCH' },
      { BRANCH: 'Up', K_NAME: 'BRANCH' },
    );
    Object.assign(Branch, {
      OnHitUp: line([
        push('0, 36, 3', 0.2, 1.2),
        launchRing('180, 0, 0'),
        wait(0.16),
      ]),
      Up: line(
        variant(
          anim(v.animUp),
          Number(v.lengthUp) || 0.35,
          { STUN: 1.2 },
          'OnHitUp',
        ),
        [{ FLIP: false, K_NAME: 'JUMP' }],
      ),
      OnHitDown: line([
        push('0, -50, 3', 0.2, 1.2),
        launchRing('0, 0, 0'),
        visual2({ OPACITY: 0, 'ALT OPACITY': 0, EFFECT: 'Shake Light' }),
        wait(0.16),
      ]),
      // Unblockable, and reaching further down, to catch someone below.
      Down: line(
        variant(
          anim(v.animDown),
          Number(v.lengthDown) || 0.5,
          {
            STUN: 1.2,
            BLOCKABLE: false,
            POSITION: '0, -1, 4',
            SIZE: '7, 12, 6',
            'HIT RAGDOLL': true,
            'IGNORE WAKEUP': true,
          },
          'OnHitDown',
        ),
        [{ FLIP: false, K_NAME: 'AIR' }],
      ),
    });
  }
  return { NAME: '4', K_NAME: 'MELEE', DATA: program(Line, Branch) };
}

const accurateM1s = (v) => [m1(1, v), m1(2, v), m1(3, v), finisher(v)];

// ─── 4. Accurate dash ───────────────────────────────────────────────────
// A chase timed like JJS's own: you slide forward while a detector hitbox
// looks in front of you every 0.05 s. The first one it finds is hit, which
// pins you both for a moment before a short knockback. Missing, or being
// blocked, leaves you stuck while the dash plays out. In the air it's the
// same, without the dust kicked up from the ground.

const fov = (amount, time) =>
  visual2({
    AMOUNT: amount,
    TIME: time,
    'ALT OPACITY': 0,
    'EASING DIRECTION': 'Out',
    'EASING STYLE': 'Exponential',
    EFFECT: 'Field of View',
  });

const windMesh = (fields) =>
  visual2({
    'EASING DIRECTION': 'Out',
    'EASING STYLE': 'Exponential',
    EFFECT: 'Mesh',
    ...fields,
  });

// Dust and debris off the ground as the dash starts.
const DUST = [
  {
    SIZE: '0.5, 0',
    'EMIT COUNT': 7,
    TEXTURE: 14582794847,
    SHAPE: 'Cylinder',
    'SPREAD ANGLE': '20, 20, 20',
    SPEED: '20, 40',
    DRAG: 5,
    TRANSPARENCY: '0.8, 1',
    LIFETIME: '1, 1',
  },
  {
    SIZE: '3, 7',
    'EMIT COUNT': 4,
    TEXTURE: 14050526759,
    'FLIPBOOK SIZE': '2, 2',
    SHAPE: 'Sphere',
    'SPREAD ANGLE': '30, 30, 30',
    SPEED: '5, 10',
    POSITION: '0, -2.7, 0',
    'EMISSION DIRECTION': 'Back',
    TRANSPARENCY: '0.9, 1',
    LIFETIME: '0.4, 0.7',
  },
  {
    SIZE: '0.35, 0',
    'PART SIZE': '3, 2, 3',
    TEXTURE: 14582794847,
    RATE: 45,
    'SPREAD ANGLE': '30, 30, 30',
    SPEED: '15, 30',
    DURATION: 0.35,
    DRAG: 7,
    'EMISSION DIRECTION': 'Back',
    BRIGHTNESS: 3,
    TRANSPARENCY: '0.7, 1',
    LIFETIME: '0.5, 1',
  },
  ...[
    [14595543880, 20, '2, 5'],
    [12144047227, 50, '2, 4'],
  ].map(([texture, rate, size]) => ({
    SIZE: size,
    'PART SIZE': '3, 2, 3',
    TEXTURE: texture,
    'FLIPBOOK SIZE': '4, 4',
    RATE: rate,
    'SPREAD ANGLE': '30, 30, 30',
    SPEED: '5, 10',
    DURATION: 0.35,
    POSITION: '0, -2.7, 0',
    'EMISSION DIRECTION': 'Back',
    TRANSPARENCY: '0.8, 1',
    LIFETIME: '0.5, 0.5',
  })),
].map((fields) => particle({ ZOFFSET: 0, 'LIGHT EMISSION': 0, ...fields }));

const loop = (back, times) => ({
  'LOOP BACK': back,
  HOLD: false,
  'LOOP AMOUNT': times,
  K_NAME: 'LOOP',
});

// A gust of wind around you as you go.
const gust = () =>
  windMesh({
    SIZE: 0.25,
    OPACITY: 0.7,
    TEXTURE: 12878479210,
    AMOUNT: 106769674256440,
    'ALT SIZE': 4.5,
    'ALT ROTATION': '0, 0, 45',
    ROTATION: '0, 180, 0',
    POSITION: '0, 0.5, 3',
    'ALT POSITION': '0, 0.5, -4',
    TIME: 0.75,
  });

// The end of the dash animation, the view back to normal, a swipe of the arm.
const recovery = (v, speed = 1) => [
  animation(
    anim(v.anim),
    [Number(v.recoverFrom) || 0, Number(v.animLength) || 1.5],
    { 'FADE OUT': 0, SPEED: speed },
  ),
  fov(0, 1.5),
  visual2({
    SIZE: 0.85,
    OPACITY: 0,
    TIME: 0.4,
    'BODY PART': 'Right Arm',
    EFFECT: 'Melee Trail',
  }),
];

// The same, the view and the arm first, after a hit or a block.
const settle = (v, speed) => {
  const [animNode, ...rest] = recovery(v, speed);
  return [...rest, animNode];
};

// Held in place: a push of almost nothing, following your facing.
const pin = () =>
  push('0.001, 0.001, 0.001', -1, 0, { TRACK: true, TIME: 0.1 });

// A state that ends with the move, if it's cut short by a hit.
const whileDashing = (...args) => ({
  ...state(...args),
  'CANCEL ON END': true,
});

function dashLine(v, grounded) {
  const out = [
    whileDashing('SpeedMultiplier', 1.2, '0.4'),
    whileDashing('NoJump', 1.2, '0.4'),
    whileDashing('InSkill', 1.2, '0.4'),
  ];
  if (id(v.dashSound))
    out.push(
      sfx({
        VOLUME: 2,
        'CLIENT SIDED': false,
        'LAST HIT': -1,
        ID: id(v.dashSound),
      }),
    );
  if (id(v.windSound))
    out.push(
      sfx({
        'FADE IN': 0.3,
        'CLIENT SIDED': false,
        'LAST HIT': -1,
        ID: id(v.windSound),
      }),
    );
  out.push(
    push(text(v.force, '0, 0, 80'), -1, 0, {
      TRACK: true,
      TIME: Number(v.dashFor) || 0.5,
      FADE: true,
    }),
    animation(anim(v.anim), [0, Number(v.animLength) || 1.5], {
      'FADE OUT': 0,
    }),
  );
  if (v.effects && grounded) out.push(...DUST);
  out.push(fov(15, 1));
  if (v.effects) {
    if (grounded)
      out.push(
        ...[
          ['0, -15, 0', '4, -2, 0'],
          ['0, 15, 0', '-4, -2, 0'],
        ].map(([rotation, position]) =>
          visual2({
            SIZE: 0.5,
            OPACITY: 0.3,
            'ALT ROTATION': rotation,
            ROTATION: rotation,
            POSITION: position,
            'ALT POSITION': '0, 0.001, 0',
            'EASING DIRECTION': 'Out',
            'EASING STYLE': 'Exponential',
            TIME: 0.15,
            EFFECT: 'Wind Streak',
          }),
        ),
      );
    out.push(
      branch('>Trails'),
      ...['Right Leg', 'Left Leg', 'Left Arm', 'Right Arm', 'Torso'].map(
        (part) =>
          visual2({
            SIZE: 0.75,
            OPACITY: 0.9,
            'BODY PART': part,
            EFFECT: 'Melee Trail',
            ...(part === 'Torso' ? { 'VISUAL TAG': 'nil' } : {}),
          }),
      ),
      branch('>Wind Meshes'),
      windMesh({
        OPACITY: 0.3,
        TEXTURE: 13877773941,
        AMOUNT: 106769674256440,
        'SIZE 2': '2, 2, 0.1',
        'ALT SIZE 2': '1, 1, 2',
        'ALT ROTATION': '0, 0, 45',
        ROTATION: '0, 180, 0',
        POSITION: '0, 0.5, -4',
        'ALT POSITION': '0, 0.5, 10',
        TIME: 0.5,
      }),
      windMesh({
        SIZE: 0.02,
        TEXTURE: 643064975,
        AMOUNT: 643098245,
        'ALT SIZE': 4,
        ROTATION: '90, 0, 0',
        POSITION: '0, 0, -2',
        'ALT POSITION': '0, 5, 0',
        TIME: 0.7,
      }),
      branch('>Loop'),
      // Three gusts, 0.1 s apart.
      gust(),
      wait(0.1),
      loop(2, 2),
      gust(),
    );
  }
  out.push(
    // Six looks in front, 0.05 s apart: HitCheck hits whoever is there.
    hitbox({
      'SINGLE TARGET': true,
      STUN: -1,
      POSITION: '0, 0, 4',
      SIZE: text(v.reach, '7, 7, 9'),
      BRANCH: 'HitCheck',
    }),
    wait(0.05),
    loop(2, 5),
    // Nobody there: stuck while the dash plays out.
    whileDashing('Stun', 0.36),
    ...recovery(v),
    wait(0.36),
  );
  return out;
}

function accurateDash(v) {
  const box = {
    'SINGLE TARGET': true,
    POSITION: '0, 0, 4',
    SIZE: text(v.reach, '7, 7, 9'),
  };
  const hitTarget = [];
  if (id(v.hitSound))
    hitTarget.push(
      sfx({
        VOLUME: 7,
        'CLIENT SIDED': false,
        'LAST HIT': -1,
        ID: id(v.hitSound),
      }),
    );
  if (v.hitFlash)
    hitTarget.push(
      HIT_FLASH[0],
      // A shockwave down through the one hit.
      visual2({
        OPACITY: 0.2,
        AMOUNT: 4681227436,
        'RELATIVE FROM BRANCH': true,
        'SIZE 2': '0.1, 3, 0.1',
        'ALT SIZE 2': '1.5, 0.2, 1.5',
        'ALT ROTATION': '0, 90, 0',
        ROTATION: '90, 0, 0',
        'ALT POSITION': '0, -5, 0',
        'EASING DIRECTION': 'Out',
        'EASING STYLE': 'Exponential',
        TIME: 0.4,
        EFFECT: 'Mesh',
      }),
      ...HIT_FLASH.slice(1),
      particle({
        SIZE: '0.3, 0',
        'EMIT COUNT': 7,
        TEXTURE: 14582794847,
        ZOFFSET: 0,
        SHAPE: 'Cylinder',
        'SPREAD ANGLE': '20, 20, 20',
        SPEED: '15, 30',
        'LIGHT EMISSION': 3,
        DRAG: 5,
        ROTATION: '0, 0',
        LIFETIME: '0.2, 0.5',
        BRIGHTNESS: 50,
      }),
    );
  const data = program(
    [
      { BRANCH: 'Air', K_NAME: 'BRANCH' },
      { BRANCH: 'Base', K_NAME: 'BRANCH' },
    ],
    {
      Air: line(dashLine(v, false), [{ FLIP: false, K_NAME: 'AIR' }]),
      OnHitTarget: line(hitTarget),
      Blocked: line([state('Stun', 0.75, '1'), pin(), ...settle(v, 0.5)]),
      OnHit: line([
        state('Stun', 0.24, '1'),
        pin(),
        push(text(v.knockback, '0, 0, 25'), 0.2, 0, { FADE: true }),
        ...settle(v),
      ]),
      Base: line(dashLine(v, true)),
      HitCheck: line([
        hitbox({
          ...box,
          DAMAGE: Number(v.damage) || 0,
          'CANCEL ENEMY': true,
          BLOCKABLE: true,
          'CLEAR KNOCKBACK': true,
          STUN: Number(v.stun) || 0,
          'STUN ANIM': true,
          'IGNORE WAKEUP': true,
          'BRANCH TARGET': 'OnHitTarget',
          BRANCH: 'OnHit',
          'CAN KILL': true,
        }),
        hitbox({ ...box, BRANCH: 'Blocked' }),
      ]),
    },
    { NOSTUN: true },
  );
  return [
    {
      K_NAME: 'CHASE',
      NAME: text(v.name, 'Chase'),
      COOLDOWN: Number(v.cooldown) || 0,
      DATA: data,
    },
  ];
}

// ─── The catalogue ──────────────────────────────────────────────────────

const LIMBS = ['Right Arm', 'Left Arm', 'Right Leg', 'Left Leg'];
const PARTS = ['Torso', 'HumanoidRootPart', 'Head', ...LIMBS];

// `row` starts a new row of the form; `when` shows a field only while that
// checkbox is ticked.
const f = (key, label, type, def, extra = {}) => ({
  key,
  label,
  type,
  def,
  ...extra,
});

export const TEMPLATES = [
  {
    id: 'progress-bar',
    name: 'Progress bar',
    icon: 'battery-medium',
    from: 'A picture for every step, empty to full',
    blurb:
      'A bar that shows one picture per step of a tag, with a regenerating passive and two debug skills. Paste in the image IDs of your steps, empty to full.',
    link: {
      route: 'jjs-progress-bar-maker',
      label: 'Draw the steps in the Progress Bar Maker',
    },
    usage: (v) =>
      `Set the ${text(v.tag, 'Bar')} tag from your other skills to move the bar: step N shows while it’s N. Keys 1 and 2 add and take away a step, to try it out.`,
    sections: [
      {
        title: 'Pictures',
        fields: [
          f('ids', 'Image IDs', 'ids', '', {
            hint: 'One image (texture) ID per step, step 0 (empty) first. Not decal IDs.',
          }),
        ],
      },
      {
        title: 'Skill',
        fields: [
          f('name', 'Name', 'text', 'Bar'),
          f('tag', 'Tag', 'text', 'Bar'),
          f('size', 'Size', 'number', 2, { step: 0.1 }),
          f('position', 'Offset (x, y, z)', 'text', '0, 0, 0'),
          f('showFor', 'Shown for (s)', 'number', 0.12, { step: 0.01 }),
          f('waitFor', 'Wait (s)', 'number', 0.1, { step: 0.01 }),
          f('start', 'Starts', 'choice', 'full', {
            options: ['full', 'empty'],
          }),
          f(
            'rails',
            'Safety Rails: keep the tag between empty and full',
            'bool',
            true,
          ),
          f('regen', 'Regenerate', 'bool', true),
          f('regenAmount', 'Add', 'number', 1, { when: 'regen', row: true }),
          f('regenEvery', 'every (s)', 'number', 1, {
            step: 0.1,
            when: 'regen',
          }),
        ],
      },
    ],
    build: progressBar,
  },
  {
    id: 'auto-sheath',
    name: 'Auto-sheathing weapon',
    icon: 'sword',
    from: 'Out on the first swing, home when it’s quiet',
    blurb:
      'A weapon worn in its holster that jumps to your hand when a move uses it, and is sheathed again, with a sound and a flash, once you’ve stopped attacking.',
    usage: (v) =>
      `In every move that uses the weapon, add a TAG node: ${text(v.tag, 'UseKatana')} = True, Set, for ${Number(v.drawnFor) || 4} s. The weapon stays drawn until that runs out.${v.debug ? ' Key 1 draws it, to try it out.' : ''}`,
    sections: [
      {
        title: 'Weapon',
        fields: [
          f('name', 'Skill name', 'text', 'SheathPassive'),
          f('weapon', 'Weapon name', 'text', 'Katana', {
            hint: 'Names its effects, so a Cancel can find them: the one in hand is this name plus “Hand”.',
          }),
          f('tag', 'Tag', 'text', 'UseKatana'),
          f('mesh', 'Mesh ID', 'id', '10447572102', { row: true }),
          f('texture', 'Texture ID', 'id', '10447572165'),
          f('scale', 'Scale', 'number', 0.12, { step: 0.01 }),
        ],
      },
      {
        title: 'Sheathed',
        fields: [
          f('holsterPart', 'On', 'choice', 'Torso', { options: PARTS }),
          f('holsterPosition', 'Position', 'text', '1, -1, -0.5'),
          f('holsterRotation', 'Rotation', 'text', '-10, 180, 0'),
          f('scabbard', 'A scabbard, always worn', 'bool', true),
          f('scabbardMesh', 'Scabbard mesh ID', 'id', '10447572348', {
            when: 'scabbard',
          }),
          f('scabbardTexture', 'Scabbard texture ID', 'id', '10447572394', {
            when: 'scabbard',
          }),
          f('scabbardPosition', 'Position', 'text', '1, -1.14, -1.6', {
            when: 'scabbard',
          }),
          f('scabbardRotation', 'Rotation', 'text', '-7, 180, 0', {
            when: 'scabbard',
          }),
        ],
      },
      {
        title: 'Drawn',
        fields: [
          f('handPart', 'In', 'choice', 'Right Arm', { options: PARTS }),
          f('handPosition', 'Position', 'text', '0, -0.84, 2.1'),
          f('handRotation', 'Rotation', 'text', '3, 0, 0'),
          f('drawnFor', 'Stays drawn for (s)', 'number', 4, {
            step: 0.5,
            hint: 'How long your moves set the tag for.',
          }),
        ],
      },
      {
        title: 'Sheathing',
        fields: [
          f('sound', 'Sound ID', 'id', '104914827478403', {
            hint: 'Blank for none.',
          }),
          f('anim', 'Animation', 'text', '13, 4', {
            hint: 'JJS’s library as “set, number”, or blank for none.',
          }),
          f('animLength', 'Animation length (s)', 'number', 0.4, {
            step: 0.05,
          }),
          f('sheatheAfter', 'Weapon goes home after (s)', 'number', 0.3, {
            step: 0.05,
          }),
          f('flash', 'A red flash at the holster', 'bool', true),
          f('flashPosition', 'Flash position', 'text', '1, -1, 1', {
            when: 'flash',
          }),
          f('debug', 'Add a debug skill on key 1 that draws it', 'bool', true),
        ],
      },
    ],
    build: autoSheath,
  },
  {
    id: 'accurate-m1s',
    name: 'Accurate M1s',
    icon: 'hand',
    from: 'Four hits that land like the game’s own',
    blurb:
      'A four-hit M1 string timed like JJS’s own, with block recoil, hit effects, and a finisher that knocks back, uppercuts when jumping and downslams in the air.',
    usage: () =>
      'These are MELEE skills 1 to 4: they replace the M1s of the moveset you import them into.',
    sections: [
      {
        title: 'Hits',
        fields: [
          f('damage', 'Damage (hits 1–3)', 'number', 3),
          f('stun', 'Stun (s)', 'number', 0.75, { step: 0.05 }),
          f('anim1', 'Hit 1 animation', 'text', '11, 8', { row: true }),
          f('length1', 'length (s)', 'number', 0.33, { step: 0.01 }),
          f('limb1', 'trail on', 'choice', 'Left Arm', { options: LIMBS }),
          f('anim2', 'Hit 2 animation', 'text', '2, 20', { row: true }),
          f('length2', 'length (s)', 'number', 0.35, { step: 0.01 }),
          f('limb2', 'trail on', 'choice', 'Right Arm', { options: LIMBS }),
          f('anim3', 'Hit 3 animation', 'text', '8, 23', { row: true }),
          f('length3', 'length (s)', 'number', 0.33, { step: 0.01 }),
          f('limb3', 'trail on', 'choice', 'Left Arm', { options: LIMBS }),
        ],
      },
      {
        title: 'Finisher',
        fields: [
          f('finisherDamage', 'Damage', 'number', 4),
          f('knockback', 'Knockback (x, y, z)', 'text', '0, 0, 40'),
          f('anim4', 'Animation', 'text', '7, 18', { row: true }),
          f('length4', 'length (s)', 'number', 0.35, { step: 0.01 }),
          f('limb4', 'trail on', 'choice', 'Right Leg', { options: LIMBS }),
          f(
            'variants',
            'Uppercut when jumping, downslam in the air',
            'bool',
            true,
          ),
          f('animUp', 'Uppercut animation', 'text', '1, 17', {
            when: 'variants',
            row: true,
          }),
          f('lengthUp', 'length (s)', 'number', 0.35, {
            step: 0.01,
            when: 'variants',
          }),
          f('animDown', 'Downslam animation', 'text', '1, 18', {
            when: 'variants',
            row: true,
          }),
          f('lengthDown', 'length (s)', 'number', 0.5, {
            step: 0.01,
            when: 'variants',
          }),
        ],
      },
      {
        title: 'Sound and effects',
        fields: [
          f('swingSound', 'Swing sound ID', 'id', '101467914599270', {
            hint: 'Blank for none.',
          }),
          f('hitSound', 'Hit sound ID', 'id', '75771399170221', {
            hint: 'Blank for none.',
          }),
          f('hitFlash', 'A flash and hit sparks on the one hit', 'bool', true),
        ],
      },
    ],
    build: accurateM1s,
  },
  {
    id: 'accurate-dash',
    name: 'Accurate dash',
    icon: 'wind',
    from: 'Closes the gap the way the game does',
    blurb:
      'A chase timed like JJS’s own: a slide forward that hits the first one it reaches, pins you both for a moment and knocks them back. A miss or a block leaves you open.',
    usage: () =>
      'This is the CHASE skill: it replaces the dash of the moveset you import it into.',
    sections: [
      {
        title: 'Dash',
        fields: [
          f('name', 'Name', 'text', 'Chase'),
          f('cooldown', 'Cooldown (s)', 'number', 6),
          f('force', 'Speed (x, y, z)', 'text', '0, 0, 80', { row: true }),
          f('dashFor', 'for (s)', 'number', 0.5, { step: 0.05 }),
          f('anim', 'Animation', 'text', '1, 19', { row: true }),
          f('animLength', 'length (s)', 'number', 1.5, { step: 0.05 }),
          f('recoverFrom', 'recovers from (s)', 'number', 1.23, {
            step: 0.01,
            hint: 'Where the animation picks up once the dash is over.',
          }),
        ],
      },
      {
        title: 'Hit',
        fields: [
          f('damage', 'Damage', 'number', 4),
          f('stun', 'Stun (s)', 'number', 0.75, { step: 0.05 }),
          f('knockback', 'Knockback (x, y, z)', 'text', '0, 0, 25'),
          f('reach', 'Hitbox size (x, y, z)', 'text', '7, 7, 9', { row: true }),
        ],
      },
      {
        title: 'Sound and effects',
        fields: [
          f('dashSound', 'Dash sound ID', 'id', '123389986399408', {
            hint: 'Blank for none.',
          }),
          f('windSound', 'Wind sound ID', 'id', '133755966655233', {
            hint: 'Blank for none.',
          }),
          f('hitSound', 'Hit sound ID', 'id', '139795256698131', {
            hint: 'Blank for none.',
          }),
          f('effects', 'Trails, wind and dust as you go', 'bool', true),
          f(
            'hitFlash',
            'A flash, a shockwave and sparks on the one hit',
            'bool',
            true,
          ),
        ],
      },
    ],
    build: accurateDash,
  },
];

export const fieldsOf = (template) =>
  template.sections.flatMap((s) => s.fields);

export const defaultsOf = (template) =>
  Object.fromEntries(fieldsOf(template).map((field) => [field.key, field.def]));

/** A template's skills for these values (missing ones take their defaults). */
export function buildTemplate(template, values = {}) {
  return template.build({ ...defaultsOf(template), ...values });
}
