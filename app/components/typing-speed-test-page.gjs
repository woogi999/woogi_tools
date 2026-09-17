import Component from '@glimmer/component';
import { tracked, cached } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';
import { keepState } from '../utils/tool-state';
import {
  MODES,
  WORD_COUNTS,
  DURATIONS,
  randomWords,
  randomQuote,
  score,
} from '../utils/typing';

const eq = (a, b) => a === b;

// How many past runs the history chart keeps.
const HISTORY = 20;

export default class TypingSpeedTestPage extends Component {
  @tracked mode = 'words';
  @tracked wordCount = 25;
  @tracked duration = 30;
  @tracked target = '';
  @tracked typed = '';
  @tracked startedAt = null;
  @tracked now = 0;
  @tracked result = null;
  @tracked history = [];
  @tracked bestWpm = 0;
  @tracked focused = false;

  // Per-second WPM samples for the graph shown at the end.
  samples = [];
  ticker = null;
  input = null;

  constructor(owner, args) {
    super(owner, args);
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
    });
  }

  // Every character of the target with its state, grouped into words so
  // the line wraps between words and not in the middle of one. Cached so
  // it only rebuilds when what's typed or the target text actually
  // changes, not on every clock tick: without this the whole word list
  // (and every DOM node under it) was rebuilt ten times a second while a
  // run was going, which is what made typing feel laggy and the blur
  // flicker.
  @cached
  get words() {
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
  }

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
    const result = score({ typed: this.typed, target: this.target, seconds });
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

  <template>
    <ToolPage
      @route="typing-speed-test"
      @subtitle="How fast do you type? Words, a timed run or a quote; your speed and accuracy show as you go."
    >
      <div class="tt-shell pop-in">
        <div class="tt-bar">
          <div class="mode-toggle" role="group" aria-label="Test mode">
            {{#each this.modes as |m|}}
              <button
                type="button"
                class="btn {{if (eq this.mode m.id) 'active'}}"
                {{on "click" (fn this.setMode m.id)}}
              >{{m.label}}</button>
            {{/each}}
          </div>
          {{#if this.isWords}}
            <div class="mode-toggle" role="group" aria-label="Word count">
              {{#each this.wordCounts as |n|}}
                <button
                  type="button"
                  class="btn {{if (eq this.wordCount n) 'active'}}"
                  {{on "click" (fn this.setWordCount n)}}
                >{{n}}</button>
              {{/each}}
            </div>
          {{else if this.isTime}}
            <div class="mode-toggle" role="group" aria-label="Duration">
              {{#each this.durations as |n|}}
                <button
                  type="button"
                  class="btn {{if (eq this.duration n) 'active'}}"
                  {{on "click" (fn this.setDuration n)}}
                >{{n}}s</button>
              {{/each}}
            </div>
          {{/if}}
          <div class="tt-live">
            <span class="tt-clock">{{this.clock}}</span>
            <span><strong>{{this.live.wpm}}</strong> wpm</span>
            <span><strong>{{this.live.accuracy}}%</strong> acc</span>
          </div>
        </div>

        {{#if this.result}}
          <div class="tt-result">
            <div class="math-stats">
              <div class="math-stat"><span>Speed</span><strong
                >{{this.result.wpm}}
                  wpm</strong></div>
              <div class="math-stat"><span>Raw</span><strong>{{this.result.raw}}
                  wpm</strong></div>
              <div class="math-stat"><span>Accuracy</span><strong
                >{{this.result.accuracy}}%</strong></div>
              <div class="math-stat"><span>Characters</span><strong
                >{{this.result.correct}}
                  /
                  {{this.result.errors}}</strong></div>
              <div class="math-stat"><span>Time</span><strong
                >{{this.result.seconds}}s</strong></div>
              <div class="math-stat"><span>Best</span><strong>{{this.bestWpm}}
                  wpm</strong></div>
            </div>
            {{#if this.samplePath}}
              <svg
                class="tt-graph"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-label="Speed over the run"
              >
                <path d={{this.samplePath}} />
              </svg>
            {{/if}}
            <div class="tool-controls">
              <button type="button" class="btn" {{on "click" this.reset}}>
                <Icon @name="refresh-cw" @size={{14}} />
                Again
              </button>
              <span class="tool-hint">Tab also restarts.</span>
            </div>
          </div>
        {{else}}
          {{! template-lint-disable no-invalid-interactive }}
          <div
            class="tt-text {{if this.focused 'is-focused'}}"
            {{on "click" this.focus}}
          >
            {{#each this.words key="@index" as |word|}}
              <span class="tt-word">
                {{~#each word key="key" as |c|~}}
                  <span class="tt-char is-{{c.state}}">{{c.char}}</span>
                {{~/each~}}
              </span>
            {{/each}}
            {{#unless this.focused}}
              <div class="tt-focus-hint">Click here or start typing</div>
            {{/unless}}
          </div>
          <input
            type="text"
            class="tt-input"
            aria-label="Type the text above"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            value={{this.typed}}
            {{this.bindInput}}
            {{on "input" this.onInput}}
            {{on "keydown" this.onKeyDown}}
            {{on "focus" this.onFocus}}
            {{on "blur" this.onBlur}}
          />
          <div class="tool-controls">
            <button type="button" class="btn" {{on "click" this.reset}}>
              <Icon @name="refresh-cw" @size={{14}} />
              New text
            </button>
            <span class="tool-hint">A word is five characters. Mistakes count
              against your speed; go back and fix them if you like.</span>
          </div>
        {{/if}}

        {{#if this.hasHistory}}
          <div class="tt-history">
            <div class="field-head">
              <span class="field-label">Your last
                {{this.history.length}}
                runs (best
                {{this.bestWpm}}
                wpm)</span>
              <button
                type="button"
                class="btn"
                {{on "click" this.clearHistory}}
              >
                Clear
              </button>
            </div>
            {{#if this.historyPath}}
              <svg
                class="tt-graph"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-label="Speed across past runs"
              >
                <path d={{this.historyPath}} />
              </svg>
            {{/if}}
          </div>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}
