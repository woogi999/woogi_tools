// User Profiling's other two kinds of target: email addresses and IP
// addresses. What goes into the box is sorted by shape (usernames, emails,
// IPs), and each email or IP gets the lookups that make sense for it.

import {
  xposedOrNot,
  leakCheck,
  gravatarProfile,
  emailAccountsLookup,
} from './osint';
import { lookup as geolocate, placeLine } from './ip-lookup';

const DOH = 'https://cloudflare-dns.com/dns-query';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;
const USERNAME = /^[A-Za-z0-9._-]{1,40}$/;

// "alice, bob@x.com  1.2.3.4\n@carol" → usernames, emails and IPs, each
// once, in the order typed. Anything that is none of the three is returned
// as `invalid` so the page can say so.
export function sortTargets(text) {
  const out = { usernames: [], emails: [], ips: [], invalid: [] };
  const seen = new Set();
  for (const raw of String(text).split(/[\s,;]+/)) {
    const value = raw.trim().replace(/^@(?=[^@]+$)/, '');
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    if (EMAIL.test(value)) out.emails.push(value.toLowerCase());
    else if (IPV4.test(value) || (IPV6.test(value) && value.includes(':')))
      out.ips.push(value.toLowerCase());
    else if (USERNAME.test(value)) out.usernames.push(value);
    else out.invalid.push(value);
  }
  return out;
}

async function dohQuery(name, type, signal) {
  // eslint-disable-next-line warp-drive/no-external-request-patterns -- Cloudflare's public resolver
  const response = await fetch(
    `${DOH}?name=${encodeURIComponent(name)}&type=${type}`,
    { headers: { Accept: 'application/dns-json' }, signal },
  );
  const data = await response.json();
  return (data.Answer ?? []).map((a) => String(a.data).replace(/\.$/, ''));
}

// Who handles an address's mail says a lot: a company's own server, Google
// Workspace, Microsoft 365, a privacy-minded provider…
const MAIL_HOSTS = [
  [/google\.com|googlemail\.com/, 'Google (Gmail or Workspace)'],
  [/outlook\.com|office365|microsoft/, 'Microsoft (Outlook or 365)'],
  [/yahoodns|yahoo\./, 'Yahoo'],
  [/icloud\.com|me\.com/, 'Apple iCloud'],
  [/protonmail|proton\.me/, 'Proton Mail'],
  [/zoho\./, 'Zoho'],
  [/messagingengine|fastmail/, 'Fastmail'],
  [/mimecast/, 'Mimecast (filtering)'],
  [/pphosted|proofpoint/, 'Proofpoint (filtering)'],
  [/yandex/, 'Yandex'],
  [/mail\.ru/, 'Mail.ru'],
  [/gmx\.|web\.de/, 'GMX / Web.de'],
];

export async function emailIntel(email, signal) {
  const domain = email.split('@')[1];
  const settle = (p) =>
    p.then(
      (value) => ({ value }),
      (error) => ({ error: error.message }),
    );
  const [breaches, leak, gravatar, accounts, mx] = await Promise.all([
    settle(xposedOrNot(email, signal)),
    settle(leakCheck(email, signal)),
    settle(gravatarProfile(email, signal)),
    settle(emailAccountsLookup(email, signal)),
    settle(
      dohQuery(domain, 'MX', signal).then((r) =>
        r.map((v) => v.split(/\s+/).at(-1)),
      ),
    ),
  ]);
  const hosts = mx.value ?? [];
  const provider =
    MAIL_HOSTS.find(([re]) => hosts.some((h) => re.test(h)))?.[1] ??
    (hosts.length ? hosts[0] : null);
  // Merge the two breach sources by name.
  const byName = new Map();
  for (const b of breaches.value ?? [])
    byName.set(b.name.toLowerCase(), {
      name: b.name,
      year: b.year,
      data: b.data.join(', '),
    });
  for (const s of leak.value?.sources ?? [])
    if (!byName.has(String(s.name).toLowerCase()))
      byName.set(String(s.name).toLowerCase(), {
        name: s.name,
        year: s.date,
        data: '',
      });
  const local = email.split('@')[0].replace(/\+.*$/, '');
  return {
    email,
    domain,
    breaches: [...byName.values()].sort((a, b) =>
      String(b.year ?? '').localeCompare(String(a.year ?? '')),
    ),
    leakFields: (leak.value?.fields ?? []).join(', '),
    gravatar: gravatar.value?.profile ?? null,
    // Services this address is registered with (a clear yes only).
    accounts: (accounts.value?.accounts ?? []).filter(
      (a) => a.state === 'found',
    ),
    mail: {
      provider,
      hosts,
      acceptsMail: hosts.length > 0,
    },
    // The part before the @ is often the same person's username elsewhere.
    usernameGuess: USERNAME.test(local) ? local : null,
    errors: [
      breaches.error && `XposedOrNot: ${breaches.error}`,
      leak.error && `LeakCheck: ${leak.error}`,
      gravatar.error && `Gravatar: ${gravatar.error}`,
      accounts.error && `Account check: ${accounts.error}`,
    ].filter(Boolean),
  };
}

// 1.2.3.4 → 4.3.2.1.in-addr.arpa; IPv6 is written out nibble by nibble.
function reverseName(ip) {
  if (IPV4.test(ip)) return `${ip.split('.').reverse().join('.')}.in-addr.arpa`;
  const [head, tail = ''] = ip.split('::');
  const parts = (s) => (s ? s.split(':') : []);
  const h = parts(head);
  const t = parts(tail);
  const groups = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return `${groups
    .map((g) => g.padStart(4, '0'))
    .join('')
    .split('')
    .reverse()
    .join('.')}.ip6.arpa`;
}

export async function ipIntel(ip, signal) {
  const [geo, ptr] = await Promise.all([
    geolocate(ip).then(
      (value) => ({ value }),
      (error) => ({ error: error.message }),
    ),
    dohQuery(reverseName(ip), 'PTR', signal).catch(() => []),
  ]);
  const g = geo.value;
  return {
    ip,
    place: g ? placeLine(g) : null,
    latitude: g?.latitude ?? null,
    longitude: g?.longitude ?? null,
    isp: g?.isp || null,
    org: g?.org || null,
    asn: g?.asn || null,
    timezone: g?.timezone || null,
    hostnames: ptr,
    links: [
      ['AbuseIPDB', `https://www.abuseipdb.com/check/${ip}`],
      ['Shodan', `https://www.shodan.io/host/${ip}`],
      ['VirusTotal', `https://www.virustotal.com/gui/ip-address/${ip}`],
      ['GreyNoise', `https://viz.greynoise.io/ip/${ip}`],
    ].map(([label, url]) => ({ label, url })),
    error: geo.error ?? null,
  };
}
