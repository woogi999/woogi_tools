// Running a song through a separation model.
//
// The models work on a fixed window — eight seconds for BS-RoFormer, six for
// MDX-Net — so a song is walked in overlapping chunks and the results
// crossfaded back together. The overlap matters: a model has no idea what
// happened either side of its window, so its guesses near the edges are worse
// than in the middle, and butting chunks up against each other leaves an
// audible tick every few seconds.
//
// Everything is streamed chunk by chunk rather than transformed all at once.
// A three minute song at these settings would be about 600 MB as one
// spectrogram, which is enough to end the tab.

import { stft, istft, hannWindow } from './stft';
import { loadSession, runModel } from './onnx';
import { chunkSamples, modelsFor } from './separator-models';

export const SAMPLE_RATE = 44100;

// A quarter of each window is shared with its neighbour. Enough to hide the
// seam, without paying for a third more inference than necessary.
const OVERLAP = 0.25;

/**
 * Decode a file to exactly what the models expect: 44.1 kHz, stereo.
 *
 * The rate is not negotiable — these models were trained at 44.1 kHz and a
 * song handed over at 48 would come back transposed and smeared.
 */
export async function decodeForModel(file) {
  const ctx = new (window.AudioContext ?? window.webkitAudioContext)();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(await file.arrayBuffer());
  } finally {
    ctx.close?.();
  }
  if (decoded.sampleRate === SAMPLE_RATE && decoded.numberOfChannels === 2)
    return decoded;

  const length = Math.ceil((decoded.duration || 0) * SAMPLE_RATE);
  if (!length) throw new Error('That file has no audio in it.');
  const offline = new OfflineAudioContext(2, length, SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  return offline.startRendering();
}

const channels = (buffer) => [
  buffer.getChannelData(0),
  buffer.numberOfChannels > 1
    ? buffer.getChannelData(1)
    : buffer.getChannelData(0),
];

/**
 * Separate `buffer` with every model in `engine`, averaging their outputs.
 *
 * Returns { vocals: [L, R], instrumental: [L, R] }. Whichever stem the models
 * predict directly is the accurate one; the other is the mix minus it, which
 * is exact by construction and means the two always add back up to the song.
 */
export async function separateWithModel(
  buffer,
  engine,
  { webgpu = true, onProgress, onStatus, onYield } = {},
) {
  const models = modelsFor(engine);
  if (!models.length) throw new Error('That engine has no model to run.');

  const [mixL, mixR] = channels(buffer);
  const length = buffer.length;

  // One accumulator per channel, summed across the ensemble's members.
  const sumL = new Float32Array(length);
  const sumR = new Float32Array(length);

  for (const [index, model] of models.entries()) {
    const which =
      models.length > 1 ? ` (${index + 1} of ${models.length})` : '';
    onStatus?.(`Loading ${model.label}${which}…`);
    const session = await loadSession(model, {
      webgpu,
      onProgress: ({ loaded, total, cached }) => {
        if (cached) return;
        onStatus?.(
          `Downloading ${model.label}: ${Math.round((loaded / total) * 100)}%`,
        );
        onProgress?.(loaded / total);
      },
    });
    await onYield?.();

    const { partL, partR } = await runOneModel(model, session, mixL, mixR, {
      onStatus: (text) => onStatus?.(`${model.label}${which}: ${text}`),
      onProgress,
      onYield,
    });
    for (let i = 0; i < length; i++) {
      sumL[i] += partL[i];
      sumR[i] += partR[i];
    }
  }

  if (models.length > 1)
    for (let i = 0; i < length; i++) {
      sumL[i] /= models.length;
      sumR[i] /= models.length;
    }

  // Every model in an engine predicts the same stem, so the first one says
  // which of the two we just built.
  const predicted = models[0].outputStem;
  const otherL = new Float32Array(length);
  const otherR = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    otherL[i] = mixL[i] - sumL[i];
    otherR[i] = mixR[i] - sumR[i];
  }

  return predicted === 'vocals'
    ? { vocals: [sumL, sumR], instrumental: [otherL, otherR] }
    : { instrumental: [sumL, sumR], vocals: [otherL, otherR] };
}

async function runOneModel(
  model,
  session,
  mixL,
  mixR,
  { onStatus, onProgress, onYield },
) {
  const { nFft, hop } = model.stft;
  const window = hannWindow(nFft);
  const chunk = chunkSamples(model);
  const overlap = Math.round(chunk * OVERLAP);
  const stride = chunk - overlap;
  const length = mixL.length;

  const partL = new Float32Array(length);
  const partR = new Float32Array(length);
  const weight = new Float32Array(length);
  const ramp = crossfade(chunk, overlap);

  const total = Math.max(1, Math.ceil(length / stride));
  let done = 0;

  const left = new Float32Array(chunk);
  const right = new Float32Array(chunk);

  for (let start = 0; start < length; start += stride) {
    // The tail of the song is zero-padded out to a full window; the model
    // needs its fixed size and silence is the honest thing to pad with.
    left.fill(0);
    right.fill(0);
    const take = Math.min(chunk, length - start);
    left.set(mixL.subarray(start, start + take));
    right.set(mixR.subarray(start, start + take));

    const specL = stft(left, { nFft, hop, window });
    const specR = stft(right, { nFft, hop, window });
    const shape = { frames: model.frames, bins: model.bins, dimF: model.dimF };

    const input = model.layout.pack(specL, specR, shape);
    const output = await runModel(
      session,
      model.layout.inputName,
      input,
      model.layout.dims(shape),
    );

    const outL = istft(model.layout.unpack(output, 0, shape), {
      nFft,
      hop,
      length: chunk,
      window,
    });
    const outR = istft(model.layout.unpack(output, 1, shape), {
      nFft,
      hop,
      length: chunk,
      window,
    });

    for (let i = 0; i < take; i++) {
      const at = start + i;
      partL[at] += outL[i] * ramp[i];
      partR[at] += outR[i] * ramp[i];
      weight[at] += ramp[i];
    }

    done++;
    onStatus?.(`chunk ${done} of ${total}`);
    onProgress?.(done / total);
    await onYield?.();
  }

  // Dividing by the accumulated ramp makes the crossfade exact, and fixes the
  // very start and end of the song where only one chunk ever contributed.
  for (let i = 0; i < length; i++) {
    if (weight[i] > 1e-6) {
      partL[i] /= weight[i];
      partR[i] /= weight[i];
    }
  }
  return { partL, partR };
}

// Fades in over the first `overlap` samples and out over the last, flat in
// between, so two neighbouring chunks sum to one across their shared region.
function crossfade(chunk, overlap) {
  const ramp = new Float32Array(chunk);
  for (let i = 0; i < chunk; i++) {
    if (i < overlap) ramp[i] = (i + 1) / (overlap + 1);
    else if (i >= chunk - overlap) ramp[i] = (chunk - i) / (overlap + 1);
    else ramp[i] = 1;
  }
  return ramp;
}

/** Mono samples as a 16-bit stereo WAV. */
export function stereoWav([left, right], sampleRate = SAMPLE_RATE) {
  const frames = left.length;
  const bytes = frames * 4; // two channels, two bytes each
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);
  const text = (at, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // uncompressed
  view.setUint16(22, 2, true); // channels
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, bytes, true);
  for (let i = 0; i < frames; i++) {
    // Clipped rather than wrapped: a separated stem can push past full scale,
    // and wrapping turns that into a crack instead of a slight squash.
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    view.setInt16(44 + i * 4, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    view.setInt16(46 + i * 4, r < 0 ? r * 0x8000 : r * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
