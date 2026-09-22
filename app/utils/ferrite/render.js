// The compositor: one renderer, drawing every surface the editor shows.
//
// Ferrite's hardest-won lesson is in its README: it used to hand a browser a
// generated document and hope the browser arrived at the same picture the
// engine had, and it could not — different text shaping broke lines at
// different words, different clocks resampled the same easing a frame apart,
// and any effect CSS could not express simply was not there. So there is one
// renderer here too. The viewport, the thumbnails and the written-out file are
// all this function, and a difference between them is a bug rather than a
// setting.
//
// The engine is a 2D canvas. That is a real choice rather than a shortcut:
// `ctx.filter` takes the same filter syntax the effect catalogue emits, so the
// 112 filter-slot effects are honoured exactly as written, and the other four
// slots are composited here by hand.

import {
  KINDS,
  draws,
  liveAt,
  valueAt,
  transformAt,
  opacityAt,
  effectDeclarations,
  effectSteps,
  rasterOf,
} from './model.js';
import { runPasses } from './gpu.js';

/* ------------------------------------------------------------- helpers */

// How a picture sits in its box: the four words CSS uses, because they are the
// four words the engine understands.
function fitRect(fit, sw, sh, dw, dh) {
  if (!sw || !sh) return { x: 0, y: 0, w: dw, h: dh };
  if (fit === 'fill') return { x: 0, y: 0, w: dw, h: dh };
  if (fit === 'none')
    return { x: (dw - sw) / 2, y: (dh - sh) / 2, w: sw, h: sh };
  const k =
    fit === 'cover' ? Math.max(dw / sw, dh / sh) : Math.min(dw / sw, dh / sh);
  return { x: (dw - sw * k) / 2, y: (dh - sh * k) / 2, w: sw * k, h: sh * k };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (!r) ctx.rect(x, y, w, h);
  else ctx.roundRect(x, y, w, h, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
}

const scratchPool = [];
function borrow(w, h) {
  const canvas = scratchPool.pop() ?? document.createElement('canvas');
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  } else {
    canvas.getContext('2d').clearRect(0, 0, w, h);
  }
  return canvas;
}
const giveBack = (canvas) => {
  if (scratchPool.length < 8) scratchPool.push(canvas);
};

/* ------------------------------------------------- CSS gradient parsing */

// Enough of the CSS gradient grammar to draw what the effect catalogue emits:
// `linear-gradient(<deg>, <stop>...)` and `radial-gradient(circle at x% y%,
// <stop>...)`. Anything else is skipped rather than guessed at.
function splitTop(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseStop(text) {
  const m = text.match(/^(.*?)\s+(-?[\d.]+)%$/);
  if (m) return { colour: m[1].trim(), at: Number(m[2]) / 100 };
  return { colour: text.trim(), at: null };
}

function applyStops(gradient, stops) {
  const n = stops.length;
  stops.forEach((stop, i) => {
    const at = stop.at ?? (n === 1 ? 0 : i / (n - 1));
    gradient.addColorStop(Math.min(1, Math.max(0, at)), stop.colour);
  });
}

// Builds a canvas gradient for one `<gradient>()` fragment over a w×h box.
function gradientFor(ctx, fragment, w, h) {
  const linear = fragment.match(/^linear-gradient\((.*)\)$/s);
  if (linear) {
    const parts = splitTop(linear[1]);
    let angle = 180;
    if (/^-?[\d.]+deg$/.test(parts[0]))
      angle = Number(parts.shift().replace('deg', ''));
    // CSS measures from "to top" clockwise; the canvas wants the line's ends.
    const rad = ((angle - 90) * Math.PI) / 180;
    const len = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
    const cx = w / 2;
    const cy = h / 2;
    const dx = (Math.cos(rad) * len) / 2;
    const dy = (Math.sin(rad) * len) / 2;
    const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    applyStops(g, parts.map(parseStop));
    return g;
  }
  const radial = fragment.match(/^radial-gradient\((.*)\)$/s);
  if (radial) {
    const parts = splitTop(radial[1]);
    let cx = w / 2;
    let cy = h / 2;
    const at = parts[0]?.match(/at\s+(-?[\d.]+)%\s+(-?[\d.]+)%/);
    if (at) {
      cx = (Number(at[1]) / 100) * w;
      cy = (Number(at[2]) / 100) * h;
      parts.shift();
    } else if (/^(circle|ellipse)/.test(parts[0] ?? '')) {
      parts.shift();
    }
    const r = Math.max(w, h) * 0.75;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    applyStops(g, parts.map(parseStop));
    return g;
  }
  return null;
}

// `box-shadow` fragments: `<x>px <y>px <blur>px [<spread>px] <colour>` with an
// optional leading `inset`.
function parseShadows(value) {
  return splitTop(value)
    .map((part) => {
      const inset = /\binset\b/.test(part);
      const body = part.replace(/\binset\b/, '').trim();
      // The colour is whatever is left once the lengths are taken off the
      // front; a function colour may itself contain spaces.
      const m = body.match(
        /^(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?(?:\s+(-?[\d.]+)px)?\s+(.+)$/,
      );
      if (!m) return null;
      return {
        inset,
        x: Number(m[1]),
        y: Number(m[2]),
        blur: Number(m[3] ?? 0),
        spread: Number(m[4] ?? 0),
        colour: m[5].trim(),
      };
    })
    .filter(Boolean);
}

/* ------------------------------------------------------- one layer's box */

// Where a layer's own box is, in scene coordinates, before its transform.
export function boxOf(layer, ms, scene, settings, source) {
  const raster = rasterOf(scene, settings);
  const auto = layer.style.autoSize;
  let w = valueAt(layer, 'width', ms);
  let h = valueAt(layer, 'height', ms);
  if (auto) {
    if (layer.kind === 'box' || layer.kind === 'adjustment') {
      w = raster.width;
      h = raster.height;
    } else if (source) {
      w = source.videoWidth || source.naturalWidth || raster.width;
      h = source.videoHeight || source.naturalHeight || raster.height;
      const k = Math.min(raster.width / w, raster.height / h, 1);
      w *= k;
      h *= k;
    } else if (layer.kind === 'text') {
      w = raster.width;
      h = valueAt(layer, 'fontSize', ms) * 1.6;
    }
  }
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

function paintText(ctx, layer, ms, w, h) {
  const size = valueAt(layer, 'fontSize', ms);
  const weight = Math.round(valueAt(layer, 'fontWeight', ms));
  const style = layer.style;
  ctx.font = `${style.fontStyle === 'italic' ? 'italic ' : ''}${weight} ${size}px ${style.fontFamily}, system-ui, sans-serif`;
  ctx.fillStyle = style.color;
  ctx.textAlign = style.textAlign;
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = `${valueAt(layer, 'letterSpacing', ms)}px`;
  let text = String(layer.content ?? '');
  if (style.textTransform === 'uppercase') text = text.toUpperCase();
  else if (style.textTransform === 'lowercase') text = text.toLowerCase();
  else if (style.textTransform === 'capitalize')
    text = text.replace(/\b\w/g, (ch) => ch.toUpperCase());
  const lines = text.split('\n');
  const lh = size * valueAt(layer, 'lineHeight', ms);
  const pad = valueAt(layer, 'padding', ms);
  const x =
    style.textAlign === 'left'
      ? pad
      : style.textAlign === 'right'
        ? w - pad
        : w / 2;
  lines.forEach((line, i) =>
    ctx.fillText(line, x, h / 2 + (i - (lines.length - 1) / 2) * lh),
  );
  ctx.letterSpacing = '0px';
}

// Draws the layer's own content into a surface of its own box's size. The
// transform, the effects and the compositing all happen to what comes back.
function paintContent(ctx, layer, ms, w, h, source, scene, settings) {
  const style = layer.style;
  const radius = valueAt(layer, 'borderRadius', ms);

  ctx.save();
  if (radius || style.clip) {
    roundRect(ctx, 0, 0, w, h, radius);
    ctx.clip();
  }

  if (style.background && style.background !== 'transparent') {
    const gradient = gradientFor(ctx, style.background, w, h);
    ctx.fillStyle = gradient ?? style.background;
    ctx.fillRect(0, 0, w, h);
  }

  if (layer.kind === 'text') {
    paintText(ctx, layer, ms, w, h);
  } else if (source && (layer.kind === 'image' || layer.kind === 'video')) {
    const sw = source.videoWidth || source.naturalWidth || w;
    const sh = source.videoHeight || source.naturalHeight || h;
    const box = fitRect(style.objectFit, sw, sh, w, h);
    try {
      ctx.drawImage(source, box.x, box.y, box.w, box.h);
    } catch {
      // A frame that is not decoded yet: leave what is underneath.
    }
  } else if (layer.kind === 'svg' && source) {
    try {
      ctx.drawImage(source, 0, 0, w, h);
    } catch {
      // As above.
    }
  }
  ctx.restore();

  const borderWidth = valueAt(layer, 'borderWidth', ms);
  if (borderWidth > 0) {
    ctx.save();
    ctx.strokeStyle = style.borderColor;
    ctx.lineWidth = borderWidth;
    roundRect(
      ctx,
      borderWidth / 2,
      borderWidth / 2,
      w - borderWidth,
      h - borderWidth,
      Math.max(0, radius - borderWidth / 2),
    );
    ctx.stroke();
    ctx.restore();
  }
  void scene;
  void settings;
}

// Runs the layer's effect stack over its surface, in the order it was authored.
//
// The CSS steps are applied by drawing the surface through `ctx.filter` onto
// itself; the shader steps go to `gpu.js`. A shader step that cannot run —
// no WebGL2, a shader that will not compile — leaves the surface alone and
// reports it, rather than quietly producing a different picture.
function applyStack(surface, steps, w, h, onNote) {
  let filterTail = 'none';
  for (const step of steps) {
    if (step.kind === 'shader') {
      const ran = runPasses(surface, [step], (why) =>
        onNote?.(`${step.name}: ${why}`),
      );
      if (!ran) onNote?.(`${step.name} could not run on this device.`);
      continue;
    }
    // The three image slots are compositing rather than filtering, so they are
    // applied to the surface directly.
    applyImageSlots(surface, step.declarations, w, h);
    const filter = step.declarations.filter;
    if (!filter) continue;
    // The last filter in the stack is handed back so the compositor can apply
    // it as it draws, which saves a copy in the common case of one effect.
    if (step === steps[steps.length - 1]) {
      filterTail = filter;
      continue;
    }
    const copy = borrow(w, h);
    const cctx = copy.getContext('2d');
    cctx.filter = filter;
    cctx.drawImage(surface, 0, 0);
    cctx.filter = 'none';
    const sctx = surface.getContext('2d');
    sctx.save();
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalCompositeOperation = 'copy';
    sctx.drawImage(copy, 0, 0);
    sctx.restore();
    giveBack(copy);
  }
  return filterTail;
}

// `mask-image` and `background-image` from the effect stack, applied to the
// layer's own surface. A mask multiplies the alpha; a background is painted
// over what is already there but only where the layer is.
function applyImageSlots(surface, decls, w, h) {
  const ctx = surface.getContext('2d');
  if (decls.maskImage) {
    const mask = borrow(w, h);
    const mctx = mask.getContext('2d');
    for (const fragment of splitTop(decls.maskImage)) {
      const gradient = gradientFor(mctx, fragment, w, h);
      if (!gradient) continue;
      mctx.fillStyle = gradient;
      mctx.fillRect(0, 0, w, h);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask, 0, 0);
    ctx.restore();
    giveBack(mask);
  }
  if (decls.backgroundImage) {
    ctx.save();
    // Only where the layer already is, so a sheen does not paint a rectangle
    // over the whole box of a shaped layer.
    ctx.globalCompositeOperation = 'source-atop';
    for (const fragment of splitTop(decls.backgroundImage)) {
      const gradient = gradientFor(ctx, fragment, w, h);
      if (!gradient) continue;
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }
}

// `box-shadow` from the stack: the outset ones are drawn behind the layer, the
// inset ones inside it.
function paintShadows(ctx, surface, shadows, w, h, inset) {
  for (const s of shadows) {
    if (Boolean(s.inset) !== inset) continue;
    if (inset) {
      const ring = borrow(w, h);
      const rctx = ring.getContext('2d');
      rctx.fillStyle = s.colour;
      rctx.fillRect(0, 0, w, h);
      rctx.globalCompositeOperation = 'destination-out';
      rctx.filter = s.blur ? `blur(${s.blur}px)` : 'none';
      rctx.fillRect(
        s.x + s.spread,
        s.y + s.spread,
        w - 2 * s.spread,
        h - 2 * s.spread,
      );
      rctx.filter = 'none';
      // Only inside the layer's own silhouette.
      rctx.globalCompositeOperation = 'destination-in';
      rctx.drawImage(surface, 0, 0);
      ctx.drawImage(ring, 0, 0);
      giveBack(ring);
    } else {
      ctx.save();
      // A coloured copy of the layer's silhouette, offset and softened — which
      // is what a drop shadow is.
      const silhouette = borrow(w, h);
      const sctx = silhouette.getContext('2d');
      sctx.drawImage(surface, 0, 0);
      sctx.globalCompositeOperation = 'source-in';
      sctx.fillStyle = s.colour;
      sctx.fillRect(0, 0, w, h);
      ctx.filter = s.blur ? `blur(${s.blur / 2}px)` : 'none';
      ctx.drawImage(silhouette, s.x, s.y);
      ctx.filter = 'none';
      giveBack(silhouette);
      ctx.restore();
    }
  }
}

/* ------------------------------------------------------------ the scene */

// Draws a scene onto a 2D context at a time in milliseconds.
//
// `sources` maps a layer id to whatever holds its pixels — a <video> already
// seeked to the right frame, or an <img>. Audio layers draw nothing.
export function drawScene(ctx, scene, settings, ms, sources, options = {}) {
  const raster = rasterOf(scene, settings);
  const W = raster.width;
  const H = raster.height;
  const layers = scene.layers;
  const byId = (id) => layers.find((l) => l.id === id);
  // A copy with the solo flags dropped, for a render told to ignore them.
  // `liveAt` decides soloing by looking at the whole list, so the switch has
  // to be a different list rather than a flag passed down to it.
  const unsoloed = options.ignoreSolo
    ? layers.map((l) => (l.solo ? { ...l, solo: false } : l))
    : layers;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.clearRect(0, 0, W, H);
  if (scene.background && scene.background !== 'transparent') {
    ctx.fillStyle = scene.background;
    ctx.fillRect(0, 0, W, H);
  }

  // Top of the list is the front of the picture, so it is painted last. The
  // matte of a layer is the layer directly above it, which is why the walk is
  // by index rather than over a reversed copy.
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (!liveAt(layer, ms, options.ignoreSolo ? unsoloed : layers)) continue;
    // A matte draws nothing of its own: it is only there to cut out the layer
    // under it.
    const isMatteFor = i + 1 < layers.length && layers[i + 1].matte !== 'none';
    if (isMatteFor) continue;

    // What the render settings switched off. After Effects lets a render
    // ignore the comp's own switches — draft a version with no effects, or
    // render the whole thing while a layer is soloed for working on — and a
    // render that could not would send you round the comp turning things off
    // and back on again afterwards.
    const decls = options.noEffects ? [] : effectDeclarations(layer, ms);

    if (layer.kind === 'adjustment') {
      applyAdjustment(ctx, layer, ms, decls, W, H, byId);
      continue;
    }
    if (!draws(layer)) continue;

    const alpha = opacityAt(layer, ms, byId);
    if (alpha <= 0.001) continue;

    const source = sources?.get(layer.id);
    const { w, h } = boxOf(layer, ms, scene, settings, source);
    const iw = Math.max(1, Math.ceil(w));
    const ih = Math.max(1, Math.ceil(h));

    const surface = borrow(iw, ih);
    const sctx = surface.getContext('2d');
    paintContent(sctx, layer, ms, iw, ih, source, scene, settings);

    // The stack, in the order it was authored: CSS steps and shader steps
    // interleaved. What comes back is the last filter in the stack, left for
    // the draw below so the common case of one effect costs no extra copy.
    const stackFilter = applyStack(
      surface,
      options.noEffects ? [] : effectSteps(layer, ms, { w: iw, h: ih }),
      iw,
      ih,
      options.onNote,
    );

    // The layer's own matte, which is the layer directly above it.
    if (layer.matte !== 'none' && i - 1 >= 0) {
      applyMatte(
        surface,
        layers[i - 1],
        layer.matte,
        ms,
        scene,
        settings,
        sources,
        iw,
        ih,
      );
    }

    // Motion blur: the layer drawn several times across the shutter's opening
    // and averaged. A shutter angle of 180 means the shutter is open for half
    // a frame, which is the film convention the scene setting follows.
    if (
      layer.motionBlur &&
      !options.noMotionBlur &&
      (scene.shutterAngle ?? 0) > 0
    ) {
      const open =
        ((scene.shutterAngle ?? 180) / 360) *
        (1000 / (scene.fps ?? settings.fps ?? 30));
      drawSmeared(ctx, layer, ms, open, {
        byId,
        W,
        H,
        surface,
        alpha,
      });
      giveBack(surface);
      continue;
    }

    const t = transformAt(layer, ms, byId);
    const ax = valueAt(layer, 'anchorX', ms) / 100;
    const ay = valueAt(layer, 'anchorY', ms) / 100;
    const blur = valueAt(layer, 'blur', ms);

    ctx.save();
    ctx.globalAlpha = alpha;
    if (layer.style.mixBlendMode && layer.style.mixBlendMode !== 'normal')
      ctx.globalCompositeOperation = layer.style.mixBlendMode;

    // The backdrop filter reads what is already composited under the layer's
    // box, so it happens before the layer is drawn and after everything below
    // it has been.
    const backdropBlur = valueAt(layer, 'backdropBlur', ms);
    if (backdropBlur > 0 || decls.backdropFilter)
      paintBackdrop(ctx, decls, backdropBlur, W, H);

    ctx.translate(W / 2 + t.x, H / 2 + t.y);
    ctx.rotate(t.rotation);
    if (t.skewX) ctx.transform(1, 0, Math.tan(t.skewX), 1, 0, 0);
    ctx.scale(t.scale, t.scale);
    ctx.translate(-ax * iw, -ay * ih);

    const shadows = [
      ...(layer.style.shadow && layer.style.shadow !== 'none'
        ? parseShadows(layer.style.shadow)
        : []),
      ...(decls.boxShadow ? parseShadows(decls.boxShadow) : []),
    ];
    paintShadows(ctx, surface, shadows, iw, ih, false);

    // The filter slot is the one place the catalogue's CSS goes in verbatim:
    // a 2D context takes the same grammar the effects emit.
    const filters = [
      stackFilter === 'none' ? '' : stackFilter,
      blur > 0 ? `blur(${blur}px)` : '',
    ]
      .filter(Boolean)
      .join(' ');
    ctx.filter = filters || 'none';
    ctx.drawImage(surface, 0, 0);
    ctx.filter = 'none';

    paintShadows(ctx, surface, shadows, iw, ih, true);
    ctx.restore();
    giveBack(surface);
  }

  if (options.safeAreas) drawSafeAreas(ctx, W, H);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
}

// One layer, drawn as many times as the shutter has samples, each at a
// slightly different instant and each at a fraction of the opacity. What moved
// between them smears; what held still stays sharp, which is the whole point
// of asking per layer rather than per scene.
const SHUTTER_SAMPLES = 9;

function drawSmeared(ctx, layer, ms, openMs, ctx2) {
  const { byId, W, H, surface, alpha } = ctx2;
  const iw = surface.width;
  const ih = surface.height;
  for (let i = 0; i < SHUTTER_SAMPLES; i++) {
    // Centred on the frame's own time, so the object is where it should be and
    // the smear reaches equally either side of it.
    const at = ms + (i / (SHUTTER_SAMPLES - 1) - 0.5) * openMs;
    const t = transformAt(layer, at, byId);
    const ax = valueAt(layer, 'anchorX', at) / 100;
    const ay = valueAt(layer, 'anchorY', at) / 100;
    ctx.save();
    ctx.globalAlpha = alpha / SHUTTER_SAMPLES;
    if (layer.style.mixBlendMode && layer.style.mixBlendMode !== 'normal')
      ctx.globalCompositeOperation = layer.style.mixBlendMode;
    ctx.translate(W / 2 + t.x, H / 2 + t.y);
    ctx.rotate(t.rotation);
    if (t.skewX) ctx.transform(1, 0, Math.tan(t.skewX), 1, 0, 0);
    ctx.scale(t.scale, t.scale);
    ctx.translate(-ax * iw, -ay * ih);
    const blur = valueAt(layer, 'blur', at);
    ctx.filter = blur > 0 ? `blur(${blur}px)` : 'none';
    ctx.drawImage(surface, 0, 0);
    ctx.filter = 'none';
    ctx.restore();
  }
}

// An adjustment layer draws nothing and filters everything beneath it: the
// scene is painted back to front, so everything below this row is already on
// the canvas and is what gets graded.
function applyAdjustment(ctx, layer, ms, decls, W, H, byId) {
  const filters = decls.filter;
  if (!filters) return;
  const alpha = opacityAt(layer, ms, byId);
  if (alpha <= 0.001) return;
  const beneath = borrow(W, H);
  beneath.getContext('2d').drawImage(ctx.canvas, 0, 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.filter = filters;
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(beneath, 0, 0);
  ctx.restore();
  ctx.filter = 'none';
  giveBack(beneath);
}

function paintBackdrop(ctx, decls, blur, W, H) {
  const filters = [decls.backdropFilter, blur > 0 ? `blur(${blur}px)` : '']
    .filter(Boolean)
    .join(' ');
  if (!filters) return;
  const beneath = borrow(W, H);
  beneath.getContext('2d').drawImage(ctx.canvas, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = filters;
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(beneath, 0, 0);
  ctx.restore();
  ctx.filter = 'none';
  giveBack(beneath);
}

// A track matte cuts one layer out with the one above it: alpha uses that
// layer's transparency, luma its brightness, and either can be inverted.
function applyMatte(
  surface,
  matteLayer,
  mode,
  ms,
  scene,
  settings,
  sources,
  w,
  h,
) {
  const source = sources?.get(matteLayer.id);
  const box = boxOf(matteLayer, ms, scene, settings, source);
  const mask = borrow(w, h);
  const mctx = mask.getContext('2d');
  const inner = borrow(Math.ceil(box.w), Math.ceil(box.h));
  paintContent(
    inner.getContext('2d'),
    matteLayer,
    ms,
    inner.width,
    inner.height,
    source,
    scene,
    settings,
  );
  mctx.drawImage(inner, 0, 0, w, h);
  giveBack(inner);

  if (mode.startsWith('luma')) {
    const data = mctx.getImageData(0, 0, w, h);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      // Rec. 709 luma, which is what a broadcast matte is judged on.
      const luma =
        (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
      px[i + 3] = Math.round(px[i + 3] * luma);
    }
    mctx.putImageData(data, 0, 0);
  }
  if (mode.endsWith('inverted')) {
    const data = mctx.getImageData(0, 0, w, h);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) px[i + 3] = 255 - px[i + 3];
    mctx.putImageData(data, 0, 0);
  }

  const ctx = surface.getContext('2d');
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0);
  ctx.restore();
  giveBack(mask);
}

// The 90% and 80% boxes, drawn over the picture and never into it.
function drawSafeAreas(ctx, W, H) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = Math.max(1, W / 960);
  for (const inset of [0.05, 0.1]) {
    ctx.strokeRect(
      W * inset,
      H * inset,
      W * (1 - 2 * inset),
      H * (1 - 2 * inset),
    );
  }
  ctx.beginPath();
  ctx.moveTo(W / 2, 0);
  ctx.lineTo(W / 2, H);
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.stroke();
  ctx.restore();
}

/* ---------------------------------------------------------- hit testing */

// Which layer is under a point on the stage, topmost first. Used by the
// selection tool, so what you click is what the compositor drew.
export function layerAt(scene, settings, ms, sources, sx, sy) {
  const raster = rasterOf(scene, settings);
  const layers = scene.layers;
  const byId = (id) => layers.find((l) => l.id === id);
  for (const layer of layers) {
    if (!liveAt(layer, ms, layers) || !draws(layer) || layer.locked) continue;
    const source = sources?.get(layer.id);
    const { w, h } = boxOf(layer, ms, scene, settings, source);
    const t = transformAt(layer, ms, byId);
    const ax = valueAt(layer, 'anchorX', ms) / 100;
    const ay = valueAt(layer, 'anchorY', ms) / 100;
    // Undo the layer's transform and ask whether the point is in its own box.
    let px = sx - (raster.width / 2 + t.x);
    let py = sy - (raster.height / 2 + t.y);
    const cos = Math.cos(-t.rotation);
    const sin = Math.sin(-t.rotation);
    [px, py] = [px * cos - py * sin, px * sin + py * cos];
    px /= t.scale || 1;
    py /= t.scale || 1;
    px += ax * w;
    py += ay * h;
    if (px >= 0 && px <= w && py >= 0 && py <= h) return layer;
  }
  return null;
}

// The four corners of a layer's box on the stage, for the selection handles.
export function handlesOf(layer, scene, settings, ms, sources) {
  const raster = rasterOf(scene, settings);
  const layers = scene.layers;
  const byId = (id) => layers.find((l) => l.id === id);
  const source = sources?.get(layer.id);
  const { w, h } = boxOf(layer, ms, scene, settings, source);
  const t = transformAt(layer, ms, byId);
  const ax = valueAt(layer, 'anchorX', ms) / 100;
  const ay = valueAt(layer, 'anchorY', ms) / 100;
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  const put = (lx, ly) => {
    const x = (lx - ax * w) * t.scale;
    const y = (ly - ay * h) * t.scale;
    return {
      x: raster.width / 2 + t.x + x * cos - y * sin,
      y: raster.height / 2 + t.y + x * sin + y * cos,
    };
  };
  return {
    corners: [put(0, 0), put(w, 0), put(w, h), put(0, h)],
    anchor: put(ax * w, ay * h),
  };
}

export { KINDS };
