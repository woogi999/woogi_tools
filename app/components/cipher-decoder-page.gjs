import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { CIPHERS, runCipher, crack } from '../utils/ciphers';

// Decoding (and encoding) classic ciphers, with a "crack it" that tries the lot
// and puts whatever reads most like English at the top.

const eq = (a, b) => a === b;

export default class CipherDecoderPage extends Component {
  @tracked text = '';
  @tracked cipher = 'caesar';
  @tracked direction = 'decode'; // 'decode' | 'encode'
  @tracked keys = { caesar: 3, vigenere: 'key', railfence: 3 };

  ciphers = CIPHERS;

  get spec() {
    return CIPHERS.find((c) => c.id === this.cipher) ?? CIPHERS[0];
  }

  get key() {
    return this.keys[this.cipher] ?? this.spec.keyDefault ?? '';
  }

  get output() {
    if (!this.text) return '';
    try {
      return runCipher(this.cipher, this.text, this.key, this.direction === 'decode');
    } catch {
      return '';
    }
  }

  // Every Caesar shift at once: sometimes you just want to eyeball them.
  get shifts() {
    if (this.cipher !== 'caesar' || !this.text) return [];
    return Array.from({ length: 25 }, (_, i) => ({ shift: i + 1, text: runCipher('caesar', this.text, i + 1, true) }));
  }

  get guesses() {
    return this.text.trim().length > 3 ? crack(this.text) : [];
  }

  setText = (event) => (this.text = event.target.value);

  setCipher = (id) => (this.cipher = id);
  setDirection = (direction) => (this.direction = direction);

  setKey = (event) => {
    const raw = event.target.value;
    this.keys = { ...this.keys, [this.cipher]: this.spec.key === 'number' ? Number(raw) || 0 : raw };
  };

  useGuess = (guess) => (this.text = guess.text);

  swap = () => {
    // Put the result back in the box, to peel off another layer.
    const out = this.output;
    if (out) this.text = out;
  };

  <template>
    <ToolPage @route="cipher-decoder" @subtitle="Decode (or write) Caesar shifts, Vigenère, Atbash, rail fence, Morse and more. Not sure which it is? Let it crack the message for you.">
      <div class="math-grid text-tool pop-in">
        <section class="math-card">
          <label class="field-label" for="cipher-text">The message</label>
          <textarea id="cipher-text" class="textarea text-area-tall" placeholder="Paste the secret message here" value={{this.text}} {{on "input" this.setText}}></textarea>

          <div class="math-tabs" role="group" aria-label="Direction">
            <button type="button" class="qr-tab {{if (eq this.direction 'decode') 'active'}}" {{on "click" (fn this.setDirection "decode")}}>Decode</button>
            <button type="button" class="qr-tab {{if (eq this.direction 'encode') 'active'}}" {{on "click" (fn this.setDirection "encode")}}>Encode</button>
          </div>

          <div class="cipher-picks" role="group" aria-label="Cipher">
            {{#each this.ciphers as |c|}}
              <button type="button" class="qr-tab {{if (eq this.cipher c.id) 'active'}}" {{on "click" (fn this.setCipher c.id)}}>{{c.label}}</button>
            {{/each}}
          </div>

          {{#if this.spec.key}}
            <label class="math-field">
              <span class="qr-label is-muted">{{this.spec.keyLabel}}</span>
              {{#if (eq this.spec.key "number")}}
                <input type="number" class="math-input" value={{this.key}} {{on "input" this.setKey}} />
              {{else}}
                <input type="text" class="math-input" spellcheck="false" value={{this.key}} {{on "input" this.setKey}} />
              {{/if}}
            </label>
          {{/if}}
        </section>

        <section class="math-card">
          <div class="fc-toolbar">
            <h3 class="qr-heading">{{if (eq this.direction "decode") "Decoded" "Encoded"}}</h3>
            <div class="settings-actions">
              <CopyButton @value={{this.output}} />
              <button type="button" class="btn" title="Put this back in the box" {{on "click" this.swap}}><Icon @name="rotate-cw" @size={{13}} /> Use as input</button>
            </div>
          </div>
          <p class="cipher-output">{{if this.output this.output "Nothing yet — paste a message on the left."}}</p>

          {{#if this.guesses.length}}
            <h3 class="qr-heading">Crack it</h3>
            <p class="tool-hint">Everything it knows, tried at once and sorted by how much the result reads like English.</p>
            <ul class="case-list">
              {{#each this.guesses key="text" as |guess|}}
                <li class="case-item">
                  <div class="case-text">
                    <span class="qr-label is-muted">{{guess.cipher}}{{#if guess.note}} · {{guess.note}}{{/if}}</span>
                    <span class="case-value">{{guess.text}}</span>
                  </div>
                  <button type="button" class="btn" {{on "click" (fn this.useGuess guess)}}>Use</button>
                </li>
              {{/each}}
            </ul>
          {{/if}}

          {{#if this.shifts.length}}
            <h3 class="qr-heading">Every Caesar shift</h3>
            <ul class="case-list">
              {{#each this.shifts key="shift" as |row|}}
                <li class="case-item">
                  <div class="case-text">
                    <span class="qr-label is-muted">Shift {{row.shift}}</span>
                    <span class="case-value">{{row.text}}</span>
                  </div>
                  <CopyButton @value={{row.text}} />
                </li>
              {{/each}}
            </ul>
          {{/if}}
        </section>
      </div>
    </ToolPage>
  </template>
}
