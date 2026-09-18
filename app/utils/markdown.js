// A small markdown renderer for chat messages.
//
// It covers what people actually type in a chat: **bold**, *italic*,
// ~~struck~~, `code`, fenced code blocks, > quotes, - lists, 1. lists,
// headings, links and bare URLs. Everything is HTML-escaped before any
// markup is added, so a message can never smuggle a tag through, and links
// only ever point at http(s) or mailto addresses.

const escape = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
const BARE_URL = /(^|[\s(])((?:https?:\/\/)[^\s<>()]+[^\s<>().,;:!?'"])/g;

const link = (href, label) =>
  SAFE_HREF.test(href)
    ? `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
    : label;

// Inline markup, applied to text that has already been escaped.
function inline(text) {
  const codes = [];
  // Code spans are lifted out first so nothing inside them is touched; the
  // marker is a private-use character no message will contain.
  let out = text.replace(/`([^`\n]+)`/g, (_, code) => {
    codes.push(`<code>${code}</code>`);
    return `\uE000${codes.length - 1}\uE000`;
  });
  out = out
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, label, href) =>
      link(href.replace(/&amp;/g, '&'), label),
    )
    .replace(
      BARE_URL,
      (_, lead, url) => `${lead}${link(url.replace(/&amp;/g, '&'), url)}`,
    )
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>');
  return out.replace(/\uE000(\d+)\uE000/g, (_, i) => codes[Number(i)]);
}

export function renderMarkdown(source) {
  const lines = escape(source).replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let paragraph = [];
  let list = null; // { tag, items }
  let quote = [];

  const flushParagraph = () => {
    if (paragraph.length)
      html.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list)
      html.push(
        `<${list.tag}>${list.items.map((item) => `<li>${inline(item)}</li>`).join('')}</${list.tag}>`,
      );
    list = null;
  };
  const flushQuote = () => {
    if (quote.length)
      html.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // A fenced block runs to the closing fence, or to the end if there is none.
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      flushAll();
      const body = [];
      while (++i < lines.length && !/^```\s*$/.test(lines[i]))
        body.push(lines[i]);
      html.push(`<pre><code>${body.join('\n')}</code></pre>`);
      continue;
    }
    const quoted = line.match(/^&gt;\s?(.*)$/);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]);
      continue;
    }
    flushQuote();
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? 'ul' : 'ol';
      if (list?.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      list.items.push((bullet ?? numbered)[1]);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushAll();
  return html.join('');
}
