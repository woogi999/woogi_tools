import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { toIpa, ipaWords, ACCENTS } from '../utils/ipa';

// English spelling into IPA, word by word, with the browser reading it aloud if it can.

const eq = (a, b) => a === b;

export default class TextIpaPage extends Component {
  @tracked text = 'The quick brown fox jumps over the lazy dog';
  @tracked accent = 'us';
  @tracked brackets = true;

  accents = ACCENTS;

  get output() {
    return this.text.trim() ? toIpa(this.text, { accent: this.accent, brackets: this.brackets }) : '';
  }

  get words() {
    return this.text.trim() ? ipaWords(this.text, { accent: this.accent }).slice(0, 200) : [];
  }

  get canSpeak() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  setText = (event) => (this.text = event.target.value);
  pick = (key, value) => (this[key] = value);
  toggleBrackets = (event) => (this.brackets = event.target.checked);

  // The browser's own voice, so you can check the transcription against the sound.
  speak = () => {
    if (!this.canSpeak) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(this.text);
    utterance.lang = this.accent === 'uk' ? 'en-GB' : 'en-US';
    window.speechSynthesis.speak(utterance);
  };

  <template>
    <ToolPage @route="text-ipa" @subtitle="English spelling turned into IPA, word by word, in American or British English. Handy for pronunciation notes, conlangs and singing.">
      <div class="math-grid text-tool pop-in">
        <section class="math-card">
          <label class="field-label" for="ipa-text">Your text</label>
          <textarea id="ipa-text" class="textarea text-area-tall" value={{this.text}} {{on "input" this.setText}}></textarea>

          <div class="math-tabs" role="group" aria-label="Accent">
            {{#each this.accents as |a|}}
              <button type="button" class="qr-tab {{if (eq this.accent a.id) 'active'}}" {{on "click" (fn this.pick "accent" a.id)}}>{{a.label}}</button>
            {{/each}}
          </div>
          <label class="lobby-rule is-switch">
            <span class="lobby-rule-text"><span class="qr-label">Slashes round it</span><span class="tool-hint">The /…/ that marks a broad transcription.</span></span>
            <span class="qr-switch">
              <input type="checkbox" role="switch" checked={{this.brackets}} aria-checked={{if this.brackets "true" "false"}} {{on "change" this.toggleBrackets}} />
              <span class="qr-switch-track" aria-hidden="true"></span>
            </span>
          </label>
          <p class="tool-hint">English spelling barely follows its own rules, so this is a good approximation, not a dictionary. Common awkward words (“though”, “colonel”, “island”) are looked up properly; the rest is worked out letter by letter.</p>
        </section>

        <section class="math-card">
          <div class="fc-toolbar">
            <h3 class="qr-heading">IPA</h3>
            <div class="settings-actions">
              <CopyButton @value={{this.output}} />
              {{#if this.canSpeak}}
                <button type="button" class="btn" {{on "click" this.speak}}><Icon @name="play" @size={{13}} /> Hear it</button>
              {{/if}}
            </div>
          </div>
          <p class="cipher-output">{{if this.output this.output "Nothing yet — type something on the left."}}</p>

          {{#if this.words.length}}
            <h3 class="qr-heading">Word by word</h3>
            <ul class="case-list">
              {{#each this.words key="word" as |w|}}
                <li class="case-item">
                  <div class="case-text">
                    <span class="qr-label is-muted">{{w.word}}{{#unless w.known}} · worked out{{/unless}}</span>
                    <span class="case-value">{{w.ipa}}</span>
                  </div>
                  <CopyButton @value={{w.ipa}} />
                </li>
              {{/each}}
            </ul>
          {{/if}}
        </section>
      </div>
    </ToolPage>
  </template>
}
