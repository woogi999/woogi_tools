import Component from '@glimmer/component';
import { tracked, cached } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import { Chess, validateFen } from 'chess.js';
import ToolPage from './tool-page';
import Icon from './icon';
import GameLobby, { ReadyButton } from './game-lobby';
import AvatarPortrait from './avatar-portrait';
import GameChat from './game-chat';
import GameRoom from '../utils/game-room';
import { roomCodeFromUrl } from '../utils/file-share';
import { botNames, newBotSeed } from '../utils/bot-names';
import { BotChatter } from '../utils/bot-chat';
import { robotAvatar } from '../utils/avatar';
import { findBestMove, LEVELS } from '../utils/chess-ai';
import { sfx, preloadSounds } from '../utils/sound';
import HoldConfirm from './hold-confirm';
import { askConfirm } from '../utils/confirm';
import { listenForActions, onScreen, openChat } from '../utils/game-input';
import { CommandError } from '../utils/debug-commands';
import {
  FILES,
  STANDARD_FEN,
  TIME_CONTROLS,
  clockFor,
  formatClock,
  chess960Fen,
  premoveTargets,
  reachableAfterReply,
  applyPremoves,
  syncTokens,
  canMate,
} from '../utils/chess-extras';
import GameSettings from './game-settings';

const PIECE_ICON = {
  k: 'chess-king',
  q: 'chess-queen',
  r: 'chess-rook',
  b: 'chess-bishop',
  n: 'chess-knight',
  p: 'chess-pawn',
};
const PIECE_NAME = {
  k: 'king',
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
  p: 'pawn',
};
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const PROMOTIONS = ['q', 'r', 'b', 'n'];
const COLOR_NAME = { w: 'White', b: 'Black' };
const BOT_DELAY_MS = 350;
const DRAG_SLOP_PX = 4;
const LOW_TIME_MS = 20000;
// Online, the side whose clock runs out says so; this long past zero, the other side calls it anyway.
const FLAG_GRACE_MS = 2500;
const PREFS_KEY = 'woogi-chess-prefs';

// noBot: the host took the computer opponent off the board and is waiting for
// a person instead. Chess seats two, so there is nothing to start without one.
const DEFAULTS = {
  time: 'none',
  minutes: 10,
  increment: 5,
  start: 'standard',
  fen: '',
  color: 'w',
  level: 'medium',
  takebacks: true,
  noBot: false,
};
const START_OPTIONS = [
  { id: 'standard', label: 'Standard' },
  { id: 'chess960', label: 'Chess960' },
  { id: 'fen', label: 'From FEN' },
];
const COLOR_CHOICES = [
  { id: 'w', label: 'White' },
  { id: 'random', label: 'Random' },
  { id: 'b', label: 'Black' },
];
const REASONS = {
  checkmate: 'by checkmate',
  resign: 'by resignation',
  timeout: 'on time',
  abandon: 'by abandonment',
};
const DRAWS = {
  stalemate: 'Stalemate. It’s a draw.',
  repetition: 'Draw by threefold repetition.',
  material: 'Draw: not enough material to checkmate.',
  fifty: 'Draw by the fifty-move rule.',
  agreement: 'Draw agreed.',
  'timeout-draw': 'Out of time, but the other side can’t checkmate: draw.',
};

const eq = (a, b) => a === b;
const other = (color) => (color === 'w' ? 'b' : 'w');
const pieceFill = (color) => (color === 'w' ? '#fafafa' : '#1b1b1b');

function loadPrefs() {
  const defaults = { premoves: true, autoQueen: false, hints: true };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY)) };
  } catch {
    return defaults;
  }
}

export default class ChessPage extends Component {
  levels = Object.entries(LEVELS).map(([id, level]) => ({
    id,
    label: level.label,
  }));
  timeControls = TIME_CONTROLS;
  startOptions = START_OPTIONS;
  colorChoices = COLOR_CHOICES;
  promotions = PROMOTIONS;

  // 'lobby' | 'playing'
  @tracked mode = 'lobby';
  // Bumped after every change to the chess.js instance, which isn't tracked itself.
  @tracked version = 0;
  @tracked playerColor = 'w';
  @tracked opponent = null; // { kind: 'bot' | 'human', name, avatar }
  @tracked level = 'medium';
  @tracked selected = null;
  @tracked pendingPromotion = null;
  @tracked thinking = false;
  // Set for endings chess.js doesn't know about: resignation, time, agreement, abandonment.
  @tracked result = null;
  @tracked premoves = [];
  @tracked tokens = [];
  @tracked offer = null; // { kind: 'draw' | 'takeback', from: 'me' | 'them' }
  @tracked rematchAsked = false;
  @tracked takebacks = true;
  @tracked prefs = loadPrefs();
  // Clocks: time left for each side as of `turnStartedAt`, when the side to move started thinking.
  @tracked clocks = null;
  @tracked turnStartedAt = null;
  @tracked now = 0;

  chess = new Chess();
  incMs = 0;
  abort = null;
  clockTimer = null;
  tokenSeq = 0;
  boardEl = null;

  room = new GameRoom('chess', {
    maxPlayers: 2,
    settings: { ...DEFAULTS, botSeed: newBotSeed() },
    onMessage: (message) => this.onlineMessage(message),
    onGuestLeft: () => this.opponentLeft(),
    onClosed: () => this.opponentLeft(),
  });

  constructor(owner, args) {
    super(owner, args);
    preloadSounds('chess');
    const code = roomCodeFromUrl();
    if (code) this.room.join(code);
    this.room.setDebugTools(this.debugTools());
    const stopInput = listenForActions('chess', {
      active: () => this.mode === 'playing' && onScreen(this.boardEl),
      onAction: (action) => this.onAction(action),
    });
    registerDestructor(this, () => {
      stopInput();
      this.chatter.dispose();
      this.abort?.abort();
      clearInterval(this.clockTimer);
      this.room.close();
    });
  }

  chatter = new BotChatter(this.room);

  get settings() {
    return this.room.settings;
  }

  // ─── Lobby ───────────────────────────────────────────────────────────

  get seats() {
    // Spectators are in the room but take no seat.
    const humans = this.room.players.map((m) => ({ ...m, kind: 'human' }));
    if (humans.length >= 2 || this.settings.noBot) return humans;
    return [
      ...humans,
      {
        id: 'bot',
        name: `${this.botName} (${LEVELS[this.settings.level]?.label ?? 'Medium'})`,
        kind: 'bot',
        avatar: this.botAvatar,
      },
    ];
  }

  // The seat is only offered back when there is actually room for it.
  get canAddBot() {
    return this.settings.noBot && this.room.members.length < 2;
  }

  addBot = () => this.setRule('noBot', false);
  removeBot = () => this.setRule('noBot', true);

  // Chess has one computer seat, so its difficulty is simply the room's
  // `level` rule: picked on the seat itself in the lobby and remembered with
  // the other rules.
  get botLevelMap() {
    return { bot: this.settings.level };
  }

  setBotLevel = (id, level) => this.setRule('level', level);

  // The computer opponent's pun name and robot look, the same for everyone in the room.
  get botName() {
    return botNames(this.settings.botSeed, 1)[0];
  }

  get botAvatar() {
    return robotAvatar(this.settings.botSeed, 0);
  }

  // Watching rather than playing. Chess already broadcasts the opening position
  // and every move to everyone in the room, so a spectator gets the game for
  // free; what it must not get is a colour of its own to move.
  get iAmSpectator() {
    return this.room.iAmSpectating;
  }

  // Chess seats exactly two, and the host is both one of them and the machine
  // that runs the computer opponent, so only a guest can drop out to watch.
  // Snake, Minesweeper and Woono have no such tie: their host simulates every
  // seat, so there the host can sit out and watch the computer players instead.
  get spectatable() {
    return this.room.isOnline && !this.room.isHost;
  }

  get vsBotInLobby() {
    return this.room.members.length < 2 && !this.settings.noBot;
  }

  // Chess needs two players. Without the computer and without a second person
  // there is no game to start, so say which is missing rather than failing.
  get blocker() {
    if (this.seats.length < 2)
      return 'Nobody to play against. Add the computer back, or wait for someone to join.';
    return this.fenError;
  }

  get fenError() {
    if (this.settings.start !== 'fen') return null;
    const fen = this.settings.fen.trim();
    if (!fen) return 'Paste a FEN to start from.';
    const check = validateFen(fen);
    return check.ok ? null : `That FEN isn't valid: ${check.error}`;
  }

  get colorRuleLabel() {
    return this.vsBotInLobby ? 'You play as' : 'Host plays as';
  }

  setRule = (key, value) => this.room.setSettings({ [key]: value });
  setRuleFromInput = (key, event) =>
    this.room.setSettings({ [key]: event.target.value });
  toggleRule = (key, event) =>
    this.room.setSettings({ [key]: event.target.checked });

  setPref = (key, event) => {
    this.prefs = { ...this.prefs, [key]: event.target.checked };
    if (key === 'premoves' && !event.target.checked) this.clearPremoves();
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      // storage blocked
    }
  };

  // Host (or a local game): deals the game, and tells the guest their side.
  startFromLobby = (color) => {
    const s = this.settings;
    const fen =
      s.start === 'chess960'
        ? chess960Fen()
        : s.start === 'fen'
          ? s.fen.trim()
          : STANDARD_FEN;
    const chosen =
      typeof color === 'string'
        ? color
        : s.color === 'random'
          ? Math.random() < 0.5
            ? 'w'
            : 'b'
          : s.color;
    const guest = this.room.players.find((m) => !m.isYou);
    const clock = clockFor(s);
    this.level = s.level;
    this.begin({
      fen,
      color: chosen,
      clock,
      takebacks: s.takebacks,
      opponent: guest
        ? { kind: 'human', name: guest.name, avatar: guest.avatar }
        : {
            kind: 'bot',
            name: `${this.botName} (${LEVELS[s.level].label})`,
            avatar: this.botAvatar,
          },
    });
    this.room.setLocked(true);
    // A rematch needs the other player to press Ready again.
    this.room.resetReady();
    if (guest) {
      this.room.send({
        type: 'start',
        fen,
        color: other(chosen),
        clock,
        takebacks: s.takebacks,
      });
    }
  };

  begin({ fen, color, clock, takebacks, opponent }) {
    this.abort?.abort();
    this.thinking = false;
    this.chess = new Chess(fen);
    this.playerColor = color;
    this.opponent = opponent;
    this.takebacks = takebacks;
    this.selected = null;
    this.pendingPromotion = null;
    this.result = null;
    this.premoves = [];
    this.offer = null;
    this.rematchAsked = false;
    this.clocks = clock ? { w: clock.baseMs, b: clock.baseMs } : null;
    this.incMs = clock?.incMs ?? 0;
    this.turnStartedAt = null;
    this.tokens = [];
    this.endSounded = false;
    this.confirmingLobby = false;
    sfx('chess.start');
    this.mode = 'playing';
    this.room.debug.clearHistory();
    this.room.recordDebugState('New game');
    clearInterval(this.clockTimer);
    if (clock) this.clockTimer = setInterval(() => this.tickClock(), 100);
    this.afterChange();
    if (opponent?.kind === 'bot')
      this.chatter.say(this.botName, 'chessHello', { urgent: true });
    this.maybeBotMove();
  }

  // Picture-in-picture: leaving the page mid-game floats it, and closing it asks first.
  get busy() {
    return (this.mode === 'playing' && !this.isOver) || this.room.isOnline;
  }

  get closeWarning() {
    if (this.room.isOnline)
      return this.room.isHost
        ? 'Close Chess? You’re hosting, so this ends the game and closes the room for everyone.'
        : 'Close Chess? You’ll be disconnected from the game.';
    return 'Close Chess? The game in progress will be lost.';
  }

  // ─── Game state ──────────────────────────────────────────────────────

  get isBot() {
    return this.opponent?.kind === 'bot';
  }

  get outcome() {
    void this.version;
    if (this.result) return this.result;
    const chess = this.chess;
    if (chess.isCheckmate())
      return { winner: other(chess.turn()), reason: 'checkmate' };
    if (chess.isStalemate()) return { winner: null, reason: 'stalemate' };
    if (chess.isThreefoldRepetition())
      return { winner: null, reason: 'repetition' };
    if (chess.isInsufficientMaterial())
      return { winner: null, reason: 'material' };
    if (chess.isDraw()) return { winner: null, reason: 'fifty' };
    return null;
  }

  get isOver() {
    return Boolean(this.outcome);
  }

  get isMyTurn() {
    return (
      this.version >= 0 &&
      this.mode === 'playing' &&
      !this.isOver &&
      !this.thinking &&
      // A spectator is never to move, whatever colour the board is shown from.
      !this.iAmSpectator &&
      this.chess.turn() === this.playerColor
    );
  }

  get canPremove() {
    return (
      this.prefs.premoves &&
      this.mode === 'playing' &&
      !this.isOver &&
      this.chess.turn() !== this.playerColor
    );
  }

  get opponentName() {
    return this.opponent?.name ?? '';
  }

  get status() {
    const outcome = this.outcome;
    if (outcome) {
      if (outcome.winner === null) return DRAWS[outcome.reason];
      const reason = REASONS[outcome.reason];
      return outcome.winner === this.playerColor
        ? `You win ${reason}!`
        : `${this.opponentName} wins ${reason}.`;
    }
    const check = this.chess.inCheck() ? 'Check! ' : '';
    if (this.thinking) return `${check}${this.botName} is thinking…`;
    if (this.chess.turn() === this.playerColor) return `${check}Your move.`;
    return `${check}Waiting for ${this.isBot ? this.botName : this.opponentName}…${this.premoves.length ? ` ${this.premoves.length} premove${this.premoves.length > 1 ? 's' : ''} queued.` : ''}`;
  }

  get lastMove() {
    void this.version;
    const history = this.chess.history({ verbose: true });
    return history[history.length - 1] ?? null;
  }

  // What's drawn: the real position with any premoves already played out.
  @cached
  get displayBoard() {
    void this.version;
    return applyPremoves(this.chess.board(), this.premoves);
  }

  pieceAt(square) {
    const [f, r] = [FILES.indexOf(square[0]), Number(square[1]) - 1];
    return this.displayBoard[7 - r][f];
  }

  @cached
  get targets() {
    void this.version;
    if (!this.selected) return new Map();
    if (this.isMyTurn)
      return new Map(
        this.chess
          .moves({ square: this.selected, verbose: true })
          .map((m) => [m.to, m]),
      );
    if (this.canPremove)
      return new Map(
        this.premoveOptions(this.selected).map((sq) => [sq, { premove: true }]),
      );
    return new Map();
  }

  // Squares a premove from `from` may go to. The first premove is checked
  // against every reply the opponent could make, so only moves that can
  // really be played are offered; later ones are a close approximation.
  premoveOptions(from) {
    if (this.pieceAt(from)?.color !== this.playerColor) return [];
    if (!this.premoves.length)
      return reachableAfterReply(Chess, this.chess.fen(), from);
    return premoveTargets(
      this.displayBoard,
      from,
      this.chess.getCastlingRights(this.playerColor),
    );
  }

  get flipped() {
    return this.playerColor === 'b';
  }

  @cached
  get squares() {
    const board = this.displayBoard;
    const last = this.lastMove;
    const checkedKing = this.chess.inCheck() ? this.chess.turn() : null;
    const targets = this.targets;
    const premoved = new Set(this.premoves.flatMap((p) => [p.from, p.to]));
    const flipped = this.flipped;
    const out = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const r = flipped ? 7 - row : row;
        const c = flipped ? 7 - col : col;
        const square = `${FILES[c]}${8 - r}`;
        const piece = board[r][c];
        const target = targets.get(square);
        out.push({
          square,
          label: piece
            ? `${COLOR_NAME[piece.color]} ${PIECE_NAME[piece.type]} on ${square}`
            : square,
          dark: (r + c) % 2 === 1,
          selected: square === this.selected,
          target: Boolean(target) && this.prefs.hints,
          capture: Boolean(target) && this.prefs.hints && Boolean(piece),
          premove: premoved.has(square),
          last: last && (last.from === square || last.to === square),
          check:
            !this.premoves.length &&
            piece?.type === 'k' &&
            piece.color === checkedKing,
          fileLabel: row === 7 ? FILES[c] : null,
          rankLabel: col === 0 ? String(8 - r) : null,
        });
      }
    }
    return out;
  }

  // Pieces as positioned tokens, so a move is a slide rather than a jump.
  get tokenViews() {
    const flipped = this.flipped;
    const premovedTo = new Set(this.premoves.map((p) => p.to));
    return this.tokens.map((t) => {
      const file = FILES.indexOf(t.square[0]);
      const rank = Number(t.square[1]) - 1;
      const x = flipped ? 7 - file : file;
      const y = flipped ? rank : 7 - rank;
      return {
        ...t,
        icon: PIECE_ICON[t.type],
        fill: pieceFill(t.color),
        premoved: premovedTo.has(t.square),
        style: htmlSafe(`--x: ${x}; --y: ${y}`),
      };
    });
  }

  afterChange() {
    this.version++;
    if (this.isOver) this.finish();
    this.tokens = syncTokens(
      this.tokens,
      this.displayBoard,
      () => ++this.tokenSeq,
    );
  }

  // Pieces each side has taken, and who's ahead on material.
  get captured() {
    void this.version;
    const left = {
      w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
      b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    };
    for (const row of this.chess.board())
      for (const piece of row)
        if (piece && piece.type !== 'k') left[piece.color][piece.type]++;
    const takenFrom = (color) =>
      Object.entries(START_COUNT).flatMap(([type, count]) =>
        Array.from({ length: Math.max(0, count - left[color][type]) }, () => ({
          type,
          icon: PIECE_ICON[type],
          fill: pieceFill(color),
        })),
      );
    const material = (color) =>
      Object.entries(left[color]).reduce(
        (sum, [type, n]) => sum + n * PIECE_VALUE[type],
        0,
      );
    const me = this.playerColor;
    const them = other(me);
    const lead = material(me) - material(them);
    return {
      byMe: takenFrom(them),
      byThem: takenFrom(me),
      myLead: lead > 0 ? `+${lead}` : '',
      theirLead: lead < 0 ? `+${-lead}` : '',
    };
  }

  get movePairs() {
    void this.version;
    const sans = this.chess.history();
    const blackFirst = this.chess.history({ verbose: true })[0]?.color === 'b';
    const list = blackFirst ? ['…', ...sans] : sans;
    const pairs = [];
    for (let i = 0; i < list.length; i += 2)
      pairs.push({ n: i / 2 + 1, white: list[i], black: list[i + 1] ?? '' });
    return pairs;
  }

  get canTakeback() {
    void this.version;
    return (
      this.takebacks &&
      !this.isOver &&
      !this.offer &&
      this.chess
        .history({ verbose: true })
        .some((m) => m.color === this.playerColor)
    );
  }

  // ─── Clocks ──────────────────────────────────────────────────────────

  get clockRunning() {
    return Boolean(this.clocks) && this.turnStartedAt !== null && !this.isOver;
  }

  remaining(color) {
    if (!this.clocks) return 0;
    const spent =
      this.clockRunning && this.chess.turn() === color
        ? this.now - this.turnStartedAt
        : 0;
    return this.clocks[color] - spent;
  }

  clockView(color) {
    if (!this.clocks) return null;
    void this.now;
    void this.version;
    const left = this.remaining(color);
    return {
      text: formatClock(left),
      running: this.clockRunning && this.chess.turn() === color,
      low: left < LOW_TIME_MS,
    };
  }

  get myClock() {
    return this.clockView(this.playerColor);
  }

  get theirClock() {
    return this.clockView(other(this.playerColor));
  }

  tickClock() {
    this.now = performance.now();
    if (!this.clockRunning) return;
    const turn = this.chess.turn();
    const left = this.remaining(turn);
    // Your last ten seconds tick.
    if (turn === this.playerColor && left > 0 && left <= 10000) {
      const second = Math.ceil(left / 1000);
      if (second !== this.lastTick) sfx('chess.tick');
      this.lastTick = second;
    }
    if (left > 0) return;
    const remoteClock = !this.isBot && turn !== this.playerColor;
    if (remoteClock && left > -FLAG_GRACE_MS) return;
    this.flag(turn);
    if (!this.isBot) this.room.send({ type: 'flag', color: turn });
  }

  flag(color) {
    const winner = other(color);
    this.endWith(
      canMate(this.chess.board(), winner)
        ? { winner, reason: 'timeout' }
        : { winner: null, reason: 'timeout-draw' },
    );
  }

  // Stops the clocks where they stand.
  freezeClocks() {
    if (!this.clockRunning) return;
    const turn = this.chess.turn();
    this.clocks = { ...this.clocks, [turn]: Math.max(0, this.remaining(turn)) };
    this.turnStartedAt = null;
  }

  endWith(result) {
    this.freezeClocks();
    this.result = result;
    this.afterChange();
  }

  finish() {
    if (this.outcome && !this.endSounded) {
      this.endSounded = true;
      const { winner } = this.outcome;
      setTimeout(
        () =>
          sfx(
            winner === null
              ? 'chess.draw'
              : winner === this.playerColor
                ? 'chess.win'
                : 'chess.lose',
          ),
        250,
      );
    }
    if (this.isBot && this.outcome) {
      const { winner } = this.outcome;
      this.chatter.say(
        this.botName,
        winner === null
          ? 'chessDraw'
          : winner === this.playerColor
            ? 'chessLose'
            : 'chessWin',
        { urgent: true },
      );
    }
    this.freezeClocks();
    this.abort?.abort();
    this.thinking = false;
    this.premoves = [];
    this.offer = null;
    this.selected = null;
  }

  // ─── Moving ──────────────────────────────────────────────────────────

  // Every move goes through here: yours, the computer's and your friend's.
  commit(move, { clocks } = {}) {
    const mover = this.chess.turn();
    let result;
    try {
      result = this.chess.move(move);
    } catch {
      return null;
    }
    if (this.clocks) {
      const t = performance.now();
      this.now = t;
      if (clocks) this.clocks = clocks;
      else if (this.turnStartedAt !== null)
        this.clocks = {
          ...this.clocks,
          [mover]: this.clocks[mover] - (t - this.turnStartedAt) + this.incMs,
        };
      // The clock starts after the first move, so no one loses time before the game begins.
      this.turnStartedAt = t;
    }
    this.selected = null;
    this.pendingPromotion = null;
    if (this.offer?.kind === 'takeback') this.offer = null;
    this.room.recordDebugState(
      `${COLOR_NAME[result.color]} played ${result.san}`,
    );
    sfx(
      result.san.includes('+') || result.san.includes('#')
        ? 'chess.check'
        : result.promotion
          ? 'chess.promote'
          : /^O-O/.test(result.san)
            ? 'chess.castle'
            : result.captured
              ? 'chess.capture'
              : 'chess.move',
    );
    this.afterChange();
    // The computer reacts to captures and checks, its own and yours.
    if (this.isBot && !this.isOver) {
      const botMoved = mover !== this.playerColor;
      if (result.san.includes('+'))
        this.chatter.say(this.botName, botMoved ? 'check' : 'checked', {
          chance: 0.7,
        });
      else if (result.captured)
        this.chatter.say(this.botName, botMoved ? 'capture' : 'hit', {
          chance: 0.3,
        });
    }
    return result;
  }

  playMine(move) {
    const result = this.commit(move);
    if (!result) return false;
    if (this.isBot) this.maybeBotMove();
    else
      this.room.send({
        type: 'move',
        from: result.from,
        to: result.to,
        promotion: result.promotion,
        fen: this.chess.fen(),
        clocks: this.clocks,
      });
    return true;
  }

  // After the other side moves, the first queued premove is played if it's legal; otherwise the queue is dropped.
  runPremove() {
    if (!this.premoves.length || !this.isMyTurn) return;
    const [first, ...rest] = this.premoves;
    this.premoves = rest;
    const legal = this.chess
      .moves({ square: first.from, verbose: true })
      .find((m) => m.to === first.to);
    if (
      !legal ||
      !this.playMine({
        from: first.from,
        to: first.to,
        promotion: legal.promotion ? (first.promotion ?? 'q') : undefined,
      })
    )
      this.clearPremoves();
  }

  clearPremoves() {
    if (!this.premoves.length) return;
    this.premoves = [];
    this.afterChange();
  }

  // Returns whether the piece should stay where it was dropped.
  tryMove(from, to) {
    if (this.isMyTurn) {
      const move = this.chess
        .moves({ square: from, verbose: true })
        .find((m) => m.to === to);
      if (!move) return false;
      if (move.promotion && !this.prefs.autoQueen) {
        this.pendingPromotion = { from, to };
        return false;
      }
      return this.playMine({
        from,
        to,
        promotion: move.promotion ? 'q' : undefined,
      });
    }
    if (this.canPremove && this.premoveOptions(from).includes(to)) {
      const piece = this.pieceAt(from);
      const promotion =
        piece?.type === 'p' && (to[1] === '8' || to[1] === '1')
          ? 'q'
          : undefined;
      this.premoves = [
        ...this.premoves,
        { from, to, promotion, color: this.playerColor },
      ];
      sfx('ui.click');
      this.selected = null;
      this.afterChange();
      return true;
    }
    return false;
  }

  clickSquare(square) {
    if (this.mode !== 'playing' || this.isOver || this.pendingPromotion) return;
    // Watching: the board is a picture, not a thing to press.
    if (this.iAmSpectator) return;
    if (this.selected && this.targets.has(square)) {
      this.tryMove(this.selected, square);
      return;
    }
    const piece = this.pieceAt(square);
    if (piece?.color === this.playerColor && square !== this.selected) {
      this.selected = square;
      return;
    }
    this.selected = null;
    // Clicking anywhere else cancels premoves, like on chess.com.
    if (!piece) this.clearPremoves();
  }

  // Keyboard users press Enter/Space on a square; pointer input is handled on the board.
  keySquare = (square, event) => {
    this.cursor = square;
    if (event.detail === 0) this.clickSquare(square);
  };

  // ─── Debug mode (see utils/debug-commands.js) ──────────────────────

  debugTools() {
    const need = () => {
      if (this.mode !== 'playing')
        throw new CommandError('No game is running. Start one first.');
    };
    const colorOf = (word) => {
      const c = String(word ?? '').toLowerCase()[0];
      if (c !== 'w' && c !== 'b') throw new CommandError('Say white or black.');
      return c;
    };
    // Changed the position: show it, tell the other player, save it for /undo.
    const changed = (ctx, label) => {
      this.selected = null;
      this.premoves = [];
      this.result = null;
      this.endSounded = false;
      this.afterChange();
      this.syncPosition();
      this.room.recordDebugState(label);
      ctx.announce(label);
      this.maybeBotMove();
    };
    return {
      players: () => [
        {
          id: this.room.selfId,
          name: `${this.room.profile.name || 'Host'} (${COLOR_NAME[this.playerColor]})`,
        },
        {
          id: this.room.members.find((m) => !m.isYou)?.id ?? 'bot',
          name: `${this.opponentName} (${COLOR_NAME[other(this.playerColor)]})`,
        },
      ],
      describe: () =>
        this.mode === 'playing'
          ? `Chess: ${COLOR_NAME[this.chess.turn()]} to move, move ${this.chess.moveNumber()}. ${this.isOver ? 'Game over.' : ''}\nFEN: ${this.chess.fen()}`
          : 'Chess: in the lobby.',
      snapshot: () =>
        this.mode === 'playing'
          ? {
              pgn: this.chess.pgn(),
              fen: this.chess.fen(),
              clocks: this.clocks,
              result: this.result,
            }
          : null,
      restore: (snap) => {
        const chess = new Chess();
        try {
          chess.loadPgn(snap.pgn);
        } catch {
          chess.load(snap.fen);
        }
        this.abort?.abort();
        this.thinking = false;
        this.chess = chess;
        this.clocks = snap.clocks;
        if (this.clocks) this.turnStartedAt = performance.now();
        this.selected = null;
        this.premoves = [];
        this.result = snap.result;
        this.endSounded = Boolean(snap.result);
        this.afterChange();
        this.syncPosition();
        this.maybeBotMove();
      },
      commands: {
        fen: {
          usage: '/fen',
          help: 'The position as FEN.',
          run: () => (need(), this.chess.fen()),
        },
        pgn: {
          usage: '/pgn',
          help: 'The moves so far as PGN.',
          run: () => (need(), this.chess.pgn() || '(no moves yet)'),
        },
        board: {
          usage: '/board',
          help: 'The board as text.',
          run: () => (need(), this.chess.ascii()),
        },
        moves: {
          usage: '/moves [square]',
          help: 'Every legal move, or just the ones from a square.',
          run: ([square]) => {
            need();
            const list = this.chess.moves(square ? { square } : undefined);
            return list.length ? list.join(' ') : 'No legal moves.';
          },
        },
        setfen: {
          usage: '/setfen <fen>',
          help: 'Sets up any position (the clocks keep going).',
          run: (words, ctx) => {
            need();
            const fen = words.join(' ');
            const check = validateFen(fen);
            if (!check.ok)
              throw new CommandError(`That FEN isn’t valid: ${check.error}`);
            this.abort?.abort();
            this.thinking = false;
            this.chess = new Chess(fen);
            changed(ctx, `${ctx.fromName} set up a new position.`);
          },
        },
        move: {
          usage: '/move <move>',
          help: 'Plays a move for whoever’s turn it is, like /move e4 or /move g1f3.',
          run: ([san], ctx) => {
            need();
            let result;
            try {
              const long = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/i.exec(
                san ?? '',
              );
              result = this.chess.move(
                long ? { from: long[1], to: long[2], promotion: long[3] } : san,
              );
            } catch {
              throw new CommandError(
                `${san ?? 'That'} isn’t a legal move. See /moves.`,
              );
            }
            changed(
              ctx,
              `${ctx.fromName} played ${result.san} for ${COLOR_NAME[result.color]}.`,
            );
          },
        },
        clock: {
          usage: '/clock <white|black> <seconds>',
          help: 'Sets how much time a side has left.',
          run: ([side, seconds], ctx) => {
            need();
            if (!this.clocks)
              throw new CommandError('This game has no clocks.');
            const color = colorOf(side);
            const ms = Math.max(1, Number(seconds) || 0) * 1000;
            this.freezeClocks();
            this.clocks = { ...this.clocks, [color]: ms };
            if (!this.isOver) this.turnStartedAt = performance.now();
            changed(
              ctx,
              `${ctx.fromName} set ${COLOR_NAME[color]}’s clock to ${Math.round(ms / 1000)}s.`,
            );
          },
        },
        level: {
          usage: '/level <easy|medium|hard>',
          help: 'Changes how strong the computer plays.',
          run: ([id], ctx) => {
            if (!LEVELS[id])
              throw new CommandError(
                `Pick one of ${Object.keys(LEVELS).join(', ')}.`,
              );
            this.level = id;
            ctx.announce(
              `${ctx.fromName} set the computer to ${LEVELS[id].label}.`,
            );
          },
        },
        end: {
          usage: '/end <white|black|draw>',
          help: 'Ends the game with that result.',
          run: ([word], ctx) => {
            need();
            const winner = /^d/i.test(word ?? '') ? null : colorOf(word);
            this.endWith(
              winner === null
                ? { winner: null, reason: 'agreement' }
                : { winner, reason: 'resign' },
            );
            this.syncPosition();
            ctx.announce(
              `${ctx.fromName} ended the game: ${winner === null ? 'a draw' : `${COLOR_NAME[winner]} wins`}.`,
            );
          },
        },
      },
    };
  }

  // Host: sends the whole position to the other player after a debug change.
  syncPosition() {
    if (this.isBot || !this.room.isOnline) return;
    this.room.send({
      type: 'sync',
      pgn: this.chess.pgn(),
      fen: this.chess.fen(),
      clocks: this.clocks,
      result: this.result,
    });
  }

  // ─── Keyboard & controller (bound in Settings) ──────────────────────

  // The square the keyboard/controller cursor is on; it's the focused square button.
  cursor = null;

  onAction(action) {
    if (this.pendingPromotion && action !== 'cancel') return false;
    switch (action) {
      case 'up':
      case 'down':
      case 'left':
      case 'right':
        this.moveCursor(action);
        return true;
      case 'select': {
        // Enter on some other focused button (Resign, Rematch) presses that button instead.
        const focused = document.activeElement;
        if (
          focused?.matches?.('button, a[href]') &&
          !this.boardEl?.contains(focused)
        )
          return false;
        const square = this.cursor ?? this.selected;
        if (!square) {
          this.moveCursor('up');
          return true;
        }
        // The key press is prevented, so a focused square button doesn't click itself as well.
        this.clickSquare(square);
        return true;
      }
      case 'cancel':
        if (this.pendingPromotion) this.cancelPromotion();
        else if (this.selected) this.selected = null;
        else return false;
        return true;
      case 'takeback':
        if (!this.canTakeback) return false;
        this.requestTakeback();
        return true;
      case 'draw':
        if (this.isBot || this.isOver || this.offer) return false;
        this.offerDraw();
        return true;
      case 'resign':
        if (this.isOver) return false;
        this.resign();
        return true;
      case 'chat':
        openChat();
        return true;
      default:
        return false;
    }
  }

  moveCursor(direction) {
    const start =
      this.cursor ?? this.selected ?? (this.playerColor === 'w' ? 'e2' : 'e7');
    let file = FILES.indexOf(start[0]);
    let rank = Number(start[1]) - 1;
    // Up is always up the screen, so a flipped board moves the other way.
    const flip = this.flipped ? -1 : 1;
    if (this.cursor) {
      if (direction === 'up') rank += flip;
      if (direction === 'down') rank -= flip;
      if (direction === 'left') file -= flip;
      if (direction === 'right') file += flip;
    }
    file = Math.max(0, Math.min(7, file));
    rank = Math.max(0, Math.min(7, rank));
    this.cursor = `${FILES[file]}${rank + 1}`;
    this.boardEl
      ?.querySelector(`.chess-square[data-square="${this.cursor}"]`)
      ?.focus({ focusVisible: true });
  }

  promote = (piece) => {
    const { from, to } = this.pendingPromotion;
    this.pendingPromotion = null;
    this.playMine({ from, to, promotion: piece });
  };

  cancelPromotion = () => (this.pendingPromotion = null);

  async maybeBotMove() {
    if (!this.isBot || this.isOver || this.chess.turn() === this.playerColor)
      return;
    this.thinking = true;
    this.abort?.abort();
    const abort = (this.abort = new AbortController());
    await new Promise((resolve) => setTimeout(resolve, BOT_DELAY_MS));
    const move = abort.signal.aborted
      ? null
      : await findBestMove(this.chess.fen(), this.level, {
          signal: abort.signal,
        });
    if (abort.signal.aborted) return;
    this.thinking = false;
    if (move && this.commit(move)) this.runPremove();
  }

  // ─── Dragging ────────────────────────────────────────────────────────

  squareFromPoint(x, y) {
    const rect = this.boardEl.getBoundingClientRect();
    const col = Math.floor(((x - rect.left) / rect.width) * 8);
    const row = Math.floor(((y - rect.top) / rect.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return this.flipped
      ? `${FILES[7 - col]}${row + 1}`
      : `${FILES[col]}${8 - row}`;
  }

  boardInput = modifier((board) => {
    this.boardEl = board;
    let drag = null;
    let hover = null;

    const setHover = (square) => {
      if (hover === square) return;
      board
        .querySelector('.chess-square.is-drag-over')
        ?.classList.remove('is-drag-over');
      hover = square;
      if (square)
        board
          .querySelector(`.chess-square[data-square="${square}"]`)
          ?.classList.add('is-drag-over');
    };

    const onDown = (event) => {
      if (
        event.button !== 0 ||
        this.mode !== 'playing' ||
        this.isOver ||
        this.pendingPromotion
      )
        return;
      const square = this.squareFromPoint(event.clientX, event.clientY);
      if (!square) return;
      const mine = this.pieceAt(square)?.color === this.playerColor;
      drag = {
        id: event.pointerId,
        square,
        x: event.clientX,
        y: event.clientY,
        moved: false,
        mine,
        wasSelected: this.selected === square,
        token: null,
      };
      if (mine) {
        event.preventDefault();
        board.setPointerCapture?.(event.pointerId);
        drag.token = board.querySelector(
          `.chess-token[data-square="${square}"]`,
        );
        if (!drag.wasSelected && !(this.selected && this.targets.has(square)))
          this.selected = square;
      }
    };

    const onMove = (event) => {
      if (!drag || event.pointerId !== drag.id || !drag.mine || !drag.token)
        return;
      if (
        !drag.moved &&
        Math.hypot(event.clientX - drag.x, event.clientY - drag.y) <
          DRAG_SLOP_PX
      )
        return;
      drag.moved = true;
      const rect = board.getBoundingClientRect();
      // The board may be zoomed (picture-in-picture): pointer maths is on screen, the translate is in the board's own pixels.
      const zoom = rect.width / (board.offsetWidth || rect.width);
      const size = board.offsetWidth / 8;
      drag.token.classList.add('is-dragging');
      drag.token.style.translate = `${(event.clientX - rect.left) / zoom - size / 2}px ${(event.clientY - rect.top) / zoom - size / 2}px`;
      setHover(this.squareFromPoint(event.clientX, event.clientY));
    };

    const onUp = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const current = drag;
      drag = null;
      setHover(null);
      const square = this.squareFromPoint(event.clientX, event.clientY);
      if (!current.moved) {
        // A tap on your own piece selects it (already done on pointerdown); a second tap lets go.
        if (current.mine && square === current.square) {
          if (current.wasSelected) this.selected = null;
        } else if (square) {
          this.clickSquare(square);
        }
        return;
      }
      const token = current.token;
      const stays =
        square && square !== current.square
          ? this.tryMove(current.square, square)
          : false;
      if (
        square &&
        square !== current.square &&
        !stays &&
        !this.pendingPromotion
      )
        sfx('chess.illegal');
      token.classList.remove('is-dragging');
      // A piece dropped on its new square shouldn't slide there again from where it started.
      if (stays) {
        token.classList.add('no-anim');
        requestAnimationFrame(() =>
          requestAnimationFrame(() => token.classList.remove('no-anim')),
        );
      }
      token.style.removeProperty('translate');
    };

    const onCancel = () => {
      if (drag?.token) {
        drag.token.classList.remove('is-dragging');
        drag.token.style.removeProperty('translate');
      }
      drag = null;
      setHover(null);
    };

    // Right-click clears premoves and the selection.
    const onContext = (event) => {
      event.preventDefault();
      this.selected = null;
      this.clearPremoves();
    };

    board.addEventListener('pointerdown', onDown);
    board.addEventListener('pointermove', onMove);
    board.addEventListener('pointerup', onUp);
    board.addEventListener('pointercancel', onCancel);
    board.addEventListener('contextmenu', onContext);
    return () => {
      board.removeEventListener('pointerdown', onDown);
      board.removeEventListener('pointermove', onMove);
      board.removeEventListener('pointerup', onUp);
      board.removeEventListener('pointercancel', onCancel);
      board.removeEventListener('contextmenu', onContext);
      this.boardEl = null;
    };
  });

  // ─── Controls ────────────────────────────────────────────────────────

  takeback(color) {
    this.abort?.abort();
    this.thinking = false;
    const history = this.chess.history({ verbose: true });
    if (!history.length) return;
    this.chess.undo();
    if (this.chess.turn() !== color && this.chess.history().length)
      this.chess.undo();
    this.premoves = [];
    this.selected = null;
    this.offer = null;
    if (this.clocks && this.turnStartedAt !== null)
      this.turnStartedAt = performance.now();
    this.afterChange();
  }

  requestTakeback = () => {
    if (this.isBot) this.takeback(this.playerColor);
    else {
      this.offer = { kind: 'takeback', from: 'me' };
      this.room.send({ type: 'offer', kind: 'takeback' });
    }
  };

  offerDraw = () => {
    this.offer = { kind: 'draw', from: 'me' };
    this.room.send({ type: 'offer', kind: 'draw' });
  };

  answerOffer = (accept) => {
    const offer = this.offer;
    if (!offer || offer.from !== 'them') return;
    this.offer = null;
    this.room.send({ type: 'offer-reply', kind: offer.kind, accept });
    if (!accept) return;
    if (offer.kind === 'draw')
      this.endWith({ winner: null, reason: 'agreement' });
    else this.takeback(other(this.playerColor));
  };

  resign = async () => {
    if (this.isOver) return;
    if (
      !(await askConfirm({
        title: 'Resign this game?',
        message: 'Your opponent wins straight away.',
        confirmLabel: 'Hold to resign',
        cancelLabel: 'Keep playing',
      })) ||
      this.isOver
    )
      return;
    this.endWith({ winner: other(this.playerColor), reason: 'resign' });
    if (!this.isBot) this.room.send({ type: 'resign' });
  };

  // Online, the host starts the rematch once the guest has pressed Ready.
  playAgain = () => {
    if (this.isBot)
      this.startFromLobby(
        this.settings.color === 'random' ? undefined : this.playerColor,
      );
    else if (this.room.isHost && this.room.allReady)
      this.startFromLobby(other(this.playerColor));
  };

  readyCheck = () => this.room.callReadyCheck();

  // Mid-game, going back to the lobby asks first (hold to confirm).
  @tracked confirmingLobby = false;

  askLobby = () => {
    if (this.isOver) this.toLobby();
    else this.confirmingLobby = true;
  };

  cancelLobby = () => (this.confirmingLobby = false);

  get lobbyWarning() {
    return this.isBot
      ? 'The game in progress will be cancelled and this position will be lost.'
      : 'The game in progress will be cancelled for both players and this position will be lost.';
  }

  toLobby = () => {
    this.confirmingLobby = false;
    if (!this.isBot && this.room.isHost) this.room.send({ type: 'lobby' });
    this.backToLobby();
  };

  backToLobby() {
    this.confirmingLobby = false;
    this.abort?.abort();
    clearInterval(this.clockTimer);
    this.thinking = false;
    this.room.setLocked(false);
    this.mode = 'lobby';
  }

  leave = async () => {
    if (
      this.mode === 'playing' &&
      !this.isOver &&
      !(await askConfirm({
        title: 'Leave the game?',
        message: 'You’ll be disconnected, and leaving counts as a loss.',
        confirmLabel: 'Hold to leave',
        cancelLabel: 'Keep playing',
      }))
    )
      return;
    this.room.close();
    this.backToLobby();
  };

  opponentLeft() {
    if (this.mode !== 'playing') return;
    if (this.isOver) {
      if (!this.room.isOnline) this.backToLobby();
      return;
    }
    this.endWith({ winner: this.playerColor, reason: 'abandon' });
  }

  // ─── Online ──────────────────────────────────────────────────────────

  onlineMessage(message) {
    switch (message.type) {
      case 'start': {
        const host = this.room.members.find((m) => m.isHost);
        this.begin({
          fen: message.fen,
          // A spectator is neither player, so it watches from White's side.
          color: this.iAmSpectator ? 'w' : message.color,
          clock: message.clock,
          takebacks: message.takebacks,
          opponent: {
            kind: 'human',
            name: host?.name ?? 'Host',
            avatar: host?.avatar,
          },
        });
        break;
      }
      case 'move':
        this.commit(
          { from: message.from, to: message.to, promotion: message.promotion },
          { clocks: message.clocks },
        );
        // Both boards replay the same moves; if they ever disagree, trust the mover.
        if (message.fen && this.chess.fen() !== message.fen) {
          this.chess.load(message.fen);
          this.afterChange();
        }
        this.runPremove();
        break;
      case 'resign':
        // The message doesn't say who sent it, and a spectator is neither of
        // them, so it only learns that somebody resigned.
        this.endWith({
          winner: this.iAmSpectator ? null : this.playerColor,
          reason: 'resign',
        });
        break;
      case 'flag':
        if (!this.isOver) this.flag(message.color);
        break;
      case 'offer':
        // Not a spectator's to accept or decline.
        if (!this.isOver && !this.iAmSpectator)
          this.offer = { kind: message.kind, from: 'them' };
        break;
      case 'offer-reply':
        this.offer = null;
        if (!message.accept) break;
        if (message.kind === 'draw')
          this.endWith({ winner: null, reason: 'agreement' });
        else this.takeback(this.playerColor);
        break;
      case 'lobby':
        this.backToLobby();
        break;
      case 'sync': {
        // The host changed the position in debug mode.
        const chess = new Chess();
        try {
          chess.loadPgn(message.pgn);
        } catch {
          chess.load(message.fen);
        }
        this.chess = chess;
        this.clocks = message.clocks ?? this.clocks;
        if (this.clocks) this.turnStartedAt = performance.now();
        this.result = message.result ?? null;
        this.endSounded = Boolean(message.result);
        this.selected = null;
        this.premoves = [];
        this.afterChange();
        break;
      }
    }
  }

  <template>
    <ToolPage
      @route="chess"
      @game={{true}}
      @busy={{this.busy}}
      @closeWarning={{this.closeWarning}}
      @subtitle="Take on the computer at three levels, or challenge a friend online. Clocks, Chess960 and premoves for the sweaty games."
    >
      {{#if (eq this.mode "playing")}}
        <div class="game-shell chess-shell pop-in">
          <div class="chess-main">
            <div class="chess-player">
              <span class="chess-player-name">
                <AvatarPortrait @avatar={{this.opponent.avatar}} @size={{28}} />
                {{this.opponentName}}
              </span>
              <span class="chess-captured">
                {{#each this.captured.byThem as |p|}}<Icon
                    @name={{p.icon}}
                    @size={{14}}
                    @fill={{p.fill}}
                    class="chess-captured-piece"
                  />{{/each}}
                {{#if this.captured.theirLead}}<span
                    class="chess-lead"
                  >{{this.captured.theirLead}}</span>{{/if}}
              </span>
              {{#if this.theirClock}}<span
                  class="chess-clock
                    {{if this.theirClock.running 'is-running'}}
                    {{if this.theirClock.low 'is-low'}}"
                >{{this.theirClock.text}}</span>{{/if}}
            </div>

            <div class="chess-board-wrap">
              <div
                class="chess-board {{if this.canPremove 'is-premoving'}}"
                data-sound="off"
                role="grid"
                aria-label="Chess board"
                {{this.boardInput}}
              >
                {{#each this.squares key="square" as |sq|}}
                  <button
                    type="button"
                    class="chess-square
                      {{if sq.dark 'is-dark' 'is-light'}}
                      {{if sq.selected 'is-selected'}}
                      {{if sq.last 'is-last'}}
                      {{if sq.check 'is-check'}}
                      {{if sq.target 'is-target'}}
                      {{if sq.capture 'is-capture'}}
                      {{if sq.premove 'is-premove'}}"
                    data-square={{sq.square}}
                    aria-label={{sq.label}}
                    {{on "click" (fn this.keySquare sq.square)}}
                  >
                    {{#if sq.rankLabel}}<span
                        class="chess-coord chess-rank"
                      >{{sq.rankLabel}}</span>{{/if}}
                    {{#if sq.fileLabel}}<span
                        class="chess-coord chess-file"
                      >{{sq.fileLabel}}</span>{{/if}}
                  </button>
                {{/each}}
                <div class="chess-pieces" aria-hidden="true">
                  {{#each this.tokenViews key="id" as |t|}}
                    <div
                      class="chess-token {{if t.premoved 'is-premoved'}}"
                      data-square={{t.square}}
                      style={{t.style}}
                    >
                      <Icon
                        @name={{t.icon}}
                        @size={{44}}
                        @fill={{t.fill}}
                        class="chess-piece is-{{t.color}}"
                      />
                    </div>
                  {{/each}}
                </div>
              </div>

              {{#if this.pendingPromotion}}
                <div
                  class="chess-promotion pop-in"
                  role="dialog"
                  aria-label="Promote pawn to"
                >
                  <span class="qr-label">Promote to</span>
                  <div class="chess-promotion-choices">
                    {{#each this.promotions as |p|}}
                      <button
                        type="button"
                        class="chess-promotion-btn"
                        aria-label={{p}}
                        {{on "click" (fn this.promote p)}}
                      >
                        <Icon
                          @name={{pieceIcon p}}
                          @size={{36}}
                          @fill={{pieceFill this.playerColor}}
                          class="chess-piece is-{{this.playerColor}}"
                        />
                      </button>
                    {{/each}}
                  </div>
                  <button
                    type="button"
                    class="btn"
                    {{on "click" this.cancelPromotion}}
                  >Cancel</button>
                </div>
              {{/if}}
            </div>

            <div class="chess-player">
              <span class="chess-player-name"><AvatarPortrait
                  @avatar={{this.room.profile.avatar}}
                  @size={{28}}
                />
                You ({{colorName this.playerColor}})</span>
              <span class="chess-captured">
                {{#each this.captured.byMe as |p|}}<Icon
                    @name={{p.icon}}
                    @size={{14}}
                    @fill={{p.fill}}
                    class="chess-captured-piece"
                  />{{/each}}
                {{#if this.captured.myLead}}<span
                    class="chess-lead"
                  >{{this.captured.myLead}}</span>{{/if}}
              </span>
              {{#if this.myClock}}<span
                  class="chess-clock
                    {{if this.myClock.running 'is-running'}}
                    {{if this.myClock.low 'is-low'}}"
                >{{this.myClock.text}}</span>{{/if}}
            </div>
          </div>

          <aside class="chess-side">
            <p
              class="game-status {{if this.isOver 'is-over'}}"
              role="status"
            >{{this.status}}</p>

            {{#if this.offer}}
              <div class="chess-offer pop-in">
                {{#if (eq this.offer.from "them")}}
                  <span>{{this.opponentName}}
                    {{if
                      (eq this.offer.kind "draw")
                      "offers a draw."
                      "asks to take back their last move."
                    }}</span>
                  <div class="game-actions">
                    <button
                      type="button"
                      class="btn active"
                      {{on "click" (fn this.answerOffer true)}}
                    >Accept</button>
                    <button
                      type="button"
                      class="btn"
                      {{on "click" (fn this.answerOffer false)}}
                    >Decline</button>
                  </div>
                {{else}}
                  <span class="tool-hint">{{if
                      (eq this.offer.kind "draw")
                      "Draw offered."
                      "Takeback requested."
                    }}
                    Waiting for
                    {{this.opponentName}}…</span>
                {{/if}}
              </div>
            {{/if}}

            <div class="game-actions">
              {{#if this.isOver}}
                {{#if this.isBot}}
                  <button
                    type="button"
                    class="btn active"
                    {{on "click" this.playAgain}}
                  ><Icon @name="rotate-cw" @size={{13}} /> Play again</button>
                {{else if this.room.isHost}}
                  {{#unless this.room.allReady}}
                    <span class="tool-hint">Waiting for
                      {{this.opponentName}}
                      to agree to a rematch…</span>
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
                  ><Icon @name="rotate-cw" @size={{13}} /> Rematch</button>
                {{else}}
                  <ReadyButton
                    @room={{this.room}}
                    @label="Rematch?"
                    @readyLabel="Ready for a rematch"
                  />
                {{/if}}
              {{else if this.iAmSpectator}}
                <span class="arcade-chip"><Icon @name="eye" @size={{13}} />
                  Watching</span>
              {{else}}
                {{#if this.takebacks}}
                  <button
                    type="button"
                    class="btn"
                    disabled={{if this.canTakeback false true}}
                    {{on "click" this.requestTakeback}}
                  ><Icon @name="undo-2" @size={{13}} /> Takeback</button>
                {{/if}}
                {{#unless this.isBot}}
                  <button
                    type="button"
                    class="btn"
                    disabled={{if this.offer true false}}
                    {{on "click" this.offerDraw}}
                  ><Icon @name="handshake" @size={{13}} /> Offer draw</button>
                {{/unless}}
                <button
                  type="button"
                  class="btn"
                  {{on "click" this.resign}}
                ><Icon @name="flag" @size={{13}} /> Resign</button>
              {{/if}}
              <GameSettings @game="chess" />
              {{#if (showLobbyButton this.isBot this.room.isHost)}}
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
                ><Icon @name="log-out" @size={{13}} /> Leave room</button>
              {{/if}}
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

            <ol class="chess-moves" aria-label="Moves">
              {{#each this.movePairs as |pair|}}
                <li><span class="chess-move-n">{{pair.n}}.</span><span
                  >{{pair.white}}</span><span>{{pair.black}}</span></li>
              {{else}}
                <li class="tool-hint">No moves yet.</li>
              {{/each}}
            </ol>
            <GameChat @room={{this.room}} @floating={{true}} />
            <p class="tool-hint chess-tip">Drag or click to move. While it’s not
              your turn, moves are queued as premoves; right-click the board to
              cancel them.</p>
          </aside>
        </div>
      {{else}}
        <GameLobby
          @game="chess"
          @room={{this.room}}
          @seats={{this.seats}}
          @maxSeats={{2}}
          @onAddBot={{if this.canAddBot this.addBot}}
          @onRemoveBot={{this.removeBot}}
          @spectatable={{this.spectatable}}
          @botLevels={{this.botLevelMap}}
          @botLevelOptions={{this.levels}}
          @onSetBotLevel={{this.setBotLevel}}
          @onStart={{this.startFromLobby}}
          @blocker={{this.blocker}}
        >
          <:rules>
            <div class="lobby-rule">
              <span class="lobby-rule-text"><span class="qr-label">Time control</span></span>
              <div
                class="chess-time-grid"
                role="group"
                aria-label="Time control"
              >
                {{#each this.timeControls as |t|}}
                  <button
                    type="button"
                    class="chess-time
                      {{if (eq this.settings.time t.id) 'active'}}"
                    aria-pressed={{if
                      (eq this.settings.time t.id)
                      "true"
                      "false"
                    }}
                    {{on "click" (fn this.setRule "time" t.id)}}
                  >
                    <span class="chess-time-label">{{t.label}}</span>
                    <span class="chess-time-group">{{t.group}}</span>
                  </button>
                {{/each}}
              </div>
              {{#if (eq this.settings.time "custom")}}
                <div class="chess-custom-time">
                  <label><span class="qr-label is-muted">Minutes</span><input
                      type="number"
                      min="0.5"
                      max="180"
                      step="0.5"
                      value={{this.settings.minutes}}
                      {{on "change" (fn this.setRuleFromInput "minutes")}}
                    /></label>
                  <label><span class="qr-label is-muted">Increment (s)</span><input
                      type="number"
                      min="0"
                      max="60"
                      value={{this.settings.increment}}
                      {{on "change" (fn this.setRuleFromInput "increment")}}
                    /></label>
                </div>
              {{/if}}
            </div>
            <div class="lobby-rule">
              <span class="lobby-rule-text"><span
                  class="qr-label"
                >{{this.colorRuleLabel}}</span></span>
              <div
                class="math-tabs"
                role="group"
                aria-label={{this.colorRuleLabel}}
              >
                {{#each this.colorChoices as |c|}}
                  <button
                    type="button"
                    class="qr-tab {{if (eq this.settings.color c.id) 'active'}}"
                    aria-pressed={{if
                      (eq this.settings.color c.id)
                      "true"
                      "false"
                    }}
                    {{on "click" (fn this.setRule "color" c.id)}}
                  >{{c.label}}</button>
                {{/each}}
              </div>
            </div>
            <div class="lobby-rule">
              <span class="lobby-rule-text"><span class="qr-label">Starting
                  position</span>{{#if
                  (eq this.settings.start "chess960")
                }}<span class="tool-hint">Shuffled back rank, same for both
                    sides. Castling is off.</span>{{/if}}</span>
              <div
                class="math-tabs"
                role="group"
                aria-label="Starting position"
              >
                {{#each this.startOptions as |o|}}
                  <button
                    type="button"
                    class="qr-tab {{if (eq this.settings.start o.id) 'active'}}"
                    aria-pressed={{if
                      (eq this.settings.start o.id)
                      "true"
                      "false"
                    }}
                    {{on "click" (fn this.setRule "start" o.id)}}
                  >{{o.label}}</button>
                {{/each}}
              </div>
              {{#if (eq this.settings.start "fen")}}
                <input
                  type="text"
                  placeholder={{STANDARD_FEN}}
                  aria-label="FEN"
                  value={{this.settings.fen}}
                  {{on "change" (fn this.setRuleFromInput "fen")}}
                />
              {{/if}}
            </div>
            <label class="lobby-rule is-switch">
              <span class="lobby-rule-text"><span
                  class="qr-label"
                >Takebacks</span><span class="tool-hint">Online, your opponent
                  has to agree.</span></span>
              <span class="qr-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={{this.settings.takebacks}}
                  aria-checked={{if this.settings.takebacks "true" "false"}}
                  {{on "change" (fn this.toggleRule "takebacks")}}
                />
                <span class="qr-switch-track" aria-hidden="true"></span>
              </span>
            </label>
          </:rules>
          <:profile>
            <div class="chess-prefs">
              <span class="qr-label is-muted">Your board</span>
              <label class="qr-switch"><input
                  type="checkbox"
                  role="switch"
                  checked={{this.prefs.premoves}}
                  aria-checked={{if this.prefs.premoves "true" "false"}}
                  {{on "change" (fn this.setPref "premoves")}}
                /><span class="qr-switch-track" aria-hidden="true"></span>
                Premoves</label>
              <label class="qr-switch"><input
                  type="checkbox"
                  role="switch"
                  checked={{this.prefs.autoQueen}}
                  aria-checked={{if this.prefs.autoQueen "true" "false"}}
                  {{on "change" (fn this.setPref "autoQueen")}}
                /><span class="qr-switch-track" aria-hidden="true"></span>
                Always promote to queen</label>
              <label class="qr-switch"><input
                  type="checkbox"
                  role="switch"
                  checked={{this.prefs.hints}}
                  aria-checked={{if this.prefs.hints "true" "false"}}
                  {{on "change" (fn this.setPref "hints")}}
                /><span class="qr-switch-track" aria-hidden="true"></span>
                Show legal moves</label>
            </div>
          </:profile>
        </GameLobby>
      {{/if}}
    </ToolPage>
  </template>
}

function pieceIcon(type) {
  return PIECE_ICON[type];
}

function colorName(color) {
  return COLOR_NAME[color];
}

function showLobbyButton(isBot, isHost) {
  return isBot || isHost;
}
