// Counts lines of code the way cloc (https://github.com/AlDanial/cloc) does:
// every physical line in a file is either blank, a comment, or code, counted
// per language. There's no server here to run cloc's own Perl script or
// clone the repository into, so this is a from-scratch JavaScript port of
// its counting method: read each file GitHub already has a copy of and run
// the same blank/comment/code state machine cloc's language database
// describes, file by file, entirely in the browser.
//
// It knows fewer languages than cloc and, like most single-pass line
// counters, doesn't understand string literals (so a `//` inside a string
// is misread as a comment); cloc's own database is more careful about that.
// For the everyday case of "how big is this codebase" it lands close.

// Extension -> language rules. `line` is an array of tokens that start a
// line comment; `block` is an array of [start, end] token pairs.
const LANGUAGES = {
  js: { name: 'JavaScript', line: ['//'], block: [['/*', '*/']] },
  mjs: { name: 'JavaScript', line: ['//'], block: [['/*', '*/']] },
  cjs: { name: 'JavaScript', line: ['//'], block: [['/*', '*/']] },
  jsx: { name: 'JavaScript (JSX)', line: ['//'], block: [['/*', '*/']] },
  ts: { name: 'TypeScript', line: ['//'], block: [['/*', '*/']] },
  tsx: { name: 'TypeScript (TSX)', line: ['//'], block: [['/*', '*/']] },
  gjs: { name: 'Ember (GJS)', line: ['//'], block: [['/*', '*/']] },
  gts: { name: 'Ember (GTS)', line: ['//'], block: [['/*', '*/']] },
  vue: { name: 'Vue', block: [['<!--', '-->']] },
  svelte: { name: 'Svelte', block: [['<!--', '-->']] },
  py: { name: 'Python', line: ['#'] },
  pyw: { name: 'Python', line: ['#'] },
  rb: { name: 'Ruby', line: ['#'], block: [['=begin', '=end']] },
  java: { name: 'Java', line: ['//'], block: [['/*', '*/']] },
  kt: { name: 'Kotlin', line: ['//'], block: [['/*', '*/']] },
  kts: { name: 'Kotlin', line: ['//'], block: [['/*', '*/']] },
  scala: { name: 'Scala', line: ['//'], block: [['/*', '*/']] },
  groovy: { name: 'Groovy', line: ['//'], block: [['/*', '*/']] },
  gradle: { name: 'Groovy', line: ['//'], block: [['/*', '*/']] },
  c: { name: 'C', line: ['//'], block: [['/*', '*/']] },
  h: { name: 'C/C++ Header', line: ['//'], block: [['/*', '*/']] },
  cpp: { name: 'C++', line: ['//'], block: [['/*', '*/']] },
  cc: { name: 'C++', line: ['//'], block: [['/*', '*/']] },
  cxx: { name: 'C++', line: ['//'], block: [['/*', '*/']] },
  hpp: { name: 'C/C++ Header', line: ['//'], block: [['/*', '*/']] },
  cs: { name: 'C#', line: ['//'], block: [['/*', '*/']] },
  m: { name: 'Objective-C', line: ['//'], block: [['/*', '*/']] },
  mm: { name: 'Objective-C++', line: ['//'], block: [['/*', '*/']] },
  go: { name: 'Go', line: ['//'], block: [['/*', '*/']] },
  rs: { name: 'Rust', line: ['//'], block: [['/*', '*/']] },
  swift: { name: 'Swift', line: ['//'], block: [['/*', '*/']] },
  dart: { name: 'Dart', line: ['//'], block: [['/*', '*/']] },
  php: { name: 'PHP', line: ['//', '#'], block: [['/*', '*/']] },
  sol: { name: 'Solidity', line: ['//'], block: [['/*', '*/']] },
  zig: { name: 'Zig', line: ['//'] },
  sh: { name: 'Shell', line: ['#'] },
  bash: { name: 'Shell', line: ['#'] },
  zsh: { name: 'Shell', line: ['#'] },
  fish: { name: 'Shell', line: ['#'] },
  ps1: { name: 'PowerShell', line: ['#'], block: [['<#', '#>']] },
  psm1: { name: 'PowerShell', line: ['#'], block: [['<#', '#>']] },
  bat: { name: 'Batch', line: ['REM', '::'] },
  cmd: { name: 'Batch', line: ['REM', '::'] },
  pl: { name: 'Perl', line: ['#'] },
  pm: { name: 'Perl', line: ['#'] },
  lua: { name: 'Lua', line: ['--'], block: [['--[[', ']]']] },
  hs: { name: 'Haskell', line: ['--'], block: [['{-', '-}']] },
  ex: { name: 'Elixir', line: ['#'] },
  exs: { name: 'Elixir', line: ['#'] },
  erl: { name: 'Erlang', line: ['%'] },
  clj: { name: 'Clojure', line: [';'] },
  cljs: { name: 'Clojure', line: [';'] },
  vim: { name: 'Vim script', line: ['"'] },
  fs: { name: 'F#', line: ['//'], block: [['(*', '*)']] },
  fsx: { name: 'F#', line: ['//'], block: [['(*', '*)']] },
  ml: { name: 'OCaml', block: [['(*', '*)']] },
  mli: { name: 'OCaml', block: [['(*', '*)']] },
  asm: { name: 'Assembly', line: [';'] },
  s: { name: 'Assembly', line: [';'] },
  f: { name: 'Fortran', line: ['!'] },
  f90: { name: 'Fortran', line: ['!'] },
  jl: { name: 'Julia', line: ['#'], block: [['#=', '=#']] },
  nim: { name: 'Nim', line: ['#'], block: [['#[', ']#']] },
  r: { name: 'R', line: ['#'] },
  sql: { name: 'SQL', line: ['--'], block: [['/*', '*/']] },
  html: { name: 'HTML', block: [['<!--', '-->']] },
  htm: { name: 'HTML', block: [['<!--', '-->']] },
  xml: { name: 'XML', block: [['<!--', '-->']] },
  svg: { name: 'SVG', block: [['<!--', '-->']] },
  css: { name: 'CSS', block: [['/*', '*/']] },
  scss: { name: 'Sass (SCSS)', line: ['//'], block: [['/*', '*/']] },
  sass: { name: 'Sass', line: ['//'] },
  less: { name: 'Less', line: ['//'], block: [['/*', '*/']] },
  yml: { name: 'YAML', line: ['#'] },
  yaml: { name: 'YAML', line: ['#'] },
  toml: { name: 'TOML', line: ['#'] },
  ini: { name: 'INI', line: ['#', ';'] },
  cfg: { name: 'INI', line: ['#', ';'] },
  conf: { name: 'Config', line: ['#'] },
  json: { name: 'JSON' },
  jsonc: { name: 'JSON with comments', line: ['//'], block: [['/*', '*/']] },
  md: { name: 'Markdown' },
  markdown: { name: 'Markdown' },
  mdx: { name: 'Markdown', block: [['{/*', '*/}']] },
  rst: { name: 'reStructuredText' },
  adoc: { name: 'AsciiDoc' },
  txt: { name: 'Text' },
  graphql: { name: 'GraphQL', line: ['#'] },
  gql: { name: 'GraphQL', line: ['#'] },
  proto: { name: 'Protocol Buffers', line: ['//'], block: [['/*', '*/']] },
  tf: { name: 'Terraform', line: ['#', '//'], block: [['/*', '*/']] },
};

// Files with no useful extension, matched by exact name (case-insensitive).
const BY_FILENAME = {
  dockerfile: { name: 'Dockerfile', line: ['#'] },
  makefile: { name: 'Makefile', line: ['#'] },
  gnumakefile: { name: 'Makefile', line: ['#'] },
  rakefile: { name: 'Ruby', line: ['#'] },
  vagrantfile: { name: 'Ruby', line: ['#'] },
};

// Never worth reading: binaries, media, archives, and generated or
// vendored code that would only pad the count.
const SKIP_EXT = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'ico',
  'webp',
  'avif',
  'tif',
  'tiff',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  'mp3',
  'mp4',
  'wav',
  'avi',
  'mov',
  'webm',
  'ogg',
  'flac',
  'm4a',
  'zip',
  'tar',
  'gz',
  'tgz',
  '7z',
  'rar',
  'jar',
  'war',
  'ear',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'exe',
  'dll',
  'so',
  'dylib',
  'bin',
  'class',
  'pyc',
  'o',
  'a',
  'wasm',
  'lock',
  'map',
  'pdb',
  'ico',
  'icns',
]);

const SKIP_PATH =
  /(^|\/)(node_modules|vendor|dist|build|\.git|coverage|target|bower_components|\.next|\.nuxt|venv|\.venv|__pycache__|\.cache|out|obj|pods|\.yarn|\.pnpm-store)\//i;

const SKIP_NAME = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'composer.lock',
  'cargo.lock',
  'gemfile.lock',
  'poetry.lock',
  'go.sum',
]);

function extOf(path) {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

// The language rules for a file, or null if it should be skipped entirely.
export function languageOf(path) {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (SKIP_NAME.has(base)) return null;
  if (SKIP_PATH.test(path)) return null;
  if (/\.min\.(js|css)$/i.test(path)) return null;
  if (BY_FILENAME[base]) return BY_FILENAME[base];
  const ext = extOf(path);
  if (!ext) return null;
  if (SKIP_EXT.has(ext)) return null;
  return LANGUAGES[ext] ?? null;
}

// Classifies every physical line of one file's text as blank, comment or
// code, per the language's comment tokens.
export function countText(text, lang) {
  const lines = text.split('\n');
  let blank = 0;
  let comment = 0;
  let code = 0;
  let blockEnd = null;
  for (let raw of lines) {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();
    if (!trimmed) {
      blank++;
      continue;
    }
    if (blockEnd) {
      const at = line.indexOf(blockEnd);
      if (at === -1) {
        comment++;
        continue;
      }
      const after = line.slice(at + blockEnd.length).trim();
      blockEnd = null;
      if (after) code++;
      else comment++;
      continue;
    }
    const lineToken = lang.line?.find((t) => trimmed.startsWith(t));
    if (lineToken) {
      comment++;
      continue;
    }
    const block = lang.block?.find(([start]) => trimmed.startsWith(start));
    if (block) {
      const [start, end] = block;
      const at = trimmed.indexOf(end, start.length);
      if (at === -1) {
        comment++;
        blockEnd = end;
      } else {
        const after = trimmed.slice(at + end.length).trim();
        if (after) code++;
        else comment++;
      }
      continue;
    }
    code++;
  }
  return { code, comment, blank };
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function readFile({ owner, repo, ref, path }, token) {
  if (token) {
    // eslint-disable-next-line warp-drive/no-external-request-patterns -- GitHub's API, not app data
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
      {
        headers: {
          Accept: 'application/vnd.github.raw',
          Authorization: `Bearer ${token.trim()}`,
        },
      },
    );
    if (!response.ok) throw new Error(String(response.status));
    return response.text();
  }
  // eslint-disable-next-line warp-drive/no-external-request-patterns -- GitHub's raw content CDN, not app data
  const response = await fetch(
    `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${encodePath(path)}`,
  );
  if (!response.ok) throw new Error(String(response.status));
  return response.text();
}

// Reads and counts as much of a repository as is reasonable to pull into a
// browser tab, using the file list from a `git/trees?recursive=1` response.
// `onProgress({ done, total })` is called as files finish.
export async function clocRepo(
  { owner, repo, ref, tree },
  token,
  {
    onProgress,
    maxFiles = 3000,
    maxBytes = 20 * 1024 * 1024,
    concurrency = 8,
  } = {},
) {
  const blobs = (tree?.tree ?? []).filter((t) => t.type === 'blob');
  const candidates = [];
  for (const blob of blobs) {
    const lang = languageOf(blob.path);
    if (!lang) continue;
    if ((blob.size ?? 0) > 2 * 1024 * 1024) continue; // one huge file isn't worth it
    candidates.push({ ...blob, lang });
  }

  let bytesBudget = maxBytes;
  const toRead = [];
  for (const file of candidates) {
    if (toRead.length >= maxFiles || bytesBudget <= 0) break;
    toRead.push(file);
    bytesBudget -= file.size ?? 0;
  }

  const byLanguage = new Map();
  const bump = (name, part) => {
    const row = byLanguage.get(name) ?? {
      name,
      files: 0,
      code: 0,
      comment: 0,
      blank: 0,
    };
    row.files++;
    row.code += part.code;
    row.comment += part.comment;
    row.blank += part.blank;
    byLanguage.set(name, row);
  };

  let done = 0;
  let failed = 0;
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= toRead.length) return;
      const file = toRead[index];
      try {
        const text = await readFile(
          { owner, repo, ref, path: file.path },
          token,
        );
        bump(file.lang.name, countText(text, file.lang));
      } catch {
        failed++;
      }
      done++;
      onProgress?.({ done, total: toRead.length });
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, toRead.length) }, worker),
  );

  const languages = [...byLanguage.values()].sort((a, b) => b.code - a.code);
  const total = languages.reduce(
    (t, l) => ({
      files: t.files + l.files,
      code: t.code + l.code,
      comment: t.comment + l.comment,
      blank: t.blank + l.blank,
    }),
    { files: 0, code: 0, comment: 0, blank: 0 },
  );

  return {
    languages,
    total,
    failed,
    skipped: candidates.length - toRead.length,
    truncated: candidates.length > toRead.length || Boolean(tree?.truncated),
  };
}
