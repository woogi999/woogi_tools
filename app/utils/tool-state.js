// Keeps what you typed into a tool. Leaving a tool's page tears its component
// down, and a refresh loses the lot, which is infuriating when you have pasted
// in a wall of text and gone to look something up. This writes the fields a
// tool cares about to localStorage and puts them back the next time it opens.
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

const PREFIX = 'woogi-tool:';
// Saving on every keystroke would write to disk hundreds of times a minute.
const SAVE_EVERY_MS = 600;
// A single tool's state should never grow into something worth evicting.
const MAX_BYTES = 200000;

const keyFor = (scope) => `${PREFIX}${scope}`;

function read(scope) {
  try {
    const raw = localStorage.getItem(keyFor(scope));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function write(scope, value) {
  try {
    const json = JSON.stringify(value);
    if (json.length > MAX_BYTES) return;
    localStorage.setItem(keyFor(scope), json);
  } catch {
    // storage blocked or full: the tool still works, it just won't be remembered
  }
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
  // The restore happens in a microtask, not here. This is called from a
  // component's constructor, which Glimmer runs inside an open render
  // transaction: writing a @tracked field there throws "you attempted to update
  // `text`, but it had already been used previously in the same computation".
  // A microtask runs after the transaction closes, so the write is an ordinary
  // update and Glimmer simply re-renders with the restored values.
  queueMicrotask(() => {
    if (isDestroyed(target) || isDestroying(target)) return;
    const saved = read(scope);
    for (const field of fields) {
      const value = saved[field];
      if (value === undefined) continue;
      // A saved value of a different shape is from an older version of the tool.
      if (typeof value !== typeof target[field] && target[field] != null)
        continue;
      target[field] = value;
    }
    // Only start watching once the restore is in: otherwise the first save
    // would write the defaults back over what was stored.
    last = JSON.stringify(snapshot());
    started = true;
    after?.();
  });

  let started = false;
  const snapshot = () => Object.fromEntries(fields.map((f) => [f, target[f]]));
  let last = JSON.stringify(snapshot());
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
    write(scope, JSON.parse(now));
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
    try {
      localStorage.removeItem(keyFor(scope));
    } catch {
      // nothing stored to remove
    }
  };
}

// Everything the tools have remembered, for the Clear button in Settings.
export function clearAllToolState() {
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(PREFIX));
    for (const key of keys) localStorage.removeItem(key);
    return keys.length;
  } catch {
    return 0;
  }
}
