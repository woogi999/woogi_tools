// Turns a PDF's text into structured HTML, so a Word or Markdown file made
// from it keeps its shape: headings stay headings, paragraphs stay together
// and bold or italic runs survive. PDF.js only gives us positioned bits of
// text, so the structure is worked out from where they sit and what they
// look like: lines from their vertical position, paragraphs from the gaps
// between lines, headings from font size, lists from their leading marks or
// their indent.

const escape = (text) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const BULLET = /^[•·◦▪▫‣■□●○\-–—*]\s+/;
const NUMBERED = /^(\(?\d{1,3}[.)]|[a-zA-Z][.)]|[ivxIVX]{1,5}[.)])\s+/;

export async function pdfToHtml(pdf, { progress = () => {} } = {}) {
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    // Fonts only reach this side of the worker once the page has been
    // prepared for drawing; that's where the bold and italic flags live.
    await page.getOperatorList();
    const { items } = await page.getTextContent();
    pages.push(linesOf(items, page));
    page.cleanup();
    progress(n / pdf.numPages);
  }
  const bodySize = commonSize(pages.flat());
  const blocks = pages.flatMap((lines) => paragraphs(lines, bodySize));
  // Neighbouring list items make one list.
  const html = [];
  for (const block of blocks) {
    const piece = render(block, bodySize);
    const last = html[html.length - 1];
    const tag = piece.match(/^<(ul|ol)>/)?.[1];
    if (tag && last?.endsWith(`</${tag}>`))
      html[html.length - 1] =
        last.slice(0, -(tag.length + 3)) + piece.slice(tag.length + 2);
    else html.push(piece);
  }
  return `<!DOCTYPE html>\n<html><head><meta charset="utf-8"></head><body>\n${html.join('\n')}\n</body></html>\n`;
}

// Each item becomes a run: its text and how it looks. Runs on the same
// baseline are gathered into a line, left to right.
function linesOf(items, page) {
  const runs = [];
  for (const item of items) {
    if (!item.str) continue;
    const [a, b, c, d, x, y] = item.transform;
    const size = Math.hypot(c, d) || Math.hypot(a, b) || item.height || 10;
    const font = page.commonObjs.has(item.fontName)
      ? page.commonObjs.get(item.fontName)
      : null;
    const name = font?.name ?? '';
    runs.push({
      text: item.str,
      x,
      y,
      width: item.width,
      size,
      bold: Boolean(font?.bold) || /bold|black|heavy|semibold|demi/i.test(name),
      italic: Boolean(font?.italic) || /italic|oblique/i.test(name),
    });
  }
  runs.sort((p, q) => q.y - p.y || p.x - q.x);
  const lines = [];
  for (const run of runs) {
    const line = lines[lines.length - 1];
    if (
      line &&
      Math.abs(line.y - run.y) < Math.min(line.size, run.size) * 0.45
    ) {
      line.runs.push(run);
    } else {
      lines.push({ y: run.y, size: run.size, runs: [run] });
    }
  }
  for (const line of lines) {
    line.runs.sort((p, q) => p.x - q.x);
    // A gap between two runs that isn't already a space is one.
    for (let i = 1; i < line.runs.length; i++) {
      const prev = line.runs[i - 1];
      const run = line.runs[i];
      const gap = run.x - (prev.x + prev.width);
      if (
        gap > run.size * 0.12 &&
        !/\s$/.test(prev.text) &&
        !/^\s/.test(run.text)
      )
        prev.text += ' ';
    }
    line.x = line.runs[0].x;
    const last = line.runs[line.runs.length - 1];
    line.right = last.x + last.width;
    line.size = Math.max(...line.runs.map((r) => r.size));
    line.text = line.runs.map((r) => r.text).join('');
    line.bold = line.runs.every((r) => r.bold || !r.text.trim());
  }
  return lines.filter((line) => line.text.trim());
}

// The size most of the text is set in, which is what body copy looks like.
function commonSize(lines) {
  const tally = new Map();
  for (const line of lines) {
    const key = Math.round(line.size * 2) / 2;
    tally.set(key, (tally.get(key) ?? 0) + line.text.length);
  }
  let best = 10;
  let most = 0;
  for (const [size, count] of tally)
    if (count > most) {
      most = count;
      best = size;
    }
  return best;
}

// Where most lines start: the left margin of the body copy.
function commonLeft(lines) {
  const tally = new Map();
  for (const line of lines) {
    const key = Math.round(line.x);
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  let best = 0;
  let most = 0;
  for (const [x, count] of tally)
    if (count > most) {
      most = count;
      best = x;
    }
  return best;
}

// Lines become paragraphs: a bigger gap than usual, a change of size, a list
// mark, or a line that stopped well short of the right edge all start a new
// block. Runs of blocks indented from the left margin are treated as a list
// whose bullets were drawn rather than typed (PDFs often do that).
function paragraphs(lines, bodySize) {
  const blocks = [];
  const rightEdge = Math.max(0, ...lines.map((l) => l.right));
  const margin = commonLeft(lines);
  let current = null;
  for (const [i, line] of lines.entries()) {
    const prev = lines[i - 1];
    const numbered = NUMBERED.test(line.text);
    const listed = numbered || BULLET.test(line.text);
    let fresh = !current || listed;
    if (!fresh && prev) {
      const gap = prev.y - line.y;
      const leading = Math.max(prev.size, line.size);
      if (gap > leading * 1.55) fresh = true;
      else if (Math.abs(prev.size - line.size) > bodySize * 0.15) fresh = true;
      else if (
        prev.bold !== line.bold &&
        (prev.size > bodySize * 1.1 || line.size > bodySize * 1.1)
      )
        fresh = true;
      else if (rightEdge - prev.right > prev.size * 2.5) fresh = true;
    }
    if (fresh) {
      current = {
        lines: [],
        size: line.size,
        listed,
        numbered,
        indented: line.x - margin > line.size * 1.2,
        x: line.x,
      };
      blocks.push(current);
    }
    current.lines.push(line);
  }
  // Two or more indented blocks in a row, lined up at the same left, are
  // list items whose marks were drawn rather than written.
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].listed || !blocks[i].indented) continue;
    let j = i;
    while (
      blocks[j + 1] &&
      !blocks[j + 1].listed &&
      blocks[j + 1].indented &&
      Math.abs(blocks[j + 1].x - blocks[i].x) < 1.5
    )
      j++;
    if (j > i) for (let k = i; k <= j; k++) blocks[k].listed = true;
    i = j;
  }
  return blocks;
}

function render(block, bodySize) {
  const size = Math.max(...block.lines.map((l) => l.size));
  const text = block.lines.map((l) => l.text.trim()).join(' ');
  const oneLine = block.lines.length === 1;
  const allBold = block.lines.every((l) => l.bold);
  if (block.listed) {
    const tag = block.numbered ? 'ol' : 'ul';
    const mark = block.numbered
      ? NUMBERED
      : BULLET.test(block.lines[0].text)
        ? BULLET
        : null;
    return `<${tag}><li>${inline(block.lines, mark)}</li></${tag}>`;
  }
  if (text.length < 160 && block.lines.length <= 3) {
    // A heading is bold enough on its own.
    const heading = (level) =>
      `<h${level}>${inline(block.lines, null, allBold)}</h${level}>`;
    if (size >= bodySize * 1.6) return heading(1);
    if (size >= bodySize * 1.3) return heading(2);
    if (
      size >= bodySize * 1.12 ||
      (oneLine && allBold && size >= bodySize * 0.98 && text.length < 90)
    )
      return heading(3);
  }
  return `<p>${inline(block.lines)}</p>`;
}

// The runs of a block joined into one string, with bold and italic marked
// and line-end hyphens mended.
function inline(lines, strip = null, plainBold = false) {
  const runs = [];
  // The list mark can be split across runs ("1." then " "), so it's taken
  // off the front of the line as a whole.
  let toStrip = strip ? (lines[0].text.match(strip)?.[0].length ?? 0) : 0;
  lines.forEach((line, i) => {
    line.runs.forEach((run, j) => {
      let text = run.text;
      if (i === 0 && toStrip > 0) {
        const take = Math.min(toStrip, text.length);
        text = text.slice(take);
        toStrip -= take;
      }
      if (j === line.runs.length - 1) {
        const next = lines[i + 1];
        if (next) {
          // "some-\nthing" was one word; anything else gets the space back.
          if (/[a-z]-$/.test(text) && /^[a-z]/.test(next.text))
            text = text.slice(0, -1);
          else if (!/\s$/.test(text)) text += ' ';
        }
      }
      runs.push({ ...run, text, bold: run.bold && !plainBold });
    });
  });
  let html = '';
  let open = null;
  const tags = (r) => (r.bold ? 'b' : '') + (r.italic ? 'i' : '');
  const closing = (style) =>
    (style.includes('i') ? '</em>' : '') +
    (style.includes('b') ? '</strong>' : '');
  const opening = (style) =>
    (style.includes('b') ? '<strong>' : '') +
    (style.includes('i') ? '<em>' : '');
  for (const run of runs) {
    if (!run.text) continue;
    // Spaces take the style of whatever's around them rather than breaking it.
    const style = run.text.trim() ? tags(run) : (open ?? '');
    if (style !== (open ?? '')) {
      if (open) html += closing(open);
      if (style) html += opening(style);
      open = style || null;
    }
    html += escape(run.text);
  }
  if (open) html += closing(open);
  // A space just inside a closing tag reads better just outside it.
  return html
    .replace(/\s+(<\/(?:strong|em)>)/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
}
