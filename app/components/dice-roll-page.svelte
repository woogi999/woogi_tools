<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import { keepState } from '../utils/tool-state.js';
  import { randomInt } from '../utils/random.js';

  // Rolls any dice you like, from a coin-flat d2 up to a d120, one or a handful
  // at a time, with the total and the run of rolls kept for the table. The dice
  // are real 3D ones that tumble across the table (lazy/dice-scene.js); without
  // WebGL, flat faces shuffle through numbers instead.

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

  class DiceRollPage extends Component {
    sides = $state.raw(6);
    count = $state.raw(1);
    modifier = $state.raw(0);
    results = $state.raw([]);
    rolling = $state.raw(false);
    history = $state.raw([]);
    sceneFailed = $state.raw(false);

    presets = PRESETS;
    timer = null;
    scene = null;

    constructor(args) {
      super(args);
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
      this.clearTable();
    };
    typeSides = (event) => this.setSides(event.target.value);
    setCount = (event) => {
      this.count = Math.min(
        MAX_DICE,
        Math.max(1, Math.floor(+event.target.value) || 1),
      );
      this.clearTable();
    };

    clearTable() {
      this.results = [];
      this.scene?.clear();
    }
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
      if (this.scene) {
        this.rolling = true;
        this.results = [];
        this.scene.roll(final, this.sides).then(() => {
          if (!this.isDestroying && this.rolling) settle();
        });
        return;
      }
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

    setupScene = modifier((canvas) => {
      let cancelled = false;
      let scene = null;
      import('../lazy/dice-scene.js')
        .then(({ createDiceScene }) => {
          if (cancelled) return;
          scene = createDiceScene(canvas);
          this.scene = scene;
          if (this.results.length) scene.roll(this.results, this.sides);
        })
        .catch((error) => {
          console.warn('3D dice unavailable:', error);
          this.sceneFailed = true;
        });
      return () => {
        cancelled = true;
        scene?.dispose();
        this.scene = null;
      };
    });
  }
</script>

<script>
  let args = $props();
  const self = new DiceRollPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="dice-roll"
  subtitle="Roll a d6, a d20 or a d120, one or a handful, with a modifier and a running log. Every roll comes from the system's own random generator."
>
  <div class="math-grid pop-in">
    <section class="math-card">
      <h3 class="qr-heading">The dice</h3>
      <div class="math-field">
        <span class="qr-label is-muted">Sides</span>
        <div class="cipher-picks" role="group" aria-label="Sides">
          {#each self.presets ?? [] as n}
            <button
              type="button"
              class="qr-tab {truthy(eq(self.sides, n)) ? 'active' : ''}"
              onclick={(..._r) => self.setSides(n, ..._r)}>d{n}</button
            >
          {/each}
        </div>
      </div>
      <div class="math-row">
        <label class="math-field"
          ><span class="qr-label is-muted">Custom sides (2 to 120)</span><input
            type="number"
            class="math-input"
            min="2"
            max="120"
            {@attach prop('value', () => self.sides)}
            onchange={self.typeSides}
          /></label
        >
        <label class="math-field"
          ><span class="qr-label is-muted">How many dice</span><input
            type="number"
            class="math-input"
            min="1"
            max="20"
            {@attach prop('value', () => self.count)}
            onchange={self.setCount}
          /></label
        >
        <label class="math-field"
          ><span class="qr-label is-muted">Add to the total</span><input
            type="number"
            class="math-input"
            {@attach prop('value', () => self.modifier)}
            onchange={self.setModifier}
          /></label
        >
      </div>
      <button
        type="button"
        class="btn active dice-roll-btn"
        disabled={self.rolling}
        onclick={self.roll}>Roll {self.notation}</button
      >
    </section>

    <section class="math-card">
      <h3 class="qr-heading">The table</h3>
      {#if truthy(self.sceneFailed)}
        <div
          class="dice-tray {truthy(self.rolling) ? 'is-rolling' : ''}"
          aria-live="polite"
        >
          {#each self.faces ?? [] as face}
            <div class="die {truthy(face?.small) ? 'is-wide' : ''}">
              {#if truthy(face?.pips)}
                <svg viewBox="0 0 100 100" aria-label={face?.value}>
                  {#each face?.pips ?? [] as pip}
                    <circle cx={pip?.cx} cy={pip?.cy} r="9"></circle>
                  {/each}
                </svg>
              {:else}
                <span class="die-number">{face?.value}</span>
              {/if}
            </div>
          {:else}
            <p class="fs-empty">Roll to see the dice land here.</p>
          {/each}
        </div>
      {:else}
        <div class="dice-table" aria-live="polite">
          <canvas class="dice-canvas" {@attach self.setupScene?.()}></canvas>
          {#if !truthy(self.results?.length)}
            {#if !truthy(self.rolling)}
              <p class="fs-empty dice-table-empty"
                >Roll to see the dice land here.</p
              >
            {/if}
          {/if}
        </div>
      {/if}
      {#if truthy(self.results?.length)}
        <div class="math-result">
          <span class="math-big">{self.total}</span>
          <span class="math-sub"
            >{self.notation}
            {#if truthy(many(self.results))}
              · rolled
              {sum(self.results)}
              ({join(self.results)})
            {/if}</span
          >
        </div>
      {/if}
      {#if truthy(self.history?.length)}
        <div class="field-head">
          <span class="qr-label is-muted">Recent rolls</span>
          <button type="button" class="btn" onclick={self.clearHistory}
            >Clear</button
          >
        </div>
        <ul class="dice-log">
          {#each self.history ?? [] as h}
            <li
              ><span class="dice-log-notation">{h?.notation}</span>
              <span class="dice-log-rolls">{h?.rolls}</span>
              <strong>{h?.total}</strong></li
            >
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</ToolPage>
