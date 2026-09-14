/* eslint-disable warp-drive/no-legacy-request-patterns -- ctx.save() here is the canvas API, not a data request */

// Player avatars: chibi anime doodles (think OMORI's sketchbook kids, or a
// tiny Attack on Titan Tribute Game cadet): a big round head with a soft chin,
// big eyes, a mop of hair and a small body. Plus little robots for computer
// players. An avatar is a small plain object, so it can be saved in
// localStorage and sent to other players as-is.
//
// Hair is described once, as a hairline: for each direction around the head,
// how far down from the crown the hair reaches. The 3D table turns that into a
// mesh (lazy/uno-scene.js) and the lobby portrait here traces the same line in
// 2D, so both always agree. Faces are drawn in 2D and wrapped onto the 3D head
// as a texture, so eyes, glasses and face piercings only need drawing once.

// All hairline heights are fractions of π measured from the crown: 0.5 is eye
// level, 1 the chin. `jag` × `strands` makes a spiky fringe, `part` sweeps it to
// one side, `center` lifts it into a middle parting, `volume` puffs the hair
// out from the head. The rest are extra pieces: `tufts` (spiky ends round the
// back), `curtain` (long hair down the back), `fin` (a mohawk), and so on.
export const HAIR_STYLES = [
  { id: 'messy', label: 'Messy fringe', front: 0.44, side: 0.56, back: 0.68, jag: 0.07, strands: 11, volume: 1.12 },
  { id: 'wolfcut', label: 'Wolf cut', front: 0.45, side: 0.63, back: 0.78, jag: 0.08, strands: 9, volume: 1.17, tufts: { count: 9, from: 0.35, to: 1, length: 0.3 } },
  { id: 'spiky', label: 'Anime spikes', front: 0.43, side: 0.58, back: 0.7, jag: 0.1, strands: 7, volume: 1.16, tufts: { count: 7, from: 0.25, to: 1, length: 0.26 }, crown: true },
  { id: 'undercut', label: 'Undercut', front: 0.46, side: 0.42, back: 0.5, jag: 0.04, strands: 10, volume: 1.13, center: 0.05 },
  { id: 'curtains', label: 'Curtains', front: 0.44, side: 0.6, back: 0.7, center: 0.14, volume: 1.12 },
  { id: 'emo', label: 'Side fringe', front: 0.46, side: 0.62, back: 0.72, part: 0.2, jag: 0.05, strands: 12, volume: 1.14 },
  { id: 'mullet', label: 'Mullet', front: 0.37, side: 0.5, back: 0.86, jag: 0.04, strands: 10, volume: 1.1, tufts: { count: 5, from: 0.7, to: 1, length: 0.22 } },
  { id: 'bowl', label: 'Bowl cut', front: 0.41, side: 0.56, back: 0.64, volume: 1.1 },
  { id: 'bob', label: 'Bob', front: 0.42, side: 0.72, back: 0.76, jag: 0.02, strands: 16, volume: 1.15 },
  { id: 'long', label: 'Long', front: 0.42, side: 0.66, back: 0.74, jag: 0.03, strands: 12, volume: 1.12, curtain: true },
  { id: 'hime', label: 'Hime cut', front: 0.45, side: 0.64, back: 0.74, volume: 1.12, curtain: true, locks: true },
  { id: 'ponytail', label: 'Ponytail', front: 0.34, side: 0.5, back: 0.6, jag: 0.04, strands: 9, volume: 1.08, ponytail: true },
  { id: 'twintails', label: 'Twin tails', front: 0.42, side: 0.56, back: 0.64, jag: 0.03, strands: 9, volume: 1.1, twintails: true },
  { id: 'braid', label: 'Braid', front: 0.38, side: 0.54, back: 0.62, center: 0.06, volume: 1.08, braid: true },
  { id: 'buns', label: 'Space buns', front: 0.41, side: 0.53, back: 0.63, jag: 0.03, strands: 9, volume: 1.09, buns: true },
  { id: 'bun', label: 'Bun', front: 0.33, side: 0.5, back: 0.6, volume: 1.07, bun: true },
  { id: 'pompadour', label: 'Pompadour', front: 0.3, side: 0.46, back: 0.58, volume: 1.08, quiff: true },
  { id: 'curly', label: 'Curly', front: 0.41, side: 0.6, back: 0.7, jag: 0.05, strands: 14, volume: 1.2, bumps: 0.06 },
  { id: 'afro', label: 'Afro', front: 0.33, side: 0.62, back: 0.74, volume: 1.42, lift: 0.07, bumps: 0.04 },
  { id: 'buzz', label: 'Buzz cut', front: 0.36, side: 0.5, back: 0.6, volume: 1.03 },
  { id: 'mohawk', label: 'Mohawk', front: 0.3, side: 0.42, back: 0.56, volume: 1.015, fin: true },
  { id: 'none', label: 'Bald', none: true },
];

export const EYES = [
  { id: 'anime', label: 'Anime' },
  { id: 'sharp', label: 'Sharp' },
  { id: 'omori', label: 'Half-lidded' },
  { id: 'sparkle', label: 'Sparkly' },
  { id: 'cat', label: 'Cat' },
  { id: 'teary', label: 'Teary' },
  { id: 'dots', label: 'Dots' },
  { id: 'happy', label: 'Happy' },
  { id: 'sleepy', label: 'Sleepy' },
  { id: 'blank', label: 'Blank' },
  { id: 'hearts', label: 'Hearts' },
  { id: 'dizzy', label: 'Dizzy' },
  { id: 'wink', label: 'Wink' },
];
export const BROWS = [
  { id: 'soft', label: 'Soft' },
  { id: 'thick', label: 'Thick' },
  { id: 'angry', label: 'Angry' },
  { id: 'worried', label: 'Worried' },
  { id: 'none', label: 'None' },
];
export const NOSES = [
  { id: 'none', label: 'None' },
  { id: 'line', label: 'Line' },
  { id: 'dot', label: 'Dot' },
];
export const MOUTHS = [
  { id: 'tiny', label: 'Tiny' },
  { id: 'smile', label: 'Smile' },
  { id: 'grin', label: 'Grin' },
  { id: 'fang', label: 'Fang' },
  { id: 'smirk', label: 'Smirk' },
  { id: 'open', label: 'Open' },
  { id: 'o', label: 'O' },
  { id: 'tongue', label: 'Tongue' },
  { id: 'cat', label: ':3' },
  { id: 'flat', label: 'Flat' },
  { id: 'frown', label: 'Frown' },
];
export const HATS = [
  { id: 'none', label: 'None' },
  { id: 'cap', label: 'Cap' },
  { id: 'beanie', label: 'Beanie' },
  { id: 'cat-ears', label: 'Cat ears' },
  { id: 'horns', label: 'Horns' },
  { id: 'crown', label: 'Crown' },
  { id: 'halo', label: 'Halo' },
  { id: 'headband', label: 'Headband' },
  { id: 'bow', label: 'Bow' },
  { id: 'flower', label: 'Flower' },
  { id: 'headphones', label: 'Headphones' },
];
export const EYEWEAR = [
  { id: 'none', label: 'None' },
  { id: 'round', label: 'Round glasses' },
  { id: 'square', label: 'Square glasses' },
  { id: 'shades', label: 'Shades' },
  { id: 'monocle', label: 'Monocle' },
  { id: 'eyepatch', label: 'Eyepatch' },
];
export const PIERCINGS = [
  { id: 'ear-studs', label: 'Ear studs' },
  { id: 'ear-hoops', label: 'Ear hoops' },
  { id: 'brow', label: 'Eyebrow' },
  { id: 'nose', label: 'Nose ring' },
  { id: 'septum', label: 'Septum' },
  { id: 'lip', label: 'Lip ring' },
  { id: 'snakebites', label: 'Snake bites' },
];
export const MARKS = [
  { id: 'freckles', label: 'Freckles' },
  { id: 'plaster', label: 'Plaster' },
  { id: 'scar', label: 'Scar' },
  { id: 'mole', label: 'Mole' },
  { id: 'blush-lines', label: 'Blush lines' },
];
export const NECKWEAR = [
  { id: 'none', label: 'None' },
  { id: 'scarf', label: 'Scarf' },
  { id: 'tie', label: 'Tie' },
  { id: 'choker', label: 'Choker' },
];
export const ROBOT_HEADS = [
  { id: 'box', label: 'Boxy' },
  { id: 'dome', label: 'Dome' },
  { id: 'tv', label: 'Telly' },
];
export const ROBOT_EYES = ['dots', 'big', 'happy', 'sleepy', 'blank', 'x'];
export const ROBOT_MOUTHS = ['tiny', 'smile', 'flat', 'grin'];
export const TYPES = [
  { id: 'human', label: 'Person' },
  { id: 'robot', label: 'Robot' },
];
export const SKIN_TONES = ['#FFFFFF', '#FFE9D6', '#F6CFA8', '#E3B083', '#C68B5E', '#8D5A3B', '#5C3A24'];
export const HAIR_COLORS = ['#141414', '#3B2A20', '#7A4A2A', '#E8C468', '#F2F2F2', '#9AA0AA', '#E5484D', '#3E7BE0', '#B388EB', '#FF8FAB', '#7ED6A5'];
export const EYE_COLORS = ['#2A2A2A', '#5A3A24', '#3E7BE0', '#30A46C', '#8E5BD9', '#D93A3A', '#E3A21A', '#6FC3DF'];
export const SHIRT_COLORS = ['#F2F2F2', '#2B2B33', '#3E7BE0', '#E5484D', '#30A46C', '#F2B90D', '#B388EB', '#FF8FAB', '#8A6A4A'];
export const PANTS_COLORS = ['#34343D', '#1B1B1B', '#4A5A7A', '#6B5A45', '#F2F2F2', '#7A2E2E'];
export const METAL_COLORS = ['#C9CED6', '#8E97A3', '#E8E1CF', '#6B7280', '#D4A373'];
export const GLOW_COLORS = ['#5CE1E6', '#FFDE59', '#FF6B8B', '#7ED957', '#C39BFF', '#FF914D'];

const HEX = /^#[0-9A-F]{6}$/i;
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const oneOf = (list, id, fallback) => (list.some((o) => (o.id ?? o) === id) ? id : fallback);
const hexOr = (value, fallback) => (HEX.test(value ?? '') ? value.toUpperCase() : fallback);
const someOf = (list, values) => (Array.isArray(values) ? list.map((o) => o.id).filter((id) => values.includes(id)) : []);

export const hairStyle = (id) => HAIR_STYLES.find((s) => s.id === id) ?? HAIR_STYLES[0];

// The sketchbook kid: pale skin, a black messy fringe with a strand sticking up, big dark eyes.
export const DEFAULT_AVATAR = {
  type: 'human',
  skin: '#FFFFFF',
  hair: 'messy',
  hairColor: '#141414',
  ahoge: true,
  eyes: 'anime',
  eyeColor: '#2A2A2A',
  brows: 'soft',
  nose: 'none',
  mouth: 'tiny',
  blush: false,
  shirt: '#F2F2F2',
  pants: '#34343D',
  hat: 'none',
  eyewear: 'none',
  piercings: [],
  marks: [],
  neck: 'none',
  head: 'box',
};

export function randomAvatar() {
  return {
    ...DEFAULT_AVATAR,
    skin: pick(SKIN_TONES),
    hair: pick(HAIR_STYLES.slice(0, -1)).id,
    hairColor: pick(HAIR_COLORS),
    ahoge: Math.random() < 0.3,
    eyes: pick(EYES.slice(0, 8)).id,
    eyeColor: pick(EYE_COLORS),
    brows: pick(BROWS).id,
    nose: pick(NOSES).id,
    mouth: pick(MOUTHS).id,
    blush: Math.random() < 0.4,
    shirt: pick(SHIRT_COLORS),
    pants: pick(PANTS_COLORS),
    hat: Math.random() < 0.7 ? 'none' : pick(HATS).id,
    eyewear: Math.random() < 0.8 ? 'none' : pick(EYEWEAR).id,
    piercings: PIERCINGS.filter(() => Math.random() < 0.12).map((p) => p.id),
    marks: MARKS.filter(() => Math.random() < 0.12).map((m) => m.id),
    neck: Math.random() < 0.8 ? 'none' : pick(NECKWEAR).id,
  };
}

// A computer player's robot, always the same one for the same seed and seat.
export function robotAvatar(seed, index) {
  let n = ((Number(seed) || 1) ^ Math.imul(index + 1, 2654435761)) >>> 0;
  const next = (list) => {
    n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
    return list[n % list.length];
  };
  return {
    ...DEFAULT_AVATAR,
    type: 'robot',
    skin: next(METAL_COLORS),
    hairColor: next(GLOW_COLORS),
    eyes: next(ROBOT_EYES),
    mouth: next(ROBOT_MOUTHS),
    blush: next([true, false]),
    shirt: next(SHIRT_COLORS),
    head: next(ROBOT_HEADS).id,
  };
}

// Older saved avatars had a single `extra` slot; it maps onto the new ones.
const LEGACY_EXTRA = { glasses: { eyewear: 'round' }, bow: { hat: 'bow' }, cap: { hat: 'cap' }, halo: { hat: 'halo' }, headphones: { hat: 'headphones' }, bandage: { marks: ['plaster'] } };
const LEGACY_EYES = { ringed: 'omori', tired: 'omori', big: 'anime' };

// Anything that arrives from storage or another player is untrusted: keep only known values.
export function normaliseAvatar(avatar) {
  const raw = avatar && typeof avatar === 'object' ? avatar : {};
  const a = { ...(LEGACY_EXTRA[raw.extra] ?? {}), ...raw };
  const d = DEFAULT_AVATAR;
  const type = oneOf(TYPES, a.type, 'human');
  const eyes = LEGACY_EYES[a.eyes] ?? a.eyes;
  return {
    type,
    skin: hexOr(a.skin, d.skin),
    hair: oneOf(HAIR_STYLES, a.hair, d.hair),
    hairColor: hexOr(a.hairColor, d.hairColor),
    ahoge: Boolean(a.ahoge),
    eyes: type === 'robot' ? oneOf(ROBOT_EYES, a.eyes, 'dots') : oneOf(EYES, eyes, d.eyes),
    eyeColor: hexOr(a.eyeColor, d.eyeColor),
    brows: oneOf(BROWS, a.brows, d.brows),
    nose: oneOf(NOSES, a.nose, d.nose),
    mouth: oneOf(MOUTHS, a.mouth, d.mouth),
    blush: Boolean(a.blush),
    shirt: hexOr(a.shirt, d.shirt),
    pants: hexOr(a.pants, d.pants),
    hat: oneOf(HATS, a.hat, 'none'),
    eyewear: oneOf(EYEWEAR, a.eyewear, 'none'),
    piercings: someOf(PIERCINGS, a.piercings),
    marks: someOf(MARKS, a.marks),
    neck: oneOf(NECKWEAR, a.neck, 'none'),
    head: oneOf(ROBOT_HEADS, a.head, 'box'),
  };
}

export const avatarKey = (avatar) =>
  Object.values(normaliseAvatar(avatar))
    .map((v) => (Array.isArray(v) ? v.join('+') : v))
    .join('|');

// ─── Hairline ─────────────────────────────────────────────────────────

const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
// A sawtooth folded into a triangle, 0..1.
const tri = (x) => 1 - Math.abs(((x % 2) + 2) % 2 - 1) * 2;

// How far down (radians from the crown) the hair reaches at azimuth `a`
// (0 = straight ahead, ±π = the back of the head, positive = the avatar's left).
export function hairline(style, a) {
  const t = Math.min(1, Math.abs(a) / Math.PI);
  let reach = t < 0.5 ? lerp(style.front, style.side, smooth(t * 2)) : lerp(style.side, style.back, smooth((t - 0.5) * 2));
  const frontness = Math.max(0, 1 - t * 2.4);
  if (style.jag) reach += style.jag * frontness * Math.abs(tri((a / Math.PI) * style.strands));
  if (style.part) reach += style.part * Math.sin(a) * frontness;
  // A middle parting: the fringe lifts in the centre and falls away to both sides.
  if (style.center) reach -= style.center * Math.max(0, 1 - Math.abs(a) * 2.2);
  return reach * Math.PI;
}

// Gentle lumps for curly and afro hair, as a radius multiplier.
export function hairBumps(style, a, polar) {
  return style.bumps ? 1 + style.bumps * Math.sin(a * 9) * Math.sin(polar * 9) : 1;
}

// A softer, anime head: round on top, narrowing a little towards the chin.
export function headTaper(y, radius) {
  if (y >= 0) return 1;
  const t = Math.min(1, -y / radius);
  return 1 - 0.17 * t ** 1.6;
}

// ─── Faces ────────────────────────────────────────────────────────────

const INK = '#141414';
const EYE_Y = 54;
const EYE_DX = 21.5;

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const channel = (shift) => Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * (1 + amount))));
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

// Draws the face centred in a size×size square, on a transparent background.
// `blink` (0–1) closes the eyes, for the idle animation.
export function drawFace(ctx, avatarInput, size, { blink = 0 } = {}) {
  const avatar = normaliseAvatar(avatarInput);
  if (avatar.type === 'robot') return drawRobotFace(ctx, avatar, size, { blink });
  const s = size / 100;
  ctx.save();
  ctx.scale(s, s);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 3;

  const line = (x1, y1, x2, y2, width = 3) => {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  const dot = (x, y, r, color = INK) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const ring = (x, y, r, width = 1.6, color = '#C9CED6') => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = INK;
  };
  const marks = new Set(avatar.marks);
  const piercings = new Set(avatar.piercings);

  if (avatar.blush) {
    ctx.fillStyle = 'rgba(255, 110, 130, 0.42)';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(50 + side * 31, 69, 8.5, 4.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (marks.has('blush-lines')) {
    ctx.strokeStyle = '#E86A7F';
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) line(50 + side * (23 + i * 4), 74, 50 + side * (21 + i * 4), 70, 1.6);
    ctx.strokeStyle = INK;
  }
  if (marks.has('freckles')) {
    for (const side of [-1, 1]) for (const [dx, dy] of [[22, 68], [27, 71], [31, 67], [25, 65]]) dot(50 + side * dx, dy, 0.9, '#B07A55');
  }

  // Brows sit just above the eyes; a fringe drawn over the face in 3D may hide them, which is fine.
  const browY = EYE_Y - 21;
  for (const side of [-1, 1]) {
    const x = 50 + side * EYE_DX;
    ctx.strokeStyle = INK;
    switch (avatar.brows) {
      case 'thick':
        line(x - 8, browY + 1, x + 8, browY - 1 * side, 4.2);
        break;
      case 'angry':
        line(x - side * 9, browY - 3, x + side * 7, browY + 3, 3.6);
        break;
      case 'worried':
        line(x - side * 9, browY + 3, x + side * 7, browY - 3, 3);
        break;
      case 'soft':
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(x - 7, browY + 1);
        ctx.quadraticCurveTo(x, browY - 3, x + 7, browY + 1);
        ctx.stroke();
        break;
      default:
        break;
    }
  }
  if (piercings.has('brow')) {
    dot(50 + EYE_DX + 8, browY - 3, 1.4, '#C9CED6');
    dot(50 + EYE_DX + 10, browY + 2, 1.4, '#C9CED6');
  }

  const closed = blink > 0.5 && !['happy', 'sleepy', 'dizzy'].includes(avatar.eyes);
  for (const side of [-1, 1]) {
    const x = 50 + side * EYE_DX;
    const y = EYE_Y;
    if (avatar.eyewear === 'eyepatch' && side === 1) continue;
    if (closed || (avatar.eyes === 'wink' && side === 1)) {
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(x - 9, y);
      ctx.quadraticCurveTo(x, y + 4, x + 9, y);
      ctx.stroke();
      continue;
    }
    drawEye(ctx, avatar, x, y, side);
  }

  if (avatar.nose === 'line') {
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(51, 66);
    ctx.quadraticCurveTo(52.5, 70, 50, 71.5);
    ctx.stroke();
  } else if (avatar.nose === 'dot') {
    dot(50, 69.5, 1.3);
  }
  if (piercings.has('nose')) ring(53.5, 70.5, 2.2);
  if (piercings.has('septum')) {
    ctx.strokeStyle = '#C9CED6';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(50, 72.5, 2.4, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.stroke();
    ctx.strokeStyle = INK;
  }

  drawMouth(ctx, avatar.mouth, 77);
  if (piercings.has('lip')) ring(50, 81, 2.2);
  if (piercings.has('snakebites')) for (const side of [-1, 1]) dot(50 + side * 5.5, 81, 1.3, '#C9CED6');

  if (marks.has('plaster')) {
    ctx.save();
    ctx.translate(71, 70);
    ctx.rotate(-0.45);
    ctx.fillStyle = '#F4D3B0';
    ctx.fillRect(-8, -3.5, 16, 7);
    ctx.lineWidth = 1.4;
    ctx.strokeRect(-8, -3.5, 16, 7);
    line(-2, -3.5, -2, 3.5, 1.2);
    line(2, -3.5, 2, 3.5, 1.2);
    ctx.restore();
  }
  if (marks.has('scar')) {
    ctx.strokeStyle = '#B5566A';
    line(24, 46, 33, 70, 1.8);
    for (let i = 0; i < 3; i++) line(26 + i * 3, 52 + i * 6, 32 + i * 3, 50 + i * 6, 1.4);
    ctx.strokeStyle = INK;
  }
  if (marks.has('mole')) dot(60, 77, 1.1);

  drawEyewear(ctx, avatar.eyewear);
  ctx.restore();
}

function drawEye(ctx, avatar, x, y, side) {
  const iris = avatar.eyeColor;
  const dot = (cx, cy, r, color = INK) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  };
  // The big anime eye everything else is a variation of.
  const animeEye = ({ rx = 12.5, ry = 15, lid = 0, slit = false, sparkle = false, lashes = true } = {}) => {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y + 1, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#fff';
    ctx.fillRect(x - rx, y - ry, rx * 2, ry * 2 + 2);
    const gradient = ctx.createLinearGradient(0, y - ry, 0, y + ry);
    gradient.addColorStop(0, shade(iris, -0.45));
    gradient.addColorStop(0.65, iris);
    gradient.addColorStop(1, shade(iris, 0.35));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(x, y + 2.5, rx * 0.8, ry * 0.88, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.beginPath();
    if (slit) ctx.ellipse(x, y + 2.5, rx * 0.16, ry * 0.62, 0, 0, Math.PI * 2);
    else ctx.ellipse(x, y + 3, rx * 0.36, ry * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    if (sparkle) {
      star(ctx, x - side * 2.5, y - 3.5, 3.6);
      dot(x + side * 3, y + 6, 1.4, '#fff');
    } else {
      dot(x - side * 3, y - 3.5, 3, '#fff');
      dot(x + side * 3.2, y + 6, 1.5, '#fff');
    }
    // A heavy lid drops over the top of the eye for sharp and sleepy looks.
    if (lid) {
      ctx.fillStyle = avatar.skin;
      ctx.beginPath();
      ctx.moveTo(x - rx - 2, y - ry - 2);
      ctx.lineTo(x + rx + 2, y - ry - 2);
      ctx.lineTo(x + side * (rx + 2), y - ry + lid * ry * 2 + side * -2.5);
      ctx.lineTo(x - side * (rx + 2), y - ry + lid * ry * 2 + side * 2.5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = INK;
    if (lid) {
      ctx.lineWidth = 4.2;
      ctx.beginPath();
      ctx.moveTo(x - side * (rx + 2), y - ry + lid * ry * 2 + side * 2.5);
      ctx.lineTo(x + side * (rx + 3), y - ry + lid * ry * 2 + side * -2.5);
      ctx.stroke();
    } else if (lashes) {
      // Upper lash line, heavier at the outer corner, with a little flick.
      ctx.lineWidth = 4.2;
      ctx.beginPath();
      ctx.moveTo(x - side * (rx + 1), y - 2);
      ctx.quadraticCurveTo(x - side * 2, y - ry - 4.5, x + side * (rx + 2), y - 4);
      ctx.lineTo(x + side * (rx + 4.5), y - 6.5);
      ctx.stroke();
    }
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(x - rx * 0.55, y + ry + 1.5);
    ctx.quadraticCurveTo(x, y + ry + 2.8, x + rx * 0.55, y + ry + 1.5);
    ctx.stroke();
  };

  switch (avatar.eyes) {
    case 'sharp':
      animeEye({ rx: 13, ry: 12.5, lid: 0.35 });
      break;
    case 'sparkle':
      animeEye({ sparkle: true });
      break;
    case 'cat':
      animeEye({ rx: 12.5, ry: 14.5, slit: true });
      break;
    case 'teary':
      animeEye();
      ctx.fillStyle = 'rgba(120, 190, 255, 0.85)';
      ctx.beginPath();
      ctx.moveTo(x + side * 7, y + 12);
      ctx.quadraticCurveTo(x + side * 11, y + 20, x + side * 7, y + 22);
      ctx.quadraticCurveTo(x + side * 3, y + 20, x + side * 7, y + 12);
      ctx.fill();
      break;
    case 'omori': {
      // Round rims with a heavy lid across the middle and the pupil sitting low.
      const rx = 13;
      const ry = 12.5;
      const lid = y - 1.5;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - rx, lid, rx * 2, ry * 2);
      dot(x - side * 1.4, y + 4, 3.4, avatar.eyeColor === '#2A2A2A' ? INK : avatar.eyeColor);
      ctx.restore();
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 4.4;
      ctx.beginPath();
      ctx.moveTo(x - rx - 2, lid + 1);
      ctx.quadraticCurveTo(x, lid - 1.6, x + rx + 2, lid + 1);
      ctx.stroke();
      break;
    }
    case 'happy':
      ctx.lineWidth = 3.6;
      ctx.beginPath();
      ctx.arc(x, y + 5, 8, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      break;
    case 'sleepy':
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.arc(x, y - 2, 8, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      break;
    case 'blank':
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(x, y, 9, 10.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.stroke();
      dot(x, y + 1, 1.9);
      break;
    case 'hearts':
      ctx.fillStyle = '#E5484D';
      heart(ctx, x, y + 1, 9);
      ctx.lineWidth = 2;
      ctx.stroke();
      break;
    case 'dizzy':
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const t = (i / 40) * Math.PI * 5;
        const r = (i / 40) * 9;
        ctx.lineTo(x + Math.cos(t) * r * side, y + Math.sin(t) * r);
      }
      ctx.stroke();
      break;
    case 'dots':
      dot(x, y + 1, 4.6);
      dot(x - side * 1.4, y - 0.6, 1.3, '#fff');
      break;
    default:
      animeEye();
  }
}

function drawMouth(ctx, mouth, my) {
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 2.8;
  const path = (draw) => {
    ctx.beginPath();
    draw();
    ctx.stroke();
  };
  switch (mouth) {
    case 'tiny':
      path(() => {
        ctx.moveTo(47, my);
        ctx.quadraticCurveTo(50, my + 1.2, 53, my - 0.2);
      });
      break;
    case 'smile':
      path(() => ctx.arc(50, my - 5, 7, Math.PI * 0.25, Math.PI * 0.75));
      break;
    case 'grin':
    case 'fang':
      ctx.beginPath();
      ctx.moveTo(42, my - 3);
      ctx.quadraticCurveTo(50, my + 9, 58, my - 3);
      ctx.closePath();
      ctx.fillStyle = mouth === 'grin' ? '#fff' : '#7A2C3A';
      ctx.fill();
      ctx.stroke();
      if (mouth === 'fang') {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(44.5, my - 2.6);
        ctx.lineTo(46.5, my + 2.5);
        ctx.lineTo(48.5, my - 2.2);
        ctx.fill();
      }
      break;
    case 'smirk':
      path(() => {
        ctx.moveTo(45, my + 1);
        ctx.quadraticCurveTo(52, my + 2, 56, my - 3);
      });
      break;
    case 'open':
      ctx.beginPath();
      ctx.moveTo(43, my - 2);
      ctx.quadraticCurveTo(50, my - 3, 57, my - 2);
      ctx.quadraticCurveTo(50, my + 10, 43, my - 2);
      ctx.fillStyle = '#7A2C3A';
      ctx.fill();
      ctx.stroke();
      break;
    case 'o':
      path(() => ctx.ellipse(50, my, 3.2, 4, 0, 0, Math.PI * 2));
      break;
    case 'tongue':
      path(() => ctx.arc(50, my - 4, 6, Math.PI * 0.2, Math.PI * 0.8));
      ctx.fillStyle = '#FF7E93';
      ctx.beginPath();
      ctx.ellipse(51.5, my + 2.8, 3, 3.6, 0, 0, Math.PI);
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.stroke();
      break;
    case 'cat':
      path(() => {
        ctx.arc(46, my - 1, 4, 0, Math.PI);
        ctx.arc(54, my - 1, 4, 0, Math.PI);
      });
      break;
    case 'flat':
      path(() => {
        ctx.moveTo(44, my);
        ctx.lineTo(56, my);
      });
      break;
    case 'frown':
      path(() => ctx.arc(50, my + 7, 7, Math.PI * 1.2, Math.PI * 1.8));
      break;
    default:
      break;
  }
}

function drawEyewear(ctx, eyewear) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.6;
  const bridge = () => {
    ctx.beginPath();
    ctx.moveTo(50 - EYE_DX + 16, EYE_Y - 2);
    ctx.quadraticCurveTo(50, EYE_Y - 5, 50 + EYE_DX - 16, EYE_Y - 2);
    ctx.stroke();
  };
  switch (eyewear) {
    case 'round':
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(50 + side * EYE_DX, EYE_Y + 1, 16, 0, Math.PI * 2);
        ctx.stroke();
      }
      bridge();
      break;
    case 'square':
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.roundRect(50 + side * EYE_DX - 16, EYE_Y - 12, 32, 26, 5);
        ctx.stroke();
      }
      bridge();
      break;
    case 'shades':
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.roundRect(50 + side * EYE_DX - 16, EYE_Y - 11, 32, 22, [3, 3, 11, 11]);
        ctx.fillStyle = 'rgba(20, 20, 20, 0.92)';
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(50 + side * EYE_DX - 9, EYE_Y - 6, 6, 3);
      }
      bridge();
      break;
    case 'monocle':
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = '#C8A24A';
      ctx.beginPath();
      ctx.arc(50 + EYE_DX, EYE_Y + 1, 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(50 + EYE_DX + 10, EYE_Y + 13);
      ctx.quadraticCurveTo(50 + EYE_DX + 16, EYE_Y + 24, 50 + EYE_DX + 8, EYE_Y + 36);
      ctx.stroke();
      break;
    case 'eyepatch':
      ctx.fillStyle = '#1B1B1B';
      ctx.beginPath();
      ctx.ellipse(50 + EYE_DX, EYE_Y + 1, 15, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(50 + EYE_DX - 10, EYE_Y - 6);
      ctx.lineTo(8, EYE_Y - 26);
      ctx.moveTo(50 + EYE_DX + 10, EYE_Y - 6);
      ctx.lineTo(96, EYE_Y - 18);
      ctx.stroke();
      break;
    default:
      break;
  }
}

function star(ctx, x, y, r) {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const radius = i % 2 ? r * 0.35 : r;
    const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
    ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
  }
  ctx.fill();
}

function heart(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.9);
  ctx.bezierCurveTo(x - r * 1.4, y - r * 0.1, x - r * 0.6, y - r * 1.1, x, y - r * 0.35);
  ctx.bezierCurveTo(x + r * 0.6, y - r * 1.1, x + r * 1.4, y - r * 0.1, x, y + r * 0.9);
  ctx.fill();
}

// A robot's face is a dark screen with glowing features in its accent colour.
function drawRobotFace(ctx, avatar, size, { blink = 0 } = {}) {
  const s = size / 100;
  const glow = avatar.hairColor;
  ctx.save();
  ctx.scale(s, s);
  ctx.fillStyle = '#1A1D24';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(14, 28, 72, 58, 14);
  ctx.fill();
  ctx.stroke();

  ctx.shadowColor = glow;
  ctx.shadowBlur = 6;
  ctx.fillStyle = glow;
  ctx.strokeStyle = glow;
  ctx.lineCap = 'round';
  ctx.lineWidth = 4;
  const closed = blink > 0.5;
  for (const side of [-1, 1]) {
    const x = 50 + side * 16;
    const y = 50;
    ctx.beginPath();
    if (closed) {
      ctx.moveTo(x - 6, y);
      ctx.lineTo(x + 6, y);
      ctx.stroke();
      continue;
    }
    switch (avatar.eyes) {
      case 'big':
        ctx.roundRect(x - 6, y - 8, 12, 16, 4);
        ctx.fill();
        break;
      case 'happy':
        ctx.arc(x, y + 3, 6, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
        break;
      case 'sleepy':
        ctx.fillRect(x - 7, y - 1, 14, 5);
        break;
      case 'blank':
        ctx.lineWidth = 3;
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 4;
        break;
      case 'x':
        ctx.moveTo(x - 6, y - 5);
        ctx.lineTo(x + 6, y + 5);
        ctx.moveTo(x - 6, y + 5);
        ctx.lineTo(x + 6, y - 5);
        ctx.stroke();
        break;
      default:
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
    }
  }
  ctx.beginPath();
  switch (avatar.mouth) {
    case 'smile':
      ctx.arc(50, 64, 9, Math.PI * 0.2, Math.PI * 0.8);
      ctx.stroke();
      break;
    case 'grin':
      // A little equaliser.
      for (let i = 0; i < 5; i++) ctx.fillRect(38 + i * 5, 72 - [4, 8, 11, 7, 4][i], 3, [4, 8, 11, 7, 4][i]);
      break;
    case 'flat':
      ctx.moveTo(40, 72);
      ctx.lineTo(60, 72);
      ctx.stroke();
      break;
    default:
      ctx.moveTo(45, 72);
      ctx.lineTo(55, 72);
      ctx.stroke();
  }
  if (avatar.blush) {
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#FF6B8B';
    for (const side of [-1, 1]) ctx.fillRect(50 + side * 28 - 4, 62, 8, 4);
  }
  ctx.restore();
}

// ─── Lobby portrait ───────────────────────────────────────────────────

// A head-and-shoulders portrait, drawn to fill a size×size canvas. It traces
// the same hairline as the 3D model, seen straight on.
export function drawPortrait(ctx, avatarInput, size) {
  const a = normaliseAvatar(avatarInput);
  const s = size / 100;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.scale(s, s);
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;

  const shape = (draw, fill) => {
    ctx.beginPath();
    draw();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.stroke();
  };

  const hx = 50;
  const hy = 44;
  const r = 31;

  if (a.type === 'robot') {
    drawRobotPortrait(ctx, a, shape, hx, hy, r);
    ctx.restore();
    return;
  }

  // Shoulders, and whatever's round the neck.
  shape(() => {
    ctx.moveTo(26, 104);
    ctx.quadraticCurveTo(28, 80, 50, 80);
    ctx.quadraticCurveTo(72, 80, 74, 104);
  }, a.shirt);
  if (a.neck === 'tie') shape(() => {
    ctx.moveTo(50, 81);
    ctx.lineTo(45, 86);
    ctx.lineTo(50, 102);
    ctx.lineTo(55, 86);
    ctx.closePath();
  }, '#C23B3B');

  const style = hairStyle(a.hair);
  const hr = r * (style.volume ?? 1);
  const cy = hy - (style.lift ?? 0) * r;
  // A point on the hair sphere at azimuth `az` and polar angle `p`, seen from the front.
  const at = (radius, az, p) => {
    const y = -Math.cos(p) * radius;
    return [hx + Math.sin(p) * Math.sin(az) * radius * headTaper(y, r), cy + y];
  };

  if (!style.none) {
    // Behind the head: tails, buns and the length that hangs past the face.
    if (style.curtain) shape(() => ctx.roundRect(hx - hr, cy - 4, hr * 2, r + 24, [4, 4, 16, 16]), a.hairColor);
    if (style.twintails) for (const side of [-1, 1]) shape(() => ctx.ellipse(hx + side * (hr + 2), cy + 22, 9, 22, side * -0.15, 0, Math.PI * 2), a.hairColor);
    if (style.bun) shape(() => ctx.arc(hx, cy - hr - 2, 11, 0, Math.PI * 2), a.hairColor);
    if (style.buns) for (const side of [-1, 1]) shape(() => ctx.arc(hx + side * 20, cy - hr + 2, 10, 0, Math.PI * 2), a.hairColor);
    if (style.ponytail) shape(() => ctx.ellipse(hx + hr - 2, cy + 8, 7, 18, -0.35, 0, Math.PI * 2), a.hairColor);
    if (style.braid) shape(() => ctx.ellipse(hx + hr - 6, cy + 26, 6, 16, -0.2, 0, Math.PI * 2), a.hairColor);
    // The sides of the hair, down to where it ends at the side of the head.
    const sideReach = Math.max(hairline(style, Math.PI / 2), hairline(style, Math.PI));
    shape(() => {
      const steps = 24;
      for (let i = 0; i <= steps; i++) ctx.lineTo(...at(hr, Math.PI / 2, (i / steps) * sideReach));
      for (let i = steps; i >= 0; i--) ctx.lineTo(...at(hr, -Math.PI / 2, (i / steps) * sideReach));
      ctx.closePath();
    }, a.hairColor);
    if (style.tufts) {
      shape(() => {
        for (const side of [-1, 1]) {
          const [x, y] = at(hr, side * Math.PI * 0.55, sideReach * 0.96);
          ctx.moveTo(x - side * 4, y - 8);
          ctx.lineTo(x + side * 7, y + 6);
          ctx.lineTo(x - side * 2, y - 1);
          ctx.lineTo(x + side * 2, y + 9);
          ctx.lineTo(x - side * 7, y - 2);
        }
      }, a.hairColor);
    }
  }

  // Ears (with any earrings), then the head.
  for (const side of [-1, 1]) shape(() => ctx.ellipse(hx + side * (r - 2), hy + 4, 5, 8, 0, 0, Math.PI * 2), a.skin);
  if (a.piercings.includes('ear-studs')) for (const side of [-1, 1]) {
    ctx.fillStyle = '#E3E6EA';
    ctx.beginPath();
    ctx.arc(hx + side * (r - 1), hy + 10, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  if (a.piercings.includes('ear-hoops')) for (const side of [-1, 1]) {
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#E3C15A';
    ctx.beginPath();
    ctx.arc(hx + side * (r - 1), hy + 13, 3.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
  }
  shape(() => {
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const y = Math.sin(t) * r;
      ctx.lineTo(hx + Math.cos(t) * r * headTaper(-y, r), hy + y);
    }
    ctx.closePath();
  }, a.skin);

  // The face patch spans ±0.85 rad across and ±0.78 rad up and down on the 3D head.
  ctx.save();
  ctx.translate(hx, hy);
  ctx.scale((0.85 * r) / 50, (0.78 * r) / 50);
  ctx.translate(-50, -50);
  drawFace(ctx, a, 100);
  ctx.restore();

  if (a.neck === 'scarf') shape(() => ctx.roundRect(30, 74, 40, 11, 5), '#C23B3B');
  if (a.neck === 'choker') {
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(40, 78);
    ctx.quadraticCurveTo(50, 82, 60, 78);
    ctx.stroke();
    ctx.lineWidth = 3;
  }

  if (!style.none) {
    // The hair over the face: down each side, then the hairline across the front.
    shape(() => {
      const steps = 48;
      const right = hairline(style, Math.PI / 2);
      for (let i = 0; i <= 12; i++) ctx.lineTo(...at(hr, Math.PI / 2, (i / 12) * right));
      for (let i = 0; i <= steps; i++) {
        const az = Math.PI / 2 - (i / steps) * Math.PI;
        ctx.lineTo(...at(hr, az, hairline(style, az)));
      }
      const left = hairline(style, -Math.PI / 2);
      for (let i = 12; i >= 0; i--) ctx.lineTo(...at(hr, -Math.PI / 2, (i / 12) * left));
      ctx.closePath();
    }, a.hairColor);
    if (style.locks) for (const side of [-1, 1]) shape(() => ctx.roundRect(hx + side * (r - 2) - 5, hy - 6, 10, 34, 5), a.hairColor);
    if (style.quiff) shape(() => ctx.ellipse(hx + 3, cy - hr + 2, 20, 11, -0.15, 0, Math.PI * 2), a.hairColor);
    if (style.crown) {
      shape(() => {
        for (let i = 0; i < 4; i++) {
          const x = hx - 18 + i * 12;
          ctx.moveTo(x - 7, cy - hr + 8);
          ctx.lineTo(x + 3, cy - hr - 8 + Math.abs(i - 1.5) * 3);
          ctx.lineTo(x + 7, cy - hr + 8);
        }
      }, a.hairColor);
    }
    if (style.fin) {
      shape(() => {
        for (let i = 0; i < 4; i++) {
          const x = hx - 9 + i * 6;
          ctx.moveTo(x - 4, cy - hr + 4);
          ctx.lineTo(x + 1, cy - hr - 18 + i * 2);
          ctx.lineTo(x + 5, cy - hr + 4);
        }
      }, a.hairColor);
    }
  }
  if (a.ahoge && !style.none) {
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(hx + 2, cy - hr + 2);
    ctx.bezierCurveTo(hx - 2, cy - hr - 12, hx + 14, cy - hr - 16, hx + 10, cy - hr - 8);
    ctx.strokeStyle = a.hairColor;
    ctx.stroke();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.lineWidth = 3;
  }

  drawHat2D(ctx, a, shape, hx, hy, cy, r, hr);
  ctx.restore();
}

function drawHat2D(ctx, a, shape, hx, hy, cy, r, hr) {
  const top = cy - hr;
  switch (a.hat) {
    case 'bow':
      shape(() => {
        const bx = hx + 18;
        const by = top + 8;
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - 12, by - 9);
        ctx.lineTo(bx - 12, by + 9);
        ctx.closePath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + 12, by - 9);
        ctx.lineTo(bx + 12, by + 9);
        ctx.closePath();
      }, '#FF6B8B');
      break;
    case 'cap':
      shape(() => {
        ctx.arc(hx, hy - 6, hr + 2, Math.PI, 0);
        ctx.closePath();
      }, a.shirt);
      shape(() => ctx.roundRect(hx - 6, hy - 10, r + 16, 7, 3), a.shirt);
      break;
    case 'beanie':
      shape(() => {
        ctx.arc(hx, hy - 4, hr + 3, Math.PI, 0);
        ctx.closePath();
      }, '#E5484D');
      shape(() => ctx.roundRect(hx - hr - 4, hy - 10, (hr + 4) * 2, 9, 4), '#B8333A');
      shape(() => ctx.arc(hx, top - 8, 6, 0, Math.PI * 2), '#F2F2F2');
      break;
    case 'cat-ears':
      for (const side of [-1, 1]) shape(() => {
        ctx.moveTo(hx + side * 12, top + 8);
        ctx.lineTo(hx + side * 24, top - 12);
        ctx.lineTo(hx + side * 30, top + 14);
        ctx.closePath();
      }, a.hairColor);
      break;
    case 'horns':
      for (const side of [-1, 1]) shape(() => {
        ctx.moveTo(hx + side * 10, top + 8);
        ctx.quadraticCurveTo(hx + side * 22, top - 4, hx + side * 26, top - 16);
        ctx.quadraticCurveTo(hx + side * 26, top + 2, hx + side * 18, top + 12);
        ctx.closePath();
      }, '#E8E1CF');
      break;
    case 'crown':
      shape(() => {
        ctx.moveTo(hx - 16, top + 8);
        ctx.lineTo(hx - 18, top - 10);
        ctx.lineTo(hx - 8, top);
        ctx.lineTo(hx, top - 14);
        ctx.lineTo(hx + 8, top);
        ctx.lineTo(hx + 18, top - 10);
        ctx.lineTo(hx + 16, top + 8);
        ctx.closePath();
      }, '#F2C230');
      break;
    case 'halo':
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#F5C518';
      ctx.beginPath();
      ctx.ellipse(hx, top - 8, 18, 5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = INK;
      break;
    case 'headband':
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#E5484D';
      ctx.beginPath();
      ctx.arc(hx, hy + 6, hr + 1, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      break;
    case 'flower':
      for (let i = 0; i < 5; i++) {
        const t = (i / 5) * Math.PI * 2;
        shape(() => ctx.arc(hx + 20 + Math.cos(t) * 5, top + 10 + Math.sin(t) * 5, 4, 0, Math.PI * 2), '#FFB3C7');
      }
      shape(() => ctx.arc(hx + 20, top + 10, 3, 0, Math.PI * 2), '#F2C230');
      break;
    case 'headphones':
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(hx, hy, hr + 2, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
      ctx.lineWidth = 3;
      for (const side of [-1, 1]) shape(() => ctx.roundRect(hx + side * (r + 1) - 6, hy - 6, 12, 18, 5), '#3A3A44');
      break;
    default:
      break;
  }
}

function drawRobotPortrait(ctx, a, shape, hx, hy, r) {
  shape(() => ctx.roundRect(22, 80, 56, 30, 10), a.shirt);
  shape(() => ctx.roundRect(hx - 5, hy + r - 6, 10, 12, 2), a.skin);
  // Antenna.
  ctx.beginPath();
  ctx.moveTo(hx, hy - r);
  ctx.lineTo(hx, hy - r - 12);
  ctx.stroke();
  shape(() => ctx.arc(hx, hy - r - 14, 5, 0, Math.PI * 2), a.hairColor);
  for (const side of [-1, 1]) shape(() => ctx.roundRect(hx + side * (r + 3) - 5, hy - 8, 10, 16, 3), a.skin);
  if (a.head === 'dome') shape(() => ctx.ellipse(hx, hy, r + 2, r - 2, 0, 0, Math.PI * 2), a.skin);
  else if (a.head === 'tv') shape(() => ctx.roundRect(hx - r - 4, hy - r + 4, (r + 4) * 2, r * 2 - 6, 8), a.skin);
  else shape(() => ctx.roundRect(hx - r, hy - r, r * 2, r * 2, 12), a.skin);
  ctx.save();
  ctx.translate(hx - r * 0.9, hy - r * 0.95);
  drawFace(ctx, a, r * 1.8);
  ctx.restore();
}
