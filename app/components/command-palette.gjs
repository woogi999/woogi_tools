import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { service } from '@ember/service';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import Icon from './icon';
import { searchTools } from '../tools';
import { htmlToPlainText } from '../utils/html-text';

const CLOSE_MS = 140;
const LIST_LIMIT = 50;
const NOTE_LIMIT = 20;
const CONTEXT = 28;
const autofocus = modifier((element) => element.focus());

// Snippets only search the body text; a title-only match still surfaces the
// note (via the outer filter) but shows a plain content preview instead of
// repeating the title that's already shown as the result's heading.
function noteSnippet(note, needle) {
  const content = htmlToPlainText(note.contentHtml);
  const i = content.toLowerCase().indexOf(needle.toLowerCase());
  if (i === -1) return { before: '', match: '', after: content.slice(0, 60) };
  const from = Math.max(0, i - CONTEXT);
  const to = Math.min(content.length, i + needle.length + CONTEXT);
  return {
    before: (from > 0 ? '…' : '') + content.slice(from, i),
    match: content.slice(i, i + needle.length),
    after:
      content.slice(i + needle.length, to) + (to < content.length ? '…' : ''),
  };
}

function findRanges(root, query) {
  const needle = query.toLowerCase();
  const ranges = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.checkVisibility()) continue;
    const text = node.data.toLowerCase();
    for (
      let i = text.indexOf(needle);
      i !== -1;
      i = text.indexOf(needle, i + needle.length)
    ) {
      const range = new Range();
      range.setStart(node, i);
      range.setEnd(node, i + needle.length);
      ranges.push(range);
    }
  }
  return ranges;
}

function snippet(range) {
  const text = range.startContainer.data;
  const { startOffset: s, endOffset: e } = range;
  const from = Math.max(0, s - CONTEXT);
  const to = Math.min(text.length, e + CONTEXT);
  return {
    before: (from > 0 ? '…' : '') + text.slice(from, s).trimStart(),
    match: text.slice(s, e),
    after: text.slice(e, to).trimEnd() + (to < text.length ? '…' : ''),
  };
}

function isFindShortcut(event) {
  const mod = event.ctrlKey || event.metaKey;
  return (
    (mod && (event.code === 'KeyF' || event.code === 'KeyG')) ||
    event.key === 'F3'
  );
}

// Global Ctrl/Cmd+F, FX-Console style: finds words on the page first,
// then offers tools to jump to.
export default class CommandPalette extends Component {
  @service router;
  @service notes;
  @service toolVisibility;
  @tracked isOpen = false;
  @tracked isClosing = false;
  @tracked query = '';
  @tracked matches = [];
  @tracked current = 0;

  constructor(owner, args) {
    super(owner, args);
    // Capture phase so nothing on the page can swallow the event before Chrome's find bar opens.
    window.addEventListener('keydown', this.onKeydown, { capture: true });
    registerDestructor(this, () => {
      window.removeEventListener('keydown', this.onKeydown, { capture: true });
      this.clearHighlights();
    });
  }

  get tools() {
    if (!this.query.trim()) return [];
    return searchTools(this.query).filter((tool) =>
      this.toolVisibility.isVisible(tool),
    );
  }

  // Expanded Ctrl+F: while inside Quick Notes, also search every note's
  // title and text (not just what's currently rendered on screen).
  get inNotesTool() {
    return this.router.currentRouteName === 'quick-notes';
  }

  get noteMatches() {
    const query = this.query.trim();
    if (!this.inNotesTool || !query) return [];
    const needle = query.toLowerCase();
    return this.notes.notes
      .filter((n) =>
        `${n.title}\n${htmlToPlainText(n.contentHtml)}`
          .toLowerCase()
          .includes(needle),
      )
      .slice(0, NOTE_LIMIT)
      .map((note) => ({
        note,
        title: note.title || 'Untitled',
        ...noteSnippet(note, query),
      }));
  }

  selectNote = (note) => {
    this.notes.requestOpen(note.id);
    this.router.transitionTo('quick-notes');
    this.close();
  };

  get matchItems() {
    return this.matches.slice(0, LIST_LIMIT).map((range, index) => ({
      index,
      ...snippet(range),
      isCurrent: index === this.current,
    }));
  }

  get hiddenCount() {
    return Math.max(0, this.matches.length - LIST_LIMIT);
  }

  get matchLabel() {
    if (!this.query.trim())
      return this.inNotesTool
        ? 'Type to search your notes and tools'
        : 'Type to search this page and your tools';
    if (!this.matches.length) return 'No matches on this page';
    return `${this.current + 1} of ${this.matches.length} on this page`;
  }

  onKeydown = (event) => {
    if (isFindShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      if (
        this.isOpen &&
        this.matches.length &&
        !event.ctrlKey &&
        !event.metaKey
      )
        this.step(event.shiftKey ? -1 : 1);
      else this.open();
      return;
    }
    if (!this.isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (this.matches.length) this.step(event.shiftKey ? -1 : 1);
      else this.select(this.tools[0]);
    }
  };

  open() {
    this.isClosing = false;
    this.isOpen = true;
    document.querySelector('.command-palette-input')?.select();
  }

  close = () => {
    if (!this.isOpen || this.isClosing) return;
    this.isClosing = true;
    this.clearHighlights();
    setTimeout(() => {
      if (!this.isClosing) return;
      this.isOpen = false;
      this.isClosing = false;
      this.query = '';
      this.matches = [];
    }, CLOSE_MS);
  };

  updateQuery = (event) => {
    this.query = event.target.value;
    const query = this.query.trim();
    const main = document.querySelector('main');
    this.matches = query && main ? findRanges(main, query) : [];
    this.current = 0;
    this.highlight();
  };

  step(delta) {
    this.goTo(
      (this.current + delta + this.matches.length) % this.matches.length,
    );
  }

  goTo = (index) => {
    this.current = index;
    this.highlight();
    document
      .querySelector('.palette-match.current')
      ?.scrollIntoView({ block: 'nearest' });
  };

  highlight() {
    if (!window.CSS?.highlights) return;
    CSS.highlights.set('search', new Highlight(...this.matches));
    const range = this.matches[this.current];
    if (range) {
      CSS.highlights.set('search-current', new Highlight(range));
      range.startContainer.parentElement.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
    } else {
      CSS.highlights.delete('search-current');
    }
  }

  clearHighlights() {
    CSS.highlights?.delete('search');
    CSS.highlights?.delete('search-current');
  }

  select = (tool) => {
    if (!tool) return;
    this.router.transitionTo(tool.route);
    this.close();
  };

  stop = (event) => event.stopPropagation();

  <template>
    {{#if this.isOpen}}
      {{! the backdrop and panel only route stray clicks; every command is
      reachable from the input and the list below }}
      {{! template-lint-disable no-invalid-interactive }}
      <div
        class="command-palette-backdrop {{if this.isClosing 'closing'}}"
        {{on "click" this.close}}
      >
        <div class="command-palette" {{on "click" this.stop}}>
          {{! template-lint-enable no-invalid-interactive }}
          <div class="command-palette-bar">
            <Icon @name="search" @size={{14}} />
            <input
              type="text"
              class="command-palette-input"
              placeholder="Find on page or jump to a tool…"
              aria-label="Find on page or jump to a tool"
              value={{this.query}}
              {{on "input" this.updateQuery}}
              {{autofocus}}
            />
          </div>
          <div class="command-palette-status">
            {{this.matchLabel}}
            {{#if this.matches.length}}<kbd>Enter</kbd>
              next ·
              <kbd>Shift+Enter</kbd>
              prev{{/if}}
          </div>

          {{#if this.matches.length}}
            <div class="nav-group-label">On this page</div>
            <ul class="command-palette-results palette-matches">
              {{#each this.matchItems as |item|}}
                <li>
                  <button
                    type="button"
                    class="command-palette-result palette-match
                      {{if item.isCurrent 'current'}}"
                    {{on "click" (fn this.goTo item.index)}}
                  >
                    <span class="palette-snippet">{{item.before}}<mark
                      >{{item.match}}</mark>{{item.after}}</span>
                  </button>
                </li>
              {{/each}}
              {{#if this.hiddenCount}}
                <li class="command-palette-empty">+{{this.hiddenCount}}
                  more, refine your search</li>
              {{/if}}
            </ul>
          {{/if}}

          {{#if this.noteMatches.length}}
            <div class="nav-group-label">In your notes</div>
            <ul class="command-palette-results">
              {{#each this.noteMatches as |item|}}
                <li>
                  <button
                    type="button"
                    class="command-palette-result"
                    {{on "click" (fn this.selectNote item.note)}}
                  >
                    <Icon @name="sticky-note" @size={{14}} />
                    <span class="palette-snippet">{{item.title}}:
                      {{item.before}}<mark
                      >{{item.match}}</mark>{{item.after}}</span>
                  </button>
                </li>
              {{/each}}
            </ul>
          {{/if}}

          {{#if this.tools.length}}
            <div class="nav-group-label">Tools</div>
            <ul class="command-palette-results">
              {{#each this.tools as |tool|}}
                <li>
                  <button
                    type="button"
                    class="command-palette-result"
                    {{on "click" (fn this.select tool)}}
                  >
                    <Icon @name={{tool.icon}} @size={{14}} />
                    <span>{{tool.label}}</span>
                  </button>
                </li>
              {{/each}}
            </ul>
          {{/if}}
        </div>
      </div>
    {{/if}}
  </template>
}
