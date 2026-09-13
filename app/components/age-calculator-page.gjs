import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { get } from '@ember/helper';
import ToolPage from './tool-page';
import { calendarDiff, parseDateInput, toDateInput, daysInMonth, plural } from '../utils/dates';

const DAY = 86400000;
const weekday = (d) => d.toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' });
const longDate = (d) => d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

const ZODIAC = [
  ['Capricorn', 1, 19], ['Aquarius', 2, 18], ['Pisces', 3, 20], ['Aries', 4, 19], ['Taurus', 5, 20], ['Gemini', 6, 20],
  ['Cancer', 7, 22], ['Leo', 8, 22], ['Virgo', 9, 22], ['Libra', 10, 22], ['Scorpio', 11, 21], ['Sagittarius', 12, 21],
];
const CHINESE = ['Rat', 'Ox', 'Tiger', 'Rabbit', 'Dragon', 'Snake', 'Horse', 'Goat', 'Monkey', 'Rooster', 'Dog', 'Pig'];

function zodiacSign(d) {
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const found = ZODIAC.find(([, m, last]) => month === m && day <= last);
  return found ? found[0] : ZODIAC[month % 12][0];
}

// Feb 29 birthdays fall on Feb 28 in common years.
function birthdayIn(year, birth) {
  const month = birth.getUTCMonth();
  return new Date(Date.UTC(year, month, Math.min(birth.getUTCDate(), daysInMonth(year, month))));
}

export default class AgeCalculatorPage extends Component {
  @tracked birth = '2000-01-01';
  @tracked asOf = toDateInput(new Date());

  get result() {
    const birth = parseDateInput(this.birth);
    const asOf = parseDateInput(this.asOf);
    if (!birth || !asOf) return { error: 'Pick both dates.' };
    if (birth > asOf) return { error: 'The birth date is after the "age on" date.' };

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
        ['Weeks', `${Math.floor(days / 7).toLocaleString()}${days % 7 ? ` + ${days % 7}d` : ''}`],
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

  <template>
    <ToolPage @route="age-calculator" @subtitle="Pick a date of birth to get an exact age, handy totals and how long until the next birthday.">
      <div class="math-grid pop-in">
        <section class="math-card">
          <div class="math-row">
            <label class="math-field"><span class="qr-label is-muted">Date of birth</span><input type="date" class="math-input" value={{this.birth}} {{on "input" this.setBirth}} /></label>
            <div class="math-field">
              <label class="qr-label is-muted" for="age-as-of">Age on</label>
              <span class="math-inline">
                <input id="age-as-of" type="date" class="math-input" value={{this.asOf}} {{on "input" this.setAsOf}} />
                <button type="button" class="btn" {{on "click" this.today}}>Today</button>
              </span>
            </div>
          </div>

          {{#if this.result.error}}
            <p class="tool-error">{{this.result.error}}</p>
          {{else}}
            <div class="math-result">
              <span class="qr-label is-muted">Age</span>
              <span class="math-big">{{this.result.years}} <small>years</small></span>
              <span class="math-sub">{{this.result.detail}}</span>
            </div>
            <div class="math-stats">
              {{#each this.result.stats as |stat|}}
                <div class="math-stat"><span>{{get stat 0}}</span><strong>{{get stat 1}}</strong></div>
              {{/each}}
            </div>
          {{/if}}
        </section>

        {{#unless this.result.error}}
          <section class="math-card">
            <h3 class="qr-heading">{{if this.result.isBirthday "Today's the day" "Next birthday"}}</h3>
            {{#if this.result.isBirthday}}
              <p class="math-callout">Happy birthday! You turn <strong>{{this.result.nextAge}}</strong> today 🎂</p>
            {{else}}
              <p class="math-callout">Turning <strong>{{this.result.nextAge}}</strong> in {{this.result.nextText}}</p>
            {{/if}}
            <p class="tool-hint">{{this.result.nextDate}}</p>
            <div class="math-stats">
              <div class="math-stat"><span>Born on a</span><strong>{{this.result.bornOn}}</strong></div>
              <div class="math-stat"><span>Star sign</span><strong>{{this.result.zodiac}}</strong></div>
              <div class="math-stat"><span>Chinese zodiac (by year)</span><strong>{{this.result.chinese}}</strong></div>
            </div>
          </section>
        {{/unless}}
      </div>
    </ToolPage>
  </template>
}
