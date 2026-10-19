<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { modifier } from '../core/modifier.js';
  import { truthy } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import Icon from './icon.svelte';
  import {
    GAME_CONTROLS,
    PAD_BUTTONS,
    RESERVED_KEYS,
    keybinds,
    keyLabel,
    padLabel,
  } from '../utils/keybinds.svelte.js';
  import { padState, pushPadHandler } from '../utils/gamepad.svelte.js';

  // Settings: every game's keyboard keys and controller buttons, rebindable.
  // Press "+ Key" (or "+ Button") and then the key or button you want; Escape cancels.
  class ControlsSettings extends Component {
    games = GAME_CONTROLS;
    pad = padState;
    game = $state.raw(GAME_CONTROLS[0].game);
    // { game, action, kind: 'keys' | 'pad' } while waiting for a press.
    listening = $state.raw(null);

    get current() {
      // Reading overrides keeps the table in step with changes.
      void keybinds.overrides;
      const group = GAME_CONTROLS.find((g) => g.game === this.game);
      return {
        ...group,
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
      return (
        Boolean(l) &&
        l.game === this.game &&
        l.action === action &&
        l.kind === kind
      );
    }

    pickGame = (game) => {
      this.game = game;
      this.listening = null;
    };

    listen = (action, kind) => {
      this.listening = this.isListening(action, kind)
        ? null
        : { game: this.game, action, kind };
    };

    remove = (action, kind, value) =>
      keybinds.unassign(this.game, action, kind, value);
    reset = () => keybinds.reset(this.game);
    pickPadButton = (action, event) => {
      if (event.target.value)
        keybinds.assign(this.game, action, 'pad', event.target.value);
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
        if (PAD_BUTTONS.includes(button))
          keybinds.assign(l.game, l.action, 'pad', button);
        this.listening = null;
        return true;
      });
      return () => {
        window.removeEventListener('keydown', onKey, { capture: true });
        release();
      };
    });

    padButtons = PAD_BUTTONS.map((id) => ({ id, label: padLabel(id) }));
  }

  function eq(a, b) {
    return a === b;
  }
</script>

<script>
  let args = $props();
  const self = new ControlsSettings(args);
  onDestroy(() => destroy(self));
</script>

<div class="controls-settings" {@attach self.capture?.()}>
  <p class="tool-hint">
    {#if truthy(self.pad?.connected)}
      <Icon name="gamepad-2" size={13} />
      {self.pad?.connected}
      connected. Use the D-pad to move round the site, A to press, B to go back, Start
      for search.
    {:else}
      <Icon name="gamepad-2" size={13} />
      Plug in or pair a controller and press any button: it works across the whole
      site, not just the games.
    {/if}
  </p>

  <div class="math-tabs" role="tablist" aria-label="Game">
    {#each self.games ?? [] as g}
      <button
        type="button"
        role="tab"
        class="qr-tab {truthy(eq(g?.game, self.game)) ? 'active' : ''}"
        aria-selected={truthy(eq(g?.game, self.game)) ? 'true' : 'false'}
        onclick={(..._r) => self.pickGame(g?.game, ..._r)}>{g?.label}</button
      >
    {/each}
  </div>

  <div
    class="controls-table"
    role="table"
    aria-label="{self.current?.label} controls"
  >
    <div class="controls-row is-head" role="row">
      <span role="columnheader">Action</span>
      <span role="columnheader"
        ><Icon name="keyboard" size={13} />
        Keys</span
      >
      <span role="columnheader"
        ><Icon name="gamepad-2" size={13} />
        Controller</span
      >
    </div>
    {#each self.current?.actions ?? [] as a (a?.id)}
      <div class="controls-row" role="row">
        <span class="controls-action" role="cell">{a?.label}</span>
        <span class="controls-binds" role="cell">
          {#each a?.keyList ?? [] as k}
            <span class="controls-chip"
              ><kbd>{k?.label}</kbd><button
                type="button"
                class="controls-chip-remove"
                aria-label="Remove {k?.label} from {a?.label}"
                onclick={(..._r) => self.remove(a?.id, 'keys', k?.code, ..._r)}
                ><Icon name="x" size={10} /></button
              ></span
            >
          {/each}
          <button
            type="button"
            class="controls-add {truthy(a?.waitingKey) ? 'is-listening' : ''}"
            onclick={(..._r) => self.listen(a?.id, 'keys', ..._r)}
            >{truthy(a?.waitingKey) ? 'Press a key…' : '+ Key'}</button
          >
        </span>
        <span class="controls-binds" role="cell">
          {#each a?.padList ?? [] as b}
            <span class="controls-chip"
              ><kbd>{b?.label}</kbd><button
                type="button"
                class="controls-chip-remove"
                aria-label="Remove {b?.label} from {a?.label}"
                onclick={(..._r) => self.remove(a?.id, 'pad', b?.button, ..._r)}
                ><Icon name="x" size={10} /></button
              ></span
            >
          {/each}
          {#if truthy(self.pad?.connected)}
            <button
              type="button"
              class="controls-add {truthy(a?.waitingPad) ? 'is-listening' : ''}"
              onclick={(..._r) => self.listen(a?.id, 'pad', ..._r)}
              >{truthy(a?.waitingPad) ? 'Press a button…' : '+ Button'}</button
            >
          {:else}
            <select
              class="controls-select"
              aria-label="Add a controller button to {a?.label}"
              onchange={(..._r) => self.pickPadButton(a?.id, ..._r)}
            >
              <option value="">+ Button</option>
              {#each self.padButtons ?? [] as p (p?.id)}<option value={p?.id}
                  >{p?.label}</option
                >{/each}
            </select>
          {/if}
        </span>
      </div>
    {/each}
  </div>

  <p class="tool-hint"
    >A key or button does one thing per game: giving it to one action takes it
    off any other. Esc cancels while choosing.</p
  >
  <button
    type="button"
    class="btn math-use"
    disabled={truthy(self.current?.customised) ? false : true}
    onclick={self.reset}
    ><Icon name="rotate-ccw" size={13} />
    Reset
    {self.current?.label}
    controls</button
  >
</div>
