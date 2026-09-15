import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import ToolPage from './tool-page';

const percent = (n) => `${parseFloat((n * 100).toFixed(2))}%`;
const segment = (share) => htmlSafe(`flex-grow:${share};`);
const readCount = (event) => Math.max(0, Math.floor(+event.target.value || 0));

export default class WinrateCalculatorPage extends Component {
  @tracked wins = 12;
  @tracked losses = 8;
  @tracked draws = 0;
  @tracked target = 60;
  @tracked drawsCount = true;
  // Text being typed into the games / win rate boxes. Kept separately so a
  // half-typed "6" isn't overwritten by the rounded value while typing.
  @tracked gamesDraft = null;
  @tracked rateDraft = null;
  // Once a win rate is typed, changing games keeps that rate instead of the win count.
  rateLocked = false;

  get games() {
    return this.wins + this.losses + (this.drawsCount ? this.draws : 0);
  }

  get rate() {
    return this.games ? this.wins / this.games : 0;
  }

  get rateText() {
    return this.games ? percent(this.rate) : '—';
  }

  get countedDraws() {
    return this.drawsCount ? this.draws : 0;
  }

  get gamesValue() {
    return this.gamesDraft ?? this.games;
  }

  get rateValue() {
    return this.rateDraft ?? (this.games ? parseFloat((this.rate * 100).toFixed(2)) : '');
  }

  // Wins and losses are whole games, so a typed rate may only be approximated.
  get rateMismatch() {
    if (this.rateDraft === null || !this.games) return null;
    const wanted = +this.rateDraft;
    const actual = this.rate * 100;
    return Math.abs(wanted - actual) > 0.005 ? `Closest possible with ${this.games} games: ${percent(this.rate)}` : null;
  }

  // Rebuild wins/losses from a games total and a win share of it.
  splitGames(games, rate) {
    const decided = Math.max(0, games - this.countedDraws);
    const wins = rate === null ? Math.min(this.wins, decided) : Math.min(decided, Math.round(rate * games));
    this.wins = wins;
    this.losses = decided - wins;
    if (games < this.countedDraws) this.draws = games;
  }

  get ratio() {
    if (!this.losses) return this.wins ? `${this.wins} : 0` : '—';
    return parseFloat((this.wins / this.losses).toFixed(2)).toString();
  }

  get goal() {
    return Math.min(100, Math.max(0, this.target)) / 100;
  }

  // (W + n) / (G + n) ≥ t  →  n ≥ (tG − W) / (1 − t)
  get winsNeeded() {
    const { wins, games, goal } = this;
    if (games && this.rate >= goal) return 0;
    if (goal >= 1) return games > wins ? null : 1;
    return Math.max(0, Math.ceil((goal * games - wins) / (1 - goal) - 1e-9));
  }

  // W / (G + m) ≥ t  →  m ≤ W / t − G
  get lossBuffer() {
    const { wins, games, goal } = this;
    if (!games || this.rate < goal) return null;
    if (goal === 0) return Infinity;
    return Math.max(0, Math.floor(wins / goal - games + 1e-9));
  }

  get targetText() {
    return percent(this.goal);
  }

  get needsText() {
    const n = this.winsNeeded;
    if (n === null) return `${this.targetText} can't be reached once you've lost a game.`;
    if (n === 0) return `You're already at or above ${this.targetText}.`;
    return `Win ${n.toLocaleString()} game${n === 1 ? '' : 's'} in a row to reach ${this.targetText}.`;
  }

  get bufferText() {
    const m = this.lossBuffer;
    if (m === null) return null;
    if (m === Infinity) return 'No number of losses can drop you below 0%.';
    if (m === 0) return `One more loss drops you below ${this.targetText}.`;
    return `You can lose ${m.toLocaleString()} game${m === 1 ? '' : 's'} in a row and stay at ${this.targetText} or higher.`;
  }

  get bar() {
    const draws = this.drawsCount ? this.draws : 0;
    return { wins: segment(this.wins), losses: segment(this.losses), draws: segment(draws), hasDraws: draws > 0 };
  }

  editRecord(key, e) {
    this[key] = readCount(e);
    this.rateLocked = false;
    this.rateDraft = null;
    this.gamesDraft = null;
  }

  setWins = (e) => this.editRecord('wins', e);
  setLosses = (e) => this.editRecord('losses', e);
  setDraws = (e) => this.editRecord('draws', e);

  setGames = (e) => {
    this.gamesDraft = e.target.value;
    const rate = this.rateLocked && this.rateDraft !== null ? Math.min(100, Math.max(0, +this.rateDraft || 0)) / 100 : null;
    this.splitGames(readCount(e), rate);
  };

  setRate = (e) => {
    this.rateDraft = e.target.value;
    this.rateLocked = true;
    const games = this.games;
    if (games) this.splitGames(games, Math.min(100, Math.max(0, +e.target.value || 0)) / 100);
  };

  settleGames = () => (this.gamesDraft = null);
  setTarget = (e) => (this.target = Math.min(100, Math.max(0, +e.target.value || 0)));
  toggleDraws = (e) => (this.drawsCount = e.target.checked);

  <template>
    <ToolPage @route="winrate-calculator" @subtitle="Enter your wins and losses to see your win rate, then set a goal to find out the streak you need.">
      <div class="math-grid pop-in">
        <section class="math-card">
          <h3 class="qr-heading">Record</h3>
          <div class="math-row">
            <label class="math-field"><span class="qr-label is-muted">Wins</span><input type="number" min="0" class="math-input" value={{this.wins}} {{on "input" this.setWins}} /></label>
            <label class="math-field"><span class="qr-label is-muted">Losses</span><input type="number" min="0" class="math-input" value={{this.losses}} {{on "input" this.setLosses}} /></label>
            <label class="math-field"><span class="qr-label is-muted">Draws</span><input type="number" min="0" class="math-input" value={{this.draws}} {{on "input" this.setDraws}} /></label>
          </div>
          <label class="math-check">
            <input type="checkbox" checked={{this.drawsCount}} {{on "change" this.toggleDraws}} />
            Count draws as games played
          </label>

          <div class="math-row">
            <label class="math-field">
              <span class="qr-label is-muted">Games played</span>
              <input type="number" min="0" class="math-input" value={{this.gamesValue}} {{on "input" this.setGames}} {{on "blur" this.settleGames}} />
            </label>
            <label class="math-field">
              <span class="qr-label is-muted">Win rate (%)</span>
              <input type="number" min="0" max="100" step="0.01" class="math-input" placeholder="—" value={{this.rateValue}} {{on "input" this.setRate}} />
            </label>
          </div>
          <p class="tool-hint">Type games and a win rate to work backwards to wins and losses.</p>
          {{#if this.rateMismatch}}
            <p class="tool-hint">{{this.rateMismatch}}</p>
          {{/if}}

          <div class="math-result">
            <span class="qr-label is-muted">Win rate</span>
            <span class="math-big">{{this.rateText}}</span>
          </div>
          {{#if this.games}}
            <div class="wr-bar" aria-hidden="true">
              <span class="wr-win" style={{this.bar.wins}}></span>
              {{#if this.bar.hasDraws}}<span class="wr-draw" style={{this.bar.draws}}></span>{{/if}}
              <span class="wr-loss" style={{this.bar.losses}}></span>
            </div>
          {{/if}}
          <div class="math-stats">
            <div class="math-stat"><span>Games</span><strong>{{this.games}}</strong></div>
            <div class="math-stat"><span>W/L ratio</span><strong>{{this.ratio}}</strong></div>
          </div>
        </section>

        <section class="math-card">
          <h3 class="qr-heading">Goal</h3>
          <label class="math-field">
            <span class="qr-label is-muted">Target win rate (%)</span>
            <input type="number" min="0" max="100" step="0.5" class="math-input" value={{this.target}} {{on "input" this.setTarget}} />
          </label>
          <p class="math-callout">{{this.needsText}}</p>
          {{#if this.bufferText}}
            <p class="math-callout is-soft">{{this.bufferText}}</p>
          {{/if}}
        </section>
      </div>
    </ToolPage>
  </template>
}
