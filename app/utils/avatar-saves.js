import { playerAvatar } from './avatar';

// Looks you've saved in the avatar maker, kept in localStorage.

const SAVES_KEY = 'woogi-avatar-saves';
export const MAX_SAVES = 16;

export function loadSaves() {
  try {
    const saves = JSON.parse(localStorage.getItem(SAVES_KEY));
    if (!Array.isArray(saves)) return [];
    // Robots saved before people and robots were split up don't come back.
    return saves
      .filter((s) => s?.avatar?.type !== 'robot')
      .slice(0, MAX_SAVES)
      .map((s, i) => ({ id: String(s?.id ?? i), label: String(s?.label ?? 'Look').slice(0, 24), avatar: playerAvatar(s?.avatar) }));
  } catch {
    return [];
  }
}

export function storeSaves(saves) {
  try {
    localStorage.setItem(SAVES_KEY, JSON.stringify(saves.slice(0, MAX_SAVES)));
  } catch {
    // storage blocked or full: saves last until the tab closes
  }
}
