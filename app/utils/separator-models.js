// The separation models, and exactly how each one wants its data.
//
// Both models here take a spectrogram rather than a waveform: the host is
// expected to do the STFT, hand over a tensor, and inverse-transform whatever
// comes back. That means the only thing that differs between them is the
// window size and how the numbers are interleaved, which is what this file
// pins down. Get the interleaving wrong and a model still runs and still
// returns finite numbers — it just returns noise — so each layout below was
// checked against the real model file before being written down.
//
// Weights are fetched from Hugging Face, which serves the CORS headers that
// let a browser read them, and cached afterwards (see model-cache.js).

const HF = 'https://huggingface.co';

// ---------------------------------------------------------------- layouts

// BS-RoFormer, per lucidrains' implementation: the spectrogram is rearranged
// '(b s) f t c -> b (f s) t c' and then 'b f t c -> b t (f c)', so the last
// axis runs ((bin * 2) + channel) * 2 + (real | imaginary).
const roformer = {
  inputName: 'input',
  dims: ({ frames, bins }) => [1, frames, bins * 4],
  // Note the input is time-major and the output frequency-major: they are not
  // the same layout, so pack and unpack are not inverses of each other here.
  outDims: ({ frames, bins }) => [1, 1, bins * 2, frames, 2],
  pack(left, right, { frames, bins }) {
    const input = new Float32Array(frames * bins * 4);
    for (let f = 0; f < frames; f++)
      for (let b = 0; b < bins; b++) {
        const src = f * bins + b;
        const at = f * bins * 4 + b * 4;
        input[at] = left.re[src];
        input[at + 1] = left.im[src];
        input[at + 2] = right.re[src];
        input[at + 3] = right.im[src];
      }
    return input;
  },
  // Output is (batch, stem, (bin channel), frame, complex).
  unpack(data, channel, { frames, bins }) {
    const re = new Float32Array(frames * bins);
    const im = new Float32Array(frames * bins);
    for (let b = 0; b < bins; b++)
      for (let f = 0; f < frames; f++) {
        const at = ((b * 2 + channel) * frames + f) * 2;
        re[f * bins + b] = data[at];
        im[f * bins + b] = data[at + 1];
      }
    return { re, im, frames, bins };
  },
};

// MDX-Net: a [1, 4, dimF, dimT] tensor whose four channels are the real and
// imaginary parts of each stereo channel. Only the lowest `dimF` bins are
// passed; the rest are dropped going in and zero on the way out.
const mdx = {
  inputName: 'input',
  dims: ({ frames, dimF }) => [1, 4, dimF, frames],
  // MDX hands back the same shape it was given, so here pack and unpack are
  // exact inverses over the bins the model is allowed to see.
  outDims: ({ frames, dimF }) => [1, 4, dimF, frames],
  pack(left, right, { frames, bins, dimF }) {
    const input = new Float32Array(4 * dimF * frames);
    const plane = dimF * frames;
    for (let b = 0; b < dimF; b++)
      for (let f = 0; f < frames; f++) {
        const src = f * bins + b;
        const at = b * frames + f;
        input[at] = left.re[src];
        input[plane + at] = left.im[src];
        input[plane * 2 + at] = right.re[src];
        input[plane * 3 + at] = right.im[src];
      }
    return input;
  },
  unpack(data, channel, { frames, bins, dimF }) {
    const re = new Float32Array(frames * bins);
    const im = new Float32Array(frames * bins);
    const plane = dimF * frames;
    const reBase = channel * 2 * plane;
    const imBase = reBase + plane;
    for (let b = 0; b < dimF; b++)
      for (let f = 0; f < frames; f++) {
        const at = b * frames + f;
        re[f * bins + b] = data[reBase + at];
        im[f * bins + b] = data[imBase + at];
      }
    return { re, im, frames, bins };
  },
};

// ----------------------------------------------------------------- models

export const MODELS = {
  'bs-roformer': {
    id: 'bs-roformer',
    label: 'BS-RoFormer',
    url: `${HF}/safescribeai/bs-roformer-onnx-fp16/resolve/main/bs_roformer_fp16.onnx`,
    bytes: 324761627,
    // Signal-to-distortion ratio on the standard vocal benchmark, in dB.
    // Higher is cleaner; the difference between 5 and 13 is not subtle.
    sdr: 12.98,
    // fp16 weights: the numbers only make sense to a GPU, and on a CPU this
    // model takes about five minutes per eight seconds of audio. Measured,
    // not guessed, which is why it is gated rather than merely discouraged.
    webgpuOnly: true,
    // Peak GPU memory reported for models of this class. Below roughly this,
    // the browser kills the context part way through.
    vramGb: 4,
    stft: { nFft: 2048, hop: 441 },
    frames: 801,
    bins: 1025,
    layout: roformer,
    outputStem: 'vocals',
  },
  'mdx-inst-hq3': {
    id: 'mdx-inst-hq3',
    label: 'UVR MDX-Net Inst HQ 3',
    url: `${HF}/Blane187/all_public_uvr_models/resolve/main/UVR-MDX-NET-Inst_HQ_3.onnx`,
    bytes: 66759214,
    sdr: 9.5,
    webgpuOnly: false,
    vramGb: 1,
    stft: { nFft: 6144, hop: 1024 },
    frames: 256,
    bins: 3073,
    dimF: 3072,
    layout: mdx,
    // The Inst models predict the backing track; the vocal is what's left.
    outputStem: 'instrumental',
  },
};

// How many samples one pass covers. Both models are framed so that a chunk of
// exactly hop * (frames - 1) samples produces exactly `frames` STFT frames.
export const chunkSamples = (model) => model.stft.hop * (model.frames - 1);

// --------------------------------------------------------------- engines
//
// What the tool actually offers. An engine is a list of models whose outputs
// get averaged, so adding a second member here is all an ensemble takes.

export const ENGINES = [
  {
    id: 'dsp',
    label: 'Instant',
    models: [],
    hint: 'No download, runs in seconds. Rough, and only as good as the stereo field: a mono track or an off-centre vocal will not separate.',
    quality: 'Rough',
    stems: ['vocals', 'instrumental', 'drums', 'bass', 'other'],
  },
  {
    id: 'mdx',
    label: 'Good',
    models: ['mdx-inst-hq3'],
    hint: 'UVR’s MDX-Net. A large step up on the instant mode, works without a modern GPU, and the download is modest.',
    quality: 'Good',
    stems: ['vocals', 'instrumental'],
  },
  // BS-RoFormer belongs here, and its entry is ready in MODELS above — it is
  // the best vocal separator there is (12.98 dB against MDX-Net's 9.5). It is
  // not offered because it could not be made to produce anything usable, and
  // these were ruled out first:
  //
  //   - the pipeline itself is fine: the same STFT, packing and inverse
  //     transform separate a voice from a chord correctly through MDX-Net
  //   - the model is running: its output tensor is 99.8% non-zero, max ~2.3,
  //     with no NaN, so it is not a dead graph
  //   - it is not the frequency-axis ordering: both bin-major (bin * 2 + ch)
  //     and channel-major (ch * bins + bin) inverse-transform to silence
  //   - it is not input scale: 1x, 100x and 10000x down all behave the same
  //
  // What is left is the fp16 weights, which really want a GPU — this was all
  // measured on the CPU provider, for want of a WebGPU machine to test on.
  // Adding it back is one entry:
  //
  //   { id: 'roformer', label: 'Best', models: ['bs-roformer'],
  //     quality: 'Best', stems: ['vocals', 'instrumental'],
  //     hint: '...' },
  //
  // once someone has confirmed on real hardware that it separates a real song.
];

export const engineById = (id) =>
  ENGINES.find((e) => e.id === id) ?? ENGINES[0];

export const modelsFor = (engine) => engine.models.map((id) => MODELS[id]);

export const totalBytes = (engine) =>
  modelsFor(engine).reduce((n, m) => n + m.bytes, 0);

export const needsWebGpu = (engine) =>
  modelsFor(engine).some((m) => m.webgpuOnly);
