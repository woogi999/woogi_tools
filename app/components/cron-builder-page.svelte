<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import CopyButton from './copy-button.svelte';
  import { describeCron, CRON_PRESETS } from '../utils/cron.js';
  import { keepState } from '../utils/tool-state.js';

  function nextRuns(expr, count = 5) {
    // A small brute-force matcher: walk minute by minute rather than
    // implementing a full cron scheduler, which is plenty fast for a preview.
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return [];
    const [mi, hr, dom, mo, dow] = parts;
    const matches = (value, field) =>
      field === '*' || field.split(',').some((tok) => matchToken(value, tok));
    function matchToken(value, tok) {
      const [range, step] = tok.split('/');
      const s = step ? Number(step) : 1;
      if (range === '*') return value % s === 0;
      if (range.includes('-')) {
        const [a, b] = range.split('-').map(Number);
        return value >= a && value <= b && (value - a) % s === 0;
      }
      return value === Number(range);
    }

    const results = [];
    const date = new Date();
    date.setSeconds(0, 0);
    date.setMinutes(date.getMinutes() + 1);
    let guard = 0;
    while (results.length < count && guard < 60 * 24 * 366) {
      guard++;
      const domOk = matches(date.getDate(), dom);
      const dowOk =
        matches(date.getDay(), dow) || matches(date.getDay() + 7, dow);
      if (
        matches(date.getMinutes(), mi) &&
        matches(date.getHours(), hr) &&
        matches(date.getMonth() + 1, mo) &&
        domOk &&
        dowOk
      ) {
        results.push(new Date(date));
      }
      date.setMinutes(date.getMinutes() + 1);
    }
    return results;
  }

  class CronBuilderPage extends Component {
    presets = CRON_PRESETS;

    expr = $state.raw('0 9 * * 1-5');

    constructor(args) {
      super(args);
      keepState(this, 'cron-builder', ['expr']);
    }

    get result() {
      try {
        return { description: describeCron(this.expr).text };
      } catch (error) {
        return { error: error.message };
      }
    }

    get upcoming() {
      if (this.result.error) return [];
      try {
        return nextRuns(this.expr);
      } catch {
        return [];
      }
    }

    setExpr = (e) => (this.expr = e.target.value);
    usePreset = (expr) => (this.expr = expr);
  }

  function formatDate(d) {
    return d.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
</script>

<script>
  let args = $props();
  const self = new CronBuilderPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="cron-builder"
  subtitle="Write a cron expression and see what it means in plain words, plus when it runs next. No more guessing."
>
  <div class="math-grid pop-in">
    <section class="math-card">
      <div class="field-head">
        <label class="field-label" for="cron-input">Cron expression</label>
        <CopyButton value={self.expr} />
      </div>
      <input
        id="cron-input"
        type="text"
        class="math-input is-mono"
        spellcheck="false"
        {@attach prop('value', () => self.expr)}
        oninput={self.setExpr}
      />

      {#if truthy(self.result?.error)}
        <p class="tool-error">{self.result?.error}</p>
      {:else}
        <p class="math-callout">{self.result?.description}</p>
      {/if}

      <h3 class="qr-heading">Presets</h3>
      <div class="line-actions">
        {#each self.presets ?? [] as p}
          <button
            type="button"
            class="btn"
            onclick={(..._r) => self.usePreset(p?.expr, ..._r)}
            >{p?.label}</button
          >
        {/each}
      </div>
    </section>

    <section class="math-card">
      <h3 class="qr-heading">Next runs</h3>
      {#if truthy(self.upcoming?.length)}
        <div class="math-stats">
          {#each self.upcoming ?? [] as d}
            <div class="math-stat"><span>{formatDate(d)}</span></div>
          {/each}
        </div>
      {:else}
        <p class="tool-hint"
          >Fix the expression above to see upcoming run times.</p
        >
      {/if}
      <p class="tool-hint"
        >Fields are minute, hour, day-of-month, month, day-of-week (0 and 7 both
        mean Sunday). Use commas for lists, hyphens for ranges and a slash for
        steps.</p
      >
    </section>
  </div>
</ToolPage>
