// The chat model lives in this worker so that downloading, compiling and
// running it never stalls the page. Messages in: `load` (with the model spec),
// `chat` (with the conversation) and `stop`. Messages out: `progress`,
// `ready`, `text` (the answer so far), `done` and `error`.
import {
  pipeline,
  TextStreamer,
  InterruptableStoppingCriteria,
} from '@huggingface/transformers';

let model = null;
let loading = null;
let stopping = null;

const post = (message) => self.postMessage(message);

async function load(spec) {
  const build = ({ dtype = 'q8', device } = {}) =>
    pipeline(spec.task, spec.id, {
      dtype,
      ...(device ? { device } : {}),
      progress_callback: (event) => {
        if (event.status === 'progress' && event.total)
          post({
            type: 'progress',
            file: event.file,
            ratio: event.loaded / event.total,
          });
        else if (event.status === 'ready') post({ type: 'progress', ratio: 1 });
      },
    });
  // The GPU is only known in here, so the device is picked in the worker.
  const first = { ...spec, device: self.navigator.gpu ? 'webgpu' : 'wasm' };
  try {
    return await build(first);
  } catch (error) {
    if (!spec.fallback) throw error;
    console.warn(`chat model: falling back to ${spec.fallback.device}`, error);
    return build(spec.fallback);
  }
}

async function chat({ id, messages, max }) {
  stopping = new InterruptableStoppingCriteria();
  let text = '';
  const streamer = new TextStreamer(model.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (piece) => {
      text += piece;
      post({ type: 'text', id, text });
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
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      loading ??= load(data.spec).then((m) => (model = m));
      await loading;
      post({ type: 'ready' });
    } else if (data.type === 'chat') {
      await loading;
      const text = await chat(data);
      post({ type: 'done', id: data.id, text });
    } else if (data.type === 'stop') {
      stopping?.interrupt();
    }
  } catch (error) {
    if (data.type === 'load') loading = null;
    post({
      type: 'error',
      id: data.id,
      message: error?.message ?? String(error),
    });
  }
};
