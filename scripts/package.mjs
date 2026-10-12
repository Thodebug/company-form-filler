// Builds dist/firefox and dist/chromium from the same code. Only manifest.json
// differs: Firefox takes "menus" and background.scripts, Chromium takes
// "contextMenus" and the service worker.
// Usage: npm run build
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const sourceDir = `${rootDir}extension`;
const distDir = `${rootDir}dist`;
const source = JSON.parse(readFileSync(`${sourceDir}/manifest.json`, 'utf8'));

/**
 * @param {Record<string, unknown>} manifest
 * @param {string[]} keys
 */
function without(manifest, keys) {
  return Object.fromEntries(Object.entries(manifest).filter(([key]) => !keys.includes(key)));
}

const targets = {
  firefox: {
    ...without(source, ['minimum_chrome_version']),
    permissions: source.permissions.filter((/** @type {string} */ name) => name !== 'contextMenus'),
    background: { scripts: source.background.scripts },
  },
  chromium: {
    ...without(source, ['browser_specific_settings']),
    permissions: source.permissions.filter((/** @type {string} */ name) => name !== 'menus'),
    background: { service_worker: source.background.service_worker },
  },
};

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir);

for (const [target, manifest] of Object.entries(targets)) {
  const targetDir = `${distDir}/${target}`;
  cpSync(sourceDir, targetDir, { recursive: true });
  writeFileSync(`${targetDir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  const filename = `company-form-filler-${target}-${source.version}.zip`;
  execFileSync(
    process.execPath,
    [
      `${rootDir}node_modules/web-ext/bin/web-ext.js`,
      'build',
      '--source-dir',
      targetDir,
      '--artifacts-dir',
      distDir,
      '--filename',
      filename,
      '--overwrite-dest',
    ],
    { stdio: 'inherit' },
  );
  console.log(`dist/${filename}`);
}
