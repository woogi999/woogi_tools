import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import { LinkTo } from '@ember/routing';
import Icon from './icon';
import { soundPrefs, sfx } from '../utils/sound';

// The speaker button next to the theme toggle: opens a little panel with the
// site's volume slider and mute switch.
export default class VolumeButton extends Component {
  prefs = soundPrefs;
  @tracked open = false;

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
  setVolume = (event) => this.prefs.setVolume(Number(event.target.value) / 100);
  // A sample on release, so you can hear the new level.
  preview = () => sfx('cards.place');

  // To the mixer in Settings, scrolled into view once the page has rendered.
  openMixer = () => {
    this.open = false;
    setTimeout(() => document.getElementById('sound')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 120);
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

  <template>
    <div class="volume-button" {{this.dismiss}}>
      <button type="button" class="theme-toggle {{if this.silent 'is-muted'}}" aria-label="Sound: {{if this.silent 'muted' (concat this.percent)}}" aria-expanded={{if this.open "true" "false"}} title="Sound" {{on "click" this.toggleOpen}}>
        <Icon @name={{this.icon}} @size={{15}} />
      </button>
      {{#if this.open}}
        <div class="volume-panel pop-in" role="dialog" aria-label="Sound">
          <button type="button" class="qr-icon-btn" aria-pressed={{if this.silent "true" "false"}} aria-label={{if this.silent "Unmute" "Mute"}} {{on "click" this.toggleMute}}>
            <Icon @name={{this.icon}} @size={{14}} />
          </button>
          <input type="range" min="0" max="100" step="5" value={{this.percent}} aria-label="Volume" aria-valuetext="{{this.percent}}%" {{on "input" this.setVolume}} {{on "change" this.preview}} />
          <span class="volume-value">{{if this.silent "Off" (concat this.percent "%")}}</span>
          <LinkTo @route="settings" class="qr-icon-btn" aria-label="More sound settings" title="Sound mixer: pick which sounds to turn down" {{on "click" this.openMixer}}>
            <Icon @name="sliders-vertical" @size={{14}} />
          </LinkTo>
        </div>
      {{/if}}
    </div>
  </template>
}

function concat(...parts) {
  return parts.join('');
}
