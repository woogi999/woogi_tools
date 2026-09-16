import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { paraphrase, howDifferent, TONES } from '../utils/paraphrase';
import { loadModel, ask, isLoaded } from '../utils/ai-models';

// Says the same thing differently: plainer, more formal, shorter or friendlier.
// The rules are instant; the model is there when you want something looser.

const eq = (a, b) => a === b;

export default class ParaphraserPage extends Component {
  @tracked text = '';
  @tracked tone = 'plain';
  @tracked modelVersions = [];
  @tracked modelBusy = false;
  @tracked modelStatus = '';
  @tracked modelError = null;

  tones = TONES;

  get toneSpec() {
    return TONES.find((t) => t.id === this.tone) ?? TONES[0];
  }

  get versions() {
    return paraphrase(this.text, this.tone).map((v, i) => ({ ...v, id: `rule-${i}`, changed: howDifferent(this.text, v.text) }));
  }

  setText = (event) => (this.text = event.target.value);
  setTone = (tone) => (this.tone = tone);
  use = (version) => (this.text = version.text);

  // The model has a go at the same job, in its own words.
  rewrite = async () => {
    if (this.modelBusy || !this.text.trim()) return;
    this.modelBusy = true;
    this.modelError = null;
    this.modelVersions = [];
    const how = { plain: 'in plain, everyday English', formal: 'in formal English', short: 'as briefly as possible', friendly: 'in a warm, friendly way' }[this.tone];
    try {
      this.modelStatus = isLoaded('flan-t5') ? 'Thinking…' : 'Downloading the writing model (about 120 MB, once)…';
      const model = await loadModel('flan-t5', { onProgress: ({ ratio }) => (this.modelStatus = `Downloading the writing model… ${Math.round((ratio ?? 0) * 100)}%`) });
      const out = [];
      // Two goes, because a small model's first answer isn't always its best.
      for (let i = 0; i < 2; i++) {
        this.modelStatus = `Rewriting… ${i + 1} of 2`;
        const answer = await ask(model, `Rewrite this ${how}, keeping the meaning: ${this.text.trim()}`, { max: 200 });
        if (answer && !out.some((v) => v.text === answer)) out.push({ id: `model-${i}`, label: 'From the model', text: answer, changed: howDifferent(this.text, answer) });
      }
      this.modelVersions = out;
      if (!out.length) this.modelError = 'The model didn’t come back with anything useful — try a shorter piece.';
    } catch (error) {
      this.modelError = error?.message ?? 'The model couldn’t be loaded';
    } finally {
      this.modelBusy = false;
      this.modelStatus = '';
    }
  };

  <template>
    <ToolPage @route="paraphraser" @subtitle="Say the same thing another way — plainer, more formal, shorter or friendlier. All on your device, nothing uploaded.">
      <div class="math-grid text-tool pop-in">
        <section class="math-card">
          <label class="field-label" for="para-text">Your text</label>
          <textarea id="para-text" class="textarea text-area-tall" placeholder="Paste a sentence or a paragraph." value={{this.text}} {{on "input" this.setText}}></textarea>

          <div class="math-tabs" role="group" aria-label="Tone">
            {{#each this.tones as |t|}}
              <button type="button" class="qr-tab {{if (eq this.tone t.id) 'active'}}" {{on "click" (fn this.setTone t.id)}}>{{t.label}}</button>
            {{/each}}
          </div>
          <p class="tool-hint">{{this.toneSpec.hint}}</p>

          <div class="settings-actions">
            <button type="button" class="btn" disabled={{this.modelBusy}} {{on "click" this.rewrite}}><Icon @name="sparkles" @size={{13}} /> {{if this.modelBusy "Working…" "Let the model try"}}</button>
          </div>
          {{#if this.modelStatus}}<p class="tool-hint">{{this.modelStatus}}</p>{{/if}}
          {{#if this.modelError}}<p class="tool-error">{{this.modelError}}</p>{{/if}}
          <p class="tool-hint">The quick versions swap words and tighten phrasing by rule — safe, and your meaning can't wander. The model writes its own sentence, which is livelier but worth reading before you use it.</p>
        </section>

        <section class="math-card">
          <h3 class="qr-heading">Other ways to say it</h3>
          {{#if this.versions.length}}
            <ul class="case-list">
              {{#each this.versions key="id" as |v|}}
                <li class="case-item">
                  <div class="case-text">
                    <span class="qr-label is-muted">{{v.label}} · {{v.changed}}% changed</span>
                    <span class="case-value">{{v.text}}</span>
                  </div>
                  <div class="issue-actions">
                    <button type="button" class="btn" {{on "click" (fn this.use v)}}>Use</button>
                    <CopyButton @value={{v.text}} />
                  </div>
                </li>
              {{/each}}
            </ul>
          {{else if this.text}}
            <p class="tool-hint">Nothing to change in this one — the words are already about as plain as the rules know how to make them. The model might still find another way.</p>
          {{else}}
            <p class="tool-hint">Type something on the left and the rewrites turn up here.</p>
          {{/if}}

          {{#if this.modelVersions.length}}
            <h3 class="qr-heading">From the model</h3>
            <ul class="case-list">
              {{#each this.modelVersions key="id" as |v|}}
                <li class="case-item">
                  <div class="case-text">
                    <span class="qr-label is-muted">{{v.changed}}% changed</span>
                    <span class="case-value">{{v.text}}</span>
                  </div>
                  <div class="issue-actions">
                    <button type="button" class="btn" {{on "click" (fn this.use v)}}>Use</button>
                    <CopyButton @value={{v.text}} />
                  </div>
                </li>
              {{/each}}
            </ul>
          {{/if}}
        </section>
      </div>
    </ToolPage>
  </template>
}
