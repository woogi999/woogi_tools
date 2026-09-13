// Myers' O((N+M)·D) diff. Returns [{ type: 'equal' | 'insert' | 'delete', value }].

// Stop before the edit trace gets big enough to freeze the tab.
const MAX_TRACE_CELLS = 40_000_000;

export class DiffTooLargeError extends Error {}

export function diff(a, b, key = (x) => x) {
  const ka = a.map(key);
  const kb = b.map(key);

  // Shared prefix/suffix never need the full algorithm.
  let start = 0;
  while (start < ka.length && start < kb.length && ka[start] === kb[start]) start++;
  let endA = ka.length;
  let endB = kb.length;
  while (endA > start && endB > start && ka[endA - 1] === kb[endB - 1]) {
    endA--;
    endB--;
  }

  const middle = myers(ka.slice(start, endA), kb.slice(start, endB)).map((op) => ({ type: op.type, value: op.type === 'insert' ? b[start + op.j] : a[start + op.i] }));
  return [...a.slice(0, start).map((value) => ({ type: 'equal', value })), ...middle, ...a.slice(endA).map((value) => ({ type: 'equal', value }))];
}

function myers(a, b) {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (max === 0) return [];
  const offset = max + 1;
  const v = new Int32Array(2 * max + 2);
  const trace = [];
  let cells = 0;

  for (let d = 0; d <= max; d++) {
    cells += v.length;
    if (cells > MAX_TRACE_CELLS) throw new DiffTooLargeError('These texts are too different to compare in the browser. Try comparing by lines instead.');
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m, offset);
    }
  }
  return [];
}

function backtrack(trace, n, m, offset) {
  const ops = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ type: 'equal', i: x - 1, j: y - 1 });
      x--;
      y--;
    }
    if (d > 0) ops.push(x === prevX ? { type: 'insert', i: x, j: y - 1 } : { type: 'delete', i: x - 1, j: y });
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

// Joins neighbouring operations of the same type so the output renders as runs.
export function mergeRuns(ops, join = (values) => values.join('')) {
  const runs = [];
  for (const op of ops) {
    const last = runs.at(-1);
    if (last?.type === op.type) last.values.push(op.value);
    else runs.push({ type: op.type, values: [op.value] });
  }
  return runs.map((r) => ({ type: r.type, value: join(r.values), count: r.values.length }));
}
