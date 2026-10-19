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
  import { SPOTS, loadBitmap, stamp, canvasBlob } from '../utils/watermark.js';

  // Puts your name, a logo or a "DRAFT" over a pile of pictures at once.

  const FORMATS = [
    { id: 'image/png', label: 'PNG', ext: 'png' },
    { id: 'image/jpeg', label: 'JPEG', ext: 'jpg' },
    { id: 'image/webp', label: 'WebP', ext: 'webp' },
  ];
  const eq = (a, b) => a === b;
  const nameFor = (name, ext) =>
    `${name.replace(/\.[^.]+$/, '')}-watermarked.${ext}`;
  let nextId = 1;

  class WatermarkerPage extends Component {
    // While this is true, leaving the page floats the tool in a PiP window
    // instead of tearing it down, so the work carries on (see services/pip.js).
    get pipBusy() {
      return this.busy;
    }

    get pipWarning() {
      return 'Close the Watermarker? The images being stamped will be lost.';
    }
    items = $state.raw([]);
    dragging = $state.raw(false);
    kind = $state.raw('text'); // 'text' | 'image'
    text = $state.raw('© your name');
    colour = $state.raw('#FFFFFF');
    shadow = $state.raw(true);
    logo = $state.raw(null);
    logoName = $state.raw('');
    spot = $state.raw('bottom-right');
    opacity = $state.raw(60);
    scale = $state.raw(25);
    rotate = $state.raw(0);
    margin = $state.raw(3);
    format = $state.raw('image/png');
    quality = $state.raw(92);
    busy = $state.raw(false);
    zipUrl = $state.raw(null);
    error = $state.raw(null);

    spots = SPOTS;
    formats = FORMATS;
    canvas = null;

    constructor(args) {
      super(args);
      registerDestructor(this, () => this.revokeAll());
    }

    revokeAll() {
      for (const item of this.items)
        if (item.url) URL.revokeObjectURL(item.url);
      if (this.zipUrl) URL.revokeObjectURL(this.zipUrl);
    }

    get options() {
      return {
        kind: this.kind,
        text: this.text,
        colour: this.colour,
        shadow: this.shadow,
        logo: this.logo,
        spot: this.spot,
        opacity: this.opacity / 100,
        scale: this.scale,
        rotate: this.rotate,
        margin: this.margin,
      };
    }

    get first() {
      return this.items[0] ?? null;
    }

    get done() {
      return this.items.filter((i) => i.url);
    }

    get ext() {
      return FORMATS.find((f) => f.id === this.format)?.ext ?? 'png';
    }

    get usesQuality() {
      return this.format !== 'image/png';
    }

    // The first picture, stamped, redrawn whenever a setting changes.
    preview = modifier((element) => {
      this.canvas = element;
      this.drawPreview();
      return () => (this.canvas = null);
    });

    drawPreview() {
      if (!this.canvas || !this.first?.bitmap) return;
      stamp(this.canvas, this.first.bitmap, this.options);
    }

    changed() {
      for (const item of this.items)
        if (item.url) URL.revokeObjectURL(item.url);
      if (this.zipUrl) URL.revokeObjectURL(this.zipUrl);
      this.zipUrl = null;
      this.items = this.items.map((i) => ({
        ...i,
        url: null,
        size: null,
        name: null,
      }));
      this.drawPreview();
    }

    async addFiles(list) {
      const files = [...list].filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      for (const file of files) {
        try {
          const bitmap = await loadBitmap(file);
          this.items = [
            ...this.items,
            { id: nextId++, file, bitmap, url: null, size: null, name: null },
          ];
        } catch {
          this.error = `${file.name} couldn’t be read as an image`;
        }
      }
      this.changed();
    }

    selectFiles = (e) => {
      this.addFiles(e.target.files);
      e.target.value = '';
    };

    selectLogo = async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        this.logo = await loadBitmap(file);
        this.logoName = file.name;
        this.kind = 'image';
        this.changed();
      } catch {
        this.error = 'That logo couldn’t be read as an image';
      }
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

    pick = (key, value) => {
      this[key] = value;
      this.changed();
    };

    number = (key, event) => this.pick(key, Number(event.target.value) || 0);
    setText = (event) => this.pick('text', event.target.value);
    setColour = (value) => this.pick('colour', value);
    setFormat = (event) => this.pick('format', event.target.value);
    toggleShadow = (event) => this.pick('shadow', event.target.checked);

    remove = (id) => {
      const item = this.items.find((i) => i.id === id);
      if (item?.url) URL.revokeObjectURL(item.url);
      item?.bitmap?.close?.();
      this.items = this.items.filter((i) => i.id !== id);
      this.changed();
    };

    clear = () => {
      this.revokeAll();
      for (const item of this.items) item.bitmap?.close?.();
      this.items = [];
      this.zipUrl = null;
    };

    run = async () => {
      if (!this.items.length || this.busy) return;
      this.busy = true;
      this.error = null;
      const canvas = document.createElement('canvas');
      for (const item of this.items) {
        try {
          stamp(canvas, item.bitmap, this.options);
          const blob = await canvasBlob(
            canvas,
            this.format,
            this.quality / 100,
          );
          const url = URL.createObjectURL(blob);
          this.items = this.items.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  url,
                  size: blob.size,
                  name: nameFor(item.file.name, this.ext),
                  blob,
                }
              : i,
          );
        } catch (error) {
          this.error = error?.message ?? 'Something went wrong stamping these';
        }
      }
      // More than one? Bundle them up as well, so it's one download.
      if (this.done.length > 1) {
        const { zipSync } = await import('fflate');
        const entries = {};
        for (const item of this.done)
          entries[item.name] = new Uint8Array(await item.blob.arrayBuffer());
        this.zipUrl = URL.createObjectURL(
          new Blob([zipSync(entries, { level: 0 })], {
            type: 'application/zip',
          }),
        );
      }
      this.busy = false;
    };
  }
</script>

<script>
  let args = $props();
  const self = new WatermarkerPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="watermarker"
  busy={self.pipBusy}
  closeWarning={self.pipWarning}
  subtitle="Stamp your name, a logo or a “DRAFT” over your pictures, one or a hundred. Position, size, see-throughness and tiling are all yours."
>
  <div class="fs" {@attach acceptPastedFiles([self.pasteFiles])}>
    <div class="fs-frame fc-panel pop-in">
      <label
        class="qr-drop fs-drop {truthy(self.dragging) ? 'is-dragging' : ''}"
        ondrop={self.drop}
        ondragleave={self.dragOver}
        ondragover={self.dragOver}
      >
        <Icon name="stamp" size={22} />
        <span
          >{truthy(self.dragging)
            ? 'Drop them here'
            : 'Drop your pictures, paste them, or click to browse'}</span
        >
        <input
          type="file"
          accept="image/*"
          multiple
          class="sr-only"
          onchange={self.selectFiles}
        />
      </label>

      <div class="math-tabs" role="group" aria-label="What to stamp">
        <button
          type="button"
          class="qr-tab {truthy(eq(self.kind, 'text')) ? 'active' : ''}"
          onclick={(..._r) => self.pick('kind', 'text', ..._r)}
          >Some words</button
        >
        <button
          type="button"
          class="qr-tab {truthy(eq(self.kind, 'image')) ? 'active' : ''}"
          onclick={(..._r) => self.pick('kind', 'image', ..._r)}>A logo</button
        >
      </div>

      {#if truthy(eq(self.kind, 'text'))}
        <label class="math-field"
          ><span class="qr-label is-muted">The words</span><input
            type="text"
            class="math-input"
            {@attach prop('value', () => self.text)}
            oninput={self.setText}
          /></label
        >
        <ColourField
          label="Colour"
          value={self.colour}
          onChange={self.setColour}
        />
        <label class="lobby-rule is-switch">
          <span class="lobby-rule-text"
            ><span class="qr-label">Drop shadow</span><span class="tool-hint"
              >Keeps it readable over a busy photo.</span
            ></span
          >
          <span class="qr-switch">
            <input
              type="checkbox"
              role="switch"
              {@attach prop('checked', () => self.shadow)}
              aria-checked={truthy(self.shadow) ? 'true' : 'false'}
              onchange={self.toggleShadow}
            />
            <span class="qr-switch-track" aria-hidden="true"></span>
          </span>
        </label>
      {:else}
        <label class="btn">
          <Icon name="image-plus" size={14} />
          {truthy(self.logoName) ? self.logoName : 'Choose a logo'}
          <input
            type="file"
            accept="image/*"
            class="sr-only"
            onchange={self.selectLogo}
          />
        </label>
        <p class="tool-hint">A PNG with a see-through background works best.</p>
      {/if}

      <label class="math-field">
        <span class="qr-label is-muted">Where it goes</span>
        <div class="cipher-picks" role="group" aria-label="Where it goes">
          {#each self.spots ?? [] as s}
            <button
              type="button"
              class="qr-tab {truthy(eq(self.spot, s?.id)) ? 'active' : ''}"
              onclick={(..._r) => self.pick('spot', s?.id, ..._r)}
              >{s?.label}</button
            >
          {/each}
        </div>
      </label>

      <div class="math-row">
        <label class="math-field"
          ><span class="qr-label is-muted"
            >Size:
            {self.scale}% of the width</span
          ><input
            type="range"
            min="2"
            max="100"
            {@attach prop('value', () => self.scale)}
            oninput={(..._r) => self.number('scale', ..._r)}
          /></label
        >
        <label class="math-field"
          ><span class="qr-label is-muted">See-through: {self.opacity}%</span
          ><input
            type="range"
            min="2"
            max="100"
            {@attach prop('value', () => self.opacity)}
            oninput={(..._r) => self.number('opacity', ..._r)}
          /></label
        >
      </div>
      <div class="math-row">
        <label class="math-field"
          ><span class="qr-label is-muted"
            >Angle:
            {self.rotate}°</span
          ><input
            type="range"
            min="-90"
            max="90"
            {@attach prop('value', () => self.rotate)}
            oninput={(..._r) => self.number('rotate', ..._r)}
          /></label
        >
        <label class="math-field"
          ><span class="qr-label is-muted"
            >Margin:
            {self.margin}%</span
          ><input
            type="range"
            min="0"
            max="20"
            {@attach prop('value', () => self.margin)}
            oninput={(..._r) => self.number('margin', ..._r)}
          /></label
        >
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
      </div>
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
            oninput={(..._r) => self.number('quality', ..._r)}
          /></label
        >
      {/if}
      {#if truthy(self.error)}<p class="tool-error">{self.error}</p>{/if}
    </div>

    {#if truthy(self.items?.length)}
      <div class="fs-frame fc-panel pop-in">
        <div class="fc-toolbar">
          <h3 class="qr-heading">Preview</h3>
          <div class="settings-actions">
            <button
              type="button"
              class="btn active"
              disabled={self.busy}
              onclick={self.run}
              >{truthy(self.busy) ? 'Stamping…' : 'Stamp them'}</button
            >
            {#if truthy(self.zipUrl)}<a
                class="btn fs-save"
                href={self.zipUrl}
                download="watermarked.zip"
                ><Icon name="download" size={13} />
                Save all (ZIP)</a
              >{/if}
            <button type="button" class="btn" onclick={self.clear}>Clear</button
            >
          </div>
        </div>
        <div class="stitch-preview"
          ><canvas class="stitch-canvas" {@attach self.preview?.()}
          ></canvas></div
        >

        <ul class="fs-list">
          {#each self.items ?? [] as item (item?.id)}
            <li class="fs-row fc-row">
              <Icon name="image" size={16} />
              <div class="fs-row-info">
                <span class="fs-row-name">{item?.file?.name}</span>
                <span class="fs-row-size"
                  >{formatBytes(item?.file?.size)}{#if truthy(item?.size)}
                    →
                    {formatBytes(item?.size)}{/if}</span
                >
              </div>
              <div class="fs-row-status">
                {#if truthy(item?.url)}
                  <a class="btn fs-save" href={item?.url} download={item?.name}
                    ><Icon name="download" size={13} /> Save</a
                  >
                  <PrintButton url={item?.url} name={item?.name} />
                {/if}
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
