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
  // The chat model behind the home page's Woogi: a half-billion-parameter
  // instruction model with 4-bit weights. It runs in a worker (see
  // app/workers/chat.js), on the GPU where the browser offers one and in
  // WebAssembly otherwise, so the page never freezes while it thinks.
  chat: {
    task: 'text-generation',
    id: 'onnx-community/Qwen2.5-0.5B-Instruct',
    label: 'Chat model (~400 MB)',
    dtype: 'q4',
    worker: true,
    // A GPU driver that can't run 4-bit weights gets the plain WebAssembly build instead.
    fallback: { dtype: 'q4', device: 'wasm' },
  },
};

const loaded = new Map();

export const modelLabel = (key) => MODELS[key]?.label ?? key;

// Loads a pipeline once and keeps it for the rest of the visit.
export async function loadModel(key, { onProgress } = {}) {
  if (loaded.has(key)) return loaded.get(key);
  const spec = MODELS[key];
  if (!spec) throw new Error(`No such model: ${key}`);
  const job = spec.worker
    ? loadInWorker(spec, onProgress)
    : (async () => {
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

// A model that runs in its own worker. The handle stands in for the pipeline:
// `chat()` below talks to it with messages instead of calling it.
function loadInWorker(spec, onProgress) {
  const worker = new Worker(new URL('../workers/chat.js', import.meta.url), {
    type: 'module',
  });
  const handle = { worker, jobs: new Map() };
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      const job = handle.jobs.get(data.id);
      if (data.type === 'progress') onProgress?.(data);
      else if (data.type === 'ready') resolve(handle);
      else if (data.type === 'text') job?.onText?.(data.text);
      else if (data.type === 'done') {
        handle.jobs.delete(data.id);
        job?.resolve(data.text);
      } else if (data.type === 'error') {
        const error = new Error(data.message);
        if (job) {
          handle.jobs.delete(data.id);
          job.reject(error);
        } else {
          reject(error);
          worker.terminate();
        }
      }
    };
    worker.onerror = (event) => {
      reject(new Error(event.message ?? 'The chat model could not start.'));
      worker.terminate();
    };
    const { fallback, task, id, dtype } = spec;
    worker.postMessage({ type: 'load', spec: { task, id, dtype, fallback } });
  });
}

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
let chatSeq = 0;
export function chat(model, messages, { onText, max = 220 } = {}) {
  if (model.worker) {
    const id = ++chatSeq;
    const job = new Promise((resolve, reject) => {
      model.jobs.set(id, { resolve, reject, onText });
      model.worker.postMessage({ type: 'chat', id, messages, max });
    });
    job.stop = () => model.worker.postMessage({ type: 'stop' });
    return job;
  }
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
