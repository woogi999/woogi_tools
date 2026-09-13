import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import ToolPage from './tool-page';
import CopyButton from './copy-button';

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'so', 'the', 'to', 'up', 'yet', 'via']);

// Splits "someHTTPRequest_id-2 value" into ["some", "HTTP", "Request", "id", "2", "value"].
function identifierWords(text) {
  return text
    .replace(/([\p{Ll}\d])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

// Case-style changes apply line by line so pasted lists keep their shape.
const perLine = (fn) => (text) => text.split('\n').map(fn).join('\n');

const CASES = [
  { id: 'upper', label: 'UPPER CASE', fn: (t) => t.toUpperCase() },
  { id: 'lower', label: 'lower case', fn: (t) => t.toLowerCase() },
  {
    id: 'title',
    label: 'Title Case',
    fn: perLine((line) => {
      const words = line.toLowerCase().split(/(\s+)/);
      const last = words.length - 1;
      return words.map((w, i) => (/\s/.test(w) || (i !== 0 && i !== last && SMALL_WORDS.has(w)) ? w : w.replace(/\p{L}/u, (c) => c.toUpperCase()))).join('');
    }),
  },
  { id: 'sentence', label: 'Sentence case', fn: (t) => t.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, pre, c) => pre + c.toUpperCase()) },
  { id: 'camel', label: 'camelCase', fn: perLine((l) => identifierWords(l).map((w, i) => (i ? cap(w) : w.toLowerCase())).join('')) },
  { id: 'pascal', label: 'PascalCase', fn: perLine((l) => identifierWords(l).map(cap).join('')) },
  { id: 'snake', label: 'snake_case', fn: perLine((l) => identifierWords(l).join('_').toLowerCase()) },
  { id: 'constant', label: 'CONSTANT_CASE', fn: perLine((l) => identifierWords(l).join('_').toUpperCase()) },
  { id: 'kebab', label: 'kebab-case', fn: perLine((l) => identifierWords(l).join('-').toLowerCase()) },
  { id: 'dot', label: 'dot.case', fn: perLine((l) => identifierWords(l).join('.').toLowerCase()) },
  { id: 'inverse', label: 'iNVERSE cASE', fn: (t) => [...t].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('') },
  { id: 'alternating', label: 'aLtErNaTiNg', fn: (t) => { let i = 0; return [...t].map((c) => (/\p{L}/u.test(c) ? (i++ % 2 ? c.toUpperCase() : c.toLowerCase()) : c)).join(''); } },
];

export default class TextCasePage extends Component {
  @tracked text = 'The quick brown fox jumps over the lazy dog';

  get results() {
    return CASES.map((c) => ({ ...c, value: c.fn(this.text) }));
  }

  setText = (event) => (this.text = event.target.value);

  <template>
    <ToolPage @route="text-case" @subtitle="See your text in every common case at once, from Title Case to snake_case.">
      <div class="math-grid text-tool pop-in">
        <section class="math-card">
          <label class="field-label" for="tc-text">Text</label>
          <textarea id="tc-text" class="textarea text-area-tall" value={{this.text}} {{on "input" this.setText}}></textarea>
        </section>
        <section class="math-card">
          <h3 class="qr-heading">Results</h3>
          <ul class="case-list">
            {{#each this.results key="id" as |r|}}
              <li class="case-item">
                <div class="case-text">
                  <span class="qr-label is-muted">{{r.label}}</span>
                  <span class="case-value">{{r.value}}</span>
                </div>
                <CopyButton @value={{r.value}} />
              </li>
            {{/each}}
          </ul>
        </section>
      </div>
    </ToolPage>
  </template>
}
