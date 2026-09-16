// Sending a tool's output straight to a printer. The file is loaded into a
// hidden iframe on this page (never uploaded) and the browser's own print
// dialog takes it from there.

const IMAGE = /^image\/(png|jpeg|jpg|webp|gif|bmp|avif|svg\+xml)$/i;
const TEXT = /^(text\/|application\/(json|xml|javascript|x-yaml))/i;

// What we can put in front of a printer: images, PDFs and plain text.
export function canPrint(type = '', name = '') {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE.test(type) || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg'].includes(ext)) return true;
  if (type === 'application/pdf' || ext === 'pdf') return true;
  if (TEXT.test(type) || ['txt', 'json', 'csv', 'md', 'xml', 'html', 'svg'].includes(ext)) return true;
  return false;
}

const escapeHtml = (text) => text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

const PAGE_CSS = `@page{margin:12mm}html,body{margin:0;padding:0;font-family:system-ui,sans-serif;color:#000;background:#fff}
img{max-width:100%;max-height:100vh;object-fit:contain;display:block;margin:0 auto}
pre{white-space:pre-wrap;word-break:break-word;font:12px/1.5 ui-monospace,monospace}`;

// Prints a Blob or File. Images and text get a small page around them; PDFs print as they are.
export async function printFile(blob, { name = '' } = {}) {
  const type = blob?.type ?? '';
  if (!blob || !canPrint(type, name)) return false;
  const pdf = type === 'application/pdf' || name.toLowerCase().endsWith('.pdf');
  const image = IMAGE.test(type) || /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(name);
  const url = URL.createObjectURL(blob);
  let source = url;
  if (!pdf) {
    const body = image ? `<img src="${url}" alt="${escapeHtml(name)}">` : `<pre>${escapeHtml(await blob.text())}</pre>`;
    const html = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(name || 'Print')}</title><style>${PAGE_CSS}</style>${body}`;
    source = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  }
  await openAndPrint(source, [url, source]);
  return true;
}

// Prints a piece of the page's own markup (a receipt, a table, a note).
export function printHtml(html, { title = '' } = {}) {
  const page = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title || 'Print')}</title><style>${PAGE_CSS}</style>${html}`;
  const url = URL.createObjectURL(new Blob([page], { type: 'text/html' }));
  return openAndPrint(url, [url]);
}

function openAndPrint(source, urls) {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0';
    const cleanUp = () => {
      frame.remove();
      for (const url of urls) URL.revokeObjectURL(url);
      resolve(true);
    };
    frame.onload = () => {
      // The print dialog blocks until it's dismissed, so tidying up after it is enough.
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch {
        // some browsers refuse to print a frame they didn't paint yet
      }
      setTimeout(cleanUp, 1000);
    };
    frame.src = source;
    document.body.append(frame);
  });
}
