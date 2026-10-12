// Real background and content scripts wired to a fake extension API, on both
// the Firefox (menus.onShown) and Chromium (verdict pushed on right press) paths.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { CONTENT_SCRIPTS, readProjectFile } from './helpers.js';
import { isValidFrenchVat, isValidSiret } from './validators.js';

const manifest = JSON.parse(readProjectFile('extension/manifest.json'));
const messages = JSON.parse(readProjectFile('extension/_locales/fr/messages.json'));
const EXTENSION_ORIGIN = 'chrome-extension://cff/';
const TAB_ID = 7;
const VIEWER_TAB_ID = 99;
const VIEWER_URL = `${EXTENSION_ORIGIN}viewer/viewer.html`;

const ERP_PAGE = `<form id="supplier">
  <fieldset><legend>Identité</legend>
    <div><label for="name">Raison sociale</label><input id="name" value="old"></div>
    <div><label for="siret">N° SIRET</label><input id="siret"></div>
    <div><label for="vat">N° TVA</label><input id="vat"></div>
  </fieldset>
  <fieldset><legend>Adresse</legend>
    <div><label for="line1">Adresse</label><input id="line1"></div>
    <div><label for="zip">Code postal</label><input id="zip"></div>
    <div><label for="city">Ville</label><input id="city"></div>
  </fieldset>
</form>
<form id="newsletter"><label for="mail">Email</label><input id="mail"></form>
<div><label for="lonely">SIRET</label><input id="lonely"></div>`;

function flush(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} name
 * @param {string[]} [substitutions]
 */
function getMessage(name, substitutions) {
  const entry = messages[name];
  if (!entry) {
    return '';
  }
  let text = entry.message;
  for (const [placeholder, { content }] of Object.entries(entry.placeholders || {})) {
    const index = Number(/** @type {string} */ (content).slice(1)) - 1;
    text = text.replaceAll(`$${placeholder.toUpperCase()}$`, substitutions?.[index] ?? '');
  }
  return text;
}

function createArea() {
  /** @type {Map<string, unknown>} */
  const values = new Map();
  return {
    values,
    async get(/** @type {string | string[] | null | undefined} */ keys) {
      const list = keys === undefined || keys === null ? [...values.keys()] : [keys].flat();
      return Object.fromEntries(
        list.filter((key) => values.has(key)).map((key) => [key, structuredClone(values.get(key))]),
      );
    },
    async set(/** @type {Record<string, unknown>} */ items) {
      for (const [key, value] of Object.entries(items)) {
        values.set(key, structuredClone(value));
      }
    },
    async remove(/** @type {string | string[]} */ keys) {
      for (const key of [keys].flat()) {
        values.delete(key);
      }
    },
  };
}

/**
 * @param {{ firefox: boolean, incognito?: boolean }} options
 */
function createEnvironment({ firefox, incognito = false }) {
  /** @type {Record<string, Function[]>} */
  const listeners = {
    installed: [],
    startup: [],
    background: [],
    content: [],
    pages: [],
    clicked: [],
    shown: [],
    hidden: [],
  };
  /** @type {Map<string, Record<string, unknown>>} */
  const items = new Map();
  /** @type {Map<number, Element>} */
  const targets = new Map();
  const stats = { refreshes: 0, fromContent: 0 };
  /** @type {string[]} */
  const createdTabs = [];
  /** @type {Array<number | undefined>} */
  const createdInWindows = [];
  /** @type {Set<number>} */
  const closedTabs = new Set();
  const local = createArea();
  const session = createArea();
  const pageUrl = 'https://example.test/form';

  /** @param {Function[]} list */
  const event = (list) => ({ addListener: (/** @type {Function} */ fn) => list.push(fn) });

  /** @type {Record<string, any>} */
  const menus = {
    create(/** @type {Record<string, unknown>} */ properties, /** @type {Function} */ callback) {
      items.set(String(properties.id), { ...properties });
      callback?.();
    },
    async update(/** @type {string} */ id, /** @type {Record<string, unknown>} */ properties) {
      const item = items.get(id);
      if (!item) {
        throw new Error(`Cannot find menu item with id ${id}`);
      }
      Object.assign(item, properties);
    },
    async removeAll() {
      items.clear();
    },
    onClicked: event(listeners.clicked),
  };
  if (firefox) {
    menus.onShown = event(listeners.shown);
    menus.onHidden = event(listeners.hidden);
    menus.refresh = async () => {
      stats.refreshes++;
    };
    menus.getTargetElement = (/** @type {number} */ id) => targets.get(id) ?? null;
  }

  /**
   * @param {Function[]} list
   * @param {unknown} message
   * @param {Record<string, unknown>} sender
   */
  function deliver(list, message, sender) {
    return new Promise((resolve, reject) => {
      if (list.length === 0) {
        reject(new Error('Could not establish connection. Receiving end does not exist.'));
        return;
      }
      let answered = false;
      let pending = false;
      for (const fn of list) {
        const result = fn(message, sender, (/** @type {unknown} */ response) => {
          answered = true;
          resolve(response);
        });
        pending ||= result === true;
      }
      if (!answered && !pending) {
        resolve(undefined);
      }
    });
  }

  /**
   * @param {'background' | 'content' | 'page'} role
   */
  function createApi(role) {
    return {
      [firefox ? 'menus' : 'contextMenus']: menus,
      i18n: { getMessage },
      runtime: {
        lastError: undefined,
        getURL: (/** @type {string} */ path) => `${EXTENSION_ORIGIN}${path}`,
        onInstalled: event(listeners.installed),
        onStartup: event(listeners.startup),
        onMessage: event(
          role === 'background'
            ? listeners.background
            : role === 'content'
              ? listeners.content
              : listeners.pages,
        ),
        sendMessage(/** @type {unknown} */ message) {
          if (role === 'background') {
            return deliver(listeners.pages, message, { id: 'cff' });
          }
          if (role === 'content') {
            stats.fromContent++;
          }
          const sender =
            role === 'content'
              ? { tab: { id: TAB_ID, incognito, windowId: 1 }, frameId: 0, url: pageUrl }
              : { id: 'cff', url: `${EXTENSION_ORIGIN}popup/popup.html` };
          return deliver(listeners.background, message, sender);
        },
      },
      tabs: {
        sendMessage(/** @type {number} */ _tabId, /** @type {unknown} */ message) {
          return deliver(listeners.content, message, { id: 'cff' });
        },
        async query(/** @type {{ active?: boolean }} */ properties) {
          const open = [
            { id: TAB_ID, incognito, windowId: 1, url: pageUrl, lastAccessed: 1 },
            { id: VIEWER_TAB_ID, incognito: false, windowId: 1, url: VIEWER_URL, lastAccessed: 2 },
          ].filter((tab) => !closedTabs.has(tab.id));
          return properties.active ? open.filter((tab) => tab.id === TAB_ID) : open;
        },
        async create(/** @type {{ url: string, windowId?: number }} */ properties) {
          createdTabs.push(properties.url);
          createdInWindows.push(properties.windowId);
          return { id: 99, windowId: properties.windowId ?? 1 };
        },
        async update(/** @type {number} */ tabId) {
          return { id: tabId, windowId: 1 };
        },
        async get(/** @type {number} */ tabId) {
          if (closedTabs.has(tabId)) {
            throw new Error(`No tab with id: ${tabId}`);
          }
          return { id: tabId, windowId: 1 };
        },
        async getCurrent() {
          return undefined;
        },
      },
      windows: {
        async update() {},
        async getAll() {
          return [
            { id: 5, focused: true, incognito: true },
            { id: 6, focused: false, incognito: false },
          ];
        },
      },
      storage: { local, session, onChanged: event([]) },
    };
  }

  const backgroundApi = createApi('background');
  const backgroundContext = vm.createContext({
    [firefox ? 'browser' : 'chrome']: backgroundApi,
    crypto: globalThis.crypto,
    structuredClone,
    fetch: async (/** @type {string} */ url) => {
      const path = url.slice(EXTENSION_ORIGIN.length);
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(readProjectFile(`extension/${path}`)),
      };
    },
    setTimeout,
    clearTimeout,
  });
  for (const file of manifest.background.scripts) {
    vm.runInContext(readProjectFile(`extension/${file}`), backgroundContext, { filename: file });
  }

  const dom = new JSDOM(ERP_PAGE, {
    runScripts: 'outside-only',
    url: pageUrl,
    pretendToBeVisual: true,
  });
  const window = /** @type {any} */ (dom.window);
  window[firefox ? 'browser' : 'chrome'] = createApi('content');
  const context = dom.getInternalVMContext();
  for (const script of CONTENT_SCRIPTS) {
    new vm.Script(readProjectFile(`extension/${script}`), { filename: script }).runInContext(
      context,
    );
  }
  const pageApi = createApi('page');

  const document = window.document;
  /** @param {string} id */
  const input = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));

  return {
    window,
    input,
    listeners,
    targets,
    stats,
    local,
    session,
    createdTabs,
    createdInWindows,
    closedTabs,
    menu: (/** @type {string} */ id) => items.get(id),
    stored: () => /** @type {CffStoredState} */ (local.values.get('cff')),
    banner: () => {
      const host = document.querySelector('cff-banner');
      return host ? host : null;
    },
    /** @param {Record<string, unknown>} message */
    request: (message) => pageApi.runtime.sendMessage(message),
    /** @param {Record<string, unknown>} message */
    requestFromViewer: (message) =>
      deliver(listeners.background, message, {
        id: 'cff',
        url: VIEWER_URL,
        tab: { id: VIEWER_TAB_ID, windowId: 1 },
      }),
    /** The content script of the next document answers with another page id. */
    navigate() {
      listeners.content.unshift(
        (
          /** @type {any} */ message,
          /** @type {unknown} */ _sender,
          /** @type {Function} */ respond,
        ) => {
          if (message.type === 'cff:page-id') {
            respond({ page: 'next-document' });
          }
        },
      );
    },
    /** @param {{ reason: string, previousVersion?: string }} details */
    async install(details = { reason: 'update', previousVersion: '2.0.0' }) {
      for (const fn of listeners.installed) {
        fn(details);
      }
      await flush(20);
    },
    /** @param {HTMLElement} field */
    async rightPress(field) {
      field.dispatchEvent(
        new window.MouseEvent('pointerdown', {
          button: 2,
          bubbles: true,
          composed: true,
          clientX: 10,
          clientY: 10,
        }),
      );
      await flush(5);
    },
    /**
     * @param {string} menuItemId
     * @param {Record<string, unknown>} [info]
     */
    async click(menuItemId, info = {}) {
      for (const fn of listeners.clicked) {
        fn({ menuItemId, frameId: 0, ...info }, { id: TAB_ID, incognito, windowId: 1 });
      }
      await flush(250);
    },
    /** @param {Element} target */
    async showMenu(target) {
      targets.set(1, target);
      for (const fn of listeners.shown) {
        fn({ contexts: ['editable'], frameId: 0, targetElementId: 1 }, { id: TAB_ID, incognito });
      }
      await flush(5);
    },
  };
}

/**
 * @param {ReturnType<typeof createEnvironment>} env
 */
function visibleEntries(env) {
  return ['cff-root', 'cff-field', 'cff-form-current', 'cff-form-new', 'cff-undo'].filter(
    (id) => env.menu(id)?.visible,
  );
}

describe('Chromium path', () => {
  it('creates the parent and four hidden entries on install', async () => {
    const env = createEnvironment({ firefox: false });
    await env.install();
    assert.equal(env.menu('cff-root')?.title, 'Company Form Filler');
    for (const id of ['cff-field', 'cff-form-current', 'cff-form-new', 'cff-undo']) {
      assert.equal(env.menu(id)?.parentId, 'cff-root');
      assert.equal(env.menu(id)?.visible, false);
    }
  });

  it('sends nothing to the background until the user interacts', async () => {
    const env = createEnvironment({ firefox: false });
    await flush(5);
    assert.equal(env.stats.fromContent, 0);
  });

  it('reports a right click once and skips unchanged focus verdicts', async () => {
    const env = createEnvironment({ firefox: false });
    await env.install();
    const siret = env.input('siret');
    await env.rightPress(siret);
    siret.dispatchEvent(
      new env.window.MouseEvent('contextmenu', {
        bubbles: true,
        composed: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    await flush(5);
    assert.equal(env.stats.fromContent, 1);
  });

  it('does not send the same focus verdict twice', async () => {
    const env = createEnvironment({ firefox: false });
    const lonely = env.input('lonely');
    lonely.focus();
    lonely.blur();
    lonely.focus();
    await flush(5);
    assert.equal(env.stats.fromContent, 1);
  });

  it('shows the entries that apply before the menu opens', async () => {
    const env = createEnvironment({ firefox: false });
    await env.install();
    await env.rightPress(env.input('siret'));
    assert.deepEqual(visibleEntries(env), ['cff-root', 'cff-field', 'cff-form-new']);
    assert.equal(env.menu('cff-field')?.title, 'Remplir ce champ : SIRET');
    assert.equal(env.menu('cff-form-new')?.title, 'Nouvelle société et remplir');

    await env.rightPress(env.input('mail'));
    assert.deepEqual(visibleEntries(env), []);

    await env.rightPress(env.input('lonely'));
    assert.deepEqual(visibleEntries(env), ['cff-root', 'cff-field']);
  });

  it('fills the whole form with a new company, then reuses it for a single field', async () => {
    const env = createEnvironment({ firefox: false });
    await env.install();
    await env.rightPress(env.input('city'));
    await env.click('cff-form-new');

    const siret = env.input('siret').value;
    assert.ok(isValidSiret(siret), siret);
    assert.ok(isValidFrenchVat(env.input('vat').value));
    assert.ok(env.input('vat').value.endsWith(siret.slice(0, 9)));
    assert.notEqual(env.input('name').value, 'old');
    assert.match(env.input('zip').value, /^\d{5}$/);
    assert.equal(env.input('mail').value, '', 'the newsletter form is another block');
    assert.ok(env.banner(), 'a banner reports the fill');

    const stored = env.stored();
    assert.equal(stored.history.length, 1);
    assert.equal(stored.last?.identity.siret, siret);

    await env.rightPress(env.input('lonely'));
    assert.deepEqual(visibleEntries(env), ['cff-root', 'cff-field', 'cff-undo']);
    await env.click('cff-field');
    assert.equal(env.input('lonely').value, siret);
    assert.equal(env.stored().history.length, 1, 'reusing does not add to the history');
  });

  it('undoes the last fill of the frame', async () => {
    const env = createEnvironment({ firefox: false });
    await env.install();
    await env.rightPress(env.input('name'));
    await env.click('cff-form-new');
    assert.notEqual(env.input('name').value, 'old');
    await env.rightPress(env.input('mail'));
    assert.deepEqual(visibleEntries(env), ['cff-root', 'cff-undo']);
    await env.click('cff-undo');
    assert.equal(env.input('name').value, 'old');
    assert.equal(env.input('siret').value, '');
  });

  it('forgets the company of the tab when a new document loads', async () => {
    const env = createEnvironment({ firefox: false });
    await env.install();
    await env.rightPress(env.input('lonely'));
    await env.click('cff-field');
    const first = env.input('lonely').value;
    assert.ok(isValidSiret(first));

    env.navigate();
    await env.click('cff-field');
    assert.notEqual(env.input('lonely').value, first);
    assert.equal(env.stored().history.length, 2);
  });

  it('checks the target again on click and generates nothing for a stale entry', async () => {
    const env = createEnvironment({ firefox: false });
    await env.install();
    await env.rightPress(env.input('siret'));
    // The page changed the field before the click.
    env.input('siret').setAttribute('readonly', '');
    await env.click('cff-field');
    assert.equal(env.input('siret').value, '');
    assert.equal(env.stored(), undefined, 'no company was created');
    assert.ok(env.banner());
  });

  it('does not show entries on the newsletter even after a right press elsewhere', async () => {
    const env = createEnvironment({ firefox: false });
    await env.install();
    await env.rightPress(env.input('mail'));
    await env.click('cff-form-new');
    assert.equal(env.input('mail').value, '');
  });
});

describe('Firefox path', () => {
  it('shows the entries while the menu is open, then hides them', async () => {
    const env = createEnvironment({ firefox: true });
    await env.install();
    await env.showMenu(env.input('vat'));
    assert.deepEqual(visibleEntries(env), ['cff-root', 'cff-field', 'cff-form-new']);
    assert.equal(env.menu('cff-field')?.title, 'Remplir ce champ : N° TVA');
    assert.equal(env.stats.refreshes, 1);

    for (const fn of env.listeners.hidden) {
      fn();
    }
    await flush(5);
    assert.deepEqual(visibleEntries(env), []);
  });

  it('leaves the menu untouched on unrecognized fields', async () => {
    const env = createEnvironment({ firefox: true });
    await env.install();
    await env.showMenu(env.input('mail'));
    assert.deepEqual(visibleEntries(env), []);
    assert.equal(env.stats.refreshes, 0);
  });

  it('hides entries left visible by a previous instance of the event page', async () => {
    const env = createEnvironment({ firefox: true });
    await env.install();
    for (const id of ['cff-root', 'cff-field', 'cff-form-new']) {
      Object.assign(/** @type {Record<string, unknown>} */ (env.menu(id)), { visible: true });
    }
    await env.showMenu(env.input('mail'));
    assert.deepEqual(visibleEntries(env), []);
  });

  it('fills the target element of the click', async () => {
    const env = createEnvironment({ firefox: true });
    await env.install();
    env.targets.set(9, env.input('siret'));
    await env.click('cff-field', { targetElementId: 9 });
    assert.ok(isValidSiret(env.input('siret').value));
  });

  it('does not register the Chromium listeners', async () => {
    const env = createEnvironment({ firefox: true });
    await env.install();
    await env.rightPress(env.input('siret'));
    assert.deepEqual(visibleEntries(env), []);
  });
});

describe('popup and viewer requests', () => {
  it('generates a company for the tab of the popup and lists it', async () => {
    const env = createEnvironment({ firefox: false });
    const company = await env.request({ type: 'cff:generate', tabId: TAB_ID });
    assert.ok(isValidSiret(company.identity.siret));
    const state = await env.request({ type: 'cff:get-state', tabId: TAB_ID });
    assert.equal(state.tabCompany.id, company.id);
    assert.equal(state.last.id, company.id);
    assert.equal(state.history.length, 1);
    assert.equal(state.storageError, false);

    await env.install();
    await env.rightPress(env.input('city'));
    assert.ok(visibleEntries(env).includes('cff-form-current'));
    await env.click('cff-form-current');
    assert.equal(env.input('siret').value, company.identity.siret);
  });

  it('keeps 20 companies in the history and manages favorites', async () => {
    const env = createEnvironment({ firefox: false });
    /** @type {any[]} */
    const companies = [];
    for (let i = 0; i < 22; i++) {
      companies.push(await env.request({ type: 'cff:generate', tabId: TAB_ID }));
    }
    let state = await env.request({ type: 'cff:get-state' });
    assert.equal(state.history.length, 20);
    assert.equal(state.history[0].id, companies[21].id);

    await env.request({
      type: 'cff:favorite',
      companyId: companies[5].id,
      favorite: true,
      label: 'Recette',
    });
    await env.request({ type: 'cff:history-clear' });
    state = await env.request({ type: 'cff:get-state' });
    assert.equal(state.history.length, 0);
    assert.equal(state.favorites.length, 1);
    assert.equal(state.favorites[0].label, 'Recette');

    const used = await env.request({ type: 'cff:use', companyId: companies[5].id, tabId: TAB_ID });
    assert.equal(used.id, companies[5].id);
    state = await env.request({ type: 'cff:get-state', tabId: TAB_ID });
    assert.equal(state.last.id, companies[5].id);
    assert.equal(state.tabCompany.id, companies[5].id);

    await env.request({ type: 'cff:theme', theme: 'dark' });
    await env.request({ type: 'cff:clear-all' });
    state = await env.request({ type: 'cff:get-state' });
    assert.deepEqual([state.last, state.history.length, state.favorites.length], [null, 0, 0]);
    assert.equal(state.theme, 'dark');
  });

  it('applies the viewer locks to the viewer generation only', async () => {
    const env = createEnvironment({ firefox: false });
    const first = await env.request({ type: 'cff:generate', tabId: TAB_ID });
    await env.request({ type: 'cff:locks', locks: ['address', 'unknown'] });
    const state = await env.request({ type: 'cff:get-state' });
    assert.deepEqual([...state.locks], ['address']);
    const fromViewer = await env.request({ type: 'cff:generate', useLocks: true });
    assert.equal(fromViewer.address.line1, first.address.line1);
    assert.notEqual(fromViewer.identity.siret, first.identity.siret);
    const fromPopup = await env.request({ type: 'cff:generate', tabId: TAB_ID });
    assert.ok(fromPopup.address.inseeCode);
  });

  it('targets the last web tab from the viewer', async () => {
    const env = createEnvironment({ firefox: false });
    const company = await env.requestFromViewer({ type: 'cff:generate', useLocks: true });
    const state = await env.requestFromViewer({ type: 'cff:get-state' });
    assert.equal(state.tabCompany.id, company.id);
    assert.ok(env.session.values.has(`tab:${TAB_ID}`));
    assert.ok(!env.session.values.has(`tab:${VIEWER_TAB_ID}`), 'never the viewer tab itself');
  });

  it('forgets a closed tab and never targets it', async () => {
    const env = createEnvironment({ firefox: false });
    await env.request({ type: 'cff:generate', tabId: TAB_ID });
    assert.equal(env.session.values.size, 1);
    env.closedTabs.add(TAB_ID);
    const company = await env.requestFromViewer({ type: 'cff:generate', useLocks: true });
    assert.equal(env.stored().last?.id, company.id);
    assert.equal(env.session.values.size, 0, [...env.session.values.keys()].join());
  });

  it('opens the viewer in a normal window, never in a private one', async () => {
    const env = createEnvironment({ firefox: false });
    await env.request({ type: 'cff:open-viewer' });
    assert.deepEqual(env.createdInWindows, [6]);
  });

  it('writes nothing to disk in private windows', async () => {
    const env = createEnvironment({ firefox: false, incognito: true });
    const company = await env.request({ type: 'cff:generate', tabId: TAB_ID, incognito: true });
    assert.equal(env.stored(), undefined);
    const state = await env.request({ type: 'cff:get-state', tabId: TAB_ID, incognito: true });
    assert.equal(state.last.id, company.id);
    assert.equal(state.tabCompany.id, company.id);

    await env.install();
    await env.rightPress(env.input('city'));
    await env.click('cff-form-new');
    assert.equal(env.stored(), undefined, 'the menu writes nothing to disk either');
    assert.ok(isValidSiret(env.input('siret').value));
  });

  it('opens the viewer with a first company on install and on update from version 1', async () => {
    const env = createEnvironment({ firefox: false });
    await env.install({ reason: 'install' });
    assert.deepEqual(env.createdTabs, [`${EXTENSION_ORIGIN}viewer/viewer.html?welcome=1`]);
    assert.equal(env.stored().history.length, 1);

    const updated = createEnvironment({ firefox: false });
    await updated.install({ reason: 'update', previousVersion: '1.0.1' });
    assert.equal(updated.createdTabs.length, 1);

    const minor = createEnvironment({ firefox: false });
    await minor.install({ reason: 'update', previousVersion: '2.0.0' });
    assert.equal(minor.createdTabs.length, 0);
  });

  it('ignores page requests coming from web pages', async () => {
    const env = createEnvironment({ firefox: false });
    let answer = 'none';
    for (const fn of env.listeners.background) {
      fn(
        { type: 'cff:clear-all' },
        { tab: { id: TAB_ID }, frameId: 0, url: 'https://evil.test/' },
        () => {
          answer = 'answered';
        },
      );
    }
    await flush(5);
    assert.equal(answer, 'none');
  });
});
