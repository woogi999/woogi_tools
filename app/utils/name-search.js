// Searching a person's name the way someone would by hand: each network's
// own people search (or, where that needs a login, a search engine's index of
// the network) turns a name into accounts with their usernames. Runs in the
// Worker (see worker/index.js, kind=people): none of these answer a browser
// on another site.

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
// Facebook shows its public people directory to link previewers only.
const PREVIEW = 'facebookexternalhit/1.1';

const MAX = 12;

const decode = (s) =>
  String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

const text = (html) =>
  decode(String(html).replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();

// Path words on the big networks that are pages, not people.
const RESERVED = new Set([
  'people',
  'public',
  'pages',
  'groups',
  'events',
  'watch',
  'posts',
  'photo',
  'photos',
  'photo.php',
  'profile.php',
  'story.php',
  'permalink.php',
  'share',
  'reel',
  'reels',
  'p',
  'tv',
  'explore',
  'stories',
  'hashtag',
  'search',
  'login',
  'accounts',
  'video',
  'videos',
  'discover',
  'tag',
  'music',
  'i',
  'home',
  'intent',
  'status',
  'marketplace',
]);

// A search result's link as { site, username, url } when it is a profile's
// own page (facebook.com/juan.dc, instagram.com/juandc, tiktok.com/@juandc,
// x.com/juandc), or null for posts, videos and everything else.
export function profileFromUrl(link) {
  let u;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|web|mobile)\./, '');
  const parts = u.pathname.split('/').filter(Boolean);
  const site = {
    'facebook.com': 'Facebook',
    'instagram.com': 'Instagram',
    'tiktok.com': 'TikTok',
    'x.com': 'X (Twitter)',
    'twitter.com': 'X (Twitter)',
  }[host];
  if (!site) return null;
  if (site === 'Facebook' && parts[0] === 'profile.php') {
    const id = u.searchParams.get('id');
    return id
      ? {
          site,
          username: null,
          url: `https://www.facebook.com/profile.php?id=${id}`,
        }
      : null;
  }
  if (parts.length !== 1) return null;
  let name = parts[0];
  if (site === 'TikTok') {
    if (!name.startsWith('@')) return null;
    name = name.slice(1);
  }
  if (RESERVED.has(name.toLowerCase()) || !/^[\w.-]{2,50}$/.test(name))
    return null;
  // Facebook's numeric addresses are an ID, not a username.
  const username = /^\d+$/.test(name) ? null : name;
  const url = {
    Facebook: `https://www.facebook.com/${name}`,
    Instagram: `https://www.instagram.com/${name}/`,
    TikTok: `https://www.tiktok.com/@${name}`,
    'X (Twitter)': `https://x.com/${name}`,
  }[site];
  return { site, username, url };
}

// "Juan Dela Cruz (@juandc) • Instagram photos and videos" → "Juan Dela Cruz"
const cleanTitle = (title) =>
  title
    .replace(/\s*\(@[^)]*\).*$/, '')
    .replace(/\s*[|•·–-]\s*(Facebook|Instagram|TikTok|X|Twitter)\b.*$/i, '')
    .replace(/\s+on (TikTok|X|Twitter)\b.*$/i, '')
    .trim();

// Facebook's public people directory (facebook.com/public/Juan-Dela-Cruz).
export function parseFacebookDirectory(html) {
  const out = [];
  const seen = new Set();
  const re =
    /<a title="([^"]+)" class="_2ial"[^>]*href="([^"]+)"[^>]*>([\s\S]{0,2500}?)<\/a>/g;
  for (const [, title, href, inner] of html.matchAll(re)) {
    const url = decode(href).split('?')[0];
    if (seen.has(url)) continue;
    seen.add(url);
    const id = html.slice(html.indexOf(href)).match(/[?&]id=(\d+)/)?.[1];
    const vanity = profileFromUrl(url);
    const image = inner.match(/<img[^>]+src="([^"]+)"/)?.[1];
    out.push({
      site: 'Facebook',
      name: decode(title),
      username: vanity?.username ?? null,
      url,
      id: id ?? null,
      image: image ? decode(image) : null,
    });
  }
  return out.slice(0, MAX);
}

// Brave's results for the name on Facebook, Instagram, TikTok and X: the
// profiles among them, with the name each one goes by.
export function parseBrave(html) {
  const out = [];
  const seen = new Set();
  for (const block of html.split('data-type="web"').slice(1)) {
    const href = block.match(/href="([^"]+)"/)?.[1];
    const found = href && profileFromUrl(decode(href));
    if (!found || seen.has(found.url)) continue;
    seen.add(found.url);
    const title = block.match(/class="title[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    const handle = title && text(title).match(/\(@([\w.-]+)\)/)?.[1];
    out.push({
      ...found,
      username: found.username ?? handle ?? null,
      name: title ? cleanTitle(text(title)) || null : null,
      image: null,
    });
  }
  return out.slice(0, MAX * 2);
}

export function parseYouTube(html) {
  const out = [];
  const re =
    /"channelRenderer":\{"channelId":"([^"]+)","title":\{"simpleText":"((?:[^"\\]|\\.)*)"\}[\s\S]{0,800}?"canonicalBaseUrl":"\/@([^"]+)"[\s\S]{0,300}?"thumbnails":\[\{"url":"([^"]+)"/g;
  for (const [, id, title, handle, image] of html.matchAll(re)) {
    let name = title;
    try {
      name = JSON.parse(`"${title}"`);
    } catch {
      // keep it as written
    }
    out.push({
      site: 'YouTube',
      name,
      username: decodeURIComponent(handle),
      url: `https://www.youtube.com/@${handle}`,
      id,
      image: image.startsWith('//') ? `https:${image}` : image,
    });
  }
  return out.slice(0, MAX);
}

// Each source: where to ask, as whom, and how to read the answer.
export const NAME_SOURCES = {
  facebook: {
    label: 'Facebook',
    url: (name) =>
      `https://www.facebook.com/public/${encodeURIComponent(name.trim().replace(/\s+/g, '-'))}`,
    agent: PREVIEW,
    read: (body) => parseFacebookDirectory(body),
  },
  web: {
    label: 'Instagram, TikTok, X and Facebook (via Brave Search)',
    url: (name) =>
      `https://search.brave.com/search?q=${encodeURIComponent(
        `"${name}" (site:instagram.com OR site:tiktok.com OR site:x.com OR site:facebook.com)`,
      )}`,
    agent: CHROME,
    read: (body) => parseBrave(body),
  },
  youtube: {
    label: 'YouTube',
    url: (name) =>
      `https://www.youtube.com/results?search_query=${encodeURIComponent(name)}&sp=EgIQAg%253D%253D`,
    agent: CHROME,
    read: (body) => parseYouTube(body),
  },
  bluesky: {
    label: 'Bluesky',
    url: (name) =>
      `https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors?q=${encodeURIComponent(name)}&limit=${MAX}`,
    agent: CHROME,
    read: (body) =>
      (JSON.parse(body).actors ?? []).map((a) => ({
        site: 'Bluesky',
        name: a.displayName || null,
        username: a.handle,
        url: `https://bsky.app/profile/${a.handle}`,
        image: a.avatar ?? null,
      })),
  },
  // Mastodon's search reaches the whole fediverse, including the Threads
  // accounts that share their posts there.
  mastodon: {
    label: 'Mastodon and Threads',
    url: (name) =>
      `https://mastodon.social/api/v2/search?q=${encodeURIComponent(name)}&type=accounts&limit=${MAX}`,
    agent: CHROME,
    read: (body) =>
      (JSON.parse(body).accounts ?? []).map((a) => {
        const threads = /@threads\.net$/i.test(a.acct);
        return {
          site: threads ? 'Threads' : 'Mastodon',
          name: a.display_name || null,
          username: threads ? a.acct.split('@')[0] : a.acct,
          url: threads
            ? `https://www.threads.com/@${a.acct.split('@')[0]}`
            : a.url,
          image: a.avatar_static ?? a.avatar ?? null,
        };
      }),
  },
  github: {
    label: 'GitHub',
    url: (name) =>
      `https://api.github.com/search/users?q=${encodeURIComponent(`fullname:"${name}"`)}&per_page=${MAX}`,
    agent: CHROME,
    read: (body, name) =>
      (JSON.parse(body).items ?? []).map((u) => ({
        site: 'GitHub',
        // GitHub matched on the full name, but doesn't say what it is.
        name,
        username: u.login,
        url: u.html_url,
        image: u.avatar_url ?? null,
      })),
  },
};

// { people: [{ site, name, username, url, image }] } for one source, fetched
// with `get(url, agent)` → Response.
export async function searchName(source, name, get) {
  const s = NAME_SOURCES[source];
  const response = await get(s.url(name), s.agent);
  if (!response.ok) throw new Error(`${s.label} answered ${response.status}`);
  const people = s.read(await response.text(), name);
  return { people: people.filter((p) => p.url).slice(0, MAX * 2) };
}
