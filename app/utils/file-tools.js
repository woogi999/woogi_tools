// Which tools can do something with a given file. The home page uses this
// when a file is dropped on the search bar: instead of typing "png", you show
// it the file and get the tools that take one, best fit first.

import { detectFormat } from './converters/formats';
import { canOpen } from './archive';

const SUBTITLES = ['srt', 'vtt', 'ass', 'ssa'];
const TEXT = ['txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'html', 'htm'];
const DATA = ['json', 'yaml', 'yml', 'toml', 'xml', 'csv', 'tsv'];

const KINDS = {
  image: {
    label: 'an image',
    routes: [
      'image-editor',
      'image-resizer',
      'image-cropper',
      'background-remover',
      'image-censor',
      'watermarker',
      'image-slicer',
      'image-stitcher',
      'file-converter',
      'file-compressor',
      'metadata-editor',
      'favicon-generator',
      'pixel-eyedropper',
      'ascii-art',
      'mockup-preview',
      'qr-code',
      'file-share',
      'hash-generator',
    ],
  },
  raw: {
    label: 'a camera RAW photo',
    routes: [
      'file-converter',
      'metadata-editor',
      'file-share',
      'hash-generator',
    ],
  },
  video: {
    label: 'a video',
    routes: [
      'trimmer',
      'video-player',
      'video-censor',
      'video-muter',
      'audio-extractor',
      'auto-subtitle',
      'subtitle-baker',
      'audio-normalizer',
      'file-converter',
      'file-compressor',
      'metadata-editor',
      'file-share',
      'hash-generator',
    ],
  },
  audio: {
    label: 'an audio file',
    routes: [
      'audio-normalizer',
      'trimmer',
      'auto-subtitle',
      'audio-extractor',
      'video-player',
      'file-converter',
      'file-compressor',
      'metadata-editor',
      'file-share',
      'hash-generator',
    ],
  },
  pdf: {
    label: 'a PDF',
    routes: [
      'pdf-tools',
      'document-redacter',
      'file-converter',
      'file-compressor',
      'file-share',
      'hash-generator',
    ],
  },
  document: {
    label: 'a document',
    routes: [
      'file-converter',
      'document-redacter',
      'file-compressor',
      'file-share',
      'hash-generator',
    ],
  },
  subtitle: {
    label: 'a subtitle file',
    routes: ['subtitle-baker', 'video-player', 'file-converter', 'file-share'],
  },
  archive: {
    label: 'an archive',
    routes: [
      'archive-opener',
      'file-converter',
      'file-share',
      'hash-generator',
    ],
  },
  font: {
    label: 'a font',
    routes: ['quick-notes', 'subtitle-baker', 'file-converter', 'file-share'],
  },
  json: {
    label: 'a JSON file',
    routes: [
      'json-formatter',
      'data-codec',
      'text-diff',
      'file-converter',
      'file-share',
      'hash-generator',
    ],
  },
  data: {
    label: 'a data file',
    routes: [
      'data-codec',
      'json-formatter',
      'file-converter',
      'text-diff',
      'file-share',
      'hash-generator',
    ],
  },
  text: {
    label: 'a text file',
    routes: [
      'word-counter',
      'text-case',
      'text-diff',
      'line-tools',
      'grammar-checker',
      'paraphraser',
      'translator',
      'qr-code',
      'file-converter',
      'file-share',
      'hash-generator',
    ],
  },
  other: {
    label: 'a file',
    routes: [
      'file-converter',
      'file-compressor',
      'archive-opener',
      'file-share',
      'hash-generator',
    ],
  },
};

const extOf = (name) =>
  (name.includes('.') ? name.split('.').pop() : '').toLowerCase();

// Works out what sort of file this is from its type and name.
export function fileKind(file) {
  const ext = extOf(file.name ?? '');
  const mime = file.type ?? '';
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (SUBTITLES.includes(ext)) return 'subtitle';
  if (ext === 'json' || mime === 'application/json') return 'json';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  // Plain text and data files are checked before the converter's categories,
  // which file them all under "document".
  if (DATA.includes(ext)) return 'data';
  if (TEXT.includes(ext)) return 'text';
  const format = detectFormat(file.name ?? '');
  if (format && format.category in KINDS) return format.category;
  if (canOpen(file.name ?? '')) return 'archive';
  if (mime.startsWith('text/')) return 'text';
  return 'other';
}

// { kind, label, routes } for a File, best tool first.
export function toolsForFile(file) {
  const kind = fileKind(file);
  return { kind, ...KINDS[kind] };
}
