// One place for the audio/video tools (extractor, muter, trimmer) to run FFmpeg.
// The engine is a single WebAssembly instance that can only do one job at a time,
// so jobs queue up behind each other here.

import { loadFFmpeg } from './converters/engines';

let queue = Promise.resolve();

const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
const extOf = (name) =>
  (name.split('.').pop() || 'bin').toLowerCase().replaceAll(/[^a-z0-9]/g, '');
export const baseName = (name) => name.replace(/\.[^.]+$/, '') || 'file';

// Runs one FFmpeg command over `file`.
//   build(input, output) -> the arguments, so a tool can put its own in
//   extras: [{ name, data }] other files the command needs (a subtitle, a font)
// Gives back a Blob of the output.
export function runFFmpeg(
  file,
  {
    out = 'mp4',
    type = '',
    build,
    onProgress,
    onStatus,
    duration = 0,
    extras = [],
  },
) {
  const job = queue.then(() =>
    execute(file, { out, type, build, onProgress, onStatus, duration, extras }),
  );
  queue = job.catch(() => {});
  return job;
}

async function execute(
  file,
  { out, type, build, onProgress, onStatus, duration, extras },
) {
  onStatus?.('Starting the audio/video engine…');
  const ffmpeg = await loadFFmpeg();
  const stamp = Date.now();
  const input = `in-${stamp}.${extOf(file.name)}`;
  const output = `out-${stamp}.${out}`;
  const logs = [];
  const onLog = ({ message }) => {
    logs.push(message);
    if (logs.length > 40) logs.shift();
  };
  // FFmpeg's own progress is unreliable when a command only copies streams, so
  // tools that know the length work it out from the time it reports instead.
  const progress = ({ progress: p, time }) => {
    if (duration && time)
      onProgress?.(Math.max(0, Math.min(1, time / 1e6 / duration)));
    else onProgress?.(Math.max(0, Math.min(1, p)));
  };
  ffmpeg.on('log', onLog);
  ffmpeg.on('progress', progress);
  try {
    onStatus?.('Reading the file…');
    await ffmpeg.writeFile(input, await bytesOf(file));
    for (const extra of extras)
      await ffmpeg.writeFile(
        extra.name,
        extra.data instanceof Blob ? await bytesOf(extra.data) : extra.data,
      );
    onStatus?.('Working…');
    const code = await ffmpeg.exec([...build(input, output), '-y', output]);
    if (code !== 0) {
      const reason = logs
        .reverse()
        .find((line) =>
          /error|invalid|not found|does not contain|no such/i.test(line),
        );
      throw new Error(
        reason
          ? `FFmpeg: ${reason.trim()}`
          : 'FFmpeg couldn’t handle this file',
      );
    }
    const data = await ffmpeg.readFile(output);
    onProgress?.(1);
    return new Blob([data.buffer ?? data], { type });
  } finally {
    ffmpeg.off('log', onLog);
    ffmpeg.off('progress', progress);
    await ffmpeg.deleteFile(input).catch(() => {});
    await ffmpeg.deleteFile(output).catch(() => {});
    for (const extra of extras)
      await ffmpeg.deleteFile(extra.name).catch(() => {});
  }
}

// How long a clip is, and whether it has any sound, read by the browser itself
// (no engine needed) so a tool can show a timeline straight away.
export function mediaInfo(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = file.type.startsWith('audio/')
      ? document.createElement('audio')
      : document.createElement('video');
    const done = (info) => {
      URL.revokeObjectURL(url);
      resolve(info);
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () =>
      done({
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        width: video.videoWidth || 0,
        height: video.videoHeight || 0,
        // Only Firefox and Chrome expose these, so "no idea" is a real answer.
        hasAudio:
          video.mozHasAudio ??
          (video.webkitAudioDecodedByteCount > 0 || undefined),
      });
    video.onerror = () =>
      done({ duration: 0, width: 0, height: 0, hasAudio: undefined });
    video.src = url;
  });
}

// 1:05.5 and friends, for timeline labels.
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  const tenths = Math.floor((seconds - whole) * 10);
  return `${mins}:${String(secs).padStart(2, '0')}.${tenths}`;
}

// "00:01:02.500", the form FFmpeg wants for -ss and -to.
export const ffmpegTime = (seconds) => {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = (s % 60).toFixed(3);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${rest.padStart(6, '0')}`;
};
