<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import Link from '../core/link.svelte';
  import { service } from '../core/services.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import Icon from './icon.svelte';
  import { searchTools, groupTools, isOpus } from '../tools.js';

  class SidebarNav extends Component {
    router = service('router');
    toolVisibility = service('tool-visibility');
    query = $state.raw('');

    // Re-runs when the route or the filtered list changes; reads the rendered active link's position.
    placeHand = modifier((nav, [, groups]) => {
      const frame = requestAnimationFrame(() => {
        const active = nav.querySelector('.nav-link.active');
        nav.classList.toggle(
          'has-active',
          Boolean(active) && groups.length > 0,
        );
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
      // A search lists each tool once, under its own category.
      return groupTools(visible, { copies: !this.query.trim() });
    }

    updateQuery = (event) => {
      this.query = event.target.value;
    };

    noop = () => {};
  }
</script>

<script>
  let args = $props();
  const self = new SidebarNav(args);
  onDestroy(() => destroy(self));
</script>

<div class="sidebar-search {truthy(self.hideSearch) ? 'is-collapsed' : ''}">
  <Icon name="search" size={13} />
  <input
    type="text"
    placeholder="Search tools…"
    aria-label="Search tools"
    {@attach prop('value', () => self.query)}
    oninput={self.updateQuery}
  />
</div>

<nav
  class="sidebar-nav"
  {@attach self.placeHand?.([self.router?.currentRouteName, self.groups])}
>
  <span class="nav-hand" aria-hidden="true"
    ><Icon name="pointer" size={16} /></span
  >
  {#each self.groups ?? [] as group}
    {#if truthy(group?.name)}
      <div class="nav-group-label">{group?.name}</div>
    {/if}
    {#each group?.items ?? [] as tool}
      {#if truthy(tool?.href)}
        <a
          href={tool?.href}
          class="nav-link nav-link-external {truthy(isOpus(tool))
            ? 'is-opus'
            : ''}"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon name={tool?.icon} size={15} />
          <span class="nav-label"
            >{tool?.label}{#if truthy(tool?.tag)}<span class="nav-tag"
                >{tool?.tag}</span
              >{/if}</span
          >
        </a>
      {:else}
        <Link
          route={tool?.route}
          class="nav-link {truthy(isOpus(tool)) ? 'is-opus' : ''}"
          activeClass="active"
          onclick={truthy(args.onNavigate) ? args.onNavigate : self.noop}
        >
          <Icon name={tool?.icon} size={15} />
          <span class="nav-label"
            >{tool?.label}{#if truthy(tool?.tag)}<span class="nav-tag"
                >{tool?.tag}</span
              >{/if}</span
          >
        </Link>
      {/if}
    {/each}
  {:else}
    <div class="nav-empty">No tools found</div>
  {/each}
</nav>
