// The site's download backend: the part of the Video Downloader and the Bunkr
// Downloader that a Cloudflare Worker can't do. It runs yt-dlp (which needs a
// real machine, FFmpeg and a disk) and relays Bunkr's files (which only open
// for a request that looks like it came from Bunkr). Hosted on Render's free
// plan from render.yaml; no npm dependencies, so there is nothing to install.
//
//   GET  /health         { ok }: also what wakes a sleeping free instance
//   POST /bunkr          { url } -> { title, files: [{ name, size, type, url }] }
//                        needs "Authorization: Bearer <API_KEY>"
//   GET  /file?t=TOKEN   the file a token names, streamed as a download
//
// Not an open proxy. /bunkr only answers the site's Worker, which holds the
// key. /file only takes tokens signed with that key (HMAC-SHA256) that expire
// after a couple of hours: the Worker signs the video ones (worker/backend.js)
// and /bunkr signs the Bunkr ones. A token never carries an address to fetch,
// only a video link that is checked again here, or a Bunkr file id.
//
// Environment:
//   API_KEY             required: the secret shared with the Worker
//   PORT                Render sets it (default 10000)
//   RENDER_EXTERNAL_URL Render sets it; PUBLIC_URL overrides it elsewhere
//   MAX_FILE_MB         biggest video yt-dlp may fetch (default 1024)
//   MAX_MINUTES         longest video (default 180)
//   MAX_JOBS            yt-dlp runs at once (default 2: the free plan is small)
//   YTDLP_COOKIES_B64   optional: a Netscape cookies.txt, base64-encoded, for
//                       when YouTube tells the server to sign in
//   YTDLP_PROXY         optional: a proxy address for yt-dlp
//   YTDLP_PATH, PYTHON  where the tools are (defaults: yt-dlp, python3)

import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { detectVideo } from '../app/utils/video-platforms.js';
import { detectBunkr } from '../app/utils/bunkr-link.js';

const API_KEY = process.env.API_KEY ?? '';
const PORT = Number(process.env.PORT) || 10000;
const MAX_BYTES = (Number(process.env.MAX_FILE_MB) || 1024) * 1024 ** 2;
const MAX_SECONDS = (Number(process.env.MAX_MINUTES) || 180) * 60;
const MAX_JOBS = Number(process.env.MAX_JOBS) || 2;
// Relaying a file costs almost nothing next to a yt-dlp run.
const MAX_RELAYS = 6;
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const PYTHON = process.env.PYTHON || 'python3';
const BUNKR_PY = fileURLToPath(new URL('./bunkr.py', import.meta.url));
const TOKEN_TTL_S = 2 * 60 * 60;
const YTDLP_TIMEOUT_MS = 20 * 60 * 1000;
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

if (API_KEY.length < 16)
  throw new Error('API_KEY is missing or too short (16 characters at least).');

// ─── What yt-dlp is asked for ────────────────────────────────────────────
// The ids are the Worker's BACKEND_FORMATS. Sorting by resolution first and
// then preferring H.264 and AAC gets a file every player opens whenever the
// site has one at that size; above 1080p YouTube only has VP9 or AV1.
const video = (height) => [
  '-f',
  'bv*+ba/b',
  '-S',
  `${height ? `res:${height}` : 'res'},vcodec:h264,acodec:aac`,
  '--merge-output-format',
  'mp4',
];
const FORMATS = {
  max: video(null),
  1080: video(1080),
  720: video(720),
  480: video(480),
  360: video(360),
  // -x on its own copies the sound out as it is, with no re-encoding.
  audio: ['-f', 'ba/b', '-S', 'acodec:aac', '-x'],
};

let cookieFile = null;
if (process.env.YTDLP_COOKIES_B64) {
  cookieFile = path.join(tmpdir(), 'yt-dlp-cookies.txt');
  await writeFile(
    cookieFile,
    Buffer.from(process.env.YTDLP_COOKIES_B64, 'base64'),
    { mode: 0o600 },
  );
}

const ytdlpArgs = (format, dir, url) => [
  ...FORMATS[format],
  '--no-playlist',
  '--no-warnings',
  '--no-progress',
  '--no-mtime',
  '--socket-timeout',
  '20',
  '--retries',
  '3',
  '--concurrent-fragments',
  '4',
  // YouTube's player needs a JavaScript runtime to be worked out; Node is
  // already here.
  '--js-runtimes',
  'node',
  '--max-filesize',
  String(MAX_BYTES),
  '--match-filter',
  `!is_live & duration <? ${MAX_SECONDS}`,
  ...(cookieFile ? ['--cookies', cookieFile] : []),
  ...(process.env.YTDLP_PROXY ? ['--proxy', process.env.YTDLP_PROXY] : []),
  '--print',
  'after_move:title',
  '-o',
  path.join(dir, '%(id)s.%(ext)s'),
  '--',
  url,
];

// What yt-dlp says, as something a person can act on.
const YTDLP_ERRORS = [
  [
    /confirm you.re not a bot|Sign in to confirm/i,
    502,
    'YouTube is asking the download backend to sign in to prove it isn’t a bot, which it does to servers. It often passes if you try again later.',
  ],
  [/private video|video is private/i, 404, 'That video is private.'],
  [
    /age.restricted|confirm your age|inappropriate for some users/i,
    403,
    'That video needs a signed-in account (it is age-restricted), which the backend doesn’t use.',
  ],
  [
    /members.only|requires payment|premium/i,
    403,
    'That video is for paying members only.',
  ],
  [
    /does not pass filter|larger than max-filesize/i,
    413,
    'That video is live, too long or too big for the download backend.',
  ],
  [
    /not available in your country|geo.?restrict/i,
    403,
    'That video isn’t available where the download backend is.',
  ],
  [
    /unavailable|has been removed|no longer available|does not exist|HTTP Error 404/i,
    404,
    'That video is unavailable or has been removed.',
  ],
  [
    /login required|log in|cookies/i,
    403,
    'That site only shows this video to people who are logged in.',
  ],
  [/Unsupported URL/i, 400, 'The download backend doesn’t support that link.'],
];

// ─── Tokens ──────────────────────────────────────────────────────────────

const b64url = (data) => Buffer.from(data).toString('base64url');
const mac = (body) => createHmac('sha256', API_KEY).update(body).digest();

function sign(payload) {
  const body = b64url(
    JSON.stringify({
      ...payload,
      e: Math.floor(Date.now() / 1000) + TOKEN_TTL_S,
    }),
  );
  return `${body}.${b64url(mac(body))}`;
}

function verify(token) {
  const [body, signature, ...rest] = String(token ?? '').split('.');
  if (!body || !signature || rest.length) return null;
  const given = Buffer.from(signature, 'base64url');
  const wanted = mac(body);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted))
    return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.e > Date.now() / 1000 ? payload : null;
  } catch {
    return null;
  }
}

function authorised(req) {
  const given = Buffer.from(
    (req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''),
  );
  const wanted = Buffer.from(API_KEY);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

// ─── The server ──────────────────────────────────────────────────────────

class Problem extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Disposition',
};

function json(res, status, body) {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, {
    ...CORS,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

let jobs = 0;
let relays = 0;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://backend');
  try {
    if (url.pathname === '/health' || url.pathname === '/')
      return json(res, 200, { ok: true });
    if (url.pathname === '/bunkr' && req.method === 'POST')
      return await bunkrList(req, res);
    if (url.pathname === '/file' && req.method === 'GET')
      return await file(req, res, url);
    json(res, 404, { error: 'Not found' });
  } catch (error) {
    if (!(error instanceof Problem)) console.error(error);
    json(res, error instanceof Problem ? error.status : 500, {
      error:
        error instanceof Problem
          ? error.message
          : 'The download backend ran into a problem.',
    });
  }
});
server.listen(PORT, () => console.log(`download backend on :${PORT}`));

// ─── GET /file ───────────────────────────────────────────────────────────

async function file(req, res, url) {
  const token = verify(url.searchParams.get('t'));
  if (!token)
    throw new Problem(
      403,
      'That download link has expired. Look the file up again.',
    );
  // Stops whatever is running for this request if the browser goes away.
  const gone = new AbortController();
  res.on('close', () => gone.abort());
  if (token.k === 'v') return sendVideo(res, token, gone.signal);
  if (token.k === 'b') return sendBunkr(res, token, gone.signal);
  throw new Problem(400, 'Unknown kind of download.');
}

async function sendVideo(res, token, signal) {
  const ref = detectVideo(token.u);
  if (!ref || ref.error || !FORMATS[token.f])
    throw new Problem(400, 'That isn’t a video link the backend takes.');
  if (jobs >= MAX_JOBS)
    throw new Problem(
      429,
      'The download backend is busy with other videos. Try again in a minute.',
    );
  jobs++;
  const dir = await mkdtemp(path.join(tmpdir(), 'dl-'));
  try {
    const { code, stdout, stderr } = await run(
      YTDLP,
      ytdlpArgs(token.f, dir, ref.url),
      { signal, timeout: YTDLP_TIMEOUT_MS },
    );
    if (signal.aborted) return;
    const name = (await readdir(dir)).find((n) => !n.endsWith('.part'));
    if (code !== 0 || !name) {
      const said = `${stderr}\n${stdout}`;
      const known = YTDLP_ERRORS.find(([pattern]) => pattern.test(said));
      if (known) throw new Problem(known[1], known[2]);
      console.error(`yt-dlp failed (${code}) for ${ref.url}\n${stderr}`);
      const line = stderr.match(/ERROR:\s*(?:\[[^\]]+\]\s*)?(?:\S+:\s*)?(.+)/);
      throw new Problem(
        502,
        `The download backend couldn’t get that video${line ? ` (${line[1].trim().slice(0, 160)})` : ''}.`,
      );
    }
    const full = path.join(dir, name);
    const { size } = await stat(full);
    if (size > MAX_BYTES)
      throw new Problem(413, 'That video is too big for the download backend.');
    const ext = path.extname(name).slice(1).toLowerCase();
    const title = stdout.split('\n')[0].trim();
    res.writeHead(200, {
      ...CORS,
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': size,
      'Content-Disposition': attachment(fileName(title, ref.id, ext)),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    await pipeline(createReadStream(full), res).catch(() => {});
  } finally {
    jobs--;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function sendBunkr(res, token, signal) {
  if (
    typeof token.h !== 'string' ||
    !detectBunkr(`https://${token.h}/a/x`)?.url ||
    !/^[\w-]{1,64}$/.test(String(token.i))
  )
    throw new Problem(400, 'That isn’t a Bunkr file.');
  if (relays >= MAX_RELAYS)
    throw new Problem(
      429,
      'The download backend is busy. Try again in a minute.',
    );
  relays++;
  try {
    const found = await bunkr(['file', token.h, String(token.i)], signal);
    const target = publicHttps(found.url);
    if (!target)
      throw new Problem(502, 'Bunkr sent the file somewhere unexpected.');
    const headers = { 'User-Agent': BROWSER_UA };
    for (const [key, value] of Object.entries(found.headers ?? {}))
      if (/^(referer|origin)$/i.test(key) && typeof value === 'string')
        headers[key] = value;
    let upstream;
    try {
      // eslint-disable-next-line warp-drive/no-external-request-patterns, n/no-unsupported-features/node-builtins -- the backend fetching a file from Bunkr; it runs on Node 22 (backend/Dockerfile)
      upstream = await fetch(target, { headers, signal });
    } catch {
      if (signal.aborted) return;
      throw new Problem(502, 'Bunkr’s file server couldn’t be reached.');
    }
    const type = (upstream.headers.get('content-type') ?? '').split(';')[0];
    // A page instead of a file is Bunkr's "under maintenance" or an error.
    if (!upstream.ok || type === 'text/html' || /maint/.test(upstream.url)) {
      await upstream.body?.cancel().catch(() => {});
      throw new Problem(
        502,
        upstream.status === 404
          ? 'Bunkr no longer has that file.'
          : 'Bunkr’s file server wouldn’t hand that file over. It may be under maintenance: try again later.',
      );
    }
    const name = String(token.n || 'file');
    const ext = path.extname(name).slice(1).toLowerCase();
    const length = upstream.headers.get('content-length');
    res.writeHead(200, {
      ...CORS,
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      ...(length ? { 'Content-Length': length } : {}),
      'Content-Disposition': attachment(name),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    // eslint-disable-next-line n/no-unsupported-features/node-builtins -- runs on Node 22 (backend/Dockerfile)
    await pipeline(Readable.fromWeb(upstream.body), res).catch(() => {});
  } finally {
    relays--;
  }
}

// ─── POST /bunkr ─────────────────────────────────────────────────────────

async function bunkrList(req, res) {
  if (!authorised(req)) throw new Problem(401, 'Unauthorised');
  const body = await readJson(req);
  const link = detectBunkr(body.url);
  if (!link || link.error)
    throw new Problem(400, link?.error ?? 'Paste a Bunkr link.');
  const gone = new AbortController();
  res.on('close', () => gone.abort());
  const found = await bunkr(['list', link.url], gone.signal);
  const host = detectBunkr(`https://${found.host}/a/x`)?.host ?? link.host;
  const base = publicBase(req);
  const files = (found.files ?? [])
    .filter((f) => /^[\w-]{1,64}$/.test(String(f.id)))
    .map((f) => {
      const name = safeName(f.name) || `file-${f.id}`;
      return {
        name,
        size: Number(f.size) || null,
        type: kindOf(name),
        url: `${base}/file?t=${sign({ k: 'b', h: host, i: String(f.id), n: name })}`,
      };
    });
  if (!files.length)
    throw new Problem(
      404,
      link.kind === 'album'
        ? 'That Bunkr album is empty, or no longer exists.'
        : 'That Bunkr file no longer exists.',
    );
  json(res, 200, {
    kind: link.kind,
    title: String(found.title ?? '').slice(0, 200),
    url: link.url,
    files,
  });
}

// Runs bunkr.py, which answers with one line of JSON either way.
async function bunkr(args, signal) {
  const { stdout, stderr } = await run(PYTHON, [BUNKR_PY, ...args], {
    signal,
    timeout: 60000,
  });
  let answer = null;
  try {
    answer = JSON.parse(stdout.trim().split('\n').pop());
  } catch {
    // not JSON: the script itself fell over
  }
  if (!answer || answer.error) {
    const why = `${answer?.error ?? ''}\n${stderr}`;
    console.error(`bunkr.py ${args[0]} failed: ${why.trim().slice(0, 500)}`);
    if (/CF challenge|403|challenge/i.test(why))
      throw new Problem(
        502,
        'Bunkr is putting a browser check in front of the download backend right now. Try again later.',
      );
    if (/404|deleted|not found/i.test(why))
      throw new Problem(404, 'Bunkr no longer has that.');
    throw new Problem(
      502,
      'Bunkr didn’t answer the download backend properly.',
    );
  }
  return answer;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

// Runs a program to the end, keeping what it printed (the tail of it, if it
// printed a lot). Killed if the request goes away or it takes too long.
function run(command, args, { signal, timeout }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    const out = { stdout: '', stderr: '' };
    for (const name of ['stdout', 'stderr'])
      child[name].on('data', (chunk) => {
        out[name] = (out[name] + chunk).slice(-64 * 1024);
      });
    const stop = () => child.kill('SIGKILL');
    const timer = setTimeout(stop, timeout);
    signal?.addEventListener('abort', stop, { once: true });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      resolve({ code, ...out });
    });
  });
}

async function readJson(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 4096) throw new Problem(413, 'Too much data');
  }
  try {
    const body = JSON.parse(text);
    if (body && typeof body === 'object') return body;
  } catch {
    // fall through
  }
  throw new Problem(400, 'Expected JSON');
}

// Where the browser reaches this server, for the links /bunkr hands out.
function publicBase(req) {
  const set = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (set) return set.replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] ?? 'http';
  return `${proto}://${req.headers.host}`;
}

// An https address on a named public host: never an IP, a port or a login.
function publicHttps(value) {
  try {
    const u = new URL(value);
    const host = u.hostname;
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.port ||
      !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) ||
      /^[\d.]+$/.test(host) ||
      /\.(local|internal|localhost)$/i.test(host)
    )
      return null;
    return u.href;
  } catch {
    return null;
  }
}

const MIME = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  opus: 'audio/ogg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  zip: 'application/zip',
  pdf: 'application/pdf',
};

const kindOf = (name) => {
  const type = MIME[path.extname(name).slice(1).toLowerCase()] ?? '';
  return type.startsWith('video/')
    ? 'video'
    : type.startsWith('audio/')
      ? 'audio'
      : type.startsWith('image/')
        ? 'photo'
        : 'file';
};

const safeName = (name) =>
  String(name ?? '')
    .replace(/[/\\?%*:|"<>\p{Cc}]/gu, '_')
    .trim()
    .slice(0, 150);

// A name that is safe on every OS: the title's words, then the id.
function fileName(title, id, ext) {
  const words = String(title ?? '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} '_-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
  const tail = /^[\w-]{1,40}$/.test(id) ? id : 'video';
  return `${words ? `${words} - ` : ''}${tail}.${ext}`;
}

const attachment = (name) =>
  `attachment; filename="${name.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
