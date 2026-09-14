import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { registerDestructor } from '@ember/destroyable';
import config from 'woogi-tools/config/environment';

const CACHE_PREFIX = 'woogi-offline-';
const UPDATE_CHECK_MS = 30 * 60 * 1000;

// Stamped into index.html by lib/offline-plugin.mjs; missing in development.
const pageBuild = () => document.querySelector('meta[name="woogi-build"]')?.content ?? null;

// Owns the service worker that makes the site work offline (lib/service-worker.js).
export default class OfflineService extends Service {
  // 'unsupported' | 'disabled' (dev/test) | 'installing' | 'ready' | 'cleared' | 'error'
  @tracked status = 'installing';
  @tracked isOnline = navigator.onLine;
  // True once a newer build has taken over in the background; a reload shows it.
  @tracked updateReady = false;
  @tracked checking = false;
  @tracked lastChecked = null;
  // Bytes in this site's offline caches, or null until measured.
  @tracked cacheBytes = null;
  @tracked cacheFiles = null;

  buildId = pageBuild();
  @tracked registration = null;

  constructor() {
    super(...arguments);
    if (!('serviceWorker' in navigator) || !window.caches) {
      this.status = 'unsupported';
      return;
    }
    // The build ID only exists in `vite build` output, so its presence (not the
    // Ember environment, which a concurrently running dev server can leak into a
    // build) is what says there's a service worker to register.
    if (config.environment === 'test' || !this.buildId) {
      this.status = 'disabled';
      return;
    }

    const onOnline = () => {
      this.isOnline = true;
      // Back on the internet: look for a newer version straight away.
      this.checkForUpdate();
    };
    const onOffline = () => (this.isOnline = false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const timer = setInterval(() => this.checkForUpdate(), UPDATE_CHECK_MS);
    registerDestructor(this, () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(timer);
    });

    this.register();
  }

  async register() {
    const { serviceWorker } = navigator;
    // A first visit gets its controller via clients.claim(); only a change
    // *after* that means a new build replaced the one this page was loaded from.
    let hadController = Boolean(serviceWorker.controller);
    serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) this.updateReady = true;
      hadController = true;
      this.status = 'ready';
      this.measure();
    });

    try {
      this.registration = await serviceWorker.register('/sw.js');
      await serviceWorker.ready;
      this.status = 'ready';
      this.lastChecked = new Date();
      this.measure();
    } catch (error) {
      console.warn('Offline support unavailable:', error);
      this.status = 'error';
    }
  }

  checkForUpdate = async () => {
    if (!this.registration || !navigator.onLine || this.checking) return;
    this.checking = true;
    try {
      await this.registration.update();
      this.lastChecked = new Date();
    } catch {
      // offline or the server hiccuped; the next check will try again
    } finally {
      this.checking = false;
    }
  };

  async measure() {
    try {
      let total = 0;
      let count = 0;
      for (const name of await caches.keys()) {
        if (!name.startsWith(CACHE_PREFIX)) continue;
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          const response = await cache.match(request);
          count++;
          const length = Number(response?.headers.get('content-length'));
          // Opaque (cross-origin font) responses hide their size; they're tiny.
          total += length || (response?.type === 'opaque' ? 0 : (await response.blob()).size);
        }
      }
      this.cacheBytes = total;
      this.cacheFiles = count;
    } catch {
      this.cacheBytes = null;
    }
  }

  reload = () => {
    // eslint-disable-next-line warp-drive/no-legacy-request-patterns -- a page reload, not a data request
    window.location.reload();
  };

  dismissUpdate = () => (this.updateReady = false);

  // Removes the worker and every offline copy. The next visit starts over.
  async clear() {
    const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(registrations.map((r) => r.unregister()));
    const names = window.caches ? await caches.keys() : [];
    await Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX)).map((n) => caches.delete(n)));
    this.registration = null;
    this.cacheBytes = 0;
    this.cacheFiles = 0;
    this.status = 'cleared';
  }
}
