/* eslint-disable warp-drive/no-legacy-request-patterns -- ctx.save() here is the canvas API, not a data request */
// Stamping a name, a logo or a "DRAFT" across pictures. Everything is drawn on
// a canvas in the browser, so the originals never leave the device.

export const SPOTS = [
  { id: 'top-left', label: 'Top left' },
  { id: 'top', label: 'Top' },
  { id: 'top-right', label: 'Top right' },
  { id: 'left', label: 'Left' },
  { id: 'centre', label: 'Middle' },
  { id: 'right', label: 'Right' },
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'bottom', label: 'Bottom' },
  { id: 'bottom-right', label: 'Bottom right' },
  { id: 'tiled', label: 'Tiled all over' },
];

const at = (spot, width, height, w, h, margin) => {
  const [row, col] = {
    'top-left': ['start', 'start'],
    top: ['start', 'centre'],
    'top-right': ['start', 'end'],
    left: ['centre', 'start'],
    centre: ['centre', 'centre'],
    right: ['centre', 'end'],
    'bottom-left': ['end', 'start'],
    bottom: ['end', 'centre'],
    'bottom-right': ['end', 'end'],
  }[spot] ?? ['end', 'end'];
  const x =
    col === 'start'
      ? margin
      : col === 'end'
        ? width - w - margin
        : (width - w) / 2;
  const y =
    row === 'start'
      ? margin
      : row === 'end'
        ? height - h - margin
        : (height - h) / 2;
  return [x, y];
};

export function loadBitmap(file) {
  return createImageBitmap(file);
}

// options: { kind: 'text'|'image', text, font, colour, shadow, logo (bitmap),
//            spot, scale (% of the picture's width), opacity (0-1), rotate (deg), margin (% of width) }
export function stamp(canvas, source, options) {
  const {
    spot = 'bottom-right',
    opacity = 0.6,
    rotate = 0,
    scale = 25,
    margin = 3,
  } = options;
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0);
  const gap = (margin / 100) * source.width;

  ctx.save();
  ctx.globalAlpha = Math.max(0.02, Math.min(1, opacity));
  let width = 0;
  let height = 0;
  let draw = () => {};

  if (options.kind === 'image' && options.logo) {
    width = (scale / 100) * source.width;
    height = (width / options.logo.width) * options.logo.height;
    draw = (x, y) => ctx.drawImage(options.logo, x, y, width, height);
  } else {
    const text = options.text || '';
    // The font size follows the picture's width, so the stamp looks the same on any size.
    const size = Math.max(8, (scale / 100) * source.width * 0.35);
    ctx.font = `700 ${size}px ${options.font || 'system-ui, sans-serif'}`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = options.colour || '#ffffff';
    if (options.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = size * 0.25;
      ctx.shadowOffsetY = size * 0.06;
    }
    const measured = ctx.measureText(text);
    width = measured.width;
    height = size * 1.2;
    draw = (x, y) => ctx.fillText(text, x, y);
  }

  if (spot === 'tiled') {
    // A rotated grid of them, drawn past the edges so the corners are covered too.
    const stepX = width + gap * 2;
    const stepY = height + gap * 2;
    ctx.translate(source.width / 2, source.height / 2);
    ctx.rotate((rotate * Math.PI) / 180);
    const reach = Math.hypot(source.width, source.height) / 2;
    for (let y = -reach; y < reach; y += stepY)
      for (let x = -reach; x < reach; x += stepX) draw(x, y);
  } else {
    const [x, y] = at(spot, source.width, source.height, width, height, gap);
    if (rotate) {
      ctx.translate(x + width / 2, y + height / 2);
      ctx.rotate((rotate * Math.PI) / 180);
      draw(-width / 2, -height / 2);
    } else {
      draw(x, y);
    }
  }
  ctx.restore();
  return canvas;
}

export const canvasBlob = (canvas, type = 'image/png', quality = 0.92) =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));
