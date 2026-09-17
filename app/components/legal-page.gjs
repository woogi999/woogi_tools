import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { LinkTo } from '@ember/routing';
import { htmlSafe } from '@ember/template';

const escape = (text) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Only what the legal documents use: # and ## headings, paragraphs and [links](url).
function renderMarkdown(source) {
  const inline = (text) =>
    escape(text).replace(
      /\[([^\]]+)\]\(((?:https?:|mailto:)[^)\s]+)\)/g,
      '<a href="$2">$1</a>',
    );
  return source
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim().replace(/\s*\r?\n\s*/g, ' '))
    .filter(Boolean)
    .map((block) => {
      if (block.startsWith('## ')) return `<h2>${inline(block.slice(3))}</h2>`;
      if (block.startsWith('# ')) return `<h1>${inline(block.slice(2))}</h1>`;
      if (/^Last updated/i.test(block))
        return `<p class="legal-updated">${inline(block)}</p>`;
      return `<p>${inline(block)}</p>`;
    })
    .join('\n');
}

// Renders public/legal/<route>.md, so the documents are edited in one place.
export default class LegalPage extends Component {
  @tracked html = null;
  @tracked failed = false;

  constructor(owner, args) {
    super(owner, args);
    this.load();
  }

  async load() {
    try {
      // eslint-disable-next-line warp-drive/no-external-request-patterns -- a static document, not app data
      const res = await fetch(`/legal/${this.args.route}.md`);
      if (!res.ok) throw new Error(res.statusText);
      const text = await res.text();
      if (!this.isDestroying) this.html = htmlSafe(renderMarkdown(text));
    } catch {
      if (!this.isDestroying) this.failed = true;
    }
  }

  <template>
    <div class="container legal-page">
      <nav class="legal-nav" aria-label="Legal pages">
        <LinkTo @route="index">Woogi Tools</LinkTo>
        <span aria-hidden="true">/</span>
        <LinkTo @route={{@route}}>{{@title}}</LinkTo>
      </nav>

      <article class="legal-document">
        {{#if this.html}}
          {{this.html}}
        {{else if this.failed}}
          <h1>{{@title}}</h1>
          <p>Couldn't load this page.
            <a href="/legal/{{@route}}.md">Open the document directly</a>.</p>
        {{else}}
          <h1>{{@title}}</h1>
          <p class="legal-updated">Loading…</p>
        {{/if}}
      </article>
    </div>
  </template>
}
