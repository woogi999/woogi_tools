// The Video Downloader's half of the Worker. Three routes, all same-site only:
//
// GET  /api/video           -> { backend }: whether the optional backend is set up
// POST /api/video           { url } -> what the video is and how it can be saved
// POST /api/video/resolve   { url, format } -> a file from the optional backend
// GET  /api/video/file      ?p=tiktok&id=…&f=… -> a TikTok file, relayed
//
// What can be done from a Worker was worked out by asking each site from
// Cloudflare's own network (September 2026), not assumed:
//
//   X          its embed service (cdn.syndication.twimg.com) lists the MP4s
//   TikTok     the video page carries every quality; the files only open for
//              whoever holds the cookies that page set, so they come through
//              /api/video/file rather than straight from TikTok
//   Facebook   the embeddable player (plugins/video.php) names SD and HD files
//              for videos their owners allow to be embedded
//   Reddit     the post's RSS feed names its v.redd.it video, whose DASH list
//              has the picture and the sound as separate files; the page joins
//              them with FFmpeg in the browser
//   Streamable its public API
//   YouTube, Instagram, Vimeo, Dailymotion
//              title and thumbnail only. YouTube answers servers with "Sign in
//              to confirm you're not a bot", Instagram wants a login (or a
//              browser's TLS fingerprint), Vimeo puts a challenge in front of
//              its player config and Dailymotion only streams HLS pieces.
//
// Anything a site refuses to a server is left refused. What fills the gap is
// an optional cobalt instance (https://github.com/imputnet/cobalt) that you
// run yourself, named by COBALT_API_URL (and COBALT_API_KEY if it wants one).
// The key never leaves the Worker. cobalt's public api.cobalt.tools is not
// for other sites to use, so it isn't a default.
//
// Not an open proxy: no route here fetches an address a visitor sent. Links
// are parsed into a site and an id (app/utils/video-platforms.js), and every
// request is rebuilt from those. File addresses a site hands back must be on
// that site's own CDN (MEDIA_HOSTS), redirects are followed by hand and
// checked the same way, and the relay only takes a TikTok id and a quality
// name, looking the file up again itself.

import {
  PLATFORMS,
  detectVideo,
  sameSiteRedirect,
} from '../app/utils/video-platforms.js';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
// Instagram shows its embed to link-preview bots it would send to a login page.
const PREVIEW_UA =
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const TIMEOUT_MS = 12000;
const MAX_BODY = 4096;
// The relay refuses anything bigger, so it can't be used to pull huge files.
const MAX_RELAY_BYTES = 1024 ** 3;

// Where each site's files may be served from. Checked on every file address a
// site hands back, and on every redirect the relay follows.
const MEDIA_HOSTS = {
  x: (h) => h === 'video.twimg.com',
  tiktok: (h) =>
    /^v\d+[\w-]*\.tiktok\.com$/.test(h) ||
    /(^|\.)tiktokcdn(-[a-z]+)?\.com$/.test(h) ||
    /(^|\.)tiktokv\.(com|us|eu)$/.test(h),
  facebook: (h) => /(^|\.)fbcdn\.net$/.test(h),
  reddit: (h) => h === 'v.redd.it',
  streamable: (h) => /(^|\.)streamable\.com$/.test(h),
};

// Only TikTok's files need the relay: every other site above serves its
// files with CORS headers, so the browser fetches them itself and none of the
// video passes through this Worker.
const RELAYED = new Set(['tiktok']);

// What the backend is asked for. cobalt picks the closest quality at or below
// the one asked, so these are ceilings, and are labelled that way.
const BACKEND_FORMATS = [
  { id: 'max', label: 'Best available', kind: 'video' },
  { id: '1080', label: 'Up to 1080p', kind: 'video' },
  { id: '720', label: 'Up to 720p', kind: 'video' },
  { id: '480', label: 'Up to 480p', kind: 'video' },
  { id: '360', label: 'Up to 360p', kind: 'video' },
  { id: 'audio', label: 'Sound only', kind: 'audio' },
];

// Why a site's files can't be had without the backend.
const WHY_NOT = {
  youtube:
    'YouTube won’t hand videos to servers like this one (it asks them to sign in to prove they aren’t a bot)',
  instagram: 'Instagram only shows videos to people who are logged in',
  vimeo: 'Vimeo blocks servers from its player',
  dailymotion:
    'Dailymotion only streams in small HLS pieces rather than as a file',
};

// The video itself can't be had: private, removed, not a video. The backend
// would get the same answer, so it isn't asked.
class Unavailable extends Error {
  status = 404;
}
// The site wouldn't talk to this Worker. The backend may still get through.
class Refused extends Error {}

export async function video(request, env) {
  const url = new URL(request.url);
  // Same-site pages only, so other sites can't put their traffic on this one.
  // Sec-Fetch-Site covers the plain GETs (downloads) that carry no Origin.
  const origin = request.headers.get('Origin');
  if (
    (origin && origin !== url.origin) ||
    request.headers.get('Sec-Fetch-Site') === 'cross-site'
  )
    return json({ error: 'Forbidden' }, 403);
  try {
    if (url.pathname === '/api/video') return await inspect(request, env);
    if (url.pathname === '/api/video/resolve')
      return await resolve(request, env);
    if (url.pathname === '/api/video/file') return await relay(request, url);
  } catch (error) {
    if (error instanceof Unavailable || error instanceof Refused)
      return json(
        { error: error.message },
        error instanceof Unavailable ? error.status : 502,
      );
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError')
      return json({ error: 'The site took too long to answer.' }, 504);
    return json({ error: 'Something went wrong looking that up.' }, 500);
  }
  return json({ error: 'Not found' }, 404);
}

// ─── POST /api/video ─────────────────────────────────────────────────────

async function inspect(request, env) {
  // What this deployment can do, so the page can say so before anything is
  // pasted. Only whether the backend exists, never where it is.
  if (request.method === 'GET') return json({ backend: !!backendUrl(env) });
  if (request.method !== 'POST')
    return json({ error: 'Method not allowed' }, 405);
  const body = await readJson(request);
  if (body instanceof Response) return body;
  let ref = detectVideo(body.url);
  if (!ref) return json({ error: 'Paste a link to a video.' }, 400);
  if (ref.error) return json({ error: ref.error }, 400);
  if (ref.id.startsWith('short:')) ref = await followShortLink(ref);

  const site = PLATFORMS[ref.platform];
  const backend = backendUrl(env);
  let found = null;
  let problem = null;
  const extract = EXTRACTORS[ref.platform];
  if (extract)
    try {
      found = await extract(ref);
    } catch (error) {
      if (error instanceof Unavailable) throw error;
      problem =
        error instanceof Refused
          ? error.message
          : `${site.name} didn’t answer properly.`;
    }

  const items = found?.items ?? [];
  const hasFiles = items.some((item) => item.formats.length);
  const notes = [...(found?.notes ?? [])];
  if (!hasFiles && !backend) {
    // A site that turned this one request away (busy, rate limited) is worth
    // trying again, so it's said as it is.
    if (problem) return json({ error: problem, platform: ref.platform }, 502);
    const why = WHY_NOT[ref.platform];
    const message = why
      ? `${why}, so it can only be saved through the optional download backend, which this site hasn’t set up.`
      : `${site.name} videos can only be saved through the optional download backend, which this site hasn’t set up.`;
    // Worth showing what there is (a YouTube title and thumbnail, say), with
    // the reason next to it. With nothing at all, it is just an error.
    if (!found) return json({ error: message, platform: ref.platform }, 501);
    notes.push(message);
  } else if (!hasFiles && problem) notes.push(problem);

  return json({
    platform: ref.platform,
    platformName: site.name,
    url: ref.url,
    title: found?.title ?? null,
    author: found?.author ?? null,
    thumbnail: found?.thumbnail ?? null,
    duration: found?.duration ?? null,
    items: hasFiles ? items : [],
    backend: !hasFiles && backend ? BACKEND_FORMATS : null,
    notes,
  });
}

// vm.tiktok.com/…, fb.watch/…, reddit.com/r/x/s/… only say where they lead
// when asked. Each hop is asked by hand and must stay on the same site.
async function followShortLink(ref) {
  let url = ref.url;
  for (let hop = 0; hop < 4; hop++) {
    const response = await get(url, { redirect: 'manual' });
    const location = response.headers.get('Location');
    if (!location) break;
    const next = sameSiteRedirect(ref.platform, new URL(location, url).href);
    if (!next)
      throw new Refused(
        `That ${PLATFORMS[ref.platform].name} share link leads somewhere this can’t follow. Open it and paste the address it lands on.`,
      );
    if (!next.id.startsWith('short:')) return next;
    url = next.url;
  }
  throw new Unavailable('That share link didn’t lead to a video.');
}

// ─── The sites ───────────────────────────────────────────────────────────

const EXTRACTORS = {
  x: fromX,
  tiktok: fromTikTok,
  facebook: fromFacebook,
  reddit: fromReddit,
  streamable: fromStreamable,
  instagram: fromInstagram,
  youtube: (ref) =>
    fromOEmbed(
      ref,
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(ref.url)}`,
      `https://i.ytimg.com/vi/${ref.id}/hqdefault.jpg`,
    ),
  vimeo: (ref) =>
    fromOEmbed(
      ref,
      `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(ref.url)}`,
    ),
  dailymotion: (ref) =>
    fromOEmbed(
      ref,
      `https://www.dailymotion.com/services/oembed?url=${encodeURIComponent(ref.url)}`,
    ),
};

// The token X's own embed script sends with the id.
const syndicationToken = (id) =>
  ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');

async function fromX(ref) {
  const response = await get(
    `https://cdn.syndication.twimg.com/tweet-result?id=${ref.id}&token=${syndicationToken(ref.id)}&lang=en`,
    { accept: 'application/json' },
  );
  if (response.status === 404)
    throw new Unavailable('That post doesn’t exist, or isn’t public.');
  if (!response.ok) throw new Refused('X didn’t answer.');
  const post = await response.json().catch(() => null);
  if (!post?.__typename)
    throw new Unavailable('That post doesn’t exist, or isn’t public.');
  if (post.__typename === 'TweetTombstone')
    throw new Unavailable(
      'X only shows that post to people who are logged in (it may be age-restricted or from a protected account).',
    );
  const withVideo = (p) =>
    (p?.mediaDetails ?? []).filter(
      (m) => m.type === 'video' || m.type === 'animated_gif',
    );
  // A post quoting a video counts too, if it has none of its own.
  const media = withVideo(post).length
    ? withVideo(post)
    : withVideo(post.quoted_tweet);
  if (!media.length) throw new Unavailable('That post has no video in it.');
  const title =
    (post.text ?? '')
      .replace(/https:\/\/t\.co\/\w+/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'Video from X';
  const author = post.user
    ? `${post.user.name} (@${post.user.screen_name})`
    : null;
  return {
    title: clip(title, 140),
    author,
    thumbnail: media[0].media_url_https ?? null,
    duration: seconds(media[0].video_info?.duration_millis / 1000),
    items: media.map((m, i) => ({
      label: media.length > 1 ? `Video ${i + 1}` : null,
      thumbnail: m.media_url_https ?? null,
      formats: (m.video_info?.variants ?? [])
        .filter((v) => v.content_type === 'video/mp4' && onCdn('x', v.url))
        .map((v) => {
          const [, w, h] = v.url.match(/\/(\d+)x(\d+)\//) ?? [];
          return {
            id: `${v.bitrate ?? 0}`,
            ...sized(Number(w), Number(h)),
            kind: 'video',
            ext: 'mp4',
            bitrate: v.bitrate ?? null,
            detail: m.type === 'animated_gif' ? 'GIF, as MP4' : null,
            via: 'direct',
            url: v.url,
            filename: fileName(title, `${ref.id}-${i + 1}`, 'mp4'),
          };
        })
        .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0)),
    })),
  };
}

// The video page's own data, and the cookies that page set: TikTok's file
// servers answer 403 to anyone who doesn't send them back.
async function tiktokPage(id) {
  const response = await get(`https://www.tiktok.com/@/video/${id}`, {
    accept: 'text/html',
  });
  if (!response.ok) throw new Refused('TikTok didn’t answer.');
  const cookies = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const html = await response.text();
  const raw = html.match(
    /<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/,
  )?.[1];
  const detail = raw
    ? JSON.parse(raw).__DEFAULT_SCOPE__?.['webapp.video-detail']
    : null;
  if (!detail)
    throw new Refused(
      'TikTok sent back a page without the video on it, as it sometimes does to servers. Try again in a moment.',
    );
  if (detail.statusCode !== 0) {
    const why = String(detail.statusMsg ?? '');
    throw new Unavailable(
      /deleted|invalid/.test(why)
        ? 'That TikTok has been removed.'
        : /privacy|private/.test(why)
          ? 'That TikTok is private.'
          : 'TikTok won’t show that video (it may be private, removed or age-restricted).',
    );
  }
  const item = detail.itemInfo?.itemStruct;
  if (!item) throw new Refused('TikTok’s answer was missing the video.');
  if (item.imagePost)
    throw new Unavailable('That TikTok is a photo slideshow, not a video.');
  return { item, cookies };
}

// Every quality TikTok lists, each with the file address it gave for it.
function tiktokFiles(item) {
  const video = item.video ?? {};
  const pick = (list) => [list ?? []].flat().find((u) => onCdn('tiktok', u));
  const seen = new Map();
  for (const b of video.bitrateInfo ?? []) {
    const upstream = pick(b.PlayAddr?.UrlList);
    if (!upstream || !b.GearName) continue;
    const w = Number(b.PlayAddr.Width);
    const h = Number(b.PlayAddr.Height);
    const codec = /265|hev|hvc/i.test(b.CodecType ?? '') ? 'H.265' : 'H.264';
    // Several gears can land on the same size; keep the best of each.
    const key = `${Math.min(w, h)}-${codec}`;
    if ((seen.get(key)?.bitrate ?? -1) >= b.Bitrate) continue;
    seen.set(key, {
      id: b.GearName,
      ...sized(w, h),
      kind: 'video',
      ext: 'mp4',
      bitrate: b.Bitrate ?? null,
      size: Number(b.PlayAddr.DataSize) || null,
      detail: codec === 'H.265' ? 'H.265: some players can’t open it' : null,
      upstream,
    });
  }
  const files = [...seen.values()].sort(
    (a, b) =>
      (b.height ?? 0) - (a.height ?? 0) ||
      (a.detail ? 1 : 0) - (b.detail ? 1 : 0),
  );
  if (!files.length && onCdn('tiktok', video.playAddr))
    files.push({
      id: 'play',
      ...sized(video.width, video.height),
      kind: 'video',
      ext: 'mp4',
      upstream: video.playAddr,
    });
  const sound = item.music?.playUrl;
  if (onCdn('tiktok', sound))
    files.push({
      id: 'music',
      label: 'Sound only',
      detail: item.music.title ? clip(item.music.title, 60) : null,
      kind: 'audio',
      ext: 'mp3',
      upstream: sound,
    });
  return files;
}

async function fromTikTok(ref) {
  const { item } = await tiktokPage(ref.id);
  const title = clip(item.desc || 'TikTok video', 140);
  const files = tiktokFiles(item);
  if (!files.length) throw new Refused('TikTok didn’t list any files.');
  return {
    title,
    author: item.author
      ? `${item.author.nickname || item.author.uniqueId} (@${item.author.uniqueId})`
      : null,
    thumbnail: item.video?.originCover || item.video?.cover || null,
    duration: seconds(item.video?.duration),
    items: [
      {
        label: null,
        formats: files.map(({ upstream: _upstream, ...f }) => ({
          ...f,
          via: 'relay',
          url: `/api/video/file?p=tiktok&id=${ref.id}&f=${encodeURIComponent(f.id)}`,
          filename: fileName(title, ref.id, f.ext),
        })),
      },
    ],
    notes: [
      'TikTok only lets whoever loaded the page fetch its files, so they come through this site.',
    ],
  };
}

async function fromFacebook(ref) {
  const href = `https://www.facebook.com/video.php?v=${ref.id}`;
  const response = await get(
    `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(href)}&show_text=false`,
    { accept: 'text/html' },
  );
  if (!response.ok) throw new Refused('Facebook didn’t answer.');
  const html = await response.text();
  const field = (name) => {
    const raw = html.match(
      new RegExp(`"${name}":"((?:[^"\\\\]|\\\\.)*)"`),
    )?.[1];
    return raw ? JSON.parse(`"${raw}"`) : null;
  };
  const hd = field('hd_src');
  const sd = field('sd_src');
  if (!hd && !sd)
    throw new Unavailable(
      'Facebook won’t show that video outside Facebook. It may be private, removed, or its owner has turned embedding off.',
    );
  const owner = decode(html.match(/aria-label="([^"]+)"/)?.[1] ?? '') || null;
  const poster = html.match(/<img class="_1p6f[^"]*"[^>]*src="([^"]+)"/)?.[1];
  const title = owner ? `Facebook video from ${owner}` : 'Facebook video';
  return {
    title,
    author: owner,
    thumbnail: poster ? decode(poster) : null,
    duration: null,
    items: [
      {
        label: null,
        formats: [
          ['hd', 'HD', hd],
          ['sd', 'SD', sd],
        ]
          .filter(([, , url]) => url && onCdn('facebook', url))
          .map(([id, label, url]) => ({
            id,
            label,
            kind: 'video',
            ext: 'mp4',
            via: 'direct',
            url,
            filename: fileName(title, `${ref.id}-${id}`, 'mp4'),
          })),
      },
    ],
  };
}

// Reddit blocks its JSON API from servers, but the post's RSS feed still
// answers, and it names the post's link: a v.redd.it video, or another site.
async function fromReddit(ref, depth = 0) {
  if (ref.id.startsWith('media:'))
    return redditMedia(ref.id.slice(6), 'Reddit video', null, null);
  // Reddit rate-limits this feed for servers, and which video a post holds
  // never changes, so a good answer is kept at the edge for an hour.
  const response = await get(`https://www.reddit.com/comments/${ref.id}/.rss`, {
    accept: 'application/atom+xml',
    cacheFor: 3600,
  });
  if (response.status === 404)
    throw new Unavailable('That Reddit post doesn’t exist.');
  if (!response.ok)
    throw new Refused(
      response.status === 429
        ? 'Reddit is limiting how often it answers servers right now. Try again in a minute.'
        : 'Reddit wouldn’t answer.',
    );
  const feed = await response.text();
  const entry = feed.match(/<entry>([\s\S]*?)<\/entry>/)?.[1];
  if (!entry) throw new Unavailable('That Reddit post couldn’t be found.');
  const title = decode(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
  const author = entry.match(/<name>([^<]+)<\/name>/)?.[1] ?? null;
  const thumb = entry.match(/<media:thumbnail url="([^"]+)"/)?.[1];
  // The content is escaped HTML, so its "[link]" anchor (where the post
  // points) is escaped twice over.
  const link = decode(
    decode(
      entry.match(/href=&quot;([^&]*(?:&amp;[^&]*)*)&quot;&gt;\[link\]/)?.[1] ??
        '',
    ),
  );
  const media = link.match(/^https:\/\/v\.redd\.it\/([a-z0-9]{5,20})/)?.[1];
  if (media)
    return redditMedia(
      media,
      title || 'Reddit video',
      author,
      thumb ? decode(thumb) : null,
    );
  // A post sharing a video from somewhere else: look that up instead, once.
  const elsewhere = detectVideo(link);
  if (depth === 0 && elsewhere && !elsewhere.error) {
    if (elsewhere.id.startsWith('short:'))
      Object.assign(elsewhere, await followShortLink(elsewhere));
    const found =
      elsewhere.platform === 'reddit'
        ? await fromReddit(elsewhere, 1)
        : await EXTRACTORS[elsewhere.platform]?.(elsewhere);
    if (found)
      return {
        ...found,
        notes: [
          `This Reddit post shares a ${PLATFORMS[elsewhere.platform].name} video; these are that video’s files.`,
          ...(found.notes ?? []),
        ],
      };
  }
  throw new Unavailable('That Reddit post doesn’t have a video in it.');
}

// v.redd.it keeps each quality of picture and the sound as separate files,
// listed in a DASH manifest. The page joins picture and sound itself.
async function redditMedia(id, title, author, thumbnail) {
  const base = `https://v.redd.it/${id}/`;
  const response = await get(`${base}DASHPlaylist.mpd`, {
    accept: 'application/dash+xml',
  });
  if (response.status === 403 || response.status === 404)
    throw new Unavailable('That Reddit video has been removed.');
  if (!response.ok) throw new Refused('Reddit’s video server didn’t answer.');
  const mpd = await response.text();
  const video = [];
  const audio = [];
  // Newer manifests mark the set as audio, older ones each representation.
  const AUDIO = /contentType="audio"|mimeType="audio\//;
  for (const set of mpd.split('<AdaptationSet').slice(1)) {
    const setIsAudio = AUDIO.test(set.slice(0, set.indexOf('>')));
    for (const rep of set.split('<Representation').slice(1)) {
      const isAudio = setIsAudio || AUDIO.test(rep.slice(0, rep.indexOf('>')));
      const attr = (name) =>
        Number(rep.match(new RegExp(`\\b${name}="(\\d+)"`))?.[1]) || null;
      const file = rep.match(/<BaseURL>([^<]+)<\/BaseURL>/)?.[1];
      if (!file) continue;
      const url = new URL(decode(file), base).href;
      if (!onCdn('reddit', url)) continue;
      (isAudio ? audio : video).push({
        url,
        width: attr('width'),
        height: attr('height'),
        bitrate: attr('bandwidth'),
      });
    }
  }
  if (!video.length)
    throw new Unavailable('That Reddit video has no files listed.');
  video.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  const sound = audio.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
  const formats = video.map((v) => ({
    id: `${v.height ?? v.bitrate}`,
    ...sized(v.width, v.height),
    kind: 'video',
    ext: 'mp4',
    bitrate: v.bitrate,
    via: sound ? 'mux' : 'direct',
    url: v.url,
    audio: sound?.url ?? null,
    detail: sound ? null : 'this video has no sound',
    filename: fileName(title, `${id}-${v.height ?? ''}`, 'mp4'),
  }));
  if (sound)
    formats.push({
      id: 'audio',
      label: 'Sound only',
      kind: 'audio',
      ext: 'm4a',
      bitrate: sound.bitrate,
      via: 'direct',
      url: sound.url,
      filename: fileName(title, id, 'm4a'),
    });
  return {
    title: clip(title, 140),
    author,
    thumbnail,
    duration: isoDuration(
      mpd.match(/mediaPresentationDuration="([^"]+)"/)?.[1],
    ),
    items: [{ label: null, formats }],
    notes: sound
      ? [
          'Reddit stores picture and sound separately; your browser joins them when you save (the first time, that means fetching a ~30 MB video engine).',
        ]
      : [],
  };
}

async function fromStreamable(ref) {
  const response = await get(`https://api.streamable.com/videos/${ref.id}`, {
    accept: 'application/json',
  });
  if (response.status === 404)
    throw new Unavailable('That Streamable video doesn’t exist.');
  if (!response.ok) throw new Refused('Streamable didn’t answer.');
  const v = await response.json();
  if (v.status !== 2)
    throw new Unavailable('That Streamable video is still processing.');
  const title = v.title || 'Streamable video';
  const formats = Object.entries(v.files ?? {})
    .map(([key, f]) => ({ key, ...f, url: absolute(f.url) }))
    .filter((f) => f.url && onCdn('streamable', f.url))
    .map((f) => ({
      id: f.key,
      ...sized(f.width, f.height),
      kind: 'video',
      ext: 'mp4',
      size: f.size ?? null,
      bitrate: f.bitrate ?? null,
      detail: f.key.includes('mobile') ? 'smaller file' : null,
      via: 'direct',
      url: f.url,
      filename: fileName(title, `${ref.id}-${f.key}`, 'mp4'),
    }))
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  return {
    title: clip(title, 140),
    author: null,
    thumbnail: absolute(v.thumbnail_url),
    duration: seconds(v.files?.mp4?.duration),
    items: [{ label: null, formats }],
  };
}

// The embed page, which Instagram still shows to link-preview bots, has the
// poster and the account name, but no longer the video.
async function fromInstagram(ref) {
  const response = await get(`${ref.url.replace(/\/$/, '')}/embed/captioned/`, {
    accept: 'text/html',
    agent: PREVIEW_UA,
  });
  if (!response.ok) throw new Refused('Instagram didn’t answer.');
  const html = await response.text();
  if (html.includes('EmbedIsBroken'))
    throw new Unavailable('That Instagram post doesn’t exist or isn’t public.');
  const user = html.match(/class="UsernameText"[^>]*>([^<]+)</)?.[1];
  const image = html.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/)?.[1];
  return {
    title: user ? `Instagram post from @${decode(user)}` : 'Instagram post',
    author: user ? `@${decode(user)}` : null,
    thumbnail: image ? decode(image) : null,
    duration: null,
    items: [],
  };
}

async function fromOEmbed(ref, endpoint, fallbackThumb = null) {
  const response = await get(endpoint, { accept: 'application/json' });
  if (response.status === 404 || response.status === 400)
    throw new Unavailable(
      `That ${PLATFORMS[ref.platform].name} video doesn’t exist.`,
    );
  // 401/403 mean private, or not allowed to be embedded; the backend may do
  // better with the second, so this is only a missing title.
  const data = response.ok ? await response.json().catch(() => null) : null;
  return {
    title: data?.title ? clip(data.title, 140) : null,
    author: data?.author_name ?? null,
    thumbnail: data?.thumbnail_url ?? fallbackThumb,
    duration: seconds(data?.duration),
    items: [],
  };
}

// ─── POST /api/video/resolve (the optional backend) ──────────────────────

function backendUrl(env) {
  const raw = env?.COBALT_API_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

const COBALT_ERRORS = [
  [
    /content\.(video|post)\.(private|unavailable)/,
    'That video is private or has been removed.',
  ],
  [
    /content\.video\.age|youtube\.login|content\.post\.age/,
    'That video needs a signed-in account (it may be age-restricted), which the backend doesn’t use.',
  ],
  [
    /content\.too_long|content\.video\.live/,
    'That video is too long or still live, so the backend won’t fetch it.',
  ],
  [/rate_exceeded/, 'The download backend is busy. Try again in a minute.'],
  [
    /auth\./,
    'The download backend refused this site’s key. Check COBALT_API_KEY.',
  ],
  [
    /link\.(invalid|unsupported)|service\.unsupported/,
    'The download backend doesn’t support that link.',
  ],
  [
    /fetch\.(fail|critical|empty)|content\.video\.region/,
    'The download backend couldn’t get that video from the site.',
  ],
];

async function resolve(request, env) {
  if (request.method !== 'POST')
    return json({ error: 'Method not allowed' }, 405);
  const backend = backendUrl(env);
  if (!backend)
    return json({ error: 'The download backend isn’t set up here.' }, 501);
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const ref = detectVideo(body.url);
  if (!ref || ref.error)
    return json({ error: ref?.error ?? 'Paste a link to a video.' }, 400);
  const format = BACKEND_FORMATS.find((f) => f.id === body.format);
  if (!format) return json({ error: 'Unknown format' }, 400);

  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (env.COBALT_API_KEY)
    headers.Authorization = `Api-Key ${env.COBALT_API_KEY}`;
  let response;
  try {
    // eslint-disable-next-line warp-drive/no-external-request-patterns -- a Worker calling the site owner's own backend
    response = await fetch(backend, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url: ref.url,
        videoQuality: format.kind === 'audio' ? 'max' : format.id,
        downloadMode: format.kind === 'audio' ? 'audio' : 'auto',
        audioFormat: 'best',
        filenameStyle: 'pretty',
        localProcessing: 'disabled',
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    return json({ error: 'The download backend couldn’t be reached.' }, 502);
  }
  const answer = await response.json().catch(() => null);
  if (!answer)
    return json({ error: 'The download backend didn’t answer.' }, 502);
  const link = (value) =>
    typeof value === 'string' && /^https?:\/\//.test(value) ? value : null;

  if (answer.status === 'tunnel' || answer.status === 'redirect') {
    const url = link(answer.url);
    if (!url)
      return json({ error: 'The backend’s answer made no sense.' }, 502);
    return json({ files: [{ url, filename: safeName(answer.filename) }] });
  }
  if (answer.status === 'picker') {
    const files = (answer.picker ?? [])
      .filter((p) => link(p.url))
      .map((p, i) => ({
        url: p.url,
        type: p.type ?? 'video',
        thumb: link(p.thumb),
        filename: `${PLATFORMS[ref.platform].name}-${i + 1}.${p.type === 'photo' ? 'jpg' : 'mp4'}`,
      }));
    if (link(answer.audio))
      files.push({
        url: answer.audio,
        type: 'audio',
        filename: safeName(answer.audioFilename) || 'audio.mp3',
      });
    return json({ files });
  }
  // Instances set to make the browser do the joining hand back the pieces;
  // the page can join a picture and a sound, as it does for Reddit.
  if (
    answer.status === 'local-processing' &&
    answer.type === 'merge' &&
    answer.tunnel?.length === 2 &&
    answer.tunnel.every(link)
  )
    return json({
      merge: {
        video: answer.tunnel[0],
        audio: answer.tunnel[1],
        filename: safeName(answer.output?.filename) || 'video.mp4',
      },
    });
  const code = String(answer.error?.code ?? answer.status ?? '');
  const known = COBALT_ERRORS.find(([pattern]) => pattern.test(code));
  return json(
    {
      error: known
        ? known[1]
        : `The download backend couldn’t get that video (${code || 'no reason given'}).`,
    },
    response.status === 429 ? 429 : 502,
  );
}

// ─── GET /api/video/file (the TikTok relay) ──────────────────────────────

async function relay(request, url) {
  if (request.method !== 'GET')
    return json({ error: 'Method not allowed' }, 405);
  const platform = url.searchParams.get('p') ?? '';
  const id = url.searchParams.get('id') ?? '';
  const format = url.searchParams.get('f') ?? '';
  if (!RELAYED.has(platform)) return json({ error: 'Not relayed' }, 400);
  if (!/^\d{1,25}$/.test(id) || !/^[\w.-]{1,64}$/.test(format))
    return json({ error: 'Bad request' }, 400);

  // Looked up afresh: the relay is only ever handed an id and a quality
  // name, never an address, and the cookies are this lookup's own.
  const { item, cookies } = await tiktokPage(id);
  const file = tiktokFiles(item).find((f) => f.id === format);
  if (!file)
    return json({ error: 'TikTok no longer lists that quality.' }, 404);

  let upstream = file.upstream;
  let response;
  for (let hop = 0; ; hop++) {
    if (hop > 3 || !onCdn(platform, upstream))
      return json({ error: 'TikTok sent the file somewhere unexpected.' }, 502);
    // eslint-disable-next-line warp-drive/no-external-request-patterns -- a Worker fetching a file from TikTok's CDN
    response = await fetch(upstream, {
      headers: {
        'User-Agent': BROWSER_UA,
        Referer: 'https://www.tiktok.com/',
        Cookie: cookies,
      },
      redirect: 'manual',
    });
    const location = response.headers.get('Location');
    if (response.status < 300 || response.status >= 400 || !location) break;
    upstream = new URL(location, upstream).href;
  }
  if (!response.ok)
    return json({ error: 'TikTok wouldn’t hand that file over.' }, 502);
  const type = (response.headers.get('Content-Type') ?? '').split(';')[0];
  // Only ever a video or a sound, so this can't serve a page from this site.
  if (!/^(video|audio)\//.test(type))
    return json({ error: 'TikTok sent something that isn’t a video.' }, 502);
  const length = Number(response.headers.get('Content-Length')) || 0;
  if (length > MAX_RELAY_BYTES)
    return json({ error: 'That file is too big to relay.' }, 413);

  const name = fileName(item.desc || 'tiktok', id, file.ext);
  const headers = new Headers({
    'Content-Type': type,
    'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (length) headers.set('Content-Length', String(length));
  return new Response(response.body, { status: 200, headers });
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function get(
  url,
  {
    accept = '*/*',
    agent = BROWSER_UA,
    redirect = 'follow',
    cacheFor = 0,
  } = {},
) {
  // eslint-disable-next-line warp-drive/no-external-request-patterns -- a Worker calling the video sites
  return fetch(url, {
    redirect,
    // Cloudflare's edge cache, successes only. Ignored outside Workers.
    ...(cacheFor && {
      cf: { cacheTtlByStatus: { '200-299': cacheFor, '300-599': 0 } },
    }),
    headers: {
      'User-Agent': agent,
      Accept: accept,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: 'Too much data' }, 413);
  try {
    const body = JSON.parse(text);
    if (body && typeof body === 'object') return body;
  } catch {
    // fall through
  }
  return json({ error: 'Expected JSON' }, 400);
}

function onCdn(platform, url) {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.port &&
      Boolean(MEDIA_HOSTS[platform]?.(u.hostname))
    );
  } catch {
    return false;
  }
}

// "720p" names the short side, so upright phone video reads the same as wide.
function sized(width, height) {
  const w = Number(width) || null;
  const h = Number(height) || null;
  const short = w && h ? Math.min(w, h) : h || w;
  return {
    label: short ? `${short}p` : 'Video',
    width: w,
    height: h,
  };
}

const seconds = (n) =>
  Number.isFinite(Number(n)) && n > 0 ? Math.round(n) : null;

function isoDuration(text) {
  const m = String(text ?? '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/);
  return m
    ? seconds((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0))
    : null;
}

const absolute = (url) =>
  typeof url === 'string' && url
    ? url.startsWith('//')
      ? `https:${url}`
      : url
    : null;

const clip = (text, n) =>
  text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text;

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  '#039': "'",
};
const decode = (text) =>
  String(text)
    .replace(/&(amp|lt|gt|quot|apos|#0?39);/g, (_, e) => ENTITIES[e])
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    );

// A name that is safe on every OS: the title's words, then the id.
function fileName(title, id, ext) {
  const words = String(title ?? '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} '_-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
  return `${words ? `${words} - ` : ''}${id}.${ext}`;
}

const safeName = (name) =>
  typeof name === 'string'
    ? name.replace(/[/\\?%*:|"<>\p{Cc}]/gu, '_').slice(0, 150)
    : '';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
