import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { keepState } from '../utils/tool-state';
import {
  PATTERNS,
  CATEGORIES,
  snippets,
  selfTest,
} from '../utils/regex-library';

const eq = (a, b) => a === b;

// A match run against whatever you typed into the try-it box, with the hits
// marked up as before/hit/after pieces so the template can highlight them
// without building HTML by hand.
function tryPattern(entry, text) {
  if (!text) return null;
  let re;
  try {
    re = new RegExp(
      entry.pattern,
      entry.flags.includes('g') ? entry.flags : `${entry.flags}g`,
    );
  } catch (error) {
    return { error: error.message, pieces: [], count: 0 };
  }
  const pieces = [];
  let last = 0;
  let count = 0;
  for (const match of text.matchAll(re)) {
    // A pattern that can match nothing (a lookahead, say) would loop forever
    // on its own if matchAll didn't already guard it; here it just adds no
    // visible highlight, so the position markers are counted and skipped.
    if (match[0] === '') {
      count++;
      continue;
    }
    if (match.index > last)
      pieces.push({
        hit: false,
        text: text.slice(last, match.index),
        key: pieces.length,
      });
    pieces.push({ hit: true, text: match[0], key: pieces.length });
    last = match.index + match[0].length;
    count++;
    if (count > 500) break;
  }
  if (last < text.length)
    pieces.push({ hit: false, text: text.slice(last), key: pieces.length });
  return { error: null, pieces, count };
}

export default class RegexLibraryPage extends Component {
  categories = CATEGORIES;

  @tracked search = '';
  @tracked category = 'All';
  @tracked openId = null;
  @tracked sample = '';
  @tracked language = 'JavaScript';

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'regex-library', ['category', 'language']);
  }

  get filterCategories() {
    return ['All', ...CATEGORIES];
  }

  get entries() {
    const q = this.search.trim().toLowerCase();
    return PATTERNS.filter((p) => {
      if (this.category !== 'All' && p.category !== this.category) return false;
      if (!q) return true;
      return `${p.name} ${p.what} ${p.note ?? ''} ${p.pattern} ${p.category}`
        .toLowerCase()
        .includes(q);
    }).map((p) => {
      const open = p.id === this.openId;
      return {
        ...p,
        open,
        // The heavy work — running the samples, rendering six languages — only
        // happens for the one card you've actually opened.
        test: open ? selfTest(p) : null,
        snippets: open ? snippets(p) : null,
        chosen: open
          ? (snippets(p).find((s) => s.language === this.language) ??
            snippets(p)[0])
          : null,
        tried: open ? tryPattern(p, this.sample) : null,
      };
    });
  }

  get languages() {
    return snippets(PATTERNS[0]).map((s) => s.language);
  }

  setSearch = (e) => (this.search = e.target.value);
  setCategory = (c) => (this.category = c);
  setSample = (e) => (this.sample = e.target.value);
  setLanguage = (e) => (this.language = e.target.value);

  toggle = (id) => {
    this.openId = this.openId === id ? null : id;
    this.sample = '';
  };

  // The card's own "should match" samples, dropped into the try-it box, so
  // opening one and pressing this shows the pattern working immediately.
  useSamples = (entry) => {
    this.sample = [...entry.good, ...entry.bad].join('\n');
  };

  <template>
    <ToolPage
      @route="regex-library"
      @subtitle="Regexes worth copying, each one explained, with the cases it quietly doesn't cover written down. Try any of them against your own text before you take it."
    >
      <div class="text-tool pop-in">
        <section class="math-card">
          <div class="math-row is-aligned">
            <input
              type="search"
              class="math-input"
              placeholder="Search: email, date, password…"
              aria-label="Search patterns"
              value={{this.search}}
              {{on "input" this.setSearch}}
            />
            <label class="math-field">
              <span class="qr-label is-muted">Copy as</span>
              <select class="select" {{on "change" this.setLanguage}}>
                {{#each this.languages as |l|}}
                  <option
                    value={{l}}
                    selected={{eq l this.language}}
                  >{{l}}</option>
                {{/each}}
              </select>
            </label>
          </div>
          <div class="math-tabs" role="group" aria-label="Category">
            {{#each this.filterCategories as |c|}}
              <button
                type="button"
                class="qr-tab {{if (eq this.category c) 'active'}}"
                {{on "click" (fn this.setCategory c)}}
              >{{c}}</button>
            {{/each}}
          </div>
        </section>

        <ul class="rxl-list">
          {{#each this.entries key="id" as |entry|}}
            <li class="rxl-card {{if entry.open 'is-open'}}">
              <button
                type="button"
                class="rxl-head"
                aria-expanded={{if entry.open "true" "false"}}
                {{on "click" (fn this.toggle entry.id)}}
              >
                <span class="rxl-title">
                  <strong>{{entry.name}}</strong>
                  <span class="tool-hint">{{entry.what}}</span>
                </span>
                <code class="rxl-pattern">{{entry.pattern}}</code>
                <Icon
                  @name={{if entry.open "chevrons-left" "chevrons-right"}}
                  @size={{14}}
                />
              </button>

              {{#if entry.open}}
                <div class="rxl-body">
                  <div class="field-head">
                    <span
                      class="qr-label is-muted"
                    >{{entry.chosen.language}}</span>
                    <CopyButton @value={{entry.chosen.code}} />
                  </div>
                  <pre class="rxl-code"><code>{{entry.chosen.code}}</code></pre>

                  {{#if entry.note}}
                    <p class="tool-hint rxl-note"><Icon
                        @name="info"
                        @size={{13}}
                      />
                      {{entry.note}}</p>
                  {{/if}}

                  <div class="field-head">
                    <span class="qr-label is-muted">Try it</span>
                    <button
                      type="button"
                      class="btn"
                      {{on "click" (fn this.useSamples entry)}}
                    >Use the examples</button>
                  </div>
                  <textarea
                    class="textarea is-mono"
                    spellcheck="false"
                    aria-label="Text to test against"
                    placeholder="Paste something to run this against"
                    value={{this.sample}}
                    {{on "input" this.setSample}}
                  ></textarea>
                  {{#if entry.tried}}
                    {{#if entry.tried.error}}
                      <p class="tool-error">{{entry.tried.error}}</p>
                    {{else}}
                      <p class="tool-hint">{{entry.tried.count}}
                        {{if (eq entry.tried.count 1) "match" "matches"}}</p>
                      <pre class="rxl-result">{{#each
                          entry.tried.pieces key="key"
                          as |piece|
                        }}{{#if piece.hit}}<mark
                            >{{piece.text}}</mark>{{else}}{{piece.text}}{{/if}}{{/each}}</pre>
                    {{/if}}
                  {{/if}}

                  <div class="rxl-samples">
                    <span class="qr-label is-muted">Checked against its own
                      examples</span>
                    {{#if entry.test.ok}}
                      <span class="rxl-pass"><Icon
                          @name="circle-check-big"
                          @size={{13}}
                        />
                        all as expected</span>
                    {{else}}
                      <span class="tool-error">this one isn't behaving as
                        documented</span>
                    {{/if}}
                    <ul>
                      {{#each entry.test.results key="sample" as |r|}}
                        <li
                          class="rxl-sample
                            {{if r.expected 'is-good' 'is-bad'}}"
                        >
                          <Icon
                            @name={{if r.expected "check" "x"}}
                            @size={{12}}
                          />
                          <code>{{r.sample}}</code>
                        </li>
                      {{/each}}
                    </ul>
                  </div>
                </div>
              {{/if}}
            </li>
          {{else}}
            <li class="tool-hint">Nothing here matches that. Try the Regex
              Tester if you're writing one of your own.</li>
          {{/each}}
        </ul>
      </div>
    </ToolPage>
  </template>
}
