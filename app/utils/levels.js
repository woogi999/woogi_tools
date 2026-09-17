// Levels you drew yourself, for Snake and Minesweeper.
//
// A level is small, flat and JSON-safe, so it can live in localStorage and also
// travel as a share code:
//
//   { id, game: 'snake' | 'mines', name, width, height, cells }
//
// `cells` is one string, row by row, one character a square. What the characters
// mean is the game's business (see KINDS below), but '.' is always empty. Using
// a string rather than an array of triples keeps a 30×30 level at under a
// kilobyte before it is even compressed, which is what makes a share code short
// enough to paste into a chat message.
//
//   listLevels(game)      the ones saved in this browser
//   saveLevel(level)      add or replace one, returns it with an id
//   deleteLevel(game, id)
//   encodeLevel(level)    -> a share code
//   decodeLevel(code)     -> a level, or null if the code is rubbish
//
// Share codes are deflate + base64url of the JSON: fflate is already a
// dependency (Woono's nearby play uses it for the same reason).

import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';

const KEY = 'woogi-levels';
const CODE_PREFIX = 'WOOGI1-';
export const SIZE_RANGE = [8, 40];
export const NAME_MAX = 32;
// A level with more than this in it is almost certainly not one of ours.
const MAX_CELLS = SIZE_RANGE[1] * SIZE_RANGE[1];

// The island is built from the squares: every square that is land pulls a
// beach up around it, and the sea is wherever the land stops. So the board's
// shape and the island's shape are both yours to draw. Three characters shape
// them, and none of them is somewhere you can play:
//
//   '~'  sea    no island here: cut the board in two and you have two islands
//   's'  beach  island with no board on it: sand you can look at, not stand on
//   'w'  water  a pond dug into the island, with the sea in it
//
// Rules-wise all three are simply off the board. Snake treats them as solid
// (the mask joins its obstacle set) and Minesweeper leaves them undiggable.
const SHAPES = [
  {
    char: 'w',
    id: 'water',
    label: 'Water',
    hint: 'A pond dug into the island. Solid, and joins up with its neighbours.',
  },
  {
    char: 's',
    id: 'beach',
    label: 'Beach',
    hint: 'Island with no board on it. Off limits, but the island is there.',
  },
  {
    char: '~',
    id: 'void',
    label: 'Sea',
    hint: 'No island at all. Cut the board in two and you have two islands.',
  },
];
// Every character that is not part of the board.
export const OFF_BOARD = new Set(SHAPES.map((k) => k.char));

// What you can paint, per game. `char` is what it becomes in `cells`.
export const KINDS = {
  snake: [
    { char: '.', id: 'empty', label: 'Empty', hint: 'Open ground.' },
    {
      char: 'r',
      id: 'rock',
      label: 'Rock',
      hint: 'Solid. Hitting one is fatal.',
    },
    {
      char: 'p',
      id: 'palm',
      label: 'Palm',
      hint: 'Solid, and tall enough to see over the island.',
    },
    ...SHAPES,
  ],
  mines: [
    { char: '.', id: 'empty', label: 'Safe', hint: 'Ordinary ground.' },
    {
      char: 'm',
      id: 'mine',
      label: 'Mine',
      hint: 'Buried here, exactly where you put it.',
    },
    ...SHAPES,
  ],
};

export const GAMES = [
  { id: 'snake', label: 'Snake' },
  { id: 'mines', label: 'Minesweeper' },
];

const clampSize = (n) =>
  Math.max(
    SIZE_RANGE[0],
    Math.min(SIZE_RANGE[1], Math.round(Number(n)) || SIZE_RANGE[0]),
  );

export const blankCells = (width, height) => '.'.repeat(width * height);

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(parsed) ? parsed.map(clean).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function write(levels) {
  try {
    localStorage.setItem(KEY, JSON.stringify(levels));
  } catch {
    // storage blocked or full: the level still works for this visit
  }
}

// Anything coming out of storage, or in from a share code, is treated as
// untrusted: the wrong size, an unknown character or a missing field makes it
// nothing rather than a half-built level the games would then trip over.
export function clean(level) {
  if (!level || typeof level !== 'object') return null;
  const game =
    level.game === 'mines' ? 'mines' : level.game === 'snake' ? 'snake' : null;
  if (!game) return null;
  const width = clampSize(level.width);
  const height = clampSize(level.height);
  if (width * height > MAX_CELLS) return null;
  const allowed = new Set(KINDS[game].map((k) => k.char));
  const raw = typeof level.cells === 'string' ? level.cells : '';
  const cells = Array.from({ length: width * height }, (_, i) =>
    allowed.has(raw[i]) ? raw[i] : '.',
  ).join('');
  return {
    id:
      typeof level.id === 'string' && level.id
        ? level.id.slice(0, 40)
        : newId(),
    game,
    name:
      String(level.name ?? '')
        .trim()
        .slice(0, NAME_MAX) || 'Untitled',
    width,
    height,
    cells,
  };
}

const newId = () =>
  `lv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function listLevels(game) {
  const all = read();
  return game ? all.filter((l) => l.game === game) : all;
}

export function findLevel(game, id) {
  return listLevels(game).find((l) => l.id === id) ?? null;
}

export function saveLevel(level) {
  const tidy = clean(level);
  if (!tidy) return null;
  const all = read().filter((l) => l.id !== tidy.id);
  write([...all, tidy]);
  return tidy;
}

export function deleteLevel(game, id) {
  write(read().filter((l) => !(l.game === game && l.id === id)));
}

export function newLevel(game, width = 20, height = 20) {
  const w = clampSize(width);
  const h = clampSize(height);
  return {
    id: newId(),
    game,
    name: '',
    width: w,
    height: h,
    cells: blankCells(w, h),
  };
}

// ─── Share codes ────────────────────────────────────────────────────────

const toBase64Url = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

const fromBase64Url = (text) => {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

export function encodeLevel(level) {
  const tidy = clean(level);
  if (!tidy) return '';
  // The id is left out: whoever loads it gets their own, so importing the same
  // level twice doesn't overwrite the copy they already had.
  const { game, name, width, height, cells } = tidy;
  const packed = deflateSync(
    strToU8(JSON.stringify({ game, name, width, height, cells })),
    { level: 9 },
  );
  return CODE_PREFIX + toBase64Url(packed);
}

export function decodeLevel(code) {
  const text = String(code ?? '').trim();
  if (!text.startsWith(CODE_PREFIX)) return null;
  try {
    const json = strFromU8(
      inflateSync(fromBase64Url(text.slice(CODE_PREFIX.length))),
    );
    return clean({ ...JSON.parse(json), id: newId() });
  } catch {
    return null;
  }
}

// ─── What the games ask for ─────────────────────────────────────────────

// The three shapes a level has, each as a flat true/false array the size of
// the board: `mask` is where you can play, `land` is where there is island
// (the board plus its beaches and ponds), and `water` is the ponds.
function shapesOf(tidy, size = null) {
  const width = size ?? tidy.width;
  const height = size ?? tidy.height;
  const at = (i) => {
    const x = i % width;
    const y = Math.floor(i / width);
    // A level fitted into a bigger board (Snake plays square) has nothing past
    // its own edge, and nothing is the sea.
    if (x >= tidy.width || y >= tidy.height) return '~';
    return tidy.cells[y * tidy.width + x];
  };
  const cells = Array.from({ length: width * height }, (_, i) => at(i));
  const mask = cells.map((c) => !OFF_BOARD.has(c));
  return {
    mask: mask.some(Boolean) ? mask : null,
    land: cells.map((c) => c !== '~'),
    water: cells.map((c) => c === 'w'),
  };
}

// Which squares are actually part of the board: true where you can play, false
// where the grid is cut out. Every scene and both rule sets take this shape.
export function levelMask(level) {
  const tidy = clean(level);
  return tidy ? shapesOf(tidy).mask : null;
}

// Snake plays on a square board, so a level that is not square is fitted into
// one the size of its width: anything past the level's own edge is sea rather
// than quietly turned into playable ground.
export function snakeShapes(level, size) {
  const tidy = clean(level);
  if (!tidy || tidy.game !== 'snake') return null;
  return shapesOf(tidy, size);
}

// Snake wants [x, y, kind] triples.
export function snakeObstacles(level) {
  const tidy = clean(level);
  if (!tidy || tidy.game !== 'snake') return [];
  // Named rather than "everything that is not empty", so a shape painted onto
  // a square cannot accidentally become a rock. Sea, beach and water are
  // carried by the mask (and drawn by the terrain), not as obstacles.
  const SOLID = { r: 'rock', p: 'palm' };
  const out = [];
  for (let i = 0; i < tidy.cells.length; i++) {
    const kind = SOLID[tidy.cells[i]];
    if (kind) out.push([i % tidy.width, Math.floor(i / tidy.width), kind]);
  }
  return out;
}

// Minesweeper wants a flat true/false array the size of the field.
export function mineLayout(level) {
  const tidy = clean(level);
  if (!tidy || tidy.game !== 'mines') return null;
  return {
    width: tidy.width,
    height: tidy.height,
    mines: Array.from(
      { length: tidy.width * tidy.height },
      (_, i) => tidy.cells[i] === 'm',
    ),
    ...shapesOf(tidy),
  };
}
