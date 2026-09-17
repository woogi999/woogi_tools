import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import ToolPage from './tool-page';
import ColourField from './colour-field';
import { parseHex, rgbToHsl, hslToRgb, toHex } from '../utils/color';
import { keepState } from '../utils/tool-state';

// WCAG 2.x relative luminance of an sRGB colour.
function luminance(hex) {
  const { r, g, b } = parseHex(hex);
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const CHECKS = [
  { id: 'aaNormal', label: 'AA · body text', min: 4.5 },
  { id: 'aaLarge', label: 'AA · large text', min: 3 },
  { id: 'aaaNormal', label: 'AAA · body text', min: 7 },
  { id: 'aaaLarge', label: 'AAA · large text', min: 4.5 },
  { id: 'ui', label: 'AA · icons & borders', min: 3 },
];

// Walks the foreground's lightness away from the background until it passes,
// keeping hue and saturation so the fix still looks like the chosen colour.
function nearestPassing(fg, bg, min) {
  const { r, g, b } = parseHex(fg);
  const { h, s, l } = rgbToHsl(r, g, b);
  const candidates = [];
  for (const direction of [-1, 1]) {
    for (let step = 1; step <= 100; step++) {
      const next = l + direction * step;
      if (next < 0 || next > 100) break;
      const rgb = hslToRgb(h, s, next);
      const hex = toHex(rgb.r, rgb.g, rgb.b);
      if (contrast(hex, bg) >= min) {
        candidates.push({ hex, distance: step });
        break;
      }
    }
  }
  return candidates.sort((x, y) => x.distance - y.distance)[0]?.hex ?? null;
}

const eq = (a, b) => a === b;

export default class ContrastCheckerPage extends Component {
  checks = CHECKS;

  @tracked foreground = '#6B7280';
  @tracked background = '#FFFFFF';
  @tracked target = 'aaNormal';

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'contrast-checker', ['foreground', 'background', 'target']);
  }

  get ratio() {
    return contrast(this.foreground, this.background);
  }

  get ratioText() {
    return `${(Math.floor(this.ratio * 100) / 100).toFixed(2)}:1`;
  }

  get results() {
    return CHECKS.map((c) => ({ ...c, pass: this.ratio >= c.min }));
  }

  get targetCheck() {
    return CHECKS.find((c) => c.id === this.target);
  }

  get suggestion() {
    const check = this.targetCheck;
    if (this.ratio >= check.min) return null;
    return nearestPassing(this.foreground, this.background, check.min);
  }

  get previewStyle() {
    return htmlSafe(`color:${this.foreground};background:${this.background};`);
  }

  get suggestionSwatch() {
    return htmlSafe(`background:${this.suggestion};`);
  }

  setForeground = (hex) => (this.foreground = hex);
  setBackground = (hex) => (this.background = hex);
  setTarget = (e) => (this.target = e.target.value);
  swap = () =>
    ([this.foreground, this.background] = [this.background, this.foreground]);
  applySuggestion = () => (this.foreground = this.suggestion);

  <template>
    <ToolPage
      @route="contrast-checker"
      @subtitle="Pop in your text and background colours to see if they pass WCAG contrast. Too faint? We’ll suggest a colour that works."
    >
      <div class="math-grid pop-in">
        <section class="math-card">
          <div class="math-row is-aligned">
            <div class="math-field"><span
                class="qr-label is-muted"
              >Text</span><ColourField
                @label="Text colour"
                @value={{this.foreground}}
                @onChange={{this.setForeground}}
              /></div>
            <button
              type="button"
              class="btn math-swap"
              aria-label="Swap colours"
              {{on "click" this.swap}}
            >⇄</button>
            <div class="math-field"><span
                class="qr-label is-muted"
              >Background</span><ColourField
                @label="Background colour"
                @value={{this.background}}
                @onChange={{this.setBackground}}
              /></div>
          </div>
          <div class="contrast-preview" style={{this.previewStyle}}>
            <span class="contrast-large">Large text looks like this</span>
            <span>Body text at a normal size, the kind people read for a while.</span>
            <span class="contrast-small">Small print and captions.</span>
          </div>
        </section>

        <section class="math-card">
          <div class="math-result">
            <span class="qr-label is-muted">Contrast ratio</span>
            <span class="math-big">{{this.ratioText}}</span>
          </div>
          <ul class="case-list">
            {{#each this.results as |r|}}
              <li class="case-item">
                <div class="case-text"><span
                    class="case-value"
                  >{{r.label}}</span><span class="tool-hint">needs
                    {{r.min}}:1</span></div>
                <span class="fs-tag {{if r.pass 'is-done' 'is-error'}}">{{if
                    r.pass
                    "Pass"
                    "Fail"
                  }}</span>
              </li>
            {{/each}}
          </ul>
          <label class="math-field">
            <span class="qr-label is-muted">Fix for</span>
            <select class="select" {{on "change" this.setTarget}}>
              {{#each this.checks as |c|}}
                <option
                  value={{c.id}}
                  selected={{eq this.target c.id}}
                >{{c.label}}</option>
              {{/each}}
            </select>
          </label>
          {{#if this.suggestion}}
            <div class="contrast-fix">
              <span
                class="contrast-swatch"
                style={{this.suggestionSwatch}}
                aria-hidden="true"
              ></span>
              <span>Try <code>{{this.suggestion}}</code> for the text.</span>
              <button
                type="button"
                class="btn"
                {{on "click" this.applySuggestion}}
              >Use it</button>
            </div>
          {{else}}
            <p class="tool-hint">These colours already pass
              {{this.targetCheck.label}}.</p>
          {{/if}}
          <p class="tool-hint">Large text means at least 24px, or 18.66px bold.</p>
        </section>
      </div>
    </ToolPage>
  </template>
}
