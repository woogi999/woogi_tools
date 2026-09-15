// Snake rules, kept free of any rendering so the host of an online game can
// run them and simply send the resulting state to everyone else.
//
// The game runs in small ticks, and every snake builds up progress towards its
// next square at its own speed: an ordinary snake moves every SUBSTEPS ticks,
// a boosting one twice as often, and (with the rule on) longer snakes a little
// faster still.

export const SUBSTEPS = 3; // ticks per square for an ordinary snake
export const COUNTDOWN_TICKS = 27; // ~1s at the normal speed before snakes move (shown as 3, 2, 1)
export const MAX_SNAKES = 4;
// Each snake's colour, by seat (shared by the 3D scene and the score chips).
export const SNAKE_COLORS = ['#7ed957', '#ff6b81', '#4d8ff0', '#b98af0'];
export const BOOST_TICKS = 18; // ticks at boost speed: nine squares' worth
const BOOST_SPEED = 1.5;
const LENGTH_STEP = 0.025; // speed change per segment past the starting length
const MAX_LENGTH_FASTER = 0.5;
const MAX_LENGTH_SLOWER = 0.4;
// A turn you've pressed goes through once the snake is this far into its next square, rather than waiting for all of it.
const EARLY_TURN = 0.5;
// Coyote time: about to crash, a player's snake hangs on for a moment (in ticks at the ordinary speed,
// fewer the faster it's going) so a last-moment turn can still save it.
const COYOTE_TICKS = 2;
// How length changes speed: longer snakes go 'faster', 'slower', or length doesn't matter ('off').
export const LENGTH_SPEEDS = ['faster', 'off', 'slower'];
export const MIN_BOOST_LENGTH = 3; // boosting costs a segment, and a snake can't go below 2
const START_LENGTH = 4;
const MAX_QUEUED_TURNS = 2;
export const BOT_LEVELS = [
  { id: 'easy', label: 'Easy' },
  { id: 'normal', label: 'Normal' },
  { id: 'hard', label: 'Hard' },
];
// wander: chance of ignoring food; blunder: chance of a random (possibly deadly) move; boost: chance to boost when it's a good moment.
const BOT_TUNING = {
  easy: { wander: 0.3, blunder: 0.025, boost: 0, dodge: false },
  normal: { wander: 0.12, blunder: 0, boost: 0.06, dodge: true },
  hard: { wander: 0.02, blunder: 0, boost: 0.18, dodge: true },
};

export const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

// Maps: where the obstacles are. Kinds are 'rock', 'palm' and 'water'.
export const MAPS = [
  { id: 'meadow', label: 'Meadow', hint: 'An open grassy island.' },
  { id: 'palms', label: 'Palm Beach', hint: 'Sand, with palm trees and rocks in the way.' },
  { id: 'lagoon', label: 'Lagoon', hint: 'A pond in the middle to slither around.' },
  { id: 'reef', label: 'Reef', hint: 'Channels of sea split the island, with gaps to cross.' },
];

const key = (state, x, y) => y * state.size + x;
const inBounds = (state, x, y) => x >= 0 && y >= 0 && x < state.size && y < state.size;

// A tiny seeded random, so a map looks the same every game on every device.
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

function mapObstacles(map, size) {
  const cells = [];
  const mid = (size - 1) / 2;
  if (map === 'palms') {
    const rand = seeded(size * 31 + 7);
    // Plenty, since the lanes in front of each starting snake get cleared afterwards.
    const count = Math.round(size * 1.1);
    const taken = new Set();
    for (let i = 0; i < count * 3 && cells.length < count; i++) {
      const x = 1 + Math.floor(rand() * (size - 2));
      const y = 1 + Math.floor(rand() * (size - 2));
      if (taken.has(`${x},${y}`)) continue;
      taken.add(`${x},${y}`);
      cells.push([x, y, rand() < 0.55 ? 'palm' : 'rock']);
    }
  } else if (map === 'lagoon') {
    const r = size * 0.17;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const d = Math.hypot((x - mid) / 1.25, y - mid);
      if (d < r) cells.push([x, y, 'water']);
      else if (d < r + 0.9 && (x + y) % 5 === 0) cells.push([x, y, 'rock']);
    }
  } else if (map === 'reef') {
    const gap = Math.max(2, Math.round(size / 8));
    const a = Math.round(size / 3);
    const b = size - 1 - a;
    for (let i = 0; i < size; i++) {
      const open = Math.abs(i - mid) < gap / 2 + 0.5 || i < 2 || i > size - 3;
      if (!open) {
        cells.push([a, i, 'water'], [b, i, 'water']);
      }
    }
    for (let i = a + 2; i < b - 1; i++) if (Math.abs(i - mid) > gap) cells.push([i, Math.round(mid), 'water']);
  }
  return cells;
}

// Where the next cell is: off the edge is out of bounds, or wraps round with no walls.
function stepFrom(state, x, y, [dx, dy]) {
  const nx = x + dx;
  const ny = y + dy;
  if (!state.wrap) return [nx, ny];
  const n = state.size;
  return [(nx + n) % n, (ny + n) % n];
}

// Each snake starts near its own edge, heading inwards.
function startsFor(count, size) {
  const mid = Math.floor(size / 2);
  if (count === 1) return [{ x: 3, y: mid - 1, dir: 'right' }];
  return [
    { x: 3, y: mid - 3, dir: 'right' },
    { x: size - 4, y: mid + 3, dir: 'left' },
    { x: mid + 3, y: 3, dir: 'down' },
    { x: mid - 3, y: size - 4, dir: 'up' },
  ];
}

// players: [{ id, name, bot }], up to four. One player is classic snake; more is a battle.
// options: { size, apples, wrap, map, lengthSpeed ('faster' | 'off' | 'slower') }
export function createGame(players, { size = 20, apples = 1, wrap = false, map = 'meadow', lengthSpeed = 'faster', botLevel = 'normal' } = {}) {
  const starts = startsFor(players.length, size);
  // No obstacle on or just ahead of a starting snake.
  const clear = new Set();
  for (const { x, y, dir } of starts.slice(0, players.length)) {
    const [dx, dy] = DIRS[dir];
    for (let n = -START_LENGTH; n <= 6; n++) for (let s = -1; s <= 1; s++) clear.add(`${x + dx * n + dy * s},${y + dy * n + dx * s}`);
  }
  const state = {
    size,
    wrap,
    // Older saved rules were on/off: on meant faster.
    lengthSpeed: LENGTH_SPEEDS.includes(lengthSpeed) ? lengthSpeed : lengthSpeed === false ? 'off' : 'faster',
    changed: true,
    botLevel: BOT_TUNING[botLevel] ? botLevel : 'normal',
    map: MAPS.some((m) => m.id === map) ? map : 'meadow',
    obstacles: [],
    appleCount: Math.max(apples, players.length === 1 ? 1 : 0),
    tick: 0,
    status: 'countdown', // 'countdown' | 'playing' | 'over'
    countdown: COUNTDOWN_TICKS,
    winner: null, // a player id, or null for a draw (or the end of a solo game)
    snakes: players.map((player, i) => {
      const { x, y, dir } = starts[i];
      const [dx, dy] = DIRS[dir];
      return {
        id: player.id,
        name: player.name,
        bot: Boolean(player.bot),
        color: i,
        dir,
        queue: [],
        alive: true,
        score: 0,
        boost: 0,
        progress: 0,
        coyote: 0,
        boosts: 0, // how many times it has boosted, so every screen can react to a new one
        body: Array.from({ length: START_LENGTH }, (_, n) => [x - dx * n, y - dy * n]),
      };
    }),
    apples: [],
  };
  state.obstacles = mapObstacles(state.map, size).filter(([x, y]) => !clear.has(`${x},${y}`));
  for (let i = 0; i < state.appleCount; i++) spawnApple(state);
  return state;
}

export function queueTurn(state, id, dir) {
  const snake = state.snakes.find((s) => s.id === id);
  if (!snake?.alive || !DIRS[dir]) return;
  state.changed = true;
  const last = snake.queue[snake.queue.length - 1] ?? snake.dir;
  if (dir === last || dir === OPPOSITE[last] || snake.queue.length >= MAX_QUEUED_TURNS) return;
  snake.queue.push(dir);
}

// Sacrifice the tail for a burst of speed. Returns whether it worked.
export function boost(state, id) {
  const snake = state.snakes.find((s) => s.id === id);
  if (!snake?.alive || state.status !== 'playing' || snake.boost > 0 || snake.body.length < MIN_BOOST_LENGTH) return false;
  snake.body.pop();
  snake.boost = BOOST_TICKS;
  snake.boosts++;
  return true;
}

// A player who left mid-game: their snake stops for good.
export function removeSnake(state, id) {
  const snake = state.snakes.find((s) => s.id === id);
  if (snake) snake.alive = false;
  settle(state);
}

function obstacleSet(state) {
  return new Set(state.obstacles.map(([x, y]) => key(state, x, y)));
}

function spawnApple(state) {
  const taken = obstacleSet(state);
  for (const snake of state.snakes) if (snake.alive) for (const [x, y] of snake.body) taken.add(key(state, x, y));
  for (const [x, y] of state.apples) taken.add(key(state, x, y));
  const free = [];
  for (let y = 0; y < state.size; y++) for (let x = 0; x < state.size; x++) if (!taken.has(key(state, x, y))) free.push([x, y]);
  if (free.length) state.apples.push(free[Math.floor(Math.random() * free.length)]);
}

// The highest score wins, not the last snake alive: the survivor keeps going
// until it overtakes the leader (and wins) or crashes too.
export function leader(state) {
  const top = Math.max(...state.snakes.map((s) => s.score));
  const leaders = state.snakes.filter((s) => s.score === top);
  return leaders.length === 1 ? leaders[0] : null;
}

function settle(state) {
  if (state.status === 'over') return;
  const alive = state.snakes.filter((s) => s.alive);
  if (state.snakes.length === 1) {
    if (!alive.length) state.status = 'over';
    return;
  }
  if (!alive.length) {
    state.status = 'over';
    state.winner = leader(state)?.id ?? null;
  } else if (alive.length === 1) {
    const survivor = alive[0];
    const bestOther = Math.max(...state.snakes.filter((s) => s !== survivor).map((s) => s.score));
    if (survivor.score > bestOther) {
      state.status = 'over';
      state.winner = survivor.id;
    }
  }
}

// Squares a snake covers per tick (at most 1).
export function speedOf(state, snake) {
  let rate = 1 / SUBSTEPS;
  const grown = Math.max(0, snake.body.length - START_LENGTH) * LENGTH_STEP;
  if (state.lengthSpeed === 'faster' || state.lengthSpeed === true) rate *= 1 + Math.min(MAX_LENGTH_FASTER, grown);
  else if (state.lengthSpeed === 'slower') rate *= 1 - Math.min(MAX_LENGTH_SLOWER, grown);
  if (snake.boost > 0) rate *= BOOST_SPEED;
  return Math.min(1, rate);
}

// Advances the game one tick. Mutates and returns `state`; `state.changed` says whether anything visible happened.
export function step(state) {
  if (state.status === 'over') return state;
  state.tick++;
  state.changed = false;
  if (state.status === 'countdown') {
    if (--state.countdown <= 0) state.status = 'playing';
    state.changed = true;
    return state;
  }

  const blocked = obstacleSet(state);
  const living = state.snakes.filter((s) => s.alive);
  const candidates = living.filter((s) => {
    s.progress = (s.progress ?? 0) + speedOf(state, s);
    // A waiting turn moves a little early; the square after it comes that much later, so it's never faster overall.
    const needed = !s.bot && s.queue.length && s.queue[0] !== s.dir ? EARLY_TURN : 1;
    return s.progress >= needed;
  });
  for (const snake of candidates) {
    if (snake.bot) {
      const plan = botPlan(state, snake);
      snake.queue = [plan.dir];
      if (plan.boost) boost(state, snake.id);
    }
    if (snake.queue.length) snake.dir = snake.queue.shift();
  }

  // Coyote time: squares that are certain death (edges, obstacles, bodies that won't move out of the way).
  const solid = new Set(blocked);
  for (const snake of living) for (let i = 0; i < snake.body.length - 1; i++) solid.add(key(state, ...snake.body[i]));
  const movers = candidates.filter((snake) => {
    if (!snake.bot) {
      const [hx, hy] = snake.body[0];
      const [nx, ny] = stepFrom(state, hx, hy, DIRS[snake.dir]);
      const doomed = !inBounds(state, nx, ny) || solid.has(key(state, nx, ny));
      const grace = Math.max(1, Math.round((COYOTE_TICKS * (1 / SUBSTEPS)) / speedOf(state, snake)));
      if (doomed && snake.coyote < grace) {
        snake.coyote++;
        // Held right at the edge of the square, ready to go the moment it turns.
        snake.progress = Math.max(snake.progress, 1);
        return false;
      }
    }
    snake.coyote = 0;
    snake.progress -= 1;
    return true;
  });
  state.changed = movers.length > 0;
  for (const snake of living) if (snake.boost > 0) snake.boost--;

  // Move every head first, then settle collisions against the new positions.
  const moves = movers.map((snake) => {
    const [hx, hy] = snake.body[0];
    const head = stepFrom(state, hx, hy, DIRS[snake.dir]);
    const appleIndex = state.apples.findIndex(([ax, ay]) => ax === head[0] && ay === head[1]);
    return { snake, head, eats: appleIndex !== -1, appleIndex };
  });

  for (const move of moves) {
    move.snake.body.unshift(move.head);
    if (!move.eats) move.snake.body.pop();
  }

  // Every segment on the board, except the heads that just moved (those are checked against it).
  const moved = new Set(movers);
  const bodies = new Set();
  for (const snake of living) {
    for (let i = moved.has(snake) ? 1 : 0; i < snake.body.length; i++) bodies.add(key(state, ...snake.body[i]));
  }
  const heads = new Map();
  for (const { head } of moves) heads.set(key(state, ...head), (heads.get(key(state, ...head)) ?? 0) + 1);

  const dead = moves.filter(({ head }) => {
    const k = key(state, ...head);
    return !inBounds(state, ...head) || blocked.has(k) || bodies.has(k) || heads.get(k) > 1;
  });
  for (const { snake } of dead) {
    snake.alive = false;
    snake.boost = 0;
  }

  const eaten = moves.filter((m) => m.eats && m.snake.alive).map((m) => m.appleIndex);
  for (const move of moves) if (move.eats && move.snake.alive) move.snake.score++;
  state.apples = state.apples.filter((_, i) => !eaten.includes(i));
  while (state.apples.length < state.appleCount && state.apples.length < state.size * state.size) {
    const before = state.apples.length;
    spawnApple(state);
    if (state.apples.length === before) break;
  }

  settle(state);
  return state;
}

// ─── Computer player ───────────────────────────────────────────────────

// Cells that will be blocked next move: obstacles and every body segment except tails that are about to move on.
function blockedCells(state) {
  const cells = obstacleSet(state);
  for (const snake of state.snakes) {
    if (!snake.alive) continue;
    for (let i = 0; i < snake.body.length - 1; i++) cells.add(key(state, ...snake.body[i]));
  }
  return cells;
}

function neighbours(state, x, y) {
  return Object.values(DIRS)
    .map((d) => stepFrom(state, x, y, d))
    .filter(([nx, ny]) => inBounds(state, nx, ny));
}

function floodSize(state, blocked, sx, sy, limit) {
  const seen = new Set([key(state, sx, sy)]);
  const stack = [[sx, sy]];
  while (stack.length && seen.size < limit) {
    const [x, y] = stack.pop();
    for (const [nx, ny] of neighbours(state, x, y)) {
      const k = key(state, nx, ny);
      if (!blocked.has(k) && !seen.has(k)) {
        seen.add(k);
        stack.push([nx, ny]);
      }
    }
  }
  return seen.size;
}

export const botDirection = (state, snake) => botPlan(state, snake).dir;

// Heads toward the nearest apple by breadth-first search, but never into a
// pocket smaller than its own body; if no safe path exists, it takes the move
// with the most room to survive in. It also shies away from squares another
// snake's head could reach next move, and boosts now and then when an apple is
// close and it's long enough to spare a segment.
function botPlan(state, snake) {
  const tuning = BOT_TUNING[state.botLevel] ?? BOT_TUNING.normal;
  const blocked = blockedCells(state);
  const [hx, hy] = snake.body[0];
  if (Math.random() < tuning.blunder) {
    const dirs = Object.keys(DIRS).filter((d) => d !== OPPOSITE[snake.dir]);
    return { dir: dirs[Math.floor(Math.random() * dirs.length)], boost: false };
  }
  const danger = new Set();
  for (const other of tuning.dodge ? state.snakes : []) {
    if (other === snake || !other.alive) continue;
    const [ox, oy] = other.body[0];
    for (const [nx, ny] of neighbours(state, ox, oy)) danger.add(key(state, nx, ny));
  }

  const options = Object.entries(DIRS)
    .filter(([dir]) => dir !== OPPOSITE[snake.dir])
    .map(([dir, d]) => {
      const [x, y] = stepFrom(state, hx, hy, d);
      return { dir, x, y };
    })
    .filter(({ x, y }) => inBounds(state, x, y) && !blocked.has(key(state, x, y)))
    .map((option) => ({ ...option, room: floodSize(state, blocked, option.x, option.y, snake.body.length * 2 + 4), risky: danger.has(key(state, option.x, option.y)) }));

  if (!options.length) return { dir: snake.dir, boost: false };
  const safe = options.filter((o) => o.room > snake.body.length && !o.risky);
  const calm = options.filter((o) => !o.risky);
  const pool = safe.length ? safe : calm.length ? calm : options;
  // Now and then it wanders instead of beelining for food, so it can be beaten.
  if (safe.length && Math.random() < tuning.wander) return { dir: safe[Math.floor(Math.random() * safe.length)].dir, boost: false };

  // Breadth-first from each candidate's cell to the nearest apple.
  const apples = new Set(state.apples.map(([x, y]) => key(state, x, y)));
  const distance = (sx, sy) => {
    const seen = new Set([key(state, sx, sy), key(state, hx, hy)]);
    let frontier = [[sx, sy]];
    for (let d = 0; frontier.length; d++) {
      const next = [];
      for (const [x, y] of frontier) {
        if (apples.has(key(state, x, y))) return d;
        for (const [nx, ny] of neighbours(state, x, y)) {
          const k = key(state, nx, ny);
          if (!blocked.has(k) && !seen.has(k)) {
            seen.add(k);
            next.push([nx, ny]);
          }
        }
      }
      frontier = next;
    }
    return Infinity;
  };

  let best = pool[0];
  let bestScore = -Infinity;
  let bestDistance = Infinity;
  for (const option of pool) {
    const d = distance(option.x, option.y);
    // Closer to food is better; plenty of room breaks ties and rescues dead ends.
    const score = (d === Infinity ? -1000 : -d * 10) + Math.min(option.room, snake.body.length * 2) + (option.dir === snake.dir ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = option;
      bestDistance = d;
    }
  }
  const wantsBoost = safe.includes(best) && snake.body.length > 6 && bestDistance >= 2 && bestDistance <= 6 && state.snakes.length > 1 && Math.random() < tuning.boost;
  return { dir: best.dir, boost: wantsBoost };
}
