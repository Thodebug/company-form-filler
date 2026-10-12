/**
 * Context menu: a fixed "Company Form Filler" parent with four entries,
 * each shown only when it applies to the right-clicked control.
 */
'use strict';

const CffMenus = (() => {
  const IDS = /** @type {const} */ ({
    root: 'cff-root',
    field: 'cff-field',
    current: 'cff-form-current',
    fresh: 'cff-form-new',
    undo: 'cff-undo',
  });
  const CONTEXTS = ['editable'];

  /**
   * @typedef {'field' | 'current' | 'fresh' | 'undo'} MenuAction
   * @typedef {Record<keyof typeof IDS, { visible: boolean, title?: string }>} MenuState
   */

  /**
   * Visibility and titles of the entries for a verdict.
   * @param {CffVerdict | null} verdict
   * @param {boolean} tabHasCompany
   * @param {(name: string, substitutions?: string[]) => string} message
   * @returns {MenuState}
   */
  function stateFor(verdict, tabHasCompany, message) {
    const field = Boolean(verdict && verdict.field);
    const block = verdict ? verdict.block : null;
    const undo = Boolean(verdict && verdict.canUndo);
    /** @type {MenuState} */
    const state = {
      root: { visible: false },
      field: {
        visible: field,
        title: field
          ? message('menuField', [message(`type_${/** @type {CffVerdict} */ (verdict).field}`)])
          : undefined,
      },
      current: { visible: Boolean(block) && tabHasCompany },
      fresh: {
        visible: Boolean(block),
        title: block
          ? message(block === 'address' ? 'menuNewAddress' : 'menuNewCompany')
          : undefined,
      },
      undo: { visible: undo },
    };
    state.root.visible = state.field.visible || state.fresh.visible || state.undo.visible;
    return state;
  }

  /**
   * @param {CffMenusApi} menus
   * @param {CffExtensionApi} api
   */
  function createMenus(menus, api) {
    /** @type {(name: string, substitutions?: string[]) => string} */
    const message = (name, substitutions) => api.i18n.getMessage(name, substitutions);

    /**
     * @param {CffMenuProperties} properties
     * @returns {Promise<void>}
     */
    function create(properties) {
      return new Promise((resolve) => {
        menus.create(properties, () => {
          // Reading lastError marks it as handled (duplicate id after a race).
          void api.runtime.lastError;
          resolve();
        });
      });
    }

    /** Creates the entries, all hidden. */
    async function ensure() {
      await menus.removeAll();
      await create({
        id: IDS.root,
        title: message('menuRoot'),
        contexts: CONTEXTS,
        visible: false,
      });
      const children = /** @type {const} */ ([
        ['field', 'menuField'],
        ['current', 'menuFillCurrent'],
        ['fresh', 'menuNewCompany'],
        ['undo', 'menuUndo'],
      ]);
      for (const [key, title] of children) {
        await create({
          id: IDS[key],
          parentId: IDS.root,
          title: message(title, key === 'field' ? [''] : undefined),
          contexts: CONTEXTS,
          visible: false,
        });
      }
    }

    /**
     * @param {MenuState} state
     */
    async function apply(state) {
      try {
        await updateAll(state);
      } catch {
        // The browser lost the entries (update or restart race): recreate.
        await ensure();
        await updateAll(state).catch(() => {});
      }
    }

    /**
     * @param {MenuState} state
     */
    async function updateAll(state) {
      await Promise.all(
        /** @type {Array<keyof typeof IDS>} */ (Object.keys(IDS)).map((key) => {
          /** @type {CffMenuProperties} */
          const properties = { visible: state[key].visible };
          if (state[key].title) {
            properties.title = state[key].title;
          }
          return menus.update(IDS[key], properties);
        }),
      );
    }

    function hideAll() {
      return apply(stateFor(null, false, message));
    }

    /**
     * @param {string | number} menuItemId
     * @returns {MenuAction | null}
     */
    function actionOf(menuItemId) {
      const entry = Object.entries(IDS).find(([key, id]) => id === menuItemId && key !== 'root');
      return entry ? /** @type {MenuAction} */ (entry[0]) : null;
    }

    return {
      ensure,
      apply,
      hideAll,
      actionOf,
      /**
       * @param {CffVerdict | null} verdict
       * @param {boolean} tabHasCompany
       */
      stateFor: (verdict, tabHasCompany) => stateFor(verdict, tabHasCompany, message),
    };
  }

  return { IDS, stateFor, createMenus };
})();
