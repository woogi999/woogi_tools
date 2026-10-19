<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import Link from '../core/link.svelte';
  import { truthy } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
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
        if (block.startsWith('## '))
          return `<h2>${inline(block.slice(3))}</h2>`;
        if (block.startsWith('# ')) return `<h1>${inline(block.slice(2))}</h1>`;
        if (/^Last updated/i.test(block))
          return `<p class="legal-updated">${inline(block)}</p>`;
        return `<p>${inline(block)}</p>`;
      })
      .join('\n');
  }

  // Renders public/legal/<route>.md, so the documents are edited in one place.
  class LegalPage extends Component {
    html = $state.raw(null);
    failed = $state.raw(false);

    constructor(args) {
      super(args);
      this.load();
    }

    async load() {
      try {
        const res = await fetch(`/legal/${this.args.route}.md`);
        if (!res.ok) throw new Error(res.statusText);
        const text = await res.text();
        if (!this.isDestroying) this.html = renderMarkdown(text);
      } catch {
        if (!this.isDestroying) this.failed = true;
      }
    }
  }
</script>

<script>
  let args = $props();
  const self = new LegalPage(args);
  onDestroy(() => destroy(self));
</script>

<div class="container legal-page">
  <nav class="legal-nav" aria-label="Legal pages">
    <Link route="index">Woogi Tools</Link>
    <span aria-hidden="true">/</span>
    <Link route={args.route}>{args.title}</Link>
  </nav>

  <article class="legal-document">
    {#if truthy(self.html)}
      {@html self.html}
    {:else if truthy(self.failed)}
      <h1>{args.title}</h1>
      <p
        >Couldn't load this page.
        <a href="/legal/{args.route}.md">Open the document directly</a>.</p
      >
    {:else}
      <h1>{args.title}</h1>
      <p class="legal-updated">Loading…</p>
    {/if}
  </article>
</div>
