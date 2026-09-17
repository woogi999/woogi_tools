// Reads what GitHub's public REST API says about a repository. Without a
// token GitHub allows 60 requests an hour per address; one lookup here costs
// about six, and the responses are held in memory so re-checking the same
// repository is free.

const API = 'https://api.github.com';
const cache = new Map();

// Accepts "owner/repo", a github.com URL (with any path after the repo) or a
// git remote, and returns { owner, repo } or null.
export function parseRepo(text) {
  const s = text.trim();
  if (!s) return null;
  let m =
    s.match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+)/i) ??
    s.match(/^([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([\w.-]+)$/);
  if (!m) return null;
  const owner = m[1];
  const repo = m[2].replace(/\.git$/, '');
  return owner && repo ? { owner, repo } : null;
}

async function get(path, token, { raw = false } = {}) {
  const key = `${token ? 'auth:' : ''}${path}`;
  if (cache.has(key)) return cache.get(key);
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token.trim()}`;
  // eslint-disable-next-line warp-drive/no-external-request-patterns -- GitHub's API, not app data
  const response = await fetch(`${API}${path}`, { headers });
  if (response.status === 404) throw new Error('No repository by that name');
  if (response.status === 403 || response.status === 429) {
    const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
    const when = reset
      ? ` It resets ${new Date(reset).toLocaleTimeString()}.`
      : '';
    throw new Error(
      `GitHub's rate limit for anonymous lookups is used up.${when} Paste a personal access token to keep going.`,
    );
  }
  if (response.status === 401) throw new Error('GitHub rejected that token');
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const value = raw ? response : await response.json();
  cache.set(key, value);
  return value;
}

// GitHub doesn't hand out a total for commits or contributors, but when
// asked for one per page it says how many pages there are.
async function countOf(path, token) {
  const response = await get(
    `${path}${path.includes('?') ? '&' : '?'}per_page=1`,
    token,
    {
      raw: true,
    },
  );
  const link = response.headers.get('link') ?? '';
  const last = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
  if (last) return Number(last[1]);
  const body = await response.clone().json();
  return Array.isArray(body) ? body.length : 0;
}

const settle = (promise) => promise.catch(() => null);

export async function inspectRepo({ owner, repo }, token) {
  const base = `/repos/${owner}/${repo}`;
  const info = await get(base, token);
  const [languages, contributors, release, commits, contributorCount, tree] =
    await Promise.all([
      settle(get(`${base}/languages`, token)),
      settle(get(`${base}/contributors?per_page=12`, token)),
      settle(get(`${base}/releases/latest`, token)),
      settle(countOf(`${base}/commits`, token)),
      settle(countOf(`${base}/contributors?anon=1`, token)),
      settle(
        get(`${base}/git/trees/${info.default_branch}?recursive=1`, token),
      ),
    ]);
  return {
    info,
    languages,
    contributors,
    release,
    commits,
    contributorCount,
    tree,
  };
}

// Rough bytes-per-line for the estimate shown before an exact count is
// asked for. Most source hovers around 30 to 40 bytes a line.
const BYTES_PER_LINE = 35;

export function estimateLines(languages) {
  if (!languages) return null;
  const bytes = Object.values(languages).reduce((n, b) => n + b, 0);
  return Math.round(bytes / BYTES_PER_LINE);
}

export function fileStats(tree) {
  if (!tree?.tree) return null;
  const files = tree.tree.filter((t) => t.type === 'blob');
  const byExt = new Map();
  let bytes = 0;
  let largest = null;
  for (const f of files) {
    bytes += f.size ?? 0;
    if (!largest || (f.size ?? 0) > largest.size) largest = f;
    const ext = f.path.includes('.')
      ? f.path.slice(f.path.lastIndexOf('.') + 1).toLowerCase()
      : '(none)';
    byExt.set(ext, (byExt.get(ext) ?? 0) + 1);
  }
  return {
    files: files.length,
    folders: tree.tree.filter((t) => t.type === 'tree').length,
    bytes,
    truncated: Boolean(tree.truncated),
    largest,
    extensions: [...byExt]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([ext, count]) => ({ ext, count })),
  };
}

export function formatBytes(n) {
  if (n == null) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return 'today';
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}
