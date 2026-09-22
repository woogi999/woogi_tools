import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { modifier } from 'ember-modifier';
import Icon from '../icon';
import ScrubNumber from './scrub-number';
import { EASINGS } from '../../utils/ferrite/model';
import {
  TimeMap,
  drawTimeline,
  drawRuler,
  hitTest,
  rowAt,
  paletteOf,
  MARQUEE_SLOP,
} from '../../utils/ferrite/timeline';

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

// The Timeline, ported from `ferrite-app/src/ui/timeline.rs`.
//
// Scene structure, effects and animation in one panel, After Effects style.
// The left half is the layer tree with twirl-down property rows, effect groups
// and keyframe stopwatches; the right half is a canvas that draws the ruler,
// the bars, the keyframes and the playhead and handles every drag.
//
// The two halves lay themselves out from the same flat row list, so a
// property's name and its keyframes are always on the same line — which is the
// whole reason the list is built once in the editor rather than twice here.
const eq = (a, b) => a === b;
const not = (a) => !a;

export default class TimelinePanel extends Component {
  easings = EASINGS;

  get editor() {
    return this.args.editor;
  }

  bindTracks = modifier((element) => {
    this.canvas = element;
    // Painting sets the canvas' own height, which resizes what the observer is
    // watching. Only a real change in width is acted on, and the act is
    // deferred out of the observer's delivery, or the two chase each other.
    let pending = 0;
    let lastWidth = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        const width = Math.max(160, element.parentElement?.clientWidth ?? 0);
        if (width === lastWidth) return;
        lastWidth = width;
        this.editor.trackWidth = width;
        this.paint();
      });
    });
    observer.observe(element.parentElement);
    this.editor.repaintTracks = () => this.paint();
    return () => {
      cancelAnimationFrame(pending);
      observer.disconnect();
      this.editor.repaintTracks = null;
    };
  });

  // Repainted on every render, which is every state change the tree shows.
  get repaint() {
    requestAnimationFrame(() => this.paint());
    return '';
  }

  get map() {
    const editor = this.editor;
    return new TimeMap(
      editor.viewStartMs,
      editor.viewSpanMs,
      editor.trackWidth,
      editor.durationMs,
    );
  }

  bindRuler = modifier((element) => {
    this.ruler = element;
    this.paint();
    return () => (this.ruler = null);
  });

  // The ruler is pinned above the scrolling tracks, so scrubbing is a gesture
  // of its own rather than the top band of the tracks canvas.
  rulerDown = (event) => {
    const editor = this.editor;
    if (!this.ruler || !editor.scene) return;
    grabPointer(this.ruler, event);
    editor.pause();
    this.drag = { what: 'scrub' };
    const box = this.ruler.getBoundingClientRect();
    editor.seek(editor.snap(this.map.ms(event.clientX - box.left)));
  };

  rulerMove = (event) => {
    if (this.drag?.what !== 'scrub' || !this.ruler) return;
    const box = this.ruler.getBoundingClientRect();
    this.editor.seek(this.editor.snap(this.map.ms(event.clientX - box.left)));
  };

  rulerUp = (event) => {
    freePointer(this.ruler, event);
    this.drag = null;
  };

  paint() {
    if (this.ruler)
      drawRuler(this.ruler, this.map, {
        timeMs: this.editor.timeMs,
        markers: this.editor.markers,
        palette: paletteOf(this.ruler),
      });
    if (!this.canvas) return;
    drawTimeline(this.canvas, this.editor.rows, this.map, {
      timeMs: this.editor.timeMs,
      markers: this.editor.markers,
      marquee: this.marquee,
      palette: paletteOf(this.canvas),
    });
  }

  /* ---------------------------------------------------------- gestures */

  pointFrom(event) {
    const box = this.canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  down = (event) => {
    const editor = this.editor;
    if (!this.canvas || !editor.scene) return;
    grabPointer(this.canvas, event);
    const at = this.pointFrom(event);
    const map = this.map;
    const rows = editor.rows;
    const hit = hitTest(rows, map, at.x, at.y);

    if (hit.what === 'time-bar') {
      // The bar under the tracks pans the window, so a long edit can be
      // looked at closely without losing where you are in it.
      this.drag = { what: 'pan-bar' };
      editor.centreView((at.x / map.width) * editor.durationMs);
      return;
    }
    if (hit.what === 'key' && hit.row.prop) {
      editor.selectKey(hit.row, hit.ms, event.shiftKey);
      this.drag = {
        what: 'key',
        row: hit.row,
        from: hit.ms,
      };
      return;
    }
    if (hit.row?.layer) {
      const layer = hit.row.layer;
      editor.selectLayer(layer.id, event);
      if (layer.locked || hit.what === 'empty') {
        this.drag = null;
        return;
      }
      editor.pause();
      this.drag = {
        what: hit.what,
        id: layer.id,
        grabMs: map.ms(at.x),
        inMs: layer.inMs,
        outMs: layer.outMs,
        offsetMs: layer.offsetMs,
      };
      return;
    }
    this.drag = { what: 'marquee', x0: at.x, y0: at.y, moved: false };
    this.marquee = { x0: at.x, y0: at.y, x1: at.x, y1: at.y };
  };

  move = (event) => {
    const drag = this.drag;
    if (!drag || !this.canvas) return;
    const editor = this.editor;
    const at = this.pointFrom(event);
    const map = this.map;
    const ms = editor.snap(map.ms(at.x));

    if (drag.what === 'scrub') {
      editor.seek(ms);
      return;
    }
    if (drag.what === 'pan-bar') {
      editor.centreView((at.x / map.width) * editor.durationMs);
      this.paint();
      return;
    }
    if (drag.what === 'key') {
      const to = Math.max(0, ms);
      if (to === drag.from) return;
      editor.moveKey(drag.row, drag.from, to);
      drag.from = to;
      return;
    }
    if (drag.what === 'marquee') {
      this.marquee = { ...this.marquee, x1: at.x, y1: at.y };
      if (
        Math.abs(at.x - drag.x0) > MARQUEE_SLOP ||
        Math.abs(at.y - drag.y0) > MARQUEE_SLOP
      )
        drag.moved = true;
      this.paint();
      return;
    }

    const shift = ms - editor.snap(drag.grabMs);
    if (drag.what === 'bar') {
      const inMs = Math.max(0, drag.inMs + shift);
      editor.setSpan(drag.id, inMs, inMs + (drag.outMs - drag.inMs));
    } else if (drag.what === 'trim-in') {
      // The left grip trims and slips together, so the frame under it stays
      // the frame under it.
      const inMs = Math.min(
        drag.outMs - editor.frameMs,
        Math.max(0, drag.inMs + shift, drag.inMs - drag.offsetMs),
      );
      editor.trimIn(drag.id, inMs, drag.offsetMs + (inMs - drag.inMs));
    } else if (drag.what === 'trim-out') {
      editor.trimOut(drag.id, drag.inMs, drag.outMs + shift, drag.offsetMs);
    }
  };

  up = (event) => {
    const drag = this.drag;
    freePointer(this.canvas, event);
    this.drag = null;
    if (drag?.what === 'marquee') {
      // A rubber band is one selection change when it is let go, not a stream
      // of them.
      if (drag.moved) this.editor.selectKeysIn(this.marquee, this.map, rowAt);
      else this.editor.clearKeySelection();
      this.marquee = null;
    } else if (drag) {
      this.editor.commit();
    }
    this.paint();
  };

  wheel = (event) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey)
      this.editor.zoomTime(event.deltaY < 0 ? 1 : -1);
    else this.editor.panTime((event.deltaX || event.deltaY) / 400);
    this.paint();
  };

  <template>
    {{! template-lint-disable no-pointer-down-event-binding }}
    <div class="fr-timeline">
      <div class="fr-timeline-bar">
        <span class="fr-time">{{@editor.timecodeNow}}</span>
        <div class="fr-tools">
          {{#each @editor.tools key="id" as |t|}}
            <button
              type="button"
              class="fr-icon-btn {{if (eq @editor.tool t.id) 'is-on'}}"
              title="{{t.label}} ({{t.key}})"
              aria-label={{t.label}}
              {{on "click" (fn @editor.setTool t.id)}}
            ><Icon @name={{t.icon}} @size={{12}} /></button>
          {{/each}}
        </div>
        <span class="fr-spacer"></span>
        {{! Easing where the keyframes are, rather than only in a panel: with
            keys selected these act on all of them at once. }}
        <span class="fr-ease-actions">
          {{#each @editor.easePresets key="id" as |e|}}
            <button
              type="button"
              class="fr-chip"
              title="{{e.label}} the selected keyframes ({{e.key}})"
              disabled={{not @editor.selectedKeys.length}}
              {{on "click" (fn @editor.easeSelectedKeys e.id)}}
            >{{e.short}}</button>
          {{/each}}
        </span>
        <span class="fr-sep"></span>
        {{#each @editor.reveals key="id" as |r|}}
          <button
            type="button"
            class="fr-chip"
            title="{{r.label}} ({{r.key}})"
            {{on "click" (fn @editor.reveal r.id)}}
          >{{r.key}}</button>
        {{/each}}
        <button
          type="button"
          class="fr-icon-btn"
          aria-label="Zoom in"
          {{on "click" (fn @editor.zoomTime 1)}}
        ><Icon @name="zoom-in" @size={{12}} /></button>
        <button
          type="button"
          class="fr-icon-btn"
          aria-label="Zoom out"
          {{on "click" (fn @editor.zoomTime -1)}}
        ><Icon @name="zoom-out" @size={{12}} /></button>
      </div>

      <div class="fr-split">
        <div class="fr-tree-head">
          <span class="fr-tree-col">Layer</span>
          <span class="fr-tree-col is-right">Parent</span>
          <span class="fr-tree-col is-right">Matte</span>
        </div>
        <div class="fr-ruler">
          <canvas
            class="fr-ruler-canvas"
            {{this.bindRuler}}
            {{on "pointerdown" this.rulerDown}}
            {{on "pointermove" this.rulerMove}}
            {{on "pointerup" this.rulerUp}}
            {{on "pointercancel" this.rulerUp}}
          ></canvas>
        </div>
        <div class="fr-tree">
          {{#each @editor.rows key="key" as |row|}}
            <div
              class="fr-trow is-{{row.kind}}
                depth-{{row.depth}}
                {{if row.selected 'is-selected'}}"
            >
              {{#if (eq row.kind "layer")}}
                <button
                  type="button"
                  class="fr-twirl"
                  aria-label="Show properties"
                  {{on "click" (fn @editor.twirl row.id)}}
                ><Icon
                    @name={{if row.expanded "chevron-down" "chevron-right"}}
                    @size={{10}}
                  /></button>
                <button
                  type="button"
                  class="fr-flag {{unless row.layer.visible 'is-off'}}"
                  aria-label="Visible"
                  {{on "click" (fn @editor.toggleLayerFlag row.id "visible")}}
                ><Icon
                    @name={{if row.layer.visible "eye" "eye-off"}}
                    @size={{11}}
                  /></button>
                <button
                  type="button"
                  class="fr-flag {{if row.layer.solo 'is-on'}}"
                  title="Solo"
                  aria-label="Solo"
                  {{on "click" (fn @editor.toggleLayerFlag row.id "solo")}}
                ><Icon @name="circle" @size={{9}} /></button>
                <button
                  type="button"
                  class="fr-flag {{if row.layer.locked 'is-on'}}"
                  title="Lock"
                  aria-label="Lock"
                  {{on "click" (fn @editor.toggleLayerFlag row.id "locked")}}
                ><Icon @name="lock" @size={{10}} /></button>
                <button
                  type="button"
                  class="fr-flag {{if row.layer.motionBlur 'is-on'}}"
                  title="Motion blur"
                  aria-label="Motion blur"
                  {{on
                    "click"
                    (fn @editor.toggleLayerFlag row.id "motionBlur")
                  }}
                ><Icon @name="wand" @size={{10}} /></button>
                <button
                  type="button"
                  class="fr-trow-name"
                  {{on "click" (fn @editor.selectLayer row.id)}}
                ><Icon @name={{row.icon}} @size={{11}} />
                  <span>{{row.label}}</span></button>
                <button
                  type="button"
                  class="fr-whip-btn {{if row.layer.parent 'is-linked'}}"
                  title="Drag onto another layer to parent this one to it"
                  aria-label="Parent {{row.label}} to another layer"
                  {{this.whip "parent" row.id}}
                ><Icon @name="link-2" @size={{10}} /></button>
                <select
                  class="fr-link"
                  aria-label="Parent of {{row.label}}"
                  {{on "change" (fn @editor.setParentOf row.id)}}
                >
                  <option
                    value=""
                    selected={{eq row.layer.parent null}}
                  >None</option>
                  {{#each row.parentChoices key="id" as |l|}}
                    <option
                      value={{l.id}}
                      selected={{eq row.layer.parent l.id}}
                    >{{l.name}}</option>
                  {{/each}}
                </select>
                <button
                  type="button"
                  class="fr-whip-btn
                    {{unless (eq row.layer.matte 'none') 'is-linked'}}"
                  title="Drag onto the layer to cut this one out with"
                  aria-label="Track matte for {{row.label}}"
                  {{this.whip "matte" row.id}}
                ><Icon @name="blend" @size={{10}} /></button>
                <select
                  class="fr-link fr-matte"
                  aria-label="Track matte for {{row.label}}"
                  {{on "change" (fn @editor.setMatteOf row.id)}}
                >
                  {{#each @editor.mattes key="id" as |m|}}
                    <option
                      value={{m.id}}
                      selected={{eq row.layer.matte m.id}}
                    >{{m.label}}</option>
                  {{/each}}
                </select>
              {{else if (eq row.kind "group")}}
                <button
                  type="button"
                  class="fr-twirl"
                  aria-label="Show {{row.label}}"
                  {{on "click" (fn @editor.twirl row.id)}}
                ><Icon
                    @name={{if row.expanded "chevron-down" "chevron-right"}}
                    @size={{10}}
                  /></button>
                <span class="fr-group-name">{{row.label}}</span>
              {{else if (eq row.kind "effect")}}
                <button
                  type="button"
                  class="fr-twirl"
                  aria-label="Show {{row.label}}"
                  {{on "click" (fn @editor.twirl row.id)}}
                ><Icon
                    @name={{if row.expanded "chevron-down" "chevron-right"}}
                    @size={{10}}
                  /></button>
                <button
                  type="button"
                  class="fr-flag {{if row.enabled 'is-on'}}"
                  aria-label="Enable {{row.label}}"
                  {{on "click" (fn @editor.toggleEffect row.fxId)}}
                ><Icon @name="sparkles" @size={{10}} /></button>
                <span class="fr-group-name">{{row.label}}</span>
              {{else}}
                <button
                  type="button"
                  class="fr-watch {{if row.keyed 'is-on'}}"
                  title="Animate {{row.label}}"
                  aria-label="Animate {{row.label}}"
                  {{on "click" (fn @editor.rowStopwatch row)}}
                ><Icon @name="clock" @size={{10}} /></button>
                {{#if row.keyed}}
                  <button
                    type="button"
                    class="fr-diamond {{if row.onKey 'is-on'}}"
                    aria-label="Key {{row.label}} on this frame"
                    {{on "click" (fn @editor.rowToggleKey row)}}
                  ><Icon @name="diamond" @size={{9}} /></button>
                {{/if}}
                <span class="fr-prop-name">{{row.label}}</span>
                <ScrubNumber
                  @value={{row.value}}
                  @step={{row.step}}
                  @min={{row.min}}
                  @max={{row.max}}
                  @unit={{row.unit}}
                  @label={{row.label}}
                  @onChange={{fn @editor.rowSetValue row}}
                />
                {{#if row.pair}}
                  <ScrubNumber
                    @value={{row.pairValue}}
                    @step={{row.step}}
                    @min={{row.min}}
                    @max={{row.max}}
                    @unit={{row.pairUnit}}
                    @label="{{row.label}} (second)"
                    @onChange={{fn @editor.rowSetPair row}}
                  />
                {{/if}}
                {{#if row.onKey}}
                  <select
                    class="fr-ease"
                    aria-label="Easing for {{row.label}}"
                    {{on "change" (fn @editor.rowSetEasing row)}}
                  >
                    {{#each this.easings key="id" as |e|}}
                      <option
                        value={{e.id}}
                        selected={{eq row.easing e.id}}
                      >{{e.label}}</option>
                    {{/each}}
                  </select>
                {{/if}}
              {{/if}}
            </div>
          {{/each}}
        </div>
        <div class="fr-tracks">{{this.repaint}}<canvas
            class="fr-tracks-canvas"
            {{this.bindTracks}}
            {{on "pointerdown" this.down}}
            {{on "pointermove" this.move}}
            {{on "pointerup" this.up}}
            {{on "pointercancel" this.up}}
            {{on "wheel" this.wheel}}
          ></canvas></div>
      </div>
    </div>
  </template>
}
