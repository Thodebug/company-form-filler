/**
 * Session state, kept in storage.session: in memory, never written to disk,
 * and preserved while the background sleeps.
 *
 * - The company of each tab, cleared when the tab loads a new document or
 *   closes.
 * - The last company of private windows, which never reaches storage.local.
 * - The tab of the viewer and the last web tab the user activated, which
 *   the viewer actions target.
 */
'use strict';

const CffTabs = (() => {
  const TAB_PREFIX = 'tab:';
  const PRIVATE_LAST = 'privateLast';
  const VIEWER_TAB = 'viewerTab';
  const LAST_WEB_TAB = 'lastWebTab';

  /**
   * Fallback when storage.session is missing: a plain map, lost when the
   * background sleeps.
   * @returns {CffStorageArea}
   */
  function memoryArea() {
    /** @type {Map<string, unknown>} */
    const values = new Map();
    return {
      async get(keys) {
        const list = keys === undefined || keys === null ? [...values.keys()] : [keys].flat();
        return Object.fromEntries(
          list.filter((key) => values.has(key)).map((key) => [key, values.get(key)]),
        );
      },
      async set(items) {
        for (const [key, value] of Object.entries(items)) {
          values.set(key, value);
        }
      },
      async remove(keys) {
        for (const key of [keys].flat()) {
          values.delete(key);
        }
      },
    };
  }

  /**
   * @param {CffStorageArea | undefined} session storage.session
   */
  function createTabState(session) {
    const area = session || memoryArea();

    /**
     * @param {string} key
     * @returns {Promise<unknown>}
     */
    async function read(key) {
      try {
        return (await area.get(key))[key];
      } catch {
        return undefined;
      }
    }

    /**
     * @param {string} key
     * @param {unknown} value
     */
    async function write(key, value) {
      try {
        if (value === null || value === undefined) {
          await area.remove(key);
        } else {
          await area.set({ [key]: value });
        }
      } catch {
        // Session storage full or unavailable: the state is only lost.
      }
    }

    return {
      /**
       * @param {number} tabId
       * @returns {Promise<Company | null>}
       */
      async getCompany(tabId) {
        const value = await read(TAB_PREFIX + tabId);
        return CffCompany.isCompany(value) ? value : null;
      },
      /**
       * @param {number} tabId
       * @param {Company | null} company
       */
      setCompany(tabId, company) {
        return write(TAB_PREFIX + tabId, company);
      },
      /** @param {number} tabId */
      clearCompany(tabId) {
        return write(TAB_PREFIX + tabId, null);
      },
      /** @returns {Promise<Company | null>} */
      async getPrivateLast() {
        const value = await read(PRIVATE_LAST);
        return CffCompany.isCompany(value) ? value : null;
      },
      /** @param {Company} company */
      setPrivateLast(company) {
        return write(PRIVATE_LAST, company);
      },
      /** @returns {Promise<number | null>} */
      async getViewerTab() {
        const value = await read(VIEWER_TAB);
        return typeof value === 'number' ? value : null;
      },
      /** @param {number | null} tabId */
      setViewerTab(tabId) {
        return write(VIEWER_TAB, tabId);
      },
      /** @returns {Promise<number | null>} */
      async getLastWebTab() {
        const value = await read(LAST_WEB_TAB);
        return typeof value === 'number' ? value : null;
      },
      /** @param {number | null} tabId */
      setLastWebTab(tabId) {
        return write(LAST_WEB_TAB, tabId);
      },
    };
  }

  return { createTabState, memoryArea };
})();
