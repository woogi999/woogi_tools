<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, on, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import { CROP_PRESETS } from '../utils/social-presets.js';
  import { acceptPastedFiles } from '../utils/paste-files.js';
  import PrintButton from './print-button.svelte';

  const GROUPS = groupByPlatform(CROP_PRESETS);
  const eq = (a, b) => a === b;
  const FREE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const CORNER_HANDLES = ['nw', 'ne', 'se', 'sw'];
  // The smallest a crop can be dragged down to, in source pixels.
  const MIN_SIDE = 8;

  function groupByPlatform(list) {
    const map = new Map();
    for (const p of list) {
      if (!map.has(p.platform)) map.set(p.platform, []);
      map.get(p.platform).push(p);
    }
    return [...map].map(([platform, items]) => ({ platform, items }));
  }

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  class ImageCropperPage extends Component {
    groups = GROUPS;

    bitmap = $state.raw(null);
    imageUrl = $state.raw(null);
    fileName = $state.raw('image');
    presetId = $state.raw('ig-square');
    // The crop, in source pixels: { x, y, w, h }.
    rect = $state.raw(null);
    // Screen pixels per source pixel, measured from the image as it's shown.
    scale = $state.raw(1);
    resultUrl = $state.raw(null);
    error = $state.raw(null);
    dragging = $state.raw(null);

    constructor(args) {
      super(args);
      registerDestructor(this, () => {
        if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
        if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
      });
    }

    get preset() {
      return CROP_PRESETS.find((p) => p.id === this.presetId);
    }

    get ratio() {
      return this.preset.free ? null : this.preset.w / this.preset.h;
    }

    get handles() {
      return this.preset.free ? FREE_HANDLES : CORNER_HANDLES;
    }

    get targetW() {
      return this.preset.free ? (this.rect?.w ?? 1) : this.preset.w;
    }

    get targetH() {
      return this.preset.free ? (this.rect?.h ?? 1) : this.preset.h;
    }

    get boxStyle() {
      if (!this.rect) return '';
      const { x, y, w, h } = this.rect;
      const s = this.scale;
      return `left:${x * s}px;top:${y * s}px;width:${w * s}px;height:${h * s}px`;
    }

    // Keeps the on-screen scale in step with however big the image is shown.
    measure = modifier((img) => {
      const update = () => {
        if (this.bitmap && img.clientWidth)
          this.scale = img.clientWidth / this.bitmap.width;
      };
      const observer = new ResizeObserver(update);
      observer.observe(img);
      update();
      return () => observer.disconnect();
    });

    // The biggest crop of the wanted shape that fits, sat in the middle.
    fitRect() {
      const { width: bw, height: bh } = this.bitmap;
      if (!this.ratio) return { x: 0, y: 0, w: bw, h: bh };
      let w = bw;
      let h = w / this.ratio;
      if (h > bh) {
        h = bh;
        w = h * this.ratio;
      }
      w = Math.round(w);
      h = Math.round(h);
      return { x: Math.round((bw - w) / 2), y: Math.round((bh - h) / 2), w, h };
    }

    openFile = async (file) => {
      if (!file || !file.type.startsWith('image/')) return;
      try {
        const bitmap = await createImageBitmap(file);
        if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
        if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
        this.imageUrl = URL.createObjectURL(file);
        this.fileName = file.name.replace(/\.[^.]+$/, '');
        this.bitmap = bitmap;
        this.resultUrl = null;
        this.error = null;
        this.rect = this.fitRect();
      } catch {
        this.error =
          "This browser can't open that image. Try the File Converter first.";
      }
    };

    selectFile = (e) => {
      this.openFile(e.target.files?.[0]);
      e.target.value = '';
    };

    dragOverFile = (e) => e.preventDefault();
    dropFile = (e) => {
      e.preventDefault();
      this.openFile(e.dataTransfer.files?.[0]);
    };

    setPreset = (event) => {
      this.presetId = event.target.value;
      this.resultUrl = null;
      if (this.bitmap) this.rect = this.fitRect();
    };

    // Typing a size for a custom crop resizes the rectangle from its top-left,
    // nudging it back into the picture if it would run off the edge.
    setCustom = (key, event) => {
      if (!this.rect) return;
      const value = Math.max(MIN_SIDE, Math.floor(+event.target.value) || 0);
      const { width: bw, height: bh } = this.bitmap;
      const next = { ...this.rect };
      if (key === 'w') {
        next.w = Math.min(value, bw);
        next.x = clamp(next.x, 0, bw - next.w);
      } else {
        next.h = Math.min(value, bh);
        next.y = clamp(next.y, 0, bh - next.h);
      }
      this.rect = next;
      this.resultUrl = null;
    };

    reset = () => {
      if (!this.bitmap) return;
      this.rect = this.fitRect();
      this.resultUrl = null;
    };

    startDrag = (mode, e) => {
      if (!this.rect) return;
      e.preventDefault();
      e.stopPropagation();
      this.dragging = mode;
      const start = { x: e.clientX, y: e.clientY, rect: this.rect };
      const move = (ev) => {
        const dx = (ev.clientX - start.x) / this.scale;
        const dy = (ev.clientY - start.y) / this.scale;
        this.rect =
          mode === 'move'
            ? this.moved(start.rect, dx, dy)
            : this.ratio
              ? this.scaled(start.rect, mode, dx, dy)
              : this.resized(start.rect, mode, dx, dy);
        this.resultUrl = null;
      };
      const stop = () => {
        this.dragging = null;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
        window.removeEventListener('pointercancel', stop);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
    };

    moved(r, dx, dy) {
      const { width: bw, height: bh } = this.bitmap;
      return {
        ...r,
        x: Math.round(clamp(r.x + dx, 0, bw - r.w)),
        y: Math.round(clamp(r.y + dy, 0, bh - r.h)),
      };
    }

    // Any side or corner, on its own: the edges being pulled follow the pointer.
    resized(r, handle, dx, dy) {
      const { width: bw, height: bh } = this.bitmap;
      let left = r.x;
      let top = r.y;
      let right = r.x + r.w;
      let bottom = r.y + r.h;
      if (handle.includes('w')) left = clamp(r.x + dx, 0, right - MIN_SIDE);
      if (handle.includes('e')) right = clamp(right + dx, left + MIN_SIDE, bw);
      if (handle.includes('n')) top = clamp(r.y + dy, 0, bottom - MIN_SIDE);
      if (handle.includes('s')) bottom = clamp(bottom + dy, top + MIN_SIDE, bh);
      return {
        x: Math.round(left),
        y: Math.round(top),
        w: Math.round(right - left),
        h: Math.round(bottom - top),
      };
    }

    // A corner, with the shape locked: the opposite corner stays put and the
    // box grows or shrinks towards the pointer, never past the picture's edge.
    scaled(r, handle, dx, dy) {
      const { width: bw, height: bh } = this.bitmap;
      const ratio = this.ratio;
      const anchorX = handle.includes('w') ? r.x + r.w : r.x;
      const anchorY = handle.includes('n') ? r.y + r.h : r.y;
      const wantW = handle.includes('w') ? r.w - dx : r.w + dx;
      const wantH = handle.includes('n') ? r.h - dy : r.h + dy;
      let w = Math.max(wantW, wantH * ratio);
      const roomW = handle.includes('w') ? anchorX : bw - anchorX;
      const roomH = handle.includes('n') ? anchorY : bh - anchorY;
      w = clamp(
        w,
        Math.max(MIN_SIDE, MIN_SIDE * ratio),
        Math.min(roomW, roomH * ratio),
      );
      const h = w / ratio;
      return {
        x: Math.round(handle.includes('w') ? anchorX - w : anchorX),
        y: Math.round(handle.includes('n') ? anchorY - h : anchorY),
        w: Math.round(w),
        h: Math.round(h),
      };
    }

    crop = () => {
      if (!this.bitmap || !this.rect) return;
      const { x, y, w, h } = this.rect;
      const canvas = document.createElement('canvas');
      canvas.width = this.targetW;
      canvas.height = this.targetH;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.bitmap, x, y, w, h, 0, 0, this.targetW, this.targetH);
      canvas.toBlob((blob) => {
        if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
        this.resultUrl = URL.createObjectURL(blob);
      }, 'image/png');
    };

    pasteFiles = (files) => this.openFile(files[0]);
  }
</script>

<script>
  let args = $props();
  const self = new ImageCropperPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="image-cropper"
  subtitle="Draw the crop right on the picture: drag it about, pull the corners, and save at an exact size, with presets for socials."
>
  <div class="math-grid pop-in" {@attach acceptPastedFiles([self.pasteFiles])}>
    <section class="math-card">
      <label
        class="qr-drop {truthy(self.bitmap) ? 'is-filled' : ''}"
        ondrop={self.dropFile}
        ondragover={self.dragOverFile}
      >
        {#if !truthy(self.bitmap)}
          <Icon name="crop" size={22} />
          <span>Drop an image, or click to browse</span>
        {/if}
        <input
          type="file"
          accept="image/*"
          class="sr-only"
          onchange={self.selectFile}
        />
      </label>
      {#if truthy(self.error)}<p class="tool-error">{self.error}</p>{/if}

      <label class="math-field">
        <span class="qr-label is-muted">Preset</span>
        <select class="select" onchange={self.setPreset}>
          {#each self.groups ?? [] as group}
            <optgroup label={group?.platform}>
              {#each group?.items ?? [] as p}
                <option
                  value={p?.id}
                  {@attach prop('selected', () => eq(p?.id, self.presetId))}
                  >{p?.label}{#if !truthy(p?.free)}
                    ({p?.w}×{p?.h}){/if}</option
                >
              {/each}
            </optgroup>
          {/each}
        </select>
      </label>

      {#if truthy(self.preset?.free)}
        <div class="math-row">
          <label class="math-field"
            ><span class="qr-label is-muted">Width (px)</span><input
              type="number"
              min="1"
              class="math-input"
              {@attach prop('value', () => self.targetW)}
              onchange={(..._r) => self.setCustom('w', ..._r)}
            /></label
          >
          <label class="math-field"
            ><span class="qr-label is-muted">Height (px)</span><input
              type="number"
              min="1"
              class="math-input"
              {@attach prop('value', () => self.targetH)}
              onchange={(..._r) => self.setCustom('h', ..._r)}
            /></label
          >
        </div>
        <p class="tool-hint"
          >Pull any side or corner of the box, or type a size.</p
        >
      {:else}
        <p class="tool-hint"
          >The box keeps its shape: pull a corner to make it bigger or smaller,
          and drag it to where you want.</p
        >
      {/if}

      {#if truthy(self.rect)}
        <p class="crop-readout"
          >Crop:
          {self.rect?.w}×{self.rect?.h}
          at
          {self.rect?.x},{self.rect?.y}
          {#if !truthy(self.preset?.free)}<span class="is-muted"
              >→
              {self.targetW}×{self.targetH}</span
            >{/if}</p
        >
        <div class="settings-actions">
          <button type="button" class="btn" onclick={self.reset}>
            <Icon name="rotate-ccw" size={13} />
            Fit to picture</button
          >
        </div>
      {/if}
    </section>

    <section class="math-card">
      <h3 class="qr-heading">Preview</h3>
      {#if truthy(self.bitmap)}
        <div class="crop-stage {truthy(self.dragging) ? 'is-dragging' : ''}">
          <img
            src={self.imageUrl}
            alt=""
            class="crop-picture"
            draggable="false"
            {@attach self.measure?.()}
          />
          <!-- template-lint-disable no-pointer-down-event-binding -->
          <div
            class="crop-box"
            style={self.boxStyle}
            {@attach on('pointerdown', (..._r) =>
              self.startDrag('move', ..._r),
            )}
          >
            {#each self.handles ?? [] as handle}
              <!-- template-lint-disable no-invalid-interactive -->
              <span
                class="crop-handle is-{handle}"
                {@attach on('pointerdown', (..._r) =>
                  self.startDrag(handle, ..._r),
                )}
              ></span>
            {/each}
          </div>
        </div>
        <div class="settings-actions">
          <button type="button" class="btn active" onclick={self.crop}
            >Crop</button
          >
          {#if truthy(self.resultUrl)}<a
              class="btn fs-save"
              href={self.resultUrl}
              download="{self.fileName}-{self.targetW}x{self.targetH}.png"
              ><Icon name="download" size={13} /> Save</a
            ><PrintButton
              url={self.resultUrl}
              name="{self.fileName}.png"
            />{/if}
        </div>
        {#if truthy(self.resultUrl)}
          <img src={self.resultUrl} alt="Cropped result" class="crop-result" />
        {/if}
      {:else}
        <p class="tool-hint">Upload an image to start cropping.</p>
      {/if}
    </section>
  </div>
</ToolPage>
