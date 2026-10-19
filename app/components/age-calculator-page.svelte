<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import {
    calendarDiff,
    parseDateInput,
    toDateInput,
    daysInMonth,
    plural,
  } from '../utils/dates.js';
  import { keepState } from '../utils/tool-state.js';

  const DAY = 86400000;
  const weekday = (d) =>
    d.toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' });
  const longDate = (d) =>
    d.toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });

  const ZODIAC = [
    ['Capricorn', 1, 19],
    ['Aquarius', 2, 18],
    ['Pisces', 3, 20],
    ['Aries', 4, 19],
    ['Taurus', 5, 20],
    ['Gemini', 6, 20],
    ['Cancer', 7, 22],
    ['Leo', 8, 22],
    ['Virgo', 9, 22],
    ['Libra', 10, 22],
    ['Scorpio', 11, 21],
    ['Sagittarius', 12, 21],
  ];
  const CHINESE = [
    'Rat',
    'Ox',
    'Tiger',
    'Rabbit',
    'Dragon',
    'Snake',
    'Horse',
    'Goat',
    'Monkey',
    'Rooster',
    'Dog',
    'Pig',
  ];

  function zodiacSign(d) {
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const found = ZODIAC.find(([, m, last]) => month === m && day <= last);
    return found ? found[0] : ZODIAC[month % 12][0];
  }

  // Feb 29 birthdays fall on Feb 28 in common years.
  function birthdayIn(year, birth) {
    const month = birth.getUTCMonth();
    return new Date(
      Date.UTC(
        year,
        month,
        Math.min(birth.getUTCDate(), daysInMonth(year, month)),
      ),
    );
  }

  class AgeCalculatorPage extends Component {
    birth = $state.raw('2000-01-01');
    asOf = $state.raw(toDateInput(new Date()));

    constructor(args) {
      super(args);
      keepState(this, 'age-calculator', ['birth']);
    }

    get result() {
      const birth = parseDateInput(this.birth);
      const asOf = parseDateInput(this.asOf);
      if (!birth || !asOf) return { error: 'Pick both dates.' };
      if (birth > asOf)
        return { error: 'The birth date is after the "age on" date.' };

      const age = calendarDiff(birth, asOf);
      const days = Math.round((asOf - birth) / DAY);
      const totalMonths = age.years * 12 + age.months;

      let next = birthdayIn(asOf.getUTCFullYear(), birth);
      if (next < asOf) next = birthdayIn(asOf.getUTCFullYear() + 1, birth);
      const untilNext = Math.round((next - asOf) / DAY);
      const gap = calendarDiff(asOf, next);

      return {
        years: age.years,
        detail: `${plural(age.months, 'month')}, ${plural(age.days, 'day')}`,
        stats: [
          ['Months', totalMonths.toLocaleString()],
          [
            'Weeks',
            `${Math.floor(days / 7).toLocaleString()}${days % 7 ? ` + ${days % 7}d` : ''}`,
          ],
          ['Days', days.toLocaleString()],
          ['Hours', (days * 24).toLocaleString()],
          ['Minutes', (days * 1440).toLocaleString()],
        ],
        isBirthday: untilNext === 0,
        nextAge: next.getUTCFullYear() - birth.getUTCFullYear(),
        nextText: `${gap.months ? `${plural(gap.months, 'month')}, ` : ''}${plural(gap.days, 'day')} (${plural(untilNext, 'day')})`,
        nextDate: longDate(next),
        bornOn: weekday(birth),
        zodiac: zodiacSign(birth),
        chinese: CHINESE[(((birth.getUTCFullYear() - 2020) % 12) + 12) % 12],
      };
    }

    setBirth = (e) => (this.birth = e.target.value);
    setAsOf = (e) => (this.asOf = e.target.value);
    today = () => (this.asOf = toDateInput(new Date()));
  }
</script>

<script>
  let args = $props();
  const self = new AgeCalculatorPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="age-calculator"
  subtitle="Pick a birthday for the exact age, some fun totals, and a countdown to the next birthday."
>
  <div class="math-grid pop-in">
    <section class="math-card">
      <div class="math-row">
        <label class="math-field"
          ><span class="qr-label is-muted">Date of birth</span><input
            type="date"
            class="math-input"
            {@attach prop('value', () => self.birth)}
            oninput={self.setBirth}
          /></label
        >
        <div class="math-field">
          <label class="qr-label is-muted" for="age-as-of">Age on</label>
          <span class="math-inline">
            <input
              id="age-as-of"
              type="date"
              class="math-input"
              {@attach prop('value', () => self.asOf)}
              oninput={self.setAsOf}
            />
            <button type="button" class="btn" onclick={self.today}>Today</button
            >
          </span>
        </div>
      </div>

      {#if truthy(self.result?.error)}
        <p class="tool-error">{self.result?.error}</p>
      {:else}
        <div class="math-result">
          <span class="qr-label is-muted">Age</span>
          <span class="math-big"
            >{self.result?.years}
            <small>years</small></span
          >
          <span class="math-sub">{self.result?.detail}</span>
        </div>
        <div class="math-stats">
          {#each self.result?.stats ?? [] as stat}
            <div class="math-stat"
              ><span>{stat?.[0]}</span><strong>{stat?.[1]}</strong></div
            >
          {/each}
        </div>
      {/if}
    </section>

    {#if !truthy(self.result?.error)}
      <section class="math-card">
        <h3 class="qr-heading"
          >{truthy(self.result?.isBirthday)
            ? "Today's the day"
            : 'Next birthday'}</h3
        >
        {#if truthy(self.result?.isBirthday)}
          <p class="math-callout"
            >Happy birthday! You turn
            <strong>{self.result?.nextAge}</strong>
            today 🎂</p
          >
        {:else}
          <p class="math-callout"
            >Turning
            <strong>{self.result?.nextAge}</strong>
            in
            {self.result?.nextText}</p
          >
        {/if}
        <p class="tool-hint">{self.result?.nextDate}</p>
        <div class="math-stats">
          <div class="math-stat"
            ><span>Born on a</span><strong>{self.result?.bornOn}</strong></div
          >
          <div class="math-stat"
            ><span>Star sign</span><strong>{self.result?.zodiac}</strong></div
          >
          <div class="math-stat"
            ><span>Chinese zodiac (by year)</span><strong
              >{self.result?.chinese}</strong
            ></div
          >
        </div>
      </section>
    {/if}
  </div>
</ToolPage>
