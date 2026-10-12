/**
 * Background entry point.
 *
 * Loaded as an event page in Firefox (background.scripts lists the other
 * scripts before this one) and as a service worker in Chromium, where it
 * imports them itself. Classic scripts only, so the same files work in both.
 */
'use strict';

if (typeof importScripts === 'function' && typeof CffCompany === 'undefined') {
  importScripts(
    '/generators/random.js',
    '/generators/checksums.js',
    '/generators/text.js',
    '/generators/company.js',
    '/background/data.js',
    '/background/store.js',
    '/background/tabs-state.js',
    '/background/menus.js',
  );
}

(() => {
  const api = /** @type {CffExtensionApi} */ (globalThis.browser || globalThis.chrome);
  const menusApi = /** @type {CffMenusApi} */ (api.menus || api.contextMenus);
  const source = CffData.createExtensionSource((path) => api.runtime.getURL(path));
  const store = CffStore.createStore(api.storage.local);
  const tabs = CffTabs.createTabState(api.storage.session);
  const menus = CffMenus.createMenus(menusApi, api);
  const VIEWER_PATH = 'viewer/viewer.html';

  /**
   * @param {number} tabId
   * @param {unknown} message
   * @param {number} frameId
   * @returns {Promise<any>}
   */
  function sendToFrame(tabId, message, frameId) {
    return api.tabs.sendMessage(tabId, message, { frameId }).catch(() => null);
  }

  /**
   * @param {number} tabId
   * @returns {Promise<boolean>}
   */
  async function tabExists(tabId) {
    try {
      return Boolean(await api.tabs.get(tabId));
    } catch {
      return false;
    }
  }

  /**
   * Makes a company the one of a tab and, outside private windows, the last
   * company; a new company also enters the history.
   * @param {Company} company
   * @param {{ tabId: number | null, incognito: boolean, isNew: boolean }} target
   */
  async function adopt(company, target) {
    if (target.tabId !== null && (await tabExists(target.tabId))) {
      await tabs.setCompany(target.tabId, company);
    }
    if (target.incognito) {
      await tabs.setPrivateLast(company);
    } else {
      await store.update((state) =>
        target.isNew ? CffStore.withNewCompany(state, company) : CffStore.withLast(state, company),
      );
    }
  }

  /**
   * @param {{ tabId: number | null, incognito: boolean, previous?: Company | null, locks?: CompanyGroup[] }} options
   * @returns {Promise<Company>}
   */
  async function newCompany(options) {
    const company = await CffCompany.generate(source, {
      previous: options.previous || null,
      locks: options.locks || [],
    });
    await adopt(company, { tabId: options.tabId, incognito: options.incognito, isNew: true });
    return company;
  }

  // Menu, Firefox: decide while the menu is open, then refresh it.
  if (menusApi.onShown && menusApi.onHidden && menusApi.refresh) {
    const refresh = menusApi.refresh.bind(menusApi);
    let shownInstance = 0;
    let nextInstance = 1;

    menusApi.onShown.addListener(
      /**
       * @param {{ contexts: string[], frameId?: number, targetElementId?: number }} info
       * @param {CffTab | undefined} tab
       */
      async (info, tab) => {
        if (!info.contexts.includes('editable') || !tab || tab.id === undefined) {
          return;
        }
        const instance = nextInstance++;
        shownInstance = instance;
        let verdict = null;
        if (typeof info.targetElementId === 'number') {
          const response = await sendToFrame(
            tab.id,
            { type: 'cff:evaluate', targetElementId: info.targetElementId },
            info.frameId || 0,
          );
          verdict = response && response.verdict ? response.verdict : null;
        }
        const state = menus.stateFor(verdict, Boolean(await tabs.getCompany(tab.id)));
        if (instance !== shownInstance) {
          return;
        }
        // Always applied, even when everything is hidden: the event page may
        // have slept since the entries were last shown.
        await menus.apply(state);
        if (instance === shownInstance && state.root.visible) {
          refresh();
        }
      },
    );

    menusApi.onHidden.addListener(() => {
      shownInstance = 0;
      menus.hideAll();
    });
  }

  menusApi.onClicked.addListener(
    /**
     * @param {{ menuItemId: string | number, frameId?: number, targetElementId?: number }} info
     * @param {CffTab | undefined} tab
     */
    async (info, tab) => {
      const action = menus.actionOf(info.menuItemId);
      if (!action || !tab || tab.id === undefined) {
        return;
      }
      const tabId = tab.id;
      const frameId = info.frameId || 0;
      if (action === 'undo') {
        await sendToFrame(tabId, { type: 'cff:undo' }, frameId);
        return;
      }
      // The menu may show a stale verdict: check again before generating.
      const evaluation = await sendToFrame(
        tabId,
        { type: 'cff:evaluate', targetElementId: info.targetElementId },
        frameId,
      );
      /** @type {CffVerdict | null} */
      const verdict = evaluation && evaluation.verdict ? evaluation.verdict : null;
      const applies =
        action === 'field' ? Boolean(verdict && verdict.field) : Boolean(verdict && verdict.block);
      let company = null;
      if (applies) {
        const incognito = Boolean(tab.incognito);
        company =
          (action !== 'fresh' && (await tabs.getCompany(tabId))) ||
          (await newCompany({ tabId, incognito }));
      }
      await sendToFrame(
        tabId,
        {
          type: 'cff:fill',
          targetElementId: info.targetElementId,
          action: action === 'field' ? 'field' : 'form',
          company,
        },
        frameId,
      );
    },
  );

  /**
   * Opens the viewer, or brings its tab to the front. An open viewer answers
   * the ping with its tab id.
   * @param {string} [query]
   */
  async function openViewer(query = '') {
    let answer = null;
    try {
      answer = await api.runtime.sendMessage({ type: 'cff:viewer-ping' });
    } catch {
      // No extension page listening.
    }
    if (answer && typeof answer.tabId === 'number') {
      try {
        const tab = await api.tabs.update(answer.tabId, { active: true });
        if (api.windows && tab && tab.windowId !== undefined) {
          await api.windows.update(tab.windowId, { focused: true });
        }
        return;
      } catch {
        // The tab closed in the meantime.
      }
    }
    // The viewer never opens in a private window: what it does is recorded.
    const windowId = await normalWindowId();
    await api.tabs.create({
      url: api.runtime.getURL(`${VIEWER_PATH}${query}`),
      ...(windowId === null ? {} : { windowId }),
    });
  }

  /**
   * A normal (non private) browser window, the focused one first.
   * @returns {Promise<number | null>}
   */
  async function normalWindowId() {
    if (!api.windows || typeof api.windows.getAll !== 'function') {
      return null;
    }
    try {
      const windows = (await api.windows.getAll({ windowTypes: ['normal'] })).filter(
        (window) => !window.incognito && window.id !== undefined,
      );
      const chosen = windows.find((window) => window.focused) || windows[0];
      return chosen ? /** @type {number} */ (chosen.id) : null;
    } catch {
      return null;
    }
  }

  /**
   * State for the popup (tabId of its window) or the viewer (tabId null).
   * @param {{ tabId?: number | null, incognito?: boolean }} request
   * @returns {Promise<CffViewState>}
   */
  async function viewState(request) {
    const stored = await store.get();
    const incognito = request.incognito === true;
    const tabId = typeof request.tabId === 'number' ? request.tabId : await tabs.getLastWebTab();
    const tabCompany = tabId === null ? null : await tabs.getCompany(tabId);
    return {
      ...stored,
      last: incognito ? await tabs.getPrivateLast() : stored.last,
      tabCompany,
      incognito,
      storageError: store.failed,
    };
  }

  /**
   * Tab an action of the popup (its tab) or of the viewer (last web tab) targets.
   * @param {{ tabId?: unknown }} request
   * @returns {Promise<number | null>}
   */
  async function targetTab(request) {
    return typeof request.tabId === 'number' ? request.tabId : tabs.getLastWebTab();
  }

  /**
   * Handles a request of the popup or the viewer.
   * @param {Record<string, any>} request
   * @returns {Promise<unknown>}
   */
  async function handlePageRequest(request) {
    const incognito = request.incognito === true;
    switch (request.type) {
      case 'cff:get-state':
        return viewState(request);
      case 'cff:generate': {
        const stored = await store.get();
        const fromViewer = request.useLocks === true;
        return newCompany({
          tabId: await targetTab(request),
          incognito,
          previous: fromViewer ? stored.last : null,
          locks: fromViewer ? stored.locks : [],
        });
      }
      case 'cff:use': {
        const stored = await store.get();
        const company =
          CffStore.findCompany(stored, String(request.companyId)) ||
          (incognito ? await tabs.getPrivateLast() : null);
        if (company && company.id === request.companyId) {
          await adopt(company, { tabId: await targetTab(request), incognito, isNew: false });
        }
        return company;
      }
      case 'cff:favorite':
        return store.update((state) =>
          CffStore.withFavorite(
            state,
            String(request.companyId),
            request.favorite === true,
            String(request.label || ''),
          ),
        );
      case 'cff:history-delete':
        return store.update((state) =>
          CffStore.withoutHistoryEntry(state, String(request.companyId)),
        );
      case 'cff:history-clear':
        return store.update(CffStore.withEmptyHistory);
      case 'cff:clear-all':
        return store.update(CffStore.withEverythingCleared);
      case 'cff:locks':
        return store.update((state) => {
          state.locks = CffCompany.GROUPS.filter((group) => (request.locks || []).includes(group));
          return state;
        });
      case 'cff:theme':
        return store.update((state) => {
          if (CffStore.THEMES.includes(request.theme)) {
            state.theme = request.theme;
          }
          return state;
        });
      case 'cff:onboarding-dismiss':
        return store.update((state) => {
          state.onboardingDismissed = true;
          return state;
        });
      case 'cff:open-viewer':
        return openViewer();
      case 'cff:viewer-hello':
        // The viewer's own activation may have been taken for a web tab.
        return typeof request.tabId === 'number' ? tabs.registerViewerTab(request.tabId) : null;
      default:
        return null;
    }
  }

  api.runtime.onMessage.addListener((incoming, sender, sendResponse) => {
    if (!incoming || typeof incoming !== 'object' || !('type' in incoming)) {
      return undefined;
    }
    const request = /** @type {Record<string, any>} */ (incoming);
    const fromTab = sender.tab && sender.tab.id !== undefined ? sender.tab : null;

    // Content scripts: verdicts (Chromium) and new documents.
    if (request.type === 'cff:verdict' && fromTab) {
      const tabId = /** @type {number} */ (fromTab.id);
      tabs
        .getCompany(tabId)
        .then((company) => menus.apply(menus.stateFor(request.verdict || null, Boolean(company))));
      return undefined;
    }
    if (request.type === 'cff:page' && fromTab) {
      if (!sender.frameId) {
        tabs.clearCompany(/** @type {number} */ (fromTab.id));
      }
      return undefined;
    }
    if (request.type === 'cff:viewer-ping') {
      return undefined;
    }

    // Extension pages only: the popup has no tab, the viewer runs on the
    // extension origin.
    const extensionOrigin = api.runtime.getURL('');
    const senderUrl = /** @type {{ url?: string }} */ (sender).url || '';
    if (fromTab && !senderUrl.startsWith(extensionOrigin)) {
      return undefined;
    }
    handlePageRequest(request).then(sendResponse, (error) =>
      sendResponse({ error: String(error) }),
    );
    return true;
  });

  api.tabs.onRemoved.addListener((tabId) => {
    tabs.forgetTab(tabId);
  });

  api.tabs.onActivated.addListener(async ({ tabId }) => {
    if (tabId !== (await tabs.getViewerTab())) {
      await tabs.setLastWebTab(tabId);
    }
  });

  api.runtime.onInstalled.addListener(async (details) => {
    await menus.ensure();
    const fromVersion1 = details.reason === 'update' && /^1\./.test(details.previousVersion || '');
    if (details.reason === 'install' || fromVersion1) {
      await newCompany({ tabId: null, incognito: false });
      await openViewer('?welcome=1');
    }
  });

  api.runtime.onStartup.addListener(() => {
    menus.ensure();
  });
})();
