// Who a domain belongs to and where it points, from two public sources that
// answer browsers directly: RDAP (the registries' replacement for WHOIS,
// found through rdap.org) and Cloudflare's DNS over HTTPS.

const RDAP = 'https://rdap.org/domain/';
const DOH = 'https://cloudflare-dns.com/dns-query';
const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT'];

export function cleanDomain(input) {
  let text = input.trim().toLowerCase();
  try {
    if (/^[a-z]+:\/\//.test(text)) text = new URL(text).hostname;
  } catch {
    // not a URL, keep as typed
  }
  text = text
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(text) ? text : null;
}

export async function lookupRdap(domain, signal) {
  // eslint-disable-next-line warp-drive/no-external-request-patterns -- a public registry service
  const response = await fetch(`${RDAP}${encodeURIComponent(domain)}`, {
    headers: { Accept: 'application/rdap+json, application/json' },
    signal,
  });
  if (response.status === 404)
    throw new Error(
      'No registry record: that domain does not seem to be registered.',
    );
  if (!response.ok)
    throw new Error("The registry didn't answer for that domain.");
  return summarise(await response.json());
}

// The parts people want, out of RDAP's rather nested shape.
function summarise(data) {
  const events = {};
  for (const e of data.events ?? []) events[e.eventAction] = e.eventDate;
  const entities = [];
  const walk = (list) => {
    for (const ent of list ?? []) {
      entities.push({
        roles: ent.roles ?? [],
        name: vcard(ent, 'fn') || ent.handle || '',
        org: vcard(ent, 'org'),
        email: vcard(ent, 'email'),
        country: vcardCountry(ent),
        registrarId:
          (ent.publicIds ?? []).find((p) => /IANA/i.test(p.type))?.identifier ??
          null,
      });
      walk(ent.entities);
    }
  };
  walk(data.entities);
  const byRole = (role) => entities.find((e) => e.roles.includes(role)) ?? null;
  return {
    name: data.ldhName ?? data.unicodeName ?? '',
    status: (data.status ?? []).map(readableStatus),
    registered: events.registration ?? null,
    expires: events.expiration ?? null,
    updated:
      events['last changed'] ?? events['last update of RDAP database'] ?? null,
    registrar: byRole('registrar'),
    registrant: byRole('registrant'),
    admin: byRole('administrative'),
    nameservers: (data.nameservers ?? [])
      .map((n) => n.ldhName?.toLowerCase())
      .filter(Boolean),
    dnssec: Boolean(data.secureDNS?.delegationSigned),
  };
}

function vcard(entity, key) {
  const props = entity.vcardArray?.[1] ?? [];
  const found = props.find((p) => p[0] === key);
  if (!found) return null;
  const value = found[3];
  return Array.isArray(value)
    ? value.filter(Boolean).join(', ')
    : String(value);
}

function vcardCountry(entity) {
  const props = entity.vcardArray?.[1] ?? [];
  const adr = props.find((p) => p[0] === 'adr');
  const parts = Array.isArray(adr?.[3]) ? adr[3] : [];
  return parts[6] || adr?.[1]?.cc || null;
}

const STATUS_WORDS = {
  'client transfer prohibited': 'Transfer locked by the registrar',
  'client delete prohibited': 'Deletion locked by the registrar',
  'client update prohibited': 'Updates locked by the registrar',
  'server transfer prohibited': 'Transfer locked by the registry',
  'server delete prohibited': 'Deletion locked by the registry',
  'server update prohibited': 'Updates locked by the registry',
  active: 'Active',
  'client hold': 'On hold (not resolving)',
  'server hold': 'On hold by the registry',
  'pending delete': 'Pending deletion',
  'redemption period': 'Expired, in its redemption period',
  'auto renew period': 'In its auto-renew grace period',
};
const readableStatus = (s) => STATUS_WORDS[s] ?? s;

export async function lookupDns(domain, signal) {
  const results = await Promise.all(
    RECORD_TYPES.map(async (type) => {
      try {
        // eslint-disable-next-line warp-drive/no-external-request-patterns -- Cloudflare's public resolver
        const response = await fetch(
          `${DOH}?name=${encodeURIComponent(domain)}&type=${type}`,
          { headers: { Accept: 'application/dns-json' }, signal },
        );
        const data = await response.json();
        const answers = (data.Answer ?? [])
          .filter((a) => a.type === TYPE_CODES[type])
          .map((a) => ({
            value: type === 'TXT' ? a.data.replace(/^"|"$/g, '') : a.data,
            ttl: a.TTL,
          }));
        return { type, answers };
      } catch {
        return { type, answers: [] };
      }
    }),
  );
  return results.filter((r) => r.answers.length);
}

const TYPE_CODES = { A: 1, AAAA: 28, CNAME: 5, MX: 15, NS: 2, TXT: 16 };
