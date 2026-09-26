// The site's roomy storage.
//
// localStorage stops at a few megabytes for the whole site, which a single
// progress bar with a picture in it, or a video project with some keyframes,
// can use up alone. IndexedDB holds as much as the browser will give the
// site, and takes plain objects without turning them into text first.
//
// This is one database with one key-value store. Keys start with "woogi-"
// like the localStorage ones, so a backup, a reset or a clear in Settings
// can find everything the site keeps by prefix. Small settings that must be
// there before the first paint (the theme, mostly) stay in localStorage:
// IndexedDB can only be read asynchronously.
//
// Every call resolves rather than throws when storage is blocked (a private
// window, a browser with site data turned off): nothing is kept, and the
// page carries on.

import { waitForPromise } from '@ember/test-waiters';

const DB_NAME = 'woogi-tools';
const STORE = 'kv';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Storage is busy'));
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

// Runs `fn` against the store and resolves with what its request returns.
// Registered with Ember's test waiters, so tests wait for storage to answer
// the way they wait for rendering; outside tests it does nothing.
function run(mode, fn) {
  return waitForPromise(runNow(mode, fn));
}

async function runNow(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Storage refused'));
  });
}

const within = (prefix) => IDBKeyRange.bound(prefix, `${prefix}￿`);

export async function idbGet(key) {
  try {
    return await run('readonly', (s) => s.get(key));
  } catch {
    return undefined;
  }
}

// Resolves false when the value couldn't be kept (no room, storage blocked).
export async function idbSet(key, value) {
  try {
    await run('readwrite', (s) => s.put(value, key));
    return true;
  } catch {
    return false;
  }
}

export async function idbDelete(key) {
  try {
    await run('readwrite', (s) => s.delete(key));
  } catch {
    // nothing stored, or nothing to be done about it
  }
}

// Every [key, value] whose key starts with `prefix`.
export async function idbEntries(prefix) {
  try {
    return await waitForPromise(readEntries(prefix));
  } catch {
    return [];
  }
}

async function readEntries(prefix) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const keys = store.getAllKeys(within(prefix));
    const values = store.getAll(within(prefix));
    tx.oncomplete = () =>
      resolve(keys.result.map((key, i) => [key, values.result[i]]));
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbDeletePrefix(prefix) {
  try {
    await run('readwrite', (s) => s.delete(within(prefix)));
  } catch {
    // nothing stored, or nothing to be done about it
  }
}

// Puts a whole set of entries in one go: all of them, or none.
export async function idbReplacePrefix(prefix, entries) {
  try {
    await run('readwrite', (s) => {
      s.delete(within(prefix));
      for (const [key, value] of entries) s.put(value, key);
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * A named shelf of saved things (projects, designs), one entry per id.
 *
 * Each entry is two records: a small summary, which is all the list needs,
 * and the thing itself, which is only read when it's opened. A shelf of
 * designs full of pictures still lists instantly.
 */
export function makeShelf(name) {
  const meta = `woogi-shelf:${name}:meta:`;
  const body = `woogi-shelf:${name}:data:`;
  return {
    async list() {
      const entries = await idbEntries(meta);
      return entries
        .map(([, value]) => value)
        .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
    },
    load: (id) => idbGet(body + id),
    // Resolves false if the browser wouldn't keep it.
    async store(id, summary, data) {
      const ok = await idbSet(body + id, data);
      if (!ok) return false;
      return idbSet(meta + id, { ...summary, id, savedAt: Date.now() });
    },
    async forget(id) {
      await idbDelete(meta + id);
      await idbDelete(body + id);
    },
    async rename(id, newName) {
      const summary = await idbGet(meta + id);
      if (summary) await idbSet(meta + id, { ...summary, name: newName });
    },
  };
}
