import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import ToolPage from './tool-page';

const PRESETS = [
  { label: '16:9', w: 16, h: 9, note: 'HD video, most monitors' },
  { label: '9:16', w: 9, h: 16, note: 'Phone video, Stories, Reels' },
  { label: '4:3', w: 4, h: 3, note: 'Classic TV, iPad' },
  { label: '3:2', w: 3, h: 2, note: '35mm photos' },
  { label: '1:1', w: 1, h: 1, note: 'Square posts' },
  { label: '4:5', w: 4, h: 5, note: 'Instagram portrait' },
  { label: '21:9', w: 21, h: 9, note: 'Ultrawide' },
  { label: '2.39:1', w: 2.39, h: 1, note: 'Cinemascope' },
];

// Screens are often "nearly" a named ratio (1366×768 is really 683:384), so match within a tolerance.
const NAMED = PRESETS.filter((p) => p.w >= p.h || p.w === 1);

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const round = (n) => parseFloat(n.toFixed(2));

export default class AspectRatioPage extends Component {
  presets = PRESETS;

  @tracked width = '1920';
  @tracked height = '1080';
  @tracked newWidth = '1280';
  @tracked newHeight = '';

  get w() {
    return Math.abs(Number(this.width));
  }

  get h() {
    return Math.abs(Number(this.height));
  }

  get valid() {
    return this.w > 0 && this.h > 0 && Number.isFinite(this.w) && Number.isFinite(this.h);
  }

  get simplified() {
    if (!this.valid) return '—';
    if (Number.isInteger(this.w) && Number.isInteger(this.h)) {
      const d = gcd(this.w, this.h);
      return `${this.w / d}:${this.h / d}`;
    }
    return `${round(this.w / this.h)}:1`;
  }

  get decimal() {
    return this.valid ? round(this.w / this.h).toString() : '—';
  }

  get closest() {
    if (!this.valid) return null;
    const ratio = this.w / this.h;
    const landscape = ratio >= 1 ? ratio : 1 / ratio;
    const best = NAMED.map((p) => ({ p, off: Math.abs(p.w / p.h - landscape) / landscape })).sort((a, b) => a.off - b.off)[0];
    if (best.off > 0.03) return null;
    const label = ratio >= 1 ? best.p.label : best.p.label.split(':').reverse().join(':');
    const exact = Math.abs(this.w * best.p.h - this.h * best.p.w) < 1e-9 || Math.abs(this.h * best.p.h - this.w * best.p.w) < 1e-9;
    return exact ? `Exactly ${label}` : `About ${label}`;
  }

  get previewStyle() {
    const ratio = this.valid ? this.w / this.h : 16 / 9;
    const box = 160;
    const pw = ratio >= 1 ? box : box * ratio;
    const ph = ratio >= 1 ? box / ratio : box;
    return htmlSafe(`width:${pw}px;height:${ph}px`);
  }

  get resized() {
    if (!this.valid) return { width: '', height: '' };
    const nw = Number(this.newWidth);
    const nh = Number(this.newHeight);
    if (this.newWidth !== '' && nw > 0) return { width: this.newWidth, height: round((nw * this.h) / this.w).toString(), from: 'width' };
    if (this.newHeight !== '' && nh > 0) return { width: round((nh * this.w) / this.h).toString(), height: this.newHeight, from: 'height' };
    return { width: '', height: '' };
  }

  setWidth = (e) => (this.width = e.target.value);
  setHeight = (e) => (this.height = e.target.value);

  setNewWidth = (e) => {
    this.newWidth = e.target.value;
    this.newHeight = '';
  };

  setNewHeight = (e) => {
    this.newHeight = e.target.value;
    this.newWidth = '';
  };

  usePreset = (p) => {
    // Keep the current width and fit the height to the chosen ratio.
    const base = this.w > 0 ? this.w : 1920;
    this.width = String(base);
    this.height = String(Math.round((base * p.h) / p.w));
  };

  swap = () => ([this.width, this.height] = [this.height, this.width]);

  <template>
    <ToolPage @route="aspect-ratio" @subtitle="Turn a resolution into its aspect ratio, or resize while keeping the proportions right.">
      <div class="math-grid pop-in">
        <section class="math-card">
          <h3 class="qr-heading">Dimensions</h3>
          <div class="math-row is-aligned">
            <label class="math-field"><span class="qr-label is-muted">Width</span><input type="number" min="0" step="any" class="math-input" value={{this.width}} {{on "input" this.setWidth}} /></label>
            <button type="button" class="btn math-swap" aria-label="Swap width and height" {{on "click" this.swap}}>⇄</button>
            <label class="math-field"><span class="qr-label is-muted">Height</span><input type="number" min="0" step="any" class="math-input" value={{this.height}} {{on "input" this.setHeight}} /></label>
          </div>
          <div class="ar-result">
            <div class="math-result">
              <span class="qr-label is-muted">Aspect ratio</span>
              <span class="math-big">{{this.simplified}}</span>
              <span class="tool-hint">{{this.decimal}} : 1{{#if this.closest}} · {{this.closest}}{{/if}}</span>
            </div>
            <div class="ar-preview" style={{this.previewStyle}} aria-hidden="true"></div>
          </div>
          <div class="line-actions">
            {{#each this.presets as |p|}}
              <button type="button" class="btn" title={{p.note}} {{on "click" (fn this.usePreset p)}}>{{p.label}}</button>
            {{/each}}
          </div>
        </section>

        <section class="math-card">
          <h3 class="qr-heading">Resize to fit</h3>
          <p class="tool-hint">Type a new width or height; the other is worked out to keep {{this.simplified}}.</p>
          <div class="math-row">
            <label class="math-field"><span class="qr-label is-muted">New width</span><input type="number" min="0" step="any" class="math-input" value={{this.resized.width}} {{on "input" this.setNewWidth}} /></label>
            <label class="math-field"><span class="qr-label is-muted">New height</span><input type="number" min="0" step="any" class="math-input" value={{this.resized.height}} {{on "input" this.setNewHeight}} /></label>
          </div>
          {{#if this.resized.width}}
            <p class="math-callout">{{this.resized.width}} × {{this.resized.height}}</p>
          {{/if}}
        </section>
      </div>
    </ToolPage>
  </template>
}
