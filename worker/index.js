// The site's Worker. Almost everything is a static file served straight from
// the build (see "assets" in wrangler.jsonc); only /api/* runs this code.
//
// GET /api/turn hands the browser short-lived Cloudflare TURN credentials, so
// games and File Share can relay their WebRTC traffic through Cloudflare and
// never show one player's IP address to another. The long-lived key lives in
// Worker secrets (TURN_KEY_ID, TURN_KEY_API_TOKEN), never in this repository.

const CREDENTIAL_TTL_S = 6 * 60 * 60;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/turn') return turn(request, env);
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(request);
  },
};

async function turn(request, env) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  // Only pages on this site should be spending the TURN allowance.
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Forbidden' }, 403);
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return json({ error: 'TURN is not configured' }, 503);

  // eslint-disable-next-line warp-drive/no-external-request-patterns -- a Worker calling Cloudflare's API
  const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: CREDENTIAL_TTL_S }),
  });
  if (!response.ok) return json({ error: 'TURN credentials unavailable' }, 502);
  const { iceServers } = await response.json();
  // Browsers block port 53, so those URLs would only slow the connection down.
  const servers = [iceServers]
    .flat()
    .map((server) => ({ ...server, urls: [server.urls].flat().filter((u) => !/:53(\?|$)/.test(u)) }))
    .filter((server) => server.urls.length);
  return json({ iceServers: servers, ttl: CREDENTIAL_TTL_S });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
