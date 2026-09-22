// The sites Username Search checks, and how one is checked. The list itself
// (username-sites-data.js) is generated from Sherlock's data.json
// (https://github.com/sherlock-project/sherlock, MIT) plus a few of our own,
// and every entry in it was tested live against a real account and a made-up
// name; sites that couldn't tell the two apart were dropped.
//
// A site's `check` says how a missing user shows up:
//   status   – any non-2xx answer (after redirects)
//   message  – a 2xx page containing one of the `absent` strings, or
//              lacking the `present` one ({} is the name)
//   redirect – any answer that isn't a 2xx straight away (it redirects away)
//
// `probe` is the URL actually fetched when it differs from the profile a
// person would open; `method`, `body` and `headers` shape that request. The
// Worker (worker/index.js) runs checkSite() for the page, so the page and the
// server can never disagree about how a site is read.

export { USERNAME_SITES } from './username-sites-data.js';

// What a username may contain before it is worth sending anywhere. Every site
// in the list accepts a subset of this; anything else is certainly absent.
export const USERNAME_PATTERN = /^[A-Za-z0-9._-]{1,40}$/;

export const fill = (template, name) =>
  template.replaceAll('{}', encodeURIComponent(name));

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// Rate limits and bot walls say nothing about whether the user exists.
const BLOCKED = [401, 403, 429, 503];

// found | absent | unknown, with a note when unknown.
export async function checkSite(site, name, timeout = 8000) {
  if (!USERNAME_PATTERN.test(name)) return { state: 'absent' };
  if (site.regex && !new RegExp(site.regex).test(name))
    return { state: 'absent', note: 'not a valid name there' };
  let response;
  try {
    // eslint-disable-next-line warp-drive/no-external-request-patterns -- a Worker checking public profile pages
    response = await fetch(fill(site.probe ?? site.url, name), {
      method: site.method ?? 'GET',
      redirect: site.check === 'redirect' ? 'manual' : 'follow',
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(site.body ? { 'Content-Type': 'application/json' } : {}),
        ...site.headers,
      },
      body: site.body ? fill(JSON.stringify(site.body), name) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    return { state: 'unknown', note: 'no answer' };
  }
  if (BLOCKED.includes(response.status)) {
    response.body?.cancel();
    return { state: 'unknown', note: `blocked (${response.status})` };
  }
  const ok = response.status >= 200 && response.status < 300;
  if (site.check === 'message') {
    const text = await response.text();
    const absent = site.present
      ? !text.includes(site.present.replaceAll('{}', name))
      : [site.absent].flat().some((s) => text.includes(s));
    return { state: !absent && ok ? 'found' : 'absent' };
  }
  response.body?.cancel();
  return { state: ok ? 'found' : 'absent' };
}
