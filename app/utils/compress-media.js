// Getting a file down to a size you actually asked for.
//
// The Image Resizer and the Audio Extractor ask you for a quality number and
// tell you afterwards what that came to. This works the other way round: you
// say "8 MB" and the tool finds the settings that land there. Images are
// re-encoded on a canvas and searched for the right quality; audio and video
// get a bitrate worked out from how long they are, which is arithmetic rather
// than a search (see the component, which owns the FFmpeg side).

export const KINDS = ['image', 'video', 'audio'];

// What we can re-encode to. GIF and SVG aren't here on purpose: a canvas
// re-encode would flatten an animation to one frame and rasterise a vector.
const IMAGE_TYPES = {
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  png: 'image/png',
};

export function kindOf(file) {
  if (/^image\//.test(file.type) && !/gif|svg/.test(file.type)) return 'image';
  if (/^video\//.test(file.type)) return 'video';
  if (/^audio\//.test(file.type)) return 'audio';
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (/^(jpe?g|png|webp|avif|bmp|tiff?)$/.test(ext)) return 'image';
  if (/^(mp4|mkv|mov|webm|m4v|avi|ogv|wmv|flv)$/.test(ext)) return 'video';
  if (/^(mp3|wav|flac|ogg|opus|m4a|aac|wma|aiff?)$/.test(ext)) return 'audio';
  return null;
}

// Whether the browser will actually give us this format back. Safari has no
// AVIF encoder and older browsers had no WebP one, and a canvas that can't
// encode what you asked for quietly hands back a PNG instead, which is usually
// far bigger than the original. Asking once up front avoids that surprise.
const encoderCache = new Map();
export function canEncode(format) {
  if (format === 'jpeg' || format === 'png') return true;
  if (!encoderCache.has(format)) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    encoderCache.set(
      format,
      canvas
        .toDataURL(IMAGE_TYPES[format])
        .startsWith(`data:${IMAGE_TYPES[format]}`),
    );
  }
  return encoderCache.get(format);
}

const encode = (canvas, format, quality) =>
  new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob), IMAGE_TYPES[format], quality),
  );

async function draw(bitmap, scale) {
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

/**
 * Re-encode an image, either at a fixed quality or hunting for a target size.
 *
 * `targetBytes` null  → one pass at `quality` (0..1)
 * `targetBytes` set   → binary search on quality, and if even the lowest
 *                       quality overshoots, shrink the picture and try again.
 *
 * Returns { blob, width, height, quality, scale }.
 */
export async function compressImage(
  file,
  {
    format = 'jpeg',
    quality = 0.8,
    targetBytes = null,
    maxScale = 1,
    onStatus,
  } = {},
) {
  const bitmap = await createImageBitmap(file);
  try {
    if (!targetBytes) {
      const canvas = await draw(bitmap, maxScale);
      const blob = await encode(canvas, format, quality);
      return {
        blob,
        width: canvas.width,
        height: canvas.height,
        quality,
        scale: maxScale,
      };
    }

    // PNG ignores the quality argument altogether, so the only lever it has
    // is the pixel count; the search below would spin on identical sizes.
    const hasQuality = format !== 'png';
    let scale = maxScale;
    let best = null;
    // Four shrinks is enough to reach ~20% of the original width, well past
    // the point where quality alone has stopped helping.
    for (let attempt = 0; attempt < 5; attempt++) {
      const canvas = await draw(bitmap, scale);
      onStatus?.(`Trying ${canvas.width}×${canvas.height}…`);
      if (!hasQuality) {
        const blob = await encode(canvas, format, 1);
        best = {
          blob,
          width: canvas.width,
          height: canvas.height,
          quality: 1,
          scale,
        };
        if (blob.size <= targetBytes) return best;
        scale *= 0.75;
        continue;
      }
      const found = await searchQuality(canvas, format, targetBytes);
      // Keep whichever attempt is closest to the target without going over,
      // falling back to the smallest we managed if nothing ever fit.
      if (found.blob.size <= targetBytes)
        return { ...found, width: canvas.width, height: canvas.height, scale };
      if (!best || found.blob.size < best.blob.size)
        best = { ...found, width: canvas.width, height: canvas.height, scale };
      scale *= 0.75;
    }
    return best;
  } finally {
    bitmap.close?.();
  }
}

// Eight steps of bisection over the 0.05..0.95 quality range: enough to land
// within about half a percent of the best quality that still fits.
async function searchQuality(canvas, format, targetBytes) {
  let low = 0.05;
  let high = 0.95;
  let best = null;
  for (let i = 0; i < 8; i++) {
    const quality = (low + high) / 2;
    const blob = await encode(canvas, format, quality);
    if (blob.size <= targetBytes) {
      best = { blob, quality };
      low = quality; // it fits, so try to spend the headroom on quality
    } else {
      high = quality;
    }
  }
  if (best) return best;
  // Nothing fit: hand back the smallest this canvas can be, so the caller
  // knows to shrink the picture instead of pushing quality lower.
  const blob = await encode(canvas, format, 0.05);
  return { blob, quality: 0.05 };
}

/**
 * Split a size budget between a video's picture and its sound.
 *
 * Everything in a file that isn't the streams themselves — the container's
 * index, headers, per-packet overhead — is a few percent, so the budget is
 * trimmed before it gets divided up. Returns kilobits per second.
 */
export function videoBitrates(targetBytes, duration, audioKbps) {
  if (!duration) return null;
  const totalKbps = ((targetBytes * 8) / duration / 1000) * 0.96;
  const video = Math.floor(totalKbps - audioKbps);
  // Below about 100 kbps x264 produces a slideshow of blocks. Better to miss
  // the target and say so than to hand back something unwatchable.
  return { video: Math.max(100, video), audio: audioKbps, fits: video >= 100 };
}

export function audioBitrate(targetBytes, duration) {
  if (!duration) return null;
  const kbps = Math.floor(((targetBytes * 8) / duration / 1000) * 0.98);
  // 32 kbps is about as low as a music codec stays intelligible.
  return { audio: Math.max(32, kbps), fits: kbps >= 32 };
}
