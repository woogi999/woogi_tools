<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { modifier } from '../core/modifier.js';
  import { truthy } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import ColourField from './colour-field.svelte';
  import CopyButton from './copy-button.svelte';
  import { toHex, parseHex, rgbToHsl } from '../utils/color.js';
  import { acceptPastedFiles } from '../utils/paste-files.js';

  const HISTORY_LIMIT = 16;

  class PixelEyedropperPage extends Component {
    imageUrl = $state.raw(null);
    bitmap = $state.raw(null);
    zoomPct = $state.raw(0);
    zoomPos = $state.raw({ x: 0, y: 0 });
    r = $state.raw(138);
    g = $state.raw(138);
    b = $state.raw(138);
    history = $state.raw([]);
    error = $state.raw(null);

    canvas = null;
    ctx = null;

    get hex() {
      return toHex(this.r, this.g, this.b);
    }

    get hsl() {
      return rgbToHsl(this.r, this.g, this.b);
    }

    get rgbText() {
      return `rgb(${this.r}, ${this.g}, ${this.b})`;
    }

    get hslText() {
      return `hsl(${this.hsl.h}, ${this.hsl.s}%, ${this.hsl.l}%)`;
    }

    get zoomStyle() {
      if (!this.zoomPct) return 'display:none';
      return `background-image:url(${this.imageUrl});background-position:${this.zoomPos.x}% ${this.zoomPos.y}%`;
    }

    get swatchStyle() {
      return `background:${this.hex}`;
    }

    setupCanvas = modifier((canvas) => {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { willReadFrequently: true });
      this.draw();
    });

    async draw() {
      if (!this.bitmap || !this.canvas) return;
      const { width, height } = this.bitmap;
      this.canvas.width = width;
      this.canvas.height = height;
      this.ctx.drawImage(this.bitmap, 0, 0);
    }

    openFile = async (file) => {
      if (!file || !file.type.startsWith('image/')) return;
      try {
        const bitmap = await createImageBitmap(file);
        if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
        this.imageUrl = URL.createObjectURL(file);
        this.bitmap = bitmap;
        this.error = null;
        this.draw();
      } catch {
        this.error =
          "This browser can't open that image. Try the File Converter first.";
      }
    };

    selectFile = (e) => {
      this.openFile(e.target.files?.[0]);
      e.target.value = '';
    };

    dragOver = (e) => e.preventDefault();
    drop = (e) => {
      e.preventDefault();
      this.openFile(e.dataTransfer.files?.[0]);
    };

    sampleAt = (clientX, clientY) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = Math.floor(
        ((clientX - rect.left) / rect.width) * this.canvas.width,
      );
      const y = Math.floor(
        ((clientY - rect.top) / rect.height) * this.canvas.height,
      );
      if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height)
        return;
      const [r, g, b] = this.ctx.getImageData(x, y, 1, 1).data;
      this.r = r;
      this.g = g;
      this.b = b;
      this.zoomPos = {
        x: (x / this.canvas.width) * 100,
        y: (y / this.canvas.height) * 100,
      };
    };

    move = (e) => {
      if (!this.bitmap) return;
      this.zoomPct = 1;
      this.sampleAt(e.clientX, e.clientY);
    };

    leave = () => (this.zoomPct = 0);

    pick = (e) => {
      this.move(e);
      const hex = toHex(this.r, this.g, this.b);
      this.history = [hex, ...this.history.filter((h) => h !== hex)].slice(
        0,
        HISTORY_LIMIT,
      );
    };

    setHex = (hex) => {
      const rgb = parseHex(hex);
      if (!rgb) return;
      this.r = rgb.r;
      this.g = rgb.g;
      this.b = rgb.b;
    };

    useHistory = (hex) => this.setHex(hex);

    pasteFiles = (files) => this.openFile(files[0]);
  }

  function htmlSwatch(hex) {
    return `background:${hex}`;
  }
</script>

<script>
  let args = $props();
  const self = new PixelEyedropperPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="pixel-eyedropper"
  subtitle="Upload an image and click anywhere to grab that exact colour. Colour thief mode: on."
>
  <div class="math-grid pop-in" {@attach acceptPastedFiles([self.pasteFiles])}>
    <section class="math-card">
      <label
        class="qr-drop {truthy(self.bitmap) ? 'is-filled' : ''}"
        ondrop={self.drop}
        ondragover={self.dragOver}
      >
        {#if !truthy(self.bitmap)}
          <Icon name="pipette" size={22} />
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

      {#if truthy(self.bitmap)}
        <div class="eyedrop-stage">
          <canvas
            class="eyedrop-canvas"
            onclick={self.pick}
            onmouseleave={self.leave}
            onmousemove={self.move}
            {@attach self.setupCanvas?.()}
          ></canvas>
          <div class="eyedrop-zoom" style={self.zoomStyle} aria-hidden="true"
          ></div>
        </div>
        <p class="tool-hint"
          >Click anywhere on the image to save that colour to your history.</p
        >
      {/if}
    </section>

    <section class="math-card">
      <h3 class="qr-heading">Sampled colour</h3>
      <div class="math-row is-aligned">
        <span class="eyedrop-swatch" style={self.swatchStyle}></span>
        <ColourField
          value={self.hex}
          label="Sampled colour"
          onChange={self.setHex}
        />
      </div>
      <div class="math-stats">
        <div class="math-stat">
          <span>RGB</span>
          <div class="field-head"
            ><strong>{self.rgbText}</strong><CopyButton
              value={self.rgbText}
            /></div
          >
        </div>
        <div class="math-stat">
          <span>HSL</span>
          <div class="field-head"
            ><strong>{self.hslText}</strong><CopyButton
              value={self.hslText}
            /></div
          >
        </div>
        <div class="math-stat">
          <span>HEX</span>
          <div class="field-head"
            ><strong>{self.hex}</strong><CopyButton value={self.hex} /></div
          >
        </div>
      </div>

      {#if truthy(self.history?.length)}
        <h3 class="qr-heading">History</h3>
        <div class="eyedrop-history">
          {#each self.history ?? [] as hex}
            <button
              type="button"
              class="eyedrop-chip"
              style={htmlSwatch(hex)}
              title={hex}
              onclick={(..._r) => self.useHistory(hex, ..._r)}
            ></button>
          {/each}
        </div>
      {/if}
    </section>
  </div>
</ToolPage>
