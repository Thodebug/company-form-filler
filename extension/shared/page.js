/**
 * Helpers shared by the extension pages (popup and viewer): messages to
 * the background, translations, theme and DOM building without innerHTML.
 */
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
   * Fills elements carrying data-i18n (text), data-i18n-title and
   * data-i18n-placeholder.
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
   * Sends a request to the background and returns its answer.
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

  /**
   * Applies a theme: "system" follows prefers-color-scheme.
   * @param {CffTheme} theme
   */
  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'light' || theme === 'dark') {
      root.setAttribute('data-theme', theme);
    } else {
      root.removeAttribute('data-theme');
    }
  }

  /**
   * Creates an element with attributes and children.
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
   * Small inline SVG icon from a path list (24 × 24 view box, stroked).
   * @param {string[]} paths
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
   * Copies text on a user gesture, with a fallback for browsers that refuse
   * the Clipboard API in extension pages.
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
