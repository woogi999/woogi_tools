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
import FanHand from './fan-hand';
import GameChat from './game-chat';
import GameRoom from '../utils/game-room';
import { roomCodeFromUrl } from '../utils/file-share';
import { HAIR_STYLES, EYES, MOUTHS, EXTRAS, SKIN_TONES, HAIR_COLORS, SHIRT_COLORS } from '../utils/avatar';
import { COLORS, MAX_PLAYERS, DEFAULT_RULES, HAND_SIZE_RANGE, PENALTY_RANGE, clampInt, normaliseRules, cardName, createGame, viewFor, play, draw, pass, callUno, swapWith, botTurn, botJumpIn, handToBot } from '../utils/uno';

const BOT_DELAY_MS = 1000;
const JUMP_IN_DELAY_MS = 650;
const SYMBOLS = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: 'W', wild4: '+4' };
const BOT_NAMES = ['Bobbin', 'Pixel', 'Mochi', 'Gizmo', 'Noodle', 'Sprocket', 'Waffles'];
const COLOR_ORDER = { red: 0, yellow: 1, green: 2, blue: 3 };
const VALUE_ORDER = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2', 'wild', 'wild4'];
const STACKING = [
  { id: 'off', label: 'Off' },
  { id: 'same', label: '+2 on +2, +4 on +4' },
  { id: 'mixed', label: 'Any draw card' },
];
// Mouse-look updates sent to other players at most this often.
const LOOK_SEND_MS = 120;
const SWITCH_RULES = [
  { key: 'sevens', label: 'Sevens swap', hint: 'Play a 7 and swap hands with anyone.' },
  { key: 'zeros', label: 'Zeros rotate', hint: 'Play a 0 and every hand moves along to the next player.' },
  { key: 'jumpIn', label: 'Jump-in', hint: 'Hold an exact copy of the top card? Play it out of turn.' },
  { key: 'drawUntilPlayable', label: 'Draw until you can play', hint: 'Keep drawing instead of stopping after one card.' },
];

const eq = (a, b) => a === b;
const symbol = (card) => SYMBOLS[card.value] ?? card.value;

// Computer players get a fixed look each, so "Mochi" is always the same doodle.
function botAvatar(i) {
  const at = (list, step) => list[(i * step + 3) % list.length];
  return { skin: at(SKIN_TONES, 3), hair: at(HAIR_STYLES, 2).id, hairColor: at(HAIR_COLORS, 5), eyes: at(EYES, 1).id, mouth: at(MOUTHS, 4).id, blush: i % 2 === 0, shirt: at(SHIRT_COLORS, 3), extra: at(EXTRAS, 5).id };
}

export default class UnoPage extends Component {
  colors = COLORS;
  handMin = HAND_SIZE_RANGE[0];
  handMax = HAND_SIZE_RANGE[1];
  stackingOptions = STACKING;
  penaltyMin = PENALTY_RANGE[0];
  penaltyMax = PENALTY_RANGE[1];
  switchRules = SWITCH_RULES;

  // 'lobby' | 'playing'
  @tracked mode = 'lobby';
  // What this device's player can see; replaced after every action.
  @tracked view = null;
  // A wild card waiting for its colour.
  @tracked choosingFor = null;
  @tracked activeCard = null;
  @tracked anchors = null;
  @tracked sceneFailed = false;

  // The full game, only on the host.
  state = null;
  botTimer = null;
  scene = null;
  lastLookSent = 0;
  sentLook = { x: 0, y: 0 };

  room = new GameRoom('uno', {
    maxPlayers: MAX_PLAYERS,
    settings: { ...DEFAULT_RULES, bots: 2 },
    onMessage: (message, from) => this.onlineMessage(message, from),
    onGuestLeft: (id) => {
      if (this.state && handToBot(this.state, id)) this.refresh();
    },
    onClosed: () => this.backToLobby(),
  });

  constructor(owner, args) {
    super(owner, args);
    const code = roomCodeFromUrl();
    if (code) this.room.join(code);
    registerDestructor(this, () => {
      clearTimeout(this.botTimer);
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

  get seats() {
    const humans = this.room.members.map((m) => ({ ...m, kind: 'human' }));
    const bots = Math.max(0, Math.min(this.settings.bots, MAX_PLAYERS - humans.length));
    return [...humans, ...Array.from({ length: bots }, (_, i) => ({ id: `bot-${i + 1}`, name: BOT_NAMES[i], kind: 'bot', avatar: botAvatar(i) }))];
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
    if (this.room.isOnline) return this.room.isHost ? 'Close Uno? You’re hosting, so this ends the game and closes the room for everyone.' : 'Close Uno? You’ll be disconnected from the game.';
    return 'Close Uno? The game in progress will be lost.';
  }

  // ─── Running the game (on the host) ─────────────────────────────────

  start = () => {
    clearTimeout(this.botTimer);
    const players = this.seats.map((seat) => ({ id: seat.id, name: seat.name, kind: seat.kind, avatar: seat.avatar }));
    this.state = createGame(players, normaliseRules(this.settings));
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
    this.show(viewFor(state, this.myIndex));
    state.players.forEach((player, i) => {
      if (player.kind === 'human' && player.id !== this.room.selfId) this.room.sendTo(player.id, { type: 'view', view: viewFor(state, i) });
    });
    clearTimeout(this.botTimer);
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

  show(view) {
    this.mode = 'playing';
    this.view = view;
    if (!view.playable.includes(this.choosingFor?.id)) this.choosingFor = null;
    this.scene?.setView(view);
    requestAnimationFrame(() => this.updateAnchors());
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

  @cached
  get handItems() {
    const view = this.view;
    if (!view) return [];
    const sorted = [...view.hand].sort((a, b) => (COLOR_ORDER[a.color] ?? 9) - (COLOR_ORDER[b.color] ?? 9) || VALUE_ORDER.indexOf(a.value) - VALUE_ORDER.indexOf(b.value));
    return sorted.map((card) => {
      const playable = view.playable.includes(card.id);
      return { key: card.id, card, playable, symbol: symbol(card), label: cardName(card), className: `is-uno is-${card.color ?? 'wild'} ${playable ? 'is-playable' : 'is-dim'}` };
    });
  }

  get opponents() {
    const view = this.view;
    if (!view) return [];
    return view.players.map((p, index) => ({ ...p, index })).filter((p) => p.index !== view.you);
  }

  // Name tags pinned over each avatar's head in the 3D scene.
  get tags() {
    const view = this.view;
    const anchors = this.anchors;
    if (!view || !anchors) return [];
    return anchors.seats
      .filter((a) => view.players[a.index])
      .map((a) => {
        const p = view.players[a.index];
        return { index: a.index, name: p.name, count: p.count, bot: p.kind === 'bot', uno: p.count === 1, turn: view.turn === a.index && view.winner === null, winner: view.winner === a.index, style: htmlSafe(`left: ${a.x.toFixed(1)}px; top: ${a.y.toFixed(1)}px`) };
      });
  }

  get deckStyle() {
    const a = this.anchors?.deck;
    return a ? htmlSafe(`left: ${a.x.toFixed(1)}px; top: ${a.y.toFixed(1)}px`) : htmlSafe('display: none');
  }

  get ruleBadges() {
    const r = this.view?.rules;
    if (!r) return [];
    return [r.stacking !== 'off' && 'Stacking', r.sevens && '7 swap', r.zeros && '0 rotate', r.jumpIn && 'Jump-in', r.drawUntilPlayable && 'Draw till play'].filter(Boolean);
  }

  get status() {
    const view = this.view;
    if (!view) return '';
    const name = (i) => (i === view.you ? 'You' : view.players[i].name);
    if (view.winner !== null) return view.winner === view.you ? 'You win! 🎉' : `${name(view.winner)} wins.`;
    if (view.choosingSwap) return 'Pick someone to swap hands with.';
    if (view.swapPending !== null) return `${name(view.swapPending)} is picking who to swap hands with…`;
    if (view.turn === view.you) {
      if (view.pendingDraw) return view.playable.length ? `Stack a draw card, or take ${view.pendingDraw}.` : `Nothing to stack. Draw ${view.pendingDraw}.`;
      if (view.drawnCardId !== null) return 'You drew a card you can play. Play it or pass.';
      return view.playable.length ? 'Your turn. Play a card or draw.' : 'Nothing to play. Draw a card.';
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
        this.updateAnchors();
      })
      .catch((error) => {
        console.warn('3D table unavailable:', error);
        this.sceneFailed = true;
      });
    const observer = new ResizeObserver(() => requestAnimationFrame(() => this.updateAnchors()));
    observer.observe(canvas);
    return () => {
      cancelled = true;
      observer.disconnect();
      scene?.dispose();
      this.scene = null;
      this.anchors = null;
    };
  });

  // Where you point decides where you glance, and (online) which way your
  // avatar turns its head on everyone else's screen.
  trackPointer = modifier((stage) => {
    const move = (event) => {
      if (event.pointerType !== 'mouse') return;
      const rect = stage.getBoundingClientRect();
      this.look((event.clientX - rect.left) / rect.width * 2 - 1, (event.clientY - rect.top) / rect.height * 2 - 1);
    };
    const leave = () => this.look(0, 0);
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerleave', leave);
    return () => {
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerleave', leave);
    };
  });

  look(x, y) {
    this.scene?.setPointer(x, y);
    if (!this.room.isOnline || !this.view) return;
    const now = performance.now();
    const moved = Math.abs(x - this.sentLook.x) + Math.abs(y - this.sentLook.y);
    const centred = x === 0 && y === 0;
    if ((now - this.lastLookSent < LOOK_SEND_MS || moved < 0.05) && !centred) return;
    this.lastLookSent = now;
    this.sentLook = { x, y };
    const rounded = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
    if (this.isHostSide) this.room.send({ type: 'look', player: this.view.you, ...rounded });
    else this.room.send({ type: 'look', ...rounded });
  }

  updateAnchors() {
    if (this.scene && this.view) this.anchors = this.scene.anchors();
  }

  // ─── Your moves ──────────────────────────────────────────────────────

  playCard = (entry) => {
    if (!entry?.playable) return;
    if (!entry.card.color) this.choosingFor = entry.card;
    else this.act({ type: 'play', cardId: entry.card.id });
    this.activeCard = null;
  };

  playByKey = (key) => this.playCard(this.handItems.find((item) => item.key === key));
  setActiveCard = (key) => (this.activeCard = key);

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

  // ─── Leaving ─────────────────────────────────────────────────────────

  playAgain = () => this.start();

  toLobby = () => {
    if (this.room.isOnline) this.room.send({ type: 'lobby' });
    this.backToLobby();
  };

  backToLobby() {
    clearTimeout(this.botTimer);
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
    <ToolPage @route="uno" @busy={{this.busy}} @closeWarning={{this.closeWarning}} @subtitle="Match colours and numbers and empty your hand first, around a 3D table with up to eight players. House rules included.">
      {{#if (eq this.mode "playing")}}
        <div class="game-shell uno-shell pop-in">
          {{! Everything you play with sits inside the table view: your hand, the buttons, the chat. }}
          <div class="uno-stage {{if this.isMyTurn 'is-my-turn'}}" {{this.trackPointer}}>
            <canvas class="uno-canvas" aria-hidden="true" {{this.setupScene}}></canvas>

            {{#if this.sceneFailed}}
              <div class="uno-fallback">
                <div class="uno-card is-{{if this.view.top.color this.view.top.color 'wild'}}" aria-label="Top card: {{cardLabel this.view.top}}">
                  <span class="uno-card-corner">{{symbol this.view.top}}</span>
                  <span class="uno-card-symbol">{{symbol this.view.top}}</span>
                </div>
                <ul class="uno-fallback-players">
                  {{#each this.opponents key="index" as |p|}}
                    <li class={{if (eq this.view.turn p.index) "is-turn"}}>{{p.name}} · {{p.count}}</li>
                  {{/each}}
                </ul>
              </div>
            {{/if}}

            {{#each this.tags key="index" as |t|}}
              <div class="uno-tag {{if t.turn 'is-turn'}} {{if t.winner 'is-winner'}}" style={{t.style}}>
                <span class="uno-tag-name">{{#if t.bot}}<Icon @name="bot" @size={{11}} />{{/if}}{{t.name}}</span>
                <span class="uno-tag-count">{{t.count}}{{#if t.uno}} · <strong>Uno!</strong>{{/if}}</span>
              </div>
            {{/each}}

            <button type="button" class="uno-deck-hit {{if this.canDraw 'is-ready'}}" style={{this.deckStyle}} disabled={{if this.canDraw false true}} aria-label="Draw {{if this.view.pendingDraw this.view.pendingDraw 'a card'}} ({{this.view.drawPileCount}} left)" {{on "click" this.drawCard}}>
              {{#if this.canDraw}}<span class="uno-deck-label">Draw{{#if this.view.pendingDraw}} {{this.view.pendingDraw}}{{/if}}</span>{{/if}}
            </button>

            <div class="uno-overlay uno-top-left">
              <div class="uno-hud">
                <span class="uno-hud-chip"><span class="uno-current is-{{this.view.color}}"></span>{{this.view.color}}</span>
                {{#if this.view.pendingDraw}}<span class="uno-hud-chip is-alert">+{{this.view.pendingDraw}} stacked</span>{{/if}}
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

            <div class="uno-hand-row">
              <FanHand @class="is-uno" @items={{this.handItems}} @activeKey={{this.activeCard}} @onActivate={{this.setActiveCard}} @onOpen={{this.playByKey}} as |item showFace|>
                <span class="uno-card-corner">{{item.symbol}}</span>
                {{#if showFace}}
                  <span class="uno-card-symbol">{{item.symbol}}</span>
                  <span class="uno-card-corner is-bottom">{{item.symbol}}</span>
                {{/if}}
              </FanHand>
            </div>

            <div class="uno-overlay uno-actions">
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
                <button type="button" class="btn uno-call {{if this.view.canCallUno 'is-ready'}}" disabled={{if this.view.canCallUno false true}} {{on "click" this.sayUno}}>Uno!</button>
              {{/if}}
            </div>

            <GameChat @room={{this.room}} @floating={{true}} @class="uno-overlay uno-chat" />

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

          <ul class="sr-only" aria-label="Your hand">
            {{#each this.handItems key="key" as |item|}}
              <li><button type="button" disabled={{if item.playable false true}} {{on "click" (fn this.playCard item)}}>{{item.label}}{{unless item.playable " (can't play)"}}</button></li>
            {{/each}}
          </ul>
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
              <span class="lobby-rule-text"><span class="qr-label">Forgetting to call Uno</span><span class="tool-hint">Cards drawn as a penalty, from {{this.penaltyMin}} to {{this.penaltyMax}}. Press Uno! while holding two cards, before you play one of them.</span></span>
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

function ruleOn(settings, key) {
  return Boolean(settings[key]);
}
