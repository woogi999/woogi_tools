<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import { keepState } from '../utils/tool-state.js';
  import {
    SIGNS,
    BIRTHSTONES,
    BIRTH_FLOWERS,
    birthChart,
    chineseZodiac,
    geocode,
    guessOffset,
    sunSignByDate,
  } from '../utils/astro.js';

  const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const fmtDeg = (n) =>
    `${Math.floor(n)}°${String(Math.round((n % 1) * 60)).padStart(2, '0')}'`;
  const fmtOffset = (h) => `UTC${h >= 0 ? '+' : '−'}${Math.abs(h)}`;

  class AstrologyProfilePage extends Component {
    signs = SIGNS;

    date = $state.raw('2000-01-01');
    time = $state.raw('12:00');
    knowsTime = $state.raw(true);
    place = $state.raw('');
    placeName = $state.raw('');
    latitude = $state.raw('');
    longitude = $state.raw('');
    offset = $state.raw('');
    busy = $state.raw(false);
    error = $state.raw(null);

    controller = null;

    constructor(args) {
      super(args);
      keepState(this, 'astrology-profile', [
        'date',
        'time',
        'knowsTime',
        'place',
        'placeName',
        'latitude',
        'longitude',
        'offset',
      ]);
      registerDestructor(this, () => this.controller?.abort());
    }

    get timeUnknown() {
      return !this.knowsTime;
    }

    get parts() {
      const m = this.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return null;
      return { year: +m[1], month: +m[2], day: +m[3] };
    }

    get sunSign() {
      return this.parts
        ? sunSignByDate(this.parts.month, this.parts.day)
        : null;
    }

    get matches() {
      return this.sunSign?.matches.join(', ') ?? '';
    }

    get famous() {
      return this.sunSign?.famous.join(', ') ?? '';
    }

    get calendar() {
      if (!this.parts) return null;
      const { year, month } = this.parts;
      return {
        birthstone: BIRTHSTONES[month - 1],
        flower: BIRTH_FLOWERS[month - 1],
        month: MONTHS[month - 1],
        chinese: chineseZodiac(year),
        weekday: new Date(year, month - 1, this.parts.day).toLocaleDateString(
          undefined,
          { weekday: 'long' },
        ),
      };
    }

    get hasPlace() {
      return (
        Number.isFinite(Number(this.latitude)) &&
        this.latitude !== '' &&
        this.longitude !== ''
      );
    }

    // The moment of birth in UTC: local date and time, less the zone offset.
    get utc() {
      if (!this.parts) return null;
      const [h, min] = (this.knowsTime ? this.time : '12:00')
        .split(':')
        .map(Number);
      const offset = Number(this.offset) || 0;
      const { year, month, day } = this.parts;
      return new Date(Date.UTC(year, month - 1, day, h - offset, min));
    }

    get chart() {
      if (!this.utc) return null;
      const lat = this.hasPlace ? Number(this.latitude) : 0;
      const lon = this.hasPlace ? Number(this.longitude) : 0;
      return birthChart(this.utc, lat, lon);
    }

    get rows() {
      if (!this.chart) return [];
      return this.chart.planets.map((p) => ({
        ...p,
        position: `${p.sign.name} ${fmtDeg(p.degree)}`,
      }));
    }

    get angleRows() {
      const c = this.chart;
      if (!c) return [];
      return [c.ascendant, c.descendant, c.midheaven, c.ic].map((a) => ({
        ...a,
        position: `${a.sign.name} ${fmtDeg(a.degree)}`,
      }));
    }

    get houseRows() {
      return (this.chart?.houses ?? []).map((h) => ({
        ...h,
        position: `${h.sign.name} ${fmtDeg(h.degree)}`,
        holds: h.planets.join(', '),
      }));
    }

    get offsetLabel() {
      return fmtOffset(Number(this.offset) || 0);
    }

    get needsPlace() {
      return !this.hasPlace || !this.knowsTime;
    }

    setDate = (e) => (this.date = e.target.value);
    setTime = (e) => (this.time = e.target.value);
    setPlace = (e) => (this.place = e.target.value);
    setLatitude = (e) => (this.latitude = e.target.value);
    setLongitude = (e) => (this.longitude = e.target.value);
    setOffset = (e) => (this.offset = e.target.value);
    toggleTime = () => (this.knowsTime = !this.knowsTime);

    findPlace = async (event) => {
      event?.preventDefault();
      if (!this.place.trim()) return;
      this.controller?.abort();
      const controller = (this.controller = new AbortController());
      this.busy = true;
      this.error = null;
      try {
        const hit = await geocode(this.place, controller.signal);
        if (controller.signal.aborted) return;
        this.placeName = hit.name;
        this.latitude = hit.latitude.toFixed(4);
        this.longitude = hit.longitude.toFixed(4);
        this.offset = String(guessOffset(hit.longitude));
      } catch (err) {
        if (!controller.signal.aborted) this.error = err.message;
      } finally {
        if (!controller.signal.aborted) this.busy = false;
      }
    };
  }
</script>

<script>
  let args = $props();
  const self = new AstrologyProfilePage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="astrology-profile"
  busy={self.busy}
  closeWarning="Close Astrology Profile? The chart being worked out will stop."
  subtitle="Your sun, moon and rising signs, the planets and the twelve houses, from when and where you were born."
>
  <div class="math-grid pop-in">
    <section class="math-card">
      <h3 class="qr-heading">Born</h3>
      <div class="math-row">
        <label class="math-field"
          ><span class="qr-label is-muted">Date</span><input
            type="date"
            class="math-input"
            {@attach prop('value', () => self.date)}
            oninput={self.setDate}
          /></label
        >
        <label class="math-field"
          ><span class="qr-label is-muted">Time</span><input
            type="time"
            class="math-input"
            {@attach prop('value', () => self.time)}
            disabled={self.timeUnknown}
            oninput={self.setTime}
          /></label
        >
      </div>
      <label class="tts-check">
        <input
          type="checkbox"
          {@attach prop('checked', () => self.knowsTime)}
          onchange={self.toggleTime}
        />
        I know the time of birth
      </label>
      <form class="astro-place" onsubmit={self.findPlace}>
        <label class="math-field"
          ><span class="qr-label is-muted">Place</span><input
            type="text"
            class="math-input"
            placeholder="City, country"
            {@attach prop('value', () => self.place)}
            oninput={self.setPlace}
          /></label
        >
        <button type="submit" class="btn" disabled={self.busy}>
          <Icon name="map-pin" size={13} />
          {truthy(self.busy) ? 'Finding…' : 'Find'}</button
        >
      </form>
      {#if truthy(self.placeName)}<p class="tool-hint">{self.placeName}</p>{/if}
      {#if truthy(self.error)}<p class="tool-error">{self.error}</p>{/if}
      <div class="math-row astro-coords">
        <label class="math-field"
          ><span class="qr-label is-muted">Latitude</span><input
            type="number"
            step="any"
            class="math-input"
            {@attach prop('value', () => self.latitude)}
            oninput={self.setLatitude}
          /></label
        >
        <label class="math-field"
          ><span class="qr-label is-muted">Longitude</span><input
            type="number"
            step="any"
            class="math-input"
            {@attach prop('value', () => self.longitude)}
            oninput={self.setLongitude}
          /></label
        >
        <label class="math-field"
          ><span class="qr-label is-muted">Time zone (hours from UTC)</span
          ><input
            type="number"
            step="0.5"
            min="-12"
            max="14"
            class="math-input"
            {@attach prop('value', () => self.offset)}
            oninput={self.setOffset}
          /></label
        >
      </div>
      <p class="tool-hint"
        >The zone is guessed from the longitude and can be off by an hour
        (summer time, odd borders): set it yourself if you know it. The place is
        looked up through OpenStreetMap; the chart itself is worked out here.</p
      >
    </section>

    {#if truthy(self.sunSign)}
      <section class="math-card astro-sign">
        <span class="astro-glyph" aria-hidden="true"
          ><Icon name={self.sunSign?.icon} size={52} /></span
        >
        <h3 class="qr-heading">{self.sunSign?.name}</h3>
        <p class="tool-hint"
          >{self.sunSign?.from}
          to
          {self.sunSign?.to}</p
        >
        <p>{self.sunSign?.traits}</p>
        <dl class="rbx-facts">
          <dt>Element</dt><dd>{self.sunSign?.element}</dd>
          <dt>Modality</dt><dd>{self.sunSign?.modality}</dd>
          <dt>Ruling planet</dt><dd>{self.sunSign?.ruler}</dd>
          <dt>Colour</dt><dd>{self.sunSign?.colour}</dd>
          <dt>Lucky number</dt><dd>{self.sunSign?.lucky}</dd>
          <dt>Lucky day</dt><dd>{self.sunSign?.day}</dd>
          <dt>Birthstone</dt><dd
            >{self.calendar?.birthstone}
            ({self.calendar?.month})</dd
          >
          <dt>Birth flower</dt><dd>{self.calendar?.flower}</dd>
          <dt>Chinese zodiac</dt><dd>{self.calendar?.chinese}</dd>
          <dt>Born on a</dt><dd>{self.calendar?.weekday}</dd>
          <dt>Gets on with</dt><dd>{self.matches}</dd>
          <dt>In good company</dt><dd>{self.famous}</dd>
        </dl>
      </section>
    {/if}
  </div>

  {#if truthy(self.chart)}
    <div class="math-grid pop-in">
      <section class="math-card">
        <h3 class="qr-heading">The big three</h3>
        <div class="astro-three">
          <div class="math-result">
            <span class="qr-label is-muted">Sun</span>
            <span class="math-big"
              ><Icon name={self.chart?.sun?.sign?.icon} size={18} />
              {self.chart?.sun?.sign?.name}</span
            >
            <span class="tool-hint">who you are</span>
          </div>
          <div class="math-result">
            <span class="qr-label is-muted">Moon</span>
            <span class="math-big"
              ><Icon name={self.chart?.moon?.sign?.icon} size={18} />
              {self.chart?.moon?.sign?.name}</span
            >
            <span class="tool-hint">how you feel</span>
          </div>
          <div class="math-result">
            <span class="qr-label is-muted">Rising</span>
            <span class="math-big"
              ><Icon name={self.chart?.ascendant?.sign?.icon} size={18} />
              {self.chart?.ascendant?.sign?.name}</span
            >
            <span class="tool-hint">how you come across</span>
          </div>
        </div>
        {#if truthy(self.needsPlace)}
          <p class="tool-hint"
            >The rising sign and the houses need the time and place of birth;
            without them they're worked out for noon at the equator and mean
            little.</p
          >
        {/if}
        <h4 class="qr-label is-muted">Angles</h4>
        <table class="astro-table">
          <tbody>
            {#each self.angleRows ?? [] as a}
              <tr
                ><th>{a?.name}</th><td
                  ><Icon name={a?.sign?.icon} size={13} />
                  {a?.position}</td
                ></tr
              >
            {/each}
          </tbody>
        </table>
        <p class="tool-hint"
          >Rising (the Ascendant) is the sign coming up over the eastern horizon
          as you were born; falling (the Descendant) is the one setting opposite
          it, the partnership point. The Midheaven is the top of the chart, your
          public face.</p
        >
      </section>

      <section class="math-card">
        <h3 class="qr-heading">The planets</h3>
        <table class="astro-table">
          <thead><tr><th>Planet</th><th>Sign</th><th>House</th></tr></thead>
          <tbody>
            {#each self.rows ?? [] as p}
              <tr>
                <th
                  >{p?.name}
                  <span class="is-muted">{p?.meaning}</span></th
                >
                <td
                  ><Icon name={p?.sign?.icon} size={13} />
                  {p?.position}</td
                >
                <td>{p?.house}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>

      <section class="math-card">
        <h3 class="qr-heading">The twelve houses</h3>
        <table class="astro-table">
          <thead><tr><th>House</th><th>Cusp</th><th>About</th></tr></thead>
          <tbody>
            {#each self.houseRows ?? [] as h}
              <tr>
                <th>{h?.number}</th>
                <td
                  ><Icon name={h?.sign?.icon} size={13} />
                  {h?.position}{#if truthy(h?.holds)}<br /><span
                      class="is-muted">{h?.holds}</span
                    >{/if}</td
                >
                <td>{h?.theme}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="tool-hint"
          >Equal houses, each thirty degrees from the Ascendant. Positions are
          good to about a degree, so a planet on the very edge of a sign could
          be on either side. Time zone in use:
          {self.offsetLabel}.</p
        >
      </section>
    </div>
  {/if}
</ToolPage>
