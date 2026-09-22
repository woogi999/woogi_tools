// Every format the converter knows about, keyed by the extension used for the
// output file. `aliases` map other extensions people use onto the same format.

const CATEGORY_LABELS = {
  image: 'Images',
  raw: 'Camera RAW',
  audio: 'Audio',
  video: 'Video',
  document: 'Documents',
  data: 'Data',
  archive: 'Archives',
  font: 'Fonts',
};

const list = (category, entries) =>
  entries.map(([ext, label, mime]) => ({
    ext,
    label,
    category,
    mime: mime ?? 'application/octet-stream',
  }));

const ALL = [
  ...list('image', [
    ['png', 'PNG', 'image/png'],
    ['jpg', 'JPEG', 'image/jpeg'],
    ['webp', 'WEBP', 'image/webp'],
    ['gif', 'GIF', 'image/gif'],
    ['avif', 'AVIF', 'image/avif'],
    ['heic', 'HEIC', 'image/heic'],
    ['heif', 'HEIF', 'image/heif'],
    ['jxl', 'JPEG XL', 'image/jxl'],
    ['bmp', 'BMP', 'image/bmp'],
    ['tiff', 'TIFF', 'image/tiff'],
    ['svg', 'SVG', 'image/svg+xml'],
    ['ico', 'ICO (icon)', 'image/x-icon'],
    ['cur', 'CUR (cursor)'],
    ['apng', 'APNG', 'image/apng'],
    ['jp2', 'JPEG 2000', 'image/jp2'],
    ['psd', 'Photoshop PSD', 'image/vnd.adobe.photoshop'],
    ['psb', 'Photoshop PSB'],
    ['xcf', 'GIMP XCF'],
    ['aseprite', 'Aseprite'],
    ['tga', 'TGA'],
    ['dds', 'DDS'],
    ['exr', 'OpenEXR'],
    ['hdr', 'Radiance HDR'],
    ['qoi', 'QOI'],
    ['pcx', 'PCX'],
    ['ppm', 'PPM'],
    ['pgm', 'PGM'],
    ['pbm', 'PBM'],
    ['pnm', 'PNM'],
    ['pam', 'PAM'],
    ['sgi', 'SGI'],
    ['sun', 'Sun Raster'],
    ['wbmp', 'WBMP'],
    ['xbm', 'XBM'],
    ['xpm', 'XPM'],
    ['jng', 'JNG'],
    ['mng', 'MNG'],
    ['dcx', 'DCX'],
    ['pict', 'PICT'],
    ['fits', 'FITS'],
    ['farbfeld', 'farbfeld'],
    ['miff', 'MIFF'],
  ]),
  ...list('raw', [
    ['dng', 'Adobe DNG'],
    ['cr2', 'Canon CR2'],
    ['cr3', 'Canon CR3'],
    ['crw', 'Canon CRW'],
    ['nef', 'Nikon NEF'],
    ['nrw', 'Nikon NRW'],
    ['arw', 'Sony ARW'],
    ['sr2', 'Sony SR2'],
    ['srf', 'Sony SRF'],
    ['orf', 'Olympus ORF'],
    ['rw2', 'Panasonic RW2'],
    ['raf', 'Fujifilm RAF'],
    ['pef', 'Pentax PEF'],
    ['erf', 'Epson ERF'],
    ['3fr', 'Hasselblad 3FR'],
    ['kdc', 'Kodak KDC'],
    ['mrw', 'Minolta MRW'],
    ['x3f', 'Sigma X3F'],
  ]),
  ...list('audio', [
    ['mp3', 'MP3', 'audio/mpeg'],
    ['wav', 'WAV', 'audio/wav'],
    ['ogg', 'OGG Vorbis', 'audio/ogg'],
    ['opus', 'Opus', 'audio/opus'],
    ['flac', 'FLAC', 'audio/flac'],
    ['m4a', 'M4A (AAC)', 'audio/mp4'],
    ['aac', 'AAC', 'audio/aac'],
    ['wma', 'WMA', 'audio/x-ms-wma'],
    ['aiff', 'AIFF', 'audio/aiff'],
    ['ac3', 'AC3', 'audio/ac3'],
    ['mka', 'Matroska Audio', 'audio/x-matroska'],
    ['au', 'AU', 'audio/basic'],
    ['caf', 'CAF'],
    ['mp2', 'MP2', 'audio/mpeg'],
    ['wv', 'WavPack'],
    ['ape', "Monkey's Audio"],
    ['weba', 'WEBA', 'audio/webm'],
  ]),
  ...list('video', [
    ['mp4', 'MP4', 'video/mp4'],
    ['webm', 'WEBM', 'video/webm'],
    ['mkv', 'MKV', 'video/x-matroska'],
    ['mov', 'MOV', 'video/quicktime'],
    ['avi', 'AVI', 'video/x-msvideo'],
    ['flv', 'FLV', 'video/x-flv'],
    ['wmv', 'WMV', 'video/x-ms-wmv'],
    ['mpeg', 'MPEG', 'video/mpeg'],
    ['m4v', 'M4V', 'video/x-m4v'],
    ['ogv', 'OGV', 'video/ogg'],
    ['ts', 'MPEG-TS', 'video/mp2t'],
    ['3gp', '3GP', 'video/3gpp'],
    ['3g2', '3G2', 'video/3gpp2'],
    ['mts', 'AVCHD MTS'],
    ['m2ts', 'M2TS'],
    ['vob', 'DVD VOB'],
    ['f4v', 'F4V'],
    ['asf', 'ASF'],
  ]),
  ...list('document', [
    ['pdf', 'PDF', 'application/pdf'],
    [
      'docx',
      'Word DOCX',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    ['odt', 'OpenDocument Text', 'application/vnd.oasis.opendocument.text'],
    ['rtf', 'Rich Text', 'application/rtf'],
    [
      'pptx',
      'PowerPoint PPTX',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
    [
      'xlsx',
      'Excel XLSX',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    ['epub', 'EPUB e-book', 'application/epub+zip'],
    ['fb2', 'FictionBook'],
    ['html', 'HTML', 'text/html'],
    ['md', 'Markdown', 'text/markdown'],
    ['txt', 'Plain text', 'text/plain'],
    ['tex', 'LaTeX', 'application/x-tex'],
    ['typ', 'Typst'],
    ['rst', 'reStructuredText', 'text/x-rst'],
    ['adoc', 'AsciiDoc'],
    ['org', 'Org mode'],
    ['textile', 'Textile'],
    ['wiki', 'MediaWiki'],
    ['dj', 'Djot'],
    ['ipynb', 'Jupyter notebook', 'application/x-ipynb+json'],
    ['dbk', 'DocBook XML', 'application/docbook+xml'],
    ['opml', 'OPML'],
    ['texi', 'Texinfo'],
    ['icml', 'InDesign ICML'],
    ['bib', 'BibTeX'],
    ['ris', 'RIS citations'],
  ]),
  ...list('data', [
    ['json', 'JSON', 'application/json'],
    ['yaml', 'YAML', 'application/yaml'],
    ['toml', 'TOML', 'application/toml'],
    ['csv', 'CSV', 'text/csv'],
    ['tsv', 'TSV', 'text/tab-separated-values'],
  ]),
  ...list('archive', [
    ['zip', 'ZIP', 'application/zip'],
    ['7z', '7-Zip', 'application/x-7z-compressed'],
    ['tar', 'TAR', 'application/x-tar'],
    ['tar.gz', 'TAR.GZ', 'application/gzip'],
    ['tar.bz2', 'TAR.BZ2', 'application/x-bzip2'],
    ['tar.xz', 'TAR.XZ', 'application/x-xz'],
    ['gz', 'GZIP', 'application/gzip'],
    ['bz2', 'BZIP2', 'application/x-bzip2'],
    ['xz', 'XZ', 'application/x-xz'],
    ['rar', 'RAR', 'application/vnd.rar'],
    ['iso', 'ISO image', 'application/x-iso9660-image'],
    ['cab', 'Windows CAB'],
    ['lzma', 'LZMA'],
    ['wim', 'WIM'],
    ['zst', 'Zstandard'],
  ]),
  ...list('font', [
    ['ttf', 'TrueType', 'font/ttf'],
    ['otf', 'OpenType', 'font/otf'],
    ['woff', 'WOFF', 'font/woff'],
    ['woff2', 'WOFF2', 'font/woff2'],
  ]),
];

export const FORMATS = new Map(ALL.map((f) => [f.ext, f]));

const ALIASES = {
  jpeg: 'jpg',
  jpe: 'jpg',
  jfif: 'jpg',
  pjpeg: 'jpg',
  tif: 'tiff',
  htm: 'html',
  xhtml: 'html',
  markdown: 'md',
  mdown: 'md',
  text: 'txt',
  yml: 'yaml',
  latex: 'tex',
  tgz: 'tar.gz',
  tbz: 'tar.bz2',
  tbz2: 'tar.bz2',
  txz: 'tar.xz',
  oga: 'ogg',
  aif: 'aiff',
  mpg: 'mpeg',
  svgz: 'svg',
  asciidoc: 'adoc',
  mediawiki: 'wiki',
};

const MULTI_EXTENSIONS = ['tar.gz', 'tar.bz2', 'tar.xz'];

export function detectFormat(fileName) {
  const name = fileName.toLowerCase();
  const multi = MULTI_EXTENSIONS.find((ext) => name.endsWith(`.${ext}`));
  if (multi) return FORMATS.get(multi);
  const ext = name.includes('.') ? name.split('.').pop() : '';
  return FORMATS.get(ALIASES[ext] ?? ext) ?? null;
}

export function stripExtension(fileName) {
  const lower = fileName.toLowerCase();
  const multi = MULTI_EXTENSIONS.find((ext) => lower.endsWith(`.${ext}`));
  if (multi) return fileName.slice(0, -(multi.length + 1));
  const i = fileName.lastIndexOf('.');
  return i > 0 ? fileName.slice(0, i) : fileName;
}

export function categoryLabel(category) {
  return CATEGORY_LABELS[category] ?? category;
}

export const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

export function formatsIn(category) {
  return ALL.filter((f) => f.category === category);
}
