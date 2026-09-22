// A short-time Fourier transform that matches PyTorch's, because the models
// this feeds were trained against torch.stft and will hand back noise if the
// spectrogram arrives in a different shape, scale or phase convention.
//
// The things that have to match exactly, all of which are easy to get subtly
// wrong: a *periodic* Hann window (not symmetric), centring the frames by
// padding half a window on each end, reflecting rather than zeroing that pad,
// and normalising the overlap-add by the sum of the squared window. Each of
// those is checked by the round-trip test in tests/node/stft-test.mjs.

const isPowerOfTwo = (n) => n > 0 && (n & (n - 1)) === 0;

/**
 * An FFT for any window size.
 *
 * Radix-2 handles the powers of two, which is most of them. It cannot handle
 * the rest, and that matters here: MDX-Net's window is 6144 samples, which is
 * 2^11 * 3. A radix-2 routine given 6144 doesn't fail loudly — it returns
 * plausible-looking finite garbage — so anything that isn't a power of two
 * goes through Bluestein's algorithm instead, which re-expresses the
 * transform as a convolution that *is* a power of two.
 */
export function fft(re, im, inverse) {
  if (isPowerOfTwo(re.length)) radix2(re, im, inverse);
  else bluestein(re, im, inverse);
}

// The chirp trick: with k^2 = (k^2 mod 2n) the angles stay accurate for large
// k, where squaring the index directly would lose precision.
function bluestein(re, im, inverse) {
  const n = re.length;
  const sign = inverse ? 1 : -1;
  let m = 1;
  while (m < 2 * n - 1) m <<= 1;

  const cos = new Float64Array(n);
  const sin = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const angle = (sign * Math.PI * ((k * k) % (2 * n))) / n;
    cos[k] = Math.cos(angle);
    sin[k] = Math.sin(angle);
  }

  const aRe = new Float64Array(m);
  const aIm = new Float64Array(m);
  for (let k = 0; k < n; k++) {
    aRe[k] = re[k] * cos[k] - im[k] * sin[k];
    aIm[k] = re[k] * sin[k] + im[k] * cos[k];
  }

  // The kernel is the conjugate chirp, wrapped around so the convolution
  // below comes out cyclic in the right way.
  const bRe = new Float64Array(m);
  const bIm = new Float64Array(m);
  bRe[0] = cos[0];
  bIm[0] = -sin[0];
  for (let k = 1; k < n; k++) {
    bRe[k] = bRe[m - k] = cos[k];
    bIm[k] = bIm[m - k] = -sin[k];
  }

  radix2(aRe, aIm, false);
  radix2(bRe, bIm, false);
  for (let k = 0; k < m; k++) {
    const r = aRe[k] * bRe[k] - aIm[k] * bIm[k];
    aIm[k] = aRe[k] * bIm[k] + aIm[k] * bRe[k];
    aRe[k] = r;
  }
  radix2(aRe, aIm, true);

  for (let k = 0; k < n; k++) {
    re[k] = aRe[k] * cos[k] - aIm[k] * sin[k];
    im[k] = aRe[k] * sin[k] + aIm[k] * cos[k];
  }
  if (inverse)
    for (let k = 0; k < n; k++) {
      re[k] /= n;
      im[k] /= n;
    }
}

// An in-place iterative radix-2 FFT over separate real and imaginary arrays.
function radix2(re, im, inverse) {
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
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + half] * curRe - im[i + k + half] * curIm;
        const bIm = re[i + k + half] * curIm + im[i + k + half] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + half] = aRe - bRe;
        im[i + k + half] = aIm - bIm;
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

// torch.hann_window(periodic=True): the window that tiles seamlessly when
// frames overlap. The symmetric version (dividing by size - 1) is the one
// SciPy defaults to and would leave a slow ripple through the output.
export function hannWindow(size) {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++)
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  return w;
}

// The reflect padding torch.stft uses for center=True: the signal mirrored
// about its own first and last sample, without repeating them.
function reflectPad(signal, pad) {
  const out = new Float32Array(signal.length + pad * 2);
  out.set(signal, pad);
  for (let i = 0; i < pad; i++) {
    out[pad - 1 - i] = signal[Math.min(i + 1, signal.length - 1)];
    out[pad + signal.length + i] = signal[Math.max(0, signal.length - 2 - i)];
  }
  return out;
}

export const frameCount = (length, hop) => Math.floor(length / hop) + 1;

/**
 * torch.stft(signal, nFft, hop, window=hann(periodic), center=True,
 *            pad_mode='reflect', return_complex=True)
 *
 * Returns { re, im, frames, bins } with bins = nFft / 2 + 1, laid out
 * frame-major: bin b of frame f is at f * bins + b.
 */
export function stft(signal, { nFft, hop, window = hannWindow(nFft) }) {
  const bins = nFft / 2 + 1;
  const frames = frameCount(signal.length, hop);
  const padded = reflectPad(signal, nFft >> 1);
  const re = new Float32Array(frames * bins);
  const im = new Float32Array(frames * bins);
  const bufRe = new Float64Array(nFft);
  const bufIm = new Float64Array(nFft);
  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    for (let i = 0; i < nFft; i++) {
      bufRe[i] = (padded[start + i] ?? 0) * window[i];
      bufIm[i] = 0;
    }
    fft(bufRe, bufIm, false);
    const base = f * bins;
    for (let b = 0; b < bins; b++) {
      re[base + b] = bufRe[b];
      im[base + b] = bufIm[b];
    }
  }
  return { re, im, frames, bins };
}

/**
 * torch.istft, the exact inverse of the above for a signal of `length`.
 *
 * The overlap-add is divided by the summed squared window, which is what
 * makes an untouched spectrogram reconstruct its input rather than come back
 * with a ripple where the frames meet.
 */
export function istft(
  { re, im, frames, bins },
  { nFft, hop, length, window = hannWindow(nFft) },
) {
  const half = nFft >> 1;
  const padded = length + nFft;
  const out = new Float64Array(padded);
  const norm = new Float64Array(padded);
  const bufRe = new Float64Array(nFft);
  const bufIm = new Float64Array(nFft);
  for (let f = 0; f < frames; f++) {
    const base = f * bins;
    // Only half the spectrum is stored; the rest is its conjugate mirror,
    // which is what makes the inverse transform come out real.
    for (let b = 0; b < bins; b++) {
      bufRe[b] = re[base + b];
      bufIm[b] = im[base + b];
      if (b > 0 && b < bins - 1) {
        bufRe[nFft - b] = re[base + b];
        bufIm[nFft - b] = -im[base + b];
      }
    }
    fft(bufRe, bufIm, true);
    const start = f * hop;
    for (let i = 0; i < nFft; i++) {
      const s = start + i;
      if (s >= padded) break;
      out[s] += bufRe[i] * window[i];
      norm[s] += window[i] * window[i];
    }
  }
  const signal = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const n = norm[i + half];
    signal[i] = n > 1e-8 ? out[i + half] / n : 0;
  }
  return signal;
}
