import Component from '@glimmer/component';
import { tracked, cached } from '@glimmer/tracking';
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
import { robotAvatar } from '../utils/avatar';
import { botNames, newBotSeed } from '../utils/bot-names';
import { BotChatter } from '../utils/bot-chat';
import { COLORS, MAX_PLAYERS, DEFAULT_RULES, HAND_SIZE_RANGE, PENALTY_RANGE, clampInt, normaliseRules, cardName, createGame, viewFor, play, draw, pass, callUno, swapWith, challenge, timeOut, botTurn, botJumpIn, handToBot, TURN_TIMES, CHALLENGE_EXTRA } from '../utils/uno';

const BOT_DELAY_MS = 1000;
const JUMP_IN_DELAY_MS = 650;
const SYMBOLS = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: 'W', wild4: '+4' };
const COLOR_ORDER = { red: 0, yellow: 1, green: 2, blue: 3 };
const VALUE_ORDER = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2', 'wild', 'wild4'];
const STACKING = [
  { id: 'off', label: 'Off' },
  { id: 'same', label: '+2 on +2, +4 on +4' },
  { id: 'mixed', label: 'Any draw card' },
];
// Where you're looking is sent to other players at most this often.
const LOOK_SEND_MS = 150;
// A touch that moves further than this (CSS px) is a drag to look around, not a tap.
const DRAG_PX = 8;
const SWITCH_RULES = [
  { key: 'sevens', label: 'Sevens swap', hint: 'Play a 7 and swap hands with anyone.' },
  { key: 'zeros', label: 'Zeros rotate', hint: 'Play a 0 and every hand moves along to the next player.' },
  { key: 'jumpIn', label: 'Jump-in', hint: 'Hold an exact copy of the top card? Play it out of turn.' },
  { key: 'drawUntilPlayable', label: 'Draw until you can play', hint: 'Keep drawing instead of stopping after one card.' },
  { key: 'challenge', label: 'Challenge Wild Draw Fours', hint: `Think a +4 was played while they still had the colour in play? Challenge it. Right: they draw instead. Wrong: you draw ${CHALLENGE_EXTRA} extra.` },
];
const TIMER_OPTIONS = TURN_TIMES.map((seconds) => ({ id: seconds, label: seconds ? `${seconds}s` : 'Off' }));

const eq = (a, b) => a === b;
const symbol = (card) => SYMBOLS[card.value] ?? card.value;
const coarsePointer = () => window.matchMedia?.('(pointer: coarse)').matches;

export default class UnoPage extends Component {
  colors = COLORS;
  handMin = HAND_SIZE_RANGE[0];
  handMax = HAND_SIZE_RANGE[1];
  stackingOptions = STACKING;
  penaltyMin = PENALTY_RANGE[0];
  penaltyMax = PENALTY_RANGE[1];
  switchRules = SWITCH_RULES;
  timerOptions = TIMER_OPTIONS;

  // 'lobby' | 'playing'
  @tracked mode = 'lobby';
  // What this device's player can see; replaced after every action.
  @tracked view = null;
  // A wild card waiting for its colour.
  @tracked choosingFor = null;
  @tracked sceneFailed = false;
  @tracked pointing = false;
  // Phone tilt steers the camera once the gyroscope has sent a reading.
  @tracked gyroOn = false;
  @tracked gyroAvailable = false;
  // When the player to move runs out of time (this device's clock), and a clock that ticks to show it.
  @tracked turnDeadline = null;
  @tracked now = Date.now();

  // The full game, only on the host.
  state = null;
  botTimer = null;
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
    this.gyroAvailable = typeof window.DeviceOrientationEvent !== 'undefined' && coarsePointer();
    registerDestructor(this, () => {
      clearTimeout(this.botTimer);
      clearTimeout(this.turnTimer);
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
    const humans = this.room.members.map((m) => ({ ...m, kind: 'human' }));
    const bots = Math.max(0, Math.min(this.settings.bots, MAX_PLAYERS - humans.length));
    const seed = this.settings.botSeed;
    return [...humans, ...botNames(seed, bots).map((name, i) => ({ id: `bot-${i + 1}`, name, kind: 'bot', avatar: robotAvatar(seed, i) }))];
  }

  get blocker() {
    return this.seats.length < 2 ? 'Add a computer player or invite a friend to start.' : null;
  }

  setRule = (key, value) => this.room.setSettings({ [key]: value });
  toggleRule = (key, event) => this.room.setSettings({ [key]: event.target.checked });
  addBot = () => this.room.setSettings({ bots: Math.min(this.settings.bots + 1, MAX_PLAYERS - this.room.members.length) });
  removeBot = () => this.room.setSettings({ bots: Math.max(0, Math.min(this.settings.bots, MAX_PLAYERS - this.room.members.length) - 1) });
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
    if (this.room.isOnline) return this.room.isHost ? 'Close Woono? You’re hosting, so this ends the game and closes the room for everyone.' : 'Close Woono? You’ll be disconnected from the game.';
    return 'Close Woono? The game in progress will be lost.';
  }

  // ─── Running the game (on the host) ─────────────────────────────────

  start = () => {
    clearTimeout(this.botTimer);
    const players = this.seats.map((seat) => ({ id: seat.id, name: seat.name, kind: seat.kind, avatar: seat.avatar }));
    this.state = createGame(players, normaliseRules(this.settings));
    this.banterSeen = this.state.events.at(-1)?.id ?? null;
    const bots = this.state.players.filter((p) => p.kind === 'bot');
    if (bots.length) this.chatter.say(bots[Math.floor(Math.random() * bots.length)].name, 'hello', { urgent: true });
    this.room.setLocked(true);
    this.choosingFor = null;
    this.refresh();
  };

  get myIndex() {
    return this.state ? this.state.players.findIndex((p) => p.id === this.room.selfId) : -1;
  }

  // Rebuilds what everyone sees, then lets a computer player move if it's their turn.
  refresh() {
    const state = this.state;
    this.armTurnTimer();
    // Everyone gets the time left rather than a timestamp, since device clocks disagree.
    const turnLeft = this.turnDeadline ? Math.max(0, this.turnDeadline - Date.now()) : null;
    this.show({ ...viewFor(state, this.myIndex), turnLeft });
    state.players.forEach((player, i) => {
      if (player.kind === 'human' && player.id !== this.room.selfId) this.room.sendTo(player.id, { type: 'view', view: { ...viewFor(state, i), turnLeft } });
    });
    clearTimeout(this.botTimer);
    this.banter(state);
    if (state.winner !== null) return;

    const jump = botJumpIn(state);
    if (jump && Math.random() < 0.5) {
      this.botTimer = setTimeout(() => play(state, jump.index, jump.cardId) && this.refresh(), JUMP_IN_DELAY_MS);
      return;
    }
    const actor = state.swapPending ?? state.turn;
    if (state.players[actor].kind === 'bot') {
      this.botTimer = setTimeout(() => {
        botTurn(state, actor);
        this.refresh();
      }, BOT_DELAY_MS);
    }
  }

  // Host: a fresh countdown whenever the turn passes to someone new.
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
    this.turnDeadline = Date.now() + seconds * 1000;
    const turnId = state.turnId;
    this.turnTimer = setTimeout(() => {
      if (this.state === state && state.turnId === turnId && timeOut(state)) this.refresh();
    }, seconds * 1000);
  }

  // Computer players comment on what just happened: their own big plays, and being on the wrong end of yours.
  banter(state) {
    const fresh = state.events.filter((e) => this.banterSeen === null || e.id > this.banterSeen);
    this.banterSeen = state.events.at(-1)?.id ?? this.banterSeen;
    const players = state.players;
    const isBot = (i) => players[i]?.kind === 'bot';
    const name = (i) => players[i]?.name;
    const someBot = (except) => {
      const bots = players.map((p, i) => i).filter((i) => isBot(i) && i !== except);
      return bots.length ? bots[Math.floor(Math.random() * bots.length)] : null;
    };
    for (const event of fresh) {
      switch (event.type) {
        case 'play': {
          const victim = players.length ? (event.player + state.direction + players.length) % players.length : null;
          const kind = { wild4: 'wild4', draw2: 'draw2', skip: 'skip', reverse: 'reverse', wild: 'wild' }[event.card.value];
          if (isBot(event.player) && kind) this.chatter.say(name(event.player), kind, { chance: kind === 'wild4' ? 0.8 : 0.45, vars: { name: name(victim) } });
          else if (!isBot(event.player) && ['wild4', 'draw2', 'skip'].includes(event.card.value) && isBot(victim)) this.chatter.say(name(victim), 'hit', { chance: 0.6, vars: { name: name(event.player) } });
          break;
        }
        case 'uno':
          if (isBot(event.player)) this.chatter.say(name(event.player), 'uno', { chance: 0.8, urgent: true });
          break;
        case 'swap':
          if (isBot(event.a)) this.chatter.say(name(event.a), 'swap', { chance: 0.6, vars: { name: name(event.b) } });
          break;
        case 'challenge':
          if (isBot(event.player)) this.chatter.say(name(event.player), event.success ? 'challengeWin' : 'challengeLose', { urgent: true, vars: { name: name(event.offender) } });
          else if (event.success && isBot(event.offender)) this.chatter.say(name(event.offender), 'caught', { urgent: true });
          break;
        case 'timeout': {
          const bot = isBot(event.player) ? null : someBot(event.player);
          if (bot !== null) this.chatter.say(name(bot), 'timeout', { chance: 0.7, vars: { name: name(event.player) } });
          break;
        }
        case 'win':
          if (isBot(event.player)) this.chatter.say(name(event.player), 'win', { urgent: true });
          else {
            const bot = someBot(event.player);
            if (bot !== null) this.chatter.say(name(bot), 'lose', { urgent: true, vars: { name: name(event.player) } });
          }
          break;
        default:
          break;
      }
    }
  }

  show(view) {
    this.mode = 'playing';
    if (!this.isHostSide) this.turnDeadline = typeof view.turnLeft === 'number' ? Date.now() + view.turnLeft : null;
    if (this.turnDeadline && !this.clockTimer) this.clockTimer = setInterval(() => (this.now = Date.now()), 250);
    if (!this.turnDeadline) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
    this.view = view;
    if (!view.playable.includes(this.choosingFor?.id)) this.choosingFor = null;
    this.scene?.setView(view);
  }

  act(action) {
    if (this.isHostSide) {
      if (this.apply(this.myIndex, action)) this.refresh();
    } else {
      this.room.send({ type: 'action', action });
    }
  }

  apply(index, action) {
    const state = this.state;
    if (!state || index < 0) return false;
    switch (action?.type) {
      case 'play':
        return play(state, index, action.cardId, action.color);
      case 'draw':
        return draw(state, index);
      case 'pass':
        return pass(state, index);
      case 'uno':
        return callUno(state, index);
      case 'swap':
        return swapWith(state, index, action.target);
      case 'challenge':
        return challenge(state, index);
      default:
        return false;
    }
  }

  // ─── What you see ────────────────────────────────────────────────────

  get isOver() {
    return this.view?.winner !== null && this.view?.winner !== undefined;
  }

  get isMyTurn() {
    const view = this.view;
    return Boolean(view) && view.turn === view.you && view.winner === null && view.swapPending === null;
  }

  get canDraw() {
    return this.isMyTurn && this.view.drawnCardId === null;
  }

  get canPass() {
    return this.isMyTurn && this.view.drawnCardId !== null;
  }

  // Your hand as a plain list: for screen readers, and for playing without WebGL.
  @cached
  get handItems() {
    const view = this.view;
    if (!view) return [];
    const sorted = [...view.hand].sort((a, b) => (COLOR_ORDER[a.color] ?? 9) - (COLOR_ORDER[b.color] ?? 9) || VALUE_ORDER.indexOf(a.value) - VALUE_ORDER.indexOf(b.value));
    return sorted.map((card) => ({ key: card.id, card, playable: view.playable.includes(card.id), symbol: symbol(card), label: cardName(card) }));
  }

  get opponents() {
    const view = this.view;
    if (!view) return [];
    return view.players.map((p, index) => ({ ...p, index })).filter((p) => p.index !== view.you);
  }

  get secondsLeft() {
    if (!this.turnDeadline || this.isOver) return null;
    return Math.max(0, Math.ceil((this.turnDeadline - this.now) / 1000));
  }

  get timerStyle() {
    const total = (this.view?.rules?.turnTime ?? 0) * 1000;
    if (!total || !this.turnDeadline || this.isOver) return htmlSafe('display: none');
    const left = Math.max(0, Math.min(1, (this.turnDeadline - this.now) / total));
    return htmlSafe(`transform: scaleX(${left.toFixed(3)})`);
  }

  get ruleBadges() {
    const r = this.view?.rules;
    if (!r) return [];
    return [r.stacking !== 'off' && 'Stacking', r.sevens && '7 swap', r.zeros && '0 rotate', r.jumpIn && 'Jump-in', r.drawUntilPlayable && 'Draw till play', r.challenge && 'Challenge +4', r.turnTime && `${r.turnTime}s turns`].filter(Boolean);
  }

  get status() {
    const view = this.view;
    if (!view) return '';
    const name = (i) => (i === view.you ? 'You' : view.players[i].name);
    if (view.winner !== null) return view.winner === view.you ? 'You win! 🎉' : `${name(view.winner)} wins.`;
    if (view.choosingSwap) return 'Pick someone to swap hands with.';
    if (view.swapPending !== null) return `${name(view.swapPending)} is picking who to swap hands with…`;
    if (view.turn === view.you) {
      if (view.canChallenge) return `Wild Draw Four! Take ${view.pendingDraw}${view.playable.length ? ', stack one' : ''}, or challenge it.`;
      if (view.pendingDraw) return view.playable.length ? `Stack a draw card, or take ${view.pendingDraw} from the deck.` : `Nothing to stack. Tap the deck to draw ${view.pendingDraw}.`;
      if (view.drawnCardId !== null) return 'You drew a card you can play. Play it or pass.';
      return view.playable.length ? 'Your turn. Play a glowing card, or draw from the deck.' : 'Nothing to play. Tap the deck to draw.';
    }
    const jump = view.playable.length ? ' You can jump in!' : '';
    return `${name(view.turn)}’s turn…${jump}`;
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
        if (this.view) scene.setView(this.view);
        if (this.gyroOn) scene.setGyro(true);
      })
      .catch((error) => {
        console.warn('3D table unavailable:', error);
        this.sceneFailed = true;
      });
    // Tell other players where you're looking, now and then.
    const lookTimer = setInterval(() => this.sendLook(), LOOK_SEND_MS);
    return () => {
      cancelled = true;
      clearInterval(lookTimer);
      scene?.dispose();
      this.scene = null;
    };
  });

  // Mouse: hover lifts a card, click plays it, the view glances toward the edges.
  // Touch: tap a card to lift it and again to play it, drag anywhere to look around.
  interact = modifier((canvas) => {
    let press = null;
    const point = (event) => {
      const rect = canvas.getBoundingClientRect();
      return { x: ((event.clientX - rect.left) / rect.width) * 2 - 1, y: ((event.clientY - rect.top) / rect.height) * 2 - 1, rect };
    };
    const down = (event) => {
      press = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, dragged: false, mouse: event.pointerType === 'mouse' };
      if (!press.mouse) canvas.setPointerCapture?.(event.pointerId);
    };
    const move = (event) => {
      const p = point(event);
      if (event.pointerType === 'mouse') {
        this.scene?.setPointer(p.x, p.y);
        const hit = this.scene?.setHover(p.x, p.y);
        this.pointing = Boolean(hit && (hit.type === 'deck' ? this.canDraw : hit.playable));
        return;
      }
      if (!press || press.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > DRAG_PX) press.dragged = true;
      if (press.dragged && !this.gyroOn) this.scene?.dragLook((event.clientX - press.lastX) / p.rect.width, (event.clientY - press.lastY) / p.rect.height);
      press.lastX = event.clientX;
      press.lastY = event.clientY;
    };
    const up = (event) => {
      if (!press || press.id !== event.pointerId) return;
      const { dragged, mouse } = press;
      press = null;
      if (!dragged) this.tap(point(event), mouse);
    };
    const leave = (event) => {
      if (event.pointerType !== 'mouse') return;
      this.scene?.setPointer(0, 0, false);
      this.scene?.clearHover();
      this.pointing = false;
    };
    const cancel = () => (press = null);
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
    if (hit?.type === 'card') {
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

  sendLook() {
    if (!this.scene || !this.room.isOnline || !this.view) return;
    const { x, y } = this.scene.getLook();
    if (Math.abs(x - this.sentLook.x) + Math.abs(y - this.sentLook.y) < 0.05) return;
    this.sentLook = { x, y };
    const rounded = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
    if (this.isHostSide) this.room.send({ type: 'look', player: this.view.you, ...rounded });
    else this.room.send({ type: 'look', ...rounded });
  }

  // ─── Gyroscope ───────────────────────────────────────────────────────

  onOrientation = (event) => {
    if (event.alpha === null || event.beta === null || event.gamma === null) return;
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
    if (!this.listening) window.addEventListener('deviceorientation', this.onOrientation);
    this.listening = true;
  };

  stopGyro() {
    if (this.listening) window.removeEventListener('deviceorientation', this.onOrientation);
    this.listening = false;
    this.gyroOn = false;
    this.scene?.setGyro(false);
  }

  toggleGyro = () => {
    if (this.listening) this.stopGyro();
    else this.startGyro();
  };

  recenter = () => this.scene?.recenter();

  // On phones that don't need permission, tilt-to-look is on from the start.
  autoGyro = modifier(() => {
    if (this.gyroAvailable && typeof window.DeviceOrientationEvent?.requestPermission !== 'function') this.startGyro();
    // Turning the phone sideways brings the whole table into view.
    const landscape = window.matchMedia?.('(orientation: landscape)');
    const onTurn = () => {
      if (landscape.matches && coarsePointer()) document.querySelector('.uno-stage')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    landscape?.addEventListener('change', onTurn);
    return () => landscape?.removeEventListener('change', onTurn);
  });

  // ─── Your moves ──────────────────────────────────────────────────────

  playCard = (id) => {
    const card = this.view?.hand.find((c) => c.id === id);
    if (!card || !this.view.playable.includes(id)) return;
    if (!card.color) this.choosingFor = card;
    else this.act({ type: 'play', cardId: card.id });
  };

  chooseColor = (color) => {
    const card = this.choosingFor;
    this.choosingFor = null;
    this.act({ type: 'play', cardId: card.id, color });
  };

  cancelColor = () => (this.choosingFor = null);
  drawCard = () => this.act({ type: 'draw' });
  passTurn = () => this.act({ type: 'pass' });
  sayUno = () => this.act({ type: 'uno' });
  swapTarget = (index) => this.act({ type: 'swap', target: index });
  challengeCard = () => this.act({ type: 'challenge' });

  // ─── Leaving ─────────────────────────────────────────────────────────

  playAgain = () => this.start();

  toLobby = () => {
    if (this.room.isOnline) this.room.send({ type: 'lobby' });
    this.backToLobby();
  };

  backToLobby() {
    clearTimeout(this.botTimer);
    clearTimeout(this.turnTimer);
    clearInterval(this.clockTimer);
    this.clockTimer = null;
    this.turnDeadline = null;
    this.timerTurn = null;
    this.room.setLocked(false);
    this.mode = 'lobby';
    this.view = null;
    this.state = null;
    this.choosingFor = null;
  }

  leave = () => {
    this.room.close();
    this.backToLobby();
  };

  // ─── Online ──────────────────────────────────────────────────────────

  onlineMessage(message, from) {
    if (this.isHostSide) {
      const index = this.state ? this.state.players.findIndex((p) => p.id === from) : -1;
      if (message.type === 'action' && index >= 0) {
        if (this.apply(index, message.action)) this.refresh();
      } else if (message.type === 'look' && index >= 0) {
        this.scene?.setLook(index, message.x, message.y);
        // Pass it on; the sender ignores its own.
        this.room.send({ type: 'look', player: index, x: message.x, y: message.y });
      }
      return;
    }
    if (message.type === 'view') this.show(message.view);
    else if (message.type === 'look' && message.player !== this.view?.you) this.scene?.setLook(message.player, message.x, message.y);
    else if (message.type === 'lobby') this.backToLobby();
  }

  <template>
    <ToolPage @route="woono" @busy={{this.busy}} @closeWarning={{this.closeWarning}} @landscape={{true}} @game={{true}} @subtitle="Match colours and numbers and empty your hand first, first person around a 3D table with up to eight players. House rules included.">
      {{#if (eq this.mode "playing")}}
        <div class="game-shell uno-shell pop-in" {{this.autoGyro}}>
          {{! Everything you play with sits inside the table view: your cards, the buttons, the chat. }}
          <div class="uno-stage {{if this.isMyTurn 'is-my-turn'}}">
            <canvas class="uno-canvas {{if this.pointing 'is-pointing'}}" aria-hidden="true" {{this.setupScene}} {{this.interact}}></canvas>

            {{#if this.sceneFailed}}
              <div class="uno-fallback">
                <div class="uno-fallback-table">
                  <div class="uno-card is-{{if this.view.top.color this.view.top.color 'wild'}}" aria-label="Top card: {{cardLabel this.view.top}}">
                    <span class="uno-card-corner">{{symbol this.view.top}}</span>
                    <span class="uno-card-symbol">{{symbol this.view.top}}</span>
                  </div>
                  <ul class="uno-fallback-players">
                    {{#each this.opponents key="index" as |p|}}
                      <li class={{if (eq this.view.turn p.index) "is-turn"}}>{{p.name}} · {{p.count}}</li>
                    {{/each}}
                  </ul>
                  <button type="button" class="btn" disabled={{if this.canDraw false true}} {{on "click" this.drawCard}}>Draw</button>
                </div>
                <div class="uno-fallback-hand">
                  {{#each this.handItems key="key" as |item|}}
                    <button type="button" class="uno-card is-{{if item.card.color item.card.color 'wild'}} {{unless item.playable 'is-dim'}}" aria-label={{item.label}} disabled={{if item.playable false true}} {{on "click" (fn this.playCard item.key)}}>
                      <span class="uno-card-corner">{{item.symbol}}</span>
                      <span class="uno-card-symbol">{{item.symbol}}</span>
                    </button>
                  {{/each}}
                </div>
              </div>
            {{/if}}

            <div class="uno-timer {{if this.isMyTurn 'is-mine'}} {{if (lowTime this.secondsLeft) 'is-low'}}" style={{this.timerStyle}} aria-hidden="true"></div>

            <div class="uno-overlay uno-top-left">
              <div class="uno-hud">
                {{#if this.secondsLeft}}<span class="uno-hud-chip uno-clock {{if (lowTime this.secondsLeft) 'is-alert'}}"><Icon @name="timer" @size={{12}} />{{this.secondsLeft}}s</span>{{/if}}
                <span class="uno-hud-chip"><span class="uno-current is-{{this.view.color}}"></span>{{this.view.color}}</span>
                <span class="uno-hud-chip"><span class="uno-direction {{if (eq this.view.direction -1) 'is-reversed'}}"><Icon @name="rotate-cw" @size={{12}} /></span>{{this.view.drawPileCount}} left</span>
              </div>
              {{#if this.ruleBadges.length}}
                <div class="uno-rule-badges">
                  {{#each this.ruleBadges as |badge|}}<span class="lobby-tag">{{badge}}</span>{{/each}}
                </div>
              {{/if}}
            </div>

            <div class="uno-overlay uno-top-right">
              {{#if this.isHostSide}}
                <button type="button" class="btn" {{on "click" this.toLobby}}><Icon @name="users" @size={{13}} /> Lobby</button>
              {{else}}
                <button type="button" class="btn" {{on "click" this.leave}}><Icon @name="log-out" @size={{13}} /> Leave</button>
              {{/if}}
              <ol class="uno-log" aria-label="What happened">
                {{#each this.view.log key="id" as |entry|}}<li>{{entry.text}}</li>{{/each}}
              </ol>
            </div>

            <p class="uno-overlay uno-status {{if this.isOver 'is-over'}}" role="status">{{this.status}}</p>

            <div class="uno-overlay uno-actions">
              {{#if this.gyroAvailable}}
                <button type="button" class="btn uno-icon-btn {{if this.gyroOn 'active'}}" aria-pressed={{if this.gyroOn "true" "false"}} aria-label="Tilt your phone to look around" title="Tilt to look" {{on "click" this.toggleGyro}}><Icon @name="smartphone" @size={{15}} /></button>
                <button type="button" class="btn uno-icon-btn" aria-label="Look back at the table" title="Recentre" {{on "click" this.recenter}}><Icon @name="locate-fixed" @size={{15}} /></button>
              {{/if}}
              {{#if this.isOver}}
                {{#if this.isHostSide}}
                  <button type="button" class="btn active" {{on "click" this.playAgain}}><Icon @name="rotate-cw" @size={{13}} /> Play again</button>
                {{else}}
                  <span class="uno-hud-chip">Waiting for the host…</span>
                {{/if}}
              {{else}}
                {{#if this.canPass}}
                  <button type="button" class="btn" {{on "click" this.passTurn}}>Pass</button>
                {{/if}}
                {{#if this.view.canChallenge}}
                  <button type="button" class="btn" {{on "click" this.drawCard}}>Take {{this.view.pendingDraw}}</button>
                  <button type="button" class="btn active uno-challenge" {{on "click" this.challengeCard}}><Icon @name="flag" @size={{13}} /> Challenge</button>
                {{/if}}
                <button type="button" class="btn uno-call {{if this.view.canCallUno 'is-ready'}}" disabled={{if this.view.canCallUno false true}} {{on "click" this.sayUno}}>Woono!</button>
              {{/if}}
            </div>

            <GameChat @room={{this.room}} @floating={{true}} @class="uno-overlay uno-chat" />

            <p class="uno-rotate-hint" aria-hidden="true"><Icon @name="rotate-cw" @size={{14}} /> Turn your phone sideways for the full table</p>

            {{#if this.choosingFor}}
              <div class="uno-dialog pop-in" role="dialog" aria-label="Choose a colour">
                <span class="qr-label">Choose a colour</span>
                <div class="uno-color-choices">
                  {{#each this.colors as |color|}}
                    <button type="button" class="uno-color-btn is-{{color}}" aria-label={{color}} {{on "click" (fn this.chooseColor color)}}></button>
                  {{/each}}
                </div>
                <button type="button" class="btn" {{on "click" this.cancelColor}}>Cancel</button>
              </div>
            {{/if}}

            {{#if this.view.choosingSwap}}
              <div class="uno-dialog pop-in" role="dialog" aria-label="Swap hands with">
                <span class="qr-label">Swap hands with…</span>
                <div class="uno-swap-choices">
                  {{#each this.opponents key="index" as |p|}}
                    <button type="button" class="btn" {{on "click" (fn this.swapTarget p.index)}}>{{p.name}} <span class="lobby-tag">{{p.count}} {{if (eq p.count 1) "card" "cards"}}</span></button>
                  {{/each}}
                </div>
              </div>
            {{/if}}
          </div>

          <div class="sr-only">
            <button type="button" disabled={{if this.canDraw false true}} {{on "click" this.drawCard}}>Draw {{if this.view.pendingDraw this.view.pendingDraw "a card"}} ({{this.view.drawPileCount}} left)</button>
            <ul aria-label="Your hand">
              {{#each this.handItems key="key" as |item|}}
                <li><button type="button" disabled={{if item.playable false true}} {{on "click" (fn this.playCard item.key)}}>{{item.label}}{{unless item.playable " (can't play)"}}</button></li>
              {{/each}}
            </ul>
          </div>
        </div>
      {{else}}
        <GameLobby @room={{this.room}} @seats={{this.seats}} @maxSeats={{8}} @onAddBot={{this.addBot}} @onRemoveBot={{this.removeBot}} @onStart={{this.start}} @startLabel="Deal" @blocker={{this.blocker}}>
          <:rules>
            <label class="lobby-rule is-switch">
              <span class="lobby-rule-text"><span class="qr-label">Starting hand</span><span class="tool-hint">Cards each player is dealt, from {{this.handMin}} to {{this.handMax}}.</span></span>
              <input type="number" class="lobby-number" min={{this.handMin}} max={{this.handMax}} step="1" value={{this.settings.handSize}} {{on "change" (fn this.setNumberRule "handSize")}} />
            </label>
            <div class="lobby-rule">
              <span class="lobby-rule-text"><span class="qr-label">Stacking</span><span class="tool-hint">Answer a draw card with another and pass the growing pile along.</span></span>
              <div class="math-tabs" role="group" aria-label="Stacking">
                {{#each this.stackingOptions as |o|}}
                  <button type="button" class="qr-tab {{if (eq this.settings.stacking o.id) 'active'}}" aria-pressed={{if (eq this.settings.stacking o.id) "true" "false"}} {{on "click" (fn this.setRule "stacking" o.id)}}>{{o.label}}</button>
                {{/each}}
              </div>
            </div>
            <div class="lobby-rule">
              <span class="lobby-rule-text"><span class="qr-label">Turn timer</span><span class="tool-hint">How long each player gets. Run out and the game draws a card for you.</span></span>
              <div class="math-tabs" role="group" aria-label="Turn timer">
                {{#each this.timerOptions as |o|}}
                  <button type="button" class="qr-tab {{if (eq this.settings.turnTime o.id) 'active'}}" aria-pressed={{if (eq this.settings.turnTime o.id) "true" "false"}} {{on "click" (fn this.setRule "turnTime" o.id)}}>{{o.label}}</button>
                {{/each}}
              </div>
            </div>
            {{#each this.switchRules as |rule|}}
              <label class="lobby-rule is-switch">
                <span class="lobby-rule-text"><span class="qr-label">{{rule.label}}</span><span class="tool-hint">{{rule.hint}}</span></span>
                <span class="qr-switch">
                  <input type="checkbox" role="switch" checked={{ruleOn this.settings rule.key}} aria-checked={{if (ruleOn this.settings rule.key) "true" "false"}} {{on "change" (fn this.toggleRule rule.key)}} />
                  <span class="qr-switch-track" aria-hidden="true"></span>
                </span>
              </label>
            {{/each}}
            <label class="lobby-rule is-switch">
              <span class="lobby-rule-text"><span class="qr-label">Forgetting to call Woono</span><span class="tool-hint">Cards drawn as a penalty, from {{this.penaltyMin}} to {{this.penaltyMax}}. Press Woono! while holding two cards, before you play one of them.</span></span>
              <input type="number" class="lobby-number" min={{this.penaltyMin}} max={{this.penaltyMax}} step="1" value={{this.settings.unoPenalty}} {{on "change" (fn this.setNumberRule "unoPenalty")}} />
            </label>
          </:rules>
        </GameLobby>
      {{/if}}
    </ToolPage>
  </template>
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
