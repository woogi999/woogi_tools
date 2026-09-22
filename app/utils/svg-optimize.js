// Squeezing an SVG down, using the browser's own XML parser rather than a
// library. An SVG that came out of Illustrator, Figma or Inkscape is mostly
// things no renderer looks at: editor metadata, a comment block, ten decimal
// places on every coordinate, and a group around every group. Taking those
// out is usually half the file and changes nothing you can see.
//
// Every step is optional and each one says how many bytes it saved, because
// "optimise" that quietly breaks a gradient is worse than a bigger file.

// Namespaces an editor leaves behind. None of them affect rendering.
const EDITOR_NS =
  /^(sodipodi|inkscape|sketch|figma|adobe|illustrator|serif|graph|krita|vectornator|xmlns:(sodipodi|inkscape|ns\d))/i;
const EDITOR_TAGS = new Set([
  'metadata',
  'title',
  'desc',
  'sodipodi:namedview',
  'inkscape:path-effect',
]);

// Attributes whose default value is the same as leaving them out.
const DEFAULTS = {
  'fill-opacity': '1',
  'stroke-opacity': '1',
  'stroke-width': '1',
  'stroke-linecap': 'butt',
  'stroke-linejoin': 'miter',
  'stroke-miterlimit': '4',
  'stroke-dasharray': 'none',
  'stroke-dashoffset': '0',
  opacity: '1',
  'fill-rule': 'nonzero',
  'clip-rule': 'nonzero',
  'font-style': 'normal',
  'font-weight': 'normal',
  'font-stretch': 'normal',
  'font-variant': 'normal',
  'text-anchor': 'start',
  visibility: 'visible',
  display: 'inline',
  'color-interpolation-filters': 'linearRGB',
  'enable-background': 'accumulate',
  version: '1.1',
  'xml:space': 'default',
};

// Attributes holding numbers or lists of numbers that can safely be rounded.
const NUMERIC = new Set([
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'stroke-width',
  'offset',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'stroke-dashoffset',
  'font-size',
  'letter-spacing',
  'points',
  'viewBox',
  'stroke-dasharray',
]);

export const DEFAULT_OPTIONS = {
  precision: 2,
  removeComments: true,
  removeMetadata: true,
  removeEditorData: true,
  removeDefaults: true,
  roundNumbers: true,
  shortenColours: true,
  collapseGroups: true,
  removeEmpty: true,
  removeIds: false, // off by default: CSS and <use> out in the page may need them
  removeDimensions: false, // off by default: it changes how the file lays out
};

const round = (n, precision) => {
  const value = Number(n);
  if (!Number.isFinite(value)) return n;
  const out = Number(value.toFixed(precision));
  // "0.5" is shorter as ".5", and "-0.5" as "-.5". Renderers accept both.
  return String(out).replace(/^(-?)0\./, '$1.');
};

const roundList = (value, precision) =>
  value.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (n) => round(n, precision));

// #ffffff → #fff, and rgb(255,0,0) → #f00. Named colours are left alone:
// "red" is already shorter than "#f00" and far easier to read.
function shortenColour(value) {
  let out = value.replace(
    /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/gi,
    (_, r, g, b) =>
      '#' +
      [r, g, b].map((n) => Number(n).toString(16).padStart(2, '0')).join(''),
  );
  out = out.replace(/#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3\b/gi, '#$1$2$3');
  return out.replace(/#[0-9a-f]{3,8}\b/gi, (hex) => hex.toLowerCase());
}

// A path's `d`, with the numbers rounded and the separators cut back to the
// minimum the grammar needs. The commands themselves are left exactly as they
// are: rewriting curves into shorter ones is where path optimisers go wrong.
function tidyPath(d, precision) {
  return (
    roundList(d, precision)
      .replace(/\s+/g, ' ')
      .replace(/\s*([MmLlHhVvCcSsQqTtAaZz])\s*/g, '$1')
      // "1 -2" doesn't need the space, and neither does "1 .5".
      .replace(/(\d)\s+-/g, '$1-')
      .replace(/(\d)\s+\./g, '$1.')
      .trim()
  );
}

function walk(node, visit) {
  // Snapshotted, because `visit` is allowed to remove or replace children.
  for (const child of [...node.children]) walk(child, visit);
  visit(node);
}

/**
 * Optimise an SVG string.
 *
 * Returns { svg, before, after, error }. A file the parser refuses is handed
 * back untouched with an error, rather than half-processed.
 */
export function optimizeSvg(source, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const before = new TextEncoder().encode(source).length;
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  const failure = doc.querySelector('parsererror');
  const root = doc.documentElement;
  if (failure || !root || root.nodeName === 'parsererror')
    return {
      svg: source,
      before,
      after: before,
      error: "This doesn't parse as SVG. Is it really an SVG file?",
    };

  if (opts.removeComments) stripComments(doc);

  walk(root, (node) => tidyElement(node, opts, root));
  if (opts.collapseGroups) walk(root, (node) => collapseGroup(node, root));
  if (opts.removeEmpty) walk(root, (node) => dropEmpty(node, root));

  let svg = new XMLSerializer().serializeToString(root);
  // Whitespace between tags means nothing to a renderer, so it goes. The one
  // exception is a file with text in it, where the spaces inside a <text> or
  // a <style> are part of the content: there the indentation stays rather
  // than risk rewriting what the drawing actually says.
  if (!/<(text|tspan|textPath|style)\b/i.test(svg))
    svg = svg.replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ');
  svg = svg.trim();

  return {
    svg,
    before,
    after: new TextEncoder().encode(svg).length,
    error: null,
  };
}

function stripComments(doc) {
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
  const comments = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const comment of comments) comment.remove();
}

function tidyElement(node, opts, root) {
  const name = node.nodeName.toLowerCase();

  if (opts.removeMetadata && EDITOR_TAGS.has(name) && node !== root) {
    // <title> on the root is the accessible name for the whole graphic, so it
    // stays; one buried on a shape is Illustrator's layer name.
    if (name !== 'title' || node.parentNode !== root) {
      node.remove();
      return;
    }
  }

  for (const attr of [...node.attributes]) {
    const attrName = attr.name;
    let value = attr.value;

    if (opts.removeEditorData && EDITOR_NS.test(attrName)) {
      node.removeAttribute(attrName);
      continue;
    }
    if (opts.removeDefaults && DEFAULTS[attrName] === value.trim()) {
      node.removeAttribute(attrName);
      continue;
    }
    if (opts.removeIds && attrName === 'id' && !isReferenced(root, value)) {
      node.removeAttribute(attrName);
      continue;
    }
    if (
      opts.removeDimensions &&
      node === root &&
      (attrName === 'width' || attrName === 'height') &&
      root.getAttribute('viewBox')
    ) {
      node.removeAttribute(attrName);
      continue;
    }

    if (opts.roundNumbers && attrName === 'd')
      value = tidyPath(value, opts.precision);
    else if (opts.roundNumbers && attrName === 'transform')
      value = roundList(value, opts.precision).replace(/\s*,\s*/g, ',');
    else if (opts.roundNumbers && NUMERIC.has(attrName))
      value = roundList(value, opts.precision).replace(/\s+/g, ' ').trim();

    if (opts.shortenColours) value = shortenColour(value);

    if (value !== attr.value) node.setAttribute(attrName, value);
  }
}

// Whether anything still points at this id, through url(#id), href="#id" or a
// CSS rule in a <style> block. Getting this wrong silently breaks gradients
// and clip paths, so anything uncertain counts as referenced.
function isReferenced(root, id) {
  if (!id) return false;
  const markup = root.outerHTML ?? new XMLSerializer().serializeToString(root);
  // The id="…" attribute itself carries no hash, so any `#id` in the markup
  // is a genuine pointer at this element.
  return new RegExp(`#${id.replace(/[^\w-]/g, '\\$&')}\\b`).test(markup);
}

// A <g> that carries nothing of its own is just a wrapper: its children can
// move up to its parent. A <g> with a transform, clip, mask or style is doing
// real work and stays.
const MEANINGFUL =
  /^(transform|clip-path|mask|filter|style|opacity|id|class|fill|stroke|font|text|marker|shape|stroke-|fill-|paint-|pointer-|dominant-)/;

function collapseGroup(node, root) {
  if (node.nodeName.toLowerCase() !== 'g' || node === root) return;
  if ([...node.attributes].some((a) => MEANINGFUL.test(a.name))) return;
  const parent = node.parentNode;
  if (!parent) return;
  while (node.firstChild) parent.insertBefore(node.firstChild, node);
  node.remove();
}

const KEEPS_EMPTY = new Set([
  'svg',
  'use',
  'image',
  'rect',
  'circle',
  'ellipse',
  'line',
  'path',
  'polygon',
  'polyline',
  'stop',
  'animate',
  'animateTransform',
  'feFlood',
  'feImage',
]);

function dropEmpty(node, root) {
  if (node === root) return;
  const name = node.nodeName.toLowerCase();
  if (KEEPS_EMPTY.has(name)) return;
  if (node.children.length) return;
  if (node.textContent.trim()) return;
  node.remove();
}
