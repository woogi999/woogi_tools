// Which well-known services an email address is registered with, the way
// Holehe does it: each service offers a public "is this address already in
// use?" endpoint (its sign-up or account-lookup form uses the same one), and
// the answer tells you whether an account exists without touching it. Only a
// yes/no per service ever comes back; no email is ever sent and nothing is
// changed.
//
// Runs in the Worker (worker/index.js), never the browser, because these
// endpoints reject cross-site calls. Each check is deliberately conservative:
// a stable, documented endpoint, a short timeout, and any surprise answer
// read as "couldn't tell" rather than a false claim — this feeds an
// investigation, so a wrong "registered" is worse than a blank.
//
// These endpoints change without notice; when one starts returning "unknown"
// for everyone, its entry here needs revisiting. Validate against staging
// before relying on the results.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

const enc = encodeURIComponent;

// found | absent | unknown. A thrown error, a rate limit, or an answer that
// is neither a clear yes nor a clear no all read as unknown.
async function ask(url, init, decide) {
  try {
    // eslint-disable-next-line warp-drive/no-external-request-patterns -- a Worker asking a public account-lookup endpoint
    const response = await fetch(url, {
      ...init,
      headers: { 'User-Agent': UA, Accept: '*/*', ...init?.headers },
      signal: AbortSignal.timeout(8000),
    });
    if ([401, 403, 429, 503].includes(response.status)) return 'unknown';
    return (await decide(response)) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// Each service: how to ask, and how to read the answer.
const SERVICES = [
  {
    name: 'Spotify',
    url: 'https://open.spotify.com',
    check: (email) =>
      ask(
        `https://spclient.wg.spotify.com/signup/public/v1/account?validate=1&email=${enc(email)}`,
        {},
        async (r) => {
          const body = await r.json().catch(() => null);
          if (!body) return 'unknown';
          // status 1 = free to register (no account); 20 = already taken.
          if (body.status === 20) return 'found';
          if (body.status === 1) return 'absent';
          return 'unknown';
        },
      ),
  },
  {
    name: 'Firefox',
    url: 'https://accounts.firefox.com',
    check: (email) =>
      ask(
        'https://api.accounts.firefox.com/v1/account/status',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        },
        async (r) => {
          const body = await r.json().catch(() => null);
          if (!body || typeof body.exists !== 'boolean') return 'unknown';
          return body.exists ? 'found' : 'absent';
        },
      ),
  },
  {
    name: 'Duolingo',
    url: 'https://www.duolingo.com',
    check: (email) =>
      ask(
        `https://www.duolingo.com/2017-06-30/users?email=${enc(email)}`,
        {},
        async (r) => {
          const body = await r.json().catch(() => null);
          if (!body || !Array.isArray(body.users)) return 'unknown';
          return body.users.length ? 'found' : 'absent';
        },
      ),
  },
];

// [{ site, url, state }] for the services that gave a clear answer, registered
// ones first. Services that couldn't tell are dropped rather than shown.
export async function emailAccounts(email) {
  const results = await Promise.all(
    SERVICES.map(async (s) => ({
      site: s.name,
      url: s.url,
      state: await s.check(email),
    })),
  );
  return results
    .filter((r) => r.state === 'found' || r.state === 'absent')
    .sort((a, b) => (b.state === 'found') - (a.state === 'found'));
}
