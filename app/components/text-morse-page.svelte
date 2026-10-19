<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import CopyButton from './copy-button.svelte';
  import { toMorse, fromMorse } from '../utils/ciphers.js';
  import { keepState } from '../utils/tool-state.js';

  // Morse code both ways, with the dits and dahs played out loud at the speed you pick.

  const eq = (a, b) => a === b;
  // Morse timing hangs off one unit: a dit. 20 words a minute puts a dit at 60ms.
  const unitMs = (wpm) => 1200 / Math.max(5, Math.min(40, wpm));

  class TextMorsePage extends Component {
    text = $state.raw('hello world');
    direction = $state.raw('encode'); // 'encode' | 'decode'
    wpm = $state.raw(15);
    playing = $state.raw(false);

    audio = null;
    timers = [];

    constructor(args) {
      super(args);
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
  }
</script>

<script>
  let args = $props();
  const self = new TextMorsePage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="text-morse"
  subtitle="Words to Morse code and back, with the dits and dahs played out loud so you can hear it."
>
  <div class="math-grid text-tool pop-in">
    <section class="math-card">
      <div class="math-tabs" role="group" aria-label="Direction">
        <button
          type="button"
          class="qr-tab {truthy(eq(self.direction, 'encode')) ? 'active' : ''}"
          onclick={(..._r) => self.setDirection('encode', ..._r)}
          >Words to Morse</button
        >
        <button
          type="button"
          class="qr-tab {truthy(eq(self.direction, 'decode')) ? 'active' : ''}"
          onclick={(..._r) => self.setDirection('decode', ..._r)}
          >Morse to words</button
        >
      </div>
      <label class="field-label" for="morse-text"
        >{truthy(eq(self.direction, 'encode'))
          ? 'Your words'
          : 'The Morse'}</label
      >
      <textarea
        id="morse-text"
        class="textarea text-area-tall"
        spellcheck="false"
        {@attach prop('value', () => self.text)}
        oninput={self.setText}></textarea>
      <p class="tool-hint"
        >Spaces between letters, a slash between words:
        <code>.... .. / - .... . .-. .</code></p
      >
    </section>

    <section class="math-card">
      <div class="fc-toolbar">
        <h3 class="qr-heading"
          >{truthy(eq(self.direction, 'encode')) ? 'Morse' : 'Words'}</h3
        >
        <div class="settings-actions">
          <CopyButton value={self.output} />
          {#if truthy(self.playing)}
            <button type="button" class="btn" onclick={self.stop}
              ><Icon name="square" size={13} />
              Stop</button
            >
          {:else}
            <button type="button" class="btn" onclick={self.play}
              ><Icon name="play" size={13} />
              Listen</button
            >
          {/if}
        </div>
      </div>
      <p class="cipher-output"
        >{truthy(self.output)
          ? self.output
          : 'Nothing yet. Type something on the left.'}</p
      >

      <label class="math-field">
        <span class="qr-label is-muted"
          >Speed:
          {self.wpm}
          words a minute</span
        >
        <input
          type="range"
          min="5"
          max="40"
          {@attach prop('value', () => self.wpm)}
          oninput={self.setWpm}
        />
      </label>
      <p class="tool-hint"
        >A dit is one beat, a dah is three, and the gaps are a beat between
        symbols, three between letters and seven between words: proper Morse
        timing, at 600 Hz.</p
      >
    </section>
  </div>
</ToolPage>
