/**
 * Debugging:
 *   https://eslint.org/docs/latest/use/configure/debug
 *  ----------------------------------------------------
 *
 *   Print a file's calculated configuration
 *
 *     npx eslint --print-config path/to/file.js
 *
 *   Inspecting the config
 *
 *     npx eslint --inspect-config
 *
 */
import globals from 'globals';
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import svelte from 'eslint-plugin-svelte';
import eslintConfigPrettier from 'eslint-config-prettier';
import qunit from 'eslint-plugin-qunit';
import n from 'eslint-plugin-n';

const esmParserOptions = {
  ecmaFeatures: { modules: true },
  ecmaVersion: 'latest',
};

export default defineConfig([
  globalIgnores([
    'dist/',
    'coverage/',
    '!**/.*',
    '.wrangler/',
    '.playwright-mcp/',
    'tmp/',
  ]),
  js.configs.recommended,
  ...svelte.configs.recommended,
  eslintConfigPrettier,
  ...svelte.configs.prettier,
  /**
   * https://eslint.org/docs/latest/use/configure/configuration-files#configuring-linter-options
   */
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  {
    files: ['**/*.{js,svelte,svelte.js}'],
    languageOptions: {
      parserOptions: esmParserOptions,
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // A leading underscore marks something deliberately unused: a parameter
      // kept to satisfy a signature, or a destructured key being skipped.
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.js'],
    languageOptions: {
      // Not svelte.config.mjs itself: its warning filter is a function, which
      // `eslint --cache` cannot store.
      parserOptions: {
        svelteConfig: { compilerOptions: { runes: true } },
      },
    },
    rules: {
      // The tools are a single-page app with their own router (app/core/router.svelte.js):
      // in-site links go through <Link>, and the plain <a> tags left are external.
      'svelte/no-navigation-without-resolve': 'off',
      // Markup comes from the site's own code (icons, the Markdown renderer,
      // generated SVG), never from a visitor, and each case is commented.
      'svelte/no-at-html-tags': 'off',
      // Most lists render by position. A key by identity would throw on a
      // list with a repeated value (two equal strings), so a key is given
      // only where it matters: a list that reorders around live state.
      'svelte/require-each-key': 'off',
      // The Maps, Sets and Dates kept on components are bookkeeping, not state
      // the page shows: anything shown is a $state.raw field that is replaced.
      'svelte/prefer-svelte-reactivity': 'off',
    },
  },
  /**
   * The effects catalogue. Every entry implements the same `render(v, col)`
   * signature -- the parameter values and the chosen colours -- and most
   * effects need only one of the two, so an unused parameter here is the
   * interface being honoured rather than something left behind.
   */
  {
    files: ['app/utils/ferrite/effects.js'],
    rules: {
      'no-unused-vars': ['error', { args: 'none' }],
    },
  },
  /**
   * Cloudflare Worker: the runtime's own globals on top of the browser ones.
   */
  {
    files: ['worker/**/*.js'],
    languageOptions: {
      globals: {
        WebSocketPair: 'readonly',
        DurableObject: 'readonly',
        HTMLRewriter: 'readonly',
      },
    },
  },
  /**
   * Service worker template: filled in at build time by lib/offline-plugin.mjs
   */
  {
    files: ['lib/service-worker.js'],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        __PRECACHE__: 'readonly',
        __ALL_FILES__: 'readonly',
      },
    },
  },
  {
    ...qunit.configs.recommended,
    files: ['tests/**/*-test.js'],
    plugins: {
      qunit,
    },
  },
  /**
   * CJS node files
   */
  {
    ...n.configs['flat/recommended-script'],
    files: ['**/*.cjs'],
    plugins: {
      n,
    },

    languageOptions: {
      sourceType: 'script',
      ecmaVersion: 'latest',
      globals: {
        ...globals.node,
      },
    },
  },
  /**
   * ESM node files
   */
  {
    ...n.configs['flat/recommended-module'],
    files: ['**/*.mjs'],
    plugins: {
      n,
    },

    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 'latest',
      parserOptions: esmParserOptions,
      globals: {
        ...globals.node,
      },
    },
  },
]);
