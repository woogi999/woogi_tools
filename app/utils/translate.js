// The Translator's engine: Google Translate, reached through this site's
// Worker at /api/translate (see worker/index.js), or straight from the page
// when there is no Worker in front of it. Translating needs a server, so unlike
// most of the text tools this one does send what you type away; the page says so.
//
//   translate(text, from, to, { signal }) -> { text, detected }
//
// `from` may be 'auto'; `detected` is the language Google decided it was.

const ENDPOINT = '/api/translate';
// Google's Chrome-extension translation endpoint. The older
// translate.googleapis.com/translate_a/single answers `client=gtx` with a 429
// for most shared addresses now; this one is not throttled that way and sends
// `Access-Control-Allow-Origin: *`, so the page can call it itself.
const PUBLIC_ENDPOINT = 'https://clients5.google.com/translate_a/t';

export const LANGUAGES = [
  { code: 'af', label: 'Afrikaans' },
  { code: 'sq', label: 'Albanian' },
  { code: 'am', label: 'Amharic' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hy', label: 'Armenian' },
  { code: 'az', label: 'Azerbaijani' },
  { code: 'eu', label: 'Basque' },
  { code: 'be', label: 'Belarusian' },
  { code: 'bn', label: 'Bengali' },
  { code: 'bs', label: 'Bosnian' },
  { code: 'bg', label: 'Bulgarian' },
  { code: 'ca', label: 'Catalan' },
  { code: 'ceb', label: 'Cebuano' },
  { code: 'zh-CN', label: 'Chinese (Simplified)' },
  { code: 'zh-TW', label: 'Chinese (Traditional)' },
  { code: 'hr', label: 'Croatian' },
  { code: 'cs', label: 'Czech' },
  { code: 'da', label: 'Danish' },
  { code: 'nl', label: 'Dutch' },
  { code: 'en', label: 'English' },
  { code: 'eo', label: 'Esperanto' },
  { code: 'et', label: 'Estonian' },
  { code: 'fi', label: 'Finnish' },
  { code: 'fr', label: 'French' },
  { code: 'gl', label: 'Galician' },
  { code: 'ka', label: 'Georgian' },
  { code: 'de', label: 'German' },
  { code: 'el', label: 'Greek' },
  { code: 'gu', label: 'Gujarati' },
  { code: 'ht', label: 'Haitian Creole' },
  { code: 'ha', label: 'Hausa' },
  { code: 'he', label: 'Hebrew' },
  { code: 'hi', label: 'Hindi' },
  { code: 'hmn', label: 'Hmong' },
  { code: 'hu', label: 'Hungarian' },
  { code: 'is', label: 'Icelandic' },
  { code: 'ig', label: 'Igbo' },
  { code: 'id', label: 'Indonesian' },
  { code: 'ga', label: 'Irish' },
  { code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'jv', label: 'Javanese' },
  { code: 'kn', label: 'Kannada' },
  { code: 'kk', label: 'Kazakh' },
  { code: 'km', label: 'Khmer' },
  { code: 'ko', label: 'Korean' },
  { code: 'ku', label: 'Kurdish' },
  { code: 'ky', label: 'Kyrgyz' },
  { code: 'lo', label: 'Lao' },
  { code: 'la', label: 'Latin' },
  { code: 'lv', label: 'Latvian' },
  { code: 'lt', label: 'Lithuanian' },
  { code: 'lb', label: 'Luxembourgish' },
  { code: 'mk', label: 'Macedonian' },
  { code: 'mg', label: 'Malagasy' },
  { code: 'ms', label: 'Malay' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'mt', label: 'Maltese' },
  { code: 'mi', label: 'Maori' },
  { code: 'mr', label: 'Marathi' },
  { code: 'mn', label: 'Mongolian' },
  { code: 'my', label: 'Myanmar (Burmese)' },
  { code: 'ne', label: 'Nepali' },
  { code: 'no', label: 'Norwegian' },
  { code: 'ps', label: 'Pashto' },
  { code: 'fa', label: 'Persian' },
  { code: 'pl', label: 'Polish' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'pa', label: 'Punjabi' },
  { code: 'ro', label: 'Romanian' },
  { code: 'ru', label: 'Russian' },
  { code: 'sm', label: 'Samoan' },
  { code: 'gd', label: 'Scots Gaelic' },
  { code: 'sr', label: 'Serbian' },
  { code: 'st', label: 'Sesotho' },
  { code: 'sn', label: 'Shona' },
  { code: 'sd', label: 'Sindhi' },
  { code: 'si', label: 'Sinhala' },
  { code: 'sk', label: 'Slovak' },
  { code: 'sl', label: 'Slovenian' },
  { code: 'so', label: 'Somali' },
  { code: 'es', label: 'Spanish' },
  { code: 'su', label: 'Sundanese' },
  { code: 'sw', label: 'Swahili' },
  { code: 'sv', label: 'Swedish' },
  { code: 'tl', label: 'Tagalog (Filipino)' },
  { code: 'tg', label: 'Tajik' },
  { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' },
  { code: 'th', label: 'Thai' },
  { code: 'tr', label: 'Turkish' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'ur', label: 'Urdu' },
  { code: 'uz', label: 'Uzbek' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'cy', label: 'Welsh' },
  { code: 'xh', label: 'Xhosa' },
  { code: 'yi', label: 'Yiddish' },
  { code: 'yo', label: 'Yoruba' },
  { code: 'zu', label: 'Zulu' },
];

export const languageLabel = (code) =>
  LANGUAGES.find((l) => l.code === code)?.label ??
  // Google reports a script-less code for the Chinese variants.
  (code?.startsWith('zh') ? 'Chinese' : code);

// The reply is a one-element array. Asked to detect the language it is
// [[translated, detected]]; told the language outright it is just [translated].
export function parseGoogle(data) {
  const first = Array.isArray(data) ? data[0] : null;
  if (Array.isArray(first))
    return {
      text: typeof first[0] === 'string' ? first[0] : '',
      detected: typeof first[1] === 'string' ? first[1] : null,
    };
  return { text: typeof first === 'string' ? first : '', detected: null };
}

export const googleUrl = (text, from, to) =>
  `${PUBLIC_ENDPOINT}?${new URLSearchParams({
    client: 'dict-chrome-ex',
    sl: from || 'auto',
    tl: to,
    q: text,
  })}`;

export async function translate(text, from, to, { signal } = {}) {
  if (!text.trim()) return { text: '', detected: null };
  let response;
  try {
    // eslint-disable-next-line warp-drive/no-external-request-patterns -- our own Worker route
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, from, to }),
      signal,
    });
    // A static host answers the API path with the app shell or a 404. And
    // Google rate-limits the Worker's datacenter address far harder than a
    // home connection, so a 429 (or any Worker-side failure) is worth
    // retrying straight from the page rather than reporting as "busy".
    if (
      response.status === 404 ||
      response.status === 405 ||
      response.status === 429 ||
      response.status >= 500 ||
      !response.headers.get('content-type')?.includes('json')
    )
      response = null;
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    response = null;
  }
  if (response) {
    const body = await response.json();
    if (!response.ok || body.error)
      throw new Error(body.error || 'The translation failed.');
    return body;
  }
  // eslint-disable-next-line warp-drive/no-external-request-patterns -- Google Translate's public endpoint
  const direct = await fetch(googleUrl(text, from, to), { signal });
  if (!direct.ok) throw new Error('The translation failed.');
  return parseGoogle(await direct.json());
}
