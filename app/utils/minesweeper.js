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
  { id: 'extreme', label: 'Extreme', width: 32, height: 32, mines: 180 },
  // Size and mines both come from the level itself; these are only a stand-in
  // for the moment before one is picked.
  { id: 'custom', label: 'Your level', width: 16, height: 16, mines: 40 },
];
// Scenery, picked at random each game: the island's look plus the colours of covered and dug tiles.
export const THEMES = [
  {
    id: 'meadow',
    island: 'meadow',
    grass: ['#8fd16a', '#80c45d'],
    sand: ['#f3e2b3', '#e9d5a0'],
  },
  {
    id: 'beach',
    island: 'palms',
    grass: ['#f2cf7e', '#e6c16c'],
    sand: ['#fbf1d6', '#f1e4c0'],
  },
  {
    id: 'lagoon',
    island: 'lagoon',
    grass: ['#5fc9a8', '#52bb9a'],
    sand: ['#e8f2dc', '#dbe8cc'],
  },
  {
    id: 'autumn',
    island: 'autumn',
    grass: ['#e8964a', '#d9853d'],
    sand: ['#efdcc0', '#e3cdae'],
  },
  {
    id: 'snow',
    island: 'snow',
    grass: ['#e9f3fb', '#d9e8f4'],
    sand: ['#b9c7d3', '#aebdca'],
  },
  {
    id: 'desert',
    island: 'desert',
    grass: ['#d9a15f', '#cc9452'],
    sand: ['#f6dfae', '#ecd29b'],
  },
];
export const themeOf = (id) => THEMES.find((t) => t.id === id) ?? THEMES[0];
export const PLAYER_COLORS = ['#ff6b81', '#4d8ff0', '#7ed957', '#f2b90d'];

export const HIDDEN = -1;
// A square the level cut out of the board: not diggable, not counted, and the
// island's sand is drawn there instead of a tile. Because it is never HIDDEN,
// every path that digs, floods or counts already steps over it.
export const VOID = -2;
export const EXPLODED = 9;
export const DROP_MS = 1800;
export const STUN_MS = 2500;
export const DEFUSED = 10;
export const WALK_SPEED = 2.6; // tiles a second
export const RUN_SPEED = 4.4;
export const RUN_MODES = [
  { id: 'off', label: 'Off' },
  { id: 'risky', label: 'Risky' },
  { id: 'stamina', label: 'Stamina' },
];
// What a mine does to you when "Bombs only stun" is off.
export const DEATH_MODES = [
  { id: 'out', label: 'Out for good', hint: 'One mine and your game is over.' },
  {
    id: 'respawn',
    label: 'Respawn',
    hint: 'You come back, and each mine keeps you down longer.',
  },
  {
    id: 'lives',
    label: 'Lives',
    hint: 'A set number of mines before you are out for good.',
  },
];
export const LIVES_RANGE = [1, 9];
const RESPAWN_BASE_MS = 4000; // how long your first mine keeps you down
const RESPAWN_STEP_MS = 3000; // added for each one after
const RESPAWN_MAX_MS = 20000;
const LIVES_DOWN_MS = 3000; // the pause before a life is spent and you're back
export const respawnMs = (deaths) =>
  Math.min(
    RESPAWN_MAX_MS,
    RESPAWN_BASE_MS + Math.max(0, deaths - 1) * RESPAWN_STEP_MS,
  );

export const STAMINA_MAX = 100;
const STAMINA_DRAIN = 30; // a second while running
const STAMINA_REGEN = 22; // a second, once you've rested long enough
const STAMINA_REST = 2; // seconds without running before stamina starts coming back
export const WINDED_SPEED = 1.5; // run dry and you trudge at this until stamina is full again
const DEFUSE_POINTS = 5;
export const TIME_RANGE = [30, 3600]; // seconds a game can last
// Time to defuse: 10 seconds for your first mine, 15% less for each one after, never under 2.
export const DEFUSE_GRACE_MS = 750; // input's ignored this long when a puzzle comes up
export const defuseMs = (level) =>
  Math.max(2000, Math.round(10000 * 0.85 ** level));
export const BLAST_RADIUS = 2; // tiles, with the Explosions stun nearby rule on (the default)
export const BLAST_RADIUS_RANGE = [1, 6];
const SPRINT_AT = 0.9; // share of safe tiles uncovered before Last-minute sprint kicks in
const SPRINT_MS = 60000;
export const MINE_PERCENT_RANGE = [5, 35];
export const BOT_LEVELS = [
  { id: 'easy', label: 'Easy' },
  { id: 'normal', label: 'Normal' },
  { id: 'hard', label: 'Hard' },
];
// speed: tiles a second; think: ms pause range between moves; slip: chance of digging a random tile instead of thinking.
// `run` is how a computer player uses the sprint, when the rule is on:
//   far    how many tiles away a target has to be before it bothers
//   keep   share of its stamina it refuses to spend, so it isn't always winded
//   risk   chance it sprints across a tile it hasn't cleared, on Risky
const BOT_TUNING = {
  easy: {
    speed: 1.4,
    think: [700, 1300],
    slip: 0.2,
    defuse: 0.5,
    run: { far: 2.5, keep: 0.1, risk: 0.5 },
  },
  normal: {
    speed: 1.9,
    think: [300, 800],
    slip: 0,
    defuse: 0.75,
    run: { far: 2, keep: 0.3, risk: 0.15 },
  },
  hard: {
    speed: 2.5,
    think: [120, 350],
    slip: 0,
    defuse: 0.92,
    run: { far: 1.5, keep: 0.45, risk: 0 },
  },
};
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
const inField = (state, x, y) =>
  x >= 0 && y >= 0 && x < state.width && y < state.height;
// The tile under a position (positions are in tile units, a tile's centre at +0.5).
export const tileAt = (state, px, py) => [
  Math.max(0, Math.min(state.width - 1, Math.floor(px))),
  Math.max(0, Math.min(state.height - 1, Math.floor(py))),
];

function around(state, x, y) {
  return NEIGHBOURS.map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) =>
    inField(state, nx, ny),
  );
}

// players: [{ id, name, bot }]; options: { field, time (seconds), stunOnly, blast, minePercent (null: the field's own count), botLevel }
export function createGame(
  players,
  {
    field = 'normal',
    time = 300,
    stunOnly = true,
    blast = false,
    blastRadius = BLAST_RADIUS,
    sprint = false,
    minePercent = null,
    botLevel = 'normal',
    run = 'off',
    defuse = false,
    deathMode = 'out',
    lives = 3,
    // A layout from the Level Editor: { width, height, mines, mask }.
    custom = null,
  } = {},
) {
  const spec = fieldOf(field);
  // A custom level brings its own size and its own mines, so the field picker
  // and the mine percentage don't apply to it.
  const laid =
    custom?.mines?.length === custom?.width * custom?.height ? custom : null;
  const w = laid ? laid.width : spec.width;
  const h = laid ? laid.height : spec.height;
  // Everyone lands in their own corner, the first two opposite each other.
  const SPAWNS = [
    [1.5, 1.5],
    [w - 1.5, h - 1.5],
    [w - 1.5, 1.5],
    [1.5, h - 1.5],
  ];
  const [lo, hi] = MINE_PERCENT_RANGE;
  const percent = Number(minePercent);
  const wanted =
    minePercent == null || minePercent === '' || !Number.isFinite(percent)
      ? spec.mines
      : Math.max(
          1,
          Math.round((w * h * Math.max(lo, Math.min(hi, percent))) / 100),
        );
  // Room left over once the landing spots and first dig are kept clear.
  // Which squares are on the board at all. A level drawn as some shape other
  // than a rectangle cuts the rest out.
  const mask =
    laid && Array.isArray(laid.mask) && laid.mask.length === w * h
      ? laid.mask
      : null;
  const playable = mask ? mask.filter(Boolean).length : w * h;
  const mineCount = laid
    ? laid.mines.filter((mine, i) => mine && (!mask || mask[i])).length
    : Math.min(wanted, playable - 9 * 5);
  return {
    width: w,
    height: h,
    mineCount,
    theme: THEMES[Math.floor(Math.random() * THEMES.length)].id,
    stunOnly: stunOnly !== false,
    // Only consulted when stunOnly is off.
    deathMode: DEATH_MODES.some((m) => m.id === deathMode) ? deathMode : 'out',
    lives: Math.max(
      LIVES_RANGE[0],
      Math.min(LIVES_RANGE[1], Math.round(Number(lives)) || 3),
    ),
    blast: Boolean(blast),
    blastRadius: Math.max(
      BLAST_RADIUS_RANGE[0],
      Math.min(
        BLAST_RADIUS_RANGE[1],
        Math.round(Number(blastRadius)) || BLAST_RADIUS,
      ),
    ),
    sprint: Boolean(sprint),
    sprinted: false,
    run: RUN_MODES.some((m) => m.id === run) ? run : 'off',
    defuse: Boolean(defuse),
    botLevel: BOT_TUNING[botLevel] ? botLevel : 'normal',
    spawns: SPAWNS.slice(0, Math.max(1, players.length)).map(([x, y]) => [
      Math.floor(x),
      Math.floor(y),
    ]),
    // Normally laid on the first dig, so it is always safe. A custom level's
    // mines are exactly where they were drawn, which is the point of drawing
    // them, so there the first dig can find one.
    mines: laid
      ? laid.mines.map((mine, i) => mine && (!mask || mask[i]))
      : null,
    custom: Boolean(laid),
    mask,
    // Where there is island, and where the ponds are. Only the scene reads
    // these: the rules only care about the mask.
    land: laid && Array.isArray(laid.land) ? laid.land : null,
    water: laid && Array.isArray(laid.water) ? laid.water : null,
    cells: Array.from({ length: w * h }, (_, i) =>
      mask && !mask[i] ? VOID : HIDDEN,
    ),
    flags: Array(w * h).fill(null), // who flagged each tile
    safeLeft: playable - mineCount,
    status: 'drop', // 'drop' | 'playing' | 'over'
    dropLeft: DROP_MS,
    timeLeft:
      Math.max(
        TIME_RANGE[0],
        Math.min(TIME_RANGE[1], Math.round(Number(time)) || 300),
      ) * 1000,
    winner: null,
    seq: 0,
    events: [],
    players: players.map((player, i) => {
      const [x, y] = SPAWNS[i % SPAWNS.length];
      return {
        id: player.id,
        name: player.name,
        bot: Boolean(player.bot),
        // Its own difficulty, set per seat in the lobby, falling back to the
        // room-wide one for a room saved before that existed.
        botLevel: BOT_TUNING[player.botLevel] ? player.botLevel : null,
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
        dead: false, // out for good
        downMs: 0, // blown up but coming back
        deaths: 0,
        livesLeft: Math.max(
          LIVES_RANGE[0],
          Math.min(LIVES_RANGE[1], Math.round(Number(lives)) || 3),
        ),
        spawn: [x, y],
        running: false,
        stamina: STAMINA_MAX,
        winded: false,
        defusing: null, // { x, y, ms, total, level, seed } while a defuse puzzle is up
        defused: 0,
        lastTile: -1,
      };
    }),
  };
}

function emit(state, event) {
  state.events = [
    ...state.events.slice(-(EVENT_HISTORY - 1)),
    { id: ++state.seq, ...event },
  ];
}

function layMines(state, sx, sy) {
  // The first dig and everyone's landing spot start safe.
  const keepClear = new Set();
  for (const [cx, cy] of [[sx, sy], ...(state.spawns ?? [])]) {
    keepClear.add(index(state, cx, cy));
    for (const [x, y] of around(state, cx, cy))
      keepClear.add(index(state, x, y));
  }
  const spots = [];
  for (let i = 0; i < state.cells.length; i++)
    if (!keepClear.has(i) && state.cells[i] !== VOID) spots.push(i);
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  state.mines = Array(state.cells.length).fill(false);
  for (const i of spots.slice(0, state.mineCount)) state.mines[i] = true;
}

const countAround = (state, x, y) =>
  around(state, x, y).filter(([nx, ny]) => state.mines[index(state, nx, ny)])
    .length;

const playerOf = (state, id) => state.players.find((p) => p.id === id);
const canAct = (state, player) =>
  state.status === 'playing' &&
  player &&
  player.stun <= 0 &&
  !player.dead &&
  !(player.downMs > 0) &&
  !player.defusing;

// A mine goes off under `player`: points lost, stunned or out, and a blast for anyone close (with that rule on).
function explode(state, player, x, y) {
  const id = player.id;
  state.cells[index(state, x, y)] = EXPLODED;
  state.flags[index(state, x, y)] = null;
  player.score -= MINE_PENALTY;
  player.booms++;
  if (state.stunOnly) {
    player.stun = STUN_MS;
  } else {
    // A mine is more than a stun: how much more is the death mode's business.
    player.deaths = (player.deaths ?? 0) + 1;
    if (state.deathMode === 'respawn') {
      // Each one keeps you down longer, so the field stays dangerous without
      // ending anybody's game on the first mistake.
      player.downMs = respawnMs(player.deaths);
    } else if (state.deathMode === 'lives') {
      player.livesLeft = Math.max(0, (player.livesLeft ?? state.lives) - 1);
      if (player.livesLeft <= 0) player.dead = true;
      else player.downMs = LIVES_DOWN_MS;
    } else {
      player.dead = true;
    }
  }
  // The blast stuns anyone standing close, without costing them points.
  const stunned = [];
  if (state.blast) {
    for (const other of state.players) {
      if (other === player || other.dead || other.left) continue;
      if (
        Math.hypot(other.x - (x + 0.5), other.y - (y + 0.5)) >
        state.blastRadius + 0.5
      )
        continue;
      other.stun = Math.max(other.stun, STUN_MS);
      stunned.push(other.id);
    }
  }
  // A blown mine counts as found, so the field can still be finished.
  emit(state, {
    kind: 'boom',
    x,
    y,
    by: id,
    dead: player.dead,
    down: player.downMs > 0,
    livesLeft: player.livesLeft,
    stunned,
    radius: state.blast ? state.blastRadius : 0,
  });
  settle(state);
}

// Dig a tile. Returns what happened: 'safe', 'boom' or null (nothing to dig).
export function dig(state, id, x, y) {
  const player = playerOf(state, id);
  if (!canAct(state, player) || !inField(state, x, y)) return null;
  const i = index(state, x, y);
  if (state.cells[i] !== HIDDEN || state.flags[i]) return null;
  if (!state.mines) layMines(state, x, y);
  if (state.mines[i]) {
    // With Defusing on, a dug-up mine gives you the chance to defuse it instead of going off.
    if (state.defuse) {
      startDefuse(state, player, x, y);
      return 'defuse';
    }
    explode(state, player, x, y);
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
    if (n === 0)
      for (const [nx, ny] of around(state, cx, cy))
        if (state.cells[index(state, nx, ny)] === HIDDEN) stack.push([nx, ny]);
  }
  player.score += opened.length;
  player.uncovered += opened.length;
  state.safeLeft -= opened.length;
  emit(state, { kind: 'dig', x, y, by: id, count: opened.length });
  // Last-minute sprint: nearly cleared, so the clock drops to a minute (if there's more than that left).
  const safeTotal =
    (state.mask
      ? state.mask.filter(Boolean).length
      : state.width * state.height) - state.mineCount;
  if (
    state.sprint &&
    !state.sprinted &&
    state.safeLeft > 0 &&
    (safeTotal - state.safeLeft) / safeTotal >= SPRINT_AT
  ) {
    state.sprinted = true;
    if (state.timeLeft > SPRINT_MS) {
      state.timeLeft = SPRINT_MS;
      emit(state, { kind: 'sprint' });
    }
  }
  settle(state);
  return 'safe';
}

// A player has moved: stepping onto a hidden, unflagged mine sets it off if they were running
// (Risky run), or starts a defuse puzzle (with Defusing on). Returns 'boom', 'defuse' or null.
export function stepOn(state, player) {
  if (!canAct(state, player) || !state.mines) return null;
  const [x, y] = tileAt(state, player.x, player.y);
  const i = index(state, x, y);
  if (player.lastTile === i) return null;
  player.lastTile = i;
  if (!state.mines[i] || state.cells[i] !== HIDDEN || state.flags[i])
    return null;
  // Only Risky running makes stepping on a mine matter, and only while running: it goes off (or, with Defusing on,
  // the puzzle comes up). Walking over mines is always safe, and with running Off or Stamina so is running.
  if (state.run !== 'risky' || !(player.running && player.moving)) return null;
  player.running = false;
  if (state.defuse) {
    startDefuse(state, player, x, y);
    return 'defuse';
  }
  explode(state, player, x, y);
  return 'boom';
}

// Puts up a defuse puzzle for the mine at x, y. `options.type` and `options.level` override the usual (debug).
export function startDefuse(state, player, x, y, options = {}) {
  const level = options.level ?? player.defused;
  const total = defuseMs(level);
  player.moving = false;
  player.running = false;
  // The clock only starts after a short grace, so a key held from running in can't set it off.
  player.defusing = {
    x,
    y,
    ms: total + DEFUSE_GRACE_MS,
    total,
    level,
    seed: Math.floor(Math.random() * 1e9) + 1,
    type: options.type ?? null,
  };
  // Computer players "solve" it after a while, more reliably the better they are.
  if (player.bot) player.defusing.botAt = total * (0.25 + Math.random() * 0.5);
  emit(state, { kind: 'defusing', x, y, by: player.id });
}

// The end of a defuse puzzle: solved, the mine is made safe (and worth points); failed, it goes off.
export function resolveDefuse(state, id, ok) {
  const player = playerOf(state, id);
  const job = player?.defusing;
  if (!job || state.status !== 'playing') return null;
  player.defusing = null;
  // A practice puzzle from /defuse on a tile that isn't a live mine: nothing on the field changes.
  const live =
    state.mines?.[index(state, job.x, job.y)] &&
    state.cells[index(state, job.x, job.y)] === HIDDEN;
  if (!live) {
    if (!ok) player.stun = STUN_MS;
    emit(
      state,
      ok
        ? { kind: 'defused', x: job.x, y: job.y, by: id }
        : {
            kind: 'boom',
            x: job.x,
            y: job.y,
            by: id,
            dead: false,
            stunned: [],
            radius: 0,
          },
    );
    return ok ? 'defused' : 'boom';
  }
  if (!ok) {
    explode(state, player, job.x, job.y);
    return 'boom';
  }
  state.cells[index(state, job.x, job.y)] = DEFUSED;
  state.flags[index(state, job.x, job.y)] = null;
  player.defused++;
  player.score += DEFUSE_POINTS;
  emit(state, { kind: 'defused', x: job.x, y: job.y, by: id });
  settle(state);
  return 'defused';
}

// Running for one frame: decides whether `player` runs (and drains or refills stamina), returning the speed to walk at.
export function runStep(state, player, wantsRun, dt) {
  if (state.run !== 'risky' && state.run !== 'stamina') {
    player.running = false;
    return WALK_SPEED;
  }
  let running = Boolean(wantsRun);
  if (state.run === 'stamina') {
    player.stamina ??= STAMINA_MAX;
    player.rest ??= 0;
    if (player.winded && player.stamina >= STAMINA_MAX) player.winded = false;
    if (running && !player.winded) {
      player.rest = 0;
      player.stamina = Math.max(0, player.stamina - STAMINA_DRAIN * dt);
      if (player.stamina <= 0) player.winded = true;
    } else {
      running = false;
      player.rest += dt;
      if (player.rest >= STAMINA_REST)
        player.stamina = Math.min(
          STAMINA_MAX,
          player.stamina + STAMINA_REGEN * dt,
        );
    }
  }
  player.running = running;
  if (running) return RUN_SPEED;
  return player.winded ? WINDED_SPEED : WALK_SPEED;
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
  // Being down is temporary, so it doesn't end the game the way being out does.
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
  emit(state, {
    kind: 'over',
    winner: state.winner,
    cleared: state.safeLeft <= 0,
    blownUp: everyoneOut && state.safeLeft > 0,
  });
}

// Moves a player by a walking direction (each axis -1..1) for `dt` seconds.
export function walk(state, player, dx, dy, dt, speed = WALK_SPEED) {
  const length = Math.hypot(dx, dy);
  player.moving =
    length > 0.05 &&
    state.status === 'playing' &&
    player.stun <= 0 &&
    !player.dead &&
    !(player.downMs > 0) &&
    !player.defusing;
  if (!player.moving) return;
  const scale = Math.min(1, length) / length;
  player.x = Math.max(
    0.2,
    Math.min(state.width - 0.2, player.x + dx * scale * speed * dt),
  );
  player.y = Math.max(
    0.2,
    Math.min(state.height - 0.2, player.y + dy * scale * speed * dt),
  );
  player.face = Math.atan2(dx, dy);
}

// Back on your feet at the corner you started in. The field is left exactly as
// it was, so nothing is undone by dying: only the player moves.
function respawn(state, player) {
  const [x, y] = player.spawn ??
    state.spawns[player.color % state.spawns.length] ?? [1.5, 1.5];
  player.x = x;
  player.y = y;
  player.downMs = 0;
  player.stun = 0;
  player.running = false;
  player.moving = false;
  player.winded = false;
  player.stamina = STAMINA_MAX;
  player.rest = 0;
  // Otherwise the tile they land on is "the one they were already on".
  player.lastTile = null;
  emit(state, { kind: 'respawn', by: player.id, x, y });
}

// Advances timers by `ms`. Mutates `state`.
export function tick(state, ms) {
  if (state.status === 'over') return;
  for (const player of state.players)
    player.stun = Math.max(0, player.stun - ms);
  if (state.status === 'drop') {
    state.dropLeft -= ms;
    if (state.dropLeft <= 0) {
      state.status = 'playing';
      emit(state, { kind: 'start' });
    }
    return;
  }
  state.timeLeft = Math.max(0, state.timeLeft - ms);
  for (const player of state.players) {
    if (player.downMs > 0 && !player.dead && !player.left) {
      player.downMs = Math.max(0, player.downMs - ms);
      if (player.downMs === 0) respawn(state, player);
    }
  }
  for (const player of state.players) {
    const job = player.defusing;
    if (!job) continue;
    job.ms -= ms;
    if (player.bot && job.total - job.ms >= job.botAt) {
      const skill = (
        BOT_TUNING[player.botLevel] ??
        BOT_TUNING[state.botLevel] ??
        BOT_TUNING.normal
      ).defuse;
      resolveDefuse(
        state,
        player.id,
        Math.random() < Math.max(0.2, skill - job.level * 0.07),
      );
    } else if (job.ms <= 0 || player.left) {
      resolveDefuse(state, player.id, false);
    }
  }
  settle(state);
}

// What everyone may see: the field without the mines (all of them once it's over).
export function viewOf(state) {
  const over = state.status === 'over';
  return {
    width: state.width,
    height: state.height,
    mineCount: state.mineCount,
    theme: state.theme,
    cells: state.cells,
    flags: state.flags,
    mask: state.mask,
    land: state.land,
    water: state.water,
    mines: over && state.mines ? state.mines : null,
    safeLeft: state.safeLeft,
    status: state.status,
    dropLeft: state.dropLeft,
    timeLeft: state.timeLeft,
    winner: state.winner,
    events: state.events,
    stunOnly: state.stunOnly,
    blast: state.blast,
    run: state.run,
    deathMode: state.deathMode,
    lives: state.lives,
    defuse: state.defuse,
    players: state.players.map(
      ({
        id,
        name,
        bot,
        color,
        x,
        y,
        face,
        moving,
        running,
        stamina,
        winded,
        score,
        uncovered,
        booms,
        flagsRight,
        flagsWrong,
        stun,
        dead,
        downMs,
        deaths,
        livesLeft,
        left,
        defusing,
        defused,
      }) => ({
        id,
        name,
        bot,
        color,
        x,
        y,
        face,
        moving,
        running: Boolean(running),
        stamina: Math.round(stamina ?? STAMINA_MAX),
        winded: Boolean(winded),
        score,
        uncovered,
        booms,
        flagsRight,
        flagsWrong,
        stun,
        dead: Boolean(dead),
        downMs: Math.max(0, Math.round(downMs ?? 0)),
        deaths: deaths ?? 0,
        livesLeft: livesLeft ?? 0,
        left: Boolean(left),
        defused: defused ?? 0,
        defusing: defusing
          ? {
              x: defusing.x,
              y: defusing.y,
              ms: defusing.ms,
              total: defusing.total,
              level: defusing.level,
              seed: defusing.seed,
              type: defusing.type ?? null,
            }
          : null,
      }),
    ),
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
  const doubtful = new Set();
  let anyOpen = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const n = cells[at(x, y)];
      // VOID is not a number: it is a square that was cut out of the board.
      if (n === HIDDEN || n === EXPLODED || n === DEFUSED || n === VOID)
        continue;
      anyOpen = true;
      if (n === 0) continue;
      const hidden = [];
      const flaggedHere = [];
      let found = 0;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const k = at(nx, ny);
        if (cells[k] === EXPLODED || cells[k] === DEFUSED) found++;
        else if (cells[k] === HIDDEN && flags[k]) {
          found++;
          flaggedHere.push(k);
        } else if (cells[k] === HIDDEN) hidden.push(k);
      }
      // More flags around a number than it allows: one of them is wrong.
      if (found > n) flaggedHere.forEach((k) => doubtful.add(k));
      if (!hidden.length) continue;
      if (found >= n) hidden.forEach((k) => safe.add(k));
      else if (n - found === hidden.length) hidden.forEach((k) => mines.add(k));
      else
        for (const k of hidden)
          risk.set(k, Math.max(risk.get(k) ?? 0, (n - found) / hidden.length));
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
    const dd = digTarget
      ? Math.hypot(digTarget[0] - px, digTarget[1] - py)
      : Infinity;
    const fd = flagTarget
      ? Math.hypot(flagTarget[0] - px, flagTarget[1] - py)
      : Infinity;
    return dd <= fd
      ? { action: 'dig', tile: digTarget }
      : { action: 'flag', tile: flagTarget };
  }
  if (!anyOpen)
    return { action: 'dig', tile: [Math.floor(px), Math.floor(py)] };
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
  if (!hidden.length) {
    // Every hidden tile is flagged but the field isn't done, so some flags are wrong:
    // take one down (anyone's), preferring flags the numbers don't back up.
    const flagged = [];
    cells.forEach((c, k) => c === HIDDEN && flags[k] && flagged.push(k));
    const suspects = flagged.filter((k) => doubtful.has(k));
    const pick = nearest(suspects.length ? suspects : flagged);
    return pick ? { action: 'unflag', tile: pick } : null;
  }
  const k = hidden[Math.floor(Math.random() * hidden.length)];
  return { action: 'dig', tile: [k % width, Math.floor(k / width)] };
}

// An easy bot's slip-up: a hidden tile nearby, picked without thinking.
function randomDig(state, player) {
  const options = [];
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const k = index(state, x, y);
      if (
        state.cells[k] === HIDDEN &&
        !state.flags[k] &&
        Math.hypot(x + 0.5 - player.x, y + 0.5 - player.y) < 4
      )
        options.push([x, y]);
    }
  }
  return options.length
    ? {
        action: 'dig',
        tile: options[Math.floor(Math.random() * options.length)],
      }
    : botPlan(state, player);
}

// Whether a computer player sprints this frame. It only matters when the rule
// is on, and the two run modes are dangerous in different ways, so each is
// weighed on its own terms:
//
//   Stamina  running costs stamina and running dry leaves you trudging, so it
//            sprints for journeys worth the cost and keeps a reserve back.
//   Risky    running over a tile that turns out to be a mine sets it off, so it
//            only sprints where it has already uncovered the ground. A careless
//            bot chances it anyway; a hard one never does.
function botWantsRun(state, player, tx, ty, distance, tuning) {
  const how = tuning.run;
  if (state.run !== 'risky' && state.run !== 'stamina') return false;
  // Not worth breaking into a run for a tile that is already under its feet.
  if (distance < how.far) return false;

  if (state.run === 'stamina') {
    if (player.winded) return false;
    return (player.stamina ?? STAMINA_MAX) > STAMINA_MAX * how.keep;
  }

  // Risky: check the ground between here and there, a tile at a time.
  return (
    pathIsClear(state, player.x, player.y, tx, ty) || Math.random() < how.risk
  );
}

// Every tile the straight line between two points passes through is already
// uncovered, so running across it can't set anything off.
function pathIsClear(state, x0, y0, x1, y1) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
  for (let i = 0; i <= steps; i++) {
    const t = steps ? i / steps : 0;
    const x = Math.floor(x0 + (x1 - x0) * t);
    const y = Math.floor(y0 + (y1 - y0) * t);
    if (!inField(state, x, y)) continue;
    const cell = state.cells[index(state, x, y)];
    // A flagged tile is believed to be a mine, so treat it as ground to avoid.
    if (cell === HIDDEN || state.flags[index(state, x, y)]) return false;
  }
  return true;
}

// One step of a computer player: walk to its chosen tile, then dig or flag it.
// `brain` is the bot's own memory ({ plan, wait }), kept by the host.
export function botStep(state, player, brain, dt) {
  if (
    state.status !== 'playing' ||
    player.stun > 0 ||
    player.dead ||
    player.defusing
  ) {
    player.moving = false;
    return null;
  }
  brain.wait = Math.max(0, (brain.wait ?? 0) - dt * 1000);
  if (brain.wait > 0) {
    player.moving = false;
    return null;
  }
  const tuning =
    BOT_TUNING[player.botLevel] ??
    BOT_TUNING[state.botLevel] ??
    BOT_TUNING.normal;
  const [minWait, maxWait] = tuning.think;
  const plan = brain.plan;
  const stillValid =
    plan &&
    state.cells[index(state, ...plan.tile)] === HIDDEN &&
    Boolean(state.flags[index(state, ...plan.tile)]) ===
      (plan.action === 'unflag');
  if (!stillValid) {
    brain.plan =
      Math.random() < tuning.slip
        ? randomDig(state, player)
        : botPlan(state, player);
    brain.wait = minWait + Math.random() * (maxWait - minWait) * 0.7;
    return null;
  }
  const tx = plan.tile[0] + 0.5;
  const ty = plan.tile[1] + 0.5;
  const dx = tx - player.x;
  const dy = ty - player.y;
  const distance = Math.hypot(dx, dy);
  if (distance > 0.12) {
    // runStep both decides the speed and spends the stamina, exactly as it does
    // for a person holding the run key, so bots are bound by the same rule.
    const wantsRun = botWantsRun(state, player, tx, ty, distance, tuning);
    const base = runStep(state, player, wantsRun, dt);
    // The level's own pace still sets how briskly it walks; running multiplies it.
    const speed = player.running ? base : Math.min(base, tuning.speed);
    const stepLength = Math.min(distance, speed * dt);
    walk(
      state,
      player,
      dx / distance,
      dy / distance,
      stepLength / speed,
      speed,
    );
    return null;
  }
  player.moving = false;
  // Standing still is when stamina comes back, so keep the clock running.
  runStep(state, player, false, dt);
  brain.plan = null;
  brain.wait = minWait + Math.random() * (maxWait - minWait);
  return plan.action === 'flag' || plan.action === 'unflag'
    ? { action: 'flag', result: toggleFlag(state, player.id, ...plan.tile) }
    : { action: 'dig', result: dig(state, player.id, ...plan.tile) };
}
