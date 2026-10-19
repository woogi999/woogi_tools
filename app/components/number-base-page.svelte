<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import CopyButton from './copy-button.svelte';
  import { keepState } from '../utils/tool-state.js';

  const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
  const PREFIX = { 2: /^0b/i, 8: /^0o/i, 16: /^0x/i };

  // BigInt keeps huge numbers exact, where Number would silently round past 2^53.
  function parseBase(text, base) {
    let s = text
      .trim()
      .replace(/[\s_,]/g, '')
      .toLowerCase();
    if (!s) return null;
    const negative = s.startsWith('-');
    if (negative) s = s.slice(1);
    if (PREFIX[base]) s = s.replace(PREFIX[base], '');
    if (!s) return undefined;
    let value = 0n;
    const b = BigInt(base);
    for (const ch of s) {
      const d = DIGITS.indexOf(ch);
      if (d < 0 || d >= base) return undefined;
      value = value * b + BigInt(d);
    }
    return negative ? -value : value;
  }

  function toBase(value, base) {
    if (value === 0n) return '0';
    const negative = value < 0n;
    let v = negative ? -value : value;
    const b = BigInt(base);
    let out = '';
    while (v > 0n) {
      out = DIGITS[Number(v % b)] + out;
      v /= b;
    }
    return (negative ? '-' : '') + out;
  }

  const group = (digits, size) =>
    digits.replace(new RegExp(`\\B(?=(.{${size}})+(?!.))`, 'g'), ' ');

  const FIELDS = [
    { base: 2, label: 'Binary', group: 4 },
    { base: 8, label: 'Octal', group: 3 },
    { base: 10, label: 'Decimal', group: 3 },
    { base: 16, label: 'Hexadecimal', group: 4 },
  ];

  class NumberBasePage extends Component {
    fields = FIELDS;

    value = $state.raw(255n);
    editing = $state.raw(null); // { base, text } while a field holds half-typed input
    customBase = $state.raw(36);
    grouped = $state.raw(false);
    uppercase = $state.raw(true);

    constructor(args) {
      super(args);
      keepState(this, 'number-base', ['customBase', 'grouped', 'uppercase']);
    }

    get error() {
      return this.editing &&
        parseBase(this.editing.text, this.editing.base) === undefined
        ? `That isn't a valid base-${this.editing.base} number.`
        : null;
    }

    text(base, grouping) {
      if (this.editing?.base === base) return this.editing.text;
      if (this.value === null) return '';
      let digits = toBase(this.value, base);
      if (this.uppercase) digits = digits.toUpperCase();
      if (this.grouped && grouping)
        digits =
          (digits.startsWith('-') ? '-' : '') +
          group(digits.replace('-', ''), grouping);
      return digits;
    }

    get rows() {
      return FIELDS.map((f) => ({
        ...f,
        text: this.text(f.base, f.group),
        plain: this.value === null ? '' : toBase(this.value, f.base),
      }));
    }

    get customText() {
      return this.text(this.customBase, 0);
    }

    get facts() {
      const v = this.value;
      if (v === null) return [];
      const magnitude = v < 0n ? -v : v;
      const bits = magnitude === 0n ? 1 : magnitude.toString(2).length;
      const facts = [
        { label: 'Bits needed', value: String(bits + (v < 0n ? 1 : 0)) },
        {
          label: 'Bytes',
          value: String(Math.ceil((bits + (v < 0n ? 1 : 0)) / 8)),
        },
        {
          label: 'Set bits',
          value: String(
            [...magnitude.toString(2)].filter((b) => b === '1').length,
          ),
        },
      ];
      if (v < 0n && v >= -(1n << 63n))
        facts.push({
          label: "Two's complement (64-bit)",
          value: BigInt.asUintN(64, v).toString(16).toUpperCase(),
        });
      return facts;
    }

    input = (base, event) => {
      const text = event.target.value;
      this.editing = { base, text };
      const parsed = parseBase(text, base);
      if (parsed !== undefined) this.value = parsed;
    };

    settle = () => {
      if (!this.error) this.editing = null;
    };

    setCustomBase = (e) => {
      this.editing = null;
      this.customBase = Math.min(
        36,
        Math.max(2, Math.floor(+e.target.value) || 2),
      );
    };

    toggleGrouped = () => (this.grouped = !this.grouped);
    toggleUppercase = () => (this.uppercase = !this.uppercase);
  }
</script>

<script>
  let args = $props();
  const self = new NumberBasePage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="number-base"
  subtitle="Switch numbers between binary, octal, decimal, hex and any base up to 36. Huge numbers welcome."
>
  <div class="math-grid pop-in">
    <section class="math-card">
      {#each self.rows ?? [] as f}
        <label class="math-field">
          <span class="field-head"
            ><span class="qr-label is-muted">{f?.label} (base {f?.base})</span
            ><CopyButton value={f?.plain} /></span
          >
          <input
            type="text"
            class="math-input"
            spellcheck="false"
            autocomplete="off"
            {@attach prop('value', () => f?.text)}
            onblur={self.settle}
            oninput={(..._r) => self.input(f?.base, ..._r)}
          />
        </label>
      {/each}
      <div class="math-row is-aligned">
        <label class="math-field"
          ><span class="qr-label is-muted">Base</span><input
            type="number"
            min="2"
            max="36"
            class="math-input"
            {@attach prop('value', () => self.customBase)}
            oninput={self.setCustomBase}
          /></label
        >
        <label class="math-field"
          ><span class="qr-label is-muted"
            >Value in base
            {self.customBase}</span
          ><input
            type="text"
            class="math-input"
            spellcheck="false"
            {@attach prop('value', () => self.customText)}
            onblur={self.settle}
            oninput={(..._r) => self.input(self.customBase, ..._r)}
          /></label
        >
      </div>
      {#if truthy(self.error)}<p class="tool-error">{self.error}</p>{/if}
      <div class="settings-actions">
        <label class="math-check"
          ><input
            type="checkbox"
            {@attach prop('checked', () => self.grouped)}
            onchange={self.toggleGrouped}
          />
          Group digits</label
        >
        <label class="math-check"
          ><input
            type="checkbox"
            {@attach prop('checked', () => self.uppercase)}
            onchange={self.toggleUppercase}
          />
          Uppercase letters</label
        >
      </div>
    </section>
    <section class="math-card">
      <h3 class="qr-heading">About this number</h3>
      <div class="math-stats">
        {#each self.facts ?? [] as f}
          <div class="math-stat"
            ><span>{f?.label}</span><strong>{f?.value}</strong></div
          >
        {/each}
      </div>
      <p class="tool-hint"
        >Prefixes like 0x, 0b and 0o, spaces and underscores are ignored when
        you type.</p
      >
    </section>
  </div>
</ToolPage>
