// Rebuilds app/utils/username-sites-data.js: `node lib/build-username-sites.mjs`
//
// Takes the site lists of Sherlock (MIT), WhatsMyName (CC BY-SA 4.0) and
// Maigret (MIT) plus the sites below, and tests every one live with
// checkSite(): a known account must come back "found" and a made-up
// name "absent", twice over. Anything that can't tell the two apart (bot
// walls, sites that answer 200 for anyone, dead sites) is left out. Run it now
// and then; sites change how they answer.

import { writeFileSync } from 'node:fs';
import { markPopular } from './popular-sites.mjs';
import {
  checkSite,
  USERNAME_PATTERN,
  USERNAME_SITES,
} from '../app/utils/username-sites.js';

const SHERLOCK =
  'https://raw.githubusercontent.com/sherlock-project/sherlock/master/sherlock_project/resources/data.json';
const WHATSMYNAME =
  'https://raw.githubusercontent.com/WebBreacher/WhatsMyName/main/wmn-data.json';
const MAIGRET =
  'https://raw.githubusercontent.com/soxoj/maigret/main/maigret/resources/data.json';
const PARALLEL = 24;
const TIMEOUT = 12000;
const PREVIEW_UA = 'facebookexternalhit/1.1';

// Ours: sites Sherlock lacks, or checks a steadier way here (an API over the
// HTML page). They win over Sherlock's entry of the same name.
const OURS = [
  {
    name: 'GitHub',
    url: 'https://github.com/{}',
    probe: 'https://api.github.com/users/{}',
    check: 'status',
    claimed: 'torvalds',
  },
  {
    name: 'GitLab',
    url: 'https://gitlab.com/{}',
    probe: 'https://gitlab.com/api/v4/users?username={}',
    check: 'message',
    absent: '[]',
    claimed: 'gitlab-qa',
  },
  {
    name: 'HackerNews',
    url: 'https://news.ycombinator.com/user?id={}',
    probe: 'https://hacker-news.firebaseio.com/v0/user/{}.json',
    check: 'message',
    absent: 'null',
    claimed: 'pg',
  },
  {
    name: 'DEV Community',
    url: 'https://dev.to/{}',
    probe: 'https://dev.to/api/users/by_username?url={}',
    check: 'status',
    claimed: 'ben',
  },
  {
    name: 'Keybase',
    url: 'https://keybase.io/{}',
    probe: 'https://keybase.io/_/api/1.0/user/lookup.json?usernames={}',
    check: 'message',
    absent: '"them":[null]',
    claimed: 'max',
  },
  {
    name: 'Chess',
    url: 'https://www.chess.com/member/{}',
    probe: 'https://api.chess.com/pub/player/{}',
    check: 'status',
    claimed: 'hikaru',
  },
  {
    name: 'Lichess',
    url: 'https://lichess.org/@/{}',
    probe: 'https://lichess.org/api/user/{}',
    check: 'status',
    claimed: 'thibault',
  },
  {
    name: 'Docker Hub',
    url: 'https://hub.docker.com/u/{}',
    probe: 'https://hub.docker.com/v2/users/{}/',
    check: 'status',
    claimed: 'library',
  },
  {
    name: 'npm',
    url: 'https://www.npmjs.com/~{}',
    probe: 'https://registry.npmjs.org/-/v1/search?text=maintainer:{}&size=1',
    check: 'message',
    absent: '"total":0',
    claimed: 'sindresorhus',
  },
  {
    name: 'crates.io',
    url: 'https://crates.io/users/{}',
    probe: 'https://crates.io/api/v1/users/{}',
    check: 'status',
    claimed: 'alexcrichton',
  },
  {
    name: 'Codeforces',
    url: 'https://codeforces.com/profile/{}',
    probe: 'https://codeforces.com/api/user.info?handles={}',
    check: 'status',
    claimed: 'tourist',
  },
  {
    name: 'Stack Overflow',
    url: 'https://stackoverflow.com/users/filter?search={}',
    probe:
      'https://api.stackexchange.com/2.3/users?inname={}&site=stackoverflow',
    check: 'message',
    absent: '"items":[]',
    claimed: 'jonskeet',
  },
  {
    name: 'Mastodon',
    url: 'https://mastodon.social/@{}',
    probe: 'https://mastodon.social/api/v1/accounts/lookup?acct={}',
    check: 'status',
    claimed: 'Gargron',
  },
  {
    name: 'Bluesky',
    url: 'https://bsky.app/profile/{}.bsky.social',
    probe:
      'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor={}.bsky.social',
    check: 'status',
    claimed: 'jay',
  },
  {
    name: 'Steam Community (User)',
    url: 'https://steamcommunity.com/id/{}',
    check: 'message',
    absent: 'The specified profile could not be found',
    claimed: 'gabelogannewell',
  },
  {
    name: 'Speedrun.com',
    url: 'https://www.speedrun.com/users/{}',
    probe: 'https://www.speedrun.com/api/v1/users/{}',
    check: 'status',
    claimed: 'Cheese',
  },
  {
    name: 'Mixcloud',
    url: 'https://www.mixcloud.com/{}/',
    probe: 'https://api.mixcloud.com/{}/',
    check: 'status',
    claimed: 'jaguarskills',
  },
  {
    name: 'Gravatar',
    url: 'https://gravatar.com/{}',
    probe: 'https://en.gravatar.com/{}.json',
    check: 'status',
    claimed: 'beau',
  },
  {
    name: 'Wikipedia',
    url: 'https://en.wikipedia.org/wiki/User:{}',
    probe:
      'https://en.wikipedia.org/w/api.php?action=query&list=users&ususers={}&format=json',
    check: 'message',
    absent: '"missing"',
    claimed: 'Jimbo_Wales',
  },
  {
    name: 'Duolingo',
    url: 'https://www.duolingo.com/profile/{}',
    probe: 'https://www.duolingo.com/2017-06-30/users?username={}',
    check: 'message',
    absent: '"users":[]',
    claimed: 'luis',
  },
  {
    name: 'Buy Me a Coffee',
    url: 'https://buymeacoffee.com/{}',
    check: 'status',
    claimed: 'jake',
  },
  // Missing Ko-fi names 302 to the homepage; real ones answer 200.
  {
    name: 'Ko-fi',
    url: 'https://ko-fi.com/{}',
    check: 'redirect',
    regex: '^[A-Za-z0-9_]{1,50}$',
    claimed: 'yeahkenny',
  },
  // Carousell's country sites answer 404 for a name that isn't there.
  {
    name: 'Carousell',
    url: 'https://www.carousell.ph/u/{}/',
    check: 'status',
    claimed: 'carousell',
  },
  // The big networks, by whatever door each leaves open. Meta's sites and a
  // few others show real pages only to link-preview crawlers, and show a
  // server (a Worker) a login wall that says nothing either way: those are
  // strict, so the wall reads as unknown instead of "no such user".
  {
    name: 'Facebook',
    url: 'https://www.facebook.com/{}',
    headers: { 'User-Agent': PREVIEW_UA },
    check: 'message',
    strict: true,
    present: 'og:title',
    absent: "isn't available at the moment",
    claimed: 'zuck',
  },
  {
    name: 'Instagram',
    url: 'https://www.instagram.com/{}/',
    // The profile page sends Cloudflare's servers to the login page; the
    // embed page still answers them.
    probe: 'https://www.instagram.com/{}/embed/',
    headers: { 'User-Agent': PREVIEW_UA },
    check: 'message',
    strict: true,
    present: 'class="Embed"',
    absent: 'EmbedIsBroken',
    claimed: 'instagram',
  },
  {
    name: 'Threads',
    url: 'https://www.threads.com/@{}',
    headers: { 'User-Agent': PREVIEW_UA },
    check: 'message',
    strict: true,
    present: '(&#064;{})',
    claimed: 'zuck',
  },
  // X's own embed service answers servers; fxtwitter says "missing" to them.
  {
    name: 'X (Twitter)',
    url: 'https://x.com/{}',
    probe: 'https://publish.twitter.com/oembed?url=https://twitter.com/{}',
    regex: '^[A-Za-z0-9_]{1,15}$',
    check: 'status',
    claimed: 'elonmusk',
  },
  {
    name: 'TikTok',
    url: 'https://www.tiktok.com/@{}',
    probe: 'https://www.tiktok.com/oembed?url=https://www.tiktok.com/@{}',
    check: 'status',
    claimed: 'tiktok',
  },
  {
    name: 'Reddit',
    url: 'https://www.reddit.com/user/{}',
    probe: 'https://old.reddit.com/user/{}/about.json',
    headers: { 'User-Agent': PREVIEW_UA },
    check: 'status',
    claimed: 'spez',
  },
  {
    name: 'Discord',
    url: 'https://discord.com',
    probe:
      'https://discord.com/api/v9/unique-username/username-attempt-unauthed',
    method: 'POST',
    body: { username: '{}' },
    check: 'message',
    absent: '"taken":false',
    claimed: 'blue',
  },
  {
    name: 'Twitch',
    url: 'https://www.twitch.tv/{}',
    probe: 'https://gql.twitch.tv/gql',
    method: 'POST',
    headers: { 'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko' },
    body: { query: 'query{user(login:"{}"){id}}' },
    check: 'message',
    absent: '"user":null',
    claimed: 'xqc',
  },
  {
    name: 'Kick',
    url: 'https://kick.com/{}',
    probe: 'https://kick.com/api/v2/channels/{}',
    headers: { 'User-Agent': PREVIEW_UA },
    check: 'status',
    claimed: 'xqc',
  },
  {
    name: 'Tumblr',
    url: 'https://www.tumblr.com/{}',
    headers: { 'User-Agent': PREVIEW_UA },
    check: 'status',
    claimed: 'staff',
  },
  {
    name: 'Telegram',
    url: 'https://t.me/{}',
    check: 'message',
    present: 'tgme_page_title',
    claimed: 'durov',
  },
  {
    name: 'Pinterest',
    url: 'https://www.pinterest.com/{}/',
    probe:
      'https://www.pinterest.com/oembed.json?url=https://www.pinterest.com/{}/',
    check: 'status',
    claimed: 'pinterest',
  },
  {
    name: 'Snapchat',
    url: 'https://www.snapchat.com/add/{}',
    check: 'status',
    regex: '^[a-z][a-z0-9_.-]{2,14}$',
    claimed: 'teamsnapchat',
  },
  {
    name: 'YouTube',
    url: 'https://www.youtube.com/@{}',
    check: 'status',
    claimed: 'youtube',
  },
  {
    name: 'Roblox',
    url: 'https://www.roblox.com/users/profile?username={}',
    probe: 'https://users.roblox.com/v1/usernames/users',
    method: 'POST',
    body: { usernames: ['{}'], excludeBannedUsers: false },
    check: 'message',
    absent: '"data":[]',
    claimed: 'builderman',
  },
  { name: 'VK', url: 'https://vk.com/{}', check: 'status', claimed: 'durov' },
  {
    name: 'Linktree',
    url: 'https://linktr.ee/{}',
    check: 'status',
    claimed: 'selenagomez',
  },
  // Adult sites none of the three lists had, or had broken.
  {
    name: 'Fansly',
    url: 'https://fansly.com/{}',
    probe: 'https://apiv3.fansly.com/api/v1/account?usernames={}',
    check: 'message',
    absent: '"response":[]',
    nsfw: true,
    claimed: 'fansly',
  },
  {
    name: 'e621',
    url: 'https://e621.net/users/{}',
    probe: 'https://e621.net/users.json?search%5Bname%5D={}',
    headers: { 'User-Agent': 'woogi-tools/1.0 (username search)' },
    check: 'message',
    absent: '[]',
    nsfw: true,
    claimed: 'Andriagon',
  },
  {
    name: 'Literotica',
    url: 'https://www.literotica.com/authors/{}',
    check: 'status',
    nsfw: true,
    claimed: 'Laurel',
  },
  {
    name: 'FanCentro',
    url: 'https://fancentro.com/{}',
    check: 'status',
    nsfw: true,
    claimed: 'fancentro',
  },
];

// Each list, in its own format, turned into ours. Entries that can't be
// checked with a single request (Maigret's ID-only sites, disabled ones,
// WhatsMyName's archived ones) are skipped here rather than tested.
const NAME_OK = (n) => typeof n === 'string' && USERNAME_PATTERN.test(n);

function fromSherlock(data) {
  const out = [];
  for (const [name, e] of Object.entries(data)) {
    if (name.startsWith('$') || !e.url?.includes('{}')) continue;
    if (!NAME_OK(e.username_claimed)) continue;
    out.push({
      name,
      url: e.url,
      ...(e.urlProbe && { probe: e.urlProbe }),
      check: {
        status_code: 'status',
        message: 'message',
        response_url: 'redirect',
      }[e.errorType],
      ...(e.errorMsg && { absent: e.errorMsg }),
      ...(e.request_method &&
        e.request_method !== 'GET' && { method: e.request_method }),
      ...(e.request_payload && { body: e.request_payload }),
      ...(e.headers && { headers: e.headers }),
      ...(e.regexCheck && { regex: e.regexCheck }),
      ...(e.isNSFW && { nsfw: true }),
      claimed: e.username_claimed,
    });
  }
  return out;
}

function fromWhatsMyName(data) {
  const acc = (v) => v?.replaceAll('{account}', '{}');
  const out = [];
  for (const e of data.sites) {
    if (e.cat === 'archived' || !e.uri_check?.includes('{account}')) continue;
    if (!NAME_OK(e.known?.[0]) || !e.e_string) continue;
    out.push({
      name: e.name,
      url: acc(e.uri_pretty ?? e.uri_check),
      ...(e.uri_pretty && { probe: acc(e.uri_check) }),
      check: 'message',
      code: e.e_code,
      present: acc(e.e_string),
      ...(e.post_body && { method: 'POST', body: acc(e.post_body) }),
      ...(e.headers && { headers: e.headers }),
      ...(e.cat === 'xx NSFW xx' && { nsfw: true }),
      claimed: e.known[0],
    });
  }
  return out;
}

const ADULT_TAGS = ['porn', 'erotic', 'webcam'];
// Adult sites the lists don't tag as such.
const ADULT_NAMES = [
  'fabswingers',
  'fancentro',
  'fansly',
  'lemmynsfwcom',
  'mym',
];

function fromMaigret(data) {
  const out = [];
  for (const [name, raw] of Object.entries(data.sites)) {
    const e = raw.engine ? { ...data.engines[raw.engine]?.site, ...raw } : raw;
    if (e.disabled || e.type || !NAME_OK(e.usernameClaimed)) continue;
    const main = (e.urlMain ?? '').replace(/\/$/, '');
    const expand = (v) =>
      v
        ?.replaceAll('{urlMain}', main)
        .replaceAll('{urlSubpath}', e.urlSubpath ?? '')
        .replaceAll('{username}', '{}');
    const url = expand(e.url);
    if (!url?.includes('{}') || /[{][a-zA-Z]/.test(url)) continue;
    const check = {
      status_code: 'status',
      message: 'message',
      response_url: 'redirect',
    }[e.checkType];
    if (!check) continue;
    out.push({
      name,
      url,
      ...(e.urlProbe && { probe: expand(e.urlProbe) }),
      check,
      ...(e.absenceStrs?.length && { absent: e.absenceStrs }),
      ...(e.presenseStrs?.length && { present: e.presenseStrs }),
      ...(e.headers && { headers: e.headers }),
      ...(e.regexCheck && { regex: e.regexCheck }),
      ...(e.tags?.some((t) => ADULT_TAGS.includes(t)) && { nsfw: true }),
      claimed: e.usernameClaimed,
    });
  }
  return out;
}

const getJson = async (url) =>
  // eslint-disable-next-line warp-drive/no-external-request-patterns, n/no-unsupported-features/node-builtins -- a build script
  (await fetch(url)).json();

// The same profile listed by several sources is one group, tried in this
// order (ours first) until one entry passes.
const profileKey = (url) =>
  url
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/\/+$/, '');
const sherlockData = await getJson(SHERLOCK);
const maigretData = await getJson(MAIGRET);
const groups = new Map();
for (const site of [
  ...OURS,
  ...fromSherlock(sherlockData),
  ...fromWhatsMyName(await getJson(WHATSMYNAME)),
  ...fromMaigret(maigretData),
]) {
  const k = profileKey(site.url);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(site);
}

const nonsense = () =>
  `woogi${Math.random().toString(36).slice(2, 10)}x${Math.random().toString(36).slice(2, 6)}`;

async function passes(site) {
  for (let round = 0; round < 2; round++) {
    const [real, fake] = await Promise.all([
      checkSite(site, site.claimed, TIMEOUT),
      checkSite(site, nonsense(), TIMEOUT),
    ]);
    // A strict site may only ever say "unknown" for a missing name; what
    // matters is that it never says "found" for one.
    const fakeOk = site.strict
      ? fake.state !== 'found'
      : fake.state === 'absent';
    if (real.state !== 'found' || !fakeOk)
      return `${real.state}/${fake.state}${real.note ? ` ${real.note}` : ''}`;
  }
  return null;
}

async function firstPassing(group) {
  let why = null;
  for (const site of group) {
    why = await passes(site).catch((e) => `error ${e.message}`);
    if (!why) return { site };
    // Plenty of sites wall off browsers they don't trust but still show
    // link-preview crawlers the real page.
    if (!site.headers?.['User-Agent'] && /blocked|found\/found/.test(why)) {
      const retry = {
        ...site,
        headers: { ...site.headers, 'User-Agent': PREVIEW_UA },
      };
      if (!(await passes(retry).catch(() => 'error'))) return { site: retry };
    }
  }
  return { why: `${group[0].name}: ${why}` };
}

// Sites already in the list are kept as they are unless --full is passed,
// so a run cut short by a flaky connection can simply be run again.
const kept = [];
let list = [...groups.values()];
if (!process.argv.includes('--full')) {
  const have = new Map(USERNAME_SITES.map((s) => [profileKey(s.url), s]));
  list = list.filter((group) => {
    const site = have.get(profileKey(group[0].url));
    if (site) kept.push(site);
    return !site;
  });
  console.log(`${kept.length} already in the list`);
}

async function run(groups, parallel) {
  const failed = [];
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: parallel }, async () => {
      while (next < groups.length) {
        const group = groups[next++];
        const { site, why } = await firstPassing(group);
        if (site) kept.push(site);
        else failed.push({ group, why });
        if (++done % 250 === 0)
          console.log(`${done}/${groups.length}, kept ${kept.length}`);
      }
    }),
  );
  return failed;
}

console.log(`${list.length} profiles to test`);
let failed = await run(list, PARALLEL);
// "No answer" is as likely our connection as the site: ask those again,
// gently, before giving up on them.
const silent = failed.filter((f) => /no answer|timeout/.test(f.why));
console.log(`retrying ${silent.length} that didn't answer`);
failed = [
  ...failed.filter((f) => !silent.includes(f)),
  ...(await run(
    silent.map((f) => f.group),
    8,
  )),
];
const dropped = failed.map((f) => f.why);

// Two sources can list the same site under slightly different addresses
// (with and without a trailing path, say); one entry per name is enough.
const names = new Set();
const siteKey = (name) =>
  name
    .replace(/ \(\d+\)$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const sites = kept
  .sort((a, b) => OURS.includes(b) - OURS.includes(a))
  .filter((s) => {
    if (names.has(siteKey(s.name))) return false;
    names.add(siteKey(s.name));
    return true;
  })
  .map((s) =>
    ADULT_NAMES.includes(siteKey(s.name)) ? { ...s, nsfw: true } : s,
  )
  .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
const listed = markPopular(sites, {
  ours: OURS.map((s) => s.name),
  sherlock: sherlockData,
  maigret: maigretData,
});

writeFileSync(
  new URL('../app/utils/username-sites-data.js', import.meta.url),
  `// Generated by lib/build-username-sites.mjs from the site lists of Sherlock
// (https://github.com/sherlock-project/sherlock, MIT), WhatsMyName
// (https://github.com/WebBreacher/WhatsMyName, CC BY-SA 4.0) and Maigret
// (https://github.com/soxoj/maigret, MIT), plus our own entries, each tested
// live on ${new Date().toISOString().slice(0, 10)}. Don't edit by hand; rerun it.
// \`claimed\` is a real account on that site, used by the test.

export const USERNAME_SITES = ${JSON.stringify(listed)};
`,
);
console.log(
  `kept ${sites.length} (${sites.filter((s) => s.nsfw).length} adult), dropped ${dropped.length}`,
);
if (process.argv.includes('--why')) console.log(dropped.sort().join('\n'));
