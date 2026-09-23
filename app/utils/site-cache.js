// Remembers what each site said about each name, so profiling the same person
// again — or reopening the page — doesn't ask every site from scratch. Kept in
// this browser's localStorage; nothing leaves the device. A person can retest
// any single site, which drops its cached answer and asks again.
//
// Like everything else that touches storage here, every read and write is
// guarded: a full, blocked or cleared store just means no cache, never a throw.

const KEY = 'woogi-site-cache';
// Answers older than this are re-checked; accounts come and go.
const MAX_AGE = 14 * 24 * 60 * 60 * 1000;
// The most answers kept. Past this the oldest are dropped, so the cache can't
// grow without bound and blow the storage quota.
const MAX_ENTRIES = 4000;

const keyOf = (site, name) => `${site}\u0000${String(name).toLowerCase()}`;

function readAll() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Full or blocked: trim to the newest half and try once more.
    try {
      const kept = Object.entries(data)
        .sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0))
        .slice(0, Math.floor(MAX_ENTRIES / 2));
      localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)));
    } catch {
      // Give up quietly; the cache is only ever an optimisation.
    }
  }
}

// The remembered answer for one site and name, or null if there's none or it's
// gone stale. Shape: { state, note, profile }.
export function cachedResult(site, name) {
  const entry = readAll()[keyOf(site, name)];
  if (!entry || Date.now() - (entry.at ?? 0) > MAX_AGE) return null;
  return { state: entry.state, note: entry.note ?? '', profile: entry.profile };
}

export function cacheResult(site, name, { state, note, profile }) {
  const data = readAll();
  data[keyOf(site, name)] = { state, note, profile, at: Date.now() };
  const keys = Object.keys(data);
  if (keys.length > MAX_ENTRIES) {
    const oldest = keys
      .sort((a, b) => (data[a].at ?? 0) - (data[b].at ?? 0))
      .slice(0, keys.length - MAX_ENTRIES);
    for (const k of oldest) delete data[k];
  }
  writeAll(data);
}

// Store the profile data on an already-cached answer (profiles are read after
// the found/absent check, so they arrive separately).
export function cacheProfile(site, name, profile) {
  const data = readAll();
  const entry = data[keyOf(site, name)];
  if (!entry) return;
  entry.profile = profile;
  entry.at = Date.now();
  writeAll(data);
}

export function forgetResult(site, name) {
  const data = readAll();
  delete data[keyOf(site, name)];
  writeAll(data);
}

export function clearCache() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to do
  }
}
