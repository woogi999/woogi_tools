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

import ember from 'eslint-plugin-ember/recommended';
import WarpDrive from 'eslint-plugin-warp-drive/recommended';
import eslintConfigPrettier from 'eslint-config-prettier';
import qunit from 'eslint-plugin-qunit';
import n from 'eslint-plugin-n';

import babelParser from '@babel/eslint-parser/experimental-worker';

const esmParserOptions = {
  ecmaFeatures: { modules: true },
  ecmaVersion: 'latest',
};

export default defineConfig([
  globalIgnores(['dist/', 'coverage/', '!**/.*', '.wrangler/']),
  js.configs.recommended,
  eslintConfigPrettier,
  ember.configs.base,
  ember.configs.gjs,
  ...WarpDrive,
  /**
   * https://eslint.org/docs/latest/use/configure/configuration-files#configuring-linter-options
   */
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      parser: babelParser,
    },
  },
  {
    files: ['**/*.{js,gjs}'],
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
  /**
   * Canvas drawing code. `ctx.save()` / `ctx.restore()` are the 2D context's
   * state stack, but warp-drive's rule reads any `.save()` as a record being
   * persisted through the legacy store API, which these files never touch.
   */
  {
    files: [
      'app/components/color-wheel.gjs',
      'app/utils/ferrite/gpu.js',
      'app/utils/ferrite/render.js',
    ],
    rules: {
      'warp-drive/no-legacy-request-patterns': 'off',
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
    rules: {
      'warp-drive/no-external-request-patterns': 'off',
    },
  },
  {
    ...qunit.configs.recommended,
    files: ['tests/**/*-test.{js,gjs}'],
    plugins: {
      qunit,
    },
  },
  /**
   * CJS node files
   */
  {
    ...n.configs['flat/recommended-script'],
    files: ['**/*.cjs', 'config/**/*.js'],
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
