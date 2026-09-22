// The timeline canvas, ported from `ferrite-app/src/ui/timeline.rs`.
//
// Ferrite draws its timeline with Iced's canvas rather than with widgets, for
// a reason that survives the move to a browser unchanged: a ruler, a few
// hundred clip bars and a few thousand keyframe diamonds are one paint, and
// laying them out as elements is a fight with the layout engine that nobody
// wins. Drawing the *editor* this way is exactly where a canvas belongs.
//
// So this is the same drawing on a 2D context: the ruler with its markers, the
// layer bars with a grip at each end, keyframe diamonds — small and summarised
// on a layer or group row, full size and grabbable on a property row — the
// playhead, the rubber band, and the time bar underneath that pans and zooms
// the visible span. Hit testing lives here too, so what you can grab and what
// you can see are decided by the same numbers.

export { paletteOf } from './theme.js';

export const ROW_H = 22;
export const RULER_H = 22;
// The scrubber under the tracks, which pans and zooms the visible span.
export const TIME_BAR_H = 12;
// Width of the drag grip at each end of a layer's bar.
export const GRIP_W = 5;
// How far a press has to travel before it is a rubber band rather than a click
// that landed on nothing.
export const MARQUEE_SLOP = 3;
const KEY_SLOP = 6;

// The visible window: which slice of the scene the canvas is showing, and the
// two conversions everything else is written in terms of.
export class TimeMap {
  constructor(startMs, spanMs, width, durationMs) {
    const duration = Math.max(1, durationMs);
    this.duration = duration;
    this.span = Math.min(Math.max(spanMs, 50), duration);
    this.start = Math.min(
      Math.max(startMs, 0),
      Math.max(0, duration - this.span),
    );
    this.width = Math.max(1, width);
  }

  x(ms) {
    return ((ms - this.start) / this.span) * this.width;
  }

  ms(x) {
    return this.start + (Math.max(0, x) / this.width) * this.span;
  }
}

// A tick roughly every 90px, on a round number of milliseconds.
const STEPS = [
  10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000,
];
export function tickStep(spanMs, width) {
  const rough = spanMs * (90 / Math.max(1, width));
  return STEPS.find((s) => s >= rough) ?? STEPS[STEPS.length - 1];
}

const tickLabel = (ms) => {
  const s = ms / 1000;
  if (s >= 60)
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return s % 1 === 0 ? `${s}s` : `${s.toFixed(1)}s`;
};

function diamond(ctx, x, y, half) {
  ctx.beginPath();
  ctx.moveTo(x, y - half);
  ctx.lineTo(x + half, y);
  ctx.lineTo(x, y + half);
  ctx.lineTo(x - half, y);
  ctx.closePath();
}

function playhead(ctx, map, ms, top, height, head, accent) {
  const x = map.x(ms);
  ctx.fillStyle = accent;
  ctx.fillRect(x - 0.75, top, 1.5, height);
  if (!head) return;
  ctx.beginPath();
  ctx.moveTo(x - 6, top);
  ctx.lineTo(x + 6, top);
  ctx.lineTo(x, top + 9);
  ctx.closePath();
  ctx.fill();
}

export const canvasHeight = (rows) => rows.length * ROW_H + TIME_BAR_H;

// The ruler is its own canvas, pinned to the top of the timeline while the
// tracks scroll under it. It used to be the first band of the tracks canvas,
// which meant scrolling down to a layer scrolled the scrub bar off the screen
// — and the scrub bar is the one control you reach for constantly.
export function drawRuler(canvas, map, options) {
  const {
    timeMs,
    markers = [],
    palette,
    dpr = window.devicePixelRatio || 1,
  } = options;
  const width = map.width;
  const wantW = Math.round(width * dpr);
  const wantH = Math.round(RULER_H * dpr);
  if (canvas.width !== wantW || canvas.height !== wantH) {
    canvas.width = wantW;
    canvas.height = wantH;
  }
  canvas.style.height = `${RULER_H}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, RULER_H);

  ctx.fillStyle = palette.panelAlt;
  ctx.fillRect(0, 0, width, RULER_H);
  const step = tickStep(map.span, width);
  ctx.font = '9px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  for (
    let t = Math.floor(map.start / step) * step;
    t <= map.start + map.span + step;
    t += step
  ) {
    if (t < 0) continue;
    const x = map.x(t);
    if (x < -20 || x > width + 20) continue;
    ctx.fillStyle = palette.border;
    ctx.fillRect(x, RULER_H - 7, 1, 7);
    ctx.fillStyle = palette.dim;
    ctx.fillText(tickLabel(t), x + 3, 3);
  }

  for (const marker of markers) {
    const x = map.x(marker.ms);
    if (x < -8 || x > width + 8) continue;
    ctx.fillStyle = palette.marker;
    ctx.fillRect(x, 0, 2, RULER_H);
    ctx.font = '9px system-ui, sans-serif';
    ctx.fillText(marker.name, x + 4, RULER_H - 12);
  }

  playhead(ctx, map, timeMs, 0, RULER_H, true, palette.playhead);
}

// rows: [{ kind: 'layer' | 'group' | 'effect' | 'prop', label, depth, selected,
//          span: [inMs, outMs], keys: [{ ms, selected }], dim }]
export function drawTimeline(canvas, rows, map, options) {
  const {
    timeMs,
    markers = [],
    marquee,
    palette,
    dpr = window.devicePixelRatio || 1,
  } = options;
  const width = map.width;
  const height = canvasHeight(rows);
  const wantW = Math.round(width * dpr);
  const wantH = Math.round(height * dpr);
  if (canvas.width !== wantW || canvas.height !== wantH) {
    canvas.width = wantW;
    canvas.height = wantH;
  }
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const tracksTop = 0;
  const tracksH = rows.length * ROW_H;
  const barTop = tracksTop + tracksH;

  ctx.fillStyle = palette.panel;
  ctx.fillRect(0, tracksTop, width, tracksH);

  const step = tickStep(map.span, width);
  ctx.font = '9px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  for (
    let t = Math.floor(map.start / step) * step;
    t <= map.start + map.span + step;
    t += step
  ) {
    if (t < 0) continue;
    const x = map.x(t);
    if (x < -20 || x > width + 20) continue;
    ctx.fillStyle = palette.grid;
    ctx.fillRect(x, tracksTop, 1, tracksH);
  }

  // ── the rows
  rows.forEach((row, index) => {
    const y = tracksTop + index * ROW_H;
    if (row.selected && row.kind === 'layer') {
      ctx.fillStyle = palette.selection;
      ctx.fillRect(0, y, width, ROW_H);
    } else if (index % 2 === 1) {
      ctx.fillStyle = palette.stripe;
      ctx.fillRect(0, y, width, ROW_H);
    }

    const centre = y + ROW_H / 2;

    if (row.kind === 'layer' && row.span) {
      const x0 = Math.max(0, map.x(row.span[0]));
      const x1 = Math.min(width, map.x(row.span[1]));
      if (x1 > x0) {
        ctx.globalAlpha = row.dim ? 0.4 : 1;
        ctx.fillStyle = row.selected ? palette.barActive : palette.bar;
        ctx.beginPath();
        ctx.roundRect(x0, y + 4, x1 - x0, ROW_H - 8, 2);
        ctx.fill();
        // Grips, so the draggable ends of the bar are visible rather than
        // something you have to know is there.
        ctx.fillStyle = row.selected ? palette.gripActive : palette.grip;
        for (const gx of [x0, x1 - GRIP_W])
          if (gx >= x0 - 0.5 && gx + GRIP_W <= x1 + 0.5)
            ctx.fillRect(gx, y + 4, GRIP_W, ROW_H - 8);
        ctx.globalAlpha = 1;
      }
    }

    // A layer or a group summarises its members' keyframes; a property row
    // shows its own, full size and grabbable.
    const summary = row.kind !== 'prop';
    for (const key of row.keys ?? []) {
      const x = map.x(key.ms);
      if (x < -8 || x > width + 8) continue;
      diamond(ctx, x, centre, summary ? 3 : 4.5);
      ctx.fillStyle = key.selected
        ? palette.keySelected
        : summary
          ? palette.keySummary
          : palette.key;
      ctx.fill();
      if (key.selected) {
        ctx.strokeStyle = palette.accent;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  });

  // ── markers, down the ruler and faintly through the tracks
  for (const marker of markers) {
    const x = map.x(marker.ms);
    if (x < -8 || x > width + 8) continue;
    ctx.fillStyle = palette.markerSoft;
    ctx.fillRect(x, tracksTop, 1, tracksH);
  }

  if (marquee) {
    const x = Math.min(marquee.x0, marquee.x1);
    const y = Math.min(marquee.y0, marquee.y1);
    const w = Math.abs(marquee.x1 - marquee.x0);
    const h = Math.abs(marquee.y1 - marquee.y0);
    ctx.fillStyle = palette.selection;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  }

  playhead(ctx, map, timeMs, 0, barTop, false, palette.playhead);

  // ── the time bar: the whole scene, with the visible window drawn on it
  ctx.fillStyle = palette.panelAlt;
  ctx.fillRect(0, barTop, width, TIME_BAR_H);
  const wholeX = (ms) => (ms / map.duration) * width;
  ctx.fillStyle = palette.bar;
  ctx.beginPath();
  ctx.roundRect(
    wholeX(map.start),
    barTop + 2,
    Math.max(8, wholeX(map.span)),
    TIME_BAR_H - 4,
    3,
  );
  ctx.fill();
  ctx.fillStyle = palette.playhead;
  ctx.fillRect(wholeX(timeMs) - 0.5, barTop, 1, TIME_BAR_H);

  return height;
}

export const rowAt = (y) => Math.floor(y / ROW_H);

// What is under the pointer, in the order a press should claim it: the ruler,
// then a keyframe, then a clip's grip, then its body, then nothing.
export function hitTest(rows, map, x, y) {
  const barTop = rows.length * ROW_H;
  if (y >= barTop) return { what: 'time-bar' };
  const index = rowAt(y);
  const row = rows[index];
  if (!row) return { what: 'empty', index };

  for (const key of row.keys ?? [])
    if (Math.abs(map.x(key.ms) - x) <= KEY_SLOP)
      return { what: 'key', index, row, ms: key.ms };

  if (row.kind === 'layer' && row.span) {
    const x0 = map.x(row.span[0]);
    const x1 = map.x(row.span[1]);
    if (x >= x0 - 2 && x <= x1 + 2) {
      if (x <= x0 + GRIP_W) return { what: 'trim-in', index, row };
      if (x >= x1 - GRIP_W) return { what: 'trim-out', index, row };
      return { what: 'bar', index, row };
    }
  }
  return { what: 'empty', index, row };
}
