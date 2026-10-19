<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import GameLobby from './game-lobby.svelte';
  import ReadyButton from './ready-button.svelte';
  import GameChat from './game-chat.svelte';
  import GameSettings from './game-settings.svelte';
  import HoldConfirm from './hold-confirm.svelte';
  import AvatarPortrait from './avatar-portrait.svelte';
  import GameRoom from '../utils/game-room.svelte.js';
  import { roomCodeFromUrl } from '../utils/file-share.js';
  import { robotAvatar } from '../utils/avatar.js';
  import { botNames, newBotSeed } from '../utils/bot-names.js';
  import { BotChatter } from '../utils/bot-chat.js';
  import { sfx, preloadSounds } from '../utils/sound.svelte.js';
  import { askConfirm } from '../utils/confirm.svelte.js';
  import { listenForActions, onScreen, openChat } from '../utils/game-input.js';
  import { bindingParts, GAME_CONTROLS } from '../utils/keybinds.svelte.js';
  import noImageSave from '../utils/no-image-save.js';
  import {
    BOARD,
    GROUPS,
    MAX_PLAYERS,
    DEFAULT_RULES,
    MONEY_RANGE,
    SALARY_RANGE,
    FINE_RANGE,
    TURN_TIMES,
    WIN_MODES,
    ROUNDS_RANGE,
    SHARE_RANGE,
    HOUSES_RANGE,
    WIN_MONEY_RANGE,
    JAIL_TERM_RANGE,
    ARSON_USES,
    ARSON_SHARE,
    canRepair,
    canRelist,
    repairCost,
    winScore,
    winTarget,
    clampInt,
    normaliseRules,
    createGame,
    act,
    actorIndex,
    timeOut,
    viewFor,
    spectatorView,
    settleMs,
    handToBot,
    money,
    deedFor,
    propertiesOf,
    canBuild,
    canSellHouse,
    canMortgage,
    canUnmortgage,
    unmortgageCost,
    netWorth,
    isProperty,
  } from '../utils/woonopoly.js';
  import { decide, judgeTrade, proposeTrade } from '../utils/woonopoly-bot.js';

  // Woonopoly: our take on the property-trading board game, on a 3D board with
  // the players' avatars as the tokens. The rules are in utils/woonopoly.js,
  // the board in lazy/woonopoly-scene.js; this is the lobby, the HUD over the
  // board, and the host's loop that runs the computer players.

  const eq = (a, b) => a === b;
  const gt = (a, b) => a > b;
  const or = (a, b) => a || b;
  const bandStyle = (group) => `background: ${GROUPS[group]?.color ?? '#999'}`;
  const colourStyle = (color) => `background: ${color}`;
  // Computer players take a beat before they act, like someone reading the board.
  const BOT_THINK_MS = [700, 1500];
  const BOT_TRADE_CHANCE = 0.12;
  // How long a computer player waits for a person to answer its offer.
  const BOT_OFFER_MS = 30000;
  const between = ([min, max]) => min + Math.random() * (max - min);

  const TIMER_OPTIONS = TURN_TIMES.map((s) => ({
    id: s,
    label: s ? `${s}s` : 'Off',
  }));
  // What each way of winning asks for, and the box to type it in.
  const WIN_TARGETS = {
    rounds: {
      key: 'winRounds',
      range: ROUNDS_RANGE,
      step: 1,
      unit: 'rounds',
      hint: 'When the rounds are up, the richest player (cash, deeds and houses) wins.',
    },
    share: {
      key: 'winShare',
      range: SHARE_RANGE,
      step: 5,
      unit: '% of the 28 deeds',
      hint: 'First to own this share of the board wins.',
    },
    houses: {
      key: 'winHouses',
      range: HOUSES_RANGE,
      step: 1,
      unit: 'houses',
      hint: 'First to have this many houses standing wins. A hotel counts as five.',
    },
    money: {
      key: 'winMoney',
      range: WIN_MONEY_RANGE,
      step: 10000,
      unit: 'Woobux in hand',
      hint: 'First to hold this much cash wins.',
    },
  };
  const SWITCH_RULES = [
    {
      key: 'auctions',
      label: 'Auctions',
      hint: 'Land on a property and pass on it? It goes under the hammer, and anyone can bid.',
    },
    {
      key: 'auctionOnly',
      label: 'Everything goes to auction',
      hint: 'Nobody buys at the list price. Land on an unowned property and it goes straight under the hammer, you included.',
    },
    {
      key: 'doublesAgain',
      label: 'Doubles roll again',
      hint: 'Roll a double and take another go. Three in a row and it’s jail.',
    },
    {
      key: 'jailDoubles',
      label: 'Doubles open the jail',
      hint: 'Roll a double while inside and you walk. Off, and only the fine, a card or the full term gets you out.',
    },
    {
      key: 'jailSentence',
      label: 'Serve your sentence',
      hint: 'No fine, no card, no doubles. Sit in jail for the full term and walk out free.',
    },
    {
      key: 'jailFreeze',
      label: 'Jail freezes you',
      hint: 'While inside you collect no rent and sit out every auction and trade.',
    },
    {
      key: 'arson',
      label: 'Arson',
      hint: `Land on the biggest landlord’s property and torch it instead of paying rent. You go to jail owing them a quarter of its price; they repair it or hand it back. ${ARSON_USES} matches per game, and never while the owner is standing there.`,
    },
    {
      key: 'doubleGo',
      label: 'Double on GO',
      hint: 'Land exactly on GO and collect your salary twice.',
    },
    {
      key: 'freeParking',
      label: 'Free Parking jackpot',
      hint: 'Taxes and fines pile up in the middle; land on Free Parking to take the lot.',
    },
    {
      key: 'housingLimit',
      label: 'Housing shortage',
      hint: 'Only 32 houses and 12 hotels exist. When they run out, nobody builds until someone sells.',
    },
    {
      key: 'quickStart',
      label: 'Quick start',
      hint: 'Everyone begins with two properties, dealt at random.',
    },
  ];
  const BID_STEPS = [1000, 5000, 10000];

  class WoonopolyPage extends Component {
    timerOptions = TIMER_OPTIONS;
    winModes = WIN_MODES;
    switchRules = SWITCH_RULES;
    jailTermMin = JAIL_TERM_RANGE[0];
    jailTermMax = JAIL_TERM_RANGE[1];

    // The number box under the chosen win condition, if it has one.
    get winTarget() {
      const t = WIN_TARGETS[this.settings.winMode];
      if (!t) return null;
      return {
        ...t,
        min: t.range[0],
        max: t.range[1],
        value: this.settings[t.key],
      };
    }
    bidSteps = BID_STEPS;
    moneyMin = MONEY_RANGE[0];
    moneyMax = MONEY_RANGE[1];
    salaryMin = SALARY_RANGE[0];
    salaryMax = SALARY_RANGE[1];
    fineMin = FINE_RANGE[0];
    fineMax = FINE_RANGE[1];

    // 'lobby' | 'playing'
    mode = $state.raw('lobby');
    view = $state.raw(null);
    sceneFailed = $state.raw(false);
    settling = $state.raw(false);
    turnDeadline = $state.raw(null);
    now = $state.raw(Date.now());
    helpOpen = $state.raw(false);
    // The space whose deed is open, and whose properties are listed.
    selectedSpace = $state.raw(null);
    portfolioOf = $state.raw(null);
    deedFrom = $state.raw(null);
    tradeOpen = $state.raw(false);
    tradeDraft = $state.raw(null);
    bidAmount = $state.raw('');
    confirmingLobby = $state.raw(false);

    state = null;
    busyUntil = 0;
    settledEvent = null;
    settleTimer = null;
    botTimer = null;
    turnTimer = null;
    timerKey = null;
    clockTimer = null;
    scene = null;
    soundSeen = null;
    banterSeen = null;

    room = new GameRoom('woonopoly', {
      maxPlayers: MAX_PLAYERS,
      settings: { ...DEFAULT_RULES, bots: 3, botSeed: newBotSeed() },
      onMessage: (message, from) => this.onlineMessage(message, from),
      onGuestLeft: (id) => {
        if (this.state && handToBot(this.state, id)) this.refresh();
      },
      onClosed: () => this.backToLobby(),
    });

    chatter = new BotChatter(this.room);

    constructor(args) {
      super(args);
      const code = roomCodeFromUrl();
      if (code) this.room.join(code);
      // After the first render, since it rewrites settings the lobby is reading.
      queueMicrotask(() => this.migrateRules());
      preloadSounds('poly');
      registerDestructor(this, () => {
        this.stopBots();
        clearTimeout(this.turnTimer);
        clearTimeout(this.settleTimer);
        clearInterval(this.clockTimer);
        this.chatter.dispose();
        this.room.close();
      });
    }

    // Rules saved before prices grew by two zeroes would come back as ₱1,500 to
    // start; scale them up rather than clamping them to the floor.
    migrateRules() {
      const s = this.room.settings;
      if (this.isDestroyed || this.isDestroying || !this.room.isHost) return;
      if (s.startingMoney >= MONEY_RANGE[0]) return;
      this.room.setSettings({
        startingMoney: clampInt(
          s.startingMoney * 100,
          MONEY_RANGE,
          DEFAULT_RULES.startingMoney,
        ),
        goSalary: clampInt(
          s.goSalary * 100,
          SALARY_RANGE,
          DEFAULT_RULES.goSalary,
        ),
        jailFine: clampInt(
          s.jailFine * 100,
          FINE_RANGE,
          DEFAULT_RULES.jailFine,
        ),
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
    setNumberRule = (key, event) => {
      const range =
        {
          startingMoney: MONEY_RANGE,
          goSalary: SALARY_RANGE,
          jailFine: FINE_RANGE,
          winRounds: ROUNDS_RANGE,
          winShare: SHARE_RANGE,
          winHouses: HOUSES_RANGE,
          winMoney: WIN_MONEY_RANGE,
          jailTerm: JAIL_TERM_RANGE,
        }[key] ?? FINE_RANGE;
      const value = clampInt(event.target.value, range, DEFAULT_RULES[key]);
      event.target.value = value;
      this.room.setSettings({ [key]: value });
    };
    addBot = () =>
      this.room.setSettings({
        bots: Math.min(
          this.settings.bots + 1,
          MAX_PLAYERS - this.room.players.length,
        ),
      });
    removeBot = () =>
      this.room.setSettings({
        bots: Math.max(
          0,
          Math.min(this.settings.bots, MAX_PLAYERS - this.room.players.length) -
            1,
        ),
      });

    get busy() {
      return (this.mode === 'playing' && !this.isOver) || this.room.isOnline;
    }

    get closeWarning() {
      if (this.room.isOnline)
        return this.room.isHost
          ? 'Close Woonopoly? You’re hosting, so this ends the game and closes the room for everyone.'
          : 'Close Woonopoly? You’ll be disconnected from the game.';
      return 'Close Woonopoly? The game in progress will be lost.';
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
      this.selectedSpace = null;
      this.portfolioOf = null;
      this.deedFrom = null;
      this.tradeOpen = false;
      const bots = this.state.players.filter((p) => p.kind === 'bot');
      if (bots.length)
        this.chatter.say(
          bots[Math.floor(Math.random() * bots.length)].name,
          'hello',
          { urgent: true },
        );
      this.room.setLocked(true);
      this.room.resetReady();
      this.refresh();
    };

    get iAmSpectator() {
      return this.room.iAmSpectating;
    }

    get myIndex() {
      return this.state
        ? this.state.players.findIndex((p) => p.id === this.room.selfId)
        : -1;
    }

    refresh() {
      const state = this.state;
      const fresh = state.events.filter(
        (e) => this.settledEvent === null || e.id > this.settledEvent,
      );
      this.settledEvent = state.events.at(-1)?.id ?? this.settledEvent;
      const settle = settleMs(fresh);
      if (settle)
        this.busyUntil = Math.max(this.busyUntil, Date.now() + settle);
      this.armTurnTimer();
      const turnLeft = this.turnDeadline
        ? Math.max(0, this.turnDeadline - Date.now())
        : null;
      const settleLeft = Math.max(0, this.busyUntil - Date.now());
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

    apply(index, action) {
      if (!this.state || index < 0) return false;
      // Trades are answered and withdrawn while the board animates; everything else waits.
      const instant =
        action?.type === 'acceptTrade' ||
        action?.type === 'declineTrade' ||
        action?.type === 'trade';
      if (!instant && Date.now() < this.busyUntil) return false;
      return act(this.state, index, action);
    }

    stopBots() {
      clearTimeout(this.botTimer);
      this.botTimer = null;
    }

    afterSettle(task, extraMs = 0) {
      const wait = Math.max(0, this.busyUntil - Date.now()) + extraMs;
      return setTimeout(() => {
        if (Date.now() < this.busyUntil) this.botTimer = this.afterSettle(task);
        else task();
      }, wait);
    }

    // The computer player the game is waiting on acts once the board has settled.
    runBots() {
      const state = this.state;
      this.stopBots();
      if (!state || state.phase === 'over') return;
      const version = state.version;
      // A computer player's offer to a person lapses if it sits there too long.
      if (
        state.trade &&
        state.players[state.trade.from].kind === 'bot' &&
        state.players[state.trade.to].kind === 'human'
      ) {
        const from = state.trade.from;
        this.botTimer = setTimeout(() => {
          if (this.state !== state || state.version !== version) return;
          if (act(state, from, { type: 'declineTrade' })) this.refresh();
        }, BOT_OFFER_MS);
        return;
      }
      // An offer on the table for a computer player gets answered first.
      if (state.trade && state.players[state.trade.to].kind === 'bot') {
        const to = state.trade.to;
        this.botTimer = this.afterSettle(() => {
          if (this.state !== state || state.version !== version) return;
          const verdict = judgeTrade(state, to);
          if (verdict && act(state, to, { type: verdict })) {
            const from = state.players[state.trade?.from ?? -1];
            this.chatter.say(
              state.players[to].name,
              verdict === 'acceptTrade' ? 'tradeYes' : 'tradeNo',
              { vars: { name: from?.name } },
            );
            this.refresh();
          }
        }, between(BOT_THINK_MS));
        return;
      }
      const actor = actorIndex(state);
      if (actor < 0 || state.players[actor].kind !== 'bot') return;
      this.botTimer = this.afterSettle(() => {
        if (this.state !== state || state.version !== version) return;
        let move = null;
        // Now and then a computer player goes shopping for the property it's missing.
        if (
          state.phase === 'turn' &&
          state.rolled &&
          !state.trade &&
          Math.random() < BOT_TRADE_CHANCE
        )
          move = proposeTrade(state, actor);
        move ??= decide(state, actor);
        if (!move || !act(state, actor, move)) {
          if (!timeOut(state)) return;
          state.version++;
        }
        this.refresh();
      }, between(BOT_THINK_MS));
    }

    armTurnTimer() {
      const state = this.state;
      const seconds = state.rules.turnTime;
      if (!seconds || state.phase === 'over') {
        clearTimeout(this.turnTimer);
        this.turnDeadline = null;
        this.timerKey = null;
        return;
      }
      // The clock restarts whenever the game waits on someone new, or for something new.
      const key = `${state.turnId}:${state.phase}:${actorIndex(state)}:${state.rolled}`;
      if (this.timerKey === key) return;
      this.timerKey = key;
      clearTimeout(this.turnTimer);
      this.turnDeadline = Math.max(Date.now(), this.busyUntil) + seconds * 1000;
      this.turnTimer = setTimeout(() => {
        if (this.state === state && this.timerKey === key) {
          // A trade waiting on a human just lapses.
          if (state.trade && state.players[state.trade.to].kind === 'human')
            act(state, state.trade.to, { type: 'declineTrade' });
          if (timeOut(state)) state.version++;
          this.refresh();
        }
      }, this.turnDeadline - Date.now());
    }

    // Computer players comment on what just happened.
    banter(state) {
      const fresh = state.events.filter(
        (e) => this.banterSeen === null || e.id > this.banterSeen,
      );
      this.banterSeen = state.events.at(-1)?.id ?? this.banterSeen;
      const bot = (i) =>
        i >= 0 && state.players[i]?.kind === 'bot'
          ? state.players[i].name
          : null;
      for (const e of fresh) {
        if (e.type === 'rent' && bot(e.to))
          this.chatter.say(bot(e.to), 'rentIn', {
            chance: 0.5,
            vars: { name: state.players[e.player].name },
          });
        else if (e.type === 'rent' && bot(e.player) && e.amount >= 10000)
          this.chatter.say(bot(e.player), 'rentOut', {
            chance: 0.5,
            vars: { name: state.players[e.to].name },
          });
        else if (e.type === 'buy' && bot(e.player))
          this.chatter.say(bot(e.player), 'bought', {
            chance: 0.35,
            vars: { name: BOARD[e.space].name },
          });
        else if (e.type === 'sold' && bot(e.player))
          this.chatter.say(bot(e.player), 'auctionWin', {
            chance: 0.6,
            vars: { name: BOARD[e.space].name },
          });
        else if (e.type === 'jail' && bot(e.player))
          this.chatter.say(bot(e.player), 'jailed', { chance: 0.7 });
        else if (e.type === 'build' && bot(e.player) && e.houses === 5)
          this.chatter.say(bot(e.player), 'hotel', {
            chance: 0.6,
            vars: { name: BOARD[e.space].name },
          });
        else if (e.type === 'arson' && bot(e.player))
          this.chatter.say(bot(e.player), 'arson', {
            urgent: true,
            vars: { name: BOARD[e.space].name },
          });
        else if (e.type === 'arson' && bot(e.owner))
          this.chatter.say(bot(e.owner), 'burnt', {
            vars: { name: state.players[e.player].name },
          });
        else if (e.type === 'bankrupt' && bot(e.player))
          this.chatter.say(bot(e.player), 'broke', { urgent: true });
        else if (e.type === 'bankrupt' && e.to !== null && bot(e.to))
          this.chatter.say(bot(e.to), 'ruined', {
            vars: { name: state.players[e.player].name },
          });
        else if (e.type === 'win') {
          const winner = state.players[e.player];
          if (winner.kind === 'bot')
            this.chatter.say(winner.name, 'win', { urgent: true });
          else {
            const loser = state.players.find((p) => p.kind === 'bot');
            if (loser)
              this.chatter.say(loser.name, 'lose', {
                urgent: true,
                vars: { name: winner.name },
              });
          }
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
          if (left !== before && left && left <= 5 && this.myGo)
            sfx('poly.tick');
        }, 250);
      }
      if (!this.turnDeadline) {
        clearInterval(this.clockTimer);
        this.clockTimer = null;
      }
      const previous = this.view;
      this.view = view;
      this.playSounds(previous, view);
      clearTimeout(this.settleTimer);
      this.settling = view.settleLeft > 0;
      if (this.settling)
        this.settleTimer = setTimeout(() => {
          this.settling = false;
        }, view.settleLeft);
      this.scene?.setView(view);
    }

    playSounds(previous, view) {
      const sameGame = previous?.gameId === view.gameId;
      const events = view.events ?? [];
      if (!sameGame) {
        this.soundSeen = events.at(-1)?.id ?? null;
        sfx('poly.start');
        return;
      }
      const fresh = events.filter(
        (e) => this.soundSeen === null || e.id > this.soundSeen,
      );
      this.soundSeen = events.at(-1)?.id ?? this.soundSeen;
      const settle = Math.max(0, view.settleLeft ?? 0);
      const me = view.you;
      if (me >= 0) {
        const myGoNow = view.actor === me && view.phase !== 'over';
        const myGoBefore =
          previous.actor === me &&
          previous.phase === view.phase &&
          previous.turnId === view.turnId;
        if (myGoNow && !myGoBefore)
          setTimeout(() => sfx('poly.myturn'), settle);
        if (
          view.trade &&
          view.trade.to === me &&
          previous.trade?.from !== view.trade.from
        )
          sfx('poly.offer');
      }
      const win = fresh.find((e) => e.type === 'win');
      if (win)
        setTimeout(
          () => sfx(win.player === me ? 'poly.win' : 'poly.lose'),
          settle,
        );
      if (this.sceneFailed)
        for (const e of fresh) {
          if (e.type === 'roll') sfx('poly.dice');
          if (e.type === 'money' && e.amount > 0) sfx('poly.receive');
          if (e.type === 'money' && e.amount < 0) sfx('poly.pay');
        }
    }

    act(action) {
      if (this.isHostSide) {
        if (this.apply(this.myIndex, action)) this.refresh();
      } else this.room.send({ type: 'action', action });
    }

    // ─── What you see ────────────────────────────────────────────────────

    get me() {
      const v = this.view;
      return v && v.you >= 0 ? v.players[v.you] : null;
    }

    get isOver() {
      return this.view?.phase === 'over';
    }

    get iWon() {
      return this.isOver && this.view.winner === this.view.you;
    }

    get myGo() {
      const v = this.view;
      return Boolean(
        v && v.you >= 0 && v.actor === v.you && v.phase !== 'over',
      );
    }

    get locked() {
      return this.settling;
    }

    get actorName() {
      const v = this.view;
      if (!v || v.actor < 0) return '';
      return v.actor === v.you ? 'You' : v.players[v.actor].name;
    }

    get playerRows() {
      const v = this.view;
      if (!v) return [];
      return v.players.map((p, index) => ({
        ...p,
        index,
        isYou: index === v.you,
        isActor: index === v.actor && v.phase !== 'over',
        isTurn: index === v.turn && v.phase !== 'over',
        cash: money(p.money),
        count: propertiesOf(v, index).length,
        isWinner: v.winner === index,
      }));
    }

    get secondsLeft() {
      if (!this.turnDeadline) return null;
      return Math.max(0, Math.ceil((this.turnDeadline - this.now) / 1000));
    }

    get diceLabel() {
      const [a, b] = this.view?.dice ?? [0, 0];
      return a ? `${a} + ${b}` : '';
    }

    get status() {
      const v = this.view;
      if (!v) return '';
      const who = this.actorName;
      const yours = v.actor === v.you;
      if (v.phase === 'over') {
        if (v.winner === null) return 'Everyone went bankrupt. The bank wins.';
        return yours || v.winner === v.you
          ? 'You win Woonopoly! Cash, property, friendships: all yours.'
          : `${v.players[v.winner].name} wins Woonopoly.`;
      }
      if (this.settling) {
        const mover = v.players[v.turn];
        return v.dice[0]
          ? `${mover.name} rolled ${v.dice[0] + v.dice[1]}.`
          : '';
      }
      if (v.phase === 'debt') {
        const d = v.debt;
        const owed = money(d.amount);
        const to = d.to === null ? 'the bank' : v.players[d.to].name;
        return yours
          ? `You owe ${owed} to ${to}. Sell houses, mortgage, or trade to raise it.`
          : `${who} owes ${owed} to ${to}.`;
      }
      if (v.phase === 'auction') {
        const a = v.auction;
        const high =
          a.bidder === null
            ? 'no bids yet'
            : `${money(a.bid)} from ${v.players[a.bidder].name}`;
        return `${BOARD[a.space].name} is up for auction (${high}). ${yours ? 'Your bid.' : `${who} to bid.`}`;
      }
      if (v.phase === 'buy') {
        const space = BOARD[v.players[v.turn].pos];
        return yours
          ? `${space.name} is for sale at ${money(space.price)}.`
          : `${who} is looking at ${space.name}.`;
      }
      if (v.phase === 'rent' && v.pending) {
        const space = BOARD[v.pending.space];
        const owner = v.players[v.pending.owner].name;
        return yours
          ? `${money(v.pending.amount)} rent is due to ${owner} for ${space.name}. Pay up, or strike a match.`
          : `${who} owes ${owner} rent for ${space.name}, and is eyeing the matches.`;
      }
      const player = v.players[v.turn];
      if (!v.rolled) {
        if (player.inJail)
          return yours
            ? v.rules.jailSentence
              ? `You’re in jail, serving ${v.rules.jailTerm - player.jailTurns} more turn${v.rules.jailTerm - player.jailTurns === 1 ? '' : 's'}. Roll to pass the time.`
              : v.rules.jailDoubles
                ? 'You’re in jail. Roll for doubles, pay the fine, or use a card.'
                : 'You’re in jail. Pay the fine, use a card, or sit out the term.'
            : `${who} is in jail.`;
        return yours ? 'Your turn: roll the dice.' : `${who} is rolling.`;
      }
      if (v.doubles && !player.inJail && yours) return 'Doubles! Roll again.';
      return yours
        ? 'Build, trade or mortgage, then end your turn.'
        : `${who} is managing their estate.`;
    }

    get roundLabel() {
      const v = this.view;
      if (!v) return '';
      return v.rules.winMode === 'rounds'
        ? `Round ${v.round}/${v.rules.winRounds}`
        : `Round ${v.round}`;
    }

    // How close the leader is to the finish line, for the HUD.
    get winChip() {
      const v = this.view;
      if (!v) return null;
      const target = winTarget(v.rules);
      if (!target) return null;
      let best = null;
      v.players.forEach((p, i) => {
        if (p.bankrupt) return;
        const score = winScore(v, i);
        if (!best || score > best.score) best = { name: p.name, score };
      });
      if (!best) return null;
      const fmt = (n) =>
        v.rules.winMode === 'money'
          ? money(n)
          : v.rules.winMode === 'share'
            ? `${Math.round(n)}%`
            : String(Math.round(n));
      return {
        title: `${WIN_MODES.find((m) => m.id === v.rules.winMode).label}: first to ${fmt(target)}`,
        text: `${best.name} ${fmt(best.score)} / ${fmt(target)}`,
      };
    }

    get timerStyle() {
      const total = (this.view?.rules?.turnTime ?? 0) * 1000;
      if (!total || !this.turnDeadline || this.isOver) return 'display: none';
      const left = Math.max(
        0,
        Math.min(1, (this.turnDeadline - this.now) / total),
      );
      return `transform: scaleX(${left.toFixed(3)})`;
    }

    // ─── Deeds ───────────────────────────────────────────────────────────

    get deed() {
      const v = this.view;
      if (!v || this.selectedSpace === null) return null;
      const d = deedFor(v, this.selectedSpace);
      if (!isProperty(d)) return null;
      const me = v.you;
      const mine = d.owner === me;
      return {
        ...d,
        ownerName: d.owner === null ? 'Nobody yet' : v.players[d.owner].name,
        ownerColor: d.owner === null ? null : v.players[d.owner].color,
        mine,
        houseLabel:
          d.houses === 5
            ? 'Hotel'
            : d.houses
              ? `${d.houses} house${d.houses > 1 ? 's' : ''}`
              : '',
        arsonable: v.canArson && v.pending?.space === d.space,
        canBuild: mine && v.canManage && canBuild(v, me, d.space),
        canSell: mine && v.canManage && canSellHouse(v, me, d.space),
        canMortgage: mine && v.canManage && canMortgage(v, me, d.space),
        canUnmortgage: mine && v.canManage && canUnmortgage(v, me, d.space),
        canRepair: mine && v.canManage && canRepair(v, me, d.space),
        canRelist: mine && v.canManage && canRelist(v, me, d.space),
        repairCost: money(repairCost(v, d.space)),
        unmortgageCost: money(unmortgageCost(d.space)),
        housePrice: d.type === 'street' ? money(d.house) : '',
        halfHouse: d.type === 'street' ? money(d.house / 2) : '',
        mortgageValue: money(d.price / 2),
      };
    }

    pickSpace = (space) => {
      this.selectedSpace = space;
      this.scene?.setPointer(space);
      if (space !== null) sfx('ui.select');
    };
    closeDeed = () => this.pickSpace(null);

    // From the deeds list: the deed takes the list's place, with a way back.
    get fromPortfolio() {
      return this.deedFrom !== null;
    }
    pickFromPortfolio = (space) => {
      this.deedFrom = this.portfolioOf;
      this.portfolioOf = null;
      this.pickSpace(space);
    };
    backToPortfolio = () => {
      const index = this.deedFrom;
      this.deedFrom = null;
      this.pickSpace(null);
      this.portfolioOf = index;
    };

    // The debt you are settling, shown in whichever panel is open so the big
    // "you owe" dialog can step aside while you sell and mortgage.
    get myDebt() {
      const v = this.view;
      if (!v?.debt || v.debt.who !== v.you) return null;
      return {
        amount: money(v.debt.amount),
        have: money(this.me?.money ?? 0),
        canPay: v.canPayDebt,
      };
    }

    get debtDialog() {
      if (this.settling) return null;
      if (!this.myDebt) return null;
      if (this.deed || this.portfolio || this.tradeBuilder || this.offer)
        return null;
      return this.myDebt;
    }

    // The involuntary auction popup: hidden while the board is still animating
    // to it, so it doesn't give away what you landed on before you see it.
    get showAuction() {
      return !this.settling && Boolean(this.view?.canBid || this.view?.auction);
    }

    get portfolio() {
      const v = this.view;
      if (!v || this.portfolioOf === null) return null;
      const index = this.portfolioOf;
      const player = v.players[index];
      if (!player) return null;
      const props = propertiesOf(v, index).map((space) => {
        const info = BOARD[space];
        const prop = v.props[space];
        return {
          space,
          name: info.name,
          group: info.group,
          houses: prop.houses,
          mortgaged: prop.mortgaged,
          badge:
            prop.houses === 5 ? 'Hotel' : prop.houses ? `${prop.houses}h` : '',
        };
      });
      return {
        ...player,
        index,
        isYou: index === v.you,
        props,
        cash: money(player.money),
        worth: money(netWorth(v, index)),
      };
    }

    openPortfolio = (index) => {
      this.portfolioOf = this.portfolioOf === index ? null : index;
      this.deedFrom = null;
      this.selectedSpace = null;
      this.scene?.setPointer(null);
    };
    closePortfolio = () => (this.portfolioOf = null);

    // ─── Your moves ──────────────────────────────────────────────────────

    roll = () => this.act({ type: 'roll' });
    payRent = () => this.act({ type: 'payRent' });
    commitArson = async () => {
      const p = this.view?.pending;
      if (!p) return;
      const left = ARSON_USES - (this.me?.arsons ?? 0);
      const ok = await askConfirm({
        title: 'Strike the match?',
        message: `${BOARD[p.space].name} burns. You go straight to jail owing ${this.view.players[p.owner].name} ${money(BOARD[p.space].price * ARSON_SHARE)}. You have ${left} match${left === 1 ? '' : 'es'} left.`,
        confirmLabel: 'Hold to burn it',
        cancelLabel: 'Pay the rent instead',
      });
      if (ok) this.act({ type: 'arson' });
    };
    repair = (space) => this.act({ type: 'repair', space });
    relist = (space) => this.act({ type: 'relist', space });
    endTurn = () => this.act({ type: 'end' });
    buy = () => this.act({ type: 'buy' });
    decline = () => this.act({ type: 'decline' });
    payFine = () => this.act({ type: 'payFine' });
    useJailCard = () => this.act({ type: 'useJailCard' });
    build = (space) => this.act({ type: 'build', space });
    sellHouse = (space) => this.act({ type: 'sellHouse', space });
    mortgage = (space) => this.act({ type: 'mortgage', space });
    unmortgage = (space) => this.act({ type: 'unmortgage', space });
    payDebt = () => this.act({ type: 'payDebt' });
    declareBankruptcy = async () => {
      if (
        !(await askConfirm({
          title: 'Declare bankruptcy?',
          message:
            'Everything you own goes to whoever you owe, and you’re out of the game.',
          confirmLabel: 'Hold to go bankrupt',
          cancelLabel: 'Keep trying',
        }))
      )
        return;
      this.act({ type: 'bankrupt' });
    };

    get bidInfo() {
      const v = this.view;
      if (!v?.auction) return null;
      const a = v.auction;
      const space = BOARD[a.space];
      const me = this.me;
      const bidder = a.bidders[a.at];
      return {
        space: a.space,
        name: space.name,
        group: space.group,
        price: money(space.price),
        high: a.bid ? money(a.bid) : 'no bids',
        highBidder: a.bidder === null ? '' : v.players[a.bidder].name,
        whose:
          bidder === v.you
            ? 'Your bid'
            : `${v.players[bidder]?.name ?? 'Someone'} to bid`,
        canAfford: me ? me.money > a.bid : false,
        steps: BID_STEPS.map((step) => ({
          step,
          amount: a.bid + step,
          label: `+${money(step)}`,
          ok: Boolean(me && a.bid + step <= me.money),
        })),
        bidders: a.bidders.map((i) => v.players[i].name).join(', '),
      };
    }

    setBidAmount = (event) => (this.bidAmount = event.target.value);
    bid = (amount) => {
      const value = Math.round(Number(amount ?? this.bidAmount));
      if (!Number.isFinite(value)) return;
      this.act({ type: 'bid', amount: value });
      this.bidAmount = '';
    };
    passBid = () => this.act({ type: 'passBid' });

    // ─── Trades ──────────────────────────────────────────────────────────

    get tradePartners() {
      const v = this.view;
      if (!v) return [];
      return v.players
        .map((p, index) => ({ ...p, index }))
        .filter((p) => !p.bankrupt && p.index !== v.you);
    }

    openTrade = (to = null) => {
      const partner = to ?? this.tradePartners[0]?.index ?? null;
      if (partner === null) return;
      this.tradeDraft = {
        to: partner,
        giveMoney: 0,
        giveProps: [],
        giveCards: 0,
        getMoney: 0,
        getProps: [],
        getCards: 0,
      };
      this.tradeOpen = true;
      this.portfolioOf = null;
      this.deedFrom = null;
      this.selectedSpace = null;
      this.scene?.setPointer(null);
    };
    closeTrade = () => {
      this.tradeOpen = false;
      this.tradeDraft = null;
    };
    setTradePartner = (index) =>
      (this.tradeDraft = {
        ...this.tradeDraft,
        to: index,
        getProps: [],
        getMoney: 0,
        getCards: 0,
      });
    setTradeMoney = (side, event) => {
      const owner =
        side === 'give' ? this.me : this.view.players[this.tradeDraft.to];
      const value = clampInt(event.target.value, [0, owner?.money ?? 0], 0);
      event.target.value = value;
      this.tradeDraft = { ...this.tradeDraft, [`${side}Money`]: value };
    };
    toggleTradeProp = (side, space) => {
      const key = `${side}Props`;
      const list = this.tradeDraft[key];
      this.tradeDraft = {
        ...this.tradeDraft,
        [key]: list.includes(space)
          ? list.filter((s) => s !== space)
          : [...list, space],
      };
    };
    toggleTradeCard = (side) => {
      const key = `${side}Cards`;
      this.tradeDraft = {
        ...this.tradeDraft,
        [key]: this.tradeDraft[key] ? 0 : 1,
      };
    };

    // The tradeable things on each side: properties without houses.
    tradeList(index) {
      const v = this.view;
      if (!v || index === null) return [];
      return propertiesOf(v, index)
        .filter((space) => v.props[space].houses === 0)
        .map((space) => ({
          space,
          name: BOARD[space].name,
          group: BOARD[space].group,
          mortgaged: v.props[space].mortgaged,
        }));
    }

    get tradeBuilder() {
      const d = this.tradeDraft;
      const v = this.view;
      if (!d || !v || !this.tradeOpen) return null;
      const partner = v.players[d.to];
      const mine = this.tradeList(v.you).map((p) => ({
        ...p,
        on: d.giveProps.includes(p.space),
      }));
      const theirs = this.tradeList(d.to).map((p) => ({
        ...p,
        on: d.getProps.includes(p.space),
      }));
      const empty =
        !d.giveMoney &&
        !d.giveProps.length &&
        !d.giveCards &&
        !d.getMoney &&
        !d.getProps.length &&
        !d.getCards;
      return {
        ...d,
        partner,
        partnerName: partner?.name ?? '',
        mine,
        theirs,
        myCards: this.me?.jailCards ?? 0,
        theirCards: partner?.jailCards ?? 0,
        canSend: !empty && v.canTrade,
      };
    }

    sendTrade = () => {
      const d = this.tradeDraft;
      if (!d) return;
      this.act({
        type: 'trade',
        to: d.to,
        give: {
          money: d.giveMoney,
          props: d.giveProps,
          jailCards: d.giveCards,
        },
        get: { money: d.getMoney, props: d.getProps, jailCards: d.getCards },
      });
      this.tradeOpen = false;
      sfx('ui.confirm');
    };

    // The offer on the table, from either side.
    get offer() {
      const v = this.view;
      const t = v?.trade;
      if (!t) return null;
      const side = (offer) => ({
        money: offer.money ? money(offer.money) : '',
        props: offer.props.map((space) => ({
          space,
          name: BOARD[space].name,
          group: BOARD[space].group,
          mortgaged: v.props[space].mortgaged,
        })),
        cards: offer.jailCards,
        empty: !offer.money && !offer.props.length && !offer.jailCards,
      });
      return {
        from: v.players[t.from].name,
        to: v.players[t.to].name,
        forMe: t.to === v.you,
        byMe: t.from === v.you,
        give: side(t.give),
        get: side(t.get),
      };
    }

    acceptTrade = () => this.act({ type: 'acceptTrade' });
    declineTrade = () => this.act({ type: 'declineTrade' });

    // ─── The board ───────────────────────────────────────────────────────

    setupScene = modifier((canvas) => {
      let scene = null;
      let cancelled = false;
      import('../lazy/woonopoly-scene.js')
        .then(({ createWoonopolyScene }) => {
          if (cancelled) return;
          scene = createWoonopolyScene(canvas, {
            onPick: (space) => this.pickSpace(space),
          });
          this.scene = scene;
          scene.setCamera(this.cameraMode);
          if (this.view) scene.setView(this.view);
        })
        .catch((error) => {
          console.warn('3D board unavailable:', error);
          this.sceneFailed = true;
        });
      const stopInput = listenForActions('woonopoly', {
        active: () => this.mode === 'playing' && onScreen(canvas),
        onAction: (action) => this.onAction(action),
      });
      return () => {
        cancelled = true;
        stopInput();
        scene?.dispose();
        this.scene = null;
      };
    });

    cameraMode = $state.raw('follow');
    historyOpen = $state.raw(false);
    sides = [
      { id: 0, label: 'GO' },
      { id: 1, label: 'Jail' },
      { id: 2, label: 'Parking' },
      { id: 3, label: 'Go to jail' },
    ];

    setCamera = (mode) => {
      this.cameraMode = mode;
      this.scene?.setCamera(mode);
    };
    lookFrom = (side) => {
      this.cameraMode = 'map';
      this.scene?.lookFrom(side);
    };
    toggleHistory = () => (this.historyOpen = !this.historyOpen);

    get recentLog() {
      return (this.view?.log ?? []).slice(-3);
    }

    toggleHelp = () => (this.helpOpen = !this.helpOpen);

    get keyHelp() {
      return (
        GAME_CONTROLS.find((g) => g.game === 'woonopoly')?.actions ?? []
      ).map((a) => ({
        id: a.id,
        label: a.label,
        ...bindingParts('woonopoly', a.id),
      }));
    }

    onAction(action) {
      const v = this.view;
      if (!v) return false;
      switch (action) {
        case 'roll':
          if (!v.canRoll || this.locked) return false;
          this.roll();
          return true;
        case 'end':
          if (!v.canEnd || this.locked) return false;
          this.endTurn();
          return true;
        case 'buy':
          if (!v.canBuy || this.locked) return false;
          this.buy();
          return true;
        case 'decline':
          if (v.canDecline && !this.locked) this.decline();
          else if (v.canBid) this.passBid();
          else return false;
          return true;
        case 'trade':
          if (!v.canTrade || v.you < 0) return false;
          this.openTrade();
          return true;
        case 'portfolio':
          if (v.you < 0) return false;
          this.openPortfolio(v.you);
          return true;
        case 'close':
          this.closeDeed();
          this.closePortfolio();
          this.closeTrade();
          this.helpOpen = false;
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

    // ─── Leaving ─────────────────────────────────────────────────────────

    playAgain = () => this.room.allReady && this.start();
    readyCheck = () => this.room.callReadyCheck();

    askLobby = () => {
      if (this.isOver) this.toLobby();
      else this.confirmingLobby = true;
    };
    cancelLobby = () => (this.confirmingLobby = false);

    get lobbyWarning() {
      return this.room.isOnline
        ? 'This ends the game for everyone in the room.'
        : 'The game in progress will be lost.';
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
      this.timerKey = null;
      this.settling = false;
      this.busyUntil = 0;
      this.selectedSpace = null;
      this.portfolioOf = null;
      this.deedFrom = null;
      this.tradeOpen = false;
      this.tradeDraft = null;
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
          message: 'You’ll be disconnected, and the computer plays on for you.',
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
        }
        return;
      }
      if (message.type === 'view') this.show(message.view);
      else if (message.type === 'lobby') this.backToLobby();
    }
  }

  function spacePrice(view) {
    return BOARD[view.players[view.turn].pos].price ?? 0;
  }

  function ruleOn(settings, key) {
    return Boolean(settings[key]);
  }
</script>

<script>
  let args = $props();
  const self = new WoonopolyPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="woonopoly"
  busy={self.busy}
  closeWarning={self.closeWarning}
  landscape={true}
  game={true}
  subtitle="Buy up the board, build hotels, and bankrupt your friends. Our take on the property game: up to eight players, your avatars as the tokens, Woobux in pesos, auctions, trades and every house rule."
>
  {#if truthy(eq(self.mode, 'playing'))}
    <div class="game-shell poly-shell pop-in">
      <div class="poly-stage {truthy(self.myGo) ? 'is-my-turn' : ''}">
        <canvas
          class="poly-canvas"
          aria-hidden="true"
          {@attach self.setupScene?.()}
          {@attach noImageSave()}
        ></canvas>

        {#if truthy(self.sceneFailed)}
          <p class="poly-fallback"
            >This browser can’t draw the 3D board, but the game still works from
            the panels: open a player to see their properties.</p
          >
        {/if}

        <div
          class="poly-timer {truthy(self.myGo) ? 'is-mine' : ''}"
          style={self.timerStyle}
          aria-hidden="true"
        ></div>

        <!-- ─── Players, top left ──────────────────────────────── -->
        <div class="poly-overlay poly-top-left">
          <ol class="poly-players" aria-label="Players">
            {#each self.playerRows ?? [] as p}
              <li>
                <button
                  type="button"
                  class="poly-player
                        {truthy(p?.isActor) ? 'is-actor' : ''}
                        {truthy(p?.isTurn) ? 'is-turn' : ''}
                        {truthy(p?.bankrupt) ? 'is-out' : ''}
                        {truthy(eq(self.portfolioOf, p?.index))
                    ? 'is-open'
                    : ''}"
                  aria-pressed={truthy(eq(self.portfolioOf, p?.index))
                    ? 'true'
                    : 'false'}
                  title="See {p?.name}’s properties"
                  onclick={(..._r) => self.openPortfolio(p?.index, ..._r)}
                >
                  <span class="poly-player-swatch" style={colourStyle(p?.color)}
                  ></span>
                  <AvatarPortrait avatar={p?.avatar} size={30} />
                  <span class="poly-player-text">
                    <span class="poly-player-name"
                      >{truthy(p?.isYou)
                        ? 'You'
                        : p?.name}{#if truthy(p?.isWinner)}
                        <Icon
                          name="crown"
                          size={11}
                        />{/if}{#if truthy(p?.inJail)}
                        <Icon name="lock" size={11} />{/if}</span
                    >
                    <span class="poly-player-cash"
                      >{truthy(p?.bankrupt) ? 'Bankrupt' : p?.cash}
                      <span class="poly-player-count"
                        >·
                        {p?.count}
                        {truthy(eq(p?.count, 1)) ? 'deed' : 'deeds'}</span
                      ></span
                    >
                  </span>
                </button>
              </li>
            {/each}
          </ol>
          <div class="poly-hud">
            <span class="poly-hud-chip">{self.roundLabel}</span>
            {#if truthy(self.winChip)}<span
                class="poly-hud-chip"
                title={self.winChip?.title}
                ><Icon name="trophy" size={12} />{self.winChip?.text}</span
              >{/if}
            {#if truthy(self.secondsLeft)}<span
                class="poly-hud-chip
                      {truthy(gt(6, self.secondsLeft)) ? 'is-alert' : ''}"
                ><Icon name="timer" size={12} />{self.secondsLeft}s</span
              >{/if}
            {#if truthy(self.diceLabel)}<span class="poly-hud-chip"
                ><Icon name="dices" size={12} />{self.diceLabel}</span
              >{/if}
            {#if truthy(self.view?.rules?.freeParking)}<span
                class="poly-hud-chip"
                ><Icon name="circle-parking" size={12} />{money(
                  self.view?.pot,
                )}</span
              >{/if}
            {#if truthy(self.view?.rules?.housingLimit)}<span
                class="poly-hud-chip"
                title="Houses and hotels left in the bank"
                ><Icon name="house" size={12} />{self.view?.houses}
                ·
                {self.view?.hotels}</span
              >{/if}
          </div>
        </div>

        <!-- ─── Settings and log, top right ─────────────────────── -->
        <div class="poly-overlay poly-top-right">
          <GameSettings game="woonopoly" />
          {#if truthy(self.isHostSide)}
            <button type="button" class="btn" onclick={self.askLobby}
              ><Icon name="users" size={13} />
              Lobby</button
            >
          {:else}
            <button type="button" class="btn" onclick={self.leave}
              ><Icon name="log-out" size={13} />
              Leave</button
            >
          {/if}
          <button
            type="button"
            class="btn {truthy(self.historyOpen) ? 'active' : ''}"
            aria-expanded={truthy(self.historyOpen) ? 'true' : 'false'}
            aria-controls="poly-history"
            onclick={self.toggleHistory}
            ><Icon name="scroll-text" size={13} />
            History</button
          >
          {#if truthy(self.historyOpen)}
            <ol
              id="poly-history"
              class="poly-history"
              aria-label="Everything that happened"
            >
              {#each self.view?.log ?? [] as entry (entry?.id)}<li
                  >{entry?.text}</li
                >{/each}
            </ol>
          {:else}
            <ol class="poly-log" aria-label="What just happened">
              {#each self.recentLog ?? [] as entry (entry?.id)}<li
                  >{entry?.text}</li
                >{/each}
            </ol>
          {/if}
        </div>

        <p
          class="poly-overlay poly-status {truthy(self.isOver)
            ? 'is-over'
            : ''}"
          role="status"
          >{#if truthy(self.iWon)}<Icon name="party-popper" size={15} />
          {/if}{self.status}</p
        >

        <!-- ─── Camera, bottom centre ──────────────────────────── -->
        <div class="poly-overlay poly-views" role="group" aria-label="Camera">
          <button
            type="button"
            class="poly-chip
                  {truthy(eq(self.cameraMode, 'follow')) ? 'is-active' : ''}"
            aria-pressed={truthy(eq(self.cameraMode, 'follow'))
              ? 'true'
              : 'false'}
            title="Ride along with whoever is moving"
            onclick={(..._r) => self.setCamera('follow', ..._r)}
            ><Icon name="video" size={11} /> Follow</button
          >
          <button
            type="button"
            class="poly-chip {truthy(eq(self.cameraMode, 'map'))
              ? 'is-active'
              : ''}"
            aria-pressed={truthy(eq(self.cameraMode, 'map')) ? 'true' : 'false'}
            title="See the whole board"
            onclick={(..._r) => self.setCamera('map', ..._r)}
            ><Icon name="map" size={11} /> Map</button
          >
          {#if truthy(eq(self.cameraMode, 'map'))}
            {#each self.sides ?? [] as side}
              <button
                type="button"
                class="poly-chip"
                onclick={(..._r) => self.lookFrom(side?.id, ..._r)}
                >{side?.label}</button
              >
            {/each}
          {/if}
        </div>

        <!-- ─── Your moves, bottom right ────────────────────────── -->
        {#if !truthy(self.iAmSpectator)}
          <div class="poly-overlay poly-actions">
            <button
              type="button"
              class="btn poly-icon-btn {truthy(self.helpOpen) ? 'active' : ''}"
              aria-expanded={truthy(self.helpOpen) ? 'true' : 'false'}
              aria-controls="poly-help"
              aria-label="Controls"
              title="Controls"
              onclick={self.toggleHelp}><Icon name="info" size={15} /></button
            >
            {#if truthy(self.isOver)}
              {#if truthy(self.isHostSide)}
                {#if !truthy(self.room?.allReady)}
                  <span class="poly-hud-chip"
                    >{self.room?.readyCount}/{self.room?.players?.length}
                    ready</span
                  >
                  <button type="button" class="btn" onclick={self.readyCheck}
                    ><Icon name="bell-ring" size={13} />
                    Ready check</button
                  >
                {/if}
                <button
                  type="button"
                  class="btn active"
                  disabled={truthy(self.room?.allReady) ? false : true}
                  title={truthy(self.room?.allReady)
                    ? ''
                    : 'Everyone has to press Ready first'}
                  onclick={self.playAgain}
                  ><Icon name="rotate-cw" size={13} /> Play again</button
                >
              {:else}
                <ReadyButton
                  room={self.room}
                  label="Play again?"
                  readyLabel="Ready for another"
                />
                {#if truthy(self.room?.iAmReady)}<span class="poly-hud-chip"
                    >Waiting for the host…</span
                  >{/if}
              {/if}
            {:else}
              {#if truthy(self.me)}
                <button
                  type="button"
                  class="btn"
                  onclick={(..._r) => self.openPortfolio(self.view?.you, ..._r)}
                  ><Icon name="scroll-text" size={13} /> My deeds</button
                >
                {#if truthy(self.view?.canTrade)}
                  <button
                    type="button"
                    class="btn"
                    onclick={(..._r) => self.openTrade(null, ..._r)}
                    ><Icon name="arrow-right-left" size={13} />
                    Trade</button
                  >
                {/if}
              {/if}
              {#if !truthy(self.settling)}
                {#if truthy(self.view?.canUseJailCard)}
                  <button
                    type="button"
                    class="btn"
                    disabled={self.locked}
                    onclick={self.useJailCard}
                    ><Icon name="ticket" size={13} />
                    Use jail card</button
                  >
                {/if}
                {#if truthy(self.view?.canPayFine)}
                  <button
                    type="button"
                    class="btn"
                    disabled={self.locked}
                    onclick={self.payFine}
                    >Pay {money(self.view?.rules?.jailFine)}</button
                  >
                {/if}
                {#if truthy(self.view?.canRoll)}
                  <button
                    type="button"
                    class="btn active poly-roll"
                    disabled={self.locked}
                    onclick={self.roll}
                    ><Icon name="dices" size={14} />
                    {truthy(self.me?.inJail)
                      ? 'Roll for doubles'
                      : 'Roll'}</button
                  >
                {/if}
                {#if truthy(self.view?.canBuy)}
                  <button
                    type="button"
                    class="btn active"
                    disabled={self.locked}
                    onclick={self.buy}
                    >Buy for {money(spacePrice(self.view))}</button
                  >
                {/if}
                {#if truthy(self.view?.canDecline)}
                  <button
                    type="button"
                    class="btn"
                    disabled={self.locked}
                    onclick={self.decline}
                    >{truthy(self.view?.rules?.auctions)
                      ? 'Auction it'
                      : 'Pass'}</button
                  >
                {/if}
                {#if truthy(self.view?.canPayRent)}
                  <button
                    type="button"
                    class="btn active"
                    disabled={self.locked}
                    onclick={self.payRent}
                    >Pay {money(self.view?.pending?.amount)} rent</button
                  >
                {/if}
                {#if truthy(self.view?.canArson)}
                  <button
                    type="button"
                    class="btn poly-danger"
                    disabled={self.locked}
                    onclick={self.commitArson}
                    ><Icon name="flame" size={13} /> Commit arson</button
                  >
                {/if}
                {#if truthy(self.view?.canEnd)}
                  <button
                    type="button"
                    class="btn active"
                    disabled={self.locked}
                    onclick={self.endTurn}
                    ><Icon name="check" size={13} /> End turn</button
                  >
                {/if}
              {/if}
            {/if}
          </div>
        {/if}

        {#if truthy(self.iAmSpectator)}
          <div class="mines-spectate" role="status">
            <span class="mines-spectate-label"
              ><Icon name="eye" size={14} />
              Watching.</span
            >
          </div>
        {/if}

        <GameChat
          room={self.room}
          floating={true}
          class="poly-overlay poly-chat"
        />

        <!-- ─── Panels ──────────────────────────────────────────── -->
        {#if truthy(self.deed)}
          <div
            class="poly-dialog poly-deed pop-in"
            role="dialog"
            aria-label="{self.deed?.name} deed"
          >
            <div class="poly-deed-band" style={bandStyle(self.deed?.group)}>
              {#if truthy(self.fromPortfolio)}
                <button
                  type="button"
                  class="btn poly-icon-btn"
                  aria-label="Back to deeds"
                  onclick={self.backToPortfolio}
                  ><Icon name="arrow-left" size={14} /></button
                >
              {/if}
              <span>{self.deed?.name}</span>
              <button
                type="button"
                class="btn poly-icon-btn"
                aria-label="Close"
                onclick={self.closeDeed}><Icon name="x" size={14} /></button
              >
            </div>
            <div class="poly-deed-body">
              <p class="poly-deed-owner">
                {#if truthy(self.deed?.ownerColor)}<span
                    class="poly-player-swatch"
                    style={colourStyle(self.deed?.ownerColor)}
                  ></span>{/if}
                {self.deed?.ownerName}{#if truthy(self.deed?.houseLabel)}
                  ·
                  {self.deed?.houseLabel}{/if}{#if truthy(self.deed?.mortgaged)}
                  · mortgaged{/if}{#if truthy(self.deed?.burnt)}
                  · burnt out{/if}
                <span class="lobby-tag">{money(self.deed?.price)}</span>
              </p>
              <dl class="poly-deed-rents">
                {#each self.deed?.lines ?? [] as line}
                  <dt>{line?.label}</dt><dd>{line?.value}</dd>
                {/each}
              </dl>
              {#if truthy(self.myDebt)}
                <p class="poly-debt-line">
                  <Icon name="triangle-alert" size={13} />
                  You owe
                  {self.myDebt?.amount}, you have
                  {self.myDebt?.have}.
                  <button
                    type="button"
                    class="btn active"
                    disabled={truthy(self.myDebt?.canPay) ? false : true}
                    onclick={self.payDebt}>Pay</button
                  >
                </p>
              {/if}
              {#if truthy(self.deed?.mine)}
                <div class="poly-deed-actions">
                  {#if truthy(self.deed?.canBuild)}
                    <button
                      type="button"
                      class="btn active"
                      onclick={(..._r) => self.build(self.deed?.space, ..._r)}
                      ><Icon name="house" size={13} />
                      Build ({self.deed?.housePrice})</button
                    >
                  {/if}
                  {#if truthy(self.deed?.canSell)}
                    <button
                      type="button"
                      class="btn"
                      onclick={(..._r) =>
                        self.sellHouse(self.deed?.space, ..._r)}
                      >Sell a house ({self.deed?.halfHouse})</button
                    >
                  {/if}
                  {#if truthy(self.deed?.canMortgage)}
                    <button
                      type="button"
                      class="btn"
                      onclick={(..._r) =>
                        self.mortgage(self.deed?.space, ..._r)}
                      >Mortgage ({self.deed?.mortgageValue})</button
                    >
                  {/if}
                  {#if truthy(self.deed?.canUnmortgage)}
                    <button
                      type="button"
                      class="btn"
                      onclick={(..._r) =>
                        self.unmortgage(self.deed?.space, ..._r)}
                      >Pay off ({self.deed?.unmortgageCost})</button
                    >
                  {/if}
                  {#if truthy(self.deed?.canRepair)}
                    <button
                      type="button"
                      class="btn active"
                      onclick={(..._r) => self.repair(self.deed?.space, ..._r)}
                      ><Icon name="hammer" size={13} />
                      Repair ({self.deed?.repairCost})</button
                    >
                  {/if}
                  {#if truthy(self.deed?.canRelist)}
                    <button
                      type="button"
                      class="btn"
                      onclick={(..._r) => self.relist(self.deed?.space, ..._r)}
                      >Hand back to the bank</button
                    >
                  {/if}
                  {#if !truthy(self.view?.canManage)}
                    <p class="tool-hint"
                      >You can build and mortgage on your own turn.</p
                    >
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        {/if}

        {#if truthy(self.portfolio)}
          <div
            class="poly-dialog poly-portfolio pop-in"
            role="dialog"
            aria-label="{self.portfolio?.name}’s properties"
          >
            <div class="poly-dialog-head">
              <span class="qr-label"
                ><span
                  class="poly-player-swatch"
                  style={colourStyle(self.portfolio?.color)}
                ></span>
                {truthy(self.portfolio?.isYou)
                  ? 'Your deeds'
                  : self.portfolio?.name}
                <span class="lobby-tag">{self.portfolio?.cash}</span>
                <span class="lobby-tag" title="Everything, sold up"
                  >worth
                  {self.portfolio?.worth}</span
                ></span
              >
              <button
                type="button"
                class="btn poly-icon-btn"
                aria-label="Close"
                onclick={self.closePortfolio}
                ><Icon name="x" size={14} /></button
              >
            </div>
            {#if truthy(self.myDebt)}
              <p class="poly-debt-line">
                <Icon name="triangle-alert" size={13} />
                You owe
                {self.myDebt?.amount}, you have
                {self.myDebt?.have}.
                <button
                  type="button"
                  class="btn active"
                  disabled={truthy(self.myDebt?.canPay) ? false : true}
                  onclick={self.payDebt}>Pay</button
                >
              </p>
            {/if}
            {#if truthy(self.portfolio?.props?.length)}
              <ul class="poly-deed-list">
                {#each self.portfolio?.props ?? [] as p}
                  <li>
                    <button
                      type="button"
                      class="poly-deed-chip
                            {truthy(p?.mortgaged) ? 'is-mortgaged' : ''}"
                      onclick={(..._r) =>
                        self.pickFromPortfolio(p?.space, ..._r)}
                      ><span class="poly-deed-dot" style={bandStyle(p?.group)}
                      ></span>{p?.name}{#if truthy(p?.badge)}
                        <span class="lobby-tag">{p?.badge}</span>{/if}</button
                    >
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="tool-hint">Nothing yet.</p>
            {/if}
            {#if truthy(self.portfolio?.jailCards)}
              <p class="tool-hint"
                ><Icon name="ticket" size={12} />
                {self.portfolio?.jailCards}
                Get Out of Jail Free
                {truthy(eq(self.portfolio?.jailCards, 1)) ? 'card' : 'cards'}</p
              >
            {/if}
            {#if !truthy(self.portfolio?.isYou)}
              {#if truthy(self.view?.canTrade)}
                <button
                  type="button"
                  class="btn"
                  onclick={(..._r) =>
                    self.openTrade(self.portfolio?.index, ..._r)}
                  ><Icon name="arrow-right-left" size={13} />
                  Offer a trade</button
                >
              {/if}
            {/if}
          </div>
        {/if}

        {#if truthy(self.showAuction)}
          {#if truthy(self.bidInfo)}
            <div
              class="poly-dialog poly-auction pop-in"
              role="dialog"
              aria-label="Auction"
            >
              <div class="poly-dialog-head">
                <span class="qr-label"
                  ><Icon name="gavel" size={14} />
                  Auction</span
                >
                <span class="lobby-tag">{self.bidInfo?.whose}</span>
              </div>
              <button
                type="button"
                class="poly-deed-chip"
                onclick={(..._r) => self.pickSpace(self.bidInfo?.space, ..._r)}
                ><span
                  class="poly-deed-dot"
                  style={bandStyle(self.bidInfo?.group)}
                ></span>{self.bidInfo?.name}
                <span class="lobby-tag"
                  >list
                  {self.bidInfo?.price}</span
                ></button
              >
              <p class="poly-auction-high"
                >Highest:
                <strong>{self.bidInfo?.high}</strong
                >{#if truthy(self.bidInfo?.highBidder)}
                  from
                  {self.bidInfo?.highBidder}{/if}</p
              >
              <p class="tool-hint">Still in: {self.bidInfo?.bidders}</p>
              {#if truthy(self.view?.canBid)}
                <div class="poly-bid-row">
                  {#each self.bidInfo?.steps ?? [] as s}
                    <button
                      type="button"
                      class="btn"
                      disabled={truthy(s?.ok) ? false : true}
                      onclick={(..._r) => self.bid(s?.amount, ..._r)}
                      >{s?.label}</button
                    >
                  {/each}
                  <input
                    type="number"
                    class="lobby-number"
                    min="1"
                    step="1"
                    placeholder="Amount"
                    aria-label="Your bid"
                    {@attach prop('value', () => self.bidAmount)}
                    oninput={self.setBidAmount}
                  />
                  <button
                    type="button"
                    class="btn active"
                    disabled={truthy(self.bidAmount) ? false : true}
                    onclick={(..._r) => self.bid(null, ..._r)}>Bid</button
                  >
                  <button type="button" class="btn" onclick={self.passBid}
                    >Pass</button
                  >
                </div>
              {/if}
            </div>
          {/if}
        {/if}

        {#if truthy(self.debtDialog)}
          <div
            class="poly-dialog poly-debt pop-in"
            role="dialog"
            aria-label="You owe money"
          >
            <div class="poly-dialog-head">
              <span class="qr-label"
                ><Icon name="triangle-alert" size={14} />
                You owe
                {money(self.view?.debt?.amount)}</span
              >
              <span class="lobby-tag"
                >you have
                {money(self.me?.money)}</span
              >
            </div>
            <p class="tool-hint"
              >Open “My deeds” to sell houses or mortgage property, or offer
              someone a trade. Then pay up.</p
            >
            <div class="poly-deed-actions">
              <button
                type="button"
                class="btn"
                onclick={(..._r) => self.openPortfolio(self.view?.you, ..._r)}
                >My deeds</button
              >
              <button
                type="button"
                class="btn active"
                disabled={truthy(self.view?.canPayDebt) ? false : true}
                onclick={self.payDebt}
                >Pay {money(self.view?.debt?.amount)}</button
              >
              <button
                type="button"
                class="btn poly-danger"
                onclick={self.declareBankruptcy}>Declare bankruptcy</button
              >
            </div>
          </div>
        {/if}

        {#if truthy(self.tradeBuilder)}
          <div
            class="poly-dialog poly-trade pop-in"
            role="dialog"
            aria-label="Offer a trade"
          >
            <div class="poly-dialog-head">
              <span class="qr-label"
                ><Icon name="arrow-right-left" size={14} />
                Trade with</span
              >
              <button
                type="button"
                class="btn poly-icon-btn"
                aria-label="Close"
                onclick={self.closeTrade}><Icon name="x" size={14} /></button
              >
            </div>
            <div class="poly-chips">
              {#each self.tradePartners ?? [] as p}
                <button
                  type="button"
                  class="poly-chip
                        {truthy(eq(self.tradeBuilder?.to, p?.index))
                    ? 'is-active'
                    : ''}"
                  aria-pressed={truthy(eq(self.tradeBuilder?.to, p?.index))
                    ? 'true'
                    : 'false'}
                  onclick={(..._r) => self.setTradePartner(p?.index, ..._r)}
                  >{p?.name}</button
                >
              {/each}
            </div>
            <div class="poly-trade-sides">
              <div class="poly-trade-side">
                <span class="qr-label">You give</span>
                <div class="poly-trade-money">
                  <span>₱</span>
                  <input
                    type="number"
                    class="lobby-number"
                    min="0"
                    max={self.me?.money}
                    step="1"
                    {@attach prop('value', () => self.tradeBuilder?.giveMoney)}
                    aria-label="Woobux you give"
                    onchange={(..._r) => self.setTradeMoney('give', ..._r)}
                  />
                </div>
                <ul class="poly-deed-list">
                  {#each self.tradeBuilder?.mine ?? [] as p}
                    <li
                      ><button
                        type="button"
                        class="poly-deed-chip
                              {truthy(p?.on) ? 'is-active' : ''}
                              {truthy(p?.mortgaged) ? 'is-mortgaged' : ''}"
                        aria-pressed={truthy(p?.on) ? 'true' : 'false'}
                        onclick={(..._r) =>
                          self.toggleTradeProp('give', p?.space, ..._r)}
                        ><span class="poly-deed-dot" style={bandStyle(p?.group)}
                        ></span>{p?.name}</button
                      ></li
                    >
                  {/each}
                  {#if truthy(self.tradeBuilder?.myCards)}
                    <li
                      ><button
                        type="button"
                        class="poly-deed-chip
                              {truthy(self.tradeBuilder?.giveCards)
                          ? 'is-active'
                          : ''}"
                        aria-pressed={truthy(self.tradeBuilder?.giveCards)
                          ? 'true'
                          : 'false'}
                        onclick={(..._r) => self.toggleTradeCard('give', ..._r)}
                        ><Icon name="ticket" size={12} />
                        Jail card</button
                      ></li
                    >
                  {/if}
                </ul>
              </div>
              <div class="poly-trade-side">
                <span class="qr-label">You get</span>
                <div class="poly-trade-money">
                  <span>₱</span>
                  <input
                    type="number"
                    class="lobby-number"
                    min="0"
                    max={self.tradeBuilder?.partner?.money}
                    step="1"
                    {@attach prop('value', () => self.tradeBuilder?.getMoney)}
                    aria-label="Woobux you get"
                    onchange={(..._r) => self.setTradeMoney('get', ..._r)}
                  />
                </div>
                <ul class="poly-deed-list">
                  {#each self.tradeBuilder?.theirs ?? [] as p}
                    <li
                      ><button
                        type="button"
                        class="poly-deed-chip
                              {truthy(p?.on) ? 'is-active' : ''}
                              {truthy(p?.mortgaged) ? 'is-mortgaged' : ''}"
                        aria-pressed={truthy(p?.on) ? 'true' : 'false'}
                        onclick={(..._r) =>
                          self.toggleTradeProp('get', p?.space, ..._r)}
                        ><span class="poly-deed-dot" style={bandStyle(p?.group)}
                        ></span>{p?.name}</button
                      ></li
                    >
                  {/each}
                  {#if truthy(self.tradeBuilder?.theirCards)}
                    <li
                      ><button
                        type="button"
                        class="poly-deed-chip
                              {truthy(self.tradeBuilder?.getCards)
                          ? 'is-active'
                          : ''}"
                        aria-pressed={truthy(self.tradeBuilder?.getCards)
                          ? 'true'
                          : 'false'}
                        onclick={(..._r) => self.toggleTradeCard('get', ..._r)}
                        ><Icon name="ticket" size={12} />
                        Jail card</button
                      ></li
                    >
                  {/if}
                </ul>
              </div>
            </div>
            <p class="tool-hint"
              >Streets with houses can’t be traded; sell the houses first.</p
            >
            <div class="poly-deed-actions">
              <button
                type="button"
                class="btn active"
                disabled={truthy(self.tradeBuilder?.canSend) ? false : true}
                onclick={self.sendTrade}
                ><Icon name="send" size={13} /> Send the offer</button
              >
            </div>
          </div>
        {/if}

        {#if truthy(self.offer)}
          {#if truthy(or(self.offer?.forMe, self.offer?.byMe))}
            <div
              class="poly-dialog poly-offer pop-in"
              role="dialog"
              aria-label="Trade offer"
            >
              <div class="poly-dialog-head">
                <span class="qr-label"
                  ><Icon name="arrow-right-left" size={14} />
                  {#if truthy(self.offer?.forMe)}{self.offer?.from}
                    offers you a trade{:else}Waiting for
                    {self.offer?.to}…{/if}</span
                >
              </div>
              <div class="poly-trade-sides">
                <div class="poly-trade-side">
                  <span class="qr-label"
                    >{truthy(self.offer?.forMe) ? 'You get' : 'You give'}</span
                  >
                  {#if truthy(self.offer?.give?.empty)}<p class="tool-hint"
                      >Nothing</p
                    >{/if}
                  {#if truthy(self.offer?.give?.money)}<span class="lobby-tag"
                      >{self.offer?.give?.money}</span
                    >{/if}
                  {#each self.offer?.give?.props ?? [] as p}<span
                      class="poly-deed-chip
                            {truthy(p?.mortgaged) ? 'is-mortgaged' : ''}"
                      ><span class="poly-deed-dot" style={bandStyle(p?.group)}
                      ></span>{p?.name}</span
                    >{/each}
                  {#if truthy(self.offer?.give?.cards)}<span class="lobby-tag"
                      ><Icon name="ticket" size={11} />
                      Jail card</span
                    >{/if}
                </div>
                <div class="poly-trade-side">
                  <span class="qr-label"
                    >{truthy(self.offer?.forMe) ? 'You give' : 'You get'}</span
                  >
                  {#if truthy(self.offer?.get?.empty)}<p class="tool-hint"
                      >Nothing</p
                    >{/if}
                  {#if truthy(self.offer?.get?.money)}<span class="lobby-tag"
                      >{self.offer?.get?.money}</span
                    >{/if}
                  {#each self.offer?.get?.props ?? [] as p}<span
                      class="poly-deed-chip
                            {truthy(p?.mortgaged) ? 'is-mortgaged' : ''}"
                      ><span class="poly-deed-dot" style={bandStyle(p?.group)}
                      ></span>{p?.name}</span
                    >{/each}
                  {#if truthy(self.offer?.get?.cards)}<span class="lobby-tag"
                      ><Icon name="ticket" size={11} />
                      Jail card</span
                    >{/if}
                </div>
              </div>
              <div class="poly-deed-actions">
                {#if truthy(self.offer?.forMe)}
                  <button
                    type="button"
                    class="btn active"
                    onclick={self.acceptTrade}
                    ><Icon name="check" size={13} />
                    Accept</button
                  >
                  <button type="button" class="btn" onclick={self.declineTrade}
                    >Decline</button
                  >
                {:else}
                  <button type="button" class="btn" onclick={self.declineTrade}
                    >Withdraw</button
                  >
                {/if}
              </div>
            </div>
          {/if}
        {/if}

        {#if truthy(self.helpOpen)}
          <div
            id="poly-help"
            class="poly-help pop-in"
            role="dialog"
            aria-label="How to play"
          >
            <div class="poly-dialog-head">
              <span class="qr-label">How to play</span>
              <button
                type="button"
                class="btn poly-icon-btn"
                aria-label="Close"
                onclick={self.toggleHelp}><Icon name="x" size={14} /></button
              >
            </div>
            <ul>
              <li
                ><strong>Roll</strong>
                and walk your avatar round the board. Pass GO for your salary.</li
              >
              <li
                >Land on a free property to
                <strong>buy</strong>
                it, or send it to auction.</li
              >
              <li
                >Land on someone’s property and you
                <strong>pay rent</strong>: more with the full colour set, much
                more with houses.</li
              >
              <li
                >Own a whole colour set to
                <strong>build</strong>
                (tap the street, or open My deeds). Build evenly: four houses, then
                a hotel.</li
              >
              <li
                >Short of cash?
                <strong>Mortgage</strong>
                for half the price, or
                <strong>trade</strong>. Can’t pay at all: bankruptcy.</li
              >
              <li
                >Three doubles in a row, or the corner, sends you to jail. Roll
                doubles, pay the fine, or use a card to get out (unless the
                lobby rules say otherwise).</li
              >
              {#if truthy(self.view?.rules?.arson)}
                <li
                  >Land on the biggest landlord’s property and you can
                  <strong>commit arson</strong>
                  instead of paying rent: the buildings burn, you go to jail owing
                  them a quarter of the property’s price, and they repair it or hand
                  it back. Two matches per game, and never while the owner is standing
                  on it.</li
                >
              {/if}
              <li
                ><strong>Drag</strong>
                the board to look round it,
                <strong>scroll</strong>
                to zoom,
                <strong>tap a space</strong>
                for its deed.</li
              >
            </ul>
            <details class="poly-help-keys">
              <summary>Keyboard & controller</summary>
              <ul>
                {#each self.keyHelp ?? [] as k (k?.id)}
                  <li
                    ><strong>{k?.label}</strong>
                    <span class="poly-help-bind"
                      >{#if truthy(k?.keys)}<Icon name="keyboard" size={12} />
                        {k?.keys}{/if}{#if truthy(k?.pad)}{#if truthy(k?.keys)}
                          ·
                        {/if}<Icon name="gamepad-2" size={12} />
                        {k?.pad}{/if}{#if !truthy(k?.keys)}{#if !truthy(k?.pad)}Not
                          bound{/if}{/if}</span
                    ></li
                  >
                {/each}
              </ul>
              <p class="tool-hint"
                >Change them any time in Settings → Controls.</p
              >
            </details>
          </div>
        {/if}

        {#if truthy(self.confirmingLobby)}
          <HoldConfirm
            title="Back to the lobby?"
            message={self.lobbyWarning}
            confirmLabel="Hold to end game"
            onConfirm={self.toLobby}
            onCancel={self.cancelLobby}
          />
        {/if}

        <p class="poly-rotate-hint" aria-hidden="true"
          ><Icon name="rotate-cw" size={14} />
          Turn your phone sideways for the full board</p
        >
      </div>
    </div>
  {:else}
    <GameLobby
      game="woonopoly"
      room={self.room}
      seats={self.seats}
      maxSeats={8}
      onAddBot={self.addBot}
      onRemoveBot={self.removeBot}
      spectatable={true}
      onStart={self.start}
      startLabel="Start"
      blocker={self.blocker}
      >{#snippet rules()}
        <label class="lobby-rule is-switch">
          <span class="lobby-rule-text"
            ><span class="qr-label">Starting Woobux</span><span
              class="tool-hint">What everyone begins with, in pesos.</span
            ></span
          >
          <input
            type="number"
            class="lobby-number"
            min={self.moneyMin}
            max={self.moneyMax}
            step="5000"
            {@attach prop('value', () => self.settings?.startingMoney)}
            onchange={(..._r) => self.setNumberRule('startingMoney', ..._r)}
          />
        </label>
        <label class="lobby-rule is-switch">
          <span class="lobby-rule-text"
            ><span class="qr-label">Salary for passing GO</span><span
              class="tool-hint">Collected every lap.</span
            ></span
          >
          <input
            type="number"
            class="lobby-number"
            min={self.salaryMin}
            max={self.salaryMax}
            step="1000"
            {@attach prop('value', () => self.settings?.goSalary)}
            onchange={(..._r) => self.setNumberRule('goSalary', ..._r)}
          />
        </label>
        <label class="lobby-rule is-switch">
          <span class="lobby-rule-text"
            ><span class="qr-label">Jail fine</span><span class="tool-hint"
              >To walk out of jail early, or charged when the term is up.</span
            ></span
          >
          <input
            type="number"
            class="lobby-number"
            min={self.fineMin}
            max={self.fineMax}
            step="1000"
            {@attach prop('value', () => self.settings?.jailFine)}
            onchange={(..._r) => self.setNumberRule('jailFine', ..._r)}
          />
        </label>
        <label class="lobby-rule is-switch">
          <span class="lobby-rule-text"
            ><span class="qr-label">Jail term</span><span class="tool-hint"
              >Turns inside before you’re let out.</span
            ></span
          >
          <input
            type="number"
            class="lobby-number"
            min={self.jailTermMin}
            max={self.jailTermMax}
            step="1"
            {@attach prop('value', () => self.settings?.jailTerm)}
            onchange={(..._r) => self.setNumberRule('jailTerm', ..._r)}
          />
        </label>
        <div class="lobby-rule">
          <span class="lobby-rule-text"
            ><span class="qr-label">Win condition</span><span class="tool-hint"
              >{truthy(self.winTarget)
                ? self.winTarget?.hint
                : 'Play until everyone else is bankrupt.'}</span
            ></span
          >
          <div class="math-tabs" role="group" aria-label="Win condition">
            {#each self.winModes ?? [] as o}
              <button
                type="button"
                class="qr-tab
                      {truthy(eq(self.settings?.winMode, o?.id))
                  ? 'active'
                  : ''}"
                aria-pressed={truthy(eq(self.settings?.winMode, o?.id))
                  ? 'true'
                  : 'false'}
                onclick={(..._r) => self.setRule('winMode', o?.id, ..._r)}
                >{o?.label}</button
              >
            {/each}
          </div>
          {#if truthy(self.winTarget)}
            <label class="poly-win-target">
              <span class="tool-hint">Target</span>
              <input
                type="number"
                class="lobby-number"
                min={self.winTarget?.min}
                max={self.winTarget?.max}
                step={self.winTarget?.step}
                {@attach prop('value', () => self.winTarget?.value)}
                onchange={(..._r) =>
                  self.setNumberRule(self.winTarget?.key, ..._r)}
              />
              <span class="tool-hint">{self.winTarget?.unit}</span>
            </label>
          {/if}
        </div>
        <div class="lobby-rule">
          <span class="lobby-rule-text"
            ><span class="qr-label">Turn timer</span><span class="tool-hint"
              >How long each decision gets. Run out and the game rolls, passes
              or ends the turn for you.</span
            ></span
          >
          <div class="math-tabs" role="group" aria-label="Turn timer">
            {#each self.timerOptions ?? [] as o}
              <button
                type="button"
                class="qr-tab
                      {truthy(eq(self.settings?.turnTime, o?.id))
                  ? 'active'
                  : ''}"
                aria-pressed={truthy(eq(self.settings?.turnTime, o?.id))
                  ? 'true'
                  : 'false'}
                onclick={(..._r) => self.setRule('turnTime', o?.id, ..._r)}
                >{o?.label}</button
              >
            {/each}
          </div>
        </div>
        {#each self.switchRules ?? [] as rule}
          <label class="lobby-rule is-switch">
            <span class="lobby-rule-text"
              ><span class="qr-label">{rule?.label}</span><span
                class="tool-hint">{rule?.hint}</span
              ></span
            >
            <span class="qr-switch">
              <input
                type="checkbox"
                role="switch"
                {@attach prop('checked', () =>
                  ruleOn(self.settings, rule?.key),
                )}
                aria-checked={truthy(ruleOn(self.settings, rule?.key))
                  ? 'true'
                  : 'false'}
                onchange={(..._r) => self.toggleRule(rule?.key, ..._r)}
              />
              <span class="qr-switch-track" aria-hidden="true"></span>
            </span>
          </label>
        {/each}
      {/snippet}</GameLobby
    >
  {/if}
</ToolPage>
