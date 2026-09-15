// Central list of tools/pages, used by the sidebar, home cards and the
// Ctrl+F palette so all three stay in sync.
export const TOOLS = [
  { label: 'Home', route: 'index', icon: 'house', keywords: ['start', 'dashboard', 'favourites', 'favorites'] },
  { label: 'Settings', route: 'settings', icon: 'settings', keywords: ['preferences', 'options', 'theme', 'dark mode', 'light mode', 'animations', 'motion', 'export', 'backup', 'data', 'reset', 'offline', 'cache'] },
  { label: 'Updates', route: 'updates', icon: 'history', keywords: ['changelog', 'what\'s new', 'release notes', 'version', 'news'] },
  {
    label: 'Colour Picker',
    route: 'color-picker',
    icon: 'paint-bucket',
    category: 'Design',
    description: 'Pick a colour and get HEX, RGB, and HSL instantly.',
    keywords: ['color', 'hex', 'rgb', 'hsl', 'hsv', 'palette', 'eyedropper', 'swatch', 'wheel'],
    madeWith:
      'The colour wheel is drawn on a <canvas> pixel by pixel, and every HEX, RGB, HSL and HSV conversion is hand-written maths in plain JavaScript. The coloured slider tracks are CSS gradients rebuilt as you drag. No colour libraries.',
    credits: [],
  },
  {
    label: "Contrast Checker",
    route: "contrast-checker",
    icon: "contrast",
    category: "Design",
    description: "Check text and background colours against WCAG contrast rules, and get a passing colour.",
    keywords: ["contrast", "wcag", "accessibility", "a11y", "color contrast", "colour contrast", "aa", "aaa", "readability"],
    madeWith:
      "Contrast is the WCAG 2 formula: each colour's relative luminance from linearised sRGB channels, then (lighter + 0.05) / (darker + 0.05). The suggested fix keeps the text colour's hue and saturation and steps its lightness away from the background until it passes, so the result still looks like your colour.",
    credits: [],
  },
  {
    label: 'Pixel Eyedropper',
    route: 'pixel-eyedropper',
    icon: 'pipette',
    category: 'Design',
    description: 'Upload an image and click anywhere on it to sample the exact colour.',
    keywords: ['eyedropper', 'color picker', 'colour picker', 'image color picker', 'pixel color', 'sample color', 'pick color from image'],
    madeWith:
      "The image is drawn onto an offscreen <canvas>; a click reads that single pixel back with getImageData and turns it into HEX, RGB and HSL.",
    credits: [],
  },
  {
    label: 'Background Remover',
    route: 'background-remover',
    icon: 'eraser',
    category: 'Design',
    description: 'Cut the background out of a photo, right in your browser.',
    keywords: ['background remover', 'remove background', 'cutout', 'transparent background', 'bg remover', 'image segmentation'],
    madeWith:
      "A small ISNet segmentation model runs on-device via ONNX Runtime Web to tell subject from background, all inside a WebAssembly sandbox. The model downloads once, from the library's own CDN, and is cached by your browser after that; your photo never leaves your device.",
    credits: [{ name: '@imgly/background-removal', author: 'IMG.LY', license: 'AGPL-3.0 / commercial', url: 'https://github.com/imgly/background-removal-js' }],
  },
  {
    label: 'Data Codec',
    route: 'data-codec',
    icon: 'file-archive',
    category: 'Dev',
    description: 'Compress data with gzip, deflate, brotli or zstd, or encode/decode Base64, URLs, hex and more.',
    keywords: ['compress', 'decompress', 'zip', 'gzip', 'deflate', 'brotli', 'zstd', 'zstandard', 'base64', 'base64url', 'url encode', 'url decode', 'html entities', 'hex', 'binary', 'unicode', 'morse code', 'encode', 'decode', 'shrink'],
    madeWith:
      "gzip and deflate run through fflate in pure JavaScript. Brotli and Zstandard are the reference C/Rust codecs compiled to WebAssembly, loaded only when you pick them. Text encoding uses TextEncoder first so emoji and accented letters survive round trips; URL coding uses the built-in encodeURIComponent, HTML entities are decoded by the browser's parser in a detached element that never runs markup, and Morse uses the international code table. All of it runs without leaving your browser.",
    credits: [
      { name: 'fflate', author: '101arrowz', license: 'MIT', url: 'https://github.com/101arrowz/fflate' },
      { name: 'brotli-wasm', author: 'HTTP Toolkit', license: 'Apache-2.0', url: 'https://github.com/httptoolkit/brotli-wasm' },
      { name: 'zstd-wasm', author: 'bokuweb', license: 'MIT', url: 'https://github.com/bokuweb/zstd-wasm' },
      { name: 'Zstandard', author: 'Meta', license: 'BSD', url: 'https://github.com/facebook/zstd' },
      { name: 'Brotli', author: 'Google', license: 'MIT', url: 'https://github.com/google/brotli' },
    ],
  },
  {
    label: "JSON Formatter",
    route: "json-formatter",
    icon: "braces",
    category: "Dev",
    description: "Validate, pretty-print, minify and sort JSON.",
    keywords: ["json", "format", "pretty print", "beautify", "minify", "validate", "lint", "sort keys", "viewer"],
    madeWith:
      "The browser's own JSON.parse does the validating; when it fails, the character position in its error is turned into a line and column. Formatting is JSON.stringify with your chosen indent, and key sorting rebuilds objects recursively before printing.",
    credits: [],
  },
  {
    label: "Hash Generator",
    route: "hash-generator",
    icon: "fingerprint",
    category: "Dev",
    description: "Hash text or files with MD5, SHA-1, SHA-2 and CRC-32, and verify checksums.",
    keywords: ["hash", "checksum", "md5", "sha1", "sha256", "sha512", "crc32", "digest", "verify", "integrity"],
    madeWith:
      "SHA-1 and the SHA-2 family come from the browser's Web Crypto API. MD5 and CRC-32 aren't part of it, so both are written by hand here (MD5 following RFC 1321, CRC-32 with the usual reflected lookup table).",
    credits: [],
  },
  {
    label: "UUID Generator",
    route: "uuid-generator",
    icon: "hash",
    category: "Dev",
    description: "Generate UUID v4 and v7, ULIDs and Nano IDs in bulk, or decode an existing ID.",
    keywords: ["uuid", "guid", "v4", "v7", "ulid", "nanoid", "nano id", "unique id", "generator", "decode"],
    madeWith:
      "Every ID draws from crypto.getRandomValues. Version 4 uses the browser's own randomUUID; version 7 packs a 48-bit millisecond timestamp in front of random bits so IDs sort by creation time; ULIDs use Crockford base-32; Nano IDs map bytes onto a 64-symbol alphabet so no symbol is favoured.",
    credits: [],
  },
  {
    label: "JWT Decoder",
    route: "jwt-decoder",
    icon: "shield-check",
    category: "Dev",
    description: "Decode JSON Web Tokens, check expiry and verify HMAC signatures.",
    keywords: ["jwt", "json web token", "decode", "bearer", "token", "claims", "exp", "hs256", "verify signature", "oauth"],
    madeWith:
      "The header and payload are Base64URL-decoded and parsed as JSON, with standard time claims shown as dates relative to now. HS256, HS384 and HS512 signatures are checked with the Web Crypto API's HMAC verify, entirely in your browser.",
    credits: [],
  },
  {
    label: "Regex Tester",
    route: "regex-tester",
    icon: "regex",
    category: "Dev",
    description: "Test JavaScript regular expressions with live highlighting, groups and replacement.",
    keywords: ["regex", "regular expression", "regexp", "pattern", "match", "capture group", "replace", "test"],
    madeWith:
      "Matching uses JavaScript's own RegExp engine, but runs inside a short-lived Web Worker. If a pattern backtracks for too long the worker is terminated, so a runaway expression can't freeze the page.",
    credits: [],
  },
  {
    label: "Timestamp Converter",
    route: "timestamp-converter",
    icon: "clock",
    category: "Dev",
    description: "Convert Unix timestamps to dates and back, across time zones, with ready-to-paste Discord timestamp codes.",
    keywords: ["timestamp", "unix time", "epoch", "date", "time zone", "timezone", "iso 8601", "milliseconds", "utc", "convert", "discord", "discord timestamp", "discord time"],
    madeWith:
      "The unit (seconds, milliseconds, micro or nanoseconds) is guessed from how many digits you type, or pick a date and time directly with the picker. Time zones are formatted by the browser's Intl.DateTimeFormat using its built-in time zone database, relative times come from Intl.RelativeTimeFormat, and the Discord codes use its <t:unix:style> timestamp syntax.",
    credits: [],
  },
  {
    label: "Number Base Converter",
    route: "number-base",
    icon: "binary",
    category: "Dev",
    description: "Convert numbers between binary, octal, decimal, hex and any base up to 36.",
    keywords: ["base converter", "binary", "octal", "decimal", "hexadecimal", "hex", "radix", "base 36", "two's complement", "bits"],
    madeWith:
      "Numbers are held as BigInt, so values far beyond 2^53 convert exactly. Parsing and printing in each base are plain repeated multiply-and-divide loops.",
    credits: [],
  },
  {
    label: 'User Agent Parser',
    route: 'user-agent-parser',
    icon: 'monitor-smartphone',
    category: 'Dev',
    description: 'Break down a browser user agent string into browser, engine, OS and device.',
    keywords: ['user agent', 'useragent', 'ua string', 'browser detection', 'os detection', 'device detection', 'navigator.useragent'],
    madeWith:
      "A hand-written set of regular expressions checks the string against the common browsers, rendering engines and operating systems, in the order that avoids the usual false positives (Edge and Opera both contain the word Chrome, for instance).",
    credits: [],
  },
  {
    label: 'Cron Expression Builder',
    route: 'cron-builder',
    icon: 'calendar-clock',
    category: 'Dev',
    description: 'Write and understand cron expressions, with a preview of the next run times.',
    keywords: ['cron', 'crontab', 'cron expression', 'cron job', 'scheduler', 'schedule', 'cron syntax'],
    madeWith:
      "Each of the five fields is validated and turned into a sentence by hand. The upcoming run times come from a simple minute-by-minute scan against the parsed fields rather than a full scheduling library.",
    credits: [],
  },
  {
    label: '.gitignore Generator',
    route: 'gitignore-generator',
    icon: 'file-code',
    category: 'Dev',
    description: 'Pick your stack and combine ready-made .gitignore rules.',
    keywords: ['gitignore', 'git ignore', 'ignore file', 'node modules', 'generator'],
    madeWith:
      "A small hand-picked set of rules for common languages, frameworks and editors, combined with headers so you can see where each block came from.",
    credits: [],
  },
  {
    label: 'Favicon Generator',
    route: 'favicon-generator',
    icon: 'app-window',
    category: 'Dev',
    description: 'Turn a picture into every favicon size a site needs, plus the HTML to link them.',
    keywords: ['favicon', 'favicon generator', 'apple touch icon', 'android chrome icon', 'ico file', 'site icon'],
    madeWith:
      "Every size is drawn onto a <canvas> and re-encoded as PNG by the browser. The multi-size .ico file is packed by hand: modern Windows can embed PNG frames directly in an ICO container, so no BMP conversion is needed.",
    credits: [],
  },
  {
    label: 'File Converter',
    route: 'file-converter',
    icon: 'file-symlink',
    category: 'Files',
    description: 'Convert images, RAW photos, audio, video, documents, data, archives and fonts, right in your browser.',
    keywords: [
      'file converter', 'convert', 'conversion', 'format', 'transcode',
      'photo converter', 'image converter', 'picture converter', 'video converter', 'audio converter', 'music converter', 'sound converter', 'movie converter', 'clip converter', 'document converter', 'pdf converter', 'word converter', 'ebook converter', 'archive converter', 'font converter',
      'heic to jpg', 'png to jpg', 'jpg to png', 'webp to png', 'png to ico', 'image to pdf', 'raw to jpg', 'psd to png', 'svg to png', 'png to svg', 'heic', 'avif', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'ico', 'psd', 'raw', 'svg', 'gif', 'convert image',
      'mp4 to mp3', 'video to gif', 'mov to mp4', 'mkv to mp4', 'wav to mp3', 'flac to mp3', 'mp3', 'wav', 'ogg', 'opus', 'flac', 'm4a', 'aac', 'wma', 'aiff', 'convert audio', 'mp4', 'webm', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'convert video', 'extract audio',
      'docx to pdf', 'pdf to jpg', 'pdf to text', 'word to pdf', 'markdown to html', 'html to docx', 'epub', 'odt', 'rtf', 'latex', 'docx', 'pdf', 'convert document',
      'json to yaml', 'csv to json', 'toml', 'zip', '7z', 'rar', 'tar', 'woff2', 'ttf to woff',
    ],
    madeWith:
      "Every conversion runs on your device; nothing is uploaded. Each engine declares what it can read and write, and a small breadth-first search chains them when no single one covers a pair (DOCX to PDF goes through plain text, for example). Everyday images use the browser's own <canvas> encoders, with a hand-written BMP writer. Everything else is ImageMagick for over a hundred image and camera RAW formats, FFmpeg for audio and video, Pandoc for documents, PDF.js to render or read PDFs, jsPDF to write them, 7-Zip for archives, and imagetracerjs to trace pictures into SVG. The heavy engines are WebAssembly builds fetched only the first time you need them. Structured data goes through yaml, smol-toml and Papa Parse, and WOFF fonts are packed and unpacked by hand with fflate; WOFF2 uses Google's encoder compiled to WebAssembly.",
    credits: [
      { name: 'ImageMagick (magick-wasm)', author: 'ImageMagick Studio', license: 'Apache-2.0', url: 'https://github.com/dlemstra/magick-wasm' },
      { name: 'ffmpeg.wasm', author: 'ffmpegwasm', license: 'MIT (FFmpeg: LGPL/GPL)', url: 'https://github.com/ffmpegwasm/ffmpeg.wasm' },
      { name: 'FFmpeg', author: 'FFmpeg team', license: 'LGPL/GPL', url: 'https://ffmpeg.org' },
      { name: 'Pandoc (pandoc-wasm)', author: 'John MacFarlane & contributors', license: 'GPL-2.0 (wrapper: MIT)', url: 'https://github.com/pandoc/pandoc-wasm' },
      { name: 'PDF.js', author: 'Mozilla', license: 'Apache-2.0', url: 'https://github.com/mozilla/pdf.js' },
      { name: 'jsPDF', author: 'James Hall & contributors', license: 'MIT', url: 'https://github.com/parallax/jsPDF' },
      { name: '7z-wasm', author: 'Alexandru Ciuca (7-Zip by Igor Pavlov)', license: 'LGPL-2.1 + unRAR restriction', url: 'https://github.com/use-strict/7z-wasm' },
      { name: 'imagetracerjs', author: 'András Jankovics', license: 'Unlicense', url: 'https://github.com/jankovicsandras/imagetracerjs' },
      { name: 'woff2-encoder', author: 'itskyedo', license: 'MIT', url: 'https://github.com/itskyedo/woff2-encoder' },
      { name: 'yaml', author: 'Eemeli Aro', license: 'ISC', url: 'https://github.com/eemeli/yaml' },
      { name: 'smol-toml', author: 'squirrelchat', license: 'BSD-3-Clause', url: 'https://github.com/squirrelchat/smol-toml' },
      { name: 'Papa Parse', author: 'Matt Holt', license: 'MIT', url: 'https://github.com/mholt/PapaParse' },
      { name: 'fflate', author: '101arrowz', license: 'MIT', url: 'https://github.com/101arrowz/fflate' },
    ],
  },
  {
    label: "PDF Merge & Split",
    route: "pdf-tools",
    icon: "file-stack",
    category: "Files",
    description: "Merge PDFs, pick pages, or split a PDF into several files.",
    keywords: ["pdf", "merge pdf", "combine pdf", "split pdf", "extract pages", "join pdf", "pdf pages", "reorder"],
    madeWith:
      "pdf-lib reads each document and copies the chosen pages into a new one without re-rendering them, so text stays selectable and quality is untouched. Split results with more than one file are packed into a ZIP with fflate.",
    credits: [
      { name: 'pdf-lib', author: 'Andrew Dillon', license: 'MIT', url: 'https://github.com/Hopding/pdf-lib' },
      { name: 'fflate', author: '101arrowz', license: 'MIT', url: 'https://github.com/101arrowz/fflate' },
    ],
  },
  {
    label: 'File Compressor',
    route: 'file-compressor',
    icon: 'package',
    category: 'Files',
    description: 'Shrink any file with gzip, deflate, brotli or zstd, or unpack one.',
    keywords: ['file compressor', 'compress file', 'zip file', 'gzip file', 'shrink file', 'reduce file size', 'decompress file', 'unzip'],
    madeWith:
      "The same engines behind the Data Codec, but working on raw file bytes instead of text: fflate for gzip and deflate, and the Brotli and Zstandard WebAssembly builds for the rest.",
    credits: [
      { name: 'fflate', author: '101arrowz', license: 'MIT', url: 'https://github.com/101arrowz/fflate' },
      { name: 'brotli-wasm', author: 'HTTP Toolkit', license: 'Apache-2.0', url: 'https://github.com/httptoolkit/brotli-wasm' },
      { name: 'zstd-wasm', author: 'bokuweb', license: 'MIT', url: 'https://github.com/bokuweb/zstd-wasm' },
    ],
  },
  {
    label: "Image Resizer",
    route: "image-resizer",
    icon: "scaling",
    category: "Design",
    description: "Resize and compress images in bulk.",
    keywords: ["resize image", "compress image", "image compressor", "shrink", "reduce file size", "thumbnail", "scale", "jpg compressor", "webp"],
    madeWith:
      "Images are decoded with createImageBitmap, drawn onto a canvas at the new size with high-quality smoothing, and re-encoded with the browser's own JPEG, WEBP or PNG encoder at the quality you pick. Batches are zipped with fflate.",
    credits: [{ name: 'fflate', author: '101arrowz', license: 'MIT', url: 'https://github.com/101arrowz/fflate' }],
  },
  {
    label: 'Image Cropper',
    route: 'image-cropper',
    icon: 'crop',
    category: 'Design',
    description: 'Crop a photo to an exact size, with ready-made social media presets and a live preview.',
    keywords: ['image cropper', 'crop image', 'photo crop', 'instagram crop', 'profile picture crop', 'social media image sizes', 'thumbnail crop', 'aspect ratio crop'],
    madeWith:
      "The photo sits behind a fixed-size viewport sized to the target ratio; dragging and the zoom slider just pan and scale it, cover-fit style, like a typical avatar cropper. Cropping reads back the exact source rectangle the viewport is showing and draws it onto a canvas at the preset's pixel size.",
    credits: [],
  },
  {
    label: 'Image Slicer',
    route: 'image-slicer',
    icon: 'grid-3x3',
    category: 'Design',
    description: 'Slice a photo into an Instagram carousel row or profile grid, with a live preview.',
    keywords: ['image slicer', 'instagram grid', 'instagram carousel', 'grid maker', 'photo grid splitter', 'panorama grid', 'split image into grid', '3x3 grid maker'],
    madeWith:
      "The photo is cover-cropped to the grid's overall aspect ratio, then divided into equal square tiles that are each redrawn onto their own canvas. Multiple tiles are bundled into a ZIP with fflate.",
    credits: [{ name: 'fflate', author: '101arrowz', license: 'MIT', url: 'https://github.com/101arrowz/fflate' }],
  },
  {
    label: 'Calculator',
    route: 'calculator',
    icon: 'calculator',
    category: 'Math',
    description: 'A scientific calculator with trig, logs, factorials and a history.',
    keywords: ['calculator', 'scientific', 'math', 'maths', 'sin', 'cos', 'tan', 'log', 'ln', 'sqrt', 'factorial', 'arithmetic'],
    madeWith:
      "Expressions are read by a hand-written recursive-descent parser that understands implied multiplication (2π, 3(x+1)), absolute value bars and postfix ! and %. Factorials of fractions use the Lanczos approximation of the gamma function. Everything else is JavaScript's own Math library.",
    credits: [],
  },
  {
    label: 'Graph Calculator',
    route: 'graph-calculator',
    icon: 'chart-spline',
    category: 'Math',
    description: 'Plot several functions at once, then pan, zoom and trace them.',
    keywords: ['graph', 'plot', 'function', 'curve', 'chart', 'grapher', 'desmos', 'math', 'maths', 'trace'],
    madeWith:
      'Each function is parsed once by the same expression parser as the calculator, then sampled twice per screen pixel and drawn on a <canvas>. Grid spacing snaps to 1, 2 and 5 steps as you zoom, and lines are broken where a curve jumps off to infinity so asymptotes stay clean.',
    credits: [],
  },
  {
    label: 'Algebra Calculator',
    route: 'algebra-calculator',
    icon: 'variable',
    category: 'Math',
    description: 'Solve equations and linear systems, expand and factor polynomials.',
    keywords: ['algebra', 'solve', 'equation', 'quadratic', 'cubic', 'polynomial', 'factor', 'expand', 'simplify', 'system', 'linear', 'roots', 'math', 'maths'],
    madeWith:
      'Expressions become polynomials stored as maps of monomials to coefficients, so expanding is just multiplying maps. Quadratics get an exact surd form, higher degrees are solved with the Durand–Kerner method, factoring uses the rational root theorem, linear systems use Gaussian elimination, and anything else is solved numerically by bisection.',
    credits: [],
  },
  {
    label: 'Time & Date Calculator',
    route: 'date-calculator',
    icon: 'calendar-clock',
    category: 'Math',
    description: 'Time between two dates, add or subtract time, and total up durations.',
    keywords: ['date', 'time', 'days between', 'difference', 'duration', 'add days', 'subtract', 'weekdays', 'business days', 'hours', 'countdown'],
    madeWith:
      "Built on the browser's Date object in your local time zone. Years, months and days are counted on the calendar (borrowing from the previous month like you would by hand), while hour totals use real elapsed time, so daylight-saving changes are accounted for.",
    credits: [],
  },
  {
    label: 'Age Calculator',
    route: 'age-calculator',
    icon: 'cake',
    category: 'Math',
    description: 'Exact age in years, months and days, plus a countdown to the next birthday.',
    keywords: ['age', 'birthday', 'born', 'how old', 'date of birth', 'dob', 'years old', 'zodiac'],
    madeWith:
      'Plain calendar arithmetic on UTC dates so time zones and daylight saving never nudge the result by a day. Leap-day birthdays are celebrated on 28 February in common years.',
    credits: [],
  },
  {
    label: 'Winrate Calculator',
    route: 'winrate-calculator',
    icon: 'trophy',
    category: 'Math',
    description: 'Work out a win rate and how many wins it takes to hit a target.',
    keywords: ['winrate', 'win rate', 'wins', 'losses', 'ratio', 'ranked', 'games', 'percentage', 'streak', 'elo'],
    madeWith:
      'A few lines of algebra: solving (wins + n) / (games + n) ≥ target for n gives the win streak you need, and the same idea in reverse tells you how many losses you can absorb.',
    credits: [],
  },
  {
    label: 'Unit Converter',
    route: 'unit-converter',
    icon: 'ruler',
    category: 'Math',
    description: 'Convert length, mass, volume, area, speed, time, data and temperature.',
    keywords: ['unit', 'convert', 'conversion', 'length', 'mass', 'weight', 'volume', 'area', 'speed', 'time', 'data', 'temperature', 'metric', 'imperial', 'km', 'miles', 'kg', 'lbs', 'celsius', 'fahrenheit'],
    madeWith:
      'Every category converts through a common base unit (metres, kilograms, litres and so on) with plain multiplication and division. Temperature gets its own formulas since °C, °F and K don’t share a zero point. All the conversion factors are hand-typed constants; no unit-conversion library.',
    credits: [],
  },
  {
    label: 'Wage Calculator',
    route: 'wage-calculator',
    icon: 'wallet',
    category: 'Math',
    description: 'Turn a pay rate into hourly, daily, weekly, monthly and annual figures, with a rough tax estimate.',
    keywords: ['wage', 'salary', 'pay', 'income', 'hourly rate', 'paycheck', 'tax', 'net pay', 'gross pay', 'take home', 'currency', 'annual salary'],
    madeWith:
      "Gross figures are plain arithmetic from your rate, hours and days per week. The tax estimate runs your annual gross through hand-typed progressive brackets for a handful of countries (national/federal only — no local tax, credits or deductions), the same marginal-bracket method real tax tables use.",
    credits: [],
  },
  {
    label: "Percentage Calculator",
    route: "percentage-calculator",
    icon: "percent",
    category: "Math",
    description: "Percent of a number, percentage change, increases, decreases and more.",
    keywords: ["percentage", "percent", "% of", "percent change", "increase", "decrease", "discount", "markup", "difference"],
    madeWith:
      "Each card is one rearrangement of part = percent / 100 × whole, with the working shown underneath so you can check it by hand.",
    credits: [],
  },
  {
    label: "Aspect Ratio Calculator",
    route: "aspect-ratio",
    icon: "proportions",
    category: "Math",
    description: "Simplify resolutions to aspect ratios and resize while keeping proportions.",
    keywords: ["aspect ratio", "resolution", "16:9", "4:3", "resize", "dimensions", "width height", "ratio"],
    madeWith:
      "Ratios are simplified with Euclid's greatest common divisor. Resolutions that don't reduce neatly (like 1366×768) are matched to the nearest common ratio within 3%.",
    credits: [],
  },
  {
    label: "Word Counter",
    route: "word-counter",
    icon: "whole-word",
    category: "Text",
    description: "Count words, characters, sentences and reading time.",
    keywords: ["word count", "character count", "letter count", "words", "characters", "reading time", "sentences", "paragraphs", "keyword density"],
    madeWith:
      "Words are split with Intl.Segmenter, which understands languages written without spaces, like Chinese and Japanese. Reading time assumes 238 words a minute and speaking time 150.",
    credits: [],
  },
  {
    label: "Text Case Converter",
    route: "text-case",
    icon: "case-sensitive",
    category: "Text",
    description: "Convert text to UPPER, lower, Title, Sentence, camelCase, snake_case and more.",
    keywords: ["case converter", "uppercase", "lowercase", "title case", "sentence case", "camelcase", "snake case", "kebab case", "pascal case", "constant case"],
    madeWith:
      "Identifier styles split words at spaces, punctuation and lower-to-upper transitions using Unicode-aware regular expressions, so accented letters work. Title case leaves short words like \"of\" and \"the\" lowercase unless they start or end the line.",
    credits: [],
  },
  {
    label: "Text Diff",
    route: "text-diff",
    icon: "diff",
    category: "Text",
    description: "Compare two texts and highlight what was added or removed.",
    keywords: ["diff", "compare", "difference", "text compare", "changes", "version", "side by side"],
    madeWith:
      "Differences are found with Myers' diff algorithm, the one behind git diff, after trimming the shared start and end. Compare by line, word or character, optionally ignoring case and whitespace.",
    credits: [],
  },
  {
    label: "Line Tools",
    route: "line-tools",
    icon: "list-filter",
    category: "Text",
    description: "Sort, dedupe, shuffle and tidy lines, plus find and replace.",
    keywords: ["sort lines", "remove duplicates", "dedupe", "shuffle", "trim", "blank lines", "find and replace", "regex replace", "alphabetize", "number lines"],
    madeWith:
      "Sorting uses Intl.Collator in numeric mode, so item 2 comes before item 10. Shuffling is a Fisher–Yates shuffle driven by crypto.getRandomValues, and every change can be undone.",
    credits: [],
  },
  {
    label: 'QR Code Generator',
    route: 'qr-code',
    icon: 'qr-code',
    category: 'Other',
    description: 'Turn text or links into a downloadable QR code.',
    keywords: ['qr', 'barcode', 'scan', 'link', 'url', 'share', 'code', 'wifi', 'vcard', 'contact', 'batch', 'logo'],
    madeWith:
      'QR matrices are generated and styled by qr-code-styling (which builds on qrcode-generator). WiFi and vCard payloads are assembled by hand, the info caption is composed onto the image with a canvas or SVG text, and batch ZIPs are packed with fflate. Layout and feature set inspired by delphitools QR Genny.',
    credits: [
      { name: 'qr-code-styling', author: 'Denys Kozak', license: 'MIT', url: 'https://github.com/kozakdenys/qr-code-styling' },
      { name: 'qrcode-generator', author: 'Kazuhiko Arase', license: 'MIT', url: 'https://github.com/kazuhikoarase/qrcode-generator' },
      { name: 'fflate', author: '101arrowz', license: 'MIT', url: 'https://github.com/101arrowz/fflate' },
      { name: 'QR Genny (inspiration)', author: 'delphitools', url: 'https://delphi.tools/tools/qr-genny' },
    ],
  },
  {
    label: 'P2P File Share',
    route: 'file-share',
    icon: 'share-2',
    category: 'Other',
    description: 'Drop a file, get a code, and send it straight to another browser over WebRTC. No upload, no server storage.',
    keywords: ['p2p', 'peer to peer', 'webrtc', 'share', 'transfer', 'send', 'file', 'airdrop', 'code', 'qr'],
    madeWith:
      "Files travel browser-to-browser over an end-to-end encrypted WebRTC data channel. PeerJS's public broker server is used only to help two browsers find each other and exchange connection info; your files themselves never pass through it or any server of ours. Each file is sliced into 4 MB pieces before sending, so neither side ever has to hold a whole large file in memory. Chrome and Edge use the File System Access API to write incoming pieces straight to disk as they arrive, while other browsers buffer the pieces and hand back the finished file once it's complete. The invite QR code is generated the same way as the QR tool, with qr-code-styling.",
    credits: [
      { name: 'PeerJS', author: 'Michelle Bu & contributors', license: 'MIT', url: 'https://github.com/peers/peerjs' },
      { name: 'qr-code-styling', author: 'Denys Kozak', license: 'MIT', url: 'https://github.com/kozakdenys/qr-code-styling' },
    ],
  },
  {
    label: 'Password Generator',
    route: 'password-generator',
    icon: 'key-round',
    category: 'Other',
    description: 'Generate a strong random password, or check the strength of one you already use.',
    keywords: ['password', 'generator', 'random', 'secure', 'strength', 'entropy', 'passphrase', 'security'],
    madeWith:
      "Passwords are built from crypto.getRandomValues with rejection sampling, so every allowed character stays equally likely (no modulo bias). The strength check estimates entropy from the character classes present and an assumed 10 billion guesses/second offline attack; nothing you type is sent anywhere.",
    credits: [],
  },
  {
    label: 'Lorem Ipsum Generator',
    route: 'lorem-ipsum',
    icon: 'type',
    category: 'Other',
    description: 'Generate placeholder text by paragraphs, sentences or words.',
    keywords: ['lorem ipsum', 'placeholder', 'dummy text', 'filler text', 'generator', 'text'],
    madeWith: 'Sentences are assembled by picking random words from the classic Lorem Ipsum word bank and stitching them into sentences and paragraphs of random length. No external text library.',
    credits: [],
  },
  {
    label: "Pomodoro Timer",
    route: "pomodoro-timer",
    icon: "timer",
    category: "Other",
    description: "Focus in timed sessions with short breaks and a long break every few rounds.",
    keywords: ["pomodoro", "timer", "focus", "productivity", "study timer", "work timer", "break", "countdown"],
    madeWith:
      "The countdown is measured against the wall clock rather than counting ticks, so it stays accurate when the browser slows background tabs. The chime is synthesised with the Web Audio API and the optional alert uses the Notification API.",
    credits: [],
  },
  {
    label: "Random Picker",
    route: "random-picker",
    icon: "dices",
    category: "Other",
    description: "Spin a wheel, draw names or split a list into random teams.",
    keywords: ["random", "picker", "wheel", "spin the wheel", "name picker", "raffle", "draw", "teams", "random team generator", "decide"],
    madeWith:
      "Winners are chosen with crypto.getRandomValues using rejection sampling, so no entry is favoured, and the wheel animation is then aimed at the result rather than deciding it. Teams come from a Fisher–Yates shuffle dealt out round-robin.",
    credits: [],
  },
  {
    label: 'Quick Notes',
    route: 'quick-notes',
    icon: 'notebook-pen',
    category: 'Other',
    description: 'Sticky notes with rich text, drawing and stickers, organised into folders. No account needed.',
    keywords: ['notes', 'notebook', 'sticky note', 'draw', 'drawing', 'sketch', 'sticker', 'folder', 'journal', 'todo', 'font'],
    madeWith:
      "Notes are edited in the browser's own contenteditable, formatted with document.execCommand. Drawing and stickers sit on a transparent <canvas> layered right over the text, the way a phone's notes app lets you scribble on the page instead of switching modes. A custom font is registered from an uploaded file with the FontFace API. Ctrl+F inside the tool also searches every note's text, not just what's on screen. Everything is saved to your browser's local storage; nothing is ever uploaded.",
    credits: [],
  },
  {
    label: 'Chess',
    route: 'chess',
    icon: 'chess-knight',
    category: 'Fun',
    description: 'Play chess against the computer at three levels, or against a friend over a direct P2P link. Clocks, Chess960, premoves and drag-and-drop.',
    keywords: ['chess', 'board game', 'checkmate', 'chess ai', 'play chess online', 'multiplayer', 'p2p', 'game', 'blitz', 'bullet', 'chess960', 'premove'],
    madeWith:
      "chess.js handles the rules: legal moves, check, castling, en passant, promotion and every kind of draw. The computer is a small hand-written engine on top of it: alpha-beta search with move ordering and a capture-only quiescence search, scoring positions by material and piece-square tables. It deepens one move at a time within a time budget and yields to the browser between slices, so the board never freezes while it thinks. Pieces live in their own layer and slide between squares with CSS transitions; after every change each piece on the new board is matched to the nearest piece of its kind on the old one, so moves, castling, captures and takebacks all animate without special cases. Premoves are checked against piece movement only, then played the moment it's your turn if they're legal. Online games use PeerJS to connect the two browsers directly; each move is sent with the resulting position and both clocks, so the boards can't drift apart.",
    credits: [
      { name: 'chess.js', author: 'Jeff Hlywa', license: 'BSD-2-Clause', url: 'https://github.com/jhlywa/chess.js' },
      { name: 'PeerJS', author: 'PeerJS contributors', license: 'MIT', url: 'https://peerjs.com' },
    ],
  },
  {
    label: 'Snake',
    route: 'snake',
    icon: 'worm',
    category: 'Fun',
    description: 'Classic snake on your own, or a battle of up to four snakes against the computer and your friends.',
    keywords: ['snake', 'arcade', 'retro game', 'nokia snake', 'multiplayer', 'p2p', 'game'],
    madeWith:
      "The board is a <canvas> redrawn every tick. The rules are plain JavaScript: heads move first, then collisions are settled against where every snake ends up, so head-on crashes are fair. The computer snake finds the nearest apple with a breadth-first search, refuses to enter a pocket smaller than its own body (checked with a flood fill), avoids squares another head could reach next, and occasionally wanders so it can be beaten. Online, the host runs the game and streams each tick to everyone over PeerJS connections; guests only send their turns.",
    credits: [{ name: 'PeerJS', author: 'PeerJS contributors', license: 'MIT', url: 'https://peerjs.com' }],
  },
  {
    label: 'Woono',
    route: 'woono',
    icon: 'layers',
    category: 'Fun',
    description: 'Our take on Uno, played first person around a 3D table: up to eight players, computer or friends, with house rules like stacking, 7 swap, 0 rotate and jump-in.',
    keywords: ['woono', 'uno', 'uno online', 'lan', 'offline multiplayer', 'hotspot', 'challenge', 'turn timer', 'card game', 'cards', 'wild card', 'multiplayer', 'p2p', 'game', 'house rules', 'stacking', 'avatar', '3d', 'first person'],
    madeWith:
      "The deck and rules are plain JavaScript: Skips, Reverses (which act as Skips with two players), Draw Twos, Wilds and Wild Draw Fours, plus optional house rules for stacking, sevens, zeros, jump-ins and drawing until you can play. The table is a small three.js scene loaded only when you open Woono, seen through your own avatar's eyes: your cards are real 3D cards held in front of the camera and picked with a raycast, while name tags, the draw button and stacked-draw warnings are sprites that always face you. Avatars are chibi doodles built from a few toon-shaded shapes with ink outlines (the back faces of each shape, pushed outwards), on a squircle head rather than a sphere; each hairstyle is a shell grown round that head down to a hairline, which hangs straight down past the widest point, so a bowl cut, a mullet and hair to the waist are all just different hairlines. Faces and cards are drawn once on a 2D canvas and reused as textures. Effects are pooled: one particle buffer, a handful of recycled rings and cards, so nothing is allocated mid-game. On phones, the gyroscope's orientation is turned into a quaternion relative to where you were facing when you switched it on, so tilting the phone looks around. Computer players really think: for each move they could make, they play the rest of the game out hundreds of times (dealing the cards they can't see at random, so they never peek), keep the move that wins most, and chat in pun-filled lines picked by what just happened. The turn timer runs on the host, which sends everyone the time left rather than a timestamp, since device clocks never quite agree. Online, the host runs the game and sends each player only what they're allowed to see, so no one can peek at another hand. Public rooms are found without any server keeping a list: each one also claims one of a dozen well-known listing ids, and browsing simply knocks on each. Nearby play needs no internet at all: the two WebRTC connection descriptions a broker would normally pass along are deflated with fflate and swapped by QR code (read with the browser's BarcodeDetector) or copy and paste, and with no STUN server only local network addresses are used.",
    credits: [
      { name: 'fflate', author: '101arrowz', license: 'MIT', url: 'https://github.com/101arrowz/fflate' },
      { name: 'qr-code-styling', author: 'Denys Kozak', license: 'MIT', url: 'https://github.com/kozakdenys/qr-code-styling' },
      { name: 'three.js', author: 'three.js authors', license: 'MIT', url: 'https://threejs.org' },
      { name: 'PeerJS', author: 'PeerJS contributors', license: 'MIT', url: 'https://peerjs.com' },
    ],
  },
  {
    label: 'JJS Stuff',
    route: 'jjs-stuff',
    icon: 'swords',
    category: 'Fun',
    description: 'Jujutsu Shenanigans Skill Builder notes: sound IDs, emote music, punch, kick and flip directions, run animations, move startups and presets.',
    keywords: ['jjs', 'jujutsu shenanigans', 'skill builder', 'skillbuilder', 'roblox', 'sound id', 'audio id', 'sounds', 'emotes', 'animations', 'vfx', 'presets', 'moveset', 'startup', 'gojo', 'sukuna', 'yuji'],
    madeWith:
      "The notes are kept as the plain text they were written in and read by a small parser: bold lines become headings, a heading followed by another heading becomes a character or category, long numbers become copyable sound IDs, and times like 0.483~ become startups. Search filters every tab at once and shows how many matches each one has. The text is loaded only when you open the page.",
    credits: [
      { name: "Skillbuilder's Help", author: 'oSam and friends', url: 'https://ossaamm.github.io' },
      { name: 'oSam on YouTube', author: 'oSam', url: 'https://www.youtube.com/@oSSamm1' },
      { name: 'Punch, kick and flip directions', author: 'Apple Lover, ujhjth', url: 'https://ossaamm.github.io' },
      { name: 'Animation finds', author: 'lululalu_a', url: 'https://ossaamm.github.io' },
      { name: 'VFX presets', author: 'TheNoob (@dhdvru2i)', url: 'https://ossaamm.github.io' },
    ],
  },
];

// Shown under every tool: the stack the whole site runs on.
export const SITE_CREDITS = [
  { name: 'Ember.js', license: 'MIT', url: 'https://emberjs.com' },
  { name: 'Vite', license: 'MIT', url: 'https://vite.dev' },
  { name: 'crayon-css', author: 'TeriyakiBomb', license: 'MIT', url: 'https://github.com/TeriyakiBomb/crayon' },
  { name: 'sketchyicons', author: 'Fantomiald', license: 'MIT, geometry from Lucide (ISC)', url: 'https://sketchyicons.com' },
  { name: 'Moderustic & Inconsolata', author: 'Google Fonts', license: 'OFL', url: 'https://fonts.google.com' },
];

// Subsequence match: every query char must appear in order. Higher is better,
// -1 means no match. Rewards consecutive runs, word starts and short targets.
export function fuzzyScore(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  let score = 0;
  let run = 0;
  let from = 0;
  for (const ch of q) {
    const i = t.indexOf(ch, from);
    if (i === -1) return -1;
    run = i === from ? run + 1 : 0;
    score += 1 + run * 2 + (i === 0 || /[\s\-_]/.test(t[i - 1]) ? 3 : 0);
    from = i + 1;
  }
  return score - t.length * 0.05;
}

export function searchTools(query) {
  const q = query.trim();
  if (!q) return TOOLS;
  return TOOLS.map((tool) => {
    const fields = [tool.label, tool.category, ...(tool.keywords ?? [])].filter(Boolean);
    const description = tool.description?.toLowerCase() ?? '';
    // Every word must hit: fuzzy on short fields (label weighted), plain substring on the description.
    const score = q.split(/\s+/).reduce((sum, word) => {
      if (sum < 0) return sum;
      const fuzzy = Math.max(...fields.map((f, i) => fuzzyScore(word, f) * (i === 0 ? 1.5 : 1)));
      const best = Math.max(fuzzy, description.includes(word.toLowerCase()) ? 2 : -1);
      return best < 0 ? -1 : sum + best;
    }, 0);
    return { tool, score };
  })
    .filter((r) => r.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.tool);
}

export function groupTools(tools) {
  const groups = new Map();
  for (const tool of tools) {
    const key = tool.category ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tool);
  }
  return [...groups].map(([name, items]) => ({ name, items }));
}
