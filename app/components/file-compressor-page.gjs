import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import { formatBytes } from '../utils/file-share';
import { FORMATS, compressBytes, decompressBytes } from '../utils/codec';
import { acceptPastedFiles } from '../utils/paste-files';

const EXT = { gzip: 'gz', deflate: 'zz', 'deflate-raw': 'raw', brotli: 'br', zstd: 'zst' };
const eq = (a, b) => a === b;

let nextId = 1;

function guessFormat(name) {
  const ext = name.split('.').pop()?.toLowerCase();
  return Object.entries(EXT).find(([, e]) => e === ext)?.[0] ?? null;
}

export default class FileCompressorPage extends Component {
  formats = FORMATS;

  @tracked mode = 'compress';
  @tracked formatId = 'gzip';
  @tracked level = FORMATS[0].level;
  @tracked items = [];
  @tracked busy = false;
  @tracked dragging = false;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => this.revokeAll());
  }

  get format() {
    return FORMATS.find((f) => f.id === this.formatId);
  }

  get isCompress() {
    return this.mode === 'compress';
  }

  get doneItems() {
    return this.items.filter((i) => i.url);
  }

  get savings() {
    const done = this.doneItems;
    if (!done.length || !this.isCompress) return null;
    const before = done.reduce((n, i) => n + i.file.size, 0);
    const after = done.reduce((n, i) => n + i.size, 0);
    const pct = Math.round((1 - after / before) * 100);
    return `${formatBytes(before)} → ${formatBytes(after)} (${pct >= 0 ? `${pct}% smaller` : `${-pct}% larger`})`;
  }

  revokeAll() {
    for (const item of this.items) if (item.url) URL.revokeObjectURL(item.url);
  }

  resetResults() {
    for (const item of this.items) if (item.url) URL.revokeObjectURL(item.url);
    this.items = this.items.map((i) => ({ ...i, url: null, size: null, name: null, error: null }));
  }

  addFiles(list) {
    if (!list.length) return;
    this.resetResults();
    this.items = [...this.items, ...[...list].map((file) => ({ id: nextId++, file, url: null, size: null, name: null, error: null }))];
    if (!this.isCompress) {
      const guess = guessFormat(list[0].name);
      if (guess) this.formatId = guess;
    }
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

  setMode = (mode) => {
    if (mode === this.mode) return;
    this.mode = mode;
    this.resetResults();
  };

  setFormat = (event) => {
    this.formatId = event.target.value;
    this.level = this.format.level;
    this.resetResults();
  };

  setLevel = (event) => {
    this.level = +event.target.value;
  };

  remove = (id) => {
    const item = this.items.find((i) => i.id === id);
    if (item?.url) URL.revokeObjectURL(item.url);
    this.items = this.items.filter((i) => i.id !== id);
  };

  clear = () => {
    this.revokeAll();
    this.items = [];
  };

  run = async () => {
    this.busy = true;
    this.resetResults();
    for (const item of this.items) {
      try {
        const bytes = new Uint8Array(await item.file.arrayBuffer());
        if (this.isCompress) {
          const out = await compressBytes(bytes, this.formatId, this.level);
          const name = `${item.file.name}.${EXT[this.formatId]}`;
          const blob = new Blob([out]);
          this.items = this.items.map((i) => (i.id === item.id ? { ...i, url: URL.createObjectURL(blob), size: blob.size, name, error: null } : i));
        } else {
          const out = await decompressBytes(bytes, this.formatId);
          const name = item.file.name.replace(new RegExp(`\\.${EXT[this.formatId]}$`, 'i'), '') || `${item.file.name}.out`;
          const blob = new Blob([out]);
          this.items = this.items.map((i) => (i.id === item.id ? { ...i, url: URL.createObjectURL(blob), size: blob.size, name, error: null } : i));
        }
      } catch {
        this.items = this.items.map((i) => (i.id === item.id ? { ...i, error: this.isCompress ? 'Compression failed.' : `Couldn't decompress: is this really a ${this.format.label} file?` } : i));
      }
    }
    this.busy = false;
  };

  pasteFiles = (files) => this.addFiles(files);

  <template>
    <ToolPage @route="file-compressor" @subtitle="Shrink any file with gzip, deflate, brotli or zstd, or unpack one. Right here in your browser.">
      <div class="fs" {{acceptPastedFiles this.pasteFiles}}>
        <div class="fs-frame fc-panel pop-in">
          <div class="tool-controls">
            <div class="mode-toggle" role="group" aria-label="Mode">
              <button type="button" class="btn {{if this.isCompress 'active'}}" {{on "click" (fn this.setMode "compress")}}>Compress</button>
              <button type="button" class="btn {{if this.isCompress '' 'active'}}" {{on "click" (fn this.setMode "decompress")}}>Decompress</button>
            </div>
            <select class="select" aria-label="Format" {{on "change" this.setFormat}}>
              {{#each this.formats as |f|}}
                <option value={{f.id}} selected={{eq f.id this.formatId}}>{{f.label}}</option>
              {{/each}}
            </select>
          </div>
          {{#if this.isCompress}}
            <div class="slider-row slider-row-wide">
              <label for="fcomp-level">Level</label>
              <input id="fcomp-level" type="range" min={{this.format.min}} max={{this.format.max}} value={{this.level}} {{on "input" this.setLevel}} />
              <span class="slider-num">{{this.level}}</span>
            </div>
          {{/if}}

          <label class="qr-drop fs-drop {{if this.dragging 'is-dragging'}}" {{on "dragover" this.dragOver}} {{on "dragleave" this.dragOver}} {{on "drop" this.drop}}>
            <Icon @name="package" @size={{22}} />
            <span>{{if this.isCompress "Drop any file to compress, or click to browse" "Drop a .gz, .br, .zst or .zz file to decompress, or click to browse"}}</span>
            <input type="file" multiple class="sr-only" {{on "change" this.selectFiles}} />
          </label>
        </div>

        {{#if this.items.length}}
          <div class="fs-frame fc-panel pop-in">
            <div class="fc-toolbar">
              <div class="settings-actions">
                <button type="button" class="btn active" disabled={{this.busy}} {{on "click" this.run}}>{{if this.busy "Working…" (if this.isCompress "Compress" "Decompress")}}</button>
                <button type="button" class="btn" {{on "click" this.clear}}>Clear</button>
              </div>
              {{#if this.savings}}<span class="tool-hint">{{this.savings}}</span>{{/if}}
            </div>
            <ul class="fs-list">
              {{#each this.items key="id" as |item|}}
                <li class="fs-row fc-row">
                  <Icon @name="package" @size={{16}} />
                  <div class="fs-row-info">
                    <span class="fs-row-name">{{item.file.name}}</span>
                    <span class="fs-row-size">{{formatBytes item.file.size}}{{#if item.size}} → {{formatBytes item.size}}{{/if}}</span>
                    {{#if item.error}}<span class="tool-error">{{item.error}}</span>{{/if}}
                  </div>
                  <div class="fs-row-status">
                    {{#if item.url}}<a class="btn fs-save" href={{item.url}} download={{item.name}}><Icon @name="download" @size={{13}} /> Save</a>{{/if}}
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
