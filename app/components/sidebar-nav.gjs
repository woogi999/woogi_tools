import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { LinkTo } from '@ember/routing';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import Icon from './icon';
import { searchTools, groupTools } from '../tools';

const accentStyle = (accent) => htmlSafe(accent ? `color:${accent};` : '');

export default class SidebarNav extends Component {
  @service router;
  @service toolVisibility;
  @tracked query = '';

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

  // `@collapsed` comes from the app shell, which tracks whether we're on the
  // homepage scrolled to the top (where its own search box makes this one
  // redundant). Typing into this box keeps it visible regardless.
  get hideSearch() {
    return this.args.collapsed && !this.query;
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
    <div class="sidebar-search {{if this.hideSearch 'is-collapsed'}}">
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
          {{#if tool.href}}
            <a
              href={{tool.href}}
              class="nav-link nav-link-external"
              target="_blank"
              rel="noopener noreferrer"
              style={{accentStyle tool.accent}}
            >
              <Icon @name={{tool.icon}} @size={{15}} />
              <span>{{tool.label}}</span>
            </a>
          {{else}}
            <LinkTo
              @route={{tool.route}}
              class="nav-link"
              activeClass="active"
              {{on "click" (if @onNavigate @onNavigate this.noop)}}
            >
              <Icon @name={{tool.icon}} @size={{15}} />
              <span>{{tool.label}}</span>
            </LinkTo>
          {{/if}}
        {{/each}}
      {{else}}
        <div class="nav-empty">No tools found</div>
      {{/each}}
    </nav>
  </template>
}
