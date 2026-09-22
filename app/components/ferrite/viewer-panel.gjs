import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import Icon from '../icon';
import { layerAt, handlesOf } from '../../utils/ferrite/render';
import { resolveColour } from '../../utils/ferrite/theme';

// A pointer that has already gone throws rather than returning, and optional
// chaining does not help: the method is there, it just refuses. A capture that
// cannot be taken is not worth failing a gesture over.
function grabPointer(element, event) {
  try {
    element?.setPointerCapture?.(event.pointerId);
  } catch {
    // The gesture still works; it just will not follow the pointer off the
    // element.
  }
}

function freePointer(element, event) {
  try {
    element?.releasePointerCapture?.(event.pointerId);
  } catch {
    // Already released.
  }
}

// The Composition panel, ported from `ferrite-app/src/ui/mod.rs`.
//
// In Ferrite this is a hole in the layout that a native child window fills,
// because the engine owns every surface. Here the compositor draws straight
// into the canvas, but the panel around it is the same: a bar saying which
// scene, at what raster and rate, with the zoom controls and the safe-area
// toggle; the picture on a checkerboard so transparency reads as transparency;
// selection handles and the anchor point over it; and the transport beneath.
const eq = (a, b) => a === b;

export default class ViewerPanel extends Component {
  get editor() {
    return this.args.editor;
  }

  bindStage = modifier((element) => {
    this.editor.stage = element;
    this.editor.paint();
    return () => (this.editor.stage = null);
  });

  bindOverlay = modifier((element) => {
    this.overlay = element;
    let pending = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => this.paintOverlay());
    });
    observer.observe(element);
    this.paintOverlay();
    return () => {
      cancelAnimationFrame(pending);
      observer.disconnect();
    };
  });

  // Redrawn on every render, so the handles follow the playhead and the drag.
  get repaint() {
    requestAnimationFrame(() => this.paintOverlay());
    return '';
  }

  // The handles are drawn on their own canvas over the picture rather than
  // into it, because they are the editor's furniture: nothing you see here
  // may ever end up in a written-out frame.
  paintOverlay() {
    const canvas = this.overlay;
    const editor = this.editor;
    if (!canvas || !editor.scene) return;
    const dpr = window.devicePixelRatio || 1;
    const box = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(box.width));
    const h = Math.max(1, Math.round(box.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (this.marquee) {
      const raster = editor.raster;
      const sx = w / raster.width;
      const sy = h / raster.height;
      const band = this.marquee;
      const bx = Math.min(band.x0, band.x1) * sx;
      const by = Math.min(band.y0, band.y1) * sy;
      const bw = Math.abs(band.x1 - band.x0) * sx;
      const bh = Math.abs(band.y1 - band.y0) * sy;
      ctx.fillStyle = resolveColour(
        canvas,
        '--fr-selection',
        'rgba(255,255,255,0.12)',
      );
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = resolveColour(canvas, '--fr-accent', '#e2e2e2');
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh);
    }

    if (!editor.showHandles || !editor.selection.length) return;

    const raster = editor.raster;
    const sx = w / raster.width;
    const sy = h / raster.height;
    const accent = resolveColour(canvas, '--fr-accent', '#e2e2e2');

    // Every selected layer is outlined, so a multiple selection looks like one
    // rather than like a single layer with the others invisibly along for the
    // ride.
    editor.selection.forEach((chosen, index) => {
      const { corners, anchor } = handlesOf(
        chosen,
        editor.scene,
        editor.project.settings,
        editor.timeMs,
        editor.media,
      );
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      corners.forEach((c, i) => {
        const x = c.x * sx;
        const y = c.y * sy;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = accent;
      for (const c of corners) ctx.fillRect(c.x * sx - 3, c.y * sy - 3, 6, 6);

      // Only the layer being worked on shows its anchor point: four of them on
      // screen at once says nothing about which one rotation will happen about.
      if (index !== 0) return;
      const ax = anchor.x * sx;
      const ay = anchor.y * sy;
      ctx.beginPath();
      ctx.arc(ax, ay, 5, 0, Math.PI * 2);
      ctx.moveTo(ax - 8, ay);
      ctx.lineTo(ax + 8, ay);
      ctx.moveTo(ax, ay - 8);
      ctx.lineTo(ax, ay + 8);
      ctx.stroke();
    });
  }

  /* ----------------------------------------------------- stage gestures */

  scenePoint(event) {
    const box = event.currentTarget.getBoundingClientRect();
    const raster = this.editor.raster;
    return {
      x: ((event.clientX - box.left) / box.width) * raster.width,
      y: ((event.clientY - box.top) / box.height) * raster.height,
      scale: raster.width / box.width,
    };
  }

  down = (event) => {
    const editor = this.editor;
    if (!editor.scene) return;
    grabPointer(event.currentTarget, event);
    const at = this.scenePoint(event);
    if (editor.tool === 'hand') {
      this.drag = { what: 'pan', x: event.clientX, y: event.clientY };
      return;
    }
    const hit = layerAt(
      editor.scene,
      editor.project.settings,
      editor.timeMs,
      editor.media,
      at.x,
      at.y,
    );
    if (!hit) {
      // Nothing under the cursor: this is a rubber band, not a miss. Which
      // layers it caught is decided when it is let go, so a marquee is one
      // selection change rather than a stream of them.
      this.drag = { what: 'marquee', from: at, to: at, moved: false };
      this.marquee = { x0: at.x, y0: at.y, x1: at.x, y1: at.y };
      return;
    }
    editor.selectLayer(hit.id, event);
    this.drag = {
      what: editor.tool,
      id: hit.id,
      from: at,
      startX: editor.valueOf(hit, 'x'),
      startY: editor.valueOf(hit, 'y'),
      startRotation: editor.valueOf(hit, 'rotation'),
      startAnchorX: editor.valueOf(hit, 'anchorX'),
      startAnchorY: editor.valueOf(hit, 'anchorY'),
    };
  };

  move = (event) => {
    const drag = this.drag;
    if (!drag) return;
    const editor = this.editor;
    const at = this.scenePoint(event);
    if (drag.what === 'pan') {
      editor.panBy(event.clientX - drag.x, event.clientY - drag.y);
      drag.x = event.clientX;
      drag.y = event.clientY;
      return;
    }
    if (drag.what === 'marquee') {
      drag.to = at;
      if (Math.abs(at.x - drag.from.x) > 3 || Math.abs(at.y - drag.from.y) > 3)
        drag.moved = true;
      this.marquee = {
        x0: drag.from.x,
        y0: drag.from.y,
        x1: at.x,
        y1: at.y,
      };
      this.paintOverlay();
      return;
    }

    const dx = at.x - drag.from.x;
    const dy = at.y - drag.from.y;
    if (drag.what === 'select') {
      editor.setProp(drag.id, 'x', drag.startX + dx);
      editor.setProp(drag.id, 'y', drag.startY + dy);
    } else if (drag.what === 'rotate') {
      // Measured from the layer's own centre, so the handle turns the layer
      // rather than dragging it round the scene's middle.
      const raster = editor.raster;
      const cx = raster.width / 2 + drag.startX;
      const cy = raster.height / 2 + drag.startY;
      const a0 = Math.atan2(drag.from.y - cy, drag.from.x - cx);
      const a1 = Math.atan2(at.y - cy, at.x - cx);
      let deg = drag.startRotation + ((a1 - a0) * 180) / Math.PI;
      if (event.shiftKey) deg = Math.round(deg / 15) * 15;
      editor.setProp(drag.id, 'rotation', deg);
    } else if (drag.what === 'anchor') {
      const layer = editor.byId(drag.id);
      const box = editor.boxOf(layer);
      editor.setProp(
        drag.id,
        'anchorX',
        drag.startAnchorX + (dx / box.w) * 100,
      );
      editor.setProp(
        drag.id,
        'anchorY',
        drag.startAnchorY + (dy / box.h) * 100,
      );
    }
  };

  up = (event) => {
    freePointer(event.currentTarget, event);
    const drag = this.drag;
    this.drag = null;
    if (drag?.what === 'marquee') {
      // A band that never travelled is a click on nothing, which deselects.
      if (drag.moved) this.editor.selectLayersIn(this.marquee, event.shiftKey);
      else this.editor.selectLayer(null);
      this.marquee = null;
      this.paintOverlay();
      return;
    }
    if (drag) this.editor.commit();
  };

  wheel = (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    this.editor.zoomStep(event.deltaY < 0 ? 1.25 : 0.8);
  };

  get stageStyle() {
    const editor = this.editor;
    return htmlSafe(
      `width:${editor.raster.width * editor.effectiveZoom}px;` +
        `height:${editor.raster.height * editor.effectiveZoom}px;` +
        `transform:translate(${editor.panX}px, ${editor.panY}px)`,
    );
  }

  <template>
    {{! template-lint-disable no-pointer-down-event-binding }}
    <div class="fr-viewer">
      <div class="fr-viewer-bar">
        <Icon @name="frame" @size={{11}} />
        <span class="fr-soft">{{@editor.scene.name}}</span>
        <span class="fr-faint">{{@editor.rasterLabel}}</span>
        <span class="fr-spacer"></span>
        <button
          type="button"
          class="fr-icon-btn"
          aria-label="Zoom out"
          {{on "click" (fn @editor.zoomStep 0.8)}}
        ><Icon @name="zoom-out" @size={{12}} /></button>
        <span class="fr-zoom">{{@editor.zoomLabel}}</span>
        <button
          type="button"
          class="fr-icon-btn"
          aria-label="Zoom in"
          {{on "click" (fn @editor.zoomStep 1.25)}}
        ><Icon @name="zoom-in" @size={{12}} /></button>
        <button
          type="button"
          class="fr-chip {{if (eq @editor.zoom 'fit') 'is-on'}}"
          {{on "click" (fn @editor.setZoom "fit")}}
        >Fit</button>
        <button
          type="button"
          class="fr-chip {{if (eq @editor.zoom 1) 'is-on'}}"
          {{on "click" (fn @editor.setZoom 1)}}
        >100%</button>
        <button
          type="button"
          class="fr-icon-btn {{if @editor.showSafe 'is-on'}}"
          title="Safe areas"
          aria-label="Safe areas"
          {{on "click" @editor.toggleSafe}}
        ><Icon @name="grid-3x3" @size={{12}} /></button>
        <button
          type="button"
          class="fr-icon-btn {{if @editor.showHandles 'is-on'}}"
          title="Selection handles"
          aria-label="Selection handles"
          {{on "click" @editor.toggleHandles}}
        ><Icon @name="crosshair" @size={{12}} /></button>
      </div>

      <div class="fr-stage-wrap" {{on "wheel" this.wheel}}>{{this.repaint}}
        <div class="fr-stage" style={{this.stageStyle}}>
          <canvas class="fr-canvas" {{this.bindStage}}></canvas>
          <canvas
            class="fr-overlay"
            {{this.bindOverlay}}
            {{on "pointerdown" this.down}}
            {{on "pointermove" this.move}}
            {{on "pointerup" this.up}}
            {{on "pointercancel" this.up}}
          ></canvas>
        </div>
      </div>

      <div class="fr-transport">
        <button
          type="button"
          class="fr-icon-btn"
          title="Start (Home)"
          aria-label="Start"
          {{on "click" (fn @editor.seek 0)}}
        ><Icon @name="skip-back" @size={{13}} /></button>
        <button
          type="button"
          class="fr-icon-btn"
          title="Back one frame (PgUp)"
          aria-label="Back one frame"
          {{on "click" (fn @editor.stepFrames -1)}}
        ><Icon @name="chevrons-left" @size={{13}} /></button>
        <button
          type="button"
          class="fr-icon-btn {{if @editor.playing 'is-on'}}"
          title="Play / pause (Space)"
          aria-label="Play or pause"
          {{on "click" @editor.playPause}}
        ><Icon
            @name={{if @editor.playing "pause" "play"}}
            @size={{13}}
          /></button>
        <button
          type="button"
          class="fr-icon-btn"
          title="Forward one frame (PgDn)"
          aria-label="Forward one frame"
          {{on "click" (fn @editor.stepFrames 1)}}
        ><Icon @name="chevrons-right" @size={{13}} /></button>
        <button
          type="button"
          class="fr-icon-btn"
          title="End (End)"
          aria-label="End"
          {{on "click" @editor.goToEnd}}
        ><Icon @name="skip-forward" @size={{13}} /></button>
        <button
          type="button"
          class="fr-icon-btn"
          title="Stop"
          aria-label="Stop"
          {{on "click" @editor.stop}}
        ><Icon @name="square-stop" @size={{13}} /></button>
        <button
          type="button"
          class="fr-icon-btn {{if @editor.looping 'is-on'}}"
          title="Loop"
          aria-label="Loop"
          {{on "click" @editor.toggleLoop}}
        ><Icon @name="repeat" @size={{13}} /></button>

        <span class="fr-time">{{@editor.timecodeNow}}</span>
        <span class="fr-faint">/ {{@editor.timecodeEnd}}</span>
        <span class="fr-spacer"></span>

        <button
          type="button"
          class="fr-icon-btn"
          title="Add marker at the playhead (M)"
          aria-label="Add marker"
          {{on "click" @editor.addMarker}}
        ><Icon @name="flag" @size={{13}} /></button>
        <button
          type="button"
          class="fr-icon-btn"
          title="Previous keyframe (J)"
          aria-label="Previous keyframe"
          {{on "click" (fn @editor.gotoKeyframe -1)}}
        ><Icon @name="diamond" @size={{11}} /></button>
        <button
          type="button"
          class="fr-icon-btn"
          title="Next keyframe (K)"
          aria-label="Next keyframe"
          {{on "click" (fn @editor.gotoKeyframe 1)}}
        ><Icon @name="diamond" @size={{11}} /></button>
        <span class="fr-faint">frame
          {{@editor.frameNow}}
          /
          {{@editor.frameTotal}}</span>
      </div>
    </div>
  </template>
}
