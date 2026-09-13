import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import ToolPage from './tool-page';
import CopyButton from './copy-button';
import { describeCron, CRON_PRESETS } from '../utils/cron';

function nextRuns(expr, count = 5) {
  // A small brute-force matcher: walk minute by minute rather than
  // implementing a full cron scheduler, which is plenty fast for a preview.
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return [];
  const [mi, hr, dom, mo, dow] = parts;
  const matches = (value, field) => field === '*' || field.split(',').some((tok) => matchToken(value, tok));
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
    const dowOk = matches(date.getDay(), dow) || matches(date.getDay() + 7, dow);
    if (matches(date.getMinutes(), mi) && matches(date.getHours(), hr) && matches(date.getMonth() + 1, mo) && domOk && dowOk) {
      results.push(new Date(date));
    }
    date.setMinutes(date.getMinutes() + 1);
  }
  return results;
}

export default class CronBuilderPage extends Component {
  presets = CRON_PRESETS;

  @tracked expr = '0 9 * * 1-5';

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

  <template>
    <ToolPage @route="cron-builder" @subtitle="Write and understand cron expressions, with a preview of the next runs.">
      <div class="math-grid pop-in">
        <section class="math-card">
          <div class="field-head">
            <label class="field-label" for="cron-input">Cron expression</label>
            <CopyButton @value={{this.expr}} />
          </div>
          <input id="cron-input" type="text" class="math-input is-mono" spellcheck="false" value={{this.expr}} {{on "input" this.setExpr}} />

          {{#if this.result.error}}
            <p class="tool-error">{{this.result.error}}</p>
          {{else}}
            <p class="math-callout">{{this.result.description}}</p>
          {{/if}}

          <h3 class="qr-heading">Presets</h3>
          <div class="line-actions">
            {{#each this.presets as |p|}}
              <button type="button" class="btn" {{on "click" (fn this.usePreset p.expr)}}>{{p.label}}</button>
            {{/each}}
          </div>
        </section>

        <section class="math-card">
          <h3 class="qr-heading">Next runs</h3>
          {{#if this.upcoming.length}}
            <div class="math-stats">
              {{#each this.upcoming as |d|}}
                <div class="math-stat"><span>{{formatDate d}}</span></div>
              {{/each}}
            </div>
          {{else}}
            <p class="tool-hint">Fix the expression above to see upcoming run times.</p>
          {{/if}}
          <p class="tool-hint">Fields are minute, hour, day-of-month, month, day-of-week (0 and 7 both mean Sunday). Use commas for lists, hyphens for ranges and a slash for steps.</p>
        </section>
      </div>
    </ToolPage>
  </template>
}

function formatDate(d) {
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
