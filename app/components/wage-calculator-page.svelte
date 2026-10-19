<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import { keepState } from '../utils/tool-state.js';

  const PERIODS = [
    { id: 'hour', label: 'Hourly' },
    { id: 'day', label: 'Daily' },
    { id: 'week', label: 'Weekly' },
    { id: 'month', label: 'Monthly' },
    { id: 'year', label: 'Annually' },
  ];

  const CURRENCIES = [
    { code: 'USD', symbol: '$' },
    { code: 'EUR', symbol: '€' },
    { code: 'GBP', symbol: '£' },
    { code: 'CAD', symbol: 'CA$' },
    { code: 'AUD', symbol: 'A$' },
    { code: 'PHP', symbol: '₱' },
    { code: 'INR', symbol: '₹' },
    { code: 'JPY', symbol: '¥' },
    { code: 'CNY', symbol: '¥' },
    { code: 'CHF', symbol: 'CHF' },
  ];

  // Rough, approximate progressive brackets (single filer, national/federal
  // only: no local tax, credits, deductions or social contributions).
  const TAX_MODELS = {
    none: { label: 'No deduction', brackets: null },
    us: {
      label: 'United States (federal)',
      brackets: [
        { upTo: 11600, rate: 0.1 },
        { upTo: 47150, rate: 0.12 },
        { upTo: 100525, rate: 0.22 },
        { upTo: 191950, rate: 0.24 },
        { upTo: 243725, rate: 0.32 },
        { upTo: 609350, rate: 0.35 },
        { upTo: Infinity, rate: 0.37 },
      ],
    },
    uk: {
      label: 'United Kingdom',
      brackets: [
        { upTo: 12570, rate: 0 },
        { upTo: 50270, rate: 0.2 },
        { upTo: 125140, rate: 0.4 },
        { upTo: Infinity, rate: 0.45 },
      ],
    },
    ca: {
      label: 'Canada (federal)',
      brackets: [
        { upTo: 55867, rate: 0.15 },
        { upTo: 111733, rate: 0.205 },
        { upTo: 173205, rate: 0.26 },
        { upTo: 246752, rate: 0.29 },
        { upTo: Infinity, rate: 0.33 },
      ],
    },
    au: {
      label: 'Australia',
      brackets: [
        { upTo: 18200, rate: 0 },
        { upTo: 45000, rate: 0.16 },
        { upTo: 135000, rate: 0.3 },
        { upTo: 190000, rate: 0.37 },
        { upTo: Infinity, rate: 0.45 },
      ],
    },
    ph: {
      label: 'Philippines',
      brackets: [
        { upTo: 250000, rate: 0 },
        { upTo: 400000, rate: 0.15 },
        { upTo: 800000, rate: 0.2 },
        { upTo: 2000000, rate: 0.25 },
        { upTo: 8000000, rate: 0.3 },
        { upTo: Infinity, rate: 0.35 },
      ],
    },
  };

  function marginalTax(brackets, amount) {
    if (!brackets || amount <= 0) return 0;
    let tax = 0;
    let last = 0;
    for (const { upTo, rate } of brackets) {
      if (amount <= last) break;
      tax += (Math.min(amount, upTo) - last) * rate;
      last = upTo;
    }
    return tax;
  }

  function money(n, symbol) {
    if (!Number.isFinite(n)) return '-';
    return `${symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  const eq = (a, b) => a === b;

  class WageCalculatorPage extends Component {
    periods = PERIODS;
    currencies = CURRENCIES;
    taxModels = Object.entries(TAX_MODELS).map(([id, m]) => ({
      id,
      label: m.label,
    }));

    rate = $state.raw('25');
    period = $state.raw('hour');
    hoursPerWeek = $state.raw(40);
    daysPerWeek = $state.raw(5);
    currency = $state.raw('USD');
    taxId = $state.raw('none');

    constructor(args) {
      super(args);
      keepState(this, 'wage-calculator', [
        'rate',
        'period',
        'hoursPerWeek',
        'daysPerWeek',
        'currency',
        'taxId',
      ]);
    }

    get symbol() {
      return CURRENCIES.find((c) => c.code === this.currency)?.symbol ?? '';
    }

    get rateValue() {
      const n = parseFloat(this.rate);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    }

    get weeksPerYear() {
      return 52;
    }

    get annualGross() {
      const {
        rateValue: r,
        hoursPerWeek: h,
        daysPerWeek: d,
        weeksPerYear: w,
      } = this;
      switch (this.period) {
        case 'year':
          return r;
        case 'month':
          return r * 12;
        case 'week':
          return r * w;
        case 'day':
          return r * d * w;
        default:
          return r * h * w;
      }
    }

    get hoursPerYear() {
      return Math.max(0, this.hoursPerWeek) * this.weeksPerYear;
    }

    get daysPerYear() {
      return Math.max(0, this.daysPerWeek) * this.weeksPerYear;
    }

    get annualTax() {
      return marginalTax(TAX_MODELS[this.taxId].brackets, this.annualGross);
    }

    get hasTax() {
      return this.taxId !== 'none';
    }

    get effectiveRateText() {
      const rate = this.annualGross
        ? (this.annualTax / this.annualGross) * 100
        : 0;
      return rate.toFixed(1);
    }

    breakdownFor(annual) {
      return {
        hourly: this.hoursPerYear ? annual / this.hoursPerYear : 0,
        daily: this.daysPerYear ? annual / this.daysPerYear : 0,
        weekly: annual / this.weeksPerYear,
        monthly: annual / 12,
        annually: annual,
      };
    }

    get gross() {
      return this.breakdownFor(this.annualGross);
    }

    get net() {
      return this.breakdownFor(Math.max(0, this.annualGross - this.annualTax));
    }

    setRate = (e) => (this.rate = e.target.value);
    setPeriod = (e) => (this.period = e.target.value);
    setHours = (e) => (this.hoursPerWeek = Math.max(0, +e.target.value || 0));
    setDays = (e) =>
      (this.daysPerWeek = Math.max(0, Math.min(7, +e.target.value || 0)));
    setCurrency = (e) => (this.currency = e.target.value);
    setTax = (e) => (this.taxId = e.target.value);
  }
</script>

<script>
  let args = $props();
  const self = new WageCalculatorPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="wage-calculator"
  subtitle="Put in your pay rate and hours to see what you make per hour, day, week, month and year, plus a rough tax estimate."
>
  <div class="math-grid pop-in">
    <section class="math-card">
      <h3 class="qr-heading">Pay</h3>
      <div class="math-row is-aligned">
        <label class="math-field">
          <span class="qr-label is-muted">Rate</span>
          <input
            type="number"
            min="0"
            step="0.01"
            class="math-input"
            {@attach prop('value', () => self.rate)}
            oninput={self.setRate}
          />
        </label>
        <label class="math-field">
          <span class="qr-label is-muted">Per</span>
          <select class="select" onchange={self.setPeriod}>
            {#each self.periods ?? [] as p}
              <option
                value={p?.id}
                {@attach prop('selected', () => eq(self.period, p?.id))}
                >{p?.label}</option
              >
            {/each}
          </select>
        </label>
        <label class="math-field">
          <span class="qr-label is-muted">Currency</span>
          <select class="select" onchange={self.setCurrency}>
            {#each self.currencies ?? [] as c}
              <option
                value={c?.code}
                {@attach prop('selected', () => eq(self.currency, c?.code))}
                >{c?.code}</option
              >
            {/each}
          </select>
        </label>
      </div>

      <div class="math-row is-aligned">
        <label class="math-field">
          <span class="qr-label is-muted">Hours per week</span>
          <input
            type="number"
            min="0"
            class="math-input"
            {@attach prop('value', () => self.hoursPerWeek)}
            oninput={self.setHours}
          />
        </label>
        <label class="math-field">
          <span class="qr-label is-muted">Days per week</span>
          <input
            type="number"
            min="0"
            max="7"
            class="math-input"
            {@attach prop('value', () => self.daysPerWeek)}
            oninput={self.setDays}
          />
        </label>
      </div>

      <label class="math-field">
        <span class="qr-label is-muted">Tax deduction</span>
        <select class="select" onchange={self.setTax}>
          {#each self.taxModels ?? [] as m}
            <option
              value={m?.id}
              {@attach prop('selected', () => eq(self.taxId, m?.id))}
              >{m?.label}</option
            >
          {/each}
        </select>
      </label>
      <p class="tool-hint"
        >Rough estimate only: national/federal brackets for a single filer,
        ignoring local tax, credits, deductions and social contributions. Not
        tax advice.</p
      >
    </section>

    <section class="math-card">
      <h3 class="qr-heading">Gross pay</h3>
      <div class="math-stats">
        <div class="math-stat"
          ><span>Hourly</span><strong
            >{money(self.gross?.hourly, self.symbol)}</strong
          ></div
        >
        <div class="math-stat"
          ><span>Daily</span><strong
            >{money(self.gross?.daily, self.symbol)}</strong
          ></div
        >
        <div class="math-stat"
          ><span>Weekly</span><strong
            >{money(self.gross?.weekly, self.symbol)}</strong
          ></div
        >
        <div class="math-stat"
          ><span>Monthly</span><strong
            >{money(self.gross?.monthly, self.symbol)}</strong
          ></div
        >
        <div class="math-stat"
          ><span>Annually</span><strong
            >{money(self.gross?.annually, self.symbol)}</strong
          ></div
        >
      </div>

      {#if truthy(self.hasTax)}
        <h3 class="qr-heading">Net pay (after estimated tax)</h3>
        <div class="math-stats">
          <div class="math-stat"
            ><span>Hourly</span><strong
              >{money(self.net?.hourly, self.symbol)}</strong
            ></div
          >
          <div class="math-stat"
            ><span>Daily</span><strong
              >{money(self.net?.daily, self.symbol)}</strong
            ></div
          >
          <div class="math-stat"
            ><span>Weekly</span><strong
              >{money(self.net?.weekly, self.symbol)}</strong
            ></div
          >
          <div class="math-stat"
            ><span>Monthly</span><strong
              >{money(self.net?.monthly, self.symbol)}</strong
            ></div
          >
          <div class="math-stat"
            ><span>Annually</span><strong
              >{money(self.net?.annually, self.symbol)}</strong
            ></div
          >
        </div>
        <p class="math-callout is-soft"
          >Estimated annual tax:
          {money(self.annualTax, self.symbol)}
          ({self.effectiveRateText}% effective rate)</p
        >
      {/if}
    </section>
  </div>
</ToolPage>
