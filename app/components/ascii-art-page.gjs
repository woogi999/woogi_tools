import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { acceptPastedFiles } from '../utils/paste-files';
import { loadBitmap, canvasBlob } from '../utils/watermark';
import {
  bannerText,
  imageToAscii,
  textToCanvas,
  TEXT_STYLES,
  RAMPS,
} from '../utils/ascii-art';
import { keepState } from '../utils/tool-state';

// Big block letters from words, or a whole picture redrawn in characters.

const eq = (a, b) => a === b;

export default class AsciiArtPage extends Component {
  @tracked mode = 'text';
  @tracked text = 'HELLO';
  @tracked style = 'block';
  @tracked custom = '';
  @tracked wrap = 12;
  @tracked bitmap = null;
  @tracked fileName = '';
  @tracked columns = 80;
  @tracked ramp = 'classic';
  @tracked invert = false;
  @tracked contrast = 1;
  @tracked dragging = false;
  @tracked error = null;
  @tracked pngUrl = null;

  styles = TEXT_STYLES;
  ramps = RAMPS;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'ascii-art', [
      'mode',
      'text',
      'style',
      'custom',
      'wrap',
      'columns',
      'ramp',
      'invert',
      'contrast',
    ]);
    registerDestructor(this, () => {
      this.bitmap?.close?.();
      if (this.pngUrl) URL.revokeObjectURL(this.pngUrl);
    });
  }

  get output() {
    if (this.mode === 'text') {
      return bannerText(this.text, {
        style: this.style,
        custom: this.custom,
        wrap: this.wrap,
      });
    }
    if (!this.bitmap) return '';
    return imageToAscii(this.bitmap, {
      columns: this.columns,
      ramp: this.ramp,
      invert: this.invert,
      contrast: this.contrast,
    });
  }

  get isImage() {
    return this.mode === 'image';
  }

  get lineCount() {
    return this.output ? this.output.split('\n').length : 0;
  }

  get txtUrl() {
    return `data:text/plain;charset=utf-8,${encodeURIComponent(this.output)}`;
  }

  pick = (key, value) => (this[key] = value);
  setText = (event) => (this.text = event.target.value);
  setCustom = (event) => (this.custom = event.target.value);
  number = (key, event) => (this[key] = Number(event.target.value) || 0);
  toggleInvert = (event) => (this.invert = event.target.checked);

  async open(file) {
    if (!file?.type.startsWith('image/')) return;
    try {
      const bitmap = await loadBitmap(file);
      this.bitmap?.close?.();
      this.bitmap = bitmap;
      this.fileName = file.name;
      this.mode = 'image';
      this.error = null;
    } catch {
      this.error = `${file.name} couldn’t be read as an image`;
    }
  }

  selectFile = (e) => {
    this.open(e.target.files?.[0]);
    e.target.value = '';
  };

  dragOver = (e) => {
    e.preventDefault();
    this.dragging = e.type === 'dragover';
  };

  drop = (e) => {
    e.preventDefault();
    this.dragging = false;
    this.open(e.dataTransfer.files?.[0]);
  };

  pasteFiles = (files) => this.open(files[0]);

  savePng = async () => {
    if (!this.output) return;
    const dark = document.documentElement.dataset.theme === 'dark';
    const canvas = textToCanvas(this.output, {
      fontSize: 14,
      fg: dark ? '#f2f2f2' : '#111',
      bg: dark ? '#111' : '#fff',
    });
    const blob = await canvasBlob(canvas, 'image/png');
    if (this.pngUrl) URL.revokeObjectURL(this.pngUrl);
    this.pngUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = this.pngUrl;
    link.download = 'ascii-art.png';
    link.click();
  };

  <template>
    <ToolPage
      @route="ascii-art"
      @subtitle="Big block letters from a word or two, or a whole picture redrawn in characters, with braille dots for the fine version. Copy it or save it as text or a picture."
    >
      <div class="math-grid pop-in" {{acceptPastedFiles this.pasteFiles}}>
        <section class="math-card">
          <div class="math-tabs" role="tablist" aria-label="Source">
            <button
              type="button"
              role="tab"
              class="qr-tab {{if (eq this.mode 'text') 'active'}}"
              aria-selected={{if (eq this.mode "text") "true" "false"}}
              {{on "click" (fn this.pick "mode" "text")}}
            >From words</button>
            <button
              type="button"
              role="tab"
              class="qr-tab {{if (eq this.mode 'image') 'active'}}"
              aria-selected={{if (eq this.mode "image") "true" "false"}}
              {{on "click" (fn this.pick "mode" "image")}}
            >From a picture</button>
          </div>

          {{#if this.isImage}}
            <label
              class="qr-drop fs-drop {{if this.dragging 'is-dragging'}}"
              {{on "dragover" this.dragOver}}
              {{on "dragleave" this.dragOver}}
              {{on "drop" this.drop}}
            >
              <Icon @name="image" @size={{22}} />
              <span>{{if
                  this.dragging
                  "Drop it here"
                  (if
                    this.fileName
                    this.fileName
                    "Drop a picture, paste it, or click to browse"
                  )
                }}</span>
              <input
                type="file"
                accept="image/*"
                class="sr-only"
                {{on "change" this.selectFile}}
              />
            </label>
            <div class="math-field">
              <span class="qr-label is-muted">Characters</span>
              <div class="cipher-picks" role="group" aria-label="Character set">
                {{#each this.ramps as |r|}}
                  <button
                    type="button"
                    class="qr-tab {{if (eq this.ramp r.id) 'active'}}"
                    {{on "click" (fn this.pick "ramp" r.id)}}
                  >{{r.label}}</button>
                {{/each}}
              </div>
            </div>
            <div class="math-row">
              <label class="math-field"><span class="qr-label is-muted">Width:
                  {{this.columns}}
                  characters</span><input
                  type="range"
                  min="20"
                  max="200"
                  value={{this.columns}}
                  {{on "input" (fn this.number "columns")}}
                /></label>
              <label class="math-field"><span
                  class="qr-label is-muted"
                >Contrast:
                  {{this.contrast}}</span><input
                  type="range"
                  min="0.5"
                  max="3"
                  step="0.1"
                  value={{this.contrast}}
                  {{on "input" (fn this.number "contrast")}}
                /></label>
            </div>
            <label class="math-check"><input
                type="checkbox"
                checked={{this.invert}}
                {{on "change" this.toggleInvert}}
              />
              Light on dark (for a dark page)</label>
          {{else}}
            <label class="math-field"><span class="qr-label is-muted">The words</span><textarea
                class="textarea"
                rows="3"
                value={{this.text}}
                {{on "input" this.setText}}
              ></textarea></label>
            <div class="math-field">
              <span class="qr-label is-muted">Style</span>
              <div class="cipher-picks" role="group" aria-label="Style">
                {{#each this.styles as |s|}}
                  <button
                    type="button"
                    class="qr-tab {{if (eq this.style s.id) 'active'}}"
                    {{on "click" (fn this.pick "style" s.id)}}
                  >{{s.label}}</button>
                {{/each}}
              </div>
            </div>
            <div class="math-row">
              <label class="math-field"><span class="qr-label is-muted">Or your
                  own character</span><input
                  type="text"
                  class="math-input"
                  maxlength="2"
                  placeholder="e.g. $ or ♥"
                  value={{this.custom}}
                  {{on "input" this.setCustom}}
                /></label>
              <label class="math-field"><span class="qr-label is-muted">Letters
                  per row:
                  {{this.wrap}}</span><input
                  type="range"
                  min="4"
                  max="30"
                  value={{this.wrap}}
                  {{on "input" (fn this.number "wrap")}}
                /></label>
            </div>
          {{/if}}
          {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
        </section>

        <section class="math-card">
          <div class="field-head">
            <h3 class="qr-heading">Result
              {{#if this.lineCount}}· {{this.lineCount}} lines{{/if}}</h3>
            <div class="settings-actions">
              <CopyButton @value={{this.output}} />
              <a class="btn" href={{this.txtUrl}} download="ascii-art.txt"><Icon
                  @name="download"
                  @size={{13}}
                />
                TXT</a>
              <button
                type="button"
                class="btn"
                {{on "click" this.savePng}}
              ><Icon @name="download" @size={{13}} /> PNG</button>
            </div>
          </div>
          {{#if this.output}}
            <pre class="ascii-out">{{this.output}}</pre>
          {{else}}
            <p class="fs-empty">{{if
                this.isImage
                "Drop a picture to see it in characters."
                "Type something above."
              }}</p>
          {{/if}}
        </section>
      </div>
    </ToolPage>
  </template>
}
