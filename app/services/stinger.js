import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { waitForPromise } from '@ember/test-waiters';
import config from 'woogi-tools/config/environment';

// The full-window showpieces. Going into one, or back out of one, is played
// over by a stinger: the screen is covered, the page changes underneath, and
// the cover comes off again.
export const STINGER_ROUTES = new Set(['video-editor', 'webskill-shenanigans']);

export const VARIANTS = ['stripes', 'blinds', 'dots', 'bounce', 'hair'];

// How long the cover takes to go on, and to come off (see _stinger.scss).
export const IN_MS = 560;
export const OUT_MS = 620;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const top = (route) => route?.name?.split('.')[0];

export default class StingerService extends Service {
  @service router;
  @service settings;

  // { id, variant } while one is playing, and whether it's covering or uncovering.
  @tracked current = null;
  @tracked phase = 'in';
  // Off in tests unless a test asks for it, so every other test navigates at full speed.
  enabled = config.environment !== 'test';
  last = null;
  seq = 0;
  passing = false;

  constructor(owner, args) {
    super(owner, args);
    this.router.on('routeWillChange', this.intercept);
  }

  willDestroy() {
    super.willDestroy(...arguments);
    this.router.off('routeWillChange', this.intercept);
  }

  // Holds the transition back until the screen is covered, then lets it through.
  intercept = (transition) => {
    if (!this.enabled || this.passing || this.current) return;
    if (transition.isAborted || !transition.from || !transition.to) return;
    const from = top(transition.from);
    const to = top(transition.to);
    if (from === to) return;
    if (!STINGER_ROUTES.has(from) && !STINGER_ROUTES.has(to)) return;
    if (this.settings.reducedMotion) return;
    transition.abort();
    waitForPromise(this.play(() => transition.retry()));
  };

  pick() {
    const pool = VARIANTS.filter((v) => v !== this.last);
    this.last = pool[Math.floor(Math.random() * pool.length)];
    return this.last;
  }

  async play(swap, variant = this.pick()) {
    const id = ++this.seq;
    this.phase = 'in';
    this.current = { id, variant };
    await wait(IN_MS);
    this.passing = true;
    try {
      await swap();
    } catch {
      // refused or redirected: the cover still comes off
    } finally {
      this.passing = false;
    }
    // Let the new page paint under the cover before taking it off.
    await frame();
    await frame();
    this.phase = 'out';
    await wait(OUT_MS);
    if (this.current?.id === id) this.current = null;
  }
}
