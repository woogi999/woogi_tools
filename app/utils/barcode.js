// Barcode encoders, hand-written from the specs. Each one turns text into a
// string of modules ('1' is a bar, '0' a space) and reports what it changed
// (a check digit worked out, letters upper-cased) so the label under the
// bars shows what was really encoded.

// ─── Code 128 ────────────────────────────────────────────────────────────
// prettier-ignore
const CODE128 = [
  '11011001100','11001101100','11001100110','10010011000','10010001100','10001001100','10011001000','10011000100','10001100100','11001001000',
  '11001000100','11000100100','10110011100','10011011100','10011001110','10111001100','10011101100','10011100110','11001110010','11001011100',
  '11001001110','11011100100','11001110100','11101101110','11101001100','11100101100','11100100110','11101100100','11100110100','11100110010',
  '11011011000','11011000110','11000110110','10100011000','10001011000','10001000110','10110001000','10001101000','10001100010','11010001000',
  '11000101000','11000100010','10110111000','10110001110','10001101110','10111011000','10111000110','10001110110','11101110110','11010001110',
  '11000101110','11011101000','11011100010','11011101110','11101011000','11101000110','11100010110','11101101000','11101100010','11100011010',
  '11101111010','11001000010','11110001010','10100110000','10100001100','10010110000','10010000110','10000101100','10000100110','10110010000',
  '10110000100','10011010000','10011000010','10000110100','10000110010','11000010010','11001010000','11110111010','11000010100','10001111010',
  '10100111100','10010111100','10010011110','10111100100','10011110100','10011110010','11110100100','11110010100','11110010010','11011011110',
  '11011110110','11110110110','10101111000','10100011110','10001011110','10111101000','10111100010','11110101000','11110100010','10111011110',
  '10111101110','11101011110','11110101110','11010000100','11010010000','11010011100','1100011101011',
];
const START_B = 104;
const START_C = 105;
const CODE_C = 99;
const CODE_B = 100;
const STOP = 106;

export function code128(text) {
  if (!text) throw new Error('Type something to encode');
  for (const ch of text)
    if (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) > 126)
      throw new Error('Code 128 here takes printable ASCII only');
  const codes = [];
  let i = 0;
  let mode = null;
  const digitsAhead = (at) => {
    let n = 0;
    while (at + n < text.length && /\d/.test(text[at + n])) n++;
    return n;
  };
  while (i < text.length) {
    const run = digitsAhead(i);
    // Pairs of digits pack into one symbol in set C, which halves the width.
    if (run >= 4 || (run >= 2 && run === text.length - i)) {
      if (mode !== 'C') codes.push(mode === null ? START_C : CODE_C);
      mode = 'C';
      const pairs = Math.floor(run / 2);
      for (let p = 0; p < pairs; p++) {
        codes.push(Number(text.slice(i, i + 2)));
        i += 2;
      }
      continue;
    }
    if (mode !== 'B') codes.push(mode === null ? START_B : CODE_B);
    mode = 'B';
    codes.push(text.charCodeAt(i) - 32);
    i++;
  }
  let check = codes[0];
  for (let k = 1; k < codes.length; k++) check += codes[k] * k;
  codes.push(check % 103, STOP);
  return { modules: codes.map((c) => CODE128[c]).join(''), label: text };
}

// ─── EAN / UPC ───────────────────────────────────────────────────────────
const L = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
];
const G = L.map((p) => [...p].reverse().join(''));
const R = L.map((p) => [...p].map((b) => (b === '1' ? '0' : '1')).join(''));
const PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
];

function checkDigit(digits) {
  let sum = 0;
  [...digits]
    .reverse()
    .forEach((d, i) => (sum += Number(d) * (i % 2 === 0 ? 3 : 1)));
  return String((10 - (sum % 10)) % 10);
}

export function ean13(text) {
  const digits = text.replaceAll(/\D/g, '');
  if (digits.length !== 12 && digits.length !== 13)
    throw new Error(
      'EAN-13 needs 12 digits (the check digit is worked out) or all 13',
    );
  const body = digits.slice(0, 12);
  const check = checkDigit(body);
  if (digits.length === 13 && digits[12] !== check)
    throw new Error(`The check digit should be ${check}`);
  const full = body + check;
  const parity = PARITY[Number(full[0])];
  let modules = '101';
  for (let i = 1; i <= 6; i++)
    modules += (parity[i - 1] === 'L' ? L : G)[Number(full[i])];
  modules += '01010';
  for (let i = 7; i <= 12; i++) modules += R[Number(full[i])];
  modules += '101';
  return { modules, label: full, guards: true };
}

export function ean8(text) {
  const digits = text.replaceAll(/\D/g, '');
  if (digits.length !== 7 && digits.length !== 8)
    throw new Error(
      'EAN-8 needs 7 digits (the check digit is worked out) or all 8',
    );
  const body = digits.slice(0, 7);
  const check = checkDigit(body);
  if (digits.length === 8 && digits[7] !== check)
    throw new Error(`The check digit should be ${check}`);
  const full = body + check;
  let modules = '101';
  for (let i = 0; i < 4; i++) modules += L[Number(full[i])];
  modules += '01010';
  for (let i = 4; i < 8; i++) modules += R[Number(full[i])];
  modules += '101';
  return { modules, label: full, guards: true };
}

export function upcA(text) {
  const digits = text.replaceAll(/\D/g, '');
  if (digits.length !== 11 && digits.length !== 12)
    throw new Error(
      'UPC-A needs 11 digits (the check digit is worked out) or all 12',
    );
  // UPC-A is EAN-13 with a leading zero.
  const out = ean13(`0${digits}`);
  return { ...out, label: out.label.slice(1) };
}

// ─── Code 39 ─────────────────────────────────────────────────────────────
// prettier-ignore
const CODE39 = {
  '0':'101001101101','1':'110100101011','2':'101100101011','3':'110110010101','4':'101001101011','5':'110100110101','6':'101100110101','7':'101001011011','8':'110100101101','9':'101100101101',
  A:'110101001011',B:'101101001011',C:'110110100101',D:'101011001011',E:'110101100101',F:'101101100101',G:'101010011011',H:'110101001101',I:'101101001101',J:'101011001101',
  K:'110101010011',L:'101101010011',M:'110110101001',N:'101011010011',O:'110101101001',P:'101101101001',Q:'101010110011',R:'110101011001',S:'101101011001',T:'101011011001',
  U:'110010101011',V:'100110101011',W:'110011010101',X:'100101101011',Y:'110010110101',Z:'100110110101','-':'100101011011','.':'110010101101',' ':'100110101101','$':'100100100101',
  '/':'100100101001','+':'100101001001','%':'101001001001','*':'100101101101',
};

export function code39(text) {
  const upper = text.toUpperCase();
  if (!upper) throw new Error('Type something to encode');
  for (const ch of upper)
    if (!CODE39[ch] || ch === '*')
      throw new Error(
        `Code 39 can't encode “${ch}”: letters, digits, space and - . $ / + % only`,
      );
  const modules = ['*', ...upper, '*'].map((ch) => CODE39[ch]).join('0');
  return { modules, label: upper };
}

// ─── Interleaved 2 of 5 (ITF) ────────────────────────────────────────────
const ITF = [
  '00110',
  '10001',
  '01001',
  '11001',
  '00101',
  '10101',
  '01101',
  '00011',
  '10011',
  '01011',
];

export function itf(text) {
  let digits = text.replaceAll(/\D/g, '');
  if (!digits) throw new Error('ITF takes digits only');
  if (digits.length % 2) digits = `0${digits}`;
  let modules = '1010';
  for (let i = 0; i < digits.length; i += 2) {
    const a = ITF[Number(digits[i])];
    const b = ITF[Number(digits[i + 1])];
    for (let k = 0; k < 5; k++) {
      modules += a[k] === '1' ? '111' : '1';
      modules += b[k] === '1' ? '000' : '0';
    }
  }
  modules += '1101';
  return { modules, label: digits };
}

export function itf14(text) {
  const digits = text.replaceAll(/\D/g, '');
  if (digits.length !== 13 && digits.length !== 14)
    throw new Error(
      'ITF-14 needs 13 digits (the check digit is worked out) or all 14',
    );
  const body = digits.slice(0, 13);
  const check = checkDigit(body);
  if (digits.length === 14 && digits[13] !== check)
    throw new Error(`The check digit should be ${check}`);
  return { ...itf(body + check), bearer: true };
}

// ─── Codabar ─────────────────────────────────────────────────────────────
// prettier-ignore
const CODABAR = {
  '0':'101010011','1':'101011001','2':'101001011','3':'110010101','4':'101101001','5':'110101001','6':'100101011','7':'100101101','8':'100110101','9':'110100101',
  '-':'101001101','$':'101100101',':':'1101011011','/':'1101101011','.':'1101101101','+':'101100110011',
  A:'1011001001',B:'1001001011',C:'1010010011',D:'1010011001',
};

export function codabar(text) {
  let upper = text.toUpperCase();
  if (!/^[A-D]/.test(upper)) upper = `A${upper}`;
  if (!/[A-D]$/.test(upper)) upper = `${upper}B`;
  for (const ch of upper)
    if (!CODABAR[ch]) throw new Error(`Codabar can't encode “${ch}”`);
  return {
    modules: [...upper].map((ch) => CODABAR[ch]).join('0'),
    label: upper,
  };
}

export const SYMBOLOGIES = [
  {
    id: 'code128',
    label: 'Code 128',
    hint: 'Any text. The everyday choice for labels and logistics.',
    encode: code128,
    sample: 'WOOGI-2026',
  },
  {
    id: 'ean13',
    label: 'EAN-13',
    hint: '12 or 13 digits. Retail products worldwide.',
    encode: ean13,
    sample: '590123412345',
  },
  {
    id: 'upca',
    label: 'UPC-A',
    hint: '11 or 12 digits. Retail products in North America.',
    encode: upcA,
    sample: '03600029145',
  },
  {
    id: 'ean8',
    label: 'EAN-8',
    hint: '7 or 8 digits. Small packages.',
    encode: ean8,
    sample: '9638507',
  },
  {
    id: 'code39',
    label: 'Code 39',
    hint: 'Letters, digits and a few symbols. Badges and industry.',
    encode: code39,
    sample: 'HELLO 123',
  },
  {
    id: 'itf14',
    label: 'ITF-14',
    hint: '13 or 14 digits. Shipping cartons.',
    encode: itf14,
    sample: '1540014128876',
  },
  {
    id: 'itf',
    label: 'Interleaved 2 of 5',
    hint: 'Digits, any even length.',
    encode: itf,
    sample: '12345678',
  },
  {
    id: 'codabar',
    label: 'Codabar',
    hint: 'Digits and - $ : / . +. Libraries and blood banks.',
    encode: codabar,
    sample: '40156',
  },
];

// The barcode as SVG markup. `height` and `module` are in pixels; the quiet
// zone is ten modules each side, as the specs ask.
export function toSvg(
  { modules, label, guards, bearer },
  {
    module = 2,
    height = 80,
    showLabel = true,
    fg = '#000000',
    bg = '#FFFFFF',
    fontSize = 14,
  } = {},
) {
  const quiet = 10 * module;
  const width = modules.length * module + quiet * 2;
  const labelRoom = showLabel ? fontSize + 8 : 0;
  const bearerBar = bearer ? Math.max(2, module * 2) : 0;
  const total = height + labelRoom + bearerBar * 2;
  const rects = [];
  let run = 0;
  for (let i = 0; i <= modules.length; i++) {
    if (modules[i] === '1') run++;
    else if (run) {
      const x = quiet + (i - run) * module;
      // EAN guard bars run a little taller than the digits, as on a packet.
      const guard =
        guards &&
        (i - run < 3 || i > modules.length - 3 || (i - run >= 45 && i <= 50));
      const h = guard && showLabel ? height + fontSize * 0.6 : height;
      rects.push(
        `<rect x="${x}" y="${bearerBar}" width="${run * module}" height="${h}"/>`,
      );
      run = 0;
    }
  }
  const text = showLabel
    ? `<text x="${width / 2}" y="${bearerBar + height + fontSize + 2}" text-anchor="middle" font-family="monospace" font-size="${fontSize}" fill="${fg}">${escapeXml(label)}</text>`
    : '';
  const frame = bearer
    ? `<rect x="0" y="0" width="${width}" height="${bearerBar}" fill="${fg}"/><rect x="0" y="${bearerBar + height}" width="${width}" height="${bearerBar}" fill="${fg}"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${total}" viewBox="0 0 ${width} ${total}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${bg}"/>${frame}<g fill="${fg}">${rects.join('')}</g>${text}</svg>`;
}

const escapeXml = (s) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
