/**
 * Loads the static data of extension/data/fr, with an in-memory cache.
 * Communes are loaded per department, on demand.
 */
'use strict';

const CffData = (() => {
  const STATIC_FILES = /** @type {const} */ ({
    naf: 'naf',
    legalForms: 'legal-forms',
    headcount: 'headcount',
    firstNames: 'first-names',
    lastNames: 'last-names',
    streets: 'streets',
    words: 'words',
    banks: 'banks',
    departments: 'departments',
  });

  /**
   * @param {(path: string) => Promise<unknown>} readJson Reads a file of
   *   extension/data/fr, path relative to that folder without extension.
   * @returns {CompanyDataSource}
   */
  function createSource(readJson) {
    /** @type {Promise<CompanyData> | null} */
    let staticData = null;
    /** @type {Map<string, Promise<CommuneRow[]>>} */
    const communes = new Map();

    return {
      load() {
        if (!staticData) {
          staticData = Promise.all(
            Object.entries(STATIC_FILES).map(async ([key, file]) => [key, await readJson(file)]),
          ).then((entries) => /** @type {CompanyData} */ (Object.fromEntries(entries)));
          staticData.catch(() => {
            staticData = null;
          });
        }
        return staticData;
      },
      communes(departmentCode) {
        if (!/^[0-9AB]{2,3}$/.test(departmentCode)) {
          return Promise.reject(new Error(`Invalid department ${departmentCode}`));
        }
        let rows = communes.get(departmentCode);
        if (!rows) {
          rows = /** @type {Promise<CommuneRow[]>} */ (readJson(`communes/${departmentCode}`));
          communes.set(departmentCode, rows);
          rows.catch(() => communes.delete(departmentCode));
        }
        return rows;
      },
    };
  }

  /**
   * Source reading the packaged files through fetch.
   * @param {(path: string) => string} getUrl runtime.getURL
   * @returns {CompanyDataSource}
   */
  function createExtensionSource(getUrl) {
    return createSource(async (path) => {
      const response = await fetch(getUrl(`data/fr/${path}.json`));
      if (!response.ok) {
        throw new Error(`Cannot load ${path}: HTTP ${response.status}`);
      }
      return response.json();
    });
  }

  return { createSource, createExtensionSource };
})();
