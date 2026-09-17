/* eslint-disable warp-drive/no-legacy-request-patterns -- ctx.save() here is the canvas API, not a data request */
// Stitching images into one sheet: spritesheets, flipbook frames, contact
// sheets, before-and-afters. All drawn on a canvas in the browser.

export const FITS = [
  { id: 'contain', label: 'Fit inside the cell' },
  { id: 'cover', label: 'Fill the cell (crops)' },
  { id: 'stretch', label: 'Stretch to the cell' },
  { id: 'none', label: 'Leave as it is' },
];

export const LAYOUTS = [
  { id: 'grid', label: 'Grid' },
  { id: 'row', label: 'One row' },
  { id: 'column', label: 'One column' },
];

export async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(new Error(`${file.name} couldn’t be read as an image`));
      img.src = url;
    });
    // Drawn from a bitmap so the object URL can go straight away.
    const bitmap = await createImageBitmap(image);
    return { width: bitmap.width, height: bitmap.height, bitmap };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Works out the sheet's shape without drawing it, for the live "what you'll get" line.
export function planSheet(images, options) {
  const {
    layout = 'grid',
    columns = 0,
    cellWidth = 0,
    cellHeight = 0,
    gap = 0,
    padding = 0,
    maxSize = 0,
  } = options;
  const count = images.length;
  if (!count) return null;
  const cols =
    layout === 'row'
      ? count
      : layout === 'column'
        ? 1
        : Math.max(1, columns || Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / cols);
  const cw = Math.max(
    1,
    Math.round(cellWidth || Math.max(...images.map((i) => i.width))),
  );
  const ch = Math.max(
    1,
    Math.round(cellHeight || Math.max(...images.map((i) => i.height))),
  );
  const width = padding * 2 + cols * cw + gap * (cols - 1);
  const height = padding * 2 + rows * ch + gap * (rows - 1);
  // A size cap scales the whole sheet down at the end, so the cells stay in step.
  const scale =
    maxSize > 0 ? Math.min(1, maxSize / Math.max(width, height)) : 1;
  return {
    cols,
    rows,
    cellWidth: cw,
    cellHeight: ch,
    width,
    height,
    scale,
    outWidth: Math.max(1, Math.round(width * scale)),
    outHeight: Math.max(1, Math.round(height * scale)),
  };
}

// Where one image sits inside its cell, for the chosen fit.
function place(image, cw, ch, fit) {
  if (fit === 'stretch') return { x: 0, y: 0, w: cw, h: ch };
  if (fit === 'none')
    return {
      x: (cw - image.width) / 2,
      y: (ch - image.height) / 2,
      w: image.width,
      h: image.height,
    };
  const ratio =
    fit === 'cover'
      ? Math.max(cw / image.width, ch / image.height)
      : Math.min(cw / image.width, ch / image.height);
  const w = image.width * ratio;
  const h = image.height * ratio;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

export function drawSheet(canvas, images, options) {
  const plan = planSheet(images, options);
  if (!plan) return null;
  const {
    gap = 0,
    padding = 0,
    background = 'transparent',
    fit = 'contain',
    smooth = true,
  } = options;
  canvas.width = plan.outWidth;
  canvas.height = plan.outHeight;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Pixel art keeps its hard edges; photos get the browser's smoothing.
  ctx.imageSmoothingEnabled = smooth;
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  ctx.scale(plan.scale, plan.scale);
  if (background && background !== 'transparent') {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, plan.width, plan.height);
  }
  images.forEach((image, i) => {
    const col = i % plan.cols;
    const row = Math.floor(i / plan.cols);
    const cellX = padding + col * (plan.cellWidth + gap);
    const cellY = padding + row * (plan.cellHeight + gap);
    const spot = place(image, plan.cellWidth, plan.cellHeight, fit);
    ctx.save();
    ctx.beginPath();
    ctx.rect(cellX, cellY, plan.cellWidth, plan.cellHeight);
    ctx.clip();
    ctx.drawImage(image.bitmap, cellX + spot.x, cellY + spot.y, spot.w, spot.h);
    ctx.restore();
  });
  ctx.restore();
  return plan;
}

export function canvasBlob(canvas, format = 'image/png', quality = 0.92) {
  return new Promise((resolve) => canvas.toBlob(resolve, format, quality));
}
