import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { checkText, applyFixes, readability } from '../utils/grammar';
import { loadModel, ask, isLoaded } from '../utils/ai-models';

// Reads your writing and says what's wrong and why. The rules run as you type;
// the model is there when you want a second opinion on the awkward sentences.

const KIND_ICON = { spelling: 'spell-check', grammar: 'circle-alert', typo: 'circle-alert', punctuation: 'type', spacing: 'type', capitals: 'case-sensitive', style: 'sparkles' };
const eq = (a, b) => a === b;

export default class GrammarCheckerPage extends Component {
  @tracked text = '';
  @tracked ignored = [];
  @tracked modelText = '';
  @tracked modelBusy = false;
  @tracked modelStatus = '';
  @tracked modelError = null;

  get issues() {
    return checkText(this.text)
      .filter((issue) => !this.ignored.includes(`${issue.at}:${issue.text}`))
      .map((issue, i) => ({ ...issue, id: `${issue.at}:${issue.text}:${i}`, key: `${issue.at}:${issue.text}`, icon: KIND_ICON[issue.kind] ?? 'circle-alert' }));
  }

  get counts() {
    const list = this.issues;
    return {
      total: list.length,
      mistakes: list.filter((i) => i.kind !== 'style').length,
      style: list.filter((i) => i.kind === 'style').length,
    };
  }

  get stats() {
    return this.text.trim() ? readability(this.text) : null;
  }

  get fixable() {
    return this.issues.filter((i) => i.fix != null).length;
  }

  setText = (event) => {
    this.text = event.target.value;
    this.ignored = [];
  };

  fixOne = (issue) => {
    this.text = applyFixes(this.text, [issue]);
  };

  ignore = (issue) => (this.ignored = [...this.ignored, issue.key]);

  fixAll = () => {
    this.text = applyFixes(this.text, this.issues);
  };

  useModelText = () => {
    if (this.modelText) this.text = this.modelText;
  };

  // The optional second opinion: a small model, downloaded once, run here.
  polish = async () => {
    if (this.modelBusy || !this.text.trim()) return;
    this.modelBusy = true;
    this.modelError = null;
    this.modelText = '';
    try {
      this.modelStatus = isLoaded('flan-t5') ? 'Thinking…' : 'Downloading the writing model (about 120 MB, once)…';
      const model = await loadModel('flan-t5', { onProgress: ({ ratio }) => (this.modelStatus = `Downloading the writing model… ${Math.round((ratio ?? 0) * 100)}%`) });
      this.modelStatus = 'Reading it through…';
      // Sentence by sentence: the small model handles short pieces far better than a wall of text.
      const sentences = this.text.match(/[^.!?]+[.!?]*/g) ?? [this.text];
      const fixed = [];
      for (const [i, sentence] of sentences.entries()) {
        if (!sentence.trim()) continue;
        this.modelStatus = `Reading it through… sentence ${i + 1} of ${sentences.length}`;
        const answer = await ask(model, `Fix the grammar and spelling of this sentence. Keep the meaning and the words as close as you can: ${sentence.trim()}`, { max: 96 });
        fixed.push(answer || sentence.trim());
      }
      this.modelText = fixed.join(' ');
    } catch (error) {
      this.modelError = error?.message ?? 'The model couldn’t be loaded';
    } finally {
      this.modelBusy = false;
      this.modelStatus = '';
    }
  };

  <template>
    <ToolPage @route="grammar-checker" @subtitle="Catches the mistakes and tells you why each one is a mistake. Runs as you type, on your device — your writing is never sent anywhere.">
      <div class="math-grid text-tool pop-in">
        <section class="math-card">
          <label class="field-label" for="grammar-text">Your writing</label>
          <textarea id="grammar-text" class="textarea text-area-tall" placeholder="Paste or write something and it'll be checked as you go." value={{this.text}} {{on "input" this.setText}}></textarea>

          {{#if this.stats}}
            <div class="stat-row">
              <span class="stat-chip"><strong>{{this.stats.words}}</strong> words</span>
              <span class="stat-chip"><strong>{{this.stats.sentences}}</strong> sentences</span>
              <span class="stat-chip"><strong>{{this.stats.perSentence}}</strong> words a sentence</span>
              <span class="stat-chip"><strong>{{this.stats.label}}</strong> · reading age {{this.stats.grade}}</span>
            </div>
          {{/if}}

          <div class="settings-actions">
            {{#if this.fixable}}
              <button type="button" class="btn active" {{on "click" this.fixAll}}><Icon @name="wand" @size={{13}} /> Fix all {{this.fixable}}</button>
            {{/if}}
            <CopyButton @value={{this.text}} />
            <button type="button" class="btn" disabled={{this.modelBusy}} {{on "click" this.polish}}><Icon @name="sparkles" @size={{13}} /> {{if this.modelBusy "Working…" "Second opinion (model)"}}</button>
          </div>
          {{#if this.modelStatus}}<p class="tool-hint">{{this.modelStatus}}</p>{{/if}}
          {{#if this.modelError}}<p class="tool-error">{{this.modelError}}</p>{{/if}}

          {{#if this.modelText}}
            <h3 class="qr-heading">What the model suggests</h3>
            <p class="cipher-output">{{this.modelText}}</p>
            <div class="settings-actions">
              <button type="button" class="btn" {{on "click" this.useModelText}}>Use this version</button>
              <CopyButton @value={{this.modelText}} />
            </div>
            <p class="tool-hint">This is a small model running on your device, so treat it as a suggestion — read it before you keep it.</p>
          {{/if}}
        </section>

        <section class="math-card">
          <div class="fc-toolbar">
            <h3 class="qr-heading">What it found</h3>
            {{#if this.counts.total}}
              <span class="tool-hint">{{this.counts.mistakes}} mistakes · {{this.counts.style}} style notes</span>
            {{/if}}
          </div>

          {{#if this.issues.length}}
            <ul class="issue-list">
              {{#each this.issues key="id" as |issue|}}
                <li class="issue {{if (eq issue.kind 'style') 'is-style'}}">
                  <Icon @name={{issue.icon}} @size={{15}} />
                  <div class="issue-text">
                    <span class="issue-message">{{issue.message}}</span>
                    {{#if issue.why}}<span class="tool-hint">{{issue.why}}</span>{{/if}}
                  </div>
                  <div class="issue-actions">
                    {{#if issue.fix}}
                      <button type="button" class="btn" {{on "click" (fn this.fixOne issue)}}>Fix</button>
                    {{/if}}
                    <button type="button" class="btn" {{on "click" (fn this.ignore issue)}}>Ignore</button>
                  </div>
                </li>
              {{/each}}
            </ul>
          {{else if this.text}}
            <p class="tool-hint"><Icon @name="circle-check-big" @size={{15}} /> Nothing to flag. Bear in mind these are rules, not a proofreader — they catch the usual slips, not everything.</p>
          {{else}}
            <p class="tool-hint">Start typing on the left and anything it spots turns up here, with a note on why.</p>
          {{/if}}
        </section>
      </div>
    </ToolPage>
  </template>
}
