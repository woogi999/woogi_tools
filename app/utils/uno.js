// Woono (our Uno-style card game) rules, kept free of any rendering. The host runs this (games against the
// computer are just a lobby no one else joined) and sends each player only
// what they're allowed to see: their own hand and everyone else's card counts.
//
// Draw cards and (with Block & reflect on) Skips don't land straight away:
// they become a *pending attack* aimed at one player, who answers it on their
// turn. They can stack a draw card on it, block it with a Skip, reflect it
// back with a Reverse, challenge a wild draw card, or take it.

export const COLORS = ['red', 'yellow', 'green', 'blue'];
export const MAX_PLAYERS = 8;
const HISTORY = 6;
const EVENT_HISTORY = 24;
export const DRAW_UNTIL_LIMIT = 40;

// Action cards that can be switched off in the lobby. Numbers are always in.
export const CARD_TYPES = [
  { id: 'skip', label: 'Skip', hint: 'The next player misses a turn.' },
  { id: 'reverse', label: 'Reverse', hint: 'Play turns the other way.' },
  { id: 'draw2', label: 'Draw Two', hint: 'The next player draws 2.' },
  { id: 'wild', label: 'Wild', hint: 'Pick the colour.' },
  { id: 'wild4', label: 'Wild Draw Four', hint: 'Pick the colour, and the next player draws 4.' },
  { id: 'target2', label: 'Targeted Draw Two', hint: 'You choose who draws 2.' },
  { id: 'target4', label: 'Targeted Wild Draw Four', hint: 'Pick the colour, and choose who draws 4.' },
  { id: 'draw99', label: 'Wild Draw 99', hint: 'One per deck. Good luck.' },
];
export const DEFAULT_CARDS = { skip: true, reverse: true, draw2: true, wild: true, wild4: true, target2: true, target4: true, draw99: false };

// House rules, all set in the lobby.
export const DEFAULT_RULES = {
  handSize: 7,
  // 'off' | 'same' (only the same amount) | 'up' (the same amount or more) | 'mixed' (any draw card)
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
  // Challenge a wild draw card: if the player had a card of the colour in play, they draw instead.
  challenge: false,
  // Answer a draw card or a Skip aimed at you with a Skip (cancel it) or a Reverse (send it back).
  defense: false,
  // Draws lean towards whoever's behind, without ever adding cards that aren't in the deck.
  drawBalancing: false,
  cards: DEFAULT_CARDS,
};

export const STACKING_MODES = ['off', 'same', 'up', 'mixed'];
export const TURN_TIMES = [0, 10, 15, 30, 60];
// A failed challenge costs the challenger this many cards on top of the draw.
export const CHALLENGE_EXTRA = 2;

const LABELS = { skip: 'Skip', reverse: 'Reverse', draw2: 'Draw Two', wild: 'Wild', wild4: 'Wild Draw Four', target2: 'Targeted Draw Two', target4: 'Targeted Wild Draw Four', draw99: 'Wild Draw 99' };
const capitalise = (s) => s[0].toUpperCase() + s.slice(1);
const DRAW_AMOUNT = { draw2: 2, wild4: 4, target2: 2, target4: 4, draw99: 99 };

export const drawAmount = (card) => DRAW_AMOUNT[card?.value] ?? 0;
export const isTargeted = (card) => card?.value === 'target2' || card?.value === 'target4';
const isWildDraw = (card) => !card.color && drawAmount(card) > 0;

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
    stacking: STACKING_MODES.includes(r.stacking) ? r.stacking : 'off',
    sevens: Boolean(r.sevens),
    zeros: Boolean(r.zeros),
    jumpIn: Boolean(r.jumpIn),
    drawUntilPlayable: Boolean(r.drawUntilPlayable),
    unoPenalty: clampInt(r.unoPenalty, PENALTY_RANGE, DEFAULT_RULES.unoPenalty),
    turnTime: TURN_TIMES.includes(Number(r.turnTime)) ? Number(r.turnTime) : 0,
    challenge: Boolean(r.challenge),
    defense: Boolean(r.defense),
    drawBalancing: Boolean(r.drawBalancing),
    cards: Object.fromEntries(CARD_TYPES.map(({ id }) => [id, typeof r.cards?.[id] === 'boolean' ? r.cards[id] : DEFAULT_CARDS[id]])),
  };
}

// The standard deck: per colour one 0, two of each 1–9, two each of Skip,
// Reverse and Draw Two, and one Targeted Draw Two; plus four Wilds, four Wild
// Draw Fours, two Targeted Wild Draw Fours and a single Wild Draw 99. Cards
// switched off are left out. Big tables and big hands shuffle in more decks.
export function buildDeck(copies = 1, cards = DEFAULT_CARDS) {
  const out = [];
  let id = 0;
  const add = (color, value, count = 1) => {
    if (value in DEFAULT_CARDS && !cards[value]) return;
    for (let i = 0; i < count; i++) out.push({ id: id++, color, value });
  };
  for (let copy = 0; copy < copies; copy++) {
    for (const color of COLORS) {
      add(color, '0');
      for (const value of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2']) add(color, value, 2);
      add(color, 'target2');
    }
    add(null, 'wild', 4);
    add(null, 'wild4', 4);
    add(null, 'target4', 2);
    add(null, 'draw99');
  }
  return out;
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
  const perDeck = buildDeck(1, r.cards).length;
  const state = {
    // Tells screens a new game from a rematch of the same players.
    gameId: Math.random().toString(36).slice(2, 10),
    rules: r,
    // uno: 'none' | 'armed' (pressed with two cards, said on the next play) | 'said'.
    // exposed: down to one card without saying it, so anyone can call them out.
    players: players.map((p) => ({ ...p, hand: [], uno: 'none', exposed: false })),
    // Enough decks that the deal leaves at least ~40 cards to draw from.
    drawPile: shuffle(buildDeck(Math.max(1, Math.ceil((players.length * r.handSize + 40) / perDeck)), r.cards)),
    discard: [],
    color: null,
    turn: Math.floor(Math.random() * players.length),
    direction: 1,
    // A card just drawn, face up in front of the player whose turn it is, waiting for "play it" or "keep it".
    drawn: null,
    // Cards drawn so far this turn.
    drewThisTurn: 0,
    // { kind: 'draw' | 'skip', amount, value, from, target, resume, offender, hadMatch, prevColor }
    pending: null,
    // { player, card, color, target, ... }: a wild or targeted card on the pile, waiting for its colour or target.
    choice: null,
    swapPending: null, // a player who played a 7 and still has to pick who to swap with
    winner: null,
    turnId: 0,
    version: 0,
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
  emit(state, { type: 'deal', players: state.players.length, handSize: r.handSize });
  return state;
}

// Simulated games (the computer thinking ahead) skip the log and the animations.
function note(state, text) {
  if (state.sim) return;
  state.log = [...state.log.slice(-(HISTORY - 1)), { id: ++state.seq, text }];
}

// Things that happened, for the table to animate. Public information only.
function emit(state, event) {
  if (state.sim) return;
  state.events = [...state.events.slice(-(EVENT_HISTORY - 1)), { id: ++state.seq, ...event }];
}

export const topCard = (state) => state.discard[state.discard.length - 1];
const name = (state, i) => state.players[i].name;

// Whether a card can go on the pile in an ordinary turn.
export function canPlay(state, card) {
  const top = topCard(state);
  return !card.color || card.color === state.color || card.value === top.value;
}

// Whether a card answers the attack aimed at its holder.
export function canAnswer(state, card) {
  const pending = state.pending;
  const rules = state.rules;
  if (!pending) return false;
  // Anything that isn't the same card as the attack still has to follow the colour.
  const followsColour = !card.color || card.color === state.color || card.value === topCard(state).value;
  if (rules.defense && (card.value === 'skip' || card.value === 'reverse')) return followsColour;
  const amount = drawAmount(card);
  if (pending.kind !== 'draw' || !amount) return false;
  // A coloured draw card worth something different still has to follow the colour.
  if (card.color && amount !== pending.value && card.color !== state.color) return false;
  switch (rules.stacking) {
    case 'same':
      return amount === pending.value;
    case 'up':
      return amount >= pending.value;
    case 'mixed':
      return true;
    default:
      return false;
  }
}

// An exact copy of the top card, which Jump-In lets anyone play at any time.
function isJumpIn(state, card) {
  const top = topCard(state);
  return state.rules.jumpIn && Boolean(top.color) && card.color === top.color && card.value === top.value;
}

const handPlayable = (state, index) => state.players[index].hand.some((c) => canPlay(state, c));

export function playableIds(state, index) {
  if (state.winner !== null || state.swapPending !== null || state.choice) return [];
  const hand = state.players[index].hand;
  if (state.pending) return state.pending.target === index ? hand.filter((c) => canAnswer(state, c)).map((c) => c.id) : [];
  if (state.turn !== index) return state.drawn ? [] : hand.filter((c) => isJumpIn(state, c)).map((c) => c.id);
  if (state.drawn) return canPlay(state, state.drawn) ? [state.drawn.id] : [];
  return hand.filter((c) => canPlay(state, c)).map((c) => c.id);
}

// Draw from the deck: to take a pending draw, for your turn's first card, or (drawing until you can play) another.
export function canDrawNow(state, index) {
  if (state.winner !== null || state.swapPending !== null || state.choice || state.turn !== index || state.drawn) return false;
  if (state.pending) return state.pending.target === index;
  if (!state.drewThisTurn) return true;
  // Drawing until you can play, you can keep drawing even after keeping a playable card, until one goes down.
  return state.rules.drawUntilPlayable && state.drewThisTurn < DRAW_UNTIL_LIMIT && state.drawPile.length + state.discard.length > 1;
}

// After drawing, you can pass. Drawing until you can play, you can't: a card has to go down
// (unless the deck has run dry with nothing to play).
export function canPassNow(state, index) {
  if (state.winner !== null || state.choice || state.turn !== index || state.pending || state.drawn || !state.drewThisTurn || canDrawNow(state, index)) return false;
  return !state.rules.drawUntilPlayable || !handPlayable(state, index);
}

export function canChallengeNow(state, index) {
  const pending = state.pending;
  return state.winner === null && !state.choice && Boolean(pending) && pending.kind === 'draw' && pending.offender !== null && pending.target === index;
}

// Woono can be pressed ahead with two cards left, only when one of them can go down right now.
export function canArmUno(state, index) {
  const player = state.players[index];
  if (state.winner !== null || !player || player.hand.length !== 2 || player.uno !== 'none') return false;
  return playableIds(state, index).some((id) => player.hand.some((c) => c.id === id));
}

export const nextIndex = (state, steps = 1, from = state.turn) => {
  const n = state.players.length;
  return (((from + state.direction * steps) % n) + n) % n;
};

function setTurn(state, index) {
  state.turn = index;
  state.drawn = null;
  state.drewThisTurn = 0;
  state.turnId++;
}

const advance = (state, steps = 1) => setTurn(state, nextIndex(state, steps));

const resetUno = (player) => {
  player.uno = 'none';
  player.exposed = false;
};

// `who` ({ index, reason, streak }), with Draw Balancing on, lets the draw lean towards what that player needs.
function takeFromPile(state, who = null) {
  if (!state.drawPile.length) {
    // Reshuffle everything under the top card back into the draw pile.
    const top = state.discard.pop();
    state.drawPile = shuffle(state.discard);
    state.discard = [top];
    // The table gathers the pile back into the deck before any card is drawn from it.
    if (state.drawPile.length) emit(state, { type: 'reshuffle', count: state.drawPile.length });
  }
  const pile = state.drawPile;
  if (!state.rules.drawBalancing || !who || pile.length < 2) return pile.pop();
  const at = balancedPick(state, who);
  // The pile is shuffled, so order doesn't matter: swap the pick to the end and take it.
  [pile[at], pile[pile.length - 1]] = [pile[pile.length - 1], pile[at]];
  return pile.pop();
}

// ─── Draw Balancing ─────────────────────────────────────────────────────
//
// Draws are rigged a little to keep games close, but only ever between the
// cards really left in the deck: every card still in the pile can come up,
// some are just more likely than others.
//
//   Behind on cards?  Power cards (Skips, Reverses, draw cards, Wilds) come up more.
//   Ahead?            Mostly plain numbers.
//   Drawing again and again (Draw until you can play, or a long turn of draws):
//                     each extra draw makes a card matching the top card's colour or number likelier.
//   Taking a big hit: a card to fight back with (to stack, block or reflect) is a bit likelier.
//   Missing a colour: cards of colours you don't hold come up a bit more, so you're less stuck.
//
// The Wild Draw 99 is never boosted. Each card's weight stays within
// WEIGHT_RANGE, so the deck is nudged, never stacked.

const WEIGHT_RANGE = [0.3, 4];
const isPower = (card) => !/^\d$/.test(card.value);

function balancedPick(state, { index, reason, streak = 0 }) {
  const players = state.players;
  const hand = players[index].hand;
  const average = players.reduce((sum, p) => sum + p.hand.length, 0) / players.length;
  // Positive when behind (more cards than the table's average), negative when ahead.
  const behind = hand.length - average;
  const powerBoost = Math.max(0.35, Math.min(2.6, 1 + behind * 0.12));
  const numberBoost = Math.max(0.6, Math.min(1.5, 1 - behind * 0.04));
  const top = topCard(state);
  const heldColors = new Set(hand.map((c) => c.color).filter(Boolean));
  const penalty = reason === 'hit' || reason === 'challenge' || reason === 'callout';
  const rules = state.rules;

  const weights = state.drawPile.map((card) => {
    let w = 1;
    if (card.value === 'draw99') return behind > 0 ? 1 : 0.5;
    w *= isPower(card) ? powerBoost : numberBoost;
    // Drawing until something fits: every extra draw leans towards the top card's colour or number.
    if (streak > 0 && top && (card.color === state.color || card.value === top.value)) w *= 1 + streak * 0.35;
    // A big hit: something to fight back with next time.
    if (penalty && ((rules.defense && (card.value === 'skip' || card.value === 'reverse')) || (rules.stacking !== 'off' && drawAmount(card) > 0 && drawAmount(card) < 99))) w *= 1.35;
    if (card.color && !heldColors.has(card.color) && hand.length <= 12) w *= 1.25;
    return Math.max(WEIGHT_RANGE[0], Math.min(WEIGHT_RANGE[1], w));
  });

  let roll = Math.random() * weights.reduce((sum, w) => sum + w, 0);
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return i;
  }
  return weights.length - 1;
}

// The moment the last card is drawn, the pile (all but its top card) is shuffled back in,
// so the deck never sits empty. Called after the draw is announced, so the table shows
// the draw first and the reshuffle after it.
function refillIfEmpty(state) {
  if (state.drawPile.length || state.discard.length < 2) return;
  const top = state.discard.pop();
  state.drawPile = shuffle(state.discard);
  state.discard = [top];
  emit(state, { type: 'reshuffle', count: state.drawPile.length });
}

function drawCards(state, index, count, reason) {
  const player = state.players[index];
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    const card = takeFromPile(state, { index, reason });
    if (!card) break;
    player.hand.push(card);
    drawn++;
  }
  if (drawn) {
    resetUno(player);
    emit(state, { type: 'draw', player: index, count: drawn, reason });
  }
  refillIfEmpty(state);
  return drawn;
}

// Debug mode (utils/uno-debug.js): deal cards from the deck to a player, animated like any other draw.
export function debugDraw(state, index, count) {
  return drawCards(state, index, count, 'debug');
}

export { buildDeck as debugBuildDeck, shuffle as debugShuffle, emit as debugEmit, note as debugNote, setTurn as debugSetTurn };

// Each action returns true if it was allowed.

const validTarget = (state, target) => target !== null && target !== undefined && target !== '' && Boolean(state.players[Number(target)]);

// Plays a card. A wild card's colour and a targeted card's target can come
// with it (the computer players do that) or be picked afterwards, once the
// card is down (see `choose`): its effect waits until they're picked.
export function play(state, index, cardId, chosenColor, chosenTarget) {
  if (!playableIds(state, index).includes(cardId)) return false;
  const player = state.players[index];
  const fromCentre = state.drawn?.id === cardId;
  const card = fromCentre ? state.drawn : player.hand.find((c) => c.id === cardId);
  const answering = state.pending;
  // Whether a wild draw card was played while holding the colour in play (which a challenge catches).
  const prevColor = state.color;
  const hadMatch = isWildDraw(card) && player.hand.some((c) => c.id !== card.id && c.color === prevColor);

  if (!answering && state.turn !== index) {
    note(state, `${player.name} jumped in!`);
    setTurn(state, index);
  }

  if (fromCentre) state.drawn = null;
  else player.hand = player.hand.filter((c) => c.id !== cardId);
  state.discard.push(card);
  if (card.color) state.color = card.color;
  note(state, `${player.name} played ${cardName(card)}.`);
  emit(state, { type: 'play', player: index, card, color: card.color, fromCentre });

  if (!player.hand.length) {
    state.winner = index;
    state.pending = null;
    resetUno(player);
    note(state, `${player.name} won!`);
    emit(state, { type: 'win', player: index });
    return true;
  }

  // Down to one card: say Woono if it was pressed in time, otherwise anyone can call them out until they say it.
  if (player.hand.length === 1) {
    if (player.uno === 'armed') {
      player.uno = 'said';
      note(state, `${player.name}: Woono!`);
      emit(state, { type: 'uno', player: index });
    } else if (player.uno !== 'said') {
      player.exposed = true;
    }
  } else if (player.hand.length > 2) {
    resetUno(player);
  }

  const context = { answering, hadMatch, prevColor };
  const color = COLORS.includes(chosenColor) ? chosenColor : null;
  const target = validTarget(state, chosenTarget) ? Number(chosenTarget) : null;
  if ((!card.color && !color) || (isTargeted(card) && target === null)) {
    state.choice = { player: index, card, color: card.color ? null : color, target, ...context };
    return true;
  }
  resolvePlay(state, index, card, color, target, context);
  return true;
}

// Picks the colour of the wild card just played, or who a targeted card is aimed at (anyone, yourself included).
export function choose(state, index, { color, target } = {}) {
  const choice = state.choice;
  if (!choice || choice.player !== index || state.winner !== null) return false;
  let changed = false;
  let pickedColor = false;
  if (!choice.card.color && !choice.color && COLORS.includes(color)) {
    choice.color = color;
    changed = pickedColor = true;
  }
  const colorDone = choice.card.color || choice.color;
  if (colorDone && isTargeted(choice.card) && choice.target === null && validTarget(state, target)) {
    choice.target = Number(target);
    changed = true;
  }
  if (!changed) return false;
  if (!colorDone) return true;
  if (pickedColor && isTargeted(choice.card) && choice.target === null) {
    // Colour picked; the target is next.
    state.color = choice.color;
    return true;
  }
  state.choice = null;
  resolvePlay(state, index, choice.card, choice.color, choice.target, choice);
  return true;
}

// What a card does once it's down (and its colour and target are known).
function resolvePlay(state, index, card, chosenColor, target, { answering, hadMatch, prevColor }) {
  const player = state.players[index];
  if (!card.color) {
    state.color = chosenColor;
    note(state, `${player.name} chose ${chosenColor}.`);
    emit(state, { type: 'color', player: index, color: chosenColor });
  }
  if (isTargeted(card)) note(state, `${player.name} aimed it at ${target === index ? 'themselves' : name(state, target)}.`);
  const rules = state.rules;
  if (answering) {
    if (rules.defense && card.value === 'skip') {
      state.pending = null;
      note(state, `${player.name} blocked it.`);
      emit(state, { type: 'block', player: index, from: answering.from });
      setTurn(state, answering.resume !== index ? answering.resume : nextIndex(state, 1, index));
      return true;
    }
    if (rules.defense && card.value === 'reverse') {
      state.direction *= -1;
      state.pending = { ...answering, from: index, target: answering.from, resume: nextIndex(state, 1, index), offender: null, hadMatch: false };
      note(state, `${player.name} sent it back to ${name(state, answering.from)}!`);
      emit(state, { type: 'reflect', player: index, target: answering.from, kind: answering.kind, amount: answering.amount });
      setTurn(state, answering.from);
      autoResolve(state);
      return true;
    }
    attack(state, index, card, target, { hadMatch, prevColor });
    return true;
  }

  const twoPlayers = state.players.length === 2;
  if (card.value === 'skip') {
    const victim = nextIndex(state, 1, index);
    if (rules.defense) {
      state.pending = { kind: 'skip', amount: 0, value: 0, from: index, target: victim, resume: nextIndex(state, 1, victim), offender: null, hadMatch: false };
      setTurn(state, victim);
      autoResolve(state);
    } else {
      note(state, `${name(state, victim)} is skipped.`);
      emit(state, { type: 'skip', player: victim, from: index });
      advance(state, 2);
    }
  } else if (card.value === 'reverse') {
    emit(state, { type: 'reverse', player: index });
    if (twoPlayers) advance(state, 2); // with two players, Reverse works like Skip
    else {
      state.direction *= -1;
      advance(state);
    }
  } else if (drawAmount(card)) {
    attack(state, index, card, target, { hadMatch, prevColor });
  } else if (card.value === '7' && rules.sevens) {
    state.swapPending = index;
    state.turnId++;
    note(state, `${player.name} gets to swap hands with someone.`);
  } else if (card.value === '0' && rules.zeros) {
    rotateHands(state);
    advance(state);
  } else {
    advance(state);
  }
  return true;
}

// A draw card: aimed at the next player (or the chosen one), added to anything already stacked.
function attack(state, index, card, chosenTarget, { hadMatch, prevColor }) {
  const rules = state.rules;
  const amount = drawAmount(card);
  const total = (state.pending?.amount ?? 0) + amount;
  const victim = isTargeted(card) ? chosenTarget : nextIndex(state, 1, index);
  const challengeable = rules.challenge && isWildDraw(card);
  const pending = { kind: 'draw', amount: total, value: amount, from: index, target: victim, resume: nextIndex(state, 1, index), offender: challengeable ? index : null, hadMatch, prevColor };
  emit(state, { type: 'attack', player: index, target: victim, amount: total });
  state.pending = pending;
  if (rules.stacking === 'off' && !rules.defense && !challengeable) {
    takePending(state);
    return;
  }
  setTurn(state, victim);
  autoResolve(state);
}

// The attack lands: the target draws (or misses their turn), and play moves on.
function takePending(state) {
  const pending = state.pending;
  state.pending = null;
  const victim = pending.target;
  if (pending.kind === 'draw') {
    const drew = drawCards(state, victim, pending.amount, 'hit');
    note(state, `${name(state, victim)} draws ${drew}${pending.resume === victim ? ' and is skipped' : ''}.`);
  } else {
    note(state, `${name(state, victim)} is skipped.`);
    emit(state, { type: 'skip', player: victim, from: pending.from });
  }
  setTurn(state, pending.resume !== victim ? pending.resume : nextIndex(state, 1, victim));
}

// An attack its target can't answer (no card to stack, block or reflect with, nothing to challenge) lands straight away.
function autoResolve(state) {
  while (state.pending && state.winner === null) {
    const target = state.pending.target;
    if (state.pending.offender !== null || playableIds(state, target).length) return;
    takePending(state);
  }
}

function rotateHands(state) {
  const hands = state.players.map((p) => p.hand);
  state.players.forEach((p, i) => {
    p.hand = hands[nextIndex(state, -1, i)];
    resetUno(p);
  });
  note(state, `Everyone passes their hand ${state.direction === 1 ? 'to the left' : 'to the right'}.`);
  emit(state, { type: 'rotate', direction: state.direction });
}

export function swapWith(state, index, target) {
  if (state.swapPending !== index || target === index || !state.players[target]) return false;
  const me = state.players[index];
  const them = state.players[target];
  [me.hand, them.hand] = [them.hand, me.hand];
  resetUno(me);
  resetUno(them);
  state.swapPending = null;
  note(state, `${me.name} swapped hands with ${them.name}.`);
  emit(state, { type: 'swap', a: index, b: target });
  advance(state);
  return true;
}

// Takes a pending attack, or draws one card into the middle for the player to play or keep.
export function draw(state, index) {
  if (!canDrawNow(state, index)) return false;
  const player = state.players[index];
  if (state.pending) {
    takePending(state);
    return true;
  }
  const card = takeFromPile(state, { index, reason: 'centre', streak: state.drewThisTurn });
  if (!card) {
    note(state, `${player.name} can't draw: the deck is empty.`);
    advance(state);
    return true;
  }
  state.drawn = card;
  state.drewThisTurn++;
  emit(state, { type: 'draw', player: index, count: 1, reason: 'centre' });
  note(state, `${player.name} drew a card.`);
  refillIfEmpty(state);
  // A card that can't be played has nothing to decide: it goes into the hand.
  if (!canPlay(state, card)) keep(state, index);
  return true;
}

// The drawn card goes into the hand. The turn carries on if there's still something to play (or to draw).
export function keep(state, index) {
  if (state.turn !== index || !state.drawn) return false;
  const player = state.players[index];
  player.hand.push(state.drawn);
  state.drawn = null;
  resetUno(player);
  emit(state, { type: 'keep', player: index });
  if (!handPlayable(state, index) && !canDrawNow(state, index)) {
    note(state, `${player.name} passed.`);
    advance(state);
  }
  return true;
}

export function pass(state, index) {
  if (!canPassNow(state, index)) return false;
  note(state, `${state.players[index].name} passed.`);
  advance(state);
  return true;
}

// The player facing a wild draw card says it was played illegally. Right:
// the one who played it draws the cards and the challenger plays on. Wrong:
// the challenger draws them plus two more, and loses their turn.
export function challenge(state, index) {
  if (!canChallengeNow(state, index)) return false;
  const pending = state.pending;
  const challenger = state.players[index];
  const offender = state.players[pending.offender];
  state.pending = null;
  if (pending.hadMatch) {
    drawCards(state, pending.offender, pending.amount, 'challenge');
    note(state, `${challenger.name} challenged and was right! ${offender.name} draws ${pending.amount}.`);
    emit(state, { type: 'challenge', player: index, offender: pending.offender, success: true, count: pending.amount });
    setTurn(state, index);
  } else {
    const count = pending.amount + CHALLENGE_EXTRA;
    drawCards(state, index, count, 'challenge');
    note(state, `${challenger.name} challenged and was wrong, and draws ${count}.`);
    emit(state, { type: 'challenge', player: index, offender: pending.offender, success: false, count });
    setTurn(state, pending.resume !== index ? pending.resume : nextIndex(state, 1, index));
  }
  return true;
}

// Whoever has to act right now.
export const actorIndex = (state) => state.choice?.player ?? state.swapPending ?? state.pending?.target ?? state.turn;

// Out of time: the game moves for you, as gently as it can. Picks someone
// at random to swap with, takes an attack, keeps a drawn card, or draws and passes.
export function timeOut(state) {
  if (state.winner !== null) return false;
  const index = actorIndex(state);
  const player = state.players[index];
  note(state, `${player.name} ran out of time.`);
  emit(state, { type: 'timeout', player: index });
  if (state.choice) {
    // A colour at random, and a target at random (never yourself).
    const others = state.players.map((_, i) => i).filter((i) => i !== index);
    choose(state, index, { color: COLORS[Math.floor(Math.random() * COLORS.length)] });
    if (state.choice) choose(state, index, { target: others[Math.floor(Math.random() * others.length)] });
    return true;
  }
  if (state.swapPending !== null) {
    const others = state.players.map((_, i) => i).filter((i) => i !== index);
    return swapWith(state, index, others[Math.floor(Math.random() * others.length)]);
  }
  if (state.pending) {
    takePending(state);
    return true;
  }
  if (!state.drewThisTurn) draw(state, index);
  if (state.turn === index && state.drawn) keep(state, index);
  // Time's up means the turn moves on, whatever is left to play.
  if (state.turn === index && state.winner === null) advance(state);
  return true;
}

// Press it holding two cards and it's said the moment you play the next one.
// Forgot? Press it with one card left, before anyone calls you out.
export function callUno(state, index) {
  const player = state.players[index];
  if (state.winner !== null || !player) return false;
  if (canArmUno(state, index)) {
    player.uno = 'armed';
    return true;
  }
  if (player.hand.length === 1 && player.exposed) {
    player.exposed = false;
    player.uno = 'said';
    note(state, `${player.name}: Woono! (just in time)`);
    emit(state, { type: 'uno', player: index, late: true });
    return true;
  }
  return false;
}

// Someone's down to one card and hasn't said Woono: they draw the penalty.
export function callOut(state, index, target) {
  const caught = state.players[target];
  if (state.winner !== null || target === index || !caught?.exposed) return false;
  caught.exposed = false;
  note(state, `${name(state, index)} called out ${caught.name} for not saying Woono!`);
  emit(state, { type: 'callout', player: index, target });
  drawCards(state, target, state.rules.unoPenalty, 'callout');
  return true;
}

// Every move, by type, as sent over the network: { type, cardId, color, target }.
export function act(state, index, action) {
  if (!state || index < 0 || !state.players[index]) return false;
  let done = false;
  switch (action?.type) {
    case 'play':
      done = play(state, index, action.cardId, action.color, action.target);
      break;
    case 'choose':
      done = choose(state, index, { color: action.color, target: action.target });
      break;
    case 'draw':
      done = draw(state, index);
      break;
    case 'keep':
      done = keep(state, index);
      break;
    case 'pass':
      done = pass(state, index);
      break;
    case 'uno':
      done = callUno(state, index);
      break;
    case 'callout':
      done = callOut(state, index, Number(action.target));
      break;
    case 'swap':
      done = swapWith(state, index, Number(action.target));
      break;
    case 'challenge':
      done = challenge(state, index);
      break;
    default:
      break;
  }
  if (done) state.version++;
  return done;
}

// Every move a player could make right now (Woono and call-outs aside).
export function legalActions(state, index) {
  const out = [];
  if (state.winner !== null) return out;
  const others = state.players.map((_, i) => i).filter((i) => i !== index);
  if (state.choice) {
    if (state.choice.player !== index) return out;
    const { card, color } = state.choice;
    if (!card.color && !color) for (const c of COLORS) out.push({ type: 'choose', color: c });
    else state.players.forEach((_, target) => out.push({ type: 'choose', target }));
    return out;
  }
  if (state.swapPending !== null) {
    if (state.swapPending === index) for (const target of others) out.push({ type: 'swap', target });
    return out;
  }
  const hand = state.players[index].hand;
  for (const id of playableIds(state, index)) {
    const card = state.drawn?.id === id ? state.drawn : hand.find((c) => c.id === id);
    for (const color of card.color ? [null] : COLORS) {
      for (const target of isTargeted(card) ? state.players.map((_, i) => i) : [null]) out.push({ type: 'play', cardId: id, color, target });
    }
  }
  if (canDrawNow(state, index)) out.push({ type: 'draw' });
  if (state.drawn && state.turn === index) out.push({ type: 'keep' });
  if (canPassNow(state, index)) out.push({ type: 'pass' });
  if (canChallengeNow(state, index)) out.push({ type: 'challenge' });
  return out;
}

// A player who left mid-game: the computer takes over their seat.
export function handToBot(state, id) {
  const player = state.players.find((p) => p.id === id);
  if (!player || player.kind === 'bot') return false;
  player.kind = 'bot';
  note(state, `${player.name} left. The computer takes over their hand.`);
  return true;
}

// Roughly how long the table takes to animate these events, so no one acts while cards are still flying.
const EVENT_MS = { color: 700, play: 900, draw: 700, keep: 550, skip: 900, reverse: 900, swap: 1000, rotate: 900, challenge: 1500, uno: 700, callout: 1100, block: 1000, reflect: 1100, attack: 500, timeout: 600, deal: 600 };

// The opening deal: a quick riffle, then cards flicked out one at a time round the table.
// Shared by the table animation and the host, so no one can move before their cards arrive.
export function dealTiming(players, handSize) {
  const rounds = Math.min(handSize, 7);
  const shuffleMs = 900;
  const stepMs = Math.max(35, Math.min(110, 1700 / Math.max(1, rounds * players)));
  return { rounds, shuffleMs, stepMs, flyMs: 440, totalMs: shuffleMs + rounds * players * stepMs + 440 + 150 };
}

// How long gathering the pile back into the deck takes on the table.
export const RESHUFFLE_MS = 1600;

export function settleMs(events) {
  let longest = 0;
  let played = false;
  for (const event of events) {
    let ms = EVENT_MS[event.type] ?? 0;
    if (event.type === 'draw') ms = event.reason === 'centre' ? 750 : 550 + 90 * Math.min(event.count, 6);
    if (event.type === 'deal' && event.players) ms = dealTiming(event.players, event.handSize).totalMs;
    if (event.type === 'play') played = true;
    longest = Math.max(longest, ms);
  }
  // Cards drawn because of a card just played start flying once it lands.
  if (played && events.some((e) => e.type === 'draw' && e.reason !== 'centre')) longest += 450;
  // Everything after a reshuffle waits for the cards to be gathered back into the deck.
  if (events.some((e) => e.type === 'reshuffle')) longest += RESHUFFLE_MS;
  return longest;
}

// What one seat is allowed to see.
export function viewFor(state, index) {
  const me = state.players[index];
  const pending = state.pending;
  return {
    gameId: state.gameId,
    you: index,
    rules: state.rules,
    players: state.players.map((p) => ({ id: p.id, name: p.name, kind: p.kind, avatar: p.avatar, count: p.hand.length, said: p.uno === 'said', exposed: p.exposed })),
    hand: me.hand,
    playable: playableIds(state, index),
    top: topCard(state),
    color: state.color,
    turn: state.turn,
    direction: state.direction,
    // Your own drawn card, face up; everyone else only knows there is one.
    drawn: state.turn === index ? state.drawn : null,
    drawnPending: Boolean(state.drawn),
    drewThisTurn: state.turn === index ? state.drewThisTurn : 0,
    pending: pending ? { kind: pending.kind, amount: pending.amount, from: pending.from, target: pending.target } : null,
    pendingDraw: pending?.kind === 'draw' ? pending.amount : 0,
    choosingSwap: state.swapPending === index,
    swapPending: state.swapPending,
    canDraw: canDrawNow(state, index),
    canKeep: state.turn === index && Boolean(state.drawn),
    canPass: canPassNow(state, index),
    canChallenge: canChallengeNow(state, index),
    canTake: Boolean(pending) && pending.target === index && state.winner === null && !state.choice,
    // Someone just played a wild or targeted card and is picking its colour or target.
    choice: state.choice ? { player: state.choice.player, needs: !state.choice.card.color && !state.choice.color ? 'color' : 'target', amount: drawAmount(state.choice.card) } : null,
    turnId: state.turnId,
    unoArmed: me.uno === 'armed',
    canCallUno: state.winner === null && (canArmUno(state, index) || me.exposed),
    drawPileCount: state.drawPile.length,
    winner: state.winner,
    log: state.log,
    events: state.events,
  };
}

// A computer player holding an exact copy of the top card, who might jump in.
export function botJumpIn(state) {
  if (!state.rules.jumpIn || state.winner !== null || state.swapPending !== null || state.pending || state.drawn) return null;
  const candidates = state.players.map((p, i) => ({ p, i })).filter(({ p, i }) => p.kind === 'bot' && i !== state.turn && playableIds(state, i).length);
  if (!candidates.length) return null;
  const { i } = candidates[Math.floor(Math.random() * candidates.length)];
  return { index: i, cardId: playableIds(state, i)[0] };
}
