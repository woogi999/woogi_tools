/* eslint-disable warp-drive/no-legacy-request-patterns -- ctx.save() here is the canvas API, not a data request */

// Player avatars: chibi sketchbook kids, somewhere between OMORI's doodles and
// an Animal Crossing villager: a big, wide, soft-cornered head, simple dark
// eyes, a short straight body in real clothes, stubby arms and legs. Plus
// little robots, which only the computer players wear. An avatar is a small
// flat object, so it can be saved in localStorage and sent to other players.
//
// The head isn't a sphere but a "squircle" (a superellipsoid): wide cheeks and
// a flat-ish face, so it never looks like a lightbulb. Hair is a shell round
// that head, described by a hairline: for each direction round the head, how
// far down the hair reaches. Past the widest point it stops following the
// head and hangs straight down, so the same description covers a buzz cut, a
// bob and hair down the back. The 3D model (lazy/avatar-model.js) and the flat
// fallback portrait here both use these same functions.

// ─── Options ──────────────────────────────────────────────────────────

// Hairline heights are fractions from the crown: 0.5 is eye level at the front,
// HANG_FROM is where hair leaves the head, and anything past that hangs down.
// `jag` × `strands` makes a spiky fringe, `part` sweeps it to one side,
// `center` lifts it into a middle parting, `ragged` chops the ends all round,
// `flip` flicks the ends out (or in, when negative), `flare` puffs out the edge
// like a mushroom, `strip` keeps only a band down the middle (a mohawk),
// `volume` and `puff` stand the hair off the head. `layers` are extra shells in
// the same colour; `under` is a closely cropped shell in a darker shade.
export const HAIR_STYLES = [
  { id: 'messy', label: 'Messy fringe', front: 0.45, side: 0.58, back: 0.68, jag: 0.07, strands: 11, ragged: 0.03, volume: 1.12 },
  { id: 'wolfcut', label: 'Wolf cut', front: 0.47, side: 0.72, back: 0.92, jag: 0.08, strands: 9, ragged: 0.1, raggedStrands: 16, flip: 0.1, volume: 1.12, layers: [{ front: 0.44, side: 0.53, back: 0.62, jag: 0.07, strands: 9, ragged: 0.09, raggedStrands: 14, volume: 1.22, puff: 0.03 }] },
  { id: 'spiky', label: 'Anime spikes', front: 0.44, side: 0.56, back: 0.66, jag: 0.12, strands: 7, ragged: 0.06, volume: 1.16, crown: true },
  { id: 'pixie', label: 'Pixie', front: 0.47, side: 0.53, back: 0.6, part: 0.14, jag: 0.09, strands: 8, ragged: 0.05, volume: 1.1 },
  { id: 'fluffy', label: 'Fluffy', front: 0.45, side: 0.6, back: 0.66, jag: 0.04, strands: 14, volume: 1.24, puff: 0.05, bumps: 0.03 },
  { id: 'sidepart', label: 'Side part', front: 0.4, side: 0.53, back: 0.62, part: 0.12, volume: 1.1 },
  { id: 'undercut', label: 'Undercut', front: 0.45, side: 0.38, back: 0.42, part: 0.08, jag: 0.05, strands: 8, volume: 1.18, puff: 0.03, under: { front: 0.42, side: 0.56, back: 0.62, volume: 1.03 } },
  { id: 'curtains', label: 'Curtains', front: 0.45, side: 0.62, back: 0.68, center: 0.16, volume: 1.12 },
  { id: 'emo', label: 'Side fringe', front: 0.5, side: 0.64, back: 0.72, part: 0.2, jag: 0.05, strands: 12, ragged: 0.03, volume: 1.14 },
  { id: 'mullet', label: 'Mullet', front: 0.42, side: 0.5, back: 1.02, backStart: 0.74, jag: 0.05, strands: 10, ragged: 0.05, raggedStrands: 18, flip: 0.14, volume: 1.1 },
  { id: 'bowl', label: 'Bowl cut', front: 0.44, side: 0.455, back: 0.47, volume: 1.2, flare: 0.07 },
  { id: 'bob', label: 'Bob', front: 0.43, side: 0.8, back: 0.8, volume: 1.14, flip: -0.05 },
  { id: 'long', label: 'Long', front: 0.44, side: 1.02, back: 1.16, jag: 0.03, strands: 12, volume: 1.12 },
  { id: 'wavy', label: 'Wavy', front: 0.45, side: 0.98, back: 1.1, center: 0.08, ragged: 0.04, flip: 0.08, volume: 1.14, bumps: 0.035 },
  { id: 'hime', label: 'Hime cut', front: 0.47, side: 0.78, back: 1.18, backStart: 0.62, volume: 1.12 },
  { id: 'ponytail', label: 'Ponytail', front: 0.42, side: 0.54, back: 0.6, jag: 0.04, strands: 9, volume: 1.08, ponytail: true },
  { id: 'twintails', label: 'Twin tails', front: 0.43, side: 0.56, back: 0.64, jag: 0.03, strands: 9, volume: 1.1, twintails: true },
  { id: 'braid', label: 'Braid', front: 0.4, side: 0.56, back: 0.62, center: 0.06, volume: 1.08, braid: true },
  { id: 'buns', label: 'Space buns', front: 0.43, side: 0.55, back: 0.63, jag: 0.03, strands: 9, volume: 1.09, buns: true },
  { id: 'bun', label: 'Bun', front: 0.38, side: 0.52, back: 0.6, volume: 1.07, bun: true },
  { id: 'pompadour', label: 'Pompadour', front: 0.34, side: 0.48, back: 0.58, volume: 1.08, quiff: true, under: { front: 0.36, side: 0.56, back: 0.62, volume: 1.03 } },
  { id: 'curly', label: 'Curly', front: 0.43, side: 0.64, back: 0.72, jag: 0.05, strands: 14, ragged: 0.04, volume: 1.22, bumps: 0.06 },
  { id: 'afro', label: 'Afro', front: 0.36, side: 0.62, back: 0.72, volume: 1.5, lift: 0.07, bumps: 0.04 },
  { id: 'buzz', label: 'Buzz cut', front: 0.41, side: 0.55, back: 0.6, volume: 1.035 },
  { id: 'mohawk', label: 'Mohawk', front: 0.38, side: 0.62, back: 0.7, strip: 0.13, volume: 1.12, fin: true, under: { front: 0.42, side: 0.56, back: 0.62, volume: 1.025 } },
  { id: 'none', label: 'Bald', none: true },
];

export const EYES = [
  { id: 'empty', label: 'Empty' },
  { id: 'tired', label: 'Tired' },
  { id: 'lashes', label: 'Lashes' },
  { id: 'bright', label: 'Bright' },
  { id: 'gentle', label: 'Gentle' },
  { id: 'glossy', label: 'Glossy' },
  { id: 'serene', label: 'Serene' },
  { id: 'shocked', label: 'Shocked' },
  { id: 'dots', label: 'Dots' },
  { id: 'happy', label: 'Happy' },
  { id: 'sleepy', label: 'Sleepy' },
  { id: 'anime', label: 'Anime' },
  { id: 'cat', label: 'Cat' },
  { id: 'hearts', label: 'Hearts' },
  { id: 'dizzy', label: 'Dizzy' },
  { id: 'wink', label: 'Wink' },
];
export const BROWS = [
  { id: 'soft', label: 'Soft' },
  { id: 'thick', label: 'Thick' },
  { id: 'short', label: 'Short' },
  { id: 'angry', label: 'Angry' },
  { id: 'worried', label: 'Worried' },
  { id: 'none', label: 'None' },
];
export const NOSES = [
  { id: 'none', label: 'None' },
  { id: 'line', label: 'Line' },
  { id: 'dot', label: 'Dot' },
  { id: 'button', label: 'Button' },
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
  { id: 'wavy', label: 'Wobbly' },
  { id: 'pout', label: 'Pout' },
  { id: 'flat', label: 'Flat' },
  { id: 'frown', label: 'Frown' },
];
// Mii-style nudges for where the features sit, in small steps either way.
export const FACE_SLIDERS = [
  { key: 'eyeY', label: 'Eye height', min: -5, max: 5 },
  { key: 'eyeGap', label: 'Eye spacing', min: -5, max: 5 },
  { key: 'eyeSize', label: 'Eye size', min: -4, max: 4 },
  { key: 'eyeTilt', label: 'Eye tilt', min: -4, max: 4 },
  { key: 'browY', label: 'Eyebrow height', min: -5, max: 5 },
  { key: 'noseY', label: 'Nose height', min: -5, max: 5 },
  { key: 'mouthY', label: 'Mouth height', min: -5, max: 5 },
  { key: 'mouthSize', label: 'Mouth size', min: -4, max: 4 },
];
export const TOPS = [
  { id: 'tee', label: 'T-shirt' },
  { id: 'tank', label: 'Tank top' },
  { id: 'long', label: 'Long sleeves' },
  { id: 'sweater', label: 'Turtleneck' },
  { id: 'hoodie', label: 'Hoodie' },
  { id: 'jacket', label: 'Jacket' },
  { id: 'sailor', label: 'Sailor' },
  { id: 'dress', label: 'Dress' },
  { id: 'overalls', label: 'Overalls' },
];
export const PATTERNS = [
  { id: 'plain', label: 'Plain' },
  { id: 'stripes', label: 'Stripes' },
  { id: 'spots', label: 'Spots' },
  { id: 'checks', label: 'Checks' },
  { id: 'star', label: 'Star' },
  { id: 'heart', label: 'Heart' },
];
export const BOTTOMS = [
  { id: 'trousers', label: 'Trousers' },
  { id: 'shorts', label: 'Shorts' },
  { id: 'skirt', label: 'Skirt' },
];
export const SHOES = [
  { id: 'sneakers', label: 'Sneakers' },
  { id: 'boots', label: 'Boots' },
  { id: 'flats', label: 'Flats' },
];
export const HATS = [
  { id: 'none', label: 'None' },
  { id: 'cap', label: 'Cap' },
  { id: 'beanie', label: 'Beanie' },
  { id: 'bucket', label: 'Bucket hat' },
  { id: 'beret', label: 'Beret' },
  { id: 'straw', label: 'Straw hat' },
  { id: 'tophat', label: 'Top hat' },
  { id: 'witch', label: 'Witch hat' },
  { id: 'party', label: 'Party hat' },
  { id: 'frog', label: 'Frog hat' },
  { id: 'cat-ears', label: 'Cat ears' },
  { id: 'bunny-ears', label: 'Bunny ears' },
  { id: 'bear-ears', label: 'Bear ears' },
  { id: 'horns', label: 'Horns' },
  { id: 'crown', label: 'Crown' },
  { id: 'halo', label: 'Halo' },
  { id: 'headband', label: 'Headband' },
  { id: 'bow', label: 'Bow' },
  { id: 'flower', label: 'Flower' },
  { id: 'leaf', label: 'Leaf' },
  { id: 'clips', label: 'Hair clips' },
  { id: 'headphones', label: 'Headphones' },
  { id: 'goggles', label: 'Goggles' },
];
export const EYEWEAR = [
  { id: 'none', label: 'None' },
  { id: 'round', label: 'Big round' },
  { id: 'square', label: 'Big square' },
  { id: 'cat-eye', label: 'Cat-eye' },
  { id: 'heart', label: 'Heart' },
  { id: 'star', label: 'Star' },
  { id: 'swirl', label: 'Swirly' },
  { id: 'shades', label: 'Shades' },
  { id: 'monocle', label: 'Monocle' },
  { id: 'eyepatch', label: 'Eyepatch' },
];
export const MASKS = [
  { id: 'none', label: 'None' },
  { id: 'cloth', label: 'Face mask' },
  { id: 'fox', label: 'Fox mask' },
];
export const NECKWEAR = [
  { id: 'none', label: 'None' },
  { id: 'scarf', label: 'Scarf' },
  { id: 'tie', label: 'Tie' },
  { id: 'bowtie', label: 'Bow tie' },
  { id: 'choker', label: 'Choker' },
  { id: 'bell', label: 'Bell collar' },
  { id: 'necklace', label: 'Necklace' },
  { id: 'bandana', label: 'Bandana' },
];
export const BACKS = [
  { id: 'none', label: 'None' },
  { id: 'backpack', label: 'Backpack' },
  { id: 'wings', label: 'Angel wings' },
  { id: 'bat-wings', label: 'Bat wings' },
  { id: 'cape', label: 'Cape' },
  { id: 'cat-tail', label: 'Cat tail' },
  { id: 'fox-tail', label: 'Fox tail' },
];
export const PIERCINGS = [
  { id: 'ear-studs', label: 'Ear studs' },
  { id: 'ear-hoops', label: 'Ear hoops' },
  { id: 'cartilage', label: 'Cartilage' },
  { id: 'brow', label: 'Eyebrow' },
  { id: 'nose', label: 'Nose ring' },
  { id: 'septum', label: 'Septum' },
  { id: 'lip', label: 'Lip ring' },
  { id: 'snakebites', label: 'Snake bites' },
];
export const MARKS = [
  { id: 'blush', label: 'Rosy cheeks' },
  { id: 'freckles', label: 'Freckles' },
  { id: 'eyebags', label: 'Eye bags' },
  { id: 'tears', label: 'Tears' },
  { id: 'whiskers', label: 'Whiskers' },
  { id: 'star', label: 'Star sticker' },
  { id: 'blush-lines', label: 'Blush lines' },
  { id: 'plaster', label: 'Plaster' },
  { id: 'nose-plaster', label: 'Nose plaster' },
  { id: 'scar', label: 'Scar' },
  { id: 'mole', label: 'Mole' },
];
export const ROBOT_HEADS = [
  { id: 'box', label: 'Boxy' },
  { id: 'dome', label: 'Dome' },
  { id: 'tv', label: 'Telly' },
];
export const ROBOT_EYES = ['dots', 'big', 'happy', 'sleepy', 'blank', 'x'];
export const ROBOT_MOUTHS = ['tiny', 'smile', 'flat', 'grin'];
export const SKIN_TONES = ['#FFFFFF', '#FFE9D6', '#F6CFA8', '#E3B083', '#C68B5E', '#8D5A3B', '#5C3A24'];
export const HAIR_COLORS = ['#141414', '#3B2A20', '#7A4A2A', '#E8C468', '#F2F2F2', '#9AA0AA', '#E5484D', '#3E7BE0', '#B388EB', '#FF8FAB', '#7ED6A5'];
export const EYE_COLORS = ['#2A2A2A', '#5A3A24', '#3E7BE0', '#30A46C', '#8E5BD9', '#D93A3A', '#E3A21A', '#6FC3DF'];
export const SHIRT_COLORS = ['#F2F2F2', '#2B2B33', '#3E7BE0', '#E5484D', '#30A46C', '#F2B90D', '#B388EB', '#FF8FAB', '#8A6A4A'];
export const ACCENT_COLORS = ['#2B2B33', '#F2F2F2', '#E5484D', '#3E7BE0', '#F2B90D', '#30A46C', '#FF8FAB', '#8E5BD9'];
export const PANTS_COLORS = ['#34343D', '#1B1B1B', '#4A5A7A', '#6B5A45', '#F2F2F2', '#7A2E2E', '#3E6B4A', '#C9A27A'];
export const SHOE_COLORS = ['#2B2B33', '#F2F2F2', '#8A5A3A', '#E5484D', '#3E7BE0', '#F2B90D'];
export const HAT_COLORS = ['#E5484D', '#2B2B33', '#F2F2F2', '#3E7BE0', '#6DBE45', '#F2B90D', '#B388EB', '#FF8FAB'];
export const METAL_COLORS = ['#C9CED6', '#8E97A3', '#E8E1CF', '#6B7280', '#D4A373'];
export const GLOW_COLORS = ['#5CE1E6', '#FFDE59', '#FF6B8B', '#7ED957', '#C39BFF', '#FF914D'];

const HEX = /^#[0-9A-F]{6}$/i;
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const oneOf = (list, id, fallback) => (list.some((o) => (o.id ?? o) === id) ? id : fallback);
const hexOr = (value, fallback) => (HEX.test(value ?? '') ? value.toUpperCase() : fallback);
const someOf = (list, values) => (Array.isArray(values) ? list.map((o) => o.id).filter((id) => values.includes(id)) : []);
const stepOr = (value, min, max) => (Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Math.round(Number(value)))) : 0);

export const hairStyle = (id) => HAIR_STYLES.find((s) => s.id === id) ?? HAIR_STYLES[0];

// The sketchbook kid: pale skin, a black messy fringe, empty dark eyes, a white tee.
export const DEFAULT_AVATAR = {
  type: 'human',
  skin: '#FFFFFF',
  hair: 'messy',
  hairColor: '#141414',
  ahoge: true,
  eyes: 'empty',
  eyeColor: '#2A2A2A',
  brows: 'soft',
  nose: 'none',
  mouth: 'tiny',
  eyeY: 0,
  eyeGap: 0,
  eyeSize: 0,
  eyeTilt: 0,
  browY: 0,
  noseY: 0,
  mouthY: 0,
  mouthSize: 0,
  top: 'tee',
  pattern: 'plain',
  shirt: '#F2F2F2',
  accent: '#2B2B33',
  bottom: 'shorts',
  pants: '#34343D',
  shoes: 'sneakers',
  shoeColor: '#2B2B33',
  hat: 'none',
  hatColor: '#E5484D',
  eyewear: 'none',
  mask: 'none',
  neck: 'none',
  back: 'none',
  piercings: [],
  marks: [],
  head: 'box',
};

export function randomAvatar() {
  const top = pick(TOPS).id;
  return {
    ...DEFAULT_AVATAR,
    skin: pick(SKIN_TONES),
    hair: pick(HAIR_STYLES.slice(0, -1)).id,
    hairColor: pick(HAIR_COLORS),
    ahoge: Math.random() < 0.3,
    eyes: pick(Math.random() < 0.7 ? EYES.slice(0, 9) : EYES).id,
    eyeColor: pick(EYE_COLORS),
    brows: pick(BROWS).id,
    nose: pick(NOSES).id,
    mouth: pick(MOUTHS).id,
    eyeY: Math.round((Math.random() - 0.5) * 3),
    eyeGap: Math.round((Math.random() - 0.5) * 3),
    top,
    pattern: Math.random() < 0.6 ? 'plain' : pick(PATTERNS).id,
    shirt: pick(SHIRT_COLORS),
    accent: pick(ACCENT_COLORS),
    bottom: pick(BOTTOMS).id,
    pants: pick(PANTS_COLORS),
    shoes: pick(SHOES).id,
    shoeColor: pick(SHOE_COLORS),
    hat: Math.random() < 0.65 ? 'none' : pick(HATS).id,
    hatColor: pick(HAT_COLORS),
    eyewear: Math.random() < 0.8 ? 'none' : pick(EYEWEAR).id,
    mask: Math.random() < 0.93 ? 'none' : pick(MASKS).id,
    neck: Math.random() < 0.75 ? 'none' : pick(NECKWEAR).id,
    back: Math.random() < 0.8 ? 'none' : pick(BACKS).id,
    piercings: PIERCINGS.filter(() => Math.random() < 0.1).map((p) => p.id),
    marks: MARKS.filter((m) => Math.random() < (m.id === 'blush' ? 0.4 : 0.08)).map((m) => m.id),
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
    marks: next([['blush'], []]),
    shirt: next(SHIRT_COLORS),
    head: next(ROBOT_HEADS).id,
  };
}

// Older saved avatars used other names for a few things; they map onto the new ones.
const LEGACY_EXTRA = { glasses: { eyewear: 'round' }, bow: { hat: 'bow' }, cap: { hat: 'cap' }, halo: { hat: 'halo' }, headphones: { hat: 'headphones' }, bandage: { marks: ['plaster'] } };
const LEGACY_EYES = { omori: 'tired', ringed: 'tired', tired: 'tired', big: 'bright', sharp: 'lashes', sparkle: 'glossy', teary: 'anime', blank: 'shocked' };

// Anything that arrives from storage or another player is untrusted: keep only known values.
export function normaliseAvatar(avatar) {
  const raw = avatar && typeof avatar === 'object' ? avatar : {};
  const a = { ...(LEGACY_EXTRA[raw.extra] ?? {}), ...raw };
  const d = DEFAULT_AVATAR;
  const type = a.type === 'robot' ? 'robot' : 'human';
  const eyes = LEGACY_EYES[a.eyes] ?? a.eyes;
  const marks = Array.isArray(a.marks) ? [...a.marks] : [];
  if (a.blush === true) marks.push('blush');
  if (a.eyes === 'teary') marks.push('tears');
  const steps = Object.fromEntries(FACE_SLIDERS.map((s) => [s.key, stepOr(a[s.key], s.min, s.max)]));
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
    mouth: type === 'robot' ? oneOf(ROBOT_MOUTHS, a.mouth, 'tiny') : oneOf(MOUTHS, a.mouth, d.mouth),
    ...steps,
    top: oneOf(TOPS, a.top, d.top),
    pattern: oneOf(PATTERNS, a.pattern, d.pattern),
    shirt: hexOr(a.shirt, d.shirt),
    accent: hexOr(a.accent, d.accent),
    bottom: oneOf(BOTTOMS, a.bottom, d.bottom),
    pants: hexOr(a.pants, d.pants),
    shoes: oneOf(SHOES, a.shoes, d.shoes),
    shoeColor: hexOr(a.shoeColor, d.shoeColor),
    hat: oneOf(HATS, a.hat, 'none'),
    hatColor: hexOr(a.hatColor, d.hatColor),
    eyewear: oneOf(EYEWEAR, a.eyewear, 'none'),
    mask: oneOf(MASKS, a.mask, 'none'),
    neck: oneOf(NECKWEAR, a.neck, 'none'),
    back: oneOf(BACKS, a.back, 'none'),
    piercings: someOf(PIERCINGS, a.piercings),
    marks: someOf(MARKS, marks),
    head: oneOf(ROBOT_HEADS, a.head, 'box'),
  };
}

// Real players are always people; robots are only for the computer.
export function playerAvatar(avatar) {
  return { ...normaliseAvatar(avatar), type: 'human' };
}

export const avatarKey = (avatar) =>
  Object.values(normaliseAvatar(avatar))
    .map((v) => (Array.isArray(v) ? v.join('+') : v))
    .join('|');

// ─── Head and hair shapes ─────────────────────────────────────────────

// Half-width, half-height and half-depth of the head, and how square its corners are.
export const HEAD = { x: 0.54, y: 0.45, z: 0.47, power: 2.6 };
export const HANG_FROM = 0.6;
const HANG_LENGTH = Math.PI * 0.42;

const clamp01 = (t) => Math.max(0, Math.min(1, t));
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
// A sawtooth folded into a triangle, 0..1.
const tri = (x) => 1 - Math.abs(((x % 2) + 2) % 2 - 1) * 2;

// Where the direction (dx, dy, dz) from the head's centre meets the head's
// surface, grown outwards by `grow` (for hair and hats).
export function headPoint(dx, dy, dz, grow = 0) {
  const { power } = HEAD;
  const sum = Math.abs(dx / (HEAD.x + grow)) ** power + Math.abs(dy / (HEAD.y + grow)) ** power + Math.abs(dz / (HEAD.z + grow)) ** power;
  const k = sum > 0 ? sum ** (-1 / power) : 0;
  return [dx * k, dy * k, dz * k];
}

// A point on the head at azimuth `az` (0 = the face, positive = the avatar's left)
// and polar angle `polar` (radians from the crown).
export function headAt(az, polar, grow = 0) {
  return headPoint(Math.sin(polar) * Math.sin(az), Math.cos(polar), Math.sin(polar) * Math.cos(az), grow);
}

// How far down (as a fraction, see above) the hair reaches at azimuth `az`.
export function hairline(style, az) {
  const t = Math.min(1, Math.abs(az) / Math.PI);
  const backStart = style.backStart ?? 0.5;
  let reach = t < backStart ? lerp(style.front, style.side, smooth(t / backStart)) : lerp(style.side, style.back, smooth((t - backStart) / (1 - backStart)));
  const frontness = Math.max(0, 1 - t * 2.4);
  if (style.jag) reach += style.jag * frontness * Math.abs(tri((az / Math.PI) * style.strands));
  if (style.part) reach += style.part * Math.sin(az) * frontness;
  // A middle parting: the fringe lifts in the centre and falls away to both sides.
  if (style.center) reach -= style.center * Math.max(0, 1 - Math.abs(az) * 2.2);
  if (style.ragged) reach += style.ragged * (1 - frontness) * Math.abs(tri((az / Math.PI) * (style.raggedStrands ?? 14)));
  // A mohawk only keeps a band down the middle of the head.
  if (style.strip) {
    const across = Math.abs(Math.sin(az));
    if (across > style.strip) reach = Math.min(reach, Math.asin(style.strip / across) / Math.PI);
  }
  return reach;
}

export function maxHairline(style) {
  let most = 0;
  for (let i = 0; i <= 90; i++) most = Math.max(most, hairline(style, -Math.PI + (i / 90) * Math.PI * 2));
  return most;
}

// How far the hair stands off the head.
export const hairGrow = (style, frac = 0) => ((style.volume ?? 1) - 1) * 0.45 + (style.puff ?? 0) * Math.max(0, Math.cos(frac * Math.PI)) ** 2;
export const hairTop = (style) => (style.none ? HEAD.y : HEAD.y + hairGrow(style, 0) + (style.lift ?? 0) * 0.5);

// A point on the hair surface, `frac` down from the crown at azimuth `az`,
// pushed `out` further from the head. Returns [x, y, z] from the head's centre.
export function hairPoint(style, az, frac, out = 0) {
  const onHead = Math.min(frac, HANG_FROM);
  const polar = onHead * Math.PI;
  const reach = style.none ? 1 : hairline(style, az);
  let [x, y, z] = headAt(az, polar, hairGrow(style, onHead) + out);
  let k = 1;
  if (style.bumps) k += style.bumps * Math.sin(az * 9) * Math.sin(polar * 9 + frac * 4);
  // Towards the ends: a mushroom flare, or a flick out.
  if (style.flare) k += style.flare * smooth(clamp01(1 - (reach - frac) / 0.14));
  if (frac > HANG_FROM) {
    const hang = (frac - HANG_FROM) * HANG_LENGTH;
    y -= hang;
    const along = clamp01((frac - HANG_FROM) / Math.max(0.01, reach - HANG_FROM));
    k += (style.flip ?? 0) * smooth(clamp01((along - 0.55) / 0.45)) - 0.05 * smooth(Math.min(1, hang / 0.3));
  }
  y += (style.lift ?? 0) * 0.5;
  return [x * k, y, z * k];
}

// ─── Faces ────────────────────────────────────────────────────────────

const INK = '#141414';
const METAL = '#C9CED6';

// The face drawing spans this much of the head, in radians either way from the
// middle of the face; the 3D face patch and the flat portrait both use it.
export const FACE_SPAN = { az: 0.85, polar: 0.78 };

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const channel = (shift) => Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * (1 + amount))));
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

// Where everything on the face goes, after the Mii-style nudges.
function faceLayout(a) {
  const eyeScale = 1 + a.eyeSize * 0.07;
  const eyeY = 52 - a.eyeY * 1.6;
  return {
    eyeY,
    eyeDX: 20 + a.eyeGap * 1.4,
    eyeScale,
    tilt: a.eyeTilt * 0.07,
    browY: eyeY - 19 * eyeScale - a.browY * 1.5,
    noseY: 68 - a.noseY * 1.5,
    mouthY: 78 - a.mouthY * 1.5,
    mouthScale: 1 + a.mouthSize * 0.1,
  };
}

// Draws the face centred in a size×size square, on a transparent background.
// `blink` (0–1) closes the eyes, for the idle animation.
export function drawFace(ctx, avatarInput, size, { blink = 0 } = {}) {
  const avatar = normaliseAvatar(avatarInput);
  if (avatar.type === 'robot') return drawRobotFace(ctx, avatar, size, { blink });
  const s = size / 100;
  const L = faceLayout(avatar);
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
  const ring = (x, y, r, width = 1.6, color = METAL) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = INK;
  };
  const marks = new Set(avatar.marks);
  const piercings = new Set(avatar.piercings);
  const cheekY = L.eyeY + 16 * L.eyeScale;

  if (marks.has('blush')) {
    ctx.fillStyle = 'rgba(255, 110, 130, 0.42)';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(50 + side * (L.eyeDX + 9), cheekY, 9, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (marks.has('blush-lines')) {
    ctx.strokeStyle = '#E86A7F';
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) line(50 + side * (L.eyeDX + 3 + i * 4), cheekY + 3, 50 + side * (L.eyeDX + 1 + i * 4), cheekY - 1, 1.6);
    ctx.strokeStyle = INK;
  }
  if (marks.has('freckles')) {
    for (const side of [-1, 1]) for (const [dx, dy] of [[2, 0], [7, 3], [11, -1], [5, -3]]) dot(50 + side * (L.eyeDX + dx), cheekY + dy, 0.9, '#B07A55');
  }
  if (marks.has('whiskers')) {
    ctx.strokeStyle = INK;
    for (const side of [-1, 1]) for (const dy of [-3, 1, 5]) line(50 + side * (L.eyeDX + 10), cheekY + 2 + dy * 0.6, 50 + side * (L.eyeDX + 24), cheekY + dy * 1.4, 1.4);
  }

  // Brows sit above the eyes; a fringe over the face in 3D may hide them, which is fine.
  for (const side of [-1, 1]) {
    const x = 50 + side * L.eyeDX;
    const y = L.browY;
    ctx.strokeStyle = INK;
    switch (avatar.brows) {
      case 'thick':
        line(x - 8, y + 1, x + 8, y - side, 4.4);
        break;
      case 'short':
        line(x - side * 3, y, x + side * 3, y - 0.5, 4.2);
        break;
      case 'angry':
        line(x - side * 9, y - 3, x + side * 7, y + 3, 3.6);
        break;
      case 'worried':
        line(x - side * 9, y + 3, x + side * 7, y - 3, 3);
        break;
      case 'soft':
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(x - 7, y + 1);
        ctx.quadraticCurveTo(x, y - 3, x + 7, y + 1);
        ctx.stroke();
        break;
      default:
        break;
    }
  }
  if (piercings.has('brow')) {
    dot(50 + L.eyeDX + 8, L.browY - 3, 1.4, METAL);
    dot(50 + L.eyeDX + 10, L.browY + 2, 1.4, METAL);
  }

  const closed = blink > 0.5 && !['happy', 'sleepy', 'dizzy', 'serene'].includes(avatar.eyes);
  for (const side of [-1, 1]) {
    if (avatar.eyewear === 'eyepatch' && side === 1) continue;
    ctx.save();
    ctx.translate(50 + side * L.eyeDX, L.eyeY);
    // Positive tilt lifts the outer corners.
    ctx.rotate(-side * L.tilt);
    ctx.scale(L.eyeScale, L.eyeScale);
    ctx.strokeStyle = INK;
    if (closed || (avatar.eyes === 'wink' && side === 1)) {
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(-9, 0);
      ctx.quadraticCurveTo(0, 4, 9, 0);
      ctx.stroke();
    } else {
      drawEye(ctx, avatar, side);
    }
    if (marks.has('eyebags')) {
      ctx.strokeStyle = 'rgba(120, 90, 130, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-7, 16);
      ctx.quadraticCurveTo(0, 19, 7, 16);
      ctx.stroke();
    }
    if (marks.has('tears')) {
      ctx.fillStyle = 'rgba(120, 190, 255, 0.9)';
      ctx.beginPath();
      ctx.moveTo(side * 6, 11);
      ctx.quadraticCurveTo(side * 10.5, 19, side * 6, 21.5);
      ctx.quadraticCurveTo(side * 1.5, 19, side * 6, 11);
      ctx.fill();
    }
    ctx.restore();
  }
  if (marks.has('star')) {
    ctx.fillStyle = '#F2C230';
    starPath(ctx, 50 + L.eyeDX + 9, cheekY + 1, 4.5, 0.45);
    ctx.fill();
  }

  if (avatar.nose === 'line') {
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(51, L.noseY - 3);
    ctx.quadraticCurveTo(52.5, L.noseY + 1, 50, L.noseY + 2.5);
    ctx.stroke();
  } else if (avatar.nose === 'dot') {
    dot(50, L.noseY + 0.5, 1.3);
  } else if (avatar.nose === 'button') {
    ctx.fillStyle = shade(avatar.skin, -0.12);
    ctx.beginPath();
    ctx.ellipse(50, L.noseY, 3.6, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  if (piercings.has('nose')) ring(53.5, L.noseY + 1.5, 2.2);
  if (piercings.has('septum')) {
    ctx.strokeStyle = METAL;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(50, L.noseY + 3.5, 2.4, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.stroke();
    ctx.strokeStyle = INK;
  }

  ctx.save();
  ctx.translate(50, L.mouthY);
  ctx.scale(L.mouthScale, L.mouthScale);
  ctx.translate(-50, -L.mouthY);
  drawMouth(ctx, avatar.mouth, L.mouthY);
  if (piercings.has('lip')) ring(50, L.mouthY + 4, 2.2);
  if (piercings.has('snakebites')) for (const side of [-1, 1]) dot(50 + side * 5.5, L.mouthY + 4, 1.3, METAL);
  ctx.restore();

  if (marks.has('plaster')) plaster(ctx, 50 + L.eyeDX + 8, cheekY + 3, -0.45);
  if (marks.has('nose-plaster')) plaster(ctx, 50, L.noseY - 2, 0);
  if (marks.has('scar')) {
    ctx.strokeStyle = '#B5566A';
    const x = 50 - L.eyeDX - 4;
    line(x - 4, L.eyeY - 10, x + 5, L.eyeY + 16, 1.8);
    for (let i = 0; i < 3; i++) line(x - 2 + i * 3, L.eyeY - 4 + i * 6, x + 4 + i * 3, L.eyeY - 6 + i * 6, 1.4);
    ctx.strokeStyle = INK;
  }
  if (marks.has('mole')) dot(60, L.mouthY, 1.1);

  if (avatar.mask === 'cloth') {
    ctx.fillStyle = '#F4F6F8';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.roundRect(29, L.noseY - 2, 42, Math.max(18, L.mouthY - L.noseY + 16), [6, 6, 14, 14]);
    ctx.fill();
    ctx.stroke();
    for (const dy of [5, 10]) line(33, L.noseY + dy, 67, L.noseY + dy, 1.2);
    line(29, L.noseY + 2, 4, L.noseY - 8, 1.6);
    line(71, L.noseY + 2, 96, L.noseY - 8, 1.6);
  }

  drawEyewear(ctx, avatar.eyewear, L);
  ctx.restore();
}

function plaster(ctx, x, y, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = '#F4D3B0';
  ctx.strokeStyle = INK;
  ctx.fillRect(-8, -3.5, 16, 7);
  ctx.lineWidth = 1.4;
  ctx.strokeRect(-8, -3.5, 16, 7);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-2, -3.5);
  ctx.lineTo(-2, 3.5);
  ctx.moveTo(2, -3.5);
  ctx.lineTo(2, 3.5);
  ctx.stroke();
  ctx.restore();
}

// One eye, drawn round (0, 0); side is -1 for the eye on the left of the picture.
function drawEye(ctx, avatar, side) {
  const tinted = avatar.eyeColor !== DEFAULT_AVATAR.eyeColor;
  const dark = tinted ? shade(avatar.eyeColor, -0.3) : INK;
  const dot = (cx, cy, r, color = INK) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const oval = (cx, cy, rx, ry) => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  };
  const stroke = (width, draw) => {
    ctx.strokeStyle = INK;
    ctx.lineWidth = width;
    ctx.beginPath();
    draw();
    ctx.stroke();
  };
  // The big anime eye, for the two anime styles.
  const animeEye = ({ slit = false } = {}) => {
    const rx = 11.5;
    const ry = 14;
    ctx.save();
    oval(0, 1, rx, ry);
    ctx.clip();
    ctx.fillStyle = '#fff';
    ctx.fillRect(-rx, -ry, rx * 2, ry * 2 + 2);
    const gradient = ctx.createLinearGradient(0, -ry, 0, ry);
    gradient.addColorStop(0, shade(avatar.eyeColor, -0.45));
    gradient.addColorStop(0.65, avatar.eyeColor);
    gradient.addColorStop(1, shade(avatar.eyeColor, 0.35));
    ctx.fillStyle = gradient;
    oval(0, 2.5, rx * 0.8, ry * 0.88);
    ctx.fill();
    ctx.fillStyle = INK;
    if (slit) oval(0, 2.5, rx * 0.16, ry * 0.62);
    else oval(0, 3, rx * 0.36, ry * 0.42);
    ctx.fill();
    dot(-side * 3, -3.5, 3, '#fff');
    dot(side * 3.2, 6, 1.5, '#fff');
    ctx.restore();
    stroke(4.2, () => {
      ctx.moveTo(-side * (rx + 1), -2);
      ctx.quadraticCurveTo(-side * 2, -ry - 4.5, side * (rx + 2), -4);
      ctx.lineTo(side * (rx + 4.5), -6.5);
    });
    stroke(1.8, () => {
      ctx.moveTo(-rx * 0.55, ry + 1.5);
      ctx.quadraticCurveTo(0, ry + 2.8, rx * 0.55, ry + 1.5);
    });
  };

  switch (avatar.eyes) {
    case 'empty':
      // Two tall, flat-black ovals: the sketchbook stare.
      ctx.fillStyle = dark;
      oval(0, 1, 8, 11.5);
      ctx.fill();
      break;
    case 'tired':
      // The same dark oval under a heavy, flat lid, with a little bag beneath.
      ctx.save();
      oval(0, 1.5, 9, 11.5);
      ctx.clip();
      ctx.fillStyle = dark;
      ctx.fillRect(-10, -3, 20, 18);
      ctx.restore();
      stroke(4.2, () => {
        ctx.moveTo(-12, -3);
        ctx.quadraticCurveTo(0, -5.5, 12, -3.5);
      });
      stroke(1.5, () => {
        ctx.moveTo(-5, 16);
        ctx.quadraticCurveTo(0, 18, 5, 16);
      });
      break;
    case 'lashes':
      ctx.fillStyle = dark;
      oval(0, 2, 9, 11.5);
      ctx.fill();
      dot(-side * 3, -3, 2.8, '#fff');
      dot(side * 2.8, 6.5, 1.4, '#fff');
      stroke(4.2, () => {
        ctx.moveTo(-side * 11, -1);
        ctx.quadraticCurveTo(-side * 2, -14, side * 11, -5);
        ctx.moveTo(side * 10, -5);
        ctx.lineTo(side * 15.5, -9);
        ctx.moveTo(side * 6.5, -8.5);
        ctx.lineTo(side * 10.5, -14);
      });
      break;
    case 'bright':
      ctx.fillStyle = '#fff';
      oval(0, 1, 10, 12);
      ctx.fill();
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = INK;
      ctx.stroke();
      dot(0, 2.5, 5.4, dark);
      dot(-side * 1.8, 0.4, 1.8, '#fff');
      break;
    case 'gentle':
      ctx.save();
      oval(0, 2, 9.5, 11);
      ctx.clip();
      ctx.fillStyle = dark;
      ctx.fillRect(-10, -1, 20, 14);
      dot(-side * 3, 3, 2, '#fff');
      ctx.restore();
      stroke(3.8, () => {
        ctx.moveTo(-side * 12, -2);
        ctx.quadraticCurveTo(-side * 1, -6.5, side * 12, 1.5);
      });
      stroke(1.5, () => {
        ctx.moveTo(-5, 14.5);
        ctx.quadraticCurveTo(0, 15.5, 5, 14.5);
      });
      break;
    case 'glossy': {
      ctx.fillStyle = '#fff';
      oval(0, 1, 11, 12.5);
      ctx.fill();
      const gradient = ctx.createLinearGradient(0, -10, 0, 12);
      gradient.addColorStop(0, shade(avatar.eyeColor, -0.5));
      gradient.addColorStop(1, shade(avatar.eyeColor, 0.25));
      ctx.fillStyle = gradient;
      oval(0, 2, 9, 10.5);
      ctx.fill();
      ctx.fillStyle = INK;
      oval(0, 3, 4, 5);
      ctx.fill();
      dot(-side * 3.5, -3, 3.4, '#fff');
      dot(side * 3.5, 6, 2, '#fff');
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;
      oval(0, 1, 11, 12.5);
      ctx.stroke();
      stroke(1.5, () => {
        for (const dx of [-5, 0, 5]) {
          ctx.moveTo(dx, 13.5);
          ctx.lineTo(dx * 1.2, 16.5);
        }
      });
      break;
    }
    case 'serene':
      stroke(3.4, () => {
        ctx.moveTo(-10, 0);
        ctx.quadraticCurveTo(0, 7, 10, 0);
        ctx.moveTo(side * 10, 0);
        ctx.lineTo(side * 13.5, -2.5);
      });
      break;
    case 'shocked':
      ctx.fillStyle = '#fff';
      oval(0, 0, 9.5, 11);
      ctx.fill();
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = INK;
      ctx.stroke();
      dot(0, 1, 2, dark);
      break;
    case 'happy':
      stroke(3.6, () => ctx.arc(0, 5, 8, Math.PI * 1.1, Math.PI * 1.9));
      break;
    case 'sleepy':
      stroke(3.4, () => ctx.arc(0, -2, 8, Math.PI * 0.15, Math.PI * 0.85));
      break;
    case 'hearts':
      ctx.fillStyle = '#E5484D';
      heart(ctx, 0, 1, 9);
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      break;
    case 'dizzy':
      stroke(2.2, () => {
        for (let i = 0; i <= 40; i++) {
          const t = (i / 40) * Math.PI * 5;
          const r = (i / 40) * 9;
          ctx.lineTo(Math.cos(t) * r * side, Math.sin(t) * r);
        }
      });
      break;
    case 'dots':
      dot(0, 1, 4.8, dark);
      dot(-side * 1.4, -0.6, 1.3, '#fff');
      break;
    case 'cat':
      animeEye({ slit: true });
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
    case 'wavy':
      path(() => {
        ctx.moveTo(42, my);
        for (let i = 1; i <= 4; i++) ctx.quadraticCurveTo(42 + (i - 0.5) * 4, my + (i % 2 ? -2.5 : 2.5), 42 + i * 4, my);
      });
      break;
    case 'pout':
      path(() => {
        ctx.moveTo(47, my - 1);
        ctx.quadraticCurveTo(50, my - 3.5, 53, my - 1);
        ctx.moveTo(47.5, my + 1);
        ctx.quadraticCurveTo(50, my + 2.5, 52.5, my + 1);
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

// Glasses are drawn big on purpose: the lenses nearly meet in the middle.
function drawEyewear(ctx, eyewear, L) {
  const { eyeY: y, eyeDX: dx } = L;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  const bridge = (inner) => {
    ctx.beginPath();
    ctx.moveTo(50 - dx + inner, y - 3);
    ctx.quadraticCurveTo(50, y - 7, 50 + dx - inner, y - 3);
    ctx.stroke();
  };
  const temples = (outer) => {
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(50 - dx - outer, y - 4);
    ctx.lineTo(0, y - 8);
    ctx.moveTo(50 + dx + outer, y - 4);
    ctx.lineTo(100, y - 8);
    ctx.stroke();
    ctx.lineWidth = 3;
  };
  const lens = (draw, fill = 'rgba(255, 255, 255, 0.18)') => {
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(50 + side * dx, y + 1);
      ctx.scale(side, 1);
      ctx.beginPath();
      draw();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  };
  switch (eyewear) {
    case 'round':
      lens(() => ctx.arc(0, 0, 19, 0, Math.PI * 2));
      bridge(19);
      temples(19);
      break;
    case 'square':
      lens(() => ctx.roundRect(-18, -15, 36, 30, 6));
      bridge(18);
      temples(18);
      break;
    case 'cat-eye':
      lens(() => {
        ctx.moveTo(-17, -6);
        ctx.quadraticCurveTo(-2, -16, 20, -17);
        ctx.quadraticCurveTo(21, 6, 8, 13);
        ctx.quadraticCurveTo(-14, 16, -17, -6);
      });
      bridge(17);
      temples(20);
      break;
    case 'heart':
      ctx.fillStyle = 'rgba(255, 90, 130, 0.55)';
      for (const side of [-1, 1]) {
        heart(ctx, 50 + side * dx, y + 1, 17);
        ctx.fillStyle = 'rgba(255, 90, 130, 0.55)';
        ctx.fill();
        ctx.stroke();
      }
      bridge(15);
      temples(17);
      break;
    case 'star':
      for (const side of [-1, 1]) {
        starPath(ctx, 50 + side * dx, y + 1, 20, 0.55);
        ctx.fillStyle = 'rgba(242, 194, 48, 0.45)';
        ctx.fill();
        ctx.stroke();
      }
      bridge(14);
      temples(16);
      break;
    case 'swirl':
      lens(() => ctx.arc(0, 0, 18, 0, Math.PI * 2), 'rgba(255, 255, 255, 0.95)');
      ctx.lineWidth = 1.6;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        for (let i = 0; i <= 60; i++) {
          const t = (i / 60) * Math.PI * 7;
          const r = (i / 60) * 15;
          ctx.lineTo(50 + side * dx + Math.cos(t) * r, y + 1 + Math.sin(t) * r);
        }
        ctx.stroke();
      }
      ctx.lineWidth = 3;
      bridge(18);
      temples(18);
      break;
    case 'shades':
      lens(() => ctx.roundRect(-18, -12, 36, 25, [4, 4, 13, 13]), 'rgba(20, 20, 20, 0.94)');
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (const side of [-1, 1]) ctx.fillRect(50 + side * dx - 10, y - 6, 7, 3);
      bridge(18);
      temples(18);
      break;
    case 'monocle':
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = '#C8A24A';
      ctx.beginPath();
      ctx.arc(50 + dx, y + 1, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(50 + dx + 11, y + 15);
      ctx.quadraticCurveTo(50 + dx + 17, y + 26, 50 + dx + 9, y + 38);
      ctx.stroke();
      break;
    case 'eyepatch':
      ctx.fillStyle = '#1B1B1B';
      ctx.beginPath();
      ctx.ellipse(50 + dx, y + 1, 15, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(50 + dx - 10, y - 6);
      ctx.lineTo(8, y - 26);
      ctx.moveTo(50 + dx + 10, y - 6);
      ctx.lineTo(96, y - 18);
      ctx.stroke();
      break;
    default:
      break;
  }
}

function starPath(ctx, x, y, r, inner = 0.4) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 ? r * inner : r;
    const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
    ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
  }
  ctx.closePath();
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
  if (avatar.marks.includes('blush')) {
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#FF6B8B';
    for (const side of [-1, 1]) ctx.fillRect(50 + side * 28 - 4, 62, 8, 4);
  }
  ctx.restore();
}

// ─── Flat portrait ────────────────────────────────────────────────────

// A head-and-shoulders portrait on a size×size canvas. Portraits are normally
// rendered from the 3D model (see components/avatar-portrait.gjs); this flat
// version shows while that loads, and stands in where WebGL isn't available.
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

  if (a.type === 'robot') {
    drawRobotPortrait(ctx, a, shape, 50, 44, 31);
    ctx.restore();
    return;
  }

  const hx = 50;
  const hy = 46;
  const U = 56;
  const at = ([x, y]) => [hx + x * U, hy - y * U];

  // Shoulders, in the top's colour.
  shape(() => {
    ctx.moveTo(28, 104);
    ctx.quadraticCurveTo(30, 80, 50, 80);
    ctx.quadraticCurveTo(70, 80, 72, 104);
  }, a.top === 'overalls' ? a.pants : a.shirt);

  const style = hairStyle(a.hair);
  if (!style.none) {
    // Behind the head: the length that hangs past the face.
    const sideBack = (az) => maxReachBetween(style, az);
    shape(() => {
      const right = sideBack(Math.PI / 2);
      for (let i = 0; i <= 16; i++) ctx.lineTo(...at(hairPoint(style, Math.PI / 2, (i / 16) * right)));
      for (let i = 0; i <= 16; i++) {
        const az = Math.PI / 2 + (i / 16) * Math.PI;
        ctx.lineTo(...at(hairPoint(style, az, hairline(style, az))));
      }
      const left = sideBack(-Math.PI / 2);
      for (let i = 16; i >= 0; i--) ctx.lineTo(...at(hairPoint(style, -Math.PI / 2, (i / 16) * left)));
      ctx.closePath();
    }, a.hairColor);
  }

  // Ears, then the squircle head, then the face on it.
  for (const side of [-1, 1]) shape(() => ctx.ellipse(hx + side * HEAD.x * U, hy + 3, 5, 7, 0, 0, Math.PI * 2), a.skin);
  shape(() => {
    const e = 2 / HEAD.power;
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * Math.PI * 2;
      const c = Math.cos(t);
      const sn = Math.sin(t);
      ctx.lineTo(hx + Math.sign(c) * Math.abs(c) ** e * HEAD.x * U, hy + Math.sign(sn) * Math.abs(sn) ** e * HEAD.y * U);
    }
    ctx.closePath();
  }, a.skin);
  const faceW = headAt(FACE_SPAN.az, Math.PI / 2)[0];
  const faceH = headAt(0, Math.PI / 2 - FACE_SPAN.polar)[1];
  ctx.save();
  ctx.translate(hx, hy);
  ctx.scale((faceW * U) / 50, (faceH * U) / 50);
  ctx.translate(-50, -50);
  drawFace(ctx, a, 100);
  ctx.restore();

  if (!style.none) {
    // The hair over the face: down each side, then the hairline across the front.
    shape(() => {
      const right = hairline(style, Math.PI / 2);
      for (let i = 0; i <= 12; i++) ctx.lineTo(...at(hairPoint(style, Math.PI / 2, (i / 12) * right)));
      for (let i = 0; i <= 48; i++) {
        const az = Math.PI / 2 - (i / 48) * Math.PI;
        ctx.lineTo(...at(hairPoint(style, az, hairline(style, az))));
      }
      const left = hairline(style, -Math.PI / 2);
      for (let i = 12; i >= 0; i--) ctx.lineTo(...at(hairPoint(style, -Math.PI / 2, (i / 12) * left)));
      ctx.closePath();
    }, a.hairColor);
  }
  ctx.restore();
}

// The furthest the hair reaches round the back half on one side.
function maxReachBetween(style, az) {
  let most = hairline(style, az);
  for (let i = 1; i <= 8; i++) most = Math.max(most, hairline(style, az + Math.sign(az) * (i / 8) * (Math.PI / 2)));
  return Math.min(most, hairline(style, az) + 0.4);
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
