import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, it } from 'node:test';
import { CONTENT_SCRIPTS, loadPage, readProjectFile, rootDir } from './helpers.js';

const manifest = JSON.parse(readProjectFile('extension/manifest.json'));
const packageJson = JSON.parse(readProjectFile('package.json'));
const messages = JSON.parse(readProjectFile('extension/_locales/fr/messages.json'));

/**
 * @param {string} directory Absolute path.
 * @param {(name: string) => boolean} keep
 * @returns {string[]} Absolute paths.
 */
function listFiles(directory, keep) {
  /** @type {string[]} */
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = `${directory}/${name}`;
    if (statSync(path).isDirectory()) {
      if (!['.git', 'node_modules', 'dist'].includes(name)) {
        files.push(...listFiles(path, keep));
      }
    } else if (keep(name)) {
      files.push(path);
    }
  }
  return files;
}

const extensionSources = listFiles(`${rootDir}extension`, (name) => /\.(js|html)$/.test(name)).map(
  (path) => readFileSync(path, 'utf8'),
);

describe('manifest', () => {
  it('has the same version as package.json', () => {
    assert.equal(manifest.version, packageJson.version);
  });

  it('keeps the gecko id of version 1, so that AMO users get the update', () => {
    assert.equal(
      manifest.browser_specific_settings.gecko.id,
      'siret-form-filler@thodebug.github.io',
    );
  });

  it('keeps the description within the Chrome Web Store limit of 132 characters', () => {
    assert.ok(messages.extDescription.message.length <= 132);
  });

  it('points to existing scripts, pages and icons', () => {
    const files = [
      ...manifest.content_scripts.flatMap((/** @type {{ js: string[] }} */ entry) => entry.js),
      ...manifest.background.scripts,
      manifest.background.service_worker,
      manifest.action.default_popup,
      ...Object.values(manifest.icons),
      ...Object.values(manifest.action.default_icon),
    ];
    for (const file of files) {
      assert.ok(existsSync(`${rootDir}extension/${file}`), `missing ${file}`);
    }
    for (const page of ['popup/popup.html', 'viewer/viewer.html']) {
      const html = readProjectFile(`extension/${page}`);
      for (const [, reference] of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) {
        const resolved = new URL(reference, `file:///extension/${page}`).pathname.replace(
          '/extension/',
          '',
        );
        assert.ok(existsSync(`${rootDir}extension/${resolved}`), `${page}: missing ${reference}`);
      }
    }
  });

  it('lists the background scripts in the order the service worker imports them', () => {
    const worker = readProjectFile('extension/background/background.js');
    const imported = [...worker.matchAll(/'\/([\w/-]+\.js)'/g)].map((match) => match[1]);
    assert.deepEqual([...imported, 'background/background.js'], manifest.background.scripts);
  });

  it('ships icons at their declared size', () => {
    for (const [size, file] of Object.entries(manifest.icons)) {
      const png = readFileSync(`${rootDir}extension/${file}`);
      assert.equal(png.readUInt32BE(16), Number(size), `${file} width`);
      assert.equal(png.readUInt32BE(20), Number(size), `${file} height`);
    }
  });

  it('declares that no data is collected and asks for no more than menus and storage', () => {
    assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions, {
      required: ['none'],
    });
    assert.deepEqual(manifest.permissions, ['menus', 'contextMenus', 'storage']);
    assert.equal(manifest.host_permissions, undefined);
  });
});

describe('locale messages', () => {
  it('has every message used by the code and the pages', () => {
    const used = new Set();
    for (const source of extensionSources) {
      for (const match of source.matchAll(/\b(?:t|message|getMessage)\('(\w+)'/g)) {
        used.add(match[1]);
      }
      for (const match of source.matchAll(/data-i18n(?:-title|-placeholder)?="(\w+)"/g)) {
        used.add(match[1]);
      }
    }
    for (const match of JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)) {
      used.add(match[1]);
    }
    assert.ok(used.size > 40);
    for (const key of used) {
      assert.ok(messages[key], `missing message ${key}`);
    }
  });

  it('names every field type in the menu and the banner', () => {
    const vocab = loadPage('', { scripts: ['vocab/fr.js'] }).get('CffVocab');
    for (const type of [
      ...vocab.TYPES.map((/** @type {{ id: string }} */ entry) => entry.id),
      'managerEmail',
    ]) {
      assert.ok(messages[`type_${type}`], `missing type_${type}`);
    }
  });

  it('labels every value and section of the viewer', () => {
    const viewer = readProjectFile('extension/viewer/viewer.js');
    const groups = [...viewer.matchAll(/group: '(\w+)'/g)].map((match) => match[1]);
    assert.equal(groups.length, 8);
    for (const group of groups) {
      assert.ok(messages[`group_${group}`], `missing group_${group}`);
    }
    const sections = viewer.split(/group: '/).slice(1);
    for (const section of sections) {
      const group = section.slice(0, section.indexOf("'"));
      for (const [, key] of section.matchAll(/\{ key: '(\w+)'/g)) {
        assert.ok(messages[`field_${group}_${key}`], `missing field_${group}_${key}`);
      }
    }
  });
});

describe('data', () => {
  const data = (/** @type {string} */ name) =>
    JSON.parse(readProjectFile(`extension/data/fr/${name}.json`));

  it('has communes for every department, with valid rows', () => {
    const departments = data('departments');
    assert.equal(departments.length, 101);
    for (const department of departments) {
      const rows = data(`communes/${department.code}`);
      assert.ok(rows.length > 0, department.code);
      for (const [code, name, postal, population, latitude, longitude] of rows) {
        assert.match(code, /^(\d{5}|2[AB]\d{3})$/);
        assert.ok(name.length > 0);
        for (const postalCode of [postal].flat()) {
          assert.match(postalCode, /^\d{5}$/);
        }
        assert.ok(population > 0);
        assert.ok(
          latitude > -25 && latitude < 52 && longitude > -62 && longitude < 56,
          `${code} ${latitude} ${longitude}`,
        );
      }
      assert.match(department.phoneZone, /^0[1-5]$/);
    }
  });

  it('has valid NAF entries for every activity family of the legal forms', () => {
    const naf = data('naf');
    const families = new Set(naf.map((/** @type {{ family: string }} */ entry) => entry.family));
    for (const entry of naf) {
      assert.match(entry.code, /^\d{2}\.\d{2}[G-LY]$/, entry.code);
      assert.match(entry.rev2, /^\d{2}\.\d{2}[A-Z]$/, entry.rev2);
      assert.ok(entry.label && entry.rev2Label && entry.trades.length > 0, entry.code);
    }
    for (const form of data('legal-forms')) {
      for (const family of form.families) {
        assert.ok(families.has(family), `${form.key}: no NAF for ${family}`);
      }
    }
  });

  it('keeps names unique and free of forbidden words', () => {
    const words = data('words');
    const forbidden = new Set(words.forbidden);
    const naf = data('naf');
    for (const trade of naf.flatMap((/** @type {{ trades: string[] }} */ entry) => entry.trades)) {
      for (const word of trade.split(/[ '-]+/)) {
        assert.ok(!forbidden.has(word), trade);
      }
    }
    const names = data('last-names');
    assert.equal(new Set(names).size, names.length);
    for (const name of names) {
      assert.ok(!forbidden.has(name.toUpperCase()), name);
    }
    const firstNames = data('first-names');
    assert.ok(firstNames.female.length >= 100 && firstNames.male.length >= 100);
  });

  it('uses fictitious bank codes and BICs', () => {
    for (const bank of data('banks')) {
      assert.match(bank.bankCode, /^99\d{3}$/);
      assert.match(bank.bic, /^Z[A-Z]{3}FRPP$/);
    }
  });
});

describe('budgets', () => {
  it('keeps the content scripts under 80 KB', () => {
    const size = CONTENT_SCRIPTS.reduce(
      (total, file) => total + statSync(`${rootDir}extension/${file}`).size,
      0,
    );
    assert.ok(size <= 80 * 1024, `${size} bytes`);
  });

  it('keeps the communes under 1.5 MB compressed', () => {
    const directory = `${rootDir}extension/data/fr/communes`;
    const compressed = readdirSync(directory).reduce(
      (total, name) => total + gzipSync(readFileSync(`${directory}/${name}`)).length,
      0,
    );
    assert.ok(compressed <= 1.5 * 1024 * 1024, `${compressed} bytes`);
  });
});

describe('repository text', () => {
  const FORBIDDEN = [0x2014, 0x2013, 0x00b7].map((code) => String.fromCharCode(code));
  const TEXT_FILES = /\.(js|mjs|json|md|html|css|svg|yml|yaml|txt|d\.ts)$|^(LICENSE|\.\w+)$/;

  it('never uses em dashes, en dashes or middle dots', () => {
    for (const file of listFiles(rootDir.replace(/\/$/, ''), (name) => TEXT_FILES.test(name))) {
      const content = readFileSync(file, 'utf8');
      for (const char of FORBIDDEN) {
        assert.ok(
          !content.includes(char),
          `${file} contains U+${char.charCodeAt(0).toString(16).toUpperCase()}`,
        );
      }
    }
  });
});
