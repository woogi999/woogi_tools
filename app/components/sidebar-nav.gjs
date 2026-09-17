import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { LinkTo } from '@ember/routing';
import { service } from '@ember/service';
import { modifier } from 'ember-modifier';
import Icon from './icon';
import { searchTools, groupTools } from '../tools';

// Below this scroll position the homepage's own big search box is still on
// screen, so the sidebar's copy of it would be redundant.
const TOP_THRESHOLD = 24;

export default class SidebarNav extends Component {
  @service router;
  @service toolVisibility;
  @tracked query = '';
  @tracked atTop = true;

  // Re-runs when the route or the filtered list changes; reads the rendered active link's position.
  placeHand = modifier((nav, [, groups]) => {
    const frame = requestAnimationFrame(() => {
      const active = nav.querySelector('.nav-link.active');
      nav.classList.toggle('has-active', Boolean(active) && groups.length > 0);
      if (active)
        nav.style.setProperty(
          '--hand-y',
          `${active.offsetTop + active.offsetHeight / 2}px`,
        );
    });
    return () => cancelAnimationFrame(frame);
  });

  // Tracks the page's scroll position so the search can hide itself while
  // the homepage's own search is in view, and come back once you scroll past it.
  watchScroll = modifier(() => {
    const update = () => (this.atTop = window.scrollY < TOP_THRESHOLD);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  });

  get isHome() {
    return this.router.currentRouteName === 'index';
  }

  get hideSearch() {
    return this.isHome && this.atTop && !this.query;
  }

  get groups() {
    const visible = searchTools(this.query).filter((tool) =>
      this.toolVisibility.isVisible(tool),
    );
    return groupTools(visible);
  }

  updateQuery = (event) => {
    this.query = event.target.value;
  };

  noop = () => {};

  <template>
    <div
      class="sidebar-search {{if this.hideSearch 'is-collapsed'}}"
      {{this.watchScroll}}
    >
      <Icon @name="search" @size={{13}} />
      <input
        type="text"
        placeholder="Search tools…"
        aria-label="Search tools"
        value={{this.query}}
        {{on "input" this.updateQuery}}
      />
    </div>

    <nav
      class="sidebar-nav"
      {{this.placeHand this.router.currentRouteName this.groups}}
    >
      <span class="nav-hand" aria-hidden="true"><Icon
          @name="pointer"
          @size={{16}}
        /></span>
      {{#each this.groups as |group|}}
        {{#if group.name}}
          <div class="nav-group-label">{{group.name}}</div>
        {{/if}}
        {{#each group.items as |tool|}}
          <LinkTo
            @route={{tool.route}}
            class="nav-link"
            activeClass="active"
            {{on "click" (if @onNavigate @onNavigate this.noop)}}
          >
            <Icon @name={{tool.icon}} @size={{15}} />
            <span>{{tool.label}}</span>
          </LinkTo>
        {{/each}}
      {{else}}
        <div class="nav-empty">No tools found</div>
      {{/each}}
    </nav>
  </template>
}
