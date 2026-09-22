import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { pageTitle } from 'ember-page-title';
import { LinkTo } from '@ember/routing';
import { service } from '@ember/service';
import { modifier } from 'ember-modifier';
import SidebarNav from '../components/sidebar-nav';
import CommandPalette from '../components/command-palette';
import PipLayer from '../components/pip-layer';
import ThemeToggle from '../components/theme-toggle';
import Icon from '../components/icon';
import VolumeButton from '../components/volume-button';
import ConfirmHost from '../components/confirm-host';
import { installUiSounds } from '../utils/ui-sounds';
import { installGamepad } from '../utils/gamepad';

// Routes that take the whole window: no sidebar, no header, no theme
// controls, no command palette. A bare route is a page in its own right and
// is responsible for its own way back into the site.
const BARE_ROUTES = ['video-editor', 'not-found'];

export default class Application extends Component {
  // Touching the service here is what registers the offline service worker on every page.
  @service offline;
  @service router;
  @service handoff;
  @tracked navOpen = false;
  @tracked homeSearchVisible = true;

  constructor(owner, args) {
    super(owner, args);
    installUiSounds();
    installGamepad();
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

  get collapseBrand() {
    return this.isHome && this.homeSearchVisible;
  }

  <template>
    {{pageTitle "Woogi Tools"}}

    {{#if this.bare}}
      <div {{this.lockScroll}}>
        {{outlet}}
      </div>
      <ConfirmHost />
    {{else}}
      <div class="app-shell">
        <header class="mobile-header">
          <button
            type="button"
            class="mobile-menu-btn"
            aria-label="Toggle menu"
            aria-expanded={{if this.navOpen "true" "false"}}
            {{on "click" this.toggleNav}}
          >
            <Icon @name="menu" @size={{18}} />
          </button>
          <LinkTo @route="index" class="mobile-brand">
            <img
              src="/icon_expanded.png"
              alt="Woogi Tools"
              class="mobile-brand-logo"
            />
          </LinkTo>
          <div class="top-controls mobile-theme-toggle">
            <VolumeButton />
            <ThemeToggle />
          </div>
        </header>

        {{#if this.navOpen}}
          <button
            type="button"
            class="sidebar-backdrop"
            aria-label="Close menu"
            {{on "click" this.closeNav}}
          ></button>
        {{/if}}

        <aside
          class="sidebar {{if this.navOpen 'is-open'}}"
          {{this.watchScroll this.router.currentRouteName}}
        >
          <LinkTo @route="index" class="sidebar-brand">
            <span
              class="brand-logo-wrap {{if this.collapseBrand 'is-collapsed'}}"
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
          </LinkTo>

          <SidebarNav
            @onNavigate={{this.closeNav}}
            @collapsed={{this.collapseBrand}}
          />
        </aside>

        <div class="content-col">
          <div class="top-controls desktop-theme-toggle">
            <VolumeButton />
            <ThemeToggle />
          </div>

          <main>
            {{outlet}}
          </main>
        </div>
      </div>

      <CommandPalette />

      {{! After the outlet on purpose: pages register their tools first (see services/pip.js). }}
      <PipLayer />

      <ConfirmHost />

      {{#if this.offline.updateReady}}
        <div class="update-toast pop-in" role="status">
          <Icon @name="refresh-cw" @size={{14}} />
          <span>A new version of Woogi Tools is ready.</span>
          <LinkTo @route="updates" class="update-toast-link">What's new</LinkTo>
          <button
            type="button"
            class="btn math-use"
            {{on "click" this.offline.reload}}
          >Reload</button>
          <button
            type="button"
            class="qr-icon-btn"
            aria-label="Dismiss"
            {{on "click" this.offline.dismissUpdate}}
          ><Icon @name="x" @size={{13}} /></button>
        </div>
      {{/if}}

    {{/if}}

    <svg class="doodle-filters" aria-hidden="true">
      <filter id="doodle-1"><feTurbulence
          type="fractalNoise"
          baseFrequency="0.09"
          numOctaves="1"
          seed="1"
          result="noise"
        /><feDisplacementMap
          in="SourceGraphic"
          in2="noise"
          scale="2.2"
        /></filter>
      <filter id="doodle-2"><feTurbulence
          type="fractalNoise"
          baseFrequency="0.09"
          numOctaves="1"
          seed="7"
          result="noise"
        /><feDisplacementMap
          in="SourceGraphic"
          in2="noise"
          scale="2.2"
        /></filter>
      <filter id="doodle-3"><feTurbulence
          type="fractalNoise"
          baseFrequency="0.09"
          numOctaves="1"
          seed="13"
          result="noise"
        /><feDisplacementMap
          in="SourceGraphic"
          in2="noise"
          scale="2.2"
        /></filter>
    </svg>
  </template>
}
