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
import GameChat from './game-chat';
import HoldConfirm from './hold-confirm';
import { askConfirm } from '../utils/confirm';
import { listenForActions, onScreen, openChat } from '../utils/game-input';
import { actionForKey, actionForPad, controlHints } from '../utils/keybinds';
import { padStick, pushPadHandler, padState } from '../utils/gamepad';
import GameRoom from '../utils/game-room';
import { roomCodeFromUrl } from '../utils/file-share';
import { botNames, newBotSeed } from '../utils/bot-names';
import { BotChatter } from '../utils/bot-chat';
import { robotAvatar } from '../utils/avatar';
import { MAX_PLAYERS, FIELDS, TIME_LIMITS, PLAYER_COLORS, HIDDEN, EXPLODED, DROP_MS, createGame, dig, toggleFlag, removePlayer, walk, tick, viewOf, botStep, tileAt } from '../utils/minesweeper';
import { sfx, preloadSounds } from '../utils/sound';

const DEFAULTS = { field: 'normal', time: 300, bots: 1, stunOnly: true };
const ON_OFF = [
  { id: true, label: 'On' },
  { id: false, label: 'Off' },
];
const SIM_MS = 50;
const SEND_EVERY = 2; // simulation steps between updates to guests (10 a second)
const POS_SEND_MS = 80;
// How close (in tiles) a guest has to be to a tile to dig or flag it, give or take lag.
const REACH = 1.6;
const MOVES = new Set(['up', 'down', 'left', 'right']);

const eq = (a, b) => a === b;

export default class MinesweeperPage extends Component {
  fields = FIELDS;
  times = TIME_LIMITS;
  onOff = ON_OFF;

  // 'lobby' | 'playing'
  @tracked mode = 'lobby';
  // The latest view, refreshed a few times a second for the scores and timer.
  @tracked view = null;
  @tracked sceneFailed = false;
  @tracked confirmingLobby = false;

  state = null; // host only: the whole game, mines included
  latest = null; // the most recent view on this device
  timer = null;
  canvas = null;
  scene = null;
  me = null; // { x, y, face, moving }: your own avatar, moved on this device
  held = new Set();
  stick = { x: 0, y: 0 };
  brains = new Map();
  avatars = new Map();
  steps = 0;
  lastSound = 0;

  room = new GameRoom('mines', {
    maxPlayers: MAX_PLAYERS,
    settings: { ...DEFAULTS, botSeed: newBotSeed() },
    onMessage: (message, from) => this.onlineMessage(message, from),
    onGuestLeft: (id) => this.state && removePlayer(this.state, id),
    onClosed: () => this.backToLobby(),
  });

  chatter = new BotChatter(this.room);

  constructor(owner, args) {
    super(owner, args);
    preloadSounds('mines');
    const code = roomCodeFromUrl();
    if (code) this.room.join(code);
    this.room.setDebugTools(this.debugTools());
    const active = () => this.mode === 'playing' && onScreen(this.canvas);
    const stopInput = listenForActions('mines', { active, onAction: (action, info) => this.onAction(action, info) });
    const keyUp = (event) => {
      const action = actionForKey('mines', event);
      if (MOVES.has(action)) this.held.delete(action);
    };
    const blur = () => this.held.clear();
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', blur);
    // The D-pad walks while held, so it needs the releases too.
    const releasePad = pushPadHandler((button, { down }) => {
      const action = actionForPad('mines', button);
      if (!MOVES.has(action) || !active()) return false;
      if (down) this.held.add(action);
      else this.held.delete(action);
      return true;
    });
    registerDestructor(this, () => {
      stopInput();
      releasePad();
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', blur);
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

  get isHostSide() {
    return this.room.isHost;
  }

  get seats() {
    const humans = this.room.members.map((m) => ({ ...m, kind: 'human' }));
    const bots = Math.max(0, Math.min(this.settings.bots, MAX_PLAYERS - humans.length));
    return [...humans, ...botNames(this.settings.botSeed, bots).map((name, i) => ({ id: `bot-${i + 1}`, name, kind: 'bot', avatar: robotAvatar(this.settings.botSeed, i) }))];
  }

  get isSolo() {
    return this.view?.players.length === 1;
  }

  get isOver() {
    return this.view?.status === 'over';
  }

  get busy() {
    return (this.mode === 'playing' && !this.isOver) || this.room.isOnline;
  }

  get closeWarning() {
    if (this.room.isOnline) return this.room.isHost ? 'Close Minesweeper? You’re hosting, so this ends the game and closes the room for everyone.' : 'Close Minesweeper? You’ll be disconnected from the game.';
    return 'Close Minesweeper? The game in progress will be lost.';
  }

  get mePlayer() {
    return this.view?.players.find((p) => p.id === this.myId) ?? null;
  }

  // The key reminders in the corner: keyboard keys, or controller buttons once a controller's in use (touch screens hide it).
  get controls() {
    return controlHints('mines', [
      { label: 'Walk', actions: ['up', 'left', 'down', 'right'] },
      { label: 'Dig', actions: ['dig'] },
      { label: 'Flag', actions: ['flag'] },
      { label: 'Chat', actions: ['chat'] },
    ]);
  }

  get padActive() {
    return padState.active;
  }

  get iAmOut() {
    return Boolean(this.mePlayer?.dead) && this.view?.status === 'playing';
  }

  get stunned() {
    return (this.mePlayer?.stun ?? 0) > 0 && this.view?.status === 'playing';
  }

  get clock() {
    const s = Math.ceil((this.view?.timeLeft ?? 0) / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  get lowTime() {
    return (this.view?.timeLeft ?? Infinity) <= 30000 && this.view?.status === 'playing';
  }

  get minesLeft() {
    const v = this.view;
    if (!v) return 0;
    const marked = v.cells.filter((c, i) => c === EXPLODED || (c === HIDDEN && v.flags[i])).length;
    return v.mineCount - marked;
  }

  get tilesLeft() {
    return this.view?.safeLeft ?? 0;
  }

  get scores() {
    return [...(this.view?.players ?? [])]
      .sort((a, b) => b.score - a.score)
      .map((p, i) => ({
        id: p.id,
        name: p.id === this.myId ? 'You' : p.name,
        score: p.score,
        leading: !this.isSolo && i === 0 && p.score > 0,
        left: p.left,
        dead: p.dead,
        over: this.isOver,
        uncovered: p.uncovered,
        flagsRight: p.flagsRight,
        flagsWrong: p.flagsWrong,
        booms: p.booms,
        swatch: htmlSafe(`background: ${PLAYER_COLORS[p.color % PLAYER_COLORS.length]}`),
      }));
  }

  get status() {
    const v = this.view;
    if (!v) return '';
    if (v.status === 'drop') return 'Dropping in…';
    if (v.status === 'playing') {
      if (this.iAmOut) return 'Boom! You’re out. The others play on.';
      if (this.stunned) return 'Boom! You’re stunned for a moment.';
      return this.isSolo ? 'Walk onto a tile, then dig it or flag it. Don’t dig the mines.' : 'Dig tiles for points, flag the mines, avoid the booms. Highest score wins.';
    }
    const everyoneOut = v.players.every((p) => p.dead || p.left);
    if (this.isSolo && v.players[0].dead) return `Boom! Game over. You scored ${v.players[0].score}.`;
    const cleared = v.safeLeft <= 0 ? 'Field cleared!' : everyoneOut ? 'Everyone blew up!' : 'Time’s up!';
    if (this.isSolo) return `${cleared} You scored ${v.players[0].score}.`;
    if (v.winner === null) return `${cleared} A tie for the top score.`;
    const winner = v.players.find((p) => p.id === v.winner);
    return v.winner === this.myId ? `${cleared} You win with ${winner.score}!` : `${cleared} ${winner?.name ?? 'Someone'} wins with ${winner?.score ?? 0}.`;
  }

  // ─── Game loop ───────────────────────────────────────────────────────

  start = () => {
    const seats = this.seats;
    this.avatars = new Map(seats.filter((s) => s.avatar).map((s) => [s.id, s.avatar]));
    this.state = createGame(
      seats.map((s) => ({ id: s.id, name: s.name, bot: s.kind === 'bot' })),
      { field: this.settings.field, time: this.settings.time, stunOnly: this.settings.stunOnly !== false },
    );
    this.brains = new Map();
    this.mode = 'playing';
    this.room.setLocked(true);
    this.room.resetReady();
    this.room.debug.clearHistory();
    const bots = this.state.players.filter((p) => p.bot);
    if (bots.length) this.chatter.say(bots[Math.floor(Math.random() * bots.length)].name, 'minesHello', { urgent: true });
    const mine = this.state.players.find((p) => p.id === this.myId);
    this.me = mine ? { x: mine.x, y: mine.y, face: 0, moving: false } : null;
    this.publish(true);
    this.stopTimer();
    this.timer = setInterval(() => this.simulate(), SIM_MS);
  };

  stopTimer() {
    clearInterval(this.timer);
    this.timer = null;
  }

  simulate() {
    const state = this.state;
    if (!state) return;
    const dt = SIM_MS / 1000;
    tick(state, SIM_MS);
    for (const player of state.players) {
      if (!player.bot) continue;
      let brain = this.brains.get(player.id);
      if (!brain) this.brains.set(player.id, (brain = {}));
      const done = botStep(state, player, brain, dt);
      if (done?.result === 'boom') this.chatter.say(player.name, 'minesBoom', { chance: 0.7 });
      else if (done?.result === 'flag') this.chatter.say(player.name, 'minesFlag', { chance: 0.08 });
    }
    if (state.status === 'over') {
      const winner = state.players.find((p) => p.id === state.winner);
      if (winner?.bot) this.chatter.say(winner.name, 'minesWin', { urgent: true });
      this.stopTimer();
      this.publish(true);
      return;
    }
    this.steps++;
    this.publish(this.steps % SEND_EVERY === 0);
  }

  // Shows the game here, and (every few steps, or right after something happens) sends it to the guests.
  publish(send) {
    const view = viewOf(this.state);
    this.show(view);
    if (send && this.room.isOnline) this.room.send({ type: 'view', view });
  }

  show(view) {
    this.playSounds(view);
    this.latest = view;
    // The scoreboard doesn't need every step.
    if (!this.view || view.status !== this.view.status || this.steps % 4 === 0 || !this.isHostSide) this.view = view;
    this.scene?.setView(view, { myId: this.myId, avatars: this.avatarMap(view) });
  }

  avatarMap(view) {
    for (const seat of this.seats) if (seat.avatar && !this.avatars.has(seat.id)) this.avatars.set(seat.id, seat.avatar);
    for (const p of view.players) if (p.bot && !this.avatars.has(p.id)) this.avatars.set(p.id, robotAvatar(this.settings.botSeed, Number(p.id.split('-')[1]) - 1));
    return this.avatars;
  }

  playSounds(view) {
    const prev = this.latest;
    if (!prev || (view.status === 'drop' && prev.status !== 'drop')) {
      this.lastSound = 0;
      setTimeout(() => sfx('mines.land'), DROP_MS * 0.7);
    }
    for (const event of view.events) {
      if (event.id <= this.lastSound) continue;
      this.lastSound = event.id;
      const nearby = event.by === this.myId || (this.me && Math.hypot(event.x + 0.5 - this.me.x, event.y + 0.5 - this.me.y) < 6);
      if (event.kind === 'dig' && nearby) sfx(event.count >= 8 ? 'mines.clear' : 'mines.dig');
      else if (event.kind === 'boom') {
        sfx('mines.boom');
        if (event.by === this.myId) setTimeout(() => sfx(event.dead ? 'snake.die' : 'mines.stun'), 300);
      }
      else if ((event.kind === 'flag' || event.kind === 'unflag') && nearby) sfx('mines.flag');
      else if (event.kind === 'start') sfx('mines.start');
      else if (event.kind === 'over') {
        const won = view.players.length === 1 ? view.safeLeft <= 0 && !event.blownUp : event.winner === this.myId;
        setTimeout(() => sfx(won ? 'mines.win' : 'mines.lose'), 500);
      }
    }
  }

  // ─── The 3D field, and walking ───────────────────────────────────────

  setupScene = modifier((canvas) => {
    this.canvas = canvas;
    let cancelled = false;
    let scene = null;
    import('../lazy/mines-scene')
      .then(({ createMinesScene }) => {
        if (cancelled) return;
        scene = createMinesScene(canvas);
        this.scene = scene;
        if (this.latest) scene.setView(this.latest, { myId: this.myId, avatars: this.avatarMap(this.latest) });
      })
      .catch((error) => {
        console.warn('3D minefield unavailable:', error);
        this.sceneFailed = true;
      });
    let last = performance.now();
    let sentAt = 0;
    let frame = requestAnimationFrame(function step(now) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.walkFrame(dt, now, () => {
        if (now - sentAt < POS_SEND_MS) return;
        sentAt = now;
        this.sendPosition();
      });
      frame = requestAnimationFrame(step.bind(this));
    }.bind(this));
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      scene?.dispose();
      this.scene = null;
      this.canvas = null;
    };
  });

  walkFrame(dt, now, sendSoon) {
    const view = this.latest;
    if (!view || !this.me || this.mode !== 'playing') return;
    let dx = this.stick.x + padStick('left').x;
    let dy = this.stick.y + padStick('left').y;
    if (this.held.has('left')) dx -= 1;
    if (this.held.has('right')) dx += 1;
    if (this.held.has('up')) dy -= 1;
    if (this.held.has('down')) dy += 1;
    const mine = view.players.find((p) => p.id === this.myId);
    if (this.isHostSide) {
      const player = this.state?.players.find((p) => p.id === this.myId);
      if (!player) return;
      walk(this.state, player, dx, dy, dt);
      Object.assign(this.me, { x: player.x, y: player.y, face: player.face, moving: player.moving });
    } else {
      const body = { ...this.me, stun: mine?.stun ?? 0, dead: mine?.dead };
      walk(view, body, dx, dy, dt);
      const moved = body.x !== this.me.x || body.y !== this.me.y || body.moving !== this.me.moving;
      Object.assign(this.me, { x: body.x, y: body.y, face: body.face, moving: body.moving });
      if (moved) sendSoon();
    }
    // Footsteps while you walk.
    this.stepTimer = this.me.moving ? (this.stepTimer ?? 0) - dt : 0;
    if (this.me.moving && this.stepTimer <= 0) {
      this.stepTimer = 0.29;
      sfx('mines.step');
    }
    this.scene?.setMe(this.me);
  }

  sendPosition() {
    if (!this.me || this.isHostSide) return;
    this.room.send({ type: 'pos', x: this.me.x, y: this.me.y, face: this.me.face, moving: this.me.moving });
  }

  act(action) {
    if (!this.me || this.view?.status !== 'playing' || this.mePlayer?.dead) return;
    const [x, y] = tileAt(this.latest, this.me.x, this.me.y);
    if (this.isHostSide) {
      const result = action === 'dig' ? dig(this.state, this.myId, x, y) : toggleFlag(this.state, this.myId, x, y);
      if (result) this.publish(true);
    } else {
      this.sendPosition();
      this.room.send({ type: action, x, y });
    }
  }

  digHere = () => this.act('dig');
  flagHere = () => this.act('flag');

  stickMoved = (x, y) => {
    this.stick = { x, y };
  };

  stickReleased = () => {
    this.stick = { x: 0, y: 0 };
  };

  onAction(action, { repeat } = {}) {
    if (MOVES.has(action)) {
      this.held.add(action);
      return true;
    }
    if (action === 'dig' || action === 'flag') {
      if (!repeat) this.act(action);
      return true;
    }
    if (action === 'chat') {
      openChat();
      return true;
    }
    return false;
  }

  // Buttons act on press, not release, for the same reason as Snake's.
  pressButton = modifier((button, [handler]) => {
    const press = (event) => {
      event.preventDefault();
      handler();
    };
    const click = (event) => {
      if (event.detail === 0) handler();
    };
    button.addEventListener('pointerdown', press);
    button.addEventListener('click', click);
    return () => {
      button.removeEventListener('pointerdown', press);
      button.removeEventListener('click', click);
    };
  });

  // ─── Debug ───────────────────────────────────────────────────────────

  debugTools() {
    return {
      players: () => (this.state?.players ?? this.seats).map((p) => ({ id: p.id, name: p.name })),
      describe: () => (this.state ? `Minesweeper: ${this.state.status}, ${this.state.safeLeft} safe tiles left, ${Math.ceil(this.state.timeLeft / 1000)}s. ${this.state.players.map((p) => `${p.name} ${p.score}`).join('; ')}.` : 'Minesweeper: in the lobby.'),
      snapshot: () => (this.state ? structuredClone(this.state) : null),
      restore: (snap) => {
        this.state = snap;
        this.publish(true);
        if (snap.status !== 'over' && !this.timer) this.timer = setInterval(() => this.simulate(), SIM_MS);
      },
      commands: {},
    };
  }

  // ─── Lobby ───────────────────────────────────────────────────────────

  setRule = (key, value) => this.room.setSettings({ [key]: value });
  addBot = () => this.room.setSettings({ bots: Math.min(this.settings.bots + 1, MAX_PLAYERS - this.room.members.length) });
  removeBot = () => this.room.setSettings({ bots: Math.max(0, Math.min(this.settings.bots, MAX_PLAYERS - this.room.members.length) - 1) });
  playAgain = () => this.room.allReady && this.start();
  readyCheck = () => this.room.callReadyCheck();

  askLobby = () => {
    if (this.isOver) this.toLobby();
    else this.confirmingLobby = true;
  };

  cancelLobby = () => (this.confirmingLobby = false);

  get lobbyWarning() {
    return this.room.isOnline ? 'The game in progress will be cancelled for everyone on the field.' : 'The game in progress will be cancelled and your score will be lost.';
  }

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
    this.view = null;
    this.latest = null;
    this.state = null;
    this.me = null;
    this.held.clear();
  }

  leave = async () => {
    if (this.mode === 'playing' && !this.isOver && !(await askConfirm({ title: 'Leave the game?', message: 'You’ll be disconnected and leave the field.', confirmLabel: 'Hold to leave', cancelLabel: 'Keep playing' }))) return;
    this.room.close();
    this.backToLobby();
  };

  // ─── Online ──────────────────────────────────────────────────────────

  onlineMessage(message, from) {
    if (this.isHostSide) {
      const state = this.state;
      const player = state?.players.find((p) => p.id === from);
      if (!player) return;
      if (message.type === 'pos') {
        if (![message.x, message.y, message.face].every(Number.isFinite) || player.stun > 0 || player.dead || state.status !== 'playing') return;
        player.x = Math.max(0.2, Math.min(state.width - 0.2, message.x));
        player.y = Math.max(0.2, Math.min(state.height - 0.2, message.y));
        player.face = message.face;
        player.moving = Boolean(message.moving);
      } else if (message.type === 'dig' || message.type === 'flag') {
        const x = Math.round(message.x);
        const y = Math.round(message.y);
        if (Math.hypot(x + 0.5 - player.x, y + 0.5 - player.y) > REACH) return;
        const result = message.type === 'dig' ? dig(state, from, x, y) : toggleFlag(state, from, x, y);
        if (result) this.publish(true);
      }
      return;
    }
    if (message.type === 'view') {
      const view = message.view;
      const fresh = !this.latest || (view.status === 'drop' && this.latest.status !== 'drop');
      if (fresh || !this.me) {
        const mine = view.players.find((p) => p.id === this.myId);
        this.me = mine ? { x: mine.x, y: mine.y, face: mine.face, moving: false } : null;
      }
      this.mode = 'playing';
      this.show(view);
    } else if (message.type === 'lobby') {
      this.backToLobby();
    }
  }

  <template>
    <ToolPage @route="minesweeper" @game={{true}} @busy={{this.busy}} @closeWarning={{this.closeWarning}} @subtitle="Drop onto a 3D minefield, walk around, dig and flag. Up to four players on one field: the highest score wins.">
      {{#if (eq this.mode "playing")}}
        <div class="game-shell uno-shell arcade-shell pop-in">
          <div class="uno-stage arcade-stage mines-stage">
            <canvas class="snake-canvas" aria-label="Minefield. Walk with the arrow keys or WASD, dig with Space and flag with F, or use the joystick and buttons on a touch screen." {{this.setupScene}}></canvas>

            <div class="uno-overlay uno-top-left arcade-scores">
              <div class="mines-hud">
                <span class="arcade-chip {{if this.lowTime 'is-low'}}"><Icon @name="timer" @size={{14}} /> <strong>{{this.clock}}</strong></span>
                <span class="arcade-chip"><Icon @name="bomb" @size={{14}} /> <strong>{{this.minesLeft}}</strong></span>
                <span class="arcade-chip"><Icon @name="shovel" @size={{14}} /> <strong>{{this.tilesLeft}}</strong></span>
              </div>
              {{#each this.scores key="id" as |s|}}
                <span class="snake-score arcade-chip {{if s.leading 'is-leading'}} {{if s.left 'is-dead'}} {{if s.dead 'is-dead'}}">
                  <span class="snake-swatch" style={{s.swatch}}></span>
                  {{#if s.leading}}<Icon @name="crown" @size={{12}} />{{/if}}
                  {{s.name}}
                  <strong>{{s.score}}</strong>
                  {{#if s.over}}<span class="mines-detail"><Icon @name="shovel" @size={{11}} /> {{s.uncovered}} <Icon @name="flag" @size={{11}} /><Icon @name="check" @size={{11}} /> {{s.flagsRight}} <Icon @name="flag" @size={{11}} /><Icon @name="x" @size={{11}} /> {{s.flagsWrong}} <Icon @name="bomb" @size={{11}} /> {{s.booms}}</span>{{/if}}
                </span>
              {{/each}}
            </div>

            <p class="uno-overlay uno-status {{if this.isOver 'is-over'}}" role="status">{{this.status}}</p>

            <div class="uno-overlay uno-top-right">
              {{#if this.isHostSide}}
                {{#if this.isOver}}
                  {{#unless this.room.allReady}}
                    <span class="arcade-chip">{{this.room.readyCount}}/{{this.room.members.length}} ready</span>
                    <button type="button" class="btn" {{on "click" this.readyCheck}}><Icon @name="bell-ring" @size={{13}} /> Ready check</button>
                  {{/unless}}
                  <button type="button" class="btn active" disabled={{if this.room.allReady false true}} {{on "click" this.playAgain}}><Icon @name="rotate-cw" @size={{13}} /> Play again</button>
                {{/if}}
                <button type="button" class="btn" {{on "click" this.askLobby}}><Icon @name="users" @size={{13}} /> Lobby</button>
              {{else}}
                {{#if this.isOver}}
                  <ReadyButton @room={{this.room}} @label="Play again?" @readyLabel="Ready for another" />
                  {{#if this.room.iAmReady}}<span class="arcade-chip">Waiting for the host…</span>{{/if}}
                {{/if}}
                <button type="button" class="btn" {{on "click" this.leave}}><Icon @name="log-out" @size={{13}} /> Leave</button>
              {{/if}}
            </div>

            {{#if (eq this.view.status "drop")}}<span class="snake-paused">Dropping in…</span>{{/if}}
            {{#if this.iAmOut}}<span class="snake-paused mines-stunned"><Icon @name="bomb" @size={{16}} /> You’re out!</span>{{else if this.stunned}}<span class="snake-paused mines-stunned"><Icon @name="sparkles" @size={{16}} /> Stunned!</span>{{/if}}
            {{#if this.sceneFailed}}
              <p class="snake-fallback">The 3D minefield couldn’t start on this device (WebGL is needed).</p>
            {{/if}}

            <div class="snake-touch">
              <Joystick @class="snake-joystick" @label="Walk" @onMove={{this.stickMoved}} @onEnd={{this.stickReleased}} />
              <div class="mines-buttons">
                <button type="button" class="snake-boost mines-flag-btn" data-sound="off" {{this.pressButton this.flagHere}}><Icon @name="flag" @size={{22}} /><span>Flag</span></button>
                <button type="button" class="snake-boost mines-dig-btn" data-sound="off" {{this.pressButton this.digHere}}><Icon @name="shovel" @size={{24}} /><span>Dig</span></button>
              </div>
            </div>

            <div class="uno-overlay arcade-controls {{if this.padActive 'is-pad'}}" aria-label="Controls">
              {{#each this.controls as |c|}}
                {{#if this.padActive}}
                  {{#if c.pad.length}}
                    <div class="arcade-control"><span class="arcade-control-keys">{{#each c.pad as |b|}}<span class="pad-button is-{{b.id}}">{{b.label}}</span>{{/each}}</span><span class="arcade-control-label">{{c.label}}</span></div>
                  {{/if}}
                {{else if c.keys.length}}
                  <div class="arcade-control"><span class="arcade-control-keys">{{#each c.keys as |k|}}<kbd class="keycap">{{k}}</kbd>{{/each}}</span><span class="arcade-control-label">{{c.label}}</span></div>
                {{/if}}
              {{/each}}
            </div>

            <GameChat @room={{this.room}} @floating={{true}} @class="uno-overlay uno-chat arcade-chat" />
          </div>
          {{#if this.confirmingLobby}}
            <HoldConfirm @title="Back to the lobby?" @message={{this.lobbyWarning}} @confirmLabel="Hold to end game" @onConfirm={{this.toLobby}} @onCancel={{this.cancelLobby}} />
          {{/if}}
        </div>
      {{else}}
        <GameLobby @room={{this.room}} @seats={{this.seats}} @maxSeats={{4}} @onAddBot={{this.addBot}} @onRemoveBot={{this.removeBot}} @onStart={{this.start}}>
          <:rules>
            <div class="lobby-rule">
              <span class="lobby-rule-text"><span class="qr-label">Field</span></span>
              <div class="math-tabs" role="group" aria-label="Field size">
                {{#each this.fields as |f|}}
                  <button type="button" class="qr-tab {{if (eq this.settings.field f.id) 'active'}}" title="{{f.width}}×{{f.height}}, {{f.mines}} mines" aria-pressed={{if (eq this.settings.field f.id) "true" "false"}} {{on "click" (fn this.setRule "field" f.id)}}>{{f.label}}</button>
                {{/each}}
              </div>
            </div>
            <div class="lobby-rule">
              <span class="lobby-rule-text"><span class="qr-label">Bombs only stun</span><span class="tool-hint">Off: digging a mine knocks you out of the game. On your own, that ends it and shows every mine, like classic Minesweeper.</span></span>
              <div class="math-tabs" role="group" aria-label="Bombs only stun">
                {{#each this.onOff as |o|}}
                  <button type="button" class="qr-tab {{if (eq this.settings.stunOnly o.id) 'active'}}" aria-pressed={{if (eq this.settings.stunOnly o.id) "true" "false"}} {{on "click" (fn this.setRule "stunOnly" o.id)}}>{{o.label}}</button>
                {{/each}}
              </div>
            </div>
            <div class="lobby-rule">
              <span class="lobby-rule-text"><span class="qr-label">Time limit</span></span>
              <div class="math-tabs" role="group" aria-label="Time limit">
                {{#each this.times as |t|}}
                  <button type="button" class="qr-tab {{if (eq this.settings.time t.id) 'active'}}" aria-pressed={{if (eq this.settings.time t.id) "true" "false"}} {{on "click" (fn this.setRule "time" t.id)}}>{{t.label}}</button>
                {{/each}}
              </div>
            </div>
            <p class="tool-hint">Walk with the arrow keys or WASD, dig the tile under your feet with Space and flag it with F (or the joystick and buttons on a touch screen). Every tile you uncover is a point, a mine costs 10 and stuns you (or knocks you out, with Bombs only stun off), and at the end each flag on a mine is worth +2 (−2 if it wasn’t). The game ends when the field is cleared or time runs out, and the highest score wins.</p>
          </:rules>
        </GameLobby>
      {{/if}}
    </ToolPage>
  </template>
}
