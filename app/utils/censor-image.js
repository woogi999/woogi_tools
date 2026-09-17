// The Image Censor's and Video Censor's shared painting: a picture, a set of
// marks (boxes, ovals, brush strokes), and an effect for each mark. Every
// effect is worked out over the whole frame once, then shown only through the
// marks' silhouette, which is what lets a brush stroke blur just where it went.

import { gaussian, noise } from './photo';

export const EFFECTS = [
  { id: 'blur', label: 'Blur' },
  { id: 'pixelate', label: 'Pixelate' },
  { id: 'black', label: 'Black box' },
  { id: 'colour', label: 'Colour box' },
  { id: 'noise', label: 'Static' },
];

// Draws a full-frame version of `source` with `effect` applied. `strength` is
// 1..100 and scales with the frame so the same setting looks the same on a
// thumbnail and the real thing.
const sizeOf = (source) => [
  source.videoWidth || source.width,
  source.videoHeight || source.height,
];

export function effectLayer(source, effect, strength, colour = '#000000') {
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = sizeOf(source);
  const ctx = canvas.getContext('2d');
  if (effect === 'black' || effect === 'colour') {
    ctx.fillStyle = effect === 'black' ? '#000' : colour;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
  }
  const { width, height } = canvas;
  const scale = Math.max(width, height) / 1000;
  if (effect === 'blur') {
    const radius = Math.max(1, Math.round((strength / 100) * 40 * scale));
    // The canvas filter is GPU-quick, which the video tool needs every frame;
    // the pixel loop is the fallback for browsers without it.
    if ('filter' in ctx) {
      ctx.filter = `blur(${radius}px)`;
      ctx.drawImage(source, 0, 0);
      ctx.filter = 'none';
    } else {
      ctx.drawImage(source, 0, 0);
      const image = ctx.getImageData(0, 0, width, height);
      const out = gaussian(image.data, width, height, radius);
      for (let i = 0; i < out.length; i += 4) {
        image.data[i] = out[i];
        image.data[i + 1] = out[i + 1];
        image.data[i + 2] = out[i + 2];
      }
      ctx.putImageData(image, 0, 0);
    }
    return canvas;
  }
  if (effect === 'pixelate') {
    // Shrink, then blow back up with smoothing off: instant mosaic.
    const block = Math.max(2, Math.round((strength / 100) * 60 * scale));
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(width / block));
    small.height = Math.max(1, Math.round(height / block));
    small.getContext('2d').drawImage(source, 0, 0, small.width, small.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    return canvas;
  }
  if (effect === 'noise') {
    const image = ctx.createImageData(width, height);
    const rand = noise(width * 7 + height + Math.floor(strength));
    for (let i = 0; i < image.data.length; i += 4) {
      const v = (rand() + 1) * 127;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
  return canvas;
}

// Paints the marks' silhouette in white on a transparent canvas. Marks are in
// 0..1 frame coordinates, so the same marks fit any size of the frame.
export function maskFor(marks, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const mark of marks) {
    if (mark.type === 'rect') {
      ctx.fillRect(
        mark.x * width,
        mark.y * height,
        mark.w * width,
        mark.h * height,
      );
    } else if (mark.type === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(
        (mark.x + mark.w / 2) * width,
        (mark.y + mark.h / 2) * height,
        Math.abs(mark.w / 2) * width,
        Math.abs(mark.h / 2) * height,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    } else if (mark.type === 'brush' && mark.points.length) {
      ctx.lineWidth = mark.size * Math.max(width, height);
      ctx.beginPath();
      const [first, ...rest] = mark.points;
      ctx.moveTo(first[0] * width, first[1] * height);
      if (!rest.length) ctx.lineTo(first[0] * width + 0.1, first[1] * height);
      for (const [x, y] of rest) ctx.lineTo(x * width, y * height);
      ctx.stroke();
    }
  }
  return canvas;
}

// Composites everything: the source, then each group of marks that share an
// effect, shown through their mask. Layers are cached by the caller through
// `layers` (a Map) since blurring a big frame is slow.
export function censor(
  target,
  source,
  marks,
  { layers = new Map(), colour = '#000000' } = {},
) {
  const [width, height] = sizeOf(source);
  target.width = width;
  target.height = height;
  const ctx = target.getContext('2d');
  ctx.drawImage(source, 0, 0);
  const groups = new Map();
  for (const mark of marks) {
    const key = `${mark.effect}:${mark.strength}:${mark.effect === 'colour' ? (mark.colour ?? colour) : ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(mark);
  }
  for (const [key, group] of groups) {
    let layer = layers.get(key);
    if (!layer) {
      layer = effectLayer(
        source,
        group[0].effect,
        group[0].strength,
        group[0].colour ?? colour,
      );
      layers.set(key, layer);
    }
    const mask = maskFor(group, width, height);
    const mctx = mask.getContext('2d');
    mctx.globalCompositeOperation = 'source-in';
    mctx.drawImage(layer, 0, 0);
    ctx.drawImage(mask, 0, 0);
  }
  return target;
}
