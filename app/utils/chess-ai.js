import { Chess } from 'chess.js';

// A small chess engine on top of chess.js (which supplies the legal moves):
// negamax with alpha-beta pruning, a short capture-only quiescence search, and
// material plus piece-square tables for evaluation. The search runs in slices
// that yield back to the browser, so the board never freezes while it thinks.

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 100000;
const QUIESCENCE_DEPTH = 3;
const SLICE_MS = 12;
const YIELD_EVERY_NODES = 200;

// Piece-square tables from White's side, rank 8 first (the order of chess.board()).
// From Tomasz Michniewski's "Simplified Evaluation Function".
const PST = {
  p: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5, 5, 10, 25, 25, 10, 5, 5],
    [0, 0, 0, 20, 20, 0, 0, 0],
    [5, -5, -10, 0, 0, -10, -5, 5],
    [5, 10, 10, -20, -20, 10, 10, 5],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ],
  n: [
    [-50, -40, -30, -30, -30, -30, -40, -50],
    [-40, -20, 0, 0, 0, 0, -20, -40],
    [-30, 0, 10, 15, 15, 10, 0, -30],
    [-30, 5, 15, 20, 20, 15, 5, -30],
    [-30, 0, 15, 20, 20, 15, 0, -30],
    [-30, 5, 10, 15, 15, 10, 5, -30],
    [-40, -20, 0, 5, 5, 0, -20, -40],
    [-50, -40, -30, -30, -30, -30, -40, -50],
  ],
  b: [
    [-20, -10, -10, -10, -10, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 10, 10, 5, 0, -10],
    [-10, 5, 5, 10, 10, 5, 5, -10],
    [-10, 0, 10, 10, 10, 10, 0, -10],
    [-10, 10, 10, 10, 10, 10, 10, -10],
    [-10, 5, 0, 0, 0, 0, 5, -10],
    [-20, -10, -10, -10, -10, -10, -10, -20],
  ],
  r: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [5, 10, 10, 10, 10, 10, 10, 5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [0, 0, 0, 5, 5, 0, 0, 0],
  ],
  q: [
    [-20, -10, -10, -5, -5, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 5, 5, 5, 0, -10],
    [-5, 0, 5, 5, 5, 5, 0, -5],
    [0, 0, 5, 5, 5, 5, 0, -5],
    [-10, 5, 5, 5, 5, 5, 0, -10],
    [-10, 0, 5, 0, 0, 0, 0, -10],
    [-20, -10, -10, -5, -5, -10, -10, -20],
  ],
  k: [
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-20, -30, -30, -40, -40, -30, -30, -20],
    [-10, -20, -20, -20, -20, -20, -20, -10],
    [20, 20, 0, 0, 0, 0, 20, 20],
    [20, 30, 10, 0, 0, 10, 30, 20],
  ],
};

export const LEVELS = {
  easy: { label: 'Easy', depth: 1, timeMs: 400, blunder: 0.35 },
  medium: { label: 'Medium', depth: 2, timeMs: 1200, blunder: 0 },
  hard: { label: 'Hard', depth: 4, timeMs: 2500, blunder: 0 },
};

// Score from White's point of view, in centipawns.
export function evaluate(chess) {
  let score = 0;
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const table = PST[piece.type];
      const value =
        VALUE[piece.type] +
        (piece.color === 'w' ? table[r][c] : table[7 - r][c]);
      score += piece.color === 'w' ? value : -value;
    }
  }
  return score;
}

// Most valuable victim, least valuable attacker first; promotions near the top.
function orderMoves(moves, first) {
  const weight = (m) => {
    let w = 0;
    if (m.captured) w += 10 * VALUE[m.captured] - VALUE[m.piece] + 1000;
    if (m.promotion) w += VALUE[m.promotion] + 900;
    if (first && m.san === first) w += 100000;
    return w;
  };
  return moves.sort((a, b) => weight(b) - weight(a));
}

class Search {
  nodes = 0;

  constructor(chess, deadline) {
    this.chess = chess;
    this.deadline = deadline;
  }

  side() {
    return this.chess.turn() === 'w' ? 1 : -1;
  }

  *quiesce(alpha, beta, depth) {
    if (++this.nodes % YIELD_EVERY_NODES === 0) yield;
    const standPat = this.side() * evaluate(this.chess);
    if (standPat >= beta || depth === 0) return standPat;
    if (standPat > alpha) alpha = standPat;
    const captures = orderMoves(
      this.chess
        .moves({ verbose: true })
        .filter((m) => m.captured || m.promotion),
    );
    for (const move of captures) {
      this.chess.move(move);
      const score = -(yield* this.quiesce(-beta, -alpha, depth - 1));
      this.chess.undo();
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  *negamax(depth, alpha, beta, ply) {
    if (++this.nodes % YIELD_EVERY_NODES === 0) yield;
    const moves = this.chess.moves({ verbose: true });
    if (!moves.length) return this.chess.inCheck() ? -MATE + ply : 0;
    if (this.chess.isDraw()) return 0;
    if (depth === 0) return yield* this.quiesce(alpha, beta, QUIESCENCE_DEPTH);
    let best = -Infinity;
    for (const move of orderMoves(moves)) {
      this.chess.move(move);
      const score = -(yield* this.negamax(depth - 1, -beta, -alpha, ply + 1));
      this.chess.undo();
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    return best;
  }

  // Every root move with its score, best first.
  *root(depth, previousBest) {
    const scored = [];
    let alpha = -Infinity;
    for (const move of orderMoves(
      this.chess.moves({ verbose: true }),
      previousBest,
    )) {
      this.chess.move(move);
      const score = -(yield* this.negamax(depth - 1, -Infinity, -alpha, 1));
      this.chess.undo();
      scored.push({ move, score });
      if (score > alpha) alpha = score;
    }
    return scored.sort((a, b) => b.score - a.score);
  }
}

const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));

// Picks a move for the side to play in `fen`. Deepens one ply at a time and
// keeps the last search that finished before the time budget ran out.
export async function findBestMove(fen, levelName = 'medium', { signal } = {}) {
  const level = LEVELS[levelName] ?? LEVELS.medium;
  const start = performance.now();
  const deadline = start + level.timeMs;
  let best = null;

  for (let depth = 1; depth <= level.depth; depth++) {
    const search = new Search(new Chess(fen), deadline);
    const run = search.root(depth, best?.[0]?.move.san);
    let slice = performance.now();
    let result = null;
    for (;;) {
      const step = run.next();
      if (step.done) {
        result = step.value;
        break;
      }
      if (signal?.aborted) return null;
      const now = performance.now();
      // Out of time: keep the previous depth's answer (depth 1 always finishes).
      if (best && now > deadline) break;
      if (now - slice > SLICE_MS) {
        await breathe();
        slice = performance.now();
      }
    }
    if (!result) break;
    best = result;
    if (Math.abs(best[0].score) > MATE - 100) break; // found a forced mate, no need to look deeper
  }

  if (!best?.length) return null;
  // Easy sometimes plays a reasonable-but-not-best move, so it can be beaten.
  if (level.blunder && Math.random() < level.blunder) {
    const decent = best.filter((entry) => entry.score > best[0].score - 250);
    return decent[Math.floor(Math.random() * decent.length)].move;
  }
  return best[0].move;
}
