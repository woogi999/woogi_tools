import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import { keepState } from '../utils/tool-state';
import { randomInt } from '../utils/random';

// Heads or tails, with a coin that actually flips. The tally keeps count so
// you can see fairness for yourself over a long run.

const FLIP_MS = 1400;
const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
  document.documentElement.dataset.motion === 'reduce';

export default class CoinTossPage extends Component {
  @tracked result = null;
  @tracked flipping = false;
  @tracked turns = 0;
  @tracked heads = 0;
  @tracked tails = 0;
  @tracked history = [];
  @tracked headsLabel = 'Heads';
  @tracked tailsLabel = 'Tails';

  timer = null;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'coin-toss', [
      'heads',
      'tails',
      'headsLabel',
      'tailsLabel',
    ]);
    registerDestructor(this, () => clearTimeout(this.timer));
  }

  get total() {
    return this.heads + this.tails;
  }

  get headsShare() {
    return this.total ? Math.round((this.heads / this.total) * 100) : 50;
  }

  get resultLabel() {
    if (!this.result) return '';
    return this.result === 'heads' ? this.headsLabel : this.tailsLabel;
  }

  // The coin spins a whole number of half turns and ends on the side that won.
  get coinStyle() {
    const duration = this.flipping && !reducedMotion() ? FLIP_MS : 0;
    return htmlSafe(
      `transform:rotateX(${this.turns * 180}deg);transition:transform ${duration}ms cubic-bezier(0.2, 0.7, 0.2, 1)`,
    );
  }

  get shareStyle() {
    return htmlSafe(`width:${this.headsShare}%`);
  }

  toss = () => {
    if (this.flipping) return;
    const heads = randomInt(2) === 0;
    // At least four full flips, landing on an even half-turn for heads and odd for tails.
    const current = this.turns % 2;
    const wanted = heads ? 0 : 1;
    this.turns += 8 + ((wanted - current + 2) % 2);
    this.flipping = true;
    this.result = null;
    this.timer = setTimeout(
      () => {
        this.flipping = false;
        this.result = heads ? 'heads' : 'tails';
        if (heads) this.heads++;
        else this.tails++;
        this.history = [this.result, ...this.history].slice(0, 20);
      },
      reducedMotion() ? 50 : FLIP_MS,
    );
  };

  resetTally = () => {
    this.heads = this.tails = 0;
    this.history = [];
    this.result = null;
  };

  setHeads = (event) => (this.headsLabel = event.target.value || 'Heads');
  setTails = (event) => (this.tailsLabel = event.target.value || 'Tails');

  <template>
    <ToolPage
      @route="coin-toss"
      @subtitle="Flip a coin and let it decide. Name the two sides whatever the choice is, and watch the tally to see it stay fair."
    >
      <div class="math-grid pop-in">
        <section class="math-card coin-stage">
          <div class="coin-scene">
            <div class="coin" style={{this.coinStyle}}>
              <div class="coin-face coin-heads"><span
                >{{this.headsLabel}}</span></div>
              <div class="coin-face coin-tails"><span
                >{{this.tailsLabel}}</span></div>
            </div>
          </div>
          <div class="math-result coin-result" aria-live="polite">
            {{#if this.result}}
              <span class="math-big">{{this.resultLabel}}</span>
            {{else if this.flipping}}
              <span class="math-big is-medium">Flipping…</span>
            {{else}}
              <span class="math-sub">Ready when you are</span>
            {{/if}}
          </div>
          <button
            type="button"
            class="btn active dice-roll-btn"
            disabled={{this.flipping}}
            {{on "click" this.toss}}
          >Toss the coin</button>
        </section>

        <section class="math-card">
          <h3 class="qr-heading">The sides</h3>
          <div class="math-row">
            <label class="math-field"><span class="qr-label is-muted">Heads
                means</span><input
                type="text"
                class="math-input"
                maxlength="16"
                value={{this.headsLabel}}
                {{on "input" this.setHeads}}
              /></label>
            <label class="math-field"><span class="qr-label is-muted">Tails
                means</span><input
                type="text"
                class="math-input"
                maxlength="16"
                value={{this.tailsLabel}}
                {{on "input" this.setTails}}
              /></label>
          </div>

          <div class="field-head">
            <h3 class="qr-heading">Tally · {{this.total}} tosses</h3>
            <button
              type="button"
              class="btn"
              {{on "click" this.resetTally}}
            >Reset</button>
          </div>
          <div class="coin-tally">
            <span>{{this.headsLabel}} · {{this.heads}}</span>
            <span>{{this.tailsLabel}} · {{this.tails}}</span>
          </div>
          <div
            class="coin-bar"
            role="img"
            aria-label="{{this.headsShare}}% heads"
          >
            <div class="coin-bar-heads" style={{this.shareStyle}}></div>
          </div>
          {{#if this.history.length}}
            <p class="tool-hint coin-history">
              {{#each this.history as |h|}}
                <span class="coin-dot is-{{h}}" title={{h}}></span>
              {{/each}}
            </p>
          {{/if}}
        </section>
      </div>
    </ToolPage>
  </template>
}
