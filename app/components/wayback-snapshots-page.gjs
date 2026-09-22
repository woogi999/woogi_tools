import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import { keepState } from '../utils/tool-state';
import { waybackSnapshots, waybackDate, waybackUrl } from '../utils/osint';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const sum = (list) => list.reduce((a, b) => a + b, 0);

export default class WaybackSnapshotsPage extends Component {
  @tracked input = '';
  @tracked target = null;
  @tracked result = null;
  @tracked busy = false;
  @tracked error = null;
  @tracked year = null;

  controller = null;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'wayback-snapshots', ['input']);
    registerDestructor(this, () => this.controller?.abort());
  }

  get yearEntries() {
    const years = this.result?.years ?? {};
    return Object.entries(years)
      .map(([year, months]) => ({ year, months, count: sum(months) }))
      .filter((y) => y.count > 0)
      .sort((a, b) => a.year.localeCompare(b.year));
  }

  get total() {
    return sum(this.yearEntries.map((y) => y.count)).toLocaleString();
  }

  // One bar per year, sized by how many captures it has.
  get years() {
    const entries = this.yearEntries;
    const max = Math.max(1, ...entries.map((y) => y.count));
    return entries.map((y) => ({
      ...y,
      height: htmlSafe(`height: ${Math.max(6, (y.count / max) * 100)}%`),
      active: y.year === this.year,
    }));
  }

  // The picked year's months, each linking to the capture nearest its middle
  // (the Archive redirects /web/<date>/<url> to the closest one it has).
  get months() {
    const entry = this.yearEntries.find((y) => y.year === this.year);
    if (!entry) return [];
    return entry.months.map((count, i) => {
      const stamp = `${this.year}${String(i + 1).padStart(2, '0')}15`;
      return {
        name: MONTHS[i],
        count,
        href: count ? waybackUrl(stamp, this.target) : null,
        calendar: `https://web.archive.org/web/${stamp.slice(0, 6)}*/${this.target}`,
      };
    });
  }

  get first() {
    const t = this.result?.first;
    return t
      ? {
          when: waybackDate(t).toLocaleDateString(),
          href: waybackUrl(t, this.target),
        }
      : null;
  }

  get last() {
    const t = this.result?.last;
    return t
      ? {
          when: waybackDate(t).toLocaleDateString(),
          href: waybackUrl(t, this.target),
        }
      : null;
  }

  setInput = (event) => (this.input = event.target.value);
  pickYear = (year) => (this.year = this.year === year ? null : year);

  submit = async (event) => {
    event.preventDefault();
    const target = this.input.trim().replace(/^https?:\/\//i, '');
    if (!target) return;
    this.controller?.abort();
    const controller = (this.controller = new AbortController());
    this.busy = true;
    this.error = null;
    this.result = null;
    this.year = null;
    this.target = target;
    try {
      const result = await waybackSnapshots(target, controller.signal);
      if (controller.signal.aborted) return;
      this.result = result;
      this.year = this.yearEntries.at(-1)?.year ?? null;
    } catch (error) {
      if (!controller.signal.aborted) this.error = error.message;
    }
    if (!controller.signal.aborted) this.busy = false;
  };

  <template>
    <ToolPage
      @route="wayback-snapshots"
      @busy={{this.busy}}
      @closeWarning="Close Wayback Snapshots? The lookup still running will stop."
      @subtitle="What a page used to say: when the Internet Archive saved it, year by year, one click from the copy."
    >
      <div class="pop-in">
        <form class="dl-form" {{on "submit" this.submit}}>
          <input
            type="text"
            class="math-input"
            placeholder="example.com/about"
            spellcheck="false"
            autocapitalize="off"
            aria-label="Address"
            value={{this.input}}
            {{on "input" this.setInput}}
          />
          <button type="submit" class="btn active" disabled={{this.busy}}>
            <Icon @name="history" @size={{13}} />
            {{if this.busy "Asking the Archive…" "Look back"}}</button>
        </form>
        {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}

        {{#if this.result}}
          <section class="math-card">
            {{#if this.first}}
              <p><strong>{{this.total}}</strong>
                captures, the first on
                <a
                  href={{this.first.href}}
                  target="_blank"
                  rel="noopener noreferrer"
                >{{this.first.when}}</a>
                and the latest on
                <a
                  href={{this.last.href}}
                  target="_blank"
                  rel="noopener noreferrer"
                >{{this.last.when}}</a>.</p>
              <div class="osint-years">
                {{#each this.years as |y|}}
                  <button
                    type="button"
                    class="osint-year {{if y.active 'is-active'}}"
                    title="{{y.year}}: {{y.count}}"
                    {{on "click" (fn this.pickYear y.year)}}
                  ><span style={{y.height}}></span><small
                    >{{y.year}}</small></button>
                {{/each}}
              </div>
              {{#if this.year}}
                <h3 class="qr-heading">{{this.year}}</h3>
                <ul class="osint-months">
                  {{#each this.months as |m|}}
                    <li class="{{unless m.count 'is-empty'}}">
                      {{#if m.href}}
                        <a
                          href={{m.href}}
                          target="_blank"
                          rel="noopener noreferrer"
                        >{{m.name}}</a>
                        <a
                          class="is-muted"
                          href={{m.calendar}}
                          target="_blank"
                          rel="noopener noreferrer"
                        >{{m.count}} captures</a>
                      {{else}}
                        <span>{{m.name}}</span>
                        <span class="is-muted">none</span>
                      {{/if}}
                    </li>
                  {{/each}}
                </ul>
              {{/if}}
            {{else}}
              <p class="tool-hint">The Archive has never saved
                {{this.target}}.</p>
            {{/if}}
          </section>
        {{else}}
          <p class="tool-hint">Pick a year to see its months. A month opens the
            capture nearest its middle; its count opens the Archive's own list
            for that month.</p>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}
