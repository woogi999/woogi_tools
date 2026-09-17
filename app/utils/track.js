// Following a box through a video for the Video Censor. Nothing clever: the
// box's pixels from the last frame are the template, and the next frame is
// searched around the same spot for where they fit best (smallest sum of
// differences). It's the classic template matcher, on a small grey copy of
// the frame so it keeps up.

const SEARCH_WIDTH = 320;

// A grey, shrunken copy of `frame` (a video element or canvas) as a Float32Array.
export function greyFrame(frame, width = SEARCH_WIDTH) {
  const fw = frame.videoWidth ?? frame.width;
  const fh = frame.videoHeight ?? frame.height;
  const scale = width / fw;
  const w = width;
  const h = Math.max(1, Math.round(fh * scale));
  const canvas =
    greyFrame.canvas ?? (greyFrame.canvas = document.createElement('canvas'));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(frame, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const grey = new Float32Array(w * h);
  for (let i = 0, j = 0; i < data.length; i += 4, j++)
    grey[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return { grey, w, h };
}

// Where `box` (0..1 frame coordinates) from `previous` has moved to in `next`.
// Returns the new box, or null when nothing nearby looks like it any more.
export function follow(previous, next, box) {
  const { w, h } = previous;
  const bx = Math.round(box.x * w);
  const by = Math.round(box.y * h);
  const bw = Math.max(4, Math.round(box.w * w));
  const bh = Math.max(4, Math.round(box.h * h));
  if (bx < 0 || by < 0 || bx + bw > w || by + bh > h) return null;
  // Look up to a third of the box's size away in every direction.
  const reach = Math.max(6, Math.round(Math.max(bw, bh) * 0.35));
  // Compare every other pixel: the box is small enough that it barely matters
  // and it's four times quicker.
  const step = bw * bh > 2000 ? 2 : 1;
  let best = Infinity;
  let bestDx = 0;
  let bestDy = 0;
  for (let dy = -reach; dy <= reach; dy++) {
    const ny = by + dy;
    if (ny < 0 || ny + bh > h) continue;
    for (let dx = -reach; dx <= reach; dx++) {
      const nx = bx + dx;
      if (nx < 0 || nx + bw > w) continue;
      let sum = 0;
      for (let y = 0; y < bh; y += step) {
        const rowA = (by + y) * w + bx;
        const rowB = (ny + y) * w + nx;
        for (let x = 0; x < bw; x += step) {
          sum += Math.abs(previous.grey[rowA + x] - next.grey[rowB + x]);
          if (sum >= best) break;
        }
        if (sum >= best) break;
      }
      // Ties go to staying still, which keeps a static shot from jittering.
      if (sum < best || (sum === best && dx === 0 && dy === 0)) {
        best = sum;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }
  // The average difference per pixel compared; past this the thing is gone.
  const compared = Math.ceil(bw / step) * Math.ceil(bh / step);
  if (best / compared > 60) return null;
  return { ...box, x: (bx + bestDx) / w, y: (by + bestDy) / h };
}

// The browser's own face finder, where there is one (Chrome on Android and
// macOS; behind a flag elsewhere). Boxes come back in 0..1 frame coordinates.
export async function findFaces(frame) {
  if (!('FaceDetector' in window)) return null;
  const fw = frame.videoWidth ?? frame.width;
  const fh = frame.videoHeight ?? frame.height;
  try {
    const detector = new window.FaceDetector({
      fastMode: false,
      maxDetectedFaces: 20,
    });
    const faces = await detector.detect(frame);
    return faces.map(({ boundingBox: b }) => {
      // A little room around the box, since hair and chins count too.
      const pad = 0.25;
      return {
        x: Math.max(0, (b.x - b.width * pad) / fw),
        y: Math.max(0, (b.y - b.height * pad) / fh),
        w: Math.min(1, (b.width * (1 + 2 * pad)) / fw),
        h: Math.min(1, (b.height * (1 + 2 * pad)) / fh),
      };
    });
  } catch {
    return null;
  }
}

// Seeks a video and resolves once the frame is really there.
export function seekTo(video, time) {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2)
      return resolve();
    const done = () => {
      video.removeEventListener('seeked', done);
      resolve();
    };
    video.addEventListener('seeked', done);
    video.currentTime = time;
  });
}
