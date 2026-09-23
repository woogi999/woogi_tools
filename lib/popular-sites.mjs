// Picks the ~500 best-known sites out of User Profiling's list, for its
// "popular sites" mode: our own hand-picked ones, then Sherlock's (a list
// kept to big, well-known sites), then Maigret's by traffic rank until the
// count is reached. Each picked site gets `top: true`.

export const POPULAR_COUNT = 500;

const key = (name) =>
  name
    .replace(/ \(\d+\)$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export function markPopular(sites, { ours, sherlock, maigret }) {
  const picked = new Set(ours.map(key));
  for (const name of Object.keys(sherlock)) picked.add(key(name));
  const have = new Set(sites.map((s) => key(s.name)));
  const inList = () => [...picked].filter((k) => have.has(k)).length;
  const ranked = Object.entries(maigret.sites)
    .filter(([, s]) => Number.isFinite(s.alexaRank))
    .sort(([, a], [, b]) => a.alexaRank - b.alexaRank);
  for (const [name] of ranked) {
    if (inList() >= POPULAR_COUNT) break;
    picked.add(key(name));
  }
  return sites.map((s) => {
    const copy = { ...s };
    delete copy.top;
    if (picked.has(key(s.name))) copy.top = true;
    return copy;
  });
}
