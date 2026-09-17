// What's left of the writing tools' own text maths: the reading-ease score the
// Grammar Checker shows under your writing.
//
// The checking itself used to live here too, as a few hundred hand-written
// rules. That has been replaced by LanguageTool (see app/utils/languagetool.js),
// which knows tens of thousands of them, including the auxiliary and modal verb
// mistakes the old rules never covered ("he can goes", "she have been", "we must
// to leave", "you didn't went"). The rules are gone rather than kept as a
// fallback: two checkers disagreeing about the same sentence was worse than one.

// A rough reading-ease score (Flesch), plus the counts people like to see.
export function readability(text) {
  const words = text.match(/\b[\w']+\b/g) ?? [];
  const sentences = text.split(/[.!?]+\s/).filter((s) => s.trim()).length || 1;
  const syllables = words.reduce((sum, word) => sum + countSyllables(word), 0);
  if (!words.length) return null;
  const score =
    206.835 -
    1.015 * (words.length / sentences) -
    84.6 * (syllables / words.length);
  const grade = Math.max(
    1,
    Math.round(
      0.39 * (words.length / sentences) +
        11.8 * (syllables / words.length) -
        15.59,
    ),
  );
  return {
    words: words.length,
    sentences,
    perSentence: Math.round((words.length / sentences) * 10) / 10,
    score: Math.max(0, Math.min(100, Math.round(score))),
    grade,
    label:
      score > 80
        ? 'Very easy'
        : score > 60
          ? 'Plain English'
          : score > 40
            ? 'A bit heavy'
            : 'Hard going',
  };
}

function countSyllables(word) {
  const clean = word.toLowerCase().replaceAll(/[^a-z]/g, '');
  if (clean.length <= 3) return 1;
  const groups = clean
    .replace(/(?:es|ed|[^laeiouy]e)$/, '')
    .match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}
