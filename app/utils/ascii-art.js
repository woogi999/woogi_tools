// ASCII art two ways: big letters from a 5×7 dot font (the classic banner
// look), and pictures turned into characters by how bright each patch is.

// The 5×7 font, one entry per glyph: seven rows of five bits, top to bottom.
// prettier-ignore
const FONT = {
  ' ': [0,0,0,0,0,0,0], '!': [4,4,4,4,4,0,4], '"': [10,10,10,0,0,0,0], '#': [10,10,31,10,31,10,10], '$': [4,15,20,14,5,30,4],
  '%': [24,25,2,4,8,19,3], '&': [12,18,20,8,21,18,13], "'": [4,4,4,0,0,0,0], '(': [2,4,8,8,8,4,2], ')': [8,4,2,2,2,4,8],
  '*': [0,4,21,14,21,4,0], '+': [0,4,4,31,4,4,0], ',': [0,0,0,0,12,4,8], '-': [0,0,0,31,0,0,0], '.': [0,0,0,0,0,12,12],
  '/': [1,1,2,4,8,16,16], '0': [14,17,19,21,25,17,14], '1': [4,12,4,4,4,4,14], '2': [14,17,1,2,4,8,31], '3': [31,2,4,2,1,17,14],
  '4': [2,6,10,18,31,2,2], '5': [31,16,30,1,1,17,14], '6': [6,8,16,30,17,17,14], '7': [31,1,2,4,8,8,8], '8': [14,17,17,14,17,17,14],
  '9': [14,17,17,15,1,2,12], ':': [0,12,12,0,12,12,0], ';': [0,12,12,0,12,4,8], '<': [2,4,8,16,8,4,2], '=': [0,0,31,0,31,0,0],
  '>': [8,4,2,1,2,4,8], '?': [14,17,1,2,4,0,4], '@': [14,17,1,13,21,21,14], A: [14,17,17,31,17,17,17], B: [30,17,17,30,17,17,30],
  C: [14,17,16,16,16,17,14], D: [28,18,17,17,17,18,28], E: [31,16,16,30,16,16,31], F: [31,16,16,30,16,16,16], G: [14,17,16,23,17,17,15],
  H: [17,17,17,31,17,17,17], I: [14,4,4,4,4,4,14], J: [7,2,2,2,2,18,12], K: [17,18,20,24,20,18,17], L: [16,16,16,16,16,16,31],
  M: [17,27,21,21,17,17,17], N: [17,17,25,21,19,17,17], O: [14,17,17,17,17,17,14], P: [30,17,17,30,16,16,16], Q: [14,17,17,17,21,18,13],
  R: [30,17,17,30,20,18,17], S: [15,16,16,14,1,1,30], T: [31,4,4,4,4,4,4], U: [17,17,17,17,17,17,14], V: [17,17,17,17,17,10,4],
  W: [17,17,17,21,21,21,10], X: [17,17,10,4,10,17,17], Y: [17,17,17,10,4,4,4], Z: [31,1,2,4,8,16,31], '[': [14,8,8,8,8,8,14],
  '\\': [16,16,8,4,2,1,1], ']': [14,2,2,2,2,2,14], '^': [4,10,17,0,0,0,0], _: [0,0,0,0,0,0,31], '{': [2,4,4,8,4,4,2], '|': [4,4,4,4,4,4,4],
  '}': [8,4,4,2,4,4,8], '~': [0,0,8,21,2,0,0],
};

export const TEXT_STYLES = [
  { id: 'block', label: 'Block', on: '██', off: '  ' },
  { id: 'shade', label: 'Shaded', on: '▓▓', off: '░░' },
  { id: 'hash', label: 'Hash', on: '##', off: '  ' },
  { id: 'letter', label: 'Own letter', on: null, off: '  ' },
  { id: 'dots', label: 'Dots', on: '● ', off: '  ' },
  { id: 'slash', label: 'Slashes', on: '//', off: '  ' },
];

// Big letters. Lines longer than `wrap` characters of input start a new row of glyphs.
export function bannerText(
  text,
  { style = 'block', custom = '', wrap = 12 } = {},
) {
  const spec = TEXT_STYLES.find((s) => s.id === style) ?? TEXT_STYLES[0];
  const lines = [];
  for (const raw of text.toUpperCase().split('\n')) {
    const chunks = raw.match(new RegExp(`.{1,${Math.max(1, wrap)}}`, 'g')) ?? [
      '',
    ];
    for (const chunk of chunks) {
      const rows = Array.from({ length: 7 }, () => '');
      for (const ch of chunk) {
        const glyph = FONT[ch] ?? FONT['?'];
        const on = custom
          ? custom.padEnd(2).slice(0, 2)
          : (spec.on ?? `${ch}${ch}`);
        for (let r = 0; r < 7; r++) {
          let row = '';
          for (let c = 4; c >= 0; c--)
            row += (glyph[r] >> c) & 1 ? on : spec.off;
          rows[r] += `${row}${spec.off}`;
        }
      }
      lines.push(...rows.map((r) => r.replace(/\s+$/, '')), '');
    }
  }
  return lines.join('\n').replace(/\n+$/, '');
}

export const RAMPS = [
  { id: 'classic', label: 'Classic', chars: ' .:-=+*#%@' },
  {
    id: 'detailed',
    label: 'Detailed',
    chars:
      ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
  },
  { id: 'blocks', label: 'Blocks', chars: ' ░▒▓█' },
  { id: 'binary', label: 'Binary', chars: '01' },
  { id: 'braille', label: 'Braille (fine)', chars: null },
];

// Draws `source` (image, bitmap or canvas) `columns` characters wide and
// reads the brightness back. Characters are about twice as tall as they are
// wide, so the rows are halved to keep the picture in proportion.
function sample(source, columns, rowsPerColumn = 0.5) {
  const w = Math.max(1, Math.round(columns));
  const h = Math.max(
    1,
    Math.round((source.height / source.width) * w * rowsPerColumn),
  );
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const grey = new Float32Array(w * h);
  for (let i = 0, j = 0; i < data.length; i += 4, j++)
    grey[j] =
      (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
  return { grey, w, h, data };
}

export function imageToAscii(
  source,
  { columns = 80, ramp = 'classic', invert = false, contrast = 1 } = {},
) {
  const spec = RAMPS.find((r) => r.id === ramp) ?? RAMPS[0];
  if (!spec.chars) return imageToBraille(source, { columns, invert, contrast });
  const { grey, w, h } = sample(source, columns);
  const chars = spec.chars;
  const lines = [];
  for (let y = 0; y < h; y++) {
    let line = '';
    for (let x = 0; x < w; x++) {
      let v = grey[y * w + x];
      v = Math.min(1, Math.max(0, (v - 0.5) * contrast + 0.5));
      // Dark pixels get the dense characters on a light page; invert for dark pages.
      const t = invert ? v : 1 - v;
      line += chars[Math.min(chars.length - 1, Math.floor(t * chars.length))];
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines.join('\n');
}

// Braille cells are 2×4 dots, so the picture is sampled at twice the columns
// and four times the rows, then each dot is switched on where it's dark.
export function imageToBraille(
  source,
  { columns = 80, invert = false, contrast = 1, threshold = 0.5 } = {},
) {
  const cols = Math.max(1, Math.round(columns));
  const w = cols * 2;
  const h = Math.max(
    4,
    Math.round((source.height / source.width) * w * 0.5 * 2) * 2,
  );
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const dark = (x, y) => {
    if (x >= w || y >= h) return false;
    const i = (y * w + x) * 4;
    let v = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    v = Math.min(1, Math.max(0, (v - 0.5) * contrast + 0.5));
    return invert ? v > threshold : v < threshold;
  };
  // Dot numbering in a braille cell: 1 4 / 2 5 / 3 6 / 7 8.
  const bits = [
    [0, 0, 0x01],
    [0, 1, 0x02],
    [0, 2, 0x04],
    [1, 0, 0x08],
    [1, 1, 0x10],
    [1, 2, 0x20],
    [0, 3, 0x40],
    [1, 3, 0x80],
  ];
  const lines = [];
  for (let y = 0; y < h; y += 4) {
    let line = '';
    for (let x = 0; x < w; x += 2) {
      let code = 0;
      for (const [dx, dy, bit] of bits) if (dark(x + dx, y + dy)) code |= bit;
      line += String.fromCodePoint(0x2800 + code);
    }
    lines.push(line.replace(/⠀+$/, ''));
  }
  return lines.join('\n');
}

// Paints the text onto a canvas in a monospace font, for saving as a picture.
export function textToCanvas(
  text,
  { fontSize = 12, fg = '#000000', bg = '#ffffff' } = {},
) {
  const lines = text.split('\n');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `${fontSize}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.font = font;
  const charWidth = ctx.measureText('M').width;
  const lineHeight = fontSize * 1.2;
  const longest = Math.max(...lines.map((l) => l.length), 1);
  canvas.width = Math.ceil(charWidth * longest + fontSize * 2);
  canvas.height = Math.ceil(lineHeight * lines.length + fontSize * 2);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = fg;
  ctx.font = font;
  ctx.textBaseline = 'top';
  lines.forEach((line, i) =>
    ctx.fillText(line, fontSize, fontSize + i * lineHeight),
  );
  return canvas;
}
