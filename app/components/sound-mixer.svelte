<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import Icon from './icon.svelte';
  import { soundPrefs, sfx, SOUND_GROUPS } from '../utils/sound.svelte.js';

  // Settings' sound mixer: the master volume, then a volume and mute for each
  // kind of sound (clicks, hover, typing, each game, jingles…), with a preview.
  class SoundMixer extends Component {
    prefs = soundPrefs;

    get masterSilent() {
      return this.prefs.muted || this.prefs.volume === 0;
    }

    get masterPercent() {
      return Math.round(this.prefs.volume * 100);
    }

    get channels() {
      // Reading prefs.groups keeps this in step with changes.
      const groups = this.prefs.groups;
      return SOUND_GROUPS.map((g) => {
        const state = groups[g.id] ?? { volume: 1, muted: false };
        const percent = Math.round(state.volume * 100);
        return { ...g, percent, silent: state.muted || state.volume === 0 };
      });
    }

    toggleMaster = () => this.prefs.toggleMuted();
    setMaster = (event) =>
      this.prefs.setVolume(Number(event.target.value) / 100);
    previewMaster = () => sfx('cards.place');

    toggleChannel = (id) => this.prefs.toggleGroupMuted(id);
    setChannel = (id, event) =>
      this.prefs.setGroupVolume(id, Number(event.target.value) / 100);
    preview = (channel) => sfx(channel.sample, { force: true });
    reset = () => this.prefs.resetGroups();
  }

  function percentText(value) {
    return `${value}%`;
  }
</script>

<script>
  let args = $props();
  const self = new SoundMixer(args);
  onDestroy(() => destroy(self));
</script>

<div class="sound-mixer" data-sound-mixer>
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
    >
      <Icon
        name={truthy(self.masterSilent) ? 'volume-x' : 'volume-2'}
        size={15}
      />
    </button>
    <span class="sound-channel-text">
      <span class="qr-label">All sounds</span>
      <span class="tool-hint"
        >The master volume; every channel below is a share of it.</span
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
      onchange={self.previewMaster}
      oninput={self.setMaster}
    />
    <span class="volume-value"
      >{truthy(self.masterSilent)
        ? 'Off'
        : percentText(self.masterPercent)}</span
    >
  </div>

  <ul class="sound-channels {truthy(self.masterSilent) ? 'is-dim' : ''}">
    {#each self.channels ?? [] as c (c?.id)}
      <li class="sound-channel {truthy(c?.silent) ? 'is-silent' : ''}">
        <button
          type="button"
          class="qr-icon-btn sound-channel-mute {truthy(c?.silent)
            ? 'is-muted'
            : ''}"
          aria-pressed={truthy(c?.silent) ? 'true' : 'false'}
          aria-label="{truthy(c?.silent) ? 'Unmute' : 'Mute'} {c?.label}"
          title="{truthy(c?.silent) ? 'Unmute' : 'Mute'} {c?.label}"
          onclick={(..._r) => self.toggleChannel(c?.id, ..._r)}
        >
          <Icon name={truthy(c?.silent) ? 'volume-x' : c?.icon} size={14} />
        </button>
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
        >
          <Icon name="play" size={12} />
        </button>
      </li>
    {/each}
  </ul>

  <button
    type="button"
    class="btn math-use sound-mixer-reset"
    disabled={truthy(self.prefs?.customised) ? false : true}
    onclick={self.reset}
  >
    <Icon name="rotate-ccw" size={13} />
    Reset channels
  </button>
</div>
