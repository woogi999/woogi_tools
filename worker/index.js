// The site's Worker. Almost everything is a static file served straight from
// the build (see "assets" in wrangler.jsonc); only /api/* runs this code.
//
// GET /api/turn hands the browser short-lived Cloudflare TURN credentials, so
// games and File Share can relay their WebRTC traffic through Cloudflare and
// never show one player's IP address to another. The long-lived key lives in
// Worker secrets (TURN_KEY_ID, TURN_KEY_API_TOKEN), never in this repository.
//
// POST /api/grammar passes a piece of writing to LanguageTool and hands back
// what it found. It goes through the Worker rather than straight from the page
// so the endpoint can be swapped for a self-hosted LanguageTool by setting
// LANGUAGETOOL_URL, and so the browser never has to care where it lives.
//
// POST /api/translate does the same for the Translator with Google Translate's
// public endpoint, so the page never talks to Google itself.

const CREDENTIAL_TTL_S = 6 * 60 * 60;

// The free public service. Point LANGUAGETOOL_URL at your own instance
// (https://host/v2/check) to keep the text on your own infrastructure.
const LANGUAGETOOL_URL = 'https://api.languagetool.org/v2/check';
// The public service caps a request at 20 KB; refuse longer here with a clear
// message rather than letting it come back as an opaque error.
const MAX_TEXT_BYTES = 20000;
// Google Translate, as the browser extensions and most free clients use it.
const TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single';
const MAX_TRANSLATE_CHARS = 5000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/turn') return turn(request, env);
    if (url.pathname === '/api/grammar') return grammar(request, env);
    if (url.pathname === '/api/translate') return translate(request);
    if (url.pathname.startsWith('/api/'))
      return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(request);
  },
};

async function turn(request, env) {
  if (request.method !== 'GET')
    return json({ error: 'Method not allowed' }, 405);
  // Only pages on this site should be spending the TURN allowance.
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin)
    return json({ error: 'Forbidden' }, 403);
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN)
    return json({ error: 'TURN is not configured' }, 503);

  // eslint-disable-next-line warp-drive/no-external-request-patterns -- a Worker calling Cloudflare's API
  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: CREDENTIAL_TTL_S }),
    },
  );
  if (!response.ok) return json({ error: 'TURN credentials unavailable' }, 502);
  const { iceServers } = await response.json();
  // Browsers block port 53, so those URLs would only slow the connection down.
  const servers = [iceServers]
    .flat()
    .map((server) => ({
      ...server,
      urls: [server.urls].flat().filter((u) => !/:53(\?|$)/.test(u)),
    }))
    .filter((server) => server.urls.length);
  return json({ iceServers: servers, ttl: CREDENTIAL_TTL_S });
}

async function grammar(request, env) {
  if (request.method !== 'POST')
    return json({ error: 'Method not allowed' }, 405);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin)
    return json({ error: 'Forbidden' }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected JSON' }, 400);
  }
  const text = typeof body?.text === 'string' ? body.text : '';
  if (!text.trim()) return json({ matches: [] });
  if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES)
    return json(
      {
        error:
          'That is too long to check in one go. Try a few paragraphs at a time.',
      },
      413,
    );

  const language =
    body.language && body.language !== 'auto' ? body.language : 'auto';
  const form = new URLSearchParams({
    text,
    language,
    level: body.picky ? 'picky' : 'default',
  });
  // Detection has to be told which variant to prefer, or it guesses American.
  if (language === 'auto') form.set('preferredVariants', 'en-GB,de-DE,pt-BR');
  if (env.LANGUAGETOOL_USERNAME && env.LANGUAGETOOL_API_KEY) {
    form.set('username', env.LANGUAGETOOL_USERNAME);
    form.set('apiKey', env.LANGUAGETOOL_API_KEY);
  }

  let response;
  try {
    // eslint-disable-next-line warp-drive/no-external-request-patterns -- a Worker calling LanguageTool
    response = await fetch(env.LANGUAGETOOL_URL || LANGUAGETOOL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form,
    });
  } catch {
    return json({ error: 'The checker could not be reached.' }, 502);
  }
  // Its own rate limit is worth passing through as itself, so the page can say so.
  if (response.status === 429)
    return json(
      {
        error: 'The checker is busy right now. Give it a moment and try again.',
      },
      429,
    );
  if (!response.ok)
    return json({ error: 'The checker turned that down.' }, 502);

  const result = await response.json();
  return json({
    language: result.language?.name ?? '',
    languageCode: result.language?.code ?? '',
    matches: (result.matches ?? []).map((m) => ({
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
    })),
  });
}

async function translate(request) {
  if (request.method !== 'POST')
    return json({ error: 'Method not allowed' }, 405);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin)
    return json({ error: 'Forbidden' }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected JSON' }, 400);
  }
  const text = typeof body?.text === 'string' ? body.text : '';
  if (!text.trim()) return json({ text: '', detected: null });
  if (text.length > MAX_TRANSLATE_CHARS)
    return json(
      { error: 'That is too long to translate in one go. Try less at a time.' },
      413,
    );
  const code = (value) =>
    typeof value === 'string' && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(value)
      ? value
      : null;
  const to = code(body.to);
  if (!to) return json({ error: 'Pick a language to translate into.' }, 400);
  const from = code(body.from) ?? 'auto';

  let response;
  try {
    const params = new URLSearchParams({
      client: 'gtx',
      sl: from,
      tl: to,
      dt: 't',
      q: text,
    });
    // eslint-disable-next-line warp-drive/no-external-request-patterns -- a Worker calling Google Translate
    response = await fetch(`${TRANSLATE_URL}?${params}`, {
      headers: { Accept: 'application/json' },
    });
  } catch {
    return json({ error: 'The translator could not be reached.' }, 502);
  }
  if (response.status === 429)
    return json(
      { error: 'The translator is busy right now. Give it a moment.' },
      429,
    );
  if (!response.ok)
    return json({ error: 'The translator turned that down.' }, 502);

  // Google's reply is a nested array: [0] holds [translated, original]
  // segments, [2] the language it detected.
  const data = await response.json();
  const segments = Array.isArray(data?.[0]) ? data[0] : [];
  return json({
    text: segments.map((s) => s?.[0] ?? '').join(''),
    detected: typeof data?.[2] === 'string' ? data[2] : null,
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
