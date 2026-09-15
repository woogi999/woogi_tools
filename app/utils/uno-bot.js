import { COLORS, act, legalActions, playableIds, canDrawNow, canPassNow, canChallengeNow, actorIndex, drawAmount, isTargeted, timeOut, nextIndex } from './uno';

// How computer players decide, by actually thinking it through: for every move
// they could make, they play the rest of the game out many times and keep the
// move that wins most often (Monte Carlo search).
//
// They play fair. A bot only knows what a person in its seat would: its own
// hand, the pile, and how many cards everyone holds. Each imagined game deals
// the cards it can't see at random (from the cards it hasn't seen), so it
// can't peek at anyone's hand or at the deck.
//
// The thinking runs in short slices between frames, so the table keeps
// animating. It stops once one move is clearly best, or when time's up.

const SLICE_MS = 8;
const MIN_TRIES = 24;
const MAX_TRIES = 400;
const MAX_THINK_MS = 2200;
const MAX_STEPS = 300;

const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

// The bot's best move, or null if it has none (or was cancelled).
export async function think(state, index, { signal, budgetMs = MAX_THINK_MS } = {}) {
  const actions = candidates(state, index);
  if (actions.length <= 1) return actions[0] ?? null;
  const stats = actions.map(() => ({ n: 0, sum: 0, squares: 0 }));
  const started = performance.now();
  let tries = 0;
  for (;;) {
    const sliceEnd = performance.now() + SLICE_MS;
    while (performance.now() < sliceEnd) {
      const arm = chooseArm(stats, tries);
      const world = imagine(state, index);
      const score = act(world, index, actions[arm]) ? playOut(world, index) : 0;
      const s = stats[arm];
      s.n++;
      s.sum += score;
      s.squares += score * score;
      tries++;
    }
    if (signal?.aborted) return null;
    if (confident(stats) || stats.every((s) => s.n >= MAX_TRIES) || performance.now() - started > budgetMs) break;
    await nextFrame();
    if (signal?.aborted) return null;
  }
  let best = 0;
  stats.forEach((s, i) => {
    if (s.n && s.sum / s.n > stats[best].sum / Math.max(1, stats[best].n)) best = i;
  });
  return actions[best];
}

// The moves worth weighing. Wild cards only consider the two colours the bot holds most of.
function candidates(state, index) {
  const colors = favouriteColors(state.players[index].hand).slice(0, 2);
  return legalActions(state, index).filter((a) => a.type !== 'play' || a.color === null || colors.includes(a.color));}

// Upper-confidence picking: mostly try the moves that look best, but give every move a fair look.
function chooseArm(stats, total) {
  let best = 0;
  let bestValue = -Infinity;
  stats.forEach((s, i) => {
    const value = s.n < MIN_TRIES ? Infinity - s.n : s.sum / s.n + Math.sqrt((2 * Math.log(total + 1)) / s.n);
    if (value > bestValue) {
      bestValue = value;
      best = i;
    }
  });
  return best;
}

// Done when the best move's worst case beats every other move's best case.
function confident(stats) {
  if (stats.some((s) => s.n < MIN_TRIES)) return false;
  const bounds = stats.map((s) => {
    const mean = s.sum / s.n;
    const spread = 2.5 * Math.sqrt(Math.max(1e-6, s.squares / s.n - mean * mean) / s.n);
    return { low: mean - spread, high: mean + spread, mean };
  });
  const top = bounds.reduce((a, b) => (b.mean > a.mean ? b : a));
  return bounds.every((b) => b === top || top.low > b.high);
}

function favouriteColors(hand) {
  const counts = Object.fromEntries(COLORS.map((c) => [c, 0]));
  for (const card of hand) if (card.color) counts[card.color]++;
  return [...COLORS].sort((a, b) => counts[b] - counts[a]);
}

// One possible version of the game as the bot sees it: its own cards as they
// are, everyone else's (and the deck) dealt at random from the cards it can't see.
function imagine(state, me) {
  const unseen = [...state.drawPile];
  state.players.forEach((p, i) => {
    if (i !== me) unseen.push(...p.hand);
  });
  const theirDrawn = state.drawn && state.turn !== me;
  if (theirDrawn) unseen.push(state.drawn);
  shuffle(unseen);
  const players = state.players.map((p, i) => ({ ...p, hand: i === me ? [...p.hand] : unseen.splice(0, p.hand.length) }));
  let pending = state.pending && { ...state.pending };
  // Whether a wild draw card was an illegal bluff is hidden too: guess from how likely its player was to hold the old colour.
  if (pending?.offender !== null && pending?.offender !== undefined && pending.offender !== me) {
    const share = unseen.length ? unseen.filter((c) => c.color === pending.prevColor).length / unseen.length : 0.25;
    pending = { ...pending, hadMatch: Math.random() < 1 - (1 - share) ** (players[pending.offender].hand.length + 1) };
  }
  return {
    ...state,
    sim: true,
    players,
    drawn: theirDrawn ? unseen.pop() : state.drawn,
    drawPile: unseen,
    discard: [...state.discard],
    pending,
    choice: state.choice && { ...state.choice },
    log: [],
    events: [],
  };
}

function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

// Plays an imagined game to the end with quick rule-of-thumb moves for everyone.
// Winning scores 1; losing scores a little for holding few cards; running long scores by position.
function playOut(world, me) {
  for (let step = 0; step < MAX_STEPS && world.winner === null; step++) {
    const actor = actorIndex(world);
    const hand = world.players[actor].hand;
    if (hand.length === 2) world.players[actor].uno = 'armed';
    const move = quickMove(world, actor);
    if (!move || !act(world, actor, move)) timeOut(world);
  }
  const mine = world.players[me].hand.length;
  if (world.winner === me) return 1;
  if (world.winner !== null) return 0.12 * Math.max(0, 1 - mine / 8);
  const fewest = Math.min(...world.players.filter((_, i) => i !== me).map((p) => p.hand.length));
  return Math.max(0, Math.min(1, 0.5 + (fewest - mine) * 0.06));
}

// A decent, instant move: what the imagined players do inside the search.
export function quickMove(state, index) {
  const player = state.players[index];
  const others = state.players.map((p, i) => ({ i, n: p.hand.length })).filter((p) => p.i !== index);
  const leader = others.reduce((a, b) => (b.n < a.n ? b : a));
  if (state.choice?.player === index) {
    const { card, color } = state.choice;
    return !card.color && !color ? { type: 'choose', color: favouriteColors(player.hand)[0] } : { type: 'choose', target: leader.i };
  }
  if (state.swapPending === index) return { type: 'swap', target: leader.i };
  if (canChallengeNow(state, index) && Math.random() < 0.3) return { type: 'challenge' };

  const ids = playableIds(state, index);
  const cards = ids.map((id) => (state.drawn?.id === id ? state.drawn : player.hand.find((c) => c.id === id)));
  if (state.drawn && state.turn === index && !state.pending) {
    return cards.length ? playMove(state, player, cards[0], leader) : { type: 'keep' };
  }
  if (cards.length) {
    const threatened = state.players[nextIndex(state, 1, index)].hand.length <= 2;
    const rank = (card) => {
      let score = Math.random();
      if (card.color === state.color) score += 10;
      if (/^\d$/.test(card.value)) score += Number(card.value) / 10;
      if (['skip', 'reverse', 'draw2', 'target2'].includes(card.value)) score += threatened ? 30 : 5;
      if (!card.color && drawAmount(card)) score += threatened || state.pending ? 40 : -30;
      if (card.value === 'wild') score -= 20;
      if (state.pending && drawAmount(card)) score += 50 - drawAmount(card);
      return score;
    };
    const card = cards.reduce((a, b) => (rank(b) > rank(a) ? b : a));
    return playMove(state, player, card, leader);
  }
  if (canDrawNow(state, index)) return { type: 'draw' };
  if (canPassNow(state, index)) return { type: 'pass' };
  return null;
}

function playMove(state, player, card, leader) {
  return { type: 'play', cardId: card.id, color: card.color ? null : favouriteColors(player.hand.filter((c) => c.id !== card.id))[0], target: isTargeted(card) ? leader.i : null };
}
