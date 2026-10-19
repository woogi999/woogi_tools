<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import { SLICE_PRESETS } from '../utils/social-presets.js';
  import { acceptPastedFiles } from '../utils/paste-files.js';

  const GROUPS = groupByPlatform(SLICE_PRESETS);
  const eq = (a, b) => a === b;
  const MAX_BOX = 360;
  const TILE_SIZE = 1080;

  function groupByPlatform(list) {
    const map = new Map();
    for (const p of list) {
      if (!map.has(p.platform)) map.set(p.platform, []);
      map.get(p.platform).push(p);
    }
    return [...map].map(([platform, items]) => ({ platform, items }));
  }

  function range(n) {
    return Array.from({ length: n }, (_, i) => i);
  }

  class ImageSlicerPage extends Component {
    groups = GROUPS;

    bitmap = $state.raw(null);
    imageUrl = $state.raw(null);
    fileName = $state.raw('image');
    presetId = $state.raw('ig-3x1');
    customCols = $state.raw(2);
    customRows = $state.raw(2);
    tiles = $state.raw([]);
    zipUrl = $state.raw(null);
    error = $state.raw(null);

    constructor(args) {
      super(args);
      registerDestructor(this, () => this.revokeAll());
    }

    revokeAll() {
      if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
      if (this.zipUrl) URL.revokeObjectURL(this.zipUrl);
      for (const t of this.tiles) URL.revokeObjectURL(t.url);
    }

    get preset() {
      return SLICE_PRESETS.find((p) => p.id === this.presetId);
    }

    get cols() {
      return this.preset.id === 'custom'
        ? Math.max(1, this.customCols)
        : this.preset.cols;
    }

    get rows() {
      return this.preset.id === 'custom'
        ? Math.max(1, this.customRows)
        : this.preset.rows;
    }

    get gridCells() {
      return range(this.rows * this.cols).map((i) => ({
        id: i,
        row: Math.floor(i / this.cols),
        col: i % this.cols,
        n: i + 1,
      }));
    }

    get gridStyle() {
      return `grid-template-columns:repeat(${this.cols},1fr);grid-template-rows:repeat(${this.rows},1fr)`;
    }

    // Tiles are square, so the whole grid's aspect ratio is cols:rows.
    get viewportSize() {
      const ratio = this.cols / this.rows;
      if (ratio >= 1) return { vw: MAX_BOX, vh: MAX_BOX / ratio };
      return { vw: MAX_BOX * ratio, vh: MAX_BOX };
    }

    get viewportStyle() {
      const { vw, vh } = this.viewportSize;
      return `width:${vw}px;height:${vh}px`;
    }

    openFile = async (file) => {
      if (!file || !file.type.startsWith('image/')) return;
      try {
        const bitmap = await createImageBitmap(file);
        this.revokeAll();
        this.imageUrl = URL.createObjectURL(file);
        this.fileName = file.name.replace(/\.[^.]+$/, '');
        this.bitmap = bitmap;
        this.tiles = [];
        this.zipUrl = null;
        this.error = null;
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
      this.tiles = [];
      this.zipUrl = null;
    };

    setCustom = (key, event) => {
      this[key] = Math.max(
        1,
        Math.min(10, Math.floor(+event.target.value) || 1),
      );
      this.tiles = [];
      this.zipUrl = null;
    };

    slice = async () => {
      if (!this.bitmap) return;
      const { cols, rows } = this;
      const gridRatio = cols / rows;
      const imgRatio = this.bitmap.width / this.bitmap.height;
      // Cover-fit: crop the source to the grid's overall aspect before slicing.
      let cropW = this.bitmap.width;
      let cropH = this.bitmap.height;
      if (imgRatio > gridRatio) cropW = cropH * gridRatio;
      else cropH = cropW / gridRatio;
      const cropX = (this.bitmap.width - cropW) / 2;
      const cropY = (this.bitmap.height - cropH) / 2;
      const tileW = cropW / cols;
      const tileH = cropH / rows;

      for (const t of this.tiles) URL.revokeObjectURL(t.url);
      if (this.zipUrl) URL.revokeObjectURL(this.zipUrl);

      const tiles = [];
      const entries = {};
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const canvas = document.createElement('canvas');
          canvas.width = TILE_SIZE;
          canvas.height = TILE_SIZE;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(
            this.bitmap,
            cropX + col * tileW,
            cropY + row * tileH,
            tileW,
            tileH,
            0,
            0,
            TILE_SIZE,
            TILE_SIZE,
          );
          const blob = await new Promise((resolve) =>
            canvas.toBlob(resolve, 'image/png'),
          );
          const n = row * cols + col + 1;
          const name = `${this.fileName}-${String(n).padStart(2, '0')}.png`;
          entries[name] = new Uint8Array(await blob.arrayBuffer());
          tiles.push({ id: n, name, url: URL.createObjectURL(blob) });
        }
      }
      this.tiles = tiles;

      const { zipSync } = await import('fflate');
      this.zipUrl = URL.createObjectURL(
        new Blob([zipSync(entries, { level: 6 })], { type: 'application/zip' }),
      );
    };

    pasteFiles = (files) => this.openFile(files[0]);
  }
</script>

<script>
  let args = $props();
  const self = new ImageSlicerPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="image-slicer"
  subtitle="Slice a photo into a swipeable Instagram carousel or a profile grid, and preview it before you post."
>
  <div class="math-grid pop-in" {@attach acceptPastedFiles([self.pasteFiles])}>
    <section class="math-card">
      <label
        class="qr-drop {truthy(self.bitmap) ? 'is-filled' : ''}"
        ondrop={self.dropFile}
        ondragover={self.dragOverFile}
      >
        {#if !truthy(self.bitmap)}
          <Icon name="grid-3x3" size={22} />
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
        <span class="qr-label is-muted">Layout</span>
        <select class="select" onchange={self.setPreset}>
          {#each self.groups ?? [] as group}
            <optgroup label={group?.platform}>
              {#each group?.items ?? [] as p}
                <option
                  value={p?.id}
                  {@attach prop('selected', () => eq(p?.id, self.presetId))}
                  >{p?.label}</option
                >
              {/each}
            </optgroup>
          {/each}
        </select>
      </label>

      {#if truthy(eq(self.preset?.id, 'custom'))}
        <div class="math-row">
          <label class="math-field"
            ><span class="qr-label is-muted">Columns</span><input
              type="number"
              min="1"
              max="10"
              class="math-input"
              {@attach prop('value', () => self.customCols)}
              oninput={(..._r) => self.setCustom('customCols', ..._r)}
            /></label
          >
          <label class="math-field"
            ><span class="qr-label is-muted">Rows</span><input
              type="number"
              min="1"
              max="10"
              class="math-input"
              {@attach prop('value', () => self.customRows)}
              oninput={(..._r) => self.setCustom('customRows', ..._r)}
            /></label
          >
        </div>
      {/if}
      <p class="tool-hint"
        >Tiles are square. The photo is cropped to fit the grid before slicing,
        and each panel is saved at
        {TILE_SIZE}×{TILE_SIZE}px. For a carousel row, upload panel 1 first, in
        order.</p
      >
    </section>

    <section class="math-card">
      <h3 class="qr-heading">Preview</h3>
      {#if truthy(self.bitmap)}
        <div class="slice-viewport" style={self.viewportStyle}>
          <img src={self.imageUrl} alt="" class="slice-image" />
          <div class="slice-grid" style={self.gridStyle}>
            {#each self.gridCells ?? [] as cell (cell?.id)}
              <div class="slice-grid-cell"><span>{cell?.n}</span></div>
            {/each}
          </div>
        </div>
        <div class="settings-actions">
          <button type="button" class="btn active" onclick={self.slice}
            >Slice</button
          >
          {#if truthy(self.zipUrl)}<a
              class="btn fs-save"
              href={self.zipUrl}
              download="{self.fileName}-slices.zip"
              ><Icon name="download" size={13} />
              Save all (ZIP)</a
            >{/if}
        </div>

        {#if truthy(self.tiles?.length)}
          <div class="slice-results">
            {#each self.tiles ?? [] as tile (tile?.id)}
              <a class="slice-tile" href={tile?.url} download={tile?.name}>
                <img src={tile?.url} alt="Panel {tile?.id}" />
                <span class="tool-hint">{tile?.id}</span>
              </a>
            {/each}
          </div>
        {/if}
      {:else}
        <p class="tool-hint">Upload an image to preview the grid.</p>
      {/if}
    </section>
  </div>
</ToolPage>
