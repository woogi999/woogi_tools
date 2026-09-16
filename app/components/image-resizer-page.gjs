import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import { formatBytes } from '../utils/file-share';
import { acceptPastedFiles } from '../utils/paste-files';
import PrintButton from './print-button';

const FORMATS = [
  { id: 'same', label: 'Same as original' },
  { id: 'image/jpeg', label: 'JPEG', ext: 'jpg' },
  { id: 'image/webp', label: 'WEBP', ext: 'webp' },
  { id: 'image/png', label: 'PNG', ext: 'png' },
];
const ENCODABLE = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' };
const eq = (a, b) => a === b;

let nextId = 1;

async function decode(file) {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new Error("This browser can't open that image. Try the File Converter for HEIC, RAW and other formats.");
  }
}

function targetSize(width, height, { mode, maxWidth, maxHeight, percent }) {
  if (mode === 'percent') {
    const scale = Math.max(1, percent) / 100;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }
  // "Fit within" never enlarges and always keeps the aspect ratio.
  const scale = Math.min(1, maxWidth > 0 ? maxWidth / width : 1, maxHeight > 0 ? maxHeight / height : 1);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function resize(file, options) {
  const bitmap = await decode(file);
  const { width, height } = targetSize(bitmap.width, bitmap.height, options);
  const type = options.format === 'same' ? (ENCODABLE[file.type] ? file.type : 'image/png') : options.format;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (type === 'image/jpeg') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  const original = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding failed'))), type, options.quality / 100));
  const base = file.name.replace(/\.[^.]+$/, '');
  return { blob, name: `${base}-${width}x${height}.${ENCODABLE[type]}`, original, width, height };
}

export default class ImageResizerPage extends Component {
  formats = FORMATS;

  @tracked items = [];
  @tracked mode = 'fit';
  @tracked maxWidth = 1920;
  @tracked maxHeight = 1920;
  @tracked percent = 50;
  @tracked format = 'image/jpeg';
  @tracked quality = 82;
  @tracked busy = false;
  @tracked dragging = false;
  @tracked zipUrl = null;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => this.revokeAll());
  }

  get options() {
    return { mode: this.mode, maxWidth: this.maxWidth, maxHeight: this.maxHeight, percent: this.percent, format: this.format, quality: this.quality };
  }

  get usesQuality() {
    return this.format !== 'image/png';
  }

  get doneItems() {
    return this.items.filter((i) => i.url);
  }

  get savings() {
    const done = this.doneItems;
    if (!done.length) return null;
    const before = done.reduce((n, i) => n + i.file.size, 0);
    const after = done.reduce((n, i) => n + i.size, 0);
    const pct = Math.round((1 - after / before) * 100);
    return `${formatBytes(before)} → ${formatBytes(after)} (${pct >= 0 ? `${pct}% smaller` : `${-pct}% larger`})`;
  }

  revokeAll() {
    for (const item of this.items) if (item.url) URL.revokeObjectURL(item.url);
    if (this.zipUrl) URL.revokeObjectURL(this.zipUrl);
  }

  // Any settings change invalidates previous results.
  resetResults() {
    for (const item of this.items) if (item.url) URL.revokeObjectURL(item.url);
    if (this.zipUrl) URL.revokeObjectURL(this.zipUrl);
    this.zipUrl = null;
    this.items = this.items.map((i) => ({ ...i, url: null, size: null, name: null, dims: null, error: null }));
  }

  addFiles(list) {
    const images = [...list].filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    this.resetResults();
    this.items = [...this.items, ...images.map((file) => ({ id: nextId++, file, url: null, size: null, name: null, dims: null, error: null }))];
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

  setting = (key, event) => {
    const raw = event.target.value;
    this[key] = ['maxWidth', 'maxHeight', 'percent', 'quality'].includes(key) ? Math.max(0, Math.floor(+raw) || 0) : raw;
    this.resetResults();
  };

  setMode = (mode) => {
    this.mode = mode;
    this.resetResults();
  };

  remove = (id) => {
    const item = this.items.find((i) => i.id === id);
    if (item?.url) URL.revokeObjectURL(item.url);
    this.items = this.items.filter((i) => i.id !== id);
  };

  clear = () => {
    this.revokeAll();
    this.zipUrl = null;
    this.items = [];
  };

  run = async () => {
    this.busy = true;
    this.resetResults();
    const options = this.options;
    for (const item of this.items) {
      try {
        const out = await resize(item.file, options);
        this.items = this.items.map((i) => (i.id === item.id ? { ...i, url: URL.createObjectURL(out.blob), blob: out.blob, size: out.blob.size, name: out.name, dims: `${out.original.width}×${out.original.height} → ${out.width}×${out.height}` } : i));
      } catch (error) {
        this.items = this.items.map((i) => (i.id === item.id ? { ...i, error: error.message } : i));
      }
    }
    if (this.doneItems.length > 1) {
      const { zipSync } = await import('fflate');
      const entries = {};
      for (const item of this.doneItems) entries[item.name] = new Uint8Array(await item.blob.arrayBuffer());
      this.zipUrl = URL.createObjectURL(new Blob([zipSync(entries, { level: 0 })], { type: 'application/zip' }));
    }
    this.busy = false;
  };

  pasteFiles = (files) => this.addFiles(files);

  <template>
    <ToolPage @route="image-resizer" @subtitle="Drop in your images, pick a size and quality, and download them smaller. Works on lots at once.">
      <div class="fs" {{acceptPastedFiles this.pasteFiles}}>
        <div class="fs-frame fc-panel pop-in">
          <label class="qr-drop fs-drop {{if this.dragging 'is-dragging'}}" {{on "dragover" this.dragOver}} {{on "dragleave" this.dragOver}} {{on "drop" this.drop}}>
            <Icon @name="image" @size={{22}} />
            <span>Drop images, or click to browse</span>
            <input type="file" accept="image/*" multiple class="sr-only" {{on "change" this.selectFiles}} />
          </label>

          <div class="math-tabs" role="group" aria-label="Resize by">
            <button type="button" class="qr-tab {{if (eq this.mode 'fit') 'active'}}" {{on "click" (fn this.setMode "fit")}}>Fit within size</button>
            <button type="button" class="qr-tab {{if (eq this.mode 'percent') 'active'}}" {{on "click" (fn this.setMode "percent")}}>Percentage</button>
          </div>
          <div class="math-row">
            {{#if (eq this.mode "fit")}}
              <label class="math-field"><span class="qr-label is-muted">Max width (px)</span><input type="number" min="0" class="math-input" value={{this.maxWidth}} {{on "input" (fn this.setting "maxWidth")}} /></label>
              <label class="math-field"><span class="qr-label is-muted">Max height (px)</span><input type="number" min="0" class="math-input" value={{this.maxHeight}} {{on "input" (fn this.setting "maxHeight")}} /></label>
            {{else}}
              <label class="math-field"><span class="qr-label is-muted">Scale (%)</span><input type="number" min="1" max="400" class="math-input" value={{this.percent}} {{on "input" (fn this.setting "percent")}} /></label>
            {{/if}}
            <label class="math-field">
              <span class="qr-label is-muted">Format</span>
              <select class="select" {{on "change" (fn this.setting "format")}}>
                {{#each this.formats as |f|}}
                  <option value={{f.id}} selected={{eq this.format f.id}}>{{f.label}}</option>
                {{/each}}
              </select>
            </label>
          </div>
          {{#if this.usesQuality}}
            <label class="math-field">
              <span class="qr-label is-muted">Quality: {{this.quality}}</span>
              <input type="range" min="10" max="100" value={{this.quality}} {{on "input" (fn this.setting "quality")}} />
            </label>
          {{/if}}
          <p class="tool-hint">{{if (eq this.mode "fit") "Images already smaller than the box keep their size, and proportions are always kept." "Scales width and height by the same amount."}}</p>
        </div>

        {{#if this.items.length}}
          <div class="fs-frame fc-panel pop-in">
            <div class="fc-toolbar">
              <div class="settings-actions">
                <button type="button" class="btn active" disabled={{this.busy}} {{on "click" this.run}}>{{if this.busy "Working…" "Resize"}}</button>
                {{#if this.zipUrl}}<a class="btn fs-save" href={{this.zipUrl}} download="resized-images.zip"><Icon @name="download" @size={{13}} /> Save all (ZIP)</a>{{/if}}
                <button type="button" class="btn" {{on "click" this.clear}}>Clear</button>
              </div>
              {{#if this.savings}}<span class="tool-hint">{{this.savings}}</span>{{/if}}
            </div>
            <ul class="fs-list">
              {{#each this.items key="id" as |item|}}
                <li class="fs-row fc-row">
                  <Icon @name="image" @size={{16}} />
                  <div class="fs-row-info">
                    <span class="fs-row-name">{{item.file.name}}</span>
                    <span class="fs-row-size">{{formatBytes item.file.size}}{{#if item.size}} → {{formatBytes item.size}} · {{item.dims}}{{/if}}</span>
                    {{#if item.error}}<span class="tool-error">{{item.error}}</span>{{/if}}
                  </div>
                  <div class="fs-row-status">
                    {{#if item.url}}<a class="btn fs-save" href={{item.url}} download={{item.name}}><Icon @name="download" @size={{13}} /> Save</a><PrintButton @url={{item.url}} @name={{item.name}} />{{/if}}
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
