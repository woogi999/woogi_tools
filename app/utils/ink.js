import { parseHex, toHex } from './color';

// Ink is stored as it looks in light mode. In dark mode, near-neutral colours
// (blacks, whites, greys) get their lightness flipped so black ink reads as
// white on a dark page, while real colours are left alone. With full strength
// the flip is its own inverse, so the same call converts both ways.
const NEUTRAL_SPREAD = 48;

function flip(r, g, b) {
  if (Math.max(r, g, b) - Math.min(r, g, b) > NEUTRAL_SPREAD) return null;
  const shift = 255 - Math.round((2 * (r + g + b)) / 3);
  return [r + shift, g + shift, b + shift];
}

export function flipNeutralHex(hex) {
  const rgb = parseHex(hex);
  const flipped = rgb && flip(rgb.r, rgb.g, rgb.b);
  return flipped ? toHex(...flipped) : hex;
}

// Flips every neutral pixel of an ImageData buffer in place (Uint8ClampedArray clamps for us).
export function flipNeutralPixels(data) {
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const flipped = flip(data[i], data[i + 1], data[i + 2]);
    if (flipped) [data[i], data[i + 1], data[i + 2]] = flipped;
  }
}

export function flipCanvasNeutrals(canvas) {
  const ctx = canvas.getContext('2d');
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  flipNeutralPixels(image.data);
  ctx.putImageData(image, 0, 0);
}

export const isDarkTheme = () => document.documentElement.getAttribute('data-theme') !== 'light';

// Lowest point a sticker reaches, so the note can grow to fit it. Emoji glyphs
// render a little taller than their font size.
export function stickerExtent(stickers = []) {
  return stickers.reduce((max, s) => Math.max(max, s.y + s.size * (s.type === 'emoji' ? 1.25 : 1)), 0);
}
