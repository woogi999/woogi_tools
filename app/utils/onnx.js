// Running the separation models: finding out whether this machine can, and
// getting several hundred megabytes of weights onto it once rather than on
// every visit.
//
// ONNX Runtime's own WebAssembly files come from a CDN pinned to the exact
// version in package.json, the same arrangement the converters use for the
// FFmpeg core: they are too big to ship with the site and they have to match
// the library exactly.

const ORT_VERSION = '1.21.0';
const ORT_WASM = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const CACHE_NAME = 'woogi-models-v1';

let runtime = null;

async function ort() {
  if (!runtime) {
    const lib = await import('onnxruntime-web/webgpu');
    lib.env.wasm.wasmPaths = ORT_WASM;
    // Threads need the page to be cross-origin isolated (COOP/COEP headers),
    // which this site is not. Asking for them anyway makes the runtime fail
    // to start rather than quietly run on one thread.
    lib.env.wasm.numThreads = globalThis.crossOriginIsolated
      ? Math.min(4, navigator.hardwareConcurrency || 1)
      : 1;
    lib.env.logLevel = 'error';
    runtime = lib;
  }
  return runtime;
}

/**
 * Whether this browser can run the heavy models, and what it would run them on.
 *
 * Returns { webgpu, vramGb, reason }. `vramGb` is an estimate read off the
 * adapter's largest allowed buffer, which is the closest thing WebGPU exposes
 * to "how much memory is there"; it deliberately understates.
 */
export async function inspectDevice() {
  if (!globalThis.isSecureContext)
    return {
      webgpu: false,
      vramGb: 0,
      reason: 'WebGPU needs a secure (https) page.',
    };
  if (!navigator.gpu)
    return {
      webgpu: false,
      vramGb: 0,
      reason:
        'This browser has no WebGPU. Chrome and Edge have it; Safari and Firefox are still catching up.',
    };
  try {
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });
    if (!adapter)
      return {
        webgpu: false,
        vramGb: 0,
        reason: 'No graphics adapter would start.',
      };
    const limit = adapter.limits?.maxStorageBufferBindingSize ?? 0;
    return { webgpu: true, vramGb: limit / 1024 ** 3, reason: null };
  } catch (error) {
    return { webgpu: false, vramGb: 0, reason: error.message };
  }
}

// ------------------------------------------------------------ the weights

/**
 * The model file, from the cache if it has been here before.
 *
 * Downloaded through a stream so the page can show real progress: a few
 * hundred megabytes with no feedback looks identical to a hang.
 */
export async function fetchWeights(model, { onProgress, signal } = {}) {
  const cached = await fromCache(model.url);
  if (cached) {
    onProgress?.({
      loaded: cached.byteLength,
      total: cached.byteLength,
      cached: true,
    });
    return cached;
  }

  // eslint-disable-next-line warp-drive/no-external-request-patterns -- downloading model weights, not app data
  const response = await fetch(model.url, { signal });
  if (!response.ok)
    throw new Error(`Could not download ${model.label} (${response.status}).`);

  const total = Number(response.headers.get('content-length')) || model.bytes;
  const reader = response.body.getReader();
  const parts = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.byteLength;
    onProgress?.({ loaded, total, cached: false });
  }

  const buffer = new Uint8Array(loaded);
  let at = 0;
  for (const part of parts) {
    buffer.set(part, at);
    at += part.byteLength;
  }
  // Storing it is a nicety, not the point: a browser that refuses (private
  // window, no quota for a 300 MB file) should still get its separation.
  await toCache(model.url, buffer).catch(() => {});
  return buffer.buffer;
}

async function fromCache(url) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    return hit ? await hit.arrayBuffer() : null;
  } catch {
    return null;
  }
}

async function toCache(url, bytes) {
  const cache = await caches.open(CACHE_NAME);
  await cache.put(
    url,
    new Response(bytes, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(bytes.byteLength),
      },
    }),
  );
}

/** Whether this model's weights are already on the machine. */
export async function isCached(model) {
  try {
    const cache = await caches.open(CACHE_NAME);
    return Boolean(await cache.match(model.url));
  } catch {
    return false;
  }
}

/** Forget every downloaded model, for a "free up space" button. */
export async function clearModelCache() {
  try {
    return await caches.delete(CACHE_NAME);
  } catch {
    return false;
  }
}

// ------------------------------------------------------------- inference

const sessions = new Map();

export async function loadSession(model, { onProgress, webgpu } = {}) {
  if (sessions.has(model.id)) return sessions.get(model.id);
  const job = (async () => {
    const lib = await ort();
    const weights = await fetchWeights(model, { onProgress });
    return lib.InferenceSession.create(weights, {
      executionProviders: webgpu ? ['webgpu'] : ['wasm'],
      graphOptimizationLevel: 'all',
    });
  })();
  sessions.set(model.id, job);
  try {
    return await job;
  } catch (error) {
    // A failed load shouldn't poison the next attempt.
    sessions.delete(model.id);
    throw error;
  }
}

/** One forward pass. `data` is the packed input, `dims` its shape. */
export async function runModel(session, inputName, data, dims) {
  const lib = await ort();
  const output = await session.run({
    [inputName]: new lib.Tensor('float32', data, dims),
  });
  return output[session.outputNames[0]].data;
}

export const releaseSessions = () => sessions.clear();
