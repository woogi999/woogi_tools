import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';

// The logo's own colours, from the letters of "Woogi Tools".
const COLOURS = ['#ff7aa2', '#ff9a1f', '#ffe45c', '#45d98f', '#29d8f0'];

const style = (vars) =>
  htmlSafe(
    Object.entries(vars)
      .map(([k, v]) => `--${k}:${v}`)
      .join(';'),
  );

const bands = (count) =>
  Array.from({ length: count }, (_, i) => ({
    style: style({ i, c: COLOURS[i % COLOURS.length] }),
  }));

// Roughly square cells over the window, each dot timed by its distance from the middle.
function dots() {
  const cols = Math.max(4, Math.ceil(window.innerWidth / 130));
  const rows = Math.max(4, Math.ceil(window.innerHeight / 130));
  const out = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const d = Math.hypot(
        (c + 0.5) / cols - 0.5,
        ((r + 0.5) / rows - 0.5) * (rows / cols),
      );
      out.push({
        style: style({
          d: d.toFixed(3),
          c: COLOURS[(r * 2 + c) % COLOURS.length],
        }),
      });
    }
  return { out, grid: style({ cols, rows }) };
}

// Covers the window between two pages; see services/stinger.js for when.
export default class LogoStinger extends Component {
  @service stinger;

  // Built once per stinger, so going from covering to uncovering keeps the same pieces.
  @cached
  get pieces() {
    const variant = this.stinger.current?.variant;
    if (variant === 'stripes') return { items: bands(5) };
    if (variant === 'blinds') return { items: bands(7) };
    if (variant === 'dots') {
      const { out, grid } = dots();
      return { items: out, style: grid };
    }
    return { items: [] };
  }

  get showsWordmark() {
    const variant = this.stinger.current?.variant;
    return variant !== 'hair' && variant !== 'bounce';
  }

  <template>
    {{#if this.stinger.current}}
      <div
        class="stinger stinger-{{this.stinger.current.variant}}
          is-{{this.stinger.phase}}"
        aria-hidden="true"
      >
        {{#let this.pieces as |pieces|}}
          <div class="stinger-pieces" style={{pieces.style}}>
            {{#each pieces.items as |piece|}}
              <span class="stinger-piece" style={{piece.style}}></span>
            {{/each}}
          </div>
        {{/let}}
        <img src="/favicon.png" alt="" class="stinger-head" />
        {{#if this.showsWordmark}}
          <img src="/icon_expanded.png" alt="" class="stinger-logo" />
        {{/if}}
      </div>
    {{/if}}
  </template>
}
