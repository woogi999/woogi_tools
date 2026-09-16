import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import { formatBytes } from '../utils/file-share';
import { parsePageRanges } from '../utils/page-ranges';
import { acceptPastedFiles } from '../utils/paste-files';
import PrintButton from './print-button';

const eq = (a, b) => a === b;
// The pre-bundled build inlines its font data, which Vite's dev optimizer can't parse from the raw package.
const loadPdfLib = () => import('pdf-lib/dist/pdf-lib.esm.min.js');

let nextId = 1;

async function readPdf(file) {
  const { PDFDocument } = await loadPdfLib();
  try {
    return await PDFDocument.load(await file.arrayBuffer());
  } catch (error) {
    throw new Error(/encrypt/i.test(error.message) ? `${file.name} is password-protected` : `${file.name} isn't a readable PDF`);
  }
}

export default class PdfToolsPage extends Component {
  @tracked mode = 'merge';
  @tracked files = [];
  @tracked splitHow = 'every';
  @tracked splitRanges = '1-2, 3-';
  @tracked busy = false;
  @tracked error = '';
  @tracked result = null;
  @tracked dragging = false;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => this.clearResult());
  }

  get isMerge() {
    return this.mode === 'merge';
  }

  get splitFile() {
    return this.files[0];
  }

  get splitPreview() {
    const file = this.splitFile;
    if (!file?.pages) return null;
    if (this.splitHow === 'every') return { text: `${file.pages} separate PDFs`, many: file.pages > 1 };
    const parsed = parsePageRanges(this.splitRanges, file.pages);
    if (parsed.error) return { error: parsed.error };
    return { text: parsed.groups.length === 1 ? `1 PDF with ${parsed.groups[0].length} pages` : `${parsed.groups.length} PDFs`, many: parsed.groups.length > 1 };
  }

  get canRun() {
    if (this.busy) return false;
    if (this.isMerge) return this.files.length > 0 && this.files.every((f) => f.pages && !f.rangeError);
    return Boolean(this.splitFile?.pages && !this.splitPreview?.error);
  }

  clearResult() {
    if (this.result?.url) URL.revokeObjectURL(this.result.url);
    this.result = null;
  }

  update(id, patch) {
    this.files = this.files.map((f) => (f.id === id ? { ...f, ...patch } : f));
  }

  async addFiles(list) {
    const pdfs = [...list].filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (!pdfs.length) {
      this.error = 'Only PDF files can be added here.';
      return;
    }
    this.error = '';
    this.clearResult();
    const added = pdfs.map((file) => ({ id: nextId++, file, name: file.name, size: file.size, pages: null, range: '', rangeError: null, loadError: null }));
    // Splitting works on one file at a time, so a new drop replaces it.
    this.files = this.isMerge ? [...this.files, ...added] : added.slice(0, 1);
    for (const entry of this.isMerge ? added : added.slice(0, 1)) {
      try {
        const doc = await readPdf(entry.file);
        this.update(entry.id, { pages: doc.getPageCount() });
      } catch (error) {
        this.update(entry.id, { loadError: error.message });
      }
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
    this.mode = mode;
    this.clearResult();
    this.error = '';
    if (mode === 'split') this.files = this.files.slice(0, 1);
  };

  setRange = (id, e) => {
    const file = this.files.find((f) => f.id === id);
    const range = e.target.value;
    this.update(id, { range, rangeError: file.pages ? parsePageRanges(range, file.pages).error ?? null : null });
    this.clearResult();
  };

  move = (id, delta) => {
    const i = this.files.findIndex((f) => f.id === id);
    const j = i + delta;
    if (j < 0 || j >= this.files.length) return;
    const next = [...this.files];
    [next[i], next[j]] = [next[j], next[i]];
    this.files = next;
    this.clearResult();
  };

  remove = (id) => {
    this.files = this.files.filter((f) => f.id !== id);
    this.clearResult();
  };

  setSplitHow = (how) => {
    this.splitHow = how;
    this.clearResult();
  };

  setSplitRanges = (e) => {
    this.splitRanges = e.target.value;
    this.clearResult();
  };

  run = async () => {
    this.busy = true;
    this.error = '';
    this.clearResult();
    try {
      const { blob, name } = this.isMerge ? await this.merge() : await this.split();
      this.result = { url: URL.createObjectURL(blob), name, size: blob.size };
    } catch (error) {
      this.error = error.message || 'Something went wrong';
    } finally {
      this.busy = false;
    }
  };

  async merge() {
    const { PDFDocument } = await loadPdfLib();
    const out = await PDFDocument.create();
    for (const entry of this.files) {
      const doc = await readPdf(entry.file);
      const parsed = parsePageRanges(entry.range, doc.getPageCount());
      if (parsed.error) throw new Error(`${entry.name}: ${parsed.error}`);
      const indexes = parsed.groups.flat();
      for (const page of await out.copyPages(doc, indexes)) out.addPage(page);
    }
    const name = this.files.length === 1 ? this.files[0].name.replace(/\.pdf$/i, '-pages.pdf') : 'merged.pdf';
    // eslint-disable-next-line warp-drive/no-legacy-request-patterns -- pdf-lib serialising a document, not a data request
    return { blob: new Blob([await out.save()], { type: 'application/pdf' }), name };
  }

  async split() {
    const { PDFDocument } = await loadPdfLib();
    const entry = this.splitFile;
    const doc = await readPdf(entry.file);
    const count = doc.getPageCount();
    const groups = this.splitHow === 'every' ? Array.from({ length: count }, (_, i) => [i]) : parsePageRanges(this.splitRanges, count).groups;
    const base = entry.name.replace(/\.pdf$/i, '');
    const parts = [];
    for (const group of groups) {
      const part = await PDFDocument.create();
      for (const page of await part.copyPages(doc, group)) part.addPage(page);
      const label = group.length === 1 ? `page-${group[0] + 1}` : `pages-${group[0] + 1}-${group.at(-1) + 1}`;
      // eslint-disable-next-line warp-drive/no-legacy-request-patterns -- pdf-lib serialising a document, not a data request
      parts.push({ name: `${base}-${label}.pdf`, bytes: await part.save() });
    }
    if (parts.length === 1) return { blob: new Blob([parts[0].bytes], { type: 'application/pdf' }), name: parts[0].name };
    const { zipSync } = await import('fflate');
    const zip = zipSync(Object.fromEntries(parts.map((p) => [p.name, p.bytes])), { level: 0 });
    return { blob: new Blob([zip], { type: 'application/zip' }), name: `${base}-split.zip` };
  }

  pasteFiles = (files) => this.addFiles(files);

  <template>
    <ToolPage @route="pdf-tools" @subtitle="Merge PDFs, pick just the pages you need, or split one into several files. Your files never leave your device.">
      <div class="fs" {{acceptPastedFiles this.pasteFiles}}>
        <div class="fs-frame fc-panel pop-in">
          <div class="math-tabs" role="group" aria-label="Mode">
            <button type="button" class="qr-tab {{if this.isMerge 'active'}}" {{on "click" (fn this.setMode "merge")}}>Merge</button>
            <button type="button" class="qr-tab {{unless this.isMerge 'active'}}" {{on "click" (fn this.setMode "split")}}>Split</button>
          </div>
          <label class="qr-drop fs-drop {{if this.dragging 'is-dragging'}}" {{on "dragover" this.dragOver}} {{on "dragleave" this.dragOver}} {{on "drop" this.drop}}>
            <Icon @name="upload" @size={{22}} />
            <span>{{if this.isMerge "Drop PDFs to combine, or click to browse" "Drop a PDF to split, or click to browse"}}</span>
            <input type="file" accept="application/pdf,.pdf" multiple={{this.isMerge}} class="sr-only" {{on "change" this.selectFiles}} />
          </label>
          {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
        </div>

        {{#if this.files.length}}
          <div class="fs-frame fc-panel pop-in">
            <ul class="fs-list">
              {{#each this.files key="id" as |f index|}}
                <li class="fs-row fc-row">
                  <Icon @name="file-text" @size={{16}} />
                  <div class="fs-row-info">
                    <span class="fs-row-name">{{f.name}}</span>
                    <span class="fs-row-size">{{formatBytes f.size}} · {{if f.pages (concatPages f.pages) "reading…"}}</span>
                    {{#if f.loadError}}<span class="tool-error">{{f.loadError}}</span>{{/if}}
                    {{#if f.rangeError}}<span class="tool-error">{{f.rangeError}}</span>{{/if}}
                  </div>
                  {{#if this.isMerge}}
                    <div class="fs-row-status">
                      <input type="text" class="math-input pdf-range" placeholder="All pages" aria-label="Pages to include from {{f.name}}" value={{f.range}} {{on "input" (fn this.setRange f.id)}} />
                      <button type="button" class="btn" aria-label="Move {{f.name}} up" disabled={{eq index 0}} {{on "click" (fn this.move f.id -1)}}>↑</button>
                      <button type="button" class="btn" aria-label="Move {{f.name}} down" {{on "click" (fn this.move f.id 1)}}>↓</button>
                    </div>
                  {{/if}}
                  <button type="button" class="fs-remove" aria-label="Remove {{f.name}}" {{on "click" (fn this.remove f.id)}}><Icon @name="x" @size={{13}} /></button>
                </li>
              {{/each}}
            </ul>

            {{#if this.isMerge}}
              <p class="tool-hint">Pages are added in list order. Leave a range empty for every page, or type something like 1-3, 5, 9-.</p>
            {{else}}
              <div class="math-tabs" role="group" aria-label="How to split">
                <button type="button" class="qr-tab {{if (eq this.splitHow 'every') 'active'}}" {{on "click" (fn this.setSplitHow "every")}}>Every page</button>
                <button type="button" class="qr-tab {{if (eq this.splitHow 'ranges') 'active'}}" {{on "click" (fn this.setSplitHow "ranges")}}>By ranges</button>
              </div>
              {{#if (eq this.splitHow "ranges")}}
                <label class="math-field">
                  <span class="qr-label is-muted">Ranges (each becomes its own PDF)</span>
                  <input type="text" class="math-input" value={{this.splitRanges}} {{on "input" this.setSplitRanges}} />
                </label>
              {{/if}}
              {{#if this.splitPreview.error}}
                <p class="tool-error">{{this.splitPreview.error}}</p>
              {{else if this.splitPreview}}
                <p class="tool-hint">Makes {{this.splitPreview.text}}{{if this.splitPreview.many ", bundled in a ZIP"}}.</p>
              {{/if}}
            {{/if}}

            <div class="settings-actions">
              <button type="button" class="btn active" disabled={{if this.canRun false true}} {{on "click" this.run}}>{{if this.busy "Working…" (if this.isMerge "Merge PDFs" "Split PDF")}}</button>
              {{#if this.result}}
                <a class="btn fs-save" href={{this.result.url}} download={{this.result.name}}><Icon @name="download" @size={{13}} /> Save {{this.result.name}} ({{formatBytes this.result.size}})</a>
                <PrintButton @url={{this.result.url}} @name={{this.result.name}} />
              {{/if}}
            </div>
          </div>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}

function concatPages(n) {
  return `${n} page${n === 1 ? '' : 's'}`;
}
