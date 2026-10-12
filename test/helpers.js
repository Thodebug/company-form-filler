import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

export const rootDir = fileURLToPath(new URL('..', import.meta.url));

// Manifest order matters: the scripts share one global scope.
export const GENERATOR_SCRIPTS = [
  'generators/random.js',
  'generators/checksums.js',
  'generators/text.js',
  'generators/company.js',
  'background/data.js',
];

export const CONTENT_SCRIPTS = [
  'vocab/fr.js',
  'shared/format.js',
  'content/detection.js',
  'content/fill.js',
  'content/banner.js',
  'content/content.js',
];

export const CONTENT_LIBRARIES = CONTENT_SCRIPTS.filter((file) => file !== 'content/content.js');

/**
 * @param {string} relativePath
 * @returns {string}
 */
export function readProjectFile(relativePath) {
  return readFileSync(`${rootDir}${relativePath}`, 'utf8');
}

/**
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
 * @returns {CompanyDataSource}
 */
export function fileSource() {
  const { get } = loadScripts(['background/data.js']);
  return get('CffData').createSource(async (/** @type {string} */ path) =>
    JSON.parse(readProjectFile(`extension/data/fr/${path}.json`)),
  );
}

/**
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
  // vm.Script in jsdom's own context, not window.eval, so top-level consts are
  // shared between scripts as in a real frame.
  const context = dom.getInternalVMContext();
  for (const script of options.scripts || CONTENT_LIBRARIES) {
    new vm.Script(readProjectFile(`extension/${script}`), { filename: script }).runInContext(
      context,
    );
  }
  return {
    window: dom.window,
    get: (name) => new vm.Script(name).runInContext(context),
  };
}
