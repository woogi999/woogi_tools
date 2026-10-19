// The Worker's side of the download backend (backend/server.mjs, on Render):
// where it is, how to ask it, and the signed links that let a browser fetch a
// file from it directly. The key (DOWNLOAD_API_KEY) never leaves the Worker.

const TOKEN_TTL_S = 2 * 60 * 60;

// { url, key } when the backend is set up, or null. `url` ends without a slash.
export function backendOf(env) {
  const key = env?.DOWNLOAD_API_KEY;
  if (!env?.DOWNLOAD_API_URL || !key) return null;
  try {
    const url = new URL(env.DOWNLOAD_API_URL);
    if (!/^https?:$/.test(url.protocol)) return null;
    return { url: url.href.replace(/\/+$/, ''), key };
  } catch {
    return null;
  }
}

// A free Render instance sleeps when idle and takes about a minute to wake.
// Asked when a downloader page opens, so it is up by the time it is needed.
export function wake(backend, ctx) {
  if (!backend) return;
  const ping = fetch(`${backend.url}/health`, {
    signal: AbortSignal.timeout(90000),
  }).catch(() => {});
  ctx?.waitUntil?.(ping);
}

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

// A link to GET /file on the backend, which only serves what a token signed
// with the shared key names (see "Tokens" in backend/server.mjs).
export async function fileLink(backend, payload) {
  const encoder = new TextEncoder();
  const body = b64url(
    encoder.encode(
      JSON.stringify({
        ...payload,
        e: Math.floor(Date.now() / 1000) + TOKEN_TTL_S,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(backend.key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return `${backend.url}/file?t=${body}.${b64url(signature)}`;
}

// POSTs JSON to the backend with the key. Gives back { status, body }, where
// body is null if it didn't answer in JSON (asleep, restarting, or not there).
export async function askBackend(backend, path, data, timeout = 100000) {
  let response;
  try {
    response = await fetch(`${backend.url}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${backend.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    return { status: 502, body: null };
  }
  return {
    status: response.status,
    body: await response.json().catch(() => null),
  };
}

// Same-site pages only, so other sites can't put their traffic on this one.
// Sec-Fetch-Site covers plain GETs, which carry no Origin.
export function sameSite(request) {
  const origin = request.headers.get('Origin');
  return !(
    (origin && origin !== new URL(request.url).origin) ||
    request.headers.get('Sec-Fetch-Site') === 'cross-site'
  );
}
