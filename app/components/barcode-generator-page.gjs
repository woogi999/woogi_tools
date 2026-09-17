import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import ColourField from './colour-field';
import CopyButton from './copy-button';
import { SYMBOLOGIES, toSvg } from '../utils/barcode';
import { keepState } from '../utils/tool-state';

// Makes real, scannable barcodes: the retail ones (EAN, UPC), the label ones
// (Code 128, Code 39), the carton one (ITF-14). All drawn here as SVG.

const eq = (a, b) => a === b;

export default class BarcodeGeneratorPage extends Component {
  @tracked type = 'code128';
  @tracked text = 'WOOGI-2026';
  @tracked module = 2;
  @tracked height = 80;
  @tracked showLabel = true;
  @tracked fg = '#000000';
  @tracked bg = '#FFFFFF';
  @tracked pngUrl = null;

  symbologies = SYMBOLOGIES;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'barcode-generator', [
      'type',
      'text',
      'module',
      'height',
      'showLabel',
      'fg',
      'bg',
    ]);
    registerDestructor(this, () => {
      if (this.pngUrl) URL.revokeObjectURL(this.pngUrl);
    });
  }

  get symbology() {
    return SYMBOLOGIES.find((s) => s.id === this.type) ?? SYMBOLOGIES[0];
  }

  get encoded() {
    try {
      return { ok: this.symbology.encode(this.text) };
    } catch (error) {
      return { error: error.message };
    }
  }

  get svg() {
    if (!this.encoded.ok) return '';
    return toSvg(this.encoded.ok, {
      module: this.module,
      height: this.height,
      showLabel: this.showLabel,
      fg: this.fg,
      bg: this.bg,
    });
  }

  get svgMarkup() {
    return htmlSafe(this.svg);
  }

  get svgUrl() {
    return this.svg
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(this.svg)}`
      : null;
  }

  get fileBase() {
    return `${this.type}-${this.text.replaceAll(/[^a-z0-9]+/gi, '-').slice(0, 30) || 'barcode'}`;
  }

  pickType = (id) => {
    this.type = id;
    const s = SYMBOLOGIES.find((x) => x.id === id);
    // A fresh type gets its own sample if what's typed can't work in it.
    try {
      s.encode(this.text);
    } catch {
      this.text = s.sample;
    }
  };
  setText = (event) => (this.text = event.target.value);
  number = (key, event) => (this[key] = Number(event.target.value) || 1);
  toggleLabel = (event) => (this.showLabel = event.target.checked);
  setFg = (value) => (this.fg = value);
  setBg = (value) => (this.bg = value);

  // The SVG is drawn onto a canvas at three times the size, so the PNG prints
  // crisply.
  savePng = async () => {
    if (!this.svg) return;
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = this.svgUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.width * 3;
    canvas.height = image.height * 3;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    if (this.pngUrl) URL.revokeObjectURL(this.pngUrl);
    this.pngUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = this.pngUrl;
    link.download = `${this.fileBase}.png`;
    link.click();
  };

  <template>
    <ToolPage
      @route="barcode-generator"
      @subtitle="Real, scannable barcodes in the retail, label and shipping formats, drawn right here as SVG. Check digits are worked out for you."
    >
      <div class="math-grid pop-in">
        <section class="math-card">
          <div class="math-field">
            <span class="qr-label is-muted">Format</span>
            <div class="cipher-picks" role="group" aria-label="Barcode format">
              {{#each this.symbologies as |s|}}
                <button
                  type="button"
                  class="qr-tab {{if (eq this.type s.id) 'active'}}"
                  {{on "click" (fn this.pickType s.id)}}
                >{{s.label}}</button>
              {{/each}}
            </div>
            <p class="tool-hint">{{this.symbology.hint}}</p>
          </div>
          <label class="math-field"><span class="qr-label is-muted">What to
              encode</span><input
              type="text"
              class="math-input"
              value={{this.text}}
              spellcheck="false"
              {{on "input" this.setText}}
            /></label>
          {{#if this.encoded.error}}
            <p class="tool-error">{{this.encoded.error}}</p>
          {{/if}}
          <div class="math-row">
            <label class="math-field"><span class="qr-label is-muted">Bar width:
                {{this.module}}px</span><input
                type="range"
                min="1"
                max="6"
                value={{this.module}}
                {{on "input" (fn this.number "module")}}
              /></label>
            <label class="math-field"><span class="qr-label is-muted">Height:
                {{this.height}}px</span><input
                type="range"
                min="30"
                max="200"
                value={{this.height}}
                {{on "input" (fn this.number "height")}}
              /></label>
          </div>
          <div class="math-row">
            <ColourField
              @label="Bars"
              @value={{this.fg}}
              @onChange={{this.setFg}}
            />
            <ColourField
              @label="Background"
              @value={{this.bg}}
              @onChange={{this.setBg}}
            />
          </div>
          <label class="math-check"><input
              type="checkbox"
              checked={{this.showLabel}}
              {{on "change" this.toggleLabel}}
            />
            Print the text under the bars</label>
        </section>

        <section class="math-card">
          <h3 class="qr-heading">Preview</h3>
          {{#if this.svg}}
            <div class="bc-preview">{{this.svgMarkup}}</div>
            <p class="tool-hint">Encoded as
              <code>{{this.encoded.ok.label}}</code>. Keep the light margin
              either side when you print it: scanners need it.</p>
            <div class="settings-actions">
              <a
                class="btn active"
                href={{this.svgUrl}}
                download="{{this.fileBase}}.svg"
              ><Icon @name="download" @size={{13}} /> SVG</a>
              <button
                type="button"
                class="btn"
                {{on "click" this.savePng}}
              ><Icon @name="download" @size={{13}} /> PNG</button>
              <CopyButton @value={{this.svg}} />
            </div>
          {{else}}
            <p class="fs-empty">Fix the text above to see the barcode.</p>
          {{/if}}
        </section>
      </div>
    </ToolPage>
  </template>
}
