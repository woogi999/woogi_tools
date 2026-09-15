import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';
import ColourField from './colour-field';
import CopyButton from './copy-button';
import { toHex, parseHex, rgbToHsl } from '../utils/color';

const HISTORY_LIMIT = 16;

export default class PixelEyedropperPage extends Component {
  @tracked imageUrl = null;
  @tracked bitmap = null;
  @tracked zoomPct = 0;
  @tracked zoomPos = { x: 0, y: 0 };
  @tracked r = 138;
  @tracked g = 138;
  @tracked b = 138;
  @tracked history = [];
  @tracked error = null;

  canvas = null;
  ctx = null;

  get hex() {
    return toHex(this.r, this.g, this.b);
  }

  get hsl() {
    return rgbToHsl(this.r, this.g, this.b);
  }

  get rgbText() {
    return `rgb(${this.r}, ${this.g}, ${this.b})`;
  }

  get hslText() {
    return `hsl(${this.hsl.h}, ${this.hsl.s}%, ${this.hsl.l}%)`;
  }

  get zoomStyle() {
    if (!this.zoomPct) return htmlSafe('display:none');
    return htmlSafe(`background-image:url(${this.imageUrl});background-position:${this.zoomPos.x}% ${this.zoomPos.y}%`);
  }

  get swatchStyle() {
    return htmlSafe(`background:${this.hex}`);
  }

  setupCanvas = modifier((canvas) => {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.draw();
  });

  async draw() {
    if (!this.bitmap || !this.canvas) return;
    const { width, height } = this.bitmap;
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx.drawImage(this.bitmap, 0, 0);
  }

  openFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const bitmap = await createImageBitmap(file);
      if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
      this.imageUrl = URL.createObjectURL(file);
      this.bitmap = bitmap;
      this.error = null;
      this.draw();
    } catch {
      this.error = "This browser can't open that image. Try the File Converter first.";
    }
  };

  selectFile = (e) => {
    this.openFile(e.target.files?.[0]);
    e.target.value = '';
  };

  dragOver = (e) => e.preventDefault();
  drop = (e) => {
    e.preventDefault();
    this.openFile(e.dataTransfer.files?.[0]);
  };

  sampleAt = (clientX, clientY) => {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor(((clientX - rect.left) / rect.width) * this.canvas.width);
    const y = Math.floor(((clientY - rect.top) / rect.height) * this.canvas.height);
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return;
    const [r, g, b] = this.ctx.getImageData(x, y, 1, 1).data;
    this.r = r;
    this.g = g;
    this.b = b;
    this.zoomPos = { x: (x / this.canvas.width) * 100, y: (y / this.canvas.height) * 100 };
  };

  move = (e) => {
    if (!this.bitmap) return;
    this.zoomPct = 1;
    this.sampleAt(e.clientX, e.clientY);
  };

  leave = () => (this.zoomPct = 0);

  pick = (e) => {
    this.move(e);
    const hex = toHex(this.r, this.g, this.b);
    this.history = [hex, ...this.history.filter((h) => h !== hex)].slice(0, HISTORY_LIMIT);
  };

  setHex = (hex) => {
    const rgb = parseHex(hex);
    if (!rgb) return;
    this.r = rgb.r;
    this.g = rgb.g;
    this.b = rgb.b;
  };

  useHistory = (hex) => this.setHex(hex);

  <template>
    <ToolPage @route="pixel-eyedropper" @subtitle="Upload an image and click anywhere to grab that exact colour. Colour thief mode: on.">
      <div class="math-grid pop-in">
        <section class="math-card">
          <label class="qr-drop {{if this.bitmap 'is-filled'}}" {{on "dragover" this.dragOver}} {{on "drop" this.drop}}>
            {{#unless this.bitmap}}
              <Icon @name="pipette" @size={{22}} />
              <span>Drop an image, or click to browse</span>
            {{/unless}}
            <input type="file" accept="image/*" class="sr-only" {{on "change" this.selectFile}} />
          </label>

          {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}

          {{#if this.bitmap}}
            <div class="eyedrop-stage">
              <canvas
                class="eyedrop-canvas"
                {{this.setupCanvas}}
                {{on "mousemove" this.move}}
                {{on "mouseleave" this.leave}}
                {{on "click" this.pick}}
              ></canvas>
              <div class="eyedrop-zoom" style={{this.zoomStyle}} aria-hidden="true"></div>
            </div>
            <p class="tool-hint">Click anywhere on the image to save that colour to your history.</p>
          {{/if}}
        </section>

        <section class="math-card">
          <h3 class="qr-heading">Sampled colour</h3>
          <div class="math-row is-aligned">
            <span class="eyedrop-swatch" style={{this.swatchStyle}}></span>
            <ColourField @value={{this.hex}} @label="Sampled colour" @onChange={{this.setHex}} />
          </div>
          <div class="math-stats">
            <div class="math-stat">
              <span>RGB</span>
              <div class="field-head"><strong>{{this.rgbText}}</strong><CopyButton @value={{this.rgbText}} /></div>
            </div>
            <div class="math-stat">
              <span>HSL</span>
              <div class="field-head"><strong>{{this.hslText}}</strong><CopyButton @value={{this.hslText}} /></div>
            </div>
            <div class="math-stat">
              <span>HEX</span>
              <div class="field-head"><strong>{{this.hex}}</strong><CopyButton @value={{this.hex}} /></div>
            </div>
          </div>

          {{#if this.history.length}}
            <h3 class="qr-heading">History</h3>
            <div class="eyedrop-history">
              {{#each this.history as |hex|}}
                <button type="button" class="eyedrop-chip" style={{htmlSwatch hex}} title={{hex}} {{on "click" (fn this.useHistory hex)}}></button>
              {{/each}}
            </div>
          {{/if}}
        </section>
      </div>
    </ToolPage>
  </template>
}

function htmlSwatch(hex) {
  return htmlSafe(`background:${hex}`);
}
