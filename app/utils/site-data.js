// Everything the site keeps is under keys starting with "woogi-", in two
// places: small things in localStorage (notes, favourites, settings, game
// profiles, saved avatars, lobby rules) and big ones in IndexedDB (what each
// tool remembers, saved projects and designs; see idb-store.js). A backup is
// both sets of keys and values, wrapped with a little metadata so a file from
// somewhere else can be recognised and refused.

import { idbEntries, idbReplacePrefix } from './idb-store';

export const STORAGE_PREFIX = 'woogi-';
const FORMAT = 'woogi-tools-data';
const FORMAT_VERSION = 2;
// Generous, but stops a hostile file from filling storage.
const MAX_BYTES = 512 * 1024 * 1024;

export async function collectData() {
  const data = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX))
        data[key] = localStorage.getItem(key);
    }
  } catch {
    // storage blocked: nothing to back up
  }
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    data,
    idb: Object.fromEntries(await idbEntries(STORAGE_PREFIX)),
  };
}

// How much the site keeps in IndexedDB, roughly, as text.
export async function idbBytes() {
  return (await idbEntries(STORAGE_PREFIX)).reduce(
    (sum, [key, value]) => sum + key.length + JSON.stringify(value).length,
    0,
  );
}

// A short, human description of a backup: what's in it and how big it is.
export function summarise(backup) {
  const data = backup?.data ?? {};
  const parse = (key) => {
    try {
      return JSON.parse(data[key]);
    } catch {
      return null;
    }
  };
  const notes = parse('woogi-quick-notes');
  const saves = parse('woogi-avatar-saves');
  const favourites = parse('woogi-favourites');
  const profile = parse('woogi-game-profile');
  const idb = backup?.idb ?? {};
  const bytes =
    Object.entries(data).reduce(
      (sum, [k, v]) => sum + k.length + String(v).length,
      0,
    ) +
    Object.entries(idb).reduce(
      (sum, [k, v]) => sum + k.length + JSON.stringify(v).length,
      0,
    );
  return {
    keys: Object.keys(data).length + Object.keys(idb).length,
    bytes,
    notes: Array.isArray(notes?.notes) ? notes.notes.length : 0,
    avatars: Array.isArray(saves) ? saves.length : 0,
    favourites: Array.isArray(favourites) ? favourites.length : 0,
    name: typeof profile?.name === 'string' ? profile.name.slice(0, 20) : null,
    exportedAt:
      typeof backup?.exportedAt === 'string' ? backup.exportedAt : null,
  };
}

// Throws a readable error if this isn't a backup from this site.
export function validateBackup(backup) {
  if (!backup || typeof backup !== 'object' || backup.format !== FORMAT)
    throw new Error("That file isn't a Woogi Tools data backup.");
  if (Number(backup.version) > FORMAT_VERSION)
    throw new Error(
      'That backup was made by a newer version of the site. Update this page and try again.',
    );
  const data = backup.data;
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('That backup is empty or damaged.');
  let bytes = 0;
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith(STORAGE_PREFIX) || typeof value !== 'string')
      throw new Error('That backup contains data this site doesn’t use.');
    bytes += key.length + value.length;
  }
  const idb = backup.idb ?? {};
  if (typeof idb !== 'object' || Array.isArray(idb))
    throw new Error('That backup is empty or damaged.');
  for (const [key, value] of Object.entries(idb)) {
    if (!key.startsWith(STORAGE_PREFIX))
      throw new Error('That backup contains data this site doesn’t use.');
    bytes += key.length + JSON.stringify(value).length;
  }
  if (bytes > MAX_BYTES) throw new Error('That backup is too big.');
  return backup;
}

// Replaces this browser's site data with the backup's.
export async function applyBackup(backup) {
  validateBackup(backup);
  const existing = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) existing.push(key);
  }
  const previous = Object.fromEntries(
    existing.map((key) => [key, localStorage.getItem(key)]),
  );
  try {
    existing.forEach((key) => localStorage.removeItem(key));
    for (const [key, value] of Object.entries(backup.data))
      localStorage.setItem(key, value);
  } catch (error) {
    // Out of space halfway: put back what was there.
    for (const key of Object.keys(backup.data)) localStorage.removeItem(key);
    for (const [key, value] of Object.entries(previous))
      localStorage.setItem(key, value);
    throw new Error(
      error?.name === 'QuotaExceededError'
        ? 'Not enough storage space in this browser for that data.'
        : "Couldn't save the data in this browser.",
    );
  }
  // A version 1 backup has no IndexedDB half; the tools just start fresh.
  if (!(await idbReplacePrefix(STORAGE_PREFIX, Object.entries(backup.idb ?? {}))))
    throw new Error('Not enough storage space in this browser for that data.');
}

export async function downloadBackup() {
  const backup = await collectData();
  const stamp = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
  );
  const link = Object.assign(document.createElement('a'), {
    href: url,
    download: `woogi-tools-data-${stamp}.json`,
  });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return backup;
}
