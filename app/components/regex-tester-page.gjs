import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import CopyButton from './copy-button';
import { keepState } from '../utils/tool-state';

const MATCH_LIMIT = 1000;
const TIMEOUT_MS = 1500;

// Runs in a worker so a catastrophically backtracking pattern can be killed
// instead of freezing the page.
const WORKER_SOURCE = `
onmessage = ({ data: { pattern, flags, text, replacement, limit } }) => {
  let re;
  try { re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g'); }
  catch (e) { postMessage({ error: e.message }); return; }
  const matches = [];
  for (const m of text.matchAll(re)) {
    matches.push({ index: m.index, text: m[0], groups: m.slice(1), named: m.groups ? Object.entries(m.groups) : [] });
    if (!flags.includes('g') || matches.length >= limit) break;
  }
  let replaced = null;
  if (replacement !== null) replaced = text.replace(new RegExp(pattern, flags), replacement);
  postMessage({ matches, replaced, capped: matches.length >= limit });
};`;

const FLAGS = [
  { id: 'g', label: 'global', hint: 'Find every match' },
  { id: 'i', label: 'ignore case', hint: 'Case-insensitive' },
  { id: 'm', label: 'multiline', hint: '^ and $ match at line breaks' },
  { id: 's', label: 'dotAll', hint: '. also matches newlines' },
  { id: 'u', label: 'unicode', hint: 'Full Unicode, \\p{…} classes' },
  { id: 'y', label: 'sticky', hint: 'Match only at lastIndex' },
];

const CHEATSHEET = [
  ['.', 'any character'],
  ['\\d \\w \\s', 'digit, word, space'],
  ['[abc] [^abc]', 'one of / none of'],
  ['a* a+ a?', '0+, 1+, 0 or 1'],
  ['a{2,5}', '2 to 5 times'],
  ['^ $ \\b', 'start, end, word edge'],
  ['(x) (?<name>x)', 'capture, named'],
  ['(?:x) x|y', 'group, either'],
  ['(?=x) (?!x)', 'followed / not by x'],
];

export default class RegexTesterPage extends Component {
  flags = FLAGS;
  cheatsheet = CHEATSHEET.map(([token, meaning]) => ({ token, meaning }));

  @tracked pattern = '(?<user>[\\w.+-]+)@(?<domain>[\\w-]+\\.[\\w.]+)';
  @tracked activeFlags = 'gi';
  @tracked text =
    'Contact ann@example.com or bob.smith+news@mail.co.uk for details.';
  @tracked replacement = '$<user> at $<domain>';
  @tracked result = { matches: [] };
  @tracked busy = false;

  worker = null;
  timer = null;
  debounce = null;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'regex-tester', [
      'pattern',
      'activeFlags',
      'text',
      'replacement',
    ]);
    registerDestructor(this, () => {
      this.worker?.terminate();
      clearTimeout(this.timer);
      clearTimeout(this.debounce);
    });
    this.run();
  }

  get segments() {
    const { matches = [] } = this.result;
    const out = [];
    let at = 0;
    matches.forEach((m, i) => {
      if (m.index > at) out.push({ text: this.text.slice(at, m.index) });
      if (m.text) out.push({ text: m.text, match: true, alt: i % 2 === 1 });
      at = Math.max(at, m.index + m.text.length);
    });
    out.push({ text: this.text.slice(at) });
    return out;
  }

  get matchList() {
    return (this.result.matches ?? []).slice(0, 100).map((m, i) => ({
      n: i + 1,
      text: m.text,
      index: m.index,
      groups: [
        ...m.groups.map((g, j) => ({
          name: `$${j + 1}`,
          value: g ?? '(no match)',
        })),
        ...m.named.map(([name, value]) => ({
          name,
          value: value ?? '(no match)',
        })),
      ],
    }));
  }

  run() {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.execute(), 120);
  }

  execute() {
    this.worker?.terminate();
    clearTimeout(this.timer);
    if (!this.pattern) {
      this.result = { matches: [] };
      return;
    }
    const url = URL.createObjectURL(
      new Blob([WORKER_SOURCE], { type: 'text/javascript' }),
    );
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    this.worker = worker;
    this.busy = true;
    worker.onmessage = ({ data }) => {
      clearTimeout(this.timer);
      worker.terminate();
      this.busy = false;
      this.result = data;
    };
    this.timer = setTimeout(() => {
      worker.terminate();
      this.busy = false;
      this.result = {
        matches: [],
        error: `Stopped after ${TIMEOUT_MS / 1000} s. This pattern probably backtracks catastrophically (nested quantifiers like (a+)+ are the usual cause).`,
      };
    }, TIMEOUT_MS);
    worker.postMessage({
      pattern: this.pattern,
      flags: this.activeFlags,
      text: this.text,
      replacement: this.replacement === '' ? null : this.replacement,
      limit: MATCH_LIMIT,
    });
  }

  hasFlag = (id) => this.activeFlags.includes(id);

  toggleFlag = (id) => {
    this.activeFlags = this.hasFlag(id)
      ? this.activeFlags.replace(id, '')
      : FLAGS.map((f) => f.id)
          .filter((f) => f === id || this.activeFlags.includes(f))
          .join('');
    this.run();
  };

  setPattern = (e) => {
    this.pattern = e.target.value;
    this.run();
  };

  setText = (e) => {
    this.text = e.target.value;
    this.run();
  };

  setReplacement = (e) => {
    this.replacement = e.target.value;
    this.run();
  };

  <template>
    <ToolPage
      @route="regex-tester"
      @subtitle="Write a JavaScript regular expression and watch matches, capture groups and replacements light up as you type."
    >
      <div class="text-tool pop-in">
        <div class="math-grid">
          <section class="math-card">
            <label class="math-field">
              <span class="qr-label is-muted">Pattern</span>
              <span class="regex-input"><span aria-hidden="true">/</span><input
                  type="text"
                  class="math-input"
                  spellcheck="false"
                  autocomplete="off"
                  value={{this.pattern}}
                  {{on "input" this.setPattern}}
                /><span aria-hidden="true">/{{this.activeFlags}}</span></span>
            </label>
            <div class="line-actions" role="group" aria-label="Flags">
              {{#each this.flags as |f|}}
                <button
                  type="button"
                  class="btn {{if (this.hasFlag f.id) 'active'}}"
                  title={{f.hint}}
                  aria-pressed={{if (this.hasFlag f.id) "true" "false"}}
                  {{on "click" (fn this.toggleFlag f.id)}}
                >{{f.id}} · {{f.label}}</button>
              {{/each}}
            </div>
            <label class="field-label" for="rx-text">Test text</label>
            <textarea
              id="rx-text"
              class="textarea text-area-tall"
              spellcheck="false"
              value={{this.text}}
              {{on "input" this.setText}}
            ></textarea>

            {{#if this.result.error}}
              <p class="tool-error">{{this.result.error}}</p>
            {{else}}
              <p class="tool-hint">{{this.result.matches.length}}{{if
                  this.result.capped
                  "+"
                }}
                match{{if (eq this.result.matches.length 1) "" "es"}}{{if
                  this.busy
                  " · working…"
                }}</p>
              <div class="regex-preview">{{#each this.segments as |s|}}{{#if
                    s.match
                  }}<mark
                      class={{if s.alt "is-alt"}}
                    >{{s.text}}</mark>{{else}}{{s.text}}{{/if}}{{/each}}</div>
            {{/if}}

            <label class="math-field">
              <span class="qr-label is-muted">Replace with (optional)</span>
              <input
                type="text"
                class="math-input"
                spellcheck="false"
                value={{this.replacement}}
                {{on "input" this.setReplacement}}
              />
            </label>
            {{#if this.result.replaced}}
              <div class="field-head"><span
                  class="qr-label is-muted"
                >Result</span><CopyButton
                  @value={{this.result.replaced}}
                /></div>
              <pre class="code-block">{{this.result.replaced}}</pre>
            {{/if}}
          </section>

          <section class="math-card">
            <h3 class="qr-heading">Matches</h3>
            {{#if this.matchList.length}}
              <ol class="regex-matches">
                {{#each this.matchList as |m|}}
                  <li>
                    <div class="field-head"><code>{{m.text}}</code><span
                        class="tool-hint"
                      >#{{m.n}} at {{m.index}}</span></div>
                    {{#each m.groups as |g|}}
                      <div class="regex-group"><span
                          class="tool-hint"
                        >{{g.name}}</span><code>{{g.value}}</code></div>
                    {{/each}}
                  </li>
                {{/each}}
              </ol>
            {{else}}
              <p class="tool-hint">No matches yet.</p>
            {{/if}}
            <h3 class="qr-heading">Cheat sheet</h3>
            <dl class="fc-formats">
              {{#each this.cheatsheet as |c|}}
                <dt><code>{{c.token}}</code></dt>
                <dd class="tool-hint">{{c.meaning}}</dd>
              {{/each}}
            </dl>
          </section>
        </div>
      </div>
    </ToolPage>
  </template>
}

function eq(a, b) {
  return a === b;
}
