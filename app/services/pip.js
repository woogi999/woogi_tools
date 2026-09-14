import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

const WINDOW_WIDTH = 440;
const WINDOW_HEIGHT = 330;
const MIN_WIDTH = 260;
const MIN_HEIGHT = 190;
const MARGIN = 16;
// Page content is laid out at this width, then zoomed down to fit the window.
export const PIP_LAYOUT_WIDTH = 980;

let nextId = 0;

// One tool's page, kept alive while it moves around the site.
class PipSession {
  @tracked mode = 'inline'; // 'inline' (on its own page) | 'floating' | 'minimized'
  @tracked x = 0;
  @tracked y = 0;
  @tracked width = WINDOW_WIDTH;
  @tracked height = WINDOW_HEIGHT;

  constructor(route, component) {
    this.id = ++nextId;
    this.route = route;
    this.component = component;
    // Rendered into once with {{in-element}} and never re-created. Moving this
    // element between the page, the floating window and the parking spot moves
    // the live tool with it: timers, canvases, WebGL and peer connections included.
    this.element = document.createElement('div');
    this.element.className = 'pip-live';
  }
}

// Picture-in-picture for tools and games.
//
// Every tool page renders through a ToolSlot, which asks this service for the
// page's session. The component itself is rendered by the PipLayer in the
// application template, into the session's detached element; the service then
// physically places that element where it should be seen:
//   inline    inside the route's slot, like a normal page
//   floating  inside a draggable window over whatever page you're on
//   minimized in a hidden parking spot (still running), shown as a pill
//
// Leaving a page destroys its tool as usual, unless the tool says it's busy
// (a game in progress): then it floats instead.
export default class PipService extends Service {
  @service router;

  @tracked sessions = [];

  byRoute = new Map(); // route -> session, untracked mirror of `sessions`
  slots = new Map(); // route -> slot element on the current page
  frames = new Map(); // session id -> body element of its floating window
  providers = new Map(); // route -> () => ({ busy, warning })
  parking = null;

  sessionFor(route) {
    return this.sessions.find((s) => s.route === route) ?? null;
  }

  // ─── Called by ToolSlot and ToolPage ────────────────────────────────

  // The route's page is being shown: reuse its live tool, or start one.
  enter(route, component) {
    // Called while rendering, so it must not read the tracked list before
    // writing it (Ember asserts on that): look the session up untracked.
    let session = this.byRoute.get(route);
    if (!session) {
      session = new PipSession(route, component);
      this.byRoute.set(route, session);
      this.sessions = [...this.byRoute.values()];
    }
    session.mode = 'inline';
    return session;
  }

  // The route's page is going away.
  leave(route) {
    const session = this.sessionFor(route);
    if (!session || session.mode !== 'inline') return;
    if (this.status(route).busy) this.float(session);
    else this.remove(session);
  }

  bindSlot(route, element) {
    this.slots.set(route, element);
    const session = this.sessionFor(route);
    if (session) this.place(session);
  }

  unbindSlot(route, element) {
    if (this.slots.get(route) === element) this.slots.delete(route);
  }

  bindFrame(session, element) {
    this.frames.set(session.id, element);
    this.place(session);
  }

  unbindFrame(session, element) {
    if (this.frames.get(session.id) === element) this.frames.delete(session.id);
  }

  bindParking(element) {
    this.parking = element;
    for (const session of this.sessions) this.place(session);
  }

  // Lets a tool report whether leaving it would interrupt something.
  provide(route, provider) {
    this.providers.set(route, provider);
    return () => {
      if (this.providers.get(route) === provider) this.providers.delete(route);
    };
  }

  status(route) {
    return this.providers.get(route)?.() ?? { busy: false, warning: '' };
  }

  // ─── Window actions ─────────────────────────────────────────────────

  float = (session) => {
    if (session.mode === 'inline' || session.mode === 'minimized') {
      // New windows open in the bottom-right corner; later ones cascade up-left.
      if (session.mode === 'inline') {
        const offset = (this.sessions.filter((s) => s.mode === 'floating').length % 5) * 28;
        session.width = Math.min(WINDOW_WIDTH, window.innerWidth - MARGIN * 2);
        session.height = Math.min(WINDOW_HEIGHT, window.innerHeight - MARGIN * 2);
        session.x = window.innerWidth - session.width - MARGIN - offset;
        session.y = window.innerHeight - session.height - MARGIN - 56 - offset;
      }
      session.mode = 'floating';
      this.clamp(session);
    }
    this.place(session);
  };

  minimize = (session) => {
    session.mode = 'minimized';
    this.place(session);
  };

  // Back to the tool's own page, where its slot takes it in again.
  expand = (session) => {
    if (this.router.currentRouteName === session.route) {
      session.mode = 'inline';
      this.place(session);
    } else {
      this.router.transitionTo(session.route);
    }
  };

  // Closing a busy tool (a game in progress) asks first, since it disconnects
  // you, or ends the game for everyone if you're hosting.
  close = (session) => {
    const { busy, warning } = this.status(session.route);
    if (busy && !window.confirm(warning || 'Close this? It is still running.')) return;
    this.remove(session);
    // Closed while its own page is open: that page starts afresh.
    if (this.router.currentRouteName === session.route && this.slots.has(session.route)) {
      const fresh = this.enter(session.route, session.component);
      this.place(fresh);
    }
  };

  remove(session) {
    if (this.byRoute.get(session.route) === session) this.byRoute.delete(session.route);
    this.sessions = [...this.byRoute.values()];
    this.frames.delete(session.id);
    session.element.remove();
  }

  moveTo(session, x, y) {
    session.x = x;
    session.y = y;
    this.clamp(session);
  }

  resizeTo(session, width, height) {
    session.width = Math.max(MIN_WIDTH, Math.min(width, window.innerWidth - MARGIN * 2));
    session.height = Math.max(MIN_HEIGHT, Math.min(height, window.innerHeight - MARGIN * 2));
    this.clamp(session);
  }

  // Keeps at least the title bar on screen.
  clamp(session) {
    session.x = Math.min(Math.max(session.x, MARGIN - session.width + 120), window.innerWidth - 120);
    session.y = Math.min(Math.max(session.y, 0), window.innerHeight - 40);
  }

  // ─── Placement ──────────────────────────────────────────────────────

  place(session) {
    const target = session.mode === 'inline' ? this.slots.get(session.route) : session.mode === 'floating' ? this.frames.get(session.id) : this.parking;
    // The target may not exist yet (a window about to render); its bind call places it then.
    if (target && session.element.parentElement !== target) target.appendChild(session.element);
  }
}
