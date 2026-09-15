import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';

// The minimap in the top-right corner and arrows at the screen edge pointing to
// players you can't see. Both are drawn straight to the DOM each frame, outside tracking.
//
//   @getScene: () => scene with markers() -> [{ id, name, color, x, y, behind }] (x, y in -1..1)
//   @drawMap:  (ctx, size, scale) => void, drawing the whole field into a size×size square (scale: canvas pixels per CSS pixel)
//   @hideMap:  hides the minimap (the arrows stay)
//   @expandable: tapping the minimap blows it up (and tapping again shrinks it)

const MAP_EVERY_MS = 100;
const EDGE_X = 0.9;
const EDGE_Y = 0.82;

export default class ArcadeRadar extends Component {
  @tracked big = false;
  redraw = false;

  toggleBig = () => {
    if (!this.args.expandable) return;
    this.big = !this.big;
    this.redraw = true;
  };

  setup = modifier((root) => {
    const canvas = root.querySelector('.arcade-minimap');
    const layer = root.querySelector('.arcade-arrows');
    const ctx = canvas.getContext('2d');
    const arrows = new Map(); // id -> element
    let mapAt = 0;
    let frame = requestAnimationFrame(function step(now) {
      if ((this.redraw || now - mapAt > MAP_EVERY_MS) && canvas.offsetWidth) {
        mapAt = now;
        this.redraw = false;
        const scale = Math.min(2, window.devicePixelRatio || 1);
        const size = Math.round(canvas.offsetWidth * scale);
        if (canvas.width !== size) canvas.width = canvas.height = size;
        ctx.clearRect(0, 0, size, size);
        this.args.drawMap?.(ctx, size, scale);
      }
      this.placeArrows(layer, arrows);
      frame = requestAnimationFrame(step.bind(this));
    }.bind(this));
    return () => cancelAnimationFrame(frame);
  });

  placeArrows(layer, arrows) {
    const markers = this.args.getScene?.()?.markers?.() ?? [];
    const seen = new Set();
    for (const m of markers) {
      let { x, y } = m;
      // Behind the camera the projection flips: point the other way.
      if (m.behind) {
        x = -x;
        y = -y;
      }
      const onScreen = !m.behind && Math.abs(x) < EDGE_X && Math.abs(y) < EDGE_Y;
      if (onScreen) continue;
      seen.add(m.id);
      let el = arrows.get(m.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'arcade-arrow';
        el.innerHTML = '<span class="arcade-arrow-head"></span><span class="arcade-arrow-name"></span>';
        layer.append(el);
        arrows.set(m.id, el);
      }
      const sy = -y; // screen y runs down
      const scale = Math.min(EDGE_X / Math.max(Math.abs(x), 1e-3), EDGE_Y / Math.max(Math.abs(sy), 1e-3));
      const px = x * scale;
      const py = sy * scale;
      el.style.left = `${((px + 1) / 2) * 100}%`;
      el.style.top = `${((py + 1) / 2) * 100}%`;
      el.style.setProperty('--arrow-color', m.color);
      el.firstChild.style.transform = `rotate(${Math.atan2(py, px)}rad)`;
      el.lastChild.textContent = m.name;
    }
    for (const [id, el] of arrows) {
      if (seen.has(id)) continue;
      el.remove();
      arrows.delete(id);
    }
  }

  <template>
    <div class="arcade-radar" {{this.setup}}>
      <div class="arcade-arrows" aria-hidden="true"></div>
      {{! template-lint-disable no-invalid-interactive }}
      <canvas class="uno-overlay arcade-minimap {{if @hideMap 'is-hidden'}} {{if @expandable 'is-expandable'}} {{if this.big 'is-big'}}" aria-hidden="true" {{on "click" this.toggleBig}}></canvas>
    </div>
  </template>
}
