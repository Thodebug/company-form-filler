/**
 * Persistent state in storage.local: last company, history, favorites,
 * viewer locks, theme and onboarding.
 *
 * Every read is validated, so a damaged or foreign value never reaches the
 * rest of the extension. When storage fails, the state lives on in memory
 * and `failed` tells the popup and the viewer.
 */
'use strict';

const CffStore = (() => {
  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = 'cff';
  const MAX_HISTORY = 20;
  const MAX_FAVORITES = 100;
  const MAX_LABEL_LENGTH = 80;
  /** @type {readonly CffTheme[]} */
  const THEMES = ['system', 'light', 'dark'];

  /**
   * @returns {CffStoredState}
   */
  function defaults() {
    return {
      schemaVersion: SCHEMA_VERSION,
      last: null,
      history: [],
      favorites: [],
      locks: [],
      theme: 'system',
      onboardingDismissed: false,
    };
  }

  /**
   * Brings an older stored state to the current schema. Version 1 is the
   * first one: there is nothing to migrate yet.
   * @param {Record<string, any>} raw
   * @returns {Record<string, any>}
   */
  function migrate(raw) {
    return raw;
  }

  /**
   * Keeps only valid values of a stored state.
   * @param {unknown} value
   * @returns {CffStoredState}
   */
  function sanitize(value) {
    const state = defaults();
    if (!value || typeof value !== 'object') {
      return state;
    }
    const raw = migrate(/** @type {Record<string, any>} */ (value));
    if (CffCompany.isCompany(raw.last)) {
      state.last = raw.last;
    }
    if (Array.isArray(raw.history)) {
      state.history = raw.history.filter(CffCompany.isCompany).slice(0, MAX_HISTORY);
    }
    if (Array.isArray(raw.favorites)) {
      state.favorites = raw.favorites
        .filter(
          (/** @type {any} */ favorite) =>
            favorite &&
            CffCompany.isCompany(favorite.company) &&
            typeof favorite.label === 'string',
        )
        .slice(0, MAX_FAVORITES)
        .map((/** @type {CffFavorite} */ favorite) => ({
          company: favorite.company,
          label: favorite.label.slice(0, MAX_LABEL_LENGTH),
        }));
    }
    if (Array.isArray(raw.locks)) {
      state.locks = CffCompany.GROUPS.filter((group) => raw.locks.includes(group));
    }
    if (THEMES.includes(raw.theme)) {
      state.theme = raw.theme;
    }
    state.onboardingDismissed = raw.onboardingDismissed === true;
    return state;
  }

  /**
   * @param {CffStorageArea} area storage.local
   */
  function createStore(area) {
    /** State read from storage, or changed since a successful read. */
    /** @type {CffStoredState | null} */
    let memory = null;
    /** State used while storage cannot be read: never written back. */
    /** @type {CffStoredState | null} */
    let fallback = null;
    let failed = false;

    /** @returns {Promise<CffStoredState>} */
    async function get() {
      if (memory) {
        return memory;
      }
      try {
        const stored = await area.get(STORAGE_KEY);
        memory = sanitize(stored[STORAGE_KEY]);
        fallback = null;
        failed = false;
        return memory;
      } catch {
        // Retried on the next call. Until then the extension works in memory,
        // and nothing is saved: saving would overwrite the stored favorites.
        failed = true;
        fallback = fallback || defaults();
        return fallback;
      }
    }

    /**
     * Applies a change and saves the result, unless the stored state could
     * not be read.
     * @param {(state: CffStoredState) => CffStoredState} change
     * @returns {Promise<CffStoredState>}
     */
    async function update(change) {
      const next = change(structuredClone(await get()));
      if (!memory) {
        fallback = next;
        return next;
      }
      memory = next;
      try {
        await area.set({ [STORAGE_KEY]: next });
        failed = false;
      } catch {
        failed = true;
      }
      return next;
    }

    return {
      get,
      update,
      /** Whether the last storage operation failed. */
      get failed() {
        return failed;
      },
    };
  }

  /**
   * A new company becomes the last one and enters the history.
   * @param {CffStoredState} state
   * @param {Company} company
   * @returns {CffStoredState}
   */
  function withNewCompany(state, company) {
    state.last = company;
    state.history = [company, ...state.history.filter((entry) => entry.id !== company.id)].slice(
      0,
      MAX_HISTORY,
    );
    return state;
  }

  /**
   * A company of the history or the favorites becomes the last one.
   * @param {CffStoredState} state
   * @param {Company} company
   * @returns {CffStoredState}
   */
  function withLast(state, company) {
    state.last = company;
    return state;
  }

  /**
   * @param {CffStoredState} state
   * @param {string} id
   * @returns {Company | null}
   */
  function findCompany(state, id) {
    if (state.last && state.last.id === id) {
      return state.last;
    }
    return (
      state.history.find((company) => company.id === id) ||
      state.favorites.map((favorite) => favorite.company).find((company) => company.id === id) ||
      null
    );
  }

  /**
   * Adds or removes a favorite. Adding beyond MAX_FAVORITES does nothing.
   * @param {CffStoredState} state
   * @param {string} id
   * @param {boolean} favorite
   * @param {string} [label]
   * @returns {CffStoredState}
   */
  function withFavorite(state, id, favorite, label = '') {
    const existing = state.favorites.find((entry) => entry.company.id === id);
    if (!favorite) {
      state.favorites = state.favorites.filter((entry) => entry.company.id !== id);
      return state;
    }
    const cleanLabel = label.trim().slice(0, MAX_LABEL_LENGTH);
    if (existing) {
      existing.label = cleanLabel;
      return state;
    }
    const company = findCompany(state, id);
    if (company && state.favorites.length < MAX_FAVORITES) {
      state.favorites = [{ company, label: cleanLabel }, ...state.favorites];
    }
    return state;
  }

  /**
   * Removes a company from the history. The last company stays.
   * @param {CffStoredState} state
   * @param {string} id
   * @returns {CffStoredState}
   */
  function withoutHistoryEntry(state, id) {
    state.history = state.history.filter((company) => company.id !== id);
    return state;
  }

  /**
   * @param {CffStoredState} state
   * @returns {CffStoredState}
   */
  function withEmptyHistory(state) {
    state.history = [];
    return state;
  }

  /**
   * Erases every company and the locks; keeps the theme and the onboarding.
   * @param {CffStoredState} state
   * @returns {CffStoredState}
   */
  function withEverythingCleared(state) {
    return { ...defaults(), theme: state.theme, onboardingDismissed: state.onboardingDismissed };
  }

  return {
    SCHEMA_VERSION,
    STORAGE_KEY,
    MAX_HISTORY,
    MAX_FAVORITES,
    THEMES,
    defaults,
    sanitize,
    createStore,
    withNewCompany,
    withLast,
    findCompany,
    withFavorite,
    withoutHistoryEntry,
    withEmptyHistory,
    withEverythingCleared,
  };
})();
