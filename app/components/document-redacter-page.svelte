<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { truthy, on, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import { acceptPastedFiles } from '../utils/paste-files.js';
  import { formatBytes } from '../utils/file-share.js';
  import {
    openPdf,
    renderPage,
    findOnPage,
    burnPdf,
    openDocx,
    docxParagraphs,
    redactDocx,
    saveDocx,
  } from '../utils/redact.js';

  // Blacks out the parts of a PDF or Word file that must not get out, for real:
  // the PDF is flattened to pictures with the bars painted on, and the Word
  // file has the words themselves replaced in its XML. Nothing to select,
  // copy, or peel back.

  const PREVIEW_SCALE = 1.25;
  const progressWidth = (p) => `width:${Math.round((p ?? 0) * 100)}%`;
  const boxStyle = (b) =>
    `left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%`;
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
      words.push({
        text: m[0],
        from: m.index,
        hit: false,
        blank: !m[0].trim(),
      });
    return words;
  }

  class DocumentRedacterPage extends Component {
    get pipBusy() {
      return this.busy;
    }

    get pipWarning() {
      return 'Close the Document Redacter? The file being written will be lost.';
    }
    file = $state.raw(null);
    kind = $state.raw(null); // 'pdf' | 'docx'
    pages = $state.raw([]); // pdf: { index, url, width, height, boxes: [] }
    paragraphs = $state.raw([]); // docx: { id, text, words: [{ text, hit }] }
    query = $state.raw('');
    found = $state.raw(0);
    draft = $state.raw(null);
    dragging = $state.raw(false);
    busy = $state.raw(false);
    status = $state.raw('');
    progress = $state.raw(0);
    error = $state.raw(null);
    resultUrl = $state.raw(null);
    resultSize = $state.raw(0);

    doc = null;
    docx = null;

    constructor(args) {
      super(args);
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
            boxes: [
              ...page.boxes,
              ...boxes.map((b) => ({ ...b, id: nextId++ })),
            ],
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
  }
</script>

<script>
  let args = $props();
  const self = new DocumentRedacterPage(args);
  onDestroy(() => destroy(self));
</script>

<!-- template-lint-disable no-pointer-down-event-binding -->
<ToolPage
  route="document-redacter"
  busy={self.pipBusy}
  closeWarning={self.pipWarning}
  subtitle="Black out names, numbers and whole passages in a PDF or Word file so they're really gone: not hidden under a box, but removed from the file. Search for a word to catch every copy, or draw the boxes yourself."
>
  <div class="fs" {@attach acceptPastedFiles([self.pasteFiles])}>
    {#if truthy(self.file)}
      <div class="fs-frame fc-panel pop-in">
        <div class="fc-toolbar">
          <span class="tool-hint"
            >{self.file?.name}
            ·
            {formatBytes(self.file?.size)}
            {#if truthy(self.isPdf)}· {self.pages?.length} pages{:else}·
              {self.paragraphs?.length}
              paragraphs{/if}</span
          >
          <div class="settings-actions">
            <button
              type="button"
              class="btn active"
              disabled={self.cannotSave}
              onclick={self.save}
              >{truthy(self.busy) ? 'Working…' : 'Redact and save'}</button
            >
            {#if truthy(self.resultUrl)}
              <a
                class="btn fs-save"
                href={self.resultUrl}
                download={self.resultName}
                ><Icon name="download" size={13} />
                Save ({formatBytes(self.resultSize)})</a
              >
            {/if}
            <button type="button" class="btn" onclick={self.reset}
              >Another file</button
            >
          </div>
        </div>
        <div class="fc-toolbar">
          <div class="dr-search">
            <input
              type="search"
              class="math-input"
              placeholder="Find text to black out everywhere…"
              aria-label="Find text"
              {@attach prop('value', () => self.query)}
              onkeydown={self.enterFinds}
              oninput={self.setQuery}
            />
            <button type="button" class="btn" onclick={self.findAll}
              >Find all</button
            >
            {#if truthy(self.found)}<span class="tool-hint"
                >{self.found}
                found</span
              >{/if}
          </div>
          <div class="settings-actions">
            <span class="tool-hint">{self.markCount} marked</span>
            <button
              type="button"
              class="btn"
              disabled={self.noMarks}
              onclick={self.clearMarks}>Clear marks</button
            >
          </div>
        </div>
        {#if truthy(self.busy)}
          <div class="fs-progress"
            ><div class="fs-progress-bar" style={progressWidth(self.progress)}
            ></div></div
          >
          <p class="tool-hint">{self.status}</p>
        {/if}
        {#if truthy(self.error)}<p class="tool-error">{self.error}</p>{/if}
        <p class="tool-hint">
          {#if truthy(self.isPdf)}
            Drag on a page to draw a box; click a box to remove it. The saved
            PDF is made of flattened page images, so there is no text underneath
            to select or copy.
          {:else}
            Click a word to black it out, or the ¶ button to take the whole
            paragraph. The words are replaced inside the file itself. Pictures
            and tracked changes are left as they are.
          {/if}
        </p>
      </div>

      {#if truthy(self.isPdf)}
        <div class="dr-pages">
          {#each self.pages ?? [] as page}
            <div
              class="dr-page"
              style={concat('aspect-ratio:', page?.width, '/', page?.height)}
              onpointercancel={self.pointerUp}
              onpointerup={self.pointerUp}
              onpointermove={self.pointerMove}
              onpointerdown={(..._r) => self.pointerDown(page, ..._r)}
            >
              <img
                src={page?.url}
                alt="Page {page?.number}"
                draggable="false"
              />
              {#each page?.boxes ?? [] as box (box?.id)}
                <button
                  type="button"
                  class="dr-box"
                  style={boxStyle(box)}
                  title="Remove this box"
                  aria-label="Remove this box"
                  {@attach on('pointerdown', (..._r) =>
                    self.removeBox(page, box?.id, ..._r),
                  )}
                ></button>
              {/each}
              {#if true}{@const d = self.draftFor(page)}
                {#if truthy(d)}<div class="dr-box is-draft" style={boxStyle(d)}
                  ></div>{/if}
              {/if}
              <span class="dr-page-number">{page?.number}</span>
            </div>
          {/each}
        </div>
      {:else}
        <div class="dr-doc">
          {#each self.paragraphs ?? [] as para (para?.id)}
            <div class="dr-para">
              <button
                type="button"
                class="dr-para-all"
                title="Black out the whole paragraph"
                aria-label="Black out the whole paragraph"
                onclick={(..._r) => self.toggleParagraph(para, ..._r)}>¶</button
              >
              <p>
                {#each para?.words ?? [] as w, index}
                  {#if truthy(w?.blank)}{w?.text}{:else}<button
                      type="button"
                      class="dr-word {truthy(w?.hit) ? 'is-hit' : ''}"
                      onclick={(..._r) => self.toggleWord(para, index, ..._r)}
                      >{w?.text}</button
                    >{/if}
                {/each}
              </p>
            </div>
          {/each}
        </div>
      {/if}
    {:else}
      <label
        class="qr-drop fs-drop {truthy(self.dragging) ? 'is-dragging' : ''}"
        ondrop={self.drop}
        ondragleave={self.dragOver}
        ondragover={self.dragOver}
      >
        <Icon name="highlighter" size={22} />
        <span
          >{truthy(self.dragging)
            ? 'Drop it here'
            : 'Drop a PDF or a Word (.docx) file, or click to browse'}</span
        >
        <input
          type="file"
          accept=".pdf,.docx,application/pdf"
          class="sr-only"
          onchange={self.selectFile}
        />
      </label>
      {#if truthy(self.error)}<p class="tool-error">{self.error}</p>{/if}
    {/if}
  </div>
</ToolPage>
