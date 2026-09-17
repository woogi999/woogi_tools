import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';
import Joystick from './joystick';
import GameLobby, { ReadyButton } from './game-lobby';
import LevelEditor from './level-editor';
import GameChat from './game-chat';
import { askConfirm } from '../utils/confirm';
import { listenForActions, onScreen, openChat } from '../utils/game-input';
import { CommandError } from '../utils/debug-commands';
import GameRoom from '../utils/game-room';
import { roomCodeFromUrl } from '../utils/file-share';
import { botNames, newBotSeed } from '../utils/bot-names';
import { BotChatter } from '../utils/bot-chat';
import { robotAvatar } from '../utils/avatar';
import ArcadeRadar from './arcade-radar';
import {
  MAX_SNAKES,
  SNAKE_COLORS,
  MAPS,
  MIN_BOOST_LENGTH,
  COUNTDOWN_TICKS,
  SUBSTEPS,
  BOT_LEVELS,
  createGame,
  step,
  queueTurn,
  removeSnake,
  boost,
  leader,
} from '../utils/snake';
import { sfx, preloadSounds } from '../utils/sound';
import { controlHints } from '../utils/keybinds';
import { padState } from '../utils/gamepad';
import HoldConfirm from './hold-confirm';
import noImageSave from '../utils/no-image-save';
import GameSettings from './game-settings';
import {
  listLevels,
  findLevel,
  snakeObstacles,
  snakeShapes,
} from '../utils/levels';

// Milliseconds per square for an ordinary snake at its starting length; the game ticks SUBSTEPS times as often.
const SPEEDS = [
  { id: 'slow', label: 'Slow', ms: 210 },
  { id: 'normal', label: 'Normal', ms: 160 },
  { id: 'fast', label: 'Fast', ms: 115 },
];
const LENGTH_OPTIONS = [
  { id: 'faster', label: 'Faster' },
  { id: 'off', label: 'No change' },
  { id: 'slower', label: 'Slower' },
];
const SIZES = [
  { id: 16, label: 'Small' },
  { id: 20, label: 'Normal' },
  { id: 28, label: 'Large' },
];
const APPLES = [
  { id: 1, label: '1' },
  { id: 3, label: '3' },
  { id: 5, label: '5' },
];
const WALLS = [
  { id: false, label: 'Fenced in' },
  { id: true, label: 'Wrap around' },
];
const DEFAULTS = {
  speed: 'normal',
  size: 20,
  apples: 3,
  wrap: false,
  bots: 1,
  map: 'meadow',
  lengthSpeed: 'faster',
  botLevel: 'normal',
};
const SWIPE_PX = 18;
const STICK_DEAD = 0.35;
const BEST_KEY = 'woogi-snake-best';
const COUNT_EVERY = Math.ceil(COUNTDOWN_TICKS / 3);

const eq = (a, b) => a === b;

function readBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

export default class SnakePage extends Component {
  speeds = SPEEDS;
  sizes = SIZES;
  appleCounts = APPLES;
  walls = WALLS;
  maps = MAPS;
  lengthOptions = LENGTH_OPTIONS;
  botLevels = BOT_LEVELS;

  // 'lobby' | 'playing'
  @tracked mode = 'lobby';
  // A fresh copy after every step, so the template re-renders scores and status.
  @tracked game = null;
  @tracked paused = false;
  @tracked best = readBest();
  @tracked sceneFailed = false;
  // The snake a spectator has chosen to follow, or null for whoever is first.
  @tracked spectateId = null;

  // The live, mutable game on this device (the host's, online).
  state = null;
  timer = null;
  canvas = null;
  scene = null;
  // Everyone's avatar for this game, by snake id.
  avatars = new Map();

  room = new GameRoom('snake', {
    maxPlayers: MAX_SNAKES,
    settings: { ...DEFAULTS, botSeed: newBotSeed() },
    onMessage: (message, from) => this.onlineMessage(message, from),
    onGuestLeft: (id) => this.state && removeSnake(this.state, id),
    onClosed: () => this.backToLobby(),
  });

  constructor(owner, args) {
    super(owner, args);
    preloadSounds('snake');
    const code = roomCodeFromUrl();
    if (code) this.room.join(code);
    this.room.setDebugTools(this.debugTools());
    const stopInput = listenForActions('snake', {
      // Minimised to a pill: the snake keeps going, but the keys belong to the page again.
      active: () => this.mode === 'playing' && onScreen(this.canvas),
      onAction: (action, info) => this.onAction(action, info),
    });
    registerDestructor(this, () => {
      stopInput();
      this.stopTimer();
      this.chatter.dispose();
      this.room.close();
    });
  }

  get settings() {
    return this.room.settings;
  }

  get myId() {
    return this.room.selfId;
  }

  // One tick: an ordinary snake moves every SUBSTEPS of them, faster ones sooner.
  get tickMs() {
    return (
      (SPEEDS.find((s) => s.id === this.settings.speed) ?? SPEEDS[1]).ms /
      SUBSTEPS
    );
  }

  // The key reminders in the corner: keyboard keys, or controller buttons once a controller's in use (touch screens hide it).
  get controls() {
    return controlHints('snake', [
      { label: 'Steer', actions: ['up', 'left', 'down', 'right'] },
      { label: 'Boost', actions: ['boost'] },
      { label: 'Pause', actions: ['pause'] },
      { label: 'Chat', actions: ['chat'] },
    ]);
  }

  get padActive() {
    return padState.active;
  }

  get iAmBoosting() {
    return Boolean(this.me?.alive && this.me.boost > 0);
  }

  get isHostSide() {
    return this.room.isHost;
  }

  // Humans first, then as many computer snakes as fit.
  get seats() {
    // Spectators are in the room but take no seat.
    const humans = this.room.players.map((m) => ({ ...m, kind: 'human' }));
    const bots = Math.max(
      0,
      Math.min(this.settings.bots, MAX_SNAKES - humans.length),
    );
    const names = botNames(this.settings.botSeed, bots);
    return [
      ...humans,
      ...names.map((name, i) => ({
        id: `bot-${i + 1}`,
        name,
        kind: 'bot',
        avatar: robotAvatar(this.settings.botSeed, i),
      })),
    ];
  }

  // ─── Watching ──────────────────────────────────────────────────────
  // A spectator chose in the lobby to watch rather than play, so they never got
  // a snake. Someone whose snake has died is in the same position for the rest
  // of the round, so both ride the camera behind whoever they pick.

  get iAmSpectator() {
    return this.room.iAmSpectating;
  }

  get iAmOut() {
    return (
      (this.iAmSpectator || this.me?.alive === false) &&
      this.game?.status === 'playing'
    );
  }

  get watchable() {
    return (this.game?.snakes ?? []).filter(
      (s) => s.id !== this.myId && s.alive,
    );
  }

  get watchId() {
    if (!this.iAmOut) return null;
    const list = this.watchable;
    if (!list.length) return null;
    return list.some((s) => s.id === this.spectateId)
      ? this.spectateId
      : list[0].id;
  }

  get watching() {
    return this.game?.snakes.find((s) => s.id === this.watchId) ?? null;
  }

  get spectateLabel() {
    return this.iAmSpectator ? 'Watching' : "You're out. Watching";
  }

  spectateStep = (step) => {
    const list = this.watchable;
    if (!list.length) return;
    const at = Math.max(
      0,
      list.findIndex((s) => s.id === this.watchId),
    );
    this.spectateId = list[(at + step + list.length) % list.length].id;
    sfx('ui.click');
  };

  spectateNext = () => this.spectateStep(1);
  spectatePrev = () => this.spectateStep(-1);

  get isSolo() {
    return this.game?.snakes.length === 1;
  }

  // Pausing is only fair when no one else is playing from another device.
  get canPause() {
    return (
      this.isHostSide &&
      !this.game?.snakes.some((s) => !s.bot && s.id !== this.myId)
    );
  }

  get me() {
    return this.game?.snakes.find((s) => s.id === this.myId) ?? null;
  }

  get canBoost() {
    const me = this.me;
    return Boolean(
      me?.alive &&
      this.game.status === 'playing' &&
      !me.boost &&
      me.body.length >= MIN_BOOST_LENGTH,
    );
  }

  get scores() {
    const top = this.game ? leader(this.game) : null;
    return [...(this.game?.snakes ?? [])]
      .sort((a, b) => b.score - a.score)
      .map((snake) => ({
        id: snake.id,
        name: snake.id === this.myId ? 'You' : snake.name,
        score: snake.score,
        alive: snake.alive,
        mine: snake.id === this.myId,
        leading: !this.isSolo && top?.id === snake.id,
        swatch: htmlSafe(
          `background: ${SNAKE_COLORS[snake.color % SNAKE_COLORS.length]}`,
        ),
      }));
  }

  get countdown() {
    const game = this.game;
    return game?.status === 'countdown'
      ? Math.ceil(game.countdown / COUNT_EVERY)
      : null;
  }

  // As a one-item list, so each new number is a new element and its pop animation replays.
  get countdownDigits() {
    return this.countdown ? [this.countdown] : [];
  }

  get status() {
    const game = this.game;
    if (!game) return '';
    if (game.status === 'countdown')
      return this.isSolo ? 'Get ready…' : 'Get ready… Highest score wins.';
    if (this.paused) return 'Paused.';
    if (game.status === 'playing') {
      if (this.isSolo)
        return 'Eat the apples. Don’t crash. Boost to go faster, at the cost of your tail.';
      const alive = game.snakes.filter((s) => s.alive);
      if (alive.length === 1) {
        const survivor = alive[0];
        const need =
          Math.max(
            ...game.snakes.filter((s) => s !== survivor).map((s) => s.score),
          ) +
          1 -
          survivor.score;
        const who =
          survivor.id === this.myId ? 'You’re' : `${survivor.name} is`;
        return `${who} the last one slithering: ${need} more ${need === 1 ? 'apple' : 'apples'} to take the win.`;
      }
      return 'Highest score wins. Staying alive only helps if you can overtake the leader.';
    }
    if (this.isSolo) return `Game over. You scored ${game.snakes[0].score}.`;
    if (game.winner === null) return 'A tie for the top score. It’s a draw.';
    const winner = game.snakes.find((s) => s.id === game.winner);
    if (game.winner === this.myId) return `You win with ${winner.score}!`;
    return `${winner?.name ?? 'Someone'} wins with ${winner?.score ?? 0}.`;
  }

  get isOver() {
    return this.game?.status === 'over';
  }

  // Picture-in-picture: leaving the page mid-game floats it, and closing it asks first.
  getScene = () => this.scene;

  // The whole island in miniature: sea-coloured obstacles, apples, and every snake (yours outlined).
  drawMap = (ctx, size) => {
    const game = this.game;
    if (!game) return;
    const cell = size / game.size;
    const sq = Math.ceil(cell);
    ctx.fillStyle = game.map === 'palms' ? '#e9d5a0' : '#8fd16a';
    ctx.fillRect(0, 0, size, size);
    const OBSTACLE = { water: '#4da6e0', rock: '#8a8a8a', palm: '#2f7d32' };
    for (const [x, y, kind] of game.obstacles) {
      ctx.fillStyle = OBSTACLE[kind] ?? '#8a8a8a';
      ctx.fillRect(x * cell, y * cell, sq, sq);
    }
    ctx.fillStyle = '#e5484d';
    for (const [x, y] of game.apples) {
      ctx.beginPath();
      ctx.arc(
        (x + 0.5) * cell,
        (y + 0.5) * cell,
        Math.max(1.5, cell * 0.45),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    for (const snake of game.snakes) {
      if (!snake.alive) continue;
      ctx.fillStyle = SNAKE_COLORS[snake.color % SNAKE_COLORS.length];
      for (const [x, y] of snake.body) ctx.fillRect(x * cell, y * cell, sq, sq);
      const [hx, hy] = snake.body[0];
      ctx.lineWidth = Math.max(1.5, cell * 0.25);
      ctx.strokeStyle = snake.id === this.myId ? '#ffffff' : '#141414';
      ctx.strokeRect(hx * cell, hy * cell, sq, sq);
    }
  };

  get busy() {
    return (this.mode === 'playing' && !this.isOver) || this.room.isOnline;
  }

  get closeWarning() {
    if (this.room.isOnline)
      return this.room.isHost
        ? 'Close Snake? You’re hosting, so this ends the game and closes the room for everyone.'
        : 'Close Snake? You’ll be disconnected from the game.';
    return 'Close Snake? The game in progress will be lost.';
  }

  // ─── Loop ────────────────────────────────────────────────────────────

  chatter = new BotChatter(this.room);

  start = () => {
    const seats = this.seats;
    const players = seats.map((seat) => ({
      id: seat.id,
      name: seat.name,
      bot: seat.kind === 'bot',
      botLevel: seat.kind === 'bot' ? this.levelForSeat(seat.id) : null,
    }));
    const { apples, wrap, map, lengthSpeed, botLevel } = this.settings;
    // A custom level brings its own size with it, so it wins over the slider.
    const level = this.customLevel;
    const size = level ? level.width : this.settings.size;
    const shapes = level ? snakeShapes(level, size) : null;
    this.state = createGame(players, {
      size,
      apples,
      wrap,
      map,
      lengthSpeed,
      botLevel,
      custom: level ? snakeObstacles(level) : null,
      mask: shapes?.mask ?? null,
      land: shapes?.land ?? null,
      water: shapes?.water ?? null,
    });
    this.mode = 'playing';
    this.paused = false;
    this.room.setLocked(true);
    // A rematch needs everyone to press Ready again.
    this.room.resetReady();
    const bots = this.state.snakes.filter((s) => s.bot);
    if (bots.length)
      this.chatter.say(
        bots[Math.floor(Math.random() * bots.length)].name,
        'snakeHello',
        { urgent: true },
      );
    this.debugTickMs = null;
    this.room.debug.clearHistory();
    this.room.recordDebugState('New game');
    this.publish();
    this.stopTimer();
    this.timer = setInterval(() => this.tick(), this.tickMs);
  };

  debugTickMs = null;

  stopTimer() {
    clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    if (this.paused || !this.state) return;
    const before = new Map(
      this.state.snakes.map((s) => [
        s.id,
        { alive: s.alive, score: s.score, boosts: s.boosts },
      ]),
    );
    step(this.state);
    // In debug mode, a state to go back to every second or so, and whenever a snake crashes.
    const crashed = this.state.snakes.some(
      (s) => before.get(s.id)?.alive && !s.alive,
    );
    if (crashed || this.state.tick % 24 === 0)
      this.room.recordDebugState(
        crashed
          ? `Step ${this.state.tick}: a crash`
          : `Step ${this.state.tick}`,
      );
    // Computer snakes remark on crashing, boosting, and now and then on an apple.
    for (const snake of this.state.snakes) {
      const was = before.get(snake.id);
      if (!snake.bot || !was) continue;
      if (was.alive && !snake.alive)
        this.chatter.say(snake.name, 'snakeDie', { chance: 0.8 });
      else if (snake.boosts > was.boosts)
        this.chatter.say(snake.name, 'snakeBoost', { chance: 0.3 });
      else if (snake.score > was.score)
        this.chatter.say(snake.name, 'snakeEat', { chance: 0.12 });
    }
    // Most ticks nobody reaches a new square: nothing to show or send.
    if (this.state.changed || this.state.status === 'over') this.publish();
    if (this.state.status === 'over') {
      const winner = this.state.snakes.find((s) => s.id === this.state.winner);
      if (winner?.bot)
        this.chatter.say(winner.name, 'snakeWin', { urgent: true });
      this.stopTimer();
      if (this.isSolo) this.saveBest(this.state.snakes[0].score);
    }
  }

  // Shows the state here, and on the host also sends it to everyone else.
  publish() {
    const snapshot = structuredClone(this.state);
    this.show(snapshot);
    if (this.room.isOnline) this.room.send({ type: 'state', state: snapshot });
  }

  show(snapshot) {
    this.playSounds(this.game, snapshot);
    this.game = snapshot;
    this.scene?.setGame(snapshot, {
      myId: this.myId,
      watchId: this.watchId,
      avatars: this.avatarMap(snapshot),
      stepMs: this.debugTickMs ?? this.tickMs,
    });
  }

  // Avatars for the snakes in this game, from the lobby seats (and what the host sent).
  avatarMap(snapshot) {
    for (const seat of this.seats)
      if (seat.avatar && !this.avatars.has(seat.id))
        this.avatars.set(seat.id, seat.avatar);
    for (const snake of snapshot.snakes)
      if (!this.avatars.has(snake.id) && snake.bot)
        this.avatars.set(
          snake.id,
          robotAvatar(
            this.settings.botSeed,
            Number(snake.id.split('-')[1]) - 1,
          ),
        );
    return this.avatars;
  }

  // Sounds from the difference between two snapshots, so guests hear the same game as the host.
  playSounds(prev, next) {
    if (!next) return;
    if (
      !prev ||
      prev.status === 'over' ||
      next.snakes.length !== prev.snakes.length ||
      next.tick < prev.tick
    ) {
      if (next.status === 'countdown') sfx('ui.click');
      return;
    }
    if (
      next.status === 'countdown' &&
      Math.ceil(prev.countdown / COUNT_EVERY) !==
        Math.ceil(next.countdown / COUNT_EVERY)
    )
      sfx('ui.click');
    if (prev.status === 'countdown' && next.status === 'playing')
      sfx('snake.start');
    const before = new Map(prev.snakes.map((s) => [s.id, s]));
    for (const snake of next.snakes) {
      const was = before.get(snake.id);
      if (!was) continue;
      const mine = snake.id === this.myId;
      if (mine && snake.score > was.score) sfx('snake.eat');
      if (mine && snake.boosts > was.boosts) {
        sfx('snake.boost');
        sfx('snake.whoosh');
      }
      if (mine && was.boost > 0 && !snake.boost && snake.alive)
        sfx('snake.boostEnd');
      if (was.alive && !snake.alive) sfx(mine ? 'snake.die' : 'snake.crash');
    }
    if (next.status === 'over' && prev.status !== 'over') {
      const solo = next.snakes.length === 1;
      const won = solo
        ? next.snakes[0].score > this.best
        : next.winner === this.myId;
      setTimeout(() => sfx(won ? 'snake.win' : 'snake.lose'), 450);
    }
  }

  saveBest(score) {
    if (score <= this.best) return;
    this.best = score;
    try {
      localStorage.setItem(BEST_KEY, String(score));
    } catch {
      // storage blocked: the best score just isn't remembered
    }
  }

  // ─── The 3D island ───────────────────────────────────────────────────

  setupScene = modifier((canvas) => {
    this.canvas = canvas;
    let cancelled = false;
    let scene = null;
    import('../lazy/snake-scene')
      .then(({ createSnakeScene }) => {
        if (cancelled) return;
        scene = createSnakeScene(canvas);
        this.scene = scene;
        if (this.game)
          scene.setGame(this.game, {
            myId: this.myId,
            watchId: this.watchId,
            avatars: this.avatarMap(this.game),
            stepMs: this.tickMs,
          });
      })
      .catch((error) => {
        console.warn('3D snake island unavailable:', error);
        this.sceneFailed = true;
      });
    return () => {
      cancelled = true;
      scene?.dispose();
      this.scene = null;
      this.canvas = null;
    };
  });

  // ─── Input ───────────────────────────────────────────────────────────

  turn = (dir) => {
    if (!this.game || this.game.status === 'over') return;
    if (
      this.me?.alive &&
      this.game.status === 'playing' &&
      this.lastDir !== dir
    )
      sfx('snake.turn');
    this.lastDir = dir;
    this.scene?.previewTurn(this.myId, dir);
    if (this.isHostSide) queueTurn(this.state, this.myId, dir);
    else this.room.send({ type: 'turn', dir });
  };

  boostNow = () => {
    if (!this.canBoost) return;
    if (this.isHostSide) {
      if (boost(this.state, this.myId)) this.publish();
    } else this.room.send({ type: 'boost' });
  };

  // Touch joystick: steers towards whichever way it's pushed furthest.
  stickDir = null;

  stickMoved = (x, y) => {
    if (Math.hypot(x, y) < STICK_DEAD) return;
    const dir =
      Math.abs(x) > Math.abs(y)
        ? x > 0
          ? 'right'
          : 'left'
        : y > 0
          ? 'down'
          : 'up';
    if (dir === this.stickDir) return;
    this.stickDir = dir;
    this.turn(dir);
  };

  stickReleased = () => (this.stickDir = null);

  boostButton = modifier((button) => {
    const press = (event) => {
      event.preventDefault();
      this.boostNow();
    };
    const click = (event) => {
      if (event.detail === 0) this.boostNow();
    };
    button.addEventListener('pointerdown', press);
    button.addEventListener('click', click);
    return () => {
      button.removeEventListener('pointerdown', press);
      button.removeEventListener('click', click);
    };
  });

  // ─── Debug mode (see utils/debug-commands.js) ──────────────────────

  debugTools() {
    const need = () => {
      if (!this.state)
        throw new CommandError('No game is running. Start one first.');
      return this.state;
    };
    const snakeAt = (ctx, ref) => need().snakes[ctx.player(ref)];
    const changed = (ctx, label) => {
      this.publish();
      this.room.recordDebugState(label);
      ctx.announce(label);
    };
    const DIR_OF = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    return {
      players: () =>
        (this.state?.snakes ?? this.seats).map((s) => ({
          id: s.id,
          name: s.name,
        })),
      describe: () =>
        this.state
          ? `Snake: step ${this.state.tick}, ${this.state.status}${this.paused ? ' (paused)' : ''}, map ${this.state.map}. ${this.state.snakes.map((s) => `${s.name} ${s.alive ? `length ${s.body.length}` : 'crashed'}, ${s.score} pts`).join('; ')}.`
          : 'Snake: in the lobby.',
      snapshot: () => (this.state ? structuredClone(this.state) : null),
      restore: (snap) => {
        this.state = snap;
        this.publish();
        if (snap.status !== 'over' && !this.timer)
          this.timer = setInterval(
            () => this.tick(),
            this.debugTickMs ?? this.tickMs,
          );
      },
      commands: {
        grow: {
          usage: '/grow <player> [length]',
          help: 'Makes a snake longer (3 by default).',
          run: ([ref, n], ctx) => {
            const snake = snakeAt(ctx, ref);
            const count = Math.max(1, Math.min(200, Number(n) || 3));
            const tail = snake.body.at(-1);
            for (let i = 0; i < count; i++) snake.body.push([...tail]);
            changed(ctx, `${ctx.fromName} grew ${snake.name} by ${count}.`);
          },
        },
        shrink: {
          usage: '/shrink <player> [length]',
          help: 'Makes a snake shorter (never below 1).',
          run: ([ref, n], ctx) => {
            const snake = snakeAt(ctx, ref);
            const count = Math.max(1, Number(n) || 3);
            snake.body = snake.body.slice(
              0,
              Math.max(1, snake.body.length - count),
            );
            changed(ctx, `${ctx.fromName} shrank ${snake.name}.`);
          },
        },
        kill: {
          usage: '/kill <player>',
          help: 'Crashes a snake.',
          run: ([ref], ctx) => {
            const snake = snakeAt(ctx, ref);
            removeSnake(this.state, snake.id);
            changed(ctx, `${ctx.fromName} crashed ${snake.name}.`);
          },
        },
        revive: {
          usage: '/revive <player>',
          help: 'Brings a crashed snake back where it was, and carries on a finished game.',
          run: ([ref], ctx) => {
            const state = need();
            const snake = snakeAt(ctx, ref);
            snake.alive = true;
            snake.queue = [];
            if (state.status === 'over') {
              state.status = 'playing';
              state.winner = null;
              this.stopTimer();
              this.timer = setInterval(
                () => this.tick(),
                this.debugTickMs ?? this.tickMs,
              );
            }
            changed(ctx, `${ctx.fromName} revived ${snake.name}.`);
          },
        },
        score: {
          usage: '/score <player> <points>',
          help: 'Sets a snake’s score.',
          run: ([ref, n], ctx) => {
            const snake = snakeAt(ctx, ref);
            snake.score = Math.max(0, Math.round(Number(n) || 0));
            changed(
              ctx,
              `${ctx.fromName} set ${snake.name}’s score to ${snake.score}.`,
            );
          },
        },
        apples: {
          usage: '/apples <count>',
          help: 'How many apples stay on the board.',
          run: ([n], ctx) => {
            const state = need();
            state.appleCount = Math.max(
              0,
              Math.min(50, Math.round(Number(n) || 0)),
            );
            state.apples = state.apples.slice(0, state.appleCount);
            changed(
              ctx,
              `${ctx.fromName} set the apples to ${state.appleCount}. New ones appear as the snakes move.`,
            );
          },
        },
        boost: {
          usage: '/boost <player>',
          help: 'Makes a snake boost (it still costs a segment).',
          run: ([ref], ctx) => {
            const snake = snakeAt(ctx, ref);
            if (!boost(this.state, snake.id))
              throw new CommandError(`${snake.name} can’t boost right now.`);
            changed(ctx, `${ctx.fromName} boosted ${snake.name}.`);
          },
        },
        teleport: {
          usage: '/teleport <player> <x> <y> [up|down|left|right]',
          help: 'Moves a snake’s head to a square (0 to size−1), body trailing behind.',
          run: ([ref, x, y, dir], ctx) => {
            const state = need();
            const snake = snakeAt(ctx, ref);
            const hx = Math.max(
              0,
              Math.min(state.size - 1, Math.round(Number(x))),
            );
            const hy = Math.max(
              0,
              Math.min(state.size - 1, Math.round(Number(y))),
            );
            if (!Number.isFinite(hx) || !Number.isFinite(hy))
              throw new CommandError('Give x and y numbers.');
            if (dir && DIR_OF[dir]) snake.dir = dir;
            const [dx, dy] = DIR_OF[snake.dir];
            snake.body = snake.body.map((_, i) => [
              Math.max(0, Math.min(state.size - 1, hx - dx * i)),
              Math.max(0, Math.min(state.size - 1, hy - dy * i)),
            ]);
            snake.queue = [];
            changed(
              ctx,
              `${ctx.fromName} teleported ${snake.name} to ${hx}, ${hy}.`,
            );
          },
        },
        speed: {
          usage: '/speed <milliseconds per tick>',
          help: 'Changes the game speed (10 to 500; normal is 30).',
          run: ([n], ctx) => {
            need();
            this.debugTickMs = Math.max(
              10,
              Math.min(500, Math.round(Number(n) || 30)),
            );
            if (this.timer) {
              this.stopTimer();
              this.timer = setInterval(() => this.tick(), this.debugTickMs);
            }
            ctx.announce(
              `${ctx.fromName} set the speed to ${this.debugTickMs}ms a tick.`,
            );
          },
        },
        wrap: {
          usage: '/wrap <on|off>',
          help: 'Solid walls, or wrap round the edges.',
          run: ([word], ctx) => {
            const state = need();
            state.wrap = /^(on|true|yes|1)$/i.test(word ?? '');
            changed(
              ctx,
              `${ctx.fromName} ${state.wrap ? 'turned on wrap-around edges' : 'put the fence back'}.`,
            );
          },
        },
        pause: {
          usage: '/pause',
          help: 'Pauses or resumes the game for everyone.',
          run: (args, ctx) => {
            need();
            this.paused = !this.paused;
            ctx.announce(
              `${ctx.fromName} ${this.paused ? 'paused' : 'resumed'} the game.`,
            );
          },
        },
        step: {
          usage: '/step [count]',
          help: 'While paused: moves the game on a few half-steps.',
          run: ([n], ctx) => {
            const state = need();
            if (!this.paused)
              throw new CommandError('Pause first with /pause.');
            const count = Math.max(1, Math.min(200, Number(n) || 2));
            for (let i = 0; i < count && state.status !== 'over'; i++)
              step(state);
            changed(ctx, `${ctx.fromName} stepped the game on ${count}.`);
          },
        },
      },
    };
  }

  // Keyboard and controller, bound in Settings (utils/keybinds.js).
  onAction(action, { repeat } = {}) {
    if (
      action === 'up' ||
      action === 'down' ||
      action === 'left' ||
      action === 'right'
    )
      this.turn(action);
    else if (action === 'boost') {
      if (!repeat) this.boostNow();
    } else if (action === 'pause') {
      if (!this.canPause) return false;
      this.togglePause();
    } else if (action === 'chat') openChat();
    else return false;
    return true;
  }

  swipe = modifier((element) => {
    let start = null;
    const down = (event) => {
      start = [event.clientX, event.clientY];
    };
    const move = (event) => {
      if (!start) return;
      const dx = event.clientX - start[0];
      const dy = event.clientY - start[1];
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;
      this.turn(
        Math.abs(dx) > Math.abs(dy)
          ? dx > 0
            ? 'right'
            : 'left'
          : dy > 0
            ? 'down'
            : 'up',
      );
      // Keep going from here, so one long swipe can chain turns.
      start = [event.clientX, event.clientY];
    };
    const up = () => (start = null);
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
    return () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
    };
  });

  // ─── Lobby & controls ────────────────────────────────────────────────

  setRule = (key, value) => this.room.setSettings({ [key]: value });

  // Per-seat difficulty. The room-wide botLevel is still the default, so a room
  // set up before this existed, and any seat nobody has touched, behaves as before.
  get botLevelMap() {
    return this.settings.botLevels ?? {};
  }

  levelForSeat = (id) => this.botLevelMap[id] ?? this.settings.botLevel;

  setBotLevel = (id, level) =>
    this.setRule('botLevels', { ...this.botLevelMap, [id]: level });

  // ─── Custom levels ─────────────────────────────────────────────────
  // One you drew in the Level Editor. It is looked up by id from this browser's
  // saved levels, so online the host's copy is the one that gets played: the
  // whole level travels inside the game state either way.
  get myLevels() {
    // The stamp is what makes this re-read after the editor has saved one.
    this.levelsStamp;
    return listLevels('snake');
  }

  // The Level Editor lives here rather than in the tool list, because a level
  // is only ever drawn for the game you are sitting in the lobby of.
  @tracked editing = false;
  @tracked levelsStamp = 0;

  openEditor = () => (this.editing = true);

  closeEditor = () => {
    this.editing = false;
    this.levelsStamp++;
  };

  // Straight from finishing a level to playing it.
  playLevel = (id) => {
    this.closeEditor();
    if (!id) return;
    this.setRule('map', 'custom');
    this.setRule('levelId', id);
  };

  get customLevel() {
    return this.settings.map === 'custom'
      ? (findLevel('snake', this.settings.levelId) ?? null)
      : null;
  }

  get customMissing() {
    return this.settings.map === 'custom' && !this.customLevel;
  }

  setLevel = (event) => this.setRule('levelId', event.target.value);

  addBot = () =>
    this.room.setSettings({
      bots: Math.min(
        this.settings.bots + 1,
        MAX_SNAKES - this.room.members.length,
      ),
    });
  removeBot = () =>
    this.room.setSettings({
      bots: Math.max(
        0,
        Math.min(this.settings.bots, MAX_SNAKES - this.room.members.length) - 1,
      ),
    });

  togglePause = () => {
    if (this.game?.status !== 'playing') return;
    this.paused = !this.paused;
    sfx('snake.pause');
  };

  playAgain = () => this.room.allReady && this.start();
  readyCheck = () => this.room.callReadyCheck();

  // Mid-game, going back to the lobby asks first (hold to confirm).
  @tracked confirmingLobby = false;

  askLobby = () => {
    if (this.isOver) this.toLobby();
    else this.confirmingLobby = true;
  };

  cancelLobby = () => (this.confirmingLobby = false);

  get lobbyWarning() {
    return this.room.isOnline
      ? 'The game in progress will be cancelled for every snake on the board.'
      : 'The game in progress will be cancelled and your score will be lost.';
  }

  // Host: everyone back to the lobby. Guest: just this device.
  toLobby = () => {
    this.confirmingLobby = false;
    if (this.isHostSide && this.room.isOnline)
      this.room.send({ type: 'lobby' });
    this.backToLobby();
  };

  backToLobby() {
    this.confirmingLobby = false;
    this.stopTimer();
    this.room.setLocked(false);
    this.mode = 'lobby';
    this.game = null;
    this.state = null;
    this.paused = false;
    this.avatars = new Map();
  }

  leave = async () => {
    if (
      this.mode === 'playing' &&
      !this.isOver &&
      !(await askConfirm({
        title: 'Leave the game?',
        message: 'You’ll be disconnected and your snake is out.',
        confirmLabel: 'Hold to leave',
        cancelLabel: 'Keep playing',
      }))
    )
      return;
    this.room.close();
    this.backToLobby();
  };

  // ─── Online ──────────────────────────────────────────────────────────

  onlineMessage(message, from) {
    if (this.isHostSide) {
      if (!this.state) return;
      if (message.type === 'turn') queueTurn(this.state, from, message.dir);
      else if (message.type === 'boost' && boost(this.state, from))
        this.publish();
      return;
    }
    if (message.type === 'state') {
      this.mode = 'playing';
      this.show(message.state);
    } else if (message.type === 'lobby') {
      this.backToLobby();
    }
  }

  <template>
    <ToolPage
      @route="snake"
      @game={{true}}
      @landscape={{true}}
      @busy={{this.busy}}
      @closeWarning={{this.closeWarning}}
      @subtitle="Ride your snake round tropical islands, solo or against up to three others. Boost for speed, and beat the high score to win."
    >
      {{#if (eq this.mode "playing")}}
        <div class="game-shell uno-shell arcade-shell pop-in">
          <div
            class="uno-stage arcade-stage {{if this.iAmBoosting 'is-boosting'}}"
          >
            <canvas
              class="snake-canvas"
              aria-label="Snake island. Steer with the arrow keys or WASD, boost with Shift, or use the joystick and Boost button on a touch screen."
              {{this.setupScene}}
              {{this.swipe}}
              {{noImageSave}}
            ></canvas>
            <div class="arcade-speedlines" aria-hidden="true"></div>
            <ArcadeRadar
              @getScene={{this.getScene}}
              @drawMap={{this.drawMap}}
              @hideMap={{this.isOver}}
            />

            <div class="uno-overlay uno-top-left arcade-scores">
              {{#each this.scores key="id" as |s|}}
                <span
                  class="snake-score arcade-chip
                    {{unless s.alive 'is-dead'}}
                    {{if s.leading 'is-leading'}}"
                >
                  <span class="snake-swatch" style={{s.swatch}}></span>
                  {{#if s.leading}}<Icon @name="crown" @size={{12}} />{{/if}}
                  {{s.name}}
                  <strong>{{s.score}}</strong>
                </span>
              {{/each}}
              {{#if this.isSolo}}<span
                  class="snake-score arcade-chip is-best"
                >Best <strong>{{this.best}}</strong></span>{{/if}}
            </div>

            <p
              class="uno-overlay uno-status {{if this.isOver 'is-over'}}"
              role="status"
            >{{this.status}}</p>

            {{#if this.iAmOut}}
              <div class="mines-spectate" role="status">
                <span class="mines-spectate-label"><Icon
                    @name="eye"
                    @size={{14}}
                  />
                  {{this.spectateLabel}}{{#if this.watching}}
                    {{this.watching.name}}{{/if}}</span>
                {{#if this.watchable.length}}
                  <span class="mines-spectate-controls">
                    <button
                      type="button"
                      class="qr-icon-btn"
                      aria-label="Watch the previous player"
                      {{on "click" this.spectatePrev}}
                    ><Icon @name="chevrons-left" @size={{14}} /></button>
                    <button
                      type="button"
                      class="qr-icon-btn"
                      aria-label="Watch the next player"
                      {{on "click" this.spectateNext}}
                    ><Icon @name="chevrons-right" @size={{14}} /></button>
                  </span>
                {{/if}}
              </div>
            {{/if}}

            <div class="uno-overlay uno-top-right">
              <GameSettings @game="snake" />
              {{#if this.isHostSide}}
                {{#if this.isOver}}
                  {{#unless this.room.allReady}}
                    <span
                      class="arcade-chip"
                    >{{this.room.readyCount}}/{{this.room.members.length}}
                      ready</span>
                    <button
                      type="button"
                      class="btn"
                      {{on "click" this.readyCheck}}
                    ><Icon @name="bell-ring" @size={{13}} />
                      Ready check</button>
                  {{/unless}}
                  <button
                    type="button"
                    class="btn active"
                    disabled={{if this.room.allReady false true}}
                    {{on "click" this.playAgain}}
                  ><Icon @name="rotate-cw" @size={{13}} /> Play again</button>
                {{else if this.canPause}}
                  <button
                    type="button"
                    class="btn"
                    {{on "click" this.togglePause}}
                  ><Icon @name={{if this.paused "play" "pause"}} @size={{13}} />
                    {{if this.paused "Resume" "Pause"}}</button>
                {{/if}}
                <button
                  type="button"
                  class="btn"
                  {{on "click" this.askLobby}}
                ><Icon @name="users" @size={{13}} /> Lobby</button>
              {{else}}
                {{#if this.isOver}}
                  <ReadyButton
                    @room={{this.room}}
                    @label="Play again?"
                    @readyLabel="Ready for another"
                  />
                  {{#if this.room.iAmReady}}<span class="arcade-chip">Waiting
                      for the host…</span>{{/if}}
                {{/if}}
                <button
                  type="button"
                  class="btn"
                  {{on "click" this.leave}}
                ><Icon @name="log-out" @size={{13}} /> Leave</button>
              {{/if}}
            </div>

            {{#if this.countdown}}
              {{#each this.countdownDigits key="@identity" as |n|}}<span
                  class="snake-countdown"
                  aria-hidden="true"
                >{{n}}</span>{{/each}}
            {{/if}}
            {{#if this.sceneFailed}}
              <p class="snake-fallback">The 3D island couldn’t start on this
                device (WebGL is needed).</p>
            {{/if}}
            {{#if this.paused}}<span class="snake-paused">Paused</span>{{/if}}

            {{#unless this.iAmOut}}
              <div class="snake-touch">
                <Joystick
                  @class="snake-joystick"
                  @label="Steer"
                  @onMove={{this.stickMoved}}
                  @onEnd={{this.stickReleased}}
                />
                <button
                  type="button"
                  class="snake-boost {{if this.me.boost 'is-boosting'}}"
                  disabled={{if this.canBoost false true}}
                  data-sound="off"
                  {{this.boostButton}}
                >
                  <Icon @name="zap" @size={{26}} />
                  <span>Boost</span>
                </button>
              </div>
            {{/unless}}

            <div
              class="uno-overlay arcade-controls {{if this.padActive 'is-pad'}}"
              aria-label="Controls"
            >
              {{#each this.controls as |c|}}
                {{#if this.padActive}}
                  {{#if c.pad.length}}
                    <div class="arcade-control"><span
                        class="arcade-control-keys"
                      >{{#each c.pad as |b|}}<span
                            class="pad-button is-{{b.id}}"
                          >{{b.label}}</span>{{/each}}</span><span
                        class="arcade-control-label"
                      >{{c.label}}</span></div>
                  {{/if}}
                {{else if c.keys.length}}
                  <div class="arcade-control"><span
                      class="arcade-control-keys"
                    >{{#each c.keys as |k|}}<kbd
                          class="keycap"
                        >{{k}}</kbd>{{/each}}</span><span
                      class="arcade-control-label"
                    >{{c.label}}</span></div>
                {{/if}}
              {{/each}}
            </div>

            <GameChat
              @room={{this.room}}
              @floating={{true}}
              @class="uno-overlay uno-chat arcade-chat"
            />
          </div>
          {{#if this.confirmingLobby}}
            <HoldConfirm
              @title="Back to the lobby?"
              @message={{this.lobbyWarning}}
              @confirmLabel="Hold to end game"
              @onConfirm={{this.toLobby}}
              @onCancel={{this.cancelLobby}}
            />
          {{/if}}
        </div>
      {{else if this.editing}}
        <LevelEditor
          @game="snake"
          @onClose={{this.closeEditor}}
          @onPlay={{this.playLevel}}
        />
      {{else}}
        <GameLobby
          @game="snake"
          @room={{this.room}}
          @seats={{this.seats}}
          @maxSeats={{4}}
          @onAddBot={{this.addBot}}
          @onRemoveBot={{this.removeBot}}
          @onLevelEditor={{this.openEditor}}
          @spectatable={{true}}
          @botLevels={{this.botLevelMap}}
          @botLevelOptions={{this.botLevels}}
          @onSetBotLevel={{this.setBotLevel}}
          @onStart={{this.start}}
        >
          <:rules>
            <div class="lobby-rule">
              <span class="lobby-rule-text"><span
                  class="qr-label"
                >Island</span></span>
              <div class="math-tabs" role="group" aria-label="Map">
                {{#each this.maps as |m|}}
                  <button
                    type="button"
                    class="qr-tab {{if (eq this.settings.map m.id) 'active'}}"
                    title={{m.hint}}
                    aria-pressed={{if
                      (eq this.settings.map m.id)
                      "true"
                      "false"
                    }}
                    {{on "click" (fn this.setRule "map" m.id)}}
                  >{{m.label}}</button>
                {{/each}}
              </div>
            </div>
            {{#if (eq this.settings.map "custom")}}
              <div class="lobby-rule is-switch">
                <span class="lobby-rule-text"><span class="qr-label">Which level</span><span
                    class="tool-hint"
                  >One you drew in the Level Editor. It brings its own size with
                    it.</span></span>
                {{#if this.myLevels.length}}
                  <select
                    class="select"
                    aria-label="Your level"
                    {{on "change" this.setLevel}}
                  >
                    <option value="">Pick one…</option>
                    {{#each this.myLevels key="id" as |lv|}}
                      <option
                        value={{lv.id}}
                        selected={{eq this.settings.levelId lv.id}}
                      >{{lv.name}} ({{lv.width}}×{{lv.height}})</option>
                    {{/each}}
                  </select>
                {{else}}
                  <button
                    type="button"
                    class="btn"
                    {{on "click" this.openEditor}}
                  ><Icon @name="grid-3x3" @size={{13}} /> Draw one</button>
                {{/if}}
              </div>
              {{#if this.customMissing}}
                <p class="tool-error">Pick one of your levels, or the game will
                  start on the open meadow.</p>
              {{/if}}
            {{/if}}
            <div class="lobby-rule">
              <span class="lobby-rule-text"><span
                  class="qr-label"
                >Speed</span></span>
              <div class="math-tabs" role="group" aria-label="Speed">
                {{#each this.speeds as |s|}}
                  <button
                    type="button"
                    class="qr-tab {{if (eq this.settings.speed s.id) 'active'}}"
                    aria-pressed={{if
                      (eq this.settings.speed s.id)
                      "true"
                      "false"
                    }}
                    {{on "click" (fn this.setRule "speed" s.id)}}
                  >{{s.label}}</button>
                {{/each}}
              </div>
            </div>
            <div class="lobby-rule">
              <span class="lobby-rule-text"><span class="qr-label">Computer
                  players</span><span class="tool-hint">Easy ones wander and
                  slip up now and then; hard ones chase every apple and boost
                  more.</span></span>
              <div
                class="math-tabs"
                role="group"
                aria-label="Computer difficulty"
              >
                {{#each this.botLevels as |l|}}
                  <button
                    type="button"
                    class="qr-tab
                      {{if (eq this.settings.botLevel l.id) 'active'}}"
                    aria-pressed={{if
                      (eq this.settings.botLevel l.id)
                      "true"
                      "false"
                    }}
                    {{on "click" (fn this.setRule "botLevel" l.id)}}
                  >{{l.label}}</button>
                {{/each}}
              </div>
            </div>
            <div class="lobby-rule">
              <span class="lobby-rule-text"><span class="qr-label">Longer is:</span><span
                  class="tool-hint"
                >Faster or slower with every segment a snake grows (up to half
                  as fast again, or 40% slower).</span></span>
              <div class="math-tabs" role="group" aria-label="Longer is">
                {{#each this.lengthOptions as |s|}}
                  <button
                    type="button"
                    class="qr-tab
                      {{if (eq this.settings.lengthSpeed s.id) 'active'}}"
                    aria-pressed={{if
                      (eq this.settings.lengthSpeed s.id)
                      "true"
                      "false"
                    }}
                    {{on "click" (fn this.setRule "lengthSpeed" s.id)}}
                  >{{s.label}}</button>
                {{/each}}
              </div>
            </div>
            <div class="lobby-rule">
              <span class="lobby-rule-text"><span
                  class="qr-label"
                >Board</span></span>
              <div class="math-tabs" role="group" aria-label="Board size">
                {{#each this.sizes as |s|}}
                  <button
                    type="button"
                    class="qr-tab {{if (eq this.settings.size s.id) 'active'}}"
                    aria-pressed={{if
                      (eq this.settings.size s.id)
                      "true"
                      "false"
                    }}
                    {{on "click" (fn this.setRule "size" s.id)}}
                  >{{s.label}}</button>
                {{/each}}
              </div>
            </div>
            <div class="lobby-rule">
              <span class="lobby-rule-text"><span class="qr-label">Apples on the
                  board</span></span>
              <div class="math-tabs" role="group" aria-label="Apples">
                {{#each this.appleCounts as |s|}}
                  <button
                    type="button"
                    class="qr-tab
                      {{if (eq this.settings.apples s.id) 'active'}}"
                    aria-pressed={{if
                      (eq this.settings.apples s.id)
                      "true"
                      "false"
                    }}
                    {{on "click" (fn this.setRule "apples" s.id)}}
                  >{{s.label}}</button>
                {{/each}}
              </div>
            </div>
            <div class="lobby-rule">
              <span class="lobby-rule-text"><span
                  class="qr-label"
                >Edges</span><span class="tool-hint">Wrap around lets snakes
                  leave one side and come back on the other.</span></span>
              <div class="math-tabs" role="group" aria-label="Edges">
                {{#each this.walls as |s|}}
                  <button
                    type="button"
                    class="qr-tab {{if (eq this.settings.wrap s.id) 'active'}}"
                    aria-pressed={{if
                      (eq this.settings.wrap s.id)
                      "true"
                      "false"
                    }}
                    {{on "click" (fn this.setRule "wrap" s.id)}}
                  >{{s.label}}</button>
                {{/each}}
              </div>
            </div>
            <p class="tool-hint">Steer with the arrow keys or WASD and boost
              with Shift (or the joystick and Boost button on a touch screen).
              Boosting doubles your speed for a moment but costs a segment of
              your tail. With more than one snake, the highest score wins:
              outliving everyone isn’t enough, you have to overtake the leader.</p>
          </:rules>
        </GameLobby>
      {{/if}}
    </ToolPage>
  </template>
}
