<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { modifier } from '../core/modifier.js';
  import Link from '../core/link.svelte';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import { openSettingsTab } from './settings-page.svelte';
  import Icon from './icon.svelte';
  import { soundPrefs, sfx } from '../utils/sound.svelte.js';

  // The speaker button next to the theme toggle: opens a little panel with the
  // site's volume slider and mute switch.
  class VolumeButton extends Component {
    prefs = soundPrefs;
    open = $state.raw(false);

    get silent() {
      return this.prefs.muted || this.prefs.volume === 0;
    }

    get percent() {
      return Math.round(this.prefs.volume * 100);
    }

    get icon() {
      return this.silent ? 'volume-x' : 'volume-2';
    }

    toggleOpen = () => (this.open = !this.open);
    toggleMute = () => this.prefs.toggleMuted();
    setVolume = (event) =>
      this.prefs.setVolume(Number(event.target.value) / 100);
    // A sample on release, so you can hear the new level.
    preview = () => sfx('cards.place');

    // To the mixer in Settings, scrolled into view once the page has rendered.
    openMixer = () => {
      this.open = false;
      openSettingsTab('sound');
    };

    // Closes when you click anywhere else or press Escape.
    dismiss = modifier((element) => {
      const onDown = (event) => {
        if (!element.contains(event.target)) this.open = false;
      };
      const onKey = (event) => {
        if (event.key === 'Escape') this.open = false;
      };
      document.addEventListener('pointerdown', onDown);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('pointerdown', onDown);
        document.removeEventListener('keydown', onKey);
      };
    });
  }

  function concat(...parts) {
    return parts.join('');
  }
</script>

<script>
  let args = $props();
  const self = new VolumeButton(args);
  onDestroy(() => destroy(self));
</script>

<div class="volume-button" {@attach self.dismiss?.()}>
  <button
    type="button"
    class="theme-toggle {truthy(self.silent) ? 'is-muted' : ''}"
    aria-label="Sound: {truthy(self.silent) ? 'muted' : concat(self.percent)}"
    aria-expanded={truthy(self.open) ? 'true' : 'false'}
    title="Sound"
    onclick={self.toggleOpen}
  >
    <Icon name={self.icon} size={15} />
  </button>
  {#if truthy(self.open)}
    <div class="volume-panel pop-in" role="dialog" aria-label="Sound">
      <button
        type="button"
        class="qr-icon-btn"
        aria-pressed={truthy(self.silent) ? 'true' : 'false'}
        aria-label={truthy(self.silent) ? 'Unmute' : 'Mute'}
        onclick={self.toggleMute}
      >
        <Icon name={self.icon} size={14} />
      </button>
      <input
        type="range"
        min="0"
        max="100"
        step="5"
        {@attach prop('value', () => self.percent)}
        aria-label="Volume"
        aria-valuetext="{self.percent}%"
        onchange={self.preview}
        oninput={self.setVolume}
      />
      <span class="volume-value"
        >{truthy(self.silent) ? 'Off' : concat(self.percent, '%')}</span
      >
      <Link
        route="settings"
        class="qr-icon-btn"
        aria-label="More sound settings"
        title="Sound mixer: pick which sounds to turn down"
        onclick={self.openMixer}
      >
        <Icon name="sliders-vertical" size={14} />
      </Link>
    </div>
  {/if}
</div>
