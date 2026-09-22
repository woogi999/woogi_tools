import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { keepState } from '../utils/tool-state';
import {
  allZones,
  localZone,
  zoneLabel,
  offsetMinutes,
  offsetLabel,
  abbreviation,
  instantFor,
  formatIn,
  dayShift,
  hourClass,
} from '../utils/timezones';

const ZONES = allZones();
const pad = (n) => String(n).padStart(2, '0');

// The <input type="datetime-local"> value for a wall clock, which is the one
// format that control will accept and give back.
const toLocalInput = (zone, instant) => {
  const d = formatIn(zone, instant, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  // en-GB gives "dd/mm/yyyy, hh:mm"; the input wants "yyyy-mm-ddThh:mm".
  const [date, time] = d.split(', ');
  const [day, month, year] = date.split('/');
  return `${year}-${month}-${day}T${time.replace('24:', '00:')}`;
};

const parseInput = (value) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  return {
    year: +m[1],
    month: +m[2],
    day: +m[3],
    hour: +m[4],
    minute: +m[5],
  };
};

const eq = (a, b) => a === b;

export default class TimezoneConverterPage extends Component {
  @tracked fromZone = localZone();
  @tracked zones = [];
  @tracked when = '';
  @tracked useNow = true;
  @tracked search = '';
  @tracked picking = false;
  @tracked tick = 0;

  constructor(owner, args) {
    super(owner, args);
    // A sensible starting set: wherever you are, plus the three places most
    // of the world's remote meetings are scheduled against.
    this.zones = [
      ...new Set([
        localZone(),
        'America/New_York',
        'Europe/London',
        'Asia/Tokyo',
      ]),
    ];
    keepState(this, 'timezone-converter', [
      'fromZone',
      'zones',
      'when',
      'useNow',
    ]);
    // "Now" has to keep moving, or the page quietly goes stale while you read it.
    const timer = setInterval(() => (this.tick = Date.now()), 1000);
    registerDestructor(this, () => clearInterval(timer));
  }

  get allZones() {
    return ZONES;
  }

  get localZoneName() {
    return localZone();
  }

  // The instant every row is showing: either right now, or the wall-clock time
  // you typed read as a time in the "from" zone.
  get instant() {
    // Referenced so the ticking clock re-renders the rows.
    this.tick;
    if (this.useNow) return new Date();
    const parts = parseInput(this.when);
    if (!parts) return new Date();
    return instantFor(this.fromZone, parts);
  }

  get whenValue() {
    return this.when || toLocalInput(this.fromZone, new Date());
  }

  get rows() {
    const instant = this.instant;
    return this.zones.map((zone) => {
      const hour = Number(
        formatIn(zone, instant, { hour: '2-digit', hour12: false }).replace(
          /\D/g,
          '',
        ),
      );
      return {
        zone,
        label: zoneLabel(zone),
        time: formatIn(zone, instant, {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        }),
        date: formatIn(zone, instant, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        }),
        offset: offsetLabel(offsetMinutes(zone, instant)),
        abbr: abbreviation(zone, instant),
        shift: dayShift(zone, this.fromZone, instant),
        isSource: zone === this.fromZone,
        state: hourClass(hour % 24),
        // The next 24 hours in this zone, so a meeting slot can be found by eye.
        strip: Array.from({ length: 24 }, (_, i) => {
          const at = new Date(instant.getTime() + i * 3600000);
          const h = Number(
            formatIn(zone, at, { hour: '2-digit', hour12: false }).replace(
              /\D/g,
              '',
            ),
          );
          return { hour: pad(h % 24), state: hourClass(h % 24), key: i };
        }),
      };
    });
  }

  get summary() {
    return this.rows
      .map(
        (r) =>
          `${r.label}: ${r.time} ${r.date}${r.shift ? ` (${r.shift})` : ''}`,
      )
      .join('\n');
  }

  get matches() {
    const q = this.search.trim().toLowerCase();
    const pool = ZONES.filter((z) => !this.zones.includes(z));
    if (!q) return pool.slice(0, 12);
    return pool
      .filter(
        (z) =>
          z.toLowerCase().includes(q) || zoneLabel(z).toLowerCase().includes(q),
      )
      .slice(0, 20);
  }

  setFrom = (e) => {
    const previous = this.fromZone;
    this.fromZone = e.target.value;
    // The typed time meant a moment in the old zone; keep that moment rather
    // than silently re-reading the same digits somewhere else.
    if (!this.useNow && this.when) {
      const parts = parseInput(this.when);
      if (parts)
        this.when = toLocalInput(this.fromZone, instantFor(previous, parts));
    }
  };

  setWhen = (e) => {
    this.when = e.target.value;
    this.useNow = false;
  };

  goNow = () => {
    this.useNow = true;
    this.when = '';
  };

  setSearch = (e) => (this.search = e.target.value);
  togglePicking = () => {
    this.picking = !this.picking;
    this.search = '';
  };

  addZone = (zone) => {
    if (!this.zones.includes(zone)) this.zones = [...this.zones, zone];
    this.search = '';
    this.picking = false;
  };

  removeZone = (zone) => (this.zones = this.zones.filter((z) => z !== zone));

  <template>
    <ToolPage
      @route="timezone-converter"
      @subtitle="What time is it there? Line up as many places as you like, pick a moment, and see it on everyone's clock at once."
    >
      <div class="math-grid text-tool pop-in">
        <section class="math-card">
          <div class="math-row is-aligned">
            <label class="math-field">
              <span class="qr-label is-muted">Reading the time in</span>
              <select class="select" {{on "change" this.setFrom}}>
                {{#each this.allZones as |z|}}
                  <option
                    value={{z}}
                    selected={{eq z this.fromZone}}
                  >{{zoneLabel z}}</option>
                {{/each}}
              </select>
            </label>
            <label class="math-field">
              <span class="qr-label is-muted">At</span>
              <input
                type="datetime-local"
                class="math-input"
                value={{this.whenValue}}
                {{on "input" this.setWhen}}
              />
            </label>
            <button
              type="button"
              class="btn {{if this.useNow 'active'}}"
              {{on "click" this.goNow}}
            ><Icon @name="clock" @size={{13}} /> Now</button>
          </div>
          {{#if this.useNow}}
            <p class="tool-hint">Following the clock as it goes. Type a time
              above to pin it to a particular moment instead.</p>
          {{/if}}
        </section>

        <section class="math-card">
          <div class="field-head">
            <span class="qr-label is-muted">{{this.zones.length}} places</span>
            <div class="settings-actions">
              <CopyButton @value={{this.summary}} />
              <button
                type="button"
                class="btn"
                {{on "click" this.togglePicking}}
              ><Icon @name="plus" @size={{13}} /> Add a place</button>
            </div>
          </div>

          {{#if this.picking}}
            <input
              type="text"
              class="math-input"
              placeholder="Search for a city or zone"
              aria-label="Search time zones"
              value={{this.search}}
              {{on "input" this.setSearch}}
            />
            <ul class="tz-results">
              {{#each this.matches as |z|}}
                <li><button
                    type="button"
                    class="tz-result"
                    {{on "click" (fn this.addZone z)}}
                  >{{zoneLabel z}}<span
                      class="is-muted"
                    >{{z}}</span></button></li>
              {{else}}
                <li class="tool-hint">Nothing matches that.</li>
              {{/each}}
            </ul>
          {{/if}}

          <ul class="tz-list">
            {{#each this.rows key="zone" as |row|}}
              <li class="tz-row {{if row.isSource 'is-source'}}">
                <div class="tz-place">
                  <strong>{{row.label}}</strong>
                  <span class="is-muted">{{row.offset}}{{#if row.abbr}}
                      ·
                      {{row.abbr}}{{/if}}</span>
                </div>
                <div class="tz-clock">
                  <span class="tz-time tz-{{row.state}}">{{row.time}}</span>
                  <span class="is-muted">{{row.date}}{{#if row.shift}}
                      ·
                      {{row.shift}}{{/if}}</span>
                </div>
                <div class="tz-strip" aria-hidden="true">
                  {{#each row.strip key="key" as |cell|}}
                    <span
                      class="tz-cell tz-{{cell.state}}"
                      title="{{cell.hour}}:00"
                    >{{cell.hour}}</span>
                  {{/each}}
                </div>
                <button
                  type="button"
                  class="fs-remove"
                  aria-label="Remove {{row.label}}"
                  {{on "click" (fn this.removeZone row.zone)}}
                ><Icon @name="x" @size={{13}} /></button>
              </li>
            {{/each}}
          </ul>
          <p class="tool-hint">The strip is the next 24 hours in each place.
            Green is their working day, amber is awake but off the clock, and
            grey is the middle of their night: find a column that's green all
            the way down and that's your meeting.</p>
        </section>
      </div>
    </ToolPage>
  </template>
}
