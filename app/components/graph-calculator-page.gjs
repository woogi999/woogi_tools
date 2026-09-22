import Component from '@glimmer/component';
import { tracked, cached } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';
import ColourField from './colour-field';
import { compileFunction, formatNumber } from '../utils/math-expr';

const PALETTE = [
  '#E5484D',
  '#3E63DD',
  '#30A46C',
  '#F76B15',
  '#8E4EC6',
  '#12A594',
];
const DEFAULT_VIEW = { cx: 0, cy: 0, scale: 40 }; // scale = pixels per unit
const MIN_SCALE = 1e-4;
const MAX_SCALE = 1e6;

const dotStyle = (color) => htmlSafe(`background:${color};`);

let nextFnId = 1;
const newFunction = (expr, index) => ({
  id: nextFnId++,
  expr,
  color: PALETTE[index % PALETTE.length],
  visible: true,
});

// Grid steps snap to 1, 2 or 5 × 10ⁿ so labels stay round at any zoom.
function niceStep(raw) {
  const power = 10 ** Math.floor(Math.log10(raw));
  const mantissa = raw / power;
  const nice = mantissa <= 1 ? 1 : mantissa <= 2 ? 2 : mantissa <= 5 ? 5 : 10;
  return { step: nice * power, minor: (nice * power) / (nice === 2 ? 4 : 5) };
}

const label = (value, step) =>
  formatNumber(
    Math.abs(value) < step / 1e6 ? 0 : parseFloat(value.toPrecision(12)),
    8,
  );

export default class GraphCalculatorPage extends Component {
  @tracked functions = [
    newFunction('sin(x)', 0),
    newFunction('x^2 / 4 - 2', 1),
  ];
  @tracked view = DEFAULT_VIEW;
  @tracked hover = null; // { px, py } in CSS pixels

  // Bumped on resize and theme change so the redraw modifier re-runs.
  @tracked sizeVersion = 0;
  canvas = null;
  width = 0;
  height = 0;
  dragging = false;

  @cached
  get compiled() {
    return this.functions.map((f) => {
      const text = f.expr.replace(/^\s*(y|f\(x\))\s*=/i, '').trim();
      if (!text) return { ...f, fn: null, error: null };
      try {
        return { ...f, fn: compileFunction(text), error: null };
      } catch (error) {
        return { ...f, fn: null, error: error.message };
      }
    });
  }

  // ─── Coordinates ─────────────────────────────────────────────────────

  toWorldX = (px) => this.view.cx + (px - this.width / 2) / this.view.scale;
  toWorldY = (py) => this.view.cy - (py - this.height / 2) / this.view.scale;
  toPx = (x) => this.width / 2 + (x - this.view.cx) * this.view.scale;
  toPy = (y) => this.height / 2 - (y - this.view.cy) * this.view.scale;

  get readout() {
    if (!this.hover) return null;
    const x = this.toWorldX(this.hover.px);
    const y = this.toWorldY(this.hover.py);
    const { step } = niceStep(80 / this.view.scale);
    const digits = Math.max(2, -Math.floor(Math.log10(step)) + 2);
    const round = (v) =>
      formatNumber(parseFloat(v.toFixed(Math.min(digits, 12))));
    return {
      point: `(${round(x)}, ${round(y)})`,
      values: this.compiled
        .filter((f) => f.fn && f.visible)
        .map((f) => {
          const value = f.fn(x);
          return {
            id: f.id,
            color: f.color,
            text: Number.isFinite(value) ? round(value) : 'undefined',
          };
        }),
    };
  }

  // ─── Canvas lifecycle ────────────────────────────────────────────────

  setupCanvas = modifier((canvas) => {
    this.canvas = canvas;
    const resize = new ResizeObserver(() => {
      const ratio = window.devicePixelRatio || 1;
      this.width = canvas.clientWidth;
      this.height = canvas.clientHeight;
      canvas.width = Math.round(this.width * ratio);
      canvas.height = Math.round(this.height * ratio);
      this.sizeVersion++;
    });
    resize.observe(canvas);
    const theme = new MutationObserver(() => this.sizeVersion++);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => {
      resize.disconnect();
      theme.disconnect();
    };
  });

  // Consuming the args is what makes this re-run when any of them change.
  redraw = modifier((canvas, [compiled, view, hover, sizeVersion]) => {
    if (sizeVersion) this.draw(canvas, compiled, view, hover);
  });

  draw(canvas, compiled, view, hover) {
    const ctx = canvas.getContext('2d');
    const ratio = window.devicePixelRatio || 1;
    const { width: w, height: h } = this;
    const styles = getComputedStyle(canvas);
    const colour = (name) => styles.getPropertyValue(name).trim();
    const text = colour('--text');
    const border = colour('--border-color');
    const faint = colour('--text-faint');
    const dim = colour('--text-dim');

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const left = this.toWorldX(0);
    const right = this.toWorldX(w);
    const top = this.toWorldY(0);
    const bottom = this.toWorldY(h);
    const { step, minor } = niceStep(80 / view.scale);

    const lines = (spacing, stroke, lineWidth) => {
      ctx.beginPath();
      for (
        let x = Math.ceil(left / spacing) * spacing;
        x <= right;
        x += spacing
      ) {
        const px = Math.round(this.toPx(x)) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, h);
      }
      for (
        let y = Math.ceil(bottom / spacing) * spacing;
        y <= top;
        y += spacing
      ) {
        const py = Math.round(this.toPy(y)) + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(w, py);
      }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    };
    ctx.globalAlpha = 0.35;
    lines(minor, border, 1);
    ctx.globalAlpha = 1;
    lines(step, border, 1);

    // Axes, pinned to the edge when the origin is off screen so labels stay visible.
    const axisX = Math.min(Math.max(this.toPx(0), 0), w);
    const axisY = Math.min(Math.max(this.toPy(0), 0), h);
    ctx.beginPath();
    ctx.moveTo(0, Math.round(this.toPy(0)) + 0.5);
    ctx.lineTo(w, Math.round(this.toPy(0)) + 0.5);
    ctx.moveTo(Math.round(this.toPx(0)) + 0.5, 0);
    ctx.lineTo(Math.round(this.toPx(0)) + 0.5, h);
    ctx.strokeStyle = text;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = dim;
    ctx.font = `11px ${styles.getPropertyValue('--font-mono') || 'monospace'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const labelY = Math.min(axisY + 4, h - 16);
    for (let x = Math.ceil(left / step) * step; x <= right; x += step) {
      if (Math.abs(x) < step / 2) continue;
      ctx.fillText(label(x, step), this.toPx(x), labelY);
    }
    ctx.textAlign = axisX > w - 40 ? 'right' : 'left';
    ctx.textBaseline = 'middle';
    const labelX = axisX > w - 40 ? axisX - 4 : axisX + 4;
    for (let y = Math.ceil(bottom / step) * step; y <= top; y += step) {
      if (Math.abs(y) < step / 2) continue;
      ctx.fillText(label(y, step), labelX, this.toPy(y));
    }
    if (left < 0 && right > 0 && bottom < 0 && top > 0) {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText('0', axisX - 4, axisY + 4);
    }

    // Curves: two samples per pixel, lifting the pen on gaps and on jumps across asymptotes.
    ctx.lineWidth = 2.25;
    ctx.lineJoin = 'round';
    for (const f of compiled) {
      if (!f.fn || !f.visible) continue;
      ctx.beginPath();
      ctx.strokeStyle = f.color;
      let penDown = false;
      let prevPy = 0;
      for (let px = 0; px <= w; px += 0.5) {
        const y = f.fn(this.toWorldX(px));
        if (!Number.isFinite(y)) {
          penDown = false;
          continue;
        }
        const py = Math.max(-1e5, Math.min(1e5, this.toPy(y)));
        const jump =
          penDown &&
          Math.abs(py - prevPy) > h * 2 &&
          (py < 0 || py > h || prevPy < 0 || prevPy > h);
        if (!penDown || jump) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
        penDown = true;
        prevPy = py;
      }
      ctx.stroke();
    }

    if (hover) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = faint;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hover.px + 0.5, 0);
      ctx.lineTo(hover.px + 0.5, h);
      ctx.stroke();
      ctx.setLineDash([]);
      const x = this.toWorldX(hover.px);
      for (const f of compiled) {
        if (!f.fn || !f.visible) continue;
        const y = f.fn(x);
        if (!Number.isFinite(y)) continue;
        const py = this.toPy(y);
        if (py < -10 || py > h + 10) continue;
        ctx.beginPath();
        ctx.arc(hover.px, py, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = f.color;
        ctx.fill();
        ctx.strokeStyle = colour('--bg-elevated');
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  // ─── Interaction ─────────────────────────────────────────────────────

  localPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { px: event.clientX - rect.left, py: event.clientY - rect.top };
  }

  // Panning starts on pointerdown, not pointerup: by the time the pointer
  // comes back up there is nothing left to drag. Hence the lint waiver on the
  // canvas in the template.
  startPan = (event) => {
    if (event.button !== 0) return;
    this.canvas.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY, view: this.view };
    this.dragging = true;
    const move = (e) => {
      const { scale, cx, cy } = start.view;
      this.view = {
        scale,
        cx: cx - (e.clientX - start.x) / scale,
        cy: cy + (e.clientY - start.y) / scale,
      };
    };
    const up = () => {
      this.dragging = false;
      this.canvas.removeEventListener('pointermove', move);
      this.canvas.removeEventListener('pointerup', up);
      this.canvas.removeEventListener('pointercancel', up);
    };
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
  };

  trackHover = (event) => {
    this.hover = this.localPoint(event);
  };

  clearHover = () => (this.hover = null);

  zoomAt(factor, px = this.width / 2, py = this.height / 2) {
    const wx = this.toWorldX(px);
    const wy = this.toWorldY(py);
    const scale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, this.view.scale * factor),
    );
    this.view = {
      scale,
      cx: wx - (px - this.width / 2) / scale,
      cy: wy + (py - this.height / 2) / scale,
    };
  }

  wheelZoom = (event) => {
    event.preventDefault();
    const { px, py } = this.localPoint(event);
    this.zoomAt(Math.exp(-event.deltaY * 0.0015), px, py);
  };

  zoomIn = () => this.zoomAt(1.5);
  zoomOut = () => this.zoomAt(1 / 1.5);
  resetView = () => (this.view = DEFAULT_VIEW);

  // ─── Function list ───────────────────────────────────────────────────

  updateFunction = (id, patch) =>
    (this.functions = this.functions.map((f) =>
      f.id === id ? { ...f, ...patch } : f,
    ));
  setExpr = (id, event) =>
    this.updateFunction(id, { expr: event.target.value });
  setColor = (id, hex) => this.updateFunction(id, { color: hex });
  toggleVisible = (f) => this.updateFunction(f.id, { visible: !f.visible });
  removeFunction = (id) =>
    (this.functions = this.functions.filter((f) => f.id !== id));
  addFunction = () =>
    (this.functions = [
      ...this.functions,
      newFunction('', this.functions.length),
    ]);

  <template>
    <ToolPage
      @route="graph-calculator"
      @subtitle="Type some functions of x and watch them plot. Drag to pan, scroll to zoom, hover to trace."
    >
      <div class="graph pop-in">
        <section class="math-card graph-side">
          <h3 class="qr-heading">Functions</h3>
          <ul class="graph-fn-list">
            {{#each this.compiled key="id" as |f|}}
              <li class="graph-fn {{unless f.visible 'is-hidden'}}">
                <div class="graph-fn-main">
                  <span class="graph-fn-prefix">y =</span>
                  <input
                    type="text"
                    class="graph-fn-input"
                    aria-label="Function"
                    placeholder="e.g. 2x + 1"
                    spellcheck="false"
                    value={{f.expr}}
                    {{on "input" (fn this.setExpr f.id)}}
                  />
                  <button
                    type="button"
                    class="fs-remove"
                    aria-label={{if f.visible "Hide" "Show"}}
                    {{on "click" (fn this.toggleVisible f)}}
                  ><Icon
                      @name={{if f.visible "eye" "eye-off"}}
                      @size={{14}}
                    /></button>
                  <button
                    type="button"
                    class="fs-remove"
                    aria-label="Remove function"
                    {{on "click" (fn this.removeFunction f.id)}}
                  ><Icon @name="x" @size={{14}} /></button>
                </div>
                <div class="graph-fn-meta">
                  <ColourField
                    @label="Line colour"
                    @value={{f.color}}
                    @onChange={{fn this.setColor f.id}}
                  />
                  {{#if f.error}}<span
                      class="tool-error"
                    >{{f.error}}</span>{{/if}}
                </div>
              </li>
            {{/each}}
          </ul>
          <button
            type="button"
            class="btn math-use"
            {{on "click" this.addFunction}}
          ><Icon @name="plus" @size={{13}} /> Add function</button>
          <p class="tool-hint">Try sin(x)/x, abs(x) - 2, sqrt(9 - x^2), 1/x,
            e^(-x^2) or floor(x). Angles are in radians.</p>
        </section>

        <section class="math-card graph-plot">
          <div class="graph-canvas-wrap">
            {{! template-lint-disable no-pointer-down-event-binding }}
            <canvas
              class="graph-canvas"
              aria-label="Graph"
              {{this.setupCanvas}}
              {{this.redraw
                this.compiled
                this.view
                this.hover
                this.sizeVersion
              }}
              {{on "pointerdown" this.startPan}}
              {{on "pointermove" this.trackHover}}
              {{on "pointerleave" this.clearHover}}
              {{on "wheel" this.wheelZoom passive=false}}
            ></canvas>
            <div class="graph-tools">
              <button
                type="button"
                class="editor-tool"
                aria-label="Zoom in"
                title="Zoom in"
                {{on "click" this.zoomIn}}
              ><Icon @name="zoom-in" @size={{15}} /></button>
              <button
                type="button"
                class="editor-tool"
                aria-label="Zoom out"
                title="Zoom out"
                {{on "click" this.zoomOut}}
              ><Icon @name="zoom-out" @size={{15}} /></button>
              <button
                type="button"
                class="editor-tool"
                aria-label="Reset view"
                title="Reset view"
                {{on "click" this.resetView}}
              ><Icon @name="locate-fixed" @size={{15}} /></button>
            </div>
          </div>
          <div class="graph-readout">
            {{#if this.readout}}
              <span class="graph-point">{{this.readout.point}}</span>
              {{#each this.readout.values as |v|}}
                <span class="graph-value"><span
                    class="graph-dot"
                    style={{dotStyle v.color}}
                  ></span>{{v.text}}</span>
              {{/each}}
            {{else}}
              <span class="tool-hint">Hover the graph to trace</span>
            {{/if}}
          </div>
        </section>
      </div>
    </ToolPage>
  </template>
}
