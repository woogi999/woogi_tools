<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import { formatBytes } from '../utils/file-share.js';
  import { acceptPastedFiles } from '../utils/paste-files.js';
  import PrintButton from './print-button.svelte';

  const FORMATS = [
    { id: 'same', label: 'Same as original' },
    { id: 'image/jpeg', label: 'JPEG', ext: 'jpg' },
    { id: 'image/webp', label: 'WEBP', ext: 'webp' },
    { id: 'image/png', label: 'PNG', ext: 'png' },
  ];
  const ENCODABLE = {
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/png': 'png',
  };
  const eq = (a, b) => a === b;

  let nextId = 1;

  async function decode(file) {
    try {
      return await createImageBitmap(file);
    } catch {
      throw new Error(
        "This browser can't open that image. Try the File Converter for HEIC, RAW and other formats.",
      );
    }
  }

  function targetSize(width, height, { mode, maxWidth, maxHeight, percent }) {
    if (mode === 'percent') {
      const scale = Math.max(1, percent) / 100;
      return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
      };
    }
    // "Fit within" never enlarges and always keeps the aspect ratio.
    const scale = Math.min(
      1,
      maxWidth > 0 ? maxWidth / width : 1,
      maxHeight > 0 ? maxHeight / height : 1,
    );
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
  }

  async function resize(file, options) {
    const bitmap = await decode(file);
    const { width, height } = targetSize(bitmap.width, bitmap.height, options);
    const type =
      options.format === 'same'
        ? ENCODABLE[file.type]
          ? file.type
          : 'image/png'
        : options.format;
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
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Encoding failed'))),
        type,
        options.quality / 100,
      ),
    );
    const base = file.name.replace(/\.[^.]+$/, '');
    return {
      blob,
      name: `${base}-${width}x${height}.${ENCODABLE[type]}`,
      original,
      width,
      height,
    };
  }

  class ImageResizerPage extends Component {
    // While this is true, leaving the page floats the tool in a PiP window
    // instead of tearing it down, so the work carries on (see services/pip.js).
    get pipBusy() {
      return this.busy;
    }

    get pipWarning() {
      return 'Close the Image Resizer? The resize in progress will be cancelled.';
    }
    formats = FORMATS;

    items = $state.raw([]);
    mode = $state.raw('fit');
    maxWidth = $state.raw(1920);
    maxHeight = $state.raw(1920);
    percent = $state.raw(50);
    format = $state.raw('image/jpeg');
    quality = $state.raw(82);
    busy = $state.raw(false);
    dragging = $state.raw(false);
    zipUrl = $state.raw(null);

    constructor(args) {
      super(args);
      registerDestructor(this, () => this.revokeAll());
    }

    get options() {
      return {
        mode: this.mode,
        maxWidth: this.maxWidth,
        maxHeight: this.maxHeight,
        percent: this.percent,
        format: this.format,
        quality: this.quality,
      };
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
      for (const item of this.items)
        if (item.url) URL.revokeObjectURL(item.url);
      if (this.zipUrl) URL.revokeObjectURL(this.zipUrl);
    }

    // Any settings change invalidates previous results.
    resetResults() {
      for (const item of this.items)
        if (item.url) URL.revokeObjectURL(item.url);
      if (this.zipUrl) URL.revokeObjectURL(this.zipUrl);
      this.zipUrl = null;
      this.items = this.items.map((i) => ({
        ...i,
        url: null,
        size: null,
        name: null,
        dims: null,
        error: null,
      }));
    }

    addFiles(list) {
      const images = [...list].filter((f) => f.type.startsWith('image/'));
      if (!images.length) return;
      this.resetResults();
      this.items = [
        ...this.items,
        ...images.map((file) => ({
          id: nextId++,
          file,
          url: null,
          size: null,
          name: null,
          dims: null,
          error: null,
        })),
      ];
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
      this[key] = ['maxWidth', 'maxHeight', 'percent', 'quality'].includes(key)
        ? Math.max(0, Math.floor(+raw) || 0)
        : raw;
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
          this.items = this.items.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  url: URL.createObjectURL(out.blob),
                  blob: out.blob,
                  size: out.blob.size,
                  name: out.name,
                  dims: `${out.original.width}×${out.original.height} → ${out.width}×${out.height}`,
                }
              : i,
          );
        } catch (error) {
          this.items = this.items.map((i) =>
            i.id === item.id ? { ...i, error: error.message } : i,
          );
        }
      }
      if (this.doneItems.length > 1) {
        const { zipSync } = await import('fflate');
        const entries = {};
        for (const item of this.doneItems)
          entries[item.name] = new Uint8Array(await item.blob.arrayBuffer());
        this.zipUrl = URL.createObjectURL(
          new Blob([zipSync(entries, { level: 0 })], {
            type: 'application/zip',
          }),
        );
      }
      this.busy = false;
    };

    pasteFiles = (files) => this.addFiles(files);
  }
</script>

<script>
  let args = $props();
  const self = new ImageResizerPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="image-resizer"
  busy={self.pipBusy}
  closeWarning={self.pipWarning}
  subtitle="Drop in your images, pick a size and quality, and download them smaller. Works on lots at once."
>
  <div class="fs" {@attach acceptPastedFiles([self.pasteFiles])}>
    <div class="fs-frame fc-panel pop-in">
      <label
        class="qr-drop fs-drop {truthy(self.dragging) ? 'is-dragging' : ''}"
        ondrop={self.drop}
        ondragleave={self.dragOver}
        ondragover={self.dragOver}
      >
        <Icon name="image" size={22} />
        <span>Drop images, or click to browse</span>
        <input
          type="file"
          accept="image/*"
          multiple
          class="sr-only"
          onchange={self.selectFiles}
        />
      </label>

      <div class="math-tabs" role="group" aria-label="Resize by">
        <button
          type="button"
          class="qr-tab {truthy(eq(self.mode, 'fit')) ? 'active' : ''}"
          onclick={(..._r) => self.setMode('fit', ..._r)}
          >Fit within size</button
        >
        <button
          type="button"
          class="qr-tab {truthy(eq(self.mode, 'percent')) ? 'active' : ''}"
          onclick={(..._r) => self.setMode('percent', ..._r)}>Percentage</button
        >
      </div>
      <div class="math-row">
        {#if truthy(eq(self.mode, 'fit'))}
          <label class="math-field"
            ><span class="qr-label is-muted">Max width (px)</span><input
              type="number"
              min="0"
              class="math-input"
              {@attach prop('value', () => self.maxWidth)}
              oninput={(..._r) => self.setting('maxWidth', ..._r)}
            /></label
          >
          <label class="math-field"
            ><span class="qr-label is-muted">Max height (px)</span><input
              type="number"
              min="0"
              class="math-input"
              {@attach prop('value', () => self.maxHeight)}
              oninput={(..._r) => self.setting('maxHeight', ..._r)}
            /></label
          >
        {:else}
          <label class="math-field"
            ><span class="qr-label is-muted">Scale (%)</span><input
              type="number"
              min="1"
              max="400"
              class="math-input"
              {@attach prop('value', () => self.percent)}
              oninput={(..._r) => self.setting('percent', ..._r)}
            /></label
          >
        {/if}
        <label class="math-field">
          <span class="qr-label is-muted">Format</span>
          <select
            class="select"
            onchange={(..._r) => self.setting('format', ..._r)}
          >
            {#each self.formats ?? [] as f}
              <option
                value={f?.id}
                {@attach prop('selected', () => eq(self.format, f?.id))}
                >{f?.label}</option
              >
            {/each}
          </select>
        </label>
      </div>
      {#if truthy(self.usesQuality)}
        <label class="math-field">
          <span class="qr-label is-muted">Quality: {self.quality}</span>
          <input
            type="range"
            min="10"
            max="100"
            {@attach prop('value', () => self.quality)}
            oninput={(..._r) => self.setting('quality', ..._r)}
          />
        </label>
      {/if}
      <p class="tool-hint"
        >{truthy(eq(self.mode, 'fit'))
          ? 'Images already smaller than the box keep their size, and proportions are always kept.'
          : 'Scales width and height by the same amount.'}</p
      >
    </div>

    {#if truthy(self.items?.length)}
      <div class="fs-frame fc-panel pop-in">
        <div class="fc-toolbar">
          <div class="settings-actions">
            <button
              type="button"
              class="btn active"
              disabled={self.busy}
              onclick={self.run}
              >{truthy(self.busy) ? 'Working…' : 'Resize'}</button
            >
            {#if truthy(self.zipUrl)}<a
                class="btn fs-save"
                href={self.zipUrl}
                download="resized-images.zip"
                ><Icon name="download" size={13} />
                Save all (ZIP)</a
              >{/if}
            <button type="button" class="btn" onclick={self.clear}>Clear</button
            >
          </div>
          {#if truthy(self.savings)}<span class="tool-hint">{self.savings}</span
            >{/if}
        </div>
        <ul class="fs-list">
          {#each self.items ?? [] as item (item?.id)}
            <li class="fs-row fc-row">
              <Icon name="image" size={16} />
              <div class="fs-row-info">
                <span class="fs-row-name">{item?.file?.name}</span>
                <span class="fs-row-size"
                  >{formatBytes(item?.file?.size)}{#if truthy(item?.size)}
                    →
                    {formatBytes(item?.size)}
                    ·
                    {item?.dims}{/if}</span
                >
                {#if truthy(item?.error)}<span class="tool-error"
                    >{item?.error}</span
                  >{/if}
              </div>
              <div class="fs-row-status">
                {#if truthy(item?.url)}<a
                    class="btn fs-save"
                    href={item?.url}
                    download={item?.name}
                    ><Icon name="download" size={13} />
                    Save</a
                  ><PrintButton url={item?.url} name={item?.name} />{/if}
              </div>
              <button
                type="button"
                class="fs-remove"
                aria-label="Remove {item?.file?.name}"
                onclick={(..._r) => self.remove(item?.id, ..._r)}
                ><Icon name="x" size={13} /></button
              >
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>
</ToolPage>
