// What Webskill Shenanigans knows about each kind of Skill Builder node: its
// label and colour in the palette, its fields (type, default, choices) and a
// one-line summary for the timeline.
//
// All of it comes from reading real JJS exports (docs/jjs-skill-builder.md).
// Choice lists are the values seen in those exports, and more may exist, so
// every choice field also takes free text. Defaults are the values JJS wrote
// most often. A node kind or field that isn't listed here still loads, edits
// (by the type of its value) and exports unchanged.

// ─── Skills ─────────────────────────────────────────────────────────────

export const CATEGORIES = [
  { id: 'SKILL', label: 'Skill', color: '#ff8e8e', icon: 'swords' },
  { id: 'SPECIAL', label: 'Special', color: '#ffae7a', icon: 'sparkles' },
  { id: 'AWAKENING', label: 'Awakening', color: '#fff27a', icon: 'user-round' },
  { id: 'MELEE', label: 'Melee', color: '#b8f36a', icon: 'hand' },
  { id: 'CHASE', label: 'Chase', color: '#2ef08a', icon: 'footprints' },
];

export const categoryOf = (id) =>
  CATEGORIES.find((c) => c.id === id) ?? { id, label: id, color: '#cfcfcf', icon: 'swords' };

// A skill's own settings, by category.
export const SKILL_FIELDS = {
  common: [
    { key: 'NAME', type: 'str', label: 'Name', def: 'New skill' },
    { key: 'ADD', type: 'bool', label: 'In the moveset', def: true, hint: 'Off for list separators like “----BASE----”.' },
  ],
  SKILL: [
    { key: 'KEY', type: 'num', label: 'Key', def: 1, hint: '1–4 are the skill slots; 9 is used for passives, 15 for separators.' },
    { key: 'COOLDOWN', type: 'num', label: 'Cooldown (s)', def: 10 },
    { key: 'TOOL TIP', type: 'str', label: 'Tool tip', def: '', hint: 'Shown on the slot, like “HOLD” or “JUMP+”.' },
  ],
  SPECIAL: [{ key: 'COOLDOWN', type: 'num', label: 'Cooldown (s)', def: 10 }],
  CHASE: [{ key: 'COOLDOWN', type: 'num', label: 'Cooldown (s)', def: 6 }],
  MELEE: [],
  AWAKENING: [
    { key: 'DURATION', type: 'num', label: 'Duration (s)', def: 60 },
    { key: 'DELAY', type: 'num', label: 'Delay (s)', def: 0 },
    { key: 'COLOR', type: 'str', label: 'Colours', def: '255,119,0 255,215,38', hint: 'Two colours, “r,g,b r,g,b”: the awakening’s gradient.' },
  ],
};

// Flags in a program's Prop. Meanings are inferred; see the handbook.
export const PROP_FLAGS = [
  { key: 'USE', label: 'USE', hint: 'Seen on passives: the skill runs on its own.' },
  { key: 'KEEP', label: 'KEEP', hint: 'Seen on most attacks: keeps running when interrupted?' },
  { key: 'REP', label: 'REP', hint: 'Seen on most attacks: can be used again?' },
  { key: 'REP2', label: 'REP2', hint: 'Seen on regen and one awakening: repeats.' },
  { key: 'AWK', label: 'AWK', hint: 'Usable while awakened?' },
  { key: 'AWK2', label: 'AWK2', hint: 'Usable in the second awakening state?' },
  { key: 'NOSTUN', label: 'NOSTUN', hint: 'Usable or keeps running while stunned?' },
  { key: 'NOCANCEL', label: 'NOCANCEL', hint: 'Can’t be cancelled by other actions?' },
];

// Branch conditions (Req). FLIP turns one into its opposite.
export const REQ_KINDS = [
  { id: 'AIR', label: 'In the air' },
  { id: 'JUMP', label: 'Jumping' },
  { id: 'HOLD', label: 'Holding the key' },
  { id: 'ULT', label: 'Awakened' },
  { id: 'BAR', label: 'Awakening bar at least', amount: true },
];

// ─── Field types ────────────────────────────────────────────────────────
//   num · str · bool · vec3 ("x, y, z") · color ("r, g, b") · pair ([a, b])
//   anim ([a, b] or a name) · branch (a branch's name) · choice (options)

const EFFECTS = ['Clash', 'Field of View', 'Mesh', 'Melee Trail', 'Wind Expand', 'Glow', 'Sparks', 'Screen Color', 'Billboard', 'Circle Glow', 'Overlay', 'Shake Heavy', 'Shake Medium', 'Shake Light', 'Beams', 'Beam', 'Light', '360 Wind', 'Whirl Slash', 'Distortion', 'Wind Streak', 'Flames', 'Weak Lightning', 'Afterimage', 'Afterimage2', 'Cleave', 'Visibility', 'Black Flash', 'Cancel', 'Mass Hit', 'Camera', 'Sphere', 'Energy Sparks', 'Star', 'Shine', 'Cursed Energy', 'Ring', 'Burst', 'Slash', 'Wind Ring'];
const STATES = ['Stun', 'NoDash', 'NoJump', 'NoM1', 'NoSprint', 'InSkill', 'IFrame', 'Block', 'SpeedMultiplier', 'HealthMultiplier', 'DirectionLock', 'DisableChase', 'Scale', 'NoBlock'];
const BODY_PARTS = ['HumanoidRootPart', 'Head', 'Torso', 'Right Arm', 'Left Arm', 'Right Leg', 'Left Leg'];
const EASING_STYLES = ['Linear', 'Quad', 'Cubic', 'Exponential', 'Sine', 'Back'];
const EASING_DIRECTIONS = ['In', 'Out', 'InOut'];
const ATTACK_TYPES = ['Melee', 'Domain', 'Bullet', 'Swarm'];

const f = (key, type, def, extra = {}) => ({ key, type, def, ...extra });
const lastHit = f('LAST HIT', 'num', -1, {
  hint: '-1: whoever runs this. A number: the last one hit, if hit within that many seconds.',
});

// ─── Node kinds ─────────────────────────────────────────────────────────
// `label` is the palette's name; `kind` is JJS's K_NAME.

export const NODES = [
  {
    kind: 'WAIT', label: 'WAIT', color: '#c9c9c9', icon: 'clock', group: 'Flow',
    about: 'Pauses this line for a time.',
    fields: [f('TIME', 'num', 0.1, { label: 'Seconds' })],
    summary: (n) => `${n.TIME ?? 0}s`,
  },
  {
    kind: 'BRANCH', label: 'BRANCH', color: '#e98bff', icon: 'split', group: 'Flow',
    about: 'Jumps to a branch, if its conditions hold; otherwise the line carries on. A branch that doesn’t exist does nothing, which makes a comment.',
    fields: [
      f('BRANCH', 'branch', '', { label: 'Branch' }),
      f('RANDOM', 'str', '', { label: 'Random from', hint: 'Branch names split by commas: one is picked at random.' }),
      lastHit,
    ],
    summary: (n) => (n.RANDOM ? `random: ${n.RANDOM}` : n.BRANCH || '—'),
  },
  {
    kind: 'LOOP', label: 'LOOP', color: '#d9a8ff', icon: 'repeat', group: 'Flow',
    about: 'Goes back a number of nodes, a number of times.',
    fields: [
      f('LOOP BACK', 'num', 2, { label: 'Back (nodes)' }),
      f('LOOP AMOUNT', 'num', 3, { label: 'Times' }),
      f('HOLD', 'bool', false, { label: 'Only while held' }),
    ],
    summary: (n) => `back ${n['LOOP BACK'] ?? 0} × ${n['LOOP AMOUNT'] ?? 0}${n.HOLD ? ' (hold)' : ''}`,
  },
  {
    kind: 'TAG', label: 'TAG', color: '#ffd37a', icon: 'hash', group: 'Flow',
    about: 'Reads or writes a named value. Check: branch if it matches ("2", "<0", ">20"). Set: replace it. Otherwise: add to it.',
    fields: [
      f('TAG', 'str', 'Tag'),
      f('VALUE', 'str', '1'),
      f('TIME', 'num', 1, { hint: 'How long a written value lasts; 1e38 is for ever, 0 clears it.' }),
      f('CHECK', 'bool', false, { label: 'Check' }),
      f('BRANCH', 'branch', '', { label: 'Branch if it matches' }),
      f('SET', 'bool', false, { label: 'Set (replace)' }),
      f('ADD/REMOVE', 'bool', false),
      lastHit,
    ],
    summary: (n) =>
      n.CHECK
        ? `${n.TAG} ${/^[<>]/.test(n.VALUE ?? '') ? n.VALUE : `= ${n.VALUE}`} → ${n.BRANCH || '—'}`
        : `${n.TAG} ${n.SET ? '=' : '+='} ${n.VALUE}`,
  },
  {
    kind: 'STATE', label: 'STATE', color: '#ff9ccf', icon: 'shield', group: 'Flow',
    about: 'Puts the character in a state (stunned, no dash, i-frames…) for a time, or checks for one.',
    fields: [
      f('STATE', 'choice', 'Stun', { options: STATES }),
      f('VALUE', 'num', 1),
      f('TIME', 'num', 1),
      f('CHECK', 'bool', false, { label: 'Check' }),
      f('BRANCH', 'branch', '', { label: 'Branch if in it' }),
      f('CANCEL ON END', 'bool', false),
      f('DISABLE BURST', 'bool', false),
      lastHit,
    ],
    summary: (n) => (n.CHECK ? `${n.STATE ?? 'Stun'}? → ${n.BRANCH || '—'}` : `${n.STATE ?? 'Stun'} ${n.VALUE ?? 1} · ${n.TIME ?? 0}s`),
  },
  {
    kind: 'SETCD', label: 'COOLDOWN', color: '#ff8e8e', icon: 'timer', group: 'Combat',
    about: 'Starts a cooldown. Key -1 is this skill; cooldown -1 is its usual one.',
    fields: [f('KEY', 'num', -1), f('COOLDOWN', 'num', -1)],
    summary: (n) => `key ${n.KEY ?? -1} · ${(n.COOLDOWN ?? -1) < 0 ? 'usual' : `${n.COOLDOWN}s`}`,
  },
  {
    kind: 'SETMELEE', label: 'MELEE', color: '#ffae7a', icon: 'hand', group: 'Combat',
    about: 'Sets the melee combo counter.',
    fields: [f('COMBO', 'num', 1), f('OFFSET', 'num', 0), lastHit],
    summary: (n) => `combo ${n.COMBO ?? 1}`,
  },
  {
    kind: 'SKILL', label: 'SKILL', color: '#ffc38a', icon: 'zap', group: 'Combat',
    about: 'Uses a move. Seen once, as MOVE “Cancel”, to cancel the move being used (a block that swaps stances).',
    fields: [
      f('MOVE', 'str', 'Cancel', { label: 'Move' }),
      f('START', 'num', 0, { label: 'Start at (s)' }),
      f('SPEED', 'num', 1),
      f('HOLD FOR', 'num', 0, { label: 'Hold for (s)' }),
      f('ENABLE VARIANTS', 'bool', true),
      f('CANCEL LAST', 'bool', false),
    ],
    summary: (n) => n.MOVE || '—',
  },
  {
    kind: 'ANIM', label: 'ANIMATION', color: '#fff27a', icon: 'person-standing', group: 'Look',
    about: 'Plays one of JJS’s animations, from PREVIEW’s start to end.',
    fields: [
      f('ANIM_USE', 'anim', [1, 1], { label: 'Animation', hint: 'JJS’s own library: [set, number], or a name like “Killbind”.' }),
      f('PREVIEW', 'pair', [0, 1], { label: 'Start, end (s)' }),
      f('SPEED', 'num', 1),
      f('LOOPED', 'bool', false),
      f('FADE IN', 'num', 0.1),
      f('FADE OUT', 'num', 0),
      lastHit,
    ],
    summary: (n) => (Array.isArray(n.ANIM_USE) ? n.ANIM_USE.join(', ') : String(n.ANIM_USE ?? '')),
  },
  {
    kind: 'SFX', label: 'SOUND', color: '#b8f36a', icon: 'volume-2', group: 'Look',
    about: 'Plays a Roblox sound by ID.',
    fields: [
      f('ID', 'num', 0, { label: 'Sound ID' }),
      f('VOLUME', 'num', 1),
      f('START', 'num', 0, { label: 'Start at (s)' }),
      f('END', 'num', 500, { label: 'End at (s)' }),
      f('SPEED', 'num', 1),
      f('FADE IN', 'num', 0),
      f('FADE OUT', 'num', 0),
      f('PROJECTILE TAG', 'str', '', { hint: 'Plays from that projectile.' }),
      f('GLOBAL', 'bool', false),
      f('CANCEL', 'bool', false),
      f('CLIENT SIDED', 'bool', false),
      lastHit,
    ],
    summary: (n) => String(n.ID ?? 0),
  },
  {
    kind: 'VELO', label: 'VELOCITY', color: '#2ef08a', icon: 'navigation', group: 'Motion',
    about: 'Pushes a character: FORCE is studs per second (x right, y up, z forward) for TIME.',
    fields: [
      f('FORCE', 'vec3', '0, 0, 10'),
      f('TIME', 'num', 0.2),
      f('FADE', 'bool', false, { hint: 'Slows to a stop over the time.' }),
      f('TRACK', 'bool', false, { hint: 'Follows where the character faces.' }),
      f('RELATIVE FROM BRANCH', 'bool', true),
      f('RAGDOLL', 'num', 0, { label: 'Ragdoll (s)' }),
      f('TRUE RAGDOLL', 'bool', false),
      lastHit,
    ],
    summary: (n) => `${n.FORCE ?? '0, 0, 0'} · ${n.TIME ?? 0}s`,
  },
  {
    kind: 'TELEPORT', label: 'TELEPORT', color: '#5fe0c0', icon: 'locate-fixed', group: 'Motion',
    about: 'Moves the character at once, relative to itself or to a projectile.',
    fields: [
      f('POSITION', 'vec3', '0, 0, 5'),
      f('ROTATION', 'vec3', '0, 0, 0'),
      f('PROJECTILE TAG', 'str', ''),
      f('IGNORE WALLS', 'bool', true),
      f('RELATIVE FROM BRANCH', 'bool', false),
      lastHit,
    ],
    summary: (n) => (n['PROJECTILE TAG'] ? `to ${n['PROJECTILE TAG']}` : n.POSITION ?? ''),
  },
  {
    kind: 'LOOK', label: 'LOOK', color: '#7ad8ff', icon: 'eye', group: 'Motion',
    about: 'Turns the character to face its target for a time.',
    fields: [
      f('TIME', 'num', 1),
      f('SMOOTHNESS', 'num', 150),
      f('CAMERA DIRECTION', 'bool', false),
      f('HORIZONTAL ONLY', 'bool', false),
      f('GROUNDED', 'bool', false),
      f('RELATIVE FROM BRANCH', 'bool', false),
      lastHit,
    ],
    summary: (n) => `${n.TIME ?? 0}s`,
  },
  {
    kind: 'GRAB', label: 'CONNECT', color: '#5b8cff', icon: 'link', group: 'Motion',
    about: 'Holds the last one hit to a body part for a time.',
    fields: [
      f('BODY PART', 'choice', 'HumanoidRootPart', { options: BODY_PARTS, label: 'Your part' }),
      f('BODY PART2', 'choice', 'HumanoidRootPart', { options: BODY_PARTS, label: 'Their part' }),
      f('POSITION', 'vec3', '0, 0, 4'),
      f('ROTATION', 'vec3', '0, 180, 0'),
      f('TIME', 'num', 1),
      f('LAST HIT', 'num', 0.3, { hint: 'Grabs whoever was hit within this many seconds.' }),
    ],
    summary: (n) => `${n['BODY PART2'] ?? 'them'} → ${n['BODY PART'] ?? 'you'} · ${n.TIME ?? 0}s`,
  },
  {
    kind: 'HITBOX', label: 'HITBOX', color: '#9a7bff', icon: 'box', group: 'Combat',
    about: 'Hits whoever is inside a box in front of you. On a hit, you run BRANCH and they run BRANCH TARGET (or BRANCH FINISHER on a kill).',
    fields: [
      f('SIZE', 'vec3', '8, 8, 9'),
      f('POSITION', 'vec3', '0, 0, 4'),
      f('ROTATION', 'vec3', '0, 0, 0'),
      f('DAMAGE', 'num', 4),
      f('STUN', 'num', 0.75, { label: 'Stun (s)' }),
      f('BRANCH', 'branch', 'OnHit', { label: 'You run' }),
      f('BRANCH TARGET', 'branch', 'OnHitTarget', { label: 'They run' }),
      f('BRANCH FINISHER', 'branch', '', { label: 'On a kill' }),
      f('ATTACK TYPE', 'choice', 'Melee', { options: ATTACK_TYPES }),
      f('BLOCKABLE', 'bool', true),
      f('SINGLE TARGET', 'bool', false),
      f('HIT RAGDOLL', 'bool', false),
      f('STUN ANIM', 'bool', true),
      f('CAN KILL', 'bool', true),
      f('CANCEL ENEMY', 'bool', true),
      f('CLEAR KNOCKBACK', 'bool', false),
      f('IGNORE WAKEUP', 'bool', false),
      f('360 BLOCK', 'bool', false),
      f('HIT USER', 'bool', false),
      f('DEBREE', 'num', 0),
      f('PROJECTILE TAG', 'str', ''),
      f('PREVIEW', 'pair', [0, 15]),
    ],
    summary: (n) => `${n.DAMAGE ?? 0} dmg · ${n.SIZE ?? ''}`,
  },
  {
    kind: 'PROJECTILE', label: 'PROJECTILE', color: '#8f6bff', icon: 'send', group: 'Combat',
    about: 'Fires a projectile. Speed 0 leaves it in place, as an anchor for effects with the same PROJECTILE TAG.',
    fields: [
      f('PROJECTILE TAG', 'str', 'Projectile'),
      f('SPEED', 'num', 35),
      f('TIME', 'num', 2),
      f('SIZE', 'vec3', '6, 6, 6'),
      f('POSITION', 'vec3', '0, 0, 0'),
      f('ROTATION', 'vec3', '0, 0, 0'),
      f('DAMAGE', 'num', 0),
      f('STUN', 'num', 0),
      f('BRANCH TARGET', 'branch', '', { label: 'They run' }),
      f('BRANCH COLLIDED', 'branch', '', { label: 'On collision' }),
      f('ATTACK TYPE', 'choice', 'Bullet', { options: ATTACK_TYPES }),
      f('CONTINUE', 'bool', true, { hint: 'Keeps going after a hit.' }),
      f('AIM LAST HIT', 'num', -1),
      f('REFLECT COUNT', 'num', 0),
      f('CAN KILL', 'bool', false),
      f('BLOCKABLE', 'bool', false),
      f('HIT RAGDOLL', 'bool', false),
      f('STUN ANIM', 'bool', false),
      f('CANCEL ENEMY', 'bool', false),
      f('CLEAR KNOCKBACK', 'bool', false),
      f('IGNORE WAKEUP', 'bool', false),
      f('CANCEL PROJECTILE', 'bool', false),
      f('FILTER INTERVAL', 'num', 1),
      f('CACHE', 'bool', true),
      f('HIT USER', 'bool', false),
      f('360 BLOCK', 'bool', false),
      f('DEBREE', 'num', 0),
    ],
    summary: (n) => `${n['PROJECTILE TAG'] || '—'} · ${n.SPEED ?? 0} studs/s`,
  },
  {
    kind: 'COUNTER', label: 'COUNTER', color: '#c0b0ff', icon: 'shield-check', group: 'Combat',
    about: 'For a time, being hit by these attack types runs a branch instead.',
    fields: [
      f('TIME', 'num', 0.2),
      f('BRANCH', 'branch', ''),
      f('ATTACK TYPE2', 'str', 'Melee', { label: 'Attack types', hint: 'Comma-separated, like “Melee,Bullet”.' }),
      f('REFLECT', 'bool', false),
      f('REMOVE ON HIT', 'bool', true),
      f('CONTINUE', 'bool', false),
      f('CANCEL ENEMY', 'bool', false),
      f('STUN', 'num', 0),
    ],
    summary: (n) => `${n['ATTACK TYPE2'] ?? ''} → ${n.BRANCH || '—'} · ${n.TIME ?? 0}s`,
  },
  {
    kind: 'HPGIB', label: 'HEALTH', color: '#ff6b6b', icon: 'bomb', group: 'Combat',
    about: 'Changes health by AMOUNT.',
    fields: [f('AMOUNT', 'num', -2), f('CAN KILL', 'bool', true)],
    summary: (n) => `${n.AMOUNT ?? 0}`,
  },
  {
    kind: 'ULTGIB', label: 'AWK BAR', color: '#ffe066', icon: 'zap', group: 'Combat',
    about: 'Changes the awakening bar by AMOUNT.',
    fields: [f('AMOUNT', 'num', -100)],
    summary: (n) => `${n.AMOUNT ?? 0}`,
  },
  {
    kind: 'VISUAL', label: 'VISUAL', color: '#7ae7ff', icon: 'sparkles', group: 'Look',
    about: 'Shows an effect on a body part: it eases from the plain values to the ALT ones over TIME.',
    fields: [
      f('EFFECT', 'choice', 'Clash', { options: EFFECTS }),
      f('TIME', 'num', 0.5),
      f('BODY PART', 'choice', 'HumanoidRootPart', { options: BODY_PARTS }),
      f('TEXTURE', 'num', 0, { hint: 'A Roblox image ID, for Billboard, Overlay and Mesh.' }),
      f('SIZE', 'num', 1),
      f('ALT SIZE', 'num', 1),
      f('POSITION', 'vec3', '0, 0, 0'),
      f('ALT POSITION', 'vec3', '0, 0, 0'),
      f('ROTATION', 'vec3', '0, 0, 0'),
      f('ALT ROTATION', 'vec3', '0, 0, 0'),
      f('COLOR', 'color', '255, 255, 255'),
      f('ALT COLOR', 'color', '255, 255, 255'),
      f('OPACITY', 'num', 0, { hint: 'Roblox transparency: 0 is solid, 1 is invisible.' }),
      f('ALT OPACITY', 'num', 1),
      f('EASING STYLE', 'choice', 'Linear', { options: EASING_STYLES }),
      f('EASING DIRECTION', 'choice', 'In', { options: EASING_DIRECTIONS }),
      f('SIZE 2', 'vec3', '-1, -1, -1'),
      f('ALT SIZE 2', 'vec3', '-1, -1, -1'),
      f('AMOUNT', 'num', 1),
      f('PROJECTILE TAG', 'str', '', { hint: 'Follows that projectile.' }),
      f('VISUAL TAG', 'str', '', { hint: 'A name a “Cancel” effect can remove it by.' }),
      f('RELATIVE FROM BRANCH', 'bool', false),
      f('CAN COLLIDE', 'bool', false),
      f('CLIENT SIDED', 'bool', false),
      f('RUN ON SERVER', 'bool', false),
      f('CANCEL ON INTERRUPT', 'bool', false),
      lastHit,
    ],
    summary: (n) => `${n.EFFECT ?? 'Clash'}${n.TEXTURE ? ` ${n.TEXTURE}` : ''}`,
  },
  {
    kind: 'PARTICLE', label: 'PARTICLE', color: '#a0f0ff', icon: 'sparkles', group: 'Look',
    about: 'Emits particles with a Roblox texture.',
    fields: [
      f('TEXTURE', 'num', 0),
      f('EMIT COUNT', 'num', 1),
      f('LIFETIME', 'str', '0.2, 0.5'),
      f('SIZE', 'str', '1, 6'),
      f('SPEED', 'str', '0, 0'),
      f('SPREAD ANGLE', 'vec3', '0, 0, 0'),
      f('COLOR', 'color', '255,255,255'),
      f('TRANSPARENCY', 'str', '0, 1'),
      f('BRIGHTNESS', 'num', 1),
      f('LIGHT EMISSION', 'num', 1),
      f('LIGHT INFLUENCE', 'num', 1),
      f('ZOFFSET', 'num', 3),
      f('SHAPE', 'choice', 'Box', { options: ['Box', 'Cylinder', 'Sphere'] }),
      f('SHAPE INOUT', 'str', 'Outward'),
      f('SHAPE PARTIAL', 'num', 0),
      f('EMISSION DIRECTION', 'str', 'Top'),
      f('ORIENTATION TYPE', 'str', 'FacingCamera'),
      f('ROTATION', 'str', '0, 360'),
      f('ROT SPEED', 'str', '0, 0'),
      f('ACCELERATION', 'vec3', '0, 0, 0'),
      f('DRAG', 'num', 0),
      f('RATE', 'num', 0),
      f('DURATION', 'num', 0),
      f('LOCK TO PART', 'bool', false),
      f('BODY PART', 'choice', 'HumanoidRootPart', { options: BODY_PARTS }),
      f('POSITION', 'vec3', '0, 0, 0'),
      f('PART SIZE', 'vec3', '0, 0, 0'),
      f('SQUASH', 'str', '0, 0'),
      f('FLIPBOOK MODE', 'str', 'OneShot'),
      f('FLIPBOOK SIZE', 'str', '0, 0'),
      f('FLIPBOOK FRAMERATE', 'str', '10, 10'),
      f('PROJECTILE TAG', 'str', 'nil'),
      f('CLIENT SIDED', 'bool', false),
      f('CANCEL', 'bool', false),
      f('CANCEL ON INTERRUPT', 'bool', false),
      f('RUN ON SERVER', 'bool', false),
      lastHit,
    ],
    summary: (n) => `${n.TEXTURE ?? 0} × ${n['EMIT COUNT'] ?? 1}`,
  },
];

export const GROUPS = ['Flow', 'Motion', 'Combat', 'Look'];

const byKind = new Map(NODES.map((n) => [n.kind, n]));

// A kind's entry, or a plain one for kinds this doesn't know yet.
export function nodeInfo(kind) {
  return (
    byKind.get(kind) ?? {
      kind,
      label: kind || '?',
      color: '#dcdcdc',
      icon: 'info',
      group: 'Other',
      about: 'A node kind Webskill Shenanigans hasn’t seen before. Its fields are kept and exported as they are.',
      fields: [],
      summary: () => '',
    }
  );
}

// The line in the timeline: "[summary] LABEL".
export function nodeTitle(node) {
  const info = nodeInfo(node?.K_NAME);
  let detail = '';
  try {
    // JJS leaves out fields at their usual values: fill them in to describe it.
    const defaults = Object.fromEntries(info.fields.map((x) => [x.key, x.def]));
    detail = info.summary({ ...defaults, ...node });
  } catch {
    detail = '';
  }
  return { detail, label: info.label, color: info.color, icon: info.icon };
}

// A new node as the palette makes it: every known field at its default.
export function newNode(kind) {
  const node = { K_NAME: kind };
  for (const field of nodeInfo(kind).fields)
    node[field.key] = Array.isArray(field.def) ? [...field.def] : field.def;
  return node;
}

// Every field to show for a node: the known ones first, then any others it
// carries, typed by their values.
export function fieldsOf(node) {
  const info = nodeInfo(node?.K_NAME);
  const known = new Set(info.fields.map((x) => x.key));
  const extra = Object.keys(node ?? {})
    .filter((key) => key !== 'K_NAME' && !known.has(key))
    .map((key) => {
      const v = node[key];
      const type =
        typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? 'num' : Array.isArray(v) ? 'json' : v && typeof v === 'object' ? 'json' : 'str';
      return { key, type, def: v, unknown: true };
    });
  return [...info.fields, ...extra];
}

// "0, 1.5, -3" → [0, 1.5, -3]; anything missing is 0.
export function vec3(text, fallback = [0, 0, 0]) {
  if (Array.isArray(text)) return text.map(Number);
  const parts = String(text ?? '').split(',').map((s) => Number(s.trim()));
  return [0, 1, 2].map((i) => (Number.isFinite(parts[i]) ? parts[i] : fallback[i]));
}

export const rgbOf = (text) =>
  vec3(text, [255, 255, 255]).map((c) => Math.max(0, Math.min(255, c)));
