<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import Link from '../core/link.svelte';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import Icon from './icon.svelte';
  import { soundPrefs, sfx, SOUND_GROUPS } from '../utils/sound.svelte.js';
  import {
    GAME_CONTROLS,
    PAD_BUTTONS,
    RESERVED_KEYS,
    keybinds,
    keyLabel,
    padLabel,
  } from '../utils/keybinds.svelte.js';
  import { padState, pushPadHandler } from '../utils/gamepad.svelte.js';

  // The settings button a game carries with it: in its lobby before you start,
  // and in the corner of the board once you have. It opens a real modal (the top
  // layer, so it shows over a fullscreen game) with the two things worth changing
  // mid-match: this game's volume, and this game's controls.
  //
  // Everything here writes to the same saved preferences as site Settings, so a
  // volume or a rebound key set from a game stays set the next time you play it.
  //
  // Args: @game is 'snake', 'mines', 'chess' or 'woono'. @compact for the icon-only
  // button used in a game's corner overlay.

  // The channels that play over the top of any game, after the game's own.
  const SHARED_CHANNELS = ['music', 'alerts'];

  const eq = (a, b) => a === b;

  class GameSettings extends Component {
    open = $state.raw(false);
    tab = $state.raw('sound');
    // { action, kind: 'keys' | 'pad' } while waiting for a press.
    listening = $state.raw(null);

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
    setMaster = (event) =>
      this.prefs.setVolume(Number(event.target.value) / 100);
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
  }

  function percentText(value) {
    return `${value}%`;
  }
</script>

<script>
  let args = $props();
  const self = new GameSettings(args);
  onDestroy(() => destroy(self));
</script>

{#if truthy(args.compact)}
  <button
    type="button"
    class="qr-icon-btn game-settings-btn"
    aria-label="{self.label} settings"
    title="{self.label} settings"
    onclick={self.show}><Icon name="settings" size={15} /></button
  >
{:else}
  <button
    type="button"
    class="btn"
    aria-label="{self.label} settings"
    onclick={self.show}><Icon name="settings" size={13} /> Settings</button
  >
{/if}

{#if truthy(self.open)}
  <dialog
    class="game-settings-modal"
    aria-label="{self.label} settings"
    {@attach self.dialog?.()}
  >
    <div class="game-settings-body">
      <header class="game-settings-head">
        <h2 class="game-settings-name">{self.label} settings</h2>
        <button
          type="button"
          class="qr-icon-btn"
          aria-label="Close settings"
          onclick={self.close}><Icon name="x" size={15} /></button
        >
      </header>

      <div class="math-tabs" role="tablist" aria-label="Settings section">
        <button
          type="button"
          role="tab"
          class="qr-tab {truthy(eq(self.tab, 'sound')) ? 'active' : ''}"
          aria-selected={truthy(eq(self.tab, 'sound')) ? 'true' : 'false'}
          onclick={(..._r) => self.setTab('sound', ..._r)}>Sound</button
        >
        {#if truthy(self.controls)}
          <button
            type="button"
            role="tab"
            class="qr-tab {truthy(eq(self.tab, 'controls')) ? 'active' : ''}"
            aria-selected={truthy(eq(self.tab, 'controls')) ? 'true' : 'false'}
            onclick={(..._r) => self.setTab('controls', ..._r)}>Controls</button
          >
        {/if}
      </div>

      {#if truthy(eq(self.tab, 'sound'))}
        <div class="game-settings-pane">
          <div class="sound-channel is-master">
            <button
              type="button"
              class="qr-icon-btn sound-channel-mute
                    {truthy(self.masterSilent) ? 'is-muted' : ''}"
              aria-pressed={truthy(self.masterSilent) ? 'true' : 'false'}
              aria-label={truthy(self.masterSilent)
                ? 'Unmute all sounds'
                : 'Mute all sounds'}
              onclick={self.toggleMaster}
              ><Icon
                name={truthy(self.masterSilent) ? 'volume-x' : 'volume-2'}
                size={14}
              /></button
            >
            <span class="sound-channel-text">
              <span class="qr-label">All sounds</span>
              <span class="tool-hint"
                >Every channel below is a share of this.</span
              >
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              {@attach prop('value', () => self.masterPercent)}
              aria-label="Master volume"
              aria-valuetext="{self.masterPercent}%"
              oninput={self.setMaster}
            />
            <span class="volume-value"
              >{truthy(self.masterSilent)
                ? 'Off'
                : percentText(self.masterPercent)}</span
            >
          </div>

          <ul
            class="sound-channels {truthy(self.masterSilent) ? 'is-dim' : ''}"
          >
            {#each self.channels ?? [] as c (c?.id)}
              <li class="sound-channel {truthy(c?.silent) ? 'is-silent' : ''}">
                <button
                  type="button"
                  class="qr-icon-btn sound-channel-mute
                        {truthy(c?.silent) ? 'is-muted' : ''}"
                  aria-pressed={truthy(c?.silent) ? 'true' : 'false'}
                  aria-label="{truthy(c?.silent)
                    ? 'Unmute'
                    : 'Mute'} {c?.label}"
                  title="{truthy(c?.silent) ? 'Unmute' : 'Mute'} {c?.label}"
                  onclick={(..._r) => self.toggleChannel(c?.id, ..._r)}
                  ><Icon
                    name={truthy(c?.silent) ? 'volume-x' : c?.icon}
                    size={13}
                  /></button
                >
                <span class="sound-channel-text">
                  <span class="qr-label">{c?.label}</span>
                  <span class="tool-hint">{c?.hint}</span>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  {@attach prop('value', () => c?.percent)}
                  aria-label="{c?.label} volume"
                  aria-valuetext="{c?.percent}%"
                  onchange={(..._r) => self.preview(c, ..._r)}
                  oninput={(..._r) => self.setChannel(c?.id, ..._r)}
                />
                <span class="volume-value"
                  >{truthy(c?.silent) ? 'Off' : percentText(c?.percent)}</span
                >
                <button
                  type="button"
                  class="qr-icon-btn"
                  aria-label="Play a sample of {c?.label}"
                  title="Play a sample"
                  onclick={(..._r) => self.preview(c, ..._r)}
                  ><Icon name="play" size={12} /></button
                >
              </li>
            {/each}
          </ul>
        </div>
      {:else if truthy(self.controls)}
        <div class="game-settings-pane">
          <p class="tool-hint">
            {#if truthy(self.pad?.connected)}
              <Icon name="gamepad-2" size={13} />
              {self.pad?.connected}
              connected.
            {:else}
              <Icon name="gamepad-2" size={13} />
              Plug in or pair a controller and press any button to use one.
            {/if}
          </p>

          <div
            class="controls-table"
            role="table"
            aria-label="{self.label} controls"
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
            {#each self.controls?.actions ?? [] as a (a?.id)}
              <div class="controls-row" role="row">
                <span class="controls-action" role="cell">{a?.label}</span>
                <span class="controls-binds" role="cell">
                  {#each a?.keyList ?? [] as k}
                    <span class="controls-chip"
                      ><kbd>{k?.label}</kbd><button
                        type="button"
                        class="controls-chip-remove"
                        aria-label="Remove {k?.label} from {a?.label}"
                        onclick={(..._r) =>
                          self.remove(a?.id, 'keys', k?.code, ..._r)}
                        ><Icon name="x" size={10} /></button
                      ></span
                    >
                  {/each}
                  <button
                    type="button"
                    class="controls-add {truthy(a?.waitingKey)
                      ? 'is-listening'
                      : ''}"
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
                        onclick={(..._r) =>
                          self.remove(a?.id, 'pad', b?.button, ..._r)}
                        ><Icon name="x" size={10} /></button
                      ></span
                    >
                  {/each}
                  {#if truthy(self.pad?.connected)}
                    <button
                      type="button"
                      class="controls-add
                            {truthy(a?.waitingPad) ? 'is-listening' : ''}"
                      onclick={(..._r) => self.listen(a?.id, 'pad', ..._r)}
                      >{truthy(a?.waitingPad)
                        ? 'Press a button…'
                        : '+ Button'}</button
                    >
                  {:else}
                    <select
                      class="controls-select"
                      aria-label="Add a controller button to {a?.label}"
                      onchange={(..._r) => self.pickPadButton(a?.id, ..._r)}
                    >
                      <option value="">+ Button</option>
                      {#each self.padButtons ?? [] as p (p?.id)}<option
                          value={p?.id}>{p?.label}</option
                        >{/each}
                    </select>
                  {/if}
                </span>
              </div>
            {/each}
          </div>

          <p class="tool-hint"
            >A key or button does one thing per game: giving it to one action
            takes it off any other. Esc cancels while choosing.</p
          >
          <button
            type="button"
            class="btn"
            disabled={truthy(self.controls?.customised) ? false : true}
            onclick={self.resetControls}
            ><Icon name="rotate-ccw" size={13} />
            Reset
            {self.label}
            controls</button
          >
        </div>
      {/if}

      <footer class="game-settings-foot">
        <Link route="settings" class="lt-link"
          ><Icon name="sliders-horizontal" size={12} />
          All settings</Link
        >
        <button type="button" class="btn" onclick={self.close}>Done</button>
      </footer>
    </div>
  </dialog>
{/if}
