/**
 * Small status banner shown in the page after a fill.
 *
 * It lives in a closed shadow root, so page styles do not reach it, and is
 * styled through the CSSOM only (adopted style sheet, element.style), which
 * strict Content Security Policies allow. It is shown as a manual popover
 * when the browser supports it, to stay clickable above a modal dialog.
 */
'use strict';

const CffBanner = (() => {
  const HIDE_DELAY_MS = 6000;
  const HOST_TAG = 'cff-banner';

  const CSS = `
    .box {
      display: flex; align-items: center; gap: 12px;
      max-width: 420px; padding: 10px 12px;
      background: #1e1b4b; color: #ffffff;
      border: 1px solid #4338ca; border-radius: 2px;
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      cursor: default;
    }
    .text { flex: 1; }
    button {
      font: inherit; color: #ffffff; background: transparent;
      border: 1px solid #a5b4fc; border-radius: 2px; padding: 2px 8px; cursor: pointer;
    }
    button:focus-visible { outline: 2px solid #a5b4fc; outline-offset: 2px; }
  `;

  /** @type {{ host: HTMLElement, timer: ReturnType<typeof setTimeout> } | null} */
  let current = null;

  /**
   * @param {HTMLElement} host
   */
  function placeHost(host) {
    const style = host.style;
    style.setProperty('all', 'initial', 'important');
    style.setProperty('position', 'fixed', 'important');
    style.setProperty('inset', 'auto 16px 16px auto', 'important');
    style.setProperty('margin', '0', 'important');
    style.setProperty('padding', '0', 'important');
    style.setProperty('border', '0', 'important');
    style.setProperty('background', 'transparent', 'important');
    style.setProperty('z-index', '2147483647', 'important');
    style.setProperty('overflow', 'visible', 'important');
  }

  /**
   * @param {ShadowRoot} shadow
   * @param {Window} view
   * @returns {boolean} Whether the style sheet could be adopted.
   */
  function adoptStyles(shadow, view) {
    try {
      const Sheet = /** @type {typeof CSSStyleSheet} */ (/** @type {any} */ (view).CSSStyleSheet);
      const sheet = new Sheet();
      sheet.replaceSync(CSS);
      shadow.adoptedStyleSheets = [sheet];
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Minimal styling when constructable style sheets are unavailable.
   * @param {HTMLElement} box
   */
  function styleWithoutSheet(box) {
    const properties = {
      display: 'flex',
      gap: '12px',
      'align-items': 'center',
      padding: '10px 12px',
      background: '#1e1b4b',
      color: '#ffffff',
      font: '13px/1.4 system-ui, sans-serif',
    };
    for (const [name, value] of Object.entries(properties)) {
      box.style.setProperty(name, value);
    }
  }

  /**
   * Shows a message, replacing the previous banner.
   * @param {Document} document
   * @param {string} message
   * @param {{ undoLabel?: string, onUndo?: () => void }} [options]
   */
  function show(document, message, options = {}) {
    hide();
    const view = /** @type {Window} */ (document.defaultView);
    const host = /** @type {HTMLElement} */ (document.createElement(HOST_TAG));
    placeHost(host);
    const shadow = host.attachShadow({ mode: 'closed' });
    const adopted = adoptStyles(shadow, view);

    const box = document.createElement('div');
    box.className = 'box';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = message;
    box.append(text);
    if (options.onUndo && options.undoLabel) {
      const onUndo = options.onUndo;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = options.undoLabel;
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        hide();
        onUndo();
      });
      box.append(button);
    }
    box.addEventListener('click', hide);
    if (!adopted) {
      styleWithoutSheet(box);
    }
    shadow.append(box);

    const supportsPopover = typeof host.showPopover === 'function';
    if (supportsPopover) {
      host.setAttribute('popover', 'manual');
    }
    (document.body || document.documentElement).append(host);
    if (supportsPopover) {
      try {
        host.showPopover();
      } catch {
        // Already shown or detached: the fixed position still shows it.
      }
    }
    current = { host, timer: setTimeout(hide, HIDE_DELAY_MS) };
  }

  /** Removes the banner, if any. */
  function hide() {
    if (!current) {
      return;
    }
    clearTimeout(current.timer);
    current.host.remove();
    current = null;
  }

  return { show, hide, HOST_TAG };
})();
