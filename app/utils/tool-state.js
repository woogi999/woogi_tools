// Keeps what you typed into a tool. Leaving a tool's page tears its component
// down, and a refresh loses the lot, which is infuriating when you have pasted
// in a wall of text and gone to look something up. This writes the fields a
// tool cares about to IndexedDB (utils/idb-store.js) and puts them back the
// next time it opens.
//
// One line in a component's constructor:
//
//   keepState(this, 'currency-converter', ['amount', 'fromCurrency']);
//
// The fields must be @tracked, and their current values are used as the
// defaults: anything not saved, or saved as the wrong type, is left alone. Only
// JSON-safe values are kept, so files, blobs and streams are never touched;
// tools that work on a file are expected to go on asking for the file.

import {
  registerDestructor,
  isDestroyed,
  isDestroying,
} from '@ember/destroyable';
import { waitForPromise } from '@ember/test-waiters';
import { idbGet, idbSet, idbDelete, idbEntries, idbDeletePrefix } from './idb-store';

const PREFIX = 'woogi-tool:';
// Saving on every keystroke would write to disk hundreds of times a minute.
const SAVE_EVERY_MS = 600;
// IndexedDB has room, but one tool's state still shouldn't grow without end.
const MAX_BYTES = 64 * 1024 * 1024;

const keyFor = (scope) => `${PREFIX}${scope}`;

async function read(scope) {
  const key = keyFor(scope);
  let saved = await idbGet(key);
  // Tools used to be remembered in localStorage: move an old copy across once.
  if (saved === undefined) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        saved = JSON.parse(raw);
        if (await idbSet(key, saved)) localStorage.removeItem(key);
      }
    } catch {
      // unreadable or blocked: start from the defaults
    }
  }
  return saved && typeof saved === 'object' ? saved : {};
}

function write(scope, json) {
  if (json.length > MAX_BYTES) return;
  // storage blocked or full: the tool still works, it just won't be remembered
  idbSet(keyFor(scope), JSON.parse(json));
}

/**
 * Restore `fields` on `target` from storage, then keep them saved.
 *
 * `after` is called once the values are back, for a tool that has to redo
 * something with them (the currency converter refetches its chart).
 *
 * Returns a `forget()` that clears this tool's saved state, for a Clear button.
 */
export function keepState(target, scope, fields, after) {
  // The restore happens later, not here. This is called from a component's
  // constructor, which Glimmer runs inside an open render transaction:
  // writing a @tracked field there throws "you attempted to update `text`,
  // but it had already been used previously in the same computation". By the
  // time IndexedDB answers the transaction has closed, so the write is an
  // ordinary update and Glimmer simply re-renders with the restored values.
  let started = false;
  const snapshot = () => Object.fromEntries(fields.map((f) => [f, target[f]]));
  const initial = Object.fromEntries(
    fields.map((f) => [f, JSON.stringify(target[f])]),
  );
  let last = JSON.stringify(snapshot());

  waitForPromise(
    read(scope).then((saved) => {
      if (isDestroyed(target) || isDestroying(target)) return;
      let restored = false;
      for (const field of fields) {
        const value = saved[field];
        if (value === undefined) continue;
        // A saved value of a different shape is from an older version of the tool.
        if (typeof value !== typeof target[field] && target[field] != null)
          continue;
        // Anything changed while storage was answering wins over the old copy.
        if (JSON.stringify(target[field]) !== initial[field]) continue;
        target[field] = value;
        restored = true;
      }
      // Only start watching once the restore is in: otherwise the first save
      // would write the defaults back over what was stored.
      last = JSON.stringify(snapshot());
      started = true;
      after?.(restored);
    }),
  );

  const save = () => {
    if (!started) return;
    let now;
    try {
      now = JSON.stringify(snapshot());
    } catch {
      return; // something in there isn't JSON-safe; leave the last good save alone
    }
    if (now === last) return;
    last = now;
    write(scope, now);
  };

  const timer = setInterval(save, SAVE_EVERY_MS);
  // Closing the tab, or switching away on a phone, may not run anything else.
  const onHide = () => save();
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onHide);

  registerDestructor(target, () => {
    clearInterval(timer);
    window.removeEventListener('pagehide', onHide);
    document.removeEventListener('visibilitychange', onHide);
    save();
  });

  return function forget() {
    last = '';
    idbDelete(keyFor(scope));
  };
}

// Everything the tools have remembered, for the Clear button in Settings (and
// for tests, which each start from nothing). Resolves with how many there were.
export async function clearAllToolState() {
  const count = (await idbEntries(PREFIX)).length;
  await idbDeletePrefix(PREFIX);
  try {
    for (const key of Object.keys(localStorage))
      if (key.startsWith(PREFIX)) localStorage.removeItem(key);
  } catch {
    // storage blocked: nothing was kept anyway
  }
  return count;
}
