// Board helpers for the Chess page that chess.js doesn't cover: Chess960 set-ups,
// premoves, clocks, and keeping track of which piece is which so moves animate.
//
// A "board" here is chess.js's board() shape: 8 rows from rank 8 down to rank 1,
// each cell null or { square, type, color }.

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const STANDARD_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const TIME_CONTROLS = [
  { id: 'none', label: 'No clock', group: 'Casual' },
  { id: '1+0', label: '1 min', group: 'Bullet', base: 1, inc: 0 },
  { id: '2+1', label: '2 | 1', group: 'Bullet', base: 2, inc: 1 },
  { id: '3+0', label: '3 min', group: 'Blitz', base: 3, inc: 0 },
  { id: '3+2', label: '3 | 2', group: 'Blitz', base: 3, inc: 2 },
  { id: '5+0', label: '5 min', group: 'Blitz', base: 5, inc: 0 },
  { id: '10+0', label: '10 min', group: 'Rapid', base: 10, inc: 0 },
  { id: '15+10', label: '15 | 10', group: 'Rapid', base: 15, inc: 10 },
  { id: '30+0', label: '30 min', group: 'Classical', base: 30, inc: 0 },
  { id: 'custom', label: 'Custom', group: 'Custom' },
];

// { baseMs, incMs } for the chosen control, or null for an untimed game.
export function clockFor(settings) {
  if (settings.time === 'none') return null;
  const control = TIME_CONTROLS.find((t) => t.id === settings.time);
  const base = control?.base ?? clamp(Number(settings.minutes) || 10, 0.5, 180);
  const inc =
    control?.base !== undefined
      ? control.inc
      : clamp(Number(settings.increment) || 0, 0, 60);
  return { baseMs: base * 60000, incMs: inc * 1000 };
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function formatClock(ms) {
  const t = Math.max(0, ms);
  // Tenths of a second once it's getting tight.
  if (t < 10000) return `0:${(t / 1000).toFixed(1).padStart(4, '0')}`;
  const total = Math.ceil(t / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// A random Chess960 back rank: bishops on opposite colours, the king somewhere
// between the rooks. chess.js can't castle in 960, so castling is off.
export function chess960Fen() {
  const rank = Array(8).fill(null);
  const free = () => rank.map((p, i) => (p ? -1 : i)).filter((i) => i >= 0);
  const place = (piece, options) =>
    (rank[options[Math.floor(Math.random() * options.length)]] = piece);
  place('b', [0, 2, 4, 6]);
  place('b', [1, 3, 5, 7]);
  place('q', free());
  place('n', free());
  place('n', free());
  const [a, k, b] = free();
  rank[a] = 'r';
  rank[k] = 'k';
  rank[b] = 'r';
  const back = rank.join('');
  return `${back}/pppppppp/8/8/8/8/PPPPPPPP/${back.toUpperCase()} w - - 0 1`;
}

export const coords = (square) => [
  FILES.indexOf(square[0]),
  Number(square[1]) - 1,
];
export const squareAt = (file, rank) =>
  file >= 0 && file < 8 && rank >= 0 && rank < 8
    ? `${FILES[file]}${rank + 1}`
    : null;
const cell = (board, square) => {
  const [f, r] = coords(square);
  return board[7 - r][f];
};

// ─── Premoves ──────────────────────────────────────────────────────────

const KNIGHT = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];
const KING = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];
const ROOK_RAYS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const BISHOP_RAYS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

// Exactly the squares `square`'s piece could legally move to after any one
// reply by the side to move: the premoves that might actually get played.
// `fen` is the real position, with the opponent to move.
export function reachableAfterReply(ChessClass, fen, square) {
  const probe = new ChessClass(fen);
  const out = new Set();
  for (const reply of probe.moves({ verbose: true })) {
    probe.move(reply);
    for (const move of probe.moves({ square, verbose: true })) out.add(move.to);
    probe.undo();
  }
  return [...out];
}

// Where a piece might go once several moves have been queued, when the exact
// answer would mean playing out every reply to every reply. Enemy pieces may
// move out of the way, so they don't block; your own pieces stay put, so they do.
// Moves that can never become legal are left out: onto your own pieces or the
// enemy king, pawn pushes through your own pieces, and castling without the
// right to (`castling` is { k, q } for the piece's side) or without the rook.
export function premoveTargets(
  board,
  square,
  castling = { k: false, q: false },
) {
  const piece = cell(board, square);
  if (!piece) return [];
  const [f, r] = coords(square);
  const own = (target) => cell(board, target)?.color === piece.color;
  const out = [];
  const add = (df, dr) => {
    const target = squareAt(f + df, r + dr);
    if (target && !own(target)) out.push(target);
    return target;
  };
  const rays = (dirs) => {
    for (const [df, dr] of dirs) {
      for (let n = 1; n < 8; n++) {
        const target = squareAt(f + df * n, r + dr * n);
        if (!target || own(target)) break;
        out.push(target);
      }
    }
  };
  switch (piece.type) {
    case 'p': {
      const dir = piece.color === 'w' ? 1 : -1;
      const one = add(0, dir);
      if (one && !own(one) && r === (piece.color === 'w' ? 1 : 6))
        add(0, dir * 2);
      add(-1, dir);
      add(1, dir);
      break;
    }
    case 'n':
      KNIGHT.forEach(([df, dr]) => add(df, dr));
      break;
    case 'k': {
      KING.forEach(([df, dr]) => add(df, dr));
      const home = piece.color === 'w' ? '1' : '8';
      if (square === `e${home}`) {
        const rook = (file) => {
          const p = cell(board, `${file}${home}`);
          return p?.type === 'r' && p.color === piece.color;
        };
        const clear = (files) =>
          files.every((file) => !cell(board, `${file}${home}`));
        if (castling.k && rook('h') && clear(['f', 'g'])) add(2, 0);
        if (castling.q && rook('a') && clear(['b', 'c', 'd'])) add(-2, 0);
      }
      break;
    }
    case 'b':
      rays(BISHOP_RAYS);
      break;
    case 'r':
      rays(ROOK_RAYS);
      break;
    default:
      rays([...ROOK_RAYS, ...BISHOP_RAYS]);
  }
  return out.filter((target) => cell(board, target)?.type !== 'k');
}

// The board as it will look once the queued premoves are played, so the
// pieces can be shown where the player has already sent them.
export function applyPremoves(board, premoves) {
  const next = board.map((row) => row.slice());
  const set = (square, piece) => {
    const [f, r] = coords(square);
    next[7 - r][f] = piece && { ...piece, square };
  };
  for (const { from, to, promotion, color } of premoves) {
    const piece = cell(next, from);
    // Skip a premove whose piece has since been captured, rather than moving whatever took it.
    if (!piece || (color && piece.color !== color)) continue;
    set(from, null);
    const lastRank = to[1] === (piece.color === 'w' ? '8' : '1');
    set(
      to,
      piece.type === 'p' && lastRank
        ? { ...piece, type: promotion ?? 'q' }
        : piece,
    );
    // Castling premove: bring the rook along.
    if (piece.type === 'k' && Math.abs(coords(to)[0] - coords(from)[0]) === 2) {
      const rank = from[1];
      const kingside = to[0] === 'g';
      const rookFrom = `${kingside ? 'h' : 'a'}${rank}`;
      const rook = cell(next, rookFrom);
      if (rook?.type === 'r') {
        set(rookFrom, null);
        set(`${kingside ? 'f' : 'd'}${rank}`, rook);
      }
    }
  }
  return next;
}

// ─── Piece identity ────────────────────────────────────────────────────

// Matches the pieces on a new board to the previous ones, so each keeps its id
// and can glide to where it went. Pieces still on their square keep it; the
// rest are paired with the nearest unclaimed piece of the same kind (a pawn,
// for a fresh promotion). This handles normal moves, captures, castling, en
// passant, takebacks and whole-position loads without special cases.
export function syncTokens(previous, board, nextId) {
  const bySquare = new Map(previous.map((t) => [t.square, t]));
  const used = new Set();
  const tokens = [];
  const unplaced = [];
  for (const row of board) {
    for (const piece of row) {
      if (!piece) continue;
      const same = bySquare.get(piece.square);
      if (same && same.type === piece.type && same.color === piece.color) {
        used.add(same.id);
        tokens.push(same);
      } else {
        unplaced.push(piece);
      }
    }
  }
  const distance = (a, b) => {
    const [af, ar] = coords(a);
    const [bf, br] = coords(b);
    return Math.hypot(af - bf, ar - br);
  };
  for (const piece of unplaced) {
    const pool = previous.filter(
      (t) => !used.has(t.id) && t.color === piece.color,
    );
    const candidates = pool.filter((t) => t.type === piece.type);
    const from = (
      candidates.length ? candidates : pool.filter((t) => t.type === 'p')
    ).sort(
      (a, b) =>
        distance(a.square, piece.square) - distance(b.square, piece.square),
    )[0];
    if (from) used.add(from.id);
    tokens.push({
      id: from?.id ?? nextId(),
      type: piece.type,
      color: piece.color,
      square: piece.square,
    });
  }
  return tokens;
}

// Whether `color` still has enough to ever checkmate (for a win on time).
export function canMate(board, color) {
  const pieces = board
    .flat()
    .filter((p) => p && p.color === color && p.type !== 'k');
  if (pieces.some((p) => ['p', 'r', 'q'].includes(p.type))) return true;
  return pieces.length >= 2;
}
