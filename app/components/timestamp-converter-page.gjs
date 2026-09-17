import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { keepState } from '../utils/tool-state';

const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const ALL_ZONES =
  typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : ['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo'];
const DEFAULT_ZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/New_York',
  'Europe/London',
  'Asia/Manila',
  'Asia/Tokyo',
];

// Guesses the unit from the number of digits: 10 → seconds, 13 → ms, 16 → µs, 19 → ns.
function parseInput(raw) {
  const text = raw.trim();
  if (!text) return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    const digits = text.replace(/^-/, '').split('.')[0].length;
    if (digits <= 11) return { date: new Date(n * 1000), unit: 'seconds' };
    if (digits <= 14) return { date: new Date(n), unit: 'milliseconds' };
    if (digits <= 17) return { date: new Date(n / 1000), unit: 'microseconds' };
    return { date: new Date(n / 1e6), unit: 'nanoseconds' };
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime())
    ? { error: "Couldn't read that as a timestamp or date" }
    : { date, unit: 'date text' };
}

function isoWeek(date) {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function relative(ms, now) {
  const diff = ms - now;
  const abs = Math.abs(diff);
  const units = [
    ['year', 31536000000],
    ['month', 2592000000],
    ['week', 604800000],
    ['day', 86400000],
    ['hour', 3600000],
    ['minute', 60000],
    ['second', 1000],
  ];
  const [unit, size] = units.find(([, s]) => abs >= s) ?? ['second', 1000];
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(
    Math.round(diff / size),
    unit,
  );
}

const zoneFormatter = (timeZone) =>
  new Intl.DateTimeFormat(undefined, {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'long',
  });

// Discord renders <t:UNIX:STYLE> as a localised, live-updating timestamp.
const DISCORD_STYLES = [
  { code: 't', label: 'Short time' },
  { code: 'T', label: 'Long time' },
  { code: 'd', label: 'Short date' },
  { code: 'D', label: 'Long date' },
  { code: 'f', label: 'Short date/time' },
  { code: 'F', label: 'Long date/time' },
  { code: 'R', label: 'Relative' },
];

function toDatetimeLocal(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export default class TimestampConverterPage extends Component {
  zones = ALL_ZONES;

  @tracked input = String(Math.floor(Date.now() / 1000));
  @tracked now = Date.now();
  @tracked shownZones = DEFAULT_ZONES.includes(LOCAL_ZONE)
    ? DEFAULT_ZONES
    : [LOCAL_ZONE, ...DEFAULT_ZONES];

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'timestamp-converter', ['input', 'shownZones']);
    const tick = setInterval(() => (this.now = Date.now()), 1000);
    registerDestructor(this, () => clearInterval(tick));
  }

  get nowSeconds() {
    return Math.floor(this.now / 1000);
  }

  get parsed() {
    return parseInput(this.input);
  }

  get rows() {
    const date = this.parsed?.date;
    if (!date || Number.isNaN(date.getTime())) return [];
    const ms = date.getTime();
    const start = new Date(date.getFullYear(), 0, 0);
    return [
      { label: 'Unix seconds', value: String(Math.floor(ms / 1000)) },
      { label: 'Unix milliseconds', value: String(ms) },
      { label: 'ISO 8601 (UTC)', value: date.toISOString() },
      { label: 'RFC 2822', value: date.toUTCString() },
      {
        label: `Local (${LOCAL_ZONE})`,
        value: date.toLocaleString(undefined, {
          dateStyle: 'full',
          timeStyle: 'long',
        }),
      },
      { label: 'Relative', value: relative(ms, this.now) },
      {
        label: 'Day of year',
        value: String(Math.floor((date - start) / 86400000)),
      },
      { label: 'ISO week', value: String(isoWeek(date)) },
    ];
  }

  get zoneRows() {
    const date = this.parsed?.date;
    if (!date || Number.isNaN(date.getTime())) return [];
    return this.shownZones.map((zone) => ({
      zone,
      value: zoneFormatter(zone).format(date),
    }));
  }

  get availableZones() {
    return ALL_ZONES.filter((z) => !this.shownZones.includes(z));
  }

  get pickerValue() {
    const date = this.parsed?.date;
    return toDatetimeLocal(
      !date || Number.isNaN(date.getTime()) ? new Date() : date,
    );
  }

  get discordCodes() {
    const date = this.parsed?.date;
    if (!date || Number.isNaN(date.getTime())) return [];
    const secs = Math.floor(date.getTime() / 1000);
    return DISCORD_STYLES.map((s) => ({
      ...s,
      value: `<t:${secs}:${s.code}>`,
    }));
  }

  setInput = (e) => (this.input = e.target.value);
  useNow = () => (this.input = String(this.nowSeconds));

  // A local date/time picker, for building a timestamp from scratch instead
  // of typing one, e.g. scheduling a Discord post for a specific moment.
  setPicker = (e) => {
    if (!e.target.value) return;
    const date = new Date(e.target.value);
    if (!Number.isNaN(date.getTime()))
      this.input = String(Math.floor(date.getTime() / 1000));
  };

  addZone = (e) => {
    if (e.target.value) this.shownZones = [...this.shownZones, e.target.value];
    e.target.value = '';
  };

  removeZone = (zone) =>
    (this.shownZones = this.shownZones.filter((z) => z !== zone));

  <template>
    <ToolPage
      @route="timestamp-converter"
      @subtitle="Turn those long Unix numbers into actual dates (and back), in any time zone. Grab a Discord timestamp code while you’re here."
    >
      <div class="math-grid text-tool pop-in">
        <section class="math-card">
          <div class="field-head">
            <span class="qr-label is-muted">Current Unix time</span>
            <CopyButton @value={{this.nowSeconds}} />
          </div>
          <span class="math-big is-medium">{{this.nowSeconds}}</span>
          <div class="math-row is-aligned">
            <label class="math-field">
              <span class="qr-label is-muted">Timestamp or date</span>
              <input
                type="text"
                class="math-input"
                spellcheck="false"
                placeholder="1700000000, 2025-01-31T12:00Z, March 5 2026…"
                value={{this.input}}
                {{on "input" this.setInput}}
              />
            </label>
            <button
              type="button"
              class="btn math-swap"
              {{on "click" this.useNow}}
            >Now</button>
          </div>
          <label class="math-field">
            <span class="qr-label is-muted">…or pick a date &amp; time</span>
            <input
              type="datetime-local"
              class="math-input"
              step="1"
              value={{this.pickerValue}}
              {{on "input" this.setPicker}}
            />
          </label>
          {{#if this.parsed.error}}
            <p class="tool-error">{{this.parsed.error}}</p>
          {{else if this.parsed}}
            <p class="tool-hint">Read as {{this.parsed.unit}}.</p>
          {{/if}}
          <ul class="case-list">
            {{#each this.rows key="label" as |r|}}
              <li class="case-item">
                <div class="case-text"><span
                    class="qr-label is-muted"
                  >{{r.label}}</span><span
                    class="case-value is-mono"
                  >{{r.value}}</span></div>
                <CopyButton @value={{r.value}} />
              </li>
            {{/each}}
          </ul>
        </section>

        <section class="math-card">
          <h3 class="qr-heading">Time zones</h3>
          <ul class="case-list">
            {{#each this.zoneRows key="zone" as |z|}}
              <li class="case-item">
                <div class="case-text"><span
                    class="qr-label is-muted"
                  >{{z.zone}}</span><span
                    class="case-value"
                  >{{z.value}}</span></div>
                <button
                  type="button"
                  class="fs-remove"
                  aria-label="Remove {{z.zone}}"
                  {{on "click" (fn this.removeZone z.zone)}}
                ><Icon @name="x" @size={{13}} /></button>
              </li>
            {{/each}}
          </ul>
          <select
            class="select"
            aria-label="Add a time zone"
            {{on "change" this.addZone}}
          >
            <option value="">Add a time zone…</option>
            {{#each this.availableZones as |zone|}}
              <option value={{zone}}>{{zone}}</option>
            {{/each}}
          </select>
        </section>

        <section class="math-card">
          <h3 class="qr-heading">Discord timestamps</h3>
          <p class="tool-hint">Paste one of these into a Discord message and it
            renders as a live, localised timestamp for whoever reads it.</p>
          <ul class="case-list">
            {{#each this.discordCodes key="code" as |d|}}
              <li class="case-item">
                <div class="case-text"><span
                    class="qr-label is-muted"
                  >{{d.label}}</span><span
                    class="case-value is-mono"
                  >{{d.value}}</span></div>
                <CopyButton @value={{d.value}} />
              </li>
            {{/each}}
          </ul>
        </section>
      </div>
    </ToolPage>
  </template>
}
