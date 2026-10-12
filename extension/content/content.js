// Firefox asks for the verdict while the menu is shown (menus.onShown and
// getTargetElement). Chromium has no onShown, so the verdict is pushed as soon
// as the interaction starts, before the menu opens.
'use strict';

(() => {
  const root = /** @type {typeof globalThis & { CompanyFormFillerLoaded?: boolean }} */ (
    globalThis
  );
  if (root.CompanyFormFillerLoaded) {
    return;
  }
  root.CompanyFormFillerLoaded = true;

  const api = /** @type {CffExtensionApi} */ (root.browser || root.chrome);
  const menus = api.menus;
  const getTargetElement =
    menus && typeof menus.getTargetElement === 'function'
      ? menus.getTargetElement.bind(menus)
      : null;
  const MAX_SHADOW_DEPTH = 16;
  /** A focus or menu event this soon after a report belongs to the same gesture. */
  const GESTURE_WINDOW_MS = 500;

  /**
   * Chromium exposes closed roots through chrome.dom, Firefox on the element.
   * @param {Element} element
   * @returns {ShadowRoot | null}
   */
  function openOrClosedShadowRoot(element) {
    try {
      if (api.dom && typeof api.dom.openOrClosedShadowRoot === 'function') {
        return api.dom.openOrClosedShadowRoot(/** @type {HTMLElement} */ (element)) || null;
      }
    } catch {
      // Not an element that can host a shadow root.
    }
    const withRoot = /** @type {Element & { openOrClosedShadowRoot?: ShadowRoot | null }} */ (
      element
    );
    return withRoot.openOrClosedShadowRoot || element.shadowRoot || null;
  }

  CffDetection.configure({ shadowRootOf: openOrClosedShadowRoot });

  /**
   * @param {string} name
   * @param {Array<string | number>} [substitutions]
   * @returns {string}
   */
  function message(name, substitutions) {
    return api.i18n.getMessage(name, substitutions && substitutions.map(String));
  }

  /** @type {Element | null} */
  let lastTarget = null;
  /** Time of the last full report (block included), for the same gesture. */
  let lastFullReport = 0;
  /** Last verdict sent, so that moving focus within a form does not wake the background. */
  let lastSent = '';
  /** The fill focuses each field in turn: those focus events are not the user's. */
  let filling = false;

  /** @type {CffUndoEntry[]} */
  let pendingUndo = [];

  /** Ties the company of the tab to this document: a new page starts afresh. */
  const pageId = Array.from(crypto.getRandomValues(new Uint32Array(2)), String).join('-');

  /**
   * @param {Element} start
   * @param {number} x
   * @param {number} y
   * @returns {Element}
   */
  function deepElementFromPoint(start, x, y) {
    let element = start;
    for (let depth = 0; depth < MAX_SHADOW_DEPTH; depth++) {
      const shadow = openOrClosedShadowRoot(element);
      const inner = shadow ? shadow.elementFromPoint(x, y) : null;
      if (!inner || inner === element) {
        break;
      }
      element = inner;
    }
    return element;
  }

  /** @returns {Element | null} */
  function deepActiveElement() {
    let element = document.activeElement;
    for (let depth = 0; element && depth < MAX_SHADOW_DEPTH; depth++) {
      const shadow = openOrClosedShadowRoot(element);
      const inner = shadow ? shadow.activeElement : null;
      if (!inner || inner === element) {
        break;
      }
      element = inner;
    }
    return element;
  }

  /**
   * @param {Element} ancestor
   * @param {Element} node
   * @returns {boolean}
   */
  function composedContains(ancestor, node) {
    for (
      let current = /** @type {Element | null} */ (node);
      current;
      current = CffDetection.composedParent(current)
    ) {
      if (current === ancestor) {
        return true;
      }
    }
    return false;
  }

  /**
   * @param {MouseEvent} event
   * @returns {Element | null}
   */
  function targetFromPointer(event) {
    const first = event.composedPath().find((node) => node instanceof Node && node.nodeType === 1);
    if (!first) {
      return null;
    }
    return deepElementFromPoint(/** @type {Element} */ (first), event.clientX, event.clientY);
  }

  /**
   * @param {unknown} targetElementId
   * @returns {Element | null}
   */
  function resolveTarget(targetElementId) {
    if (getTargetElement && typeof targetElementId === 'number') {
      const element = getTargetElement(targetElementId);
      if (element) {
        if (CffDetection.isEligible(element)) {
          return element;
        }
        // The target may be the host of a closed shadow root: the right
        // click focused the real control inside it.
        const active = deepActiveElement();
        return active && composedContains(element, active) ? active : element;
      }
    }
    if (lastTarget && lastTarget.isConnected) {
      return lastTarget;
    }
    return deepActiveElement();
  }

  /** @returns {boolean} */
  function canUndo() {
    return pendingUndo.some((entry) => entry.element.isConnected);
  }

  /**
   * @param {Element | null} element
   * @param {{ withBlock: boolean }} options
   * @returns {CffVerdict}
   */
  function verdictFor(element, options) {
    /** @type {CffVerdict} */
    const verdict = { field: null, block: null, canUndo: canUndo() };
    if (!element || !CffDetection.isEligible(element)) {
      return verdict;
    }
    const detection = CffDetection.detectType(element);
    if (detection.category === 'strong' || detection.category === 'address') {
      verdict.field = detection.type;
    }
    if (options.withBlock) {
      const block = CffDetection.findBlock(element);
      verdict.block = block ? block.qualification : null;
    }
    return verdict;
  }

  /**
   * @param {Element | null} element
   * @param {{ withBlock: boolean }} options
   */
  function report(element, options) {
    lastTarget = element;
    if (options.withBlock) {
      lastFullReport = Date.now();
    }
    const verdict = verdictFor(element, options);
    const key = JSON.stringify(verdict);
    if (!options.withBlock && key === lastSent) {
      return;
    }
    lastSent = key;
    try {
      const sent = api.runtime.sendMessage({ type: 'cff:verdict', verdict });
      if (sent && typeof sent.catch === 'function') {
        sent.catch(() => {});
      }
    } catch {
      // Orphaned script after an extension reload or update.
    }
  }

  /**
   * @param {string} text
   * @param {boolean} [withUndo]
   */
  function showBanner(text, withUndo = false) {
    CffBanner.show(
      document,
      text,
      withUndo ? { undoLabel: message('bannerUndo'), onUndo: undoLastFill } : {},
    );
  }

  /**
   * @param {string} type
   * @returns {string}
   */
  function typeLabel(type) {
    return message(`type_${type}`) || type;
  }

  /**
   * @param {{ filled: number, skipped: number }} result
   * @param {TypedFieldRequest | null} single
   * @returns {string}
   */
  function resultMessage(result, single) {
    if (single) {
      return result.filled
        ? message('bannerFieldFilled', [typeLabel(single.type)])
        : message('bannerFieldSkipped');
    }
    const filled = message(result.filled === 1 ? 'bannerOneFilled' : 'bannerManyFilled', [
      result.filled,
    ]);
    if (!result.skipped) {
      return filled;
    }
    const skipped = message(result.skipped === 1 ? 'bannerOneSkipped' : 'bannerManySkipped', [
      result.skipped,
    ]);
    return `${filled}, ${skipped}`;
  }

  /**
   * @typedef {{ element: Element, type: string }} TypedFieldRequest
   */

  /**
   * Detects again: the menu may show a stale verdict.
   * @param {Element | null} element
   * @param {'field' | 'form'} action
   * @param {Company | null} company
   * @returns {Promise<{ ok: boolean, filled?: number, skipped?: number }>}
   */
  async function fillFromMenu(element, action, company) {
    if (!company || !element || !CffDetection.isEligible(element)) {
      showBanner(message('bannerNotRecognized'));
      return { ok: false };
    }
    /** @type {TypedFieldRequest[]} */
    let fields;
    /** @type {'company' | 'address' | 'field'} */
    let mode = 'field';
    /** @type {TypedFieldRequest | null} */
    let single = null;
    if (action === 'field') {
      const detection = CffDetection.detectType(element);
      if (detection.category !== 'strong' && detection.category !== 'address') {
        showBanner(message('bannerNotRecognized'));
        return { ok: false };
      }
      single = { element, type: /** @type {string} */ (detection.type) };
      fields = [single];
    } else {
      const block = CffDetection.findBlock(element);
      if (!block || !block.qualification) {
        showBanner(message('bannerNotRecognized'));
        return { ok: false };
      }
      fields = [...block.fields, ...CffDetection.companionAddress(block)];
      mode = block.qualification;
    }
    filling = true;
    /** @type {Awaited<ReturnType<typeof CffFill.fill>>} */
    let result;
    try {
      result = await CffFill.fill(fields, company, { mode, focusBack: element });
    } finally {
      filling = false;
    }
    if (result.undo.length) {
      pendingUndo = result.undo;
    }
    showBanner(resultMessage(result, single), result.undo.length > 0);
    return { ok: true, filled: result.filled, skipped: result.skipped };
  }

  function undoLastFill() {
    const restored = CffFill.undo(pendingUndo);
    pendingUndo = [];
    showBanner(message(restored === 1 ? 'bannerOneRestored' : 'bannerManyRestored', [restored]));
    return restored;
  }

  if (!getTargetElement) {
    const options = { capture: true, passive: true };
    window.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button === 2) {
          report(targetFromPointer(event), { withBlock: true });
        }
      },
      options,
    );
    window.addEventListener(
      'contextmenu',
      (event) => {
        const fromPointer = event.clientX !== 0 || event.clientY !== 0;
        const target = fromPointer ? targetFromPointer(event) : deepActiveElement();
        // Already reported by the right press or the menu key of this gesture.
        if (target !== lastTarget || Date.now() - lastFullReport >= GESTURE_WINDOW_MS) {
          report(target, { withBlock: true });
        }
      },
      options,
    );
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
          report(deepActiveElement(), { withBlock: true });
        }
      },
      options,
    );
    // The menu only shows on editable elements. The costlier block evaluation
    // is left to the right press, which comes right before the menu.
    window.addEventListener(
      'focusin',
      () => {
        if (filling || Date.now() - lastFullReport < GESTURE_WINDOW_MS) {
          return;
        }
        const element = deepActiveElement();
        if (element && CffDetection.isEligible(element)) {
          report(element, { withBlock: false });
        }
      },
      options,
    );
    // Another frame or tab may have changed the menu since the last verdict.
    window.addEventListener('blur', (event) => {
      if (event.target === window) {
        lastSent = '';
      }
    });
  }

  api.runtime.onMessage.addListener(
    /**
     * @param {unknown} incoming
     * @param {unknown} _sender
     * @param {(response: unknown) => void} sendResponse
     */
    (incoming, _sender, sendResponse) => {
      if (!incoming || typeof incoming !== 'object' || !('type' in incoming)) {
        return undefined;
      }
      const request =
        /** @type {{ type: unknown, targetElementId?: unknown, action?: unknown, company?: unknown }} */ (
          incoming
        );
      switch (request.type) {
        case 'cff:evaluate':
          sendResponse({
            verdict: verdictFor(resolveTarget(request.targetElementId), { withBlock: true }),
          });
          return undefined;
        case 'cff:fill': {
          const action = request.action === 'form' ? 'form' : 'field';
          fillFromMenu(
            resolveTarget(request.targetElementId),
            action,
            /** @type {Company | null} */ (request.company || null),
          ).then(sendResponse, () => sendResponse({ ok: false }));
          return true;
        }
        case 'cff:page-id':
          sendResponse({ page: pageId });
          return undefined;
        case 'cff:undo':
          sendResponse({ restored: undoLastFill() });
          return undefined;
        default:
          return undefined;
      }
    },
  );
})();
