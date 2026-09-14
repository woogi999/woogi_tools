// Snake rules, kept free of any rendering so the host of an online game can
// run them and simply send the resulting state to everyone else.

export const COUNTDOWN_TICKS = 8; // ~1s at the normal speed before snakes move
export const MAX_SNAKES = 4;
const START_LENGTH = 4;
const MAX_QUEUED_TURNS = 2;
const WANDER_CHANCE = 0.12;

export const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

const key = (state, x, y) => y * state.size + x;
const inBounds = (state, x, y) => x >= 0 && y >= 0 && x < state.size && y < state.size;

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
  if (count === 1) return [{ x: 3, y: mid, dir: 'right' }];
  return [
    { x: 3, y: mid - 3, dir: 'right' },
    { x: size - 4, y: mid + 3, dir: 'left' },
    { x: mid + 3, y: 3, dir: 'down' },
    { x: mid - 3, y: size - 4, dir: 'up' },
  ];
}

// players: [{ id, name, bot }], up to four. One player is classic snake; more is a battle.
// options: { size, apples, wrap }
export function createGame(players, { size = 20, apples = 1, wrap = false } = {}) {
  const starts = startsFor(players.length, size);
  const state = {
    size,
    wrap,
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
        body: Array.from({ length: START_LENGTH }, (_, n) => [x - dx * n, y - dy * n]),
      };
    }),
    apples: [],
  };
  for (let i = 0; i < state.appleCount; i++) spawnApple(state);
  return state;
}

export function queueTurn(state, id, dir) {
  const snake = state.snakes.find((s) => s.id === id);
  if (!snake?.alive || !DIRS[dir]) return;
  const last = snake.queue[snake.queue.length - 1] ?? snake.dir;
  if (dir === last || dir === OPPOSITE[last] || snake.queue.length >= MAX_QUEUED_TURNS) return;
  snake.queue.push(dir);
}

// A player who left mid-game: their snake stops for good.
export function removeSnake(state, id) {
  const snake = state.snakes.find((s) => s.id === id);
  if (snake) snake.alive = false;
  settle(state);
}

function occupied(state) {
  const cells = new Set();
  for (const snake of state.snakes) if (snake.alive) for (const [x, y] of snake.body) cells.add(key(state, x, y));
  return cells;
}

function spawnApple(state) {
  const taken = occupied(state);
  for (const [x, y] of state.apples) taken.add(key(state, x, y));
  const free = [];
  for (let y = 0; y < state.size; y++) for (let x = 0; x < state.size; x++) if (!taken.has(key(state, x, y))) free.push([x, y]);
  if (free.length) state.apples.push(free[Math.floor(Math.random() * free.length)]);
}

function settle(state) {
  const alive = state.snakes.filter((s) => s.alive);
  if (state.snakes.length === 1 ? alive.length === 0 : alive.length <= 1) {
    state.status = 'over';
    state.winner = state.snakes.length > 1 && alive.length === 1 ? alive[0].id : null;
  }
}

// Advances the game one tick. Mutates and returns `state`.
export function step(state) {
  if (state.status === 'over') return state;
  state.tick++;
  if (state.status === 'countdown') {
    if (--state.countdown <= 0) state.status = 'playing';
    return state;
  }

  const living = state.snakes.filter((s) => s.alive);
  for (const snake of living) {
    if (snake.bot) snake.queue = [botDirection(state, snake)];
    if (snake.queue.length) snake.dir = snake.queue.shift();
  }

  // Move every head first, then settle collisions against the new positions.
  const moves = living.map((snake) => {
    const [hx, hy] = snake.body[0];
    const head = stepFrom(state, hx, hy, DIRS[snake.dir]);
    const appleIndex = state.apples.findIndex(([ax, ay]) => ax === head[0] && ay === head[1]);
    return { snake, head, eats: appleIndex !== -1, appleIndex };
  });

  for (const move of moves) {
    move.snake.body.unshift(move.head);
    if (!move.eats) move.snake.body.pop();
  }

  const bodies = new Map(); // cell -> how many body segments (not heads) sit there
  for (const { snake } of moves) {
    for (let i = 1; i < snake.body.length; i++) {
      const k = key(state, ...snake.body[i]);
      bodies.set(k, (bodies.get(k) ?? 0) + 1);
    }
  }
  const heads = new Map();
  for (const { head } of moves) heads.set(key(state, ...head), (heads.get(key(state, ...head)) ?? 0) + 1);

  const dead = moves.filter(({ head }) => !inBounds(state, ...head) || bodies.has(key(state, ...head)) || heads.get(key(state, ...head)) > 1);
  for (const { snake } of dead) snake.alive = false;

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

// Cells that will be blocked next tick: every body segment except tails that are about to move on.
function blockedCells(state) {
  const cells = new Set();
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

// Heads toward the nearest apple by breadth-first search, but never into a
// pocket smaller than its own body; if no safe path exists, it takes the move
// with the most room to survive in. It also shies away from squares another
// snake's head could reach next tick.
export function botDirection(state, snake) {
  const blocked = blockedCells(state);
  const [hx, hy] = snake.body[0];
  const danger = new Set();
  for (const other of state.snakes) {
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

  if (!options.length) return snake.dir;
  const safe = options.filter((o) => o.room > snake.body.length && !o.risky);
  const calm = options.filter((o) => !o.risky);
  const pool = safe.length ? safe : calm.length ? calm : options;
  // Now and then it wanders instead of beelining for food, so it can be beaten.
  if (safe.length && Math.random() < WANDER_CHANCE) return safe[Math.floor(Math.random() * safe.length)].dir;

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
  for (const option of pool) {
    const d = distance(option.x, option.y);
    // Closer to food is better; plenty of room breaks ties and rescues dead ends.
    const score = (d === Infinity ? -1000 : -d * 10) + Math.min(option.room, snake.body.length * 2) + (option.dir === snake.dir ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = option;
    }
  }
  return best.dir;
}
