// Ctrl+V anywhere on a tool page drops whatever's on the clipboard into it:
// a screenshot, files copied in the file manager, or copied text saved as a file.
//
// Used as a modifier on a tool's wrapper, so it only listens while that tool is open:
//   <div {{acceptPastedFiles this.addFiles}}>

import { modifier } from 'ember-modifier';

// Pasted plain text becomes a file too, so tools that only take files still get something.
function textFile(text, html) {
  if (html) return new File([html], 'pasted.html', { type: 'text/html' });
  return new File([text], 'pasted.txt', { type: 'text/plain' });
}

export function filesFromClipboard(data, { text = false } = {}) {
  const files = [...(data?.files ?? [])];
  if (!files.length) {
    for (const item of data?.items ?? []) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (files.length || !text) return files;
  const plain = data?.getData?.('text/plain') ?? '';
  const html = data?.getData?.('text/html') ?? '';
  return plain || html ? [textFile(plain, html)] : [];
}

// Pasting into something you're typing in belongs to that field, unless it's a real file.
function typing(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export const acceptPastedFiles = modifier((element, [handler], named = {}) => {
  const onPaste = (event) => {
    if (!handler || !element.isConnected) return;
    const data = event.clipboardData;
    const hasFile = [...(data?.items ?? [])].some((item) => item.kind === 'file');
    if (typing(event.target) && !hasFile) return;
    const files = filesFromClipboard(data, { text: named.text ?? false });
    if (!files.length) return;
    event.preventDefault();
    handler(files);
  };
  window.addEventListener('paste', onPaste);
  return () => window.removeEventListener('paste', onPaste);
});

export const PASTE_HINT = 'Paste with Ctrl+V (⌘V) works too.';
