import config from '../config/environment.js';
import { ROUTES, REDIRECTS } from '../router.js';

// The site's router. Every page is one flat route whose path is its name
// ('/qr-code' is 'qr-code'), '/' is 'index', and anything else is
// 'not-found'. Each route's page is app/templates/<name>.svelte.
//
// In the tests the location is 'none': the address bar never changes and
// `currentURL` is the only record of where the app is.

const PAGES = Object.fromEntries(
  Object.entries(
    import.meta.glob('../templates/*.svelte', { eager: true }),
  ).map(([file, module]) => [
    file.match(/([^/]+)\.svelte$/)[1],
    module.default,
  ]),
);

const KNOWN = new Set(ROUTES);

function parse(url) {
  const u = new URL(url, 'http://x');
  let path = u.pathname.replace(/\/+$/, '') || '/';
  let name = 'index';
  if (path !== '/') {
    try {
      name = decodeURIComponent(path.slice(1));
    } catch {
      name = ''; // a malformed address ('/%zz') is just a page that is not here
    }
  }
  return {
    name: KNOWN.has(name) || name === 'index' ? name : 'not-found',
    query: Object.fromEntries(u.searchParams),
    url: path + u.search + u.hash,
  };
}

function build(name, query = {}) {
  const path = name === 'index' ? '/' : `/${name}`;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== null && value !== undefined) params.set(key, value);
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

// What 'routeWillChange' listeners get: they may abort() it and retry() later.
class Transition {
  isAborted = false;

  constructor(router, from, to, url, replace, fromHistory) {
    this.router = router;
    this.fromHistory = fromHistory;
    this.from = from ? { name: from } : null;
    this.to = { name: to };
    this.url = url;
    this.replace = replace;
  }

  abort() {
    this.isAborted = true;
  }

  retry() {
    return this.router.go(this.url, {
      replace: this.replace,
      force: true,
      fromHistory: this.fromHistory,
    });
  }
}

export default class RouterService {
  currentRouteName = $state.raw(null);
  currentURL = $state.raw(null);
  queryParams = $state.raw({});
  location = config.locationType;
  listeners = { routeWillChange: new Set(), routeDidChange: new Set() };

  constructor() {
    if (this.location === 'history') {
      this.onPopState = () => {
        const target =
          window.location.pathname +
          window.location.search +
          window.location.hash;
        // A listener may hold this back (the stinger covers the page first).
        // The address already changed, and retry() then follows it without
        // writing history again.
        this.go(target, { fromHistory: true });
      };
      window.addEventListener('popstate', this.onPopState);
    }
  }

  willDestroy() {
    if (this.onPopState)
      window.removeEventListener('popstate', this.onPopState);
  }

  // Starts at the address bar's page (or `url`, for the tests).
  start(url) {
    if (!url && this.location === 'history')
      url =
        window.location.pathname +
        window.location.search +
        window.location.hash;
    this.go(url ?? '/', { replace: true, force: true });
  }

  // The page component for the current route.
  get page() {
    return PAGES[this.currentRouteName] ?? null;
  }

  urlFor(name, options = {}) {
    return build(name, options.queryParams);
  }

  transitionTo(target, options) {
    return this.go(this.resolve(target, options));
  }

  replaceWith(target, options) {
    return this.go(this.resolve(target, options), { replace: true });
  }

  resolve(target, options) {
    return target.startsWith('/')
      ? target
      : build(target, options?.queryParams);
  }

  on(event, fn) {
    this.listeners[event].add(fn);
  }

  off(event, fn) {
    this.listeners[event].delete(fn);
  }

  // Moves to `url`. Returns a promise that resolves once the page changed, or
  // null when a listener held the transition back.
  go(url, { replace = false, force = false, fromHistory = false } = {}) {
    let target = parse(url);
    let redirected = false;
    // Old addresses that now live somewhere else.
    for (let hops = 0; REDIRECTS[target.name] && hops < 5; hops++) {
      const next = REDIRECTS[target.name](target);
      if (!next) return Promise.resolve();
      target = parse(
        typeof next === 'string' ? build(next) : build(next.name, next.query),
      );
      replace = true;
      redirected = true;
    }
    const from = this.currentRouteName;
    const transition = new Transition(
      this,
      from,
      target.name,
      target.url,
      replace,
      fromHistory,
    );
    if (!force) {
      for (const fn of this.listeners.routeWillChange) fn(transition);
      if (transition.isAborted) return null;
    }
    // A Back or Forward already moved the address, unless it landed on an old
    // address that redirects: then the entry is rewritten in place.
    if (
      this.location === 'history' &&
      (!fromHistory || redirected) &&
      target.url !== this.currentURL
    ) {
      if (replace || fromHistory)
        window.history.replaceState(null, '', target.url);
      else window.history.pushState(null, '', target.url);
    }
    this.currentURL = target.url;
    this.queryParams = target.query;
    this.currentRouteName = target.name;
    for (const fn of this.listeners.routeDidChange) fn(transition);
    return Promise.resolve(transition);
  }
}
