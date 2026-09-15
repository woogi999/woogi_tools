// Everything the site keeps lives in localStorage under keys starting with
// "woogi-": notes, favourites, settings, game profiles, saved avatars, lobby
// rules. A backup is simply those keys and their stored text, wrapped with a
// little metadata so a file from somewhere else can be recognised and refused.

export const STORAGE_PREFIX = 'woogi-';
const FORMAT = 'woogi-tools-data';
const FORMAT_VERSION = 1;
// Generous, but stops a hostile file from filling storage.
const MAX_BYTES = 8 * 1024 * 1024;

export function collectData() {
  const data = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) data[key] = localStorage.getItem(key);
    }
  } catch {
    // storage blocked: nothing to back up
  }
  return { format: FORMAT, version: FORMAT_VERSION, exportedAt: new Date().toISOString(), data };
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
  const bytes = Object.entries(data).reduce((sum, [k, v]) => sum + k.length + String(v).length, 0);
  return {
    keys: Object.keys(data).length,
    bytes,
    notes: Array.isArray(notes?.notes) ? notes.notes.length : 0,
    avatars: Array.isArray(saves) ? saves.length : 0,
    favourites: Array.isArray(favourites) ? favourites.length : 0,
    name: typeof profile?.name === 'string' ? profile.name.slice(0, 20) : null,
    exportedAt: typeof backup?.exportedAt === 'string' ? backup.exportedAt : null,
  };
}

// Throws a readable error if this isn't a backup from this site.
export function validateBackup(backup) {
  if (!backup || typeof backup !== 'object' || backup.format !== FORMAT) throw new Error("That file isn't a Woogi Tools data backup.");
  if (Number(backup.version) > FORMAT_VERSION) throw new Error('That backup was made by a newer version of the site. Update this page and try again.');
  const data = backup.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('That backup is empty or damaged.');
  let bytes = 0;
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith(STORAGE_PREFIX) || typeof value !== 'string') throw new Error('That backup contains data this site doesn’t use.');
    bytes += key.length + value.length;
  }
  if (bytes > MAX_BYTES) throw new Error('That backup is too big.');
  return backup;
}

// Replaces this browser's site data with the backup's.
export function applyBackup(backup) {
  validateBackup(backup);
  const existing = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) existing.push(key);
  }
  const previous = Object.fromEntries(existing.map((key) => [key, localStorage.getItem(key)]));
  try {
    existing.forEach((key) => localStorage.removeItem(key));
    for (const [key, value] of Object.entries(backup.data)) localStorage.setItem(key, value);
  } catch (error) {
    // Out of space halfway: put back what was there.
    for (const key of Object.keys(backup.data)) localStorage.removeItem(key);
    for (const [key, value] of Object.entries(previous)) localStorage.setItem(key, value);
    throw new Error(error?.name === 'QuotaExceededError' ? 'Not enough storage space in this browser for that data.' : "Couldn't save the data in this browser.");
  }
}

export function downloadBackup() {
  const backup = collectData();
  const stamp = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `woogi-tools-data-${stamp}.json` });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return backup;
}
