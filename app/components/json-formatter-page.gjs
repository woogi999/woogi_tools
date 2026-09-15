import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import ToolPage from './tool-page';
import CopyButton from './copy-button';

const INDENTS = [
  { id: '2', label: '2 spaces', value: 2 },
  { id: '4', label: '4 spaces', value: 4 },
  { id: 'tab', label: 'Tabs', value: '\t' },
  { id: 'min', label: 'Minify', value: 0 },
];

const eq = (a, b) => a === b;

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  return value;
}

function summarize(value) {
  let keys = 0;
  let depth = 0;
  let values = 0;
  const walk = (v, d) => {
    depth = Math.max(depth, d);
    if (Array.isArray(v)) v.forEach((x) => walk(x, d + 1));
    else if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        keys++;
        walk(v[k], d + 1);
      }
    } else values++;
  };
  walk(value, 0);
  return { keys, depth, values, type: Array.isArray(value) ? `array of ${value.length}` : value === null ? 'null' : typeof value };
}

// Turns "…at position 42" into a line and column the user can find.
function locate(text, message) {
  const match = /position (\d+)/.exec(message);
  if (!match) return message;
  const before = text.slice(0, +match[1]);
  const line = before.split('\n').length;
  const column = before.length - before.lastIndexOf('\n');
  return `${message.replace(/\s*\(line \d+ column \d+\)/, '')} — line ${line}, column ${column}`;
}

export default class JsonFormatterPage extends Component {
  indents = INDENTS;

  @tracked input = '{"name":"Woogi Tools","tools":["json","hash","uuid"],"nested":{"ok":true,"count":3}}';
  @tracked indent = '2';
  @tracked sorted = false;

  get parsed() {
    if (!this.input.trim()) return { empty: true };
    try {
      return { value: JSON.parse(this.input) };
    } catch (error) {
      return { error: locate(this.input, error.message) };
    }
  }

  get output() {
    const { value, error, empty } = this.parsed;
    if (error || empty) return '';
    const space = INDENTS.find((i) => i.id === this.indent).value;
    return JSON.stringify(this.sorted ? sortKeys(value) : value, null, space);
  }

  get summary() {
    return 'value' in this.parsed ? summarize(this.parsed.value) : null;
  }

  setInput = (e) => (this.input = e.target.value);
  setIndent = (id) => (this.indent = id);
  toggleSorted = () => (this.sorted = !this.sorted);
  useOutput = () => (this.input = this.output);

  <template>
    <ToolPage @route="json-formatter" @subtitle="Paste your JSON to validate, pretty-print, minify or sort it. It even tells you the line where it broke.">
      <div class="math-grid text-tool pop-in">
        <section class="math-card">
          <label class="field-label" for="json-in">JSON</label>
          <textarea id="json-in" class="textarea text-area-tall" spellcheck="false" value={{this.input}} {{on "input" this.setInput}}></textarea>
          {{#if this.parsed.error}}
            <p class="tool-error">{{this.parsed.error}}</p>
          {{else if this.summary}}
            <p class="tool-hint">Valid JSON · {{this.summary.type}} · {{this.summary.keys}} keys · {{this.summary.values}} values · {{this.summary.depth}} levels deep</p>
          {{/if}}
        </section>
        <section class="math-card">
          <div class="math-tabs" role="group" aria-label="Indentation">
            {{#each this.indents as |i|}}
              <button type="button" class="qr-tab {{if (eq this.indent i.id) 'active'}}" {{on "click" (fn this.setIndent i.id)}}>{{i.label}}</button>
            {{/each}}
          </div>
          <div class="field-head">
            <label class="math-check"><input type="checkbox" checked={{this.sorted}} {{on "change" this.toggleSorted}} /> Sort keys</label>
            <div class="settings-actions">
              <button type="button" class="btn" disabled={{if this.output false true}} {{on "click" this.useOutput}}>Use as input</button>
              <CopyButton @value={{this.output}} />
            </div>
          </div>
          <textarea class="textarea text-area-tall" readonly spellcheck="false" aria-label="Formatted JSON" value={{this.output}}></textarea>
        </section>
      </div>
    </ToolPage>
  </template>
}
