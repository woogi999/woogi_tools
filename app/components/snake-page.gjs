import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';
import GameLobby, { ReadyButton } from './game-lobby';
import GameChat from './game-chat';
import { askConfirm } from '../utils/confirm';
import { listenForActions, onScreen, openChat } from '../utils/game-input';
import { CommandError } from '../utils/debug-commands';
import GameRoom from '../utils/game-room';
import { roomCodeFromUrl } from '../utils/file-share';
import { botNames, newBotSeed } from '../utils/bot-names';
import { BotChatter } from '../utils/bot-chat';
import { robotAvatar } from '../utils/avatar';
import { MAX_SNAKES, createGame, step, queueTurn, removeSnake } from '../utils/snake';
import { sfx, preloadSounds } from '../utils/sound';
import HoldConfirm from './hold-confirm';

const SPEEDS = [
  { id: 'slow', label: 'Slow', ms: 160 },
  { id: 'normal', label: 'Normal', ms: 120 },
  { id: 'fast', label: 'Fast', ms: 80 },
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
  { id: false, label: 'Solid walls' },
  { id: true, label: 'Wrap around' },
];
const DEFAULTS = { speed: 'normal', size: 20, apples: 1, wrap: false, bots: 1 };
// Everyone else's snake; your own is always drawn in the text colour.
const PALETTE = ['#ff5c72', '#3e7be0', '#30a46c', '#b388eb'];
const SWIPE_PX = 18;
const BEST_KEY = 'woogi-snake-best';

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

  // 'lobby' | 'playing'
  @tracked mode = 'lobby';
  // A fresh copy after every tick, so the template re-renders scores and status.
  @tracked game = null;
  @tracked paused = false;
  @tracked best = readBest();

  // The live, mutable game on this device (the host's, online).
  state = null;
  timer = null;
  canvas = null;

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
      onAction: (action) => this.onAction(action),
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

  get tickMs() {
    return (SPEEDS.find((s) => s.id === this.settings.speed) ?? SPEEDS[1]).ms;
  }

  get isHostSide() {
    return this.room.isHost;
  }

  // Humans first, then as many computer snakes as fit.
  get seats() {
    const humans = this.room.members.map((m) => ({ ...m, kind: 'human' }));
    const bots = Math.max(0, Math.min(this.settings.bots, MAX_SNAKES - humans.length));
    const names = botNames(this.settings.botSeed, bots);
    return [...humans, ...names.map((name, i) => ({ id: `bot-${i + 1}`, name, kind: 'bot', avatar: robotAvatar(this.settings.botSeed, i) }))];
  }

  get isSolo() {
    return this.game?.snakes.length === 1;
  }

  // Pausing is only fair when no one else is playing from another device.
  get canPause() {
    return this.isHostSide && !this.game?.snakes.some((s) => !s.bot && s.id !== this.myId);
  }

  get scores() {
    return (this.game?.snakes ?? []).map((snake) => ({
      id: snake.id,
      name: snake.id === this.myId ? 'You' : snake.name,
      score: snake.score,
      alive: snake.alive,
      mine: snake.id === this.myId,
      swatch: htmlSafe(`background: ${snake.id === this.myId ? 'var(--text)' : PALETTE[snake.color % PALETTE.length]}`),
    }));
  }

  get status() {
    const game = this.game;
    if (!game) return '';
    if (game.status === 'countdown') return 'Get ready…';
    if (this.paused) return 'Paused.';
    if (game.status === 'playing') return this.isSolo ? 'Eat the apples. Don’t hit the walls or yourself.' : 'Last snake slithering wins.';
    if (this.isSolo) return `Game over. You scored ${game.snakes[0].score}.`;
    if (game.winner === null) return 'Everyone crashed. It’s a draw.';
    if (game.winner === this.myId) return 'You win!';
    return `${game.snakes.find((s) => s.id === game.winner)?.name ?? 'Someone'} wins.`;
  }

  get isOver() {
    return this.game?.status === 'over';
  }

  // Picture-in-picture: leaving the page mid-game floats it, and closing it asks first.
  get busy() {
    return (this.mode === 'playing' && !this.isOver) || this.room.isOnline;
  }

  get closeWarning() {
    if (this.room.isOnline) return this.room.isHost ? 'Close Snake? You’re hosting, so this ends the game and closes the room for everyone.' : 'Close Snake? You’ll be disconnected from the game.';
    return 'Close Snake? The game in progress will be lost.';
  }

  // ─── Loop ────────────────────────────────────────────────────────────

  chatter = new BotChatter(this.room);

  start = () => {
    const players = this.seats.map((seat) => ({ id: seat.id, name: seat.name, bot: seat.kind === 'bot' }));
    const { size, apples, wrap } = this.settings;
    this.state = createGame(players, { size, apples, wrap });
    this.mode = 'playing';
    this.paused = false;
    this.room.setLocked(true);
    // A rematch needs everyone to press Ready again.
    this.room.resetReady();
    const bots = this.state.snakes.filter((s) => s.bot);
    if (bots.length) this.chatter.say(bots[Math.floor(Math.random() * bots.length)].name, 'snakeHello', { urgent: true });
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
    const before = new Map(this.state.snakes.map((s) => [s.id, { alive: s.alive, score: s.score }]));
    step(this.state);
    // In debug mode, a state to go back to every second or so, and whenever a snake crashes.
    const crashed = this.state.snakes.some((s) => before.get(s.id)?.alive && !s.alive);
    if (crashed || this.state.tick % 8 === 0) this.room.recordDebugState(crashed ? `Tick ${this.state.tick}: a crash` : `Tick ${this.state.tick}`);
    // Computer snakes remark on crashing, and now and then on an apple.
    for (const snake of this.state.snakes) {
      const was = before.get(snake.id);
      if (!snake.bot || !was) continue;
      if (was.alive && !snake.alive) this.chatter.say(snake.name, 'snakeDie', { chance: 0.8 });
      else if (snake.score > was.score) this.chatter.say(snake.name, 'snakeEat', { chance: 0.12 });
    }
    this.publish();
    if (this.state.status === 'over') {
      const winner = this.state.snakes.find((s) => s.id === this.state.winner);
      if (winner?.bot) this.chatter.say(winner.name, 'snakeWin', { urgent: true });
      this.stopTimer();
      if (this.isSolo) this.saveBest(this.state.snakes[0].score);
    }
  }

  // Shows the state here, and on the host also sends it to everyone else.
  publish() {
    const snapshot = structuredClone(this.state);
    this.playSounds(this.game, snapshot);
    this.game = snapshot;
    this.draw();
    if (this.room.isOnline) this.room.send({ type: 'state', state: snapshot });
  }

  // Sounds from the difference between two snapshots, so guests hear the same game as the host.
  playSounds(prev, next) {
    if (!next) return;
    if (!prev || prev.status === 'over' || next.snakes.length !== prev.snakes.length) {
      if (next.status === 'countdown') sfx('ui.click');
      return;
    }
    if (next.status === 'countdown' && Math.ceil(prev.countdown / 3) !== Math.ceil(next.countdown / 3)) sfx('ui.click');
    if (prev.status === 'countdown' && next.status === 'playing') sfx('snake.start');
    const before = new Map(prev.snakes.map((s) => [s.id, s]));
    for (const snake of next.snakes) {
      const was = before.get(snake.id);
      if (!was) continue;
      const mine = snake.id === this.myId;
      if (mine && snake.score > was.score) sfx('snake.eat');
      if (was.alive && !snake.alive) sfx(mine ? 'snake.die' : 'snake.crash');
    }
    if (next.status === 'over' && prev.status !== 'over') {
      const solo = next.snakes.length === 1;
      const won = solo ? next.snakes[0].score > this.best : next.winner === this.myId;
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

  // ─── Drawing ─────────────────────────────────────────────────────────

  setupCanvas = modifier((canvas) => {
    this.canvas = canvas;
    const resize = () => {
      const size = canvas.clientWidth;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(size * ratio);
      canvas.height = Math.round(size * ratio);
      this.draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      this.canvas = null;
    };
  });

  draw() {
    const canvas = this.canvas;
    const game = this.game;
    if (!canvas || !game) return;
    const ctx = canvas.getContext('2d');
    const styles = getComputedStyle(canvas);
    const cell = canvas.width / game.size;
    const colors = {
      bg: styles.getPropertyValue('--bg-elevated').trim() || '#121212',
      grid: styles.getPropertyValue('--border-color').trim() || '#333',
      me: styles.getPropertyValue('--text').trim() || '#fff',
      apple: '#f5c518',
    };

    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = colors.grid;
    const dot = Math.max(1, cell * 0.08);
    for (let y = 0; y < game.size; y++) for (let x = 0; x < game.size; x++) ctx.fillRect((x + 0.5) * cell - dot / 2, (y + 0.5) * cell - dot / 2, dot, dot);

    ctx.fillStyle = colors.apple;
    for (const [x, y] of game.apples) {
      ctx.beginPath();
      ctx.arc((x + 0.5) * cell, (y + 0.5) * cell, cell * 0.36, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const snake of game.snakes) {
      const color = snake.id === this.myId ? colors.me : PALETTE[snake.color % PALETTE.length];
      ctx.globalAlpha = snake.alive ? 1 : 0.3;
      snake.body.forEach(([x, y], i) => {
        const inset = i === 0 ? cell * 0.04 : cell * 0.12;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(x * cell + inset, y * cell + inset, cell - inset * 2, cell - inset * 2, cell * 0.28);
        ctx.fill();
      });
      // Eyes, so it's clear which end is the head.
      const [hx, hy] = snake.body[0];
      ctx.fillStyle = colors.bg;
      const r = cell * 0.09;
      const offsets = { up: [[-0.18, -0.15], [0.18, -0.15]], down: [[-0.18, 0.15], [0.18, 0.15]], left: [[-0.15, -0.18], [-0.15, 0.18]], right: [[0.15, -0.18], [0.15, 0.18]] }[snake.dir];
      for (const [ox, oy] of offsets) {
        ctx.beginPath();
        ctx.arc((hx + 0.5 + ox) * cell, (hy + 0.5 + oy) * cell, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    if (game.status === 'countdown') {
      ctx.fillStyle = colors.me;
      ctx.font = `700 ${canvas.width * 0.15}px Moderustic, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(Math.ceil(game.countdown / 3)), canvas.width / 2, canvas.height / 2);
    }
  }

  // ─── Input ───────────────────────────────────────────────────────────

  turn = (dir) => {
    if (!this.game || this.game.status === 'over') return;
    const me = this.game.snakes.find((s) => s.id === this.myId);
    if (me?.alive && this.game.status === 'playing' && this.lastDir !== dir) sfx('snake.turn');
    this.lastDir = dir;
    if (this.isHostSide) queueTurn(this.state, this.myId, dir);
    else this.room.send({ type: 'turn', dir });
  };

  // ─── Debug mode (see utils/debug-commands.js) ──────────────────────

  debugTools() {
    const need = () => {
      if (!this.state) throw new CommandError('No game is running. Start one first.');
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
      players: () => (this.state?.snakes ?? this.seats).map((s) => ({ id: s.id, name: s.name })),
      describe: () => (this.state ? `Snake: tick ${this.state.tick}, ${this.state.status}${this.paused ? ' (paused)' : ''}. ${this.state.snakes.map((s) => `${s.name} ${s.alive ? `length ${s.body.length}` : 'crashed'}, ${s.score} pts`).join('; ')}.` : 'Snake: in the lobby.'),
      snapshot: () => (this.state ? structuredClone(this.state) : null),
      restore: (snap) => {
        this.state = snap;
        this.publish();
        if (snap.status !== 'over' && !this.timer) this.timer = setInterval(() => this.tick(), this.debugTickMs ?? this.tickMs);
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
            snake.body = snake.body.slice(0, Math.max(1, snake.body.length - count));
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
              this.timer = setInterval(() => this.tick(), this.debugTickMs ?? this.tickMs);
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
            changed(ctx, `${ctx.fromName} set ${snake.name}’s score to ${snake.score}.`);
          },
        },
        apples: {
          usage: '/apples <count>',
          help: 'How many apples stay on the board.',
          run: ([n], ctx) => {
            const state = need();
            state.appleCount = Math.max(0, Math.min(50, Math.round(Number(n) || 0)));
            state.apples = state.apples.slice(0, state.appleCount);
            changed(ctx, `${ctx.fromName} set the apples to ${state.appleCount}. New ones appear as the snakes move.`);
          },
        },
        teleport: {
          usage: '/teleport <player> <x> <y> [up|down|left|right]',
          help: 'Moves a snake’s head to a square (0 to size−1), body trailing behind.',
          run: ([ref, x, y, dir], ctx) => {
            const state = need();
            const snake = snakeAt(ctx, ref);
            const hx = Math.max(0, Math.min(state.size - 1, Math.round(Number(x))));
            const hy = Math.max(0, Math.min(state.size - 1, Math.round(Number(y))));
            if (!Number.isFinite(hx) || !Number.isFinite(hy)) throw new CommandError('Give x and y numbers.');
            if (dir && DIR_OF[dir]) snake.dir = dir;
            const [dx, dy] = DIR_OF[snake.dir];
            snake.body = snake.body.map((_, i) => [Math.max(0, Math.min(state.size - 1, hx - dx * i)), Math.max(0, Math.min(state.size - 1, hy - dy * i))]);
            snake.queue = [];
            changed(ctx, `${ctx.fromName} teleported ${snake.name} to ${hx}, ${hy}.`);
          },
        },
        speed: {
          usage: '/speed <milliseconds per step>',
          help: 'Changes the game speed (40 to 1000; normal is 120).',
          run: ([n], ctx) => {
            need();
            this.debugTickMs = Math.max(40, Math.min(1000, Math.round(Number(n) || 120)));
            if (this.timer) {
              this.stopTimer();
              this.timer = setInterval(() => this.tick(), this.debugTickMs);
            }
            ctx.announce(`${ctx.fromName} set the speed to ${this.debugTickMs}ms a step.`);
          },
        },
        wrap: {
          usage: '/wrap <on|off>',
          help: 'Solid walls, or wrap round the edges.',
          run: ([word], ctx) => {
            const state = need();
            state.wrap = /^(on|true|yes|1)$/i.test(word ?? '');
            changed(ctx, `${ctx.fromName} ${state.wrap ? 'turned on wrap-around edges' : 'put the walls back'}.`);
          },
        },
        pause: {
          usage: '/pause',
          help: 'Pauses or resumes the game for everyone.',
          run: (args, ctx) => {
            need();
            this.paused = !this.paused;
            ctx.announce(`${ctx.fromName} ${this.paused ? 'paused' : 'resumed'} the game.`);
          },
        },
        step: {
          usage: '/step [count]',
          help: 'While paused: moves the game on a few steps.',
          run: ([n], ctx) => {
            const state = need();
            if (!this.paused) throw new CommandError('Pause first with /pause.');
            const count = Math.max(1, Math.min(100, Number(n) || 1));
            for (let i = 0; i < count && state.status !== 'over'; i++) step(state);
            changed(ctx, `${ctx.fromName} stepped the game on ${count}.`);
          },
        },
      },
    };
  }

  // Keyboard and controller, bound in Settings (utils/keybinds.js).
  onAction(action) {
    if (action === 'up' || action === 'down' || action === 'left' || action === 'right') this.turn(action);
    else if (action === 'pause') {
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
      this.turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
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

  // Steers on pointerdown rather than click: a click only fires on release,
  // which is a noticeable lag when a snake is one square from a wall. A
  // keyboard "click" (Enter/Space on a focused button) still steers too.
  padButton = modifier((button, [dir]) => {
    const press = (event) => {
      event.preventDefault();
      this.turn(dir);
    };
    const click = (event) => {
      if (event.detail === 0) this.turn(dir);
    };
    button.addEventListener('pointerdown', press);
    button.addEventListener('click', click);
    return () => {
      button.removeEventListener('pointerdown', press);
      button.removeEventListener('click', click);
    };
  });

  // ─── Lobby & controls ────────────────────────────────────────────────

  setRule = (key, value) => this.room.setSettings({ [key]: value });
  addBot = () => this.room.setSettings({ bots: Math.min(this.settings.bots + 1, MAX_SNAKES - this.room.members.length) });
  removeBot = () => this.room.setSettings({ bots: Math.max(0, Math.min(this.settings.bots, MAX_SNAKES - this.room.members.length) - 1) });

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
    return this.room.isOnline ? 'The game in progress will be cancelled for every snake on the board.' : 'The game in progress will be cancelled and your score will be lost.';
  }

  // Host: everyone back to the lobby. Guest: just this device.
  toLobby = () => {
    this.confirmingLobby = false;
    if (this.isHostSide && this.room.isOnline) this.room.send({ type: 'lobby' });
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
  }

  leave = async () => {
    if (this.mode === 'playing' && !this.isOver && !(await askConfirm({ title: 'Leave the game?', message: 'You’ll be disconnected and your snake is out.', confirmLabel: 'Hold to leave', cancelLabel: 'Keep playing' }))) return;
    this.room.close();
    this.backToLobby();
  };

  // ─── Online ──────────────────────────────────────────────────────────

  onlineMessage(message, from) {
    if (this.isHostSide) {
      if (message.type === 'turn' && this.state) queueTurn(this.state, from, message.dir);
      return;
    }
    if (message.type === 'state') {
      this.mode = 'playing';
      this.playSounds(this.game, message.state);
      this.game = message.state;
      this.draw();
    } else if (message.type === 'lobby') {
      this.backToLobby();
    }
  }

  <template>
    <ToolPage @route="snake" @game={{true}} @busy={{this.busy}} @closeWarning={{this.closeWarning}} @subtitle="The classic, solo or in a battle of up to four snakes against the computer and your friends. Don’t crash.">
      {{#if (eq this.mode "playing")}}
        <div class="game-shell snake-shell pop-in">
          <div class="snake-scores">
            {{#each this.scores key="id" as |s|}}
              <span class="snake-score {{unless s.alive 'is-dead'}}"><span class="snake-swatch" style={{s.swatch}}></span>{{s.name}} <strong>{{s.score}}</strong></span>
            {{/each}}
            {{#if this.isSolo}}<span class="snake-score is-best">Best <strong>{{this.best}}</strong></span>{{/if}}
          </div>

          <canvas class="snake-canvas" aria-label="Snake board. Use the arrow keys, WASD, swipes or the buttons below to steer." {{this.setupCanvas}} {{this.swipe}}></canvas>

          <p class="game-status {{if this.isOver 'is-over'}}" role="status">{{this.status}}</p>

          <div class="snake-pad" aria-label="Steering" data-sound="off">
            <button type="button" class="snake-pad-btn is-up" aria-label="Up" {{this.padButton "up"}}><Icon @name="arrow-up" @size={{20}} /></button>
            <button type="button" class="snake-pad-btn is-left" aria-label="Left" {{this.padButton "left"}}><Icon @name="arrow-left" @size={{20}} /></button>
            <button type="button" class="snake-pad-btn is-down" aria-label="Down" {{this.padButton "down"}}><Icon @name="arrow-down" @size={{20}} /></button>
            <button type="button" class="snake-pad-btn is-right" aria-label="Right" {{this.padButton "right"}}><Icon @name="arrow-right" @size={{20}} /></button>
          </div>

          <GameChat @room={{this.room}} @floating={{true}} />

          <div class="game-actions">
            {{#if this.isHostSide}}
              {{#if this.isOver}}
                {{#unless this.room.allReady}}
                  <span class="tool-hint">{{this.room.readyCount}}/{{this.room.members.length}} ready</span>
                  <button type="button" class="btn" {{on "click" this.readyCheck}}><Icon @name="bell-ring" @size={{13}} /> Ready check</button>
                {{/unless}}
                <button type="button" class="btn active" disabled={{if this.room.allReady false true}} {{on "click" this.playAgain}}><Icon @name="rotate-cw" @size={{13}} /> Play again</button>
              {{else if this.canPause}}
                <button type="button" class="btn" {{on "click" this.togglePause}}><Icon @name={{if this.paused "play" "pause"}} @size={{13}} /> {{if this.paused "Resume" "Pause"}}</button>
              {{/if}}
              <button type="button" class="btn" {{on "click" this.askLobby}}><Icon @name="users" @size={{13}} /> Back to lobby</button>
            {{else}}
              {{#if this.isOver}}
                <ReadyButton @room={{this.room}} @label="Play again?" @readyLabel="Ready for another" />
                {{#if this.room.iAmReady}}<span class="tool-hint">Waiting for the host…</span>{{/if}}
              {{/if}}
              <button type="button" class="btn" {{on "click" this.leave}}><Icon @name="log-out" @size={{13}} /> Leave room</button>
            {{/if}}
          </div>
          {{#if this.confirmingLobby}}
            <HoldConfirm @title="Back to the lobby?" @message={{this.lobbyWarning}} @confirmLabel="Hold to end game" @onConfirm={{this.toLobby}} @onCancel={{this.cancelLobby}} />
          {{/if}}
        </div>
      {{else}}
        <GameLobby @room={{this.room}} @seats={{this.seats}} @maxSeats={{4}} @onAddBot={{this.addBot}} @onRemoveBot={{this.removeBot}} @onStart={{this.start}}>
          <:rules>
            <div class="lobby-rule">
              <span class="lobby-rule-text"><span class="qr-label">Speed</span></span>
              <div class="math-tabs" role="group" aria-label="Speed">
                {{#each this.speeds as |s|}}
                  <button type="button" class="qr-tab {{if (eq this.settings.speed s.id) 'active'}}" aria-pressed={{if (eq this.settings.speed s.id) "true" "false"}} {{on "click" (fn this.setRule "speed" s.id)}}>{{s.label}}</button>
                {{/each}}
              </div>
            </div>
            <div class="lobby-rule">
              <span class="lobby-rule-text"><span class="qr-label">Board</span></span>
              <div class="math-tabs" role="group" aria-label="Board size">
                {{#each this.sizes as |s|}}
                  <button type="button" class="qr-tab {{if (eq this.settings.size s.id) 'active'}}" aria-pressed={{if (eq this.settings.size s.id) "true" "false"}} {{on "click" (fn this.setRule "size" s.id)}}>{{s.label}}</button>
                {{/each}}
              </div>
            </div>
            <div class="lobby-rule">
              <span class="lobby-rule-text"><span class="qr-label">Apples on the board</span></span>
              <div class="math-tabs" role="group" aria-label="Apples">
                {{#each this.appleCounts as |s|}}
                  <button type="button" class="qr-tab {{if (eq this.settings.apples s.id) 'active'}}" aria-pressed={{if (eq this.settings.apples s.id) "true" "false"}} {{on "click" (fn this.setRule "apples" s.id)}}>{{s.label}}</button>
                {{/each}}
              </div>
            </div>
            <div class="lobby-rule">
              <span class="lobby-rule-text"><span class="qr-label">Edges</span><span class="tool-hint">Wrap around lets snakes leave one side and come back on the other.</span></span>
              <div class="math-tabs" role="group" aria-label="Edges">
                {{#each this.walls as |s|}}
                  <button type="button" class="qr-tab {{if (eq this.settings.wrap s.id) 'active'}}" aria-pressed={{if (eq this.settings.wrap s.id) "true" "false"}} {{on "click" (fn this.setRule "wrap" s.id)}}>{{s.label}}</button>
                {{/each}}
              </div>
            </div>
            <p class="tool-hint">Steer with the arrow keys, WASD, swipes, or the on-screen buttons. On your own it’s classic snake; add computer players or friends for a battle.</p>
          </:rules>
        </GameLobby>
      {{/if}}
    </ToolPage>
  </template>
}
