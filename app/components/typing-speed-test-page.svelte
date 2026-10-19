<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import { keepState } from '../utils/tool-state.js';
  import { sfx } from '../utils/sound.svelte.js';
  import {
    MODES,
    WORD_COUNTS,
    DURATIONS,
    randomWords,
    randomQuote,
    score,
  } from '../utils/typing.js';

  const eq = (a, b) => a === b;

  // How many past runs the history chart keeps.
  const HISTORY = 20;

  class TypingSpeedTestPage extends Component {
    mode = $state.raw('words');
    wordCount = $state.raw(25);
    duration = $state.raw(30);
    target = $state.raw('');
    typed = $state.raw('');
    startedAt = $state.raw(null);
    now = $state.raw(0);
    result = $state.raw(null);
    history = $state.raw([]);
    bestWpm = $state.raw(0);
    focused = $state.raw(false);

    // Per-second WPM samples for the graph shown at the end.
    samples = [];
    ticker = null;
    input = null;
    // Every character actually typed and how many of those were wrong,
    // counted as they happen so backspacing over a mistake and retyping it
    // correctly doesn't erase the fact that it happened.
    keystrokes = 0;
    mistakes = 0;

    constructor(args) {
      super(args);
      keepState(
        this,
        'typing-speed-test',
        ['mode', 'wordCount', 'duration', 'history', 'bestWpm'],
        () => this.reset(),
      );
      this.reset();
      registerDestructor(this, () => clearInterval(this.ticker));
    }

    get modes() {
      return MODES;
    }
    get wordCounts() {
      return WORD_COUNTS;
    }
    get durations() {
      return DURATIONS;
    }
    get isWords() {
      return this.mode === 'words';
    }
    get isTime() {
      return this.mode === 'time';
    }
    get running() {
      return this.startedAt !== null && !this.result;
    }

    get seconds() {
      if (this.startedAt === null) return 0;
      return (this.now - this.startedAt) / 1000;
    }

    // Counts down in time mode, up otherwise.
    get clock() {
      const s = this.isTime
        ? Math.max(0, Math.ceil(this.duration - this.seconds))
        : Math.floor(this.seconds);
      return `${s}s`;
    }

    get live() {
      return score({
        typed: this.typed,
        target: this.target,
        seconds: this.seconds,
        keystrokes: this.keystrokes,
        mistakes: this.mistakes,
      });
    }

    // Every character of the target with its state, grouped into words so
    // the line wraps between words and not in the middle of one. Cached so
    // it only rebuilds when what's typed or the target text actually
    // changes, not on every clock tick: without this the whole word list
    // (and every DOM node under it) was rebuilt ten times a second while a
    // run was going, which is what made typing feel laggy and the blur
    // flicker.
    words = $derived.by(() => {
      const typed = this.typed;
      const words = [];
      let word = [];
      let index = 0;
      for (const char of this.target) {
        const at = index++;
        let state = 'todo';
        if (at < typed.length) state = typed[at] === char ? 'ok' : 'bad';
        else if (at === typed.length) state = 'cursor';
        word.push({ char, state, key: at });
        if (char === ' ') {
          words.push(word);
          word = [];
        }
      }
      if (word.length) words.push(word);
      // Anything typed past the end shows as extra errors.
      if (typed.length > this.target.length) {
        const extra = [...typed.slice(this.target.length)].map((char, i) => ({
          char,
          state: 'bad',
          key: this.target.length + i,
        }));
        words.push(extra);
      }
      return words;
    });

    get hasHistory() {
      return this.history.length > 0;
    }

    // Points for the little history sparkline (newest on the right).
    get historyPath() {
      const runs = this.history;
      if (runs.length < 2) return '';
      const max = Math.max(...runs.map((r) => r.wpm), 1);
      return runs
        .map((r, i) => {
          const x = (i / (runs.length - 1)) * 100;
          const y = 100 - (r.wpm / max) * 90;
          return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
    }

    get samplePath() {
      const list = this.samples;
      if (list.length < 2) return '';
      const max = Math.max(...list, 1);
      return list
        .map((v, i) => {
          const x = (i / (list.length - 1)) * 100;
          const y = 100 - (v / max) * 90;
          return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
    }

    bindInput = modifier((element) => {
      this.input = element;
      return () => (this.input = null);
    });

    reset = () => {
      clearInterval(this.ticker);
      this.ticker = null;
      this.samples = [];
      this.keystrokes = 0;
      this.mistakes = 0;
      this.typed = '';
      this.startedAt = null;
      this.now = 0;
      this.result = null;
      if (this.mode === 'quote') this.target = randomQuote();
      else if (this.mode === 'time') this.target = randomWords(400).join(' ');
      else this.target = randomWords(this.wordCount).join(' ');
      this.input?.focus();
    };

    setMode = (id) => {
      this.mode = id;
      this.reset();
    };
    setWordCount = (n) => {
      this.wordCount = n;
      this.reset();
    };
    setDuration = (n) => {
      this.duration = n;
      this.reset();
    };

    focus = () => this.input?.focus();
    onFocus = () => (this.focused = true);
    onBlur = () => (this.focused = false);

    onInput = (event) => {
      if (this.result) return;
      const value = event.target.value;
      if (this.startedAt === null && value.length) this.start();
      // A key thock for every keystroke, a duller one for a wrong letter.
      // Everything typed past the old length counts toward accuracy, even a
      // pasted or autocompleted run of several characters at once.
      if (value.length < this.typed.length) sfx('ui.type');
      else if (value.length > this.typed.length) {
        let anyWrong = false;
        for (let at = this.typed.length; at < value.length; at++) {
          this.keystrokes++;
          if (this.target[at] !== value[at]) {
            this.mistakes++;
            anyWrong = true;
          }
        }
        sfx(anyWrong ? 'ui.tick' : 'ui.type');
      }
      this.typed = value;
      if (!this.isTime && value.length >= this.target.length) this.finish();
    };

    // Tab restarts, like the popular typing sites.
    onKeyDown = (event) => {
      if (event.key === 'Tab') {
        event.preventDefault();
        this.reset();
      }
    };

    start() {
      this.startedAt = performance.now();
      this.now = this.startedAt;
      this.ticker = setInterval(() => {
        this.now = performance.now();
        const second = Math.floor(this.seconds);
        if (second > 0 && second > this.samples.length)
          this.samples.push(this.live.wpm);
        if (this.isTime && this.seconds >= this.duration) this.finish();
      }, 50);
    }

    finish() {
      if (this.result) return;
      clearInterval(this.ticker);
      this.ticker = null;
      this.now = performance.now();
      // Always score against the real elapsed time, not the nominal test
      // length: the timer is only checked every tick, so a time-mode run
      // typically runs a little past the target duration before it's
      // caught, and a few extra characters typed in that overrun were
      // inflating WPM when it was divided by the shorter nominal duration
      // instead.
      const seconds = this.seconds;
      const result = score({
        typed: this.typed,
        target: this.target,
        seconds,
        keystrokes: this.keystrokes,
        mistakes: this.mistakes,
      });
      this.result = { ...result, seconds: Math.round(seconds * 10) / 10 };
      this.samples = [...this.samples, result.wpm];
      this.history = [
        ...this.history,
        { wpm: result.wpm, accuracy: result.accuracy },
      ].slice(-HISTORY);
      if (result.wpm > this.bestWpm) this.bestWpm = result.wpm;
    }

    clearHistory = () => {
      this.history = [];
      this.bestWpm = 0;
    };
  }
</script>

<script>
  let args = $props();
  const self = new TypingSpeedTestPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="typing-speed-test"
  subtitle="How fast do you type? Words, a timed run or a quote; your speed and accuracy show as you go."
>
  <div class="tt-shell pop-in">
    <div class="tt-bar">
      <div class="mode-toggle" role="group" aria-label="Test mode">
        {#each self.modes ?? [] as m}
          <button
            type="button"
            class="btn {truthy(eq(self.mode, m?.id)) ? 'active' : ''}"
            onclick={(..._r) => self.setMode(m?.id, ..._r)}>{m?.label}</button
          >
        {/each}
      </div>
      {#if truthy(self.isWords)}
        <div class="mode-toggle" role="group" aria-label="Word count">
          {#each self.wordCounts ?? [] as n}
            <button
              type="button"
              class="btn {truthy(eq(self.wordCount, n)) ? 'active' : ''}"
              onclick={(..._r) => self.setWordCount(n, ..._r)}>{n}</button
            >
          {/each}
        </div>
      {:else if truthy(self.isTime)}
        <div class="mode-toggle" role="group" aria-label="Duration">
          {#each self.durations ?? [] as n}
            <button
              type="button"
              class="btn {truthy(eq(self.duration, n)) ? 'active' : ''}"
              onclick={(..._r) => self.setDuration(n, ..._r)}>{n}s</button
            >
          {/each}
        </div>
      {/if}
      <div class="tt-live">
        <span class="tt-clock">{self.clock}</span>
        <span><strong>{self.live?.wpm}</strong> wpm</span>
        <span><strong>{self.live?.accuracy}%</strong> acc</span>
      </div>
    </div>

    {#if truthy(self.result)}
      <div class="tt-result">
        <div class="math-stats">
          <div class="math-stat"
            ><span>Speed</span><strong
              >{self.result?.wpm}
              wpm</strong
            ></div
          >
          <div class="math-stat"
            ><span>Raw</span><strong
              >{self.result?.raw}
              wpm</strong
            ></div
          >
          <div class="math-stat"
            ><span>Accuracy</span><strong>{self.result?.accuracy}%</strong></div
          >
          <div class="math-stat"
            ><span>Characters</span><strong
              >{self.result?.correct}
              /
              {self.result?.errors}</strong
            ></div
          >
          <div class="math-stat"
            ><span>Time</span><strong>{self.result?.seconds}s</strong></div
          >
          <div class="math-stat"
            ><span>Best</span><strong
              >{self.bestWpm}
              wpm</strong
            ></div
          >
        </div>
        {#if truthy(self.samplePath)}
          <svg
            class="tt-graph"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-label="Speed over the run"
          >
            <path d={self.samplePath}></path>
          </svg>
        {/if}
        <div class="tool-controls">
          <button type="button" class="btn" onclick={self.reset}>
            <Icon name="refresh-cw" size={14} />
            Again
          </button>
          <span class="tool-hint">Tab also restarts.</span>
        </div>
      </div>
    {:else}
      <!-- template-lint-disable no-invalid-interactive -->
      <div
        class="tt-text {truthy(self.focused) ? 'is-focused' : ''}"
        onclick={self.focus}
      >
        {#each self.words ?? [] as word}
          <span class="tt-word"
            >{#each word ?? [] as c}<span class="tt-char is-{c?.state}"
                >{c?.char}</span
              >{/each}</span
          >
        {/each}
        {#if !truthy(self.focused)}
          <div class="tt-focus-hint">Click here or start typing</div>
        {/if}
      </div>
      <input
        type="text"
        class="tt-input"
        aria-label="Type the text above"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        {@attach prop('value', () => self.typed)}
        onblur={self.onBlur}
        onfocus={self.onFocus}
        onkeydown={self.onKeyDown}
        oninput={self.onInput}
        {@attach self.bindInput?.()}
      />
      <div class="tool-controls">
        <button type="button" class="btn" onclick={self.reset}>
          <Icon name="refresh-cw" size={14} />
          New text
        </button>
        <span class="tool-hint"
          >A word is five characters. Mistakes count against your speed; go back
          and fix them if you like.</span
        >
      </div>
    {/if}

    {#if truthy(self.hasHistory)}
      <div class="tt-history">
        <div class="field-head">
          <span class="field-label"
            >Your last
            {self.history?.length}
            runs (best
            {self.bestWpm}
            wpm)</span
          >
          <button type="button" class="btn" onclick={self.clearHistory}>
            Clear
          </button>
        </div>
        {#if truthy(self.historyPath)}
          <svg
            class="tt-graph"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-label="Speed across past runs"
          >
            <path d={self.historyPath}></path>
          </svg>
        {/if}
      </div>
    {/if}
  </div>
</ToolPage>
