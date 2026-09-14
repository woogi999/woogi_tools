import { defineConfig } from 'vite';
import { extensions, classicEmberSupport, ember } from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';
import { fileURLToPath } from 'node:url';
import offline from './lib/offline-plugin.mjs';

export default defineConfig({
  plugins: [
    classicEmberSupport(),
    ember(),
    // extra plugins here
    // Must stay after ember(): it fingerprints the finished build and writes dist/sw.js.
    offline(),
    babel({
      babelHelpers: 'runtime',
      extensions,
    }),
  ],
  // Pre-bundling rewrites import.meta.url, which these libs use to locate their .wasm files.
  optimizeDeps: {
    exclude: ['brotli-wasm', '@bokuweb/zstd-wasm', '@imagemagick/magick-wasm', '7z-wasm', '@ffmpeg/ffmpeg', '@ffmpeg/util', 'pdfjs-dist', '@imgly/background-removal'],
  },
  resolve: {
    alias: {
      // pandoc-wasm only exports an entry that bundles its 55 MB binary; the
      // core loader lets the File Converter fetch that binary on demand instead.
      'pandoc-wasm-core': fileURLToPath(new URL('./node_modules/pandoc-wasm/src/core.js', import.meta.url)),
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
