// User Profiling's report: what the found accounts say, merged into one
// picture of the person the way Maigret's report does, plus the link graph
// and the PDF/JSON exports. The extraction itself happens in the Worker (see
// profile-extract.js); this only combines what came back.

import { USERNAME_SITES } from './username-sites';
import { priorityOf } from './priority-sites';
import { loadJsPdf } from './converters/engines';

// ─── Which known site a link points to, and whose account it is ─────────

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const bare = (host) => host.toLowerCase().replace(/^www\./, '');
// Sites that moved, so old links still count.
const ALIASES = { 'twitter.com': 'x.com', 'mobile.twitter.com': 'x.com' };

let matchers = null;
function buildMatchers() {
  matchers = new Map(); // host -> [{ re, index }]
  USERNAME_SITES.forEach((site, index) => {
    let url;
    try {
      url = new URL(site.url.replace('{}', 'USERNAME'));
    } catch {
      return;
    }
    const tail = `${url.pathname}${url.search}`;
    if (!tail.includes('USERNAME')) return; // name in the subdomain; rare
    const re = new RegExp(
      `^${escape(tail.replace(/\/$/, '')).replace(
        'USERNAME',
        '([A-Za-z0-9._-]{2,40})',
      )}/?$`,
      'i',
    );
    const host = bare(url.hostname);
    if (!matchers.has(host)) matchers.set(host, []);
    matchers.get(host).push({ re, index });
  });
}

export function accountFromLink(link) {
  if (!matchers) buildMatchers();
  let url;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  let host = bare(url.hostname);
  host = ALIASES[host] ?? host;
  const tail = `${url.pathname}${url.search}`.replace(/\/$/, '');
  for (const { re, index } of matchers.get(host) ?? []) {
    const m = tail.match(re);
    if (m) return { index, site: USERNAME_SITES[index].name, username: m[1] };
  }
  return null;
}

// ─── The merged picture ──────────────────────────────────────────────────

export const FIELDS = [
  ['name', 'Names'],
  ['alternate', 'Other names'],
  ['location', 'Locations'],
  ['email', 'Email addresses'],
  ['website', 'Websites'],
  ['company', 'Work'],
  ['birthday', 'Birthdays'],
  ['gender', 'Gender'],
  ['bio', 'Bios'],
];

const norm = (v) =>
  String(v)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@.]+/gu, ' ')
    .trim();

// Page titles like "max (Max Krohn) on Keybase" or plain "Keybase" aren't a
// name; neither is the username itself.
function tidyName(value, account) {
  let v = String(value)
    .replace(
      new RegExp(`\\s+(on|at|[|•·-])\\s+${escape(account.site)}.*$`, 'i'),
      '',
    )
    .trim();
  const m = v.match(/^\S+\s+\((.+)\)$/);
  if (m) v = m[1];
  // Labels, page titles and placeholders, not names: anything with a
  // handle, brackets, separators or digits in it, more than five words, or
  // a single all-lowercase word ("textures").
  if (
    /[@:()[\]{}|<>]|\d|'s\b/.test(v) ||
    /\b(profile|user|member|account|private|page|home|official|years?|click|here|chat|welcome|log ?in|sign ?up|personal)\b/i.test(
      v,
    ) ||
    v.split(/\s+/).length > 5 ||
    /^[a-z]+$/.test(v)
  )
    return null;
  const n = norm(v);
  if (!n || n === norm(account.username) || n === norm(account.site))
    return null;
  if (norm(account.site).includes(n) || n.includes(norm(account.site)))
    return null;
  return v;
}

// The key a personal-data value is hidden by.
export const hideKey = (field, value) => `${field}:${norm(value)}`;

// accounts: [{ username, site, url, profile }]
// extra: {
//   emails:  emailIntel() results,
//   ips:     ipIntel() results,
//   manual:  [{ field, value }] added by hand,
//   hidden:  [hideKey] values hidden by hand,
// }
export function buildReport(usernames, found, extra = {}) {
  const { emails = [], ips = [], manual = [], hidden = [] } = extra;
  const hiddenSet = new Set(hidden);
  // A Gravatar profile is one more account, found by email rather than name.
  const accounts = [
    ...found,
    ...emails
      .filter((e) => e.gravatar)
      .map((e) => ({
        username: e.email,
        site: 'Gravatar',
        url: e.gravatar.url ?? `https://gravatar.com`,
        viaEmail: true,
        profile: {
          name: e.gravatar.name,
          location: e.gravatar.location,
          bio: e.gravatar.bio,
          company: e.gravatar.company,
          image: e.gravatar.image,
          links: e.gravatar.accounts.map((a) => a.url),
        },
      })),
  ];
  const fields = Object.fromEntries(FIELDS.map(([k]) => [k, new Map()]));
  const add = (field, value, account) => {
    if (value == null || value === '') return;
    const key = norm(value);
    if (!key) return;
    const entry = fields[field].get(key) ?? {
      value: String(value),
      sources: [],
      ids: [],
      domains: new Set(),
    };
    if (!entry.sources.includes(account.site)) entry.sources.push(account.site);
    try {
      entry.domains.add(
        bare(new URL(account.url).hostname).split('.').slice(-2)[0],
      );
    } catch {
      // a custom site with an odd address; counts by name alone
    }
    entry.ids.push(`${account.site}:${account.username}`);
    fields[field].set(key, entry);
  };
  // What was typed in counts as known, and what was added by hand is
  // credited to "You".
  const you = { site: 'You', username: '', url: '' };
  for (const e of emails) add('email', e.email, { ...you, site: 'Searched' });
  for (const m of manual) if (fields[m.field]) add(m.field, m.value, you);
  const known = new Set(usernames.map((u) => u.toLowerCase()));
  const linked = new Map(); // username -> { username, via: [site] }
  const links = new Map(); // other outbound pages -> { url, sources }
  const images = [];
  let earliest = null;
  let followers = 0;

  for (const account of accounts) {
    const p = account.profile;
    if (!p) continue;
    add('name', p.name && tidyName(p.name, account), account);
    if (p.alternate && norm(p.alternate) !== norm(account.username))
      add('alternate', p.alternate, account);
    // Codes and numbers ("ru_RU", "102", "GI") aren't places.
    if (p.location && /\p{L}{3}/u.test(p.location) && !/_/.test(p.location))
      add('location', p.location, account);
    add('email', p.email, account);
    add('website', p.website, account);
    add('company', p.company, account);
    add('birthday', p.birthday, account);
    add('gender', p.gender, account);
    add('bio', p.bio, account);
    if (p.image)
      images.push({
        url: p.image,
        site: account.site,
        id: `${account.site}:${account.username}`,
      });
    if (p.created && (!earliest || p.created < earliest.date))
      earliest = { date: p.created, site: account.site };
    if (p.followers) followers += p.followers;
    const found = [...(p.links ?? [])];
    if (p.twitter) found.push(`https://x.com/${p.twitter}`);
    for (const link of found) {
      const match = accountFromLink(link);
      // Hashes and file names (gist IDs, "x.git") aren't usernames.
      if (match && /^[0-9a-f]{16,}|\.git$/i.test(match.username)) continue;
      if (match) {
        if (known.has(match.username.toLowerCase())) continue;
        const key = match.username.toLowerCase();
        const entry = linked.get(key) ?? {
          username: match.username,
          via: [],
          accounts: [],
        };
        if (!entry.via.includes(account.site)) entry.via.push(account.site);
        entry.ids ??= [];
        entry.ids.push(`${account.site}:${account.username}`);
        if (!entry.accounts.some((a) => a.url === link))
          entry.accounts.push({ site: match.site, url: link });
        linked.set(key, entry);
      } else if (!links.has(link) && links.size < 40) {
        try {
          if (
            bare(new URL(link).hostname) === bare(new URL(account.url).hostname)
          )
            continue;
        } catch {
          continue;
        }
        links.set(link, { url: link, source: account.site });
      }
    }
  }

  // Ranked by how many different sites say it, counting fl.ru and
  // www.fl.ru (listed twice by the site lists) once.
  const ranked = (field, map) =>
    [...map.values()]
      .filter((entry) => !hiddenSet.has(hideKey(field, entry.value)))
      .sort(
        (a, b) =>
          b.sources.includes('You') - a.sources.includes('You') ||
          b.domains.size - a.domains.size,
      )
      .map(({ domains, ...entry }) => ({
        ...entry,
        weight: domains.size,
        hideKey: hideKey(field, entry.value),
      }));
  return {
    usernames,
    accounts,
    emails,
    ips,
    personal: FIELDS.map(([key, label]) => ({
      key,
      label,
      values: ranked(key, fields[key]),
    })).filter((f) => f.values.length),
    linked: [...linked.values()].sort((a, b) => b.via.length - a.via.length),
    links: [...links.values()],
    // Big networks first, so the headline avatar is the one from Instagram or
    // Facebook rather than some obscure forum's default egg.
    images: images
      .sort((a, b) => priorityOf(a.site) - priorityOf(b.site))
      .slice(0, 24),
    earliest,
    followers,
  };
}

// ─── The graph ───────────────────────────────────────────────────────────

export const NODE_KINDS = {
  username: { label: 'Username', colour: '#f5b841' },
  target: { label: 'Email or IP searched', colour: '#ffd166' },
  breach: { label: 'Breach', colour: '#c0392b' },
  account: { label: 'Account', colour: '#4f9dff' },
  name: { label: 'Name', colour: '#2ecc71' },
  location: { label: 'Location', colour: '#ff9f43' },
  email: { label: 'Email', colour: '#ff5a5f' },
  website: { label: 'Website', colour: '#a07bff' },
  company: { label: 'Work', colour: '#1abc9c' },
  linked: { label: 'Linked username', colour: '#f368e0' },
};
const GRAPH_FIELDS = ['name', 'location', 'email', 'website', 'company'];
const MAX_ACCOUNTS_DRAWN = 120;

export function buildGraph(report) {
  const nodes = new Map();
  const edges = [];
  const node = (id, kind, label, extra = {}) => {
    if (!nodes.has(id)) nodes.set(id, { id, kind, label, ...extra });
    return id;
  };
  const edge = (a, b) => edges.push([a, b]);

  for (const u of report.usernames) node(`u:${u.toLowerCase()}`, 'username', u);
  // Searched emails and IPs sit at the middle too, with what hangs off them.
  for (const e of report.emails) {
    const id = node(`u:${e.email}`, 'target', e.email);
    for (const b of e.breaches.slice(0, 10))
      edge(id, node(`b:${b.name.toLowerCase()}`, 'breach', b.name));
  }
  for (const ip of report.ips) {
    const id = node(`ip:${ip.ip}`, 'target', ip.ip);
    if (ip.place)
      edge(id, node(`location:${norm(ip.place)}`, 'location', ip.place));
    if (ip.isp) edge(id, node(`company:${norm(ip.isp)}`, 'company', ip.isp));
    for (const h of ip.hostnames.slice(0, 4))
      edge(id, node(`website:${norm(h)}`, 'website', h));
  }
  // Accounts with something to say first, so a big search stays readable.
  const accounts = [...report.accounts]
    .sort((a, b) => Boolean(b.profile?.name) - Boolean(a.profile?.name))
    .slice(0, MAX_ACCOUNTS_DRAWN);
  for (const a of accounts) {
    const id = node(`a:${a.site}:${a.username}`, 'account', a.site, {
      url: a.url,
    });
    edge(`u:${a.username.toLowerCase()}`, id);
  }
  for (const field of report.personal) {
    if (!GRAPH_FIELDS.includes(field.key)) continue;
    for (const v of field.values.slice(0, 12)) {
      const id = node(`${field.key}:${norm(v.value)}`, field.key, v.value);
      for (const ref of v.ids) edge(`a:${ref}`, id);
    }
  }
  for (const l of report.linked.slice(0, 20)) {
    const id = node(`l:${l.username.toLowerCase()}`, 'linked', l.username, {
      pivot: true,
    });
    for (const ref of l.ids) edge(`a:${ref}`, id);
  }
  // Only edges whose both ends were drawn.
  const kept = edges.filter(([a, b]) => nodes.has(a) && nodes.has(b));
  return layout([...nodes.values()], kept);
}

// A plain force-directed layout (Fruchterman–Reingold): everything pushes
// everything apart, edges pull their ends together, and the usernames are
// pinned in the middle. A few hundred nodes settle in well under 100 ms.
function layout(nodes, edges, size = 1000) {
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const n = nodes.length;
  const k = Math.sqrt((size * size) / Math.max(n, 1)) * 0.7;
  const centre = (d) => d.kind === 'username' || d.kind === 'target';
  const users = nodes.filter(centre);
  const pos = nodes.map((d, i) => {
    if (centre(d)) {
      const j = users.indexOf(d);
      const a = (j / users.length) * Math.PI * 2;
      const r = users.length > 1 ? size * 0.12 : 0;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r, pinned: true };
    }
    const a = i * 2.39996; // golden angle: an even spiral to start from
    const r = Math.sqrt(i / n) * size * 0.45;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
  const links = edges.map(([a, b]) => [index.get(a), index.get(b)]);
  let temp = size / 8;
  for (let step = 0; step < 220; step++) {
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const x = pos[i].x - pos[j].x;
        const y = pos[i].y - pos[j].y;
        const d2 = Math.max(x * x + y * y, 1);
        const f = (k * k) / d2;
        dx[i] += x * f;
        dy[i] += y * f;
        dx[j] -= x * f;
        dy[j] -= y * f;
      }
    for (const [a, b] of links) {
      const x = pos[a].x - pos[b].x;
      const y = pos[a].y - pos[b].y;
      const d = Math.max(Math.hypot(x, y), 1);
      const f = d / k;
      dx[a] -= x * f;
      dy[a] -= y * f;
      dx[b] += x * f;
      dy[b] += y * f;
    }
    for (let i = 0; i < n; i++) {
      if (pos[i].pinned) continue;
      // A gentle pull to the middle keeps loose nodes from drifting off.
      dx[i] -= pos[i].x * 0.02;
      dy[i] -= pos[i].y * 0.02;
      const d = Math.max(Math.hypot(dx[i], dy[i]), 0.01);
      const move = Math.min(d, temp);
      pos[i].x += (dx[i] / d) * move;
      pos[i].y += (dy[i] / d) * move;
    }
    temp *= 0.975;
  }
  const xs = pos.map((p) => p.x);
  const ys = pos.map((p) => p.y);
  const pad = 120;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - 40;
  const width = Math.max(...xs) - minX + pad;
  const height = Math.max(...ys) - minY + 40;
  return {
    viewBox: `${minX.toFixed(0)} ${minY.toFixed(0)} ${width.toFixed(0)} ${height.toFixed(0)}`,
    nodes: nodes.map((d, i) => ({
      ...d,
      x: pos[i].x,
      y: pos[i].y,
      colour: NODE_KINDS[d.kind].colour,
      r: centre(d) ? 11 : d.kind === 'account' ? 6 : 5,
      short: d.label.length > 28 ? `${d.label.slice(0, 27)}…` : d.label,
    })),
    edges: links.map(([a, b]) => ({
      x1: pos[a].x,
      y1: pos[a].y,
      x2: pos[b].x,
      y2: pos[b].y,
      colour: NODE_KINDS[nodes[b].kind].colour,
    })),
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// Everything that was searched: usernames, then emails, then IPs.
const targets = (report) => [
  ...report.usernames.map((u) => `@${u}`),
  ...report.emails.map((e) => e.email),
  ...report.ips.map((i) => i.ip),
];

const fileName = (report, ext, title) =>
  `profile-${(title || targets(report).join('-'))
    .replace(/[^\w@.-]+/g, '-')
    .slice(0, 60)}-${new Date().toISOString().slice(0, 10)}.${ext}`;

// notes: { title, text } written on the page.
export function exportJson(report, notes = {}) {
  const data = {
    generator: 'woogi tools · User Profiling',
    generated: new Date().toISOString(),
    title: notes.title || null,
    notes: notes.text || null,
    usernames: report.usernames,
    emails: report.emails,
    ips: report.ips,
    summary: {
      accounts: report.accounts.length,
      earliestAccount: report.earliest,
      totalFollowers: report.followers,
    },
    personalData: Object.fromEntries(
      report.personal.map((f) => [f.key, f.values]),
    ),
    linkedUsernames: report.linked,
    otherLinks: report.links,
    accounts: report.accounts.map((a) => ({
      username: a.username,
      site: a.site,
      url: a.url,
      ...(a.profile && { profile: a.profile }),
    })),
  };
  save(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    fileName(report, 'json', notes.title),
  );
}

// The graph as a picture for the PDF, drawn from the layout itself so it
// doesn't matter whether the graph is on screen.
const xml = (v) => String(v).replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

function graphSvg(graph) {
  const edges = graph.edges
    .map(
      (e) =>
        `<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke="${e.colour}" stroke-opacity="0.45" stroke-width="1.2"/>`,
    )
    .join('');
  const nodes = graph.nodes
    .map(
      (n) =>
        `<circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="${n.colour}"/>` +
        `<text x="${n.x + n.r + 4}" y="${n.y + 4}" font-family="Helvetica, Arial, sans-serif" font-size="${n.kind === 'username' ? 16 : 12}" font-weight="${n.kind === 'username' ? 700 : 400}" fill="#222">${xml(n.short)}</text>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${graph.viewBox}">${edges}${nodes}</svg>`;
}

async function graphPng(graph) {
  if (!graph?.nodes.length) return null;
  const [, , w, h] = graph.viewBox.split(' ').map(Number);
  const scale = Math.min(1600 / w, 1600 / h, 2);
  const url = URL.createObjectURL(
    new Blob([graphSvg(graph)], { type: 'image/svg+xml' }),
  );
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { data: canvas.toDataURL('image/jpeg', 0.85), w, h };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportPdf(report, graph, notes = {}) {
  const JsPdf = await loadJsPdf();
  const doc = new JsPdf({ unit: 'pt', format: 'a4', compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  let y = M;
  const need = (h) => {
    if (y + h > H - M) {
      doc.addPage();
      y = M;
    }
  };
  const text = (
    value,
    { size = 10, bold = false, colour = 20, gap = 4 } = {},
  ) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(colour);
    // jsPDF's standard fonts only cover Latin-1; anything else would print
    // as garbage, so it's dropped.
    // eslint-disable-next-line no-control-regex -- the whole Latin-1 range, on purpose
    const safe = String(value).replace(/[^\u0000-ÿ•–—‘’“”…]/g, '');
    for (const line of doc.splitTextToSize(safe, W - M * 2)) {
      need(size + gap);
      doc.text(line, M, y + size);
      y += size + gap;
    }
  };
  const heading = (value) => {
    y += 10;
    need(40);
    text(value, { size: 14, bold: true, gap: 8 });
  };

  text(notes.title || 'User profile', { size: 22, bold: true, gap: 6 });
  text(targets(report).join(', '), { size: 13, colour: 80 });
  text(
    `${report.accounts.length} accounts found · generated ${new Date().toLocaleString()} by woogi tools`,
    { size: 9, colour: 120, gap: 12 },
  );
  if (report.earliest)
    text(
      `Oldest account: ${report.earliest.site}, ${new Date(report.earliest.date).toLocaleDateString()}`,
    );
  if (report.followers)
    text(`Followers across accounts: ${report.followers.toLocaleString()}`);

  if (notes.text) {
    heading('Notes');
    text(notes.text, { size: 10 });
  }

  for (const e of report.emails) {
    heading(`Email: ${e.email}`);
    if (e.mail.provider) text(`Mail handled by ${e.mail.provider}`);
    else text('The domain accepts no mail (no MX records).');
    if (e.gravatar)
      text(
        `Gravatar: ${[e.gravatar.name, e.gravatar.location, e.gravatar.job, e.gravatar.company].filter(Boolean).join(' · ')}`,
      );
    text(
      e.breaches.length
        ? `In ${e.breaches.length} known breaches:`
        : 'In no known breach.',
      { bold: true, size: 10 },
    );
    for (const b of e.breaches.slice(0, 40))
      text(
        `• ${b.name}${b.year ? ` (${b.year})` : ''}${b.data ? `: ${b.data}` : ''}`,
        {
          size: 8,
        },
      );
  }

  for (const ip of report.ips) {
    heading(`IP address: ${ip.ip}`);
    const lines = [
      ip.place && `Location: ${ip.place}`,
      ip.isp && `Network: ${ip.isp}${ip.asn ? ` (${ip.asn})` : ''}`,
      ip.org && ip.org !== ip.isp && `Organisation: ${ip.org}`,
      ip.timezone && `Time zone: ${ip.timezone}`,
      ip.hostnames.length && `Hostnames: ${ip.hostnames.join(', ')}`,
    ].filter(Boolean);
    for (const line of lines) text(line);
  }

  heading('Personal data');
  if (!report.personal.length) text('Nothing was found beyond the accounts.');
  for (const field of report.personal) {
    text(field.label, { bold: true, size: 11, gap: 3 });
    for (const v of field.values.slice(0, 15))
      text(`• ${v.value}   (${v.sources.join(', ')})`, { size: 9 });
    y += 4;
  }

  if (report.linked.length) {
    heading('Other usernames found');
    for (const l of report.linked)
      text(`• ${l.username}   (linked from ${l.via.join(', ')})`, { size: 9 });
  }

  const picture = await graphPng(graph);
  if (picture) {
    const width = W - M * 2;
    const height = Math.min((picture.h / picture.w) * width, H - M * 2 - 60);
    // The heading goes wherever the picture does, not a page before it.
    need(height + 50);
    heading('Graph');
    doc.addImage(
      picture.data,
      'JPEG',
      M,
      y,
      (picture.w / picture.h) * height,
      height,
    );
    y += height + 8;
  }

  heading(`Accounts (${report.accounts.length})`);
  for (const a of report.accounts) {
    const p = a.profile ?? {};
    const detail = [
      p.name,
      p.location,
      p.followers && `${p.followers} followers`,
    ]
      .filter(Boolean)
      .join(' · ');
    need(28);
    text(
      `${a.site}${a.username === report.usernames[0] ? '' : ` (@${a.username})`}`,
      {
        bold: true,
        size: 10,
        gap: 2,
      },
    );
    doc.setTextColor(40, 90, 200);
    doc.setFontSize(8);
    doc.textWithLink(a.url.slice(0, 110), M, y + 8, { url: a.url });
    y += 12;
    if (detail) text(detail, { size: 8, colour: 90, gap: 2 });
    y += 4;
  }

  if (report.links.length) {
    heading('Other links on the profiles');
    for (const l of report.links)
      text(`• ${l.url}   (${l.source})`, { size: 8 });
  }

  y += 10;
  text(
    'Found from public profile pages. A match means an account with that name exists, not that it belongs to the person you have in mind; check before you rely on it.',
    { size: 8, colour: 120 },
  );
  // eslint-disable-next-line warp-drive/no-legacy-request-patterns -- jsPDF's own download, not a request
  doc.save(fileName(report, 'pdf', notes.title));
}
