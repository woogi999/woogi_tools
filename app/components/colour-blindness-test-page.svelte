<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { modifier } from '../core/modifier.js';
  import { truthy } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import { drawPlate, makeRun, PLATE_TYPES } from '../utils/ishihara.js';

  function reading(rg, rgTotal, by, byTotal) {
    const lines = [];
    if (rg >= rgTotal - 1)
      lines.push('Red-green: you read the plates the way most people do.');
    else if (rg >= rgTotal / 2)
      lines.push(
        'Red-green: a few plates were hard to read. That can be the screen, but it is also how a mild red-green deficiency shows up.',
      );
    else
      lines.push(
        'Red-green: most of these plates were hard to read, which is the pattern of a red-green colour vision deficiency (the commonest kind, usually deutan or protan).',
      );
    if (by >= byTotal) lines.push('Blue-yellow: all clear.');
    else if (by >= byTotal - 1)
      lines.push('Blue-yellow: one slipped, which is usually nothing.');
    else
      lines.push(
        'Blue-yellow: several were hard to read, which is rarer and worth mentioning to an optometrist.',
      );
    return lines;
  }

  class ColourBlindnessTestPage extends Component {
    run = $state.raw(null);
    at = $state.raw(0);
    answers = $state.raw([]);
    finished = $state.raw(false);
    revealed = $state.raw(false);

    get plate() {
      return this.run?.[this.at] ?? null;
    }

    get inProgress() {
      return !this.finished;
    }

    get plateNumber() {
      return this.at + 1;
    }

    get total() {
      return this.run?.length ?? 0;
    }

    get score() {
      if (!this.run) return null;
      const tally = { rg: [0, 0], by: [0, 0] };
      this.run.forEach((plate, i) => {
        tally[plate.type][1]++;
        if (this.answers[i] === plate.number) tally[plate.type][0]++;
      });
      return {
        rg: tally.rg[0],
        rgTotal: tally.rg[1],
        by: tally.by[0],
        byTotal: tally.by[1],
        correct: tally.rg[0] + tally.by[0],
        lines: reading(tally.rg[0], tally.rg[1], tally.by[0], tally.by[1]),
      };
    }

    get review() {
      if (!this.run) return [];
      return this.run.map((plate, i) => ({
        ...plate,
        i: i + 1,
        typeLabel: PLATE_TYPES[plate.type].label,
        answer: this.answers[i],
        right: this.answers[i] === plate.number,
      }));
    }

    // Each plate is drawn the moment its canvas is on the page.
    paint = modifier((canvas, [plate]) => {
      if (plate) drawPlate(canvas, plate.number, plate.type);
    });

    start = () => {
      this.run = makeRun();
      this.at = 0;
      this.answers = [];
      this.finished = false;
      this.revealed = false;
    };

    answer = (value) => {
      this.answers = [...this.answers, value];
      if (this.at + 1 >= this.total) this.finished = true;
      else this.at++;
    };

    reveal = () => (this.revealed = !this.revealed);
  }
</script>

<script>
  let args = $props();
  const self = new ColourBlindnessTestPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="colour-blindness-test"
  subtitle="Nine plates of coloured dots, each hiding a number. Pick what you see and get a read on your red-green and blue-yellow vision."
>
  <div class="math-grid pop-in">
    <section class="math-card cb-card">
      {#if truthy(self.plate)}
        {#if truthy(self.inProgress)}
          <p class="cb-progress"
            >Plate
            {self.plateNumber}
            of
            {self.total}</p
          >
          <canvas
            class="cb-plate"
            aria-label="A disc of coloured dots hiding a number"
            {@attach self.paint?.([self.plate])}
          ></canvas>
          <div class="cb-options">
            {#each self.plate?.options ?? [] as n}
              <button
                type="button"
                class="btn cb-option"
                onclick={(..._r) => self.answer(n, ..._r)}>{n}</button
              >
            {/each}
            <button
              type="button"
              class="btn cb-option is-none"
              onclick={(..._r) => self.answer(null, ..._r)}
              >I can't see a number</button
            >
          </div>
        {:else}
          <div class="math-result">
            <span class="qr-label is-muted">You read</span>
            <span class="math-big"
              >{self.score?.correct}
              of
              {self.total}</span
            >
            <span class="tool-hint"
              >Red-green
              {self.score?.rg}/{self.score?.rgTotal}, blue-yellow
              {self.score?.by}/{self.score?.byTotal}</span
            >
          </div>
          {#each self.score?.lines ?? [] as line}
            <p class="math-callout">{line}</p>
          {/each}
          <div class="settings-actions">
            <button type="button" class="btn active" onclick={self.start}>
              <Icon name="refresh-cw" size={13} />
              Go again</button
            >
            <button type="button" class="btn" onclick={self.reveal}>
              <Icon
                name={truthy(self.revealed) ? 'eye-off' : 'eye'}
                size={13}
              />
              {truthy(self.revealed)
                ? 'Hide the answers'
                : 'Show the answers'}</button
            >
          </div>
          {#if truthy(self.revealed)}
            <ul class="cb-review">
              {#each self.review ?? [] as p}
                <li class={truthy(p?.right) ? 'is-right' : 'is-wrong'}>
                  <span>Plate {p?.i} ({p?.typeLabel})</span>
                  <strong>{p?.number}</strong>
                  <span class="is-muted"
                    >you said
                    {truthy(p?.answer) ? p?.answer : 'nothing'}</span
                  >
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      {:else}
        <div class="cb-intro">
          <Icon name="eye" size={40} />
          <p
            >Sit at a normal distance, with the screen at its usual brightness,
            and pick the number you see in each plate. Take a guess if it's
            faint; say so if there's nothing.</p
          >
          <button type="button" class="btn active" onclick={self.start}>
            <Icon name="play" size={13} />
            Start</button
          >
        </div>
      {/if}
    </section>

    <section class="math-card">
      <h3 class="qr-heading">About this test</h3>
      <p class="tool-hint"
        >These plates work like the Ishihara test: a number in reds and oranges
        sits among greens and olives at the same brightness, so it only stands
        out if your eyes tell those hues apart. Three of the nine swap that for
        blues against yellows.</p
      >
      <p class="tool-hint"
        >Screens vary a lot in colour, and a night-light mode or a warm colour
        profile can hide the numbers from anyone. Treat it as a rough check, not
        a diagnosis: an optometrist can do the proper thing in a few minutes.</p
      >
      <p class="tool-hint"
        >Roughly one in twelve men and one in two hundred women have some
        red-green deficiency, so a low score here is common and nothing to worry
        about on its own.</p
      >
    </section>
  </div>
</ToolPage>
