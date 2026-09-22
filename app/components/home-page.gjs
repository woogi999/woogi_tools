import Component from '@glimmer/component';
import { tracked, cached } from '@glimmer/tracking';
import { service } from '@ember/service';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { LinkTo } from '@ember/routing';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import Icon from './icon';
import FavouriteStar from './favourite-star';
import CreditList from './credit-list';
import CardHand from './card-hand';
import {
  TOOLS,
  SITE_CREDITS,
  CATEGORY_ORDER,
  searchTools,
  fuzzyScore,
} from '../tools';
import { toolsForFile } from '../utils/file-tools';
import { startGravity } from '../utils/gravity';

const CARDS = TOOLS.filter((t) => t.category);
const CATEGORIES = [...new Set(CARDS.map((t) => t.category))].sort(
  (a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b),
);

const MATCH_MODES = [
  { id: 'all', label: 'Everything' },
  { id: 'names', label: 'Names only' },
];
const SORTS = [
  { id: 'relevance', label: 'Best match' },
  { id: 'az', label: 'A–Z' },
];

// Pages without a category (Settings, Updates) still turn up in search, as jokers.
const JOKER = { rank: 'JK', suit: { symbol: '★', black: true } };

// One of these greets you under the search bar, picked fresh each visit.
const TAGLINES = [
  'Everything you need, free of charge. Maybe not everything, but we do have lots of tools!',
  'I made all of these so I would stop opening forty tabs. I still do, but because of Youtube.',
  'Did you know you can Ctrl + F to pull the search bar immediately from this site anywhere?',
  'Free, offline-friendly, and made with a generous amount of doodles.',
  'A collection of various tools that are supposed to be free.',
  'Shut up and keep your money!',
  'We also have games here for your friends!',
  'Nothing to install and nothing to pay for. I would know, I forgot to add a shop.',
  'Drag a file in, or just have a wander!',
  'Hand-drawn, hand-coded, occasionally hand-wringing. Enjoy.',
  'If a tool is missing, it is probably on my list. The list is long. Sorry.',
  'Type "Gravity" in the search bar and click "I\'m Feeling Lucky" and see what happens.',
  'FREE PALESTINE.',
  'No to gatekeeping tools!',
];

const eq = (a, b) => a === b;
const includes = (list, item) => list.includes(item);

// Publishes the sticky search bar's height (plus any sticky header above it)
// as --search-h, so the hand can pin itself right underneath.
const measureSearchBar = modifier((section) => {
  const container = section.parentElement;
  const update = () => {
    const top = parseFloat(getComputedStyle(section).top) || 0;
    container.style.setProperty(
      '--search-h',
      `${section.offsetHeight + top}px`,
    );
  };
  const observer = new ResizeObserver(update);
  observer.observe(section);
  window.addEventListener('resize', update);
  return () => {
    observer.disconnect();
    window.removeEventListener('resize', update);
  };
});

// Coming back from the results, the search grows to a full screen again over
// its height transition; the container is `is-settling` until that's done, so
// the tools below don't show through in the meantime.
const settleHero = modifier((section, [searching]) => {
  const container = section.parentElement;
  const was = section.dataset.searching === 'true';
  section.dataset.searching = String(Boolean(searching));
  if (searching || !was) return;
  container.classList.add('is-settling');
  let timer = null;
  const done = () => {
    clearTimeout(timer);
    section.removeEventListener('transitionend', onEnd);
    container.classList.remove('is-settling');
  };
  const onEnd = (event) => {
    if (event.target === section && event.propertyName === 'min-height') done();
  };
  section.addEventListener('transitionend', onEnd);
  // Reduced motion (or a browser that skips the transition) never fires the event.
  timer = setTimeout(done, 600);
  return done;
});

// A search result in gravity: handed to the sim the moment it's on the page.
const dropIn = modifier((el, [engine, order]) => {
  engine?.drop(el, order);
});

// Only where a keyboard is likely: focusing on touch would pop the on-screen keyboard.
const autofocusOnDesktop = modifier((input) => {
  if (window.matchMedia('(pointer: fine)').matches) input.focus();
});

// Cards are dealt onto the page as they scroll into view and slip away again
// as they leave it: `is-in` while on screen, `is-above` once scrolled past.
// One observer serves every card; see .scroll-card in the stylesheet.
let cardObserver = null;
const revealOnScroll = modifier((card, [enabled]) => {
  if (!enabled) return;
  if (!('IntersectionObserver' in window)) {
    card.classList.add('is-in');
    return;
  }
  cardObserver ??= new IntersectionObserver(
    (entries) => {
      for (const { target, isIntersecting, boundingClientRect } of entries) {
        // A card in a hidden part of the page keeps its state for when it's back.
        if (!boundingClientRect.width && !boundingClientRect.height) continue;
        target.classList.toggle('is-in', isIntersecting);
        target.classList.toggle(
          'is-above',
          !isIntersecting && boundingClientRect.top < 0,
        );
      }
    },
    { rootMargin: '0px 0px -4% 0px' },
  );
  cardObserver.observe(card);
  return () => cardObserver?.unobserve(card);
});

// The first screen is either the search or the tools, never half of each:
// a wheel, key or touch scroll that starts in the search snaps to whichever
// end you were heading for. Once you're among the tools the page scrolls as
// normal; coming back up to the top edge snaps to the search again. The app
// shell listens for `woogi:home-view` to swap its own logo and search box in
// step with the snap rather than with the raw scroll position.
const SNAP_MS = 650;
const snapHero = modifier((section, [searching]) => {
  // While searching the section is a sticky bar over the results, and the page scrolls as normal.
  if (searching) return;
  // Back from the results (or fresh on the page): start on the search screen,
  // wherever the results had been scrolled to.
  if (window.scrollY > 0) window.scrollTo(0, 0);
  let locked = 0;
  let settle = null;
  let lastY = window.scrollY;
  const bottom = () =>
    Math.round(section.getBoundingClientRect().bottom + window.scrollY);
  const announce = (view) => {
    document.documentElement.dataset.homeView = view;
    window.dispatchEvent(new CustomEvent('woogi:home-view', { detail: view }));
  };
  const goTo = (view) => {
    announce(view);
    locked = Date.now() + SNAP_MS;
    window.scrollTo({
      top: view === 'hero' ? 0 : bottom(),
      behavior: 'smooth',
    });
  };
  // Only the page's own column: a wheel over the sidebar scrolls the sidebar.
  const column = section.closest('main') ?? section.parentElement;
  const onWheel = (event) => {
    if (event.ctrlKey || !event.deltaY || !column.contains(event.target))
      return;
    const y = window.scrollY;
    const edge = bottom();
    if (Date.now() < locked) {
      if (y < edge) event.preventDefault();
      return;
    }
    if (event.deltaY > 0 && y < edge - 1) {
      event.preventDefault();
      goTo('tools');
    } else if (event.deltaY < 0 && y > 0 && y <= edge + 1) {
      event.preventDefault();
      goTo('hero');
    }
  };
  // Touch and keyboard scrolling can't be intercepted, so once they stop
  // inside the search area the page settles to the nearer end.
  const onScroll = () => {
    const y = window.scrollY;
    const edge = bottom();
    const direction = y > lastY ? 'tools' : 'hero';
    lastY = y;
    if (Date.now() < locked) return;
    clearTimeout(settle);
    if (y <= 0) announce('hero');
    else if (y >= edge) announce('tools');
    else settle = setTimeout(() => goTo(direction), 90);
  };
  announce(window.scrollY >= bottom() ? 'tools' : 'hero');
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('scroll', onScroll, { passive: true });
  return () => {
    clearTimeout(settle);
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('scroll', onScroll);
    delete document.documentElement.dataset.homeView;
    window.dispatchEvent(new CustomEvent('woogi:home-view', { detail: null }));
  };
});

// Every word has to fuzzy-match the tool's name.
function matchesName(query, tool) {
  return query
    .trim()
    .split(/\s+/)
    .every((word) => fuzzyScore(word, tool.label) >= 0);
}

// A tool's position in the list fixes its rank and suit, so a card keeps the
// same "identity" wherever it's shown (favourites or the full grid). Suits
// cycle in the classic alternating black/red order.
const RANKS = [
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
];
const SUITS = [
  { symbol: '♠', black: true },
  { symbol: '♥', black: false },
  { symbol: '♣', black: true },
  { symbol: '♦', black: false },
];

export default class HomePage extends Component {
  @service favourites;
  @service toolVisibility;
  @service settings;
  @service router;

  categories = CATEGORIES;
  toolCount = CARDS.length;
  tagline = TAGLINES[Math.floor(Math.random() * TAGLINES.length)];

  matchModes = MATCH_MODES;
  sorts = SORTS;

  @tracked query = '';
  // What the results are for: empty until Enter is pressed, so typing on the
  // hero changes nothing on the page; from then on it tracks the box.
  @tracked committed = '';
  // Advanced search filters.
  @tracked showFilters = false;
  @tracked filterCategories = [];
  @tracked favouritesOnly = false;
  @tracked matchMode = 'all';
  @tracked sort = 'relevance';
  // The category buttons above the home grid; null shows everything.
  @tracked browseCategory = null;
  // The card lifted in the hand, from hovering either the hand or the grid.
  @tracked activeRoute = null;
  // A file dropped on the search bar: { name, kind, label, routes }.
  @tracked droppedFile = null;
  @tracked dragging = false;
  // The gravity easter egg: while it's on, the first screen is a pile of
  // rubble at the foot of the window and searches rain down from above.
  @tracked gravity = false;
  gravityEngine = null;
  // Search results dropped in so far: { id, order, card } or { id, order, note }.
  @tracked fallen = [];
  fallenSeq = 0;
  @service handoff;

  @cached
  get cards() {
    return CARDS.filter((tool) => this.toolVisibility.isVisible(tool)).map(
      (tool, i) => ({
        tool,
        starred: this.favourites.has(tool.route),
        rank: RANKS[i % RANKS.length],
        suit: SUITS[i % SUITS.length],
      }),
    );
  }

  get activeFilterCount() {
    return (
      this.filterCategories.length +
      (this.favouritesOnly ? 1 : 0) +
      (this.matchMode !== 'all' ? 1 : 0) +
      (this.sort !== 'relevance' ? 1 : 0)
    );
  }

  get isGravityWord() {
    return this.query.trim().toLowerCase() === 'gravity';
  }

  // A submitted search, a dropped file or a narrowing filter switches the page to results.
  get isSearching() {
    if (this.gravity) return false;
    return (
      Boolean(this.committed) ||
      Boolean(this.droppedFile) ||
      this.filterCategories.length > 0 ||
      this.favouritesOnly
    );
  }

  get placeholder() {
    if (this.droppedFile) return 'Narrow these down…';
    return 'Search tools or drop a file…';
  }

  // Read many times per render (the hand, the grid, counts), so worth caching.
  @cached
  get results() {
    if (!this.isSearching) return [];
    const byRoute = new Map(this.cards.map((card) => [card.tool.route, card]));
    const query = this.committed;
    let tools;
    if (!query) tools = TOOLS;
    else if (this.matchMode === 'names')
      tools = TOOLS.filter((tool) => matchesName(query, tool));
    else tools = searchTools(query);
    // A dropped file narrows the list to the tools that take one, best first;
    // typing on top of that narrows it further.
    const file = this.droppedFile;
    if (file) {
      const matched = new Set(tools.map((t) => t.route));
      tools = file.routes
        .map((route) => TOOLS.find((t) => t.route === route))
        .filter((t) => t && matched.has(t.route));
    }

    let results = tools
      .filter(
        (tool) => tool.route !== 'index' && this.toolVisibility.isVisible(tool),
      )
      .filter(
        (tool) =>
          !this.filterCategories.length ||
          this.filterCategories.includes(tool.category),
      )
      .filter((tool) => !this.favouritesOnly || this.favourites.has(tool.route))
      .map(
        (tool) =>
          byRoute.get(tool.route) ?? {
            tool,
            starred: this.favourites.has(tool.route),
            ...JOKER,
          },
      );
    if (this.sort === 'az' || (!query && !file))
      results = results.sort((a, b) =>
        a.tool.label.localeCompare(b.tool.label),
      );
    return results;
  }

  get showHand() {
    return this.settings.handSearch && this.results.length > 0;
  }

  get favouriteCards() {
    return this.cards.filter((c) => c.starred);
  }

  @cached
  get groupedCards() {
    const groups = new Map();
    for (const card of this.cards) {
      const key = card.tool.category ?? '';
      if (this.browseCategory && key !== this.browseCategory) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(card);
    }
    return [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, items]) => ({
        name,
        items: items.sort((a, b) => a.tool.label.localeCompare(b.tool.label)),
      }));
  }

  updateQuery = (event) => {
    this.query = event.target.value;
    this.activeRoute = null;
    // Once the results are up they follow every keystroke; emptying the box
    // takes them away again.
    if (this.committed) this.committed = this.query.trim();
  };

  // Enter shows the results for what was typed; with them up, Enter opens the
  // lifted card, or else the best match.
  submit = (event) => {
    event.preventDefault();
    if (this.gravity) {
      this.dropResults();
      return;
    }
    const query = this.query.trim();
    if (query !== this.committed) {
      this.committed = query;
      this.activeRoute = null;
      return;
    }
    const route = this.activeRoute ?? this.results[0]?.tool.route;
    if (!route) return;
    this.carryFile();
    this.router.transitionTo(route);
  };

  // Picking a tool from the results takes the dropped file along with you.
  carryFile = () => {
    if (this.droppedFile) this.handoff.file = this.droppedFile.file;
  };
  onResultClick = (event) => {
    if (event.target.closest('a')) this.carryFile();
  };

  onKeydown = (event) => {
    if (event.key === 'Escape' && this.gravity) {
      event.preventDefault();
      this.stopGravity();
      return;
    }
    if (event.key === 'Escape' && (this.query || this.droppedFile)) {
      event.preventDefault();
      this.clear();
    }
  };

  clear = () => {
    this.query = '';
    this.committed = '';
    this.activeRoute = null;
    this.droppedFile = null;
  };

  // ─── Dropped files ─────────────────────────────────────────────────

  onDragOver = (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    this.dragging = true;
  };

  onDragLeave = (event) => {
    // Moving over a child fires this too; only leaving the page counts.
    if (
      !event.relatedTarget ||
      !event.currentTarget.contains(event.relatedTarget)
    )
      this.dragging = false;
  };

  onDrop = (event) => {
    const file = event.dataTransfer?.files?.[0];
    this.dragging = false;
    if (!file) return;
    event.preventDefault();
    this.useFile(file);
  };

  pickFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) this.useFile(file);
  };

  useFile(file) {
    this.droppedFile = { file, name: file.name, ...toolsForFile(file) };
    this.activeRoute = null;
  }

  clearFile = () => (this.droppedFile = null);

  scrollToTools = () => {
    document
      .getElementById('home-browse')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  feelingLucky = () => {
    if (this.isGravityWord) {
      this.startGravity();
      return;
    }
    const pool = this.cards.filter((card) => card.tool.route);
    if (pool.length)
      this.router.transitionTo(
        pool[Math.floor(Math.random() * pool.length)].tool.route,
      );
  };

  // ─── Gravity ───────────────────────────────────────────────────────

  startGravity = async () => {
    if (this.gravity || this.gravityEngine) return;
    this.query = '';
    this.committed = '';
    // Positions are taken with the page at the top, so the first screen is the room.
    window.scrollTo(0, 0);
    const section = document.querySelector('.home-search');
    // The physics engine is a separate download, fetched only for this.
    this.gravityEngine = await startGravity(
      [...section.children].filter((el) => !el.matches('.home-drop-hint')),
    );
    if (this.isDestroying) this.gravityEngine.stop();
    else this.gravity = true;
  };

  stopGravity = () => {
    this.gravityEngine?.stop();
    this.gravityEngine = null;
    this.fallen = [];
    this.gravity = false;
  };

  // In gravity, Enter doesn't open anything: the matching tools fall in from
  // the sky as cards, still clickable once they've landed.
  dropResults() {
    const query = this.query.trim();
    if (!query) return;
    const cards = searchTools(query)
      .map((tool) => this.cards.find((card) => card.tool.route === tool.route))
      .filter(Boolean)
      .slice(0, 10);
    this.query = '';
    const drops = cards.length
      ? cards.map((card, order) => ({ id: ++this.fallenSeq, order, card }))
      : [
          {
            id: ++this.fallenSeq,
            order: 0,
            note: `Nothing matches “${query}”.`,
          },
        ];
    this.fallen = [...this.fallen, ...drops];
  }

  willDestroy() {
    super.willDestroy(...arguments);
    if (this.gravity) this.stopGravity();
  }

  toggleFilters = () => (this.showFilters = !this.showFilters);
  toggleFilterCategory = (category) => {
    this.filterCategories = this.filterCategories.includes(category)
      ? this.filterCategories.filter((c) => c !== category)
      : [...this.filterCategories, category];
  };
  toggleFavouritesOnly = (event) =>
    (this.favouritesOnly = event.target.checked);
  setMatchMode = (id) => (this.matchMode = id);
  setSort = (id) => (this.sort = id);
  resetFilters = () => {
    this.filterCategories = [];
    this.favouritesOnly = false;
    this.matchMode = 'all';
    this.sort = 'relevance';
  };

  setBrowseCategory = (category) => (this.browseCategory = category);
  setActive = (route) => (this.activeRoute = route);

  <template>
    {{! template-lint-disable no-invalid-interactive }}
    <div
      class="container home
        {{if this.dragging 'is-dragging'}}
        {{if this.gravity 'is-gravity'}}"
      {{on "dragover" this.onDragOver}}
      {{on "dragleave" this.onDragLeave}}
      {{on "drop" this.onDrop}}
      {{on "click" this.onResultClick}}
    >
      <section
        class="home-search {{if this.isSearching 'is-searching' 'is-hero'}}"
        {{measureSearchBar}}
        {{snapHero this.isSearching}}
        {{settleHero this.isSearching}}
      >
        <img
          src="/icon_expanded.gif"
          alt="Woogi Tools"
          class="home-search-logo"
          draggable="false"
        />
        <form
          class="home-search-form"
          role="search"
          {{on "submit" this.submit}}
        >
          <Icon @name={{if this.droppedFile "file" "search"}} @size={{16}} />
          {{#if this.droppedFile}}
            <span class="home-file-chip" title={{this.droppedFile.name}}>
              <span class="home-file-name">{{this.droppedFile.name}}</span>
              <button
                type="button"
                class="qr-icon-btn"
                aria-label="Forget this file"
                {{on "click" this.clearFile}}
              ><Icon @name="x" @size={{12}} /></button>
            </span>
          {{/if}}
          <input
            type="search"
            class="home-search-input"
            placeholder={{this.placeholder}}
            aria-label="Search tools"
            autocomplete="off"
            value={{this.query}}
            {{on "input" this.updateQuery}}
            {{on "keydown" this.onKeydown}}
            {{autofocusOnDesktop}}
          />
          {{#if this.query}}
            <button
              type="button"
              class="qr-icon-btn"
              aria-label="Clear search"
              {{on "click" this.clear}}
            ><Icon @name="x" @size={{14}} /></button>
          {{/if}}
          <label
            class="qr-icon-btn home-attach"
            title="Show me the tools for a file"
          >
            <Icon @name="paperclip" @size={{15}} />
            <span class="sr-only">Show me the tools for a file</span>
            <input type="file" class="sr-only" {{on "change" this.pickFile}} />
          </label>
          <button
            type="button"
            class="home-filter-btn {{if this.showFilters 'active'}}"
            aria-expanded={{if this.showFilters "true" "false"}}
            aria-controls="home-filters"
            {{on "click" this.toggleFilters}}
          >
            <Icon @name="list-filter" @size={{14}} />
            <span>Filters</span>
            {{#if this.activeFilterCount}}<span
                class="home-filter-count"
              >{{this.activeFilterCount}}</span>{{/if}}
          </button>
        </form>

        {{#if this.showFilters}}
          <div class="home-filters pop-in" id="home-filters">
            <div class="home-filter-group">
              <span class="qr-label is-muted">Categories</span>
              <div class="home-chips">
                {{#each this.categories as |category|}}
                  <button
                    type="button"
                    class="home-chip
                      {{if (includes this.filterCategories category) 'active'}}"
                    aria-pressed={{if
                      (includes this.filterCategories category)
                      "true"
                      "false"
                    }}
                    {{on "click" (fn this.toggleFilterCategory category)}}
                  >{{category}}</button>
                {{/each}}
              </div>
            </div>
            <div class="home-filter-group">
              <span class="qr-label is-muted">Match in</span>
              <div class="math-tabs" role="group" aria-label="Match in">
                {{#each this.matchModes as |m|}}
                  <button
                    type="button"
                    class="qr-tab {{if (eq this.matchMode m.id) 'active'}}"
                    aria-pressed={{if (eq this.matchMode m.id) "true" "false"}}
                    {{on "click" (fn this.setMatchMode m.id)}}
                  >{{m.label}}</button>
                {{/each}}
              </div>
            </div>
            <div class="home-filter-group">
              <span class="qr-label is-muted">Sort</span>
              <div class="math-tabs" role="group" aria-label="Sort">
                {{#each this.sorts as |s|}}
                  <button
                    type="button"
                    class="qr-tab {{if (eq this.sort s.id) 'active'}}"
                    aria-pressed={{if (eq this.sort s.id) "true" "false"}}
                    {{on "click" (fn this.setSort s.id)}}
                  >{{s.label}}</button>
                {{/each}}
              </div>
            </div>
            <div class="home-filter-row">
              <label class="qr-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={{this.favouritesOnly}}
                  aria-checked={{if this.favouritesOnly "true" "false"}}
                  {{on "change" this.toggleFavouritesOnly}}
                />
                <span class="qr-switch-track" aria-hidden="true"></span>
                Favourites only
              </label>
              {{#if this.activeFilterCount}}
                <button
                  type="button"
                  class="btn math-use"
                  {{on "click" this.resetFilters}}
                >Clear filters</button>
              {{/if}}
            </div>
          </div>
        {{/if}}

        {{#unless this.isSearching}}
          <div class="home-search-actions">
            <button
              type="button"
              class="btn home-lucky"
              {{on "click" this.feelingLucky}}
            >I'm Feeling Lucky</button>
          </div>
          <p class="home-search-hint">{{this.tagline}}</p>
          <button
            type="button"
            class="home-scroll-hint"
            aria-label="Scroll down to the tools"
            {{on "click" this.scrollToTools}}
          >
            <span>{{this.toolCount}} tools</span>
            <Icon @name="chevron-down" @size={{18}} />
          </button>
        {{/unless}}
        {{#if this.dragging}}
          <div class="home-drop-hint pop-in" aria-hidden="true">
            <Icon @name="upload" @size={{18}} />
            Drop it to see which tools can take it
          </div>
        {{/if}}
      </section>

      {{#if this.gravity}}
        <div class="gravity-layer">
          {{#each this.fallen key="id" as |drop|}}
            <div class="gravity-drop" {{dropIn this.gravityEngine drop.order}}>
              {{#if drop.card}}
                <ToolCard @card={{drop.card}} />
              {{else}}
                <div class="gravity-note">{{drop.note}}</div>
              {{/if}}
            </div>
          {{/each}}
        </div>
      {{/if}}

      {{#if this.isSearching}}
        {{#if this.results.length}}
          <div class="home-results {{if this.showHand 'has-hand'}}">
            {{#if this.showHand}}
              <CardHand
                @cards={{this.results}}
                @activeRoute={{this.activeRoute}}
                @onActivate={{this.setActive}}
              />
            {{/if}}
            <section class="home-results-grid" aria-label="Search results">
              <h2 class="section-title">{{this.results.length}}
                {{if (eq this.results.length 1) "result" "results"}}{{#if
                  this.droppedFile
                }}
                  for
                  {{this.droppedFile.label}}{{/if}}</h2>
              <div class="tool-grid">
                {{! Keyed by position, so typing reuses the cards already on screen instead of rebuilding them. }}
                {{#each this.results key="@index" as |card|}}
                  <ToolCard
                    @card={{card}}
                    @active={{eq card.tool.route this.activeRoute}}
                    @onHover={{this.setActive}}
                  />
                {{/each}}
              </div>
            </section>
          </div>
        {{else}}
          <p class="home-no-results">Nothing matches “{{this.committed}}”{{if
              this.activeFilterCount
              " with these filters"
            }}. Try another word{{if
              this.droppedFile
              ", or forget the file"
            }}.</p>
        {{/if}}
      {{/if}}

      {{! The tools are their own part of the page: always rendered, only hidden
          while results are up, so coming back doesn't deal them all in again. }}
      <div class="home-browse" id="home-browse" hidden={{this.isSearching}}>
        <div class="home-browse-head">
          <nav class="home-categories" aria-label="Browse by category">
            >
            <button
              type="button"
              class="home-chip {{unless this.browseCategory 'active'}}"
              aria-pressed={{if this.browseCategory "false" "true"}}
              {{on "click" (fn this.setBrowseCategory null)}}
            >All</button>
            {{#each this.categories as |category|}}
              <button
                type="button"
                class="home-chip
                  {{if (eq this.browseCategory category) 'active'}}"
                aria-pressed={{if
                  (eq this.browseCategory category)
                  "true"
                  "false"
                }}
                {{on "click" (fn this.setBrowseCategory category)}}
              >{{category}}</button>
            {{/each}}
          </nav>
          <p class="home-count">Have a look through all
            <strong>{{this.toolCount}}</strong>
            tools, every one of them free, no account, and nothing uploaded.</p>
        </div>

        {{#unless this.browseCategory}}
          <section class="home-section">
            <h2 class="section-title">Favourites</h2>
            {{#if this.favouriteCards.length}}
              <div class="tool-grid">
                {{#each this.favouriteCards key="tool.route" as |card|}}
                  <ToolCard @card={{card}} @reveal={{true}} />
                {{/each}}
              </div>
            {{else}}
              <p class="history-empty">Star a tool below and it will show up
                here.</p>
            {{/if}}
          </section>
        {{/unless}}

        {{#each this.groupedCards key="name" as |group|}}
          <section class="home-section">
            <h2 class="section-title">{{group.name}}</h2>
            <div class="tool-grid">
              {{#each group.items key="tool.route" as |card|}}
                <ToolCard @card={{card}} @reveal={{true}} />
              {{/each}}
            </div>
          </section>
        {{/each}}

        <section class="made-with">
          <h3 class="credit-heading">Site built with</h3>
          <CreditList @credits={{SITE_CREDITS}} />
        </section>

        <footer class="site-footer">
          <span>Woogi Tools is a personal project maintained by one person.</span>
          <nav aria-label="Site information">
            <LinkTo @route="privacy">Privacy Policy</LinkTo>
            <LinkTo @route="terms">Terms of Service</LinkTo>
            <a href="mailto:earl@woogi.xyz">earl@woogi.xyz</a>
          </nav>
        </footer>
      </div>
    </div>
  </template>
}

function hover(onHover, route) {
  return () => onHover?.(route);
}

const accentStyle = (accent) => htmlSafe(accent ? `color:${accent};` : '');

const ToolCard = <template>
  <div
    class="tool-card
      {{if @reveal 'scroll-card'}}
      {{if @card.suit.black 'is-black' 'is-red'}}
      {{if @active 'is-active'}}"
    {{revealOnScroll @reveal}}
    {{on "mouseenter" (hover @onHover @card.tool.route)}}
    {{on "mouseleave" (hover @onHover null)}}
  >
    {{#if @card.tool.route}}
      <FavouriteStar
        @route={{@card.tool.route}}
        @size={{16}}
        class="card-star"
      />
    {{/if}}
    <span class="card-corner card-corner-tl"><span
        class="card-rank"
      >{{@card.rank}}</span><span
        class="card-suit"
      >{{@card.suit.symbol}}</span></span>
    <span class="card-corner card-corner-br"><span
        class="card-rank"
      >{{@card.rank}}</span><span
        class="card-suit"
      >{{@card.suit.symbol}}</span></span>
    <Icon @name={{@card.tool.icon}} @size={{34}} class="tool-icon" />
    {{#if @card.tool.href}}
      <a
        href={{@card.tool.href}}
        class="tool-card-link"
        target="_blank"
        rel="noopener noreferrer"
        style={{accentStyle @card.tool.accent}}
      >{{@card.tool.label}}</a>
    {{else}}
      <LinkTo
        @route={{@card.tool.route}}
        class="tool-card-link"
      >{{@card.tool.label}}</LinkTo>
    {{/if}}
    <p>{{@card.tool.description}}</p>
  </div>
</template>;
