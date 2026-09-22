// The transform the separation models are fed through.
//
// This is worth testing hard because getting it wrong fails quietly: a model
// handed a subtly wrong spectrogram still runs, still returns finite numbers,
// and returns noise. The radix-2/Bluestein split in particular was found by
// this kind of check — MDX-Net's window is 6144 samples, which is not a power
// of two, and a radix-2 routine given 6144 returns plausible garbage rather
// than an error.

import assert from 'node:assert';

const B = 'file:///E:/coding_projects/woogi_tools/app/utils/';
const { fft, stft, istft, hannWindow, frameCount } = await import(
  B + 'stft.js'
);
const { MODELS, chunkSamples } = await import(B + 'separator-models.js');

/* ---- the window */

// torch.hann_window(periodic=True) divides by the size, not size - 1. The
// symmetric version is SciPy's default and would ripple through the output.
const w = hannWindow(8);
assert.equal(w[0], 0, 'starts at zero');
assert.ok(Math.abs(w[4] - 1) < 1e-12, 'peaks at one, halfway');
assert.ok(Math.abs(w[2] - 0.5) < 1e-12, 'periodic, not symmetric');

/* ---- the FFT, against a brute-force DFT */

function dft(re, im) {
  const n = re.length;
  const R = new Float64Array(n);
  const I = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let a = 0;
    let b = 0;
    for (let j = 0; j < n; j++) {
      const t = (-2 * Math.PI * j * k) / n;
      a += re[j] * Math.cos(t) - im[j] * Math.sin(t);
      b += re[j] * Math.sin(t) + im[j] * Math.cos(t);
    }
    R[k] = a;
    I[k] = b;
  }
  return [R, I];
}

// 64 is a power of two (radix-2); 96 and 48 are not (Bluestein).
for (const n of [64, 96, 48]) {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    re[k] = Math.sin(k * 0.7) + (0.3 * k) / n;
    im[k] = Math.cos(k * 0.3);
  }
  const [R, I] = dft(Float64Array.from(re), Float64Array.from(im));
  fft(re, im, false);
  let err = 0;
  for (let k = 0; k < n; k++)
    err = Math.max(err, Math.abs(re[k] - R[k]), Math.abs(im[k] - I[k]));
  assert.ok(err < 1e-9, `fft(${n}) matches a brute-force DFT (error ${err})`);
}

// And the inverse really is the inverse, at a size that needs Bluestein.
{
  const n = 96;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 0; k < n; k++) re[k] = Math.sin(k * 1.1);
  const wantRe = Float64Array.from(re);
  fft(re, im, false);
  fft(re, im, true);
  let err = 0;
  for (let k = 0; k < n; k++)
    err = Math.max(err, Math.abs(re[k] - wantRe[k]), Math.abs(im[k]));
  assert.ok(err < 1e-9, `inverse fft round-trips (error ${err})`);
}

/* ---- the STFT, at the settings each model actually uses */

for (const model of Object.values(MODELS)) {
  const { nFft, hop } = model.stft;
  const length = nFft * 40;
  const x = new Float32Array(length);
  for (let i = 0; i < length; i++)
    x[i] =
      0.3 * Math.sin((2 * Math.PI * 220 * i) / 44100) +
      0.2 * Math.sin((2 * Math.PI * 3000 * i) / 44100) +
      0.05 * Math.sin(i * 12.9898);

  const spec = stft(x, { nFft, hop });
  assert.equal(spec.bins, nFft / 2 + 1, `${model.id}: bin count`);
  assert.equal(
    spec.frames,
    frameCount(length, hop),
    `${model.id}: frame count matches torch's center=True formula`,
  );

  const y = istft(spec, { nFft, hop, length });
  let err = 0;
  // The first and last window are approximate: reflect padding, by design.
  for (let i = nFft; i < length - nFft; i++)
    err = Math.max(err, Math.abs(x[i] - y[i]));
  assert.ok(
    err < 1e-4,
    `${model.id}: stft -> istft round-trips (error ${err})`,
  );
}

/* ---- the chunk sizes the models are framed around */

for (const model of Object.values(MODELS)) {
  const chunk = chunkSamples(model);
  assert.equal(
    frameCount(chunk, model.stft.hop),
    model.frames,
    `${model.id}: a chunk produces exactly the frames the model wants`,
  );
}

/* ---- the tensor layouts pack and unpack as inverses */

for (const model of Object.values(MODELS)) {
  const shape = { frames: model.frames, bins: model.bins, dimF: model.dimF };
  const size = model.frames * model.bins;
  const left = { re: new Float32Array(size), im: new Float32Array(size) };
  const right = { re: new Float32Array(size), im: new Float32Array(size) };
  for (let i = 0; i < size; i++) {
    left.re[i] = i + 1;
    left.im[i] = -(i + 1);
    right.re[i] = (i + 1) * 2;
    right.im[i] = -(i + 1) * 2;
  }

  const packed = model.layout.pack(left, right, shape);
  const dims = model.layout.dims(shape);
  assert.equal(
    packed.length,
    dims.reduce((a, b) => a * b, 1),
    `${model.id}: packed size matches the declared tensor shape`,
  );

  // unpack reads the model's *output* layout, which is not always the input
  // one — BS-RoFormer takes time-major and returns frequency-major. So build a
  // buffer in the output shape where every slot states which (bin, channel,
  // frame, real/imaginary) it is, and check unpack puts each back where it
  // belongs. The encoding is exact in a float: the values stay small.
  const keep = model.dimF ?? model.bins;
  const outShape = model.layout.outDims(shape);
  const outSize = outShape.reduce((a, b) => a * b, 1);
  const tag = (b, ch, f, part) =>
    ((b * 2 + ch) * model.frames + f) * 2 + part + 1;

  const fake = new Float32Array(outSize);
  if (model.id === 'bs-roformer') {
    for (let b = 0; b < model.bins; b++)
      for (let ch = 0; ch < 2; ch++)
        for (let f = 0; f < model.frames; f++) {
          const at = ((b * 2 + ch) * model.frames + f) * 2;
          fake[at] = tag(b, ch, f, 0);
          fake[at + 1] = tag(b, ch, f, 1);
        }
  } else {
    const plane = model.dimF * model.frames;
    for (let b = 0; b < model.dimF; b++)
      for (let ch = 0; ch < 2; ch++)
        for (let f = 0; f < model.frames; f++) {
          const at = b * model.frames + f;
          fake[ch * 2 * plane + at] = tag(b, ch, f, 0);
          fake[(ch * 2 + 1) * plane + at] = tag(b, ch, f, 1);
        }
  }

  for (const channel of [0, 1]) {
    const out = model.layout.unpack(fake, channel, shape);
    for (let f = 0; f < model.frames; f++)
      for (let b = 0; b < keep; b++) {
        const at = f * model.bins + b;
        assert.equal(
          out.re[at],
          tag(b, channel, f, 0),
          `${model.id}: ch${channel} re`,
        );
        assert.equal(
          out.im[at],
          tag(b, channel, f, 1),
          `${model.id}: ch${channel} im`,
        );
      }
  }

  // For MDX the two really are inverses, so check that directly too.
  if (model.id === 'mdx-inst-hq3')
    for (const [channel, source] of [
      [0, left],
      [1, right],
    ]) {
      const out = model.layout.unpack(packed, channel, shape);
      for (let f = 0; f < model.frames; f++)
        for (let b = 0; b < keep; b++) {
          const at = f * model.bins + b;
          assert.equal(out.re[at], source.re[at], `${model.id}: round-trip re`);
          assert.equal(out.im[at], source.im[at], `${model.id}: round-trip im`);
        }
    }
}

console.log('stft: all checks passed');
