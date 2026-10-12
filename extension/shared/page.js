// Shared by the popup and the viewer, which build their DOM without innerHTML.
'use strict';

const CffPage = (() => {
  const api = /** @type {CffExtensionApi} */ (globalThis.browser || globalThis.chrome);

  /**
   * @param {string} name
   * @param {Array<string | number>} [substitutions]
   * @returns {string}
   */
  function t(name, substitutions) {
    return api.i18n.getMessage(name, substitutions && substitutions.map(String)) || name;
  }

  /**
   * @param {ParentNode} root
   */
  function localize(root) {
    for (const element of root.querySelectorAll('[data-i18n]')) {
      element.textContent = t(/** @type {string} */ (element.getAttribute('data-i18n')));
    }
    for (const element of root.querySelectorAll('[data-i18n-title]')) {
      element.setAttribute(
        'title',
        t(/** @type {string} */ (element.getAttribute('data-i18n-title'))),
      );
    }
    for (const element of root.querySelectorAll('[data-i18n-placeholder]')) {
      element.setAttribute(
        'placeholder',
        t(/** @type {string} */ (element.getAttribute('data-i18n-placeholder'))),
      );
    }
  }

  /**
   * @param {Record<string, unknown>} message
   * @returns {Promise<any>}
   */
  async function send(message) {
    const answer = await api.runtime.sendMessage(message);
    if (answer && typeof answer === 'object' && 'error' in answer) {
      throw new Error(String(answer.error));
    }
    return answer;
  }

  const THEME_KEY = 'cff-theme';
  const PAGE_SCHEME_KEY = 'cff-page-scheme';
  // Firefox draws popups after the browser's own theme, so their
  // prefers-color-scheme may differ from the one of tabs. In "system" mode the
  // popup takes the scheme last seen by the viewer, light by default.
  const IN_POPUP = location.pathname.endsWith('/popup/popup.html');
  const darkScheme = matchMedia('(prefers-color-scheme: dark)');

  /**
   * localStorage keeps the theme at hand before the background answers, so
   * pages open in the right colors.
   * @param {string} key
   * @returns {string | null}
   */
  function recall(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  /**
   * @param {string} key
   * @param {string} value
   */
  function remember(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage disabled: the theme is applied once the state arrives.
    }
  }

  function rememberPageScheme() {
    remember(PAGE_SCHEME_KEY, darkScheme.matches ? 'dark' : 'light');
  }

  /**
   * Without data-theme, theme.css follows prefers-color-scheme.
   * @param {CffTheme} theme
   */
  function applyTheme(theme) {
    remember(THEME_KEY, theme);
    let scheme = theme;
    if (theme === 'system') {
      if (IN_POPUP) {
        scheme = recall(PAGE_SCHEME_KEY) === 'dark' ? 'dark' : 'light';
      } else {
        rememberPageScheme();
      }
    }
    const root = document.documentElement;
    if (scheme === 'light' || scheme === 'dark') {
      root.setAttribute('data-theme', scheme);
    } else {
      root.removeAttribute('data-theme');
    }
  }

  const savedTheme = recall(THEME_KEY);
  applyTheme(savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'system');
  if (!IN_POPUP) {
    darkScheme.addEventListener('change', rememberPageScheme);
  }

  /**
   * @template {keyof HTMLElementTagNameMap} K
   * @param {K} tag
   * @param {Record<string, string | boolean | undefined>} [attributes]
   * @param {Array<Node | string | null | undefined | false>} [children]
   * @returns {HTMLElementTagNameMap[K]}
   */
  function h(tag, attributes = {}, children = []) {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      if (value === true) {
        element.setAttribute(name, '');
      } else if (typeof value === 'string') {
        element.setAttribute(name, value);
      }
    }
    for (const child of children) {
      if (child !== null && child !== undefined && child !== false) {
        element.append(child);
      }
    }
    return element;
  }

  /**
   * @param {string[]} paths Path data for a 24 × 24 view box.
   * @returns {SVGSVGElement}
   */
  function icon(paths) {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = /** @type {SVGSVGElement} */ (document.createElementNS(namespace, 'svg'));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'icon');
    for (const d of paths) {
      const path = document.createElementNS(namespace, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    return svg;
  }

  const ICONS = {
    lockClosed: ['M6 11h12v10H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
    lockOpen: ['M6 11h12v10H6z', 'M8.5 11V8a3.5 3.5 0 0 1 6.8-1.2'],
    star: ['M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z'],
    refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 5v6h-6'],
    theme: ['M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z'],
  };

  /**
   * Some browsers refuse the Clipboard API in extension pages.
   * @param {string} text
   * @returns {Promise<boolean>}
   */
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = h('textarea', { 'aria-hidden': 'true' }, [text]);
      area.style.setProperty('position', 'fixed');
      area.style.setProperty('opacity', '0');
      document.body.append(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      return copied;
    }
  }

  return { api, t, localize, send, applyTheme, h, icon, ICONS, copy };
})();
