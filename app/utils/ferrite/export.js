// The render queue's engine: one scene, one span of time, one file out.
//
// Ferrite renders offline: it walks the timeline a frame at a time and hands
// each finished frame to an encoder, and that is the only way a render is
// *exact*. A browser's `MediaRecorder` records a canvas in real time, so a
// frame that took too long to draw is simply not in the file, and a comp that
// takes 40ms a frame comes out of a "30fps" export at whatever rate the
// machine managed. That is fine for a quick look and wrong for a deliverable.
//
// So there are two engines here, and the modal makes you choose:
//
//   * `live`  is captureStream + MediaRecorder. Fast, and the only one that
//               can carry the sound, because the mixer is a live graph.
//   * `exact` is every frame drawn, seeked and encoded in order through
//               FFmpeg. Slower, frame-accurate, silent.
//
// Nothing here touches the editor's state. The caller passes a `drawAt(ms)`
// that puts the frame on a canvas and, for the exact engine, a `seekTo(ms)`
// that waits for the footage to actually arrive at that time.

import { runFFmpeg } from '../media-jobs';
import { createArchive } from '../archive';

// What After Effects calls the output module: the container, what it can
// carry, and which engine can produce it.
export const FORMATS = [
  {
    id: 'webm-vp9',
    label: 'WebM (VP9)',
    ext: 'webm',
    mime: 'video/webm;codecs=vp9,opus',
    engines: ['live', 'exact'],
    alpha: true,
    audio: true,
    note: 'Plays everywhere but Safari. Keeps transparency.',
  },
  {
    id: 'webm-vp8',
    label: 'WebM (VP8)',
    ext: 'webm',
    mime: 'video/webm;codecs=vp8,opus',
    engines: ['live', 'exact'],
    alpha: true,
    audio: true,
    note: 'Older, larger, and the widest WebM support.',
  },
  {
    id: 'mp4-h264',
    label: 'MP4 (H.264)',
    ext: 'mp4',
    engines: ['live', 'exact'],
    alpha: false,
    audio: true,
    note: 'The one to hand to anybody else. No transparency.',
  },
  {
    id: 'gif',
    label: 'Animated GIF',
    ext: 'gif',
    engines: ['exact'],
    alpha: true,
    audio: false,
    note: '256 colours, no sound. Keep it short.',
  },
  {
    id: 'png-seq',
    label: 'PNG sequence (.zip)',
    ext: 'zip',
    engines: ['exact'],
    alpha: true,
    audio: false,
    note: 'Every frame as its own file, for finishing elsewhere.',
  },
  {
    id: 'png-still',
    label: 'Single frame (PNG)',
    ext: 'png',
    engines: ['exact'],
    alpha: true,
    audio: false,
    note: 'Just the frame the playhead is on.',
  },
];

export const formatById = (id) =>
  FORMATS.find((f) => f.id === id) ?? FORMATS[0];

// After Effects' resolution menu, which is a divisor and not a size: half of a
// 1920 comp is 960 whatever the comp is.
export const RESOLUTIONS = [
  { id: 'full', label: 'Full', divisor: 1 },
  { id: 'half', label: 'Half', divisor: 2 },
  { id: 'third', label: 'Third', divisor: 3 },
  { id: 'quarter', label: 'Quarter', divisor: 4 },
  { id: 'custom', label: 'Custom', divisor: 0 },
];

export const QUALITIES = [
  { id: 'draft', label: 'Draft', crf: 30, bits: 4e6, scale: 0.6 },
  { id: 'good', label: 'Good', crf: 23, bits: 10e6, scale: 1 },
  { id: 'best', label: 'Best', crf: 18, bits: 20e6, scale: 1 },
  { id: 'lossless', label: 'Lossless', crf: 12, bits: 40e6, scale: 1 },
];

export const qualityById = (id) =>
  QUALITIES.find((q) => q.id === id) ?? QUALITIES[1];

// Even dimensions, because H.264 in 4:2:0 cannot encode an odd one and the
// error it gives when you try says nothing about width.
export const evenOut = (n) => Math.max(2, Math.round(n / 2) * 2);

export function sizeFor({ width, height, resolution, customW, customH }) {
  const res = RESOLUTIONS.find((r) => r.id === resolution) ?? RESOLUTIONS[0];
  if (res.divisor === 0)
    return {
      width: evenOut(customW || width),
      height: evenOut(customH || height),
    };
  return {
    width: evenOut(width / res.divisor),
    height: evenOut(height / res.divisor),
  };
}

export const frameCount = (fromMs, toMs, fps) =>
  Math.max(1, Math.round(((toMs - fromMs) / 1000) * fps));

// What the render will weigh, roughly, so nobody starts a half-hour job by
// accident. The exact engine holds every frame as a PNG until FFmpeg has them,
// which is the number worth warning about.
export function estimate(options) {
  const frames = frameCount(options.fromMs, options.toMs, options.fps);
  const { width, height } = sizeFor(options);
  const format = formatById(options.format);
  const seconds = frames / Math.max(options.fps, 1);
  if (options.engine === 'exact' || format.engines[0] === 'exact')
    // A PNG of a typical frame lands near a fifth of its raw size.
    return { frames, seconds, bytes: frames * width * height * 4 * 0.2 };
  return {
    frames,
    seconds,
    bytes: (qualityById(options.quality).bits / 8) * seconds,
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const blobOf = (canvas, type, quality) =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('the frame would not encode'))),
      type,
      quality,
    ),
  );

/**
 * Renders one span of the timeline to a file.
 *
 * `drawAt(ctx, ms)` paints one frame; `seekTo(ms)` (exact engine only) settles
 * the footage on that time and resolves when it has. `onProgress` gets 0..1,
 * `onStatus` a line of prose.
 *
 * Gives back `{ blob, ext }`. Throws with a sentence a person can act on.
 */
export async function renderOut(options) {
  const format = formatById(options.format);
  const engine = format.engines.includes(options.engine)
    ? options.engine
    : format.engines[0];
  return engine === 'live' ? renderLive(options) : renderExact(options);
}

/* ------------------------------------------------------------- real time */

async function renderLive(options) {
  const {
    fromMs,
    toMs,
    fps,
    format,
    quality,
    audio,
    audioTracks = [],
    seekTo,
    onProgress,
    onStatus,
    signal,
  } = options;
  const def = formatById(format);
  const { canvas, paint } = makeSurface(options);
  const stream = canvas.captureStream(Math.round(fps));
  if (audio && def.audio)
    for (const track of audioTracks) stream.addTrack(track);

  const mime = [
    def.mime,
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ].find((m) => m && MediaRecorder.isTypeSupported(m));
  if (!mime)
    throw new Error('This browser will not record video from a canvas.');

  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: qualityById(quality).bits,
  });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((resolve) => (recorder.onstop = resolve));

  onStatus?.('Recording in real time…');
  await seekTo?.(fromMs);
  recorder.start(500);
  const started = performance.now();
  const span = Math.max(1, toMs - fromMs);
  await new Promise((resolve) => {
    const step = () => {
      if (signal?.aborted) return resolve();
      const at = Math.min(span, performance.now() - started);
      paint(fromMs + at);
      onProgress?.((at / span) * (def.ext === 'mp4' ? 0.6 : 0.95));
      if (at >= span) return resolve();
      requestAnimationFrame(step);
    };
    step();
  });
  recorder.stop();
  await stopped;

  let blob = new Blob(chunks, { type: 'video/webm' });
  if (def.ext === 'mp4') {
    onStatus?.('Converting to MP4…');
    blob = await toMp4(blob, { seconds: span / 1000, quality, onProgress });
  }
  onProgress?.(1);
  return { blob, ext: def.ext };
}

/* ---------------------------------------------------------- frame by frame */

async function renderExact(options) {
  const {
    fromMs,
    toMs,
    fps,
    format,
    quality,
    seekTo,
    onProgress,
    onStatus,
    signal,
  } = options;
  const def = formatById(format);
  const { canvas, paint } = makeSurface(options);

  if (def.id === 'png-still') {
    await seekTo?.(fromMs);
    paint(fromMs);
    return { blob: await blobOf(canvas, 'image/png'), ext: 'png' };
  }

  const frames = frameCount(fromMs, toMs, fps);
  const step = 1000 / fps;
  const files = [];
  for (let i = 0; i < frames; i++) {
    if (signal?.aborted) throw new Error('Render cancelled.');
    const ms = fromMs + i * step;
    // Footage first, then the frame: drawing before the seek has landed is
    // how an exact render ends up with the previous frame's picture in it.
    await seekTo?.(ms);
    paint(ms);
    files.push(
      new File(
        [await blobOf(canvas, 'image/png')],
        `frame-${String(i).padStart(5, '0')}.png`,
        { type: 'image/png' },
      ),
    );
    onProgress?.((i / frames) * 0.7);
    onStatus?.(`Drawing frame ${i + 1} of ${frames}…`);
    // A breath every so often, so the tab stays answerable and the progress
    // bar it is drawing actually moves.
    if (i % 8 === 7) await wait(0);
  }

  if (def.id === 'png-seq') {
    onStatus?.('Zipping the frames…');
    const zip = await createArchive(files, 'zip', 3);
    onProgress?.(1);
    return { blob: new Blob([zip], { type: 'application/zip' }), ext: 'zip' };
  }

  onStatus?.('Encoding…');
  const seconds = frames / fps;
  const q = qualityById(quality);
  const blob = await runFFmpeg(new File([files[0]], 'seed.png'), {
    out: def.ext,
    type: def.ext === 'gif' ? 'image/gif' : `video/${def.ext}`,
    duration: seconds,
    extras: files.map((f) => ({ name: f.name, data: f })),
    onProgress: (p) => onProgress?.(0.7 + p * 0.3),
    onStatus,
    build: () => {
      const input = ['-framerate', String(fps), '-i', 'frame-%05d.png'];
      if (def.id === 'gif')
        return [
          ...input,
          '-filter_complex',
          '[0:v] split [a][b];[a] palettegen=stats_mode=diff [p];[b][p] paletteuse=dither=bayer',
        ];
      if (def.id === 'mp4-h264')
        return [
          ...input,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          String(q.crf),
          '-pix_fmt',
          'yuv420p',
        ];
      // VP8 and VP9 both, and both keep the alpha the PNGs carry.
      return [
        ...input,
        '-c:v',
        def.id === 'webm-vp8' ? 'libvpx' : 'libvpx-vp9',
        '-crf',
        String(q.crf),
        '-b:v',
        '0',
        '-pix_fmt',
        'yuva420p',
      ];
    },
  });
  onProgress?.(1);
  return { blob, ext: def.ext };
}

async function toMp4(webm, { seconds, quality, onProgress }) {
  const q = qualityById(quality);
  return runFFmpeg(new File([webm], 'edit.webm', { type: 'video/webm' }), {
    out: 'mp4',
    type: 'video/mp4',
    duration: seconds,
    onProgress: (p) => onProgress?.(0.6 + p * 0.4),
    build: (input) => [
      '-i',
      input,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      String(q.crf),
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
    ],
  });
}

// The comp is always drawn at its own size and then scaled into the output,
// never drawn small. `drawScene` resets the transform on every call (it has
// to, it is compositing), so a scale set on the context before it would be
// thrown away, and a half render would come out as the top-left quarter.
function makeSurface(options) {
  const { width, height } = sizeFor(options);
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const octx = out.getContext('2d');
  const comp = document.createElement('canvas');
  comp.width = options.width;
  comp.height = options.height;
  const cctx = comp.getContext('2d');
  const paint = (ms) => {
    options.drawAt(cctx, ms);
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, width, height);
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = options.quality === 'draft' ? 'low' : 'high';
    octx.drawImage(comp, 0, 0, width, height);
  };
  return { canvas: out, paint };
}
