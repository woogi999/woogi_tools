import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import CopyButton from './copy-button';
import { toBaybayin, fromBaybayin, FINAL_MODES } from '../utils/baybayin';
import { keepState } from '../utils/tool-state';

const eq = (a, b) => a === b;
const FONT_URL =
  'https://fonts.googleapis.com/css2?family=Noto+Sans+Tagalog&display=swap';

// Few systems ship a Baybayin font, so one is fetched the first time the page opens.
const loadFont = modifier(() => {
  if (document.querySelector(`link[href="${FONT_URL}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = FONT_URL;
  document.head.append(link);
});

export default class BaybayinTranslatorPage extends Component {
  finalModes = FINAL_MODES;

  @tracked text = 'Mabuhay ang Pilipinas';
  @tracked direction = 'encode'; // 'encode' | 'decode'
  @tracked final = 'virama';

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'baybayin-translator', ['text', 'direction', 'final']);
  }

  get output() {
    if (!this.text.trim()) return '';
    return this.direction === 'encode'
      ? toBaybayin(this.text, { final: this.final })
      : fromBaybayin(this.text);
  }

  setText = (event) => (this.text = event.target.value);
  setFinal = (event) => (this.final = event.target.value);
  setDirection = (direction) => {
    if (direction === this.direction) return;
    const out = this.output;
    this.direction = direction;
    if (out) this.text = out;
  };

  <template>
    <ToolPage
      @route="baybayin-translator"
      @subtitle="Tagalog into Baybayin, the script the Philippines wrote in before the Latin alphabet, and back again."
    >
      <div class="math-grid text-tool pop-in" {{loadFont}}>
        <section class="math-card">
          <div class="math-tabs" role="group" aria-label="Direction">
            <button
              type="button"
              class="qr-tab {{if (eq this.direction 'encode') 'active'}}"
              {{on "click" (fn this.setDirection "encode")}}
            >Letters to Baybayin</button>
            <button
              type="button"
              class="qr-tab {{if (eq this.direction 'decode') 'active'}}"
              {{on "click" (fn this.setDirection "decode")}}
            >Baybayin to letters</button>
          </div>
          <label class="field-label" for="baybayin-text">{{if
              (eq this.direction "encode")
              "Tagalog"
              "Baybayin"
            }}</label>
          <textarea
            id="baybayin-text"
            class="textarea text-area-tall
              {{if (eq this.direction 'decode') 'baybayin-text'}}"
            spellcheck="false"
            value={{this.text}}
            {{on "input" this.setText}}
          ></textarea>
          {{#if (eq this.direction "encode")}}
            <label class="math-field">
              <span class="qr-label is-muted">Consonant with no vowel after it</span>
              <select class="select" {{on "change" this.setFinal}}>
                {{#each this.finalModes as |mode|}}
                  <option
                    value={{mode.id}}
                    selected={{eq mode.id this.final}}
                  >{{mode.label}}</option>
                {{/each}}
              </select>
            </label>
            <p class="tool-hint">Spell it the Tagalog way for the best result:
              "ng" is one letter, and C, F, J, Q, V, X and Z are swapped for the
              nearest Tagalog sound.</p>
          {{else}}
            <p class="tool-hint">Paste Baybayin here. A kudlit above reads as i,
              below as u; a consonant without one reads with a.</p>
          {{/if}}
        </section>

        <section class="math-card">
          <div class="fc-toolbar">
            <h3 class="qr-heading">{{if
                (eq this.direction "encode")
                "Baybayin"
                "Letters"
              }}</h3>
            <CopyButton @value={{this.output}} />
          </div>
          <p
            class="cipher-output
              {{if (eq this.direction 'encode') 'baybayin-text'}}"
            lang={{if (eq this.direction "encode") "tl-Tglg" "tl"}}
          >{{if
              this.output
              this.output
              "Nothing yet. Type something on the left."
            }}</p>
          <p class="tool-hint">The three vowels, ᜀ ᜁ ᜂ, stand alone; every other
            character is a consonant with "a" built in, so ᜊ is "ba", ᜊᜒ is "bi"
            and ᜊᜓ is "bu".</p>
        </section>
      </div>
    </ToolPage>
  </template>
}
