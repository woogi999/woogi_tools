<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import { keepState } from '../utils/tool-state.js';
  import { randomInt } from '../utils/random.js';

  // Heads or tails, with a coin that actually flips: a solid 3D one that goes up
  // in the air and lands (lazy/dice-scene.js), or a flat spinning disc without
  // WebGL. The tally keeps count so you can see fairness for yourself over a
  // long run.

  const FLIP_MS = 1400;
  const reducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.dataset.motion === 'reduce';

  class CoinTossPage extends Component {
    result = $state.raw(null);
    flipping = $state.raw(false);
    turns = $state.raw(0);
    heads = $state.raw(0);
    tails = $state.raw(0);
    history = $state.raw([]);
    headsLabel = $state.raw('Heads');
    tailsLabel = $state.raw('Tails');
    sceneFailed = $state.raw(false);

    timer = null;
    scene = null;

    constructor(args) {
      super(args);
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
      return `transform:rotateX(${this.turns * 180}deg);transition:transform ${duration}ms cubic-bezier(0.2, 0.7, 0.2, 1)`;
    }

    get shareStyle() {
      return `width:${this.headsShare}%`;
    }

    toss = () => {
      if (this.flipping) return;
      const heads = randomInt(2) === 0;
      const land = () => {
        this.flipping = false;
        this.result = heads ? 'heads' : 'tails';
        if (heads) this.heads++;
        else this.tails++;
        this.history = [this.result, ...this.history].slice(0, 20);
      };
      if (this.scene) {
        this.flipping = true;
        this.result = null;
        this.scene.toss(heads).then(() => {
          if (!this.isDestroying && this.flipping) land();
        });
        return;
      }
      // At least four full flips, landing on an even half-turn for heads and odd for tails.
      const current = this.turns % 2;
      const wanted = heads ? 0 : 1;
      this.turns += 8 + ((wanted - current + 2) % 2);
      this.flipping = true;
      this.result = null;
      this.timer = setTimeout(land, reducedMotion() ? 50 : FLIP_MS);
    };

    resetTally = () => {
      this.heads = this.tails = 0;
      this.history = [];
      this.result = null;
    };

    setHeads = (event) => {
      this.headsLabel = event.target.value || 'Heads';
      this.scene?.setLabels(this.headsLabel, this.tailsLabel);
    };
    setTails = (event) => {
      this.tailsLabel = event.target.value || 'Tails';
      this.scene?.setLabels(this.headsLabel, this.tailsLabel);
    };

    setupScene = modifier((canvas) => {
      let cancelled = false;
      let scene = null;
      import('../lazy/dice-scene.js')
        .then(({ createCoinScene }) => {
          if (cancelled) return;
          scene = createCoinScene(canvas);
          scene.setLabels(this.headsLabel, this.tailsLabel);
          this.scene = scene;
        })
        .catch((error) => {
          console.warn('3D coin unavailable:', error);
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
  const self = new CoinTossPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="coin-toss"
  subtitle="Flip a coin and let it decide. Name the two sides whatever the choice is, and watch the tally to see it stay fair."
>
  <div class="math-grid pop-in">
    <section class="math-card coin-stage">
      {#if truthy(self.sceneFailed)}
        <div class="coin-scene">
          <div class="coin" style={self.coinStyle}>
            <div class="coin-face coin-heads"
              ><span>{self.headsLabel}</span></div
            >
            <div class="coin-face coin-tails"
              ><span>{self.tailsLabel}</span></div
            >
          </div>
        </div>
      {:else}
        <canvas class="coin-canvas" {@attach self.setupScene?.()}></canvas>
      {/if}
      <div class="math-result coin-result" aria-live="polite">
        {#if truthy(self.result)}
          <span class="math-big">{self.resultLabel}</span>
        {:else if truthy(self.flipping)}
          <span class="math-big is-medium">Flipping…</span>
        {:else}
          <span class="math-sub">Ready when you are</span>
        {/if}
      </div>
      <button
        type="button"
        class="btn active dice-roll-btn"
        disabled={self.flipping}
        onclick={self.toss}>Toss the coin</button
      >
    </section>

    <section class="math-card">
      <h3 class="qr-heading">The sides</h3>
      <div class="math-row">
        <label class="math-field"
          ><span class="qr-label is-muted">Heads means</span><input
            type="text"
            class="math-input"
            maxlength="16"
            {@attach prop('value', () => self.headsLabel)}
            oninput={self.setHeads}
          /></label
        >
        <label class="math-field"
          ><span class="qr-label is-muted">Tails means</span><input
            type="text"
            class="math-input"
            maxlength="16"
            {@attach prop('value', () => self.tailsLabel)}
            oninput={self.setTails}
          /></label
        >
      </div>

      <div class="field-head">
        <h3 class="qr-heading">Tally · {self.total} tosses</h3>
        <button type="button" class="btn" onclick={self.resetTally}
          >Reset</button
        >
      </div>
      <div class="coin-tally">
        <span>{self.headsLabel} · {self.heads}</span>
        <span>{self.tailsLabel} · {self.tails}</span>
      </div>
      <div class="coin-bar" role="img" aria-label="{self.headsShare}% heads">
        <div class="coin-bar-heads" style={self.shareStyle}></div>
      </div>
      {#if truthy(self.history?.length)}
        <p class="tool-hint coin-history">
          {#each self.history ?? [] as h}
            <span class="coin-dot is-{h}" title={h}></span>
          {/each}
        </p>
      {/if}
    </section>
  </div>
</ToolPage>
