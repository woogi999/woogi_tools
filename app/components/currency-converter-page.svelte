<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import { keepState } from '../utils/tool-state.js';

  // Frankfurter's v2 API, which is the one that is actually live: the old
  // api.frankfurter.app host now answers every request with a 301 to this one.
  const API = 'https://api.frankfurter.dev/v2';
  // Used only until the first response lands, and if the service is unreachable.
  const FALLBACK_RATES = {
    USD: 1,
    EUR: 0.92,
    GBP: 0.79,
    JPY: 150.2,
    CAD: 1.36,
    AUD: 1.53,
    CHF: 0.88,
    CNY: 7.24,
    INR: 83.1,
    PHP: 56.4,
    SGD: 1.34,
    NZD: 1.66,
  };
  const FALLBACK_NAMES = Object.fromEntries(
    Object.keys(FALLBACK_RATES).map((code) => [code, code]),
  );
  // The currencies the comparison list starts with. Listing all 165 was a wall of
  // numbers nobody reads, so you pick the handful you actually care about.
  const DEFAULT_WATCH = ['EUR', 'GBP', 'JPY', 'PHP'];

  const eq = (a, b) => a === b;

  function formatCurrency(value, currency) {
    if (!Number.isFinite(value)) return '-';
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
      }).format(value);
    } catch {
      // A code Intl doesn't know: show the number and the code instead.
      return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;
    }
  }

  class CurrencyConverterPage extends Component {
    currencies = $state.raw(Object.keys(FALLBACK_RATES));
    names = $state.raw(FALLBACK_NAMES);
    rates = $state.raw(FALLBACK_RATES);
    history = $state.raw([]);
    loading = $state.raw(true);
    historyLoading = $state.raw(false);
    error = $state.raw('');
    asOf = $state.raw('');

    amount = $state.raw('100');
    fromCurrency = $state.raw('USD');
    toCurrency = $state.raw('EUR');
    watch = $state.raw(DEFAULT_WATCH);

    requestId = 0;

    constructor(args) {
      super(args);
      registerDestructor(this, () => this.abort?.abort());
      // The first fetch waits for the restore, so the chart asks for the pair you
      // were last looking at rather than the default one.
      keepState(
        this,
        'currency-converter',
        ['amount', 'fromCurrency', 'toCurrency', 'watch'],
        () => this.loadRates(),
      );
    }

    loadRates = async () => {
      const id = ++this.requestId;
      this.loading = true;
      this.error = '';
      this.abort?.abort();
      this.abort = new AbortController();
      try {
        const [ratesResponse, currenciesResponse] = await Promise.all([
          fetch(`${API}/rates?base=USD`, { signal: this.abort.signal }),
          fetch(`${API}/currencies`, { signal: this.abort.signal }),
        ]);
        if (!ratesResponse.ok || !currenciesResponse.ok)
          throw new Error('The exchange-rate service is unavailable.');
        const [rows, currencies] = await Promise.all([
          ratesResponse.json(),
          currenciesResponse.json(),
        ]);
        if (id !== this.requestId || !Array.isArray(rows) || !rows.length)
          throw new Error('The exchange-rate service sent nothing back.');
        // v2 answers with one flat row per currency: { date, base, quote, rate }.
        this.rates = {
          USD: 1,
          ...Object.fromEntries(rows.map((row) => [row.quote, row.rate])),
        };
        this.currencies = Object.keys(this.rates).sort();
        this.names = {
          ...FALLBACK_NAMES,
          ...Object.fromEntries(
            (currencies ?? []).map((c) => [c.iso_code, c.name]),
          ),
        };
        this.asOf = rows[0]?.date ?? '';
        await this.loadHistory(id);
      } catch (error) {
        if (error.name !== 'AbortError' && id === this.requestId)
          this.error =
            'Live rates unavailable. Showing the last built-in reference rates.';
      } finally {
        if (id === this.requestId) this.loading = false;
      }
    };

    // The chart asks for the chosen pair directly, so there is no cross-rate to work out.
    loadHistory = async (id = this.requestId) => {
      const end = new Date();
      const start = new Date(end);
      start.setDate(start.getDate() - 30);
      const date = (value) => value.toISOString().slice(0, 10);
      const from = this.fromCurrency;
      const to = this.toCurrency;
      this.historyLoading = true;
      try {
        if (from === to) throw new Error('Same currency');
        const response = await fetch(
          `${API}/rates?base=${from}&quotes=${to}&from=${date(start)}&to=${date(end)}`,
        );
        if (!response.ok) throw new Error('History unavailable');
        const rows = await response.json();
        if (id !== this.requestId || !Array.isArray(rows)) return;
        this.history = rows
          .filter((row) => Number.isFinite(row.rate))
          .map((row) => ({ day: row.date, rate: row.rate }))
          .sort((a, b) => a.day.localeCompare(b.day));
      } catch {
        if (id === this.requestId) this.history = [];
      } finally {
        if (id === this.requestId) this.historyLoading = false;
      }
    };

    rateFor = (currency) => (currency === 'USD' ? 1 : this.rates[currency]);

    convert = (amount, from, to) => {
      const a = this.rateFor(from);
      const b = this.rateFor(to);
      return a && b ? (amount * b) / a : NaN;
    };

    get numericAmount() {
      const value = Number(this.amount);
      return Number.isFinite(value) && value >= 0 ? value : null;
    }

    get result() {
      if (this.numericAmount === null) return null;
      const value = this.convert(
        this.numericAmount,
        this.fromCurrency,
        this.toCurrency,
      );
      return Number.isFinite(value) ? value : null;
    }

    get resultText() {
      return formatCurrency(this.result, this.toCurrency);
    }

    // "1 USD = 62.7520 PHP": the number people actually want to check.
    get unitRateText() {
      const rate = this.convert(1, this.fromCurrency, this.toCurrency);
      if (!Number.isFinite(rate)) return '';
      return `1 ${this.fromCurrency} = ${rate.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${this.toCurrency}`;
    }

    nameFor = (currency) => this.names[currency] ?? currency;

    get sourceText() {
      const source = 'European Central Bank reference rates, via Frankfurter.';
      return this.asOf ? `${source} Published ${this.asOf}.` : source;
    }

    // Only the currencies you chose to watch, and never the one you're converting from.
    get watchRows() {
      if (this.numericAmount === null) return [];
      return this.watch
        .filter((currency) => currency !== this.fromCurrency)
        .map((currency) => ({
          currency,
          name: this.nameFor(currency),
          value: formatCurrency(
            this.convert(this.numericAmount, this.fromCurrency, currency),
            currency,
          ),
        }));
    }

    // What's left to add, minus the ones already listed.
    get addable() {
      return this.currencies.filter((c) => !this.watch.includes(c));
    }

    setAmount = (event) => (this.amount = event.target.value);

    setFromCurrency = (event) => {
      this.fromCurrency = event.target.value;
      this.loadHistory();
    };

    setToCurrency = (event) => {
      this.toCurrency = event.target.value;
      this.loadHistory();
    };

    swap = () => {
      [this.fromCurrency, this.toCurrency] = [
        this.toCurrency,
        this.fromCurrency,
      ];
      this.loadHistory();
    };

    addWatch = (event) => {
      const code = event.target.value;
      if (code && !this.watch.includes(code))
        this.watch = [...this.watch, code];
      event.target.value = '';
    };

    removeWatch = (code) => (this.watch = this.watch.filter((c) => c !== code));
    resetWatch = () => (this.watch = DEFAULT_WATCH);

    // Sizing and theme changes redraw directly rather than through reactive
    // state: the chart is drawn on a canvas, so there is nothing for a state
    // change to re-render.
    setupChart = modifier((canvas) => {
      const resize = () => {
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.round(canvas.clientWidth * ratio);
        canvas.height = Math.round(canvas.clientHeight * ratio);
        this.drawChart(canvas, this.history);
      };
      const observer = new ResizeObserver(resize);
      observer.observe(canvas);
      const theme = new MutationObserver(resize);
      theme.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });
      resize();
      return () => {
        observer.disconnect();
        theme.disconnect();
      };
    });

    redrawChart = modifier((canvas, [history]) => {
      this.drawChart(canvas, history);
    });

    drawChart(canvas, history) {
      const ctx = canvas.getContext('2d');
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const styles = getComputedStyle(canvas);
      const colour = (name) => styles.getPropertyValue(name).trim();
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (history.length < 2) return;
      const values = history.map((point) => point.rate);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const padding = Math.max((max - min) * 0.15, max * 0.001);
      const low = min - padding;
      const high = max + padding;
      const x = (index) => (index / (history.length - 1)) * width;
      const y = (value) => height - ((value - low) / (high - low)) * height;
      ctx.beginPath();
      history.forEach((point, index) =>
        index
          ? ctx.lineTo(x(index), y(point.rate))
          : ctx.moveTo(x(index), y(point.rate)),
      );
      ctx.strokeStyle = colour('--accent');
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.fillStyle = colour('--text-faint');
      ctx.font = `11px ${styles.getPropertyValue('--font-mono') || 'monospace'}`;
      ctx.fillText(formatCurrency(min, this.toCurrency), 6, height - 6);
      ctx.textAlign = 'right';
      ctx.fillText(formatCurrency(max, this.toCurrency), width - 6, 14);
      ctx.textAlign = 'left';
    }
  }
</script>

<script>
  let args = $props();
  const self = new CurrencyConverterPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="currency-converter"
  subtitle="Convert currencies at the latest published rates and see how your pair moved over the last 30 days."
>
  <div class="cc-page pop-in">
    <section class="cc-convert">
      <div class="cc-row">
        <label class="cc-field cc-amount">
          <span class="qr-label is-muted">Amount</span>
          <input
            type="number"
            min="0"
            step="any"
            class="math-input"
            {@attach prop('value', () => self.amount)}
            oninput={self.setAmount}
          />
        </label>
        <label class="cc-field">
          <span class="qr-label is-muted">From</span>
          <select class="select" onchange={self.setFromCurrency}>
            {#each self.currencies ?? [] as currency}
              <option
                value={currency}
                {@attach prop('selected', () =>
                  eq(self.fromCurrency, currency),
                )}>{currency} · {self.nameFor(currency)}</option
              >
            {/each}
          </select>
        </label>
        <button
          type="button"
          class="btn cc-swap"
          aria-label="Swap currencies"
          title="Swap currencies"
          onclick={self.swap}><Icon name="arrow-right-left" size={14} /></button
        >
        <label class="cc-field">
          <span class="qr-label is-muted">To</span>
          <select class="select" onchange={self.setToCurrency}>
            {#each self.currencies ?? [] as currency}
              <option
                value={currency}
                {@attach prop('selected', () => eq(self.toCurrency, currency))}
                >{currency} · {self.nameFor(currency)}</option
              >
            {/each}
          </select>
        </label>
      </div>

      <div class="cc-result">
        <span class="cc-from">{self.amount} {self.fromCurrency}</span>
        <span class="cc-equals">=</span>
        <strong class="cc-big">{self.resultText}</strong>
        {#if truthy(self.unitRateText)}
          <span class="cc-unit">{self.unitRateText}</span>
        {/if}
      </div>

      <p class="tool-hint cc-source">
        {truthy(self.loading)
          ? 'Getting the latest rate…'
          : truthy(self.error)
            ? self.error
            : self.sourceText}
      </p>
    </section>

    <section class="cc-chart-section">
      <div class="cc-head">
        <h3 class="qr-heading"
          >{self.fromCurrency}
          /
          {self.toCurrency}</h3
        >
        <span class="tool-hint">Last 30 days</span>
      </div>
      {#if truthy(self.history?.length)}
        <div class="cc-chart-wrap">
          <canvas
            class="cc-chart"
            aria-label="{self.fromCurrency} to {self.toCurrency} exchange rate over the last 30 days"
            {@attach self.setupChart?.()}
            {@attach self.redrawChart?.([self.history])}
          ></canvas>
        </div>
      {:else if truthy(self.historyLoading)}
        <p class="fs-empty">Loading rate history…</p>
      {:else}
        <p class="fs-empty">Rate history is unavailable for this pair.</p>
      {/if}
    </section>

    <section class="cc-watch-section">
      <div class="cc-head">
        <h3 class="qr-heading"
          >{self.amount}
          {self.fromCurrency}
          also equals</h3
        >
        <div class="cc-watch-tools">
          <select
            class="select cc-add"
            aria-label="Add a currency to the list"
            onchange={self.addWatch}
          >
            <option value="">Add a currency…</option>
            {#each self.addable ?? [] as currency}
              <option value={currency}
                >{currency}
                ·
                {self.nameFor(currency)}</option
              >
            {/each}
          </select>
          <button
            type="button"
            class="btn"
            aria-label="Reset the list"
            title="Back to the default list"
            onclick={self.resetWatch}
            ><Icon name="rotate-ccw" size={13} /></button
          >
        </div>
      </div>

      {#if truthy(self.watchRows?.length)}
        <ul class="cc-watch">
          {#each self.watchRows ?? [] as row}
            <li class="cc-watch-row">
              <span class="cc-watch-name">
                <strong>{row?.currency}</strong>
                <span class="tool-hint">{row?.name}</span>
              </span>
              <span class="cc-watch-value">{row?.value}</span>
              <button
                type="button"
                class="qr-icon-btn"
                aria-label="Remove {row?.currency} from the list"
                title="Remove"
                onclick={(..._r) => self.removeWatch(row?.currency, ..._r)}
                ><Icon name="x" size={12} /></button
              >
            </li>
          {/each}
        </ul>
      {:else}
        <p class="fs-empty"
          >Nothing on the list. Add a currency above to compare against it.</p
        >
      {/if}
    </section>
  </div>
</ToolPage>
