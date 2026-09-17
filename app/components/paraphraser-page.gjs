import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { paraphrase, howDifferent, TONES } from '../utils/paraphrase';
import { loadModel, ask, isLoaded } from '../utils/ai-models';
import { check, applyAll, LANGUAGES } from '../utils/languagetool';
import { keepState } from '../utils/tool-state';

// Says the same thing differently: plainer, more formal, shorter or friendlier,
// laid out the way the grammar checker is so the two feel like one tool.
//
// LanguageTool has no rewriting of its own in its open API, so the rewrites
// still come from the rules and the small on-device model. What LanguageTool
// does here is check the results: every version is run past it, so a rewrite
// that introduces a mistake is caught and can be tidied in one press.

const DEBOUNCE_MS = 700;

export default class ParaphraserPage extends Component {
  @tracked text = '';
  @tracked tone = 'plain';
  @tracked language = 'auto';
  @tracked modelVersions = [];
  @tracked modelBusy = false;
  @tracked modelStatus = '';
  @tracked modelError = null;
  // { [version id]: { matches, tidied } }: what LanguageTool made of each one.
  @tracked reviews = {};
  @tracked reviewError = '';

  tones = TONES;
  languages = LANGUAGES;
  timer = null;
  abort = null;

  constructor(owner, args) {
    super(owner, args);
    // Restored text gets its rewrites checked straight away, the same as if you
    // had just stopped typing it.
    keepState(this, 'paraphraser', ['text', 'tone', 'language'], () => {
      if (this.text.trim()) this.review();
    });
    registerDestructor(this, () => {
      clearTimeout(this.timer);
      this.abort?.abort();
    });
  }

  get toneSpec() {
    return TONES.find((t) => t.id === this.tone) ?? TONES[0];
  }

  get ruleVersions() {
    return paraphrase(this.text, this.tone).map((v, i) => ({
      ...v,
      id: `rule-${i}`,
      changed: howDifferent(this.text, v.text),
    }));
  }

  get versions() {
    return [...this.ruleVersions, ...this.modelVersions].map((v) => {
      const review = this.reviews[v.id];
      const issues = review?.matches?.length ?? 0;
      return {
        ...v,
        issues,
        checked: Boolean(review),
        tidied: review?.tidied && review.tidied !== v.text ? review.tidied : '',
        verdict: !review
          ? ''
          : issues
            ? `${issues} thing${issues === 1 ? '' : 's'} LanguageTool would change`
            : 'LanguageTool found nothing wrong',
      };
    });
  }

  setText = (event) => {
    this.text = event.target.value;
    this.schedule();
  };

  setTone = (tone) => {
    this.tone = tone;
    this.schedule();
  };

  setLanguage = (event) => {
    this.language = event.target.value;
    this.review();
  };

  use = (text) => {
    this.text = text;
    this.modelVersions = [];
    this.schedule();
  };

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.review(), DEBOUNCE_MS);
  }

  // Every version goes past LanguageTool in one batch, so a rewrite that reads
  // well but is not quite right does not slip through unremarked.
  review = async () => {
    clearTimeout(this.timer);
    this.abort?.abort();
    const versions = [...this.ruleVersions, ...this.modelVersions];
    if (!versions.length) {
      this.reviews = {};
      this.reviewError = '';
      return;
    }
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.reviewError = '';
    try {
      const results = await Promise.all(
        versions.map((v) => check(v.text, { language: this.language, signal })),
      );
      if (signal.aborted) return;
      this.reviews = Object.fromEntries(
        versions.map((v, i) => [
          v.id,
          {
            matches: results[i].matches,
            tidied: applyAll(v.text, results[i].matches),
          },
        ]),
      );
    } catch (error) {
      if (error.name === 'AbortError') return;
      this.reviewError = error.message;
      this.reviews = {};
    }
  };

  // The model has a go at the same job, in its own words.
  rewrite = async () => {
    if (this.modelBusy || !this.text.trim()) return;
    this.modelBusy = true;
    this.modelError = null;
    this.modelVersions = [];
    const how = {
      plain: 'in plain, everyday English',
      formal: 'in formal English',
      short: 'as briefly as possible',
      friendly: 'in a warm, friendly way',
    }[this.tone];
    try {
      this.modelStatus = isLoaded('flan-t5')
        ? 'Thinking…'
        : 'Downloading the writing model (about 120 MB, once)…';
      const model = await loadModel('flan-t5', {
        onProgress: ({ ratio }) =>
          (this.modelStatus = `Downloading the writing model… ${Math.round((ratio ?? 0) * 100)}%`),
      });
      const out = [];
      // Two goes, because a small model's first answer isn't always its best.
      for (let i = 0; i < 2; i++) {
        this.modelStatus = `Rewriting… ${i + 1} of 2`;
        const answer = await ask(
          model,
          `Rewrite this ${how}, keeping the meaning: ${this.text.trim()}`,
          { max: 200 },
        );
        if (answer && !out.some((v) => v.text === answer))
          out.push({
            id: `model-${i}`,
            label: 'From the model',
            text: answer,
            changed: howDifferent(this.text, answer),
          });
      }
      this.modelVersions = out;
      if (!out.length)
        this.modelError =
          'The model didn’t come back with anything useful. Try a shorter piece.';
      else this.review();
    } catch (error) {
      this.modelError = error?.message ?? 'The model couldn’t be loaded';
    } finally {
      this.modelBusy = false;
      this.modelStatus = '';
    }
  };

  <template>
    <ToolPage
      @route="paraphraser"
      @subtitle="Say the same thing another way: plainer, more formal, shorter or friendlier. Every version is then checked by LanguageTool, so a rewrite can't quietly introduce a mistake."
    >
      <div class="lt-layout pop-in">
        <section class="lt-main">
          <div class="lt-toolbar">
            <div class="math-tabs lt-tones" role="group" aria-label="Tone">
              {{#each this.tones as |t|}}
                <button
                  type="button"
                  class="qr-tab {{if (eq this.tone t.id) 'active'}}"
                  {{on "click" (fn this.setTone t.id)}}
                >{{t.label}}</button>
              {{/each}}
            </div>
            <span class="lt-spacer"></span>
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
              class="btn"
              disabled={{this.modelBusy}}
              {{on "click" this.rewrite}}
            >
              <Icon @name="sparkles" @size={{13}} />
              {{if this.modelBusy "Working…" "Let the model try"}}
            </button>
          </div>

          <div class="lt-editor">
            <textarea
              class="lt-input is-plain"
              aria-label="Your text"
              placeholder="Paste a sentence or a paragraph."
              value={{this.text}}
              {{on "input" this.setText}}
            ></textarea>
          </div>

          <div class="lt-status">
            <span class="tool-hint">{{this.toneSpec.hint}}</span>
            <CopyButton @value={{this.text}} />
          </div>
          {{#if this.modelStatus}}<p
              class="tool-hint"
            >{{this.modelStatus}}</p>{{/if}}
          {{#if this.modelError}}<p
              class="tool-error"
            >{{this.modelError}}</p>{{/if}}
          {{#if this.reviewError}}<p
              class="tool-error"
            >{{this.reviewError}}</p>{{/if}}
          <p class="tool-hint">
            The quick versions swap words and tighten phrasing by rule, so your
            meaning can't wander. The model writes its own sentence, which is
            livelier but worth reading before you use it. LanguageTool checks
            both.
          </p>
        </section>

        <aside class="lt-side">
          <div class="lt-side-head">
            <h3 class="qr-heading">Other ways to say it</h3>
            {{#if this.versions.length}}<span
                class="lt-count"
              >{{this.versions.length}}</span>{{/if}}
          </div>

          {{#if this.versions.length}}
            <ul class="lt-cards">
              {{#each this.versions key="id" as |v|}}
                <li class="lt-card {{if v.issues 'is-grammar' 'is-clean'}}">
                  <div class="lt-card-head is-static">
                    <span class="lt-card-kind">{{v.label}}</span>
                    <span class="lt-card-word">{{v.changed}}% changed</span>
                  </div>
                  <p class="lt-card-message is-quote">{{v.text}}</p>
                  {{#if v.checked}}
                    <p class="lt-verdict {{if v.issues 'has-issues'}}">
                      <Icon
                        @name={{if v.issues "circle-alert" "circle-check-big"}}
                        @size={{12}}
                      />
                      {{v.verdict}}
                    </p>
                  {{/if}}
                  <div class="lt-card-actions">
                    <button
                      type="button"
                      class="lt-link"
                      {{on "click" (fn this.use v.text)}}
                    >Use this</button>
                    {{#if v.tidied}}
                      <button
                        type="button"
                        class="lt-link is-strong"
                        {{on "click" (fn this.use v.tidied)}}
                      >Use it tidied up</button>
                    {{/if}}
                    <CopyButton @value={{v.text}} />
                  </div>
                </li>
              {{/each}}
            </ul>
          {{else if this.text}}
            <p class="tool-hint">Nothing to change in this one: the words are
              already about as plain as the rules know how to make them. The
              model might still find another way.</p>
          {{else}}
            <p class="tool-hint">Type something on the left and the rewrites
              turn up here.</p>
          {{/if}}

          <p class="tool-hint lt-privacy">
            <Icon @name="circle-alert" @size={{13}} />
            The rewrites are worked out on your device, but checking them sends
            them to LanguageTool. Keep anything confidential out of it.
          </p>
        </aside>
      </div>
    </ToolPage>
  </template>
}

function eq(a, b) {
  return a === b;
}
