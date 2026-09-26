// Stroke order for kanji and kana, from KanjiVG (kanjivg.tagaini.net, CC
// BY-SA 3.0): one SVG per character, its strokes as paths numbered in the
// order they're written. Text bars in "stroke order" draw them one by one.
//
// Each character is fetched once, from jsDelivr's copy of the KanjiVG
// repository, and kept in IndexedDB; the paths are then stored in the design
// itself, so a saved design never needs the network again.

import { idbGet, idbSet } from './idb-store';

const SOURCE = 'https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg@master/kanji/';
const CACHE = 'woogi-cache:kanjivg:';
const memory = new Map();

const fileFor = (char) =>
  `${char.codePointAt(0).toString(16).padStart(5, '0')}.svg`;

// The stroke paths, in order, from one KanjiVG file.
export function parseStrokes(svgText) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  return [...doc.querySelectorAll('path[id]')]
    .map((path) => ({
      n: Number(/-s(\d+)$/.exec(path.getAttribute('id'))?.[1]),
      d: path.getAttribute('d'),
    }))
    .filter((s) => s.n && s.d)
    .sort((a, b) => a.n - b.n)
    .map((s) => s.d);
}

/**
 * The strokes of `char` in writing order, or null if KanjiVG doesn't have it
 * (Latin letters, most punctuation) or it can't be reached.
 */
export function strokesFor(char) {
  if (memory.has(char)) return memory.get(char);
  const job = (async () => {
    const cached = await idbGet(CACHE + char);
    if (cached !== undefined) return cached;
    let strokes = null;
    try {
      // eslint-disable-next-line warp-drive/no-external-request-patterns -- a static file from a CDN, not app data
      const response = await fetch(SOURCE + fileFor(char));
      if (response.ok) strokes = parseStrokes(await response.text());
      else if (response.status !== 404) throw new Error(response.statusText);
    } catch {
      // Offline, or the CDN is down: try again next time, don't remember "none".
      memory.delete(char);
      return null;
    }
    const found = strokes?.length ? strokes : null;
    await idbSet(CACHE + char, found);
    return found;
  })();
  memory.set(char, job);
  return job;
}
