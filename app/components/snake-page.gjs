import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';
import GameLobby from './game-lobby';
import GameChat from './game-chat';
import GameRoom from '../utils/game-room';
import { roomCodeFromUrl } from '../utils/file-share';
import { MAX_SNAKES, createGame, step, queueTurn, removeSnake } from '../utils/snake';

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
const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };
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
    settings: { ...DEFAULTS },
    onMessage: (message, from) => this.onlineMessage(message, from),
    onGuestLeft: (id) => this.state && removeSnake(this.state, id),
    onClosed: () => this.backToLobby(),
  });

  constructor(owner, args) {
    super(owner, args);
    const code = roomCodeFromUrl();
    if (code) this.room.join(code);
    const onKey = (event) => this.onKey(event);
    window.addEventListener('keydown', onKey);
    registerDestructor(this, () => {
      window.removeEventListener('keydown', onKey);
      this.stopTimer();
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
    return [...humans, ...Array.from({ length: bots }, (_, i) => ({ id: `bot-${i + 1}`, name: `Computer ${i + 1}`, kind: 'bot' }))];
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

  start = () => {
    const players = this.seats.map((seat) => ({ id: seat.id, name: seat.name, bot: seat.kind === 'bot' }));
    const { size, apples, wrap } = this.settings;
    this.state = createGame(players, { size, apples, wrap });
    this.mode = 'playing';
    this.paused = false;
    this.room.setLocked(true);
    this.publish();
    this.stopTimer();
    this.timer = setInterval(() => this.tick(), this.tickMs);
  };

  stopTimer() {
    clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    if (this.paused || !this.state) return;
    step(this.state);
    this.publish();
    if (this.state.status === 'over') {
      this.stopTimer();
      if (this.isSolo) this.saveBest(this.state.snakes[0].score);
    }
  }

  // Shows the state here, and on the host also sends it to everyone else.
  publish() {
    const snapshot = structuredClone(this.state);
    this.game = snapshot;
    this.draw();
    if (this.room.isOnline) this.room.send({ type: 'state', state: snapshot });
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
    if (this.isHostSide) queueTurn(this.state, this.myId, dir);
    else this.room.send({ type: 'turn', dir });
  };

  onKey(event) {
    if (this.mode !== 'playing' || event.target.closest?.('input, textarea')) return;
    // Minimised to a pill: the snake keeps going, but the arrow keys belong to the page again.
    if (!this.canvas?.isConnected || this.canvas.offsetParent === null) return;
    const dir = KEYS[event.key];
    if (dir) {
      event.preventDefault();
      this.turn(dir);
    } else if (event.key === ' ' && this.canPause) {
      event.preventDefault();
      this.togglePause();
    }
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
  };

  playAgain = () => this.start();

  // Host: everyone back to the lobby. Guest: just this device.
  toLobby = () => {
    if (this.isHostSide && this.room.isOnline) this.room.send({ type: 'lobby' });
    this.backToLobby();
  };

  backToLobby() {
    this.stopTimer();
    this.room.setLocked(false);
    this.mode = 'lobby';
    this.game = null;
    this.state = null;
    this.paused = false;
  }

  leave = () => {
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
      this.game = message.state;
      this.draw();
    } else if (message.type === 'lobby') {
      this.backToLobby();
    }
  }

  <template>
    <ToolPage @route="snake" @busy={{this.busy}} @closeWarning={{this.closeWarning}} @subtitle="Classic snake on your own, or a battle of up to four snakes against the computer and your friends.">
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

          <div class="snake-pad" aria-label="Steering">
            <button type="button" class="snake-pad-btn is-up" aria-label="Up" {{this.padButton "up"}}><Icon @name="arrow-up" @size={{20}} /></button>
            <button type="button" class="snake-pad-btn is-left" aria-label="Left" {{this.padButton "left"}}><Icon @name="arrow-left" @size={{20}} /></button>
            <button type="button" class="snake-pad-btn is-down" aria-label="Down" {{this.padButton "down"}}><Icon @name="arrow-down" @size={{20}} /></button>
            <button type="button" class="snake-pad-btn is-right" aria-label="Right" {{this.padButton "right"}}><Icon @name="arrow-right" @size={{20}} /></button>
          </div>

          <GameChat @room={{this.room}} @floating={{true}} />

          <div class="game-actions">
            {{#if this.isHostSide}}
              {{#if this.isOver}}
                <button type="button" class="btn active" {{on "click" this.playAgain}}><Icon @name="rotate-cw" @size={{13}} /> Play again</button>
              {{else if this.canPause}}
                <button type="button" class="btn" {{on "click" this.togglePause}}><Icon @name={{if this.paused "play" "pause"}} @size={{13}} /> {{if this.paused "Resume" "Pause"}}</button>
              {{/if}}
              <button type="button" class="btn" {{on "click" this.toLobby}}><Icon @name="users" @size={{13}} /> Back to lobby</button>
            {{else}}
              {{#if this.isOver}}<span class="tool-hint">Waiting for the host…</span>{{/if}}
              <button type="button" class="btn" {{on "click" this.leave}}><Icon @name="log-out" @size={{13}} /> Leave room</button>
            {{/if}}
          </div>
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
