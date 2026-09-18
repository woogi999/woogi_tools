// Woonopoly: the rules, as plain data and pure functions. The page (or the
// host, online) keeps one `state`, everyone sends it actions, and the state
// turns into a view for every screen. Nothing here touches the DOM or three.js.
//
//   createGame(players, rules)   -> state
//   act(state, index, action)    -> true if it happened (mutates the state)
//   timeOut(state)               -> what the clock does when the player to move is out of time
//   viewFor(state, index)        -> what one screen shows (index -1 for a spectator)
//   settleMs(events)             -> how long the board takes to animate these events
//
// Money is Woobux, counted in pesos: ₱150,000 to start, ₱20,000 for passing GO.

export const MAX_PLAYERS = 8;
export const CURRENCY = '₱';

export const money = (amount) =>
  `${CURRENCY}${Math.round(Math.abs(amount)).toLocaleString('en-US')}`;

// ─── The board ─────────────────────────────────────────────────────────

export const GROUPS = {
  brown: { label: 'Brown', color: '#8B5A2B' },
  lightblue: { label: 'Light blue', color: '#8ED1F2' },
  pink: { label: 'Pink', color: '#E561A6' },
  orange: { label: 'Orange', color: '#F28C28' },
  red: { label: 'Red', color: '#E5484D' },
  yellow: { label: 'Yellow', color: '#F2D02B' },
  green: { label: 'Green', color: '#30A46C' },
  darkblue: { label: 'Dark blue', color: '#2E5BD7' },
  station: { label: 'Stations', color: '#3A3A44' },
  utility: { label: 'Utilities', color: '#8C8C99' },
};

const street = (name, group, price, rent, house) => ({
  type: 'street',
  name,
  group,
  price,
  rent, // [alone, 1 house, 2, 3, 4, hotel]
  house, // cost of one house (a hotel is one more)
});
const station = (name) => ({
  type: 'station',
  name,
  group: 'station',
  price: 20000,
});
const utility = (name) => ({
  type: 'utility',
  name,
  group: 'utility',
  price: 15000,
});
const chance = () => ({ type: 'chance', name: 'Chance' });
const chest = () => ({ type: 'chest', name: 'Treasure Chest' });

// Clockwise from GO, the way the token walks. Corners are 0, 10, 20 and 30.
export const BOARD = [
  { type: 'go', name: 'GO' },
  street(
    'Lorem Lane',
    'brown',
    6000,
    [200, 1000, 3000, 9000, 16000, 25000],
    5000,
  ),
  chest(),
  street(
    'Ipsum Alley',
    'brown',
    6000,
    [400, 2000, 6000, 18000, 32000, 45000],
    5000,
  ),
  { type: 'tax', name: 'Income Tax', amount: 20000 },
  station('File Share Station'),
  street(
    'Pixel Path',
    'lightblue',
    10000,
    [600, 3000, 9000, 27000, 40000, 55000],
    5000,
  ),
  chance(),
  street(
    'Favicon Field',
    'lightblue',
    10000,
    [600, 3000, 9000, 27000, 40000, 55000],
    5000,
  ),
  street(
    'Emoji Esplanade',
    'lightblue',
    12000,
    [800, 4000, 10000, 30000, 45000, 60000],
    5000,
  ),
  { type: 'jail', name: 'Jail' },
  street(
    'Cipher Crescent',
    'pink',
    14000,
    [1000, 5000, 15000, 45000, 62500, 75000],
    10000,
  ),
  utility('Power Plant'),
  street(
    'Hash Hill',
    'pink',
    14000,
    [1000, 5000, 15000, 45000, 62500, 75000],
    10000,
  ),
  street(
    'Regex Row',
    'pink',
    16000,
    [1200, 6000, 18000, 50000, 70000, 90000],
    10000,
  ),
  station('Messages Station'),
  street(
    'QR Quay',
    'orange',
    18000,
    [1400, 7000, 20000, 55000, 75000, 95000],
    10000,
  ),
  chest(),
  street(
    'Barcode Boulevard',
    'orange',
    18000,
    [1400, 7000, 20000, 55000, 75000, 95000],
    10000,
  ),
  street(
    'Mockup Meadows',
    'orange',
    20000,
    [1600, 8000, 22000, 60000, 80000, 100000],
    10000,
  ),
  { type: 'parking', name: 'Free Parking' },
  street(
    'Snake Street',
    'red',
    22000,
    [1800, 9000, 25000, 70000, 87500, 105000],
    15000,
  ),
  chance(),
  street(
    'Minesweeper Mews',
    'red',
    22000,
    [1800, 9000, 25000, 70000, 87500, 105000],
    15000,
  ),
  street(
    'Chess Court',
    'red',
    24000,
    [2000, 10000, 30000, 75000, 92500, 110000],
    15000,
  ),
  station('World Radio Station'),
  street(
    'Woono Way',
    'yellow',
    26000,
    [2200, 11000, 33000, 80000, 97500, 115000],
    15000,
  ),
  street(
    'Avatar Avenue',
    'yellow',
    26000,
    [2200, 11000, 33000, 80000, 97500, 115000],
    15000,
  ),
  utility('Waterworks'),
  street(
    'Pose Parade',
    'yellow',
    28000,
    [2400, 12000, 36000, 85000, 102500, 120000],
    15000,
  ),
  { type: 'gotojail', name: 'Go To Jail' },
  street(
    'Crayon Close',
    'green',
    30000,
    [2600, 13000, 39000, 90000, 110000, 127500],
    20000,
  ),
  street(
    'Doodle Drive',
    'green',
    30000,
    [2600, 13000, 39000, 90000, 110000, 127500],
    20000,
  ),
  chest(),
  street(
    'Sketchbook Square',
    'green',
    320,
    [28, 150, 450, 1000, 1200, 1400],
    200,
  ),
  station('Speed Test Station'),
  chance(),
  street(
    'Gallery Walk',
    'darkblue',
    35000,
    [3500, 17500, 50000, 110000, 130000, 150000],
    20000,
  ),
  { type: 'tax', name: 'Luxury Tax', amount: 10000 },
  street(
    'Studio Heights',
    'darkblue',
    400,
    [50, 200, 600, 1400, 1700, 2000],
    200,
  ),
];

export const JAIL = 10;
export const GO_TO_JAIL = 30;
const STATION_RENT = [2500, 5000, 10000, 20000];
// Times the dice total, in pesos.
const UTILITY_MULTIPLIER = [400, 1000];
const HOUSE_SUPPLY = 32;
const HOTEL_SUPPLY = 12;
const MAX_JAIL_TURNS = 3;

export const isProperty = (space) =>
  space.type === 'street' ||
  space.type === 'station' ||
  space.type === 'utility';
export const PROPERTY_INDICES = BOARD.map((s, i) =>
  isProperty(s) ? i : -1,
).filter((i) => i >= 0);
export const groupSpaces = (group) =>
  BOARD.map((s, i) => (s.group === group ? i : -1)).filter((i) => i >= 0);

// The colours the players' markers take, in seat order.
export const PLAYER_COLORS = [
  '#E5484D',
  '#3E7BE0',
  '#30A46C',
  '#F2B90D',
  '#9B5DE5',
  '#F28C28',
  '#1CB5B0',
  '#E561A6',
];

// ─── Cards ─────────────────────────────────────────────────────────────

// { text, effect }. Effects: go (to a space, collecting on the way), goBack,
// jail, money (from or to the bank), each (from or to every other player),
// repairs (per house / hotel), nearestStation, nearestUtility, jailCard.
const CHANCE = [
  { text: 'Advance to GO. Collect your salary.', effect: { go: 0 } },
  { text: 'Advance to Studio Heights.', effect: { go: 39 } },
  {
    text: 'Advance to Snake Street. If you pass GO, collect your salary.',
    effect: { go: 21 },
  },
  {
    text: 'Advance to Cipher Crescent. If you pass GO, collect your salary.',
    effect: { go: 11 },
  },
  {
    text: 'Advance to the nearest station. If it’s owned, pay the owner twice the rent.',
    effect: { nearestStation: true },
  },
  {
    text: 'Advance to the nearest station. If it’s owned, pay the owner twice the rent.',
    effect: { nearestStation: true },
  },
  {
    text: 'Advance to the nearest utility. If it’s owned, roll the dice and pay ten times the total.',
    effect: { nearestUtility: true },
  },
  { text: 'The bank pays you a dividend of ₱5,000.', effect: { money: 5000 } },
  {
    text: 'Get out of jail free. Keep this card until you need it.',
    effect: { jailCard: true },
  },
  { text: 'Go back three spaces.', effect: { goBack: 3 } },
  {
    text: 'Go straight to jail. Do not pass GO, do not collect your salary.',
    effect: { jail: true },
  },
  {
    text: 'Make general repairs on all your property: ₱2,500 per house, ₱10,000 per hotel.',
    effect: { repairs: [2500, 10000] },
  },
  { text: 'Speeding fine: pay ₱1,500.', effect: { money: -1500 } },
  {
    text: 'Take a trip to File Share Station. If you pass GO, collect your salary.',
    effect: { go: 5 },
  },
  {
    text: 'You’ve been elected chair of the board. Pay each player ₱5,000.',
    effect: { each: -5000 },
  },
  {
    text: 'Your building loan matures. Collect ₱15,000.',
    effect: { money: 15000 },
  },
];

const CHEST = [
  { text: 'Advance to GO. Collect your salary.', effect: { go: 0 } },
  {
    text: 'Bank error in your favour. Collect ₱20,000.',
    effect: { money: 20000 },
  },
  { text: 'Doctor’s fee. Pay ₱5,000.', effect: { money: -5000 } },
  {
    text: 'From the sale of some stock you get ₱5,000.',
    effect: { money: 5000 },
  },
  {
    text: 'Get out of jail free. Keep this card until you need it.',
    effect: { jailCard: true },
  },
  {
    text: 'Go straight to jail. Do not pass GO, do not collect your salary.',
    effect: { jail: true },
  },
  { text: 'Holiday fund matures. Receive ₱10,000.', effect: { money: 10000 } },
  { text: 'Income tax refund. Collect ₱2,000.', effect: { money: 2000 } },
  {
    text: 'It’s your birthday! Collect ₱1,000 from every player.',
    effect: { each: 1000 },
  },
  {
    text: 'Life insurance matures. Collect ₱10,000.',
    effect: { money: 10000 },
  },
  { text: 'Pay hospital fees of ₱10,000.', effect: { money: -10000 } },
  { text: 'Pay school fees of ₱5,000.', effect: { money: -5000 } },
  { text: 'Receive a ₱2,500 consultancy fee.', effect: { money: 2500 } },
  {
    text: 'You’re assessed for street repairs: ₱4,000 per house, ₱11,500 per hotel.',
    effect: { repairs: [4000, 11500] },
  },
  {
    text: 'You won second prize in a doodle contest. Collect ₱1,000.',
    effect: { money: 1000 },
  },
  { text: 'You inherit ₱10,000.', effect: { money: 10000 } },
];

const DECKS = { chance: CHANCE, chest: CHEST };

// ─── Rules ─────────────────────────────────────────────────────────────

export const DEFAULT_RULES = Object.freeze({
  startingMoney: 150000,
  goSalary: 20000,
  // Landing exactly on GO pays the salary twice.
  doubleGo: false,
  // Taxes and fines pile up under Free Parking for whoever lands there.
  freeParking: false,
  // A property nobody buys goes to auction.
  auctions: true,
  // Only 32 houses and 12 hotels exist; when they run out, nobody can build.
  housingLimit: true,
  jailFine: 5000,
  // Seconds per turn, 0 for no clock.
  turnTime: 0,
  // Rounds before the richest player wins, 0 to play to the last one standing.
  roundLimit: 0,
  // Everyone starts with two random properties.
  quickStart: false,
});

export const MONEY_RANGE = [50000, 500000];
export const SALARY_RANGE = [0, 50000];
export const FINE_RANGE = [0, 50000];
export const TURN_TIMES = [0, 30, 60, 90, 120];
export const ROUND_LIMITS = [0, 20, 40, 60];

export const clampInt = (value, [min, max], fallback) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

export function normaliseRules(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const d = DEFAULT_RULES;
  const flag = (key) => (raw[key] === undefined ? d[key] : Boolean(raw[key]));
  return {
    startingMoney: clampInt(raw.startingMoney, MONEY_RANGE, d.startingMoney),
    goSalary: clampInt(raw.goSalary, SALARY_RANGE, d.goSalary),
    doubleGo: flag('doubleGo'),
    freeParking: flag('freeParking'),
    auctions: flag('auctions'),
    housingLimit: flag('housingLimit'),
    jailFine: clampInt(raw.jailFine, FINE_RANGE, d.jailFine),
    turnTime: TURN_TIMES.includes(Number(raw.turnTime))
      ? Number(raw.turnTime)
      : d.turnTime,
    roundLimit: ROUND_LIMITS.includes(Number(raw.roundLimit))
      ? Number(raw.roundLimit)
      : d.roundLimit,
    quickStart: flag('quickStart'),
  };
}

// ─── The game ──────────────────────────────────────────────────────────

const shuffle = (list) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const die = () => 1 + Math.floor(Math.random() * 6);

export function createGame(players, rules = DEFAULT_RULES) {
  const r = normaliseRules(rules);
  const state = {
    gameId: Math.random().toString(36).slice(2, 10),
    rules: r,
    players: players.map((p, i) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      avatar: p.avatar,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      money: r.startingMoney,
      pos: 0,
      inJail: false,
      jailTurns: 0,
      jailCards: 0,
      bankrupt: false,
    })),
    // Per property index: { owner (player index or null), houses 0-5 (5 is a hotel), mortgaged }.
    props: Object.fromEntries(
      PROPERTY_INDICES.map((i) => [
        i,
        { owner: null, houses: 0, mortgaged: false },
      ]),
    ),
    turn: 0,
    // 'turn' (roll, then manage and end) | 'buy' | 'auction' | 'debt' | 'over'
    phase: 'turn',
    // Whether the player to move has finished moving this turn.
    rolled: false,
    dice: [0, 0],
    doubles: 0,
    round: 1,
    pot: 0,
    decks: {
      chance: shuffle(CHANCE.map((_, i) => i)),
      chest: shuffle(CHEST.map((_, i) => i)),
    },
    // A card drawn this turn, shown to everyone until the next action.
    card: null,
    auction: null,
    // Money owed that couldn't be paid straight away: [{ who, to, amount, reason }].
    debts: [],
    trade: null,
    resume: null,
    houses: HOUSE_SUPPLY,
    hotels: HOTEL_SUPPLY,
    winner: null,
    turnId: 0,
    version: 0,
    seq: 0,
    log: [],
    events: [],
  };
  state.turn = Math.floor(Math.random() * players.length);
  if (r.quickStart) quickStart(state);
  note(state, `${state.players[state.turn].name} goes first.`);
  event(state, { type: 'turn', player: state.turn });
  return state;
}

function quickStart(state) {
  const pool = shuffle(PROPERTY_INDICES);
  for (const player of state.players)
    for (let k = 0; k < 2 && pool.length; k++) {
      const space = pool.pop();
      state.props[space].owner = state.players.indexOf(player);
    }
  note(state, 'Quick start: everyone begins with two properties.');
}

// ─── Bookkeeping ───────────────────────────────────────────────────────

const LOG_KEEP = 40;

function note(state, text) {
  state.log.push({ id: ++state.seq, text });
  if (state.log.length > LOG_KEEP) state.log.shift();
}

function event(state, data) {
  state.events.push({ id: ++state.seq, ...data });
  if (state.events.length > LOG_KEEP) state.events.shift();
}

const alive = (state) =>
  state.players.map((p, i) => (p.bankrupt ? -1 : i)).filter((i) => i >= 0);
const nameOf = (state, i) =>
  i === null || i === undefined ? 'the bank' : state.players[i].name;

// Streets owned in a group by one player, and whether that's all of them.
export function ownsGroup(state, index, group) {
  const spaces = groupSpaces(group);
  return spaces.every((s) => state.props[s].owner === index);
}
const groupCount = (state, index, group) =>
  groupSpaces(group).filter((s) => state.props[s].owner === index).length;

export function rentFor(
  state,
  space,
  diceTotal,
  { doubled = false, utilityTimes = null } = {},
) {
  const info = BOARD[space];
  const prop = state.props[space];
  if (prop.owner === null || prop.mortgaged) return 0;
  if (info.type === 'street') {
    if (prop.houses > 0) return info.rent[prop.houses];
    const full = ownsGroup(state, prop.owner, info.group);
    return info.rent[0] * (full ? 2 : 1) * (doubled ? 2 : 1);
  }
  if (info.type === 'station') {
    const count = groupCount(state, prop.owner, 'station');
    return STATION_RENT[count - 1] * (doubled ? 2 : 1);
  }
  const count = groupCount(state, prop.owner, 'utility');
  const times = utilityTimes ?? UTILITY_MULTIPLIER[count - 1];
  return times * diceTotal;
}

// What a player owns, all told, if everything were sold or mortgaged.
export function netWorth(state, index) {
  const player = state.players[index];
  let total = player.money;
  for (const [space, prop] of Object.entries(state.props)) {
    if (prop.owner !== index) continue;
    const info = BOARD[space];
    total += prop.mortgaged ? 0 : info.price / 2;
    if (info.type === 'street') total += (prop.houses * info.house) / 2;
  }
  return total;
}

function give(state, index, amount, reason) {
  const player = state.players[index];
  player.money += amount;
  event(state, { type: 'money', player: index, amount, reason });
}

// Takes money; whatever can't be paid becomes a debt to settle before anything else.
function charge(state, index, amount, to, reason) {
  if (amount <= 0) return;
  const player = state.players[index];
  const paid = Math.min(player.money, amount);
  player.money -= paid;
  if (to !== null && to !== undefined) state.players[to].money += paid;
  else if (state.rules.freeParking) state.pot += paid;
  event(state, { type: 'money', player: index, amount: -paid, reason, to });
  if (to !== null && to !== undefined)
    event(state, { type: 'money', player: to, amount: paid, reason });
  if (paid < amount) {
    state.debts.push({
      who: index,
      to: to ?? null,
      amount: amount - paid,
      reason,
    });
    note(
      state,
      `${player.name} owes ${money(amount - paid)} to ${nameOf(state, to)}.`,
    );
  }
}

// Debts are settled before anything else; the phase they interrupted resumes after.
const settleDebts = (state) => {
  if (!state.debts.length || state.phase === 'over' || state.phase === 'debt')
    return;
  state.resume = state.phase;
  state.phase = 'debt';
};
const afterDebts = (state) => {
  if (state.debts.length) return 'debt';
  const back = state.resume ?? 'turn';
  state.resume = null;
  if (back === 'auction' && !state.auction) return 'turn';
  if (back === 'buy' && state.props[current(state).pos]?.owner !== null)
    return 'turn';
  return back;
};

// ─── Moving ────────────────────────────────────────────────────────────

function passGo(state, index, exact) {
  const salary = state.rules.goSalary * (exact && state.rules.doubleGo ? 2 : 1);
  if (!salary) return;
  give(state, index, salary, 'go');
  note(
    state,
    `${state.players[index].name} ${exact ? 'landed on' : 'passed'} GO and collected ${money(salary)}.`,
  );
}

// Walks the token `steps` forward (or jumps to `to`), then deals with the space.
function moveTo(
  state,
  index,
  to,
  { steps = null, collect = true, rentTimes = null } = {},
) {
  const player = state.players[index];
  const from = player.pos;
  const passed = collect && (to < from || to === 0);
  player.pos = to;
  event(state, {
    type: 'move',
    player: index,
    from,
    to,
    steps: steps ?? (to - from + 40) % 40,
  });
  if (passed) passGo(state, index, to === 0);
  land(state, index, rentTimes);
}

function goToJail(state, index) {
  const player = state.players[index];
  player.pos = JAIL;
  player.inJail = true;
  player.jailTurns = 0;
  state.doubles = 0;
  state.rolled = true;
  event(state, { type: 'jail', player: index });
  note(state, `${player.name} was sent to jail.`);
}

function land(state, index, rentTimes) {
  const player = state.players[index];
  const space = BOARD[player.pos];
  const total = state.dice[0] + state.dice[1];
  event(state, { type: 'land', player: index, space: player.pos });
  switch (space.type) {
    case 'go':
    case 'jail':
      return;
    case 'parking':
      if (state.rules.freeParking && state.pot) {
        note(
          state,
          `${player.name} collected the ${money(state.pot)} under Free Parking.`,
        );
        give(state, index, state.pot, 'parking');
        state.pot = 0;
      }
      return;
    case 'gotojail':
      goToJail(state, index);
      return;
    case 'tax':
      note(
        state,
        `${player.name} paid ${money(space.amount)} in ${space.name}.`,
      );
      charge(state, index, space.amount, null, 'tax');
      return;
    case 'chance':
    case 'chest':
      drawCard(state, index, space.type);
      return;
    default: {
      const prop = state.props[player.pos];
      if (prop.owner === null) {
        state.phase = 'buy';
        return;
      }
      if (prop.owner === index || prop.mortgaged) return;
      const rent =
        rentTimes === 'double'
          ? rentFor(state, player.pos, total, { doubled: true })
          : rentTimes === 'ten'
            ? rentFor(state, player.pos, total, { utilityTimes: 1000 })
            : rentFor(state, player.pos, total);
      if (!rent) return;
      note(
        state,
        `${player.name} paid ${money(rent)} rent to ${nameOf(state, prop.owner)} for ${space.name}.`,
      );
      charge(state, index, rent, prop.owner, 'rent');
      event(state, {
        type: 'rent',
        player: index,
        to: prop.owner,
        space: player.pos,
        amount: rent,
      });
    }
  }
}

function drawCard(state, index, deck) {
  const player = state.players[index];
  const pile = state.decks[deck];
  if (!pile.length) state.decks[deck] = shuffle(DECKS[deck].map((_, i) => i));
  const cardIndex = state.decks[deck].shift();
  const card = DECKS[deck][cardIndex];
  // A jail card stays with the player until it's used; everything else goes to the bottom.
  if (!card.effect.jailCard) state.decks[deck].push(cardIndex);
  state.card = { deck, text: card.text, player: index };
  event(state, { type: 'card', player: index, deck, text: card.text });
  note(state, `${player.name} drew: “${card.text}”`);
  const e = card.effect;
  if (e.go !== undefined) moveTo(state, index, e.go);
  else if (e.goBack)
    moveTo(state, index, (player.pos - e.goBack + 40) % 40, {
      steps: -e.goBack,
      collect: false,
    });
  else if (e.jail) goToJail(state, index);
  else if (e.money) {
    if (e.money > 0) give(state, index, e.money, 'card');
    else charge(state, index, -e.money, null, 'card');
  } else if (e.each) {
    for (const other of alive(state)) {
      if (other === index) continue;
      if (e.each > 0) charge(state, other, e.each, index, 'card');
      else charge(state, index, -e.each, other, 'card');
    }
  } else if (e.repairs) {
    let bill = 0;
    for (const [space, prop] of Object.entries(state.props)) {
      if (prop.owner !== index || BOARD[space].type !== 'street') continue;
      bill += prop.houses === 5 ? e.repairs[1] : prop.houses * e.repairs[0];
    }
    if (bill) charge(state, index, bill, null, 'card');
  } else if (e.nearestStation) {
    const next = [5, 15, 25, 35].find((s) => s > player.pos) ?? 5;
    moveTo(state, index, next, { rentTimes: 'double' });
  } else if (e.nearestUtility) {
    const next = [12, 28].find((s) => s > player.pos) ?? 12;
    // The card says roll again for the amount.
    state.dice = [die(), die()];
    moveTo(state, index, next, { rentTimes: 'ten' });
  } else if (e.jailCard) {
    player.jailCards++;
  }
}

// ─── Turns ─────────────────────────────────────────────────────────────

const current = (state) => state.players[state.turn];

function endTurn(state) {
  const order = alive(state);
  if (order.length <= 1) {
    finish(state, order[0] ?? null);
    return;
  }
  const at = order.indexOf(state.turn);
  const next = order[(at + 1) % order.length];
  if (next <= state.turn) {
    state.round++;
    if (state.rules.roundLimit && state.round > state.rules.roundLimit) {
      const richest = order.reduce(
        (best, i) => (netWorth(state, i) > netWorth(state, best) ? i : best),
        order[0],
      );
      note(state, `${state.rules.roundLimit} rounds are up.`);
      finish(state, richest);
      return;
    }
  }
  state.turn = next;
  state.rolled = false;
  state.doubles = 0;
  state.card = null;
  state.phase = 'turn';
  state.turnId++;
  event(state, { type: 'turn', player: next });
}

function finish(state, winner) {
  state.winner = winner;
  state.phase = 'over';
  state.auction = null;
  state.trade = null;
  if (winner !== null) {
    note(state, `${state.players[winner].name} wins Woonopoly!`);
    event(state, { type: 'win', player: winner });
  }
}

function roll(state, index) {
  const player = state.players[index];
  const dice = [die(), die()];
  state.dice = dice;
  state.card = null;
  const doubles = dice[0] === dice[1];
  event(state, { type: 'roll', player: index, dice });
  if (player.inJail) {
    if (doubles) {
      player.inJail = false;
      player.jailTurns = 0;
      note(state, `${player.name} rolled doubles and is out of jail.`);
      event(state, { type: 'free', player: index });
      state.rolled = true;
      moveTo(state, index, (player.pos + dice[0] + dice[1]) % 40, {
        steps: dice[0] + dice[1],
      });
      return;
    }
    player.jailTurns++;
    if (player.jailTurns >= MAX_JAIL_TURNS) {
      note(
        state,
        `${player.name} paid the ${money(state.rules.jailFine)} fine after three turns in jail.`,
      );
      charge(state, index, state.rules.jailFine, null, 'fine');
      player.inJail = false;
      player.jailTurns = 0;
      event(state, { type: 'free', player: index });
      state.rolled = true;
      moveTo(state, index, (player.pos + dice[0] + dice[1]) % 40, {
        steps: dice[0] + dice[1],
      });
      return;
    }
    note(state, `${player.name} stays in jail.`);
    state.rolled = true;
    return;
  }
  if (doubles) {
    state.doubles++;
    if (state.doubles === 3) {
      note(state, `${player.name} rolled doubles three times in a row.`);
      goToJail(state, index);
      return;
    }
    // Another go after this one lands.
    state.rolled = false;
  } else state.rolled = true;
  moveTo(state, index, (player.pos + dice[0] + dice[1]) % 40, {
    steps: dice[0] + dice[1],
  });
  // Sent to jail mid-move (a card, or the corner): no second roll.
  if (player.inJail) state.rolled = true;
}

// ─── Buying, building, mortgaging ──────────────────────────────────────

function buy(state, index, space, price) {
  const player = state.players[index];
  player.money -= price;
  state.props[space].owner = index;
  event(state, { type: 'buy', player: index, space, price });
  note(
    state,
    `${player.name} bought ${BOARD[space].name} for ${money(price)}.`,
  );
}

export function canBuild(state, index, space) {
  const info = BOARD[space];
  const prop = state.props[space];
  if (info.type !== 'street' || prop.owner !== index || prop.houses >= 5)
    return false;
  if (!ownsGroup(state, index, info.group)) return false;
  const siblings = groupSpaces(info.group).map((s) => state.props[s]);
  if (siblings.some((p) => p.mortgaged)) return false;
  // Build evenly: never more than one house ahead of the rest of the group.
  if (siblings.some((p) => p.houses < prop.houses)) return false;
  if (state.rules.housingLimit) {
    if (prop.houses === 4 && state.hotels < 1) return false;
    if (prop.houses < 4 && state.houses < 1) return false;
  }
  return state.players[index].money >= info.house;
}

export function canSellHouse(state, index, space) {
  const info = BOARD[space];
  const prop = state.props[space];
  if (info.type !== 'street' || prop.owner !== index || prop.houses === 0)
    return false;
  const siblings = groupSpaces(info.group).map((s) => state.props[s]);
  // Sell evenly too: from the most built-up first.
  if (siblings.some((p) => p.houses > prop.houses)) return false;
  // A hotel turns back into four houses, which have to exist.
  if (prop.houses === 5 && state.rules.housingLimit && state.houses < 4)
    return false;
  return true;
}

export function canMortgage(state, index, space) {
  const info = BOARD[space];
  const prop = state.props[space];
  if (!isProperty(info) || prop.owner !== index || prop.mortgaged) return false;
  if (
    info.type === 'street' &&
    groupSpaces(info.group).some((s) => state.props[s].houses > 0)
  )
    return false;
  return true;
}

export const unmortgageCost = (space) =>
  Math.round((BOARD[space].price / 2) * 1.1);

export function canUnmortgage(state, index, space) {
  const prop = state.props[space];
  return (
    prop.owner === index &&
    prop.mortgaged &&
    state.players[index].money >= unmortgageCost(space)
  );
}

function build(state, index, space) {
  const info = BOARD[space];
  const prop = state.props[space];
  prop.houses++;
  if (state.rules.housingLimit) {
    if (prop.houses === 5) {
      state.hotels--;
      state.houses += 4;
    } else state.houses--;
  }
  state.players[index].money -= info.house;
  event(state, { type: 'build', player: index, space, houses: prop.houses });
  note(
    state,
    `${state.players[index].name} built ${prop.houses === 5 ? 'a hotel' : 'a house'} on ${info.name}.`,
  );
}

function sellHouse(state, index, space) {
  const info = BOARD[space];
  const prop = state.props[space];
  if (state.rules.housingLimit) {
    if (prop.houses === 5) {
      state.hotels++;
      state.houses -= 4;
    } else state.houses++;
  }
  prop.houses--;
  state.players[index].money += info.house / 2;
  event(state, { type: 'build', player: index, space, houses: prop.houses });
  note(
    state,
    `${state.players[index].name} sold a ${prop.houses === 4 ? 'hotel' : 'house'} on ${info.name} for ${money(info.house / 2)}.`,
  );
}

function mortgage(state, index, space) {
  const info = BOARD[space];
  state.props[space].mortgaged = true;
  state.players[index].money += info.price / 2;
  event(state, { type: 'mortgage', player: index, space, on: true });
  note(
    state,
    `${state.players[index].name} mortgaged ${info.name} for ${money(info.price / 2)}.`,
  );
}

function unmortgage(state, index, space) {
  const info = BOARD[space];
  state.props[space].mortgaged = false;
  state.players[index].money -= unmortgageCost(space);
  event(state, { type: 'mortgage', player: index, space, on: false });
  note(
    state,
    `${state.players[index].name} paid off the mortgage on ${info.name}.`,
  );
}

// ─── Auctions ──────────────────────────────────────────────────────────

function startAuction(state, space) {
  const bidders = alive(state).filter((i) => state.players[i].money > 0);
  if (bidders.length < 2) return;
  // Bidding goes round from the player after the one who passed on it.
  const order = [
    ...bidders.filter((i) => i > state.turn),
    ...bidders.filter((i) => i <= state.turn),
  ];
  state.auction = { space, bid: 0, bidder: null, bidders: order, at: 0 };
  state.phase = 'auction';
  event(state, { type: 'auction', space });
  note(state, `${BOARD[space].name} is up for auction.`);
}

function auctionNext(state) {
  const a = state.auction;
  if (
    a.bidders.length === 0 ||
    (a.bidders.length === 1 && a.bidder === a.bidders[0])
  ) {
    if (a.bidder !== null) {
      buy(state, a.bidder, a.space, a.bid);
      event(state, {
        type: 'sold',
        player: a.bidder,
        space: a.space,
        price: a.bid,
      });
    } else note(state, `Nobody wanted ${BOARD[a.space].name}.`);
    state.auction = null;
    state.phase = 'turn';
    return;
  }
  a.at = (a.at + 1) % a.bidders.length;
}

// ─── Bankruptcy ────────────────────────────────────────────────────────

function bankrupt(state, index, to) {
  const player = state.players[index];
  player.bankrupt = true;
  player.inJail = false;
  for (const prop of Object.values(state.props)) {
    if (prop.owner !== index) continue;
    if (state.rules.housingLimit) {
      if (prop.houses === 5) state.hotels++;
      else state.houses += prop.houses;
    }
    prop.houses = 0;
    if (to === null || to === undefined) {
      prop.owner = null;
      prop.mortgaged = false;
    } else prop.owner = to;
  }
  if (to !== null && to !== undefined) {
    state.players[to].money += player.money;
    state.players[to].jailCards += player.jailCards;
  }
  player.money = 0;
  player.jailCards = 0;
  state.debts = state.debts.filter((d) => d.who !== index);
  for (const debt of state.debts) if (debt.to === index) debt.to = to ?? null;
  if (state.trade && (state.trade.from === index || state.trade.to === index))
    state.trade = null;
  if (state.auction) {
    state.auction.bidders = state.auction.bidders.filter((i) => i !== index);
    if (state.auction.bidder === index) state.auction.bidder = null;
  }
  event(state, { type: 'bankrupt', player: index, to: to ?? null });
  note(
    state,
    `${player.name} went bankrupt${to !== null && to !== undefined ? ` to ${nameOf(state, to)}` : ''}.`,
  );
  const left = alive(state);
  if (left.length <= 1) finish(state, left[0] ?? null);
  else if (state.turn === index) {
    state.resume = null;
    endTurn(state);
  }
}

// ─── Trades ────────────────────────────────────────────────────────────

const cleanOffer = (state, index, offer) => {
  const raw = offer && typeof offer === 'object' ? offer : {};
  const props = [
    ...new Set((Array.isArray(raw.props) ? raw.props : []).map(Number)),
  ].filter(
    (s) =>
      state.props[s] &&
      state.props[s].owner === index &&
      state.props[s].houses === 0,
  );
  return {
    money: clampInt(raw.money, [0, state.players[index].money], 0),
    props,
    jailCards: clampInt(raw.jailCards, [0, state.players[index].jailCards], 0),
  };
};

function applyTrade(state, trade) {
  const swap = (from, to, offer) => {
    state.players[from].money -= offer.money;
    state.players[to].money += offer.money;
    state.players[from].jailCards -= offer.jailCards;
    state.players[to].jailCards += offer.jailCards;
    for (const space of offer.props) state.props[space].owner = to;
  };
  swap(trade.from, trade.to, trade.give);
  swap(trade.to, trade.from, trade.get);
  event(state, { type: 'trade', from: trade.from, to: trade.to });
  note(
    state,
    `${nameOf(state, trade.from)} and ${nameOf(state, trade.to)} made a trade.`,
  );
}

// ─── Actions ───────────────────────────────────────────────────────────

const manageable = (state, index) => {
  if (state.phase === 'over' || state.players[index]?.bankrupt) return false;
  if (state.phase === 'debt') return state.debts[0]?.who === index;
  if (state.phase === 'auction') return false;
  return state.turn === index;
};

export function act(state, index, action) {
  if (!action || typeof action !== 'object') return false;
  const player = state.players[index];
  if (!player || player.bankrupt || state.phase === 'over') return false;
  const ok = perform(state, index, action);
  if (ok) {
    settleDebts(state);
    state.version++;
  }
  return ok;
}

function perform(state, index, action) {
  const player = state.players[index];
  const mine = state.turn === index;
  switch (action.type) {
    case 'roll':
      if (!mine || state.phase !== 'turn' || state.rolled) return false;
      roll(state, index);
      return true;
    case 'payFine':
      if (!mine || state.phase !== 'turn' || !player.inJail || state.rolled)
        return false;
      if (player.money < state.rules.jailFine) return false;
      charge(state, index, state.rules.jailFine, null, 'fine');
      player.inJail = false;
      player.jailTurns = 0;
      event(state, { type: 'free', player: index });
      note(
        state,
        `${player.name} paid ${money(state.rules.jailFine)} to leave jail.`,
      );
      return true;
    case 'useJailCard':
      if (
        !mine ||
        state.phase !== 'turn' ||
        !player.inJail ||
        state.rolled ||
        !player.jailCards
      )
        return false;
      player.jailCards--;
      player.inJail = false;
      player.jailTurns = 0;
      event(state, { type: 'free', player: index });
      note(state, `${player.name} used a Get Out of Jail Free card.`);
      return true;
    case 'buy': {
      if (!mine || state.phase !== 'buy') return false;
      const space = player.pos;
      const price = BOARD[space].price;
      if (player.money < price) return false;
      buy(state, index, space, price);
      state.phase = 'turn';
      return true;
    }
    case 'decline':
      if (!mine || state.phase !== 'buy') return false;
      note(state, `${player.name} passed on ${BOARD[player.pos].name}.`);
      state.phase = 'turn';
      if (state.rules.auctions) startAuction(state, player.pos);
      return true;
    case 'bid': {
      const a = state.auction;
      if (state.phase !== 'auction' || !a || a.bidders[a.at] !== index)
        return false;
      const amount = Math.round(Number(action.amount));
      if (!Number.isFinite(amount) || amount <= a.bid || amount > player.money)
        return false;
      a.bid = amount;
      a.bidder = index;
      event(state, { type: 'bid', player: index, amount });
      note(
        state,
        `${player.name} bid ${money(amount)} for ${BOARD[a.space].name}.`,
      );
      auctionNext(state);
      return true;
    }
    case 'passBid': {
      const a = state.auction;
      if (state.phase !== 'auction' || !a || a.bidders[a.at] !== index)
        return false;
      a.bidders.splice(a.at, 1);
      a.at = a.bidders.length ? a.at % a.bidders.length : 0;
      // Whoever's up next is the one now at `at`, so no extra step.
      if (
        a.bidders.length === 0 ||
        (a.bidders.length === 1 && a.bidder === a.bidders[0])
      )
        auctionNext(state);
      return true;
    }
    case 'build':
      if (!manageable(state, index) || !canBuild(state, index, action.space))
        return false;
      build(state, index, action.space);
      return true;
    case 'sellHouse':
      if (
        !manageable(state, index) ||
        !canSellHouse(state, index, action.space)
      )
        return false;
      sellHouse(state, index, action.space);
      return true;
    case 'mortgage':
      if (!manageable(state, index) || !canMortgage(state, index, action.space))
        return false;
      mortgage(state, index, action.space);
      return true;
    case 'unmortgage':
      if (
        !manageable(state, index) ||
        !canUnmortgage(state, index, action.space)
      )
        return false;
      unmortgage(state, index, action.space);
      return true;
    case 'payDebt': {
      if (state.phase !== 'debt' || state.debts[0]?.who !== index) return false;
      const debt = state.debts[0];
      if (player.money < debt.amount) return false;
      player.money -= debt.amount;
      if (debt.to !== null) state.players[debt.to].money += debt.amount;
      else if (state.rules.freeParking) state.pot += debt.amount;
      event(state, {
        type: 'money',
        player: index,
        amount: -debt.amount,
        reason: debt.reason,
        to: debt.to,
      });
      if (debt.to !== null)
        event(state, {
          type: 'money',
          player: debt.to,
          amount: debt.amount,
          reason: debt.reason,
        });
      note(
        state,
        `${player.name} paid the ${money(debt.amount)} owed to ${nameOf(state, debt.to)}.`,
      );
      state.debts.shift();
      state.phase = afterDebts(state);
      return true;
    }
    case 'bankrupt': {
      if (state.phase !== 'debt' || state.debts[0]?.who !== index) return false;
      const debt = state.debts[0];
      bankrupt(state, index, debt.to);
      if (state.phase !== 'over') state.phase = afterDebts(state);
      return true;
    }
    case 'end':
      if (!mine || state.phase !== 'turn' || !state.rolled) return false;
      endTurn(state);
      return true;
    case 'trade': {
      if (state.trade || state.phase === 'over') return false;
      const to = Number(action.to);
      const other = state.players[to];
      if (!other || other.bankrupt || to === index) return false;
      const give = cleanOffer(state, index, action.give);
      const get = cleanOffer(state, to, action.get);
      if (
        !give.money &&
        !give.props.length &&
        !give.jailCards &&
        !get.money &&
        !get.props.length &&
        !get.jailCards
      )
        return false;
      state.trade = { from: index, to, give, get };
      event(state, { type: 'offer', from: index, to });
      note(state, `${player.name} offered ${other.name} a trade.`);
      return true;
    }
    case 'acceptTrade': {
      const t = state.trade;
      if (!t || t.to !== index) return false;
      // Things can change while the offer sits there: check it still holds.
      const give = cleanOffer(state, t.from, t.give);
      const get = cleanOffer(state, t.to, t.get);
      const same = (a, b) =>
        a.money === b.money &&
        a.jailCards === b.jailCards &&
        a.props.length === b.props.length;
      if (!same(give, t.give) || !same(get, t.get)) {
        state.trade = null;
        note(state, 'The trade fell through: something in it changed.');
        return true;
      }
      applyTrade(state, t);
      state.trade = null;
      return true;
    }
    case 'declineTrade': {
      const t = state.trade;
      if (!t || (t.to !== index && t.from !== index)) return false;
      note(
        state,
        t.to === index
          ? `${player.name} turned the trade down.`
          : `${player.name} withdrew the trade.`,
      );
      state.trade = null;
      event(state, { type: 'tradeOff', player: index });
      return true;
    }
    default:
      return false;
  }
}

// The clock ran out: the game does the least surprising thing for whoever is up.
export function timeOut(state) {
  const index = actorIndex(state);
  if (index < 0) return false;
  const player = state.players[index];
  switch (state.phase) {
    case 'turn':
      if (!state.rolled) return act(state, index, { type: 'roll' });
      return act(state, index, { type: 'end' });
    case 'buy':
      return act(state, index, { type: 'decline' });
    case 'auction':
      return act(state, index, { type: 'passBid' });
    case 'debt': {
      raiseMoney(state, index, state.debts[0].amount);
      if (player.money >= state.debts[0].amount)
        return act(state, index, { type: 'payDebt' });
      return act(state, index, { type: 'bankrupt' });
    }
    default:
      return false;
  }
}

// Who the game is waiting on.
export function actorIndex(state) {
  if (state.phase === 'over') return -1;
  if (state.phase === 'debt') return state.debts[0]?.who ?? -1;
  if (state.phase === 'auction')
    return state.auction?.bidders[state.auction.at] ?? -1;
  return state.turn;
}

// Sells houses and mortgages property, cheapest first, until `amount` is in hand (or nothing's left).
export function raiseMoney(state, index, amount) {
  const player = state.players[index];
  let guard = 0;
  while (player.money < amount && guard++ < 100) {
    const houses = PROPERTY_INDICES.filter((s) =>
      canSellHouse(state, index, s),
    ).sort((a, b) => BOARD[a].house - BOARD[b].house);
    if (houses.length) {
      sellHouse(state, index, houses[0]);
      continue;
    }
    const mortgages = PROPERTY_INDICES.filter((s) =>
      canMortgage(state, index, s),
    ).sort((a, b) => BOARD[a].price - BOARD[b].price);
    if (!mortgages.length) break;
    mortgage(state, index, mortgages[0]);
  }
}

// ─── Views ─────────────────────────────────────────────────────────────

// How long the board takes to show these events, so nobody acts over an animation.
export function settleMs(events) {
  let total = 0;
  for (const e of events) {
    if (e.type === 'roll') total += 1100;
    else if (e.type === 'move')
      total += Math.min(Math.abs(e.steps), 40) * 130 + 250;
    else if (e.type === 'jail') total += 900;
    else if (e.type === 'card') total += 1400;
    else if (e.type === 'bankrupt' || e.type === 'win') total += 800;
  }
  return total;
}

export function propertiesOf(state, index) {
  return PROPERTY_INDICES.filter((s) => state.props[s].owner === index);
}

export function viewFor(state, index) {
  const me = index >= 0 ? state.players[index] : null;
  const actor = actorIndex(state);
  const flags = {
    canRoll: false,
    canEnd: false,
    canBuy: false,
    canDecline: false,
    canPayFine: false,
    canUseJailCard: false,
    canBid: false,
    canPayDebt: false,
    canManage: false,
    canTrade: false,
  };
  if (me && !me.bankrupt && state.phase !== 'over') {
    const mine = state.turn === index;
    flags.canRoll = mine && state.phase === 'turn' && !state.rolled;
    flags.canEnd = mine && state.phase === 'turn' && state.rolled;
    flags.canBuy =
      mine && state.phase === 'buy' && me.money >= BOARD[me.pos].price;
    flags.canDecline = mine && state.phase === 'buy';
    flags.canPayFine =
      flags.canRoll && me.inJail && me.money >= state.rules.jailFine;
    flags.canUseJailCard = flags.canRoll && me.inJail && me.jailCards > 0;
    flags.canBid = state.phase === 'auction' && actor === index;
    flags.canPayDebt =
      state.phase === 'debt' &&
      actor === index &&
      me.money >= state.debts[0].amount;
    flags.canManage = manageable(state, index);
    flags.canTrade =
      !state.trade && state.phase !== 'auction' && state.phase !== 'debt';
  }
  return {
    gameId: state.gameId,
    rules: state.rules,
    you: index,
    players: state.players.map((p) => ({ ...p })),
    props: state.props,
    turn: state.turn,
    actor,
    phase: state.phase,
    rolled: state.rolled,
    dice: state.dice,
    doubles: state.doubles,
    round: state.round,
    pot: state.pot,
    card: state.card,
    auction: state.auction
      ? { ...state.auction, bidders: [...state.auction.bidders] }
      : null,
    debt: state.debts[0] ?? null,
    trade: state.trade,
    houses: state.houses,
    hotels: state.hotels,
    winner: state.winner,
    turnId: state.turnId,
    version: state.version,
    log: state.log,
    events: state.events,
    ...flags,
  };
}

export const spectatorView = (state) => viewFor(state, -1);

// The player who left is played by the computer from here on.
export function handToBot(state, id) {
  const player = state.players.find((p) => p.id === id);
  if (!player || player.kind !== 'human') return false;
  player.kind = 'bot';
  note(state, `${player.name} left; the computer plays on for them.`);
  state.version++;
  return true;
}

// What a deed card says, for the panels.
export function deedFor(state, space) {
  const info = BOARD[space];
  const prop = state.props[space];
  if (!isProperty(info)) return { ...info, space, owner: null };
  const lines = [];
  if (info.type === 'street') {
    lines.push({ label: 'Rent', value: money(info.rent[0]) });
    lines.push({ label: 'With the full set', value: money(info.rent[0] * 2) });
    for (let h = 1; h <= 4; h++)
      lines.push({
        label: `With ${h} house${h > 1 ? 's' : ''}`,
        value: money(info.rent[h]),
      });
    lines.push({ label: 'With a hotel', value: money(info.rent[5]) });
    lines.push({ label: 'Each house costs', value: money(info.house) });
  } else if (info.type === 'station') {
    STATION_RENT.forEach((rent, i) =>
      lines.push({
        label: `With ${i + 1} station${i ? 's' : ''}`,
        value: money(rent),
      }),
    );
  } else {
    lines.push({ label: 'With one utility', value: '₱400 × the dice' });
    lines.push({ label: 'With both', value: '₱1,000 × the dice' });
  }
  lines.push({ label: 'Mortgage value', value: money(info.price / 2) });
  return {
    ...info,
    space,
    owner: prop.owner,
    houses: prop.houses,
    mortgaged: prop.mortgaged,
    lines,
  };
}
