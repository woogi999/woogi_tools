<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import CopyButton from './copy-button.svelte';
  import { keepState } from '../utils/tool-state.js';

  const eq = (a, b) => a === b;
  const VALUES = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  const DIGIT = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  // Standard form only goes to 3999; a bar over a numeral multiplies it by a thousand.
  const MAX = 3999999;

  export function toRoman(n) {
    if (!Number.isInteger(n) || n < 1 || n > MAX) return null;
    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    const plain = (value) => {
      let out = '';
      for (const [v, s] of VALUES)
        while (value >= v) {
          out += s;
          value -= v;
        }
      return out;
    };
    if (thousands < 4) return plain(n);
    // Over 3999: the thousands get a vinculum, written here with a combining overline.
    const barred = [...plain(thousands)].map((c) => c + '̅').join('');
    return barred + plain(rest);
  }

  export function fromRoman(text) {
    const clean = text.toUpperCase().replace(/\s+/g, '');
    if (!clean) return null;
    let total = 0;
    let prev = 0;
    for (let i = clean.length - 1; i >= 0; i--) {
      const ch = clean[i];
      if (ch === '̅') continue;
      const barred = clean[i + 1] === '̅';
      const value = DIGIT[ch] * (barred ? 1000 : 1);
      if (!value) return null;
      if (value < prev) total -= value;
      else {
        total += value;
        prev = value;
      }
    }
    // Only a number that writes back the same way is a proper numeral.
    return toRoman(total) === clean ? total : null;
  }

  const EXAMPLES = [1987, 2024, 3999, 444, 49, 14];

  class RomanNumeralsPage extends Component {
    examples = EXAMPLES;

    direction = $state.raw('to'); // 'to' | 'from'
    input = $state.raw('2024');

    constructor(args) {
      super(args);
      keepState(this, 'roman-numerals', ['direction', 'input']);
    }

    get result() {
      const raw = this.input.trim();
      if (!raw) return { value: '', note: '' };
      if (this.direction === 'to') {
        const n = Number(raw.replace(/[,\s]/g, ''));
        const roman = toRoman(n);
        if (roman === null)
          return {
            value: '',
            note: Number.isInteger(n)
              ? `Roman numerals run from 1 to ${MAX.toLocaleString()}.`
              : 'Type a whole number.',
          };
        return {
          value: roman,
          note:
            n > 3999 ? 'A bar over a numeral means a thousand times it.' : '',
        };
      }
      const n = fromRoman(raw);
      if (n === null)
        return {
          value: '',
          note: 'That is not a well-formed numeral. Only I, V, X, L, C, D and M, in the standard order.',
        };
      return { value: n.toLocaleString(), note: '' };
    }

    get breakdown() {
      if (this.direction !== 'to' || !this.result.value) return [];
      const n = Number(this.input.replace(/[,\s]/g, ''));
      if (n > 3999) return [];
      const parts = [];
      let left = n;
      for (const [v, s] of VALUES)
        while (left >= v) {
          parts.push({ value: v, symbol: s });
          left -= v;
        }
      return parts;
    }

    setInput = (event) => (this.input = event.target.value);
    setDirection = (direction) => {
      if (direction === this.direction) return;
      const out = this.result.value;
      this.direction = direction;
      if (out) this.input = out.replace(/,/g, '');
    };
    useExample = (n) => {
      this.direction = 'to';
      this.input = String(n);
    };
  }
</script>

<script>
  let args = $props();
  const self = new RomanNumeralsPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="roman-numerals"
  subtitle="Numbers into Roman numerals and Roman numerals back into numbers, with the working shown."
>
  <div class="math-grid pop-in">
    <section class="math-card">
      <div class="math-tabs" role="group" aria-label="Direction">
        <button
          type="button"
          class="qr-tab {truthy(eq(self.direction, 'to')) ? 'active' : ''}"
          onclick={(..._r) => self.setDirection('to', ..._r)}
          >Number to Roman</button
        >
        <button
          type="button"
          class="qr-tab {truthy(eq(self.direction, 'from')) ? 'active' : ''}"
          onclick={(..._r) => self.setDirection('from', ..._r)}
          >Roman to number</button
        >
      </div>
      <label class="math-field">
        <span class="qr-label is-muted"
          >{truthy(eq(self.direction, 'to')) ? 'Number' : 'Roman numeral'}</span
        >
        <input
          type="text"
          class="math-input roman-input"
          inputmode={truthy(eq(self.direction, 'to')) ? 'numeric' : 'text'}
          spellcheck="false"
          {@attach prop('value', () => self.input)}
          oninput={self.setInput}
        />
      </label>
      <div class="line-actions">
        {#each self.examples ?? [] as n}
          <button
            type="button"
            class="btn"
            onclick={(..._r) => self.useExample(n, ..._r)}>{n}</button
          >
        {/each}
      </div>
    </section>

    <section class="math-card">
      <div class="fc-toolbar">
        <h3 class="qr-heading">Result</h3>
        {#if truthy(self.result?.value)}<CopyButton
            value={self.result?.value}
          />{/if}
      </div>
      <p class="math-big roman-result"
        >{truthy(self.result?.value) ? self.result?.value : '-'}</p
      >
      {#if truthy(self.result?.note)}<p class="tool-hint">{self.result?.note}</p
        >{/if}
      {#if truthy(self.breakdown?.length)}
        <div class="roman-parts">
          {#each self.breakdown ?? [] as part}
            <span class="roman-part"
              ><strong>{part?.symbol}</strong>
              {part?.value}</span
            >
          {/each}
        </div>
      {/if}
      <p class="tool-hint"
        >I 1, V 5, X 10, L 50, C 100, D 500, M 1000. A smaller numeral before a
        bigger one is taken away from it: IV is 4, XC is 90, CM is 900.</p
      >
    </section>
  </div>
</ToolPage>
