// Usernames a person plausibly uses, guessed from what is already known about
// them: their full name ("Juan Dela Cruz" → juandelacruz, jdelacruz,
// juan.delacruz…), the part of an email address before the @, and small
// variations of usernames already found (jdoe92 → jdoe, j.doe → j_doe).
// These are only guesses: an account under one of them may well be someone
// else's, and the page says so.

import { USERNAME_PATTERN } from './username-sites';

// Titles and suffixes that are never part of a handle.
const SKIP = new Set([
  'mr',
  'mrs',
  'ms',
  'miss',
  'dr',
  'atty',
  'engr',
  'prof',
  'sir',
  'jr',
  'sr',
  'ii',
  'iii',
  'iv',
]);

// "Juan  Dela-Cruz Jr." → ['juan', 'dela', 'cruz']
export function nameParts(full) {
  return String(full)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w && !SKIP.has(w));
}

const valid = (u) =>
  typeof u === 'string' && u.length >= 3 && USERNAME_PATTERN.test(u);

// Handles made from a full name, most common patterns first.
export function usernamesFromName(full, limit = 14) {
  const parts = nameParts(full);
  if (!parts.length) return [];
  if (parts.length === 1) return valid(parts[0]) ? [parts[0]] : [];
  const first = parts[0];
  const middle = parts.slice(1, -1);
  // Compound surnames ("dela cruz", "van der berg") are usually run
  // together, so the surname is tried both whole and as its last word.
  const lasts = [...new Set([parts.slice(1).join(''), parts.at(-1)])];
  // One list of patterns per surname reading, taken in turn so the likeliest
  // patterns of both come first.
  const lists = lasts.map((last) => {
    const f = first[0];
    const l = last[0];
    return [
      first + last,
      `${first}.${last}`,
      `${first}_${last}`,
      f + last,
      first + l,
      last + first,
      `${f}.${last}`,
      `${f}_${last}`,
      `${last}.${first}`,
      `${last}_${first}`,
      `${first}-${last}`,
      last + f,
    ];
  });
  if (middle.length) {
    const m = middle.map((w) => w[0]).join('');
    const last = parts.at(-1);
    lists.push([first + m + last, first[0] + m + last]);
  }
  const out = [];
  for (let i = 0; i < 12; i++) for (const list of lists) out.push(list[i]);
  out.push(first);
  return [...new Set(out)].filter(valid).slice(0, limit);
}

const PREFIXES = /^(the|real|its|iam|im|official|hey|mr|ms)[._-]?(?=[a-z])/i;
const SUFFIXES = /[._-]?(official|real|tv|yt|ph|xo)$/i;

// Close variations of a username someone already uses.
export function usernameVariants(username) {
  const u = String(username).toLowerCase();
  const bare = u.replace(/[._-]+/g, '');
  const out = [bare];
  if (/[._-]/.test(u))
    for (const sep of ['.', '_', '-']) out.push(u.replace(/[._-]+/g, sep));
  out.push(u.replace(/\d+$/, ''), u.replace(PREFIXES, ''));
  out.push(u.replace(SUFFIXES, ''));
  if (!/\d$/.test(u) && !/[._-]/.test(u) && u.length <= 12)
    out.push(`${u}_`, `_${u}`, `real${u}`, `its${u}`);
  return [...new Set(out)].filter((v) => v !== u && valid(v));
}

// [{ username, why }] worth trying, none of which is in `exclude`.
export function suggestUsernames(
  { usernames = [], emails = [], fullNames = [] },
  exclude = [],
  limit = 24,
) {
  const seen = new Set(exclude.map((u) => String(u).toLowerCase()));
  const out = [];
  const add = (username, why) => {
    const key = username.toLowerCase();
    if (seen.has(key) || !valid(username)) return;
    seen.add(key);
    out.push({ username, why });
  };
  for (const email of emails) {
    const local = String(email).split('@')[0].replace(/\+.*$/, '');
    add(local, `from ${email}`);
    for (const v of usernameVariants(local)) add(v, `like ${local}`);
  }
  for (const full of fullNames)
    for (const u of usernamesFromName(full, 8)) add(u, `from “${full}”`);
  for (const name of usernames)
    for (const v of usernameVariants(name)) add(v, `like ${name}`);
  return out.slice(0, limit);
}

// Where to look for a full name by hand: the people-search pages of the big
// networks, which only answer someone who is logged in.
export function nameSearchLinks(full) {
  const q = encodeURIComponent(full);
  const quoted = encodeURIComponent(`"${full}"`);
  return [
    ['Google', `https://www.google.com/search?q=${quoted}`],
    ['Facebook', `https://www.facebook.com/search/people/?q=${q}`],
    [
      'Instagram (via Google)',
      `https://www.google.com/search?q=${quoted}+site%3Ainstagram.com`,
    ],
    [
      'LinkedIn',
      `https://www.linkedin.com/search/results/people/?keywords=${q}`,
    ],
    ['X (Twitter)', `https://x.com/search?q=${quoted}&f=user`],
    ['TikTok', `https://www.tiktok.com/search/user?q=${q}`],
    ['YouTube', `https://www.youtube.com/results?search_query=${quoted}`],
    ['Threads', `https://www.threads.com/search?q=${q}&serp_type=accounts`],
    ['Reddit', `https://www.reddit.com/search/?q=${quoted}&type=people`],
  ].map(([site, url]) => ({ site, url }));
}

// Whether a profile's display name is the name searched: every word of the
// shorter one appears in the longer ("Juan D. Cruz" and "Juan Dela Cruz"
// agree through juan and cruz), and at least two words are shared unless
// both names are a single word (a lone first name proves nothing).
export function namesAgree(a, b) {
  const x = nameParts(a).filter((w) => w.length > 1);
  const y = nameParts(b).filter((w) => w.length > 1);
  if (!x.length || !y.length) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const set = new Set(long);
  const shared = short.filter((w) => set.has(w)).length;
  return (
    shared === short.length &&
    (shared >= 2 || (x.length === 1 && y.length === 1))
  );
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Where a username turns up in what was already collected: a link to it
// (a Linktree button, a "connected accounts" list, a URL in a bio) or the
// handle written out ("ig: @juandc"). `sources` are
// { site, owner, texts: [], links: [] }; an account's own page doesn't count
// as a mention of itself.
export function mentionsOf(username, sources) {
  const key = username.toLowerCase();
  const word = new RegExp(`(^|[^\\w.-])@?${escape(key)}(?![\\w-]|\\.\\w)`, 'i');
  const out = [];
  for (const s of sources) {
    if (s.owner && s.owner.toLowerCase() === key) continue;
    const inLink = s.links.some((link) => {
      try {
        const u = new URL(link);
        return `${u.pathname}${u.search}`
          .toLowerCase()
          .split(/[/?&=@]+/)
          .includes(key);
      } catch {
        return false;
      }
    });
    if (inLink || s.texts.some((t) => t && word.test(t)))
      if (!out.includes(s.site)) out.push(s.site);
  }
  return out;
}
