// Redaction that actually removes things. For a PDF, the pages are drawn to
// pictures with the boxes painted on, and a fresh PDF is built from those
// pictures: there is no text layer left to select, copy or peel back. For a
// Word file, the matched characters are replaced inside the document's XML
// with block characters, so the words are gone from the file itself.

import { loadPdfJs } from './converters/engines';

const loadPdfLib = () => import('pdf-lib/dist/pdf-lib.esm.min.js');

// ─── PDF ─────────────────────────────────────────────────────────────────

export async function openPdf(file) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() })
    .promise;
  return doc;
}

// Draws one page at `scale` and gives back the canvas.
export async function renderPage(doc, index, scale) {
  const page = await doc.getPage(index + 1);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport })
    .promise;
  return canvas;
}

// Where `query` appears on a page, as boxes in 0..1 page coordinates. A hit
// inside a longer run of text is boxed by its share of the run's width.
export async function findOnPage(doc, index, query) {
  const page = await doc.getPage(index + 1);
  const viewport = page.getViewport({ scale: 1 });
  const { items } = await page.getTextContent();
  const needle = query.toLowerCase();
  const boxes = [];
  for (const item of items) {
    const text = item.str ?? '';
    if (!text || !item.width) continue;
    const lower = text.toLowerCase();
    let at = lower.indexOf(needle);
    while (at >= 0) {
      const [, , , , e, f] = item.transform;
      const height =
        item.height || Math.hypot(item.transform[2], item.transform[3]);
      const x0 = e + (at / text.length) * item.width;
      const x1 = e + ((at + needle.length) / text.length) * item.width;
      const [vx0, vy0] = viewport.convertToViewportPoint(x0, f + height);
      const [vx1, vy1] = viewport.convertToViewportPoint(x1, f - height * 0.25);
      boxes.push({
        x: Math.min(vx0, vx1) / viewport.width,
        y: Math.min(vy0, vy1) / viewport.height,
        w: Math.abs(vx1 - vx0) / viewport.width,
        h: Math.abs(vy1 - vy0) / viewport.height,
      });
      at = lower.indexOf(needle, at + 1);
    }
  }
  return boxes;
}

// Builds the flattened PDF: every page as a picture with its boxes burnt in.
export async function burnPdf(
  doc,
  boxesByPage,
  { scale = 2, onProgress } = {},
) {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  for (let i = 0; i < doc.numPages; i++) {
    const canvas = await renderPage(doc, i, scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    for (const box of boxesByPage[i] ?? []) {
      ctx.fillRect(
        Math.floor(box.x * canvas.width) - 1,
        Math.floor(box.y * canvas.height) - 1,
        Math.ceil(box.w * canvas.width) + 2,
        Math.ceil(box.h * canvas.height) + 2,
      );
    }
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92),
    );
    const image = await out.embedJpg(await blob.arrayBuffer());
    const page = await doc.getPage(i + 1);
    const { width, height } = page.getViewport({ scale: 1 });
    const pdfPage = out.addPage([width, height]);
    pdfPage.drawImage(image, { x: 0, y: 0, width, height });
    onProgress?.((i + 1) / doc.numPages);
  }
  out.setTitle('');
  out.setAuthor('');
  out.setSubject('');
  out.setKeywords([]);
  out.setProducer('Woogi Tools Document Redacter');
  out.setCreator('');
  // eslint-disable-next-line warp-drive/no-legacy-request-patterns -- pdf-lib serialising a document, not a data request
  const bytes = await out.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

// ─── DOCX ────────────────────────────────────────────────────────────────

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PARTS = [
  'word/document.xml',
  'word/header1.xml',
  'word/header2.xml',
  'word/header3.xml',
  'word/footer1.xml',
  'word/footer2.xml',
  'word/footer3.xml',
  'word/footnotes.xml',
  'word/endnotes.xml',
  'word/comments.xml',
];
const decoder = new TextDecoder();
const encoder = new TextEncoder();

export async function openDocx(file) {
  const { unzipSync } = await import('fflate');
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  if (!files['word/document.xml'])
    throw new Error('That doesn’t look like a Word (.docx) file');
  const parts = {};
  for (const name of PARTS)
    if (files[name])
      parts[name] = new DOMParser().parseFromString(
        decoder.decode(files[name]),
        'application/xml',
      );
  return { files, parts };
}

// Every paragraph's text, with its runs, so the page can show the document.
export function docxParagraphs(docx) {
  const out = [];
  for (const [part, xml] of Object.entries(docx.parts)) {
    const paragraphs = xml.getElementsByTagNameNS(W, 'p');
    for (let i = 0; i < paragraphs.length; i++) {
      const runs = [...paragraphs[i].getElementsByTagNameNS(W, 't')];
      const text = runs.map((t) => t.textContent).join('');
      if (text.trim()) out.push({ id: `${part}#${i}`, part, index: i, text });
    }
  }
  return out;
}

// Replaces characters in the XML: `targets` is a list of { id, ranges: [[from, to]] }
// in paragraph text offsets, or { id, all: true } for the whole paragraph.
export function redactDocx(docx, targets) {
  const byId = new Map(targets.map((t) => [t.id, t]));
  let count = 0;
  for (const [part, xml] of Object.entries(docx.parts)) {
    const paragraphs = xml.getElementsByTagNameNS(W, 'p');
    for (let i = 0; i < paragraphs.length; i++) {
      const target = byId.get(`${part}#${i}`);
      if (!target) continue;
      const runs = [...paragraphs[i].getElementsByTagNameNS(W, 't')];
      let offset = 0;
      for (const run of runs) {
        const text = run.textContent;
        const chars = [...text];
        let changed = false;
        for (let c = 0; c < chars.length; c++) {
          const at = offset + c;
          const hit =
            target.all ||
            target.ranges.some(([from, to]) => at >= from && at < to);
          if (hit && chars[c] !== '█') {
            chars[c] = chars[c].trim() ? '█' : chars[c];
            changed = true;
            count++;
          }
        }
        if (changed) {
          run.textContent = chars.join('');
          run.setAttribute('xml:space', 'preserve');
          shadeRun(run, xml);
        }
        offset += chars.length;
      }
    }
  }
  return count;
}

// Black highlight behind the blocks so the bar is solid whatever the font.
function shadeRun(t, xml) {
  const r = t.parentNode;
  if (!r || r.localName !== 'r') return;
  let rPr = r.getElementsByTagNameNS(W, 'rPr')[0];
  if (!rPr) {
    rPr = xml.createElementNS(W, 'w:rPr');
    r.insertBefore(rPr, r.firstChild);
  }
  if (!rPr.getElementsByTagNameNS(W, 'shd').length) {
    const shd = xml.createElementNS(W, 'w:shd');
    shd.setAttributeNS(W, 'w:val', 'clear');
    shd.setAttributeNS(W, 'w:fill', '000000');
    rPr.appendChild(shd);
  }
  const color =
    rPr.getElementsByTagNameNS(W, 'color')[0] ??
    rPr.appendChild(xml.createElementNS(W, 'w:color'));
  color.setAttributeNS(W, 'w:val', '000000');
}

export async function saveDocx(docx) {
  const { zipSync } = await import('fflate');
  const files = { ...docx.files };
  for (const [part, xml] of Object.entries(docx.parts)) {
    let text = new XMLSerializer().serializeToString(xml);
    if (!text.startsWith('<?xml'))
      text = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${text}`;
    files[part] = encoder.encode(text);
  }
  // Word's own metadata can carry the author and a title; blank them too.
  if (files['docProps/core.xml']) {
    const core = decoder
      .decode(files['docProps/core.xml'])
      .replace(/<dc:creator>[^<]*<\/dc:creator>/, '<dc:creator></dc:creator>')
      .replace(
        /<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/,
        '<cp:lastModifiedBy></cp:lastModifiedBy>',
      );
    files['docProps/core.xml'] = encoder.encode(core);
  }
  return new Blob([zipSync(files, { level: 6 })], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
