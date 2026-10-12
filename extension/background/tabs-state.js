// storage.session is never written to disk and survives the background
// sleeping, so private-window companies are kept here, not in storage.local.
'use strict';

const CffTabs = (() => {
  const TAB_PREFIX = 'tab:';
  const PRIVATE_LAST = 'privateLast';

  /**
   * For browsers without storage.session; lost when the background sleeps.
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
        // Session storage full or unavailable: losing this state is harmless.
      }
    }

    return {
      /**
       * The company belongs to the document it was set for: another page id
       * means the tab navigated since.
       * @param {number} tabId
       * @param {string | null} page
       * @returns {Promise<Company | null>}
       */
      async getCompany(tabId, page) {
        const entry = /** @type {{ company?: unknown, page?: unknown } | undefined} */ (
          await read(TAB_PREFIX + tabId)
        );
        if (!entry) {
          return null;
        }
        if (entry.page !== page || !CffCompany.isCompany(entry.company)) {
          await write(TAB_PREFIX + tabId, null);
          return null;
        }
        return entry.company;
      },
      /**
       * @param {number} tabId
       * @param {Company} company
       * @param {string | null} page
       */
      setCompany(tabId, company, page) {
        return write(TAB_PREFIX + tabId, { company, page });
      },
      /**
       * Closed tabs are dropped here rather than on tabs.onRemoved, which
       * would wake the background each time any tab closes.
       * @param {number[]} openTabIds
       */
      async forgetClosedTabs(openTabIds) {
        const open = new Set(openTabIds.map((id) => TAB_PREFIX + id));
        try {
          const closed = Object.keys(await area.get(null)).filter(
            (key) => key.startsWith(TAB_PREFIX) && !open.has(key),
          );
          if (closed.length) {
            await area.remove(closed);
          }
        } catch {
          // Retried on the next adoption.
        }
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
    };
  }

  return { createTabState, memoryArea };
})();
