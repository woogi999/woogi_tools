import {
  loadFFmpeg,
  loadMagick,
  loadPandoc,
  loadSevenZip,
  loadPdfJs,
  loadJsPdf,
} from './engines';
import { FORMATS } from './formats';
import { pdfToHtml } from './pdf-html';

// A handler converts between the formats in each of its [from, to] pairs.
// convert() gets a Blob and returns a Blob, or { blob, ext } when the result
// isn't the requested format (e.g. a multi-page PDF becoming a ZIP of pages).

const blobOf = (data, ext) =>
  new Blob([data], {
    type: FORMATS.get(ext)?.mime ?? 'application/octet-stream',
  });
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

// ─── Canvas (fast path for everyday images) ─────────────────────────────

function loadImageElement(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The browser couldn't decode this image"));
    };
    img.src = url;
  });
}

async function drawToCanvas(
  blob,
  { maxSize = Infinity, background = null } = {},
) {
  const { img, url } = await loadImageElement(blob);
  try {
    // SVGs without an explicit size report 0×0, so give them a sensible default.
    let width = img.naturalWidth || 1024;
    let height = img.naturalHeight || 1024;
    const scale = Math.min(1, maxSize / Math.max(width, height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Canvas can't encode BMP, so this writes an uncompressed 24-bit one by hand.
function encodeBmp(canvas) {
  const { width, height } = canvas;
  const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + rowSize * height;
  const view = new DataView(new ArrayBuffer(size));
  view.setUint16(0, 0x424d);
  view.setUint32(2, size, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, rowSize * height, true);
  for (let y = 0; y < height; y++) {
    let offset = 54 + y * rowSize;
    const src = (height - 1 - y) * width;
    for (let x = 0; x < width; x++) {
      const i = (src + x) * 4;
      view.setUint8(offset++, data[i + 2]);
      view.setUint8(offset++, data[i + 1]);
      view.setUint8(offset++, data[i]);
    }
  }
  return new Blob([view.buffer], { type: 'image/bmp' });
}

const canvasHandler = {
  id: 'canvas',
  // GIF/APNG are left to ImageMagick, which keeps their animation.
  pairs: [
    [
      ['png', 'jpg', 'webp', 'bmp', 'avif', 'svg', 'ico'],
      ['png', 'jpg', 'webp', 'bmp'],
    ],
  ],
  async convert(blob, from, to) {
    const opaque = to === 'jpg' || to === 'bmp';
    const canvas = await drawToCanvas(blob, {
      background: opaque ? '#fff' : null,
    });
    if (to === 'bmp') return encodeBmp(canvas);
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Encoding failed'))),
        FORMATS.get(to).mime,
        0.92,
      ),
    );
  },
};

// ─── Raster → SVG tracing ───────────────────────────────────────────────

const traceHandler = {
  id: 'trace',
  pairs: [[['png', 'jpg', 'webp', 'bmp'], ['svg']]],
  async convert(blob) {
    const { default: ImageTracer } = await import('imagetracerjs');
    // Tracing cost grows with pixel count, so large photos are scaled down first.
    const canvas = await drawToCanvas(blob, { maxSize: 1024 });
    const imageData = canvas
      .getContext('2d')
      .getImageData(0, 0, canvas.width, canvas.height);
    const svg = ImageTracer.imagedataToSVG(imageData, {
      numberofcolors: 24,
      scale: 1,
      ltres: 1,
      qtres: 1,
      pathomit: 4,
    });
    return new Blob([svg], { type: 'image/svg+xml' });
  },
};

// ─── ImageMagick (hundreds of image formats) ────────────────────────────

const MAGICK_READ = [
  'png',
  'jpg',
  'webp',
  'gif',
  'bmp',
  'tiff',
  'avif',
  'heic',
  'heif',
  'jxl',
  'jp2',
  'ico',
  'cur',
  'apng',
  'psd',
  'psb',
  'xcf',
  'aseprite',
  'tga',
  'dds',
  'exr',
  'hdr',
  'qoi',
  'pcx',
  'ppm',
  'pgm',
  'pbm',
  'pnm',
  'pam',
  'sgi',
  'sun',
  'wbmp',
  'xbm',
  'xpm',
  'jng',
  'mng',
  'dcx',
  'pict',
  'fits',
  'farbfeld',
  'miff',
  'svg',
];
const RAW_READ = [
  'dng',
  'cr2',
  'cr3',
  'crw',
  'nef',
  'nrw',
  'arw',
  'sr2',
  'srf',
  'orf',
  'rw2',
  'raf',
  'pef',
  'erf',
  '3fr',
  'kdc',
  'mrw',
  'x3f',
];
const MAGICK_WRITE = [
  'png',
  'jpg',
  'webp',
  'gif',
  'bmp',
  'tiff',
  'avif',
  'jxl',
  'jp2',
  'ico',
  'cur',
  'apng',
  'psd',
  'tga',
  'dds',
  'exr',
  'hdr',
  'qoi',
  'pcx',
  'ppm',
  'pgm',
  'pbm',
  'pam',
  'sgi',
  'wbmp',
  'xbm',
  'xpm',
  'fits',
  'farbfeld',
  'miff',
  'pdf',
];
const MAGICK_NAMES = { jpg: 'JPEG', aseprite: 'ASEPRITE' };
// Formats that can hold several frames/pages; everything else gets the first frame.
const MULTI_FRAME = new Set([
  'gif',
  'apng',
  'webp',
  'tiff',
  'pdf',
  'ico',
  'mng',
  'miff',
]);
// Formats ImageMagick would otherwise write as an unreadable 256×256+ icon.
const ICON_MAX = 256;

const magickHandler = {
  id: 'magick',
  engine: 'magick',
  pairs: [[[...MAGICK_READ, ...RAW_READ], MAGICK_WRITE]],
  async convert(blob, from, to) {
    const { ImageMagick, MagickReadSettings } = await loadMagick();
    const bytes = await bytesOf(blob);
    const settings = new MagickReadSettings();
    settings.format = MAGICK_NAMES[from] ?? from.toUpperCase();
    const format = MAGICK_NAMES[to] ?? to.toUpperCase();
    const data = ImageMagick.readCollection(bytes, settings, (images) => {
      if (!images.length) throw new Error('No image found in this file');
      if (to === 'ico' || to === 'cur') {
        const image = images[0];
        if (image.width > ICON_MAX || image.height > ICON_MAX)
          image.resize(ICON_MAX, ICON_MAX);
        return image.write(format, (out) => out.slice());
      }
      if (MULTI_FRAME.has(from) && MULTI_FRAME.has(to)) {
        images.coalesce();
        return images.write(format, (out) => out.slice());
      }
      return images[0].write(format, (out) => out.slice());
    });
    return blobOf(data, to);
  },
};

// ─── FFmpeg (audio and video) ───────────────────────────────────────────

const AUDIO_READ = [
  'mp3',
  'wav',
  'ogg',
  'opus',
  'flac',
  'm4a',
  'aac',
  'wma',
  'aiff',
  'ac3',
  'mka',
  'au',
  'caf',
  'mp2',
  'wv',
  'ape',
  'weba',
];
const VIDEO_READ = [
  'mp4',
  'webm',
  'mkv',
  'mov',
  'avi',
  'flv',
  'wmv',
  'mpeg',
  'm4v',
  'ogv',
  'ts',
  '3gp',
  '3g2',
  'mts',
  'm2ts',
  'vob',
  'f4v',
  'asf',
];

const EVEN_SIZE = ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'];
const H264 = [
  ...EVEN_SIZE,
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '23',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-b:a',
  '160k',
];

const VIDEO_ARGS = {
  mp4: [...H264, '-movflags', '+faststart'],
  m4v: H264,
  mov: H264,
  mkv: H264,
  ts: H264,
  flv: H264,
  webm: [
    '-c:v',
    'libvpx',
    '-b:v',
    '2M',
    '-deadline',
    'realtime',
    '-cpu-used',
    '8',
    '-c:a',
    'libvorbis',
  ],
  ogv: ['-c:v', 'libtheora', '-q:v', '7', '-c:a', 'libvorbis'],
  avi: ['-c:v', 'mpeg4', '-q:v', '4', '-c:a', 'libmp3lame'],
  wmv: ['-c:v', 'wmv2', '-b:v', '2M', '-c:a', 'wmav2'],
  mpeg: ['-c:v', 'mpeg2video', '-q:v', '4', '-c:a', 'mp2'],
  gif: [
    '-vf',
    "fps=12,scale='min(480,iw)':-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse",
    '-an',
  ],
};

const AUDIO_ARGS = {
  mp3: ['-c:a', 'libmp3lame', '-q:a', '2'],
  wav: ['-c:a', 'pcm_s16le'],
  ogg: ['-c:a', 'libvorbis', '-q:a', '5'],
  opus: ['-c:a', 'libopus', '-b:a', '128k'],
  flac: ['-c:a', 'flac'],
  m4a: ['-c:a', 'aac', '-b:a', '192k'],
  aac: ['-c:a', 'aac', '-b:a', '192k'],
  wma: ['-c:a', 'wmav2', '-b:a', '192k'],
  aiff: ['-c:a', 'pcm_s16be'],
  ac3: ['-c:a', 'ac3', '-b:a', '192k'],
  mka: ['-c:a', 'libopus', '-b:a', '128k'],
  au: ['-c:a', 'pcm_s16be'],
  mp2: ['-c:a', 'mp2', '-b:a', '192k'],
};

let ffmpegJob = Promise.resolve();

const ffmpegHandler = {
  id: 'ffmpeg',
  engine: 'ffmpeg',
  pairs: [
    [[...AUDIO_READ, ...VIDEO_READ], Object.keys(AUDIO_ARGS)],
    [[...VIDEO_READ, 'gif', 'apng'], Object.keys(VIDEO_ARGS)],
  ],
  convert(blob, from, to, ctx) {
    // One shared FFmpeg instance can only run a single job at a time.
    const job = ffmpegJob.then(() => runFFmpeg(blob, from, to, ctx));
    ffmpegJob = job.catch(() => {});
    return job;
  },
};

async function runFFmpeg(blob, from, to, ctx) {
  const ffmpeg = await loadFFmpeg();
  const stamp = Date.now();
  const input = `in-${stamp}.${from.replaceAll('.', '_')}`;
  const output = `out-${stamp}.${to}`;
  const logs = [];
  const onLog = ({ message }) => {
    logs.push(message);
    if (logs.length > 40) logs.shift();
  };
  const onProgress = ({ progress }) =>
    ctx.progress(Math.max(0, Math.min(1, progress)));
  ffmpeg.on('log', onLog);
  ffmpeg.on('progress', onProgress);
  try {
    await ffmpeg.writeFile(input, await bytesOf(blob));
    const args = AUDIO_ARGS[to] ? ['-vn', ...AUDIO_ARGS[to]] : VIDEO_ARGS[to];
    const code = await ffmpeg.exec(['-i', input, ...args, '-y', output]);
    if (code !== 0) {
      const reason = logs
        .reverse()
        .find((line) => /error|invalid|not found|does not contain/i.test(line));
      throw new Error(
        reason
          ? `FFmpeg: ${reason.trim()}`
          : 'FFmpeg could not convert this file',
      );
    }
    return blobOf(await ffmpeg.readFile(output), to);
  } finally {
    ffmpeg.off('log', onLog);
    ffmpeg.off('progress', onProgress);
    await ffmpeg.deleteFile(input).catch(() => {});
    await ffmpeg.deleteFile(output).catch(() => {});
  }
}

// ─── Pandoc (documents) ─────────────────────────────────────────────────

const PANDOC_READ = {
  md: 'markdown',
  txt: 'markdown',
  html: 'html',
  docx: 'docx',
  odt: 'odt',
  rtf: 'rtf',
  epub: 'epub',
  tex: 'latex',
  typ: 'typst',
  rst: 'rst',
  org: 'org',
  textile: 'textile',
  wiki: 'mediawiki',
  dj: 'djot',
  ipynb: 'ipynb',
  dbk: 'docbook',
  opml: 'opml',
  fb2: 'fb2',
  csv: 'csv',
  tsv: 'tsv',
  xlsx: 'xlsx',
  pptx: 'pptx',
  bib: 'bibtex',
  ris: 'ris',
  adoc: 'asciidoc',
};
const PANDOC_WRITE = {
  md: 'gfm',
  txt: 'plain',
  html: 'html',
  docx: 'docx',
  odt: 'odt',
  rtf: 'rtf',
  epub: 'epub',
  tex: 'latex',
  typ: 'typst',
  rst: 'rst',
  org: 'org',
  textile: 'textile',
  wiki: 'mediawiki',
  dj: 'djot',
  ipynb: 'ipynb',
  dbk: 'docbook5',
  opml: 'opml',
  fb2: 'fb2',
  pptx: 'pptx',
  adoc: 'asciidoc',
  texi: 'texinfo',
  icml: 'icml',
};
const BINARY_DOCS = new Set(['docx', 'odt', 'epub', 'xlsx', 'pptx']);
const STANDALONE = new Set([
  'html',
  'rtf',
  'tex',
  'typ',
  'dbk',
  'icml',
  'texi',
  'opml',
  'fb2',
]);

const pandocHandler = {
  id: 'pandoc',
  engine: 'pandoc',
  pairs: [[Object.keys(PANDOC_READ), Object.keys(PANDOC_WRITE)]],
  async convert(blob, from, to) {
    const pandoc = await loadPandoc();
    const inputName = `input.${from}`;
    const outputName = `output.${to}`;
    const files = {
      [inputName]: BINARY_DOCS.has(from) ? blob : await blob.text(),
    };
    const options = {
      from: PANDOC_READ[from],
      to: PANDOC_WRITE[to],
      'input-files': [inputName],
      'output-file': outputName,
      standalone: STANDALONE.has(to),
    };
    const result = await pandoc.convert(options, null, files);
    const out = result.files?.[outputName];
    if (out === undefined)
      throw new Error(
        result.stderr?.trim() || 'Pandoc could not convert this document',
      );
    return typeof out === 'string'
      ? blobOf(out, to)
      : new Blob([out], { type: FORMATS.get(to).mime });
  },
};

// ─── PDF.js (PDF → images / text / HTML) ────────────────────────────────
// HTML comes first so a Word file (or anything else Pandoc writes) is built
// from the PDF's structure, not from a flat text dump.

const pdfHandler = {
  id: 'pdf',
  engine: 'pdf',
  pairs: [[['pdf'], ['html', 'png', 'jpg', 'txt']]],
  async convert(blob, from, to, ctx) {
    const pdfjs = await loadPdfJs();
    const task = pdfjs.getDocument({ data: await bytesOf(blob) });
    const pdf = await task.promise;
    try {
      if (to === 'html')
        return blobOf(await pdfToHtml(pdf, { progress: ctx.progress }), 'html');
      if (to === 'txt') {
        const pages = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          const { items } = await (await pdf.getPage(n)).getTextContent();
          pages.push(
            items.map((item) => item.str + (item.hasEOL ? '\n' : '')).join(''),
          );
          ctx.progress(n / pdf.numPages);
        }
        return blobOf(pages.join('\n\n'), 'txt');
      }
      const images = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, canvas, viewport }).promise;
        images.push(
          await new Promise((resolve) =>
            canvas.toBlob(resolve, FORMATS.get(to).mime, 0.92),
          ),
        );
        ctx.progress(n / pdf.numPages);
      }
      if (images.length === 1) return images[0];
      const { zipSync } = await import('fflate');
      const entries = {};
      for (const [i, image] of images.entries())
        entries[
          `${ctx.baseName}-page-${String(i + 1).padStart(3, '0')}.${to}`
        ] = await bytesOf(image);
      return {
        blob: new Blob([zipSync(entries, { level: 0 })], {
          type: 'application/zip',
        }),
        ext: 'zip',
      };
    } finally {
      task.destroy();
    }
  },
};

// ─── Plain text → PDF ───────────────────────────────────────────────────

const textPdfHandler = {
  id: 'text-pdf',
  pairs: [[['txt'], ['pdf']]],
  async convert(blob) {
    const JsPdf = await loadJsPdf();
    const doc = new JsPdf({ unit: 'pt', format: 'a4' });
    const margin = 56;
    const lineHeight = 15;
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.setFont('helvetica').setFontSize(11);
    const lines = doc.splitTextToSize(
      (await blob.text()).replaceAll('\t', '    '),
      doc.internal.pageSize.getWidth() - margin * 2,
    );
    let y = margin;
    for (const line of lines) {
      if (y > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += lineHeight;
    }
    return doc.output('blob');
  },
};

// ─── Structured data ────────────────────────────────────────────────────

const DATA = ['json', 'yaml', 'toml', 'csv', 'tsv'];

async function parseData(text, from) {
  if (from === 'json') return JSON.parse(text);
  if (from === 'yaml') return (await import('yaml')).parse(text);
  if (from === 'toml') return (await import('smol-toml')).parse(text);
  const { default: Papa } = await import('papaparse');
  const { data, errors } = Papa.parse(text.trim(), {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
    delimiter: from === 'tsv' ? '\t' : '',
  });
  if (!data.length && errors.length) throw new Error(errors[0].message);
  return data;
}

function toRows(value) {
  const rows = Array.isArray(value)
    ? value
    : (Object.values(value ?? {}).find(Array.isArray) ?? [value]);
  // Nested objects don't fit in a cell, so they're written as JSON text.
  return rows.map((row) =>
    row && typeof row === 'object'
      ? Object.fromEntries(
          Object.entries(row).map(([k, v]) => [
            k,
            v && typeof v === 'object' ? JSON.stringify(v) : v,
          ]),
        )
      : { value: row },
  );
}

async function stringifyData(value, to) {
  if (to === 'json') return JSON.stringify(value, null, 2);
  if (to === 'yaml') return (await import('yaml')).stringify(value);
  if (to === 'toml') {
    // TOML documents must be tables, so a top-level list gets a key.
    const table =
      value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : { items: value };
    return (await import('smol-toml')).stringify(table);
  }
  const { default: Papa } = await import('papaparse');
  return Papa.unparse(toRows(value), { delimiter: to === 'tsv' ? '\t' : ',' });
}

const dataHandler = {
  id: 'data',
  pairs: [[DATA, DATA]],
  async convert(blob, from, to) {
    let value;
    try {
      value = await parseData(await blob.text(), from);
    } catch (error) {
      throw new Error(
        `Couldn't read this ${from.toUpperCase()} file: ${error.message}`,
      );
    }
    return blobOf(await stringifyData(value, to), to);
  },
};

// ─── 7-Zip (archives) ───────────────────────────────────────────────────

const ARCHIVE_READ = [
  'zip',
  '7z',
  'tar',
  'tar.gz',
  'tar.bz2',
  'tar.xz',
  'gz',
  'bz2',
  'xz',
  'rar',
  'iso',
  'cab',
  'lzma',
  'wim',
  'zst',
];
const ARCHIVE_WRITE = ['zip', '7z', 'tar', 'tar.gz', 'tar.bz2', 'tar.xz'];
const COMPRESSOR = { 'tar.gz': 'gzip', 'tar.bz2': 'bzip2', 'tar.xz': 'xz' };

const archiveHandler = {
  id: 'archive',
  engine: 'sevenZip',
  pairs: [[ARCHIVE_READ, ARCHIVE_WRITE]],
  async convert(blob, from, to) {
    const create = await loadSevenZip();
    const z = await create();
    const run = (args) => {
      try {
        z.callMain(args);
      } catch (error) {
        // Emscripten reports a normal exit by throwing; only a non-zero status is a failure.
        if (error?.status)
          throw new Error('7-Zip could not process this archive');
      }
    };
    const source = `/source.${from}`;
    z.FS.writeFile(source, await bytesOf(blob));
    z.FS.mkdir('/files');
    run(['x', source, '-o/files', '-y']);

    // .tar.gz and friends unpack in two layers: first the .tar, then its contents.
    const top = z.FS.readdir('/files').filter((n) => n !== '.' && n !== '..');
    if (
      from.startsWith('tar.') &&
      top.length === 1 &&
      top[0].endsWith('.tar')
    ) {
      z.FS.mkdir('/inner');
      run(['x', `/files/${top[0]}`, '-o/inner', '-y']);
      z.FS.chdir('/inner');
    } else {
      z.FS.chdir('/files');
    }

    const output = `/result.${to}`;
    if (COMPRESSOR[to]) {
      run(['a', '-ttar', '/result.tar', '*']);
      run(['a', `-t${COMPRESSOR[to]}`, output, '/result.tar']);
    } else {
      run(['a', `-t${to}`, output, '*']);
    }
    return blobOf(z.FS.readFile(output), to);
  },
};

// ─── Fonts ──────────────────────────────────────────────────────────────

const WOFF_SIGNATURE = 0x774f4646;
const OTTO = 0x4f54544f;
const pad4 = (n) => (n + 3) & ~3;

function sfntFlavorMatches(flavor, to) {
  const isCff = flavor === OTTO;
  if (to === 'otf' && !isCff)
    throw new Error(
      'This font has TrueType outlines; convert it to TTF instead',
    );
  if (to === 'ttf' && isCff)
    throw new Error(
      'This font has CFF (OpenType) outlines; convert it to OTF instead',
    );
}

async function sfntToWoff(bytes) {
  const { zlibSync } = await import('fflate');
  const sfnt = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numTables = sfnt.getUint16(4);
  const tables = [];
  let totalSfntSize = 12 + 16 * numTables;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const offset = sfnt.getUint32(rec + 8);
    const length = sfnt.getUint32(rec + 12);
    const original = bytes.subarray(offset, offset + length);
    const compressed = zlibSync(original, { level: 9 });
    tables.push({
      tag: sfnt.getUint32(rec),
      checksum: sfnt.getUint32(rec + 4),
      length,
      data: compressed.length < length ? compressed : original,
    });
    totalSfntSize += pad4(length);
  }
  const headerSize = 44 + 20 * numTables;
  const size =
    headerSize + tables.reduce((sum, t) => sum + pad4(t.data.length), 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, WOFF_SIGNATURE);
  view.setUint32(4, sfnt.getUint32(0));
  view.setUint32(8, size);
  view.setUint16(12, numTables);
  view.setUint32(16, totalSfntSize);
  view.setUint16(20, 1);
  let offset = headerSize;
  tables.forEach((t, i) => {
    const rec = 44 + i * 20;
    view.setUint32(rec, t.tag);
    view.setUint32(rec + 4, offset);
    view.setUint32(rec + 8, t.data.length);
    view.setUint32(rec + 12, t.length);
    view.setUint32(rec + 16, t.checksum);
    out.set(t.data, offset);
    offset += pad4(t.data.length);
  });
  return out;
}

async function woffToSfnt(bytes, to) {
  const { unzlibSync } = await import('fflate');
  const woff = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (woff.getUint32(0) !== WOFF_SIGNATURE)
    throw new Error("This isn't a valid WOFF font");
  const flavor = woff.getUint32(4);
  sfntFlavorMatches(flavor, to);
  const numTables = woff.getUint16(12);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const rec = 44 + i * 20;
    const offset = woff.getUint32(rec + 4);
    const compLength = woff.getUint32(rec + 8);
    const origLength = woff.getUint32(rec + 12);
    const raw = bytes.subarray(offset, offset + compLength);
    tables.push({
      tag: woff.getUint32(rec),
      checksum: woff.getUint32(rec + 16),
      data: compLength < origLength ? unzlibSync(raw) : raw,
    });
  }
  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = 2 ** entrySelector * 16;
  const headerSize = 12 + 16 * numTables;
  const out = new Uint8Array(
    headerSize + tables.reduce((sum, t) => sum + pad4(t.data.length), 0),
  );
  const view = new DataView(out.buffer);
  view.setUint32(0, flavor);
  view.setUint16(4, numTables);
  view.setUint16(6, searchRange);
  view.setUint16(8, entrySelector);
  view.setUint16(10, numTables * 16 - searchRange);
  let offset = headerSize;
  tables.forEach((t, i) => {
    const rec = 12 + i * 16;
    view.setUint32(rec, t.tag);
    view.setUint32(rec + 4, t.checksum);
    view.setUint32(rec + 8, offset);
    view.setUint32(rec + 12, t.data.length);
    out.set(t.data, offset);
    offset += pad4(t.data.length);
  });
  return out;
}

const fontHandler = {
  id: 'font',
  pairs: [
    [
      ['ttf', 'otf'],
      ['woff', 'woff2'],
    ],
    [
      ['woff', 'woff2'],
      ['ttf', 'otf'],
    ],
  ],
  async convert(blob, from, to) {
    const bytes = await bytesOf(blob);
    let out;
    if (to === 'woff') out = await sfntToWoff(bytes);
    else if (to === 'woff2')
      out = await (await import('woff2-encoder')).compress(bytes);
    else if (from === 'woff') out = await woffToSfnt(bytes, to);
    else {
      out = await (await import('woff2-encoder/decompress')).default(bytes);
      sfntFlavorMatches(
        new DataView(out.buffer, out.byteOffset).getUint32(0),
        to,
      );
    }
    return blobOf(out, to);
  },
};

// Order matters: when two routes are equally short, the earlier handler wins,
// so cheap in-browser handlers come before the big downloadable engines.
export const HANDLERS = [
  canvasHandler,
  traceHandler,
  fontHandler,
  dataHandler,
  pdfHandler,
  textPdfHandler,
  archiveHandler,
  magickHandler,
  ffmpegHandler,
  pandocHandler,
];
