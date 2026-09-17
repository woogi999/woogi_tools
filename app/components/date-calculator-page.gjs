import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn, get } from '@ember/helper';
import ToolPage from './tool-page';
import Icon from './icon';
import {
  calendarDiff,
  calendarDays,
  weekdaysBetween,
  parseDateTimeInput,
  toDateTimeInput,
  daysInMonth,
  joinParts,
  plural,
} from '../utils/dates';
import { keepState } from '../utils/tool-state';

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
const newRow = (h = 0, m = 0, s = 0) => ({ id: nextRowId++, sign: 1, h, m, s });

function startOfToday() {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  return d;
}

export default class DateCalculatorPage extends Component {
  tabs = TABS;
  units = UNITS;

  @tracked tab = 'between';

  // Between
  @tracked from = toDateTimeInput(startOfToday());
  @tracked to = toDateTimeInput(
    new Date(startOfToday().getTime() + 30 * 86400000),
  );
  @tracked includeEnd = false;

  // Add / subtract
  @tracked base = toDateTimeInput(startOfToday());
  @tracked direction = 1;
  @tracked amounts = {
    years: 0,
    months: 0,
    weeks: 2,
    days: 0,
    hours: 0,
    minutes: 0,
  };

  // Durations
  @tracked rows = [newRow(1, 30), newRow(0, 45)];

  setTab = (id) => (this.tab = id);

  constructor(owner, args) {
    super(owner, args);
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

  <template>
    <ToolPage
      @route="date-calculator"
      @subtitle="Count the time between two dates, jump a date forwards or back, or add up a pile of durations."
    >
      <div class="math-stack pop-in">
        <div class="math-tabs" role="tablist">
          {{#each this.tabs as |t|}}
            <button
              type="button"
              role="tab"
              class="qr-tab {{if (eq this.tab t.id) 'active'}}"
              aria-selected={{if (eq this.tab t.id) "true" "false"}}
              {{on "click" (fn this.setTab t.id)}}
            >{{t.label}}</button>
          {{/each}}
        </div>

        {{#if (eq this.tab "between")}}
          <section class="math-card qr-mode-panel">
            <div class="math-row is-aligned">
              <label class="math-field"><span
                  class="qr-label is-muted"
                >From</span><input
                  type="datetime-local"
                  class="math-input"
                  value={{this.from}}
                  {{on "input" this.setFrom}}
                /></label>
              <button
                type="button"
                class="btn math-swap"
                aria-label="Swap dates"
                {{on "click" this.swap}}
              ><Icon @name="rotate-ccw" @size={{14}} /></button>
              <label class="math-field"><span
                  class="qr-label is-muted"
                >To</span><input
                  type="datetime-local"
                  class="math-input"
                  value={{this.to}}
                  {{on "input" this.setTo}}
                /></label>
            </div>
            <label class="math-check">
              <input
                type="checkbox"
                checked={{this.includeEnd}}
                {{on "change" this.toggleIncludeEnd}}
              />
              Include the end day
            </label>
            {{#if this.between.error}}
              <p class="tool-error">{{this.between.error}}</p>
            {{else}}
              <div class="math-result">
                <span class="qr-label is-muted">Difference{{if
                    this.between.reversed
                    " (end is before start)"
                  }}</span>
                <span class="math-big is-medium">{{this.between.summary}}</span>
              </div>
              <div class="math-stats">
                {{#each this.between.stats as |stat|}}
                  <div class="math-stat"><span>{{get stat 0}}</span><strong
                    >{{get stat 1}}</strong></div>
                {{/each}}
              </div>
            {{/if}}
          </section>
        {{else if (eq this.tab "add")}}
          <section class="math-card qr-mode-panel">
            <div class="math-row is-aligned">
              <label class="math-field"><span
                  class="qr-label is-muted"
                >Start</span><input
                  type="datetime-local"
                  class="math-input"
                  value={{this.base}}
                  {{on "input" this.setBase}}
                /></label>
              <div class="mode-toggle" role="group" aria-label="Direction">
                <button
                  type="button"
                  class="btn {{if (eq this.direction 1) 'active'}}"
                  {{on "click" (fn this.setDirection 1)}}
                >Add</button>
                <button
                  type="button"
                  class="btn {{if (eq this.direction -1) 'active'}}"
                  {{on "click" (fn this.setDirection -1)}}
                >Subtract</button>
              </div>
            </div>
            <div class="math-units">
              {{#each this.units as |unit|}}
                <label class="math-field"><span
                    class="qr-label is-muted"
                  >{{unit.label}}</span><input
                    type="number"
                    min="0"
                    class="math-input"
                    value={{get this.amounts unit.key}}
                    {{on "input" (fn this.setAmount unit.key)}}
                  /></label>
              {{/each}}
            </div>
            {{#if this.added.error}}
              <p class="tool-error">{{this.added.error}}</p>
            {{else}}
              <div class="math-result">
                <span class="qr-label is-muted">Result</span>
                <span class="math-big is-medium">{{this.added.text}}</span>
                <span class="math-sub">{{this.added.offset}}</span>
              </div>
              <button
                type="button"
                class="btn math-use"
                {{on "click" this.useResult}}
              >Use as start</button>
            {{/if}}
          </section>
        {{else}}
          <section class="math-card qr-mode-panel">
            <div class="dur-list">
              <div class="dur-row dur-head" aria-hidden="true"><span
                ></span><span>Hours</span><span>Minutes</span><span
                >Seconds</span><span></span></div>
              {{#each this.rows as |row|}}
                <div class="dur-row">
                  <div
                    class="mode-toggle dur-sign"
                    role="group"
                    aria-label="Add or subtract"
                  >
                    <button
                      type="button"
                      class="btn {{if (eq row.sign 1) 'active'}}"
                      aria-label="Add"
                      {{on "click" (fn this.updateRow row.id "sign" 1)}}
                    >+</button>
                    <button
                      type="button"
                      class="btn {{if (eq row.sign -1) 'active'}}"
                      aria-label="Subtract"
                      {{on "click" (fn this.updateRow row.id "sign" -1)}}
                    >−</button>
                  </div>
                  <input
                    type="number"
                    min="0"
                    class="math-input"
                    aria-label="Hours"
                    value={{row.h}}
                    {{on "input" (fn this.updateRow row.id "h")}}
                  />
                  <input
                    type="number"
                    min="0"
                    class="math-input"
                    aria-label="Minutes"
                    value={{row.m}}
                    {{on "input" (fn this.updateRow row.id "m")}}
                  />
                  <input
                    type="number"
                    min="0"
                    class="math-input"
                    aria-label="Seconds"
                    value={{row.s}}
                    {{on "input" (fn this.updateRow row.id "s")}}
                  />
                  <button
                    type="button"
                    class="fs-remove"
                    aria-label="Remove row"
                    {{on "click" (fn this.removeRow row.id)}}
                  ><Icon @name="x" @size={{13}} /></button>
                </div>
              {{/each}}
            </div>
            <button
              type="button"
              class="btn math-use"
              {{on "click" this.addRow}}
            ><Icon @name="plus" @size={{13}} /> Add time</button>
            <div class="math-result">
              <span class="qr-label is-muted">Total</span>
              <span class="math-big">{{this.total.clock}}</span>
            </div>
            <div class="math-stats">
              <div class="math-stat"><span>Hours</span><strong
                >{{this.total.hours}}</strong></div>
              <div class="math-stat"><span>Minutes</span><strong
                >{{this.total.minutes}}</strong></div>
              <div class="math-stat"><span>Seconds</span><strong
                >{{this.total.seconds}}</strong></div>
            </div>
          </section>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}
