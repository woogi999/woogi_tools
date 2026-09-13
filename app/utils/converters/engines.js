// Lazy loaders for the heavy conversion engines. Each is fetched the first time
// a conversion actually needs it and then reused for the rest of the visit.

const once = (load) => {
  let promise = null;
  return () => {
    promise ??= load().catch((error) => {
      promise = null; // let a later attempt retry after a network hiccup
      throw error;
    });
    return promise;
  };
};

// Too big to ship with the site itself (and over most static hosts' per-file
// limits), so these two cores come from npm's CDN, pinned to exact versions.
const FFMPEG_CORE = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm';
const PANDOC_WASM = 'https://unpkg.com/pandoc-wasm@1.1.0/src/pandoc.wasm';

export const ENGINE_INFO = {
  ffmpeg: 'the audio/video engine (about 30 MB)',
  magick: 'the image engine (about 15 MB)',
  pandoc: 'the document engine (about 55 MB)',
  sevenZip: 'the archive engine (about 2 MB)',
  pdf: 'the PDF engine',
};

export const loadFFmpeg = once(async () => {
  const [{ FFmpeg }, { toBlobURL }] = await Promise.all([import('@ffmpeg/ffmpeg'), import('@ffmpeg/util')]);
  const ffmpeg = new FFmpeg();
  const [coreURL, wasmURL] = await Promise.all([toBlobURL(`${FFMPEG_CORE}/ffmpeg-core.js`, 'text/javascript'), toBlobURL(`${FFMPEG_CORE}/ffmpeg-core.wasm`, 'application/wasm')]);
  await ffmpeg.load({ coreURL, wasmURL });
  return ffmpeg;
});

export const loadMagick = once(async () => {
  const [magick, { default: wasmUrl }] = await Promise.all([import('@imagemagick/magick-wasm'), import('@imagemagick/magick-wasm/magick.wasm?url')]);
  await magick.initializeImageMagick(new URL(wasmUrl, window.location.href));
  return magick;
});

export const loadPandoc = once(async () => {
  // eslint-disable-next-line warp-drive/no-external-request-patterns -- downloading a WebAssembly binary, not app data
  const [{ createPandocInstance }, wasm] = await Promise.all([import('pandoc-wasm-core'), fetch(PANDOC_WASM).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('Could not download the document engine'))))]);
  return createPandocInstance(wasm);
});

export const loadSevenZip = once(async () => {
  const [{ default: SevenZip }, { default: wasmUrl }] = await Promise.all([import('7z-wasm'), import('7z-wasm/7zz.wasm?url')]);
  // eslint-disable-next-line warp-drive/no-external-request-patterns -- downloading a WebAssembly binary, not app data
  const wasmBinary = await fetch(wasmUrl).then((r) => r.arrayBuffer());
  // A fresh module per job keeps each archive's scratch files isolated.
  return () => SevenZip({ wasmBinary, print: () => {}, printErr: () => {} });
});

export const loadPdfJs = once(async () => {
  const [pdfjs, { default: workerUrl }] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
});

export const loadJsPdf = once(async () => (await import('jspdf')).jsPDF);

export const ENGINE_LOADERS = { ffmpeg: loadFFmpeg, magick: loadMagick, pandoc: loadPandoc, sevenZip: loadSevenZip, pdf: loadPdfJs };
