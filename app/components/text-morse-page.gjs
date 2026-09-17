import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { toMorse, fromMorse } from '../utils/ciphers';
import { keepState } from '../utils/tool-state';

// Morse code both ways, with the dits and dahs played out loud at the speed you pick.

const eq = (a, b) => a === b;
// Morse timing hangs off one unit: a dit. 20 words a minute puts a dit at 60ms.
const unitMs = (wpm) => 1200 / Math.max(5, Math.min(40, wpm));

export default class TextMorsePage extends Component {
  @tracked text = 'hello world';
  @tracked direction = 'encode'; // 'encode' | 'decode'
  @tracked wpm = 15;
  @tracked playing = false;

  audio = null;
  timers = [];

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'text-morse', ['text', 'direction', 'wpm']);
    registerDestructor(this, () => this.stop());
  }

  get output() {
    if (!this.text.trim()) return '';
    return this.direction === 'encode'
      ? toMorse(this.text)
      : fromMorse(this.text);
  }

  // What gets played: the morse, whichever side it's on.
  get morse() {
    return this.direction === 'encode' ? this.output : this.text;
  }

  setText = (event) => (this.text = event.target.value);
  setDirection = (direction) => {
    // Swapping sides carries the result over, which is nearly always what you want.
    const out = this.output;
    this.direction = direction;
    if (out) this.text = out;
  };
  setWpm = (event) => (this.wpm = Number(event.target.value) || 15);

  stop = () => {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    this.audio?.close?.();
    this.audio = null;
    this.playing = false;
  };

  // Each dit or dah is its own little beep, scheduled up front on the audio clock.
  play = () => {
    this.stop();
    const morse = this.morse.trim();
    if (!morse) return;
    const ctx = new (window.AudioContext ?? window.webkitAudioContext)();
    this.audio = ctx;
    this.playing = true;
    const unit = unitMs(this.wpm) / 1000;
    let at = ctx.currentTime + 0.1;
    for (const symbol of morse) {
      if (symbol === '.' || symbol === '-') {
        const length = (symbol === '.' ? 1 : 3) * unit;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 600;
        osc.type = 'sine';
        // A tiny fade each end keeps it from clicking.
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.25, at + 0.005);
        gain.gain.setValueAtTime(0.25, at + length - 0.005);
        gain.gain.linearRampToValueAtTime(0, at + length);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + length);
        at += length + unit;
      } else if (symbol === ' ') {
        at += unit * 2;
      } else if (symbol === '/') {
        at += unit * 4;
      }
    }
    this.timers.push(
      setTimeout(() => this.stop(), (at - ctx.currentTime + 0.2) * 1000),
    );
  };

  <template>
    <ToolPage
      @route="text-morse"
      @subtitle="Words to Morse code and back, with the dits and dahs played out loud so you can hear it."
    >
      <div class="math-grid text-tool pop-in">
        <section class="math-card">
          <div class="math-tabs" role="group" aria-label="Direction">
            <button
              type="button"
              class="qr-tab {{if (eq this.direction 'encode') 'active'}}"
              {{on "click" (fn this.setDirection "encode")}}
            >Words to Morse</button>
            <button
              type="button"
              class="qr-tab {{if (eq this.direction 'decode') 'active'}}"
              {{on "click" (fn this.setDirection "decode")}}
            >Morse to words</button>
          </div>
          <label class="field-label" for="morse-text">{{if
              (eq this.direction "encode")
              "Your words"
              "The Morse"
            }}</label>
          <textarea
            id="morse-text"
            class="textarea text-area-tall"
            spellcheck="false"
            value={{this.text}}
            {{on "input" this.setText}}
          ></textarea>
          <p class="tool-hint">Spaces between letters, a slash between words:
            <code>.... .. / - .... . .-. .</code></p>
        </section>

        <section class="math-card">
          <div class="fc-toolbar">
            <h3 class="qr-heading">{{if
                (eq this.direction "encode")
                "Morse"
                "Words"
              }}</h3>
            <div class="settings-actions">
              <CopyButton @value={{this.output}} />
              {{#if this.playing}}
                <button type="button" class="btn" {{on "click" this.stop}}><Icon
                    @name="square"
                    @size={{13}}
                  />
                  Stop</button>
              {{else}}
                <button type="button" class="btn" {{on "click" this.play}}><Icon
                    @name="play"
                    @size={{13}}
                  />
                  Listen</button>
              {{/if}}
            </div>
          </div>
          <p class="cipher-output">{{if
              this.output
              this.output
              "Nothing yet. Type something on the left."
            }}</p>

          <label class="math-field">
            <span class="qr-label is-muted">Speed:
              {{this.wpm}}
              words a minute</span>
            <input
              type="range"
              min="5"
              max="40"
              value={{this.wpm}}
              {{on "input" this.setWpm}}
            />
          </label>
          <p class="tool-hint">A dit is one beat, a dah is three, and the gaps
            are a beat between symbols, three between letters and seven between
            words: proper Morse timing, at 600 Hz.</p>
        </section>
      </div>
    </ToolPage>
  </template>
}
