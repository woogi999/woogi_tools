<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import Link from '../core/link.svelte';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import CopyButton from './copy-button.svelte';
  import { extractPalette, savePalette } from '../utils/palettes.js';
  import { acceptPastedFiles } from '../utils/paste-files.js';
  import { parseHex, rgbToHsl } from '../utils/color.js';

  const eq = (a, b) => a === b;
  const inkFor = (hex) => {
    const { r, g, b } = parseHex(hex);
    return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#000' : '#fff';
  };

  class PaletteExtractorPage extends Component {
    bitmap = $state.raw(null);
    imageUrl = $state.raw(null);
    fileName = $state.raw('image');
    count = $state.raw(6);
    colours = $state.raw([]);
    error = $state.raw(null);
    justSaved = $state.raw(false);
    copied = $state.raw(null);

    constructor(args) {
      super(args);
      registerDestructor(this, () => {
        if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
      });
    }

    get swatches() {
      return this.colours.map((c) => {
        const { r, g, b } = parseHex(c.hex);
        const { h, s, l } = rgbToHsl(r, g, b);
        return {
          ...c,
          percent: Math.round(c.share * 100),
          rgb: `rgb(${r}, ${g}, ${b})`,
          hsl: `hsl(${h}, ${s}%, ${l}%)`,
          style: `background:${c.hex};color:${inkFor(c.hex)}`,
          barStyle: `flex:${Math.max(0.02, c.share)};background:${c.hex}`,
        };
      });
    }

    get list() {
      return this.colours.map((c) => c.hex).join(', ');
    }

    get css() {
      return `:root {\n${this.colours
        .map((c, i) => `  --colour-${i + 1}: ${c.hex.toLowerCase()};`)
        .join('\n')}\n}`;
    }

    openFile = async (file) => {
      if (!file || !file.type.startsWith('image/')) return;
      try {
        const bitmap = await createImageBitmap(file);
        if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
        this.imageUrl = URL.createObjectURL(file);
        this.fileName = file.name.replace(/\.[^.]+$/, '');
        this.bitmap = bitmap;
        this.error = null;
        this.extract();
      } catch {
        this.error =
          "This browser can't open that image. Try the File Converter first.";
      }
    };

    extract = () => {
      if (!this.bitmap) return;
      this.colours = extractPalette(this.bitmap, this.count);
      this.justSaved = false;
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

    pasteFiles = (files) => this.openFile(files[0]);

    setCount = (event) => {
      this.count = Math.max(2, Math.min(12, Number(event.target.value) || 6));
      this.extract();
    };

    copyOne = async (hex) => {
      try {
        await navigator.clipboard.writeText(hex);
        this.copied = hex;
        setTimeout(() => {
          if (this.copied === hex) this.copied = null;
        }, 1200);
      } catch {
        // clipboard blocked
      }
    };

    save = () => {
      if (!this.colours.length) return;
      savePalette(
        this.colours.map((c) => c.hex),
        this.fileName,
      );
      this.justSaved = true;
    };
  }
</script>

<script>
  let args = $props();
  const self = new PaletteExtractorPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="palette-extractor"
  subtitle="Drop in a picture and get the colours it's made of, biggest first, as hex codes you can copy or keep."
>
  <div class="math-grid pop-in" {@attach acceptPastedFiles([self.pasteFiles])}>
    <section class="math-card">
      <label
        class="qr-drop {truthy(self.bitmap) ? 'is-filled' : ''}"
        ondrop={self.dropFile}
        ondragover={self.dragOverFile}
      >
        {#if truthy(self.bitmap)}
          <img src={self.imageUrl} alt="" class="pex-picture" />
        {:else}
          <Icon name="palette" size={22} />
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
        <span class="qr-label is-muted"
          >Colours to find:
          {self.count}</span
        >
        <input
          type="range"
          min="2"
          max="12"
          {@attach prop('value', () => self.count)}
          oninput={self.setCount}
        />
      </label>
      {#if truthy(self.bitmap)}
        <div class="settings-actions">
          <button type="button" class="btn" onclick={self.extract}>
            <Icon name="refresh-cw" size={13} />
            Run again</button
          >
        </div>
        <p class="tool-hint"
          >The grouping starts from random picks, so running it again can shift
          the colours a little.</p
        >
      {/if}
    </section>

    <section class="math-card">
      <h3 class="qr-heading">Colours</h3>
      {#if truthy(self.colours?.length)}
        <div class="pex-bar" aria-hidden="true">
          {#each self.swatches ?? [] as s}
            <span style={s?.barStyle}></span>
          {/each}
        </div>
        <ul class="pex-list">
          {#each self.swatches ?? [] as s}
            <li class="pex-row">
              <button
                type="button"
                class="pex-swatch"
                style={s?.style}
                title="Copy {s?.hex}"
                onclick={(..._r) => self.copyOne(s?.hex, ..._r)}
                >{truthy(eq(self.copied, s?.hex)) ? 'Copied' : s?.hex}</button
              >
              <div class="pex-meta">
                <span>{s?.rgb}</span>
                <span>{s?.hsl}</span>
                <span class="is-muted">{s?.percent}% of the picture</span>
              </div>
            </li>
          {/each}
        </ul>
        <div class="settings-actions">
          <button type="button" class="btn active" onclick={self.save}>
            <Icon name={truthy(self.justSaved) ? 'check' : 'save'} size={13} />
            {truthy(self.justSaved) ? 'Saved' : 'Save to my palettes'}</button
          >
          <CopyButton value={self.list} label="Copy hex list" />
          <CopyButton value={self.css} label="Copy as CSS" />
        </div>
        <p class="tool-hint"
          >Saved palettes live in the
          <Link route="palette">Palette</Link>
          tool.</p
        >
      {:else}
        <p class="tool-hint">Upload a picture to pull its colours out.</p>
      {/if}
    </section>
  </div>
</ToolPage>
