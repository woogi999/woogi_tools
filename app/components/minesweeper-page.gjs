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
import ArcadeRadar from './arcade-radar';
import GameLobby, { ReadyButton } from './game-lobby';
import LevelEditor from './level-editor';
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
import DefusePuzzle from './defuse-puzzle';
import {
  DEFUSED,
  RUN_MODES,
  STAMINA_MAX,
  TIME_RANGE,
  runStep,
  stepOn,
  resolveDefuse,
  startDefuse,
} from '../utils/minesweeper';
import { PUZZLE_TYPES } from '../utils/defuse-puzzles';
import { CommandError } from '../utils/debug-commands';
import {
  MAX_PLAYERS,
  FIELDS,
  PLAYER_COLORS,
  HIDDEN,
  EXPLODED,
  DROP_MS,
  BLAST_RADIUS,
  BLAST_RADIUS_RANGE,
  MINE_PERCENT_RANGE,
  BOT_LEVELS,
  DEATH_MODES,
  LIVES_RANGE,
  createGame,
  dig,
  toggleFlag,
  removePlayer,
  walk,
  tick,
  viewOf,
  botStep,
  tileAt,
  themeOf,
} from '../utils/minesweeper';
import { sfx, preloadSounds } from '../utils/sound';
import noImageSave from '../utils/no-image-save';
import GameSettings from './game-settings';
import { listLevels, findLevel, mineLayout } from '../utils/levels';

// Views go over the wire packed small: PeerJS refuses a JSON message over ~16 KB and errors the
// connection, which drops the player. A big field (with every mine added once the game's over)
// went past that. Cells become one character each; flags and mines only list the tiles that have them.
function packView(view) {
  const flags = [];
  view.flags.forEach((owner, i) => owner && flags.push(i, owner));
  const mines = [];
  view.mines?.forEach((mine, i) => mine && mines.push(i));
  return {
    ...view,
    cells: view.cells.map((c) => String.fromCharCode(c + 49)).join(''),
    flags,
    mines: view.mines ? mines : null,
  };
}

function unpackView(packed) {
  const count = packed.width * packed.height;
  const flags = Array(count).fill(null);
  for (let i = 0; i + 1 < packed.flags.length; i += 2)
    flags[packed.flags[i]] = packed.flags[i + 1];
  let mines = null;
  if (packed.mines) {
    mines = Array(count).fill(false);
    for (const i of packed.mines) mines[i] = true;
  }
  return {
    ...packed,
    cells: Array.from(packed.cells, (ch) => ch.charCodeAt(0) - 49),
    flags,
    mines,
  };
}

// Minimap number colours (the same as on the tiles).
const MAP_NUMBER_COLORS = [
  '',
  '#2f6fe0',
  '#2e9e4f',
  '#e5484d',
  '#3a3fa8',
  '#9b2c2c',
  '#15999a',
  '#141414',
  '#7a7a7a',
];

const DEFAULTS = {
  field: 'normal',
  time: 300,
  bots: 1,
  stunOnly: true,
  deathMode: 'out',
  lives: 3,
  blast: false,
  blastRadius: 2,
  sprint: false,
  minePercent: null,
  botLevel: 'normal',
  botLevels: {},
  run: 'off',
  defuse: false,
};
const SIM_MS = 50;
const SEND_EVERY = 2; // simulation steps between updates to guests (10 a second)
const POS_SEND_MS = 80;
// How close (in tiles) a guest has to be to a tile to dig or flag it, give or take lag.
const REACH = 1.6;
const MOVES = new Set(['up', 'down', 'left', 'right']);
// Actions that last while held.
const HOLDS = new Set([...MOVES, 'run']);

const eq = (a, b) => a === b;

export default class MinesweeperPage extends Component {
  fields = FIELDS;
  botLevels = BOT_LEVELS;
  runModes = RUN_MODES;
  percentMin = MINE_PERCENT_RANGE[0];
  percentMax = MINE_PERCENT_RANGE[1];
  radiusMin = BLAST_RADIUS_RANGE[0];
  radiusMax = BLAST_RADIUS_RANGE[1];
  @tracked sprinting = false;

  // 'lobby' | 'playing'
  @tracked mode = 'lobby';
  // The latest view, refreshed a few times a second for the scores and timer.
  @tracked view = null;
  @tracked sceneFailed = false;
  // The player a spectator has chosen to follow, or null for whoever is first.
  @tracked spectateId = null;
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
    const stopInput = listenForActions('mines', {
      active,
      onAction: (action, info) => this.onAction(action, info),
    });
    const keyUp = (event) => {
      const action = actionForKey('mines', event);
      if (HOLDS.has(action)) this.held.delete(action);
    };
    const blur = () => this.held.clear();
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', blur);
    // The D-pad walks while held, so it needs the releases too.
    const releasePad = pushPadHandler((button, { down }) => {
      const action = actionForPad('mines', button);
      if (!HOLDS.has(action) || !active()) return false;
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
      clearTimeout(this.sprintTimer);
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
    // Spectators are in the room but take no seat.
    const humans = this.room.players.map((m) => ({ ...m, kind: 'human' }));
    const bots = Math.max(
      0,
      Math.min(this.settings.bots, MAX_PLAYERS - humans.length),
    );
    return [
      ...humans,
      ...botNames(this.settings.botSeed, bots).map((name, i) => ({
        id: `bot-${i + 1}`,
        name,
        kind: 'bot',
        avatar: robotAvatar(this.settings.botSeed, i),
      })),
    ];
  }

  get isSolo() {
    return this.view?.players.length === 1;
  }

  get isOver() {
    return this.view?.status === 'over';
  }

  getScene = () => this.scene;

  // The whole field in miniature, in the game's theme: covered and dug tiles, the numbers, flags and blown mines, and everyone with their names (you outlined).
  drawMap = (ctx, size, scale = 1) => {
    const v = this.latest;
    if (!v) return;
    const theme = themeOf(v.theme);
    const cell = size / Math.max(v.width, v.height);
    const sq = Math.ceil(cell);
    const ox = (size - cell * v.width) / 2;
    const oy = (size - cell * v.height) / 2;
    // Numbers only once they're big enough to read (always on the enlarged map).
    const numbers = cell >= 6 * scale;
    ctx.font = `800 ${Math.round(cell * 0.78)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let y = 0; y < v.height; y++) {
      for (let x = 0; x < v.width; x++) {
        const i = y * v.width + x;
        const c = v.cells[i];
        const odd = (x + y) % 2;
        ctx.fillStyle =
          c === DEFUSED
            ? '#4d8ff0'
            : c === EXPLODED || (c === HIDDEN && v.mines?.[i])
              ? '#2b2b2b'
              : c === HIDDEN
                ? v.flags[i]
                  ? '#e5484d'
                  : theme.grass[odd]
                : theme.sand[odd];
        ctx.fillRect(ox + x * cell, oy + y * cell, sq, sq);
        if (numbers && c >= 1 && c <= 8) {
          ctx.fillStyle = MAP_NUMBER_COLORS[c];
          ctx.fillText(
            String(c),
            ox + (x + 0.5) * cell,
            oy + (y + 0.54) * cell,
          );
        }
      }
    }
    const nameSize = Math.round(
      Math.max(9 * scale, Math.min(14 * scale, size / 18)),
    );
    for (const p of v.players) {
      if (p.left) continue;
      const mine = p.id === this.myId;
      const pos = mine && this.me ? this.me : p;
      const px = ox + pos.x * cell;
      const py = oy + pos.y * cell;
      const radius = Math.max(3 * scale, cell * 0.7);
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fillStyle = p.dead
        ? '#9e9e9e'
        : PLAYER_COLORS[p.color % PLAYER_COLORS.length];
      ctx.fill();
      ctx.lineWidth = Math.max(1.5 * scale, cell * 0.22);
      ctx.strokeStyle = mine ? '#ffffff' : '#141414';
      ctx.stroke();
      // The name above the dot, kept inside the map.
      ctx.font = `700 ${nameSize}px system-ui, sans-serif`;
      const half = ctx.measureText(p.name).width / 2 + 2 * scale;
      const nx = Math.max(half, Math.min(size - half, px));
      const ny = Math.max(nameSize / 2 + scale, py - radius - nameSize * 0.7);
      ctx.lineWidth = 3 * scale;
      ctx.strokeStyle = 'rgb(20 20 20 / 85%)';
      ctx.strokeText(p.name, nx, ny);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(p.name, nx, ny);
    }
  };

  get busy() {
    return (this.mode === 'playing' && !this.isOver) || this.room.isOnline;
  }

  get closeWarning() {
    if (this.room.isOnline)
      return this.room.isHost
        ? 'Close Minesweeper? You’re hosting, so this ends the game and closes the room for everyone.'
        : 'Close Minesweeper? You’ll be disconnected from the game.';
    return 'Close Minesweeper? The game in progress will be lost.';
  }

  get mePlayer() {
    return this.view?.players.find((p) => p.id === this.myId) ?? null;
  }

  // The key reminders in the corner: keyboard keys, or controller buttons once a controller's in use (touch screens hide it).
  get controls() {
    const run = this.view?.run === 'risky' || this.view?.run === 'stamina';
    return controlHints('mines', [
      { label: 'Walk', actions: ['up', 'left', 'down', 'right'] },
      ...(run ? [{ label: 'Run (hold)', actions: ['run'] }] : []),
      { label: 'Dig', actions: ['dig'] },
      { label: 'Flag', actions: ['flag'] },
      { label: 'Chat', actions: ['chat'] },
    ]);
  }

  get padActive() {
    return padState.active;
  }

  // Watching rather than playing: you chose it in the lobby and never got a seat.
  get iAmSpectator() {
    return this.room.iAmSpectating;
  }

  // Out of the game for good, with the game still going on around you. A
  // spectator is in the same position from the first second, so the same
  // camera, banner and player picker serve both.
  get iAmOut() {
    return (
      (this.iAmSpectator || Boolean(this.mePlayer?.dead)) &&
      this.view?.status === 'playing'
    );
  }

  // Blown up but coming back, on the Respawn and Lives modes.
  get iAmDown() {
    return (this.mePlayer?.downMs ?? 0) > 0 && this.view?.status === 'playing';
  }

  get downSeconds() {
    return Math.ceil((this.mePlayer?.downMs ?? 0) / 1000);
  }

  get livesLeft() {
    return this.view?.deathMode === 'lives' && !this.view?.stunOnly
      ? (this.mePlayer?.livesLeft ?? 0)
      : null;
  }

  // Everyone still playing, for the spectator to pick from.
  get watchable() {
    return (this.view?.players ?? []).filter(
      (p) => p.id !== this.myId && !p.dead && !p.left,
    );
  }

  // Who the camera follows. Only meaningful once you're out; if the person you
  // were watching is knocked out too, it moves on to whoever is left.
  get watchId() {
    if (!this.iAmOut) return null;
    const list = this.watchable;
    if (!list.length) return null;
    return list.some((p) => p.id === this.spectateId)
      ? this.spectateId
      : list[0].id;
  }

  // A spectator never was in the game; someone knocked out was.
  get spectateLabel() {
    return this.iAmSpectator ? 'Watching' : "You're out. Watching";
  }

  get watching() {
    return this.view?.players.find((p) => p.id === this.watchId) ?? null;
  }

  // Cycle through the survivors, in either direction.
  spectateStep = (step) => {
    const list = this.watchable;
    if (!list.length) return;
    const at = Math.max(
      0,
      list.findIndex((p) => p.id === this.watchId),
    );
    this.spectateId = list[(at + step + list.length) % list.length].id;
    sfx('ui.click');
  };

  spectateNext = () => this.spectateStep(1);
  spectatePrev = () => this.spectateStep(-1);

  get stunned() {
    return (this.mePlayer?.stun ?? 0) > 0 && this.view?.status === 'playing';
  }

  get clock() {
    const s = Math.ceil((this.view?.timeLeft ?? 0) / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // The clock grows and beats harder as the time goes: a minute left, then half a minute, then the last ten seconds.
  get timeClass() {
    if (this.view?.status !== 'playing') return '';
    const left = this.view?.timeLeft ?? Infinity;
    if (left <= 10000) return 'is-warn is-low is-final';
    if (left <= 30000) return 'is-warn is-low';
    if (left <= 60000) return 'is-warn';
    return '';
  }

  get minesLeft() {
    const v = this.view;
    if (!v) return 0;
    const marked = v.cells.filter(
      (c, i) => c === EXPLODED || c === DEFUSED || (c === HIDDEN && v.flags[i]),
    ).length;
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
        defused: p.defused,
        swatch: htmlSafe(
          `background: ${PLAYER_COLORS[p.color % PLAYER_COLORS.length]}`,
        ),
      }));
  }

  get status() {
    const v = this.view;
    if (!v) return '';
    if (v.status === 'drop') return 'Dropping in…';
    if (v.status === 'playing') {
      if (this.iAmOut) return 'Boom! You’re out. The others play on.';
      if (this.myDefusing)
        return 'You stepped on a mine! Defuse it before the timer runs out.';
      if (this.stunned) return 'Boom! You’re stunned for a moment.';
      return this.isSolo
        ? 'Walk onto a tile, then dig it or flag it. Don’t dig the mines.'
        : 'Dig tiles for points, flag the mines, avoid the booms. Highest score wins.';
    }
    const everyoneOut = v.players.every((p) => p.dead || p.left);
    if (this.isSolo && v.players[0].dead)
      return `Boom! Game over. You scored ${v.players[0].score}.`;
    const cleared =
      v.safeLeft <= 0
        ? 'Field cleared!'
        : everyoneOut
          ? 'Everyone blew up!'
          : 'Time’s up!';
    if (this.isSolo) return `${cleared} You scored ${v.players[0].score}.`;
    if (v.winner === null) return `${cleared} A tie for the top score.`;
    const winner = v.players.find((p) => p.id === v.winner);
    return v.winner === this.myId
      ? `${cleared} You win with ${winner.score}!`
      : `${cleared} ${winner?.name ?? 'Someone'} wins with ${winner?.score ?? 0}.`;
  }

  // ─── Game loop ───────────────────────────────────────────────────────

  start = () => {
    const seats = this.seats;
    this.avatars = new Map(
      seats.filter((s) => s.avatar).map((s) => [s.id, s.avatar]),
    );
    this.state = createGame(
      seats.map((s) => ({
        id: s.id,
        name: s.name,
        bot: s.kind === 'bot',
        botLevel: s.kind === 'bot' ? this.levelForSeat(s.id) : null,
      })),
      {
        run: this.settings.run,
        defuse: this.settings.defuse === true,
        field: this.settings.field,
        time: this.settings.time,
        stunOnly: this.settings.stunOnly !== false,
        custom: this.customLayout,
        deathMode: this.settings.deathMode ?? 'out',
        lives: this.settings.lives ?? 3,
        blast: this.settings.blast === true,
        blastRadius: this.settings.blastRadius,
        sprint: this.settings.sprint === true,
        minePercent: this.settings.minePercent ?? null,
        botLevel: this.settings.botLevel,
      },
    );
    this.brains = new Map();
    this.mode = 'playing';
    this.room.setLocked(true);
    this.room.resetReady();
    this.room.debug.clearHistory();
    const bots = this.state.players.filter((p) => p.bot);
    if (bots.length)
      this.chatter.say(
        bots[Math.floor(Math.random() * bots.length)].name,
        'minesHello',
        { urgent: true },
      );
    const mine = this.state.players.find((p) => p.id === this.myId);
    this.me = mine
      ? { x: mine.x, y: mine.y, face: 0, moving: false, stamina: STAMINA_MAX }
      : null;
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
      stepOn(state, player);
      if (done?.result === 'boom')
        this.chatter.say(player.name, 'minesBoom', { chance: 0.7 });
      else if (done?.result === 'flag')
        this.chatter.say(player.name, 'minesFlag', { chance: 0.08 });
    }
    if (state.status === 'over') {
      const winner = state.players.find((p) => p.id === state.winner);
      if (winner?.bot)
        this.chatter.say(winner.name, 'minesWin', { urgent: true });
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
    if (send && this.room.isOnline)
      this.room.send({ type: 'view', view: packView(view) });
  }

  show(view) {
    this.playSounds(view);
    this.latest = view;
    // The scoreboard doesn't need every step.
    const defusingNow = (v) =>
      v?.players.find((p) => p.id === this.myId)?.defusing?.seed ?? null;
    if (
      !this.view ||
      view.status !== this.view.status ||
      this.steps % 4 === 0 ||
      !this.isHostSide ||
      defusingNow(view) !== defusingNow(this.view)
    )
      this.view = view;
    this.scene?.setView(view, {
      myId: this.myId,
      watchId: this.watchId,
      avatars: this.avatarMap(view),
    });
  }

  avatarMap(view) {
    for (const seat of this.seats)
      if (seat.avatar && !this.avatars.has(seat.id))
        this.avatars.set(seat.id, seat.avatar);
    for (const p of view.players)
      if (p.bot && !this.avatars.has(p.id))
        this.avatars.set(
          p.id,
          robotAvatar(this.settings.botSeed, Number(p.id.split('-')[1]) - 1),
        );
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
      const nearby =
        event.by === this.myId ||
        (this.me &&
          Math.hypot(event.x + 0.5 - this.me.x, event.y + 0.5 - this.me.y) < 6);
      if (event.kind === 'dig' && nearby)
        sfx(event.count >= 8 ? 'mines.clear' : 'mines.dig');
      else if (event.kind === 'boom') {
        sfx('mines.boom');
        if (event.by === this.myId)
          setTimeout(() => sfx(event.dead ? 'snake.die' : 'mines.stun'), 300);
        else if (event.stunned?.includes(this.myId))
          setTimeout(() => sfx('mines.stun'), 300);
      } else if ((event.kind === 'flag' || event.kind === 'unflag') && nearby)
        sfx('mines.flag');
      else if (event.kind === 'start') sfx('mines.start');
      else if (event.kind === 'respawn' && event.by === this.myId && this.me) {
        // Back at the spawn point: your own avatar follows, rather than
        // carrying on from where the mine got you.
        Object.assign(this.me, { x: event.x, y: event.y, moving: false });
        sfx('mines.start');
      } else if (event.kind === 'defusing' && event.by === this.myId)
        sfx('mines.stun');
      else if (event.kind === 'defused' && nearby) sfx('mines.clear');
      else if (event.kind === 'sprint') {
        sfx('mines.start');
        this.sprinting = true;
        clearTimeout(this.sprintTimer);
        this.sprintTimer = setTimeout(() => (this.sprinting = false), 3000);
      } else if (event.kind === 'over') {
        const won =
          view.players.length === 1
            ? view.safeLeft <= 0 && !event.blownUp
            : event.winner === this.myId;
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
        if (this.latest)
          scene.setView(this.latest, {
            myId: this.myId,
            avatars: this.avatarMap(this.latest),
          });
      })
      .catch((error) => {
        console.warn('3D minefield unavailable:', error);
        this.sceneFailed = true;
      });
    let last = performance.now();
    let sentAt = 0;
    let frame = requestAnimationFrame(
      function step(now) {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        this.walkFrame(dt, now, () => {
          if (now - sentAt < POS_SEND_MS) return;
          sentAt = now;
          this.sendPosition();
        });
        frame = requestAnimationFrame(step.bind(this));
      }.bind(this),
    );
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
    const wantsRun =
      (this.held.has('run') || this.touchRun) && Math.hypot(dx, dy) > 0.05;
    if (this.isHostSide) {
      const player = this.state?.players.find((p) => p.id === this.myId);
      if (!player) return;
      const speed = player.defusing
        ? 0
        : runStep(this.state, player, wantsRun, dt);
      walk(this.state, player, dx, dy, dt, speed);
      if (stepOn(this.state, player)) this.publish(true);
      Object.assign(this.me, {
        x: player.x,
        y: player.y,
        face: player.face,
        moving: player.moving,
        running: player.running && player.moving,
        stamina: player.stamina,
        winded: player.winded,
      });
    } else {
      const body = {
        ...this.me,
        stun: mine?.stun ?? 0,
        dead: mine?.dead,
        downMs: mine?.downMs ?? 0,
        defusing: mine?.defusing,
      };
      const speed = body.defusing ? 0 : runStep(view, body, wantsRun, dt);
      walk(view, body, dx, dy, dt, speed);
      const moved =
        body.x !== this.me.x ||
        body.y !== this.me.y ||
        body.moving !== this.me.moving;
      Object.assign(this.me, {
        x: body.x,
        y: body.y,
        face: body.face,
        moving: body.moving,
        running: body.running && body.moving,
        stamina: body.stamina,
        winded: body.winded,
      });
      if (moved) sendSoon();
    }
    const stamina = Math.round(this.me.stamina ?? STAMINA_MAX);
    if (stamina !== this.staminaShown) this.staminaShown = stamina;
    const runningNow = Boolean(this.me.running && this.me.moving);
    if (runningNow !== this.iAmRunning) this.iAmRunning = runningNow;
    const windedNow = view.run === 'stamina' && Boolean(this.me.winded);
    if (windedNow !== this.iAmWinded) this.iAmWinded = windedNow;
    // Footsteps while you walk (quicker when running).
    this.stepTimer = this.me.moving ? (this.stepTimer ?? 0) - dt : 0;
    if (this.me.moving && this.stepTimer <= 0) {
      this.stepTimer = this.me.running ? 0.18 : 0.32;
      sfx('mines.step');
    }
    this.scene?.setMe(this.me);
  }

  sendPosition() {
    if (!this.me || this.isHostSide) return;
    this.room.send({
      type: 'pos',
      x: this.me.x,
      y: this.me.y,
      face: this.me.face,
      moving: this.me.moving,
      running: Boolean(this.me.running),
      stamina: Math.round(this.me.stamina ?? STAMINA_MAX),
      winded: Boolean(this.me.winded),
    });
  }

  act(action) {
    if (!this.me || this.view?.status !== 'playing' || this.mePlayer?.dead)
      return;
    const [x, y] = tileAt(this.latest, this.me.x, this.me.y);
    if (this.isHostSide) {
      const result =
        action === 'dig'
          ? dig(this.state, this.myId, x, y)
          : toggleFlag(this.state, this.myId, x, y);
      if (result) this.publish(true);
    } else {
      this.sendPosition();
      this.room.send({ type: action, x, y });
    }
  }

  touchRun = false;

  // Held down on a touch screen, like Shift on a keyboard.
  holdRun = modifier((button) => {
    const down = (event) => {
      event.preventDefault();
      this.touchRun = true;
    };
    const up = () => (this.touchRun = false);
    button.addEventListener('pointerdown', down);
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'])
      button.addEventListener(type, up);
    return () => {
      this.touchRun = false;
      button.removeEventListener('pointerdown', down);
      for (const type of ['pointerup', 'pointercancel', 'pointerleave'])
        button.removeEventListener(type, up);
    };
  });

  get myDefusing() {
    return this.view?.status === 'playing'
      ? (this.mePlayer?.defusing ?? null)
      : null;
  }

  // As a list keyed by seed, so a new mine gets a fresh puzzle.
  get defuseJobs() {
    return this.myDefusing ? [this.myDefusing] : [];
  }

  defuseDone = (ok) => {
    if (this.isHostSide) {
      if (resolveDefuse(this.state, this.myId, ok)) this.publish(true);
    } else {
      this.room.send({ type: 'defuse', ok });
    }
  };

  get viewRunOn() {
    return this.view?.run === 'risky' || this.view?.run === 'stamina';
  }

  get staminaOn() {
    return this.view?.run === 'stamina';
  }

  @tracked staminaShown = STAMINA_MAX;
  @tracked iAmRunning = false;
  @tracked iAmWinded = false;

  get staminaStyle() {
    return htmlSafe(`width: ${this.staminaShown}%`);
  }

  get staminaLow() {
    return this.staminaShown < 35 || this.me?.winded;
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
    // The defuse panel has its own controls.
    if (this.myDefusing && action !== 'chat') return true;
    if (HOLDS.has(action)) {
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
    const need = () => {
      if (!this.state)
        throw new CommandError('No game is running. Start one first.');
      return this.state;
    };
    const playerAt = (ctx, ref) => need().players[ctx.player(ref)];
    const changed = (ctx, label) => {
      this.publish(true);
      this.room.recordDebugState(label);
      ctx.announce(label);
    };
    return {
      players: () =>
        (this.state?.players ?? this.seats).map((p) => ({
          id: p.id,
          name: p.name,
        })),
      describe: () =>
        this.state
          ? `Minesweeper: ${this.state.status}, ${this.state.safeLeft} safe tiles left, ${Math.ceil(this.state.timeLeft / 1000)}s. ${this.state.players.map((p) => `${p.name} ${p.score}`).join('; ')}.`
          : 'Minesweeper: in the lobby.',
      snapshot: () => (this.state ? structuredClone(this.state) : null),
      restore: (snap) => {
        this.state = snap;
        this.publish(true);
        if (snap.status !== 'over' && !this.timer)
          this.timer = setInterval(() => this.simulate(), SIM_MS);
      },
      commands: {
        time: {
          usage: '/time <seconds>',
          help: 'Sets the time left on the clock.',
          run: ([n], ctx) => {
            const state = need();
            const seconds = Math.max(1, Math.min(3600, Math.round(Number(n))));
            if (!Number.isFinite(seconds))
              throw new CommandError('Give a number of seconds.');
            state.timeLeft = seconds * 1000;
            changed(ctx, `${ctx.fromName} set the clock to ${seconds}s.`);
          },
        },
        score: {
          usage: '/score <player> <points>',
          help: 'Sets a player’s score.',
          run: ([ref, n], ctx) => {
            const p = playerAt(ctx, ref);
            p.score = Math.round(Number(n) || 0);
            changed(
              ctx,
              `${ctx.fromName} set ${p.name}’s score to ${p.score}.`,
            );
          },
        },
        stun: {
          usage: '/stun <player> [seconds]',
          help: 'Stuns a player (2.5 seconds by default; 0 wakes them up).',
          run: ([ref, n], ctx) => {
            const p = playerAt(ctx, ref);
            p.stun =
              n === undefined
                ? 2500
                : Math.max(0, Math.min(60, Number(n) || 0)) * 1000;
            changed(
              ctx,
              p.stun
                ? `${ctx.fromName} stunned ${p.name}.`
                : `${ctx.fromName} woke ${p.name} up.`,
            );
          },
        },
        kill: {
          usage: '/kill <player>',
          help: 'Knocks a player out of the game.',
          run: ([ref], ctx) => {
            const p = playerAt(ctx, ref);
            p.dead = true;
            p.defusing = null;
            changed(ctx, `${ctx.fromName} knocked ${p.name} out.`);
          },
        },
        revive: {
          usage: '/revive <player>',
          help: 'Brings a knocked-out player back, unstunned.',
          run: ([ref], ctx) => {
            const p = playerAt(ctx, ref);
            p.dead = false;
            p.stun = 0;
            changed(ctx, `${ctx.fromName} revived ${p.name}.`);
          },
        },
        teleport: {
          usage: '/teleport <player> <x> <y>',
          help: 'Moves a player onto a tile (0 to width−1, 0 to height−1).',
          run: ([ref, x, y], ctx) => {
            const state = need();
            const p = playerAt(ctx, ref);
            const tx = Math.round(Number(x));
            const ty = Math.round(Number(y));
            if (!Number.isFinite(tx) || !Number.isFinite(ty))
              throw new CommandError('Give x and y numbers.');
            p.x = Math.max(0, Math.min(state.width - 1, tx)) + 0.5;
            p.y = Math.max(0, Math.min(state.height - 1, ty)) + 0.5;
            if (p.id === this.myId && this.me)
              Object.assign(this.me, { x: p.x, y: p.y });
            changed(
              ctx,
              `${ctx.fromName} teleported ${p.name} to ${Math.floor(p.x)}, ${Math.floor(p.y)}.`,
            );
          },
        },
        stamina: {
          usage: '/stamina <player> <0-100>',
          help: 'Sets a player’s stamina (Stamina running). 0 leaves them winded.',
          run: ([ref, n], ctx) => {
            const p = playerAt(ctx, ref);
            const value = Math.max(0, Math.min(STAMINA_MAX, Number(n)));
            if (!Number.isFinite(value))
              throw new CommandError('Give a number from 0 to 100.');
            p.stamina = value;
            p.winded = value <= 0;
            p.rest = 0;
            if (p.id === this.myId && this.me)
              Object.assign(this.me, {
                stamina: value,
                winded: p.winded,
                rest: 0,
              });
            changed(
              ctx,
              `${ctx.fromName} set ${p.name}’s stamina to ${Math.round(value)}.`,
            );
          },
        },
        defuse: {
          usage: `/defuse <player> [${PUZZLE_TYPES.join('|')}] [level]`,
          help: 'Puts up a defuse puzzle for a player, on the mine under them (or a practice one if there isn’t one). Level is how many mines they’ve “already defused”.',
          run: ([ref, type, level], ctx) => {
            const state = need();
            if (state.status !== 'playing')
              throw new CommandError('Wait for the game to start.');
            const p = playerAt(ctx, ref);
            if (type && !PUZZLE_TYPES.includes(type))
              throw new CommandError(
                `Puzzle types: ${PUZZLE_TYPES.join(', ')}.`,
              );
            if (p.dead) throw new CommandError(`${p.name} is out.`);
            const [x, y] = tileAt(state, p.x, p.y);
            startDefuse(state, p, x, y, {
              type: type ?? null,
              level:
                level === undefined
                  ? undefined
                  : Math.max(0, Math.min(20, Math.round(Number(level) || 0))),
            });
            changed(
              ctx,
              `${ctx.fromName} gave ${p.name} a ${type ?? 'random'} defuse puzzle.`,
            );
          },
        },
        defused: {
          usage: '/defused <player> <count>',
          help: 'Sets how many mines a player has defused (makes their next puzzle harder and quicker).',
          run: ([ref, n], ctx) => {
            const p = playerAt(ctx, ref);
            p.defused = Math.max(0, Math.min(50, Math.round(Number(n) || 0)));
            changed(
              ctx,
              `${ctx.fromName} set ${p.name}’s defused mines to ${p.defused}.`,
            );
          },
        },
        clear: {
          usage: '/clear [percent]',
          help: 'Uncovers safe tiles at random until that much of the field is dug (90 by default). Needs the mines laid (dig once first).',
          run: ([n], ctx) => {
            const state = need();
            if (!state.mines)
              throw new CommandError(
                'Dig a tile first, so the mines are laid.',
              );
            const target = Math.max(0, Math.min(100, Number(n ?? 90))) / 100;
            const total = state.width * state.height - state.mineCount;
            const hidden = [];
            state.cells.forEach(
              (c, i) => c === HIDDEN && !state.mines[i] && hidden.push(i),
            );
            hidden.sort(() => Math.random() - 0.5);
            let dug = total - state.safeLeft;
            for (const i of hidden) {
              if (dug / total >= target) break;
              state.cells[i] = 0;
              state.flags[i] = null;
              state.safeLeft--;
              dug++;
            }
            // Put the real numbers back on everything uncovered.
            state.cells.forEach((c, i) => {
              if (c < 0 || c > 8) return;
              const x = i % state.width;
              const y = Math.floor(i / state.width);
              let count = 0;
              for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) {
                  const nx = x + dx;
                  const ny = y + dy;
                  if (
                    (dx || dy) &&
                    nx >= 0 &&
                    ny >= 0 &&
                    nx < state.width &&
                    ny < state.height &&
                    state.mines[ny * state.width + nx]
                  )
                    count++;
                }
              state.cells[i] = count;
            });
            changed(
              ctx,
              `${ctx.fromName} dug the field to ${Math.round((dug / total) * 100)}%.`,
            );
          },
        },
        mines: {
          usage: '/mines',
          help: 'Tells you (only you) where every mine is, as x,y.',
          run: () => {
            const state = need();
            if (!state.mines)
              throw new CommandError(
                'No mines yet: they’re laid on the first dig.',
              );
            const spots = [];
            state.mines.forEach(
              (m, i) =>
                m &&
                state.cells[i] === HIDDEN &&
                spots.push(`${i % state.width},${Math.floor(i / state.width)}`),
            );
            return `${spots.length} hidden mines: ${spots.join('  ')}`;
          },
        },
        rule: {
          usage: '/rule <run|defuse|blast|radius|sprint|stun> <value>',
          help: 'Changes a rule mid-game. run: off, risky or stamina. radius: 1 to 6. The rest: on or off.',
          run: ([name, value], ctx) => {
            const state = need();
            const on = /^(on|true|yes|1)$/i.test(value ?? '');
            if (name === 'run') {
              if (!RUN_MODES.some((m) => m.id === value))
                throw new CommandError('run: off, risky or stamina.');
              state.run = value;
            } else if (name === 'defuse') state.defuse = on;
            else if (name === 'blast') state.blast = on;
            else if (name === 'radius')
              state.blastRadius = Math.max(
                BLAST_RADIUS_RANGE[0],
                Math.min(
                  BLAST_RADIUS_RANGE[1],
                  Math.round(Number(value)) || BLAST_RADIUS,
                ),
              );
            else if (name === 'sprint') state.sprint = on;
            else if (name === 'stun') state.stunOnly = on;
            else
              throw new CommandError(
                'Rules: run, defuse, blast, radius, sprint, stun.',
              );
            changed(ctx, `${ctx.fromName} set ${name} to ${value}.`);
          },
        },
        end: {
          usage: '/end',
          help: 'Ends the game now, as if time ran out.',
          run: (args, ctx) => {
            const state = need();
            if (state.status !== 'playing')
              throw new CommandError('The game isn’t being played.');
            state.timeLeft = 0;
            tick(state, 0);
            changed(ctx, `${ctx.fromName} ended the game.`);
          },
        },
      },
    };
  }

  // ─── Lobby ───────────────────────────────────────────────────────────

  setRule = (key, value) => this.room.setSettings({ [key]: value });
  // Blank means the field's usual count; anything else is clamped into range.
  setMinePercent = (event) => {
    const raw = event.target.value.trim();
    if (raw === '' || !Number.isFinite(Number(raw))) {
      event.target.value = '';
      this.room.setSettings({ minePercent: null });
      return;
    }
    const [lo, hi] = MINE_PERCENT_RANGE;
    const value = Math.max(lo, Math.min(hi, Math.round(Number(raw))));
    event.target.value = value;
    this.room.setSettings({ minePercent: value });
  };

  get timeMinutes() {
    return Math.round(((this.settings.time ?? 300) / 60) * 100) / 100;
  }

  setTime = (event) => {
    const [lo, hi] = TIME_RANGE;
    const minutes = Number(event.target.value);
    const seconds =
      Number.isFinite(minutes) && minutes > 0
        ? Math.max(lo, Math.min(hi, Math.round(minutes * 60)))
        : (this.settings.time ?? 300);
    event.target.value = Math.round((seconds / 60) * 100) / 100;
    this.room.setSettings({ time: seconds });
  };

  setBlastRadius = (event) => {
    const [lo, hi] = BLAST_RADIUS_RANGE;
    const value = Math.max(
      lo,
      Math.min(hi, Math.round(Number(event.target.value)) || BLAST_RADIUS),
    );
    event.target.value = value;
    this.room.setSettings({ blastRadius: value });
  };

  toggleRule = (key, event) =>
    this.room.setSettings({ [key]: event.target.checked });

  get blastOn() {
    return this.settings.blast === true;
  }

  get defuseOn() {
    return this.settings.defuse === true;
  }

  get sprintOn() {
    return this.settings.sprint === true;
  }

  get stunOnlyOn() {
    return this.settings.stunOnly !== false;
  }

  // Per-seat difficulty. The room-wide botLevel is still the default, so a room
  // set up before this existed, and any seat nobody has touched, behaves as before.
  get botLevelMap() {
    return this.settings.botLevels ?? {};
  }

  levelForSeat = (id) => this.botLevelMap[id] ?? this.settings.botLevel;

  setBotLevel = (id, level) =>
    this.setRule('botLevels', { ...this.botLevelMap, [id]: level });

  // ─── Custom levels ─────────────────────────────────────────────────
  // A minefield you drew in the Level Editor: it brings its own size and its
  // own mines, exactly where you put them, so unlike a generated field the
  // first dig is not guaranteed safe.
  get myLevels() {
    // The stamp is what makes this re-read after the editor has saved one.
    this.levelsStamp;
    return listLevels('mines');
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
    this.setRule('field', 'custom');
    this.setRule('levelId', id);
  };

  get customLevel() {
    return this.settings.field === 'custom'
      ? (findLevel('mines', this.settings.levelId) ?? null)
      : null;
  }

  get customLayout() {
    return this.customLevel ? mineLayout(this.customLevel) : null;
  }

  get customMissing() {
    return this.settings.field === 'custom' && !this.customLevel;
  }

  setLevel = (event) => this.setRule('levelId', event.target.value);

  deathModes = DEATH_MODES;
  livesRange = LIVES_RANGE;

  get deathMode() {
    return this.settings.deathMode ?? 'out';
  }

  get deathModeHint() {
    return DEATH_MODES.find((m) => m.id === this.deathMode)?.hint ?? '';
  }

  get livesSetting() {
    return this.settings.lives ?? 3;
  }

  setLives = (event) => {
    const [lo, hi] = LIVES_RANGE;
    const value = Math.round(Number(event.target.value));
    this.setRule(
      'lives',
      Number.isFinite(value) ? Math.max(lo, Math.min(hi, value)) : 3,
    );
  };

  get minePercentHint() {
    const f = FIELDS.find((x) => x.id === this.settings.field) ?? FIELDS[1];
    const [lo, hi] = MINE_PERCENT_RANGE;
    return `${lo}–${hi}%. Leave blank for the field’s usual ${Math.round((f.mines / (f.width * f.height)) * 100)}% (${f.mines} mines).`;
  }
  addBot = () =>
    this.room.setSettings({
      bots: Math.min(
        this.settings.bots + 1,
        MAX_PLAYERS - this.room.members.length,
      ),
    });
  removeBot = () =>
    this.room.setSettings({
      bots: Math.max(
        0,
        Math.min(this.settings.bots, MAX_PLAYERS - this.room.members.length) -
          1,
      ),
    });
  playAgain = () => this.room.allReady && this.start();
  readyCheck = () => this.room.callReadyCheck();

  askLobby = () => {
    if (this.isOver) this.toLobby();
    else this.confirmingLobby = true;
  };

  cancelLobby = () => (this.confirmingLobby = false);

  get lobbyWarning() {
    return this.room.isOnline
      ? 'The game in progress will be cancelled for everyone on the field.'
      : 'The game in progress will be cancelled and your score will be lost.';
  }

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
    this.view = null;
    this.latest = null;
    this.state = null;
    this.me = null;
    this.held.clear();
  }

  leave = async () => {
    if (
      this.mode === 'playing' &&
      !this.isOver &&
      !(await askConfirm({
        title: 'Leave the game?',
        message: 'You’ll be disconnected and leave the field.',
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
      const state = this.state;
      const player = state?.players.find((p) => p.id === from);
      if (!player) return;
      if (message.type === 'pos') {
        if (
          ![message.x, message.y, message.face].every(Number.isFinite) ||
          player.stun > 0 ||
          player.dead ||
          player.downMs > 0 ||
          player.defusing ||
          state.status !== 'playing'
        )
          return;
        player.x = Math.max(0.2, Math.min(state.width - 0.2, message.x));
        player.y = Math.max(0.2, Math.min(state.height - 0.2, message.y));
        player.face = message.face;
        player.moving = Boolean(message.moving);
        player.running =
          state.run !== 'off' && Boolean(message.running) && player.moving;
        if (state.run === 'stamina' && Number.isFinite(message.stamina)) {
          player.stamina = Math.max(0, Math.min(STAMINA_MAX, message.stamina));
          player.winded = Boolean(message.winded);
        }
        if (stepOn(state, player)) this.publish(true);
      } else if (message.type === 'defuse') {
        if (resolveDefuse(state, from, message.ok === true)) this.publish(true);
      } else if (message.type === 'dig' || message.type === 'flag') {
        const x = Math.round(message.x);
        const y = Math.round(message.y);
        if (Math.hypot(x + 0.5 - player.x, y + 0.5 - player.y) > REACH) return;
        const result =
          message.type === 'dig'
            ? dig(state, from, x, y)
            : toggleFlag(state, from, x, y);
        if (result) this.publish(true);
      }
      return;
    }
    if (message.type === 'view') {
      const view = unpackView(message.view);
      const fresh =
        !this.latest ||
        (view.status === 'drop' && this.latest.status !== 'drop');
      if (fresh || !this.me) {
        const mine = view.players.find((p) => p.id === this.myId);
        this.me = mine
          ? {
              x: mine.x,
              y: mine.y,
              face: mine.face,
              moving: false,
              stamina: STAMINA_MAX,
            }
          : null;
      }
      this.mode = 'playing';
      this.show(view);
    } else if (message.type === 'lobby') {
      this.backToLobby();
    }
  }

  <template>
    <ToolPage
      @route="minesweeper"
      @game={{true}}
      @landscape={{true}}
      @busy={{this.busy}}
      @closeWarning={{this.closeWarning}}
      @subtitle="Drop onto a 3D minefield, walk around, dig and flag. Up to four players on one field: the highest score wins."
    >
      {{#if (eq this.mode "playing")}}
        <div class="game-shell uno-shell arcade-shell pop-in">
          <div
            class="uno-stage arcade-stage mines-stage
              {{if this.iAmRunning 'is-boosting is-running'}}
              {{if this.iAmWinded 'is-winded'}}"
          >
            <div class="arcade-speedlines" aria-hidden="true"></div>
            <div class="mines-winded" aria-hidden="true"></div>
            <canvas
              class="snake-canvas"
              aria-label="Minefield. Walk with the arrow keys or WASD, dig with Space and flag with F, or use the joystick and buttons on a touch screen."
              {{this.setupScene}}
              {{noImageSave}}
            ></canvas>
            <ArcadeRadar
              @getScene={{this.getScene}}
              @drawMap={{this.drawMap}}
              @hideMap={{this.isOver}}
              @expandable={{true}}
            />

            <div class="uno-overlay uno-top-left arcade-scores">
              <div class="mines-hud">
                <span class="arcade-chip mines-clock {{this.timeClass}}"><Icon
                    @name="timer"
                    @size={{14}}
                  />
                  <strong>{{this.clock}}</strong></span>
                <span class="arcade-chip"><Icon @name="bomb" @size={{14}} />
                  <strong>{{this.minesLeft}}</strong></span>
                <span class="arcade-chip"><Icon @name="shovel" @size={{14}} />
                  <strong>{{this.tilesLeft}}</strong></span>
                {{#if this.staminaOn}}
                  <span
                    class="arcade-chip mines-stamina
                      {{if this.staminaLow 'is-low'}}"
                    aria-label="Stamina"
                  ><Icon @name="zap" @size={{14}} /><span
                      class="mines-stamina-bar"
                    ><span style={{this.staminaStyle}}></span></span></span>
                {{/if}}
              </div>
              {{#each this.scores key="id" as |s|}}
                <span
                  class="snake-score arcade-chip
                    {{if s.leading 'is-leading'}}
                    {{if s.left 'is-dead'}}
                    {{if s.dead 'is-dead'}}"
                >
                  <span class="snake-swatch" style={{s.swatch}}></span>
                  {{#if s.leading}}<Icon @name="crown" @size={{12}} />{{/if}}
                  {{s.name}}
                  <strong>{{s.score}}</strong>
                  {{#if s.over}}<span class="mines-detail"><Icon
                        @name="shovel"
                        @size={{11}}
                      />
                      {{s.uncovered}}
                      <Icon @name="flag" @size={{11}} /><Icon
                        @name="check"
                        @size={{11}}
                      />
                      {{s.flagsRight}}
                      <Icon @name="flag" @size={{11}} /><Icon
                        @name="x"
                        @size={{11}}
                      />
                      {{s.flagsWrong}}
                      <Icon @name="bomb" @size={{11}} />
                      {{s.booms}}{{#if s.defused}}
                        <Icon @name="bomb" @size={{11}} /><Icon
                          @name="check"
                          @size={{11}}
                        />
                        {{s.defused}}{{/if}}</span>{{/if}}
                </span>
              {{/each}}
            </div>

            <p
              class="uno-overlay uno-status {{if this.isOver 'is-over'}}"
              role="status"
            >{{this.status}}</p>

            {{#if this.iAmDown}}
              <div class="mines-down" role="status">
                <Icon @name="bomb" @size={{22}} />
                <strong>Back in {{this.downSeconds}}…</strong>
                {{#if this.livesLeft}}
                  <span class="tool-hint">{{this.livesLeft}}
                    {{if (eq this.livesLeft 1) "life" "lives"}}
                    left</span>
                {{/if}}
              </div>
            {{/if}}

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
              <GameSettings @game="mines" />
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

            {{#if (eq this.view.status "drop")}}<span
                class="snake-paused"
              >Dropping in…</span>{{/if}}
            {{#if this.iAmOut}}<span class="snake-paused mines-stunned"><Icon
                  @name="bomb"
                  @size={{16}}
                />
                You’re out!</span>{{else if this.sprinting}}<span
                class="snake-paused mines-stunned"
              ><Icon @name="timer" @size={{16}} />
                Last-minute sprint!</span>{{/if}}
            {{#each this.defuseJobs key="seed" as |job|}}
              <DefusePuzzle @defusing={{job}} @onDone={{this.defuseDone}} />
            {{/each}}
            {{#if this.sceneFailed}}
              <p class="snake-fallback">The 3D minefield couldn’t start on this
                device (WebGL is needed).</p>
            {{/if}}

            {{#unless this.iAmOut}}
              <div class="snake-touch">
                <Joystick
                  @class="snake-joystick"
                  @label="Walk"
                  @onMove={{this.stickMoved}}
                  @onEnd={{this.stickReleased}}
                />
                <div class="mines-buttons">
                  {{#if this.viewRunOn}}
                    <button
                      type="button"
                      class="snake-boost mines-run-btn"
                      data-sound="off"
                      {{this.holdRun}}
                    ><Icon @name="zap" @size={{22}} /><span>Run</span></button>
                  {{/if}}
                  <button
                    type="button"
                    class="snake-boost mines-flag-btn"
                    data-sound="off"
                    {{this.pressButton this.flagHere}}
                  ><Icon @name="flag" @size={{22}} /><span>Flag</span></button>
                  <button
                    type="button"
                    class="snake-boost mines-dig-btn"
                    data-sound="off"
                    {{this.pressButton this.digHere}}
                  ><Icon @name="shovel" @size={{24}} /><span>Dig</span></button>
                </div>
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
          @game="mines"
          @onClose={{this.closeEditor}}
          @onPlay={{this.playLevel}}
        />
      {{else}}
        <GameLobby
          @game="mines"
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
                >Field</span></span>
              <div class="math-tabs" role="group" aria-label="Field size">
                {{#each this.fields as |f|}}
                  <button
                    type="button"
                    class="qr-tab {{if (eq this.settings.field f.id) 'active'}}"
                    title="{{f.width}}×{{f.height}}, {{f.mines}} mines"
                    aria-pressed={{if
                      (eq this.settings.field f.id)
                      "true"
                      "false"
                    }}
                    {{on "click" (fn this.setRule "field" f.id)}}
                  >{{f.label}}</button>
                {{/each}}
              </div>
            </div>
            {{#if (eq this.settings.field "custom")}}
              <div class="lobby-rule is-switch">
                <span class="lobby-rule-text"><span class="qr-label">Which level</span><span
                    class="tool-hint"
                  >One you drew in the Level Editor. Its mines are exactly where
                    you put them, so the first dig isn't safe.</span></span>
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
                  start on an ordinary field.</p>
              {{/if}}
            {{/if}}
            <label class="lobby-rule is-switch">
              <span class="lobby-rule-text"><span class="qr-label">Mines (% of
                  the field)</span><span
                  class="tool-hint"
                >{{this.minePercentHint}}</span></span>
              <input
                type="number"
                class="lobby-number"
                min={{this.percentMin}}
                max={{this.percentMax}}
                step="1"
                placeholder="Auto"
                value={{this.settings.minePercent}}
                {{on "change" this.setMinePercent}}
              />
            </label>
            <label class="lobby-rule is-switch">
              <span class="lobby-rule-text"><span class="qr-label">Explosions
                  stun nearby</span><span class="tool-hint">A mine’s blast stuns
                  anyone close by too. Only whoever dug it loses points.</span></span>
              <span class="qr-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={{this.blastOn}}
                  aria-checked={{if this.blastOn "true" "false"}}
                  {{on "change" (fn this.toggleRule "blast")}}
                />
                <span class="qr-switch-track" aria-hidden="true"></span>
              </span>
            </label>
            {{#if this.blastOn}}
              <label class="lobby-rule is-switch">
                <span class="lobby-rule-text"><span class="qr-label">Explosion
                    radius</span><span class="tool-hint">How many tiles a blast
                    reaches, from
                    {{this.radiusMin}}
                    to
                    {{this.radiusMax}}.</span></span>
                <input
                  type="number"
                  class="lobby-number"
                  min={{this.radiusMin}}
                  max={{this.radiusMax}}
                  step="1"
                  value={{this.settings.blastRadius}}
                  {{on "change" this.setBlastRadius}}
                />
              </label>
            {{/if}}
            <div class="lobby-rule">
              <span class="lobby-rule-text"><span
                  class="qr-label"
                >Running</span><span class="tool-hint">Hold Shift (or Run) to go
                  faster. Risky: run onto a mine and it goes off under you
                  (walking is safe; with Defusing on, you get the puzzle
                  instead). Stamina: running drains it, it refills 2 seconds
                  after you stop, and if you run dry you’re slowed until it’s
                  full again.</span></span>
              <div class="math-tabs" role="group" aria-label="Running">
                {{#each this.runModes as |m|}}
                  <button
                    type="button"
                    class="qr-tab {{if (eq this.settings.run m.id) 'active'}}"
                    aria-pressed={{if
                      (eq this.settings.run m.id)
                      "true"
                      "false"
                    }}
                    {{on "click" (fn this.setRule "run" m.id)}}
                  >{{m.label}}</button>
                {{/each}}
              </div>
            </div>
            <label class="lobby-rule is-switch">
              <span class="lobby-rule-text"><span
                  class="qr-label"
                >Defusing</span><span class="tool-hint">Dig up a mine (or run
                  onto one, with Risky running) and you get a puzzle to defuse
                  it for +5 instead of it going off: cut a wire, punch in a
                  code, and so on. Fail or run out of time and it blows. You get
                  10 seconds for your first, 15% less for each one after (down
                  to 2), and the puzzles get harder too.</span></span>
              <span class="qr-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={{this.defuseOn}}
                  aria-checked={{if this.defuseOn "true" "false"}}
                  {{on "change" (fn this.toggleRule "defuse")}}
                />
                <span class="qr-switch-track" aria-hidden="true"></span>
              </span>
            </label>
            <label class="lobby-rule is-switch">
              <span class="lobby-rule-text"><span class="qr-label">Last-minute
                  sprint</span><span class="tool-hint">Once 90% of the safe
                  tiles are dug, the clock drops to 1 minute (if there’s more
                  than that left).</span></span>
              <span class="qr-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={{this.sprintOn}}
                  aria-checked={{if this.sprintOn "true" "false"}}
                  {{on "change" (fn this.toggleRule "sprint")}}
                />
                <span class="qr-switch-track" aria-hidden="true"></span>
              </span>
            </label>
            <label class="lobby-rule is-switch">
              <span class="lobby-rule-text"><span class="qr-label">Bombs only
                  stun</span><span class="tool-hint">Off: digging a mine knocks
                  you out of the game. On your own, that ends it and shows every
                  mine, like classic Minesweeper.</span></span>
              <span class="qr-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={{this.stunOnlyOn}}
                  aria-checked={{if this.stunOnlyOn "true" "false"}}
                  {{on "change" (fn this.toggleRule "stunOnly")}}
                />
                <span class="qr-switch-track" aria-hidden="true"></span>
              </span>
            </label>
            {{#unless this.stunOnlyOn}}
              <div class="lobby-rule">
                <span class="lobby-rule-text"><span class="qr-label">When a mine
                    gets you</span><span
                    class="tool-hint"
                  >{{this.deathModeHint}}</span></span>
                <div
                  class="math-tabs"
                  role="group"
                  aria-label="When a mine gets you"
                >
                  {{#each this.deathModes key="id" as |m|}}
                    <button
                      type="button"
                      class="qr-tab {{if (eq this.deathMode m.id) 'active'}}"
                      aria-pressed={{if
                        (eq this.deathMode m.id)
                        "true"
                        "false"
                      }}
                      {{on "click" (fn this.setRule "deathMode" m.id)}}
                    >{{m.label}}</button>
                  {{/each}}
                </div>
              </div>
              {{#if (eq this.deathMode "lives")}}
                <label class="lobby-rule is-switch">
                  <span class="lobby-rule-text"><span class="qr-label">Lives
                      each</span><span class="tool-hint">How many mines you can
                      take before you're out for good.</span></span>
                  <input
                    type="number"
                    class="lobby-number"
                    min="1"
                    max="9"
                    step="1"
                    value={{this.livesSetting}}
                    {{on "change" this.setLives}}
                  />
                </label>
              {{/if}}
            {{/unless}}
            <label class="lobby-rule is-switch">
              <span class="lobby-rule-text"><span class="qr-label">Time limit
                  (minutes)</span><span class="tool-hint">Anything from half a
                  minute to 60. Decimals work: 2.5 is two and a half minutes.</span></span>
              <input
                type="number"
                class="lobby-number"
                min="0.5"
                max="60"
                step="0.5"
                value={{this.timeMinutes}}
                {{on "change" this.setTime}}
              />
            </label>
            <p class="tool-hint">Walk with the arrow keys or WASD, dig the tile
              under your feet with Space and flag it with F (or the joystick and
              buttons on a touch screen). Every tile you uncover is a point, a
              mine costs 10 and stuns you (or knocks you out, with Bombs only
              stun off), and at the end each flag on a mine is worth +2 (−2 if
              it wasn’t). The game ends when the field is cleared or time runs
              out, and the highest score wins.</p>
          </:rules>
        </GameLobby>
      {{/if}}
    </ToolPage>
  </template>
}
