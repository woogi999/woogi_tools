import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { pageTitle } from 'ember-page-title';
import { LinkTo } from '@ember/routing';
import { service } from '@ember/service';
import SidebarNav from '../components/sidebar-nav';
import CommandPalette from '../components/command-palette';
import PipLayer from '../components/pip-layer';
import ThemeToggle from '../components/theme-toggle';
import Icon from '../components/icon';
import VolumeButton from '../components/volume-button';
import ConfirmHost from '../components/confirm-host';
import { installUiSounds } from '../utils/ui-sounds';

export default class Application extends Component {
  // Touching the service here is what registers the offline service worker on every page.
  @service offline;
  @tracked navOpen = false;

  constructor(owner, args) {
    super(owner, args);
    installUiSounds();
  }

  toggleNav = () => (this.navOpen = !this.navOpen);
  closeNav = () => (this.navOpen = false);

  <template>
    {{pageTitle "Woogi Tools"}}

    <div class="app-shell">
      <header class="mobile-header">
        <button type="button" class="mobile-menu-btn" aria-label="Toggle menu" aria-expanded={{if this.navOpen "true" "false"}} {{on "click" this.toggleNav}}>
          <Icon @name="menu" @size={{18}} />
        </button>
        <LinkTo @route="index" class="mobile-brand">
          <img src="/icon_expanded.png" alt="Woogi Tools" class="mobile-brand-logo" />
        </LinkTo>
        <div class="top-controls mobile-theme-toggle">
          <VolumeButton />
          <ThemeToggle />
        </div>
      </header>

      {{#if this.navOpen}}
        <button type="button" class="sidebar-backdrop" aria-label="Close menu" {{on "click" this.closeNav}}></button>
      {{/if}}

      <aside class="sidebar {{if this.navOpen 'is-open'}}">
        <LinkTo @route="index" class="sidebar-brand">
          <span class="brand-logo-wrap">
            <img src="/icon_expanded.png" alt="Woogi Tools" class="brand-logo brand-logo-static" />
            <img src="/icon_expanded.gif" alt="" aria-hidden="true" class="brand-logo brand-logo-gif" />
          </span>
        </LinkTo>

        <SidebarNav @onNavigate={{this.closeNav}} />
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
        <button type="button" class="btn math-use" {{on "click" this.offline.reload}}>Reload</button>
        <button type="button" class="qr-icon-btn" aria-label="Dismiss" {{on "click" this.offline.dismissUpdate}}><Icon @name="x" @size={{13}} /></button>
      </div>
    {{/if}}

    <svg class="doodle-filters" aria-hidden="true">
      <filter id="doodle-1"><feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="1" seed="1" result="noise" /><feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" /></filter>
      <filter id="doodle-2"><feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="1" seed="7" result="noise" /><feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" /></filter>
      <filter id="doodle-3"><feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="1" seed="13" result="noise" /><feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" /></filter>
    </svg>
  </template>
}
