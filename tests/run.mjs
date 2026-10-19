// `npm test` runs this after `vite build --mode test`: it serves dist/, opens
// dist/tests/index.html in headless Chrome, prints each QUnit result as TAP,
// and exits non-zero if any test fails.
//
// Chrome: set CHROME_PATH, or it looks in the usual install places.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const TIMEOUT_MS = 15 * 60 * 1000;

const CHROMES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
};

// Static files from dist/, read-only, and never outside it.
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(DIST, url.endsWith('/') ? `${url}index.html` : url);
  if (
    !file.startsWith(DIST) ||
    !fs.existsSync(file) ||
    fs.statSync(file).isDirectory()
  ) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
  });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

const executablePath = CHROMES.find((p) => fs.existsSync(p));
if (!executablePath) {
  server.close();
  throw new Error(
    'No Chrome found. Set CHROME_PATH to a Chrome or Chromium binary.',
  );
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: [
    // --no-sandbox is needed when running Chrome inside a container
    process.env.CI ? '--no-sandbox' : null,
    '--disable-dev-shm-usage',
    // CI runners have no GPU, so WebGL has to come from SwiftShader.
    // Do not add --disable-software-rasterizer: it turns SwiftShader off,
    // and the shader tests then fail with "no WebGL2" on CI.
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--mute-audio',
    '--window-size=1440,900',
  ].filter(Boolean),
});

let count = 0;
let failed = 0;
let ended;
const done = new Promise((resolve) => (ended = resolve));

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
// tests/test-helper.js calls these from QUnit's testEnd and runEnd events.
await page.exposeFunction('reportTest', (test) => {
  count++;
  const name = `${test.module} | ${test.name}`;
  if (test.status === 'failed') {
    failed++;
    console.log(`not ok ${count} ${name}`);
    for (const error of test.errors)
      console.log(`    # ${error.replace(/\n/g, '\n    # ')}`);
  } else if (test.status === 'skipped')
    console.log(`ok ${count} ${name} # skip`);
  else console.log(`ok ${count} ${name}`);
});
await page.exposeFunction('reportEnd', () => ended());
page.on('pageerror', (error) => console.log(`# page error: ${error.message}`));
await page.goto(`http://127.0.0.1:${port}/tests/index.html`);

const timer = setTimeout(() => {
  console.log(
    `not ok ${count + 1} the run did not finish in ${TIMEOUT_MS / 60000} minutes`,
  );
  failed++;
  ended();
}, TIMEOUT_MS);

await done;
clearTimeout(timer);
console.log(
  `\n1..${count}\n# tests ${count}\n# pass  ${count - failed}\n# fail  ${failed}`,
);
await browser.close();
server.close();
process.exitCode = failed || !count ? 1 : 0;
