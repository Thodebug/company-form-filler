import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

export const rootDir = fileURLToPath(new URL('..', import.meta.url));

/** Scripts of the background that generate data, in manifest order. */
export const GENERATOR_SCRIPTS = [
  'generators/random.js',
  'generators/checksums.js',
  'generators/text.js',
  'generators/company.js',
  'background/data.js',
];

/** Content scripts, in manifest order. */
export const CONTENT_SCRIPTS = [
  'vocab/fr.js',
  'shared/format.js',
  'content/detection.js',
  'content/fill.js',
  'content/banner.js',
  'content/content.js',
];

/** Content scripts without the entry point, for unit tests. */
export const CONTENT_LIBRARIES = CONTENT_SCRIPTS.filter((file) => file !== 'content/content.js');

/**
 * @param {string} relativePath
 * @returns {string}
 */
export function readProjectFile(relativePath) {
  return readFileSync(`${rootDir}${relativePath}`, 'utf8');
}

/**
 * Runs extension scripts in a fresh context, as classic scripts sharing one
 * global scope, and returns an accessor for their globals.
 * @param {string[]} files Paths relative to extension/.
 * @param {Record<string, unknown>} [globals]
 * @returns {{ context: vm.Context, get: (name: string) => any }}
 */
export function loadScripts(files, globals = {}) {
  const context = vm.createContext({ crypto: globalThis.crypto, structuredClone, ...globals });
  for (const file of files) {
    vm.runInContext(readProjectFile(`extension/${file}`), context, { filename: file });
  }
  return { context, get: (name) => vm.runInContext(name, context) };
}

/**
 * Data source reading extension/data/fr from disk.
 * @returns {CompanyDataSource}
 */
export function fileSource() {
  const { get } = loadScripts(['background/data.js']);
  return get('CffData').createSource(async (/** @type {string} */ path) =>
    JSON.parse(readProjectFile(`extension/data/fr/${path}.json`)),
  );
}

/**
 * Builds a jsdom window with content scripts loaded, as they are in a frame.
 * @param {string} html
 * @param {{ scripts?: string[], url?: string }} [options]
 * @returns {{ window: import('jsdom').DOMWindow, get: (name: string) => any }}
 */
export function loadPage(html, options = {}) {
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: options.url || 'https://example.test/',
    pretendToBeVisual: true,
  });
  for (const script of options.scripts || CONTENT_LIBRARIES) {
    dom.window.eval(readProjectFile(`extension/${script}`));
  }
  return { window: dom.window, get: (name) => dom.window.eval(name) };
}
