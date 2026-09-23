// Reads what a profile page or profile API says about its owner, the way
// Maigret's socid_extractor does: the name, bio, location, avatar, links and
// so on. Runs in the Worker on each found profile, so only these few fields
// travel back to the page, never the page itself.
//
// It knows no site in particular. JSON answers are searched for the field
// names profile APIs commonly use; HTML pages are read for their Open Graph
// and meta tags, JSON-LD Person data, rel="me" links and the outbound links
// on the page (which is where other accounts of the same person turn up).

const KEYS = {
  name: [
    'name',
    'full_name',
    'fullname',
    'fullName',
    'display_name',
    'displayName',
    'displayname',
    'real_name',
    'realname',
    'realName',
    'global_name',
  ],
  bio: [
    'bio',
    'description',
    'about',
    'about_me',
    'aboutMe',
    'summary',
    'tagline',
    'headline',
    'biography',
    'public_description',
  ],
  location: ['location', 'city', 'country', 'region', 'hometown'],
  image: [
    'avatar_url',
    'avatarUrl',
    'avatar',
    'avatarfull',
    'profile_image_url',
    'profile_image_url_https',
    'profile_pic_url',
    'picture',
    'icon_img',
    'image',
    'photo',
    'thumbnail',
  ],
  website: ['blog', 'website', 'homepage', 'home_page', 'web', 'website_url'],
  created: [
    'created_at',
    'createdAt',
    'created',
    'joined',
    'join_date',
    'joinDate',
    'date_joined',
    'registered',
    'member_since',
    'signup_date',
    'creation_date',
  ],
  followers: [
    'followers',
    'followers_count',
    'follower_count',
    'followerCount',
    'subscribers',
    'subscriber_count',
  ],
  email: ['email', 'public_email', 'publicEmail', 'contact_email'],
  company: ['company', 'organization', 'organisation', 'employer', 'work'],
  gender: ['gender', 'sex'],
  birthday: ['birthday', 'birthdate', 'birth_date', 'dob'],
  twitter: ['twitter_username', 'twitter', 'twitter_handle'],
};

const MAX_LINKS = 60;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Addresses that sit in every page's footer and say nothing about its owner.
const JUNK_EMAIL =
  /(example\.|sentry|wixpress|noreply|no-reply|support@|privacy@|abuse@|help@|legal@|press@|info@|\.(png|jpe?g|gif|svg|webp)$)/i;

const clean = (value, max = 400) =>
  String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/g, "'")
    .replace(/&#064;/g, '@')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

// "news.example.co.uk" and "example.co.uk" are the same site.
function siteDomain(url) {
  try {
    const parts = new URL(url).hostname.toLowerCase().split('.');
    const two = parts.slice(-2).join('.');
    return /^(co|com|org|net|ac|gov)\.[a-z]{2}$/.test(two)
      ? parts.slice(-3).join('.')
      : two;
  } catch {
    return '';
  }
}

// The site's brand: "advfn" for uk.advfn.com. Links and addresses carrying it
// (advfn.ltd, advertise@advfnplc.com, apps.apple.com/…/advfn-…) are the
// site's own, not its user's.
function brand(url) {
  const domain = siteDomain(url);
  const name = domain.split('.')[0];
  return name.length >= 4 ? name : null;
}

const ownedBySite = (value, pageUrl) => {
  const b = brand(pageUrl);
  return Boolean(b) && value.toLowerCase().includes(b);
};

const isUrl = (v) => typeof v === 'string' && /^https?:\/\/\S+$/.test(v);
// Links worth following are to pages, not to the site's images, scripts or
// its own API.
const ASSET =
  /\.(png|jpe?g|gif|webp|svg|ico|css|js|woff2?|mp4|webm|json)([?#]|$)|\/\/(api|static|cdn|assets?|avatars?|images?|img|media|fonts?)[.-]/i;
const isPageLink = (v) => isUrl(v) && !ASSET.test(v);
const decode = (url) => url.replaceAll('&amp;', '&');

function asDate(value) {
  if (value == null || value === '') return null;
  let n = Number(value);
  if (Number.isFinite(n) && n > 1e8) {
    if (n < 1e11) n *= 1000; // seconds
    const d = new Date(n);
    return d.getFullYear() > 1995 && d <= new Date() ? d.toISOString() : null;
  }
  const d = new Date(value);
  return !Number.isNaN(d.getTime()) && d.getFullYear() > 1995 && d <= new Date()
    ? d.toISOString()
    : null;
}

// Walks a JSON answer a few levels deep and takes the first sensible value
// for each field.
function fromJson(data, out) {
  const seen = new Set();
  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 4 || seen.has(node))
      return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.slice(0, 5).forEach((n) => visit(n, depth + 1));
      return;
    }
    for (const [field, keys] of Object.entries(KEYS)) {
      if (out[field] != null) continue;
      for (const key of keys) {
        const v = node[key];
        if (v == null || v === '' || typeof v === 'object') continue;
        if (field === 'image' || field === 'website') {
          if (isUrl(v)) out[field] = decode(v);
        } else if (field === 'created') out[field] = asDate(v);
        else if (field === 'followers') {
          if (Number.isFinite(Number(v))) out[field] = Number(v);
        } else if (field === 'email') {
          if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) out[field] = v;
        } else if (typeof v === 'string' && !/^https?:\/\//.test(v))
          out[field] = clean(v);
        if (out[field] != null) break;
      }
    }
    for (const v of Object.values(node)) {
      if (isPageLink(v)) out.links.add(v);
      else if (v && typeof v === 'object') visit(v, depth + 1);
    }
  };
  visit(data, 0);
}

function meta(html, key) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`,
    'i',
  );
  const tag = html.match(re)?.[0];
  return tag ? (tag.match(/content=["']([^"']*)["']/i)?.[1] ?? null) : null;
}

// Titles and image captions that are a call to action or the site's own
// slogan, not a person's name: "follow me on Shelf…", "Buy X a Coffee",
// "Check out my…". These slip past length checks, so name them here.
const TITLE_BOILERPLATE =
  /^(follow|buy|check|see|discover|join|sign|log|welcome|support|subscribe|download|get|make|find|explore|watch|read|shop|visit|create|start|share|listen|view|meet|tips?|link|home|the\s)\b|\b(on\s+\w+\s+for|my\s+(music|links?|profile|page|content|art|store|shop)|for\s+(my|the)\b|and\s+(reading|watching)\b)/i;

// "Jane Doe (@jane) • Instagram photos and videos" → "Jane Doe"
function tidyTitle(title, username) {
  let t = clean(title, 200)
    .replace(/\s*[|•·–—-]\s*[^|•·–—-]*$/, '')
    .replace(/\s*\(@?[^)]*\)\s*$/, '')
    .replace(/^@/, '')
    .trim();
  if (username && t.toLowerCase() === username.toLowerCase()) t = '';
  if (TITLE_BOILERPLATE.test(t)) t = '';
  return t.length > 1 && t.length < 80 ? t : null;
}

// A profile avatar in the page's markup, when the og:image is a generated
// share-card rather than the person's own picture (Shelf, Linktree and the
// like). The first <img> whose class or alt calls it an avatar wins.
function avatarImg(html, pageUrl) {
  for (const [tag] of html.matchAll(/<img\s[^>]*>/gi)) {
    if (!/\b(avatar|profile[-_ ]?(pic|photo|image)|userpic)\b/i.test(tag))
      continue;
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    if (!src) continue;
    try {
      const url = decode(new URL(src, pageUrl).href);
      if (isUrl(url) && !/\.svg([?#]|$)/i.test(url)) return url;
    } catch {
      // a data: URI or junk src; keep looking
    }
  }
  return null;
}

function fromHtml(html, pageUrl, username, out) {
  // JSON-LD: a Person, or a ProfilePage about one.
  for (const [, body] of html.matchAll(
    /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      let data = JSON.parse(body);
      data = [data, data?.['@graph']].flat().filter(Boolean);
      for (const d of data) {
        const person = d.mainEntity ?? d.author ?? d;
        if (!/Person|Organization/i.test(person?.['@type'] ?? '')) continue;
        out.name ??= person.name ? clean(person.name, 120) : null;
        out.bio ??= person.description ? clean(person.description) : null;
        const addr = person.address ?? person.homeLocation;
        out.location ??=
          typeof addr === 'string'
            ? clean(addr, 120)
            : addr
              ? clean(
                  [
                    addr.addressLocality,
                    addr.addressRegion,
                    addr.addressCountry,
                  ]
                    .flat()
                    .filter((x) => typeof x === 'string')
                    .join(', ') ||
                    addr.name ||
                    '',
                  120,
                ) || null
              : null;
        const img = person.image?.url ?? person.image;
        if (isUrl(img)) out.image ??= decode(img);
        for (const link of [person.sameAs, person.url].flat())
          if (isPageLink(link)) out.links.add(decode(link));
        out.alternate ??= person.alternateName
          ? clean(person.alternateName, 80)
          : null;
      }
    } catch {
      // not JSON after all
    }
  }
  out.name ??= tidyTitle(
    meta(html, 'og:title') ?? meta(html, 'twitter:title') ?? '',
    username,
  );
  // "Jenn on Shelf" (og:image:alt) names the owner when the title is a
  // slogan; tidyName downstream strips the "on <site>" tail.
  out.name ??= tidyTitle(
    meta(html, 'og:image:alt') ?? meta(html, 'twitter:image:alt') ?? '',
    username,
  );
  const desc =
    meta(html, 'og:description') ??
    meta(html, 'description') ??
    meta(html, 'twitter:description');
  // A page's description is often the site's own blurb ("Discover X's
  // profile…"); count it only when it's about the owner by name.
  if (desc && !out.bio) {
    const d = clean(desc);
    // The username, not the page title: a title is often just the site's name.
    const who = username ? [username.toLowerCase()] : [];
    const boiler =
      /\b(discover|check out|see (the )?(latest|photos)|sign up|log in|join\b|profile on|portfolio|millions of)\b/i;
    if (who.some((w) => d.toLowerCase().includes(w)) && !boiler.test(d))
      out.bio = d;
  }
  // An explicit avatar element is the person's own picture; the og:image is
  // often a generated share-card, so it only fills in when there's no avatar.
  out.image ??= avatarImg(html, pageUrl);
  const img = meta(html, 'og:image') ?? meta(html, 'twitter:image');
  if (img && isUrl(img)) out.image ??= decode(img);
  // Links: rel="me" ones (explicitly the owner's) and any outbound link.
  for (const [tag] of html.matchAll(
    /<a\s[^>]*>|<link\s[^>]*rel=["']me["'][^>]*>/gi,
  )) {
    if (out.links.size >= MAX_LINKS) break;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href || !isPageLink(decode(href))) continue;
    try {
      if (new URL(href).hostname === new URL(pageUrl).hostname) continue;
    } catch {
      continue;
    }
    out.links.add(decode(clean(href, 300)));
  }
  if (!out.email) {
    const site = siteDomain(pageUrl);
    const emails = [
      ...new Set(
        [...html.matchAll(/mailto:([^"'?\s>]+)/gi)]
          .map((m) => m[1])
          .concat(desc?.match(EMAIL) ?? []),
      ),
    ].filter(
      (e) =>
        !JUNK_EMAIL.test(e) &&
        siteDomain(`http://${e.split('@')[1]}`) !== site &&
        !ownedBySite(e, pageUrl),
    );
    if (emails.length) out.email = emails[0];
  }
}

export function extractProfile(text, contentType, pageUrl, username) {
  const out = { links: new Set() };
  const trimmed = text.trimStart();
  if (/json/i.test(contentType) || /^[[{]/.test(trimmed)) {
    try {
      fromJson(JSON.parse(trimmed), out);
    } catch {
      // not JSON after all
    }
  } else if (/html/i.test(contentType) || trimmed.startsWith('<'))
    fromHtml(text, pageUrl, username, out);
  // Pages that are the site's own boilerplate rather than the person's.
  if (out.bio && out.bio.length < 4) out.bio = null;
  const result = {
    links: [...out.links]
      .filter((l) => !ownedBySite(l, pageUrl))
      .slice(0, MAX_LINKS),
  };
  for (const [k, v] of Object.entries(out))
    if (k !== 'links' && v != null && v !== '') result[k] = v;
  return result;
}
