import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import { keepState } from '../utils/tool-state';
import { randomInt } from '../utils/random';

// Rolls any dice you like, from a coin-flat d2 up to a d120, one or a handful
// at a time, with the total and the run of rolls kept for the table.

const PRESETS = [2, 4, 6, 8, 10, 12, 20, 100, 120];
const MAX_SIDES = 120;
const MAX_DICE = 20;
const ROLL_MS = 900;
const eq = (a, b) => a === b;
const sum = (list) => list.reduce((a, b) => a + b, 0);
const join = (list) => list.join(', ');
const many = (list) => list.length > 1;

const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
  document.documentElement.dataset.motion === 'reduce';

// The pips of a six-sided die, in the classic layout.
const PIPS = {
  1: [[50, 50]],
  2: [
    [25, 25],
    [75, 75],
  ],
  3: [
    [25, 25],
    [50, 50],
    [75, 75],
  ],
  4: [
    [25, 25],
    [75, 25],
    [25, 75],
    [75, 75],
  ],
  5: [
    [25, 25],
    [75, 25],
    [50, 50],
    [25, 75],
    [75, 75],
  ],
  6: [
    [25, 25],
    [75, 25],
    [25, 50],
    [75, 50],
    [25, 75],
    [75, 75],
  ],
};

export default class DiceRollPage extends Component {
  @tracked sides = 6;
  @tracked count = 1;
  @tracked modifier = 0;
  @tracked results = [];
  @tracked rolling = false;
  @tracked history = [];

  presets = PRESETS;
  timer = null;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'dice-roll', ['sides', 'count', 'modifier']);
    registerDestructor(this, () => clearInterval(this.timer));
  }

  get total() {
    return sum(this.results) + (this.results.length ? this.modifier : 0);
  }

  get faces() {
    return this.results.map((value) => ({
      value,
      pips:
        this.sides === 6 ? PIPS[value].map(([cx, cy]) => ({ cx, cy })) : null,
      // Bigger numbers need a smaller face to fit.
      small: value >= 100,
    }));
  }

  get isCustom() {
    return !PRESETS.includes(this.sides);
  }

  get modifierLabel() {
    if (!this.modifier) return '';
    return this.modifier > 0 ? `+${this.modifier}` : `${this.modifier}`;
  }

  get notation() {
    return `${this.count}d${this.sides}${this.modifierLabel}`;
  }

  setSides = (value) => {
    this.sides = Math.min(MAX_SIDES, Math.max(2, Math.floor(+value) || 2));
    this.results = [];
  };
  typeSides = (event) => this.setSides(event.target.value);
  setCount = (event) => {
    this.count = Math.min(
      MAX_DICE,
      Math.max(1, Math.floor(+event.target.value) || 1),
    );
    this.results = [];
  };
  setModifier = (event) =>
    (this.modifier = Math.floor(+event.target.value) || 0);

  roll = () => {
    if (this.rolling) return;
    const final = Array.from(
      { length: this.count },
      () => 1 + randomInt(this.sides),
    );
    const settle = () => {
      clearInterval(this.timer);
      this.rolling = false;
      this.results = final;
      this.history = [
        {
          notation: this.notation,
          rolls: final.join(' + '),
          total: sum(final) + this.modifier,
        },
        ...this.history,
      ].slice(0, 12);
    };
    if (reducedMotion()) return settle();
    // The faces tumble through random values before landing on the real ones.
    this.rolling = true;
    const started = Date.now();
    this.timer = setInterval(() => {
      if (Date.now() - started >= ROLL_MS) return settle();
      this.results = final.map(() => 1 + randomInt(this.sides));
    }, 70);
  };

  clearHistory = () => (this.history = []);

  <template>
    <ToolPage
      @route="dice-roll"
      @subtitle="Roll a d6, a d20 or a d120, one or a handful, with a modifier and a running log. Every roll comes from the system's own random generator."
    >
      <div class="math-grid pop-in">
        <section class="math-card">
          <h3 class="qr-heading">The dice</h3>
          <div class="math-field">
            <span class="qr-label is-muted">Sides</span>
            <div class="cipher-picks" role="group" aria-label="Sides">
              {{#each this.presets as |n|}}
                <button
                  type="button"
                  class="qr-tab {{if (eq this.sides n) 'active'}}"
                  {{on "click" (fn this.setSides n)}}
                >d{{n}}</button>
              {{/each}}
            </div>
          </div>
          <div class="math-row">
            <label class="math-field"><span class="qr-label is-muted">Custom
                sides (2 to 120)</span><input
                type="number"
                class="math-input"
                min="2"
                max="120"
                value={{this.sides}}
                {{on "change" this.typeSides}}
              /></label>
            <label class="math-field"><span class="qr-label is-muted">How many
                dice</span><input
                type="number"
                class="math-input"
                min="1"
                max="20"
                value={{this.count}}
                {{on "change" this.setCount}}
              /></label>
            <label class="math-field"><span class="qr-label is-muted">Add to the
                total</span><input
                type="number"
                class="math-input"
                value={{this.modifier}}
                {{on "change" this.setModifier}}
              /></label>
          </div>
          <button
            type="button"
            class="btn active dice-roll-btn"
            disabled={{this.rolling}}
            {{on "click" this.roll}}
          >Roll {{this.notation}}</button>
        </section>

        <section class="math-card">
          <h3 class="qr-heading">The table</h3>
          <div
            class="dice-tray {{if this.rolling 'is-rolling'}}"
            aria-live="polite"
          >
            {{#each this.faces as |face|}}
              <div class="die {{if face.small 'is-wide'}}">
                {{#if face.pips}}
                  <svg viewBox="0 0 100 100" aria-label={{face.value}}>
                    {{#each face.pips as |pip|}}
                      <circle cx={{pip.cx}} cy={{pip.cy}} r="9"></circle>
                    {{/each}}
                  </svg>
                {{else}}
                  <span class="die-number">{{face.value}}</span>
                {{/if}}
              </div>
            {{else}}
              <p class="fs-empty">Roll to see the dice land here.</p>
            {{/each}}
          </div>
          {{#if this.results.length}}
            <div class="math-result">
              <span class="math-big">{{this.total}}</span>
              <span class="math-sub">{{this.notation}}
                {{#if (many this.results)}}
                  · rolled
                  {{sum this.results}}
                  ({{join this.results}})
                {{/if}}</span>
            </div>
          {{/if}}
          {{#if this.history.length}}
            <div class="field-head">
              <span class="qr-label is-muted">Recent rolls</span>
              <button
                type="button"
                class="btn"
                {{on "click" this.clearHistory}}
              >Clear</button>
            </div>
            <ul class="dice-log">
              {{#each this.history as |h|}}
                <li><span class="dice-log-notation">{{h.notation}}</span>
                  <span class="dice-log-rolls">{{h.rolls}}</span>
                  <strong>{{h.total}}</strong></li>
              {{/each}}
            </ul>
          {{/if}}
        </section>
      </div>
    </ToolPage>
  </template>
}
