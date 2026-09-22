import { defineConfig } from 'vite';
import { extensions, classicEmberSupport, ember } from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';
import { fileURLToPath } from 'node:url';
import offline from './lib/offline-plugin.mjs';
import devApi from './lib/dev-api-plugin.mjs';

export default defineConfig({
  plugins: [
    classicEmberSupport(),
    ember(),
    // extra plugins here
    devApi(),
    // Must stay after ember(): it fingerprints the finished build and writes dist/sw.js.
    offline(),
    babel({
      babelHelpers: 'runtime',
      extensions,
      // Do not be tempted to exclude node_modules here to save build time:
      // Ember addons ship `@embroider/macros` calls that only exist until a
      // Babel plugin replaces them, so skipping them builds an app that
      // throws "this method is really implemented at compile time" on boot.
    }),
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
});
