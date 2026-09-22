// The editor's colours, read off the page rather than kept as a second copy.
//
// Everything the canvases draw — the timeline, the selection handles, the ease
// curve — has to match the chrome around it, and the chrome is styled from the
// site's own tokens. So the canvas asks the page what colour to use instead of
// carrying its own palette, which is what keeps the two from drifting apart
// when the site's theme changes or somebody flips to light mode.
//
// The awkward part is getting from a token to something a canvas will paint
// with. Reading a custom property hands back its raw token sequence —
// `color-mix(in oklab, …)` and all — so the value is first bounced through a
// real `color` property, whose computed value is a resolved colour. That is
// still not enough: it resolves in whatever space it was authored in, and the
// site's greys land on `oklch(0.985 0 none)`. A `fillStyle` that cannot be
// parsed is ignored rather than rejected, leaving the previous colour in place
// and painting the wrong thing, so the last step asks a canvas directly.

let probe = null;
let pen = null;

function probeIn(element) {
  if (!probe || !probe.isConnected || probe.parentElement !== element) {
    probe?.remove();
    probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:absolute;width:0;height:0;visibility:hidden';
    element.appendChild(probe);
  }
  return probe;
}

// Whether a canvas can actually paint with this colour, and what it calls it.
//
// Resolving a custom property gives back whatever colour space it was authored
// in — the site's greys compute to `oklch(0.985 0 none)` — and assigning
// something a canvas cannot parse is silently ignored, which leaves the
// *previous* colour in `fillStyle` and paints the wrong thing. So the value is
// offered to a real canvas twice from two different starting colours: if both
// attempts agree, it parsed, and the agreed answer is the canvas' own
// normalised spelling of it.
function normalise(value) {
  if (!pen) pen = document.createElement('canvas').getContext('2d');
  pen.fillStyle = '#000000';
  pen.fillStyle = value;
  const first = pen.fillStyle;
  pen.fillStyle = '#ffffff';
  pen.fillStyle = value;
  return first === pen.fillStyle ? first : null;
}

// One token, resolved against `element`'s own cascade, in a spelling a canvas
// is guaranteed to accept.
export function resolveColour(element, name, fallback = '#888888') {
  try {
    const host = element.closest?.('.fr') ?? element;
    const span = probeIn(host);
    span.style.color = '';
    span.style.color = `var(${name}, ${fallback})`;
    return (
      normalise(getComputedStyle(span).color) ??
      normalise(fallback) ??
      '#888888'
    );
  } catch {
    return fallback;
  }
}

const TOKENS = {
  accent: ['--fr-accent', '#e2e2e2'],
  playhead: ['--fr-playhead', '#ff5c72'],
  panel: ['--fr-panel', '#1c1c1c'],
  panelAlt: ['--fr-panel-alt', '#232323'],
  border: ['--fr-border', '#363636'],
  dim: ['--fr-dim', '#8a8a8a'],
  marker: ['--fr-marker', '#ff5c72'],
  markerSoft: ['--fr-marker-soft', 'rgba(255,92,114,0.45)'],
  grid: ['--fr-grid', 'rgba(255,255,255,0.05)'],
  stripe: ['--fr-stripe', 'rgba(255,255,255,0.03)'],
  bar: ['--fr-bar', '#2e2e2e'],
  barActive: ['--fr-bar-active', '#6e6e6e'],
  grip: ['--fr-grip', 'rgba(255,255,255,0.3)'],
  gripActive: ['--fr-grip-active', 'rgba(255,255,255,0.65)'],
  selection: ['--fr-selection', 'rgba(255,255,255,0.12)'],
  key: ['--fr-key', '#b4b4b4'],
  keySummary: ['--fr-key-summary', '#5e5e5e'],
  keySelected: ['--fr-key-selected', '#ffffff'],
};

// Resolving twenty tokens on every animation frame would be twenty forced
// style recalculations a frame, so the answer is kept until the theme changes.
let cached = null;
let cachedFor = null;

export function paletteOf(element) {
  const theme = document.documentElement.dataset.theme ?? 'dark';
  if (cached && cachedFor === theme) return cached;
  const palette = {};
  for (const [key, [name, fallback]] of Object.entries(TOKENS))
    palette[key] = resolveColour(element, name, fallback);
  cached = palette;
  cachedFor = theme;
  return palette;
}

// The editor's own styles are torn down with it, and a stale probe would keep
// a detached node alive.
export function forgetPalette() {
  probe?.remove();
  probe = null;
  pen = null;
  cached = null;
  cachedFor = null;
}
