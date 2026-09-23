// The Video Downloader's browser side: asking the site's Worker what a link
// is (worker/video.js), then fetching the files it names.
//
// Progress is only ever what can be measured: bytes received, out of the
// file's size when the server says what that is. When it doesn't, the page
// shows the count without a percentage rather than inventing one. Joining a
// Reddit video's picture and sound is FFmpeg copying streams, which it can't
// report usefully, so that step is shown as ongoing, not as a number.

import { runFFmpeg } from './media-jobs';

async function api(path, init = {}) {
  // eslint-disable-next-line warp-drive/no-external-request-patterns -- the site's own Worker
  const response = await fetch(path, {
    ...init,
    headers: init.body ? { 'Content-Type': 'application/json' } : {},
  });
  // Anything but JSON means the Worker isn't there at all (a static host, or
  // a dev server without it): say so instead of guessing.
  if (!response.headers.get('Content-Type')?.includes('application/json'))
    throw new Error("This site's download service isn't running here.");
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? 'The download service did not answer.');
  return body;
}

// { backend } — whether the site owner set up the optional backend.
export const downloaderInfo = (signal) => api('/api/video', { signal });

export const inspectVideo = (url, signal) =>
  api('/api/video', {
    method: 'POST',
    body: JSON.stringify({ url }),
    signal,
  });

// One of the backend's formats -> { files: [{ url, filename, type, thumb }] }
// or { merge: { video, audio, filename } }.
export const resolveVideo = (url, format, signal) =>
  api('/api/video/resolve', {
    method: 'POST',
    body: JSON.stringify({ url, format }),
    signal,
  });

// Fetches a whole file, reporting { received, total } (total is 0 when the
// server didn't say). Fails with `blocked: true` when the browser couldn't
// fetch it at all, which for another site's file means CORS.
export async function fetchFile(url, { signal, onProgress }) {
  let response;
  try {
    // No referrer: X's file server answers 403 to any page that isn't X's,
    // and no other site needs to know which page asked.
    // eslint-disable-next-line warp-drive/no-external-request-patterns -- a video file the Worker named
    response = await fetch(url, {
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw Object.assign(new Error('The browser couldn’t fetch the file.'), {
      blocked: true,
    });
  }
  if (!response.ok) {
    let message = `The file server answered ${response.status}.`;
    if (response.headers.get('Content-Type')?.includes('application/json'))
      message = (await response.json().catch(() => null))?.error ?? message;
    else if (response.status === 403)
      message =
        'The file server refused. The link may have expired: look the video up again.';
    throw new Error(message);
  }
  const total = Number(response.headers.get('Content-Length')) || 0;
  const type = response.headers.get('Content-Type') ?? '';
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  onProgress?.({ received, total });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress?.({ received, total });
  }
  return new Blob(chunks, { type });
}

// Picture and sound fetched side by side, then joined without re-encoding.
// Progress covers both downloads; the join reports stages only.
export async function fetchAndJoin(
  videoUrl,
  audioUrl,
  { signal, onProgress, onStage },
) {
  const parts = [
    { received: 0, total: 0 },
    { received: 0, total: 0 },
  ];
  const report = () =>
    onProgress?.({
      received: parts[0].received + parts[1].received,
      // Only a real total once both sizes are known.
      total:
        parts[0].total && parts[1].total ? parts[0].total + parts[1].total : 0,
    });
  onStage?.('Downloading picture and sound');
  const [picture, sound] = await Promise.all(
    [videoUrl, audioUrl].map((url, i) =>
      fetchFile(url, {
        signal,
        onProgress: (p) => {
          parts[i] = p;
          report();
        },
      }),
    ),
  );
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  onStage?.('Joining picture and sound');
  return runFFmpeg(new File([picture], 'picture.mp4'), {
    out: 'mp4',
    type: 'video/mp4',
    extras: [{ name: 'sound.m4a', data: sound }],
    build: (input) => [
      '-i',
      input,
      '-i',
      'sound.m4a',
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c',
      'copy',
      '-movflags',
      '+faststart',
    ],
    onStatus: (status) => onStage?.(status),
  });
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name || 'video';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// When the browser can't fetch a file itself, hand the address to it as a
// plain link: it downloads or plays it in a new tab, with its own progress.
export function openLink(url, name) {
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  if (name) link.download = name;
  link.click();
}

export function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(n) / Math.log(1024)),
  );
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(s) {
  if (!s) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
