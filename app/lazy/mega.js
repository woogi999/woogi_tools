// MEGA, for the Mega Downloader: loaded only when a link is looked up.
//
// MEGA's files are encrypted with a key that only exists in the share link,
// so there is nothing a server could do here: megajs asks MEGA's API (which
// answers browsers on any site) where the encrypted file is, fetches it, and
// decrypts and checks it in the page.

import { File } from 'megajs';

// What megajs's errors mean, by MEGA's error name.
const ERRORS = [
  [
    /ENOENT|EARGS/,
    'MEGA has no file or folder at that link. It may have been removed.',
  ],
  [
    /EKEY|EINCOMPLETE|could not be decrypted|Invalid key/i,
    'That link’s key doesn’t open it. Copy the whole link again.',
  ],
  [/EBLOCKED/, 'MEGA has taken that file down.'],
  [/EACCESS/, 'MEGA won’t share that: the link may have been turned off.'],
  [
    /EOVERQUOTA|Bandwidth limit|509/i,
    'MEGA’s free transfer allowance for your connection has run out. It refills over a few hours.',
  ],
  [
    /ETOOMANY|ERATELIMIT|EAGAIN/,
    'MEGA is busy or limiting requests. Try again in a moment.',
  ],
  [
    /MAC verification failed/i,
    'The file arrived damaged (it failed MEGA’s integrity check). Try again.',
  ],
];

function friendly(error) {
  const text = String(error?.message ?? error);
  const known = ERRORS.find(([pattern]) => pattern.test(text));
  return new Error(known ? known[1] : `MEGA said: ${text}`);
}

// { kind, title, files: [{ node, name, path, size }] } for a share link.
// `path` is the folder a file sits in, below the shared one ('' at the top).
export async function openMega(url) {
  let shared;
  try {
    shared = await File.fromURL(url).loadAttributes();
  } catch (error) {
    throw friendly(error);
  }
  const files = [];
  const walk = (node, path) => {
    if (!node.directory)
      files.push({
        node,
        name: node.name || 'file',
        path,
        size: node.size ?? null,
      });
    else
      for (const child of node.children ?? [])
        walk(
          child,
          node === shared ? '' : [path, node.name].filter(Boolean).join('/'),
        );
  };
  walk(shared, '');
  return {
    kind: shared.directory ? 'folder' : 'file',
    title: shared.name || (shared.directory ? 'MEGA folder' : 'MEGA file'),
    files,
  };
}

// Fetches and decrypts one file, reporting { received, total } as it goes.
export function downloadMega(node, { signal, onProgress }) {
  return new Promise((resolve, reject) => {
    const stream = node.download({ forceHttps: true });
    const chunks = [];
    const stop = () => {
      stream.destroy();
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    if (signal?.aborted) return stop();
    signal?.addEventListener('abort', stop, { once: true });
    stream.on('progress', ({ bytesLoaded, bytesTotal }) =>
      onProgress?.({ received: bytesLoaded, total: bytesTotal }),
    );
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', (error) => {
      signal?.removeEventListener('abort', stop);
      reject(friendly(error));
    });
    stream.on('end', () => {
      signal?.removeEventListener('abort', stop);
      resolve(new Blob(chunks));
    });
  });
}
