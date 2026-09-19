import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';
import { keepState } from '../utils/tool-state';

const eq = (a, b) => a === b;
const GOES = 5;
const WAIT_MIN_MS = 1500;
const WAIT_MAX_MS = 5000;
const MAX_HISTORY = 20;

// Roughly where an average lands among people who try these tests.
function verdict(ms) {
  if (ms < 180)
    return 'Faster than almost everyone. Are you sure you are not a cat?';
  if (ms < 220) return 'Very quick: quicker than most.';
  if (ms < 260) return 'About average for a mouse click. Solidly human.';
  if (ms < 320) return 'A touch slower than average. Coffee?';
  return 'On the slow side today. Screens, tiredness and the mouse all add a bit.';
}

export default class ReactionTimePage extends Component {
  // 'idle' | 'waiting' | 'go' | 'early' | 'result' | 'done'
  @tracked state = 'idle';
  @tracked times = [];
  @tracked last = null;
  @tracked history = [];
  @tracked best = null;

  timer = null;
  shownAt = 0;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'reaction-time', ['history', 'best']);
    registerDestructor(this, () => clearTimeout(this.timer));
  }

  get go() {
    return this.times.length + 1;
  }

  get average() {
    if (!this.times.length) return null;
    return Math.round(
      this.times.reduce((a, b) => a + b, 0) / this.times.length,
    );
  }

  get fastest() {
    return this.times.length ? Math.min(...this.times) : null;
  }

  get verdict() {
    return this.average === null ? '' : verdict(this.average);
  }

  get prompt() {
    switch (this.state) {
      case 'idle':
        return 'Click anywhere in here to start';
      case 'waiting':
        return 'Wait for green…';
      case 'go':
        return 'Click!';
      case 'early':
        return 'Too soon! Click to try that one again';
      case 'result':
        return `${this.last} ms. Click to keep going`;
      case 'done':
        return `Average ${this.average} ms. Click to go again`;
      default:
        return '';
    }
  }

  // Space and Enter count as a click, so a keyboard works just as well.
  keys = modifier(() => {
    const onKey = (event) => {
      if (event.code !== 'Space' && event.code !== 'Enter') return;
      if (event.target.closest('input, textarea, select, button, a')) return;
      event.preventDefault();
      this.press();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  press = () => {
    switch (this.state) {
      case 'idle':
      case 'done':
        this.times = [];
        this.arm();
        break;
      case 'result':
      case 'early':
        this.arm();
        break;
      case 'waiting':
        clearTimeout(this.timer);
        this.state = 'early';
        break;
      case 'go': {
        this.last = Math.round(performance.now() - this.shownAt);
        this.times = [...this.times, this.last];
        if (this.times.length >= GOES) this.finish();
        else this.state = 'result';
        break;
      }
    }
  };

  arm() {
    this.state = 'waiting';
    const wait = WAIT_MIN_MS + Math.random() * (WAIT_MAX_MS - WAIT_MIN_MS);
    this.timer = setTimeout(() => {
      this.shownAt = performance.now();
      this.state = 'go';
    }, wait);
  }

  finish() {
    this.state = 'done';
    const avg = this.average;
    this.history = [avg, ...this.history].slice(0, MAX_HISTORY);
    if (this.best === null || avg < this.best) this.best = avg;
  }

  clearHistory = () => {
    this.history = [];
    this.best = null;
  };

  <template>
    <ToolPage
      @route="reaction-time"
      @subtitle="Wait for the panel to turn green, then click as fast as you can. Five goes make a score."
    >
      <div class="pop-in" {{this.keys}}>
        {{! template-lint-disable no-pointer-down-event-binding require-presentational-children }}
        <div
          class="rt-pad is-{{this.state}}"
          role="button"
          tabindex="0"
          {{on "pointerdown" this.press}}
        >
          <Icon
            @name={{if (eq this.state "go") "zap" "mouse-pointer-click"}}
            @size={{40}}
          />
          <p class="rt-prompt">{{this.prompt}}</p>
          {{#unless (eq this.state "idle")}}
            <p class="rt-count">Go
              {{if (eq this.state "done") GOES this.go}}
              of
              {{GOES}}</p>
          {{/unless}}
        </div>

        <div class="math-grid rt-stats">
          <section class="math-card">
            <h3 class="qr-heading">This run</h3>
            <div class="rt-goes">
              {{#each this.times as |t|}}
                <span class="rt-go">{{t}} ms</span>
              {{/each}}
            </div>
            {{#if this.times.length}}
              <div class="math-result">
                <span class="qr-label is-muted">Average</span>
                <span class="math-big">{{this.average}} ms</span>
                <span class="tool-hint">Fastest {{this.fastest}} ms</span>
              </div>
              {{#if (eq this.state "done")}}
                <p class="math-callout">{{this.verdict}}</p>
              {{/if}}
            {{else}}
              <p class="tool-hint">Space or Enter works too. Clicking before the
                green counts as a false start.</p>
            {{/if}}
          </section>

          <section class="math-card">
            <h3 class="qr-heading">Past runs</h3>
            {{#if this.history.length}}
              <div class="math-result">
                <span class="qr-label is-muted">Personal best</span>
                <span class="math-big">{{this.best}} ms</span>
              </div>
              <div class="rt-goes">
                {{#each this.history as |avg|}}
                  <span
                    class="rt-go {{if (eq avg this.best) 'is-best'}}"
                  >{{avg}}
                    ms</span>
                {{/each}}
              </div>
              <div class="settings-actions">
                <button
                  type="button"
                  class="btn"
                  {{on "click" this.clearHistory}}
                >
                  <Icon @name="trash-2" @size={{13}} />
                  Clear</button>
              </div>
            {{else}}
              <p class="tool-hint">Finish a run of five and it's kept here.</p>
            {{/if}}
          </section>
        </div>
      </div>
    </ToolPage>
  </template>
}
