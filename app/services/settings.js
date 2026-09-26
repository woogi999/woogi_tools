import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { waitForPromise } from '@ember/test-waiters';
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

  get reducedMotion() {
    return (
      this.motion === 'reduce' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  /**
   * Changes the theme. With `origin` (a point on screen, usually the button
   * that was pressed) the new theme is revealed through a circle growing out
   * from it, over the old one.
   *
   * Resolves once the new theme is in place, which with the reveal is a frame
   * or two later: anything that reads colours off the page waits for it.
   */
  setTheme(preference, origin) {
    const apply = () => {
      this.themePreference = preference;
      write(THEME_KEY, preference === 'system' ? null : preference);
      this.applyTheme();
    };
    if (!origin || !document.startViewTransition || this.reducedMotion) {
      apply();
      return Promise.resolve();
    }
    const root = document.documentElement;
    // Colour transitions on the page would otherwise fade from the old theme
    // inside the snapshot of the new one.
    root.classList.add('is-theme-switching');
    const transition = document.startViewTransition(apply);
    const { x, y } = origin;
    const reach = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );
    transition.ready
      .then(() =>
        root.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${reach}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 560,
            easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
            pseudoElement: '::view-transition-new(root)',
          },
        ),
      )
      .catch(() => {});
    transition.finished
      .catch(() => {})
      .finally(() => root.classList.remove('is-theme-switching'));
    return waitForPromise(transition.updateCallbackDone.catch(() => apply()));
  }

  // The header button flips between light and dark explicitly.
  toggleTheme(origin) {
    return this.setTheme(this.isDark ? 'light' : 'dark', origin);
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
