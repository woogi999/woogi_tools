<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import ColourField from './colour-field.svelte';
  import CopyButton from './copy-button.svelte';
  import { keepState } from '../utils/tool-state.js';
  import {
    HARMONIES,
    generatePalette,
    loadPalettes,
    savePalette,
    removePalette,
  } from '../utils/palettes.js';
  import { parseHex, rgbToHsl } from '../utils/color.js';

  const eq = (a, b) => a === b;
  const swatchStyle = (hex) => `background:${hex}`;
  // Dark swatches get light text on top, and the other way round.
  const inkFor = (hex) => {
    const { r, g, b } = parseHex(hex) ?? { r: 0, g: 0, b: 0 };
    return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#000' : '#fff';
  };
  const textStyle = (hex) => `background:${hex};color:${inkFor(hex)}`;
  const hslOf = (hex) => {
    const rgb = parseHex(hex);
    if (!rgb) return '';
    const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
    return `hsl(${h}, ${s}%, ${l}%)`;
  };

  class PalettePage extends Component {
    harmonies = HARMONIES;

    colours = $state.raw([]);
    locked = $state.raw([]);
    harmony = $state.raw('analogous');
    count = $state.raw(5);
    name = $state.raw('');
    saved = $state.raw(loadPalettes());
    justSaved = $state.raw(false);

    constructor(args) {
      super(args);
      keepState(
        this,
        'palette',
        ['colours', 'locked', 'harmony', 'count'],
        () => {
          if (!this.colours.length) this.generate();
        },
      );
    }

    // Space rolls a new palette, as on the palette sites people know.
    keys = modifier(() => {
      const onKey = (event) => {
        if (
          event.code !== 'Space' ||
          event.target.closest('input, textarea, select, button')
        )
          return;
        event.preventDefault();
        this.generate();
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    });

    get swatches() {
      return this.colours.map((hex, i) => ({
        hex,
        i,
        locked: Boolean(this.locked[i]),
        hsl: hslOf(hex),
        style: swatchStyle(hex),
        inkStyle: `color:${inkFor(hex)}`,
      }));
    }

    get css() {
      return `:root {\n${this.colours
        .map((c, i) => `  --colour-${i + 1}: ${c.toLowerCase()};`)
        .join('\n')}\n}`;
    }

    get list() {
      return this.colours.join(', ');
    }

    generate = () => {
      const keep = this.colours.map((c, i) => (this.locked[i] ? c : null));
      this.colours = generatePalette(this.count, this.harmony, keep);
      this.locked = this.colours.map((_, i) => Boolean(keep[i]));
      this.justSaved = false;
    };

    setHarmony = (event) => {
      this.harmony = event.target.value;
      this.generate();
    };

    setCount = (event) => {
      const count = Math.max(2, Math.min(10, Number(event.target.value) || 5));
      this.count = count;
      if (count < this.colours.length) {
        this.colours = this.colours.slice(0, count);
        this.locked = this.locked.slice(0, count);
      } else {
        const keep = [
          ...this.colours,
          ...Array(count - this.colours.length).fill(null),
        ];
        this.colours = generatePalette(count, this.harmony, keep);
        this.locked = [
          ...this.locked,
          ...Array(count - this.locked.length).fill(false),
        ];
      }
    };

    setColour = (i, hex) => {
      this.colours = this.colours.map((c, j) => (j === i ? hex : c));
      this.justSaved = false;
    };

    toggleLock = (i) => {
      this.locked = this.colours.map((_, j) =>
        j === i ? !this.locked[j] : Boolean(this.locked[j]),
      );
    };

    remove = (i) => {
      if (this.colours.length <= 2) return;
      this.colours = this.colours.filter((_, j) => j !== i);
      this.locked = this.locked.filter((_, j) => j !== i);
      this.count = this.colours.length;
    };

    setName = (event) => (this.name = event.target.value);

    save = (event) => {
      event?.preventDefault();
      if (!this.colours.length) return;
      savePalette(this.colours, this.name);
      this.saved = loadPalettes();
      this.name = '';
      this.justSaved = true;
    };

    load = (palette) => {
      this.colours = [...palette.colours];
      this.locked = palette.colours.map(() => false);
      this.count = palette.colours.length;
      this.justSaved = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    forget = (palette) => {
      removePalette(palette.id);
      this.saved = loadPalettes();
    };
  }
</script>

<script>
  let args = $props();
  const self = new PalettePage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="palette"
  subtitle="Roll colours that go together, lock the keepers, and build up a collection you can come back to."
>
  <div class="palette-tool pop-in" {@attach self.keys?.()}>
    <div class="palette-controls">
      <label class="math-field">
        <span class="qr-label is-muted">Harmony</span>
        <select class="select" onchange={self.setHarmony}>
          {#each self.harmonies ?? [] as h}
            <option
              value={h?.id}
              {@attach prop('selected', () => eq(h?.id, self.harmony))}
              >{h?.label}</option
            >
          {/each}
        </select>
      </label>
      <label class="math-field palette-count">
        <span class="qr-label is-muted">Colours</span>
        <input
          type="number"
          min="2"
          max="10"
          class="math-input"
          {@attach prop('value', () => self.count)}
          onchange={self.setCount}
        />
      </label>
      <button type="button" class="btn active" onclick={self.generate}>
        <Icon name="shuffle" size={13} />
        Generate</button
      >
      <span class="tool-hint">or press Space</span>
    </div>

    <div class="palette-strip">
      {#each self.swatches ?? [] as s}
        <div
          class="palette-swatch {truthy(s?.locked) ? 'is-locked' : ''}"
          style={s?.style}
        >
          <div class="palette-swatch-tools">
            <button
              type="button"
              class="palette-icon-btn"
              style={s?.inkStyle}
              aria-pressed={truthy(s?.locked) ? 'true' : 'false'}
              title={truthy(s?.locked) ? 'Unlock' : 'Lock this colour'}
              onclick={(..._r) => self.toggleLock(s?.i, ..._r)}
              ><Icon
                name={truthy(s?.locked) ? 'lock' : 'lock-open'}
                size={15}
              /></button
            >
            <button
              type="button"
              class="palette-icon-btn"
              style={s?.inkStyle}
              title="Remove"
              onclick={(..._r) => self.remove(s?.i, ..._r)}
              ><Icon name="x" size={15} /></button
            >
          </div>
          <div class="palette-swatch-foot">
            <ColourField
              value={s?.hex}
              label="Colour {s?.i}"
              onChange={(..._r) => self.setColour(s?.i, ..._r)}
            />
            <span class="palette-hsl" style={s?.inkStyle}>{s?.hsl}</span>
          </div>
        </div>
      {/each}
    </div>

    <div class="palette-actions">
      <form class="palette-save" onsubmit={self.save}>
        <input
          type="text"
          class="math-input"
          placeholder="Name it (optional)"
          aria-label="Palette name"
          maxlength="40"
          {@attach prop('value', () => self.name)}
          oninput={self.setName}
        />
        <button type="submit" class="btn">
          <Icon name={truthy(self.justSaved) ? 'check' : 'save'} size={13} />
          {truthy(self.justSaved) ? 'Saved' : 'Save to my palettes'}</button
        >
      </form>
      <div class="settings-actions">
        <CopyButton value={self.list} label="Copy hex list" />
        <CopyButton value={self.css} label="Copy as CSS" />
      </div>
    </div>

    <section class="palette-collection">
      <h3 class="qr-heading">My palettes</h3>
      {#if truthy(self.saved?.length)}
        <div class="palette-saved-list">
          {#each self.saved ?? [] as p (p?.id)}
            <div class="palette-saved">
              <button
                type="button"
                class="palette-saved-strip"
                title="Open this palette"
                onclick={(..._r) => self.load(p, ..._r)}
              >
                {#each p?.colours ?? [] as c}
                  <span style={textStyle(c)}>{c}</span>
                {/each}
              </button>
              <div class="palette-saved-meta">
                <span class="palette-saved-name">{p?.name}</span>
                <button
                  type="button"
                  class="btn"
                  aria-label="Delete {p?.name}"
                  onclick={(..._r) => self.forget(p, ..._r)}
                  ><Icon name="trash-2" size={13} /></button
                >
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <p class="tool-hint"
          >Nothing saved yet. Roll a palette you like and save it; the Palette
          Extractor can add ones from your pictures too.</p
        >
      {/if}
    </section>
  </div>
</ToolPage>
