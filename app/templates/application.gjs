import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { pageTitle } from 'ember-page-title';
import { LinkTo } from '@ember/routing';
import SidebarNav from '../components/sidebar-nav';
import CommandPalette from '../components/command-palette';
import ThemeToggle from '../components/theme-toggle';
import Icon from '../components/icon';

export default class Application extends Component {
  @tracked navOpen = false;

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
        <ThemeToggle class="mobile-theme-toggle" />
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
        <ThemeToggle class="desktop-theme-toggle" />

        <main>
          {{outlet}}
        </main>
      </div>
    </div>

    <CommandPalette />

    <svg class="doodle-filters" aria-hidden="true">
      <filter id="doodle-1"><feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="1" seed="1" result="noise" /><feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" /></filter>
      <filter id="doodle-2"><feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="1" seed="7" result="noise" /><feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" /></filter>
      <filter id="doodle-3"><feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="1" seed="13" result="noise" /><feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" /></filter>
    </svg>
  </template>
}
