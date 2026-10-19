<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import { acceptPastedFiles } from '../utils/paste-files.js';
  import { loadBitmap, canvasBlob } from '../utils/watermark.js';
  import { DEFAULT_EDITS, PRESETS, render } from '../utils/photo.js';
  import { keepState } from '../utils/tool-state.js';

  // A darkroom in the browser: the Lightroom sliders (light, colour, detail,
  // effects) plus the fun stuff (dither, pixelate, posterize), all worked out
  // on the pixels themselves so what you see is what you save.

  const PREVIEW_SIDE = 1100;
  const eq = (a, b) => a === b;

  const PANELS = [
    {
      id: 'light',
      label: 'Light',
      sliders: [
        ['exposure', 'Exposure', -100, 100],
        ['contrast', 'Contrast', -100, 100],
        ['highlights', 'Highlights', -100, 100],
        ['shadows', 'Shadows', -100, 100],
        ['whites', 'Whites', -100, 100],
        ['blacks', 'Blacks', -100, 100],
      ],
    },
    {
      id: 'colour',
      label: 'Colour',
      sliders: [
        ['temperature', 'Temperature', -100, 100],
        ['tint', 'Tint', -100, 100],
        ['vibrance', 'Vibrance', -100, 100],
        ['saturation', 'Saturation', -100, 100],
        ['hue', 'Hue shift', -180, 180],
      ],
    },
    {
      id: 'detail',
      label: 'Detail',
      sliders: [
        ['sharpen', 'Sharpen', 0, 100],
        ['blur', 'Blur', 0, 100],
        ['grain', 'Grain', 0, 100],
      ],
    },
    {
      id: 'effects',
      label: 'Effects',
      sliders: [
        ['vignette', 'Vignette', -100, 100],
        ['fade', 'Fade', 0, 100],
        ['pixelate', 'Pixelate', 0, 40],
        ['posterize', 'Posterize levels', 0, 16],
        ['threshold', 'Threshold', 0, 255],
      ],
    },
  ];

  const DITHERS = [
    { id: 'none', label: 'Off' },
    { id: 'floyd', label: 'Floyd–Steinberg' },
    { id: 'atkinson', label: 'Atkinson' },
    { id: 'bayer', label: 'Ordered (Bayer)' },
  ];

  const FORMATS = [
    { id: 'image/png', label: 'PNG', ext: 'png' },
    { id: 'image/jpeg', label: 'JPEG', ext: 'jpg' },
    { id: 'image/webp', label: 'WebP', ext: 'webp' },
  ];

  class ImageEditorPage extends Component {
    file = $state.raw(null);
    bitmap = $state.raw(null);
    edits = $state.raw({ ...DEFAULT_EDITS });
    panel = $state.raw('light');
    preset = $state.raw('none');
    comparing = $state.raw(false);
    dragging = $state.raw(false);
    format = $state.raw('image/jpeg');
    quality = $state.raw(92);
    busy = $state.raw(false);
    error = $state.raw(null);
    resultUrl = $state.raw(null);
    resultSize = $state.raw(0);
    undo = $state.raw([]);

    panels = PANELS;
    dithers = DITHERS;
    formats = FORMATS;
    presets = PRESETS;
    canvas = null;
    frame = null;

    constructor(args) {
      super(args);
      keepState(this, 'image-editor', ['format', 'quality', 'panel']);
      registerDestructor(this, () => {
        cancelAnimationFrame(this.frame);
        this.bitmap?.close?.();
        if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
      });
    }

    get activePanel() {
      return PANELS.find((p) => p.id === this.panel) ?? PANELS[0];
    }

    get sliders() {
      return this.activePanel.sliders.map(([key, label, min, max]) => ({
        key,
        label,
        min,
        max,
        value: this.edits[key],
      }));
    }

    get ext() {
      return FORMATS.find((f) => f.id === this.format)?.ext ?? 'jpg';
    }

    get resultName() {
      return `${(this.file?.name ?? 'photo').replace(/\.[^.]+$/, '')}-edited.${this.ext}`;
    }

    get usesQuality() {
      return this.format !== 'image/png';
    }

    get cannotUndo() {
      return this.undo.length === 0;
    }

    bindCanvas = modifier((element) => {
      this.canvas = element;
      this.draw();
      return () => (this.canvas = null);
    });

    // Redraws on the next frame; a slider sends dozens of events a second and
    // only the last one needs painting.
    draw() {
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => {
        if (!this.canvas || !this.bitmap) return;
        const edits = this.comparing
          ? {
              rotate: this.edits.rotate,
              flipH: this.edits.flipH,
              flipV: this.edits.flipV,
            }
          : this.edits;
        const out = render(this.bitmap, edits, PREVIEW_SIDE);
        this.canvas.width = out.width;
        this.canvas.height = out.height;
        this.canvas.getContext('2d').drawImage(out, 0, 0);
      });
    }

    async open(file) {
      if (!file?.type.startsWith('image/')) return;
      try {
        const bitmap = await loadBitmap(file);
        this.bitmap?.close?.();
        this.bitmap = bitmap;
        this.file = file;
        this.error = null;
        this.clearResult();
        this.draw();
      } catch {
        this.error = `${file.name} couldn’t be read as an image`;
      }
    }

    clearResult() {
      if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
      this.resultUrl = null;
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

    change(patch, { remember = true } = {}) {
      if (remember) this.undo = [...this.undo.slice(-30), this.edits];
      this.edits = { ...this.edits, ...patch };
      this.preset = 'none';
      this.clearResult();
      this.draw();
    }

    // Dragging a slider is one change, not fifty: the undo point is taken when
    // the drag starts.
    beginSlide = () => (this.undo = [...this.undo.slice(-30), this.edits]);
    slide = (key, event) =>
      this.change(
        { [key]: Number(event.target.value) || 0 },
        { remember: false },
      );
    resetSlider = (key) => this.change({ [key]: DEFAULT_EDITS[key] });
    toggle = (key) => this.change({ [key]: !this.edits[key] });
    setDither = (id) => this.change({ dither: id });
    setDitherColours = (event) =>
      this.change(
        { ditherColours: Number(event.target.value) || 2 },
        { remember: false },
      );
    rotate = () => this.change({ rotate: (this.edits.rotate + 90) % 360 });
    pickPanel = (id) => (this.panel = id);
    setFormat = (event) => (this.format = event.target.value);
    setQuality = (event) => (this.quality = Number(event.target.value) || 92);

    applyPreset = (preset) => {
      this.change({
        ...DEFAULT_EDITS,
        rotate: this.edits.rotate,
        flipH: this.edits.flipH,
        flipV: this.edits.flipV,
        ...preset.edits,
      });
      this.preset = preset.id;
    };

    resetAll = () => this.change({ ...DEFAULT_EDITS });

    undoLast = () => {
      const last = this.undo.at(-1);
      if (!last) return;
      this.undo = this.undo.slice(0, -1);
      this.edits = last;
      this.clearResult();
      this.draw();
    };

    compare = (event) => {
      this.comparing = event.type === 'pointerdown' || event.type === 'keydown';
      this.draw();
    };

    save = async () => {
      if (!this.bitmap || this.busy) return;
      this.busy = true;
      try {
        // The full-size render can take a few seconds on a big photo; the
        // preview stays put while it runs.
        await new Promise((resolve) => setTimeout(resolve, 16));
        const out = render(this.bitmap, this.edits, 0);
        const blob = await canvasBlob(out, this.format, this.quality / 100);
        this.clearResult();
        this.resultUrl = URL.createObjectURL(blob);
        this.resultSize = blob.size;
      } catch (error) {
        this.error = error?.message ?? 'Couldn’t write the picture out';
      } finally {
        this.busy = false;
      }
    };

    reset = () => {
      this.bitmap?.close?.();
      this.bitmap = this.file = null;
      this.edits = { ...DEFAULT_EDITS };
      this.undo = [];
      this.clearResult();
    };
  }
</script>

<script>
  let args = $props();
  const self = new ImageEditorPage(args);
  onDestroy(() => destroy(self));
</script>

<!-- template-lint-disable no-pointer-down-event-binding -->
<ToolPage
  route="image-editor"
  busy={self.busy}
  closeWarning="Close the Image Editor? The picture being saved will be lost."
  subtitle="A darkroom for one photo: light, colour, detail and effects sliders, plus dither, pixelate and posterize for the fun stuff. Nothing is uploaded."
>
  <div class="fs" {@attach acceptPastedFiles([self.pasteFiles])}>
    {#if truthy(self.bitmap)}
      <div class="ie-layout">
        <div class="ie-stage">
          <div class="ie-canvas-wrap checkerboard">
            <canvas class="ie-canvas" {@attach self.bindCanvas?.()}></canvas>
          </div>
          <div class="fc-toolbar">
            <div class="settings-actions">
              <button
                type="button"
                class="btn"
                title="Hold to see the original"
                onpointerleave={self.compare}
                onpointerup={self.compare}
                onpointerdown={self.compare}
                ><Icon name="eye" size={13} /> Hold to compare</button
              >
              <button
                type="button"
                class="btn"
                disabled={self.cannotUndo}
                onclick={self.undoLast}
                ><Icon name="rotate-ccw" size={13} /> Undo</button
              >
              <button type="button" class="btn" onclick={self.rotate}
                ><Icon name="refresh-cw" size={13} /> Rotate</button
              >
              <button
                type="button"
                class="btn {truthy(self.edits?.flipH) ? 'active' : ''}"
                onclick={(..._r) => self.toggle('flipH', ..._r)}>Flip ↔</button
              >
              <button
                type="button"
                class="btn {truthy(self.edits?.flipV) ? 'active' : ''}"
                onclick={(..._r) => self.toggle('flipV', ..._r)}>Flip ↕</button
              >
            </div>
            <div class="settings-actions">
              <select
                class="select"
                aria-label="Save as"
                onchange={self.setFormat}
              >
                {#each self.formats ?? [] as f}
                  <option
                    value={f?.id}
                    {@attach prop('selected', () => eq(self.format, f?.id))}
                    >{f?.label}</option
                  >
                {/each}
              </select>
              {#if truthy(self.usesQuality)}
                <input
                  type="range"
                  min="30"
                  max="100"
                  aria-label="Quality"
                  title="Quality: {self.quality}"
                  {@attach prop('value', () => self.quality)}
                  oninput={self.setQuality}
                />
              {/if}
              <button
                type="button"
                class="btn active"
                disabled={self.busy}
                onclick={self.save}
                >{truthy(self.busy) ? 'Developing…' : 'Develop'}</button
              >
              {#if truthy(self.resultUrl)}
                <a
                  class="btn fs-save"
                  href={self.resultUrl}
                  download={self.resultName}
                  ><Icon name="download" size={13} /> Save</a
                >
              {/if}
              <button type="button" class="btn" onclick={self.reset}
                >New photo</button
              >
            </div>
          </div>
          {#if truthy(self.error)}<p class="tool-error">{self.error}</p>{/if}
        </div>

        <aside class="ie-panel">
          <div class="field-head">
            <span class="qr-label is-muted">Presets</span>
            <button type="button" class="btn" onclick={self.resetAll}
              >Reset all</button
            >
          </div>
          <div class="cipher-picks" role="group" aria-label="Presets">
            {#each self.presets ?? [] as p}
              <button
                type="button"
                class="qr-tab {truthy(eq(self.preset, p?.id)) ? 'active' : ''}"
                onclick={(..._r) => self.applyPreset(p, ..._r)}
                >{p?.label}</button
              >
            {/each}
          </div>

          <div class="math-tabs" role="tablist" aria-label="Adjustments">
            {#each self.panels ?? [] as p}
              <button
                type="button"
                role="tab"
                class="qr-tab {truthy(eq(self.panel, p?.id)) ? 'active' : ''}"
                aria-selected={truthy(eq(self.panel, p?.id)) ? 'true' : 'false'}
                onclick={(..._r) => self.pickPanel(p?.id, ..._r)}
                >{p?.label}</button
              >
            {/each}
          </div>

          <div class="ie-sliders">
            {#each self.sliders ?? [] as s}
              <div class="ie-slider">
                <div class="field-head">
                  <span class="qr-label is-muted">{s?.label}</span>
                  <button
                    type="button"
                    class="ie-slider-value"
                    title="Reset"
                    onclick={(..._r) => self.resetSlider(s?.key, ..._r)}
                    >{s?.value}</button
                  >
                </div>
                <input
                  type="range"
                  min={s?.min}
                  max={s?.max}
                  {@attach prop('value', () => s?.value)}
                  aria-label={s?.label}
                  oninput={(..._r) => self.slide(s?.key, ..._r)}
                  onpointerdown={self.beginSlide}
                />
              </div>
            {/each}
          </div>

          {#if truthy(eq(self.panel, 'colour'))}
            <div class="cipher-picks">
              <button
                type="button"
                class="qr-tab {truthy(self.edits?.grayscale) ? 'active' : ''}"
                onclick={(..._r) => self.toggle('grayscale', ..._r)}
                >Black & white</button
              >
              <button
                type="button"
                class="qr-tab {truthy(self.edits?.sepia) ? 'active' : ''}"
                onclick={(..._r) => self.toggle('sepia', ..._r)}>Sepia</button
              >
              <button
                type="button"
                class="qr-tab {truthy(self.edits?.invert) ? 'active' : ''}"
                onclick={(..._r) => self.toggle('invert', ..._r)}>Invert</button
              >
            </div>
          {/if}

          {#if truthy(eq(self.panel, 'effects'))}
            <div class="math-field">
              <span class="qr-label is-muted">Dither</span>
              <div class="cipher-picks" role="group" aria-label="Dither">
                {#each self.dithers ?? [] as d}
                  <button
                    type="button"
                    class="qr-tab
                          {truthy(eq(self.edits?.dither, d?.id))
                      ? 'active'
                      : ''}"
                    onclick={(..._r) => self.setDither(d?.id, ..._r)}
                    >{d?.label}</button
                  >
                {/each}
              </div>
            </div>
            {#if !truthy(eq(self.edits?.dither, 'none'))}
              <div class="ie-slider">
                <div class="field-head">
                  <span class="qr-label is-muted">Shades per channel</span>
                  <span class="ie-slider-value"
                    >{self.edits?.ditherColours}</span
                  >
                </div>
                <input
                  type="range"
                  min="2"
                  max="8"
                  {@attach prop('value', () => self.edits?.ditherColours)}
                  aria-label="Shades per channel"
                  oninput={self.setDitherColours}
                  onpointerdown={self.beginSlide}
                />
              </div>
            {/if}
          {/if}
        </aside>
      </div>
    {:else}
      <label
        class="qr-drop fs-drop {truthy(self.dragging) ? 'is-dragging' : ''}"
        ondrop={self.drop}
        ondragleave={self.dragOver}
        ondragover={self.dragOver}
      >
        <Icon name="aperture" size={22} />
        <span
          >{truthy(self.dragging)
            ? 'Drop it here'
            : 'Drop a photo, paste it, or click to browse'}</span
        >
        <input
          type="file"
          accept="image/*"
          class="sr-only"
          onchange={self.selectFile}
        />
      </label>
      {#if truthy(self.error)}<p class="tool-error">{self.error}</p>{/if}
    {/if}
  </div>
</ToolPage>
