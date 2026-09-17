import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { keepState } from '../utils/tool-state';

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

function shuffle(lines) {
  const out = [...lines];
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const ACTIONS = [
  { id: 'sortAsc', label: 'Sort A → Z', fn: (l, o) => [...l].sort(o.compare) },
  {
    id: 'sortDesc',
    label: 'Sort Z → A',
    fn: (l, o) => [...l].sort(o.compare).reverse(),
  },
  {
    id: 'sortLength',
    label: 'Sort by length',
    fn: (l, o) => [...l].sort((a, b) => a.length - b.length || o.compare(a, b)),
  },
  { id: 'reverse', label: 'Reverse', fn: (l) => [...l].reverse() },
  { id: 'shuffle', label: 'Shuffle', fn: (l) => shuffle(l) },
  {
    id: 'dedupe',
    label: 'Remove duplicates',
    fn: (l, o) => {
      const seen = new Set();
      return l.filter((line) => {
        const key = o.ignoreCase ? line.toLowerCase() : line;
        return seen.has(key) ? false : seen.add(key);
      });
    },
  },
  {
    id: 'blank',
    label: 'Remove blank lines',
    fn: (l) => l.filter((line) => line.trim()),
  },
  { id: 'trim', label: 'Trim spaces', fn: (l) => l.map((line) => line.trim()) },
  {
    id: 'number',
    label: 'Number lines',
    fn: (l) =>
      l.map(
        (line, i) =>
          `${String(i + 1).padStart(String(l.length).length, ' ')}. ${line}`,
      ),
  },
  {
    id: 'unnumber',
    label: 'Strip numbers',
    fn: (l) => l.map((line) => line.replace(/^\s*\d+[.):]\s?/, '')),
  },
];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default class LineToolsPage extends Component {
  actions = ACTIONS;

  @tracked text = 'banana\napple\nCherry\napple\n\n  date  \nbanana';
  @tracked ignoreCase = true;
  @tracked history = [];
  @tracked find = '';
  @tracked replace = '';
  @tracked useRegex = false;
  @tracked message = '';

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'line-tools', [
      'text',
      'ignoreCase',
      'find',
      'replace',
      'useRegex',
    ]);
  }

  get lineCount() {
    return this.text ? this.text.split('\n').length : 0;
  }

  get findError() {
    if (!this.useRegex || !this.find) return null;
    try {
      new RegExp(this.find);
      return null;
    } catch (error) {
      return error.message;
    }
  }

  get matchCount() {
    if (!this.find || this.findError) return 0;
    return [...this.text.matchAll(this.pattern)].length;
  }

  get pattern() {
    return new RegExp(
      this.useRegex ? this.find : escapeRegex(this.find),
      this.ignoreCase ? 'gi' : 'g',
    );
  }

  commit(next, message) {
    if (next === this.text) {
      this.message = 'Nothing changed.';
      return;
    }
    this.history = [...this.history.slice(-49), this.text];
    this.text = next;
    this.message = message;
  }

  run = (action) => {
    const compare = this.ignoreCase
      ? collator.compare
      : (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    const before = this.lineCount;
    const lines = action.fn(this.text.split('\n'), {
      ignoreCase: this.ignoreCase,
      compare,
    });
    const removed = before - lines.length;
    this.commit(
      lines.join('\n'),
      removed > 0
        ? `${action.label}: removed ${removed} line${removed === 1 ? '' : 's'}.`
        : `${action.label}: done.`,
    );
  };

  replaceAll = () => {
    if (!this.find || this.findError) return;
    const count = this.matchCount;
    // In plain mode "$" in the replacement must stay literal.
    const replacement = this.useRegex
      ? this.replace
      : this.replace.replaceAll('$', '$$$$');
    this.commit(
      this.text.replace(this.pattern, replacement),
      `Replaced ${count} match${count === 1 ? '' : 'es'}.`,
    );
  };

  undo = () => {
    if (!this.history.length) return;
    this.text = this.history.at(-1);
    this.history = this.history.slice(0, -1);
    this.message = 'Undone.';
  };

  setText = (e) => (this.text = e.target.value);
  setFind = (e) => (this.find = e.target.value);
  setReplace = (e) => (this.replace = e.target.value);
  toggleCase = () => (this.ignoreCase = !this.ignoreCase);
  toggleRegex = () => (this.useRegex = !this.useRegex);

  <template>
    <ToolPage
      @route="line-tools"
      @subtitle="Sort lines, remove duplicates, shuffle, trim blank lines, or find and replace across the lot."
    >
      <div class="math-grid text-tool pop-in">
        <section class="math-card">
          <div class="field-head">
            <label class="field-label" for="lt-text">Text ·
              {{this.lineCount}}
              lines</label>
            <div class="settings-actions">
              <button
                type="button"
                class="btn"
                disabled={{if this.history.length false true}}
                {{on "click" this.undo}}
              ><Icon @name="rotate-ccw" @size={{13}} /> Undo</button>
              <CopyButton @value={{this.text}} />
            </div>
          </div>
          <textarea
            id="lt-text"
            class="textarea text-area-tall"
            spellcheck="false"
            value={{this.text}}
            {{on "input" this.setText}}
          ></textarea>
          {{#if this.message}}<p
              class="tool-hint"
              role="status"
            >{{this.message}}</p>{{/if}}
        </section>

        <section class="math-card">
          <h3 class="qr-heading">Lines</h3>
          <div class="line-actions">
            {{#each this.actions as |a|}}
              <button
                type="button"
                class="btn"
                {{on "click" (fn this.run a)}}
              >{{a.label}}</button>
            {{/each}}
          </div>
          <label class="math-check"><input
              type="checkbox"
              checked={{this.ignoreCase}}
              {{on "change" this.toggleCase}}
            />
            Ignore case (sorting, duplicates and find)</label>

          <h3 class="qr-heading">Find and replace</h3>
          <label class="math-field"><span
              class="qr-label is-muted"
            >Find</span><input
              type="text"
              class="math-input"
              spellcheck="false"
              value={{this.find}}
              {{on "input" this.setFind}}
            /></label>
          <label class="math-field"><span class="qr-label is-muted">Replace with</span><input
              type="text"
              class="math-input"
              spellcheck="false"
              value={{this.replace}}
              {{on "input" this.setReplace}}
            /></label>
          <label class="math-check"><input
              type="checkbox"
              checked={{this.useRegex}}
              {{on "change" this.toggleRegex}}
            />
            Regular expression ($1, $2… for groups)</label>
          {{#if this.findError}}
            <p class="tool-error">{{this.findError}}</p>
          {{else if this.find}}
            <p class="tool-hint">{{this.matchCount}}
              match{{if (eq this.matchCount 1) "" "es"}}</p>
          {{/if}}
          <button
            type="button"
            class="btn active math-use"
            disabled={{if this.matchCount false true}}
            {{on "click" this.replaceAll}}
          >Replace all</button>
        </section>
      </div>
    </ToolPage>
  </template>
}

function eq(a, b) {
  return a === b;
}
