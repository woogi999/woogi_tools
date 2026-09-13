// Parses "1-3, 5, 8-" into groups of zero-based page indexes. Returns
// { groups } or { error }. An empty string means every page, as one group.
export function parsePageRanges(text, pageCount) {
  const trimmed = text.trim();
  if (!trimmed) return { groups: [Array.from({ length: pageCount }, (_, i) => i)] };
  const groups = [];
  for (const part of trimmed.split(/[,;]+/).map((p) => p.trim()).filter(Boolean)) {
    const match = /^(\d*)\s*(?:(-)\s*(\d*))?$/.exec(part);
    if (!match || (!match[1] && !match[3])) return { error: `"${part}" isn't a page or range like 2 or 4-7` };
    const start = match[1] ? Number(match[1]) : 1;
    const end = match[2] ? (match[3] ? Number(match[3]) : pageCount) : start;
    if (start < 1 || end < 1) return { error: 'Pages start at 1' };
    if (start > pageCount || end > pageCount) return { error: `This PDF only has ${pageCount} page${pageCount === 1 ? '' : 's'}` };
    const step = start <= end ? 1 : -1;
    const group = [];
    for (let p = start; p !== end + step; p += step) group.push(p - 1);
    groups.push(group);
  }
  return { groups };
}
