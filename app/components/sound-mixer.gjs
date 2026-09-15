import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import Icon from './icon';
import { soundPrefs, sfx, SOUND_GROUPS } from '../utils/sound';

// Settings' sound mixer: the master volume, then a volume and mute for each
// kind of sound (clicks, hover, typing, each game, jingles…), with a preview.
export default class SoundMixer extends Component {
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
  setMaster = (event) => this.prefs.setVolume(Number(event.target.value) / 100);
  previewMaster = () => sfx('cards.place');

  toggleChannel = (id) => this.prefs.toggleGroupMuted(id);
  setChannel = (id, event) => this.prefs.setGroupVolume(id, Number(event.target.value) / 100);
  preview = (channel) => sfx(channel.sample, { force: true });
  reset = () => this.prefs.resetGroups();

  <template>
    <div class="sound-mixer" data-sound-mixer>
      <div class="sound-channel is-master">
        <button type="button" class="qr-icon-btn sound-channel-mute {{if this.masterSilent 'is-muted'}}" aria-pressed={{if this.masterSilent "true" "false"}} aria-label={{if this.masterSilent "Unmute all sounds" "Mute all sounds"}} {{on "click" this.toggleMaster}}>
          <Icon @name={{if this.masterSilent "volume-x" "volume-2"}} @size={{15}} />
        </button>
        <span class="sound-channel-text">
          <span class="qr-label">All sounds</span>
          <span class="tool-hint">The master volume; every channel below is a share of it.</span>
        </span>
        <input type="range" min="0" max="100" step="5" value={{this.masterPercent}} aria-label="Master volume" aria-valuetext="{{this.masterPercent}}%" {{on "input" this.setMaster}} {{on "change" this.previewMaster}} />
        <span class="volume-value">{{if this.masterSilent "Off" (percentText this.masterPercent)}}</span>
      </div>

      <ul class="sound-channels {{if this.masterSilent 'is-dim'}}">
        {{#each this.channels key="id" as |c|}}
          <li class="sound-channel {{if c.silent 'is-silent'}}">
            <button type="button" class="qr-icon-btn sound-channel-mute {{if c.silent 'is-muted'}}" aria-pressed={{if c.silent "true" "false"}} aria-label="{{if c.silent 'Unmute' 'Mute'}} {{c.label}}" title="{{if c.silent 'Unmute' 'Mute'}} {{c.label}}" {{on "click" (fn this.toggleChannel c.id)}}>
              <Icon @name={{if c.silent "volume-x" c.icon}} @size={{14}} />
            </button>
            <span class="sound-channel-text">
              <span class="qr-label">{{c.label}}</span>
              <span class="tool-hint">{{c.hint}}</span>
            </span>
            <input type="range" min="0" max="100" step="5" value={{c.percent}} aria-label="{{c.label}} volume" aria-valuetext="{{c.percent}}%" {{on "input" (fn this.setChannel c.id)}} {{on "change" (fn this.preview c)}} />
            <span class="volume-value">{{if c.silent "Off" (percentText c.percent)}}</span>
            <button type="button" class="qr-icon-btn" aria-label="Play a sample of {{c.label}}" title="Play a sample" {{on "click" (fn this.preview c)}}>
              <Icon @name="play" @size={{12}} />
            </button>
          </li>
        {{/each}}
      </ul>

      <button type="button" class="btn math-use sound-mixer-reset" disabled={{if this.prefs.customised false true}} {{on "click" this.reset}}>
        <Icon @name="rotate-ccw" @size={{13}} /> Reset channels
      </button>
    </div>
  </template>
}

function percentText(value) {
  return `${value}%`;
}
