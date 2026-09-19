// Tagalog in Latin letters to Baybayin (the Unicode Tagalog block) and back.
//
// Baybayin writes syllables, not letters. A consonant on its own reads with
// "a"; a kudlit above makes it i/e, one below makes it u/o. A consonant with
// no vowel after it was simply left out in the old script; the Spanish-era
// krus-kudlit (a small cross) and the newer pamudpod were added to write it.

const VOWELS = { a: 'ᜀ', i: 'ᜁ', e: 'ᜁ', u: 'ᜂ', o: 'ᜂ' };
const CONSONANTS = {
  k: 'ᜃ',
  g: 'ᜄ',
  ng: 'ᜅ',
  t: 'ᜆ',
  d: 'ᜇ',
  r: 'ᜇ',
  n: 'ᜈ',
  p: 'ᜉ',
  b: 'ᜊ',
  m: 'ᜋ',
  y: 'ᜌ',
  l: 'ᜎ',
  w: 'ᜏ',
  s: 'ᜐ',
  h: 'ᜑ',
};
const KUDLIT_ABOVE = 'ᜒ';
const KUDLIT_BELOW = 'ᜓ';
const VIRAMA = '᜔';
const PAMUDPOD = '᜕';

export const FINAL_MODES = [
  { id: 'virama', label: 'Krus-kudlit (+)' },
  { id: 'pamudpod', label: 'Pamudpod' },
  { id: 'drop', label: 'Leave out (traditional)' },
];

// Sounds Tagalog never wrote, mapped to the nearest it did.
function nativise(text) {
  return text
    .toLowerCase()
    .replace(/ñ/g, 'ny')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k')
    .replace(/ch/g, 'ts')
    .replace(/f/g, 'p')
    .replace(/j/g, 'dy')
    .replace(/q(?=u)/g, 'k')
    .replace(/q/g, 'k')
    .replace(/v/g, 'b')
    .replace(/x/g, 'ks')
    .replace(/z/g, 's');
}

export function toBaybayin(text, { final = 'virama' } = {}) {
  const marks = { virama: VIRAMA, pamudpod: PAMUDPOD, drop: '' };
  const closer = marks[final] ?? VIRAMA;
  let out = '';
  const words = nativise(text).split(/([^a-z]+)/);
  for (const word of words) {
    if (!/^[a-z]+$/.test(word)) {
      out += word;
      continue;
    }
    let i = 0;
    while (i < word.length) {
      const two = word.slice(i, i + 2);
      let consonant = null;
      if (two === 'ng') {
        consonant = 'ng';
        i += 2;
      } else if (CONSONANTS[word[i]]) {
        consonant = word[i];
        i += 1;
      }
      const vowel = VOWELS[word[i]] !== undefined ? word[i] : null;
      if (consonant && vowel) {
        out += CONSONANTS[consonant];
        if (vowel === 'i' || vowel === 'e') out += KUDLIT_ABOVE;
        else if (vowel === 'u' || vowel === 'o') out += KUDLIT_BELOW;
        i += 1;
      } else if (consonant) {
        out += CONSONANTS[consonant] + closer;
      } else if (vowel) {
        out += VOWELS[vowel];
        i += 1;
      } else {
        // Something with no Baybayin sound at all: keep it as it is.
        out += word[i];
        i += 1;
      }
    }
  }
  return out;
}

const LATIN = new Map([
  ['ᜀ', 'a'],
  ['ᜁ', 'i'],
  ['ᜂ', 'u'],
  ...Object.entries(CONSONANTS)
    .filter(([latin]) => latin !== 'r')
    .map(([latin, glyph]) => [glyph, latin]),
  // Newer Unicode has a separate RA.
  ['ᜟ', 'r'],
]);

export function fromBaybayin(text) {
  let out = '';
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const latin = LATIN.get(ch);
    if (latin === undefined) {
      out += ch;
      continue;
    }
    if ('aiu'.includes(latin)) {
      out += latin;
      continue;
    }
    const next = chars[i + 1];
    if (next === KUDLIT_ABOVE) {
      out += latin + 'i';
      i++;
    } else if (next === KUDLIT_BELOW) {
      out += latin + 'u';
      i++;
    } else if (next === VIRAMA || next === PAMUDPOD) {
      out += latin;
      i++;
    } else {
      out += latin + 'a';
    }
  }
  return out;
}
