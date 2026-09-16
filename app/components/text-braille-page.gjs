import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import ToolPage from './tool-page';
import CopyButton from './copy-button';
import { toBraille, fromBraille, dotsOf } from '../utils/braille';

// Words to Unicode braille and back, with the cells drawn big so you can read the dots.

const eq = (a, b) => a === b;

export default class TextBraillePage extends Component {
  @tracked text = 'hello world';
  @tracked direction = 'encode'; // 'encode' | 'decode'
  @tracked capitals = true;
  @tracked numbers = true;

  get output() {
    if (!this.text.trim()) return '';
    return this.direction === 'encode' ? toBraille(this.text, { capitals: this.capitals, numbers: this.numbers }) : fromBraille(this.text);
  }

  // Each cell with its six dots, for the picture underneath.
  get cells() {
    const braille = this.direction === 'encode' ? this.output : this.text;
    return [...braille].slice(0, 300).map((cell, i) => ({ id: i, cell, space: cell === ' ' || cell === '\n', dots: dotsOf(cell) ?? [] }));
  }

  setText = (event) => (this.text = event.target.value);
  setDirection = (direction) => {
    const out = this.output;
    this.direction = direction;
    if (out) this.text = out;
  };
  toggle = (key, event) => (this[key] = event.target.checked);

  <template>
    <ToolPage @route="text-braille" @subtitle="Words to braille and back. Unicode cells you can copy anywhere, drawn big so you can see the dots.">
      <div class="math-grid text-tool pop-in">
        <section class="math-card">
          <div class="math-tabs" role="group" aria-label="Direction">
            <button type="button" class="qr-tab {{if (eq this.direction 'encode') 'active'}}" {{on "click" (fn this.setDirection "encode")}}>Words to braille</button>
            <button type="button" class="qr-tab {{if (eq this.direction 'decode') 'active'}}" {{on "click" (fn this.setDirection "decode")}}>Braille to words</button>
          </div>
          <label class="field-label" for="braille-text">{{if (eq this.direction "encode") "Your words" "The braille"}}</label>
          <textarea id="braille-text" class="textarea text-area-tall" spellcheck="false" value={{this.text}} {{on "input" this.setText}}></textarea>

          {{#if (eq this.direction "encode")}}
            <label class="lobby-rule is-switch">
              <span class="lobby-rule-text"><span class="qr-label">Capital signs</span><span class="tool-hint">A ⠠ before a capital letter, as braille does it.</span></span>
              <span class="qr-switch">
                <input type="checkbox" role="switch" checked={{this.capitals}} aria-checked={{if this.capitals "true" "false"}} {{on "change" (fn this.toggle "capitals")}} />
                <span class="qr-switch-track" aria-hidden="true"></span>
              </span>
            </label>
            <label class="lobby-rule is-switch">
              <span class="lobby-rule-text"><span class="qr-label">Number signs</span><span class="tool-hint">A ⠼ before digits, which are written as the letters a–j.</span></span>
              <span class="qr-switch">
                <input type="checkbox" role="switch" checked={{this.numbers}} aria-checked={{if this.numbers "true" "false"}} {{on "change" (fn this.toggle "numbers")}} />
                <span class="qr-switch-track" aria-hidden="true"></span>
              </span>
            </label>
          {{/if}}
          <p class="tool-hint">This is Grade 1 (uncontracted) English braille: every letter spelled out, no contractions.</p>
        </section>

        <section class="math-card">
          <div class="fc-toolbar">
            <h3 class="qr-heading">{{if (eq this.direction "encode") "Braille" "Words"}}</h3>
            <CopyButton @value={{this.output}} />
          </div>
          <p class="cipher-output {{if (eq this.direction 'encode') 'is-braille'}}">{{if this.output this.output "Nothing yet — type something on the left."}}</p>

          {{#if this.cells.length}}
            <h3 class="qr-heading">The dots</h3>
            <div class="braille-cells">
              {{#each this.cells key="id" as |c|}}
                {{#if c.space}}
                  <span class="braille-gap"></span>
                {{else}}
                  <span class="braille-cell" title={{c.cell}}>
                    {{#each c.dots as |on|}}<span class="braille-dot {{if on 'is-on'}}"></span>{{/each}}
                  </span>
                {{/if}}
              {{/each}}
            </div>
          {{/if}}
        </section>
      </div>
    </ToolPage>
  </template>
}
