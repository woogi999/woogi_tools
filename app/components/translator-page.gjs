import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { translate, LANGUAGES, languageLabel } from '../utils/translate';
import { keepState } from '../utils/tool-state';

// Two panes, the way Google Translate lays it out: what you type on the left,
// the translation on the right, a language over each and a swap in between.
// The translation is fetched as you pause typing.

const DEBOUNCE_MS = 500;
const MAX_CHARS = 5000;

const eq = (a, b) => a === b;

export default class TranslatorPage extends Component {
  @tracked text = '';
  @tracked from = 'auto';
  @tracked to = 'en';
  @tracked result = '';
  // The language Google detected, when `from` is auto.
  @tracked detected = null;
  @tracked busy = false;
  @tracked error = '';
  @tracked speaking = null;

  languages = LANGUAGES;
  timer = null;
  abort = null;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'translator', ['text', 'from', 'to'], () => {
      if (this.text.trim()) this.run();
    });
    registerDestructor(this, () => {
      clearTimeout(this.timer);
      this.abort?.abort();
      window.speechSynthesis?.cancel();
    });
  }

  get count() {
    return this.text.length;
  }

  get overLimit() {
    return this.text.length > MAX_CHARS;
  }

  get limit() {
    return MAX_CHARS;
  }

  get detectedLabel() {
    if (this.from !== 'auto' || !this.detected) return '';
    return `${languageLabel(this.detected)} detected`;
  }

  get canSpeak() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  // The language a pane is actually in, for the voice: detection filled in.
  get sourceLang() {
    return this.from === 'auto' ? (this.detected ?? '') : this.from;
  }

  // ─── Translating ───────────────────────────────────────────────────

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), DEBOUNCE_MS);
  }

  async run() {
    clearTimeout(this.timer);
    this.abort?.abort();
    const text = this.text;
    if (!text.trim()) {
      this.result = '';
      this.detected = null;
      this.error = '';
      this.busy = false;
      return;
    }
    if (this.overLimit) {
      this.error = `That is over ${MAX_CHARS.toLocaleString()} characters. Try less at a time.`;
      this.busy = false;
      return;
    }
    const abort = (this.abort = new AbortController());
    this.busy = true;
    this.error = '';
    try {
      const out = await translate(text, this.from, this.to, {
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      this.result = out.text;
      this.detected = out.detected;
    } catch (error) {
      if (abort.signal.aborted) return;
      this.error = error?.message || 'The translation failed.';
    } finally {
      if (!abort.signal.aborted) this.busy = false;
    }
  }

  updateText = (event) => {
    this.text = event.target.value;
    this.schedule();
  };

  setFrom = (event) => {
    this.from = event.target.value;
    this.detected = null;
    this.run();
  };

  setTo = (event) => {
    this.to = event.target.value;
    this.run();
  };

  // Swap the languages, and the texts with them, so the translation becomes
  // the thing to translate. Detection can't be swapped into the target side,
  // so whatever was detected stands in for it.
  swap = () => {
    const from = this.from === 'auto' ? (this.detected ?? this.to) : this.from;
    const to = this.to;
    this.from = to;
    this.to = from === to ? 'en' : from;
    if (this.result) {
      this.text = this.result;
      this.result = '';
    }
    this.detected = null;
    this.run();
  };

  clear = () => {
    this.text = '';
    this.run();
  };

  // ─── Reading aloud ─────────────────────────────────────────────────

  speak = (which) => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (this.speaking === which) {
      synth.cancel();
      this.speaking = null;
      return;
    }
    synth.cancel();
    const text = which === 'source' ? this.text : this.result;
    if (!text.trim()) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = which === 'source' ? this.sourceLang : this.to;
    utterance.onend = utterance.onerror = () => {
      if (this.speaking === which) this.speaking = null;
    };
    this.speaking = which;
    synth.speak(utterance);
  };

  speakSource = () => this.speak('source');
  speakResult = () => this.speak('result');

  <template>
    <ToolPage
      @route="translator"
      @busy={{this.busy}}
      @closeWarning="Close the Translator? The translation still running will stop."
      @subtitle="Type on the left and the translation appears on the right, in any of more than a hundred languages. Leave the source on detect and it works out what you wrote."
    >
      <div class="tr-layout pop-in">
        <section class="tr-pane">
          <div class="tr-bar">
            <select
              class="select tr-language"
              aria-label="Translate from"
              {{on "change" this.setFrom}}
            >
              <option value="auto" selected={{eq this.from "auto"}}>Detect
                language</option>
              {{#each this.languages key="code" as |l|}}
                <option
                  value={{l.code}}
                  selected={{eq this.from l.code}}
                >{{l.label}}</option>
              {{/each}}
            </select>
            {{#if this.detectedLabel}}
              <span class="tr-detected">{{this.detectedLabel}}</span>
            {{/if}}
            <span class="lt-spacer"></span>
            {{#if this.canSpeak}}
              <button
                type="button"
                class="qr-icon-btn {{if (eq this.speaking 'source') 'active'}}"
                aria-label="Read the original aloud"
                title="Read aloud"
                disabled={{if this.text false true}}
                {{on "click" this.speakSource}}
              ><Icon
                  @name={{if (eq this.speaking "source") "volume-x" "volume-2"}}
                  @size={{15}}
                /></button>
            {{/if}}
            <button
              type="button"
              class="qr-icon-btn"
              aria-label="Clear"
              title="Clear"
              disabled={{if this.text false true}}
              {{on "click" this.clear}}
            ><Icon @name="x" @size={{14}} /></button>
          </div>
          <div class="tr-editor">
            <textarea
              class="tr-input"
              aria-label="Text to translate"
              placeholder="Type or paste something…"
              spellcheck="false"
              value={{this.text}}
              {{on "input" this.updateText}}
            ></textarea>
          </div>
          <p class="tr-foot {{if this.overLimit 'is-over'}}">
            {{this.count}}
            /
            {{this.limit}}
          </p>
        </section>

        <button
          type="button"
          class="qr-icon-btn tr-swap"
          aria-label="Swap languages"
          title="Swap languages"
          {{on "click" this.swap}}
        ><Icon @name="repeat" @size={{16}} /></button>

        <section class="tr-pane is-result">
          <div class="tr-bar">
            <select
              class="select tr-language"
              aria-label="Translate to"
              {{on "change" this.setTo}}
            >
              {{#each this.languages key="code" as |l|}}
                <option
                  value={{l.code}}
                  selected={{eq this.to l.code}}
                >{{l.label}}</option>
              {{/each}}
            </select>
            <span class="lt-spacer"></span>
            {{#if this.canSpeak}}
              <button
                type="button"
                class="qr-icon-btn {{if (eq this.speaking 'result') 'active'}}"
                aria-label="Read the translation aloud"
                title="Read aloud"
                disabled={{if this.result false true}}
                {{on "click" this.speakResult}}
              ><Icon
                  @name={{if (eq this.speaking "result") "volume-x" "volume-2"}}
                  @size={{15}}
                /></button>
            {{/if}}
            <CopyButton @value={{this.result}} />
          </div>
          <div class="tr-editor {{if this.busy 'is-busy'}}" aria-live="polite">
            {{#if this.error}}
              <p class="tr-output is-error">{{this.error}}</p>
            {{else if this.result}}
              <p class="tr-output">{{this.result}}</p>
            {{else}}
              <p class="tr-output is-empty">Translation</p>
            {{/if}}
          </div>
          <p class="tr-foot is-note">Sent to Google Translate through this
            site's own Worker as you pause typing.</p>
        </section>
      </div>
    </ToolPage>
  </template>
}
