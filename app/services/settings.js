import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { registerDestructor } from '@ember/destroyable';

// index.html applies both keys before first paint, so keep the names in sync with it.
const THEME_KEY = 'woogi-theme';
const MOTION_KEY = 'woogi-motion';
const HAND_SEARCH_KEY = 'woogi-hand-search';

const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key, value) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage blocked (private mode): the choice still applies for this visit
  }
};

// Matches index.html: anything that isn't an explicit light preference counts as dark.
const lightQuery = () => window.matchMedia('(prefers-color-scheme: light)');

export default class SettingsService extends Service {
  // 'system' | 'light' | 'dark'
  @tracked themePreference = ['light', 'dark'].includes(read(THEME_KEY))
    ? read(THEME_KEY)
    : 'system';
  @tracked systemDark = !lightQuery().matches;
  // 'system' follows the OS; 'reduce' switches animations off regardless.
  @tracked motion = read(MOTION_KEY) === 'reduce' ? 'reduce' : 'system';
  // Home page search results fanned in a hand of cards, next to the plain grid.
  @tracked handSearch = read(HAND_SEARCH_KEY) !== 'off';

  constructor() {
    super(...arguments);
    const query = lightQuery();
    const onChange = (event) => {
      this.systemDark = !event.matches;
      this.applyTheme();
    };
    query.addEventListener('change', onChange);
    registerDestructor(this, () =>
      query.removeEventListener('change', onChange),
    );
    this.applyTheme();
    this.applyMotion();
  }

  get theme() {
    if (this.themePreference === 'system')
      return this.systemDark ? 'dark' : 'light';
    return this.themePreference;
  }

  get isDark() {
    return this.theme === 'dark';
  }

  applyTheme() {
    document.documentElement.setAttribute('data-theme', this.theme);
  }

  applyMotion() {
    const root = document.documentElement;
    if (this.motion === 'system') root.removeAttribute('data-motion');
    else root.setAttribute('data-motion', this.motion);
  }

  setTheme(preference) {
    this.themePreference = preference;
    write(THEME_KEY, preference === 'system' ? null : preference);
    this.applyTheme();
  }

  // The header button flips between light and dark explicitly.
  toggleTheme() {
    this.setTheme(this.isDark ? 'light' : 'dark');
  }

  setHandSearch(enabled) {
    this.handSearch = enabled;
    write(HAND_SEARCH_KEY, enabled ? null : 'off');
  }

  setMotion(motion) {
    this.motion = motion;
    write(MOTION_KEY, motion === 'system' ? null : motion);
    this.applyMotion();
  }
}
