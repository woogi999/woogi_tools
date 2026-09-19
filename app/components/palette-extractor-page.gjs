import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import { LinkTo } from '@ember/routing';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { extractPalette, savePalette } from '../utils/palettes';
import { acceptPastedFiles } from '../utils/paste-files';
import { parseHex, rgbToHsl } from '../utils/color';

const eq = (a, b) => a === b;
const inkFor = (hex) => {
  const { r, g, b } = parseHex(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#000' : '#fff';
};

export default class PaletteExtractorPage extends Component {
  @tracked bitmap = null;
  @tracked imageUrl = null;
  @tracked fileName = 'image';
  @tracked count = 6;
  @tracked colours = [];
  @tracked error = null;
  @tracked justSaved = false;
  @tracked copied = null;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => {
      if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
    });
  }

  get swatches() {
    return this.colours.map((c) => {
      const { r, g, b } = parseHex(c.hex);
      const { h, s, l } = rgbToHsl(r, g, b);
      return {
        ...c,
        percent: Math.round(c.share * 100),
        rgb: `rgb(${r}, ${g}, ${b})`,
        hsl: `hsl(${h}, ${s}%, ${l}%)`,
        style: htmlSafe(`background:${c.hex};color:${inkFor(c.hex)}`),
        barStyle: htmlSafe(
          `flex:${Math.max(0.02, c.share)};background:${c.hex}`,
        ),
      };
    });
  }

  get list() {
    return this.colours.map((c) => c.hex).join(', ');
  }

  get css() {
    return `:root {\n${this.colours
      .map((c, i) => `  --colour-${i + 1}: ${c.hex.toLowerCase()};`)
      .join('\n')}\n}`;
  }

  openFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const bitmap = await createImageBitmap(file);
      if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
      this.imageUrl = URL.createObjectURL(file);
      this.fileName = file.name.replace(/\.[^.]+$/, '');
      this.bitmap = bitmap;
      this.error = null;
      this.extract();
    } catch {
      this.error =
        "This browser can't open that image. Try the File Converter first.";
    }
  };

  extract = () => {
    if (!this.bitmap) return;
    this.colours = extractPalette(this.bitmap, this.count);
    this.justSaved = false;
  };

  selectFile = (e) => {
    this.openFile(e.target.files?.[0]);
    e.target.value = '';
  };

  dragOverFile = (e) => e.preventDefault();
  dropFile = (e) => {
    e.preventDefault();
    this.openFile(e.dataTransfer.files?.[0]);
  };

  pasteFiles = (files) => this.openFile(files[0]);

  setCount = (event) => {
    this.count = Math.max(2, Math.min(12, Number(event.target.value) || 6));
    this.extract();
  };

  copyOne = async (hex) => {
    try {
      await navigator.clipboard.writeText(hex);
      this.copied = hex;
      setTimeout(() => {
        if (this.copied === hex) this.copied = null;
      }, 1200);
    } catch {
      // clipboard blocked
    }
  };

  save = () => {
    if (!this.colours.length) return;
    savePalette(
      this.colours.map((c) => c.hex),
      this.fileName,
    );
    this.justSaved = true;
  };

  <template>
    <ToolPage
      @route="palette-extractor"
      @subtitle="Drop in a picture and get the colours it's made of, biggest first, as hex codes you can copy or keep."
    >
      <div class="math-grid pop-in" {{acceptPastedFiles this.pasteFiles}}>
        <section class="math-card">
          <label
            class="qr-drop {{if this.bitmap 'is-filled'}}"
            {{on "dragover" this.dragOverFile}}
            {{on "drop" this.dropFile}}
          >
            {{#if this.bitmap}}
              <img src={{this.imageUrl}} alt="" class="pex-picture" />
            {{else}}
              <Icon @name="palette" @size={{22}} />
              <span>Drop an image, or click to browse</span>
            {{/if}}
            <input
              type="file"
              accept="image/*"
              class="sr-only"
              {{on "change" this.selectFile}}
            />
          </label>
          {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
          <label class="math-field">
            <span class="qr-label is-muted">Colours to find:
              {{this.count}}</span>
            <input
              type="range"
              min="2"
              max="12"
              value={{this.count}}
              {{on "input" this.setCount}}
            />
          </label>
          {{#if this.bitmap}}
            <div class="settings-actions">
              <button type="button" class="btn" {{on "click" this.extract}}>
                <Icon @name="refresh-cw" @size={{13}} />
                Run again</button>
            </div>
            <p class="tool-hint">The grouping starts from random picks, so
              running it again can shift the colours a little.</p>
          {{/if}}
        </section>

        <section class="math-card">
          <h3 class="qr-heading">Colours</h3>
          {{#if this.colours.length}}
            <div class="pex-bar" aria-hidden="true">
              {{#each this.swatches as |s|}}
                <span style={{s.barStyle}}></span>
              {{/each}}
            </div>
            <ul class="pex-list">
              {{#each this.swatches key="hex" as |s|}}
                <li class="pex-row">
                  <button
                    type="button"
                    class="pex-swatch"
                    style={{s.style}}
                    title="Copy {{s.hex}}"
                    {{on "click" (fn this.copyOne s.hex)}}
                  >{{if (eq this.copied s.hex) "Copied" s.hex}}</button>
                  <div class="pex-meta">
                    <span>{{s.rgb}}</span>
                    <span>{{s.hsl}}</span>
                    <span class="is-muted">{{s.percent}}% of the picture</span>
                  </div>
                </li>
              {{/each}}
            </ul>
            <div class="settings-actions">
              <button type="button" class="btn active" {{on "click" this.save}}>
                <Icon @name={{if this.justSaved "check" "save"}} @size={{13}} />
                {{if this.justSaved "Saved" "Save to my palettes"}}</button>
              <CopyButton @value={{this.list}} @label="Copy hex list" />
              <CopyButton @value={{this.css}} @label="Copy as CSS" />
            </div>
            <p class="tool-hint">Saved palettes live in the
              <LinkTo @route="palette">Palette</LinkTo>
              tool.</p>
          {{else}}
            <p class="tool-hint">Upload a picture to pull its colours out.</p>
          {{/if}}
        </section>
      </div>
    </ToolPage>
  </template>
}
