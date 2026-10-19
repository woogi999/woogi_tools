<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import ColourField from './colour-field.svelte';
  import { acceptPastedFiles } from '../utils/paste-files.js';
  import { loadBitmap, canvasBlob } from '../utils/watermark.js';
  import { EFFECTS, censor } from '../utils/censor-image.js';
  import { keepState } from '../utils/tool-state.js';

  // Hides the bits of a picture that shouldn't be seen: drag a box or an oval,
  // or paint with the brush, and pick how it's hidden (blur, mosaic, a black
  // bar, static). Each mark keeps its own effect so a face can be pixelated
  // while a licence plate is blacked out.

  const TOOLS = [
    { id: 'rect', label: 'Box', icon: 'square' },
    { id: 'ellipse', label: 'Oval', icon: 'circle' },
    { id: 'brush', label: 'Brush', icon: 'brush' },
  ];
  const FORMATS = [
    { id: 'image/png', label: 'PNG', ext: 'png' },
    { id: 'image/jpeg', label: 'JPEG', ext: 'jpg' },
    { id: 'image/webp', label: 'WebP', ext: 'webp' },
  ];
  const PREVIEW_SIDE = 1200;
  const eq = (a, b) => a === b;
  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  class ImageCensorPage extends Component {
    file = $state.raw(null);
    bitmap = $state.raw(null);
    marks = $state.raw([]);
    draft = $state.raw(null);
    tool = $state.raw('rect');
    effect = $state.raw('blur');
    strength = $state.raw(50);
    brushSize = $state.raw(6);
    colour = $state.raw('#000000');
    dragging = $state.raw(false);
    format = $state.raw('image/png');
    busy = $state.raw(false);
    error = $state.raw(null);
    resultUrl = $state.raw(null);

    tools = TOOLS;
    effects = EFFECTS;
    formats = FORMATS;
    canvas = null;
    preview = null;
    layers = new Map();
    frame = null;

    constructor(args) {
      super(args);
      keepState(this, 'image-censor', [
        'tool',
        'effect',
        'strength',
        'brushSize',
        'colour',
        'format',
      ]);
      registerDestructor(this, () => {
        cancelAnimationFrame(this.frame);
        this.bitmap?.close?.();
        if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
      });
    }

    get ext() {
      return FORMATS.find((f) => f.id === this.format)?.ext ?? 'png';
    }

    get resultName() {
      return `${(this.file?.name ?? 'picture').replace(/\.[^.]+$/, '')}-censored.${this.ext}`;
    }

    get allMarks() {
      return this.draft ? [...this.marks, this.draft] : this.marks;
    }

    get usesColour() {
      return this.effect === 'colour';
    }

    get noMarks() {
      return this.marks.length === 0;
    }

    bindCanvas = modifier((element) => {
      this.canvas = element;
      this.draw();
      return () => (this.canvas = null);
    });

    // The preview is a scaled copy so brush strokes stay smooth on big photos;
    // the save runs the same marks over the full-size picture.
    makePreview() {
      const { width, height } = this.bitmap;
      const scale = Math.min(1, PREVIEW_SIDE / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas
        .getContext('2d')
        .drawImage(this.bitmap, 0, 0, canvas.width, canvas.height);
      this.preview = canvas;
      this.layers = new Map();
    }

    draw() {
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => {
        if (!this.canvas || !this.preview) return;
        censor(this.canvas, this.preview, this.allMarks, {
          layers: this.layers,
          colour: this.colour,
        });
      });
    }

    async open(file) {
      if (!file?.type.startsWith('image/')) return;
      try {
        const bitmap = await loadBitmap(file);
        this.bitmap?.close?.();
        this.bitmap = bitmap;
        this.file = file;
        this.marks = [];
        this.error = null;
        this.clearResult();
        this.makePreview();
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
    pick = (key, value) => (this[key] = value);
    number = (key, event) => (this[key] = Number(event.target.value) || 0);
    setColour = (value) => (this.colour = value);
    setFormat = (event) => (this.format = event.target.value);

    // Pointer positions come back as a share of the picture, whatever size it
    // is shown at.
    at(event) {
      const rect = this.canvas.getBoundingClientRect();
      return [
        clamp01((event.clientX - rect.left) / rect.width),
        clamp01((event.clientY - rect.top) / rect.height),
      ];
    }

    base() {
      return {
        effect: this.effect,
        strength: this.strength,
        colour: this.colour,
      };
    }

    pointerDown = (event) => {
      if (!this.preview || event.button) return;
      event.preventDefault();
      this.canvas.setPointerCapture(event.pointerId);
      const [x, y] = this.at(event);
      this.draft =
        this.tool === 'brush'
          ? {
              ...this.base(),
              type: 'brush',
              size: this.brushSize / 100,
              points: [[x, y]],
            }
          : { ...this.base(), type: this.tool, x, y, w: 0, h: 0, ox: x, oy: y };
      this.draw();
    };

    pointerMove = (event) => {
      if (!this.draft) return;
      const [x, y] = this.at(event);
      if (this.draft.type === 'brush') {
        this.draft = { ...this.draft, points: [...this.draft.points, [x, y]] };
      } else {
        const { ox, oy } = this.draft;
        this.draft = {
          ...this.draft,
          x: Math.min(ox, x),
          y: Math.min(oy, y),
          w: Math.abs(x - ox),
          h: Math.abs(y - oy),
        };
      }
      this.draw();
    };

    pointerUp = () => {
      if (!this.draft) return;
      const mark = this.draft;
      this.draft = null;
      const tooSmall =
        mark.type !== 'brush' && (mark.w < 0.005 || mark.h < 0.005);
      if (!tooSmall) {
        this.marks = [...this.marks, mark];
        this.clearResult();
      }
      this.draw();
    };

    undo = () => {
      this.marks = this.marks.slice(0, -1);
      this.clearResult();
      this.draw();
    };

    clearMarks = () => {
      this.marks = [];
      this.clearResult();
      this.draw();
    };

    save = async () => {
      if (!this.bitmap || !this.marks.length || this.busy) return;
      this.busy = true;
      try {
        await new Promise((resolve) => setTimeout(resolve, 16));
        const out = document.createElement('canvas');
        censor(out, this.bitmap, this.marks, { colour: this.colour });
        const blob = await canvasBlob(out, this.format, 0.92);
        this.clearResult();
        this.resultUrl = URL.createObjectURL(blob);
      } catch (error) {
        this.error = error?.message ?? 'Couldn’t write the picture out';
      } finally {
        this.busy = false;
      }
    };

    reset = () => {
      this.bitmap?.close?.();
      this.bitmap = this.file = this.preview = null;
      this.marks = [];
      this.clearResult();
    };
  }
</script>

<script>
  let args = $props();
  const self = new ImageCensorPage(args);
  onDestroy(() => destroy(self));
</script>

<!-- template-lint-disable no-pointer-down-event-binding -->
<ToolPage
  route="image-censor"
  busy={self.busy}
  closeWarning="Close Image Censor? The picture being saved will be lost."
  subtitle="Blur, pixelate or black out the parts of a picture that shouldn't be seen: drag a box or an oval, or paint over them with a brush. Nothing leaves your device."
>
  <div class="fs" {@attach acceptPastedFiles([self.pasteFiles])}>
    {#if truthy(self.bitmap)}
      <div class="ie-layout">
        <div class="ie-stage">
          <div class="ie-canvas-wrap checkerboard">
            <canvas
              class="ie-canvas ic-canvas"
              onpointercancel={self.pointerUp}
              onpointerup={self.pointerUp}
              onpointermove={self.pointerMove}
              onpointerdown={self.pointerDown}
              {@attach self.bindCanvas?.()}
            ></canvas>
          </div>
          <div class="fc-toolbar">
            <div class="settings-actions">
              <button
                type="button"
                class="btn"
                disabled={self.noMarks}
                onclick={self.undo}
                ><Icon name="rotate-ccw" size={13} /> Undo</button
              >
              <button
                type="button"
                class="btn"
                disabled={self.noMarks}
                onclick={self.clearMarks}>Clear marks</button
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
              <button
                type="button"
                class="btn active"
                disabled={self.noMarks}
                onclick={self.save}
                >{truthy(self.busy) ? 'Working…' : 'Apply'}</button
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
                >New picture</button
              >
            </div>
          </div>
          <p class="tool-hint"
            >{self.marks?.length}
            {truthy(eq(self.marks?.length, 1)) ? 'mark' : 'marks'}. The saved
            picture is the full size; the effects are baked into the pixels, so
            there's nothing underneath to recover.</p
          >
          {#if truthy(self.error)}<p class="tool-error">{self.error}</p>{/if}
        </div>

        <aside class="ie-panel">
          <div class="math-field">
            <span class="qr-label is-muted">Draw with</span>
            <div class="math-tabs" role="group" aria-label="Tool">
              {#each self.tools ?? [] as t}
                <button
                  type="button"
                  class="qr-tab {truthy(eq(self.tool, t?.id)) ? 'active' : ''}"
                  onclick={(..._r) => self.pick('tool', t?.id, ..._r)}
                  ><Icon name={t?.icon} size={13} /> {t?.label}</button
                >
              {/each}
            </div>
          </div>
          {#if truthy(eq(self.tool, 'brush'))}
            <div class="ie-slider">
              <div class="field-head">
                <span class="qr-label is-muted">Brush size</span>
                <span class="ie-slider-value">{self.brushSize}</span>
              </div>
              <input
                type="range"
                min="1"
                max="30"
                {@attach prop('value', () => self.brushSize)}
                aria-label="Brush size"
                oninput={(..._r) => self.number('brushSize', ..._r)}
              />
            </div>
          {/if}
          <div class="math-field">
            <span class="qr-label is-muted">Hide it with</span>
            <div class="cipher-picks" role="group" aria-label="Effect">
              {#each self.effects ?? [] as e}
                <button
                  type="button"
                  class="qr-tab {truthy(eq(self.effect, e?.id))
                    ? 'active'
                    : ''}"
                  onclick={(..._r) => self.pick('effect', e?.id, ..._r)}
                  >{e?.label}</button
                >
              {/each}
            </div>
          </div>
          {#if truthy(self.usesColour)}
            <ColourField
              label="Box colour"
              value={self.colour}
              onChange={self.setColour}
            />
          {/if}
          <div class="ie-slider">
            <div class="field-head">
              <span class="qr-label is-muted">Strength</span>
              <span class="ie-slider-value">{self.strength}</span>
            </div>
            <input
              type="range"
              min="5"
              max="100"
              {@attach prop('value', () => self.strength)}
              aria-label="Strength"
              oninput={(..._r) => self.number('strength', ..._r)}
            />
          </div>
          <p class="tool-hint"
            >The effect and strength are set per mark as you draw it, so you can
            mix them on one picture.</p
          >
        </aside>
      </div>
    {:else}
      <label
        class="qr-drop fs-drop {truthy(self.dragging) ? 'is-dragging' : ''}"
        ondrop={self.drop}
        ondragleave={self.dragOver}
        ondragover={self.dragOver}
      >
        <Icon name="eye-off" size={22} />
        <span
          >{truthy(self.dragging)
            ? 'Drop it here'
            : 'Drop a picture, paste it, or click to browse'}</span
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
