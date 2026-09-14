import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Files above this are only cached once a tool loads them (the background
// remover's ONNX runtime and ImageMagick are ~23 MB and ~14 MB on their own).
const PRECACHE_LIMIT = 5 * 1024 * 1024;
// Deploy-host config, not something the page ever requests.
const SKIP = new Set(['/sw.js', '/_headers', '/_redirects']);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])));
  return nested.flat();
}

// After `vite build`, fingerprints the whole output and writes dist/sw.js from
// lib/service-worker.js. The build ID is a hash of every file's contents, so
// it changes exactly when something a visitor would download has changed.
export default function offline() {
  let outDir;
  return {
    name: 'woogi-offline',
    apply: 'build',
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    async closeBundle() {
      const files = [];
      const hash = createHash('sha256');
      for (const path of (await walk(outDir)).sort()) {
        const url = `/${relative(outDir, path).split(sep).join('/')}`;
        if (SKIP.has(url) || url.endsWith('.map')) continue;
        const [contents, info] = await Promise.all([readFile(path), stat(path)]);
        hash.update(url).update(contents);
        files.push({ url, size: info.size });
      }
      const buildId = hash.digest('hex').slice(0, 12);

      // The page reads the build ID from this meta tag to show which version is running.
      const indexPath = join(outDir, 'index.html');
      const html = await readFile(indexPath, 'utf8');
      await writeFile(indexPath, html.replace('</head>', `  <meta name="woogi-build" content="${buildId}">\n  </head>`));

      const template = await readFile(fileURLToPath(new URL('./service-worker.js', import.meta.url)), 'utf8');
      const precache = files.filter((f) => f.size <= PRECACHE_LIMIT).map((f) => f.url);
      const sw = template
        .replace("'__BUILD_ID__'", JSON.stringify(buildId))
        .replace('__PRECACHE__', JSON.stringify(precache))
        .replace('__ALL_FILES__', JSON.stringify(files.map((f) => f.url)));
      await writeFile(join(outDir, 'sw.js'), sw);

      const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
      const precacheBytes = files.filter((f) => f.size <= PRECACHE_LIMIT).reduce((sum, f) => sum + f.size, 0);
      console.log(`\n[woogi-offline] build ${buildId}: precaching ${precache.length}/${files.length} files (${mb(precacheBytes)} MB)`);
    },
  };
}
