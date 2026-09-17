// The writing tools' checker: LanguageTool, reached through this site's Worker
// at /api/grammar (see worker/index.js). LanguageTool is a server, so unlike
// the rest of the text tools this one does send your writing away to be read.
// Both pages that use it say so.
//
//   check(text)            -> { matches, language, languageCode }
//   applyMatch(text, m, r) -> the text with one suggestion taken
//   applyAll(text, ms)     -> the text with every first suggestion taken
//
// A match is { offset, length, message, replacements, issueType, category }.

const ENDPOINT = '/api/grammar';
// Used when there is no Worker in front of the page (development, or a plain
// static host). LanguageTool's public API allows cross-origin requests.
const PUBLIC_ENDPOINT = 'https://api.languagetool.org/v2/check';

// LanguageTool's issue types, grouped the way the pages colour them: a real
// mistake, a punctuation or spacing slip, or a suggestion about style.
const KINDS = {
  misspelling: 'spelling',
  typographical: 'punctuation',
  whitespace: 'punctuation',
  duplication: 'grammar',
  grammar: 'grammar',
  inconsistency: 'style',
  style: 'style',
  register: 'style',
  locale_violation: 'style',
  redundancy: 'style',
  uncategorized: 'grammar',
};

export const kindOf = (match) =>
  match.categoryId === 'TYPOS'
    ? 'spelling'
    : (KINDS[match.issueType] ?? 'grammar');

export const LANGUAGES = [
  { code: 'auto', label: 'Detect language' },
  { code: 'en-GB', label: 'English (British)' },
  { code: 'en-US', label: 'English (American)' },
  { code: 'de-DE', label: 'German' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)' },
  { code: 'nl', label: 'Dutch' },
  { code: 'it', label: 'Italian' },
  { code: 'pl-PL', label: 'Polish' },
  { code: 'ru-RU', label: 'Russian' },
];

// Whether the Worker route answered last time. `vite` dev serves no Worker, so
// there /api/grammar comes back as the app's own index.html; the same is true
// of any host where the site is served as plain static files. Once that has
// been seen, stop asking and go straight to LanguageTool.
let workerRoute = true;

export async function check(
  text,
  { language = 'auto', picky = false, signal } = {},
) {
  if (!text.trim()) return { matches: [], language: '', languageCode: '' };
  if (workerRoute) {
    const viaWorker = await throughWorker(text, language, picky, signal);
    if (viaWorker) return viaWorker;
  }
  return direct(text, language, picky, signal);
}

async function throughWorker(text, language, picky, signal) {
  let response;
  try {
    // eslint-disable-next-line warp-drive/no-external-request-patterns -- our own Worker route
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language, picky }),
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    workerRoute = false;
    return null;
  }
  // No Worker here: fall back for good rather than reporting a failure.
  if (
    response.status === 404 ||
    !(response.headers.get('Content-Type') || '').includes('json')
  ) {
    workerRoute = false;
    return null;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error || 'The checker is unavailable right now.');
  return {
    matches: data.matches ?? [],
    language: data.language ?? '',
    languageCode: data.languageCode ?? '',
  };
}

// Straight to the free public service. It allows cross-origin requests, so the
// page can do this itself; the Worker route is still preferred when there is
// one, because that is the one that can be pointed at a self-hosted instance.
async function direct(text, language, picky, signal) {
  const form = new URLSearchParams({
    text,
    language: language && language !== 'auto' ? language : 'auto',
    level: picky ? 'picky' : 'default',
  });
  if (form.get('language') === 'auto')
    form.set('preferredVariants', 'en-GB,de-DE,pt-BR');

  let response;
  try {
    // eslint-disable-next-line warp-drive/no-external-request-patterns -- LanguageTool's public API
    response = await fetch(PUBLIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form,
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('The checker could not be reached. Check your connection.');
  }
  if (response.status === 429)
    throw new Error(
      'The checker is busy right now. Give it a moment and try again.',
    );
  if (!response.ok) throw new Error('The checker is unavailable right now.');

  const result = await response.json();
  return {
    language: result.language?.name ?? '',
    languageCode: result.language?.code ?? '',
    matches: (result.matches ?? []).map(normalise),
  };
}

// The public API's own shape, flattened to the same one the Worker hands back.
function normalise(m) {
  return {
    offset: m.offset,
    length: m.length,
    message: m.message,
    shortMessage: m.shortMessage || '',
    replacements: (m.replacements ?? []).slice(0, 6).map((r) => r.value),
    ruleId: m.rule?.id ?? '',
    issueType: m.rule?.issueType ?? 'misspelling',
    categoryId: m.rule?.category?.id ?? '',
    category: m.rule?.category?.name ?? '',
    url: m.rule?.urls?.[0]?.value ?? '',
  };
}

export function applyMatch(text, match, replacement) {
  return (
    text.slice(0, match.offset) +
    replacement +
    text.slice(match.offset + match.length)
  );
}

// Back to front, so each edit leaves the offsets of the ones before it alone.
export function applyAll(text, matches) {
  return [...matches]
    .filter((m) => m.replacements?.length)
    .sort((a, b) => b.offset - a.offset)
    .reduce((out, m) => applyMatch(out, m, m.replacements[0]), text);
}

// The text split into the runs between matches and the runs a match covers, so
// a page can underline the problems in place. Overlapping matches are dropped:
// LanguageTool returns them in order, and the first one is the one it is surest of.
export function segments(text, matches) {
  const out = [];
  let at = 0;
  for (const match of [...matches].sort((a, b) => a.offset - b.offset)) {
    if (match.offset < at) continue;
    if (match.offset > at)
      out.push({ id: `t${at}`, text: text.slice(at, match.offset) });
    out.push({
      id: `m${match.offset}`,
      text: text.slice(match.offset, match.offset + match.length),
      match,
    });
    at = match.offset + match.length;
  }
  if (at < text.length) out.push({ id: `t${at}`, text: text.slice(at) });
  return out;
}

// LanguageTool says "Possible spelling mistake found." where the page has room
// for the word itself; its own short message is better when there is one.
export const titleOf = (match) =>
  match.shortMessage || match.category || 'Suggestion';
