// Strips HTML down to plain text, for search and preview snippets.
export function htmlToPlainText(html) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  return div.textContent.trim();
}
