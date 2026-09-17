// Classic pen-and-paper ciphers, plus a cracker that tries the lot and ranks
// what comes out by how much it looks like English.

const A = 'A'.charCodeAt(0);
const isLetter = (code) =>
  (code >= 65 && code <= 90) || (code >= 97 && code <= 122);

const mapLetters = (text, fn) =>
  [...text]
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (!isLetter(code)) return ch;
      const upper = code < 97;
      const index = (upper ? code - 65 : code - 97) % 26;
      const out = String.fromCharCode(A + (((fn(index) % 26) + 26) % 26));
      return upper ? out : out.toLowerCase();
    })
    .join('');

// ─── The ciphers ──────────────────────────────────────────────────────

export const caesar = (text, shift) => mapLetters(text, (i) => i + shift);
export const rot13 = (text) => caesar(text, 13);
export const atbash = (text) => mapLetters(text, (i) => 25 - i);

export function vigenere(text, key, decode = false) {
  const letters = key.toUpperCase().replaceAll(/[^A-Z]/g, '');
  if (!letters) return text;
  let k = 0;
  return mapLetters(text, (i) => {
    const shift = letters.charCodeAt(k++ % letters.length) - A;
    return decode ? i - shift : i + shift;
  });
}

// Rail fence: written in a zigzag over `rails` lines, then read line by line.
export function railFence(text, rails, decode = false) {
  const n = Math.max(2, Math.min(50, Math.floor(rails) || 2));
  if (text.length < 2) return text;
  const pattern = [];
  for (let i = 0, rail = 0, dir = 1; i < text.length; i++) {
    pattern.push(rail);
    if (rail === 0) dir = 1;
    else if (rail === n - 1) dir = -1;
    rail += dir;
  }
  if (!decode) {
    let out = '';
    for (let rail = 0; rail < n; rail++)
      for (let i = 0; i < text.length; i++)
        if (pattern[i] === rail) out += text[i];
    return out;
  }
  const out = Array(text.length);
  let at = 0;
  for (let rail = 0; rail < n; rail++)
    for (let i = 0; i < text.length; i++)
      if (pattern[i] === rail) out[i] = text[at++];
  return out.join('');
}

// A1Z26: letters as their place in the alphabet.
export const toNumbers = (text) =>
  [...text.toUpperCase()]
    .map((ch) =>
      isLetter(ch.charCodeAt(0))
        ? ch.charCodeAt(0) - A + 1
        : ch === ' '
          ? '/'
          : ch,
    )
    .join(' ')
    .replaceAll(/\s+/g, ' ')
    .trim();

export const fromNumbers = (text) =>
  text
    .split(/[^0-9/]+/)
    .filter(Boolean)
    .map((part) =>
      part === '/' ? ' ' : String.fromCharCode(A + (Number(part) - 1)),
    )
    .join('')
    .replaceAll(/\s+/g, ' ');

export const reverseText = (text) => [...text].reverse().join('');

const MORSE = {
  A: '.-',
  B: '-...',
  C: '-.-.',
  D: '-..',
  E: '.',
  F: '..-.',
  G: '--.',
  H: '....',
  I: '..',
  J: '.---',
  K: '-.-',
  L: '.-..',
  M: '--',
  N: '-.',
  O: '---',
  P: '.--.',
  Q: '--.-',
  R: '.-.',
  S: '...',
  T: '-',
  U: '..-',
  V: '...-',
  W: '.--',
  X: '-..-',
  Y: '-.--',
  Z: '--..',
  0: '-----',
  1: '.----',
  2: '..---',
  3: '...--',
  4: '....-',
  5: '.....',
  6: '-....',
  7: '--...',
  8: '---..',
  9: '----.',
  '.': '.-.-.-',
  ',': '--..--',
  '?': '..--..',
  "'": '.----.',
  '!': '-.-.--',
  '/': '-..-.',
  '(': '-.--.',
  ')': '-.--.-',
  '&': '.-...',
  ':': '---...',
  ';': '-.-.-.',
  '=': '-...-',
  '+': '.-.-.',
  '-': '-....-',
  '"': '.-..-.',
  '@': '.--.-.',
};
const FROM_MORSE = Object.fromEntries(
  Object.entries(MORSE).map(([k, v]) => [v, k]),
);

export const toMorse = (text) =>
  [...text.toUpperCase()]
    .map((ch) => (ch === ' ' ? '/' : (MORSE[ch] ?? '')))
    .filter(Boolean)
    .join(' ');

export const fromMorse = (text) =>
  text
    .trim()
    .split(/\s*\/\s*|\s{2,}/)
    .map((word) =>
      word
        .split(/\s+/)
        .map((code) => FROM_MORSE[code] ?? '')
        .join(''),
    )
    .join(' ')
    .trim();

export const CIPHERS = [
  {
    id: 'caesar',
    label: 'Caesar shift',
    key: 'number',
    keyLabel: 'Shift',
    keyDefault: 3,
  },
  { id: 'rot13', label: 'ROT13' },
  { id: 'atbash', label: 'Atbash' },
  {
    id: 'vigenere',
    label: 'Vigenère',
    key: 'text',
    keyLabel: 'Keyword',
    keyDefault: 'key',
  },
  {
    id: 'railfence',
    label: 'Rail fence',
    key: 'number',
    keyLabel: 'Rails',
    keyDefault: 3,
  },
  { id: 'a1z26', label: 'A1Z26 (numbers)' },
  { id: 'morse', label: 'Morse code' },
  { id: 'reverse', label: 'Reversed text' },
];

export function runCipher(id, text, key, decode) {
  switch (id) {
    case 'caesar':
      return caesar(text, decode ? -Number(key || 0) : Number(key || 0));
    case 'rot13':
      return rot13(text);
    case 'atbash':
      return atbash(text);
    case 'vigenere':
      return vigenere(text, String(key ?? ''), decode);
    case 'railfence':
      return railFence(text, Number(key || 3), decode);
    case 'a1z26':
      return decode ? fromNumbers(text) : toNumbers(text);
    case 'morse':
      return decode ? fromMorse(text) : toMorse(text);
    case 'reverse':
      return reverseText(text);
    default:
      return text;
  }
}

// ─── Cracking ─────────────────────────────────────────────────────────

// How often each letter turns up in English, as a share of all letters.
const ENGLISH = [
  8.2, 1.5, 2.8, 4.3, 12.7, 2.2, 2.0, 6.1, 7.0, 0.2, 0.8, 4.0, 2.4, 6.7, 7.5,
  1.9, 0.1, 6.0, 6.3, 9.1, 2.8, 1.0, 2.4, 0.2, 2.0, 0.1,
];
const COMMON = [
  'the',
  'and',
  'that',
  'have',
  'for',
  'not',
  'with',
  'you',
  'this',
  'but',
  'his',
  'from',
  'they',
  'she',
  'her',
  'been',
  'are',
  'was',
  'were',
  'what',
  'when',
  'there',
  'their',
  'would',
  'about',
  'hello',
  'world',
];

// Lower is more English-looking: the difference from the usual letter mix, minus
// a bonus for every common word that shows up.
export function englishScore(text) {
  const letters = text.toUpperCase().replaceAll(/[^A-Z]/g, '');
  if (letters.length < 2) return 1000;
  const counts = Array(26).fill(0);
  for (const ch of letters) counts[ch.charCodeAt(0) - A]++;
  let difference = 0;
  for (let i = 0; i < 26; i++)
    difference += Math.abs((counts[i] / letters.length) * 100 - ENGLISH[i]);
  const words = text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  const hits = words.filter((w) => COMMON.includes(w)).length;
  return difference - hits * 12;
}

// Tries everything it knows and hands back the best guesses first.
export function crack(text, { limit = 8 } = {}) {
  const tries = [];
  const add = (cipher, note, out) => {
    const clean = (out ?? '').trim();
    if (clean.length > 1 && clean !== text.trim())
      tries.push({ cipher, note, text: clean, score: englishScore(clean) });
  };
  for (let shift = 1; shift < 26; shift++)
    add('Caesar shift', `shift ${shift}`, caesar(text, -shift));
  add('Atbash', '', atbash(text));
  add('Reversed text', '', reverseText(text));
  if (/[.\-/]/.test(text) && /^[\s.\-/]+$/.test(text.trim()))
    add('Morse code', '', fromMorse(text));
  if (/\d/.test(text)) add('A1Z26', '', fromNumbers(text));
  for (let rails = 2; rails <= 10; rails++)
    add('Rail fence', `${rails} rails`, railFence(text, rails, true));
  // Vigenère with a short keyword: every word of the key found one letter at a time.
  for (let length = 2; length <= 6; length++) {
    const key = guessVigenereKey(text, length);
    if (key)
      add(
        'Vigenère',
        `keyword "${key.toLowerCase()}"`,
        vigenere(text, key, true),
      );
  }
  return tries.sort((a, b) => a.score - b.score).slice(0, limit);
}

// For a given key length, each slice of the message is its own Caesar shift, so
// the best-scoring shift for each slice spells out the keyword.
function guessVigenereKey(text, length) {
  const letters = text.toUpperCase().replaceAll(/[^A-Z]/g, '');
  if (letters.length < length * 4) return null;
  let key = '';
  for (let offset = 0; offset < length; offset++) {
    let slice = '';
    for (let i = offset; i < letters.length; i += length) slice += letters[i];
    let best = 0;
    let bestScore = Infinity;
    for (let shift = 0; shift < 26; shift++) {
      const score = englishScore(caesar(slice, -shift));
      if (score < bestScore) {
        bestScore = score;
        best = shift;
      }
    }
    key += String.fromCharCode(A + best);
  }
  return key;
}
