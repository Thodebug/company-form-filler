import js from '@eslint/js';
import globals from 'globals';

/** Globals each classic script of the extension defines for the others. */
const extensionGlobals = Object.fromEntries(
  [
    'CffRandom',
    'CffChecksums',
    'CffText',
    'CffCompany',
    'CffData',
    'CffStore',
    'CffTabs',
    'CffMenus',
    'CffVocab',
    'CffFormat',
    'CffDetection',
    'CffFill',
    'CffBanner',
    'CffPage',
  ].map((name) => [name, 'readonly']),
);

export default [
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  {
    files: ['extension/**/*.js', 'site/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.serviceworker,
        ...extensionGlobals,
      },
    },
    rules: {
      // Top-level constants are the modules other scripts use.
      'no-unused-vars': ['error', { vars: 'local', argsIgnorePattern: '^_' }],
      'no-redeclare': ['error', { builtinGlobals: false }],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'test/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    rules: {
      eqeqeq: 'error',
      'prefer-const': 'error',
    },
  },
];
