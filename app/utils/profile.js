import { DEFAULT_AVATAR, playerAvatar } from './avatar';

// Your name and avatar in games, shared by every game lobby and Settings.
const PROFILE_KEY = 'woogi-game-profile';
export const NAME_LENGTH = 20;

export function loadProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY));
    if (saved?.name) return { name: String(saved.name).slice(0, NAME_LENGTH), avatar: playerAvatar(saved.avatar) };
  } catch {
    // nothing saved, or storage blocked
  }
  return { name: `Player ${Math.floor(100 + Math.random() * 900)}`, avatar: { ...DEFAULT_AVATAR } };
}

export function saveProfile(profile) {
  const clean = { name: String(profile.name ?? '').slice(0, NAME_LENGTH), avatar: playerAvatar(profile.avatar) };
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(clean));
  } catch {
    // storage blocked: the profile lasts until the tab closes
  }
  return clean;
}
