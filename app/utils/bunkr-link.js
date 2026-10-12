// Recognising a Bunkr link. Shared by the Bunkr Downloader page, the Worker
// and the download backend, which each check for themselves; nothing here
// touches the network.
//
// detectBunkr(text) -> { kind, host, url } | { error } | null
//   kind  'album' (bunkr.xx/a/…) or 'file' (/f/, /v/, /i/, /d/)
//   url   rebuilt from the checked parts, never the string that was pasted

import { parseLink } from './video-platforms.js';

// Bunkr hops between top-level domains (bunkr.cr, bunkr.si, bunkrr.su, …).
const HOST = /^(?:www\.|app\.)?(bunkr{1,3}\.[a-z]{2,10})$/;
const SLUG = /^[\w.%~-]{1,200}$/;

export function detectBunkr(text) {
  const parsed = parseLink(text);
  if (!parsed || parsed.error) return parsed;
  const host = parsed.host.match(HOST)?.[1];
  if (!host) return { error: 'That isn’t a Bunkr link.' };
  const [kind, slug] = parsed.u.pathname.split('/').filter(Boolean);
  if (!['a', 'f', 'v', 'i', 'd'].includes(kind) || !SLUG.test(slug ?? ''))
    return {
      error: 'That Bunkr link doesn’t point at an album or a file.',
    };
  return {
    kind: kind === 'a' ? 'album' : 'file',
    host,
    url: `https://${host}/${kind}/${slug}`,
  };
}
