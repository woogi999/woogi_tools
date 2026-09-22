import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { modifier } from 'ember-modifier';
import { EASINGS, ease, cubic } from '../../utils/ferrite/model';
import { resolveColour } from '../../utils/ferrite/theme';

const eq = (a, b) => a === b;
const gt = (a, b) => a > b;

// The Ease panel, ported from `ferrite-app/src/ui/easing.rs`.
//
// A curve is the one property of a keyframe you cannot read off a number, so
// the panel is mostly a picture — and the picture is the control. Both handles
// are draggable, the way After Effects' graph editor and Keyframe Wingman
// work: grab one, pull, and the motion changes under you.
//
// Picking a preset converts it to its own control points, so the handles carry
// on from where the preset left them rather than snapping back to a line.
const SIZE = 168;
const PAD = 18;

const AS_BEZIER = {
  linear: [0, 0, 1, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  expo: [0.7, 0, 0.84, 0],
  back: [0.68, -0.55, 0.27, 1.55],
  hold: [1, 0, 1, 0],
};

export default class EasePanel extends Component {
  easings = EASINGS;
  dragging = null;

  get editor() {
    return this.args.editor;
  }

  get selected() {
    return this.editor.selectedKey;
  }

  get count() {
    return this.editor.selectedKeys.length;
  }

  get easingId() {
    return this.selected?.key?.easing ?? 'linear';
  }

  // What the handles sit on: the keyframe's own curve once it has been
  // dragged, otherwise the preset it is set to, expressed as one.
  get bezier() {
    return (
      this.selected?.key?.bezier ?? AS_BEZIER[this.easingId] ?? AS_BEZIER.linear
    );
  }

  bindCanvas = modifier((element) => {
    this.canvas = element;
    this.paint();
    return () => (this.canvas = null);
  });

  get repaint() {
    requestAnimationFrame(() => this.paint());
    return '';
  }

  /* --------------------------------------------------------- the handles */

  point(event) {
    const box = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * (SIZE + PAD * 2) - PAD,
      y: ((event.clientY - box.top) / box.height) * (SIZE + PAD * 2) - PAD,
    };
  }

  down = (event) => {
    if (!this.selected) return;
    const at = this.point(event);
    const [x1, y1, x2, y2] = this.bezier;
    // Whichever control point is nearer, so there is no invisible hit order.
    const d1 = Math.hypot(at.x - x1 * SIZE, at.y - (SIZE - y1 * SIZE));
    const d2 = Math.hypot(at.x - x2 * SIZE, at.y - (SIZE - y2 * SIZE));
    if (Math.min(d1, d2) > 26) return;
    this.dragging = d1 <= d2 ? 0 : 1;
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that has already gone; the drag still works.
    }
    event.preventDefault();
  };

  move = (event) => {
    if (this.dragging === null) return;
    const at = this.point(event);
    // X stays inside the frame — a control point behind the start or past the
    // end is a curve that doubles back in time — but Y is free, because
    // overshoot is exactly what a back or an elastic ease is.
    const next = [...this.bezier];
    next[this.dragging * 2] = Math.min(1, Math.max(0, at.x / SIZE));
    next[this.dragging * 2 + 1] = Math.min(
      1.8,
      Math.max(-0.8, (SIZE - at.y) / SIZE),
    );
    this.editor.setKeyBezier(next);
  };

  up = (event) => {
    if (this.dragging === null) return;
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Already released.
    }
    this.dragging = null;
    this.editor.commit();
  };

  /* --------------------------------------------------------- the picture */

  paint() {
    const canvas = this.canvas;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round((SIZE + PAD * 2) * dpr);
    if (canvas.width !== px) canvas.width = canvas.height = px;
    const ctx = canvas.getContext('2d');
    const accent = resolveColour(canvas, '--fr-accent', '#e2e2e2');
    const grid = resolveColour(canvas, '--fr-border', '#363636');
    const dim = resolveColour(canvas, '--fr-faint', '#5e5e5e');
    const soft = resolveColour(canvas, '--fr-grid', 'rgba(255,255,255,0.06)');

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE + PAD * 2, SIZE + PAD * 2);

    const X = (k) => PAD + k * SIZE;
    const Y = (v) => PAD + SIZE - v * SIZE;

    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD + 0.5, PAD + 0.5, SIZE, SIZE);
    ctx.strokeStyle = soft;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(X(i / 4), Y(0));
      ctx.lineTo(X(i / 4), Y(1));
      ctx.moveTo(X(0), Y(i / 4));
      ctx.lineTo(X(1), Y(i / 4));
      ctx.stroke();
    }
    // Linear, for comparison: it is what the curve is bending away from.
    ctx.strokeStyle = dim;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0));
    ctx.lineTo(X(1), Y(1));
    ctx.stroke();
    ctx.setLineDash([]);

    if (!this.selected) return;

    const own = this.selected.key.bezier;
    const sample = (k) => (own ? cubic(...own, k) : ease(this.easingId, k));
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) {
      const k = i / 96;
      const v = sample(k);
      if (i === 0) ctx.moveTo(X(k), Y(v));
      else ctx.lineTo(X(k), Y(v));
    }
    ctx.stroke();

    // The handles, on arms from the two anchors, as a graph editor draws them.
    const [x1, y1, x2, y2] = this.bezier;
    ctx.strokeStyle = dim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0));
    ctx.lineTo(X(x1), Y(y1));
    ctx.moveTo(X(1), Y(1));
    ctx.lineTo(X(x2), Y(y2));
    ctx.stroke();
    ctx.fillStyle = accent;
    for (const [cx, cy] of [
      [x1, y1],
      [x2, y2],
    ]) {
      ctx.beginPath();
      ctx.arc(X(cx), Y(cy), 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  <template>
    {{! template-lint-disable no-pointer-down-event-binding }}
    <div class="fr-panel-body">
      <div class="fr-head">Ease</div>
      {{#if this.selected}}
        <div class="fr-ease-head">
          <span>{{this.selected.propLabel}}</span>
          <span class="fr-faint">{{this.selected.timecode}}</span>
        </div>
        <div class="fr-ease-canvas">{{this.repaint}}<canvas
            class="fr-ease-graph"
            width="204"
            height="204"
            {{this.bindCanvas}}
            {{on "pointerdown" this.down}}
            {{on "pointermove" this.move}}
            {{on "pointerup" this.up}}
            {{on "pointercancel" this.up}}
          ></canvas></div>
        <p class="fr-hint">Drag either handle to shape the motion. The curve
          runs from this keyframe to the next one.</p>
        <div class="fr-ease-list">
          {{#each this.easings key="id" as |e|}}
            <button
              type="button"
              class="fr-chip {{if (eq this.easingId e.id) 'is-on'}}"
              {{on "click" (fn @editor.setKeyEasing e.id)}}
            >{{e.label}}</button>
          {{/each}}
        </div>
        {{#if this.selected.key.bezier}}
          <div class="fr-ease-list">
            <button
              type="button"
              class="fr-btn"
              {{on "click" @editor.clearKeyBezier}}
            >Back to the preset</button>
          </div>
        {{/if}}
        {{#if (gt this.count 1)}}
          <p class="fr-hint">{{this.count}}
            keyframes selected — a preset applies to all of them, the handles
            shape the first.</p>
        {{/if}}
      {{else}}
        <p class="fr-hint">No keyframe selected.</p>
        <p class="fr-hint">Turn on the clock beside a property to start
          animating it, then click one of the diamonds that appear on the
          timeline. Drag a box across several to select them all.</p>
        <p class="fr-hint">With keys selected, F9 eases them, Ctrl+Alt+F9 makes
          them linear and Ctrl+Alt+H holds them.</p>
      {{/if}}
    </div>
  </template>
}
