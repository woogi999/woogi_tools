// A grammar and style checker built out of rules, not a model: it knows the
// mistakes people actually make and can say why each one is a mistake. It won't
// catch everything a big model would, and it never sends your writing anywhere.

// Spelling slips that are always wrong, whatever the sentence.
const MISSPELLINGS = {
  teh: 'the', adn: 'and', recieve: 'receive', recieved: 'received', seperate: 'separate', seperated: 'separated',
  definately: 'definitely', occured: 'occurred', occuring: 'occurring', untill: 'until', wich: 'which',
  thier: 'their', freind: 'friend', beleive: 'believe', acheive: 'achieve', accomodate: 'accommodate',
  neccessary: 'necessary', necesary: 'necessary', enviroment: 'environment', goverment: 'government',
  arguement: 'argument', existance: 'existence', independant: 'independent', occassion: 'occasion',
  publically: 'publicly', responsability: 'responsibility', rythm: 'rhythm', tendancy: 'tendency',
  truely: 'truly', wierd: 'weird', writting: 'writing', alot: 'a lot', cant: "can't", dont: "don't",
  wont: "won't", isnt: "isn't", didnt: "didn't", doesnt: "doesn't", wasnt: "wasn't", couldnt: "couldn't",
  shouldnt: "shouldn't", wouldnt: "wouldn't", ive: "I've", im: "I'm", youre: "you're", theyre: "they're",
  lets: "let's", thats: "that's", whats: "what's", hasnt: "hasn't", havent: "haven't",
};

// Pairs people mix up. Each has a quick way to tell them apart.
const CONFUSIONS = [
  { find: /\byour (welcome|right|wrong|going|coming|doing|not)\b/gi, fix: (m) => m.replace(/^your/i, "you're"), why: "“You're” is short for “you are”; “your” means it belongs to you." },
  { find: /\bits (a|the|been|not|going|too|very|so)\b/gi, fix: (m) => m.replace(/^its/i, "it's"), why: "“It's” is short for “it is”; “its” means belonging to it." },
  { find: /\b(could|would|should|must|might) of\b/gi, fix: (m) => m.replace(/of$/i, 'have'), why: "It sounds like “of”, but it's “could have”, “would have”, “should have”." },
  { find: /\bless (people|things|items|words|files|bugs|cars|books)\b/gi, fix: (m) => m.replace(/^less/i, 'fewer'), why: 'Use “fewer” for things you can count, “less” for amounts.' },
  { find: /\bamount of (people|things|files|items|users|words)\b/gi, fix: (m) => m.replace(/^amount/i, 'number'), why: 'Use “number of” for things you can count.' },
  { find: /\bwould of\b/gi, fix: () => 'would have', why: 'It sounds like “of”, but it is “would have”.' },
];

// Padding that says nothing. Left as suggestions, not errors.
const WORDY = [
  [/\bin order to\b/gi, 'to'],
  [/\bdue to the fact that\b/gi, 'because'],
  [/\bat this point in time\b/gi, 'now'],
  [/\bin the event that\b/gi, 'if'],
  [/\bfor the purpose of\b/gi, 'for'],
  [/\bin spite of the fact that\b/gi, 'although'],
  [/\ba large number of\b/gi, 'many'],
  [/\bthe majority of\b/gi, 'most'],
  [/\bis able to\b/gi, 'can'],
  [/\bhas the ability to\b/gi, 'can'],
  [/\bmake a decision\b/gi, 'decide'],
  [/\bgive consideration to\b/gi, 'consider'],
  [/\bvery unique\b/gi, 'unique'],
  [/\bcompletely eliminate\b/gi, 'eliminate'],
  [/\bfree gift\b/gi, 'gift'],
  [/\bbasically\b/gi, ''],
  [/\bactually\b/gi, ''],
  [/\bliterally\b/gi, ''],
];

const VOWEL_SOUND = /^(a|e|i|o|u|hour|honest|honour|honor|heir)/i;
const CONSONANT_SOUND = /^(uni|use|user|usual|euro|one|once)/i;

const issue = (kind, at, text, message, why, fix) => ({ kind, at, end: at + text.length, text, message, why, fix });

// Every problem found, in the order they appear in the text.
export function checkText(text) {
  const found = [];

  // Spelling
  for (const match of text.matchAll(/\b[\w']+\b/g)) {
    const word = match[0];
    const lower = word.toLowerCase();
    const right = MISSPELLINGS[lower];
    if (!right) continue;
    const cased = word[0] === word[0].toUpperCase() ? right[0].toUpperCase() + right.slice(1) : right;
    found.push(issue('spelling', match.index, word, `“${word}” → “${cased}”`, 'A common misspelling.', cased));
  }

  // Words people mix up
  for (const rule of CONFUSIONS) {
    for (const match of text.matchAll(rule.find)) {
      found.push(issue('grammar', match.index, match[0], `“${match[0]}” → “${rule.fix(match[0])}”`, rule.why, rule.fix(match[0])));
    }
  }

  // a / an
  for (const match of text.matchAll(/\b(a|an)\s+([A-Za-z]+)/g)) {
    const [whole, article, word] = match;
    const wantsAn = VOWEL_SOUND.test(word) && !CONSONANT_SOUND.test(word);
    const right = wantsAn ? 'an' : 'a';
    if (article.toLowerCase() === right) continue;
    const fixed = whole.replace(article, article[0] === article[0].toUpperCase() ? right[0].toUpperCase() + right.slice(1) : right);
    found.push(issue('grammar', match.index, whole, `“${whole}” → “${fixed}”`, `“${word}” starts with a ${wantsAn ? 'vowel' : 'consonant'} sound.`, fixed));
  }

  // The same word twice in a row
  for (const match of text.matchAll(/\b(\w+)\s+\1\b/gi)) {
    found.push(issue('typo', match.index, match[0], `“${match[0]}” → “${match[1]}”`, 'The same word twice over.', match[1]));
  }

  // Spacing and punctuation
  for (const match of text.matchAll(/\s+([,.;:!?])/g)) {
    found.push(issue('punctuation', match.index, match[0], `Remove the space before “${match[1]}”`, 'Punctuation sits tight against the word before it.', match[1]));
  }
  for (const match of text.matchAll(/([,;:])(?=[^\s\d])/g)) {
    found.push(issue('punctuation', match.index, match[0], `Add a space after “${match[1]}”`, 'A space follows a comma or colon.', `${match[1]} `));
  }
  for (const match of text.matchAll(/ {2,}(?=\S)/g)) {
    found.push(issue('spacing', match.index, match[0], 'Two spaces in a row', 'One space between words is plenty.', ' '));
  }

  // A sentence starting lower case
  for (const match of text.matchAll(/(^|[.!?]\s+)([a-z])/g)) {
    const at = match.index + match[1].length;
    found.push(issue('capitals', at, match[2], `Capitalise “${match[2]}”`, 'Sentences start with a capital letter.', match[2].toUpperCase()));
  }

  // Lower-case "i"
  for (const match of text.matchAll(/\bi\b(?!['’])/g)) {
    found.push(issue('capitals', match.index, 'i', '“i” → “I”', 'The word “I” is always a capital.', 'I'));
  }

  // Padding
  for (const [find, better] of WORDY) {
    for (const match of text.matchAll(find)) {
      found.push(issue('style', match.index, match[0], better ? `“${match[0]}” → “${better}”` : `“${match[0]}” adds nothing`, 'Shorter says the same thing.', better));
    }
  }

  // Passive voice: worth a look, never simply wrong.
  for (const match of text.matchAll(/\b(was|were|is|are|been|being)\s+(\w+ed|written|made|done|taken|given|seen|known|found|held|built|sent|kept)\b(\s+by\b)?/gi)) {
    found.push(issue('style', match.index, match[0], 'Passive voice', 'Saying who did it is usually livelier — “the cat knocked it over”, not “it was knocked over”.', null));
  }

  // Long sentences
  for (const match of text.matchAll(/[^.!?]+[.!?]/g)) {
    const words = match[0].trim().split(/\s+/).length;
    if (words > 40) found.push(issue('style', match.index, match[0].trim().slice(0, 60), `A ${words}-word sentence`, 'Long sentences are hard to follow — try splitting it.', null));
  }

  return found.sort((a, b) => a.at - b.at || a.end - b.end);
}

// Applies every fix that has one, back to front so the positions stay put.
export function applyFixes(text, issues) {
  let out = text;
  let lastStart = text.length;
  for (const found of [...issues].sort((a, b) => b.at - a.at)) {
    // Two rules can land on the same words; the later one wins and the other is left alone.
    if (found.fix == null || found.end > lastStart) continue;
    out = out.slice(0, found.at) + found.fix + out.slice(found.end);
    lastStart = found.at;
  }
  return out.replaceAll(/ {2,}/g, ' ').replaceAll(/\s+([,.;:!?])/g, '$1');
}

// A rough reading-ease score (Flesch), plus the counts people like to see.
export function readability(text) {
  const words = text.match(/\b[\w']+\b/g) ?? [];
  const sentences = text.split(/[.!?]+\s/).filter((s) => s.trim()).length || 1;
  const syllables = words.reduce((sum, word) => sum + countSyllables(word), 0);
  if (!words.length) return null;
  const score = 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syllables / words.length);
  const grade = Math.max(1, Math.round(0.39 * (words.length / sentences) + 11.8 * (syllables / words.length) - 15.59));
  return {
    words: words.length,
    sentences,
    perSentence: Math.round((words.length / sentences) * 10) / 10,
    score: Math.max(0, Math.min(100, Math.round(score))),
    grade,
    label: score > 80 ? 'Very easy' : score > 60 ? 'Plain English' : score > 40 ? 'A bit heavy' : 'Hard going',
  };
}

function countSyllables(word) {
  const clean = word.toLowerCase().replaceAll(/[^a-z]/g, '');
  if (clean.length <= 3) return 1;
  const groups = clean.replace(/(?:es|ed|[^laeiouy]e)$/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}
