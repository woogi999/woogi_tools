import {
  COLORS,
  DEFAULT_RULES,
  STACKING_MODES,
  TURN_TIMES,
  cardName,
  topCard,
  normaliseRules,
  debugDraw,
  debugShuffle,
  debugEmit,
  debugNote,
  debugSetTurn,
} from './uno';
import { CommandError } from './debug-commands';

// Woono's debug commands (see utils/debug-commands.js). `page` is the Woono page on the host.

const VALUES = {
  skip: 'skip',
  s: 'skip',
  block: 'skip',
  reverse: 'reverse',
  rev: 'reverse',
  r: 'reverse',
  draw2: 'draw2',
  '+2': 'draw2',
  d2: 'draw2',
  wild: 'wild',
  w: 'wild',
  wild4: 'wild4',
  '+4': 'wild4',
  w4: 'wild4',
  target2: 'target2',
  t2: 'target2',
  target4: 'target4',
  t4: 'target4',
  draw99: 'draw99',
  '+99': 'draw99',
};
const COLOR_ALIASES = {
  r: 'red',
  red: 'red',
  y: 'yellow',
  yellow: 'yellow',
  g: 'green',
  green: 'green',
  b: 'blue',
  blue: 'blue',
};
const WILD = new Set(['wild', 'wild4', 'target4', 'draw99']);

const list = (cards) =>
  cards.length ? cards.map(cardName).join(', ') : '(none)';

// "red 5", "r5", "blue skip", "wild4", "+4". Returns { color, value }.
export function parseCard(words) {
  const text = words.join(' ').toLowerCase().trim();
  if (!text)
    throw new CommandError(
      'Say which card, like "red 5", "blue skip" or "wild4".',
    );
  const compact = text.match(/^([rygb])([0-9])$/);
  if (compact) return { color: COLOR_ALIASES[compact[1]], value: compact[2] };
  const parts = text.split(/\s+/);
  let color = null;
  let valueWord = parts.join('');
  if (parts.length > 1 && COLOR_ALIASES[parts[0]]) {
    color = COLOR_ALIASES[parts[0]];
    valueWord = parts.slice(1).join('');
  }
  const value = /^[0-9]$/.test(valueWord) ? valueWord : VALUES[valueWord];
  if (!value)
    throw new CommandError(
      `“${text}” isn’t a card. Try "red 5", "green reverse", "yellow +2" or "wild4".`,
    );
  if (WILD.has(value)) return { color: null, value };
  if (!color) throw new CommandError(`Which colour? Like "red ${valueWord}".`);
  return { color, value };
}

// Splits trailing "x3" / "*3" off a word list.
function takeCount(words, max = 50) {
  const last = words.at(-1);
  const match = last?.match(/^[x*](\d+)$/i);
  if (!match) return { words, count: 1 };
  return {
    words: words.slice(0, -1),
    count: Math.max(1, Math.min(max, Number(match[1]))),
  };
}

export function unoDebugTools(page) {
  const state = () => {
    if (!page.state)
      throw new CommandError('No game is running. Start one first.');
    return page.state;
  };
  const nameOf = (s, i) => s.players[i].name;
  // After a change: bump the version, let everyone see it, and save it for /undo.
  const changed = (ctx, label) => {
    const s = state();
    s.version++;
    s.turnId++;
    page.refresh({ debugLabel: label });
    ctx.announce(label);
  };
  // Takes a matching card out of the deck (or the discard pile) if one's there, otherwise prints a new one.
  const fetchCard = (s, { color, value }) => {
    const matches = (c) => c.value === value && (c.color ?? null) === color;
    let i = s.drawPile.findIndex(matches);
    if (i >= 0) return s.drawPile.splice(i, 1)[0];
    i = s.discard.slice(0, -1).findIndex(matches);
    if (i >= 0) return s.discard.splice(i, 1)[0];
    const ids = [
      ...s.drawPile,
      ...s.discard,
      ...s.players.flatMap((p) => p.hand),
      s.drawn,
    ]
      .filter(Boolean)
      .map((c) => c.id);
    return { id: Math.max(-1, ...ids) + 1, color, value };
  };
  const fixUno = (player) => {
    if (player.hand.length !== 1) {
      player.exposed = false;
      if (player.hand.length > 2) player.uno = 'none';
    }
  };

  const commands = {
    hand: {
      usage: '/hand <player>',
      help: 'Shows a player’s cards (only to you).',
      run: ([ref], ctx) => {
        const s = state();
        const i = ctx.player(ref);
        return `${nameOf(s, i)} (${s.players[i].hand.length}): ${list(s.players[i].hand)}`;
      },
    },
    hands: {
      usage: '/hands',
      help: 'Everyone’s cards (only to you).',
      run: () => {
        const s = state();
        return s.players
          .map(
            (p, i) => `${i + 1}. ${p.name} (${p.hand.length}): ${list(p.hand)}`,
          )
          .join('\n');
      },
    },
    deck: {
      usage: '/deck [count]',
      help: 'How many cards are left, and the next ones to be drawn, in order.',
      run: ([n]) => {
        const s = state();
        const count = Math.max(1, Math.min(40, Number(n) || 10));
        const next = s.drawPile.slice(-count).reverse();
        return `${s.drawPile.length} cards in the deck. Next ${next.length}: ${list(next)}`;
      },
    },
    pile: {
      usage: '/pile [count]',
      help: 'The discard pile, top card first.',
      run: ([n]) => {
        const s = state();
        const count = Math.max(1, Math.min(40, Number(n) || 8));
        return `${s.discard.length} cards on the pile. Top ${Math.min(count, s.discard.length)}: ${list(s.discard.slice(-count).reverse())}. Colour in play: ${s.color}.`;
      },
    },
    give: {
      usage: '/give <player> <card> [x count]',
      help: 'Puts a specific card in a player’s hand, like /give 2 red 5 or /give me wild4 x2. Taken from the deck when it’s there.',
      changes: true,
      run: ([ref, ...rest], ctx) => {
        const s = state();
        const i = ctx.player(ref);
        const { words, count } = takeCount(rest, 30);
        const card = parseCard(words);
        const player = s.players[i];
        for (let n = 0; n < count; n++) player.hand.push(fetchCard(s, card));
        fixUno(player);
        debugEmit(s, { type: 'draw', player: i, count, reason: 'debug' });
        changed(
          ctx,
          `${ctx.fromName} gave ${player.name} ${count > 1 ? `${count}× ` : ''}${cardName(card)}.`,
        );
      },
    },
    draw: {
      usage: '/draw <player> <count>',
      help: 'Deals a player cards from the top of the deck.',
      changes: true,
      run: ([ref, n], ctx) => {
        const s = state();
        const i = ctx.player(ref);
        const count = Math.max(1, Math.min(99, Number(n) || 1));
        const drew = debugDraw(s, i, count);
        changed(
          ctx,
          `${ctx.fromName} dealt ${nameOf(s, i)} ${drew} card${drew === 1 ? '' : 's'}.`,
        );
      },
    },
    take: {
      usage: '/take <player> <card | all> [x count]',
      help: 'Takes cards out of a player’s hand and shuffles them back into the deck.',
      changes: true,
      run: ([ref, ...rest], ctx) => {
        const s = state();
        const i = ctx.player(ref);
        const player = s.players[i];
        let removed = [];
        if (rest[0]?.toLowerCase() === 'all') {
          removed = player.hand;
          player.hand = [];
        } else {
          const { words, count } = takeCount(rest);
          const card = parseCard(words);
          for (let n = 0; n < count; n++) {
            const at = player.hand.findIndex(
              (c) => c.value === card.value && (c.color ?? null) === card.color,
            );
            if (at < 0) break;
            removed.push(...player.hand.splice(at, 1));
          }
          if (!removed.length)
            throw new CommandError(
              `${player.name} doesn’t have a ${cardName(card)}.`,
            );
        }
        s.drawPile.unshift(...removed);
        debugShuffle(s.drawPile);
        fixUno(player);
        changed(
          ctx,
          `${ctx.fromName} took ${removed.length} card${removed.length === 1 ? '' : 's'} from ${player.name}.`,
        );
      },
    },
    next: {
      usage: '/next <card>',
      help: 'Puts a card on top of the deck, so it’s the next one drawn.',
      changes: true,
      run: (words, ctx) => {
        const s = state();
        const card = parseCard(words);
        s.drawPile.push(fetchCard(s, card));
        changed(
          ctx,
          `${ctx.fromName} stacked the deck: the next card is ${cardName(card)}.`,
        );
      },
    },
    top: {
      usage: '/top <card>',
      help: 'Changes the card on top of the pile (and the colour to match).',
      changes: true,
      run: (words, ctx) => {
        const s = state();
        const parsed = parseCard(words);
        const card = fetchCard(s, parsed);
        s.discard.push(card);
        s.color = card.color ?? s.color;
        debugEmit(s, {
          type: 'play',
          player: s.turn,
          card,
          color: card.color,
          fromCentre: true,
        });
        changed(
          ctx,
          `${ctx.fromName} put ${cardName(card)} on top of the pile.`,
        );
      },
    },
    color: {
      usage: '/color <red|yellow|green|blue>',
      help: 'Changes the colour in play.',
      changes: true,
      run: ([word], ctx) => {
        const s = state();
        const color = COLOR_ALIASES[String(word).toLowerCase()];
        if (!color) throw new CommandError(`Pick one of ${COLORS.join(', ')}.`);
        s.color = color;
        debugEmit(s, { type: 'color', player: s.turn, color });
        changed(ctx, `${ctx.fromName} changed the colour to ${color}.`);
      },
    },
    turn: {
      usage: '/turn <player>',
      help: 'Makes it someone’s turn (clearing anything pending).',
      changes: true,
      run: ([ref], ctx) => {
        const s = state();
        const i = ctx.player(ref);
        s.pending = null;
        s.choice = null;
        s.swapPending = null;
        debugSetTurn(s, i);
        s.turnId--; // changed() bumps it again
        changed(ctx, `${ctx.fromName} made it ${nameOf(s, i)}’s turn.`);
      },
    },
    reverse: {
      usage: '/reverse',
      help: 'Flips the direction of play.',
      changes: true,
      run: (args, ctx) => {
        const s = state();
        s.direction *= -1;
        debugEmit(s, { type: 'reverse', player: s.turn });
        changed(ctx, `${ctx.fromName} reversed the direction of play.`);
      },
    },
    clear: {
      usage: '/clear',
      help: 'Cancels a pending draw or skip, a colour pick or a swap.',
      changes: true,
      run: (args, ctx) => {
        const s = state();
        if (!s.pending && !s.choice && s.swapPending === null)
          return 'Nothing is pending.';
        s.pending = null;
        s.choice = null;
        s.swapPending = null;
        changed(ctx, `${ctx.fromName} cleared what was pending.`);
      },
    },
    shuffle: {
      usage: '/shuffle',
      help: 'Shuffles the deck.',
      changes: true,
      run: (args, ctx) => {
        debugShuffle(state().drawPile);
        changed(ctx, `${ctx.fromName} shuffled the deck.`);
      },
    },
    win: {
      usage: '/win <player>',
      help: 'Ends the game with that player winning.',
      changes: true,
      run: ([ref], ctx) => {
        const s = state();
        const i = ctx.player(ref);
        s.winner = i;
        s.pending = null;
        s.choice = null;
        debugNote(s, `${nameOf(s, i)} won (debug).`);
        debugEmit(s, { type: 'win', player: i });
        changed(ctx, `${ctx.fromName} declared ${nameOf(s, i)} the winner.`);
      },
    },
    rules: {
      usage: '/rules',
      help: 'The rules this game is using.',
      run: () =>
        Object.entries(state().rules)
          .map(
            ([key, value]) =>
              `${key}: ${
                typeof value === 'object'
                  ? Object.entries(value)
                      .filter(([, on]) => on)
                      .map(([k]) => k)
                      .join(', ')
                  : value
              }`,
          )
          .join('\n'),
    },
    rule: {
      usage: '/rule <name> <value>',
      help: 'Changes a rule mid-game, like /rule stacking mixed or /rule jumpIn on. See /rules for the names.',
      changes: true,
      run: ([key, value], ctx) => {
        const s = state();
        const name = Object.keys(DEFAULT_RULES).find(
          (k) => k.toLowerCase() === String(key ?? '').toLowerCase(),
        );
        if (!name || name === 'cards')
          throw new CommandError(`No rule called “${key ?? ''}”. See /rules.`);
        let parsed;
        const current = DEFAULT_RULES[name];
        if (typeof current === 'boolean')
          parsed = /^(on|true|yes|1)$/i.test(value);
        else if (typeof current === 'number') parsed = Number(value);
        else parsed = String(value);
        if (name === 'stacking' && !STACKING_MODES.includes(parsed))
          throw new CommandError(
            `Stacking is one of ${STACKING_MODES.join(', ')}.`,
          );
        if (name === 'turnTime' && !TURN_TIMES.includes(parsed))
          throw new CommandError(
            `Turn time is one of ${TURN_TIMES.join(', ')} seconds.`,
          );
        s.rules = normaliseRules({ ...s.rules, [name]: parsed });
        changed(ctx, `${ctx.fromName} set ${name} to ${s.rules[name]}.`);
      },
    },
    bots: {
      usage: '/bots <pause|resume>',
      help: 'Freezes or unfreezes the computer players.',
      run: ([word], ctx) => {
        const pause = /^(pause|stop|off|freeze)$/i.test(word ?? '');
        const resume = /^(resume|go|on|start)$/i.test(word ?? '');
        if (!pause && !resume)
          throw new CommandError('Say /bots pause or /bots resume.');
        page.botsPaused = pause;
        if (pause) page.stopBots();
        else if (page.state) page.runBots();
        ctx.announce(
          `${ctx.fromName} ${pause ? 'froze' : 'unfroze'} the computer players.`,
        );
      },
    },
    state: {
      usage: '/state',
      help: 'Whose turn it is, the direction, and anything pending.',
      run: () => describe(state()),
    },
  };

  function describe(s) {
    const pending = s.pending
      ? ` Pending: ${s.pending.kind === 'draw' ? `+${s.pending.amount}` : 'skip'} at ${nameOf(s, s.pending.target)}.`
      : '';
    const choice = s.choice
      ? ` ${nameOf(s, s.choice.player)} is picking a ${s.choice.card.color || s.choice.color ? 'target' : 'colour'}.`
      : '';
    return `Woono: ${s.winner !== null ? `${nameOf(s, s.winner)} won.` : `${nameOf(s, s.turn)}’s turn, going ${s.direction === 1 ? 'clockwise' : 'anticlockwise'}.`} Top: ${cardName(topCard(s))} (${s.color}). Deck: ${s.drawPile.length}.${pending}${choice}${page.botsPaused ? ' Computer players frozen.' : ''}`;
  }

  return {
    commands,
    players: () => page.state?.players ?? page.seats,
    describe: () =>
      page.state ? describe(page.state) : 'Woono: in the lobby.',
    snapshot: () => (page.state ? structuredClone(page.state) : null),
    restore: (snap) => page.restoreState(snap),
  };
}
