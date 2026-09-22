// Walking a video frame by frame, so a tool that only knows how to work on a
// picture can be pointed at a clip.
//
// The frames are pulled out by seeking a <video> element and drawing each
// position onto a canvas, which needs no engine and no decoding of our own:
// the browser already has a video decoder and this borrows it. The catch is
// that seeking is not instant, so this is much slower than a real decoder
// would be, which is why the tools using it cap how long a clip may be.

/**
 * Yields each frame of `file` as an ImageBitmap-ready canvas.
 *
 * `fps` is how many frames a second to take, not the clip's own rate: taking
 * every frame of a 60fps video would mean sixty background removals a second
 * of footage, and twelve looks fine for most things.
 */
export async function eachFrame(
  file,
  { fps = 12, maxSeconds = 15, scale = 1, onFrame, onProgress },
) {
  const video = document.createElement('video');
  const url = URL.createObjectURL(file);
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;

  try {
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = () =>
        reject(
          new Error(
            "The browser can't play this video, so the frames can't be read. Try converting it to MP4 first.",
          ),
        );
    });

    const duration = Math.min(
      maxSeconds,
      Number.isFinite(video.duration) ? video.duration : maxSeconds,
    );
    const width = Math.max(2, Math.round(video.videoWidth * scale));
    const height = Math.max(2, Math.round(video.videoHeight * scale));
    // Video encoders want even dimensions; an odd one fails at the last step,
    // after every frame has already been processed.
    const canvas = document.createElement('canvas');
    canvas.width = width - (width % 2);
    canvas.height = height - (height % 2);
    const ctx = canvas.getContext('2d');

    const count = Math.max(1, Math.floor(duration * fps));
    for (let i = 0; i < count; i++) {
      const at = i / fps + 1 / (fps * 2); // mid-frame, to avoid landing on a cut
      await seek(video, Math.min(at, duration - 0.001));
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      await onFrame(canvas, i, count);
      onProgress?.((i + 1) / count);
    }
    return { count, fps, width: canvas.width, height: canvas.height, duration };
  } finally {
    video.src = '';
    URL.revokeObjectURL(url);
  }
}

function seek(video, time) {
  return new Promise((resolve, reject) => {
    const done = () => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', fail);
      resolve();
    };
    const fail = () => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', fail);
      reject(new Error('Lost the video part way through.'));
    };
    video.addEventListener('seeked', done);
    video.addEventListener('error', fail);
    video.currentTime = time;
  });
}

export const canvasToPng = (canvas) =>
  new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

/** Draw a blob back onto a canvas of the same size. */
export async function drawBlob(blob, width, height) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return canvas;
}
