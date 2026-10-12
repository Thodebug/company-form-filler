// Communes are split per department and fetched on demand to keep startup light.
'use strict';

const CffData = (() => {
  const MAX_CACHED_DEPARTMENTS = 12;
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
   * @param {(path: string) => Promise<unknown>} readJson Path relative to
   *   extension/data/fr, without extension.
   * @returns {CompanyDataSource}
   */
  function createSource(readJson) {
    /** @type {Promise<CompanyData> | null} */
    let staticData = null;
    /**
     * Least recently used last. Bounded: a long session would otherwise end
     * up holding every commune of France.
     * @type {Map<string, Promise<CommuneRow[]>>}
     */
    const communes = new Map();

    return {
      load() {
        if (!staticData) {
          staticData = Promise.all(
            Object.entries(STATIC_FILES).map(async ([key, file]) => [key, await readJson(file)]),
          ).then((entries) => /** @type {CompanyData} */ (Object.fromEntries(entries)));
          // A failed load is forgotten so the next call retries.
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
        const cached = communes.get(departmentCode);
        const rows =
          cached || /** @type {Promise<CommuneRow[]>} */ (readJson(`communes/${departmentCode}`));
        communes.delete(departmentCode);
        communes.set(departmentCode, rows);
        if (!cached) {
          rows.catch(() => {
            if (communes.get(departmentCode) === rows) {
              communes.delete(departmentCode);
            }
          });
          if (communes.size > MAX_CACHED_DEPARTMENTS) {
            communes.delete(/** @type {string} */ (communes.keys().next().value));
          }
        }
        return rows;
      },
    };
  }

  /**
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
