<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import CopyButton from './copy-button.svelte';
  import { acceptPastedFiles } from '../utils/paste-files.js';
  import { loadBitmap, canvasBlob } from '../utils/watermark.js';
  import {
    bannerText,
    imageToAscii,
    textToCanvas,
    TEXT_STYLES,
    RAMPS,
  } from '../utils/ascii-art.js';
  import { keepState } from '../utils/tool-state.js';

  // Big block letters from words, or a whole picture redrawn in characters.

  const eq = (a, b) => a === b;

  class AsciiArtPage extends Component {
    mode = $state.raw('text');
    text = $state.raw('HELLO');
    style = $state.raw('block');
    custom = $state.raw('');
    wrap = $state.raw(12);
    bitmap = $state.raw(null);
    fileName = $state.raw('');
    columns = $state.raw(80);
    ramp = $state.raw('classic');
    invert = $state.raw(false);
    contrast = $state.raw(1);
    dragging = $state.raw(false);
    error = $state.raw(null);
    pngUrl = $state.raw(null);

    styles = TEXT_STYLES;
    ramps = RAMPS;

    constructor(args) {
      super(args);
      keepState(this, 'ascii-art', [
        'mode',
        'text',
        'style',
        'custom',
        'wrap',
        'columns',
        'ramp',
        'invert',
        'contrast',
      ]);
      registerDestructor(this, () => {
        this.bitmap?.close?.();
        if (this.pngUrl) URL.revokeObjectURL(this.pngUrl);
      });
    }

    get output() {
      if (this.mode === 'text') {
        return bannerText(this.text, {
          style: this.style,
          custom: this.custom,
          wrap: this.wrap,
        });
      }
      if (!this.bitmap) return '';
      return imageToAscii(this.bitmap, {
        columns: this.columns,
        ramp: this.ramp,
        invert: this.invert,
        contrast: this.contrast,
      });
    }

    get isImage() {
      return this.mode === 'image';
    }

    get lineCount() {
      return this.output ? this.output.split('\n').length : 0;
    }

    get txtUrl() {
      return `data:text/plain;charset=utf-8,${encodeURIComponent(this.output)}`;
    }

    pick = (key, value) => (this[key] = value);
    setText = (event) => (this.text = event.target.value);
    setCustom = (event) => (this.custom = event.target.value);
    number = (key, event) => (this[key] = Number(event.target.value) || 0);
    toggleInvert = (event) => (this.invert = event.target.checked);

    async open(file) {
      if (!file?.type.startsWith('image/')) return;
      try {
        const bitmap = await loadBitmap(file);
        this.bitmap?.close?.();
        this.bitmap = bitmap;
        this.fileName = file.name;
        this.mode = 'image';
        this.error = null;
      } catch {
        this.error = `${file.name} couldn’t be read as an image`;
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

    savePng = async () => {
      if (!this.output) return;
      const dark = document.documentElement.dataset.theme === 'dark';
      const canvas = textToCanvas(this.output, {
        fontSize: 14,
        fg: dark ? '#f2f2f2' : '#111',
        bg: dark ? '#111' : '#fff',
      });
      const blob = await canvasBlob(canvas, 'image/png');
      if (this.pngUrl) URL.revokeObjectURL(this.pngUrl);
      this.pngUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = this.pngUrl;
      link.download = 'ascii-art.png';
      link.click();
    };
  }
</script>

<script>
  let args = $props();
  const self = new AsciiArtPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="ascii-art"
  subtitle="Big block letters from a word or two, or a whole picture redrawn in characters, with braille dots for the fine version. Copy it or save it as text or a picture."
>
  <div class="math-grid pop-in" {@attach acceptPastedFiles([self.pasteFiles])}>
    <section class="math-card">
      <div class="math-tabs" role="tablist" aria-label="Source">
        <button
          type="button"
          role="tab"
          class="qr-tab {truthy(eq(self.mode, 'text')) ? 'active' : ''}"
          aria-selected={truthy(eq(self.mode, 'text')) ? 'true' : 'false'}
          onclick={(..._r) => self.pick('mode', 'text', ..._r)}
          >From words</button
        >
        <button
          type="button"
          role="tab"
          class="qr-tab {truthy(eq(self.mode, 'image')) ? 'active' : ''}"
          aria-selected={truthy(eq(self.mode, 'image')) ? 'true' : 'false'}
          onclick={(..._r) => self.pick('mode', 'image', ..._r)}
          >From a picture</button
        >
      </div>

      {#if truthy(self.isImage)}
        <label
          class="qr-drop fs-drop {truthy(self.dragging) ? 'is-dragging' : ''}"
          ondrop={self.drop}
          ondragleave={self.dragOver}
          ondragover={self.dragOver}
        >
          <Icon name="image" size={22} />
          <span
            >{truthy(self.dragging)
              ? 'Drop it here'
              : truthy(self.fileName)
                ? self.fileName
                : 'Drop a picture, paste it, or click to browse'}</span
          >
          <input
            type="file"
            accept="image/*"
            class="sr-only"
            onchange={self.selectFile}
          />
        </label>
        <div class="math-field">
          <span class="qr-label is-muted">Characters</span>
          <div class="cipher-picks" role="group" aria-label="Character set">
            {#each self.ramps ?? [] as r}
              <button
                type="button"
                class="qr-tab {truthy(eq(self.ramp, r?.id)) ? 'active' : ''}"
                onclick={(..._r) => self.pick('ramp', r?.id, ..._r)}
                >{r?.label}</button
              >
            {/each}
          </div>
        </div>
        <div class="math-row">
          <label class="math-field"
            ><span class="qr-label is-muted"
              >Width:
              {self.columns}
              characters</span
            ><input
              type="range"
              min="20"
              max="200"
              {@attach prop('value', () => self.columns)}
              oninput={(..._r) => self.number('columns', ..._r)}
            /></label
          >
          <label class="math-field"
            ><span class="qr-label is-muted"
              >Contrast:
              {self.contrast}</span
            ><input
              type="range"
              min="0.5"
              max="3"
              step="0.1"
              {@attach prop('value', () => self.contrast)}
              oninput={(..._r) => self.number('contrast', ..._r)}
            /></label
          >
        </div>
        <label class="math-check"
          ><input
            type="checkbox"
            {@attach prop('checked', () => self.invert)}
            onchange={self.toggleInvert}
          />
          Light on dark (for a dark page)</label
        >
      {:else}
        <label class="math-field"
          ><span class="qr-label is-muted">The words</span><textarea
            class="textarea"
            rows="3"
            {@attach prop('value', () => self.text)}
            oninput={self.setText}></textarea></label
        >
        <div class="math-field">
          <span class="qr-label is-muted">Style</span>
          <div class="cipher-picks" role="group" aria-label="Style">
            {#each self.styles ?? [] as s}
              <button
                type="button"
                class="qr-tab {truthy(eq(self.style, s?.id)) ? 'active' : ''}"
                onclick={(..._r) => self.pick('style', s?.id, ..._r)}
                >{s?.label}</button
              >
            {/each}
          </div>
        </div>
        <div class="math-row">
          <label class="math-field"
            ><span class="qr-label is-muted">Or your own character</span><input
              type="text"
              class="math-input"
              maxlength="2"
              placeholder="e.g. $ or ♥"
              {@attach prop('value', () => self.custom)}
              oninput={self.setCustom}
            /></label
          >
          <label class="math-field"
            ><span class="qr-label is-muted"
              >Letters per row:
              {self.wrap}</span
            ><input
              type="range"
              min="4"
              max="30"
              {@attach prop('value', () => self.wrap)}
              oninput={(..._r) => self.number('wrap', ..._r)}
            /></label
          >
        </div>
      {/if}
      {#if truthy(self.error)}<p class="tool-error">{self.error}</p>{/if}
    </section>

    <section class="math-card">
      <div class="field-head">
        <h3 class="qr-heading"
          >Result
          {#if truthy(self.lineCount)}· {self.lineCount} lines{/if}</h3
        >
        <div class="settings-actions">
          <CopyButton value={self.output} />
          <a class="btn" href={self.txtUrl} download="ascii-art.txt"
            ><Icon name="download" size={13} />
            TXT</a
          >
          <button type="button" class="btn" onclick={self.savePng}
            ><Icon name="download" size={13} /> PNG</button
          >
        </div>
      </div>
      {#if truthy(self.output)}
        <pre class="ascii-out">{self.output}</pre>
      {:else}
        <p class="fs-empty"
          >{truthy(self.isImage)
            ? 'Drop a picture to see it in characters.'
            : 'Type something above.'}</p
        >
      {/if}
    </section>
  </div>
</ToolPage>
