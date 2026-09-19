import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';
import ColourField from './colour-field';
import CopyButton from './copy-button';
import { keepState } from '../utils/tool-state';
import {
  HARMONIES,
  generatePalette,
  loadPalettes,
  savePalette,
  removePalette,
} from '../utils/palettes';
import { parseHex, rgbToHsl } from '../utils/color';

const eq = (a, b) => a === b;
const swatchStyle = (hex) => htmlSafe(`background:${hex}`);
// Dark swatches get light text on top, and the other way round.
const inkFor = (hex) => {
  const { r, g, b } = parseHex(hex) ?? { r: 0, g: 0, b: 0 };
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#000' : '#fff';
};
const textStyle = (hex) => htmlSafe(`background:${hex};color:${inkFor(hex)}`);
const hslOf = (hex) => {
  const rgb = parseHex(hex);
  if (!rgb) return '';
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  return `hsl(${h}, ${s}%, ${l}%)`;
};

export default class PalettePage extends Component {
  harmonies = HARMONIES;

  @tracked colours = [];
  @tracked locked = [];
  @tracked harmony = 'analogous';
  @tracked count = 5;
  @tracked name = '';
  @tracked saved = loadPalettes();
  @tracked justSaved = false;

  constructor(owner, args) {
    super(owner, args);
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
      inkStyle: htmlSafe(`color:${inkFor(hex)}`),
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

  <template>
    <ToolPage
      @route="palette"
      @subtitle="Roll colours that go together, lock the keepers, and build up a collection you can come back to."
    >
      <div class="palette-tool pop-in" {{this.keys}}>
        <div class="palette-controls">
          <label class="math-field">
            <span class="qr-label is-muted">Harmony</span>
            <select class="select" {{on "change" this.setHarmony}}>
              {{#each this.harmonies as |h|}}
                <option
                  value={{h.id}}
                  selected={{eq h.id this.harmony}}
                >{{h.label}}</option>
              {{/each}}
            </select>
          </label>
          <label class="math-field palette-count">
            <span class="qr-label is-muted">Colours</span>
            <input
              type="number"
              min="2"
              max="10"
              class="math-input"
              value={{this.count}}
              {{on "change" this.setCount}}
            />
          </label>
          <button type="button" class="btn active" {{on "click" this.generate}}>
            <Icon @name="shuffle" @size={{13}} />
            Generate</button>
          <span class="tool-hint">or press Space</span>
        </div>

        <div class="palette-strip">
          {{#each this.swatches as |s|}}
            <div
              class="palette-swatch {{if s.locked 'is-locked'}}"
              style={{s.style}}
            >
              <div class="palette-swatch-tools">
                <button
                  type="button"
                  class="palette-icon-btn"
                  style={{s.inkStyle}}
                  aria-pressed={{if s.locked "true" "false"}}
                  title={{if s.locked "Unlock" "Lock this colour"}}
                  {{on "click" (fn this.toggleLock s.i)}}
                ><Icon
                    @name={{if s.locked "lock" "lock-open"}}
                    @size={{15}}
                  /></button>
                <button
                  type="button"
                  class="palette-icon-btn"
                  style={{s.inkStyle}}
                  title="Remove"
                  {{on "click" (fn this.remove s.i)}}
                ><Icon @name="x" @size={{15}} /></button>
              </div>
              <div class="palette-swatch-foot">
                <ColourField
                  @value={{s.hex}}
                  @label="Colour {{s.i}}"
                  @onChange={{fn this.setColour s.i}}
                />
                <span class="palette-hsl" style={{s.inkStyle}}>{{s.hsl}}</span>
              </div>
            </div>
          {{/each}}
        </div>

        <div class="palette-actions">
          <form class="palette-save" {{on "submit" this.save}}>
            <input
              type="text"
              class="math-input"
              placeholder="Name it (optional)"
              aria-label="Palette name"
              maxlength="40"
              value={{this.name}}
              {{on "input" this.setName}}
            />
            <button type="submit" class="btn">
              <Icon @name={{if this.justSaved "check" "save"}} @size={{13}} />
              {{if this.justSaved "Saved" "Save to my palettes"}}</button>
          </form>
          <div class="settings-actions">
            <CopyButton @value={{this.list}} @label="Copy hex list" />
            <CopyButton @value={{this.css}} @label="Copy as CSS" />
          </div>
        </div>

        <section class="palette-collection">
          <h3 class="qr-heading">My palettes</h3>
          {{#if this.saved.length}}
            <div class="palette-saved-list">
              {{#each this.saved key="id" as |p|}}
                <div class="palette-saved">
                  <button
                    type="button"
                    class="palette-saved-strip"
                    title="Open this palette"
                    {{on "click" (fn this.load p)}}
                  >
                    {{#each p.colours as |c|}}
                      <span style={{textStyle c}}>{{c}}</span>
                    {{/each}}
                  </button>
                  <div class="palette-saved-meta">
                    <span class="palette-saved-name">{{p.name}}</span>
                    <button
                      type="button"
                      class="btn"
                      aria-label="Delete {{p.name}}"
                      {{on "click" (fn this.forget p)}}
                    ><Icon @name="trash-2" @size={{13}} /></button>
                  </div>
                </div>
              {{/each}}
            </div>
          {{else}}
            <p class="tool-hint">Nothing saved yet. Roll a palette you like and
              save it; the Palette Extractor can add ones from your pictures
              too.</p>
          {{/if}}
        </section>
      </div>
    </ToolPage>
  </template>
}
