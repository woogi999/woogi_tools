// Turns a piece of the page into a PNG, for the Mockup Preview. Browsers
// won't paint HTML onto a canvas directly, but an SVG <foreignObject> can
// carry HTML, and an SVG can be drawn onto a canvas. The catch is that the
// SVG is loaded on its own, without the page's stylesheets, so every
// element's computed style is written inline first, and pictures must be
// data: URLs rather than blob: ones.

const SKIP = new Set([
  'inline-size',
  'block-size',
  'transition',
  'animation',
  'cursor',
  'pointer-events',
  'user-select',
]);

function inlineStyles(source, target) {
  const computed = getComputedStyle(source);
  let css = '';
  for (let i = 0; i < computed.length; i++) {
    const name = computed[i];
    if (
      SKIP.has(name) ||
      name.startsWith('-webkit-') ||
      name.startsWith('-moz-')
    )
      continue;
    css += `${name}:${computed.getPropertyValue(name)};`;
  }
  target.setAttribute('style', css);
  const sourceKids = source.children;
  const targetKids = target.children;
  for (let i = 0; i < sourceKids.length; i++)
    inlineStyles(sourceKids[i], targetKids[i]);
}

export async function snapshot(element, { scale = 2 } = {}) {
  const rect = element.getBoundingClientRect();
  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);
  const clone = element.cloneNode(true);
  inlineStyles(element, clone);
  // Form controls and scroll positions don't survive cloning; neither matters here.
  const wrapper = document.createElement('div');
  wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  wrapper.style.width = `${width}px`;
  wrapper.style.height = `${height}px`;
  wrapper.appendChild(clone);
  const html = new XMLSerializer().serializeToString(wrapper);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () =>
      reject(
        new Error(
          'The mockup couldn’t be drawn. Pictures must be loaded through the tool, not linked.',
        ),
      );
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.drawImage(image, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
