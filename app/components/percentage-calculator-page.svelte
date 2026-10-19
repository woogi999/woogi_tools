<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import { keepState } from '../utils/tool-state.js';

  const num = (v) => (v === '' || v === null ? NaN : Number(v));
  const fmt = (n, suffix = '') =>
    Number.isFinite(n)
      ? `${parseFloat(n.toFixed(6)).toLocaleString(undefined, { maximumFractionDigits: 6 })}${suffix}`
      : '-';

  // Each card is a sentence with blanks; `solve` turns the two inputs into an answer.
  const PROBLEMS = [
    {
      id: 'of',
      before: 'What is',
      middle: '% of',
      after: '?',
      a: 15,
      b: 80,
      solve: (a, b) => ({
        answer: fmt((a / 100) * b),
        working: `${a} ÷ 100 × ${b}`,
      }),
    },
    {
      id: 'whatPercent',
      before: '',
      middle: 'is what % of',
      after: '?',
      a: 12,
      b: 48,
      solve: (a, b) => ({
        answer: fmt((a / b) * 100, '%'),
        working: `${a} ÷ ${b} × 100`,
      }),
    },
    {
      id: 'whole',
      before: '',
      middle: 'is',
      after: '% of what?',
      a: 30,
      b: 20,
      solve: (a, b) => ({
        answer: fmt(a / (b / 100)),
        working: `${a} ÷ (${b} ÷ 100)`,
      }),
    },
    {
      id: 'change',
      before: 'From',
      middle: 'to',
      after: 'is a change of?',
      a: 50,
      b: 65,
      solve: (a, b) => {
        const pct = ((b - a) / Math.abs(a)) * 100;
        return {
          answer: `${pct > 0 ? '+' : ''}${fmt(pct, '%')}`,
          working: `(${b} − ${a}) ÷ |${a}| × 100 · ${pct >= 0 ? 'increase' : 'decrease'} of ${fmt(Math.abs(b - a))}`,
        };
      },
    },
    {
      id: 'increase',
      before: 'Increase',
      middle: 'by',
      after: '%',
      a: 200,
      b: 12.5,
      solve: (a, b) => ({
        answer: fmt(a * (1 + b / 100)),
        working: `${a} × (1 + ${b} ÷ 100)`,
      }),
    },
    {
      id: 'decrease',
      before: 'Decrease',
      middle: 'by',
      after: '%',
      a: 200,
      b: 25,
      solve: (a, b) => ({
        answer: fmt(a * (1 - b / 100)),
        working: `${a} × (1 − ${b} ÷ 100)`,
      }),
    },
    {
      id: 'difference',
      before: 'Percentage difference between',
      middle: 'and',
      after: '',
      a: 40,
      b: 60,
      solve: (a, b) => ({
        answer: fmt((Math.abs(a - b) / ((a + b) / 2)) * 100, '%'),
        working: `|${a} − ${b}| ÷ average × 100`,
      }),
    },
  ];

  class PercentageCalculatorPage extends Component {
    values = $state.raw(
      Object.fromEntries(
        PROBLEMS.map((p) => [p.id, { a: String(p.a), b: String(p.b) }]),
      ),
    );

    get problems() {
      return PROBLEMS.map((p) => {
        const { a, b } = this.values[p.id];
        const na = num(a);
        const nb = num(b);
        const result =
          Number.isFinite(na) && Number.isFinite(nb)
            ? p.solve(na, nb)
            : { answer: '-', working: 'Fill in both numbers.' };
        return { ...p, a, b, ...result };
      });
    }

    constructor(args) {
      super(args);
      keepState(this, 'percentage-calculator', ['values']);
    }

    setValue = (id, key, event) => {
      this.values = {
        ...this.values,
        [id]: { ...this.values[id], [key]: event.target.value },
      };
    };
  }
</script>

<script>
  let args = $props();
  const self = new PercentageCalculatorPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="percentage-calculator"
  subtitle="What’s 15% off? How much did it go up? Percentages of all kinds, with the working shown so you can check."
>
  <div class="math-grid pop-in">
    {#each self.problems ?? [] as p (p?.id)}
      <section class="math-card">
        <div class="pct-sentence">
          {#if truthy(p?.before)}<span>{p?.before}</span>{/if}
          <input
            type="number"
            step="any"
            class="math-input pct-input"
            aria-label="{p?.before} first number"
            {@attach prop('value', () => p?.a)}
            oninput={(..._r) => self.setValue(p?.id, 'a', ..._r)}
          />
          <span>{p?.middle}</span>
          <input
            type="number"
            step="any"
            class="math-input pct-input"
            aria-label="{p?.middle} second number"
            {@attach prop('value', () => p?.b)}
            oninput={(..._r) => self.setValue(p?.id, 'b', ..._r)}
          />
          {#if truthy(p?.after)}<span>{p?.after}</span>{/if}
        </div>
        <span class="math-big is-medium">{p?.answer}</span>
        <span class="tool-hint">{p?.working}</span>
      </section>
    {/each}
  </div>
</ToolPage>
