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

export async function pdfToHtml(pdf, { progress = () => {}, pdfjs } = {}) {
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    // Fonts only reach this side of the worker once the page has been
    // prepared for drawing; that's where the bold and italic flags live.
    const ops = await page.getOperatorList();
    const { items } = await page.getTextContent();
    const lines = linesOf(items, page);
    const images = pdfjs ? await imagesOf(ops, page, pdfjs) : [];
    pages.push({ lines, images });
    page.cleanup();
    progress(n / pdf.numPages);
  }
  const bodySize = commonSize(pages.flatMap((p) => p.lines));
  // Text blocks and pictures are put back in the order they sit on the page,
  // top to bottom.
  const blocks = pages.flatMap(({ lines, images }) =>
    [
      ...paragraphs(lines, bodySize).map((block) => ({
        top: block.lines[0].y,
        block,
      })),
      ...images.map((image) => ({ top: image.top, image })),
    ].sort((p, q) => q.top - p.top),
  );
  // Neighbouring list items make one list.
  const html = [];
  for (const { block, image } of blocks) {
    const piece = image
      ? `<p><img src="${image.src}" width="${image.width}" height="${image.height}"></p>`
      : render(block, bodySize);
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

// The pictures drawn on a page, with where they sit. PDF.js hands over the
// drawing as a list of operators, so the current transform is followed
// through saves, restores and nested forms to find where each image lands.
async function imagesOf(ops, page, pdfjs) {
  const { OPS } = pdfjs;
  const images = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const multiply = (m, n) => [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  const place = async (data, m) => {
    const image = await imageData(data, page);
    if (!image) return;
    // The unit square under the transform is where the picture lands.
    const xs = [m[4], m[4] + m[0], m[4] + m[2], m[4] + m[0] + m[2]];
    const ys = [m[5], m[5] + m[1], m[5] + m[3], m[5] + m[1] + m[3]];
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (w < 4 || h < 4) return;
    images.push({
      top: Math.max(...ys),
      width: Math.round((w * 96) / 72),
      height: Math.round((h * 96) / 72),
      src: image,
    });
  };
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = multiply(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (args[0]) ctm = multiply(ctm, args[0]);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.paintImageXObject) await place(args[0], ctm);
    else if (fn === OPS.paintInlineImageXObject) await place(args[0], ctm);
    else if (fn === OPS.paintImageXObjectRepeat) {
      const [id, sx, sy, positions] = args;
      for (let p = 0; p < positions.length; p += 2)
        await place(
          id,
          multiply(ctm, [sx, 0, 0, sy, positions[p], positions[p + 1]]),
        );
    }
  }
  return images;
}

const fetchObject = (page, id) =>
  new Promise((resolve) => {
    const store = id.startsWith('g_') ? page.commonObjs : page.objs;
    store.get(id, resolve);
  });

// A PDF.js image (a bitmap, or raw pixels in one of its layouts) as a PNG data URL.
async function imageData(ref, page) {
  const img = typeof ref === 'string' ? await fetchObject(page, ref) : ref;
  if (!img?.width || !img?.height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (img.bitmap) {
    ctx.drawImage(img.bitmap, 0, 0);
  } else if (img.data) {
    const out = ctx.createImageData(img.width, img.height);
    const dest = out.data;
    const src = img.data;
    const pixels = img.width * img.height;
    if (src.length >= pixels * 4) {
      dest.set(src.subarray(0, pixels * 4));
    } else if (src.length >= pixels * 3) {
      for (let p = 0, s = 0; p < pixels; p++, s += 3) {
        dest[p * 4] = src[s];
        dest[p * 4 + 1] = src[s + 1];
        dest[p * 4 + 2] = src[s + 2];
        dest[p * 4 + 3] = 255;
      }
    } else {
      // One bit a pixel, rows padded to a byte: a set bit is white.
      const rowBytes = (img.width + 7) >> 3;
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++) {
          const bit = (src[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
          const p = (y * img.width + x) * 4;
          dest[p] = dest[p + 1] = dest[p + 2] = bit ? 255 : 0;
          dest[p + 3] = 255;
        }
    }
    ctx.putImageData(out, 0, 0);
  } else return null;
  return canvas.toDataURL('image/png');
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
