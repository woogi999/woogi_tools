import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';
import PrintButton from './print-button';
import ColourField from './colour-field';
import { acceptPastedFiles } from '../utils/paste-files';
import { formatBytes } from '../utils/file-share';
import { loadImage, planSheet, drawSheet, canvasBlob, FITS, LAYOUTS } from '../utils/stitch';

// Sticks a pile of images together into one sheet: a spritesheet for a game, a
// flipbook strip, or a plain contact sheet. Everything is drawn on a canvas here.

const FORMATS = [
  { id: 'image/png', label: 'PNG (keeps transparency)', ext: 'png' },
  { id: 'image/webp', label: 'WebP', ext: 'webp' },
  { id: 'image/jpeg', label: 'JPEG', ext: 'jpg' },
];
const eq = (a, b) => a === b;
let nextId = 1;

export default class ImageStitcherPage extends Component {
  @tracked items = [];
  @tracked dragging = false;
  @tracked layout = 'grid';
  @tracked columns = 0; // 0: work it out from how many there are
  @tracked cellWidth = 0; // 0: the biggest image's size
  @tracked cellHeight = 0;
  @tracked gap = 0;
  @tracked padding = 0;
  @tracked maxSize = 0; // 0: no cap
  @tracked fit = 'contain';
  @tracked smooth = false;
  @tracked background = 'transparent';
  @tracked bgColor = '#ffffff';
  @tracked format = 'image/png';
  @tracked quality = 92;
  @tracked resultUrl = null;
  @tracked resultSize = null;
  @tracked busy = false;
  @tracked error = null;

  fits = FITS;
  layouts = LAYOUTS;
  formats = FORMATS;
  canvas = null;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => {
      if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
      for (const item of this.items) item.image?.bitmap?.close?.();
    });
  }

  get images() {
    return this.items.map((i) => i.image).filter(Boolean);
  }

  get options() {
    return {
      layout: this.layout,
      columns: this.columns,
      cellWidth: this.cellWidth,
      cellHeight: this.cellHeight,
      gap: this.gap,
      padding: this.padding,
      maxSize: this.maxSize,
      fit: this.fit,
      smooth: this.smooth,
      background: this.background === 'colour' ? this.bgColor : 'transparent',
    };
  }

  get plan() {
    return planSheet(this.images, this.options);
  }

  // "4 across, 3 down · 512×384 · 128×128 a frame" — the bit that matters for game dev.
  get planText() {
    const plan = this.plan;
    if (!plan) return '';
    const scaled = plan.scale < 1 ? ` (scaled down from ${plan.width}×${plan.height})` : '';
    return `${plan.cols} across, ${plan.rows} down · ${plan.outWidth}×${plan.outHeight}${scaled} · ${plan.cellWidth}×${plan.cellHeight} a frame`;
  }

  get usesQuality() {
    return this.format !== 'image/png';
  }

  get ext() {
    return FORMATS.find((f) => f.id === this.format)?.ext ?? 'png';
  }

  // The preview is redrawn whenever the images or any setting change.
  preview = modifier((element) => {
    this.canvas = element;
    this.redraw();
    return () => (this.canvas = null);
  });

  redraw() {
    if (!this.canvas) return;
    if (!this.images.length) {
      this.canvas.width = this.canvas.height = 1;
      return;
    }
    drawSheet(this.canvas, this.images, this.options);
  }

  changed() {
    if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
    this.resultUrl = null;
    this.resultSize = null;
    this.redraw();
  }

  async addFiles(list) {
    const files = [...list].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    this.error = null;
    for (const file of files) {
      const item = { id: nextId++, file, image: null };
      this.items = [...this.items, item];
      try {
        const image = await loadImage(file);
        this.items = this.items.map((i) => (i.id === item.id ? { ...i, image } : i));
      } catch (error) {
        this.items = this.items.filter((i) => i.id !== item.id);
        this.error = error.message;
      }
    }
    this.changed();
  }

  selectFiles = (e) => {
    this.addFiles(e.target.files);
    e.target.value = '';
  };

  dragOver = (e) => {
    e.preventDefault();
    this.dragging = e.type === 'dragover';
  };

  drop = (e) => {
    e.preventDefault();
    this.dragging = false;
    this.addFiles(e.dataTransfer.files);
  };

  pasteFiles = (files) => this.addFiles(files);

  number = (key, event) => {
    this[key] = Math.max(0, Math.floor(Number(event.target.value)) || 0);
    this.changed();
  };

  pick = (key, value) => {
    this[key] = value;
    this.changed();
  };

  setFit = (e) => this.pick('fit', e.target.value);
  setFormat = (e) => this.pick('format', e.target.value);
  setQuality = (e) => this.pick('quality', Math.max(10, Math.min(100, Number(e.target.value) || 92)));
  setBgColor = (value) => this.pick('bgColor', value);
  toggleSmooth = (e) => this.pick('smooth', e.target.checked);

  // The order is the order they're drawn in, so moving one matters for a spritesheet.
  move = (id, by) => {
    const index = this.items.findIndex((i) => i.id === id);
    const to = index + by;
    if (index < 0 || to < 0 || to >= this.items.length) return;
    const next = [...this.items];
    [next[index], next[to]] = [next[to], next[index]];
    this.items = next;
    this.changed();
  };

  sortByName = () => {
    // Numbers inside names count as numbers, so frame2 lands before frame10.
    this.items = [...this.items].sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: 'base' }));
    this.changed();
  };

  remove = (id) => {
    const item = this.items.find((i) => i.id === id);
    item?.image?.bitmap?.close?.();
    this.items = this.items.filter((i) => i.id !== id);
    this.changed();
  };

  clear = () => {
    for (const item of this.items) item.image?.bitmap?.close?.();
    this.items = [];
    this.changed();
  };

  stitch = async () => {
    if (!this.images.length || this.busy) return;
    this.busy = true;
    this.error = null;
    try {
      const canvas = document.createElement('canvas');
      drawSheet(canvas, this.images, this.options);
      const blob = await canvasBlob(canvas, this.format, this.quality / 100);
      if (!blob) throw new Error('The sheet couldn’t be saved');
      if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
      this.resultUrl = URL.createObjectURL(blob);
      this.resultSize = blob.size;
    } catch (error) {
      this.error = error?.message ?? 'Something went wrong stitching these together';
    } finally {
      this.busy = false;
    }
  };

  get resultName() {
    return `spritesheet.${this.ext}`;
  }

  <template>
    <ToolPage @route="image-stitcher" @subtitle="Stick images together into one sheet: spritesheets, flipbook frames or a plain grid. Set the columns, the frame size and a size cap.">
      <div class="fs" {{acceptPastedFiles this.pasteFiles}}>
        <div class="fs-frame fc-panel pop-in">
          <label class="qr-drop fs-drop {{if this.dragging 'is-dragging'}}" {{on "dragover" this.dragOver}} {{on "dragleave" this.dragOver}} {{on "drop" this.drop}}>
            <Icon @name="layout-grid" @size={{22}} />
            <span>{{if this.dragging "Drop them here" "Drop your frames, paste them, or click to browse"}}</span>
            <input type="file" accept="image/*" multiple class="sr-only" {{on "change" this.selectFiles}} />
          </label>

          <div class="math-tabs" role="group" aria-label="Layout">
            {{#each this.layouts as |l|}}
              <button type="button" class="qr-tab {{if (eq this.layout l.id) 'active'}}" {{on "click" (fn this.pick "layout" l.id)}}>{{l.label}}</button>
            {{/each}}
          </div>

          <div class="math-row">
            {{#if (eq this.layout "grid")}}
              <label class="math-field"><span class="qr-label is-muted">Columns (0 = work it out)</span><input type="number" min="0" class="math-input" value={{this.columns}} {{on "input" (fn this.number "columns")}} /></label>
            {{/if}}
            <label class="math-field"><span class="qr-label is-muted">Frame width (0 = biggest)</span><input type="number" min="0" class="math-input" value={{this.cellWidth}} {{on "input" (fn this.number "cellWidth")}} /></label>
            <label class="math-field"><span class="qr-label is-muted">Frame height (0 = biggest)</span><input type="number" min="0" class="math-input" value={{this.cellHeight}} {{on "input" (fn this.number "cellHeight")}} /></label>
          </div>

          <div class="math-row">
            <label class="math-field"><span class="qr-label is-muted">Gap between frames (px)</span><input type="number" min="0" class="math-input" value={{this.gap}} {{on "input" (fn this.number "gap")}} /></label>
            <label class="math-field"><span class="qr-label is-muted">Edge padding (px)</span><input type="number" min="0" class="math-input" value={{this.padding}} {{on "input" (fn this.number "padding")}} /></label>
            <label class="math-field"><span class="qr-label is-muted">Max sheet size (0 = no cap)</span><input type="number" min="0" class="math-input" value={{this.maxSize}} {{on "input" (fn this.number "maxSize")}} /></label>
          </div>

          <div class="math-row">
            <label class="math-field">
              <span class="qr-label is-muted">How each image sits</span>
              <select class="select" {{on "change" this.setFit}}>
                {{#each this.fits as |f|}}
                  <option value={{f.id}} selected={{eq this.fit f.id}}>{{f.label}}</option>
                {{/each}}
              </select>
            </label>
            <label class="math-field">
              <span class="qr-label is-muted">Save as</span>
              <select class="select" {{on "change" this.setFormat}}>
                {{#each this.formats as |f|}}
                  <option value={{f.id}} selected={{eq this.format f.id}}>{{f.label}}</option>
                {{/each}}
              </select>
            </label>
            {{#if this.usesQuality}}
              <label class="math-field"><span class="qr-label is-muted">Quality: {{this.quality}}</span><input type="range" min="10" max="100" value={{this.quality}} {{on "input" this.setQuality}} /></label>
            {{/if}}
          </div>

          <div class="math-tabs" role="group" aria-label="Background">
            <button type="button" class="qr-tab {{if (eq this.background 'transparent') 'active'}}" {{on "click" (fn this.pick "background" "transparent")}}>See-through</button>
            <button type="button" class="qr-tab {{if (eq this.background 'colour') 'active'}}" {{on "click" (fn this.pick "background" "colour")}}>A colour</button>
          </div>
          {{#if (eq this.background "colour")}}
            <ColourField @label="Background" @value={{this.bgColor}} @onChange={{this.setBgColor}} />
          {{/if}}

          <label class="lobby-rule is-switch">
            <span class="lobby-rule-text"><span class="qr-label">Smooth when scaling</span><span class="tool-hint">Leave this off for pixel art: it keeps the edges hard instead of blurring them.</span></span>
            <span class="qr-switch">
              <input type="checkbox" role="switch" checked={{this.smooth}} aria-checked={{if this.smooth "true" "false"}} {{on "change" this.toggleSmooth}} />
              <span class="qr-switch-track" aria-hidden="true"></span>
            </span>
          </label>
        </div>

        {{#if this.items.length}}
          <div class="fs-frame fc-panel pop-in">
            <div class="fc-toolbar">
              <h3 class="qr-heading">The sheet</h3>
              <div class="settings-actions">
                <button type="button" class="btn active" disabled={{this.busy}} {{on "click" this.stitch}}>{{if this.busy "Stitching…" "Stitch them"}}</button>
                {{#if this.resultUrl}}
                  <a class="btn fs-save" href={{this.resultUrl}} download={{this.resultName}}><Icon @name="download" @size={{13}} /> Save</a>
                  <PrintButton @url={{this.resultUrl}} @name={{this.resultName}} />
                {{/if}}
                <button type="button" class="btn" {{on "click" this.sortByName}}>Sort by name</button>
                <button type="button" class="btn" {{on "click" this.clear}}>Clear</button>
              </div>
            </div>
            <p class="tool-hint">{{this.planText}}{{#if this.resultSize}} · {{formatBytes this.resultSize}}{{/if}}</p>
            {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
            <div class="stitch-preview"><canvas class="stitch-canvas" {{this.preview}}></canvas></div>

            <ul class="fs-list">
              {{#each this.items key="id" as |item index|}}
                <li class="fs-row fc-row">
                  <span class="stitch-index">{{index}}</span>
                  <div class="fs-row-info">
                    <span class="fs-row-name">{{item.file.name}}</span>
                    <span class="fs-row-size">{{#if item.image}}{{item.image.width}}×{{item.image.height}} · {{/if}}{{formatBytes item.file.size}}</span>
                  </div>
                  <div class="fs-row-status">
                    <button type="button" class="btn" aria-label="Move {{item.file.name}} earlier" {{on "click" (fn this.move item.id -1)}}><Icon @name="arrow-up" @size={{13}} /></button>
                    <button type="button" class="btn" aria-label="Move {{item.file.name}} later" {{on "click" (fn this.move item.id 1)}}><Icon @name="arrow-down" @size={{13}} /></button>
                  </div>
                  <button type="button" class="fs-remove" aria-label="Remove {{item.file.name}}" {{on "click" (fn this.remove item.id)}}><Icon @name="x" @size={{13}} /></button>
                </li>
              {{/each}}
            </ul>
          </div>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}
