// The Bunkr Downloader's half of the Worker, same-site only:
//
// GET  /api/bunkr          -> { backend }: whether the download backend is set up
// POST /api/bunkr { url }  -> { kind, title, url, files: [{ name, size, type, url }] }
//
// Bunkr can't be read from a Worker (it keeps changing how its files are
// reached, and its file servers only answer requests that look like they came
// from Bunkr), so the work is done by the download backend on Render with
// gallery-dl. This only checks the link and passes it on with the key. The
// file addresses that come back point at the backend, each a signed link that
// expires; the files never pass through this Worker.

import { detectBunkr } from '../app/utils/bunkr-link.js';
import { askBackend, backendOf, sameSite, wake } from './backend.js';

const MAX_BODY = 4096;

export async function bunkr(request, env, ctx) {
  if (!sameSite(request)) return json({ error: 'Forbidden' }, 403);
  const backend = backendOf(env);
  if (request.method === 'GET') {
    wake(backend, ctx);
    return json({ backend: !!backend });
  }
  if (request.method !== 'POST')
    return json({ error: 'Method not allowed' }, 405);
  if (!backend)
    return json(
      {
        error:
          'Bunkr can only be read through the download backend, which this site hasn’t set up.',
      },
      501,
    );
  const text = await request.text();
  let body = null;
  if (text.length <= MAX_BODY)
    try {
      body = JSON.parse(text);
    } catch {
      // fall through
    }
  const link = detectBunkr(body?.url);
  if (!link) return json({ error: 'Paste a Bunkr link.' }, 400);
  if (link.error) return json({ error: link.error }, 400);

  const answer = await askBackend(backend, '/bunkr', { url: link.url });
  if (!answer.body)
    return json(
      {
        error:
          'The download backend didn’t answer. It sleeps when nobody is using it and takes about a minute to wake: try again shortly.',
      },
      502,
    );
  if (answer.status !== 200)
    return json(
      {
        error: answer.body.error ?? 'The download backend couldn’t read that.',
      },
      answer.status === 401 ? 502 : answer.status,
    );
  return json(answer.body);
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
