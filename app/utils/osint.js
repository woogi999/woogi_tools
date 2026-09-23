// Shared plumbing for the OSINT tools. Sources that refuse browsers go through
// the site's Worker (/api/osint, see worker/index.js); the ones that answer
// browsers directly (Pwned Passwords) are asked straight from the page.

async function api(params, signal) {
  // eslint-disable-next-line warp-drive/no-external-request-patterns -- the site's own Worker
  const response = await fetch(`/api/osint?${new URLSearchParams(params)}`, {
    signal,
  });
  // Anything but JSON means /api/osint isn't there at all (a static host,
  // or a dev server without the Worker): say so instead of guessing.
  if (!response.headers.get('Content-Type')?.includes('application/json'))
    throw new Error("This site's lookup service isn't running here.");
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? 'The lookup service did not answer.');
  return body;
}

// A batch of sites (indexes into USERNAME_SITES) in one request; the answer
// is { results: [{ state, note }] } in the same order.
export const checkUsernames = (sites, name, signal) =>
  api({ kind: 'username', sites: sites.join(','), name }, signal);

// What up to 10 found accounts say about their owner, in the same order:
// { profiles: [{ name, bio, location, image, links, … } | null] }.
export const profileAccounts = (sites, name, signal) =>
  api({ kind: 'profile', sites: sites.join(','), name }, signal);

// A site the person added themselves: { url: 'https://…/{}', absent: '' }.
export const checkCustomSite = ({ url, absent }, name, signal) =>
  api({ kind: 'username', url, absent: absent ?? '', name }, signal);

export const findSubdomains = (domain, signal) =>
  api({ kind: 'subdomains', domain }, signal);

// An email address's public Gravatar profile: { profile: {…} | null }.
export const gravatarProfile = (email, signal) =>
  api({ kind: 'gravatar', email }, signal);

export const leakCheck = (email, signal) =>
  api({ kind: 'leakcheck', email }, signal);

// Which well-known services an email address is registered with:
// { accounts: [{ site, url, state }] }.
export const emailAccountsLookup = (email, signal) =>
  api({ kind: 'emailaccounts', email }, signal);

export const waybackSnapshots = (url, signal) =>
  api({ kind: 'wayback', url }, signal);

let breachList = null;
export function allBreaches(signal) {
  breachList ??= api({ kind: 'breaches' }, signal).catch((error) => {
    breachList = null;
    throw error;
  });
  return breachList;
}

// XposedOrNot (open source, no key, answers browsers directly): every breach
// an email address is in, with the details of each.
export async function xposedOrNot(email, signal) {
  // eslint-disable-next-line warp-drive/no-external-request-patterns -- XposedOrNot's public API
  const response = await fetch(
    `https://api.xposedornot.com/v1/breach-analytics?email=${encodeURIComponent(email)}`,
    { signal },
  );
  if (response.status === 429)
    throw new Error('XposedOrNot is rate limiting; try again in a minute.');
  if (!response.ok) throw new Error('XposedOrNot did not answer.');
  const body = await response.json();
  return (body.ExposedBreaches?.breaches_details ?? []).map((b) => ({
    name: b.breach,
    domain: b.domain,
    year: b.xposed_date,
    records: b.xposed_records,
    data: String(b.xposed_data ?? '')
      .split(';')
      .filter(Boolean),
    description: b.details,
    passwordRisk: b.password_risk,
  }));
}

// Have I Been Pwned's Pwned Passwords range API. Only the first five hex
// characters of the password's SHA-1 leave the browser (k-anonymity); the
// rest is matched here against the few hundred suffixes that come back.
export async function pwnedCount(password, signal) {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  const prefix = hex.slice(0, 5);
  const suffix = hex.slice(5);
  // eslint-disable-next-line warp-drive/no-external-request-patterns -- Pwned Passwords only ever sees a 5-character hash prefix
  const response = await fetch(
    `https://api.pwnedpasswords.com/range/${prefix}`,
    { headers: { 'Add-Padding': 'true' }, signal },
  );
  if (!response.ok) throw new Error('Pwned Passwords did not answer.');
  for (const line of (await response.text()).split('\n')) {
    const [s, count] = line.trim().split(':');
    if (s === suffix) return Number(count);
  }
  return 0;
}

// "20150314092653" → Date
export function waybackDate(timestamp) {
  const t = String(timestamp).padEnd(14, '0');
  return new Date(
    Date.UTC(
      +t.slice(0, 4),
      +t.slice(4, 6) - 1,
      +t.slice(6, 8),
      +t.slice(8, 10),
      +t.slice(10, 12),
      +t.slice(12, 14),
    ),
  );
}

export const waybackUrl = (timestamp, original) =>
  `https://web.archive.org/web/${timestamp}/${original}`;

// ---- Email headers ------------------------------------------------------

// Unfold RFC 5322 headers (continuation lines start with whitespace) into
// [name, value] pairs, stopping at the first blank line (the body).
export function parseHeaders(raw) {
  const out = [];
  for (const line of raw.replace(/\r\n/g, '\n').split('\n')) {
    if (!line.trim()) {
      if (out.length) break;
      continue;
    }
    if (/^[ \t]/.test(line) && out.length) {
      out[out.length - 1][1] += ` ${line.trim()}`;
      continue;
    }
    const at = line.indexOf(':');
    if (at > 0) out.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]);
  }
  return out;
}

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const IPV6 = /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/i;
const isPrivate = (ip) =>
  /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) ||
  /^(::1|fe80:|fc|fd)/i.test(ip);

// Each Received header is one hop, newest first as written; read them
// oldest-first so the list follows the message from sender to you.
export function receivedHops(headers) {
  const hops = headers
    .filter(([n]) => n.toLowerCase() === 'received')
    .map(([, v]) => {
      const [route, stamp] = v.split(/;(?=[^;]*$)/);
      const from = route.match(/\bfrom\s+(\S+)/i)?.[1] ?? null;
      const by = route.match(/\bby\s+(\S+)/i)?.[1] ?? null;
      const withProto = route.match(/\bwith\s+(\S+)/i)?.[1] ?? null;
      const bracket = route.match(/\[([0-9a-f.:]+)\]/i)?.[1];
      const ip = bracket ?? route.match(IPV4)?.[0] ?? route.match(IPV6)?.[0];
      const date = stamp ? new Date(stamp.trim()) : null;
      return {
        from,
        by,
        with: withProto,
        ip: ip ?? null,
        publicIp: ip && !isPrivate(ip) ? ip : null,
        date: date && !Number.isNaN(date.getTime()) ? date : null,
        raw: v,
      };
    })
    .reverse();
  for (let i = 0; i < hops.length; i++) {
    const prev = hops[i - 1]?.date;
    hops[i].delay =
      prev && hops[i].date ? Math.round((hops[i].date - prev) / 1000) : null;
  }
  return hops;
}

// spf=pass, dkim=fail, dmarc=pass… out of Authentication-Results (and the
// older Received-SPF), last word wins per mechanism.
export function authResults(headers) {
  const results = {};
  for (const [name, value] of headers) {
    const n = name.toLowerCase();
    if (n === 'authentication-results' || n === 'arc-authentication-results')
      for (const m of value.matchAll(/\b(spf|dkim|dmarc|arc)=(\w+)/gi))
        results[m[1].toLowerCase()] ??= m[2].toLowerCase();
    if (n === 'received-spf')
      results.spf ??= value.split(/\s/)[0].toLowerCase();
  }
  return results;
}

export function headerValue(headers, name) {
  return headers.find(([n]) => n.toLowerCase() === name.toLowerCase())?.[1];
}

const addressOf = (v) =>
  (v?.match(/<([^>]+)>/)?.[1] ?? v?.match(/[\w.+-]+@[\w.-]+/)?.[0] ?? '')
    .trim()
    .toLowerCase();
const domainOf = (address) => address.split('@')[1] ?? '';

// Things in the headers that a phishing check would look at.
export function headerWarnings(headers, auth) {
  const warnings = [];
  const from = addressOf(headerValue(headers, 'From'));
  const reply = addressOf(headerValue(headers, 'Reply-To'));
  const returnPath = addressOf(headerValue(headers, 'Return-Path'));
  if (reply && domainOf(reply) !== domainOf(from))
    warnings.push(
      `Replies go to ${reply}, a different domain from the sender (${from || 'unknown'}).`,
    );
  if (returnPath && from && domainOf(returnPath) !== domainOf(from))
    warnings.push(
      `Bounces go to ${returnPath}; the visible sender is ${from}. Common for mailing services, suspicious otherwise.`,
    );
  for (const k of ['spf', 'dkim', 'dmarc'])
    if (auth[k] && !['pass', 'none', 'neutral'].includes(auth[k]))
      warnings.push(
        `${k.toUpperCase()} ${auth[k]}: the sending server's claim to be ${domainOf(from) || 'the sender'} did not check out.`,
      );
  return warnings;
}
