import { DEFAULT_AVATAR, playerAvatar } from './avatar';
import { normalisePose } from './pose';

// Your name, avatar and profile pose in games, shared by every game lobby, Settings and the Avatar Editor.
const PROFILE_KEY = 'woogi-game-profile';
export const NAME_LENGTH = 20;

export function loadProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY));
    if (saved?.name)
      return {
        name: String(saved.name).slice(0, NAME_LENGTH),
        avatar: playerAvatar(saved.avatar),
        pose: normalisePose(saved.pose),
        look: typeof saved.look === 'string' ? saved.look : null,
      };
  } catch {
    // nothing saved, or storage blocked
  }
  return {
    name: `Player ${Math.floor(100 + Math.random() * 900)}`,
    avatar: { ...DEFAULT_AVATAR },
    pose: normalisePose(null),
    look: null,
  };
}

export function saveProfile(profile) {
  const clean = {
    name: String(profile.name ?? '').slice(0, NAME_LENGTH),
    avatar: playerAvatar(profile.avatar),
    pose: normalisePose(profile.pose),
    // Which saved look this is, if it came from one.
    look: typeof profile.look === 'string' ? profile.look : null,
  };
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(clean));
  } catch {
    // storage blocked: the profile lasts until the tab closes
  }
  return clean;
}
