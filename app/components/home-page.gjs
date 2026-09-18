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
import { chartSvg, parseChartSpec } from '../utils/ask-charts';

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
  'Small tools, no bloat. No accounts, no tracking. Just me, Woogi.',
  'I made all of these so I would stop opening forty tabs. Now you can too.',
  'Everything runs in your browser. Your files never leave home. I checked.',
  'No sign up, no newsletter, no "wait, before you go". Just tools.',
  'Free, offline-friendly and made with a suspicious amount of doodles.',
  'It is a website of small things. The small things are the whole point.',
  'Pick a card, any card. They are all tools, so you cannot lose.',
  'Built by one person with a laptop, a to-do list and too much coffee.',
  'Nothing to install and nothing to pay for. I would know, I forgot to add a shop.',
  'Drag a file in, ask a question, or just have a wander. I am not going anywhere.',
  'Hand-drawn, hand-coded, occasionally hand-wringing. Enjoy.',
  'If a tool is missing, it is probably on my list. The list is long. Sorry.',
];

const eq = (a, b) => a === b;
const and = (a, b) => Boolean(a && b);
const not = (a) => !a;
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
const revealOnScroll = modifier((card, [enabled]) => {
  if (!enabled) return;
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

const ROUTES = new Map(TOOLS.map((t) => [t.route, t]));
// Longest names first, so "Image Resizer" isn't half-linked as "Image".
const LINKABLE = [...TOOLS]
  .filter((t) => t.category)
  .sort((a, b) => b.label.length - a.label.length);
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Private-use markers carry links and charts through the markdown renderer untouched.
const LINK_OPEN = '\uE100';
const LINK_MID = '\uE101';
const LINK_CLOSE = '\uE102';
const CHART_OPEN = '\uE110';
const CHART_CLOSE = '\uE111';

// The answer as HTML: markdown, with tool names turned into links to the
// tools and ```chart blocks drawn as pictures.
function renderAnswer(text) {
  const charts = [];
  const draw = (body, fallback) => {
    const spec = parseChartSpec(body);
    if (
      !spec ||
      !(spec.values || spec.series || spec.data || spec.fn || spec.function)
    )
      return fallback;
    const svg = chartSvg(spec);
    if (!svg) return fallback;
    charts.push(svg);
    return `\n${CHART_OPEN}${charts.length - 1}${CHART_CLOSE}\n`;
  };
  // A chart spec in any fenced block, or a bare JSON object on its own lines:
  // the model doesn't always remember the ```chart label.
  let source = text
    .replace(/```\w*[ \t]*\n([\s\S]*?)```/g, (m, body) => draw(body, m))
    .replace(/^\{[^]*?\}[ \t]*$/gm, (m) => draw(m, m));
  // Links the model wrote itself, kept when the route is real.
  source = source.replace(
    /\[([^\]\n]+)\]\(\/?([a-z0-9-]+)\)/g,
    (m, label, route) =>
      ROUTES.has(route)
        ? `${LINK_OPEN}${route}${LINK_MID}${label}${LINK_CLOSE}`
        : label,
  );
  // Tool names mentioned in passing become links too, the first mention of each.
  const parts = source.split(
    new RegExp(`(${LINK_OPEN}[^${LINK_CLOSE}]*${LINK_CLOSE}|\`[^\`\n]*\`)`),
  );
  const linked = new Set();
  for (let i = 0; i < parts.length; i += 2) {
    for (const tool of LINKABLE) {
      if (linked.has(tool.route)) continue;
      const re = new RegExp(
        `(?<![\\w-])${escapeRe(tool.label)}(?![\\w-])`,
        'i',
      );
      if (!re.test(parts[i])) continue;
      parts[i] = parts[i].replace(
        re,
        (hit) => `${LINK_OPEN}${tool.route}${LINK_MID}${hit}${LINK_CLOSE}`,
      );
      linked.add(tool.route);
    }
  }
  const html = renderMarkdown(parts.join(''))
    .replace(
      new RegExp(`${LINK_OPEN}([a-z0-9-]+)${LINK_MID}(.*?)${LINK_CLOSE}`, 'g'),
      (_, route, label) =>
        `<a href="/${route}" class="home-ask-link">${label}</a>`,
    )
    .replace(
      new RegExp(`${CHART_OPEN}(\\d+)${CHART_CLOSE}`, 'g'),
      (_, i) => charts[Number(i)] ?? '',
    );
  return htmlSafe(html);
}
const percent = (ratio) => Math.round((ratio ?? 0) * 100);

// Woogi types in lowercase, like a chat message. The model doesn't always
// remember, so sentence-initial capitals come off here, except on names
// (tools, Woogi Tools), on shouted words (WHAT???) and on acronyms.
const PROPER = [...LINKABLE.map((t) => t.label), 'Woogi'];
function casual(text) {
  return text
    .replace(
      /(^|[.!?:]\s+|\n\s*(?:[-*]\s+|\d+\.\s+)?|\[)([A-Z])(?=[a-z'])/g,
      (m, before, letter, offset) => {
        const rest = text.slice(offset + before.length);
        if (PROPER.some((name) => rest.startsWith(name))) return m;
        return before + letter.toLowerCase();
      },
    )
    .replace(/\bI(?=['\s,.!?])/g, 'i');
}

// The tools the assistant is told about: the few that best match the
// question. A whole sentence rarely matches anything, so each word is looked
// up on its own and the tools that keep turning up win.
const STOP_WORDS = new Set(
  'a an the i me my you your it its is are was be can do does how what which where why when to of in on for with from and or not this that there some any make get tool tools site website use using want need help please one thing'.split(
    ' ',
  ),
);
function relevantTools(question) {
  const tally = new Map();
  const words = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  // "crops" and "cropping" should find the cropper as well as "crop" does.
  const stems = (word) =>
    [...new Set([word, word.replace(/(ing|ed|es|s)$/, '')])].filter(
      (w) => w.length > 2,
    );
  for (const word of words) {
    const seen = new Set();
    for (const stem of stems(word))
      searchTools(stem)
        .filter((t) => t.category && !seen.has(t))
        .slice(0, 8)
        .forEach((tool, i) => {
          seen.add(tool);
          tally.set(tool, (tally.get(tool) ?? 0) + (8 - i));
        });
  }
  return [...tally]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([tool]) => tool);
}

function systemPrompt(tools) {
  const list = tools
    .map((t) => `- [${t.label}](/${t.route}): ${t.description}`)
    .join('\n');
  return [
    "You are Woogi: the one person who drew, coded and runs Woogi Tools, a website of small free tools (image, video, audio, text, developer and calculator tools, plus a few games) that run entirely in the visitor's browser. Nothing is uploaded, no account, no tracking. Speak as yourself in the first person: casual, friendly, a little deadpan, with a dry joke when it fits, like texting a friend. Keep it to one to three short sentences, or a short list. No em dashes.",
    "Type in lowercase, the way you would in a chat: no capital letters at the start of sentences, and 'i' rather than 'I'. Use capitals only for names (Woogi Tools, a tool's name, PNG) or to shout a word, like WHAT??? for surprise.",
    "You have not seen the tools' screens, so never describe buttons or steps inside one; say which tool to open and what it does. Only mention tools from the list below, written exactly as markdown links like [Image Resizer](/image-resizer). If nothing on the site fits, say so and answer the question anyway.",
    'You can draw pictures. When someone asks for a chart, a graph or a plot, or numbers would be clearer drawn, write a short sentence and then a block that starts with ```chart and holds JSON. The block is shown in the chat as a picture, so never mention JSON, blocks or code, and never send people elsewhere to see it. Numbers to compare:\n```chart\n{"type":"bar","title":"Coffee per day","labels":["Mon","Tue","Wed"],"values":[2,3,5]}\n```\nTypes are bar, line and pie. A function of x:\n```chart\n{"type":"plot","fn":"sin(x)","from":-6.3,"to":6.3}\n```',
    list ? `Tools that may fit the question:\n${list}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

// Whether to fetch the chat model quietly in the background: not on a metered
// connection, not when the visitor asked for less data, and only once online.
const canPreloadModel = () => {
  const conn = navigator.connection;
  return navigator.onLine && !conn?.saveData && conn?.type !== 'cellular';
};

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

  constructor() {
    super(...arguments);
    // The chat model is fetched in the background once the page has settled,
    // so the first question doesn't start with a download.
    if (!isLoaded('chat') && canPreloadModel())
      setTimeout(() => {
        if (!this.isDestroying) loadModel('chat').catch(() => {});
      }, 2500);
  }
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
  // The chat with Woogi, or null when it isn't open:
  // { messages: [{ role, content }], status, error, busy, tools }.
  @tracked ask = null;
  askJob = null;
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

  // Typing, a dropped file, a question or a narrowing filter switches the page to results.
  get isSearching() {
    return (
      Boolean(this.ask) ||
      Boolean(this.query.trim()) ||
      Boolean(this.droppedFile) ||
      this.filterCategories.length > 0 ||
      this.favouritesOnly
    );
  }

  // A question mark at the end is for Woogi, not the tool list; once the
  // chat is open, everything typed is part of it.
  get isQuestion() {
    return Boolean(this.ask) || this.query.trim().endsWith('?');
  }

  get chatMessages() {
    return this.ask?.messages ?? [];
  }

  get placeholder() {
    if (this.ask) return 'Say something to Woogi…';
    if (this.droppedFile) return 'Narrow these down…';
    return 'Search tools, drop a file, or ask a question…';
  }

  // Read many times per render (the hand, the grid, counts), so worth caching.
  @cached
  get results() {
    if (!this.isSearching || this.ask) return [];
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
    this.droppedFile = { file, name: file.name, ...toolsForFile(file) };
    this.activeRoute = null;
    this.closeAsk();
  }

  clearFile = () => (this.droppedFile = null);

  // ─── The assistant ─────────────────────────────────────────────────

  askAssistant = async () => {
    const text = this.query.trim();
    if (!text || this.ask?.busy) return;
    const question = text.replace(/\?+$/, '').trim();
    const history = this.ask?.messages ?? [];
    // The tools are picked from the whole conversation so far, latest first.
    const tools = relevantTools(
      [
        question,
        ...history.filter((m) => m.role === 'user').map((m) => m.content),
      ]
        .reverse()
        .join(' '),
    );
    let messages = [
      ...history,
      { role: 'user', content: text },
      { role: 'assistant', content: '' },
    ];
    this.query = '';
    this.ask = {
      messages,
      error: null,
      busy: true,
      tools,
      status: isLoaded('chat')
        ? 'thinking…'
        : 'downloading the chat model (about 400 MB, once)…',
    };
    let current = messages;
    const update = (patch) => {
      if (this.isDestroying || this.ask?.messages !== current) return;
      this.ask = { ...this.ask, ...patch };
    };
    const reply = (content) => {
      messages = [...messages.slice(0, -1), { role: 'assistant', content }];
      update({ messages });
      current = messages;
    };
    try {
      const model = await loadModel('chat', {
        onProgress: ({ ratio }) =>
          update({
            status: `downloading the chat model… ${percent(ratio)}%`,
          }),
      });
      update({ status: 'thinking…' });
      // The last few turns are enough context for a small model.
      const recent = messages.slice(-7, -1).filter((m) => m.content);
      const job = chat(
        model,
        [{ role: 'system', content: systemPrompt(tools) }, ...recent],
        {
          onText: (answer) => {
            reply(casual(answer));
            update({ status: '' });
          },
          max: 160,
        },
      );
      this.askJob = job;
      reply(casual(await job));
    } catch (error) {
      update({ error: error?.message ?? 'i could not answer that one.' });
    } finally {
      update({ busy: false, status: '' });
      this.askJob = null;
    }
  };

  stopAsk = () => this.askJob?.stop();

  // Tool links in the answer are plain <a> tags; route them without a reload.
  onAnswerClick = (event) => {
    const link = event.target.closest('a.home-ask-link');
    if (!link) return;
    event.preventDefault();
    this.router.transitionTo(link.getAttribute('href'));
  };

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
        {{snapHero this.isSearching}}
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
            placeholder={{this.placeholder}}
            aria-label="Search tools or ask a question"
            autocomplete="off"
            value={{this.query}}
            {{on "input" this.updateQuery}}
            {{on "keydown" this.onKeydown}}
            {{autofocusOnDesktop}}
          />
          {{#if (and this.query (not this.ask))}}
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
              title="Send to Woogi"
              disabled={{this.ask.busy}}
              {{on "click" this.askAssistant}}
            >
              <Icon @name="sparkles" @size={{14}} />
              <span>{{if this.ask "Send" "Ask"}}</span>
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

      {{#if this.ask}}
        <section class="home-ask pop-in" aria-label="Chat with Woogi">
          <div class="home-ask-head">
            <Icon @name="sparkles" @size={{16}} />
            <strong class="home-ask-title">Woogi</strong>
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
              aria-label="Close the chat"
              {{on "click" this.closeAsk}}
            ><Icon @name="x" @size={{14}} /></button>
          </div>
          {{! template-lint-disable no-invalid-interactive }}
          <div
            class="home-chat"
            aria-live="polite"
            {{on "click" this.onAnswerClick}}
          >
            {{#each this.chatMessages as |message|}}
              {{#if (eq message.role "user")}}
                <div class="home-bubble is-user">{{message.content}}</div>
              {{else if message.content}}
                <div class="home-bubble is-woogi">
                  <img
                    src="/icon_expanded.png"
                    alt=""
                    class="home-bubble-avatar"
                    aria-hidden="true"
                  />
                  <div
                    class="home-ask-answer {{if this.ask.busy 'is-typing'}}"
                  >{{renderAnswer message.content}}</div>
                </div>
              {{/if}}
            {{/each}}
            {{#if this.ask.error}}
              <div class="home-bubble is-woogi is-error">
                <img
                  src="/icon_expanded.png"
                  alt=""
                  class="home-bubble-avatar"
                  aria-hidden="true"
                />
                <div class="home-ask-answer">{{this.ask.error}}</div>
              </div>
            {{else if this.ask.status}}
              <div class="home-bubble is-woogi is-status">
                <img
                  src="/icon_expanded.png"
                  alt=""
                  class="home-bubble-avatar"
                  aria-hidden="true"
                />
                <div class="home-ask-answer">{{this.ask.status}}</div>
              </div>
            {{/if}}
          </div>
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
          <p class="home-ask-status is-note">a small model running on your
            device, so take what it says with a pinch of salt. nothing you type
            leaves this browser.</p>
        </section>
      {{/if}}

      {{#if this.isSearching}}
        {{#if this.results.length}}
          {{! template-lint-disable no-invalid-interactive }}
          <div
            class="home-results {{if this.showHand 'has-hand'}}"
            {{on "click" this.onResultClick}}
          >
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
          <section class="home-section pop-in">
            <h2 class="section-title">{{group.name}}</h2>
            <div class="tool-grid">
              {{#each group.items key="tool.route" as |card|}}
                <ToolCard @card={{card}} @reveal={{true}} />
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
    class="tool-card
      {{if @reveal 'scroll-card'}}
      {{if @card.suit.black 'is-black' 'is-red'}}
      {{if @active 'is-active'}}"
    {{revealOnScroll @reveal}}
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
