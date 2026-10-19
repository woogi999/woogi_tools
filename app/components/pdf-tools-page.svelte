<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import { formatBytes } from '../utils/file-share.js';
  import { parsePageRanges } from '../utils/page-ranges.js';
  import { acceptPastedFiles } from '../utils/paste-files.js';
  import PrintButton from './print-button.svelte';

  const eq = (a, b) => a === b;
  // The pre-bundled build inlines its font data, which Vite's dev optimizer can't parse from the raw package.
  const loadPdfLib = () => import('pdf-lib/dist/pdf-lib.esm.min.js');

  let nextId = 1;

  async function readPdf(file) {
    const { PDFDocument } = await loadPdfLib();
    try {
      return await PDFDocument.load(await file.arrayBuffer());
    } catch (error) {
      throw new Error(
        /encrypt/i.test(error.message)
          ? `${file.name} is password-protected`
          : `${file.name} isn't a readable PDF`,
      );
    }
  }

  class PdfToolsPage extends Component {
    // While this is true, leaving the page floats the tool in a PiP window
    // instead of tearing it down, so the work carries on (see services/pip.js).
    get pipBusy() {
      return this.busy;
    }

    get pipWarning() {
      return 'Close PDF Tools? The job in progress will be cancelled.';
    }
    mode = $state.raw('merge');
    files = $state.raw([]);
    splitHow = $state.raw('every');
    splitRanges = $state.raw('1-2, 3-');
    busy = $state.raw(false);
    error = $state.raw('');
    result = $state.raw(null);
    dragging = $state.raw(false);

    constructor(args) {
      super(args);
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
      if (this.splitHow === 'every')
        return { text: `${file.pages} separate PDFs`, many: file.pages > 1 };
      const parsed = parsePageRanges(this.splitRanges, file.pages);
      if (parsed.error) return { error: parsed.error };
      return {
        text:
          parsed.groups.length === 1
            ? `1 PDF with ${parsed.groups[0].length} pages`
            : `${parsed.groups.length} PDFs`,
        many: parsed.groups.length > 1,
      };
    }

    get canRun() {
      if (this.busy) return false;
      if (this.isMerge)
        return (
          this.files.length > 0 &&
          this.files.every((f) => f.pages && !f.rangeError)
        );
      return Boolean(this.splitFile?.pages && !this.splitPreview?.error);
    }

    clearResult() {
      if (this.result?.url) URL.revokeObjectURL(this.result.url);
      this.result = null;
    }

    update(id, patch) {
      this.files = this.files.map((f) =>
        f.id === id ? { ...f, ...patch } : f,
      );
    }

    async addFiles(list) {
      const pdfs = [...list].filter(
        (f) =>
          f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
      );
      if (!pdfs.length) {
        this.error = 'Only PDF files can be added here.';
        return;
      }
      this.error = '';
      this.clearResult();
      const added = pdfs.map((file) => ({
        id: nextId++,
        file,
        name: file.name,
        size: file.size,
        pages: null,
        range: '',
        rangeError: null,
        loadError: null,
      }));
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
      this.update(id, {
        range,
        rangeError: file.pages
          ? (parsePageRanges(range, file.pages).error ?? null)
          : null,
      });
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
        const { blob, name } = this.isMerge
          ? await this.merge()
          : await this.split();
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
      const name =
        this.files.length === 1
          ? this.files[0].name.replace(/\.pdf$/i, '-pages.pdf')
          : 'merged.pdf';
      const bytes = await out.save();
      return { blob: new Blob([bytes], { type: 'application/pdf' }), name };
    }

    async split() {
      const { PDFDocument } = await loadPdfLib();
      const entry = this.splitFile;
      const doc = await readPdf(entry.file);
      const count = doc.getPageCount();
      const groups =
        this.splitHow === 'every'
          ? Array.from({ length: count }, (_, i) => [i])
          : parsePageRanges(this.splitRanges, count).groups;
      const base = entry.name.replace(/\.pdf$/i, '');
      const parts = [];
      for (const group of groups) {
        const part = await PDFDocument.create();
        for (const page of await part.copyPages(doc, group)) part.addPage(page);
        const label =
          group.length === 1
            ? `page-${group[0] + 1}`
            : `pages-${group[0] + 1}-${group.at(-1) + 1}`;
        parts.push({ name: `${base}-${label}.pdf`, bytes: await part.save() });
      }
      if (parts.length === 1)
        return {
          blob: new Blob([parts[0].bytes], { type: 'application/pdf' }),
          name: parts[0].name,
        };
      const { zipSync } = await import('fflate');
      const zip = zipSync(
        Object.fromEntries(parts.map((p) => [p.name, p.bytes])),
        { level: 0 },
      );
      return {
        blob: new Blob([zip], { type: 'application/zip' }),
        name: `${base}-split.zip`,
      };
    }

    pasteFiles = (files) => this.addFiles(files);
  }

  function concatPages(n) {
    return `${n} page${n === 1 ? '' : 's'}`;
  }
</script>

<script>
  let args = $props();
  const self = new PdfToolsPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="pdf-tools"
  busy={self.pipBusy}
  closeWarning={self.pipWarning}
  subtitle="Merge PDFs, pick just the pages you need, or split one into several files. Your files never leave your device."
>
  <div class="fs" {@attach acceptPastedFiles([self.pasteFiles])}>
    <div class="fs-frame fc-panel pop-in">
      <div class="math-tabs" role="group" aria-label="Mode">
        <button
          type="button"
          class="qr-tab {truthy(self.isMerge) ? 'active' : ''}"
          onclick={(..._r) => self.setMode('merge', ..._r)}>Merge</button
        >
        <button
          type="button"
          class="qr-tab {!truthy(self.isMerge) ? 'active' : ''}"
          onclick={(..._r) => self.setMode('split', ..._r)}>Split</button
        >
      </div>
      <label
        class="qr-drop fs-drop {truthy(self.dragging) ? 'is-dragging' : ''}"
        ondrop={self.drop}
        ondragleave={self.dragOver}
        ondragover={self.dragOver}
      >
        <Icon name="upload" size={22} />
        <span
          >{truthy(self.isMerge)
            ? 'Drop PDFs to combine, or click to browse'
            : 'Drop a PDF to split, or click to browse'}</span
        >
        <input
          type="file"
          accept="application/pdf,.pdf"
          multiple={self.isMerge}
          class="sr-only"
          onchange={self.selectFiles}
        />
      </label>
      {#if truthy(self.error)}<p class="tool-error">{self.error}</p>{/if}
    </div>

    {#if truthy(self.files?.length)}
      <div class="fs-frame fc-panel pop-in">
        <ul class="fs-list">
          {#each self.files ?? [] as f, index (f?.id)}
            <li class="fs-row fc-row">
              <Icon name="file-text" size={16} />
              <div class="fs-row-info">
                <span class="fs-row-name">{f?.name}</span>
                <span class="fs-row-size"
                  >{formatBytes(f?.size)}
                  ·
                  {truthy(f?.pages) ? concatPages(f?.pages) : 'reading…'}</span
                >
                {#if truthy(f?.loadError)}<span class="tool-error"
                    >{f?.loadError}</span
                  >{/if}
                {#if truthy(f?.rangeError)}<span class="tool-error"
                    >{f?.rangeError}</span
                  >{/if}
              </div>
              {#if truthy(self.isMerge)}
                <div class="fs-row-status">
                  <input
                    type="text"
                    class="math-input pdf-range"
                    placeholder="All pages"
                    aria-label="Pages to include from {f?.name}"
                    {@attach prop('value', () => f?.range)}
                    oninput={(..._r) => self.setRange(f?.id, ..._r)}
                  />
                  <button
                    type="button"
                    class="btn"
                    aria-label="Move {f?.name} up"
                    disabled={eq(index, 0)}
                    onclick={(..._r) => self.move(f?.id, -1, ..._r)}>↑</button
                  >
                  <button
                    type="button"
                    class="btn"
                    aria-label="Move {f?.name} down"
                    onclick={(..._r) => self.move(f?.id, 1, ..._r)}>↓</button
                  >
                </div>
              {/if}
              <button
                type="button"
                class="fs-remove"
                aria-label="Remove {f?.name}"
                onclick={(..._r) => self.remove(f?.id, ..._r)}
                ><Icon name="x" size={13} /></button
              >
            </li>
          {/each}
        </ul>

        {#if truthy(self.isMerge)}
          <p class="tool-hint"
            >Pages are added in list order. Leave a range empty for every page,
            or type something like 1-3, 5, 9-.</p
          >
        {:else}
          <div class="math-tabs" role="group" aria-label="How to split">
            <button
              type="button"
              class="qr-tab {truthy(eq(self.splitHow, 'every'))
                ? 'active'
                : ''}"
              onclick={(..._r) => self.setSplitHow('every', ..._r)}
              >Every page</button
            >
            <button
              type="button"
              class="qr-tab {truthy(eq(self.splitHow, 'ranges'))
                ? 'active'
                : ''}"
              onclick={(..._r) => self.setSplitHow('ranges', ..._r)}
              >By ranges</button
            >
          </div>
          {#if truthy(eq(self.splitHow, 'ranges'))}
            <label class="math-field">
              <span class="qr-label is-muted"
                >Ranges (each becomes its own PDF)</span
              >
              <input
                type="text"
                class="math-input"
                {@attach prop('value', () => self.splitRanges)}
                oninput={self.setSplitRanges}
              />
            </label>
          {/if}
          {#if truthy(self.splitPreview?.error)}
            <p class="tool-error">{self.splitPreview?.error}</p>
          {:else if truthy(self.splitPreview)}
            <p class="tool-hint"
              >Makes
              {self.splitPreview?.text}{truthy(self.splitPreview?.many)
                ? ', bundled in a ZIP'
                : ''}.</p
            >
          {/if}
        {/if}

        <div class="settings-actions">
          <button
            type="button"
            class="btn active"
            disabled={truthy(self.canRun) ? false : true}
            onclick={self.run}
            >{truthy(self.busy)
              ? 'Working…'
              : truthy(self.isMerge)
                ? 'Merge PDFs'
                : 'Split PDF'}</button
          >
          {#if truthy(self.result)}
            <a
              class="btn fs-save"
              href={self.result?.url}
              download={self.result?.name}
              ><Icon name="download" size={13} />
              Save
              {self.result?.name}
              ({formatBytes(self.result?.size)})</a
            >
            <PrintButton url={self.result?.url} name={self.result?.name} />
          {/if}
        </div>
      </div>
    {/if}
  </div>
</ToolPage>
