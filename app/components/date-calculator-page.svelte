<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import {
    calendarDiff,
    calendarDays,
    weekdaysBetween,
    parseDateTimeInput,
    toDateTimeInput,
    daysInMonth,
    joinParts,
    plural,
  } from '../utils/dates.js';
  import { keepState } from '../utils/tool-state.js';

  const eq = (a, b) => a === b;
  const fullDate = (d) =>
    d.toLocaleString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  const num = (value) => (Number.isFinite(+value) ? +value : 0);

  const TABS = [
    { id: 'between', label: 'Between dates' },
    { id: 'add', label: 'Add / subtract' },
    { id: 'durations', label: 'Add up times' },
  ];

  const UNITS = [
    { key: 'years', label: 'Years' },
    { key: 'months', label: 'Months' },
    { key: 'weeks', label: 'Weeks' },
    { key: 'days', label: 'Days' },
    { key: 'hours', label: 'Hours' },
    { key: 'minutes', label: 'Minutes' },
  ];

  let nextRowId = 1;
  const newRow = (h = 0, m = 0, s = 0) => ({
    id: nextRowId++,
    sign: 1,
    h,
    m,
    s,
  });

  function startOfToday() {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    return d;
  }

  class DateCalculatorPage extends Component {
    tabs = TABS;
    units = UNITS;

    tab = $state.raw('between');

    // Between
    from = $state.raw(toDateTimeInput(startOfToday()));
    to = $state.raw(
      toDateTimeInput(new Date(startOfToday().getTime() + 30 * 86400000)),
    );
    includeEnd = $state.raw(false);

    // Add / subtract
    base = $state.raw(toDateTimeInput(startOfToday()));
    direction = $state.raw(1);
    amounts = $state.raw({
      years: 0,
      months: 0,
      weeks: 2,
      days: 0,
      hours: 0,
      minutes: 0,
    });

    // Durations
    rows = $state.raw([newRow(1, 30), newRow(0, 45)]);

    setTab = (id) => (this.tab = id);

    constructor(args) {
      super(args);
      keepState(this, 'date-calculator', ['tab', 'includeEnd', 'direction']);
    }

    // ─── Between ─────────────────────────────────────────────────────────

    get between() {
      let a = parseDateTimeInput(this.from);
      let b = parseDateTimeInput(this.to);
      if (!a || !b) return { error: 'Pick both dates.' };
      const reversed = a > b;
      if (reversed) [a, b] = [b, a];
      const end = this.includeEnd
        ? new Date(
            b.getFullYear(),
            b.getMonth(),
            b.getDate() + 1,
            b.getHours(),
            b.getMinutes(),
          )
        : b;
      const diff = calendarDiff(a, end, false);
      const minutes = Math.round((end - a) / 60000);
      const days = calendarDays(a, end);
      return {
        reversed,
        summary: joinParts([
          [diff.years, 'year'],
          [diff.months, 'month'],
          [diff.days, 'day'],
          [diff.hours, 'hour'],
          [diff.minutes, 'minute'],
        ]),
        stats: [
          ['Days', days.toLocaleString()],
          [
            'Weeks',
            `${Math.floor(days / 7).toLocaleString()}${days % 7 ? ` + ${days % 7}d` : ''}`,
          ],
          ['Weekdays', weekdaysBetween(a, end).toLocaleString()],
          ['Hours', parseFloat((minutes / 60).toFixed(2)).toLocaleString()],
          ['Minutes', minutes.toLocaleString()],
          ['Seconds', (minutes * 60).toLocaleString()],
        ],
      };
    }

    setFrom = (e) => (this.from = e.target.value);
    setTo = (e) => (this.to = e.target.value);
    toggleIncludeEnd = (e) => (this.includeEnd = e.target.checked);
    swap = () => ([this.from, this.to] = [this.to, this.from]);

    // ─── Add / subtract ──────────────────────────────────────────────────

    get added() {
      const start = parseDateTimeInput(this.base);
      if (!start) return { error: 'Pick a starting date.' };
      const { years, months, weeks, days, hours, minutes } = this.amounts;
      const sign = this.direction;
      // Move by months first and clamp the day, so Jan 31 + 1 month = end of February.
      const totalMonths = start.getMonth() + sign * (years * 12 + months);
      const year = start.getFullYear() + Math.floor(totalMonths / 12);
      const month = ((totalMonths % 12) + 12) % 12;
      const day = Math.min(start.getDate(), daysInMonth(year, month));
      const result = new Date(
        year,
        month,
        day + sign * (weeks * 7 + days),
        start.getHours() + sign * hours,
        start.getMinutes() + sign * minutes,
      );
      const offset = calendarDays(start, result);
      return {
        text: fullDate(result),
        offset: offset
          ? `${plural(Math.abs(offset), 'calendar day')} ${offset > 0 ? 'later' : 'earlier'}`
          : 'Same day',
        value: toDateTimeInput(result),
      };
    }

    setBase = (e) => (this.base = e.target.value);
    setDirection = (d) => (this.direction = d);
    setAmount = (key, e) =>
      (this.amounts = {
        ...this.amounts,
        [key]: Math.max(0, Math.floor(num(e.target.value))),
      });
    useResult = () => (this.base = this.added.value);

    // ─── Durations ───────────────────────────────────────────────────────

    get total() {
      const seconds = Math.round(
        this.rows.reduce(
          (sum, r) => sum + r.sign * (r.h * 3600 + r.m * 60 + r.s),
          0,
        ),
      );
      const abs = Math.abs(seconds);
      const pad = (n) => String(n).padStart(2, '0');
      return {
        clock: `${seconds < 0 ? '−' : ''}${Math.floor(abs / 3600)}:${pad(Math.floor(abs / 60) % 60)}:${pad(abs % 60)}`,
        hours: parseFloat((seconds / 3600).toFixed(4)).toLocaleString(),
        minutes: parseFloat((seconds / 60).toFixed(2)).toLocaleString(),
        seconds: seconds.toLocaleString(),
      };
    }

    updateRow = (id, key, e) => {
      const value = key === 'sign' ? e : Math.max(0, num(e.target.value));
      this.rows = this.rows.map((r) =>
        r.id === id ? { ...r, [key]: value } : r,
      );
    };
    addRow = () => (this.rows = [...this.rows, newRow()]);
    removeRow = (id) => (this.rows = this.rows.filter((r) => r.id !== id));
  }
</script>

<script>
  let args = $props();
  const self = new DateCalculatorPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="date-calculator"
  subtitle="Count the time between two dates, jump a date forwards or back, or add up a pile of durations."
>
  <div class="math-stack pop-in">
    <div class="math-tabs" role="tablist">
      {#each self.tabs ?? [] as t}
        <button
          type="button"
          role="tab"
          class="qr-tab {truthy(eq(self.tab, t?.id)) ? 'active' : ''}"
          aria-selected={truthy(eq(self.tab, t?.id)) ? 'true' : 'false'}
          onclick={(..._r) => self.setTab(t?.id, ..._r)}>{t?.label}</button
        >
      {/each}
    </div>

    {#if truthy(eq(self.tab, 'between'))}
      <section class="math-card qr-mode-panel">
        <div class="math-row is-aligned">
          <label class="math-field"
            ><span class="qr-label is-muted">From</span><input
              type="datetime-local"
              class="math-input"
              {@attach prop('value', () => self.from)}
              oninput={self.setFrom}
            /></label
          >
          <button
            type="button"
            class="btn math-swap"
            aria-label="Swap dates"
            onclick={self.swap}><Icon name="rotate-ccw" size={14} /></button
          >
          <label class="math-field"
            ><span class="qr-label is-muted">To</span><input
              type="datetime-local"
              class="math-input"
              {@attach prop('value', () => self.to)}
              oninput={self.setTo}
            /></label
          >
        </div>
        <label class="math-check">
          <input
            type="checkbox"
            {@attach prop('checked', () => self.includeEnd)}
            onchange={self.toggleIncludeEnd}
          />
          Include the end day
        </label>
        {#if truthy(self.between?.error)}
          <p class="tool-error">{self.between?.error}</p>
        {:else}
          <div class="math-result">
            <span class="qr-label is-muted"
              >Difference{truthy(self.between?.reversed)
                ? ' (end is before start)'
                : ''}</span
            >
            <span class="math-big is-medium">{self.between?.summary}</span>
          </div>
          <div class="math-stats">
            {#each self.between?.stats ?? [] as stat}
              <div class="math-stat"
                ><span>{stat?.[0]}</span><strong>{stat?.[1]}</strong></div
              >
            {/each}
          </div>
        {/if}
      </section>
    {:else if truthy(eq(self.tab, 'add'))}
      <section class="math-card qr-mode-panel">
        <div class="math-row is-aligned">
          <label class="math-field"
            ><span class="qr-label is-muted">Start</span><input
              type="datetime-local"
              class="math-input"
              {@attach prop('value', () => self.base)}
              oninput={self.setBase}
            /></label
          >
          <div class="mode-toggle" role="group" aria-label="Direction">
            <button
              type="button"
              class="btn {truthy(eq(self.direction, 1)) ? 'active' : ''}"
              onclick={(..._r) => self.setDirection(1, ..._r)}>Add</button
            >
            <button
              type="button"
              class="btn {truthy(eq(self.direction, -1)) ? 'active' : ''}"
              onclick={(..._r) => self.setDirection(-1, ..._r)}>Subtract</button
            >
          </div>
        </div>
        <div class="math-units">
          {#each self.units ?? [] as unit}
            <label class="math-field"
              ><span class="qr-label is-muted">{unit?.label}</span><input
                type="number"
                min="0"
                class="math-input"
                {@attach prop('value', () => self.amounts?.[unit?.key])}
                oninput={(..._r) => self.setAmount(unit?.key, ..._r)}
              /></label
            >
          {/each}
        </div>
        {#if truthy(self.added?.error)}
          <p class="tool-error">{self.added?.error}</p>
        {:else}
          <div class="math-result">
            <span class="qr-label is-muted">Result</span>
            <span class="math-big is-medium">{self.added?.text}</span>
            <span class="math-sub">{self.added?.offset}</span>
          </div>
          <button type="button" class="btn math-use" onclick={self.useResult}
            >Use as start</button
          >
        {/if}
      </section>
    {:else}
      <section class="math-card qr-mode-panel">
        <div class="dur-list">
          <div class="dur-row dur-head" aria-hidden="true"
            ><span></span><span>Hours</span><span>Minutes</span><span
              >Seconds</span
            ><span></span></div
          >
          {#each self.rows ?? [] as row}
            <div class="dur-row">
              <div
                class="mode-toggle dur-sign"
                role="group"
                aria-label="Add or subtract"
              >
                <button
                  type="button"
                  class="btn {truthy(eq(row?.sign, 1)) ? 'active' : ''}"
                  aria-label="Add"
                  onclick={(..._r) => self.updateRow(row?.id, 'sign', 1, ..._r)}
                  >+</button
                >
                <button
                  type="button"
                  class="btn {truthy(eq(row?.sign, -1)) ? 'active' : ''}"
                  aria-label="Subtract"
                  onclick={(..._r) =>
                    self.updateRow(row?.id, 'sign', -1, ..._r)}>−</button
                >
              </div>
              <input
                type="number"
                min="0"
                class="math-input"
                aria-label="Hours"
                {@attach prop('value', () => row?.h)}
                oninput={(..._r) => self.updateRow(row?.id, 'h', ..._r)}
              />
              <input
                type="number"
                min="0"
                class="math-input"
                aria-label="Minutes"
                {@attach prop('value', () => row?.m)}
                oninput={(..._r) => self.updateRow(row?.id, 'm', ..._r)}
              />
              <input
                type="number"
                min="0"
                class="math-input"
                aria-label="Seconds"
                {@attach prop('value', () => row?.s)}
                oninput={(..._r) => self.updateRow(row?.id, 's', ..._r)}
              />
              <button
                type="button"
                class="fs-remove"
                aria-label="Remove row"
                onclick={(..._r) => self.removeRow(row?.id, ..._r)}
                ><Icon name="x" size={13} /></button
              >
            </div>
          {/each}
        </div>
        <button type="button" class="btn math-use" onclick={self.addRow}
          ><Icon name="plus" size={13} /> Add time</button
        >
        <div class="math-result">
          <span class="qr-label is-muted">Total</span>
          <span class="math-big">{self.total?.clock}</span>
        </div>
        <div class="math-stats">
          <div class="math-stat"
            ><span>Hours</span><strong>{self.total?.hours}</strong></div
          >
          <div class="math-stat"
            ><span>Minutes</span><strong>{self.total?.minutes}</strong></div
          >
          <div class="math-stat"
            ><span>Seconds</span><strong>{self.total?.seconds}</strong></div
          >
        </div>
      </section>
    {/if}
  </div>
</ToolPage>
