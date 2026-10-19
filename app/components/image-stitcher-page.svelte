<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import PrintButton from './print-button.svelte';
  import ColourField from './colour-field.svelte';
  import { acceptPastedFiles } from '../utils/paste-files.js';
  import { formatBytes } from '../utils/file-share.js';
  import {
    loadImage,
    planSheet,
    drawSheet,
    canvasBlob,
    FITS,
    LAYOUTS,
  } from '../utils/stitch.js';

  // Sticks a pile of images together into one sheet: a spritesheet for a game, a
  // flipbook strip, or a plain contact sheet. Everything is drawn on a canvas here.

  const FORMATS = [
    { id: 'image/png', label: 'PNG (keeps transparency)', ext: 'png' },
    { id: 'image/webp', label: 'WebP', ext: 'webp' },
    { id: 'image/jpeg', label: 'JPEG', ext: 'jpg' },
  ];
  const eq = (a, b) => a === b;
  let nextId = 1;

  class ImageStitcherPage extends Component {
    // While this is true, leaving the page floats the tool in a PiP window
    // instead of tearing it down, so the work carries on (see services/pip.js).
    get pipBusy() {
      return this.busy;
    }

    get pipWarning() {
      return 'Close the Image Stitcher? The sheet being built will be lost.';
    }
    items = $state.raw([]);
    dragging = $state.raw(false);
    layout = $state.raw('grid');
    columns = $state.raw(0); // 0: work it out from how many there are
    cellWidth = $state.raw(0); // 0: the biggest image's size
    cellHeight = $state.raw(0);
    gap = $state.raw(0);
    padding = $state.raw(0);
    maxSize = $state.raw(0); // 0: no cap
    fit = $state.raw('contain');
    smooth = $state.raw(false);
    background = $state.raw('transparent');
    bgColor = $state.raw('#ffffff');
    format = $state.raw('image/png');
    quality = $state.raw(92);
    resultUrl = $state.raw(null);
    resultSize = $state.raw(null);
    busy = $state.raw(false);
    error = $state.raw(null);

    fits = FITS;
    layouts = LAYOUTS;
    formats = FORMATS;
    canvas = null;

    constructor(args) {
      super(args);
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

    // "4 across, 3 down · 512×384 · 128×128 a frame": the bit that matters for game dev.
    get planText() {
      const plan = this.plan;
      if (!plan) return '';
      const scaled =
        plan.scale < 1
          ? ` (scaled down from ${plan.width}×${plan.height})`
          : '';
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
          this.items = this.items.map((i) =>
            i.id === item.id ? { ...i, image } : i,
          );
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
    setQuality = (e) =>
      this.pick(
        'quality',
        Math.max(10, Math.min(100, Number(e.target.value) || 92)),
      );
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
      this.items = [...this.items].sort((a, b) =>
        a.file.name.localeCompare(b.file.name, undefined, {
          numeric: true,
          sensitivity: 'base',
        }),
      );
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
        this.error =
          error?.message ?? 'Something went wrong stitching these together';
      } finally {
        this.busy = false;
      }
    };

    get resultName() {
      return `spritesheet.${this.ext}`;
    }
  }
</script>

<script>
  let args = $props();
  const self = new ImageStitcherPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="image-stitcher"
  busy={self.pipBusy}
  closeWarning={self.pipWarning}
  subtitle="Stick images together into one sheet: spritesheets, flipbook frames or a plain grid. Set the columns, the frame size and a size cap."
>
  <div class="fs" {@attach acceptPastedFiles([self.pasteFiles])}>
    <div class="fs-frame fc-panel pop-in">
      <label
        class="qr-drop fs-drop {truthy(self.dragging) ? 'is-dragging' : ''}"
        ondrop={self.drop}
        ondragleave={self.dragOver}
        ondragover={self.dragOver}
      >
        <Icon name="layout-grid" size={22} />
        <span
          >{truthy(self.dragging)
            ? 'Drop them here'
            : 'Drop your frames, paste them, or click to browse'}</span
        >
        <input
          type="file"
          accept="image/*"
          multiple
          class="sr-only"
          onchange={self.selectFiles}
        />
      </label>

      <div class="math-tabs" role="group" aria-label="Layout">
        {#each self.layouts ?? [] as l}
          <button
            type="button"
            class="qr-tab {truthy(eq(self.layout, l?.id)) ? 'active' : ''}"
            onclick={(..._r) => self.pick('layout', l?.id, ..._r)}
            >{l?.label}</button
          >
        {/each}
      </div>

      <div class="math-row">
        {#if truthy(eq(self.layout, 'grid'))}
          <label class="math-field"
            ><span class="qr-label is-muted">Columns (0 = work it out)</span
            ><input
              type="number"
              min="0"
              class="math-input"
              {@attach prop('value', () => self.columns)}
              oninput={(..._r) => self.number('columns', ..._r)}
            /></label
          >
        {/if}
        <label class="math-field"
          ><span class="qr-label is-muted">Frame width (0 = biggest)</span
          ><input
            type="number"
            min="0"
            class="math-input"
            {@attach prop('value', () => self.cellWidth)}
            oninput={(..._r) => self.number('cellWidth', ..._r)}
          /></label
        >
        <label class="math-field"
          ><span class="qr-label is-muted">Frame height (0 = biggest)</span
          ><input
            type="number"
            min="0"
            class="math-input"
            {@attach prop('value', () => self.cellHeight)}
            oninput={(..._r) => self.number('cellHeight', ..._r)}
          /></label
        >
      </div>

      <div class="math-row">
        <label class="math-field"
          ><span class="qr-label is-muted">Gap between frames (px)</span><input
            type="number"
            min="0"
            class="math-input"
            {@attach prop('value', () => self.gap)}
            oninput={(..._r) => self.number('gap', ..._r)}
          /></label
        >
        <label class="math-field"
          ><span class="qr-label is-muted">Edge padding (px)</span><input
            type="number"
            min="0"
            class="math-input"
            {@attach prop('value', () => self.padding)}
            oninput={(..._r) => self.number('padding', ..._r)}
          /></label
        >
        <label class="math-field"
          ><span class="qr-label is-muted">Max sheet size (0 = no cap)</span
          ><input
            type="number"
            min="0"
            class="math-input"
            {@attach prop('value', () => self.maxSize)}
            oninput={(..._r) => self.number('maxSize', ..._r)}
          /></label
        >
      </div>

      <div class="math-row">
        <label class="math-field">
          <span class="qr-label is-muted">How each image sits</span>
          <select class="select" onchange={self.setFit}>
            {#each self.fits ?? [] as f}
              <option
                value={f?.id}
                {@attach prop('selected', () => eq(self.fit, f?.id))}
                >{f?.label}</option
              >
            {/each}
          </select>
        </label>
        <label class="math-field">
          <span class="qr-label is-muted">Save as</span>
          <select class="select" onchange={self.setFormat}>
            {#each self.formats ?? [] as f}
              <option
                value={f?.id}
                {@attach prop('selected', () => eq(self.format, f?.id))}
                >{f?.label}</option
              >
            {/each}
          </select>
        </label>
        {#if truthy(self.usesQuality)}
          <label class="math-field"
            ><span class="qr-label is-muted"
              >Quality:
              {self.quality}</span
            ><input
              type="range"
              min="10"
              max="100"
              {@attach prop('value', () => self.quality)}
              oninput={self.setQuality}
            /></label
          >
        {/if}
      </div>

      <div class="math-tabs" role="group" aria-label="Background">
        <button
          type="button"
          class="qr-tab {truthy(eq(self.background, 'transparent'))
            ? 'active'
            : ''}"
          onclick={(..._r) => self.pick('background', 'transparent', ..._r)}
          >See-through</button
        >
        <button
          type="button"
          class="qr-tab {truthy(eq(self.background, 'colour')) ? 'active' : ''}"
          onclick={(..._r) => self.pick('background', 'colour', ..._r)}
          >A colour</button
        >
      </div>
      {#if truthy(eq(self.background, 'colour'))}
        <ColourField
          label="Background"
          value={self.bgColor}
          onChange={self.setBgColor}
        />
      {/if}

      <label class="lobby-rule is-switch">
        <span class="lobby-rule-text"
          ><span class="qr-label">Smooth when scaling</span><span
            class="tool-hint"
            >Leave this off for pixel art: it keeps the edges hard instead of
            blurring them.</span
          ></span
        >
        <span class="qr-switch">
          <input
            type="checkbox"
            role="switch"
            {@attach prop('checked', () => self.smooth)}
            aria-checked={truthy(self.smooth) ? 'true' : 'false'}
            onchange={self.toggleSmooth}
          />
          <span class="qr-switch-track" aria-hidden="true"></span>
        </span>
      </label>
    </div>

    {#if truthy(self.items?.length)}
      <div class="fs-frame fc-panel pop-in">
        <div class="fc-toolbar">
          <h3 class="qr-heading">The sheet</h3>
          <div class="settings-actions">
            <button
              type="button"
              class="btn active"
              disabled={self.busy}
              onclick={self.stitch}
              >{truthy(self.busy) ? 'Stitching…' : 'Stitch them'}</button
            >
            {#if truthy(self.resultUrl)}
              <a
                class="btn fs-save"
                href={self.resultUrl}
                download={self.resultName}
                ><Icon name="download" size={13} /> Save</a
              >
              <PrintButton url={self.resultUrl} name={self.resultName} />
            {/if}
            <button type="button" class="btn" onclick={self.sortByName}
              >Sort by name</button
            >
            <button type="button" class="btn" onclick={self.clear}>Clear</button
            >
          </div>
        </div>
        <p class="tool-hint"
          >{self.planText}{#if truthy(self.resultSize)}
            ·
            {formatBytes(self.resultSize)}{/if}</p
        >
        {#if truthy(self.error)}<p class="tool-error">{self.error}</p>{/if}
        <div class="stitch-preview"
          ><canvas class="stitch-canvas" {@attach self.preview?.()}
          ></canvas></div
        >

        <ul class="fs-list">
          {#each self.items ?? [] as item, index (item?.id)}
            <li class="fs-row fc-row">
              <span class="stitch-index">{index}</span>
              <div class="fs-row-info">
                <span class="fs-row-name">{item?.file?.name}</span>
                <span class="fs-row-size"
                  >{#if truthy(item?.image)}{item?.image?.width}×{item?.image
                      ?.height}
                    ·
                  {/if}{formatBytes(item?.file?.size)}</span
                >
              </div>
              <div class="fs-row-status">
                <button
                  type="button"
                  class="btn"
                  aria-label="Move {item?.file?.name} earlier"
                  onclick={(..._r) => self.move(item?.id, -1, ..._r)}
                  ><Icon name="arrow-up" size={13} /></button
                >
                <button
                  type="button"
                  class="btn"
                  aria-label="Move {item?.file?.name} later"
                  onclick={(..._r) => self.move(item?.id, 1, ..._r)}
                  ><Icon name="arrow-down" size={13} /></button
                >
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
