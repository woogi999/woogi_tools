// Ishihara-style plates: a disc of packed dots where a number is written in
// one family of hues and the rest in another, at the same lightness, so the
// figure can only be told apart by hue.

import { hslToRgb, toHex } from './color';

const SIZE = 420;
const RADIUS = 200;

// Hue ranges per plate type: [figure, background]. Lightness is shared and
// jittered on both sides so it says nothing about which dot is which.
export const PLATE_TYPES = {
  rg: {
    label: 'red-green',
    figure: [[2, 30, 62, 85]],
    background: [
      [70, 110, 30, 55],
      [45, 65, 35, 55],
    ],
  },
  by: {
    label: 'blue-yellow',
    figure: [[205, 250, 45, 70]],
    background: [[42, 62, 50, 75]],
  },
};

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const between = (lo, hi) => lo + Math.random() * (hi - lo);

// HSL lightness is not how bright a colour looks (a red and a green at the
// same L differ plainly), so the lightness is searched for the one that gives
// the wanted relative luminance. Then the figure really is hue alone.
function luminance(r, g, b) {
  const lin = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function colour(ranges, targetLuminance) {
  const [h0, h1, s0, s1] = pick(ranges);
  const h = between(h0, h1);
  const s = between(s0, s1);
  let lo = 5;
  let hi = 95;
  let rgb = hslToRgb(h, s, 50);
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    rgb = hslToRgb(h, s, mid);
    if (luminance(rgb.r, rgb.g, rgb.b) < targetLuminance) lo = mid;
    else hi = mid;
  }
  return toHex(rgb.r, rgb.g, rgb.b);
}

// Random circles that don't overlap, filling the disc.
function packDots() {
  const dots = [];
  for (let tries = 0; tries < 9000 && dots.length < 1400; tries++) {
    const r = between(3.5, 10.5);
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * (RADIUS - r - 1);
    const x = SIZE / 2 + Math.cos(angle) * dist;
    const y = SIZE / 2 + Math.sin(angle) * dist;
    let clear = true;
    for (const d of dots) {
      const dx = d.x - x;
      const dy = d.y - y;
      if (dx * dx + dy * dy < (d.r + r + 1.5) ** 2) {
        clear = false;
        break;
      }
    }
    if (clear) dots.push({ x, y, r });
  }
  return dots;
}

// The number drawn as a mask, to ask which dots land on it.
function maskFor(text) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${text.length > 1 ? 230 : 280}px Arial, Helvetica, sans-serif`;
  ctx.fillText(text, SIZE / 2, SIZE / 2 + 12);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  return (x, y) => data[(Math.round(y) * SIZE + Math.round(x)) * 4 + 3] > 128;
}

export function drawPlate(canvas, number, type) {
  const spec = PLATE_TYPES[type];
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);
  const inside = maskFor(String(number));
  const luminances = [
    between(0.16, 0.2),
    between(0.24, 0.29),
    between(0.33, 0.39),
  ];
  for (const dot of packDots()) {
    const light = pick(luminances) + between(-0.015, 0.015);
    ctx.fillStyle = colour(
      inside(dot.x, dot.y) ? spec.figure : spec.background,
      light,
    );
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// A run of plates: mostly red-green (by far the commonest deficiency), a
// few blue-yellow, in a shuffled order, each with three wrong answers.
export function makeRun() {
  const types = ['rg', 'rg', 'rg', 'rg', 'rg', 'rg', 'by', 'by', 'by'];
  types.sort(() => Math.random() - 0.5);
  const used = new Set();
  return types.map((type) => {
    let number;
    do {
      number =
        Math.random() < 0.5
          ? 2 + Math.floor(Math.random() * 8)
          : 10 + Math.floor(Math.random() * 88);
    } while (used.has(number));
    used.add(number);
    const options = new Set([number]);
    while (options.size < 4) {
      const near =
        number < 10
          ? 2 + Math.floor(Math.random() * 8)
          : Math.max(
              10,
              Math.min(97, number + Math.floor(Math.random() * 21) - 10),
            );
      options.add(near);
    }
    return {
      type,
      number,
      options: [...options].sort(() => Math.random() - 0.5),
    };
  });
}
