import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import ToolPage from './tool-page';
import { diff, mergeRuns, DiffTooLargeError } from '../utils/diff';

const MODES = [
  { id: 'lines', label: 'Lines' },
  { id: 'words', label: 'Words' },
  { id: 'chars', label: 'Characters' },
];

const eq = (a, b) => a === b;

const TOKENIZE = {
  lines: (t) => (t ? t.split('\n') : []),
  words: (t) => t.split(/(\s+)/).filter(Boolean),
  chars: (t) => [...t],
};

export default class TextDiffPage extends Component {
  modes = MODES;

  @tracked left = 'The quick brown fox\njumps over\nthe lazy dog.';
  @tracked right = 'The quick red fox\njumps over\nthe very lazy dog!';
  @tracked mode = 'words';
  @tracked ignoreCase = false;
  @tracked ignoreWhitespace = false;

  get key() {
    return (token) => {
      let k = token;
      if (this.ignoreWhitespace) k = this.mode === 'lines' ? k.trim().replace(/\s+/g, ' ') : k.replace(/\s+/g, ' ');
      if (this.ignoreCase) k = k.toLowerCase();
      return k;
    };
  }

  get result() {
    const tokenize = TOKENIZE[this.mode];
    try {
      const ops = diff(tokenize(this.left), tokenize(this.right), this.key);
      if (this.mode === 'lines') return { lines: ops, added: ops.filter((o) => o.type === 'insert').length, removed: ops.filter((o) => o.type === 'delete').length, unit: 'line' };
      const runs = mergeRuns(ops);
      const count = (type) => runs.filter((r) => r.type === type).reduce((n, r) => n + (this.mode === 'words' ? r.value.split(/\s+/).filter(Boolean).length : r.count), 0);
      return { runs, added: count('insert'), removed: count('delete'), unit: this.mode === 'words' ? 'word' : 'character' };
    } catch (error) {
      if (error instanceof DiffTooLargeError) return { error: error.message };
      throw error;
    }
  }

  get identical() {
    return !this.result.error && this.result.added === 0 && this.result.removed === 0;
  }

  setLeft = (e) => (this.left = e.target.value);
  setRight = (e) => (this.right = e.target.value);
  setMode = (mode) => (this.mode = mode);
  toggleCase = () => (this.ignoreCase = !this.ignoreCase);
  toggleWhitespace = () => (this.ignoreWhitespace = !this.ignoreWhitespace);
  swap = () => ([this.left, this.right] = [this.right, this.left]);

  <template>
    <ToolPage @route="text-diff" @subtitle="Paste two versions of something and see exactly what changed, word by word or line by line.">
      <div class="text-tool diff-tool pop-in">
        <div class="math-grid">
          <section class="math-card">
            <label class="field-label" for="diff-left">Original</label>
            <textarea id="diff-left" class="textarea text-area-tall" spellcheck="false" value={{this.left}} {{on "input" this.setLeft}}></textarea>
          </section>
          <section class="math-card">
            <label class="field-label" for="diff-right">Changed</label>
            <textarea id="diff-right" class="textarea text-area-tall" spellcheck="false" value={{this.right}} {{on "input" this.setRight}}></textarea>
          </section>
        </div>

        <section class="math-card">
          <div class="fc-toolbar">
            <div class="math-tabs" role="group" aria-label="Compare by">
              {{#each this.modes as |m|}}
                <button type="button" class="qr-tab {{if (eq this.mode m.id) 'active'}}" {{on "click" (fn this.setMode m.id)}}>{{m.label}}</button>
              {{/each}}
            </div>
            <div class="settings-actions">
              <label class="math-check"><input type="checkbox" checked={{this.ignoreCase}} {{on "change" this.toggleCase}} /> Ignore case</label>
              <label class="math-check"><input type="checkbox" checked={{this.ignoreWhitespace}} {{on "change" this.toggleWhitespace}} /> Ignore whitespace</label>
              <button type="button" class="btn" {{on "click" this.swap}}>Swap</button>
            </div>
          </div>

          {{#if this.result.error}}
            <p class="tool-error">{{this.result.error}}</p>
          {{else}}
            <p class="tool-hint">
              {{#if this.identical}}No differences.{{else}}<span class="diff-count is-ins">+{{this.result.added}}</span> <span class="diff-count is-del">−{{this.result.removed}}</span> {{this.result.unit}}s{{/if}}
            </p>
            {{#if this.result.lines}}
              <ol class="diff-lines">
                {{#each this.result.lines as |line|}}
                  <li class="diff-line is-{{line.type}}"><span class="diff-gutter" aria-hidden="true">{{sign line.type}}</span><span class="diff-text">{{line.value}}</span></li>
                {{/each}}
              </ol>
            {{else}}
              <div class="diff-inline">{{#each this.result.runs as |run|}}{{#if (eq run.type "insert")}}<ins>{{run.value}}</ins>{{else if (eq run.type "delete")}}<del>{{run.value}}</del>{{else}}<span>{{run.value}}</span>{{/if}}{{/each}}</div>
            {{/if}}
          {{/if}}
        </section>
      </div>
    </ToolPage>
  </template>
}

function sign(type) {
  if (type === 'insert') return '+';
  if (type === 'delete') return '−';
  return ' ';
}
