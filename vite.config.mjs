import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import offline from './lib/offline-plugin.mjs';
import trackedFields from './lib/tracked-fields-plugin.mjs';
import devApi from './lib/dev-api-plugin.mjs';

export default defineConfig(({ mode }) => ({
  plugins: [
    svelte(),
    // After svelte(): class fields notify on every assignment, as in Ember.
    trackedFields(),
    devApi(),
    // Must stay last: it fingerprints the finished build and writes dist/sw.js.
    offline(),
  ],
  build: {
    // Rolldown's own minifier, rather than Terser. Back to back on the same
    // machine this build took 2m12s with Terser and 1m13s with Oxc, and the
    // Oxc output was 59 KB smaller, so there is nothing to trade away.
    minify: 'oxc',
    // Vite gzips every chunk just to print a size next to it. This build has
    // fifty of them and twenty megabytes of WebAssembly, and nothing reads the
    // numbers, so the compression is pure cost.
    reportCompressedSize: false,
    rollupOptions: {
      // `npm test` builds the test page (tests/index.html) next to the site.
      input:
        mode === 'test'
          ? { main: 'index.html', tests: 'tests/index.html' }
          : { main: 'index.html' },
    },
  },
  // Pre-bundling rewrites import.meta.url, which these libs use to locate their .wasm files.
  optimizeDeps: {
    exclude: [
      'brotli-wasm',
      '@bokuweb/zstd-wasm',
      '@imagemagick/magick-wasm',
      '7z-wasm',
      '@ffmpeg/ffmpeg',
      '@ffmpeg/util',
      'pdfjs-dist',
      '@imgly/background-removal',
    ],
  },
  resolve: {
    alias: {
      // pandoc-wasm only exports an entry that bundles its 55 MB binary; the
      // core loader lets the File Converter fetch that binary on demand instead.
      'pandoc-wasm-core': fileURLToPath(
        new URL('./node_modules/pandoc-wasm/src/core.js', import.meta.url),
      ),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        loadPaths: ['node_modules'],
      },
    },
  },
}));
