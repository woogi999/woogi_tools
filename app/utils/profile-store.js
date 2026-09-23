// Saved User Profiling investigations, kept in this browser's localStorage.
// Nothing leaves the device. Each saved profile holds what was searched,
// what was found, and everything the person added or hid by hand, so it can
// be reopened, edited and exported later without searching again.
//
// Storage can be full, blocked (private windows) or cleared at any time, so
// every read and write is guarded and failure is reported, never thrown.

const KEY = 'woogi-user-profiles';
// Profile links beyond this are rarely useful and eat the storage quota.
const MAX_LINKS_KEPT = 15;

function readAll() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function listProfiles() {
  return readAll()
    .map((p) => ({
      id: p.id,
      title: p.title,
      updated: p.updated,
      accounts: p.accounts?.length ?? 0,
    }))
    .sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
}

export function loadProfile(id) {
  return readAll().find((p) => p.id === id) ?? null;
}

// Returns the saved record, or null if the browser refused to store it.
export function saveProfile(profile) {
  const record = {
    ...profile,
    id: profile.id ?? `p${Date.now().toString(36)}`,
    updated: new Date().toISOString(),
    accounts: (profile.accounts ?? []).map((a) => ({
      ...a,
      profile: a.profile
        ? {
            ...a.profile,
            links: (a.profile.links ?? []).slice(0, MAX_LINKS_KEPT),
          }
        : null,
    })),
  };
  const list = readAll().filter((p) => p.id !== record.id);
  return writeAll([record, ...list]) ? record : null;
}

export function deleteProfile(id) {
  return writeAll(readAll().filter((p) => p.id !== id));
}
