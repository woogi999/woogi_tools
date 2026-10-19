<script module>
  import { onDestroy } from 'svelte';
  import Component from './core/component.js';
  import Link from './core/link.svelte';
  import { service } from './core/services.js';
  import { modifier } from './core/modifier.js';
  import { truthy } from './core/helpers.js';
  import Outlet from './core/outlet.svelte';
  import { destroy } from './core/destroyable.js';
  import SidebarNav from './components/sidebar-nav.svelte';
  import CommandPalette from './components/command-palette.svelte';
  import PipLayer from './components/pip-layer.svelte';
  import ThemeToggle from './components/theme-toggle.svelte';
  import Icon from './components/icon.svelte';
  import VolumeButton from './components/volume-button.svelte';
  import ConfirmHost from './components/confirm-host.svelte';
  import LogoStinger from './components/logo-stinger.svelte';
  import { installUiSounds } from './utils/ui-sounds.js';
  import { installGamepad } from './utils/gamepad.svelte.js';
  import { pageMeta, SITE_NAME } from './utils/page-meta.js';

  // Routes that take the whole window: no sidebar, no header, no theme
  // controls, no command palette. A bare route is a page in its own right and
  // is responsible for its own way back into the site.
  const BARE_ROUTES = ['video-editor', '3d-studio', 'not-found'];

  class Application extends Component {
    // Touching the service here is what registers the offline service worker on every page.
    offline = service('offline');
    router = service('router');
    handoff = service('handoff');
    // Touched here so it's listening before the first trip into a full-window tool.
    stinger = service('stinger');
    navOpen = $state.raw(false);
    homeSearchVisible = $state.raw(true);

    constructor(args) {
      super(args);
      installUiSounds();
      installGamepad();
      void this.stinger;
      // A file brought along from the home page goes into the tool once it has rendered.
      this.router.on('routeDidChange', () => {
        if (!this.handoff.file) return;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => this.handoff.feed()),
        );
      });
    }

    toggleNav = () => (this.navOpen = !this.navOpen);
    closeNav = () => (this.navOpen = false);

    // Tracks whether the homepage's own logo and search box are actually on
    // screen, so the sidebar's copies (redundant with them) can hide while
    // they're visible and come back the moment they scroll out of view (or
    // you leave the homepage, where there's nothing to check).
    // Re-runs (and re-checks straight away) whenever the route changes, since
    // navigating to or away from the homepage is otherwise silent.
    // eslint-disable-next-line no-unused-vars
    watchScroll = modifier((element, [route]) => {
      const update = () => {
        // While the homepage snaps between its search and its tools, it says
        // which one it's heading for, so the sidebar swaps in step with the snap.
        const view = document.documentElement.dataset.homeView;
        if (view) {
          this.homeSearchVisible = view === 'hero';
          return;
        }
        const home = document.querySelector('.home-search');
        this.homeSearchVisible = home
          ? home.getBoundingClientRect().bottom > 0
          : false;
      };
      update();
      window.addEventListener('scroll', update, { passive: true });
      window.addEventListener('resize', update, { passive: true });
      window.addEventListener('woogi:home-view', update);
      return () => {
        window.removeEventListener('scroll', update);
        window.removeEventListener('resize', update);
        window.removeEventListener('woogi:home-view', update);
      };
    });

    get bare() {
      return BARE_ROUTES.includes(this.router.currentRouteName);
    }

    // The shell normally lets the page scroll; a bare route is a fixed layer
    // over the whole viewport, so the scrollbar it would leave behind is taken
    // away while it is open and given back when it closes.
    lockScroll = modifier(() => {
      const root = document.documentElement;
      root.dataset.bare = 'true';
      return () => delete root.dataset.bare;
    });

    get isHome() {
      return this.router.currentRouteName === 'index';
    }

    // The tab title follows the page you're on ("Colour Picker | Woogi Tools").
    get title() {
      const route = this.router.currentRouteName;
      return route ? pageMeta(route.split('.')[0]).title : SITE_NAME;
    }

    get collapseBrand() {
      return this.isHome && this.homeSearchVisible;
    }
  }
</script>

<script>
  let args = $props();
  const self = new Application(args);
  onDestroy(() => destroy(self));
  $effect(() => {
    document.title = self.title;
  });
</script>

{#if truthy(self.bare)}
  <div {@attach self.lockScroll?.()}>
    <Outlet />
  </div>
  <ConfirmHost />
{:else}
  <div class="app-shell">
    <header class="mobile-header">
      <button
        type="button"
        class="mobile-menu-btn"
        aria-label="Toggle menu"
        aria-expanded={truthy(self.navOpen) ? 'true' : 'false'}
        onclick={self.toggleNav}
      >
        <Icon name="menu" size={18} />
      </button>
      <Link route="index" class="mobile-brand">
        <img
          src="/icon_expanded.png"
          alt="Woogi Tools"
          class="mobile-brand-logo"
        />
      </Link>
      <div class="top-controls mobile-theme-toggle">
        <VolumeButton />
        <ThemeToggle />
      </div>
    </header>

    {#if truthy(self.navOpen)}
      <button
        type="button"
        class="sidebar-backdrop"
        aria-label="Close menu"
        onclick={self.closeNav}
      ></button>
    {/if}

    <aside
      class="sidebar {truthy(self.navOpen) ? 'is-open' : ''}"
      {@attach self.watchScroll?.([self.router?.currentRouteName])}
    >
      <Link route="index" class="sidebar-brand">
        <span
          class="brand-logo-wrap {truthy(self.collapseBrand)
            ? 'is-collapsed'
            : ''}"
        >
          <img
            src="/icon_expanded.png"
            alt="Woogi Tools"
            class="brand-logo brand-logo-static"
          />
          <img
            src="/icon_expanded.gif"
            alt=""
            aria-hidden="true"
            class="brand-logo brand-logo-gif"
          />
        </span>
      </Link>

      <SidebarNav onNavigate={self.closeNav} collapsed={self.collapseBrand} />
    </aside>

    <div class="content-col">
      <div class="top-controls desktop-theme-toggle">
        <VolumeButton />
        <ThemeToggle />
      </div>

      <main>
        <Outlet />
      </main>
    </div>
  </div>

  <CommandPalette />

  <!-- After the outlet on purpose: pages register their tools first (see services/pip.js). -->
  <PipLayer />

  <ConfirmHost />

  {#if truthy(self.offline?.updateReady)}
    <div class="update-toast pop-in" role="status">
      <Icon name="refresh-cw" size={14} />
      <span>A new version of Woogi Tools is ready.</span>
      <Link route="updates" class="update-toast-link">What's new</Link>
      <button type="button" class="btn math-use" onclick={self.offline?.reload}
        >Reload</button
      >
      <button
        type="button"
        class="qr-icon-btn"
        aria-label="Dismiss"
        onclick={self.offline?.dismissUpdate}
        ><Icon name="x" size={13} /></button
      >
    </div>
  {/if}
{/if}

<LogoStinger />

<svg class="doodle-filters" aria-hidden="true">
  <filter id="doodle-1"
    ><feTurbulence
      type="fractalNoise"
      baseFrequency="0.09"
      numOctaves="1"
      seed="1"
      result="noise"
    ></feTurbulence><feDisplacementMap
      in="SourceGraphic"
      in2="noise"
      scale="2.2"
    ></feDisplacementMap></filter
  >
  <filter id="doodle-2"
    ><feTurbulence
      type="fractalNoise"
      baseFrequency="0.09"
      numOctaves="1"
      seed="7"
      result="noise"
    ></feTurbulence><feDisplacementMap
      in="SourceGraphic"
      in2="noise"
      scale="2.2"
    ></feDisplacementMap></filter
  >
  <filter id="doodle-3"
    ><feTurbulence
      type="fractalNoise"
      baseFrequency="0.09"
      numOctaves="1"
      seed="13"
      result="noise"
    ></feTurbulence><feDisplacementMap
      in="SourceGraphic"
      in2="noise"
      scale="2.2"
    ></feDisplacementMap></filter
  >
</svg>
