// Woono (our Uno-style card game) rules, kept free of any rendering. The host runs this (games against the
// computer are just a lobby no one else joined) and sends each player only
// what they're allowed to see: their own hand and everyone else's card counts.

export const COLORS = ['red', 'yellow', 'green', 'blue'];
export const MAX_PLAYERS = 8;
const HISTORY = 6;
const EVENT_HISTORY = 24;
const DRAW_UNTIL_LIMIT = 40;

// House rules, all set in the lobby.
export const DEFAULT_RULES = {
  handSize: 7,
  // 'off' | 'same' (+2 on +2, +4 on +4) | 'mixed' (any draw card on any other)
  stacking: 'off',
  // Play a 7 to swap hands with a player of your choice.
  sevens: false,
  // Play a 0 and every hand moves on to the next player.
  zeros: false,
  // Play an identical card (same colour and number or symbol) out of turn.
  jumpIn: false,
  // Keep drawing until you get a card you can play.
  drawUntilPlayable: false,
  unoPenalty: 2,
  // Seconds each player gets to move; 0 means no limit.
  turnTime: 0,
  // Challenge a Wild Draw Four: if the player had a card of the colour in play, they draw instead.
  challenge: false,
};

export const TURN_TIMES = [0, 10, 15, 30, 60];
// A failed challenge costs the challenger this many cards on top of the draw.
export const CHALLENGE_EXTRA = 2;

const LABELS = { skip: 'Skip', reverse: 'Reverse', draw2: 'Draw Two', wild: 'Wild', wild4: 'Wild Draw Four' };
const capitalise = (s) => s[0].toUpperCase() + s.slice(1);

export function cardName(card) {
  if (!card.color) return LABELS[card.value];
  return `${capitalise(card.color)} ${LABELS[card.value] ?? card.value}`;
}

export const HAND_SIZE_RANGE = [1, 20];
export const PENALTY_RANGE = [0, 10];

// A whole number within [min, max], or the fallback when it isn't a number at all.
export function clampInt(value, [min, max], fallback) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && String(value).trim() !== '' ? Math.min(max, Math.max(min, n)) : fallback;
}

export function normaliseRules(rules) {
  const r = { ...DEFAULT_RULES, ...rules };
  return {
    handSize: clampInt(r.handSize, HAND_SIZE_RANGE, DEFAULT_RULES.handSize),
    stacking: ['off', 'same', 'mixed'].includes(r.stacking) ? r.stacking : 'off',
    sevens: Boolean(r.sevens),
    zeros: Boolean(r.zeros),
    jumpIn: Boolean(r.jumpIn),
    drawUntilPlayable: Boolean(r.drawUntilPlayable),
    unoPenalty: clampInt(r.unoPenalty, PENALTY_RANGE, DEFAULT_RULES.unoPenalty),
    turnTime: TURN_TIMES.includes(Number(r.turnTime)) ? Number(r.turnTime) : 0,
    challenge: Boolean(r.challenge),
  };
}

// The standard 108-card deck: per colour one 0, two of each 1–9, Skip, Reverse
// and Draw Two; plus four Wilds and four Wild Draw Fours. Big tables and big
// starting hands shuffle in more decks.
export function buildDeck(copies = 1) {
  const cards = [];
  let id = 0;
  for (let copy = 0; copy < copies; copy++) {
    for (const color of COLORS) {
      cards.push({ id: id++, color, value: '0' });
      for (const value of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2']) {
        cards.push({ id: id++, color, value }, { id: id++, color, value });
      }
    }
    for (let i = 0; i < 4; i++) cards.push({ id: id++, color: null, value: 'wild' }, { id: id++, color: null, value: 'wild4' });
  }
  return cards;
}

function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

// players: [{ id, name, kind, avatar }] where kind is 'human' | 'bot'.
export function createGame(players, rules = DEFAULT_RULES) {
  const r = normaliseRules(rules);
  const state = {
    // Tells screens a new game from a rematch of the same players.
    gameId: Math.random().toString(36).slice(2, 10),
    rules: r,
    players: players.map((p) => ({ ...p, hand: [], calledUno: false })),
    // Enough decks that the deal leaves at least ~40 cards to draw from.
    drawPile: shuffle(buildDeck(Math.max(1, Math.ceil((players.length * r.handSize + 40) / 108)))),
    discard: [],
    color: null,
    turn: Math.floor(Math.random() * players.length),
    direction: 1,
    drawnCardId: null, // after drawing a playable card, only that card may be played (or pass)
    pendingDraw: 0, // stacked +2/+4 cards the player to move must answer or draw
    pendingType: null,
    swapPending: null, // a player who played a 7 and still has to pick who to swap with
    challengeable: null, // { offender, hadMatch }: the Wild Draw Four the player to move may challenge
    winner: null,
    log: [],
    events: [],
    seq: 0,
  };
  for (let round = 0; round < r.handSize; round++) for (const player of state.players) player.hand.push(state.drawPile.pop());
  // The first face-up card is always a plain number, so no one starts with an effect.
  const first = state.drawPile.findIndex((card) => /^\d$/.test(card.value));
  const [top] = state.drawPile.splice(first, 1);
  state.discard.push(top);
  state.color = top.color;
  note(state, `Game on. First card: ${cardName(top)}.`);
  emit(state, { type: 'deal' });
  return state;
}

function note(state, text) {
  state.log = [...state.log.slice(-(HISTORY - 1)), { id: ++state.seq, text }];
}

// Things that happened, for the table to animate. Public information only.
function emit(state, event) {
  state.events = [...state.events.slice(-(EVENT_HISTORY - 1)), { id: ++state.seq, ...event }];
}

export const topCard = (state) => state.discard[state.discard.length - 1];

export function canPlay(state, card) {
  const top = topCard(state);
  if (state.pendingDraw) {
    // A Wild Draw Four waiting on a challenge, with no stacking: take it or challenge it.
    if (state.rules.stacking === 'off') return false;
    if (card.value === 'wild4') return state.rules.stacking === 'mixed' || state.pendingType === 'wild4';
    if (card.value === 'draw2') return state.pendingType === 'draw2' || (state.rules.stacking === 'mixed' && card.color === state.color);
    return false;
  }
  return !card.color || card.color === state.color || card.value === top.value;
}

// An exact copy of the top card, which Jump-In lets anyone play at any time.
function isJumpIn(state, card) {
  const top = topCard(state);
  return state.rules.jumpIn && Boolean(top.color) && card.color === top.color && card.value === top.value;
}

export function playableIds(state, index) {
  if (state.winner !== null || state.swapPending !== null) return [];
  const hand = state.players[index].hand;
  if (state.turn !== index) return hand.filter((c) => isJumpIn(state, c)).map((c) => c.id);
  if (state.drawnCardId !== null) return hand.filter((c) => c.id === state.drawnCardId && canPlay(state, c)).map((c) => c.id);
  return hand.filter((c) => canPlay(state, c)).map((c) => c.id);
}

export const nextIndex = (state, steps = 1, from = state.turn) => {
  const n = state.players.length;
  return (((from + state.direction * steps) % n) + n) % n;
};

function advance(state, steps = 1) {
  state.turn = nextIndex(state, steps);
  state.drawnCardId = null;
  state.turnId = (state.turnId ?? 0) + 1;
}

function drawCards(state, index, count) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (!state.drawPile.length) {
      // Reshuffle everything under the top card back into the draw pile.
      const top = state.discard.pop();
      state.drawPile = shuffle(state.discard);
      state.discard = [top];
      if (!state.drawPile.length) break;
    }
    const card = state.drawPile.pop();
    state.players[index].hand.push(card);
    drawn.push(card);
  }
  if (drawn.length) emit(state, { type: 'draw', player: index, count: drawn.length });
  return drawn;
}

// Each action returns true if it was allowed.

export function play(state, index, cardId, chosenColor) {
  if (!playableIds(state, index).includes(cardId)) return false;
  const player = state.players[index];
  const card = player.hand.find((c) => c.id === cardId);
  if (!card.color && !COLORS.includes(chosenColor)) return false;
  // Whether this Wild Draw Four was played while holding the colour in play (which a challenge catches).
  const hadMatch = card.value === 'wild4' && player.hand.some((c) => c.id !== card.id && c.color === state.color);
  state.challengeable = null;

  if (state.turn !== index) {
    note(state, `${player.name} jumped in!`);
    state.turn = index;
    state.drawnCardId = null;
    state.turnId = (state.turnId ?? 0) + 1;
  }

  player.hand = player.hand.filter((c) => c.id !== cardId);
  state.discard.push(card);
  state.color = card.color ?? chosenColor;
  note(state, `${player.name} played ${cardName(card)}${card.color ? '' : `, chose ${chosenColor}`}.`);
  emit(state, { type: 'play', player: index, card, color: state.color });

  if (!player.hand.length) {
    state.winner = index;
    state.pendingDraw = 0;
    note(state, `${player.name} won!`);
    emit(state, { type: 'win', player: index });
    return true;
  }

  // Down to one card without calling UNO: draw the penalty.
  if (player.hand.length === 1 && !player.calledUno) {
    drawCards(state, index, state.rules.unoPenalty);
    note(state, `${player.name} forgot to call Woono and drew ${state.rules.unoPenalty}.`);
  }
  player.calledUno = false;

  const rules = state.rules;
  const twoPlayers = state.players.length === 2;
  if (card.value === 'skip') {
    const skipped = nextIndex(state);
    note(state, `${state.players[skipped].name} is skipped.`);
    emit(state, { type: 'skip', player: skipped });
    advance(state, 2);
  } else if (card.value === 'reverse') {
    emit(state, { type: 'reverse' });
    if (twoPlayers) advance(state, 2); // with two players, Reverse works like Skip
    else {
      state.direction *= -1;
      advance(state);
    }
  } else if (card.value === 'draw2' || card.value === 'wild4') {
    const count = card.value === 'draw2' ? 2 : 4;
    if (card.value === 'wild4' && rules.challenge) {
      // The next player gets to decide: take the cards, challenge, or stack if stacking is on.
      state.pendingDraw += count;
      state.pendingType = card.value;
      advance(state);
      state.challengeable = { offender: index, hadMatch };
      note(state, `${state.players[state.turn].name} can take ${state.pendingDraw} or challenge.`);
    } else if (rules.stacking !== 'off') {
      state.pendingDraw += count;
      state.pendingType = card.value;
      advance(state);
      note(state, `${state.players[state.turn].name} must stack or draw ${state.pendingDraw}.`);
    } else {
      const victim = nextIndex(state);
      drawCards(state, victim, count);
      note(state, `${state.players[victim].name} draws ${count} and is skipped.`);
      emit(state, { type: 'skip', player: victim });
      advance(state, 2);
    }
  } else if (card.value === '7' && rules.sevens) {
    state.swapPending = index;
    state.turnId = (state.turnId ?? 0) + 1;
    note(state, `${player.name} gets to swap hands with someone.`);
  } else if (card.value === '0' && rules.zeros) {
    rotateHands(state);
    advance(state);
  } else {
    advance(state);
  }
  return true;
}

function rotateHands(state) {
  const hands = state.players.map((p) => p.hand);
  state.players.forEach((p, i) => {
    p.hand = hands[nextIndex(state, -1, i)];
    p.calledUno = false;
  });
  note(state, `Everyone passes their hand ${state.direction === 1 ? 'to the left' : 'to the right'}.`);
  emit(state, { type: 'rotate', direction: state.direction });
}

export function swapWith(state, index, target) {
  if (state.swapPending !== index || target === index || !state.players[target]) return false;
  const me = state.players[index];
  const them = state.players[target];
  [me.hand, them.hand] = [them.hand, me.hand];
  me.calledUno = false;
  them.calledUno = false;
  state.swapPending = null;
  note(state, `${me.name} swapped hands with ${them.name}.`);
  emit(state, { type: 'swap', a: index, b: target });
  advance(state);
  return true;
}

export function draw(state, index) {
  if (state.winner !== null || state.turn !== index || state.drawnCardId !== null || state.swapPending !== null) return false;
  const player = state.players[index];
  player.calledUno = false;

  if (state.pendingDraw) {
    const count = state.pendingDraw;
    drawCards(state, index, count);
    state.pendingDraw = 0;
    state.pendingType = null;
    state.challengeable = null;
    note(state, `${player.name} drew ${count}.`);
    advance(state);
    return true;
  }

  let card = drawCards(state, index, 1)[0];
  let count = 1;
  while (state.rules.drawUntilPlayable && card && !canPlay(state, card) && count < DRAW_UNTIL_LIMIT) {
    card = drawCards(state, index, 1)[0];
    count++;
  }
  const drew = count === 1 ? 'a card' : `${count} cards`;
  if (card && canPlay(state, card)) {
    state.drawnCardId = card.id;
    note(state, `${player.name} drew ${drew}.`);
  } else {
    note(state, `${player.name} drew ${drew} and passed.`);
    advance(state);
  }
  return true;
}

export function pass(state, index) {
  if (state.turn !== index || state.drawnCardId === null) return false;
  note(state, `${state.players[index].name} passed.`);
  advance(state);
  return true;
}

// The player facing a Wild Draw Four says it was played illegally. Right:
// the one who played it draws the cards and the challenger plays on. Wrong:
// the challenger draws them plus two more, and loses their turn.
export function challenge(state, index) {
  const pending = state.challengeable;
  if (!pending || state.turn !== index || state.winner !== null) return false;
  const challenger = state.players[index];
  const offender = state.players[pending.offender];
  const count = state.pendingDraw;
  state.challengeable = null;
  state.pendingDraw = 0;
  state.pendingType = null;
  if (pending.hadMatch) {
    drawCards(state, pending.offender, count);
    offender.calledUno = false;
    note(state, `${challenger.name} challenged and was right! ${offender.name} draws ${count}.`);
    emit(state, { type: 'challenge', player: index, offender: pending.offender, success: true, count });
  } else {
    drawCards(state, index, count + CHALLENGE_EXTRA);
    note(state, `${challenger.name} challenged and was wrong, and draws ${count + CHALLENGE_EXTRA}.`);
    emit(state, { type: 'challenge', player: index, offender: pending.offender, success: false, count: count + CHALLENGE_EXTRA });
    advance(state);
  }
  return true;
}

// Out of time: the game moves for you, as gently as it can. Picks someone
// at random to swap with, takes a pending draw, passes a drawn card, or draws.
export function timeOut(state) {
  if (state.winner !== null) return false;
  const index = state.swapPending ?? state.turn;
  const player = state.players[index];
  note(state, `${player.name} ran out of time.`);
  emit(state, { type: 'timeout', player: index });
  if (state.swapPending !== null) {
    const others = state.players.map((_, i) => i).filter((i) => i !== index);
    return swapWith(state, index, others[Math.floor(Math.random() * others.length)]);
  }
  if (state.drawnCardId !== null) return pass(state, index);
  const drew = draw(state, index);
  // Drawing a card you could play would leave the turn waiting on you again; time's up means it moves on.
  if (drew && state.drawnCardId !== null && state.turn === index) pass(state, index);
  return drew;
}

// Call it with two cards in hand, before playing the second-to-last one.
export function callUno(state, index) {
  const player = state.players[index];
  if (state.winner !== null || player.hand.length !== 2 || player.calledUno) return false;
  player.calledUno = true;
  note(state, `${player.name}: Woono!`);
  emit(state, { type: 'uno', player: index });
  return true;
}

// A player who left mid-game: the computer takes over their seat.
export function handToBot(state, id) {
  const player = state.players.find((p) => p.id === id);
  if (!player || player.kind === 'bot') return false;
  player.kind = 'bot';
  note(state, `${player.name} left. The computer takes over their hand.`);
  return true;
}

// What one seat is allowed to see.
export function viewFor(state, index) {
  const me = state.players[index];
  return {
    gameId: state.gameId,
    you: index,
    rules: state.rules,
    players: state.players.map((p) => ({ id: p.id, name: p.name, kind: p.kind, avatar: p.avatar, count: p.hand.length, calledUno: p.calledUno })),
    hand: me.hand,
    playable: playableIds(state, index),
    top: topCard(state),
    color: state.color,
    turn: state.turn,
    direction: state.direction,
    drawnCardId: state.turn === index ? state.drawnCardId : null,
    pendingDraw: state.pendingDraw,
    choosingSwap: state.swapPending === index,
    swapPending: state.swapPending,
    canChallenge: Boolean(state.challengeable) && state.turn === index && state.winner === null,
    turnId: state.turnId ?? 0,
    canCallUno: me.hand.length === 2 && !me.calledUno && state.winner === null,
    drawPileCount: state.drawPile.length,
    winner: state.winner,
    log: state.log,
    events: state.events,
  };
}

// ─── Computer player ───────────────────────────────────────────────────

function pickColor(player, except) {
  const counts = Object.fromEntries(COLORS.map((c) => [c, 0]));
  for (const c of player.hand) if (c.color && c.id !== except) counts[c.color]++;
  return COLORS.reduce((best, c) => (counts[c] > counts[best] ? c : best), COLORS[Math.floor(Math.random() * 4)]);
}

export function botTurn(state, index) {
  const player = state.players[index];

  if (state.swapPending === index) {
    // Swap with whoever is closest to winning.
    const target = state.players.map((p, i) => ({ i, n: p.hand.length })).filter((p) => p.i !== index).sort((a, b) => a.n - b.n)[0];
    return swapWith(state, index, target.i);
  }

  // Facing a challengeable +4: challenge sometimes, more often when the player had lots of cards to choose from.
  if (state.challengeable && state.turn === index) {
    const offender = state.players[state.challengeable.offender];
    if (Math.random() < Math.min(0.6, 0.15 + offender.hand.length * 0.04)) return challenge(state, index);
  }

  const playable = playableIds(state, index).map((id) => player.hand.find((c) => c.id === id));
  if (!playable.length) return state.drawnCardId !== null ? pass(state, index) : draw(state, index);

  if (player.hand.length === 2) callUno(state, index);

  const rules = state.rules;
  const nextPlayer = state.players[nextIndex(state)];
  const threatened = nextPlayer.hand.length <= 2;
  const fewestOther = Math.min(...state.players.filter((_, i) => i !== index).map((p) => p.hand.length));
  const rank = (card) => {
    let score = 0;
    if (card.color === state.color) score += 10;
    if (/^\d$/.test(card.value)) score += Number(card.value) / 10; // shed high numbers first
    if (['skip', 'reverse', 'draw2'].includes(card.value)) score += threatened ? 30 : 5;
    if (card.value === 'wild4') score += threatened || state.pendingDraw ? 40 : -30; // hold the strongest card unless it's needed
    if (card.value === 'draw2' && state.pendingDraw) score += 50; // stack the cheaper card first
    if (card.value === 'wild') score += -20;
    if (card.value === '7' && rules.sevens && fewestOther < player.hand.length - 1) score += 25;
    return score;
  };
  const card = playable.sort((a, b) => rank(b) - rank(a))[0];
  return play(state, index, card.id, card.color ? null : pickColor(player, card.id));
}

// A computer player holding an exact copy of the top card, who might jump in.
export function botJumpIn(state) {
  if (!state.rules.jumpIn || state.winner !== null || state.swapPending !== null) return null;
  const candidates = state.players.map((p, i) => ({ p, i })).filter(({ p, i }) => p.kind === 'bot' && i !== state.turn && playableIds(state, i).length);
  if (!candidates.length) return null;
  const { i } = candidates[Math.floor(Math.random() * candidates.length)];
  return { index: i, cardId: playableIds(state, i)[0] };
}
