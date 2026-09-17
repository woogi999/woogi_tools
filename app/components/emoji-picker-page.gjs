import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { EMOJI, CATEGORIES, SKIN_TONES, withTone } from '../utils/emoji-data';
import { keepState } from '../utils/tool-state';

// Find an emoji by name, tap it to copy, or line a few up to paste at once.
// The code points are shown so it works for CSS and code as well as chat.

const eq = (a, b) => a === b;
const swatch = (colour) => htmlSafe(`background:${colour}`);

const codePoints = (char) =>
  [...char]
    .map(
      (c) =>
        `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
    )
    .join(' ');

export default class EmojiPickerPage extends Component {
  @tracked query = '';
  @tracked category = 'Smileys';
  @tracked tone = '';
  @tracked picked = '';
  @tracked recent = [];
  @tracked flash = null;

  categories = CATEGORIES;
  tones = SKIN_TONES;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'emoji-picker', ['tone', 'recent', 'category']);
  }

  get searching() {
    return this.query.trim().length > 0;
  }

  get shown() {
    const q = this.query.trim().toLowerCase();
    const list = q
      ? EMOJI.filter((e) => e.search.includes(q) || e.char === q)
      : EMOJI.filter((e) => e.category === this.category);
    return list.map((e) => ({ ...e, shown: withTone(e, this.tone) }));
  }

  get recentEntries() {
    return this.recent
      .map((char) => EMOJI.find((e) => e.char === char))
      .filter(Boolean)
      .map((e) => ({ ...e, shown: withTone(e, this.tone) }));
  }

  get flashInfo() {
    if (!this.flash) return null;
    return { ...this.flash, codes: codePoints(this.flash.shown) };
  }

  setQuery = (event) => (this.query = event.target.value);
  clearQuery = () => (this.query = '');
  pickCategory = (id) => {
    this.category = id;
    this.query = '';
  };
  pickTone = (id) => (this.tone = id);
  setPicked = (event) => (this.picked = event.target.value);
  clearPicked = () => (this.picked = '');

  // Tapping copies straight away and also drops it into the line-up.
  choose = async (entry) => {
    this.picked += entry.shown;
    this.recent = [
      entry.char,
      ...this.recent.filter((c) => c !== entry.char),
    ].slice(0, 24);
    this.flash = entry;
    try {
      await navigator.clipboard.writeText(entry.shown);
    } catch {
      // No clipboard: it's still in the line-up to copy from.
    }
  };

  <template>
    <ToolPage
      @route="emoji-picker"
      @subtitle="Every emoji people actually use, searchable by name. Tap one to copy it, or line up a few and copy the lot. Skin tones included."
    >
      <div class="ep-page pop-in">
        <div class="ep-search">
          <Icon @name="search" @size={{14}} />
          <input
            type="search"
            class="math-input"
            placeholder="Search by name: cat, party, thumbs…"
            aria-label="Search emoji"
            value={{this.query}}
            {{on "input" this.setQuery}}
          />
          <div class="ep-tones" role="group" aria-label="Skin tone">
            {{#each this.tones as |t|}}
              <button
                type="button"
                class="ep-tone {{if (eq this.tone t.id) 'active'}}"
                style={{swatch t.swatch}}
                title={{t.label}}
                aria-label={{t.label}}
                {{on "click" (fn this.pickTone t.id)}}
              ></button>
            {{/each}}
          </div>
        </div>

        <div class="ep-lineup">
          <input
            type="text"
            class="math-input ep-lineup-input"
            placeholder="Tap emoji to line them up here"
            aria-label="Picked emoji"
            value={{this.picked}}
            {{on "input" this.setPicked}}
          />
          <CopyButton @value={{this.picked}} />
          <button
            type="button"
            class="btn"
            {{on "click" this.clearPicked}}
          >Clear</button>
        </div>
        {{#if this.flashInfo}}
          <p class="tool-hint ep-flash"><span
              class="ep-flash-char"
            >{{this.flashInfo.shown}}</span>
            <strong>{{this.flashInfo.name}}</strong>
            · copied ·
            <code>{{this.flashInfo.codes}}</code></p>
        {{/if}}

        {{#unless this.searching}}
          <div class="cipher-picks" role="tablist" aria-label="Category">
            {{#each this.categories as |c|}}
              <button
                type="button"
                role="tab"
                class="qr-tab {{if (eq this.category c) 'active'}}"
                aria-selected={{if (eq this.category c) "true" "false"}}
                {{on "click" (fn this.pickCategory c)}}
              >{{c}}</button>
            {{/each}}
          </div>
          {{#if this.recentEntries.length}}
            <span class="qr-label is-muted">Recently used</span>
            <div class="ep-grid is-small">
              {{#each this.recentEntries key="char" as |e|}}
                <button
                  type="button"
                  class="ep-cell"
                  title={{e.name}}
                  {{on "click" (fn this.choose e)}}
                >{{e.shown}}</button>
              {{/each}}
            </div>
          {{/if}}
        {{/unless}}

        <div class="ep-grid">
          {{#each this.shown key="char" as |e|}}
            <button
              type="button"
              class="ep-cell"
              title={{e.name}}
              {{on "click" (fn this.choose e)}}
            >{{e.shown}}</button>
          {{else}}
            <p class="fs-empty">Nothing called that. Try another word.</p>
          {{/each}}
        </div>
      </div>
    </ToolPage>
  </template>
}
