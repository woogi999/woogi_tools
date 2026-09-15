import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { modifier } from 'ember-modifier';
import Icon from './icon';
import { GAME_CONTROLS, PAD_BUTTONS, RESERVED_KEYS, keybinds, keyLabel, padLabel } from '../utils/keybinds';
import { padState, pushPadHandler } from '../utils/gamepad';

// Settings: every game's keyboard keys and controller buttons, rebindable.
// Press "+ Key" (or "+ Button") and then the key or button you want; Escape cancels.
export default class ControlsSettings extends Component {
  games = GAME_CONTROLS;
  pad = padState;
  @tracked game = GAME_CONTROLS[0].game;
  // { game, action, kind: 'keys' | 'pad' } while waiting for a press.
  @tracked listening = null;

  get current() {
    // Reading overrides keeps the table in step with changes.
    void keybinds.overrides;
    const group = GAME_CONTROLS.find((g) => g.game === this.game);
    return {
      ...group,
      customised: keybinds.isCustomised(this.game),
      actions: group.actions.map((a) => ({
        ...a,
        keyList: keybinds.keys(this.game, a.id).map((code) => ({ code, label: keyLabel(code) })),
        padList: keybinds.pad(this.game, a.id).map((button) => ({ button, label: padLabel(button) })),
        waitingKey: this.isListening(a.id, 'keys'),
        waitingPad: this.isListening(a.id, 'pad'),
      })),
    };
  }

  isListening(action, kind) {
    const l = this.listening;
    return Boolean(l) && l.game === this.game && l.action === action && l.kind === kind;
  }

  pickGame = (game) => {
    this.game = game;
    this.listening = null;
  };

  listen = (action, kind) => {
    this.listening = this.isListening(action, kind) ? null : { game: this.game, action, kind };
  };

  remove = (action, kind, value) => keybinds.unassign(this.game, action, kind, value);
  reset = () => keybinds.reset(this.game);
  pickPadButton = (action, event) => {
    if (event.target.value) keybinds.assign(this.game, action, 'pad', event.target.value);
    event.target.value = '';
  };

  // While listening: the next key (or controller button) becomes the binding.
  capture = modifier(() => {
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
      keybinds.assign(l.game, l.action, 'keys', event.code);
      this.listening = null;
    };
    window.addEventListener('keydown', onKey, { capture: true });
    const release = pushPadHandler((button, { down }) => {
      const l = this.listening;
      if (!l || l.kind !== 'pad') return false;
      if (!down) return true;
      if (PAD_BUTTONS.includes(button)) keybinds.assign(l.game, l.action, 'pad', button);
      this.listening = null;
      return true;
    });
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true });
      release();
    };
  });

  padButtons = PAD_BUTTONS.map((id) => ({ id, label: padLabel(id) }));

  <template>
    <div class="controls-settings" {{this.capture}}>
      <p class="tool-hint">
        {{#if this.pad.connected}}
          <Icon @name="gamepad-2" @size={{13}} /> {{this.pad.connected}} connected. Use the D-pad to move round the site, A to press, B to go back, Start for search.
        {{else}}
          <Icon @name="gamepad-2" @size={{13}} /> Plug in or pair a controller and press any button: it works across the whole site, not just the games.
        {{/if}}
      </p>

      <div class="math-tabs" role="tablist" aria-label="Game">
        {{#each this.games key="game" as |g|}}
          <button type="button" role="tab" class="qr-tab {{if (eq g.game this.game) 'active'}}" aria-selected={{if (eq g.game this.game) "true" "false"}} {{on "click" (fn this.pickGame g.game)}}>{{g.label}}</button>
        {{/each}}
      </div>

      <div class="controls-table" role="table" aria-label="{{this.current.label}} controls">
        <div class="controls-row is-head" role="row">
          <span role="columnheader">Action</span>
          <span role="columnheader"><Icon @name="keyboard" @size={{13}} /> Keys</span>
          <span role="columnheader"><Icon @name="gamepad-2" @size={{13}} /> Controller</span>
        </div>
        {{#each this.current.actions key="id" as |a|}}
          <div class="controls-row" role="row">
            <span class="controls-action" role="cell">{{a.label}}</span>
            <span class="controls-binds" role="cell">
              {{#each a.keyList key="code" as |k|}}
                <span class="controls-chip"><kbd>{{k.label}}</kbd><button type="button" class="controls-chip-remove" aria-label="Remove {{k.label}} from {{a.label}}" {{on "click" (fn this.remove a.id "keys" k.code)}}><Icon @name="x" @size={{10}} /></button></span>
              {{/each}}
              <button type="button" class="controls-add {{if a.waitingKey 'is-listening'}}" {{on "click" (fn this.listen a.id "keys")}}>{{if a.waitingKey "Press a key…" "+ Key"}}</button>
            </span>
            <span class="controls-binds" role="cell">
              {{#each a.padList key="button" as |b|}}
                <span class="controls-chip"><kbd>{{b.label}}</kbd><button type="button" class="controls-chip-remove" aria-label="Remove {{b.label}} from {{a.label}}" {{on "click" (fn this.remove a.id "pad" b.button)}}><Icon @name="x" @size={{10}} /></button></span>
              {{/each}}
              {{#if this.pad.connected}}
                <button type="button" class="controls-add {{if a.waitingPad 'is-listening'}}" {{on "click" (fn this.listen a.id "pad")}}>{{if a.waitingPad "Press a button…" "+ Button"}}</button>
              {{else}}
                <select class="controls-select" aria-label="Add a controller button to {{a.label}}" {{on "change" (fn this.pickPadButton a.id)}}>
                  <option value="">+ Button</option>
                  {{#each this.padButtons key="id" as |p|}}<option value={{p.id}}>{{p.label}}</option>{{/each}}
                </select>
              {{/if}}
            </span>
          </div>
        {{/each}}
      </div>

      <p class="tool-hint">A key or button does one thing per game: giving it to one action takes it off any other. Esc cancels while choosing.</p>
      <button type="button" class="btn math-use" disabled={{if this.current.customised false true}} {{on "click" this.reset}}><Icon @name="rotate-ccw" @size={{13}} /> Reset {{this.current.label}} controls</button>
    </div>
  </template>
}

function eq(a, b) {
  return a === b;
}
