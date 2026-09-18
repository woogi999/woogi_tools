// The on-device models, loaded only when you ask for them. transformers.js runs
// them in WebAssembly (or WebGPU where there is one) inside your browser: the
// files download once from Hugging Face's CDN and your text and audio stay here.

const WHISPER_DTYPE = { encoder_model: 'q8', decoder_model_merged: 'fp32' };

const MODELS = {
  // Speech to text. Tiny is quick and good enough for clear speech; small is slower and better.
  // The quantised decoder files fail to open in the current onnxruntime
  // ("Missing required scale ... embed_tokens"), so the decoder stays fp32.
  'whisper-tiny': {
    task: 'automatic-speech-recognition',
    id: 'onnx-community/whisper-tiny.en',
    label: 'Fast (~130 MB)',
    dtype: WHISPER_DTYPE,
  },
  'whisper-base': {
    task: 'automatic-speech-recognition',
    id: 'onnx-community/whisper-base',
    label: 'Better, any language (~250 MB)',
    dtype: WHISPER_DTYPE,
  },
  // A small instruction model, used for both rewriting and tidying up grammar.
  'flan-t5': {
    task: 'text2text-generation',
    id: 'Xenova/flan-t5-small',
    label: 'Writing model (~120 MB)',
  },
  // A small chat model for the home page's "ask" box. 4-bit weights keep the
  // download to about a quarter of a gigabyte; it runs on the GPU where the
  // browser offers one, and in WebAssembly otherwise.
  chat: {
    task: 'text-generation',
    id: 'HuggingFaceTB/SmolLM2-360M-Instruct',
    label: 'Chat model (~270 MB)',
    dtype: 'q4',
    device: navigator.gpu ? 'webgpu' : 'wasm',
    // A GPU driver that can't run 4-bit weights gets the plain 8-bit build instead.
    fallback: { dtype: 'q8', device: 'wasm' },
  },
};

const loaded = new Map();

export const modelLabel = (key) => MODELS[key]?.label ?? key;

// Loads a pipeline once and keeps it for the rest of the visit.
export async function loadModel(key, { onProgress } = {}) {
  if (loaded.has(key)) return loaded.get(key);
  const spec = MODELS[key];
  if (!spec) throw new Error(`No such model: ${key}`);
  const job = (async () => {
    const { pipeline } = await import('@huggingface/transformers');
    const load = ({ dtype = 'q8', device } = {}) =>
      pipeline(spec.task, spec.id, {
        dtype,
        ...(device ? { device } : {}),
        progress_callback: (event) => {
          if (event.status === 'progress' && event.total)
            onProgress?.({
              file: event.file,
              ratio: event.loaded / event.total,
            });
          else if (event.status === 'ready') onProgress?.({ ratio: 1 });
        },
      });
    try {
      return await load(spec);
    } catch (error) {
      if (!spec.fallback) throw error;
      console.warn(`${key}: falling back to ${spec.fallback.dtype}`, error);
      return load(spec.fallback);
    }
  })();
  loaded.set(key, job);
  try {
    return await job;
  } catch (error) {
    // A failed download shouldn't poison the next attempt.
    loaded.delete(key);
    throw error;
  }
}

export const isLoaded = (key) => loaded.has(key);

// Whisper wants plain 16 kHz mono samples, which the browser can decode itself.
export async function decodeAudio(blob) {
  const ctx = new (window.AudioContext ?? window.webkitAudioContext)({
    sampleRate: 16000,
  });
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
    // Two ears into one: the average of the channels.
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    const mono = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) mono[i] = (left[i] + right[i]) / 2;
    return mono;
  } finally {
    ctx.close();
  }
}

// Asks the writing model for one answer, kept short and steady.
export async function ask(model, prompt, { max = 160 } = {}) {
  const out = await model(prompt, {
    max_new_tokens: max,
    temperature: 0.7,
    do_sample: true,
    top_p: 0.92,
    repetition_penalty: 1.15,
  });
  const text = Array.isArray(out)
    ? (out[0]?.generated_text ?? '')
    : (out?.generated_text ?? '');
  return String(text).trim();
}

// Streams one answer from the chat model. `onText` gets the answer so far as
// it grows. The returned promise resolves with the finished text and carries a
// `stop()` that cuts the answer short.
export function chat(model, messages, { onText, max = 220 } = {}) {
  let stopping = null;
  const job = (async () => {
    const { TextStreamer, InterruptableStoppingCriteria } =
      await import('@huggingface/transformers');
    stopping = new InterruptableStoppingCriteria();
    let text = '';
    const streamer = new TextStreamer(model.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (piece) => {
        text += piece;
        onText?.(text);
      },
    });
    const out = await model(messages, {
      max_new_tokens: max,
      do_sample: false,
      repetition_penalty: 1.1,
      return_full_text: false,
      streamer,
      stopping_criteria: stopping,
    });
    const last = Array.isArray(out)
      ? out[0]?.generated_text
      : out?.generated_text;
    const final = Array.isArray(last) ? last.at(-1)?.content : last;
    return String(final ?? text).trim() || text.trim();
  })();
  job.stop = () => stopping?.interrupt();
  return job;
}
