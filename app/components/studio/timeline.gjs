import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import Icon from '../icon';
import StNum from './num';

// The timeline under the viewport: transport controls, then either the
// dope sheet (one row per animated channel, a diamond per key) or the
// graph editor (the curves themselves, with tangent handles). Both are
// drawn on a canvas and share the ruler at the top, which scrubs.
//
//   Frame     0    10    20    30    40
//             │     │     │     │     │
//   Root      ●─────●─────●─────●─────●
//   Arm       ●────────●────────●──────

const ROW = 20;
const RULER = 22;
const COMP_COLORS = ['#ff5c72', '#3ad29f', '#4c9dff', '#ffd23c'];

const eq = (a, b) => a === b;
const not = (x) => !x;

function css(name, fallback) {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

export default class StudioTimeline extends Component {
  @tracked zoom = null; // pixels per frame; null fits the clip
  @tracked scroll = 0; // first visible frame
  @tracked rowScroll = 0;
  @tracked width = 600;
  @tracked height = 180;
  canvas = null;

  get s() {
    return this.args.s;
  }

  get clip() {
    return this.s.clip;
  }

  get rows() {
    return this.s.timelineRows;
  }

  get ppf() {
    const c = this.clip;
    if (this.zoom) return this.zoom;
    const span = c ? c.end - c.start + 4 : 50;
    return Math.max(2, (this.width - 16) / span);
  }

  get start() {
    const c = this.clip;
    return this.zoom ? this.scroll : (c?.start ?? 0) - 2;
  }

  fx = (f) => (f - this.start) * this.ppf;
  xf = (x) => x / this.ppf + this.start;

  // ─── Drawing ───────────────────────────────────────────────────────

  attach = modifier((canvas) => {
    this.canvas = canvas;
    const ro = new ResizeObserver(() => {
      const r = canvas.parentElement.getBoundingClientRect();
      this.width = Math.max(100, r.width);
      this.height = Math.max(60, r.height);
    });
    ro.observe(canvas.parentElement);
    return () => ro.disconnect();
  });

  // Redraws when anything it reads changes.
  paint = modifier(
    (canvas, [clip, frame, sel, view, width, height, rows, comps]) => {
      void comps;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const text = css('--text', '#eee');
      const dim = css('--text-faint', '#666');
      const line = css('--border-color', '#333');
      ctx.clearRect(0, 0, width, height);
      if (!clip) return;
      // Clip range shading and grid.
      ctx.fillStyle = 'rgba(128,128,128,0.06)';
      ctx.fillRect(
        this.fx(clip.start),
        RULER,
        this.fx(clip.end) - this.fx(clip.start),
        height - RULER,
      );
      const step = niceStep(this.ppf);
      ctx.font = '10px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      for (
        let f = Math.ceil(this.start / step) * step;
        this.fx(f) < width;
        f += step
      ) {
        const x = Math.round(this.fx(f)) + 0.5;
        ctx.strokeStyle = line;
        ctx.beginPath();
        ctx.moveTo(x, RULER - 6);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.fillStyle = dim;
        ctx.fillText(String(f), x + 3, RULER / 2);
      }
      if (view === 'graph') this.drawGraph(ctx, clip, sel, width, height);
      else this.drawDope(ctx, clip, sel, rows, width, height, text, line);
      // Playhead.
      const px = Math.round(this.fx(frame)) + 0.5;
      ctx.strokeStyle = '#ff9a3c';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = '#ff9a3c';
      ctx.fillRect(px - 14, 2, 28, RULER - 6);
      ctx.fillStyle = '#111';
      ctx.textAlign = 'center';
      ctx.fillText(String(frame), px, RULER / 2 - 1);
      ctx.textAlign = 'start';
    },
  );

  drawDope(ctx, clip, sel, rows, width, height, text, line) {
    const A = this.s.E.anim;
    rows.forEach((r, i) => {
      const y = RULER + i * ROW - this.rowScroll;
      if (y < RULER - ROW || y > height) return;
      ctx.strokeStyle = line;
      ctx.beginPath();
      ctx.moveTo(0, y + ROW + 0.5);
      ctx.lineTo(width, y + ROW + 0.5);
      ctx.stroke();
      const cy = y + ROW / 2;
      if (r.kind === 'group') {
        ctx.fillStyle = 'rgba(128,128,128,0.08)';
        ctx.fillRect(0, y, width, ROW);
        for (const f of r.keys) {
          const allSel = r.tracks.every(
            (t) => !t.keys.some((k) => k.f === f) || sel.has(`${t.id}@${f}`),
          );
          diamond(ctx, this.fx(f), cy, 5, allSel ? '#ffb26b' : text, true);
        }
        return;
      }
      const keys = r.track.keys;
      // Holds between equal keys drawn as bars, like Blender.
      for (let k = 0; k < keys.length - 1; k++) {
        const a = keys[k];
        const b = keys[k + 1];
        const same = a.v.every((x, c) => Math.abs(x - b.v[c]) < 1e-6);
        ctx.strokeStyle = same
          ? 'rgba(160,160,170,0.8)'
          : 'rgba(160,160,170,0.35)';
        ctx.lineWidth = same ? 3 : 1;
        ctx.beginPath();
        ctx.moveTo(this.fx(a.f), cy);
        ctx.lineTo(this.fx(b.f), cy);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      for (const k of keys) {
        const on = sel.has(A.keyRef(r.track, k));
        const shape =
          k.i === 'constant' ? 'square' : k.i === 'linear' ? 'tri' : 'diamond';
        diamond(
          ctx,
          this.fx(k.f),
          cy,
          4.5,
          on ? '#ff9a3c' : '#d8dbe2',
          false,
          shape,
        );
      }
    });
    if (this.box) {
      const b = this.box;
      ctx.strokeStyle = '#ff9a3c';
      ctx.fillStyle = 'rgba(255,154,60,0.12)';
      ctx.fillRect(
        Math.min(b.x0, b.x1),
        Math.min(b.y0, b.y1),
        Math.abs(b.x1 - b.x0),
        Math.abs(b.y1 - b.y0),
      );
      ctx.strokeRect(
        Math.min(b.x0, b.x1) + 0.5,
        Math.min(b.y0, b.y1) + 0.5,
        Math.abs(b.x1 - b.x0),
        Math.abs(b.y1 - b.y0),
      );
    }
  }

  // ─── Graph editor ──────────────────────────────────────────────────

  // Channels shown: those of the selection, or everything if nothing's selected.
  get curves() {
    const s = this.s;
    const clip = this.clip;
    if (!clip) return [];
    const sel = new Set(s.selected);
    const bones = s.boneSel;
    let tracks = clip.tracks.filter((t) => t.prop !== 'visible');
    const picked = tracks.filter(
      (t) =>
        (t.target.kind === 'object' && sel.has(t.target.id)) ||
        (t.target.kind === 'bone' &&
          bones?.arm === t.target.arm &&
          (bones.ids.has(t.target.bone) || bones.active === t.target.bone)),
    );
    if (picked.length) tracks = picked;
    const out = [];
    for (const t of tracks) {
      const size = t.keys[0]?.v.length ?? 0;
      for (let c = 0; c < size; c++) {
        const key = `${t.id}:${c}`;
        if (
          s.anim.graphComps &&
          s.anim.graphComps.size &&
          !s.anim.graphComps.has(key)
        )
          continue;
        out.push({
          key,
          track: t,
          comp: c,
          color: COMP_COLORS[size === 1 ? 3 : c],
          label: `${s.E.anim.trackLabel(t, s.doc)} ${s.E.anim.PROPS[t.prop]?.comps[c] ?? ''}`,
        });
      }
    }
    return out;
  }

  graphRange(curves) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const cv of curves)
      for (const k of cv.track.keys) {
        lo = Math.min(lo, k.v[cv.comp]);
        hi = Math.max(hi, k.v[cv.comp]);
      }
    if (!Number.isFinite(lo)) return [-1, 1];
    const pad = Math.max((hi - lo) * 0.15, 0.5);
    return [lo - pad, hi + pad];
  }

  vy = (v, height) => {
    const [lo, hi] = this.range;
    return RULER + 6 + (1 - (v - lo) / (hi - lo)) * (height - RULER - 12);
  };

  yv = (y, height) => {
    const [lo, hi] = this.range;
    return lo + (1 - (y - RULER - 6) / (height - RULER - 12)) * (hi - lo);
  };

  drawGraph(ctx, clip, sel, width, height) {
    const A = this.s.E.anim;
    const curves = this.curves;
    this.range = this.graphDrag?.range ?? this.graphRange(curves);
    // Zero line.
    ctx.strokeStyle = 'rgba(160,160,170,0.3)';
    ctx.beginPath();
    ctx.moveTo(0, this.vy(0, height));
    ctx.lineTo(width, this.vy(0, height));
    ctx.stroke();
    this.handles = [];
    for (const cv of curves) {
      const keys = cv.track.keys;
      if (!keys.length) continue;
      ctx.strokeStyle = cv.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const f0 = Math.floor(this.xf(0));
      const f1 = Math.ceil(this.xf(width));
      const stepF = Math.max(0.25, 1 / Math.max(this.ppf / 4, 1));
      let first = true;
      for (let f = f0; f <= f1; f += stepF) {
        const x = this.fx(f);
        const y = this.vy(A.sampleKeys(keys, f, cv.comp), height);
        if (first) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        first = false;
      }
      ctx.stroke();
      ctx.lineWidth = 1;
      keys.forEach((k, i) => {
        const x = this.fx(k.f);
        const y = this.vy(k.v[cv.comp], height);
        const on = sel.has(A.keyRef(cv.track, k));
        if (on && k.i === 'bezier') {
          // Tangent handles, a third of the way to each neighbour.
          for (const side of ['in', 'out']) {
            const nb = keys[i + (side === 'in' ? -1 : 1)];
            if (!nb) continue;
            const slope = A.slopeAt(keys, i, cv.comp, side);
            const df = (Math.abs(nb.f - k.f) / 3) * (side === 'in' ? -1 : 1);
            const hx = this.fx(k.f + df);
            const hy = this.vy(k.v[cv.comp] + slope * df, height);
            ctx.strokeStyle = 'rgba(255,255,255,0.6)';
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(hx, hy);
            ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(hx, hy, 3, 0, Math.PI * 2);
            ctx.fill();
            this.handles.push({ x: hx, y: hy, cv, k, side, df });
          }
        }
        ctx.fillStyle = on ? '#ff9a3c' : cv.color;
        ctx.fillRect(x - 3, y - 3, 6, 6);
      });
    }
    if (!curves.length) {
      ctx.fillStyle = css('--text-faint', '#777');
      ctx.fillText(
        'No curves yet: key something, then select it to see its curves here.',
        12,
        RULER + 20,
      );
    }
  }

  // ─── Pointer ───────────────────────────────────────────────────────

  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  down = (e) => {
    const s = this.s;
    const [x, y] = this.local(e);
    capture(this.canvas, e.pointerId);
    if (y < RULER) {
      this.drag = { kind: 'scrub' };
      s.stop();
      s.setFrame(this.xf(x));
      return;
    }
    if (s.anim.view === 'graph') return this.graphDown(e, x, y);
    const hit = this.keyAt(x, y);
    if (hit) {
      const refs = hit.refs;
      const already = refs.every((r) => s.anim.keySel.has(r));
      if (e.shiftKey || e.ctrlKey || e.metaKey)
        s.selectKeys(refs, { toggle: true });
      else if (!already) s.selectKeys(refs);
      this.drag = { kind: 'keys', x0: x, df: 0, copy: e.altKey };
      return;
    }
    this.drag = { kind: 'box', add: e.shiftKey };
    this.box = { x0: x, y0: y, x1: x, y1: y };
  };

  move = (e) => {
    const d = this.drag;
    if (!d) return;
    const s = this.s;
    const [x, y] = this.local(e);
    if (d.kind === 'scrub') s.setFrame(this.xf(x));
    else if (d.kind === 'keys') {
      const df = Math.round((x - d.x0) / this.ppf);
      if (df !== d.df) {
        d.df = df;
        s.dragKeys(df, false, { copy: d.copy || e.altKey });
      }
    } else if (d.kind === 'box') {
      this.box = { ...this.box, x1: x, y1: y };
      this.redraw();
    } else if (d.kind === 'gkey') {
      const f = this.xf(x);
      const v = this.yv(y, this.height);
      s.graphMoveKey(
        d.track.id,
        d.frame,
        d.comp,
        e.shiftKey ? d.frame : f,
        v,
        false,
      );
      d.frame = Math.round(e.shiftKey ? d.frame : f);
    } else if (d.kind === 'handle') {
      const h = d.h;
      const f = this.xf(x) - h.k.f;
      if (Math.abs(f) < 1e-3 || Math.sign(f) !== Math.sign(h.df)) return;
      const slope = (this.yv(y, this.height) - h.k.v[h.cv.comp]) / f;
      s.graphSetTangent(h.cv.track.id, h.k.f, h.cv.comp, h.side, slope, false);
    }
  };

  up = () => {
    const d = this.drag;
    this.drag = null;
    this.graphDrag = null;
    if (!d) return;
    const s = this.s;
    if (d.kind === 'keys') {
      if (d.df) s.dragKeys(d.df, true, { copy: d.copy });
      else s.keyDrag = null;
    } else if (d.kind === 'box') {
      const b = this.box;
      this.box = null;
      const refs = this.keysIn(b);
      if (Math.abs(b.x1 - b.x0) < 3 && Math.abs(b.y1 - b.y0) < 3) {
        if (!d.add) s.selectKeys([]);
        s.setFrame(this.xf(b.x0));
      } else s.selectKeys(refs, { add: d.add });
      this.redraw();
    } else if (d.kind === 'gkey')
      s.graphMoveKey(
        d.track.id,
        d.frame,
        d.comp,
        d.frame,
        s.clip.tracks
          .find((t) => t.id === d.track.id)
          ?.keys.find((k) => k.f === d.frame)?.v[d.comp] ?? 0,
        true,
      );
    else if (d.kind === 'handle') s.seal();
  };

  graphDown(e, x, y) {
    const s = this.s;
    const A = s.E.anim;
    for (const h of this.handles ?? [])
      if (Math.hypot(h.x - x, h.y - y) < 6) {
        this.drag = { kind: 'handle', h };
        this.graphDrag = { range: this.range };
        return;
      }
    for (const cv of this.curves)
      for (const k of cv.track.keys) {
        if (
          Math.hypot(this.fx(k.f) - x, this.vy(k.v[cv.comp], this.height) - y) <
          6
        ) {
          s.selectKeys([A.keyRef(cv.track, k)], { add: e.shiftKey });
          this.drag = {
            kind: 'gkey',
            track: cv.track,
            frame: k.f,
            comp: cv.comp,
          };
          this.graphDrag = { range: this.range };
          return;
        }
      }
    s.selectKeys([]);
    this.drag = { kind: 'scrub' };
    s.setFrame(this.xf(x));
  }

  keyAt(x, y) {
    const i = Math.floor((y - RULER + this.rowScroll) / ROW);
    const r = this.rows[i];
    if (!r) return null;
    const A = this.s.E.anim;
    const near = (f) => Math.abs(this.fx(f) - x) <= 6;
    if (r.kind === 'group') {
      const f = r.keys.find(near);
      if (f === undefined) return null;
      return {
        refs: r.tracks.flatMap((t) =>
          t.keys.filter((k) => k.f === f).map((k) => A.keyRef(t, k)),
        ),
      };
    }
    const k = r.track.keys.find((kk) => near(kk.f));
    return k ? { refs: [A.keyRef(r.track, k)] } : null;
  }

  keysIn(b) {
    const A = this.s.E.anim;
    const x0 = Math.min(b.x0, b.x1),
      x1 = Math.max(b.x0, b.x1);
    const y0 = Math.min(b.y0, b.y1),
      y1 = Math.max(b.y0, b.y1);
    const refs = [];
    this.rows.forEach((r, i) => {
      const cy = RULER + i * ROW - this.rowScroll + ROW / 2;
      if (cy < y0 || cy > y1) return;
      const tracks = r.kind === 'group' ? r.tracks : [r.track];
      for (const t of tracks)
        for (const k of t.keys)
          if (this.fx(k.f) >= x0 && this.fx(k.f) <= x1)
            refs.push(A.keyRef(t, k));
    });
    return refs;
  }

  wheel = (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey || this.s.anim.view === 'graph') {
      const [x] = this.local(e);
      const f = this.xf(x);
      const next = Math.max(
        1,
        Math.min(80, this.ppf * (e.deltaY < 0 ? 1.15 : 1 / 1.15)),
      );
      this.zoom = next;
      this.scroll = f - x / next;
    } else if (e.shiftKey) {
      this.zoom = this.ppf;
      this.scroll = this.start + (e.deltaY > 0 ? 5 : -5);
    } else {
      const max = Math.max(
        0,
        this.rows.length * ROW - (this.height - RULER) + ROW,
      );
      this.rowScroll = Math.max(
        0,
        Math.min(max, this.rowScroll + e.deltaY * 0.5),
      );
    }
  };

  fit = () => {
    this.zoom = null;
    this.scroll = 0;
  };

  // The paint modifier reruns when one of its tracked args changes; this is one.
  @tracked boxTick = 0;

  redraw() {
    this.boxTick++;
  }

  setView = (v) => this.s.setTimelineView(v);
  setFrame = (v) => this.s.setFrame(v);
  labelStyle = (i) => `top:${RULER + i * ROW - this.rowScroll}px`;

  <template>
    {{! template-lint-disable no-pointer-down-event-binding no-invalid-interactive }}
    <div class="st-timeline">
      <div class="st-transport">
        <button
          type="button"
          class="st-mini"
          title="Start (Shift ←)"
          aria-label="Go to start"
          {{on "click" (fn @s.jump "start")}}
        ><Icon @name="skip-back" @size={{13}} /></button>
        <button
          type="button"
          class="st-mini"
          title="Previous key (↓)"
          aria-label="Previous key"
          {{on "click" (fn @s.jump "prev")}}
        ><Icon @name="chevrons-left" @size={{13}} /></button>
        <button
          type="button"
          class="st-mini"
          title="Back a frame (←)"
          aria-label="Back a frame"
          {{on "click" (fn @s.stepFrame -1)}}
        ><Icon @name="step-back" @size={{13}} /></button>
        <button
          type="button"
          class="st-play {{if @s.playing 'on'}}"
          title="Play / pause (Space)"
          aria-label={{if @s.playing "Pause" "Play"}}
          {{on "click" @s.togglePlay}}
        ><Icon @name={{if @s.playing "pause" "play"}} @size={{14}} /></button>
        <button
          type="button"
          class="st-mini"
          title="Forward a frame (→)"
          aria-label="Forward a frame"
          {{on "click" (fn @s.stepFrame 1)}}
        ><Icon @name="step-forward" @size={{13}} /></button>
        <button
          type="button"
          class="st-mini"
          title="Next key (↑)"
          aria-label="Next key"
          {{on "click" (fn @s.jump "next")}}
        ><Icon @name="chevrons-right" @size={{13}} /></button>
        <button
          type="button"
          class="st-mini"
          title="End (Shift →)"
          aria-label="Go to end"
          {{on "click" (fn @s.jump "end")}}
        ><Icon @name="skip-forward" @size={{13}} /></button>
        <StNum
          @label="Frame"
          @value={{@s.frame}}
          @step={{1}}
          @int={{true}}
          @onChange={{this.setFrame}}
        />
        {{#if @s.clip}}
          <select
            class="st-clip-pick"
            aria-label="Clip"
            {{on "change" @s.pickClip}}
          >
            {{#each @s.clips as |c|}}<option
                value={{c.id}}
                selected={{eq c.id @s.doc.activeClip}}
              >{{c.name}}</option>{{/each}}
          </select>
          <label class="st-check"><input
              type="checkbox"
              checked={{@s.clip.loop}}
              {{on "change" (fn @s.setClip "loop" (not @s.clip.loop))}}
            /><span>Loop</span></label>
        {{/if}}
        <span class="st-spacer"></span>
        <button
          type="button"
          class="st-mini st-autokey {{if @s.autoKey 'on'}}"
          title="Auto key"
          aria-label="Auto key"
          {{on "click" @s.toggleAutoKey}}
        ><Icon @name="circle-dot" @size={{13}} /></button>
        <button
          type="button"
          class="st-mini {{if @s.anim.onlySelected 'on'}}"
          title="Only the selection's channels"
          aria-label="Only selected"
          {{on "click" @s.toggleOnlySelected}}
        ><Icon @name="list-filter" @size={{13}} /></button>
        <div class="st-seg" role="group" aria-label="Timeline view">
          <button
            type="button"
            class="{{if (eq @s.anim.view 'dope') 'on'}}"
            {{on "click" (fn this.setView "dope")}}
          >Dope sheet</button>
          <button
            type="button"
            class="st-graph-btn {{if (eq @s.anim.view 'graph') 'on'}}"
            {{on "click" (fn this.setView "graph")}}
          >Graph</button>
        </div>
        <button
          type="button"
          class="st-mini"
          title="Fit the clip"
          aria-label="Fit"
          {{on "click" this.fit}}
        ><Icon @name="maximize" @size={{13}} /></button>
      </div>
      <div class="st-tl-body">
        <div class="st-tl-labels">
          {{#if (eq @s.anim.view "dope")}}
            {{#each this.rows key="key" as |r i|}}
              <div
                class="st-tl-label {{r.kind}}"
                style={{htmlStyle (this.labelStyle i)}}
              >{{r.label}}</div>
            {{else}}
              <p class="st-note st-tl-empty">Move or pose something at a frame
                (auto key is on), or press I to key the selection.</p>
            {{/each}}
          {{else}}
            {{#each this.curves key="key" as |cv|}}
              <button
                type="button"
                class="st-tl-curve"
                {{on "click" (fn @s.toggleGraphComp cv.key)}}
              ><span
                  class="st-swatch"
                  style={{htmlStyle (concat "background:" cv.color)}}
                ></span>{{cv.label}}</button>
            {{/each}}
          {{/if}}
        </div>
        <div class="st-tl-canvas-wrap">
          <canvas
            class="st-tl-canvas"
            {{this.attach}}
            {{this.paint
              @s.clip
              @s.frame
              @s.anim.keySel
              @s.anim.view
              this.width
              this.height
              this.rows
              (array
                @s.anim.graphComps
                this.boxTick
                this.rowScroll
                this.zoom
                this.scroll
                @s.selected
                @s.boneSel
              )
            }}
            {{on "pointerdown" this.down}}
            {{on "pointermove" this.move}}
            {{on "pointerup" this.up}}
            {{on "wheel" this.wheel}}
          ></canvas>
        </div>
      </div>
    </div>
  </template>
}

function niceStep(ppf) {
  for (const s of [1, 2, 5, 10, 20, 50, 100, 200, 500])
    if (s * ppf >= 36) return s;
  return 1000;
}

function diamond(ctx, x, y, r, color, hollow, shape = 'diamond') {
  ctx.beginPath();
  if (shape === 'square') ctx.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
  else if (shape === 'tri') {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y + r * 0.8);
    ctx.lineTo(x - r, y + r * 0.8);
    ctx.closePath();
  } else {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
  }
  if (hollow) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineWidth = 1;
  } else {
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.stroke();
  }
}

function htmlStyle(s) {
  return htmlSafe(s);
}

function concat(...parts) {
  return parts.join('');
}

function array(...xs) {
  return xs;
}

// Pointer capture keeps a drag going outside the element; a pointer the
// browser doesn't know (a synthetic event) can't be captured, which is fine.
function capture(el, id) {
  try {
    el.setPointerCapture?.(id);
    return true;
  } catch {
    return false; // not a live pointer
  }
}
