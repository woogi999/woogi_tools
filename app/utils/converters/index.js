import { HANDLERS } from './handlers';
import { FORMATS, CATEGORY_ORDER, categoryLabel, detectFormat, stripExtension, formatsIn } from './formats';
import { ENGINE_INFO, ENGINE_LOADERS } from './engines';

export { detectFormat, stripExtension, categoryLabel, CATEGORY_ORDER, formatsIn, FORMATS };

// Longest chain of handlers we'll try, e.g. DOCX → TXT → PDF.
const MAX_STEPS = 3;

// from ext → [{ to, handler }] in handler priority order.
const EDGES = new Map();
for (const handler of HANDLERS) {
  for (const [froms, tos] of handler.pairs) {
    for (const from of froms) {
      if (!EDGES.has(from)) EDGES.set(from, []);
      for (const to of tos) if (to !== from) EDGES.get(from).push({ to, handler });
    }
  }
}

// Breadth-first search, so every target gets its shortest chain and, among
// equally short ones, the chain through the highest-priority handlers.
function routesFrom(source) {
  const routes = new Map([[source, []]]);
  let frontier = [source];
  for (let depth = 0; depth < MAX_STEPS && frontier.length; depth++) {
    const next = [];
    for (const ext of frontier) {
      for (const { to, handler } of EDGES.get(ext) ?? []) {
        if (routes.has(to)) continue;
        routes.set(to, [...routes.get(ext), { from: ext, to, handler }]);
        next.push(to);
      }
    }
    frontier = next;
  }
  routes.delete(source);
  return routes;
}

const ROUTE_CACHE = new Map();
const cachedRoutes = (ext) => {
  if (!ROUTE_CACHE.has(ext)) ROUTE_CACHE.set(ext, routesFrom(ext));
  return ROUTE_CACHE.get(ext);
};

// Reachable targets grouped by category, in catalogue order.
export function targetGroups(sourceExt) {
  const routes = cachedRoutes(sourceExt);
  return CATEGORY_ORDER.map((category) => ({
    category,
    label: categoryLabel(category),
    formats: formatsIn(category).filter((f) => routes.has(f.ext)),
  })).filter((group) => group.formats.length);
}

export function routeDescription(sourceExt, targetExt) {
  const route = cachedRoutes(sourceExt).get(targetExt);
  if (!route || route.length < 2) return null;
  return route
    .slice(0, -1)
    .map((step) => FORMATS.get(step.to)?.label ?? step.to)
    .join(' → ');
}

// Picks a sensible default: another format from the same family first.
export function defaultTarget(source) {
  const routes = cachedRoutes(source.ext);
  const preferred = { image: ['png', 'jpg'], raw: ['jpg', 'png'], audio: ['mp3', 'wav'], video: ['mp4', 'webm'], document: ['pdf', 'docx', 'md'], data: ['json', 'yaml'], archive: ['zip', '7z'], font: ['woff2', 'ttf'] }[source.category] ?? [];
  return preferred.find((ext) => ext !== source.ext && routes.has(ext)) ?? formatsIn(source.category).find((f) => routes.has(f.ext))?.ext ?? routes.keys().next().value ?? null;
}

export function canConvert(sourceExt) {
  return cachedRoutes(sourceExt).size > 0;
}

// Runs every step of the route. `onStatus` receives human-readable progress
// text and `onProgress` a 0–1 fraction across the whole chain.
export async function convertFile(file, source, targetExt, { onStatus = () => {}, onProgress = () => {} } = {}) {
  const route = cachedRoutes(source.ext).get(targetExt);
  if (!route) throw new Error(`Can't convert ${source.label} to ${FORMATS.get(targetExt)?.label ?? targetExt}`);

  const baseName = stripExtension(file.name);
  let blob = file;
  let ext = source.ext;
  for (const [index, step] of route.entries()) {
    const isLast = index === route.length - 1;
    if (step.handler.engine) {
      onStatus(`Loading ${ENGINE_INFO[step.handler.engine]}…`);
      await ENGINE_LOADERS[step.handler.engine]();
    }
    onStatus(route.length > 1 ? `Converting (step ${index + 1} of ${route.length})…` : 'Converting…');
    const result = await step.handler.convert(blob, step.from, step.to, {
      baseName,
      progress: (p) => onProgress((index + p) / route.length),
    });
    if (result instanceof Blob) {
      blob = result;
      ext = step.to;
    } else {
      if (!isLast) throw new Error(`This file produced a ${result.ext.toUpperCase()} partway through, so it can only be converted to ${FORMATS.get(step.to).label} directly`);
      blob = result.blob;
      ext = result.ext;
    }
    onProgress((index + 1) / route.length);
  }
  return { blob, ext, name: `${baseName}.${ext}` };
}
