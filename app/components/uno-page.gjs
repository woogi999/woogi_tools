import Component from '@glimmer/component';
import { tracked, cached } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';
import GameLobby, { ReadyButton } from './game-lobby';
import GameChat from './game-chat';
import GameRoom from '../utils/game-room';
import { roomCodeFromUrl } from '../utils/file-share';
import { robotAvatar } from '../utils/avatar';
import { botNames, newBotSeed } from '../utils/bot-names';
import { BotChatter } from '../utils/bot-chat';
import {
  COLORS,
  MAX_PLAYERS,
  DEFAULT_RULES,
  DEFAULT_CARDS,
  CARD_TYPES,
  HAND_SIZE_RANGE,
  PENALTY_RANGE,
  clampInt,
  normaliseRules,
  cardName,
  createGame,
  viewFor,
  spectatorView,
  act,
  actorIndex,
  timeOut,
  botJumpIn,
  handToBot,
  settleMs,
  TURN_TIMES,
  CHALLENGE_EXTRA,
} from '../utils/uno';
import { think } from '../utils/uno-bot';
import { sfx, preloadSounds } from '../utils/sound';
import HoldConfirm from './hold-confirm';
import { askConfirm } from '../utils/confirm';
import { listenForActions, onScreen, openChat } from '../utils/game-input';
import { padStick } from '../utils/gamepad';
import { unoDebugTools } from '../utils/uno-debug';
import { bindingParts, GAME_CONTROLS } from '../utils/keybinds';
import noImageSave from '../utils/no-image-save';
import GameSettings from './game-settings';

const JUMP_IN_DELAY_MS = 650;
// Computer players are people too: how long they take to notice someone forgot to say Woono (or that they did).
const CALLOUT_REACTION_MS = [1400, 3800];
const LATE_UNO_REACTION_MS = [900, 2600];
// Most of the time a computer player remembers to press Woono before playing its second-last card.
const BOT_REMEMBERS_UNO = 0.85;
const SYMBOLS = {
  skip: '✋',
  reverse: '⇄',
  draw2: '+2',
  wild: 'W',
  wild4: '+4',
  target2: '◎+2',
  target4: '◎+4',
  draw99: '+99',
};
const COLOR_ORDER = { red: 0, yellow: 1, green: 2, blue: 3 };
const VALUE_ORDER = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'skip',
  'reverse',
  'draw2',
  'target2',
  'wild',
  'wild4',
  'target4',
  'draw99',
];
const STACKING = [
  { id: 'off', label: 'Off' },
  { id: 'same', label: 'Same amount' },
  { id: 'up', label: 'Equal or higher' },
  { id: 'mixed', label: 'Any draw card' },
];
// Where you're looking is sent to other players at most this often.
const LOOK_SEND_MS = 150;
// A touch that moves further than this (CSS px) is a drag to look around, not a tap.
const DRAG_PX = 8;
// A lifted card swiped up at least this far (CSS px, or 12% of the table's height if that's more) is played.
const SWIPE_MIN_PX = 48;
const SWITCH_RULES = [
  {
    key: 'defense',
    label: 'Block & reflect',
    hint: 'A draw card coming at you? Play any Skip to cancel it, or any Reverse to send it back to whoever played it. A Skip coming at you? A Skip passes it on to the next player; a Reverse sends it back.',
  },
  {
    key: 'sevens',
    label: 'Sevens swap',
    hint: 'Play a 7 and swap hands with anyone.',
  },
  {
    key: 'zeros',
    label: 'Zeros rotate',
    hint: 'Play a 0 and every hand moves along to the next player.',
  },
  {
    key: 'jumpIn',
    label: 'Jump-in',
    hint: 'Hold an exact copy of the top card? Play it out of turn.',
  },
  {
    key: 'drawUntilPlayable',
    label: 'Draw until you can play',
    hint: 'Draw and you have to put a card down: keep drawing until you can. No passing.',
  },
  {
    key: 'drawBalancing',
    label: 'Draw balancing',
    hint: 'The deck plays fair-ish. Lots of cards? Power cards find you more often. Nearly out? Mostly numbers. Keep drawing and matching cards get likelier. Only ever cards still in the deck.',
  },
  {
    key: 'challenge',
    label: 'Challenge wild draw cards',
    hint: `Think a wild draw card was played while they still had the colour in play? Challenge it. Right: they draw instead. Wrong: you draw ${CHALLENGE_EXTRA} extra.`,
  },
];
const TIMER_OPTIONS = TURN_TIMES.map((seconds) => ({
  id: seconds,
  label: seconds ? `${seconds}s` : 'Off',
}));

const LOOK_LOCK_KEY = 'woogi-woono-autolook';
const readLookLock = () => {
  try {
    return localStorage.getItem(LOOK_LOCK_KEY) === '1';
  } catch {
    return false;
  }
};

const eq = (a, b) => a === b;
const symbol = (card) => SYMBOLS[card.value] ?? card.value;
const coarsePointer = () => window.matchMedia?.('(pointer: coarse)').matches;
const between = ([min, max]) => min + Math.random() * (max - min);

export default class UnoPage extends Component {
  colors = COLORS;
  handMin = HAND_SIZE_RANGE[0];
  handMax = HAND_SIZE_RANGE[1];
  stackingOptions = STACKING;
  penaltyMin = PENALTY_RANGE[0];
  penaltyMax = PENALTY_RANGE[1];
  switchRules = SWITCH_RULES;
  cardTypes = CARD_TYPES;
  timerOptions = TIMER_OPTIONS;

  // 'lobby' | 'playing'
  @tracked mode = 'lobby';
  // What this device's player can see; replaced after every action.
  @tracked view = null;
  @tracked sceneFailed = false;
  @tracked pointing = false;
  // Phone tilt steers the camera once the gyroscope has sent a reading.
  @tracked gyroOn = false;
  @tracked gyroAvailable = false;
  // When the player to move runs out of time (this device's clock), and a clock that ticks to show it.
  @tracked turnDeadline = null;
  @tracked now = Date.now();
  // The list of controls, opened from the ⓘ button.
  @tracked helpOpen = false;
  // True while the table is still animating the last move; no one can act until it settles.
  @tracked settling = false;
  touchControls = coarsePointer();

  // The full game, only on the host.
  state = null;
  // Host: nobody acts before this time, while the table animates.
  busyUntil = 0;
  settledEvent = null;
  settleTimer = null;
  botTimer = null;
  botAbort = null;
  reactions = new Map(); // `${kind}:${bot}:${target}` -> timer
  turnTimer = null;
  timerTurn = null;
  clockTimer = null;
  scene = null;
  sentLook = { x: 0, y: 0 };
  selectedId = null;

  room = new GameRoom('uno', {
    maxPlayers: MAX_PLAYERS,
    settings: { ...DEFAULT_RULES, bots: 2, botSeed: newBotSeed() },
    onMessage: (message, from) => this.onlineMessage(message, from),
    onGuestLeft: (id) => {
      if (this.state && handToBot(this.state, id)) this.refresh();
    },
    onClosed: () => this.backToLobby(),
  });

  chatter = new BotChatter(this.room);
  // The last game event the computer players have reacted to.
  banterSeen = null;

  constructor(owner, args) {
    super(owner, args);
    const code = roomCodeFromUrl();
    if (code) this.room.join(code);
    preloadSounds('uno');
    this.room.setDebugTools(unoDebugTools(this));
    this.gyroAvailable =
      typeof window.DeviceOrientationEvent !== 'undefined' && coarsePointer();
    registerDestructor(this, () => {
      this.stopBots();
      clearTimeout(this.turnTimer);
      clearTimeout(this.settleTimer);
      clearInterval(this.clockTimer);
      this.chatter.dispose();
      this.stopGyro();
      this.room.close();
    });
  }

  get settings() {
    return this.room.settings;
  }

  get isHostSide() {
    return this.room.isHost;
  }

  // ─── Lobby ───────────────────────────────────────────────────────────

  // Humans first, then robots with pun names, the same for everyone in the room.
  get seats() {
    // Spectators are in the room but take no seat.
    const humans = this.room.players.map((m) => ({ ...m, kind: 'human' }));
    const bots = Math.max(
      0,
      Math.min(this.settings.bots, MAX_PLAYERS - humans.length),
    );
    const seed = this.settings.botSeed;
    return [
      ...humans,
      ...botNames(seed, bots).map((name, i) => ({
        id: `bot-${i + 1}`,
        name,
        kind: 'bot',
        avatar: robotAvatar(seed, i),
      })),
    ];
  }

  get blocker() {
    return this.seats.length < 2
      ? 'Add a computer player or invite a friend to start.'
      : null;
  }

  setRule = (key, value) => this.room.setSettings({ [key]: value });
  toggleRule = (key, event) =>
    this.room.setSettings({ [key]: event.target.checked });
  toggleCard = (id, event) =>
    this.room.setSettings({
      cards: {
        ...DEFAULT_CARDS,
        ...this.settings.cards,
        [id]: event.target.checked,
      },
    });
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
  setNumberRule = (key, event) => {
    const range = key === 'handSize' ? HAND_SIZE_RANGE : PENALTY_RANGE;
    const value = clampInt(event.target.value, range, DEFAULT_RULES[key]);
    // Put the clamped number back in the box, even if the setting didn't change.
    event.target.value = value;
    this.room.setSettings({ [key]: value });
  };

  // Picture-in-picture: leaving the page mid-game floats it, and closing it asks first.
  get busy() {
    return (this.mode === 'playing' && !this.isOver) || this.room.isOnline;
  }

  get closeWarning() {
    if (this.room.isOnline)
      return this.room.isHost
        ? 'Close Woono? You’re hosting, so this ends the game and closes the room for everyone.'
        : 'Close Woono? You’ll be disconnected from the game.';
    return 'Close Woono? The game in progress will be lost.';
  }

  // ─── Running the game (on the host) ─────────────────────────────────

  start = () => {
    this.stopBots();
    const players = this.seats.map((seat) => ({
      id: seat.id,
      name: seat.name,
      kind: seat.kind,
      avatar: seat.avatar,
    }));
    this.state = createGame(players, normaliseRules(this.settings));
    this.banterSeen = this.state.events.at(-1)?.id ?? null;
    this.settledEvent = null;
    this.busyUntil = 0;
    const bots = this.state.players.filter((p) => p.kind === 'bot');
    if (bots.length)
      this.chatter.say(
        bots[Math.floor(Math.random() * bots.length)].name,
        'hello',
        { urgent: true },
      );
    this.room.setLocked(true);
    // A rematch needs everyone to press Ready again.
    this.room.resetReady();
    this.room.debug.clearHistory();
    this.recordedVersion = null;
    this.refresh({ debugLabel: 'New game' });
  };

  // Debug mode: what /undo goes back to.
  recordedVersion = null;
  botsPaused = false;

  restoreState(snap) {
    this.stopBots();
    const current = this.state;
    // Newer event ids and versions, so every screen treats the rewound game as the latest news.
    snap.seq = Math.max(snap.seq, current?.seq ?? 0) + 1;
    snap.version = Math.max(snap.version, current?.version ?? 0) + 1;
    snap.turnId = Math.max(snap.turnId, current?.turnId ?? 0) + 1;
    this.state = snap;
    this.settledEvent = snap.events.at(-1)?.id ?? null;
    this.busyUntil = 0;
    this.timerTurn = null;
    this.recordedVersion = snap.version;
    this.refresh();
  }

  // Watching rather than playing: no seat, so no hand is ever sent here.
  get iAmSpectator() {
    return this.room.iAmSpectating;
  }

  get myIndex() {
    return this.state
      ? this.state.players.findIndex((p) => p.id === this.room.selfId)
      : -1;
  }

  // Rebuilds what everyone sees, then gets the computer players thinking.
  refresh({ debugLabel } = {}) {
    const state = this.state;
    if (state.version !== this.recordedVersion) {
      this.recordedVersion = state.version;
      this.room.recordDebugState(
        debugLabel ?? state.log.at(-1)?.text ?? 'A move',
      );
    }
    // Nobody moves until the table has finished animating what just happened.
    const fresh = state.events.filter(
      (e) => this.settledEvent === null || e.id > this.settledEvent,
    );
    this.settledEvent = state.events.at(-1)?.id ?? this.settledEvent;
    const settle = settleMs(fresh);
    if (settle) this.busyUntil = Math.max(this.busyUntil, Date.now() + settle);
    this.armTurnTimer();
    // Everyone gets times left rather than timestamps, since device clocks disagree.
    const turnLeft = this.turnDeadline
      ? Math.max(0, this.turnDeadline - Date.now())
      : null;
    const settleLeft = Math.max(0, this.busyUntil - Date.now());
    // A spectator (the host included) has no seat, so they get the table-only
    // view: it carries nobody's cards, which is what stops a second window
    // being used to read the table.
    const mine =
      this.myIndex >= 0 ? viewFor(state, this.myIndex) : spectatorView(state);
    this.show({ ...mine, turnLeft, settleLeft });
    state.players.forEach((player, i) => {
      if (player.kind === 'human' && player.id !== this.room.selfId)
        this.room.sendTo(player.id, {
          type: 'view',
          view: { ...viewFor(state, i), turnLeft, settleLeft },
        });
    });
    // Everyone watching gets the same public view.
    for (const watcher of this.room.spectators) {
      if (watcher.isYou) continue;
      this.room.sendTo(watcher.id, {
        type: 'view',
        view: { ...spectatorView(state), turnLeft, settleLeft },
      });
    }
    this.banter(state);
    this.runBots();
  }

  // Saying Woono and calling someone out are instant: they work while the table is still settling, on anyone's turn.
  apply(index, action) {
    if (!this.state || index < 0) return false;
    if (
      action?.type !== 'uno' &&
      action?.type !== 'callout' &&
      Date.now() < this.busyUntil
    )
      return false;
    return act(this.state, index, action);
  }

  stopBots() {
    clearTimeout(this.botTimer);
    this.botAbort?.abort();
    this.botAbort = null;
    for (const timer of this.reactions.values()) clearTimeout(timer);
    this.reactions.clear();
  }

  // Waits for the table to settle, then runs `task` (unless the game moved on meanwhile).
  afterSettle(task, extraMs = 0) {
    const wait = Math.max(0, this.busyUntil - Date.now()) + extraMs;
    return setTimeout(() => {
      if (Date.now() < this.busyUntil) this.afterSettle(task);
      else task();
    }, wait);
  }

  // The computer player to move thinks it over (see utils/uno-bot.js) and moves once the table has settled.
  runBots() {
    const state = this.state;
    clearTimeout(this.botTimer);
    this.botAbort?.abort();
    this.botAbort = null;
    if (!state || state.winner !== null || this.botsPaused) return;
    this.scheduleReactions();

    const jump = botJumpIn(state);
    if (jump && Math.random() < 0.5) {
      const version = state.version;
      this.botTimer = this.afterSettle(() => {
        if (
          this.state === state &&
          state.version === version &&
          this.apply(jump.index, { type: 'play', cardId: jump.cardId })
        )
          this.refresh();
      }, JUMP_IN_DELAY_MS);
      return;
    }

    const actor = actorIndex(state);
    if (state.players[actor].kind !== 'bot') return;
    const version = state.version;
    const abort = new AbortController();
    this.botAbort = abort;
    // With a turn timer, leave plenty of the turn for the move itself.
    const budgetMs = state.rules.turnTime
      ? Math.min(2200, state.rules.turnTime * 300)
      : undefined;
    think(state, actor, { signal: abort.signal, budgetMs }).then((move) => {
      if (
        abort.signal.aborted ||
        this.state !== state ||
        state.version !== version
      )
        return;
      this.botTimer = this.afterSettle(() => {
        if (
          abort.signal.aborted ||
          this.state !== state ||
          state.version !== version
        )
          return;
        const player = state.players[actor];
        if (
          player.hand.length === 2 &&
          move?.type === 'play' &&
          Math.random() < BOT_REMEMBERS_UNO
        )
          act(state, actor, { type: 'uno' });
        if (!move || !this.apply(actor, move)) {
          timeOut(state);
          state.version++;
        }
        this.refresh();
      });
    });
  }

  // Computer players notice when someone's down to one card without saying Woono, and call them out;
  // one who forgot says it as soon as it notices.
  scheduleReactions() {
    const state = this.state;
    const live = new Set();
    state.players.forEach((bot, b) => {
      if (bot.kind !== 'bot') return;
      state.players.forEach((player, t) => {
        if (!player.exposed) return;
        const kind = t === b ? 'uno' : 'callout';
        const key = `${kind}:${b}:${t}`;
        live.add(key);
        if (this.reactions.has(key)) return;
        const timer = this.afterSettle(
          () => {
            this.reactions.delete(key);
            if (this.state !== state || !state.players[t].exposed) return;
            if (
              this.apply(
                b,
                kind === 'uno'
                  ? { type: 'uno' }
                  : { type: 'callout', target: t },
              )
            )
              this.refresh();
          },
          between(kind === 'uno' ? LATE_UNO_REACTION_MS : CALLOUT_REACTION_MS),
        );
        this.reactions.set(key, timer);
      });
    });
    for (const [key, timer] of this.reactions) {
      if (live.has(key)) continue;
      clearTimeout(timer);
      this.reactions.delete(key);
    }
  }

  // Host: a fresh countdown whenever the turn passes to someone new. It starts once the table settles.
  armTurnTimer() {
    const state = this.state;
    const seconds = state.rules.turnTime;
    if (!seconds || state.winner !== null) {
      clearTimeout(this.turnTimer);
      this.turnDeadline = null;
      this.timerTurn = null;
      return;
    }
    if (this.timerTurn === state.turnId) return;
    this.timerTurn = state.turnId;
    clearTimeout(this.turnTimer);
    this.turnDeadline = Math.max(Date.now(), this.busyUntil) + seconds * 1000;
    const turnId = state.turnId;
    this.turnTimer = setTimeout(() => {
      if (this.state === state && state.turnId === turnId && timeOut(state)) {
        state.version++;
        this.refresh();
      }
    }, this.turnDeadline - Date.now());
  }

  // Computer players comment on what just happened: their own big plays, and being on the wrong end of yours.
  banter(state) {
    const fresh = state.events.filter(
      (e) => this.banterSeen === null || e.id > this.banterSeen,
    );
    this.banterSeen = state.events.at(-1)?.id ?? this.banterSeen;
    const players = state.players;
    const isBot = (i) => players[i]?.kind === 'bot';
    const name = (i) => players[i]?.name;
    const someBot = (except) => {
      const bots = players
        .map((p, i) => i)
        .filter((i) => isBot(i) && i !== except);
      return bots.length ? bots[Math.floor(Math.random() * bots.length)] : null;
    };
    for (const event of fresh) {
      switch (event.type) {
        case 'play': {
          const kind = { skip: 'skip', reverse: 'reverse', wild: 'wild' }[
            event.card.value
          ];
          if (isBot(event.player) && kind)
            this.chatter.say(name(event.player), kind, {
              chance: 0.45,
              vars: {
                name: name(
                  (event.player + state.direction + players.length) %
                    players.length,
                ),
              },
            });
          break;
        }
        case 'attack':
          if (isBot(event.player))
            this.chatter.say(
              name(event.player),
              event.amount >= 4 ? 'wild4' : 'draw2',
              {
                chance: event.amount >= 4 ? 0.8 : 0.45,
                vars: { name: name(event.target) },
              },
            );
          else if (isBot(event.target))
            this.chatter.say(name(event.target), 'hit', {
              chance: 0.6,
              vars: { name: name(event.player) },
            });
          break;
        case 'block':
        case 'reflect':
          if (isBot(event.player))
            this.chatter.say(name(event.player), event.type, {
              chance: 0.7,
              vars: { name: name(event.from ?? event.target) },
            });
          break;
        case 'uno':
          if (isBot(event.player))
            this.chatter.say(name(event.player), 'uno', {
              chance: 0.8,
              urgent: true,
            });
          break;
        case 'callout':
          if (isBot(event.player))
            this.chatter.say(name(event.player), 'callout', {
              urgent: true,
              vars: { name: name(event.target) },
            });
          else if (isBot(event.target))
            this.chatter.say(name(event.target), 'caught', { urgent: true });
          break;
        case 'swap':
          if (isBot(event.a))
            this.chatter.say(name(event.a), 'swap', {
              chance: 0.6,
              vars: { name: name(event.b) },
            });
          break;
        case 'challenge':
          if (isBot(event.player))
            this.chatter.say(
              name(event.player),
              event.success ? 'challengeWin' : 'challengeLose',
              { urgent: true, vars: { name: name(event.offender) } },
            );
          else if (event.success && isBot(event.offender))
            this.chatter.say(name(event.offender), 'caught', { urgent: true });
          break;
        case 'timeout': {
          const bot = isBot(event.player) ? null : someBot(event.player);
          if (bot !== null)
            this.chatter.say(name(bot), 'timeout', {
              chance: 0.7,
              vars: { name: name(event.player) },
            });
          break;
        }
        case 'win':
          if (isBot(event.player))
            this.chatter.say(name(event.player), 'win', { urgent: true });
          else {
            const bot = someBot(event.player);
            if (bot !== null)
              this.chatter.say(name(bot), 'lose', {
                urgent: true,
                vars: { name: name(event.player) },
              });
          }
          break;
        default:
          break;
      }
    }
  }

  show(view) {
    this.mode = 'playing';
    if (!this.isHostSide)
      this.turnDeadline =
        typeof view.turnLeft === 'number' ? Date.now() + view.turnLeft : null;
    if (this.turnDeadline && !this.clockTimer) {
      this.clockTimer = setInterval(() => {
        const before = this.secondsLeft;
        this.now = Date.now();
        const left = this.secondsLeft;
        // Your last few seconds tick.
        if (left !== before && left && left <= 5 && this.isMyTurn)
          sfx('uno.tick');
      }, 250);
    }
    if (!this.turnDeadline) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
    const previous = this.view;
    this.view = view;
    this.playSounds(previous, view);
    // Locked while the last move animates; the scene shows nothing to play until then.
    clearTimeout(this.settleTimer);
    this.settling = view.settleLeft > 0;
    if (this.settling) {
      this.settleTimer = setTimeout(() => {
        this.settling = false;
        this.scene?.setView(this.view);
      }, view.settleLeft);
    }
    this.scene?.setView(this.sceneView);
  }

  // Sounds for whatever happened since the last view: every event once, plus a ping when it becomes your turn.
  playSounds(previous, view) {
    const sameGame = previous?.gameId === view.gameId;
    const events = view.events ?? [];
    if (!sameGame) {
      this.soundSeen = events.at(-1)?.id ?? null;
      return;
    }
    const fresh = events.filter(
      (e) => this.soundSeen === null || e.id > this.soundSeen,
    );
    this.soundSeen = events.at(-1)?.id ?? this.soundSeen;
    // The 3D table plays each event's sound in step with its animation (lazy/uno-scene.js).
    // Without the table, play them here instead.
    if (this.sceneFailed) {
      fresh.slice(-4).forEach((event, i) => {
        const name = unoSoundFor(event, view);
        if (name) setTimeout(() => sfx(name), i * 110);
      });
    }
    const myTurnNow = view.turn === view.you && view.winner === null;
    const myTurnBefore =
      previous.turn === previous.you && previous.turnId === view.turnId;
    if (myTurnNow && !myTurnBefore && !fresh.some((e) => e.type === 'win'))
      setTimeout(() => sfx('uno.myturn'), Math.max(0, view.settleLeft ?? 0));
  }

  soundSeen = null;

  get sceneView() {
    const view = this.view;
    // The colour wheel and arrows appear once the card has landed.
    return this.settling
      ? { ...view, playable: [], canDraw: false, choice: null }
      : view;
  }

  act(action) {
    if (this.isHostSide) {
      if (this.apply(this.myIndex, action)) this.refresh();
    } else {
      this.room.send({ type: 'action', action });
    }
  }

  // ─── What you see ────────────────────────────────────────────────────

  get isOver() {
    return this.view?.winner !== null && this.view?.winner !== undefined;
  }

  get isMyTurn() {
    const view = this.view;
    return (
      Boolean(view) &&
      view.turn === view.you &&
      view.winner === null &&
      view.swapPending === null
    );
  }

  // Buttons wait for the table to settle.
  get locked() {
    return this.settling || this.isOver;
  }

  get canDraw() {
    return !this.locked && Boolean(this.view?.canDraw);
  }

  get canPass() {
    return !this.locked && Boolean(this.view?.canPass);
  }

  get drawnPlayable() {
    const view = this.view;
    return Boolean(view?.drawn) && view.playable.includes(view.drawn.id);
  }

  get takeLabel() {
    const pending = this.view?.pending;
    if (!pending) return '';
    return pending.kind === 'draw' ? `Take ${pending.amount}` : 'Take the skip';
  }

  // Everyone else who's down to one card without saying Woono.
  get exposedPlayers() {
    const view = this.view;
    if (!view || this.isOver) return [];
    return view.players
      .map((p, index) => ({ ...p, index }))
      .filter((p) => p.exposed && p.index !== view.you);
  }

  get iAmExposed() {
    return Boolean(this.view?.players[this.view.you]?.exposed);
  }

  get unoLabel() {
    if (this.view?.unoArmed) return 'Woono';
    return this.iAmExposed ? 'Say Woono!' : 'Woono!';
  }

  // Your hand as a plain list: for screen readers, and for playing without WebGL.
  @cached
  get handItems() {
    const view = this.view;
    if (!view) return [];
    const sorted = [...view.hand].sort(
      (a, b) =>
        (COLOR_ORDER[a.color] ?? 9) - (COLOR_ORDER[b.color] ?? 9) ||
        VALUE_ORDER.indexOf(a.value) - VALUE_ORDER.indexOf(b.value),
    );
    return sorted.map((card) => ({
      key: card.id,
      card,
      playable: view.playable.includes(card.id),
      symbol: symbol(card),
      label: cardName(card),
    }));
  }

  get drawnItem() {
    const card = this.view?.drawn;
    return card
      ? {
          key: card.id,
          card,
          playable: this.drawnPlayable,
          symbol: symbol(card),
          label: cardName(card),
        }
      : null;
  }

  get opponents() {
    const view = this.view;
    if (!view) return [];
    return view.players
      .map((p, index) => ({ ...p, index }))
      .filter((p) => p.index !== view.you);
  }

  get secondsLeft() {
    if (!this.turnDeadline || this.isOver) return null;
    return Math.max(0, Math.ceil((this.turnDeadline - this.now) / 1000));
  }

  get timerStyle() {
    const total = (this.view?.rules?.turnTime ?? 0) * 1000;
    if (!total || !this.turnDeadline || this.isOver)
      return htmlSafe('display: none');
    const left = Math.max(
      0,
      Math.min(1, (this.turnDeadline - this.now) / total),
    );
    return htmlSafe(`transform: scaleX(${left.toFixed(3)})`);
  }

  get ruleBadges() {
    const r = this.view?.rules;
    if (!r) return [];
    const stacking = { same: 'Stack same', up: 'Stack up', mixed: 'Stack any' }[
      r.stacking
    ];
    return [
      stacking,
      r.defense && 'Block & reflect',
      r.sevens && '7 swap',
      r.zeros && '0 rotate',
      r.jumpIn && 'Jump-in',
      r.drawUntilPlayable && 'Draw till play',
      r.challenge && 'Challenge',
      r.drawBalancing && 'Balanced draws',
      r.cards?.draw99 && '+99',
      r.turnTime && `${r.turnTime}s turns`,
    ].filter(Boolean);
  }

  get iWon() {
    return this.view
      ? this.view.winner !== null && this.view.winner === this.view.you
      : false;
  }

  get status() {
    const view = this.view;
    if (!view) return '';
    const name = (i) => (i === view.you ? 'You' : view.players[i].name);
    if (view.winner !== null)
      return view.winner === view.you
        ? 'You win!'
        : `${name(view.winner)} wins.`;
    if (view.choice) {
      if (view.choice.player !== view.you)
        return `${name(view.choice.player)} is picking ${view.choice.needs === 'color' ? 'a colour' : 'who draws'}…`;
      return view.choice.needs === 'color'
        ? 'Pick a colour on the table.'
        : 'Who draws? Pick an arrow, even the one pointing at you.';
    }
    if (view.choosingSwap) return 'Pick someone to swap hands with.';
    if (view.swapPending !== null)
      return `${name(view.swapPending)} is picking who to swap hands with…`;
    const pending = view.pending;
    const defense = view.rules.defense;
    if (pending) {
      const what = pending.kind === 'draw' ? `+${pending.amount}` : 'A Skip';
      if (pending.target === view.you) {
        const answers = [
          view.rules.stacking !== 'off' && pending.kind === 'draw' && 'stack',
          defense &&
            (pending.kind === 'skip'
              ? 'pass it on with a Skip'
              : 'block it with a Skip'),
          defense && 'send it back with a Reverse',
        ].filter(Boolean);
        const options = view.playable.length ? `${answers.join(', ')}, ` : '';
        return `${what} is coming at you! ${capitalise(`${options}${view.canChallenge ? 'challenge it, ' : ''}or take it.`)}`;
      }
      return `${what} is heading for ${name(pending.target)}…`;
    }
    if (view.turn === view.you) {
      if (view.drawn)
        return this.drawnPlayable
          ? 'You drew a card you can play. Play it, or keep it.'
          : 'You drew a card.';
      if (view.drewThisTurn) {
        if (view.canDraw)
          return view.playable.length
            ? 'Play a card from your hand, or draw again.'
            : 'Still nothing to play. Draw again.';
        return view.canPass
          ? 'Play a card from your hand, or pass.'
          : 'Play a card from your hand.';
      }
      if (!view.playable.length)
        return 'Nothing to play. Tap the deck to draw.';
      return this.touchControls
        ? 'Your turn. Swipe up a glowing card, or tap the deck to draw.'
        : 'Your turn. Play a glowing card, or draw from the deck.';
    }
    const drawing = view.drawnPending ? ' They drew a card.' : '';
    const jump = view.playable.length ? ' You can jump in!' : '';
    return `${name(view.turn)}’s turn…${drawing}${jump}`;
  }

  // ─── The 3D table ────────────────────────────────────────────────────

  setupScene = modifier((canvas) => {
    let scene = null;
    let cancelled = false;
    import('../lazy/uno-scene')
      .then(({ createUnoScene }) => {
        if (cancelled) return;
        scene = createUnoScene(canvas);
        this.scene = scene;
        if (this.view) scene.setView(this.sceneView);
        if (this.gyroOn) scene.setGyro(true);
        scene.setAutoLook(this.lookLocked);
      })
      .catch((error) => {
        console.warn('3D table unavailable:', error);
        this.sceneFailed = true;
      });
    // Tell other players where you're looking, now and then.
    const lookTimer = setInterval(() => this.sendLook(), LOOK_SEND_MS);
    this.canvasEl = canvas;
    const stopInput = listenForActions('woono', {
      active: () => this.mode === 'playing' && onScreen(canvas),
      onAction: (action) => this.onAction(action),
    });
    // A controller's right stick looks around.
    let stickFrame = requestAnimationFrame(
      function steer() {
        const { x, y } = padStick('right');
        if ((x || y) && !this.lookLocked && !this.gyroOn)
          this.scene?.dragLook(-x * 0.02, -y * 0.015);
        stickFrame = requestAnimationFrame(steer.bind(this));
      }.bind(this),
    );
    return () => {
      cancelled = true;
      stopInput();
      cancelAnimationFrame(stickFrame);
      clearInterval(lookTimer);
      scene?.dispose();
      this.scene = null;
    };
  });

  // Mouse: hover lifts a card, click plays it, the view glances toward the edges.
  // Touch: tap a card to lift it, then tap it again or swipe it up to play it.
  // Slide along your hand to flip through the cards; drag anywhere else to look around.
  interact = modifier((canvas) => {
    let press = null;
    const point = (event) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
        y: ((event.clientY - rect.top) / rect.height) * 2 - 1,
        rect,
      };
    };
    // How far up (CSS px) a card has to be swiped to play it.
    const swipeDistance = (rect) => Math.max(SWIPE_MIN_PX, rect.height * 0.12);
    const down = (event) => {
      const mouse = event.pointerType === 'mouse';
      press = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        dragged: false,
        mouse,
        card: null,
        mode: null,
      };
      if (mouse) return;
      canvas.setPointerCapture?.(event.pointerId);
      const p = point(event);
      const hit = this.scene?.pick(p.x, p.y);
      if (hit?.type === 'card' || hit?.type === 'drawn') {
        press.card = { wasUp: this.selectedId === hit.id };
        this.select(hit.id);
      }
    };
    const move = (event) => {
      const p = point(event);
      if (event.pointerType === 'mouse') {
        this.scene?.setPointer(p.x, p.y);
        const hit = this.scene?.setHover(p.x, p.y);
        this.pointing =
          !this.locked &&
          Boolean(hit && (hit.type === 'deck' ? this.canDraw : hit.playable));
        return;
      }
      if (!press || press.id !== event.pointerId) return;
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      if (Math.hypot(dx, dy) > DRAG_PX) press.dragged = true;
      if (press.card && press.dragged) {
        // Up is a swipe to play; sideways flips through the hand. A slide can still turn into a swipe.
        if (-dy > Math.abs(dx)) press.mode = 'swipe';
        else if (press.mode !== 'swipe') press.mode = 'slide';
        if (press.mode === 'slide') {
          const hit = this.scene?.pick(p.x, p.y);
          if (hit?.type === 'card' && hit.id !== this.selectedId) {
            this.select(hit.id);
            // Measure the next swipe from where this card was picked up.
            press.x = event.clientX;
            press.y = event.clientY;
          }
          this.scene?.setSwipe(0);
        } else {
          this.scene?.setSwipe(-dy / swipeDistance(p.rect));
        }
      } else if (press.dragged && !this.gyroOn) {
        this.scene?.dragLook(
          (event.clientX - press.lastX) / p.rect.width,
          (event.clientY - press.lastY) / p.rect.height,
        );
      }
      press.lastX = event.clientX;
      press.lastY = event.clientY;
    };
    const up = (event) => {
      if (!press || press.id !== event.pointerId) return;
      const { dragged, mouse, card, mode, y } = press;
      press = null;
      if (card) {
        this.scene?.setSwipe(0);
        const swiped =
          mode === 'swipe' &&
          y - event.clientY >= swipeDistance(canvas.getBoundingClientRect());
        if (swiped || (!dragged && card.wasUp)) this.playSelected();
        return;
      }
      if (!dragged) this.tap(point(event), mouse);
    };
    const leave = (event) => {
      if (event.pointerType !== 'mouse') return;
      this.scene?.setPointer(0, 0, false);
      this.scene?.clearHover();
      this.pointing = false;
    };
    const cancel = () => {
      press = null;
      this.scene?.setSwipe(0);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('pointerleave', leave);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('pointerleave', leave);
    };
  });

  tap({ x, y }, mouse) {
    const scene = this.scene;
    if (!scene || !this.view) return;
    const hit = scene.pick(x, y);
    if (hit?.type === 'deck') {
      if (this.canDraw) this.drawCard();
      return;
    }
    if (hit?.type === 'color') {
      this.chooseColor(hit.color);
      return;
    }
    if (hit?.type === 'target') {
      this.chooseTarget(hit.index);
      return;
    }
    if (hit?.type === 'card' || hit?.type === 'drawn') {
      // A tap lifts the card so you can see it; tapping the lifted card plays it.
      if (mouse || this.selectedId === hit.id) {
        if (hit.playable) this.playCard(hit.id);
        this.select(null);
      } else {
        this.select(hit.id);
      }
      return;
    }
    this.select(null);
  }

  select(id) {
    this.selectedId = id;
    this.scene?.setSelected(id);
  }

  // Plays the lifted card if it can be played; either way it drops back into the hand.
  playSelected() {
    const id = this.selectedId;
    this.select(null);
    if (id !== null && this.view?.playable.includes(id)) this.playCard(id);
  }

  toggleHelp = () => (this.helpOpen = !this.helpOpen);

  // ─── Keyboard & controller (bound in Settings) ──────────────────────

  canvasEl = null;

  get keyHelp() {
    return (GAME_CONTROLS.find((g) => g.game === 'woono')?.actions ?? []).map(
      (a) => ({ id: a.id, label: a.label, ...bindingParts('woono', a.id) }),
    );
  }
  // Which colour or arrow the keyboard is on while picking.
  pickCursor = 0;

  onAction(action) {
    const view = this.view;
    if (!view) return false;
    const colorIds = {
      red: 'red',
      yellow: 'yellow',
      green: 'green',
      blue: 'blue',
    };
    if (colorIds[action]) {
      if (!this.choosingColor) return false;
      this.chooseColor(action);
      return true;
    }
    switch (action) {
      case 'prev':
      case 'next':
        return this.stepCursor(action === 'next' ? 1 : -1);
      case 'play':
        return this.confirmCursor();
      case 'draw':
        if (!this.canDraw) return false;
        this.drawCard();
        return true;
      case 'keep':
        if (this.locked || !view.canKeep) return false;
        this.keepCard();
        return true;
      case 'pass':
        if (!this.canPass) return false;
        this.passTurn();
        return true;
      case 'uno':
        if (!view.canCallUno) return false;
        this.sayUno();
        return true;
      case 'callout': {
        const target = this.exposedPlayers[0];
        if (!target) return false;
        this.callOut(target.index);
        return true;
      }
      case 'challenge':
        if (this.locked || !view.canChallenge) return false;
        this.challengeCard();
        return true;
      case 'autolook':
        this.toggleLookLock();
        return true;
      case 'chat':
        openChat();
        return true;
      case 'help':
        this.toggleHelp();
        return true;
      default:
        return false;
    }
  }

  // Left/right: through your hand, or through the colours, arrows or swap choices while picking.
  stepCursor(step) {
    if (this.view.choosingSwap) {
      const buttons = [
        ...document.querySelectorAll(
          '.uno-swap-choices button:not([disabled])',
        ),
      ];
      if (!buttons.length) return false;
      const at = buttons.indexOf(document.activeElement);
      buttons[(at + step + buttons.length) % buttons.length].focus({
        focusVisible: true,
      });
      return true;
    }
    if (this.choosingColor) {
      this.pickCursor =
        (this.pickCursor + step + COLORS.length) % COLORS.length;
      this.scene?.setPickHover({
        type: 'color',
        color: COLORS[this.pickCursor],
      });
      return true;
    }
    if (this.choosingTargetNow) {
      const targets = this.scene?.getTargetIndices() ?? [];
      if (!targets.length) return false;
      this.pickCursor =
        (this.pickCursor + step + targets.length) % targets.length;
      this.scene.setPickHover({
        type: 'target',
        index: targets[this.pickCursor],
      });
      return true;
    }
    const ids =
      this.scene?.getHandIds() ?? this.handItems.map((item) => item.key);
    if (!ids.length) return false;
    const at = ids.indexOf(this.selectedId);
    // The first press lifts a card you can play, if there is one.
    const firstPlayable = ids.findIndex((id) =>
      this.view.playable.includes(id),
    );
    const next =
      at === -1
        ? firstPlayable >= 0
          ? firstPlayable
          : step > 0
            ? 0
            : ids.length - 1
        : (at + step + ids.length) % ids.length;
    this.select(ids[next]);
    return true;
  }

  confirmCursor() {
    if (this.view.choosingSwap) {
      const focused = document.activeElement;
      if (!focused?.closest?.('.uno-swap-choices')) return this.stepCursor(1);
      focused.click();
      return true;
    }
    if (this.choosingColor) {
      this.chooseColor(COLORS[this.pickCursor % COLORS.length]);
      return true;
    }
    if (this.choosingTargetNow) {
      const targets = this.scene?.getTargetIndices() ?? [];
      if (!targets.length) return false;
      this.chooseTarget(targets[this.pickCursor % targets.length]);
      return true;
    }
    if (this.selectedId === null) return this.stepCursor(1);
    this.playSelected();
    return true;
  }

  sendLook() {
    if (!this.scene || !this.room.isOnline || !this.view) return;
    const { x, y } = this.scene.getLook();
    if (Math.abs(x - this.sentLook.x) + Math.abs(y - this.sentLook.y) < 0.05)
      return;
    this.sentLook = { x, y };
    const rounded = {
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
    };
    if (this.isHostSide)
      this.room.send({ type: 'look', player: this.view.you, ...rounded });
    else this.room.send({ type: 'look', ...rounded });
  }

  // ─── Gyroscope ───────────────────────────────────────────────────────

  onOrientation = (event) => {
    if (event.alpha === null || event.beta === null || event.gamma === null)
      return;
    if (!this.gyroOn) {
      // The first real reading: this device has a gyroscope, so let it steer.
      this.gyroOn = true;
      this.scene?.setGyro(true);
    }
    const angle = window.screen?.orientation?.angle ?? window.orientation ?? 0;
    this.scene?.setOrientation(event.alpha, event.beta, event.gamma, angle);
  };

  listening = false;

  startGyro = async () => {
    // iPhones and iPads ask for permission, and only from a tap.
    const Orientation = window.DeviceOrientationEvent;
    if (typeof Orientation?.requestPermission === 'function') {
      try {
        if ((await Orientation.requestPermission()) !== 'granted') return;
      } catch {
        return;
      }
    }
    if (!this.listening)
      window.addEventListener('deviceorientation', this.onOrientation);
    this.listening = true;
  };

  stopGyro() {
    if (this.listening)
      window.removeEventListener('deviceorientation', this.onOrientation);
    this.listening = false;
    this.gyroOn = false;
    this.scene?.setGyro(false);
  }

  // Auto look: the camera follows the game by itself (the same on phones and computers). Remembered.
  @tracked lookLocked = readLookLock();

  toggleLookLock = () => {
    this.lookLocked = !this.lookLocked;
    try {
      localStorage.setItem(LOOK_LOCK_KEY, this.lookLocked ? '1' : '0');
    } catch {
      // storage blocked
    }
    this.scene?.setAutoLook(this.lookLocked);
  };

  // On phones, tilting to look around is always on. Where the browser asks permission first
  // (iPhones), it's asked on the first tap on the table.
  autoGyro = modifier(() => {
    let askOnTap = null;
    if (this.gyroAvailable) {
      if (
        typeof window.DeviceOrientationEvent?.requestPermission !== 'function'
      )
        this.startGyro();
      else {
        askOnTap = () => this.startGyro();
        window.addEventListener('pointerup', askOnTap, {
          once: true,
          capture: true,
        });
      }
    }
    // Turning the phone sideways brings the whole table into view.
    const landscape = window.matchMedia?.('(orientation: landscape)');
    const onTurn = () => {
      if (landscape.matches && coarsePointer())
        document
          .querySelector('.uno-stage')
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    landscape?.addEventListener('change', onTurn);
    return () => {
      landscape?.removeEventListener('change', onTurn);
      if (askOnTap)
        window.removeEventListener('pointerup', askOnTap, { capture: true });
    };
  });

  // ─── Your moves ──────────────────────────────────────────────────────

  // The card goes down first; a wild's colour and a targeted card's target are picked on the table after.
  playCard = (id) => {
    if (this.locked || !this.view?.playable.includes(id)) return;
    this.act({ type: 'play', cardId: id });
  };

  playDrawn = () => this.view?.drawn && this.playCard(this.view.drawn.id);

  chooseColor = (color) =>
    !this.settling && this.act({ type: 'choose', color });
  chooseTarget = (target) =>
    !this.settling && this.act({ type: 'choose', target });

  get myChoice() {
    const view = this.view;
    return view?.choice &&
      view.choice.player === view.you &&
      view.winner === null
      ? view.choice
      : null;
  }

  get choosingColor() {
    return this.myChoice?.needs === 'color';
  }

  get choosingTargetNow() {
    return this.myChoice?.needs === 'target';
  }

  // Everyone, you included, for aiming a targeted card.
  get allPlayers() {
    const view = this.view;
    if (!view) return [];
    return view.players.map((p, index) => ({
      ...p,
      index,
      label: index === view.you ? 'You' : p.name,
    }));
  }

  drawCard = () => this.act({ type: 'draw' });
  keepCard = () => this.act({ type: 'keep' });
  passTurn = () => this.act({ type: 'pass' });
  sayUno = () => this.act({ type: 'uno' });
  callOut = (target) => this.act({ type: 'callout', target });
  swapTarget = (index) => this.act({ type: 'swap', target: index });
  challengeCard = () => this.act({ type: 'challenge' });

  // ─── Leaving ─────────────────────────────────────────────────────────

  playAgain = () => this.room.allReady && this.start();
  readyCheck = () => this.room.callReadyCheck();

  // Mid-game, going back to the lobby asks first (hold to confirm), since it ends the game for everyone.
  @tracked confirmingLobby = false;

  askLobby = () => {
    if (this.isOver) this.toLobby();
    else this.confirmingLobby = true;
  };

  cancelLobby = () => (this.confirmingLobby = false);

  get lobbyWarning() {
    return this.room.isOnline
      ? 'The game in progress will be cancelled for everyone at the table, and all hands will be lost.'
      : 'The game in progress will be cancelled and all hands will be lost.';
  }

  toLobby = () => {
    this.confirmingLobby = false;
    if (this.room.isOnline) this.room.send({ type: 'lobby' });
    this.backToLobby();
  };

  backToLobby() {
    this.confirmingLobby = false;
    this.stopBots();
    clearTimeout(this.turnTimer);
    clearTimeout(this.settleTimer);
    clearInterval(this.clockTimer);
    this.clockTimer = null;
    this.turnDeadline = null;
    this.timerTurn = null;
    this.settling = false;
    this.busyUntil = 0;
    this.room.setLocked(false);
    this.mode = 'lobby';
    this.view = null;
    this.state = null;
  }

  leave = async () => {
    if (
      !this.isOver &&
      !(await askConfirm({
        title: 'Leave the game?',
        message:
          'You’ll be disconnected, and the computer takes over your hand.',
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
      const index = this.state
        ? this.state.players.findIndex((p) => p.id === from)
        : -1;
      if (message.type === 'action' && index >= 0) {
        if (this.apply(index, message.action)) this.refresh();
      } else if (message.type === 'look' && index >= 0) {
        this.scene?.setLook(index, message.x, message.y);
        // Pass it on; the sender ignores its own.
        this.room.send({
          type: 'look',
          player: index,
          x: message.x,
          y: message.y,
        });
      }
      return;
    }
    if (message.type === 'view') this.show(message.view);
    else if (message.type === 'look' && message.player !== this.view?.you)
      this.scene?.setLook(message.player, message.x, message.y);
    else if (message.type === 'lobby') this.backToLobby();
  }

  <template>
    <ToolPage
      @route="woono"
      @busy={{this.busy}}
      @closeWarning={{this.closeWarning}}
      @landscape={{true}}
      @game={{true}}
      @subtitle="Do you want your friendships to end? Match colours and numbers, stack +4s on your best friend, and empty your hand first. Up to eight players around a 3D table, with all the house rules."
    >
      {{#if (eq this.mode "playing")}}
        <div class="game-shell uno-shell pop-in" {{this.autoGyro}}>
          {{! Everything you play with sits inside the table view: your cards, the buttons, the chat. }}
          <div class="uno-stage {{if this.isMyTurn 'is-my-turn'}}">
            <canvas
              class="uno-canvas {{if this.pointing 'is-pointing'}}"
              aria-hidden="true"
              {{this.setupScene}}
              {{this.interact}}
              {{noImageSave}}
            ></canvas>

            {{#if this.sceneFailed}}
              <div class="uno-fallback">
                <div class="uno-fallback-table">
                  <div
                    class="uno-card is-{{if
                        this.view.top.color
                        this.view.top.color
                        'wild'
                      }}"
                    aria-label="Top card: {{cardLabel this.view.top}}"
                  >
                    <span class="uno-card-corner">{{symbol
                        this.view.top
                      }}</span>
                    <span class="uno-card-symbol">{{symbol
                        this.view.top
                      }}</span>
                  </div>
                  {{#if this.drawnItem}}
                    <button
                      type="button"
                      class="uno-card is-{{if
                          this.drawnItem.card.color
                          this.drawnItem.card.color
                          'wild'
                        }}
                        {{unless this.drawnItem.playable 'is-dim'}}"
                      aria-label="You drew: {{this.drawnItem.label}}"
                      disabled={{if this.drawnItem.playable false true}}
                      {{on "click" this.playDrawn}}
                    >
                      <span
                        class="uno-card-corner"
                      >{{this.drawnItem.symbol}}</span>
                      <span
                        class="uno-card-symbol"
                      >{{this.drawnItem.symbol}}</span>
                    </button>
                  {{/if}}
                  <ul class="uno-fallback-players">
                    {{#each this.opponents key="index" as |p|}}
                      <li
                        class={{if (eq this.view.turn p.index) "is-turn"}}
                      >{{p.name}} · {{p.count}}</li>
                    {{/each}}
                  </ul>
                  <button
                    type="button"
                    class="btn"
                    disabled={{if this.canDraw false true}}
                    {{on "click" this.drawCard}}
                  >Draw</button>
                </div>
                <div class="uno-fallback-hand">
                  {{#each this.handItems key="key" as |item|}}
                    <button
                      type="button"
                      class="uno-card is-{{if
                          item.card.color
                          item.card.color
                          'wild'
                        }}
                        {{unless item.playable 'is-dim'}}"
                      aria-label={{item.label}}
                      disabled={{if item.playable false true}}
                      {{on "click" (fn this.playCard item.key)}}
                    >
                      <span class="uno-card-corner">{{item.symbol}}</span>
                      <span class="uno-card-symbol">{{item.symbol}}</span>
                    </button>
                  {{/each}}
                </div>
              </div>
            {{/if}}

            <div
              class="uno-timer
                {{if this.isMyTurn 'is-mine'}}
                {{if (lowTime this.secondsLeft) 'is-low'}}"
              style={{this.timerStyle}}
              aria-hidden="true"
            ></div>

            <div class="uno-overlay uno-top-left">
              <div class="uno-hud">
                {{#if this.secondsLeft}}<span
                    class="uno-hud-chip uno-clock
                      {{if (lowTime this.secondsLeft) 'is-alert'}}"
                  ><Icon
                      @name="timer"
                      @size={{12}}
                    />{{this.secondsLeft}}s</span>{{/if}}
                <span class="uno-hud-chip"><span
                    class="uno-current is-{{this.view.color}}"
                  ></span>{{this.view.color}}</span>
                <span class="uno-hud-chip"><span
                    class="uno-direction
                      {{if (eq this.view.direction -1) 'is-reversed'}}"
                  ><Icon
                      @name="rotate-cw"
                      @size={{12}}
                    /></span>{{this.view.drawPileCount}}
                  left</span>
              </div>
              {{#if this.ruleBadges.length}}
                <div class="uno-rule-badges">
                  {{#each this.ruleBadges as |badge|}}<span
                      class="lobby-tag"
                    >{{badge}}</span>{{/each}}
                </div>
              {{/if}}
            </div>

            <div class="uno-overlay uno-top-right">
              <GameSettings @game="woono" />
              {{#if this.isHostSide}}
                <button
                  type="button"
                  class="btn"
                  {{on "click" this.askLobby}}
                ><Icon @name="users" @size={{13}} /> Lobby</button>
              {{else}}
                <button
                  type="button"
                  class="btn"
                  {{on "click" this.leave}}
                ><Icon @name="log-out" @size={{13}} /> Leave</button>
              {{/if}}
              <ol class="uno-log" aria-label="What happened">
                {{#each this.view.log key="id" as |entry|}}<li
                  >{{entry.text}}</li>{{/each}}
              </ol>
            </div>

            <p
              class="uno-overlay uno-status {{if this.isOver 'is-over'}}"
              role="status"
            >{{#if this.iWon}}<Icon @name="party-popper" @size={{15}} />
              {{/if}}{{this.status}}</p>

            {{#if this.exposedPlayers.length}}
              <div class="uno-overlay uno-callouts">
                {{#each this.exposedPlayers key="index" as |p|}}
                  <button
                    type="button"
                    class="btn uno-callout"
                    {{on "click" (fn this.callOut p.index)}}
                  ><Icon @name="flag" @size={{13}} />
                    {{p.name}}
                    didn’t say Woono!</button>
                {{/each}}
              </div>
            {{/if}}

            {{#unless this.iAmSpectator}}
              <div class="uno-overlay uno-actions">
                <button
                  type="button"
                  class="btn uno-icon-btn {{if this.helpOpen 'active'}}"
                  aria-expanded={{if this.helpOpen "true" "false"}}
                  aria-controls="uno-help"
                  aria-label="Controls"
                  title="Controls"
                  {{on "click" this.toggleHelp}}
                ><Icon @name="info" @size={{15}} /></button>
                <button
                  type="button"
                  class="btn uno-icon-btn {{if this.lookLocked 'active'}}"
                  aria-pressed={{if this.lookLocked "true" "false"}}
                  aria-label="Look around automatically"
                  title={{if
                    this.lookLocked
                    "Auto look is on: the view follows the game"
                    "Auto look: let the view follow the game"
                  }}
                  {{on "click" this.toggleLookLock}}
                ><Icon @name="locate-fixed" @size={{15}} /></button>
                {{#if this.isOver}}
                  {{#if this.isHostSide}}
                    {{#unless this.room.allReady}}
                      <span
                        class="uno-hud-chip"
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
                      title={{if
                        this.room.allReady
                        ""
                        "Everyone has to press Ready first"
                      }}
                      {{on "click" this.playAgain}}
                    ><Icon @name="rotate-cw" @size={{13}} /> Play again</button>
                  {{else}}
                    <ReadyButton
                      @room={{this.room}}
                      @label="Play again?"
                      @readyLabel="Ready for another"
                    />
                    {{#if this.room.iAmReady}}<span class="uno-hud-chip">Waiting
                        for the host…</span>{{/if}}
                  {{/if}}
                {{else}}
                  {{#if this.view.canKeep}}
                    {{#if this.drawnPlayable}}
                      <button
                        type="button"
                        class="btn active"
                        disabled={{this.locked}}
                        {{on "click" this.playDrawn}}
                      >Play it</button>
                    {{/if}}
                    <button
                      type="button"
                      class="btn"
                      disabled={{this.locked}}
                      {{on "click" this.keepCard}}
                    >Keep it</button>
                  {{/if}}
                  {{#if this.view.canTake}}
                    <button
                      type="button"
                      class="btn"
                      disabled={{this.locked}}
                      {{on "click" this.drawCard}}
                    >{{this.takeLabel}}</button>
                  {{else if this.view.drewThisTurn}}
                    {{#if this.view.canDraw}}
                      <button
                        type="button"
                        class="btn"
                        disabled={{this.locked}}
                        {{on "click" this.drawCard}}
                      >Draw again</button>
                    {{/if}}
                  {{/if}}
                  {{#if this.view.canPass}}
                    <button
                      type="button"
                      class="btn"
                      disabled={{this.locked}}
                      {{on "click" this.passTurn}}
                    >Pass</button>
                  {{/if}}
                  {{#if this.view.canChallenge}}
                    <button
                      type="button"
                      class="btn active uno-challenge"
                      disabled={{this.locked}}
                      {{on "click" this.challengeCard}}
                    ><Icon @name="flag" @size={{13}} /> Challenge</button>
                  {{/if}}
                  <button
                    type="button"
                    class="btn uno-call
                      {{if this.view.canCallUno 'is-ready'}}
                      {{if this.view.unoArmed 'is-armed'}}
                      {{if this.iAmExposed 'is-urgent'}}"
                    disabled={{if this.view.canCallUno false true}}
                    title={{if
                      this.view.unoArmed
                      "You’ll say Woono when you play your next card"
                      "Press with two cards left, before you play one"
                    }}
                    {{on "click" this.sayUno}}
                  >{{#if this.view.unoArmed}}<Icon @name="check" @size={{13}} />
                    {{/if}}{{this.unoLabel}}</button>
                {{/if}}
              </div>
            {{/unless}}

            {{#if this.iAmSpectator}}
              <div class="mines-spectate" role="status">
                <span class="mines-spectate-label"><Icon
                    @name="eye"
                    @size={{14}}
                  />
                  Watching. Nobody’s cards are sent to this screen.</span>
              </div>
            {{/if}}

            <GameChat
              @room={{this.room}}
              @floating={{true}}
              @class="uno-overlay uno-chat"
            />

            {{#if this.helpOpen}}
              <div
                id="uno-help"
                class="uno-help pop-in"
                role="dialog"
                aria-label="Controls"
              >
                <div class="uno-help-head">
                  <span class="qr-label">Controls</span>
                  <button
                    type="button"
                    class="btn uno-icon-btn"
                    aria-label="Close"
                    {{on "click" this.toggleHelp}}
                  ><Icon @name="x" @size={{14}} /></button>
                </div>
                {{#if this.touchControls}}
                  <ul>
                    <li><strong>Tap a card</strong> to lift it</li>
                    <li><strong>Swipe it up</strong>
                      or
                      <strong>tap it again</strong>
                      to play it</li>
                    <li><strong>Slide along your hand</strong>
                      to flip through your cards</li>
                    <li><strong>Tap the deck</strong>
                      to draw, then play the card or keep it</li>
                    <li>{{if
                        this.gyroAvailable
                        "Tilt your phone"
                        "Drag the table"
                      }}
                      to look around, or turn on
                      <strong>auto look</strong>
                      <Icon @name="locate-fixed" @size={{12}} />
                      to let the view follow the game</li>
                  </ul>
                {{else}}
                  <ul>
                    <li><strong>Hover a card</strong> to lift it</li>
                    <li><strong>Click it</strong> to play it</li>
                    <li><strong>Click the deck</strong>
                      to draw, then play the card or keep it</li>
                    <li><strong>Move to the edges</strong>
                      to look around, or turn on
                      <strong>auto look</strong>
                      <Icon @name="locate-fixed" @size={{12}} />
                      to let the view follow the game</li>
                  </ul>
                {{/if}}
                <details class="uno-help-keys">
                  <summary>Keyboard & controller</summary>
                  <ul>
                    {{#each this.keyHelp key="id" as |k|}}
                      <li><strong>{{k.label}}</strong>
                        <span class="uno-help-bind">{{#if k.keys}}<Icon
                              @name="keyboard"
                              @size={{12}}
                            />
                            {{k.keys}}{{/if}}{{#if k.pad}}{{#if k.keys}}
                              ·
                            {{/if}}<Icon @name="gamepad-2" @size={{12}} />
                            {{k.pad}}{{/if}}{{#unless k.keys}}{{#unless
                              k.pad
                            }}Not bound{{/unless}}{{/unless}}</span></li>
                    {{/each}}
                  </ul>
                  <p class="tool-hint">Change them any time in Settings →
                    Controls.</p>
                </details>
                <p class="tool-hint">Press
                  <strong>Woono!</strong>
                  with two cards left and it’s said as you play. Forgot? Press
                  it before someone calls you out, or draw
                  {{this.view.rules.unoPenalty}}.</p>
              </div>
            {{/if}}

            {{#if this.confirmingLobby}}
              <HoldConfirm
                @title="Back to the lobby?"
                @message={{this.lobbyWarning}}
                @confirmLabel="Hold to end game"
                @onConfirm={{this.toLobby}}
                @onCancel={{this.cancelLobby}}
              />
            {{/if}}

            <p class="uno-rotate-hint" aria-hidden="true"><Icon
                @name="rotate-cw"
                @size={{14}}
              />
              Turn your phone sideways for the full table</p>

            {{! The colour and target are picked on the 3D table; these dialogs only stand in without WebGL. }}
            {{#if this.sceneFailed}}
              {{#if this.choosingColor}}
                <div
                  class="uno-dialog pop-in"
                  role="dialog"
                  aria-label="Choose a colour"
                >
                  <span class="qr-label">Choose a colour</span>
                  <div class="uno-color-choices">
                    {{#each this.colors as |color|}}
                      <button
                        type="button"
                        class="uno-color-btn is-{{color}}"
                        aria-label={{color}}
                        disabled={{this.settling}}
                        {{on "click" (fn this.chooseColor color)}}
                      ></button>
                    {{/each}}
                  </div>
                </div>
              {{/if}}
              {{#if this.choosingTargetNow}}
                <div
                  class="uno-dialog pop-in"
                  role="dialog"
                  aria-label="Who draws"
                >
                  <span class="qr-label">Who draws?</span>
                  <div class="uno-swap-choices">
                    {{#each this.allPlayers key="index" as |p|}}
                      <button
                        type="button"
                        class="btn"
                        disabled={{this.settling}}
                        {{on "click" (fn this.chooseTarget p.index)}}
                      >{{p.label}}
                        <span class="lobby-tag">{{p.count}}
                          {{if (eq p.count 1) "card" "cards"}}</span></button>
                    {{/each}}
                  </div>
                </div>
              {{/if}}
            {{/if}}

            {{#if this.view.choosingSwap}}
              <div
                class="uno-dialog pop-in"
                role="dialog"
                aria-label="Swap hands with"
              >
                <span class="qr-label">Swap hands with…</span>
                <div class="uno-swap-choices">
                  {{#each this.opponents key="index" as |p|}}
                    <button
                      type="button"
                      class="btn"
                      disabled={{this.settling}}
                      {{on "click" (fn this.swapTarget p.index)}}
                    >{{p.name}}
                      <span class="lobby-tag">{{p.count}}
                        {{if (eq p.count 1) "card" "cards"}}</span></button>
                  {{/each}}
                </div>
              </div>
            {{/if}}
          </div>

          <div class="sr-only">
            <button
              type="button"
              disabled={{if this.canDraw false true}}
              {{on "click" this.drawCard}}
            >{{if this.view.canTake this.takeLabel "Draw a card"}}
              ({{this.view.drawPileCount}}
              left)</button>
            {{#if this.drawnItem}}
              <button
                type="button"
                disabled={{if this.drawnItem.playable false true}}
                {{on "click" this.playDrawn}}
              >Play the card you drew: {{this.drawnItem.label}}</button>
              <button type="button" {{on "click" this.keepCard}}>Keep it</button>
            {{/if}}
            {{#if this.choosingColor}}
              {{#each this.colors as |color|}}
                <button
                  type="button"
                  disabled={{this.settling}}
                  {{on "click" (fn this.chooseColor color)}}
                >Make it {{color}}</button>
              {{/each}}
            {{/if}}
            {{#if this.choosingTargetNow}}
              {{#each this.allPlayers key="index" as |p|}}
                <button
                  type="button"
                  disabled={{this.settling}}
                  {{on "click" (fn this.chooseTarget p.index)}}
                >Aim it at {{p.label}}</button>
              {{/each}}
            {{/if}}
            <ul aria-label="Your hand">
              {{#each this.handItems key="key" as |item|}}
                <li><button
                    type="button"
                    disabled={{if item.playable false true}}
                    {{on "click" (fn this.playCard item.key)}}
                  >{{item.label}}{{unless
                      item.playable
                      " (can't play)"
                    }}</button></li>
              {{/each}}
            </ul>
          </div>
        </div>
      {{else}}
        <GameLobby
          @game="woono"
          @room={{this.room}}
          @seats={{this.seats}}
          @maxSeats={{8}}
          @onAddBot={{this.addBot}}
          @onRemoveBot={{this.removeBot}}
          @spectatable={{true}}
          @onStart={{this.start}}
          @startLabel="Deal"
          @blocker={{this.blocker}}
        >
          <:rules>
            <label class="lobby-rule is-switch">
              <span class="lobby-rule-text"><span class="qr-label">Starting hand</span><span
                  class="tool-hint"
                >Cards each player is dealt, from
                  {{this.handMin}}
                  to
                  {{this.handMax}}.</span></span>
              <input
                type="number"
                class="lobby-number"
                min={{this.handMin}}
                max={{this.handMax}}
                step="1"
                value={{this.settings.handSize}}
                {{on "change" (fn this.setNumberRule "handSize")}}
              />
            </label>
            <div class="lobby-rule">
              <span class="lobby-rule-text"><span
                  class="qr-label"
                >Stacking</span><span class="tool-hint">Answer a draw card with
                  another and pass the growing pile along. “Equal or higher”: +4
                  on +2 is fine, +2 on +4 isn’t.</span></span>
              <div class="math-tabs" role="group" aria-label="Stacking">
                {{#each this.stackingOptions as |o|}}
                  <button
                    type="button"
                    class="qr-tab
                      {{if (eq this.settings.stacking o.id) 'active'}}"
                    aria-pressed={{if
                      (eq this.settings.stacking o.id)
                      "true"
                      "false"
                    }}
                    {{on "click" (fn this.setRule "stacking" o.id)}}
                  >{{o.label}}</button>
                {{/each}}
              </div>
            </div>
            <div class="lobby-rule">
              <span class="lobby-rule-text"><span class="qr-label">Turn timer</span><span
                  class="tool-hint"
                >How long each player gets. Run out and the game draws a card
                  for you.</span></span>
              <div class="math-tabs" role="group" aria-label="Turn timer">
                {{#each this.timerOptions as |o|}}
                  <button
                    type="button"
                    class="qr-tab
                      {{if (eq this.settings.turnTime o.id) 'active'}}"
                    aria-pressed={{if
                      (eq this.settings.turnTime o.id)
                      "true"
                      "false"
                    }}
                    {{on "click" (fn this.setRule "turnTime" o.id)}}
                  >{{o.label}}</button>
                {{/each}}
              </div>
            </div>
            {{#each this.switchRules as |rule|}}
              <label class="lobby-rule is-switch">
                <span class="lobby-rule-text"><span
                    class="qr-label"
                  >{{rule.label}}</span><span
                    class="tool-hint"
                  >{{rule.hint}}</span></span>
                <span class="qr-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={{ruleOn this.settings rule.key}}
                    aria-checked={{if
                      (ruleOn this.settings rule.key)
                      "true"
                      "false"
                    }}
                    {{on "change" (fn this.toggleRule rule.key)}}
                  />
                  <span class="qr-switch-track" aria-hidden="true"></span>
                </span>
              </label>
            {{/each}}
            <label class="lobby-rule is-switch">
              <span class="lobby-rule-text"><span class="qr-label">Forgetting to
                  call Woono</span><span class="tool-hint">Cards drawn if
                  someone calls you out, from
                  {{this.penaltyMin}}
                  to
                  {{this.penaltyMax}}. Press Woono! with two cards left, or with
                  one before anyone catches you.</span></span>
              <input
                type="number"
                class="lobby-number"
                min={{this.penaltyMin}}
                max={{this.penaltyMax}}
                step="1"
                value={{this.settings.unoPenalty}}
                {{on "change" (fn this.setNumberRule "unoPenalty")}}
              />
            </label>
            <div class="lobby-rule uno-card-rules">
              <span class="lobby-rule-text"><span class="qr-label">Cards in the
                  deck</span><span class="tool-hint">Numbers are always in.
                  Switch action cards on or off.</span></span>
              {{#each this.cardTypes as |type|}}
                <label class="lobby-rule is-switch">
                  <span class="lobby-rule-text"><span
                      class="qr-label"
                    >{{type.label}}</span><span
                      class="tool-hint"
                    >{{type.hint}}</span></span>
                  <span class="qr-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={{cardOn this.settings type.id}}
                      aria-checked={{if
                        (cardOn this.settings type.id)
                        "true"
                        "false"
                      }}
                      {{on "change" (fn this.toggleCard type.id)}}
                    />
                    <span class="qr-switch-track" aria-hidden="true"></span>
                  </span>
                </label>
              {{/each}}
            </div>
          </:rules>
        </GameLobby>
      {{/if}}
    </ToolPage>
  </template>
}

function unoSoundFor(event, view) {
  switch (event.type) {
    case 'play': {
      const value = event.card?.value;
      if (value === 'skip') return 'uno.skip';
      if (value === 'reverse') return 'uno.reverse';
      if (value === 'wild') return 'uno.wild';
      return 'uno.play';
    }
    case 'draw':
      return event.reason === 'centre' ? 'uno.draw' : 'uno.hit';
    case 'keep':
      return 'uno.keep';
    case 'attack':
      return 'uno.attack';
    case 'color':
      return 'uno.color';
    case 'uno':
      return 'uno.uno';
    case 'callout':
      return 'uno.callout';
    case 'block':
      return 'uno.block';
    case 'reflect':
      return 'uno.reflect';
    case 'swap':
      return 'uno.swap';
    case 'rotate':
      return 'uno.rotate';
    case 'challenge':
      return 'uno.challenge';
    case 'timeout':
      return 'uno.timeout';
    case 'skip':
      return event.player === view.you ? 'uno.hit' : null;
    case 'win':
      return event.player === view.you ? 'uno.win' : 'uno.lose';
    default:
      return null;
  }
}

function cardLabel(card) {
  return card ? cardName(card) : '';
}

function lowTime(seconds) {
  return seconds !== null && seconds <= 5;
}

function ruleOn(settings, key) {
  return Boolean(settings[key]);
}

function cardOn(settings, id) {
  return settings.cards?.[id] ?? DEFAULT_CARDS[id];
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
