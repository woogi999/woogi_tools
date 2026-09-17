// Rewriting text without a model: swaps in plainer (or fancier) words, unpacks
// or tightens contractions, and trims padding. It's a rewriter with opinions,
// not an author: the meaning is yours, it only changes the clothes.

// [formal, plain] pairs. Which way they're swapped depends on the tone you pick.
const PAIRS = [
  ['utilise', 'use'],
  ['utilize', 'use'],
  ['commence', 'start'],
  ['terminate', 'end'],
  ['purchase', 'buy'],
  ['obtain', 'get'],
  ['require', 'need'],
  ['assist', 'help'],
  ['attempt', 'try'],
  ['demonstrate', 'show'],
  ['sufficient', 'enough'],
  ['additional', 'more'],
  ['numerous', 'many'],
  ['approximately', 'about'],
  ['subsequently', 'later'],
  ['previously', 'before'],
  ['currently', 'now'],
  ['frequently', 'often'],
  ['immediately', 'right away'],
  ['initial', 'first'],
  ['final', 'last'],
  ['primary', 'main'],
  ['permit', 'let'],
  ['inform', 'tell'],
  ['request', 'ask'],
  ['residence', 'home'],
  ['vehicle', 'car'],
  ['individual', 'person'],
  ['occupation', 'job'],
  ['comprehend', 'understand'],
  ['construct', 'build'],
  ['endeavour', 'try'],
  ['facilitate', 'make easier'],
  ['implement', 'carry out'],
  ['indicate', 'show'],
  ['modify', 'change'],
  ['notify', 'tell'],
  ['optimal', 'best'],
  ['prioritise', 'put first'],
  ['regarding', 'about'],
  ['sustain', 'keep up'],
  ['transmit', 'send'],
  ['ascertain', 'find out'],
  ['component', 'part'],
  ['difficult', 'hard'],
  ['rapid', 'quick'],
  ['strange', 'odd'],
  ['enormous', 'huge'],
  ['beautiful', 'lovely'],
  ['intelligent', 'clever'],
  ['important', 'key'],
  ['necessary', 'needed'],
  ['possess', 'have'],
  ['sufficient', 'enough'],
  ['therefore', 'so'],
  ['however', 'but'],
  ['moreover', 'and'],
  ['nevertheless', 'even so'],
  ['prior to', 'before'],
  ['in order to', 'to'],
  ['due to the fact that', 'because'],
  ['at this point in time', 'now'],
  ['in the event that', 'if'],
  ['a large number of', 'many'],
  ['the majority of', 'most'],
  ['in addition', 'also'],
  ['as a result', 'so'],
];

const CONTRACTIONS = [
  ['it is', "it's"],
  ['that is', "that's"],
  ['there is', "there's"],
  ['he is', "he's"],
  ['she is', "she's"],
  ['they are', "they're"],
  ['we are', "we're"],
  ['you are', "you're"],
  ['I am', "I'm"],
  ['cannot', "can't"],
  ['do not', "don't"],
  ['does not', "doesn't"],
  ['did not', "didn't"],
  ['is not', "isn't"],
  ['are not', "aren't"],
  ['was not', "wasn't"],
  ['were not', "weren't"],
  ['will not', "won't"],
  ['would not', "wouldn't"],
  ['should not', "shouldn't"],
  ['could not', "couldn't"],
  ['have not', "haven't"],
  ['has not', "hasn't"],
  ['I will', "I'll"],
  ['we will', "we'll"],
  ['you will', "you'll"],
  ['they will', "they'll"],
  ['I have', "I've"],
  ['we have', "we've"],
  ['you have', "you've"],
  ['they have', "they've"],
];

// Padding that can simply go.
const FILLER = [
  /\bbasically\b/gi,
  /\bactually\b/gi,
  /\bliterally\b/gi,
  /\bjust\b/gi,
  /\bvery\b/gi,
  /\breally\b/gi,
  /\bquite\b/gi,
  /\bin order\b/gi,
  /\bthat said,?/gi,
];

export const TONES = [
  {
    id: 'plain',
    label: 'Plainer',
    hint: 'Everyday words instead of long ones, and contractions where they fit.',
  },
  {
    id: 'formal',
    label: 'More formal',
    hint: 'The longer word, contractions spelled out. For letters and reports.',
  },
  {
    id: 'short',
    label: 'Shorter',
    hint: 'Plain words, padding cut, sentences trimmed.',
  },
  {
    id: 'friendly',
    label: 'Friendlier',
    hint: 'Plain and contracted, with the stiff connectives softened.',
  },
];

const keepCase = (original, replacement) =>
  original[0] === original[0].toUpperCase()
    ? replacement[0].toUpperCase() + replacement.slice(1)
    : replacement;

function swapWords(text, toPlain) {
  let out = text;
  for (const [formal, plain] of PAIRS) {
    const from = toPlain ? formal : plain;
    const to = toPlain ? plain : formal;
    // Whole words only, and the capital at the start of a sentence is kept.
    out = out.replaceAll(new RegExp(`\\b${from}\\b`, 'gi'), (m) =>
      keepCase(m, to),
    );
  }
  return out;
}

function contract(text, on) {
  let out = text;
  for (const [long, short] of CONTRACTIONS) {
    const from = on ? long : short;
    const to = on ? short : long;
    out = out.replaceAll(
      new RegExp(`\\b${from.replace("'", "['’]")}\\b`, 'gi'),
      (m) => keepCase(m, to),
    );
  }
  return out;
}

const FRIENDLY = [
  [/\bhowever\b/gi, 'but'],
  [/\btherefore\b/gi, 'so'],
  [/\bin conclusion\b/gi, 'all in all'],
  [/\bplease be advised that\b/gi, 'just so you know,'],
  [/\bwe regret to inform you\b/gi, "we're sorry to say"],
  [/\bdo not hesitate to\b/gi, 'feel free to'],
  [/\bat your earliest convenience\b/gi, 'when you can'],
];

// Gives back a few versions, so you can pick the one that sounds like you.
export function paraphrase(text, tone = 'plain') {
  if (!text.trim()) return [];
  const versions = [];
  if (tone === 'formal') {
    let out = contract(swapWords(text, false), false);
    out = out
      .replaceAll(/\bbut\b/g, 'however')
      .replaceAll(/\bso\b/g, 'therefore');
    versions.push({ label: 'More formal', text: tidy(out) });
    versions.push({
      label: 'More formal, contractions kept',
      text: tidy(swapWords(text, false)),
    });
  } else if (tone === 'short') {
    let out = swapWords(text, true);
    for (const filler of FILLER) out = out.replaceAll(filler, '');
    out = contract(out, true);
    versions.push({ label: 'Shorter', text: tidy(out) });
    versions.push({
      label: 'Shorter, padding kept',
      text: tidy(swapWords(text, true)),
    });
  } else if (tone === 'friendly') {
    let out = contract(swapWords(text, true), true);
    for (const [find, replace] of FRIENDLY)
      out = out.replaceAll(find, (m) => keepCase(m, replace));
    versions.push({ label: 'Friendlier', text: tidy(out) });
    versions.push({
      label: 'Friendlier, a touch more formal',
      text: tidy(swapWords(text, true)),
    });
  } else {
    versions.push({
      label: 'Plainer',
      text: tidy(contract(swapWords(text, true), true)),
    });
    versions.push({
      label: 'Plainer, no contractions',
      text: tidy(swapWords(text, true)),
    });
  }
  // Only worth showing if it's actually different.
  return versions.filter(
    (v, i, all) =>
      v.text !== text.trim() && all.findIndex((x) => x.text === v.text) === i,
  );
}

function tidy(text) {
  return text
    .replaceAll(/ {2,}/g, ' ')
    .replaceAll(/\s+([,.;:!?])/g, '$1')
    .replaceAll(/([.!?])\s*([a-z])/g, (m, stop, letter) => `${stop} ${letter}`)
    .trim();
}

// How much actually changed, so you can see at a glance whether it did anything.
export function howDifferent(before, after) {
  const a = before.toLowerCase().match(/\b[\w']+\b/g) ?? [];
  const b = after.toLowerCase().match(/\b[\w']+\b/g) ?? [];
  const same = b.filter((word, i) => a[i] === word).length;
  return Math.round(
    (1 - same / Math.max(1, Math.max(a.length, b.length))) * 100,
  );
}
