import { normaliseAvatar, DEFAULT_AVATAR, robotAvatar } from './avatar';

// Looks you've saved, and the last person and robot you made, so switching
// between them never throws either one away. Everything lives in localStorage.

const SAVES_KEY = 'woogi-avatar-saves';
const BY_TYPE_KEY = 'woogi-avatar-by-type';
export const MAX_SAVES = 16;

function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked or full: saves last until the tab closes
  }
}

export function loadSaves() {
  const saves = read(SAVES_KEY, []);
  return Array.isArray(saves) ? saves.slice(0, MAX_SAVES).map((s, i) => ({ id: String(s?.id ?? i), label: String(s?.label ?? 'Look').slice(0, 24), avatar: normaliseAvatar(s?.avatar) })) : [];
}

export function storeSaves(saves) {
  write(SAVES_KEY, saves.slice(0, MAX_SAVES));
}

// Remembers this avatar as the latest of its type.
export function rememberType(avatar) {
  const a = normaliseAvatar(avatar);
  write(BY_TYPE_KEY, { ...read(BY_TYPE_KEY, {}), [a.type]: a });
}

// The latest avatar of a type, or a fresh one if there isn't one yet.
export function recallType(type) {
  const saved = read(BY_TYPE_KEY, {})?.[type];
  if (saved) return normaliseAvatar(saved);
  return type === 'robot' ? robotAvatar(Math.floor(Math.random() * 1e9), 0) : { ...DEFAULT_AVATAR };
}
