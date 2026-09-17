import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { readability } from '../utils/grammar';
import { keepState } from '../utils/tool-state';
import {
  check,
  applyMatch,
  applyAll,
  segments,
  kindOf,
  titleOf,
  LANGUAGES,
} from '../utils/languagetool';

// The grammar checker, on LanguageTool. You write on the left with the problems
// underlined where they are, and each one gets a card on the right saying what
// is wrong and what to put instead: the shape languagetool.org uses, because
// for this job it is the right one.
//
// LanguageTool runs on a server, so the text does leave the device. The page
// says so plainly rather than burying it.

const KIND_ICON = {
  spelling: 'spell-check',
  grammar: 'circle-alert',
  punctuation: 'type',
  style: 'sparkles',
};
const KIND_LABEL = {
  spelling: 'Spelling',
  grammar: 'Grammar',
  punctuation: 'Punctuation',
  style: 'Style',
};
const DEBOUNCE_MS = 900;
const eq = (a, b) => a === b;

export default class GrammarCheckerPage extends Component {
  @tracked text = '';
  @tracked matches = [];
  @tracked dismissed = [];
  @tracked language = 'auto';
  @tracked picky = false;
  @tracked detected = '';
  @tracked busy = false;
  @tracked error = '';
  @tracked selected = null;
  @tracked checkedText = '';

  languages = LANGUAGES;
  timer = null;
  abort = null;

  constructor(owner, args) {
    super(owner, args);
    // Text restored from a previous visit is checked straight away, so the
    // suggestions are there without having to touch the keyboard first.
    keepState(this, 'grammar-checker', ['text', 'language', 'picky'], () => {
      if (this.text.trim()) this.run();
    });
    registerDestructor(this, () => {
      clearTimeout(this.timer);
      this.abort?.abort();
    });
  }

  // A dismissed suggestion is remembered by what it said about which words, so
  // it stays dismissed while you carry on typing elsewhere.
  keyFor = (match) =>
    `${match.ruleId}:${this.checkedText.slice(match.offset, match.offset + match.length)}`;

  get live() {
    return this.matches.filter((m) => !this.dismissed.includes(this.keyFor(m)));
  }

  get cards() {
    return this.live.map((match, i) => {
      const kind = kindOf(match);
      const id = `${match.offset}:${match.ruleId}:${i}`;
      return {
        ...match,
        id,
        kind,
        kindLabel: KIND_LABEL[kind] ?? 'Suggestion',
        icon: KIND_ICON[kind] ?? 'circle-alert',
        title: titleOf(match),
        word: this.checkedText.slice(match.offset, match.offset + match.length),
        active: this.selected === id,
      };
    });
  }

  // Underlining only makes sense against the text that was actually checked.
  get pieces() {
    if (this.text !== this.checkedText) return [{ id: 't0', text: this.text }];
    return segments(this.text, this.live).map((piece) => ({
      ...piece,
      kind: piece.match ? kindOf(piece.match) : '',
    }));
  }

  get counts() {
    const list = this.cards;
    return {
      total: list.length,
      mistakes: list.filter((c) => c.kind !== 'style').length,
      style: list.filter((c) => c.kind === 'style').length,
    };
  }

  get fixable() {
    return this.live.filter((m) => m.replacements?.length).length;
  }

  get stats() {
    return this.text.trim() ? readability(this.text) : null;
  }

  get statusText() {
    if (this.busy) return 'Checking…';
    if (this.error) return this.error;
    if (!this.text.trim())
      return 'Start writing and it gets checked a moment after you stop.';
    if (this.text !== this.checkedText) return 'Waiting for you to pause…';
    if (!this.counts.total) return 'Nothing to flag.';
    return `${this.counts.mistakes} to fix, ${this.counts.style} style notes`;
  }

  setText = (event) => {
    this.text = event.target.value;
    this.schedule();
  };

  setLanguage = (event) => {
    this.language = event.target.value;
    this.run();
  };

  togglePicky = () => {
    this.picky = !this.picky;
    this.run();
  };

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), DEBOUNCE_MS);
  }

  run = async () => {
    clearTimeout(this.timer);
    this.abort?.abort();
    const text = this.text;
    if (!text.trim()) {
      this.matches = [];
      this.checkedText = text;
      this.error = '';
      return;
    }
    this.abort = new AbortController();
    this.busy = true;
    this.error = '';
    try {
      const result = await check(text, {
        language: this.language,
        picky: this.picky,
        signal: this.abort.signal,
      });
      this.matches = result.matches;
      this.checkedText = text;
      this.detected = result.language;
      this.selected = null;
    } catch (error) {
      if (error.name === 'AbortError') return;
      this.error = error.message;
      this.matches = [];
    } finally {
      this.busy = false;
    }
  };

  // Taking a suggestion shifts everything after it, so the text is re-checked.
  accept = (card, replacement) => {
    this.text = applyMatch(this.text, card, replacement);
    this.matches = [];
    this.checkedText = this.text;
    this.run();
  };

  dismiss = (card) => (this.dismissed = [...this.dismissed, this.keyFor(card)]);

  acceptAll = () => {
    this.text = applyAll(this.text, this.live);
    this.matches = [];
    this.checkedText = this.text;
    this.run();
  };

  select = (card) =>
    (this.selected = this.selected === card.id ? null : card.id);

  clear = () => {
    this.text = '';
    this.matches = [];
    this.checkedText = '';
    this.dismissed = [];
    this.error = '';
  };

  // The underlines live in a layer behind the textarea, so the two have to
  // scroll together for a problem to stay under its own words.
  syncScroll = modifier((textarea) => {
    const layer = textarea.previousElementSibling;
    const onScroll = () => {
      layer.scrollTop = textarea.scrollTop;
      layer.scrollLeft = textarea.scrollLeft;
    };
    textarea.addEventListener('scroll', onScroll);
    return () => textarea.removeEventListener('scroll', onScroll);
  });

  <template>
    <ToolPage
      @route="grammar-checker"
      @subtitle="Checks your spelling, grammar, punctuation and style with LanguageTool, and says what is wrong with each one rather than just underlining it."
    >
      <div class="lt-layout pop-in">
        <section class="lt-main">
          <div class="lt-toolbar">
            <select
              class="select lt-language"
              aria-label="Language"
              {{on "change" this.setLanguage}}
            >
              {{#each this.languages key="code" as |l|}}
                <option
                  value={{l.code}}
                  selected={{eq this.language l.code}}
                >{{l.label}}</option>
              {{/each}}
            </select>
            <button
              type="button"
              class="btn {{if this.picky 'active'}}"
              aria-pressed={{if this.picky "true" "false"}}
              title="Also flag wordiness, repetition and other style habits"
              {{on "click" this.togglePicky}}
            >
              <Icon @name="sparkles" @size={{13}} />
              Picky mode
            </button>
            <span class="lt-spacer"></span>
            {{#if this.fixable}}
              <button
                type="button"
                class="btn active"
                {{on "click" this.acceptAll}}
              ><Icon @name="wand" @size={{13}} />
                Accept all
                {{this.fixable}}</button>
            {{/if}}
            <CopyButton @value={{this.text}} />
            <button
              type="button"
              class="btn"
              disabled={{if this.text false true}}
              {{on "click" this.clear}}
            ><Icon @name="x" @size={{13}} /> Clear</button>
          </div>

          <div class="lt-editor">
            <div class="lt-underlay" aria-hidden="true">
              {{#each this.pieces key="id" as |piece|}}
                {{#if piece.match}}<mark
                    class="lt-mark is-{{piece.kind}}"
                  >{{piece.text}}</mark>{{else}}{{piece.text}}{{/if}}
              {{/each}}
              <br />
            </div>
            <textarea
              class="lt-input"
              aria-label="Your writing"
              spellcheck="false"
              placeholder="Paste or write something here. It gets checked a moment after you stop typing."
              value={{this.text}}
              {{on "input" this.setText}}
              {{this.syncScroll}}
            ></textarea>
          </div>

          <div class="lt-status">
            <span
              class="{{if this.error 'tool-error' 'tool-hint'}}"
            >{{this.statusText}}</span>
            {{#if this.stats}}
              <span class="lt-stats">{{this.stats.words}}
                words ·
                {{this.stats.sentences}}
                sentences ·
                {{this.stats.label}}{{#if this.detected}}
                  ·
                  {{this.detected}}{{/if}}</span>
            {{/if}}
          </div>
        </section>

        <aside class="lt-side">
          <div class="lt-side-head">
            <h3 class="qr-heading">Suggestions</h3>
            {{#if this.counts.total}}<span
                class="lt-count"
              >{{this.counts.total}}</span>{{/if}}
          </div>

          {{#if this.cards.length}}
            <ul class="lt-cards">
              {{#each this.cards key="id" as |card|}}
                <li
                  class="lt-card is-{{card.kind}}
                    {{if card.active 'is-active'}}"
                >
                  <button
                    type="button"
                    class="lt-card-head"
                    {{on "click" (fn this.select card)}}
                  >
                    <span class="lt-card-kind"><Icon
                        @name={{card.icon}}
                        @size={{13}}
                      />
                      {{card.kindLabel}}</span>
                    <span class="lt-card-word">{{card.word}}</span>
                  </button>
                  <p class="lt-card-message">{{card.message}}</p>
                  {{#if card.replacements.length}}
                    <div class="lt-replacements">
                      {{#each card.replacements key="@index" as |replacement|}}
                        <button
                          type="button"
                          class="lt-replacement"
                          {{on "click" (fn this.accept card replacement)}}
                        >{{replacement}}</button>
                      {{/each}}
                    </div>
                  {{/if}}
                  <div class="lt-card-actions">
                    <button
                      type="button"
                      class="lt-link"
                      {{on "click" (fn this.dismiss card)}}
                    >Dismiss</button>
                    {{#if card.url}}
                      <a
                        class="lt-link"
                        href={{card.url}}
                        target="_blank"
                        rel="noopener noreferrer"
                      >Why?</a>
                    {{/if}}
                  </div>
                </li>
              {{/each}}
            </ul>
          {{else if this.busy}}
            <p class="tool-hint">Checking…</p>
          {{else if this.text}}
            <p class="tool-hint"><Icon @name="circle-check-big" @size={{15}} />
              Nothing to flag. LanguageTool is good but not infallible, so give
              it a read yourself too.</p>
          {{else}}
            <p class="tool-hint">Whatever it finds turns up here, with a note on
              why and something to put instead.</p>
          {{/if}}

          <p class="tool-hint lt-privacy">
            <Icon @name="circle-alert" @size={{13}} />
            Unlike the other text tools, this one sends what you write to
            LanguageTool to be checked. Keep anything confidential out of it.
          </p>
        </aside>
      </div>
    </ToolPage>
  </template>
}
