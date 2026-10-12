// Renders assets/icon.svg to the extension PNGs and the site favicon.
// Usage: npm run icons
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const source = readFileSync(`${rootDir}assets/icon.svg`, 'utf8');
const SIZES = [16, 32, 48, 96, 128];

for (const size of SIZES) {
  const png = new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(`${rootDir}extension/icons/icon-${size}.png`, png);
  console.log(`extension/icons/icon-${size}.png`);
}
copyFileSync(`${rootDir}assets/icon.svg`, `${rootDir}site/favicon.svg`);
console.log('site/favicon.svg');
