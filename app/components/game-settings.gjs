import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { LinkTo } from '@ember/routing';
import { modifier } from 'ember-modifier';
import Icon from './icon';
import { soundPrefs, sfx, SOUND_GROUPS } from '../utils/sound';
import {
  GAME_CONTROLS,
  PAD_BUTTONS,
  RESERVED_KEYS,
  keybinds,
  keyLabel,
  padLabel,
} from '../utils/keybinds';
import { padState, pushPadHandler } from '../utils/gamepad';

// The settings button a game carries with it: in its lobby before you start,
// and in the corner of the board once you have. It opens a real modal (the top
// layer, so it shows over a fullscreen game) with the two things worth changing
// mid-match: this game's volume, and this game's controls.
//
// Everything here writes to the same saved preferences as site Settings, so a
// volume or a rebound key set from a game stays set the next time you play it.
//
// Args: @game — 'snake', 'mines', 'chess' or 'woono'. @compact for the icon-only
// button used in a game's corner overlay.

// The channels that play over the top of any game, after the game's own.
const SHARED_CHANNELS = ['music', 'alerts'];

const eq = (a, b) => a === b;

export default class GameSettings extends Component {
  @tracked open = false;
  @tracked tab = 'sound';
  // { action, kind: 'keys' | 'pad' } while waiting for a press.
  @tracked listening = null;

  prefs = soundPrefs;
  pad = padState;
  padButtons = PAD_BUTTONS.map((id) => ({ id, label: padLabel(id) }));

  get game() {
    return this.args.game;
  }

  get label() {
    return (
      GAME_CONTROLS.find((g) => g.game === this.game)?.label ??
      SOUND_GROUPS.find((g) => g.id === this.game)?.label ??
      'Game'
    );
  }

  get masterSilent() {
    return this.prefs.muted || this.prefs.volume === 0;
  }

  get masterPercent() {
    return Math.round(this.prefs.volume * 100);
  }

  // This game's channel first, then the two that play over the top of it.
  get channels() {
    const groups = this.prefs.groups;
    return [this.game, ...SHARED_CHANNELS]
      .map((id) => SOUND_GROUPS.find((g) => g.id === id))
      .filter(Boolean)
      .map((g) => {
        const state = groups[g.id] ?? { volume: 1, muted: false };
        return {
          ...g,
          percent: Math.round(state.volume * 100),
          silent: state.muted || state.volume === 0,
        };
      });
  }

  get controls() {
    // Reading overrides keeps the list in step with a rebind.
    void keybinds.overrides;
    const group = GAME_CONTROLS.find((g) => g.game === this.game);
    if (!group) return null;
    return {
      customised: keybinds.isCustomised(this.game),
      actions: group.actions.map((a) => ({
        ...a,
        keyList: keybinds
          .keys(this.game, a.id)
          .map((code) => ({ code, label: keyLabel(code) })),
        padList: keybinds
          .pad(this.game, a.id)
          .map((button) => ({ button, label: padLabel(button) })),
        waitingKey: this.isListening(a.id, 'keys'),
        waitingPad: this.isListening(a.id, 'pad'),
      })),
    };
  }

  isListening(action, kind) {
    const l = this.listening;
    return Boolean(l) && l.action === action && l.kind === kind;
  }

  show = () => {
    this.open = true;
    this.listening = null;
  };

  close = () => {
    this.open = false;
    this.listening = null;
  };

  setTab = (tab) => {
    this.tab = tab;
    this.listening = null;
  };

  toggleMaster = () => this.prefs.toggleMuted();
  setMaster = (event) => this.prefs.setVolume(Number(event.target.value) / 100);
  toggleChannel = (id) => this.prefs.toggleGroupMuted(id);
  setChannel = (id, event) =>
    this.prefs.setGroupVolume(id, Number(event.target.value) / 100);
  preview = (channel) => sfx(channel.sample, { force: true });

  listen = (action, kind) => {
    this.listening = this.isListening(action, kind) ? null : { action, kind };
  };

  remove = (action, kind, value) =>
    keybinds.unassign(this.game, action, kind, value);
  resetControls = () => keybinds.reset(this.game);

  pickPadButton = (action, event) => {
    if (event.target.value)
      keybinds.assign(this.game, action, 'pad', event.target.value);
    event.target.value = '';
  };

  // Opens as a modal so it sits in the top layer, above a fullscreen game.
  // Escape and the backdrop both close it; while waiting for a key to bind,
  // Escape cancels that instead.
  dialog = modifier((element) => {
    element.showModal?.();
    sfx('ui.open');

    const onCancel = (event) => {
      if (!this.listening) return;
      event.preventDefault();
      this.listening = null;
    };
    // A click that lands on the dialog itself is a click on the backdrop.
    const onClick = (event) => {
      if (event.target === element) this.close();
    };
    const onClose = () => this.close();

    // While listening, the next key or controller button becomes the binding.
    const onKey = (event) => {
      const l = this.listening;
      if (!l || l.kind !== 'keys') return;
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape') {
        this.listening = null;
        return;
      }
      if (RESERVED_KEYS.has(event.code) || !event.code) return;
      keybinds.assign(this.game, l.action, 'keys', event.code);
      this.listening = null;
    };
    const releasePad = pushPadHandler((button, { down }) => {
      const l = this.listening;
      if (!l || l.kind !== 'pad') return false;
      if (!down) return true;
      if (PAD_BUTTONS.includes(button))
        keybinds.assign(this.game, l.action, 'pad', button);
      this.listening = null;
      return true;
    });

    element.addEventListener('cancel', onCancel);
    element.addEventListener('click', onClick);
    element.addEventListener('close', onClose);
    window.addEventListener('keydown', onKey, { capture: true });

    return () => {
      element.removeEventListener('cancel', onCancel);
      element.removeEventListener('click', onClick);
      element.removeEventListener('close', onClose);
      window.removeEventListener('keydown', onKey, { capture: true });
      releasePad();
      if (element.open) element.close();
    };
  });

  <template>
    {{#if @compact}}
      <button
        type="button"
        class="qr-icon-btn game-settings-btn"
        aria-label="{{this.label}} settings"
        title="{{this.label}} settings"
        {{on "click" this.show}}
      ><Icon @name="settings" @size={{15}} /></button>
    {{else}}
      <button
        type="button"
        class="btn"
        aria-label="{{this.label}} settings"
        {{on "click" this.show}}
      ><Icon @name="settings" @size={{13}} /> Settings</button>
    {{/if}}

    {{#if this.open}}
      <dialog
        class="game-settings-modal"
        aria-label="{{this.label}} settings"
        {{this.dialog}}
      >
        <div class="game-settings-body">
          <header class="game-settings-head">
            <h2 class="game-settings-name">{{this.label}} settings</h2>
            <button
              type="button"
              class="qr-icon-btn"
              aria-label="Close settings"
              {{on "click" this.close}}
            ><Icon @name="x" @size={{15}} /></button>
          </header>

          <div class="math-tabs" role="tablist" aria-label="Settings section">
            <button
              type="button"
              role="tab"
              class="qr-tab {{if (eq this.tab 'sound') 'active'}}"
              aria-selected={{if (eq this.tab "sound") "true" "false"}}
              {{on "click" (fn this.setTab "sound")}}
            >Sound</button>
            {{#if this.controls}}
              <button
                type="button"
                role="tab"
                class="qr-tab {{if (eq this.tab 'controls') 'active'}}"
                aria-selected={{if (eq this.tab "controls") "true" "false"}}
                {{on "click" (fn this.setTab "controls")}}
              >Controls</button>
            {{/if}}
          </div>

          {{#if (eq this.tab "sound")}}
            <div class="game-settings-pane">
              <div class="sound-channel is-master">
                <button
                  type="button"
                  class="qr-icon-btn sound-channel-mute
                    {{if this.masterSilent 'is-muted'}}"
                  aria-pressed={{if this.masterSilent "true" "false"}}
                  aria-label={{if
                    this.masterSilent
                    "Unmute all sounds"
                    "Mute all sounds"
                  }}
                  {{on "click" this.toggleMaster}}
                ><Icon
                    @name={{if this.masterSilent "volume-x" "volume-2"}}
                    @size={{14}}
                  /></button>
                <span class="sound-channel-text">
                  <span class="qr-label">All sounds</span>
                  <span class="tool-hint">Every channel below is a share of
                    this.</span>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={{this.masterPercent}}
                  aria-label="Master volume"
                  aria-valuetext="{{this.masterPercent}}%"
                  {{on "input" this.setMaster}}
                />
                <span class="volume-value">{{if
                    this.masterSilent
                    "Off"
                    (percentText this.masterPercent)
                  }}</span>
              </div>

              <ul class="sound-channels {{if this.masterSilent 'is-dim'}}">
                {{#each this.channels key="id" as |c|}}
                  <li class="sound-channel {{if c.silent 'is-silent'}}">
                    <button
                      type="button"
                      class="qr-icon-btn sound-channel-mute
                        {{if c.silent 'is-muted'}}"
                      aria-pressed={{if c.silent "true" "false"}}
                      aria-label="{{if c.silent 'Unmute' 'Mute'}} {{c.label}}"
                      title="{{if c.silent 'Unmute' 'Mute'}} {{c.label}}"
                      {{on "click" (fn this.toggleChannel c.id)}}
                    ><Icon
                        @name={{if c.silent "volume-x" c.icon}}
                        @size={{13}}
                      /></button>
                    <span class="sound-channel-text">
                      <span class="qr-label">{{c.label}}</span>
                      <span class="tool-hint">{{c.hint}}</span>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={{c.percent}}
                      aria-label="{{c.label}} volume"
                      aria-valuetext="{{c.percent}}%"
                      {{on "input" (fn this.setChannel c.id)}}
                      {{on "change" (fn this.preview c)}}
                    />
                    <span class="volume-value">{{if
                        c.silent
                        "Off"
                        (percentText c.percent)
                      }}</span>
                    <button
                      type="button"
                      class="qr-icon-btn"
                      aria-label="Play a sample of {{c.label}}"
                      title="Play a sample"
                      {{on "click" (fn this.preview c)}}
                    ><Icon @name="play" @size={{12}} /></button>
                  </li>
                {{/each}}
              </ul>
            </div>
          {{else if this.controls}}
            <div class="game-settings-pane">
              <p class="tool-hint">
                {{#if this.pad.connected}}
                  <Icon @name="gamepad-2" @size={{13}} />
                  {{this.pad.connected}}
                  connected.
                {{else}}
                  <Icon @name="gamepad-2" @size={{13}} />
                  Plug in or pair a controller and press any button to use one.
                {{/if}}
              </p>

              <div
                class="controls-table"
                role="table"
                aria-label="{{this.label}} controls"
              >
                <div class="controls-row is-head" role="row">
                  <span role="columnheader">Action</span>
                  <span role="columnheader"><Icon
                      @name="keyboard"
                      @size={{13}}
                    />
                    Keys</span>
                  <span role="columnheader"><Icon
                      @name="gamepad-2"
                      @size={{13}}
                    />
                    Controller</span>
                </div>
                {{#each this.controls.actions key="id" as |a|}}
                  <div class="controls-row" role="row">
                    <span class="controls-action" role="cell">{{a.label}}</span>
                    <span class="controls-binds" role="cell">
                      {{#each a.keyList key="code" as |k|}}
                        <span class="controls-chip"><kbd
                          >{{k.label}}</kbd><button
                            type="button"
                            class="controls-chip-remove"
                            aria-label="Remove {{k.label}} from {{a.label}}"
                            {{on "click" (fn this.remove a.id "keys" k.code)}}
                          ><Icon @name="x" @size={{10}} /></button></span>
                      {{/each}}
                      <button
                        type="button"
                        class="controls-add {{if a.waitingKey 'is-listening'}}"
                        {{on "click" (fn this.listen a.id "keys")}}
                      >{{if a.waitingKey "Press a key…" "+ Key"}}</button>
                    </span>
                    <span class="controls-binds" role="cell">
                      {{#each a.padList key="button" as |b|}}
                        <span class="controls-chip"><kbd
                          >{{b.label}}</kbd><button
                            type="button"
                            class="controls-chip-remove"
                            aria-label="Remove {{b.label}} from {{a.label}}"
                            {{on "click" (fn this.remove a.id "pad" b.button)}}
                          ><Icon @name="x" @size={{10}} /></button></span>
                      {{/each}}
                      {{#if this.pad.connected}}
                        <button
                          type="button"
                          class="controls-add
                            {{if a.waitingPad 'is-listening'}}"
                          {{on "click" (fn this.listen a.id "pad")}}
                        >{{if
                            a.waitingPad
                            "Press a button…"
                            "+ Button"
                          }}</button>
                      {{else}}
                        <select
                          class="controls-select"
                          aria-label="Add a controller button to {{a.label}}"
                          {{on "change" (fn this.pickPadButton a.id)}}
                        >
                          <option value="">+ Button</option>
                          {{#each this.padButtons key="id" as |p|}}<option
                              value={{p.id}}
                            >{{p.label}}</option>{{/each}}
                        </select>
                      {{/if}}
                    </span>
                  </div>
                {{/each}}
              </div>

              <p class="tool-hint">A key or button does one thing per game:
                giving it to one action takes it off any other. Esc cancels
                while choosing.</p>
              <button
                type="button"
                class="btn"
                disabled={{if this.controls.customised false true}}
                {{on "click" this.resetControls}}
              ><Icon @name="rotate-ccw" @size={{13}} />
                Reset
                {{this.label}}
                controls</button>
            </div>
          {{/if}}

          <footer class="game-settings-foot">
            <LinkTo @route="settings" class="lt-link"><Icon
                @name="sliders-horizontal"
                @size={{12}}
              />
              All settings</LinkTo>
            <button
              type="button"
              class="btn"
              {{on "click" this.close}}
            >Done</button>
          </footer>
        </div>
      </dialog>
    {{/if}}
  </template>
}

function percentText(value) {
  return `${value}%`;
}
