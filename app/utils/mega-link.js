// Recognising a MEGA share link, for the Mega Downloader. Nothing here
// touches the network.
//
// detectMega(text) -> { kind, url } | { error } | null
//   kind  'file' or 'folder'
//   url   the link in MEGA's current form, rebuilt from the checked parts
//
// A share link is an id and a key: mega.nz/file/<id>#<key>. The key is the
// part after the #, which browsers never send to a server; without it the
// file can be fetched but not decrypted, so a link missing it is no use.

import { parseLink } from './video-platforms.js';

const HOSTS = ['mega.nz', 'mega.co.nz', 'mega.io'];
const ID = /^[\w-]{8}$/;
// 43 characters for a file's key, 22 for a folder's.
const KEY = /^[\w-]{22,43}$/;
// A folder link can go on to name one thing inside it.
const INSIDE = /^\/(file|folder)\/[\w-]{8}$/;

const NO_KEY =
  'That MEGA link is missing its key (the part after the #), so the file couldn’t be decrypted. Copy the whole link.';

export function detectMega(text) {
  const parsed = parseLink(text);
  if (!parsed || parsed.error) return parsed;
  const { u } = parsed;
  const host = parsed.host.replace(/^www\./, '');
  if (!HOSTS.includes(host)) return { error: 'That isn’t a MEGA link.' };

  let kind, id, key, inside;
  const [first, second] = u.pathname.split('/').filter(Boolean);
  const hash = u.hash.slice(1);
  if (['file', 'folder', 'embed'].includes(first)) {
    kind = first === 'folder' ? 'folder' : 'file';
    id = second;
    const slash = hash.indexOf('/');
    key = slash < 0 ? hash : hash.slice(0, slash);
    inside = slash < 0 ? '' : hash.slice(slash);
  } else {
    // The old form: mega.nz/#!<id>!<key>, and #F!<id>!<key> for a folder.
    const old = hash.match(/^(F?)!([^!]+)(?:!([^!?]*))?/);
    if (!old)
      return { error: 'That MEGA link doesn’t point at a file or a folder.' };
    kind = old[1] ? 'folder' : 'file';
    id = old[2];
    key = old[3] ?? '';
  }
  if (!ID.test(id ?? ''))
    return { error: 'That MEGA link doesn’t point at a file or a folder.' };
  if (!key) return { error: NO_KEY };
  if (!KEY.test(key)) return { error: 'That MEGA link’s key isn’t valid.' };
  const tail = kind === 'folder' && INSIDE.test(inside ?? '') ? inside : '';
  return { kind, url: `https://mega.nz/${kind}/${id}#${key}${tail}` };
}
