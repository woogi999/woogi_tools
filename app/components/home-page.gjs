import Component from '@glimmer/component';
import { tracked, cached } from '@glimmer/tracking';
import { service } from '@ember/service';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { LinkTo } from '@ember/routing';
import { modifier } from 'ember-modifier';
import { htmlSafe } from '@ember/template';
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
import { loadModel, chat, isLoaded } from '../utils/ai-models';
import { renderMarkdown } from '../utils/markdown';

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

// Only where a keyboard is likely: focusing on touch would pop the on-screen keyboard.
const autofocusOnDesktop = modifier((input) => {
  if (window.matchMedia('(pointer: fine)').matches) input.focus();
});

// Cards are dealt onto the page as they scroll into view and slip away again
// as they leave it: `is-in` while on screen, `is-above` once scrolled past.
// One observer serves every card; see .scroll-card in the stylesheet.
let cardObserver = null;
const revealOnScroll = modifier((card) => {
  if (!('IntersectionObserver' in window)) {
    card.classList.add('is-in');
    return;
  }
  cardObserver ??= new IntersectionObserver(
    (entries) => {
      for (const { target, isIntersecting, boundingClientRect } of entries) {
        target.classList.toggle('is-in', isIntersecting);
        target.classList.toggle(
          'is-above',
          !isIntersecting && boundingClientRect.top < 0,
        );
      }
    },
    { rootMargin: '-6% 0px -6% 0px' },
  );
  cardObserver.observe(card);
  return () => cardObserver?.unobserve(card);
});

const markdown = (text) => htmlSafe(renderMarkdown(text));
const percent = (ratio) => Math.round((ratio ?? 0) * 100);

// The tools the assistant is told about: the few that best match the
// question. A whole sentence rarely matches anything, so each word is looked
// up on its own and the tools that keep turning up win.
const STOP_WORDS = new Set(
  'a an the i me my you your it its is are was be can do does how what which where why when to of in on for with from and or not this that there some any make get'.split(
    ' ',
  ),
);
function relevantTools(question) {
  const tally = new Map();
  const words = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  for (const word of words) {
    searchTools(word)
      .filter((t) => t.category)
      .slice(0, 8)
      .forEach((tool, i) => tally.set(tool, (tally.get(tool) ?? 0) + (8 - i)));
  }
  return [...tally]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([tool]) => tool);
}

function systemPrompt(tools) {
  const list = tools.map((t) => `- ${t.label}: ${t.description}`).join('\n');
  return [
    "You are Woogi, the helper on Woogi Tools, a website of small free tools that run in the browser on the visitor's own device. Nothing is uploaded and no account is needed.",
    "Answer in two or three short sentences of plain English. You have not seen the tools' screens, so never describe buttons, menus or steps inside one: say which tool to open and what it does. Do not make up tools that are not in the list.",
    list
      ? `Tools on the site that may fit the question:\n${list}\nWhen one fits, name it.`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

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
  matchModes = MATCH_MODES;
  sorts = SORTS;

  @tracked query = '';
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
  // The on-device assistant's current exchange, or null when it isn't open:
  // { question, answer, status, error, busy, tools }.
  @tracked ask = null;
  askJob = null;

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

  // Typing, a dropped file, a question or a narrowing filter switches the page to results.
  get isSearching() {
    return (
      Boolean(this.query.trim()) ||
      Boolean(this.droppedFile) ||
      Boolean(this.ask) ||
      this.filterCategories.length > 0 ||
      this.favouritesOnly
    );
  }

  // A question mark at the end is for the assistant, not the tool list.
  get isQuestion() {
    return this.query.trim().endsWith('?');
  }

  // Read many times per render (the hand, the grid, counts), so worth caching.
  @cached
  get results() {
    if (!this.isSearching) return [];
    const byRoute = new Map(this.cards.map((card) => [card.tool.route, card]));
    const query = this.query.trim();
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

  get askTools() {
    return this.ask?.tools ?? [];
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
  };

  // Enter opens the lifted card, or else the best match. A question goes to the assistant.
  submit = (event) => {
    event.preventDefault();
    if (this.isQuestion) {
      this.askAssistant();
      return;
    }
    const route = this.activeRoute ?? this.results[0]?.tool.route;
    if (route) this.router.transitionTo(route);
  };

  onKeydown = (event) => {
    if (
      event.key === 'Escape' &&
      (this.query || this.droppedFile || this.ask)
    ) {
      event.preventDefault();
      this.clear();
    }
  };

  clear = () => {
    this.query = '';
    this.activeRoute = null;
    this.droppedFile = null;
    this.closeAsk();
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
    this.droppedFile = { name: file.name, ...toolsForFile(file) };
    this.activeRoute = null;
    this.closeAsk();
  }

  clearFile = () => (this.droppedFile = null);

  // ─── The assistant ─────────────────────────────────────────────────

  askAssistant = async () => {
    const question = this.query.trim().replace(/\?+$/, '').trim();
    if (!question || this.ask?.busy) return;
    const tools = relevantTools(question);
    this.ask = {
      question,
      answer: '',
      error: null,
      busy: true,
      tools,
      status: isLoaded('chat')
        ? 'Thinking…'
        : 'Downloading the chat model (about 270 MB, once)…',
    };
    const update = (patch) => {
      if (this.isDestroying || this.ask?.question !== question) return;
      this.ask = { ...this.ask, ...patch };
    };
    try {
      const model = await loadModel('chat', {
        onProgress: ({ ratio }) =>
          update({
            status: `Downloading the chat model… ${percent(ratio)}%`,
          }),
      });
      update({ status: 'Thinking…' });
      const job = chat(
        model,
        [
          { role: 'system', content: systemPrompt(tools) },
          { role: 'user', content: `${question}?` },
        ],
        { onText: (answer) => update({ answer, status: '' }), max: 160 },
      );
      this.askJob = job;
      const answer = await job;
      update({ answer, status: '' });
    } catch (error) {
      update({ error: error?.message ?? 'The assistant couldn’t answer.' });
    } finally {
      update({ busy: false, status: '' });
      this.askJob = null;
    }
  };

  stopAsk = () => this.askJob?.stop();

  closeAsk = () => {
    this.askJob?.stop();
    this.askJob = null;
    this.ask = null;
  };

  scrollToTools = () => {
    document
      .getElementById('home-browse')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  feelingLucky = () => {
    const pool = this.cards;
    if (pool.length)
      this.router.transitionTo(
        pool[Math.floor(Math.random() * pool.length)].tool.route,
      );
  };

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
    <div
      class="container home {{if this.dragging 'is-dragging'}}"
      {{on "dragover" this.onDragOver}}
      {{on "dragleave" this.onDragLeave}}
      {{on "drop" this.onDrop}}
    >
      <section
        class="home-search {{if this.isSearching 'is-searching' 'is-hero'}}"
        {{measureSearchBar}}
      >
        <img
          src="/icon_expanded.gif"
          alt="Woogi Tools"
          class="home-search-logo"
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
            placeholder={{if
              this.droppedFile
              "Narrow these down…"
              "Search tools, or ask a question?"
            }}
            aria-label="Search tools or ask a question"
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
          {{#if this.isQuestion}}
            <button
              type="button"
              class="home-filter-btn home-ask-btn"
              title="Ask the on-device assistant"
              disabled={{this.ask.busy}}
              {{on "click" this.askAssistant}}
            >
              <Icon @name="sparkles" @size={{14}} />
              <span>Ask</span>
            </button>
          {{else}}
            <label
              class="qr-icon-btn home-attach"
              title="Show me the tools for a file"
            >
              <Icon @name="paperclip" @size={{15}} />
              <span class="sr-only">Show me the tools for a file</span>
              <input
                type="file"
                class="sr-only"
                {{on "change" this.pickFile}}
              />
            </label>
          {{/if}}
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
          <p class="home-search-hint">Small tools, no bloat. No accounts, no
            tracking.</p>
          <p class="home-search-hint is-tips">Drop a file on the bar to see what
            can open it. End with a question mark to ask the assistant, which
            runs here in your browser.</p>
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

      {{#if this.ask}}
        <section
          class="home-ask pop-in"
          aria-live="polite"
          aria-label="Assistant"
        >
          <div class="home-ask-head">
            <Icon @name="sparkles" @size={{16}} />
            <strong class="home-ask-question">{{this.ask.question}}?</strong>
            {{#if this.ask.busy}}
              <button
                type="button"
                class="btn math-use"
                {{on "click" this.stopAsk}}
              >Stop</button>
            {{/if}}
            <button
              type="button"
              class="qr-icon-btn"
              aria-label="Close the answer"
              {{on "click" this.closeAsk}}
            ><Icon @name="x" @size={{14}} /></button>
          </div>
          {{#if this.ask.error}}
            <p class="home-ask-status is-error">{{this.ask.error}}</p>
          {{else}}
            {{#if this.ask.answer}}
              <div
                class="home-ask-answer {{if this.ask.busy 'is-typing'}}"
              >{{markdown this.ask.answer}}</div>
            {{/if}}
            {{#if this.ask.status}}
              <p class="home-ask-status">{{this.ask.status}}</p>
            {{/if}}
          {{/if}}
          {{#if this.askTools.length}}
            <div class="home-chips">
              {{#each this.askTools as |tool|}}
                <LinkTo @route={{tool.route}} class="home-chip">
                  <Icon @name={{tool.icon}} @size={{13}} />
                  {{tool.label}}
                </LinkTo>
              {{/each}}
            </div>
          {{/if}}
          <p class="home-ask-status is-note">A small model running on your
            device, so take its answers with a pinch of salt. Nothing you ask
            leaves this browser.</p>
        </section>
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
          {{#unless this.ask}}
            <p class="home-no-results">Nothing matches “{{this.query}}”{{if
                this.activeFilterCount
                " with these filters"
              }}. Try another word{{if
                this.droppedFile
                ", or forget the file"
              }}.</p>
          {{/unless}}
        {{/if}}
      {{else}}
        <nav
          class="home-categories pop-in"
          id="home-browse"
          aria-label="Browse by category"
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
        <p class="home-count pop-in">Have a look through all
          <strong>{{this.toolCount}}</strong>
          tools, every one of them free, no account, and nothing uploaded.</p>

        {{#unless this.browseCategory}}
          <section class="home-section pop-in">
            <h2 class="section-title">Favourites</h2>
            {{#if this.favouriteCards.length}}
              <div class="tool-grid">
                {{#each this.favouriteCards key="tool.route" as |card|}}
                  <ToolCard @card={{card}} />
                {{/each}}
              </div>
            {{else}}
              <p class="history-empty">Star a tool below and it will show up
                here.</p>
            {{/if}}
          </section>
        {{/unless}}

        {{#each this.groupedCards key="name" as |group|}}
          <section class="home-section pop-in">
            <h2 class="section-title">{{group.name}}</h2>
            <div class="tool-grid">
              {{#each group.items key="tool.route" as |card|}}
                <ToolCard @card={{card}} />
              {{/each}}
            </div>
          </section>
        {{/each}}

        <section class="made-with pop-in">
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
      {{/if}}
    </div>
  </template>
}

function hover(onHover, route) {
  return () => onHover?.(route);
}

const ToolCard = <template>
  <div
    class="tool-card scroll-card
      {{if @card.suit.black 'is-black' 'is-red'}}
      {{if @active 'is-active'}}"
    {{revealOnScroll}}
    {{on "mouseenter" (hover @onHover @card.tool.route)}}
    {{on "mouseleave" (hover @onHover null)}}
  >
    {{#if @card.tool.category}}
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
    <LinkTo
      @route={{@card.tool.route}}
      class="tool-card-link"
    >{{@card.tool.label}}</LinkTo>
    <p>{{@card.tool.description}}</p>
  </div>
</template>;
