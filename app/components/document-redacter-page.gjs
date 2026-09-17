import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import { acceptPastedFiles } from '../utils/paste-files';
import { formatBytes } from '../utils/file-share';
import {
  openPdf,
  renderPage,
  findOnPage,
  burnPdf,
  openDocx,
  docxParagraphs,
  redactDocx,
  saveDocx,
} from '../utils/redact';

// Blacks out the parts of a PDF or Word file that must not get out, for real:
// the PDF is flattened to pictures with the bars painted on, and the Word
// file has the words themselves replaced in its XML. Nothing to select,
// copy, or peel back.

const PREVIEW_SCALE = 1.25;
const progressWidth = (p) => htmlSafe(`width:${Math.round((p ?? 0) * 100)}%`);
const boxStyle = (b) =>
  htmlSafe(
    `left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%`,
  );
const isPdf = (file) =>
  file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
const isDocx = (file) => /\.docx$/i.test(file.name);
let nextId = 1;
const concat = (...parts) => parts.join('');

// A paragraph split into words and the spaces between them, each remembering
// where it starts, so a click maps straight back to the XML.
function splitWords(text) {
  const words = [];
  const re = /\S+|\s+/g;
  let m;
  while ((m = re.exec(text)))
    words.push({ text: m[0], from: m.index, hit: false, blank: !m[0].trim() });
  return words;
}

export default class DocumentRedacterPage extends Component {
  get pipBusy() {
    return this.busy;
  }

  get pipWarning() {
    return 'Close the Document Redacter? The file being written will be lost.';
  }
  @tracked file = null;
  @tracked kind = null; // 'pdf' | 'docx'
  @tracked pages = []; // pdf: { index, url, width, height, boxes: [] }
  @tracked paragraphs = []; // docx: { id, text, words: [{ text, hit }] }
  @tracked query = '';
  @tracked found = 0;
  @tracked draft = null;
  @tracked dragging = false;
  @tracked busy = false;
  @tracked status = '';
  @tracked progress = 0;
  @tracked error = null;
  @tracked resultUrl = null;
  @tracked resultSize = 0;

  doc = null;
  docx = null;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => this.clearUrls());
  }

  clearUrls() {
    for (const page of this.pages) URL.revokeObjectURL(page.url);
    if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
  }

  get isPdf() {
    return this.kind === 'pdf';
  }

  get boxCount() {
    return this.pages.reduce((n, p) => n + p.boxes.length, 0);
  }

  get docxCount() {
    let n = 0;
    for (const p of this.paragraphs) for (const w of p.words) if (w.hit) n++;
    return n;
  }

  get markCount() {
    return this.isPdf ? this.boxCount : this.docxCount;
  }

  get resultName() {
    return `${(this.file?.name ?? 'document').replace(/\.[^.]+$/, '')}-redacted.${this.kind}`;
  }

  get canSave() {
    return this.markCount > 0 && !this.busy;
  }

  get cannotSave() {
    return !this.canSave;
  }

  get noMarks() {
    return this.markCount === 0;
  }

  async open(file) {
    if (!file) return;
    if (!isPdf(file) && !isDocx(file)) {
      this.error = 'Drop a PDF or a Word (.docx) file.';
      return;
    }
    this.reset();
    this.file = file;
    this.busy = true;
    this.status = 'Opening…';
    try {
      if (isPdf(file)) {
        this.kind = 'pdf';
        this.doc = await openPdf(file);
        const pages = [];
        for (let i = 0; i < this.doc.numPages; i++) {
          const canvas = await renderPage(this.doc, i, PREVIEW_SCALE);
          const blob = await new Promise((resolve) =>
            canvas.toBlob(resolve, 'image/jpeg', 0.85),
          );
          pages.push({
            index: i,
            number: i + 1,
            url: URL.createObjectURL(blob),
            width: canvas.width,
            height: canvas.height,
            boxes: [],
          });
          this.progress = (i + 1) / this.doc.numPages;
          this.pages = [...pages];
        }
      } else {
        this.kind = 'docx';
        this.docx = await openDocx(file);
        this.paragraphs = docxParagraphs(this.docx).map((p) => ({
          ...p,
          words: splitWords(p.text),
        }));
      }
    } catch (error) {
      this.error = error?.message ?? 'Couldn’t open that file';
      this.file = null;
    } finally {
      this.busy = false;
      this.status = '';
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
  setQuery = (event) => (this.query = event.target.value);
  enterFinds = (event) => {
    if (event.key === 'Enter') this.findAll();
  };

  // Boxes (or words) everywhere the typed text appears.
  findAll = async () => {
    const q = this.query.trim();
    if (!q) return;
    this.clearResult();
    if (this.isPdf) {
      let n = 0;
      const pages = [];
      for (const page of this.pages) {
        const boxes = await findOnPage(this.doc, page.index, q);
        n += boxes.length;
        pages.push({
          ...page,
          boxes: [...page.boxes, ...boxes.map((b) => ({ ...b, id: nextId++ }))],
        });
      }
      this.pages = pages;
      this.found = n;
    } else {
      const needle = q.toLowerCase();
      let n = 0;
      this.paragraphs = this.paragraphs.map((p) => {
        if (!p.text.toLowerCase().includes(needle)) return p;
        const words = p.words.map((w) => {
          // A word counts if the search lands anywhere inside it or spans it.
          const from = w.from;
          const to = w.from + w.text.length;
          let hit = w.hit;
          const lower = p.text.toLowerCase();
          let at = lower.indexOf(needle);
          while (at >= 0) {
            if (at < to && at + needle.length > from && w.text.trim()) {
              hit = true;
              n++;
            }
            at = lower.indexOf(needle, at + 1);
          }
          return { ...w, hit };
        });
        return { ...p, words };
      });
      this.found = n;
    }
  };

  // PDF: draw a box by hand.
  pointerDown = (page, event) => {
    if (event.button) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    this.draft = { page: page.index, ox: x, oy: y, x, y, w: 0, h: 0 };
  };

  pointerMove = (event) => {
    if (!this.draft) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / rect.width),
    );
    const y = Math.min(
      1,
      Math.max(0, (event.clientY - rect.top) / rect.height),
    );
    const { ox, oy } = this.draft;
    this.draft = {
      ...this.draft,
      x: Math.min(ox, x),
      y: Math.min(oy, y),
      w: Math.abs(x - ox),
      h: Math.abs(y - oy),
    };
  };

  pointerUp = () => {
    const d = this.draft;
    this.draft = null;
    if (!d || d.w < 0.003 || d.h < 0.003) return;
    this.pages = this.pages.map((p) =>
      p.index === d.page
        ? {
            ...p,
            boxes: [
              ...p.boxes,
              { id: nextId++, x: d.x, y: d.y, w: d.w, h: d.h },
            ],
          }
        : p,
    );
    this.clearResult();
  };

  removeBox = (page, id, event) => {
    event.stopPropagation();
    this.pages = this.pages.map((p) =>
      p.index === page.index
        ? { ...p, boxes: p.boxes.filter((b) => b.id !== id) }
        : p,
    );
    this.clearResult();
  };

  draftFor = (page) => (this.draft?.page === page.index ? this.draft : null);

  // DOCX: click a word to toggle it; the paragraph button takes the lot.
  toggleWord = (paragraph, index) => {
    this.paragraphs = this.paragraphs.map((p) =>
      p.id === paragraph.id
        ? {
            ...p,
            words: p.words.map((w, i) =>
              i === index && w.text.trim() ? { ...w, hit: !w.hit } : w,
            ),
          }
        : p,
    );
    this.clearResult();
  };

  toggleParagraph = (paragraph) => {
    const all = paragraph.words.every((w) => w.hit || !w.text.trim());
    this.paragraphs = this.paragraphs.map((p) =>
      p.id === paragraph.id
        ? {
            ...p,
            words: p.words.map((w) => ({
              ...w,
              hit: w.text.trim() ? !all : false,
            })),
          }
        : p,
    );
    this.clearResult();
  };

  clearMarks = () => {
    this.pages = this.pages.map((p) => ({ ...p, boxes: [] }));
    this.paragraphs = this.paragraphs.map((p) => ({
      ...p,
      words: p.words.map((w) => ({ ...w, hit: false })),
    }));
    this.found = 0;
    this.clearResult();
  };

  clearResult() {
    if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
    this.resultUrl = null;
  }

  save = async () => {
    if (!this.canSave) return;
    this.busy = true;
    this.error = null;
    this.progress = 0;
    try {
      let blob;
      if (this.isPdf) {
        this.status = 'Flattening the pages…';
        const boxes = this.pages.map((p) => p.boxes);
        blob = await burnPdf(this.doc, boxes, {
          onProgress: (p) => (this.progress = p),
        });
      } else {
        this.status = 'Rewriting the document…';
        const targets = this.paragraphs
          .filter((p) => p.words.some((w) => w.hit))
          .map((p) => ({
            id: p.id,
            ranges: p.words
              .filter((w) => w.hit)
              .map((w) => [w.from, w.from + w.text.length]),
          }));
        redactDocx(this.docx, targets);
        blob = await saveDocx(this.docx);
        // The XML is changed in place; open the file again for another round.
        this.docx = await openDocx(new File([blob], this.file.name));
      }
      this.clearResult();
      this.resultUrl = URL.createObjectURL(blob);
      this.resultSize = blob.size;
    } catch (error) {
      this.error = error?.message ?? 'Couldn’t write the file';
    } finally {
      this.busy = false;
      this.status = '';
    }
  };

  reset = () => {
    this.clearUrls();
    this.file = this.doc = this.docx = null;
    this.kind = null;
    this.pages = [];
    this.paragraphs = [];
    this.resultUrl = null;
    this.error = null;
    this.found = 0;
  };

  <template>
    {{! template-lint-disable no-pointer-down-event-binding }}
    <ToolPage
      @route="document-redacter"
      @busy={{this.pipBusy}}
      @closeWarning={{this.pipWarning}}
      @subtitle="Black out names, numbers and whole passages in a PDF or Word file so they're really gone: not hidden under a box, but removed from the file. Search for a word to catch every copy, or draw the boxes yourself."
    >
      <div class="fs" {{acceptPastedFiles this.pasteFiles}}>
        {{#if this.file}}
          <div class="fs-frame fc-panel pop-in">
            <div class="fc-toolbar">
              <span class="tool-hint">{{this.file.name}}
                ·
                {{formatBytes this.file.size}}
                {{#if this.isPdf}}· {{this.pages.length}} pages{{else}}·
                  {{this.paragraphs.length}}
                  paragraphs{{/if}}</span>
              <div class="settings-actions">
                <button
                  type="button"
                  class="btn active"
                  disabled={{this.cannotSave}}
                  {{on "click" this.save}}
                >{{if this.busy "Working…" "Redact and save"}}</button>
                {{#if this.resultUrl}}
                  <a
                    class="btn fs-save"
                    href={{this.resultUrl}}
                    download={{this.resultName}}
                  ><Icon @name="download" @size={{13}} />
                    Save ({{formatBytes this.resultSize}})</a>
                {{/if}}
                <button
                  type="button"
                  class="btn"
                  {{on "click" this.reset}}
                >Another file</button>
              </div>
            </div>
            <div class="fc-toolbar">
              <div class="dr-search">
                <input
                  type="search"
                  class="math-input"
                  placeholder="Find text to black out everywhere…"
                  aria-label="Find text"
                  value={{this.query}}
                  {{on "input" this.setQuery}}
                  {{on "keydown" this.enterFinds}}
                />
                <button
                  type="button"
                  class="btn"
                  {{on "click" this.findAll}}
                >Find all</button>
                {{#if this.found}}<span class="tool-hint">{{this.found}}
                    found</span>{{/if}}
              </div>
              <div class="settings-actions">
                <span class="tool-hint">{{this.markCount}} marked</span>
                <button
                  type="button"
                  class="btn"
                  disabled={{this.noMarks}}
                  {{on "click" this.clearMarks}}
                >Clear marks</button>
              </div>
            </div>
            {{#if this.busy}}
              <div class="fs-progress"><div
                  class="fs-progress-bar"
                  style={{progressWidth this.progress}}
                ></div></div>
              <p class="tool-hint">{{this.status}}</p>
            {{/if}}
            {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
            <p class="tool-hint">
              {{#if this.isPdf}}
                Drag on a page to draw a box; click a box to remove it. The
                saved PDF is made of flattened page images, so there is no text
                underneath to select or copy.
              {{else}}
                Click a word to black it out, or the ¶ button to take the whole
                paragraph. The words are replaced inside the file itself.
                Pictures and tracked changes are left as they are.
              {{/if}}
            </p>
          </div>

          {{#if this.isPdf}}
            <div class="dr-pages">
              {{#each this.pages key="index" as |page|}}
                <div
                  class="dr-page"
                  style={{htmlSafe
                    (concat "aspect-ratio:" page.width "/" page.height)
                  }}
                  {{on "pointerdown" (fn this.pointerDown page)}}
                  {{on "pointermove" this.pointerMove}}
                  {{on "pointerup" this.pointerUp}}
                  {{on "pointercancel" this.pointerUp}}
                >
                  <img
                    src={{page.url}}
                    alt="Page {{page.number}}"
                    draggable="false"
                  />
                  {{#each page.boxes key="id" as |box|}}
                    <button
                      type="button"
                      class="dr-box"
                      style={{boxStyle box}}
                      title="Remove this box"
                      aria-label="Remove this box"
                      {{on "pointerdown" (fn this.removeBox page box.id)}}
                    ></button>
                  {{/each}}
                  {{#let (this.draftFor page) as |d|}}
                    {{#if d}}<div
                        class="dr-box is-draft"
                        style={{boxStyle d}}
                      ></div>{{/if}}
                  {{/let}}
                  <span class="dr-page-number">{{page.number}}</span>
                </div>
              {{/each}}
            </div>
          {{else}}
            <div class="dr-doc">
              {{#each this.paragraphs key="id" as |para|}}
                <div class="dr-para">
                  <button
                    type="button"
                    class="dr-para-all"
                    title="Black out the whole paragraph"
                    aria-label="Black out the whole paragraph"
                    {{on "click" (fn this.toggleParagraph para)}}
                  >¶</button>
                  <p>
                    {{#each para.words as |w index|}}
                      {{#if w.blank}}{{w.text}}{{else}}<button
                          type="button"
                          class="dr-word {{if w.hit 'is-hit'}}"
                          {{on "click" (fn this.toggleWord para index)}}
                        >{{w.text}}</button>{{/if}}
                    {{/each}}
                  </p>
                </div>
              {{/each}}
            </div>
          {{/if}}
        {{else}}
          <label
            class="qr-drop fs-drop {{if this.dragging 'is-dragging'}}"
            {{on "dragover" this.dragOver}}
            {{on "dragleave" this.dragOver}}
            {{on "drop" this.drop}}
          >
            <Icon @name="highlighter" @size={{22}} />
            <span>{{if
                this.dragging
                "Drop it here"
                "Drop a PDF or a Word (.docx) file, or click to browse"
              }}</span>
            <input
              type="file"
              accept=".pdf,.docx,application/pdf"
              class="sr-only"
              {{on "change" this.selectFile}}
            />
          </label>
          {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
        {{/if}}
      </div>
    </ToolPage>
  </template>
}
