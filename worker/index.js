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
//
// GET /api/relay-room is File Share's fallback transport: a WebSocket that
// forwards file pieces between two browsers that WebRTC could not introduce
// to each other (see worker/relay-room.js). It is deliberately not a TURN
// server; it is a plain socket on 443, which is what gets it through networks
// that block UDP.
//
// GET /api/roblox fetches public Roblox assets and their details for the
// Roblox Asset Viewer, since Roblox's endpoints refuse browsers on other sites.
//
// GET /api/osint backs the OSINT tools, whose sources refuse browsers on
// other sites: kind=username checks one site from app/utils/username-sites.js
// for one name (the page asks for each site separately, so results stream in),
// kind=subdomains reads certificate-transparency logs through crt.sh (with
// Cert Spotter as the fallback), kind=wayback is the Internet Archive's
// capture calendar for a URL, and kind=breaches is Have I Been Pwned's public list of
// known breaches, and kind=leakcheck asks LeakCheck's public API which leaks
// an email address appears in. Nothing is stored; each answer is only cached briefly.
//
// Disposable Emails: mail sent to <anything>@temp.woogi.xyz reaches the
// email() handler below through Cloudflare Email Routing, is parsed, and is
// kept in the TEMP_MAIL KV namespace for an hour. GET /api/mail?box=<name>
// lists a box, and &id=<id> fetches one message. The box name is the only
// secret: the page makes a long random one and never shows it to anyone else.

import PostalMime from 'postal-mime';
import { USERNAME_SITES, checkSite } from '../app/utils/username-sites.js';

export { RelayRoom } from './relay-room.js';

const CREDENTIAL_TTL_S = 6 * 60 * 60;

// The free public service. Point LANGUAGETOOL_URL at your own instance
// (https://host/v2/check) to keep the text on your own infrastructure.
const LANGUAGETOOL_URL = 'https://api.languagetool.org/v2/check';
// The public service caps a request at 20 KB; refuse longer here with a clear
// message rather than letting it come back as an opaque error.
const MAX_TEXT_BYTES = 20000;
// Google Translate, as the browser extensions and most free clients use it.
// Google's Chrome-extension translation endpoint. The older
// translate.googleapis.com/translate_a/single answers `client=gtx` with a 429
// for almost every datacenter address, which is what a Worker calls from, so
// the Translator used to report "busy" more or less permanently.
const TRANSLATE_URL = 'https://clients5.google.com/translate_a/t';
const MAX_TRANSLATE_CHARS = 5000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/turn') return turn(request, env);
    if (url.pathname === '/api/grammar') return grammar(request, env);
    if (url.pathname === '/api/translate') return translate(request);
    if (url.pathname === '/api/roblox') return roblox(request);
    if (url.pathname === '/api/osint') return osint(request);
    if (url.pathname === '/api/mail') return mail(request, env);
    if (url.pathname === '/api/relay-room') return relayRoom(request, env);
    if (url.pathname.startsWith('/api/'))
      return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(request);
  },

  async email(message, env) {
    if (!env.TEMP_MAIL) return;
    const box = boxOf(message.to);
    if (!box) return;
    const parsed = await PostalMime.parse(message.raw);
    const id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const record = {
      id,
      box,
      from: parsed.from?.address ?? message.from,
      fromName: parsed.from?.name ?? '',
      to: message.to,
      subject: parsed.subject ?? '',
      date: parsed.date ?? new Date().toISOString(),
      text: (parsed.text ?? '').slice(0, MAIL_MAX_BODY),
      html: (parsed.html ?? '').slice(0, MAIL_MAX_BODY),
      attachments: (parsed.attachments ?? []).map((a) => ({
        name: a.filename ?? 'attachment',
        type: a.mimeType ?? '',
        size: a.content?.byteLength ?? 0,
      })),
    };
    await env.TEMP_MAIL.put(`${box}:${id}`, JSON.stringify(record), {
      expirationTtl: MAIL_TTL_S,
    });
  },
};

const MAIL_TTL_S = 60 * 60;
const MAIL_MAX_BODY = 200 * 1024;
const MAIL_DOMAIN = 'temp.woogi.xyz';
const BOX_NAME = /^[a-z0-9]{6,32}$/;

// The part before the @, lower-cased, if the address is one of ours.
function boxOf(address) {
  const m = String(address ?? '')
    .toLowerCase()
    .match(/^([a-z0-9._+-]+)@([a-z0-9.-]+)$/);
  if (!m || m[2] !== MAIL_DOMAIN) return null;
  const box = m[1].replace(/[^a-z0-9]/g, '');
  return BOX_NAME.test(box) ? box : null;
}

async function mail(request, env) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin)
    return json({ error: 'Forbidden' }, 403);
  if (!env.TEMP_MAIL)
    return json(
      { error: 'Disposable email is not set up on this server.' },
      503,
    );
  const params = new URL(request.url).searchParams;
  const box = params.get('box') ?? '';
  if (!BOX_NAME.test(box)) return json({ error: 'Bad box name' }, 400);
  const id = params.get('id');

  if (request.method === 'DELETE') {
    const { keys } = await env.TEMP_MAIL.list({ prefix: `${box}:` });
    await Promise.all(keys.map((k) => env.TEMP_MAIL.delete(k.name)));
    return json({ ok: true });
  }
  if (request.method !== 'GET')
    return json({ error: 'Method not allowed' }, 405);

  if (id) {
    const raw = await env.TEMP_MAIL.get(`${box}:${id}`);
    if (!raw) return json({ error: 'That message has gone.' }, 404);
    return json(JSON.parse(raw));
  }
  const { keys } = await env.TEMP_MAIL.list({ prefix: `${box}:` });
  const messages = await Promise.all(
    keys.map(async (k) => {
      const raw = await env.TEMP_MAIL.get(k.name);
      if (!raw) return null;
      const m = JSON.parse(raw);
      return {
        id: m.id,
        from: m.from,
        fromName: m.fromName,
        subject: m.subject,
        date: m.date,
        preview: (m.text || '').replace(/\s+/g, ' ').slice(0, 120),
        attachments: m.attachments.length,
        expires: k.expiration ? k.expiration * 1000 : null,
      };
    }),
  );
  return json({
    address: `${box}@${MAIL_DOMAIN}`,
    ttl: MAIL_TTL_S,
    messages: messages
      .filter(Boolean)
      .sort((a, b) => (b.date > a.date ? 1 : -1)),
  });
}

// Hands the socket to the Durable Object named after the share code, so both
// sides of one share land in the same room and no other share can see it.
function relayRoom(request, env) {
  if (!env.RELAY_ROOM)
    return json({ error: 'The relay is not configured' }, 503);
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  // Only pages on this site should be opening rooms.
  if (origin && origin !== url.origin) return json({ error: 'Forbidden' }, 403);
  const code = (url.searchParams.get('code') || '').toUpperCase();
  // The same alphabet File Share generates codes from (utils/file-share.js).
  if (!/^[A-HJ-NP-Z2-9]{4,12}$/.test(code))
    return json({ error: 'Bad room code' }, 400);
  const room = env.RELAY_ROOM.get(env.RELAY_ROOM.idFromName(code));
  return room.fetch(request);
}

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
      client: 'dict-chrome-ex',
      sl: from,
      tl: to,
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

  // The reply is a one-element array. Asked to detect the language it is
  // [[translated, detected]]; told the language outright it is just
  // [translated].
  const data = await response.json();
  const first = Array.isArray(data) ? data[0] : null;
  const pair = Array.isArray(first) ? first : [first, null];
  return json({
    text: typeof pair[0] === 'string' ? pair[0] : '',
    detected: typeof pair[1] === 'string' ? pair[1] : null,
  });
}

// The Roblox Asset Viewer. Roblox's public endpoints don't allow browsers on
// other sites to call them, so the page asks here and this fetches on its
// behalf. Only public assets come back; anything Roblox restricts stays that
// way. `kind` picks what to fetch:
//   details  what the asset is (name, type, creator)
//   thumb    the 2D thumbnail's image URL
//   asset    the file itself (audio, an image, a decal's XML)
//   3d       the pieces Roblox's own 3D thumbnails are drawn from
//   cdn      one of those pieces, by its hash
const ROBLOX_CACHE = 'public, max-age=3600';
const ASSET_ID = /^\d{1,20}$/;
const CDN_HASH = /^[a-f0-9]{32}/;

async function roblox(request) {
  if (request.method !== 'GET')
    return json({ error: 'Method not allowed' }, 405);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin)
    return json({ error: 'Forbidden' }, 403);
  const params = new URL(request.url).searchParams;
  const kind = params.get('kind');
  const id = params.get('id') ?? '';
  const hash = (params.get('hash') ?? '').match(CDN_HASH)?.[0];

  try {
    if (kind === 'cdn') {
      if (!hash) return json({ error: 'Bad hash' }, 400);
      // eslint-disable-next-line warp-drive/no-external-request-patterns -- a Worker calling Roblox's CDN
      return passThrough(await fetch(cdnUrl(hash)));
    }
    if (!ASSET_ID.test(id)) return json({ error: 'Bad asset id' }, 400);

    if (kind === 'details') {
      // eslint-disable-next-line warp-drive/no-external-request-patterns -- a Worker calling Roblox
      const response = await fetch(
        `https://economy.roblox.com/v2/assets/${id}/details`,
        { headers: { Accept: 'application/json' } },
      );
      if (!response.ok)
        return json({ error: 'Roblox has no public asset with that id.' }, 404);
      const d = await response.json();
      return json(
        {
          id: d.AssetId,
          name: d.Name ?? '',
          description: d.Description ?? '',
          typeId: d.AssetTypeId,
          creator: d.Creator?.Name ?? '',
          created: d.Created ?? null,
          updated: d.Updated ?? null,
        },
        200,
        ROBLOX_CACHE,
      );
    }
    if (kind === 'thumb') {
      // eslint-disable-next-line warp-drive/no-external-request-patterns -- a Worker calling Roblox
      const response = await fetch(
        `https://thumbnails.roblox.com/v1/assets?assetIds=${id}&size=420x420&format=Png&isCircular=false`,
      );
      const d = response.ok ? await response.json() : null;
      const entry = d?.data?.[0];
      return json(
        { url: entry?.state === 'Completed' ? entry.imageUrl : null },
        200,
        ROBLOX_CACHE,
      );
    }
    if (kind === 'asset') {
      // eslint-disable-next-line warp-drive/no-external-request-patterns -- a Worker calling Roblox
      const response = await fetch(
        `https://assetdelivery.roblox.com/v1/asset/?id=${id}`,
        { redirect: 'follow' },
      );
      if (response.status === 403 || response.status === 401)
        return json(
          {
            error: 'Roblox keeps that asset private, so it cannot be fetched.',
          },
          403,
        );
      if (!response.ok)
        return json({ error: 'Roblox did not hand that asset over.' }, 404);
      return passThrough(response);
    }
    if (kind === '3d') {
      // eslint-disable-next-line warp-drive/no-external-request-patterns -- a Worker calling Roblox
      const response = await fetch(
        `https://thumbnails.roblox.com/v1/assets-thumbnail-3d?assetId=${id}`,
      );
      const d = response.ok ? await response.json() : null;
      if (d?.state !== 'Completed' || !d.imageUrl)
        return json({ error: 'Roblox has no 3D view of that asset.' }, 404);
      // eslint-disable-next-line warp-drive/no-external-request-patterns -- a Worker calling Roblox's CDN
      const parts = await (await fetch(d.imageUrl)).json();
      if (!parts?.obj) return json({ error: 'That 3D view is empty.' }, 404);
      return json(
        {
          obj: parts.obj,
          mtl: parts.mtl ?? null,
          textures: parts.textures ?? [],
          camera: parts.camera ?? null,
          aabb: parts.aabb ?? null,
        },
        200,
        ROBLOX_CACHE,
      );
    }
    return json({ error: 'Unknown kind' }, 400);
  } catch {
    return json({ error: 'Roblox could not be reached.' }, 502);
  }
}

// Roblox spreads its CDN over eight hosts, picked from the hash itself.
function cdnUrl(hash) {
  let t = 31;
  for (let i = 0; i < 32; i++) t ^= hash.charCodeAt(i);
  return `https://t${t % 8}.rbxcdn.com/${hash}`;
}

const OSINT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 woogi-tools-osint';
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

async function osint(request) {
  if (request.method !== 'GET')
    return json({ error: 'Method not allowed' }, 405);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin)
    return json({ error: 'Forbidden' }, 403);
  const params = new URL(request.url).searchParams;
  const kind = params.get('kind');
  try {
    if (kind === 'username') return await osintUsername(params);
    if (kind === 'subdomains') return await osintSubdomains(params);
    if (kind === 'wayback') return await osintWayback(params);
    if (kind === 'breaches') return await osintBreaches();
    if (kind === 'leakcheck') return await osintLeakCheck(params);
    return json({ error: 'Unknown kind' }, 400);
  } catch {
    return json({ error: 'The source did not answer in time.' }, 502);
  }
}

function osintFetch(url, timeout = 10000, init = {}) {
  // eslint-disable-next-line warp-drive/no-external-request-patterns -- a Worker calling public OSINT sources
  return fetch(url, {
    redirect: 'follow',
    ...init,
    headers: { 'User-Agent': OSINT_UA, Accept: '*/*', ...init.headers },
    signal: AbortSignal.timeout(timeout),
  });
}

async function osintUsername(params) {
  const site = USERNAME_SITES[Number(params.get('site'))];
  if (!site) return json({ error: 'Unknown site' }, 400);
  const result = await checkSite(site, params.get('name') ?? '');
  return json(
    result,
    200,
    result.state === 'unknown' ? 'no-store' : 'public, max-age=600',
  );
}

async function osintSubdomains(params) {
  const domain = (params.get('domain') ?? '').toLowerCase();
  if (!DOMAIN.test(domain)) return json({ error: 'Bad domain' }, 400);
  const names = new Set();
  const add = (value) => {
    for (const n of String(value).toLowerCase().split(/\s+/)) {
      const clean = n.replace(/^\*\./, '');
      // Certificates carry wildcards and placeholders (aam*.x, ?.?.x); skip them.
      if (!/^[a-z0-9.-]+$/.test(clean)) continue;
      if (clean === domain || clean.endsWith(`.${domain}`)) names.add(clean);
    }
  };
  let source = 'crt.sh';
  try {
    const r = await osintFetch(
      `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json`,
      25000,
    );
    if (!r.ok) throw new Error('crt.sh');
    for (const row of await r.json()) add(row.name_value);
  } catch {
    source = 'Cert Spotter';
    const r = await osintFetch(
      `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(domain)}&include_subdomains=true&expand=dns_names`,
      15000,
    );
    if (!r.ok)
      return json(
        {
          error:
            'Neither certificate log search answered. Try again in a minute.',
        },
        502,
      );
    for (const row of await r.json())
      for (const n of row.dns_names ?? []) add(n);
  }
  return json(
    { source, names: [...names].sort() },
    200,
    'public, max-age=3600',
  );
}

// The Wayback Machine's own calendar data (what its year/month view draws
// from): first and last capture, and a capture count per month. The CDX index
// can list every capture but takes a minute or times out on busy sites; this
// answers in about a second.
async function osintWayback(params) {
  const target = (params.get('url') ?? '').trim();
  if (!target || target.length > 300) return json({ error: 'Bad URL' }, 400);
  const r = await osintFetch(
    `https://web.archive.org/__wb/sparkline?output=json&url=${encodeURIComponent(target)}&collapse=timestamp:4`,
    20000,
  );
  if (!r.ok)
    return json({ error: 'The Internet Archive did not answer.' }, 502);
  const body = await r.json().catch(() => null);
  if (!body)
    return json({ error: 'The Internet Archive did not answer.' }, 502);
  return json(
    {
      first: body.first_ts ?? null,
      last: body.last_ts ?? null,
      years: body.years ?? {},
    },
    200,
    'public, max-age=3600',
  );
}

const EMAIL = /^[^\s@]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

// LeakCheck's free public endpoint: which leaks an email turns up in (no
// passwords or other rows, just the source names and dates).
async function osintLeakCheck(params) {
  const email = (params.get('email') ?? '').trim();
  if (!EMAIL.test(email)) return json({ error: 'Bad email' }, 400);
  const r = await osintFetch(
    `https://leakcheck.io/api/public?check=${encodeURIComponent(email)}`,
    15000,
  );
  if (r.status === 429)
    return json({ error: 'LeakCheck is rate limiting; try again soon.' }, 429);
  const body = await r.json().catch(() => null);
  if (!body) return json({ error: 'LeakCheck did not answer.' }, 502);
  return json({
    found: body.success ? body.found : 0,
    fields: body.fields ?? [],
    sources: body.success ? (body.sources ?? []) : [],
  });
}

async function osintBreaches() {
  const r = await osintFetch(
    'https://haveibeenpwned.com/api/v3/breaches',
    15000,
  );
  if (!r.ok) return json({ error: 'Have I Been Pwned did not answer.' }, 502);
  const list = await r.json();
  return json(
    list.map((b) => ({
      name: b.Name,
      title: b.Title,
      domain: b.Domain,
      date: b.BreachDate,
      count: b.PwnCount,
      classes: b.DataClasses,
      verified: b.IsVerified,
      sensitive: b.IsSensitive,
      description: b.Description,
    })),
    200,
    'public, max-age=86400',
  );
}

function passThrough(response) {
  if (!response.ok) return json({ error: 'Not found' }, 404);
  const headers = new Headers();
  headers.set(
    'Content-Type',
    response.headers.get('Content-Type') ?? 'application/octet-stream',
  );
  const length = response.headers.get('Content-Length');
  if (length) headers.set('Content-Length', length);
  headers.set('Cache-Control', ROBLOX_CACHE);
  return new Response(response.body, { status: 200, headers });
}

function json(body, status = 200, cache = 'no-store') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cache,
    },
  });
}
