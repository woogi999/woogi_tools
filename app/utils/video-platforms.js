// Which video sites the Video Downloader knows, and how to recognise a link to
// one. Shared by the page (to name the site as you type) and the Worker (which
// is the one that actually decides): nothing here touches the network.
//
// detectVideo(text) -> { platform, id, url } | { error } | null
//   platform  a key of PLATFORMS
//   id        what the Worker needs to find the video: a post id, a short-link
//             code, or for the backend-only sites the whole link
//   url       the address rebuilt from the parts that were checked, never the
//             string that was pasted, so nothing the user typed rides along
//
// `native` says what the Worker can do on its own from Cloudflare's network,
// as tested from there (September 2026):
//   'download'  finds the files itself
//   'info'      only the title and thumbnail; the site refuses to hand video to
//               servers, so saving needs the optional backend (see worker/video.js)
//   null        nothing without the backend

export const PLATFORMS = {
  youtube: { name: 'YouTube', native: 'info' },
  x: { name: 'X (Twitter)', native: 'download' },
  tiktok: { name: 'TikTok', native: 'download' },
  instagram: { name: 'Instagram', native: 'info' },
  facebook: { name: 'Facebook', native: 'download' },
  reddit: { name: 'Reddit', native: 'download' },
  streamable: { name: 'Streamable', native: 'download' },
  vimeo: { name: 'Vimeo', native: 'info' },
  dailymotion: { name: 'Dailymotion', native: 'info' },
  bluesky: { name: 'Bluesky', native: null },
  twitch: { name: 'Twitch clips', native: null },
  pinterest: { name: 'Pinterest', native: null },
  tumblr: { name: 'Tumblr', native: null },
  loom: { name: 'Loom', native: null },
  bilibili: { name: 'Bilibili', native: null },
};

const MAX_URL = 2048;
const YT_ID = /^[\w-]{11}$/;
const DIGITS = /^\d{1,25}$/;
const CODE = /^[\w-]{1,64}$/;

// Exactly `domain` or one of its subdomains.
const under = (host, domain) => host === domain || host.endsWith(`.${domain}`);
const seg = (path) => path.split('/').filter(Boolean);

// Per site: take the parsed URL, give back { id, url } or null. Each only sees
// URLs whose host already matched that site.
const MATCHERS = [
  {
    platform: 'youtube',
    hosts: ['youtube.com', 'youtube-nocookie.com', 'youtu.be'],
    match(u, host) {
      const parts = seg(u.pathname);
      let id = null;
      if (host === 'youtu.be') id = parts[0];
      else if (parts[0] === 'watch') id = u.searchParams.get('v');
      else if (['shorts', 'embed', 'live', 'v', 'e'].includes(parts[0]))
        id = parts[1];
      if (!id || !YT_ID.test(id)) return null;
      return { id, url: `https://www.youtube.com/watch?v=${id}` };
    },
  },
  {
    platform: 'x',
    hosts: ['x.com', 'twitter.com'],
    match(u) {
      const parts = seg(u.pathname);
      const at = parts.indexOf('status');
      const id = at >= 0 ? parts[at + 1] : null;
      if (!id || !DIGITS.test(id)) return null;
      const user = at === 1 && parts[0] !== 'i' ? parts[0] : 'i';
      return { id, url: `https://x.com/${user}/status/${id}` };
    },
  },
  {
    platform: 'tiktok',
    hosts: ['tiktok.com'],
    match(u, host) {
      const parts = seg(u.pathname);
      // Share links: vm.tiktok.com/ZMxyz/, vt.tiktok.com/…, tiktok.com/t/…
      if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') {
        const code = parts[0];
        return code && CODE.test(code)
          ? { id: `short:${host}/${code}`, url: `https://${host}/${code}/` }
          : null;
      }
      if (parts[0] === 't' && CODE.test(parts[1] ?? ''))
        return {
          id: `short:www.tiktok.com/t/${parts[1]}`,
          url: `https://www.tiktok.com/t/${parts[1]}/`,
        };
      // /@user/video/123, /embed/v2/123, /share/video/123, m.tiktok.com/v/123.html
      const at = parts.findIndex((p) => p === 'video' || p === 'v2');
      let id = at >= 0 ? parts[at + 1] : null;
      if (!id && parts[0] === 'v') id = (parts[1] ?? '').replace(/\.html$/, '');
      if (!id || !DIGITS.test(id)) return null;
      const user = parts[0]?.startsWith('@') ? parts[0] : '@';
      return { id, url: `https://www.tiktok.com/${user}/video/${id}` };
    },
  },
  {
    platform: 'instagram',
    hosts: ['instagram.com'],
    match(u) {
      const parts = seg(u.pathname);
      // /p/CODE, /reel/CODE, /reels/CODE, /tv/CODE, and /user/p/CODE
      const at = parts.findIndex((p) =>
        ['p', 'reel', 'reels', 'tv'].includes(p),
      );
      const code = at >= 0 ? parts[at + 1] : null;
      if (!code || !CODE.test(code)) return null;
      const kind = parts[at] === 'reels' ? 'reel' : parts[at];
      return { id: code, url: `https://www.instagram.com/${kind}/${code}/` };
    },
  },
  {
    platform: 'facebook',
    hosts: ['facebook.com', 'fb.watch', 'fb.com'],
    match(u, host) {
      const parts = seg(u.pathname);
      if (host === 'fb.watch')
        return CODE.test(parts[0] ?? '')
          ? {
              id: `short:fb.watch/${parts[0]}`,
              url: `https://fb.watch/${parts[0]}/`,
            }
          : null;
      // /share/v/CODE and /share/r/CODE only say where the video is once asked.
      if (parts[0] === 'share' && ['v', 'r'].includes(parts[1]))
        return CODE.test(parts[2] ?? '')
          ? {
              id: `short:www.facebook.com/share/${parts[1]}/${parts[2]}`,
              url: `https://www.facebook.com/share/${parts[1]}/${parts[2]}/`,
            }
          : null;
      let id = null;
      if (['watch', 'video.php'].includes(parts[0]))
        id = u.searchParams.get('v');
      else if (parts[0] === 'reel') id = parts[1];
      else {
        // /PAGE/videos/ID or /PAGE/videos/SLUG/ID
        const at = parts.indexOf('videos');
        if (at >= 0) id = parts.slice(at + 1).find((p) => DIGITS.test(p));
      }
      if (!id || !DIGITS.test(id)) return null;
      return { id, url: `https://www.facebook.com/watch/?v=${id}` };
    },
  },
  {
    platform: 'reddit',
    hosts: ['reddit.com', 'redd.it'],
    match(u, host) {
      const parts = seg(u.pathname);
      if (host === 'v.redd.it')
        return /^[a-z0-9]{5,20}$/.test(parts[0] ?? '')
          ? { id: `media:${parts[0]}`, url: `https://v.redd.it/${parts[0]}` }
          : null;
      if (host === 'redd.it' || host === 'www.redd.it') {
        const id = parts[0];
        return /^[a-z0-9]{3,12}$/.test(id ?? '')
          ? { id, url: `https://www.reddit.com/comments/${id}/` }
          : null;
      }
      // /r/SUB/s/CODE share links
      if (parts[0] === 'r' && parts[2] === 's' && CODE.test(parts[3] ?? ''))
        return {
          id: `short:www.reddit.com/r/${parts[1]}/s/${parts[3]}`,
          url: `https://www.reddit.com/r/${parts[1]}/s/${parts[3]}`,
        };
      const at = parts.indexOf('comments');
      const id = at >= 0 ? parts[at + 1] : null;
      if (!id || !/^[a-z0-9]{3,12}$/.test(id)) return null;
      return { id, url: `https://www.reddit.com/comments/${id}/` };
    },
  },
  {
    platform: 'streamable',
    hosts: ['streamable.com'],
    match(u) {
      const parts = seg(u.pathname);
      const code = ['e', 'o', 's'].includes(parts[0]) ? parts[1] : parts[0];
      if (!code || !/^[a-z0-9]{3,12}$/i.test(code)) return null;
      return { id: code, url: `https://streamable.com/${code}` };
    },
  },
  {
    platform: 'vimeo',
    hosts: ['vimeo.com'],
    match(u) {
      // vimeo.com/123, vimeo.com/channels/x/123, player.vimeo.com/video/123
      const id = seg(u.pathname).find((p) => /^\d{3,12}$/.test(p));
      return id ? { id, url: `https://vimeo.com/${id}` } : null;
    },
  },
  {
    platform: 'dailymotion',
    hosts: ['dailymotion.com', 'dai.ly'],
    match(u, host) {
      const parts = seg(u.pathname);
      const id =
        host === 'dai.ly'
          ? parts[0]
          : parts[0] === 'video'
            ? parts[1]
            : parts[0] === 'embed' && parts[1] === 'video'
              ? parts[2]
              : null;
      if (!id || !/^x[a-z0-9]{3,12}$/i.test(id)) return null;
      return { id, url: `https://www.dailymotion.com/video/${id}` };
    },
  },
  // The backend-only sites: recognised so the page can say which it is, and
  // handed to the backend as the rebuilt address.
  {
    platform: 'bluesky',
    hosts: ['bsky.app'],
    match: (u) =>
      /^\/profile\/[\w.:-]+\/post\/[a-z0-9]+\/?$/i.test(u.pathname)
        ? { id: u.pathname, url: `https://bsky.app${u.pathname}` }
        : null,
  },
  {
    platform: 'twitch',
    hosts: ['twitch.tv'],
    match(u, host) {
      const parts = seg(u.pathname);
      const slug =
        host === 'clips.twitch.tv'
          ? parts[0]
          : parts[1] === 'clip'
            ? parts[2]
            : null;
      if (!slug || !CODE.test(slug)) return null;
      return { id: slug, url: `https://clips.twitch.tv/${slug}` };
    },
  },
  {
    platform: 'pinterest',
    hosts: ['pinterest.com', 'pin.it'],
    match(u, host) {
      const parts = seg(u.pathname);
      if (host === 'pin.it')
        return CODE.test(parts[0] ?? '')
          ? { id: parts[0], url: `https://pin.it/${parts[0]}` }
          : null;
      return parts[0] === 'pin' && DIGITS.test(parts[1] ?? '')
        ? { id: parts[1], url: `https://www.pinterest.com/pin/${parts[1]}/` }
        : null;
    },
  },
  {
    platform: 'tumblr',
    hosts: ['tumblr.com'],
    match(u, host) {
      const parts = seg(u.pathname);
      // blog.tumblr.com/post/ID or www.tumblr.com/BLOG/ID
      const blog =
        host === 'www.tumblr.com' || host === 'tumblr.com'
          ? parts[0]
          : host.split('.')[0];
      const id = parts.find((p) => DIGITS.test(p));
      if (!blog || !/^[\w-]{1,64}$/.test(blog) || !id) return null;
      return { id, url: `https://www.tumblr.com/${blog}/${id}` };
    },
  },
  {
    platform: 'loom',
    hosts: ['loom.com'],
    match(u) {
      const parts = seg(u.pathname);
      return ['share', 'embed'].includes(parts[0]) &&
        /^[a-f0-9]{32}$/.test(parts[1] ?? '')
        ? { id: parts[1], url: `https://www.loom.com/share/${parts[1]}` }
        : null;
    },
  },
  {
    platform: 'bilibili',
    hosts: ['bilibili.com', 'b23.tv'],
    match(u, host) {
      const parts = seg(u.pathname);
      if (host === 'b23.tv')
        return CODE.test(parts[0] ?? '')
          ? { id: parts[0], url: `https://b23.tv/${parts[0]}` }
          : null;
      return parts[0] === 'video' && /^(BV[\w]{10}|av\d+)$/.test(parts[1] ?? '')
        ? { id: parts[1], url: `https://www.bilibili.com/video/${parts[1]}` }
        : null;
    },
  },
];

// Parses what was pasted. Accepts a bare "youtu.be/abc" too, since people
// often copy links without the scheme.
export function parseLink(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  if (raw.length > MAX_URL) return { error: 'That link is far too long.' };
  let u;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { error: 'That doesn’t look like a link.' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:')
    return { error: 'Only web links (https://…) can be looked up.' };
  // user:pass@host and odd ports have no business in a share link, and are the
  // classic ways to make one host look like another.
  if (u.username || u.password || u.port)
    return { error: 'That link has parts a share link never has.' };
  return { u, host: u.hostname.toLowerCase().replace(/\.$/, '') };
}

export function detectVideo(text) {
  const parsed = parseLink(text);
  if (!parsed || parsed.error) return parsed;
  const { u, host } = parsed;
  const site = MATCHERS.find((m) => m.hosts.some((h) => under(host, h)));
  if (!site)
    return { error: 'That site isn’t one the downloader supports.', host };
  const found = site.match(u, host);
  if (!found)
    return {
      platform: site.platform,
      error: `That ${PLATFORMS[site.platform].name} link doesn’t point at a single video or post.`,
    };
  return { platform: site.platform, ...found };
}

// Where a share link was allowed to lead: the same site, checked again.
export function sameSiteRedirect(platform, location) {
  const next = detectVideo(location);
  return next && !next.error && next.platform === platform ? next : null;
}
