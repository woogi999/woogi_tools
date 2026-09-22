// Rebuilds app/utils/username-sites-data.js: `node lib/build-username-sites.mjs`
//
// Takes Sherlock's data.json (MIT) plus the sites below, and tests every one
// live with checkSite(): a known account must come back "found" and a made-up
// name "absent", twice over. Anything that can't tell the two apart (bot
// walls, sites that answer 200 for anyone, dead sites) is left out. Run it now
// and then; sites change how they answer.

import { writeFileSync } from 'node:fs';
import { checkSite } from '../app/utils/username-sites.js';

const SHERLOCK =
  'https://raw.githubusercontent.com/sherlock-project/sherlock/master/sherlock_project/resources/data.json';
const PARALLEL = 32;
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
  // The big networks, by whatever door each leaves open. Meta's sites and a
  // few others show real pages only to link-preview crawlers.
  {
    name: 'Facebook',
    url: 'https://www.facebook.com/{}',
    headers: { 'User-Agent': PREVIEW_UA },
    check: 'message',
    present: 'og:title',
    claimed: 'zuck',
  },
  {
    name: 'Instagram',
    url: 'https://www.instagram.com/{}/',
    headers: { 'User-Agent': PREVIEW_UA },
    check: 'message',
    present: '(&#064;{})',
    claimed: 'instagram',
  },
  {
    name: 'Threads',
    url: 'https://www.threads.com/@{}',
    headers: { 'User-Agent': PREVIEW_UA },
    check: 'message',
    present: '(&#064;{})',
    claimed: 'zuck',
  },
  {
    name: 'X (Twitter)',
    url: 'https://x.com/{}',
    probe: 'https://api.fxtwitter.com/{}',
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
];

const toOurs = (name, e) => ({
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
  claimed: e.username_claimed,
});

const key = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
// eslint-disable-next-line warp-drive/no-external-request-patterns, n/no-unsupported-features/node-builtins -- a build script
const sherlock = await (await fetch(SHERLOCK)).json();
const candidates = new Map();
for (const [name, e] of Object.entries(sherlock)) {
  if (name.startsWith('$') || e.isNSFW || !e.url?.includes('{}')) continue;
  if (!e.username_claimed) continue;
  candidates.set(key(name), toOurs(name, e));
}
for (const site of OURS) candidates.set(key(site.name), site);

const nonsense = () =>
  `woogi${Math.random().toString(36).slice(2, 10)}x${Math.random().toString(36).slice(2, 6)}`;

async function passes(site) {
  for (let round = 0; round < 2; round++) {
    const [real, fake] = await Promise.all([
      checkSite(site, site.claimed, 15000),
      checkSite(site, nonsense(), 15000),
    ]);
    if (real.state !== 'found' || fake.state !== 'absent')
      return `${real.state}/${fake.state}${real.note ? ` ${real.note}` : ''}`;
  }
  return null;
}

const list = [...candidates.values()];
const kept = [];
const dropped = [];
let next = 0;
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    while (next < list.length) {
      let site = list[next++];
      let why = await passes(site).catch((e) => `error ${e.message}`);
      // Plenty of sites wall off browsers they don't trust but still show
      // link-preview crawlers the real page.
      if (why && !site.headers?.['User-Agent']) {
        const retry = {
          ...site,
          headers: { ...site.headers, 'User-Agent': PREVIEW_UA },
        };
        if (!(await passes(retry).catch(() => 'error'))) {
          site = retry;
          why = null;
        }
      }
      (why ? dropped : kept).push(why ? `${site.name}: ${why}` : site);
      process.stdout.write(why ? 'x' : '.');
    }
  }),
);

// Where two entries check the same profile, keep one.
const seen = new Set();
const sites = kept
  .sort((a, b) => OURS.includes(b) - OURS.includes(a))
  .filter((s) => {
    const u = s.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '');
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  })
  .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

writeFileSync(
  new URL('../app/utils/username-sites-data.js', import.meta.url),
  `// Generated by lib/build-username-sites.mjs from Sherlock's data.json
// (https://github.com/sherlock-project/sherlock, MIT) and our own entries,
// each tested live on ${new Date().toISOString().slice(0, 10)}. Don't edit by hand; rerun it.
// \`claimed\` is a real account on that site, used by the test.

export const USERNAME_SITES = ${JSON.stringify(sites, null, 2)};
`,
);
console.log(`\nkept ${sites.length}, dropped ${dropped.length}`);
if (process.argv.includes('--why')) console.log(dropped.sort().join('\n'));
