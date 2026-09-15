// Multiplayer Minesweeper rules: one shared field, everyone walking about on
// it at once. Kept free of rendering so the host runs it and sends each player
// a view without the mines.
//
// Scoring: +1 for every tile you uncover (a flood of empty tiles counts them
// all), −10 and a short stun for digging up a mine, and flags settle at the end:
// +2 for each on a mine, −2 for each on a safe tile. Highest score wins.
//
// With "Bombs only stun" off, a mine knocks you out of the game instead: once
// everyone's out (or on your own, straight away) the game ends and every mine shows.

export const MAX_PLAYERS = 4;
export const FIELDS = [
  { id: 'small', label: 'Small', width: 12, height: 12, mines: 22 },
  { id: 'normal', label: 'Normal', width: 16, height: 16, mines: 42 },
  { id: 'large', label: 'Large', width: 22, height: 22, mines: 85 },
];
export const TIME_LIMITS = [
  { id: 180, label: '3 min' },
  { id: 300, label: '5 min' },
  { id: 480, label: '8 min' },
];
export const PLAYER_COLORS = ['#ff6b81', '#4d8ff0', '#7ed957', '#f2b90d'];

export const HIDDEN = -1;
export const EXPLODED = 9;
export const DROP_MS = 1800;
export const STUN_MS = 2500;
export const WALK_SPEED = 3.6; // tiles a second
const BOT_SPEED = 2.4;
const MINE_PENALTY = 10;
const FLAG_POINTS = 2;
const EVENT_HISTORY = 30;

const NEIGHBOURS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

export const fieldOf = (id) => FIELDS.find((f) => f.id === id) ?? FIELDS[1];
const index = (state, x, y) => y * state.width + x;
const inField = (state, x, y) => x >= 0 && y >= 0 && x < state.width && y < state.height;
// The tile under a position (positions are in tile units, a tile's centre at +0.5).
export const tileAt = (state, px, py) => [Math.max(0, Math.min(state.width - 1, Math.floor(px))), Math.max(0, Math.min(state.height - 1, Math.floor(py)))];

function around(state, x, y) {
  return NEIGHBOURS.map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) => inField(state, nx, ny));
}

// players: [{ id, name, bot }]; options: { field, time (seconds), stunOnly }
export function createGame(players, { field = 'normal', time = 300, stunOnly = true } = {}) {
  const spec = fieldOf(field);
  // Everyone lands in a huddle near the top-left corner.
  const SPAWNS = [
    [1.5, 1.5],
    [2.7, 1.5],
    [1.5, 2.7],
    [2.7, 2.7],
  ];
  return {
    width: spec.width,
    height: spec.height,
    mineCount: spec.mines,
    stunOnly: stunOnly !== false,
    mines: null, // laid on the first dig
    cells: Array(spec.width * spec.height).fill(HIDDEN),
    flags: Array(spec.width * spec.height).fill(null), // who flagged each tile
    safeLeft: spec.width * spec.height - spec.mines,
    status: 'drop', // 'drop' | 'playing' | 'over'
    dropLeft: DROP_MS,
    timeLeft: time * 1000,
    winner: null,
    seq: 0,
    events: [],
    players: players.map((player, i) => {
      const [x, y] = SPAWNS[i % SPAWNS.length];
      return {
        id: player.id,
        name: player.name,
        bot: Boolean(player.bot),
        color: i,
        x,
        y,
        face: 0,
        moving: false,
        score: 0,
        uncovered: 0,
        booms: 0,
        flagsRight: 0,
        flagsWrong: 0,
        stun: 0,
        dead: false,
      };
    }),
  };
}

function emit(state, event) {
  state.events = [...state.events.slice(-(EVENT_HISTORY - 1)), { id: ++state.seq, ...event }];
}

function layMines(state, sx, sy) {
  const keepClear = new Set([index(state, sx, sy), ...around(state, sx, sy).map(([x, y]) => index(state, x, y))]);
  const spots = [];
  for (let i = 0; i < state.cells.length; i++) if (!keepClear.has(i)) spots.push(i);
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  state.mines = Array(state.cells.length).fill(false);
  for (const i of spots.slice(0, state.mineCount)) state.mines[i] = true;
}

const countAround = (state, x, y) => around(state, x, y).filter(([nx, ny]) => state.mines[index(state, nx, ny)]).length;

const playerOf = (state, id) => state.players.find((p) => p.id === id);
const canAct = (state, player) => state.status === 'playing' && player && player.stun <= 0 && !player.dead;

// Dig a tile. Returns what happened: 'safe', 'boom' or null (nothing to dig).
export function dig(state, id, x, y) {
  const player = playerOf(state, id);
  if (!canAct(state, player) || !inField(state, x, y)) return null;
  const i = index(state, x, y);
  if (state.cells[i] !== HIDDEN || state.flags[i]) return null;
  if (!state.mines) layMines(state, x, y);
  if (state.mines[i]) {
    state.cells[i] = EXPLODED;
    player.score -= MINE_PENALTY;
    player.booms++;
    if (state.stunOnly) player.stun = STUN_MS;
    else player.dead = true;
    // A blown mine counts as found, so the field can still be finished.
    emit(state, { kind: 'boom', x, y, by: id, dead: player.dead });
    settle(state);
    return 'boom';
  }
  // Flood outwards from empty tiles.
  const opened = [];
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    const k = index(state, cx, cy);
    if (state.cells[k] !== HIDDEN || state.mines[k]) continue;
    if (state.flags[k] && (cx !== x || cy !== y)) continue;
    const n = countAround(state, cx, cy);
    state.cells[k] = n;
    opened.push(k);
    if (n === 0) for (const [nx, ny] of around(state, cx, cy)) if (state.cells[index(state, nx, ny)] === HIDDEN) stack.push([nx, ny]);
  }
  player.score += opened.length;
  player.uncovered += opened.length;
  state.safeLeft -= opened.length;
  emit(state, { kind: 'dig', x, y, by: id, count: opened.length });
  settle(state);
  return 'safe';
}

// Put a flag on a hidden tile, or take one off (anyone's: a wrong flag shouldn't block the field).
export function toggleFlag(state, id, x, y) {
  const player = playerOf(state, id);
  if (!canAct(state, player) || !inField(state, x, y)) return null;
  const i = index(state, x, y);
  if (state.cells[i] !== HIDDEN) return null;
  if (state.flags[i]) {
    state.flags[i] = null;
    emit(state, { kind: 'unflag', x, y, by: id });
    return 'unflag';
  }
  state.flags[i] = id;
  emit(state, { kind: 'flag', x, y, by: id });
  return 'flag';
}

// A player who left: they stay on the scoreboard but stop playing.
export function removePlayer(state, id) {
  const player = playerOf(state, id);
  if (player) player.left = true;
}

function settle(state) {
  if (state.status !== 'playing') return;
  const everyoneOut = state.players.every((p) => p.dead || p.left);
  if (state.safeLeft > 0 && state.timeLeft > 0 && !everyoneOut) return;
  state.status = 'over';
  // Flags count now.
  if (state.mines) {
    state.flags.forEach((owner, i) => {
      const player = owner && playerOf(state, owner);
      if (!player || state.cells[i] !== HIDDEN) return;
      if (state.mines[i]) {
        player.score += FLAG_POINTS;
        player.flagsRight++;
      } else {
        player.score -= FLAG_POINTS;
        player.flagsWrong++;
      }
    });
  }
  const top = Math.max(...state.players.map((p) => p.score));
  const leaders = state.players.filter((p) => p.score === top);
  state.winner = leaders.length === 1 ? leaders[0].id : null;
  emit(state, { kind: 'over', winner: state.winner, cleared: state.safeLeft <= 0, blownUp: everyoneOut && state.safeLeft > 0 });
}

// Moves a player by a walking direction (each axis -1..1) for `dt` seconds.
export function walk(state, player, dx, dy, dt, speed = WALK_SPEED) {
  const length = Math.hypot(dx, dy);
  player.moving = length > 0.05 && state.status === 'playing' && player.stun <= 0 && !player.dead;
  if (!player.moving) return;
  const scale = Math.min(1, length) / length;
  player.x = Math.max(0.2, Math.min(state.width - 0.2, player.x + dx * scale * speed * dt));
  player.y = Math.max(0.2, Math.min(state.height - 0.2, player.y + dy * scale * speed * dt));
  player.face = Math.atan2(dx, dy);
}

// Advances timers by `ms`. Mutates `state`.
export function tick(state, ms) {
  if (state.status === 'over') return;
  for (const player of state.players) player.stun = Math.max(0, player.stun - ms);
  if (state.status === 'drop') {
    state.dropLeft -= ms;
    if (state.dropLeft <= 0) {
      state.status = 'playing';
      emit(state, { kind: 'start' });
    }
    return;
  }
  state.timeLeft = Math.max(0, state.timeLeft - ms);
  settle(state);
}

// What everyone may see: the field without the mines (all of them once it's over).
export function viewOf(state) {
  const over = state.status === 'over';
  return {
    width: state.width,
    height: state.height,
    mineCount: state.mineCount,
    cells: state.cells,
    flags: state.flags,
    mines: over && state.mines ? state.mines : null,
    safeLeft: state.safeLeft,
    status: state.status,
    dropLeft: state.dropLeft,
    timeLeft: state.timeLeft,
    winner: state.winner,
    events: state.events,
    stunOnly: state.stunOnly,
    players: state.players.map(({ id, name, bot, color, x, y, face, moving, score, uncovered, booms, flagsRight, flagsWrong, stun, dead, left }) => ({ id, name, bot, color, x, y, face, moving, score, uncovered, booms, flagsRight, flagsWrong, stun, dead: Boolean(dead), left: Boolean(left) })),
  };
}

// ─── Computer players ──────────────────────────────────────────────────

// Picks a tile from what's on show: the classic single-number deductions
// (a number whose mines are all flagged makes the rest safe; one with as many
// hidden tiles as missing mines makes them all mines), otherwise the tile with
// the lowest chance of a mine next to the uncovered area, otherwise anywhere.
export function botPlan(view, player) {
  const { width, height, cells, flags } = view;
  const at = (x, y) => y * width + x;
  const safe = new Set();
  const mines = new Set();
  const risk = new Map();
  let anyOpen = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const n = cells[at(x, y)];
      if (n === HIDDEN || n === EXPLODED) continue;
      anyOpen = true;
      if (n === 0) continue;
      const hidden = [];
      let found = 0;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const k = at(nx, ny);
        if (cells[k] === EXPLODED || flags[k]) found++;
        else if (cells[k] === HIDDEN) hidden.push(k);
      }
      if (!hidden.length) continue;
      if (found >= n) hidden.forEach((k) => safe.add(k));
      else if (n - found === hidden.length) hidden.forEach((k) => mines.add(k));
      else for (const k of hidden) risk.set(k, Math.max(risk.get(k) ?? 0, (n - found) / hidden.length));
    }
  }
  const px = player.x;
  const py = player.y;
  const nearest = (set) => {
    let best = null;
    let bestD = Infinity;
    for (const k of set) {
      const x = k % width;
      const y = Math.floor(k / width);
      const d = Math.hypot(x + 0.5 - px, y + 0.5 - py);
      if (d < bestD) {
        bestD = d;
        best = [x, y];
      }
    }
    return best;
  };
  for (const k of [...mines]) if (flags[k]) mines.delete(k);
  const flagTarget = nearest(mines);
  const digTarget = nearest(safe);
  if (digTarget || flagTarget) {
    const dd = digTarget ? Math.hypot(digTarget[0] - px, digTarget[1] - py) : Infinity;
    const fd = flagTarget ? Math.hypot(flagTarget[0] - px, flagTarget[1] - py) : Infinity;
    return dd <= fd ? { action: 'dig', tile: digTarget } : { action: 'flag', tile: flagTarget };
  }
  if (!anyOpen) return { action: 'dig', tile: [Math.floor(px), Math.floor(py)] };
  let guess = null;
  let lowest = Infinity;
  for (const [k, r] of risk) {
    if (flags[k]) continue;
    const score = r + Math.random() * 0.05;
    if (score < lowest) {
      lowest = score;
      guess = [k % width, Math.floor(k / width)];
    }
  }
  if (guess) return { action: 'dig', tile: guess };
  const hidden = [];
  cells.forEach((c, k) => c === HIDDEN && !flags[k] && hidden.push(k));
  if (!hidden.length) return null;
  const k = hidden[Math.floor(Math.random() * hidden.length)];
  return { action: 'dig', tile: [k % width, Math.floor(k / width)] };
}

// One step of a computer player: walk to its chosen tile, then dig or flag it.
// `brain` is the bot's own memory ({ plan, wait }), kept by the host.
export function botStep(state, player, brain, dt) {
  if (state.status !== 'playing' || player.stun > 0 || player.dead) {
    player.moving = false;
    return null;
  }
  brain.wait = Math.max(0, (brain.wait ?? 0) - dt * 1000);
  if (brain.wait > 0) {
    player.moving = false;
    return null;
  }
  const plan = brain.plan;
  const stillValid = plan && state.cells[index(state, ...plan.tile)] === HIDDEN && !state.flags[index(state, ...plan.tile)];
  if (!stillValid) {
    brain.plan = botPlan(state, player);
    brain.wait = 250 + Math.random() * 450;
    return null;
  }
  const tx = plan.tile[0] + 0.5;
  const ty = plan.tile[1] + 0.5;
  const dx = tx - player.x;
  const dy = ty - player.y;
  const distance = Math.hypot(dx, dy);
  if (distance > 0.12) {
    const stepLength = Math.min(distance, BOT_SPEED * dt);
    walk(state, player, dx / distance, dy / distance, stepLength / BOT_SPEED, BOT_SPEED);
    return null;
  }
  player.moving = false;
  brain.plan = null;
  brain.wait = 350 + Math.random() * 500;
  return plan.action === 'flag' ? { action: 'flag', result: toggleFlag(state, player.id, ...plan.tile) } : { action: 'dig', result: dig(state, player.id, ...plan.tile) };
}
