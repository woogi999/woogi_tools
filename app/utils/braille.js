// Text to Unicode braille and back (Grade 1, uncontracted). The dot patterns are
// standard English braille; the Unicode block puts them at U+2800 + the dot bits.

const LETTERS = {
  a: '⠁', b: '⠃', c: '⠉', d: '⠙', e: '⠑', f: '⠋', g: '⠛', h: '⠓', i: '⠊', j: '⠚',
  k: '⠅', l: '⠇', m: '⠍', n: '⠝', o: '⠕', p: '⠏', q: '⠟', r: '⠗', s: '⠎', t: '⠞',
  u: '⠥', v: '⠧', w: '⠺', x: '⠭', y: '⠽', z: '⠵',
};
// Numbers are the first ten letters after a number sign.
const DIGITS = { 1: 'a', 2: 'b', 3: 'c', 4: 'd', 5: 'e', 6: 'f', 7: 'g', 8: 'h', 9: 'i', 0: 'j' };
const PUNCTUATION = {
  ',': '⠂', ';': '⠆', ':': '⠒', '.': '⠲', '?': '⠦', '!': '⠖', "'": '⠄', '-': '⠤', '/': '⠌',
  '(': '⠐⠣', ')': '⠐⠜', '"': '⠐⠦', '*': '⠐⠔', '+': '⠐⠮', '=': '⠐⠶', '#': '⠸⠹', '&': '⠈⠯', '@': '⠈⠁',
};
export const CAPITAL = '⠠';
export const NUMBER = '⠼';

const FROM_LETTER = Object.fromEntries(Object.entries(LETTERS).map(([k, v]) => [v, k]));
const FROM_PUNCT = Object.fromEntries(Object.entries(PUNCTUATION).map(([k, v]) => [v, k]));
const FROM_DIGIT = Object.fromEntries(Object.entries(DIGITS).map(([d, letter]) => [letter, d]));

export function toBraille(text, { capitals = true, numbers = true } = {}) {
  let out = '';
  let inNumber = false;
  for (const ch of text) {
    const lower = ch.toLowerCase();
    if (LETTERS[lower]) {
      // A letter straight after digits needs the number run closed off.
      if (inNumber) {
        out += '⠰';
        inNumber = false;
      }
      if (capitals && ch !== lower) out += CAPITAL;
      out += LETTERS[lower];
    } else if (DIGITS[ch]) {
      if (numbers && !inNumber) {
        out += NUMBER;
        inNumber = true;
      }
      out += LETTERS[DIGITS[ch]];
    } else {
      inNumber = false;
      if (ch === ' ') out += ' ';
      else if (ch === '\n') out += '\n';
      else out += (PUNCTUATION[ch] ?? '');
    }
  }
  return out;
}

export function fromBraille(braille) {
  let out = '';
  let capitalNext = false;
  let inNumber = false;
  const cells = [...braille];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell === CAPITAL) {
      capitalNext = true;
      continue;
    }
    if (cell === NUMBER) {
      inNumber = true;
      continue;
    }
    if (cell === '⠰') {
      inNumber = false;
      continue;
    }
    if (cell === ' ' || cell === '\n') {
      inNumber = false;
      out += cell;
      continue;
    }
    // Two-cell punctuation first, then the single-cell sort.
    const pair = cell + (cells[i + 1] ?? '');
    if (FROM_PUNCT[pair]) {
      out += FROM_PUNCT[pair];
      i++;
      continue;
    }
    if (FROM_PUNCT[cell]) {
      out += FROM_PUNCT[cell];
      continue;
    }
    const letter = FROM_LETTER[cell];
    if (!letter) continue;
    if (inNumber && FROM_DIGIT[letter]) {
      out += FROM_DIGIT[letter];
      continue;
    }
    out += capitalNext ? letter.toUpperCase() : letter;
    capitalNext = false;
  }
  return out;
}

// Which of the six dots a cell uses, for drawing it big on screen.
export function dotsOf(cell) {
  const code = cell.codePointAt(0) - 0x2800;
  if (code < 0 || code > 0xff) return null;
  return [1, 2, 3, 4, 5, 6].map((dot) => Boolean(code & (1 << (dot - 1))));
}
