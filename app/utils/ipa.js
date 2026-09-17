// English spelling to IPA, the honest way: a dictionary of the awkward words
// everyone uses, then letter rules for everything else. English spelling being
// what it is, the rules are an approximation, not gospel.

// The words the rules would get wrong, and get used constantly.
const WORDS = {
  a: 'ə',
  the: 'ðə',
  to: 'tuː',
  of: 'ʌv',
  and: 'ænd',
  i: 'aɪ',
  you: 'juː',
  he: 'hiː',
  she: 'ʃiː',
  we: 'wiː',
  they: 'ðeɪ',
  is: 'ɪz',
  are: 'ɑːr',
  was: 'wɒz',
  were: 'wɜːr',
  be: 'biː',
  been: 'bɪn',
  being: 'ˈbiːɪŋ',
  am: 'æm',
  have: 'hæv',
  has: 'hæz',
  had: 'hæd',
  do: 'duː',
  does: 'dʌz',
  did: 'dɪd',
  done: 'dʌn',
  go: 'ɡoʊ',
  goes: 'ɡoʊz',
  gone: 'ɡɒn',
  said: 'sɛd',
  says: 'sɛz',
  one: 'wʌn',
  two: 'tuː',
  once: 'wʌns',
  who: 'huː',
  whose: 'huːz',
  what: 'wɒt',
  where: 'wɛr',
  there: 'ðɛr',
  their: 'ðɛr',
  here: 'hɪr',
  why: 'waɪ',
  how: 'haʊ',
  when: 'wɛn',
  which: 'wɪtʃ',
  would: 'wʊd',
  could: 'kʊd',
  should: 'ʃʊd',
  many: 'ˈmɛni',
  any: 'ˈɛni',
  some: 'sʌm',
  come: 'kʌm',
  come_s: 'kʌmz',
  women: 'ˈwɪmɪn',
  woman: 'ˈwʊmən',
  people: 'ˈpiːpəl',
  water: 'ˈwɔːtər',
  other: 'ˈʌðər',
  mother: 'ˈmʌðər',
  father: 'ˈfɑːðər',
  brother: 'ˈbrʌðər',
  again: 'əˈɡɛn',
  against: 'əˈɡɛnst',
  friend: 'frɛnd',
  great: 'ɡreɪt',
  break: 'breɪk',
  steak: 'steɪk',
  laugh: 'læf',
  enough: 'ɪˈnʌf',
  tough: 'tʌf',
  rough: 'rʌf',
  cough: 'kɒf',
  though: 'ðoʊ',
  through: 'θruː',
  thought: 'θɔːt',
  bought: 'bɔːt',
  brought: 'brɔːt',
  caught: 'kɔːt',
  taught: 'tɔːt',
  daughter: 'ˈdɔːtər',
  eight: 'eɪt',
  height: 'haɪt',
  island: 'ˈaɪlənd',
  business: 'ˈbɪznɪs',
  busy: 'ˈbɪzi',
  colonel: 'ˈkɜːrnəl',
  choir: 'ˈkwaɪər',
  science: 'ˈsaɪəns',
  ocean: 'ˈoʊʃən',
  sure: 'ʃʊr',
  sugar: 'ˈʃʊɡər',
  machine: 'məˈʃiːn',
  chef: 'ʃɛf',
  chaos: 'ˈkeɪɒs',
  school: 'skuːl',
  very: 'ˈvɛri',
  every: 'ˈɛvri',
  hello: 'həˈloʊ',
  hour: 'aʊər',
  honest: 'ˈɒnɪst',
  honour: 'ˈɒnər',
  honor: 'ˈɒnər',
  know: 'noʊ',
  knew: 'njuː',
  knife: 'naɪf',
  write: 'raɪt',
  wrote: 'roʊt',
  wrong: 'rɒŋ',
  answer: 'ˈænsər',
  because: 'bɪˈkɒz',
  before: 'bɪˈfɔːr',
  about: 'əˈbaʊt',
  above: 'əˈbʌv',
  love: 'lʌv',
  live: 'lɪv',
  give: 'ɡɪv',
  have_to: 'hæftə',
  your: 'jʊr',
  my: 'maɪ',
  our: 'aʊər',
  her: 'hɜːr',
  him: 'hɪm',
  them: 'ðɛm',
  this: 'ðɪs',
  that: 'ðæt',
  these: 'ðiːz',
  those: 'ðoʊz',
  word: 'wɜːrd',
  world: 'wɜːrld',
  work: 'wɜːrk',
  first: 'fɜːrst',
  girl: 'ɡɜːrl',
  learn: 'lɜːrn',
  heard: 'hɜːrd',
  earth: 'ɜːrθ',
};

// Letter groups, longest first. Each rule is [pattern, phonemes], and the
// pattern may look at what comes next with a lookahead.
const RULES = [
  [/^ough/, 'ʌf'],
  [/^augh/, 'ɔː'],
  [/^eigh/, 'eɪ'],
  [/^tion/, 'ʃən'],
  [/^sion/, 'ʒən'],
  [/^ture/, 'tʃər'],
  [/^ous/, 'əs'],
  [/^air/, 'ɛr'],
  [/^are$/, 'ɛr'],
  [/^ear/, 'ɪr'],
  [/^eer/, 'ɪr'],
  [/^oor/, 'ɔːr'],
  [/^our/, 'aʊər'],
  [/^oul/, 'ʊl'],
  [/^igh/, 'aɪ'],
  [/^dge/, 'dʒ'],
  [/^tch/, 'tʃ'],
  [/^sch/, 'sk'],
  [/^shr/, 'ʃr'],
  [/^thr/, 'θr'],
  [/^wor/, 'wɜːr'],
  [/^wr/, 'r'],
  [/^kn/, 'n'],
  [/^gn/, 'n'],
  [/^ph/, 'f'],
  [/^gh/, 'ɡ'],
  [/^ch/, 'tʃ'],
  [/^sh/, 'ʃ'],
  [/^th/, 'θ'],
  [/^ck/, 'k'],
  [/^qu/, 'kw'],
  [/^ng/, 'ŋ'],
  [/^nk/, 'ŋk'],
  [/^ee/, 'iː'],
  [/^ea/, 'iː'],
  [/^ie/, 'iː'],
  [/^ei/, 'eɪ'],
  [/^oo/, 'uː'],
  [/^oa/, 'oʊ'],
  [/^oe/, 'oʊ'],
  [/^ow/, 'aʊ'],
  [/^ou/, 'aʊ'],
  [/^oi/, 'ɔɪ'],
  [/^oy/, 'ɔɪ'],
  [/^au/, 'ɔː'],
  [/^aw/, 'ɔː'],
  [/^ay/, 'eɪ'],
  [/^ai/, 'eɪ'],
  [/^ew/, 'uː'],
  [/^eu/, 'juː'],
  [/^ue/, 'uː'],
  [/^ui/, 'uː'],
  [/^ar/, 'ɑːr'],
  [/^er/, 'ɜːr'],
  [/^ir/, 'ɜːr'],
  [/^ur/, 'ɜːr'],
  [/^or/, 'ɔːr'],
  // A single vowel with one consonant then a silent e says its own name.
  [/^a(?=[^aeiou]e$)/, 'eɪ'],
  [/^e(?=[^aeiou]e$)/, 'iː'],
  [/^i(?=[^aeiou]e$)/, 'aɪ'],
  [/^o(?=[^aeiou]e$)/, 'oʊ'],
  [/^u(?=[^aeiou]e$)/, 'juː'],
  [/^c(?=[eiy])/, 's'],
  [/^g(?=[eiy])/, 'dʒ'],
  [/^e$/, ''], // silent e
  [/^a/, 'æ'],
  [/^e/, 'ɛ'],
  [/^i/, 'ɪ'],
  [/^o/, 'ɒ'],
  [/^u/, 'ʌ'],
  [/^y/, 'i'],
  [/^b/, 'b'],
  [/^c/, 'k'],
  [/^d/, 'd'],
  [/^f/, 'f'],
  [/^g/, 'ɡ'],
  [/^h/, 'h'],
  [/^j/, 'dʒ'],
  [/^k/, 'k'],
  [/^l/, 'l'],
  [/^m/, 'm'],
  [/^n/, 'n'],
  [/^p/, 'p'],
  [/^r/, 'r'],
  [/^s/, 's'],
  [/^t/, 't'],
  [/^v/, 'v'],
  [/^w/, 'w'],
  [/^x/, 'ks'],
  [/^z/, 'z'],
];

function wordToIpa(word) {
  const known = WORDS[word];
  if (known) return known;
  // Plurals and past tenses of known words, so "friends" isn't a surprise.
  if (word.endsWith('s') && WORDS[word.slice(0, -1)])
    return (
      WORDS[word.slice(0, -1)] +
      (/[sʃʒtʃdʒz]$/.test(WORDS[word.slice(0, -1)]) ? 'ɪz' : 'z')
    );
  let rest = word;
  let out = '';
  while (rest) {
    const rule = RULES.find(([pattern]) => pattern.test(rest));
    if (!rule) {
      rest = rest.slice(1);
      continue;
    }
    out += rule[1];
    rest = rest.replace(rule[0], '');
  }
  return out;
}

// British English is non-rhotic: an r that isn't followed by a vowel goes quiet.
const deRhotic = (ipa) =>
  ipa
    .replaceAll('ɜːr', 'ɜː')
    .replaceAll('ɑːr', 'ɑː')
    .replaceAll('ɔːr', 'ɔː')
    .replaceAll('ɪr', 'ɪə')
    .replaceAll('ɛr', 'eə')
    .replaceAll('ər', 'ə')
    .replaceAll(/r(?![aeiouəɪɛæɑɔʊʌ])/g, '');

export const ACCENTS = [
  { id: 'us', label: 'American (rhotic)' },
  { id: 'uk', label: 'British (non-rhotic)' },
];

// Keeps the spacing and punctuation of the original, so it lines up when you read along.
export function toIpa(text, { accent = 'us', brackets = true } = {}) {
  const out = text.replaceAll(/[A-Za-z']+/g, (word) => {
    const ipa = wordToIpa(word.toLowerCase().replaceAll("'", ''));
    return accent === 'uk' ? deRhotic(ipa) : ipa;
  });
  return brackets ? `/${out.trim()}/` : out;
}

// Word by word, for the table view.
export function ipaWords(text, options) {
  return [...new Set(text.toLowerCase().match(/[a-z']+/g) ?? [])].map(
    (word) => ({
      word,
      ipa: toIpa(word, { ...options, brackets: false }),
      known: Boolean(WORDS[word]),
    }),
  );
}
