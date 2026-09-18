// Small inline SVG charts for the home page assistant. The model writes a
// ```chart block holding a little JSON spec and this turns it into a picture:
//
//   { "type": "bar" | "line" | "pie", "title": "...", "labels": [...], "values": [...] }
//   { "type": "plot", "fn": "sin(x)", "from": -6.3, "to": 6.3 }
//
// Everything is drawn in the page's text colour, with the red card suit for a
// second series, so it fits the rest of the site in both themes.

import { compileFunction } from './math-expr';

const W = 420;
const H = 200;
const PAD = { top: 22, right: 14, bottom: 30, left: 40 };
const SERIES = ['currentColor', 'var(--card-red)', 'var(--text-faint)'];

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmt = (n) =>
  Math.abs(n) >= 1000
    ? n.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : Number(n.toFixed(2)).toString();

// A "nice" step so the grid lands on round numbers.
function ticks(min, max, count = 4) {
  const span = max - min || 1;
  const rough = span / count;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((s) => s * mag).find((s) => s >= rough);
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step)
    out.push(Number(v.toFixed(10)));
  return out;
}

// The model's JSON is not always tidy: single quotes and trailing commas happen.
export function parseChartSpec(text) {
  const cleaned = text
    .trim()
    .replace(/'/g, '"')
    .replace(/,\s*([}\]])/g, '$1');
  try {
    const spec = JSON.parse(cleaned);
    return spec && typeof spec === 'object' ? spec : null;
  } catch {
    return null;
  }
}

function normalise(spec) {
  const labels = Array.isArray(spec.labels) ? spec.labels.map(String) : [];
  // Either `values` (one series) or `series: [{ name, values }]`.
  let series = [];
  if (Array.isArray(spec.series))
    series = spec.series
      .filter((s) => Array.isArray(s?.values))
      .map((s) => ({
        name: String(s.name ?? ''),
        values: s.values.map(Number),
      }));
  else if (Array.isArray(spec.values))
    series = [{ name: '', values: spec.values.map(Number) }];
  else if (
    spec.data &&
    typeof spec.data === 'object' &&
    !Array.isArray(spec.data)
  ) {
    // { "data": { "a": 1, "b": 2 } }
    const entries = Object.entries(spec.data);
    return {
      labels: entries.map(([k]) => k),
      series: [{ name: '', values: entries.map(([, v]) => Number(v)) }],
    };
  }
  series = series.slice(0, SERIES.length).map((s) => ({
    ...s,
    values: s.values.map((v) => (Number.isFinite(v) ? v : 0)),
  }));
  const n = Math.max(labels.length, ...series.map((s) => s.values.length));
  while (labels.length < n) labels.push(String(labels.length + 1));
  return { labels, series };
}

function frame(title, body, legend = '') {
  return `<svg class="ask-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title || 'Chart')}" xmlns="http://www.w3.org/2000/svg">${
    title
      ? `<text x="${PAD.left}" y="14" class="ask-chart-title">${esc(title)}</text>`
      : ''
  }${body}${legend}</svg>`;
}

function legendFor(series) {
  if (series.length < 2) return '';
  let x = PAD.left;
  return series
    .map((s, i) => {
      const item = `<g transform="translate(${x} ${H - 6})"><rect width="10" height="10" y="-9" rx="2" fill="${SERIES[i]}"/><text x="14" class="ask-chart-label">${esc(s.name || `Series ${i + 1}`)}</text></g>`;
      x += 24 + (s.name || `Series ${i + 1}`).length * 6.2;
      return item;
    })
    .join('');
}

function axes(min, max, y, { bottom = PAD.bottom } = {}) {
  return (
    ticks(min, max)
      .map(
        (t) =>
          `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(t)}" y2="${y(t)}" class="ask-chart-grid"/><text x="${PAD.left - 6}" y="${y(t) + 3}" text-anchor="end" class="ask-chart-label">${fmt(t)}</text>`,
      )
      .join('') +
    `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${H - bottom}" y2="${H - bottom}" class="ask-chart-axis"/>`
  );
}

function bars(spec) {
  const { labels, series } = normalise(spec);
  if (!series.length) return null;
  const bottom = series.length > 1 ? PAD.bottom + 14 : PAD.bottom;
  const all = series.flatMap((s) => s.values);
  const min = Math.min(0, ...all);
  const max = Math.max(0, ...all) || 1;
  const plotH = H - PAD.top - bottom;
  const y = (v) => PAD.top + plotH - ((v - min) / (max - min)) * plotH;
  const slot = (W - PAD.left - PAD.right) / labels.length;
  const bw = Math.max(4, (slot * 0.7) / series.length);
  let body = axes(min, max, y, { bottom });
  labels.forEach((label, i) => {
    const x0 = PAD.left + slot * i + (slot - bw * series.length) / 2;
    series.forEach((s, k) => {
      const v = s.values[i] ?? 0;
      const top = Math.min(y(v), y(0));
      const h = Math.max(1, Math.abs(y(v) - y(0)));
      body += `<rect x="${x0 + k * bw + 1}" y="${top}" width="${bw - 2}" height="${h}" rx="3" fill="${SERIES[k]}"><title>${esc(label)}${s.name ? ` · ${esc(s.name)}` : ''}: ${fmt(v)}</title></rect>`;
      if (series.length === 1)
        body += `<text x="${x0 + bw / 2}" y="${top - 4}" text-anchor="middle" class="ask-chart-label">${fmt(v)}</text>`;
    });
    body += `<text x="${PAD.left + slot * i + slot / 2}" y="${H - bottom + 14}" text-anchor="middle" class="ask-chart-label">${esc(label.length > 10 ? label.slice(0, 9) + '…' : label)}</text>`;
  });
  return frame(spec.title, body, legendFor(series));
}

function lines(spec) {
  const { labels, series } = normalise(spec);
  if (!series.length) return null;
  const bottom = series.length > 1 ? PAD.bottom + 14 : PAD.bottom;
  const all = series.flatMap((s) => s.values);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const lo = min === max ? min - 1 : min;
  const hi = min === max ? max + 1 : max;
  const plotH = H - PAD.top - bottom;
  const y = (v) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const x = (i) =>
    PAD.left +
    (labels.length > 1
      ? (i / (labels.length - 1)) * (W - PAD.left - PAD.right)
      : (W - PAD.left - PAD.right) / 2);
  let body = axes(lo, hi, y, { bottom });
  series.forEach((s, k) => {
    const d = s.values
      .map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
      .join(' ');
    body += `<path d="${d}" fill="none" stroke="${SERIES[k]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    s.values.forEach((v, i) => {
      body += `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="${SERIES[k]}"><title>${esc(labels[i])}${s.name ? ` · ${esc(s.name)}` : ''}: ${fmt(v)}</title></circle>`;
    });
  });
  const every = Math.ceil(labels.length / 8);
  labels.forEach((label, i) => {
    if (i % every) return;
    body += `<text x="${x(i)}" y="${H - bottom + 14}" text-anchor="middle" class="ask-chart-label">${esc(label.length > 10 ? label.slice(0, 9) + '…' : label)}</text>`;
  });
  return frame(spec.title, body, legendFor(series));
}

function pie(spec) {
  const { labels, series } = normalise(spec);
  const values = series[0]?.values.map((v) => Math.max(0, v)) ?? [];
  const total = values.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const cx = 100;
  const cy = H / 2 + 6;
  const r = 70;
  let angle = -Math.PI / 2;
  let body = '';
  let legend = '';
  values.forEach((v, i) => {
    const sweep = (v / total) * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    angle += sweep;
    const x2 = cx + r * Math.cos(angle);
    const y2 = cy + r * Math.sin(angle);
    const large = sweep > Math.PI ? 1 : 0;
    // Slices alternate between the ink colours; the gap between them keeps them apart.
    const fill = i % 2 ? 'var(--card-red)' : 'currentColor';
    const opacity = 1 - (Math.floor(i / 2) % 3) * 0.28;
    body += `<path d="M${cx} ${cy} L${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${fill}" fill-opacity="${opacity}" stroke="var(--bg)" stroke-width="2"><title>${esc(labels[i])}: ${fmt(v)} (${Math.round((v / total) * 100)}%)</title></path>`;
    const ly = 40 + i * 18;
    if (ly < H - 8)
      legend += `<g transform="translate(200 ${ly})"><rect width="10" height="10" y="-9" rx="2" fill="${fill}" fill-opacity="${opacity}"/><text x="16" class="ask-chart-label">${esc(labels[i])} · ${Math.round((v / total) * 100)}%</text></g>`;
  });
  return frame(spec.title, body + legend);
}

function plot(spec) {
  let f;
  try {
    // Python habits: x**2 for x^2.
    f = compileFunction(
      String(spec.fn ?? spec.function ?? '').replace(/\*\*/g, '^'),
    );
  } catch {
    return null;
  }
  const from = Number.isFinite(Number(spec.from)) ? Number(spec.from) : -10;
  const to =
    Number.isFinite(Number(spec.to)) && Number(spec.to) > from
      ? Number(spec.to)
      : from + 20;
  const steps = 200;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const x = from + ((to - from) * i) / steps;
    let y;
    try {
      y = f(x);
    } catch {
      y = NaN;
    }
    pts.push([x, Number.isFinite(y) ? y : NaN]);
  }
  const ys = pts.map(([, y]) => y).filter(Number.isFinite);
  if (!ys.length) return null;
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  // Clip wild asymptotes to something readable.
  const spread = hi - lo;
  const plotH = H - PAD.top - PAD.bottom;
  const plotW = W - PAD.left - PAD.right;
  const X = (x) => PAD.left + ((x - from) / (to - from)) * plotW;
  const Y = (y) => PAD.top + plotH - ((y - lo) / spread) * plotH;
  let body = axes(lo, hi, Y);
  if (from < 0 && to > 0)
    body += `<line x1="${X(0)}" x2="${X(0)}" y1="${PAD.top}" y2="${H - PAD.bottom}" class="ask-chart-axis"/>`;
  ticks(from, to, 5).forEach((t) => {
    body += `<text x="${X(t)}" y="${H - PAD.bottom + 14}" text-anchor="middle" class="ask-chart-label">${fmt(t)}</text>`;
  });
  let d = '';
  let pen = false;
  for (const [x, y] of pts) {
    if (!Number.isFinite(y) || y < lo - spread || y > hi + spread) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(y).toFixed(1)} `;
    pen = true;
  }
  body += `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`;
  return frame(spec.title || `y = ${spec.fn ?? spec.function}`, body);
}

// SVG markup for a spec, or null when it can't be drawn.
export function chartSvg(spec) {
  const type = String(
    spec?.type ?? (spec?.fn || spec?.function ? 'plot' : 'bar'),
  ).toLowerCase();
  if (type === 'plot' || type === 'function' || type === 'graph')
    return plot(spec);
  if (type === 'line') return lines(spec);
  if (type === 'pie' || type === 'donut') return pie(spec);
  return bars(spec);
}
