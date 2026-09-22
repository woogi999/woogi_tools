// Pulling a song apart into its parts, with signal processing rather than a
// neural network.
//
// The state of the art here is a model like Demucs, which is hundreds of
// megabytes and wants a GPU. What this does instead is two classic techniques
// that need neither, and between them get surprisingly far on ordinary studio
// music:
//
//   Centre extraction. In almost every mix the lead vocal is panned dead
//   centre, so it appears in the left and right channels as the same signal,
//   while guitars, keys and reverb are spread out. Comparing the two channels
//   bin by bin in the frequency domain says how "centred" each bit of sound
//   is, and that number is the mask: keep the centred part and you have a
//   rough acapella, keep the rest and you have the backing track.
//
//   Harmonic/percussive separation. A sustained note is a horizontal streak
//   across a spectrogram; a drum hit is a vertical one. Running a median
//   along time keeps the streaks that persist (the harmonic part) and a
//   median along frequency keeps the ones that span the spectrum (the
//   percussive part). This is the standard HPSS method, and it is what
//   separates the drums here.
//
// Be straight about what this is: it is not Demucs. A vocal that was panned
// off centre, or a mono recording, will not separate; loud reverb bleeds; and
// what comes out has artefacts a model wouldn't leave. For a karaoke track, a
// rough acapella to sample, or a drum loop to practise over, it does the job.

const FFT_SIZE = 4096;
const HOP = 1024;

export const STEMS = [
  {
    id: 'vocals',
    label: 'Vocals',
    hint: 'The centred part of the mix. Your acapella.',
    icon: 'audio-lines',
  },
  {
    id: 'instrumental',
    label: 'Instrumental',
    hint: 'Everything that isn’t centred. Your karaoke track.',
    icon: 'music',
  },
  {
    id: 'drums',
    label: 'Drums',
    hint: 'The percussive part: hits and transients rather than held notes.',
    icon: 'circle-dot',
  },
  {
    id: 'bass',
    label: 'Bass',
    hint: 'The sustained low end, under about 250 Hz.',
    icon: 'waves',
  },
  {
    id: 'other',
    label: 'Other',
    hint: 'The sustained mid and high parts that aren’t the vocal: guitars, keys, strings.',
    icon: 'layers',
  },
];

// ---------------------------------------------------------------- the FFT

// An in-place iterative radix-2 FFT. Small and plain on purpose: the window
// size is a power of two and known, so none of the general-case machinery a
// library carries would ever run.
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + len / 2] = aRe - bRe;
        im[i + k + len / 2] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
}

// A periodic Hann window. Squared and overlap-added at 75% it sums to a
// constant, so analysing and resynthesising a signal untouched gives it back
// unchanged rather than with a ripple through it.
function hann(size) {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++)
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  return w;
}

// ------------------------------------------------------------- the STFT

function analyse(samples, window) {
  const frames = Math.max(1, Math.ceil((samples.length - FFT_SIZE) / HOP) + 1);
  const bins = FFT_SIZE / 2 + 1;
  const re = new Float32Array(frames * bins);
  const im = new Float32Array(frames * bins);
  const bufRe = new Float64Array(FFT_SIZE);
  const bufIm = new Float64Array(FFT_SIZE);
  for (let f = 0; f < frames; f++) {
    const start = f * HOP;
    for (let i = 0; i < FFT_SIZE; i++) {
      const s = start + i;
      bufRe[i] = (s < samples.length ? samples[s] : 0) * window[i];
      bufIm[i] = 0;
    }
    fft(bufRe, bufIm, false);
    for (let b = 0; b < bins; b++) {
      re[f * bins + b] = bufRe[b];
      im[f * bins + b] = bufIm[b];
    }
  }
  return { re, im, frames, bins };
}

function synthesise({ re, im, frames, bins }, window, length) {
  const out = new Float32Array(length);
  const norm = new Float32Array(length);
  const bufRe = new Float64Array(FFT_SIZE);
  const bufIm = new Float64Array(FFT_SIZE);
  for (let f = 0; f < frames; f++) {
    // Only half the spectrum was kept; the rest is its mirror image, which is
    // what makes the result real rather than complex.
    for (let b = 0; b < bins; b++) {
      bufRe[b] = re[f * bins + b];
      bufIm[b] = im[f * bins + b];
      if (b > 0 && b < bins - 1) {
        bufRe[FFT_SIZE - b] = re[f * bins + b];
        bufIm[FFT_SIZE - b] = -im[f * bins + b];
      }
    }
    fft(bufRe, bufIm, true);
    const start = f * HOP;
    for (let i = 0; i < FFT_SIZE; i++) {
      const s = start + i;
      if (s >= length) break;
      out[s] += bufRe[i] * window[i];
      norm[s] += window[i] * window[i];
    }
  }
  // Divide out the window overlap, so the edges of the file aren't quieter
  // than the middle where fewer frames covered them.
  for (let i = 0; i < length; i++) if (norm[i] > 1e-6) out[i] /= norm[i];
  return out;
}

// --------------------------------------------------------------- the masks

// How much of each bin is common to both channels. 1 means the two channels
// carry exactly the same thing there (dead centre); 0 means they are
// unrelated (hard panned, or reverb).
function centreMask(left, right, sharpness) {
  const n = left.re.length;
  const mask = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lr = left.re[i];
    const li = left.im[i];
    const rr = right.re[i];
    const ri = right.im[i];
    const cross = Math.hypot(lr * rr + li * ri, li * rr - lr * ri);
    const power = lr * lr + li * li + rr * rr + ri * ri;
    const similarity = power > 1e-12 ? (2 * cross) / power : 0;
    mask[i] = Math.pow(Math.min(1, similarity), sharpness);
  }
  return mask;
}

// A median over a short run, which is what HPSS needs and what makes it work:
// a mean would let a loud drum hit smear across the held notes either side of
// it, where a median simply ignores it as the outlier it is.
//
// Insertion sort into a caller-owned scratch array. This runs tens of
// millions of times over a song, so it allocates nothing: a .slice().sort()
// here is the difference between a few seconds and a few minutes.
function median(scratch, count) {
  for (let i = 1; i < count; i++) {
    const value = scratch[i];
    let j = i - 1;
    while (j >= 0 && scratch[j] > value) {
      scratch[j + 1] = scratch[j];
      j--;
    }
    scratch[j + 1] = value;
  }
  const mid = count >> 1;
  return count % 2 ? scratch[mid] : (scratch[mid - 1] + scratch[mid]) / 2;
}

/**
 * Split a magnitude spectrogram into what persists over time (harmonic) and
 * what spans the spectrum at one moment (percussive), as two soft masks that
 * add up to one.
 *
 * `onYield` is awaited every so often, so a three minute song doesn't lock
 * the page up for the duration.
 */
async function hpssMasks(
  mag,
  frames,
  bins,
  { span = 9, onYield, onProgress } = {},
) {
  const harmonic = new Float32Array(frames * bins);
  const percussive = new Float32Array(frames * bins);
  const scratch = new Float32Array(span);
  const half = span >> 1;

  // Along time, at a fixed frequency: a held note survives, a drum hit doesn't.
  for (let b = 0; b < bins; b++) {
    for (let f = 0; f < frames; f++) {
      let count = 0;
      for (let k = -half; k <= half; k++) {
        const t = f + k;
        if (t >= 0 && t < frames) scratch[count++] = mag[t * bins + b];
      }
      harmonic[f * bins + b] = median(scratch, count);
    }
    if ((b & 63) === 0) {
      onProgress?.(b / bins / 2);
      await onYield?.();
    }
  }
  // Along frequency, at a fixed moment: a broadband hit survives, a single
  // sustained partial doesn't.
  for (let f = 0; f < frames; f++) {
    for (let b = 0; b < bins; b++) {
      let count = 0;
      for (let k = -half; k <= half; k++) {
        const c = b + k;
        if (c >= 0 && c < bins) scratch[count++] = mag[f * bins + c];
      }
      percussive[f * bins + b] = median(scratch, count);
    }
    if ((f & 255) === 0) {
      onProgress?.(0.5 + f / frames / 2);
      await onYield?.();
    }
  }
  // Wiener-style soft masks: each bin is shared out in proportion to how much
  // each side claims it, so the two always add back up to the original.
  for (let i = 0; i < harmonic.length; i++) {
    const h = harmonic[i] * harmonic[i];
    const p = percussive[i] * percussive[i];
    const total = h + p;
    if (total > 1e-12) {
      harmonic[i] = h / total;
      percussive[i] = p / total;
    } else {
      harmonic[i] = percussive[i] = 0.5;
    }
  }
  return { harmonic, percussive };
}

const apply = (spec, mask) => ({
  re: spec.re.map((v, i) => v * mask[i]),
  im: spec.im.map((v, i) => v * mask[i]),
  frames: spec.frames,
  bins: spec.bins,
});

/**
 * Separate a decoded AudioBuffer into stems.
 *
 * `wanted` is a list of stem ids; only those are computed, because each one
 * costs an inverse transform over the whole song. `onProgress(ratio, label)`
 * is called as it goes, and `yieldEvery` lets the caller hand the thread back
 * to the browser so the page doesn't freeze.
 */
export async function separate(
  buffer,
  {
    wanted = ['vocals', 'instrumental'],
    sharpness = 2,
    onProgress,
    onYield,
  } = {},
) {
  const length = buffer.length;
  const rate = buffer.sampleRate;
  const window = hann(FFT_SIZE);
  const left = buffer.getChannelData(0);
  const right =
    buffer.numberOfChannels > 1
      ? buffer.getChannelData(1)
      : buffer.getChannelData(0);
  const isMono = buffer.numberOfChannels === 1;

  const step = async (ratio, label) => {
    onProgress?.(ratio, label);
    await onYield?.();
  };

  await step(0.05, 'Reading the left channel…');
  const specL = analyse(left, window);
  await step(0.2, 'Reading the right channel…');
  const specR = analyse(right, window);

  const { frames, bins } = specL;
  const size = frames * bins;

  // The mono sum, which is what every stem is carved out of.
  const midRe = new Float32Array(size);
  const midIm = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    midRe[i] = (specL.re[i] + specR.re[i]) / 2;
    midIm[i] = (specL.im[i] + specR.im[i]) / 2;
  }
  const mid = { re: midRe, im: midIm, frames, bins };

  await step(0.3, 'Working out what sits in the centre…');
  // A mono file has no stereo field to read, so everything is "centred" and
  // the vocal mask would be all ones. Saying so beats handing back a copy.
  const centre = isMono ? null : centreMask(specL, specR, sharpness);

  const mag = new Float32Array(size);
  for (let i = 0; i < size; i++) mag[i] = Math.hypot(midRe[i], midIm[i]);

  const needsHpss = wanted.some((id) =>
    ['drums', 'bass', 'other'].includes(id),
  );
  let hpss = null;
  if (needsHpss) {
    hpss = await hpssMasks(mag, frames, bins, {
      onYield,
      onProgress: (r) =>
        onProgress?.(0.4 + r * 0.2, 'Telling the drums from the held notes…'),
    });
  }

  // 250 Hz, as a bin number: where the bass ends and everything else begins.
  const bassBin = Math.round((250 / (rate / 2)) * (bins - 1));

  const out = {};
  const total = wanted.length || 1;
  let done = 0;

  for (const id of wanted) {
    await step(0.6 + (done / total) * 0.35, `Rendering the ${id}…`);
    let mask;
    if (id === 'vocals') mask = centre ?? ones(size);
    else if (id === 'instrumental') mask = centre ? invert(centre) : ones(size);
    else if (id === 'drums') mask = hpss.percussive;
    else if (id === 'bass')
      mask = band(hpss.harmonic, frames, bins, 0, bassBin);
    else if (id === 'other') {
      // What's left of the sustained part once the bass and the vocal are out
      // of it, which is the honest definition of "other" here.
      const rest = band(hpss.harmonic, frames, bins, bassBin, bins);
      mask = centre ? multiply(rest, invert(centre)) : rest;
    }
    out[id] = synthesise(apply(mid, mask), window, length);
    done++;
  }

  await step(1, 'Done.');
  return { stems: out, sampleRate: rate, isMono };
}

const ones = (n) => new Float32Array(n).fill(1);
const invert = (mask) => mask.map((v) => 1 - v);
const multiply = (a, b) => a.map((v, i) => v * b[i]);

// The same mask, silenced outside a frequency range.
function band(mask, frames, bins, from, to) {
  const out = new Float32Array(mask.length);
  for (let f = 0; f < frames; f++)
    for (let b = from; b < to && b < bins; b++)
      out[f * bins + b] = mask[f * bins + b];
  return out;
}

// ------------------------------------------------------------- WAV output

/** Wrap mono samples as a 16-bit WAV, which every program on earth opens. */
export function toWav(samples, sampleRate) {
  const bytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);
  const text = (offset, string) => {
    for (let i = 0; i < string.length; i++)
      view.setUint8(offset + i, string.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM header length
  view.setUint16(20, 1, true); // format: uncompressed
  view.setUint16(22, 1, true); // channels
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per sample frame
  view.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, bytes, true);
  for (let i = 0; i < samples.length; i++) {
    // Clipped, not wrapped: a mask can push a peak past full scale, and
    // wrapping turns that into a loud crack rather than a slight squash.
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
