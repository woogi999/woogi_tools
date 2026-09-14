// Chat filter for the games. Swearing is fine; slurs and "go kill yourself"
// style abuse are not. Each blocked phrase is written as plain letters and
// turned into a pattern that also catches the usual dodges: repeated letters
// (niiice), look-alike digits and symbols (1 for i, 0 for o, @ for a) and a
// single separator between letters (f.a.g). Matches become asterisks.
//
// Word edges matter here: short stems only match as whole words, so "raccoon",
// "snigger", "spicy" and "retardant" stay untouched.

const LOOKALIKES = {
  a: 'a@4',
  b: 'b8',
  e: 'e3',
  g: 'g9',
  i: 'i1!|l',
  k: 'kq',
  l: 'l1|',
  o: 'o0',
  s: 's$5z',
  t: 't7+',
  u: 'uv',
  y: 'y',
  z: 'zs',
};

const escape = (chars) => chars.replace(/[-\\\]^]/g, '\\$&');

// "fag" -> f+[^a-z0-9]?[a@4]+[^a-z0-9]?g+ ...
function stem(word) {
  return [...word]
    .map((ch) => (ch === ' ' ? '[^a-z0-9]*' : `[${escape(LOOKALIKES[ch] ?? ch)}]+`))
    .join('[^a-z0-9]?');
}

// [phrase, how it may continue]. 'word' needs a clean edge on both sides;
// 'prefix' only on the left (so plurals and -ed/-ing are caught too).
const BLOCKED = [
  ['nigger', 'prefix'],
  ['nigga', 'prefix'],
  ['niggah', 'prefix'],
  ['nigguh', 'prefix'],
  ['sandnigger', 'prefix'],
  ['nignog', 'prefix'],
  ['jigaboo', 'prefix'],
  ['porch monkey', 'prefix'],
  ['faggot', 'prefix'],
  ['fagot', 'prefix'],
  ['fag', 'word'],
  ['fags', 'word'],
  ['dyke', 'word'],
  ['dykes', 'word'],
  ['tranny', 'word'],
  ['trannies', 'word'],
  ['retard', 'word'],
  ['retards', 'word'],
  ['retarded', 'word'],
  ['kike', 'word'],
  ['kikes', 'word'],
  ['spic', 'word'],
  ['spics', 'word'],
  ['spick', 'word'],
  ['chink', 'word'],
  ['chinks', 'word'],
  ['gook', 'word'],
  ['gooks', 'word'],
  ['wetback', 'prefix'],
  ['beaner', 'prefix'],
  ['coon', 'word'],
  ['coons', 'word'],
  ['towelhead', 'prefix'],
  ['raghead', 'prefix'],
  ['zipperhead', 'prefix'],
  ['paki', 'word'],
  ['pakis', 'word'],
  ['golliwog', 'prefix'],
  ['kill yourself', 'prefix'],
  ['kill urself', 'prefix'],
  ['kys', 'word'],
  ['go die', 'word'],
];

const PATTERN = new RegExp(BLOCKED.map(([phrase, edge]) => `(?<![a-z0-9])${stem(phrase)}${edge === 'word' ? '(?![a-z0-9])' : ''}`).join('|'), 'gi');

// Invisible characters people slip between letters to get past filters.
const INVISIBLE = /[\u00AD\u200B-\u200F\u2060\uFEFF]/g;

export const MAX_CHAT_LENGTH = 240;

export function censor(text) {
  const clean = String(text ?? '')
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHAT_LENGTH);
  return clean.replace(PATTERN, (match) => '*'.repeat([...match].length));
}
