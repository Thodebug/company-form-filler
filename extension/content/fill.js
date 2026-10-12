/**
 * Writes company values into fields so that the page and its framework
 * (React, Angular, Vue, input masks) take them into account, and keeps
 * what is needed to undo the last fill.
 */
'use strict';

const CffFill = (() => {
  /** Geography first: a page may reload departments when the country changes,
   * or fill the city when the postal code changes. */
  const FIRST_TYPES = ['country', 'region', 'department', 'postalCode', 'city'];
  /** Delay before checking whether the page changed what was written. */
  const SETTLE_DELAY_MS = 150;
  /** Types written in address mode, besides the address category. */
  const ADDRESS_MODE_CATEGORIES = new Set(['address', 'generic']);

  /**
   * @typedef {{ element: Element, type: string }} TypedField
   * @typedef {{ element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, previous: string }} UndoEntry
   * @typedef {{ filled: number, skipped: number, undo: UndoEntry[] }} FillResult
   * @typedef {HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement} Control
   */

  /**
   * Lowercase ASCII words, for comparing option labels and written values.
   * @param {string} text
   * @returns {string}
   */
  function normalizeText(text) {
    return String(text)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /**
   * Compact form used to check that a field holds what was written, even
   * when an input mask added separators.
   * @param {string} text
   * @returns {string}
   */
  function compact(text) {
    return normalizeText(text).replace(/ /g, '');
  }

  /**
   * @param {HTMLSelectElement} select
   * @param {string[]} candidates
   * @param {string} type
   * @returns {number} Option index, or -1.
   */
  function findOption(select, candidates, type) {
    const options = Array.from(select.options).map((option, index) => ({
      index,
      disabled: option.disabled,
      value: normalizeText(option.value),
      text: normalizeText(option.text),
    }));
    const usable = options.filter((option) => !option.disabled && (option.value || option.text));
    const wanted = candidates.map(normalizeText).filter(Boolean);
    for (const candidate of wanted) {
      const exact = usable.find(
        (option) => option.value === candidate || option.text === candidate,
      );
      if (exact) {
        return exact.index;
      }
    }
    for (const candidate of wanted) {
      const prefix = usable.find(
        (option) =>
          option.text.startsWith(`${candidate} `) || option.value.startsWith(`${candidate} `),
      );
      if (prefix) {
        return prefix.index;
      }
    }
    if (type === 'headcount') {
      return findHeadcountOption(usable, wanted);
    }
    return -1;
  }

  /**
   * Matches a headcount band on its lower bound ("3 à 5 salariés" and
   * "3-5" or "De 3 à 5").
   * @param {Array<{ index: number, value: string, text: string }>} options
   * @param {string[]} wanted
   * @returns {number}
   */
  function findHeadcountOption(options, wanted) {
    const label = wanted.find((candidate) => /\d/.test(candidate) && candidate.length > 2) || '';
    const lowerBound = (label.match(/\d+/) || [''])[0];
    if (!lowerBound) {
      return -1;
    }
    const option = options.find(
      (candidate) => (candidate.text.match(/\d+/) || [''])[0] === lowerBound,
    );
    return option ? option.index : -1;
  }

  /**
   * Current value of a control, as a string.
   * @param {Control} control
   * @returns {string}
   */
  function currentValue(control) {
    return control.value;
  }

  /**
   * Fires the events a user edit fires, minus the ones the browser already
   * fired.
   * @param {Control} control
   * @param {string[]} types
   */
  function dispatch(control, types) {
    for (const type of types) {
      control.dispatchEvent(new Event(type, { bubbles: true }));
    }
  }

  /**
   * Writes text into an input or a textarea. Tries execCommand('insertText')
   * first: it goes through the browser editing pipeline, fires trusted
   * beforeinput and input events and keeps Ctrl+Z working. Falls back to a
   * direct assignment followed by an input event.
   * @param {HTMLInputElement | HTMLTextAreaElement} control
   * @param {string} value
   * @returns {boolean} Whether the field holds the value.
   */
  function writeText(control, value) {
    const document = control.ownerDocument;
    let inserted;
    try {
      control.select();
      inserted = document.execCommand('insertText', false, value);
    } catch {
      inserted = false;
    }
    if (!inserted || compact(currentValue(control)) !== compact(value)) {
      control.value = value;
      dispatch(control, ['input']);
    }
    return compact(currentValue(control)) === compact(value);
  }

  /**
   * @param {HTMLSelectElement} select
   * @param {number} index
   */
  function writeOption(select, index) {
    select.selectedIndex = index;
    dispatch(select, ['input']);
  }

  /**
   * Writes one field: focus, value, change, blur.
   * @param {TypedField} field
   * @param {Company} company
   * @returns {{ status: 'filled' | 'skipped' | 'empty', previous: string, written: string }}
   */
  function writeField(field, company) {
    const control = /** @type {Control} */ (field.element);
    const previous = currentValue(control);
    const hints = CffFormat.hintsOf(control);
    control.focus({ preventScroll: true });

    if (control.localName === 'select') {
      const select = /** @type {HTMLSelectElement} */ (control);
      const candidates = CffFormat.optionCandidates(field.type, company).filter(Boolean);
      if (candidates.length === 0) {
        return { status: 'empty', previous, written: previous };
      }
      const index = findOption(select, candidates, field.type);
      if (index < 0) {
        return { status: 'skipped', previous, written: previous };
      }
      writeOption(select, index);
      dispatch(select, ['change']);
      select.blur();
      return { status: 'filled', previous, written: select.value };
    }

    const text = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (control);
    const candidates = CffFormat.candidatesFor(field.type, company, hints).filter(Boolean);
    if (candidates.length === 0) {
      return { status: 'empty', previous, written: previous };
    }
    const value = CffFormat.choose(candidates, hints);
    if (value === null) {
      return { status: 'skipped', previous, written: previous };
    }
    if (!writeText(text, value)) {
      text.value = previous;
      dispatch(text, ['input', 'change']);
      text.blur();
      return { status: 'skipped', previous, written: previous };
    }
    dispatch(text, ['change']);
    text.blur();
    return { status: 'filled', previous, written: currentValue(text) };
  }

  /**
   * @param {TypedField[]} fields
   * @returns {TypedField[]}
   */
  function inFillOrder(fields) {
    const rank = (/** @type {TypedField} */ field) => {
      const index = FIRST_TYPES.indexOf(field.type);
      return index < 0 ? FIRST_TYPES.length : index;
    };
    return fields
      .map((field, position) => ({ field, position }))
      .sort((a, b) => rank(a.field) - rank(b.field) || a.position - b.position)
      .map((entry) => entry.field);
  }

  /**
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Fills fields with the values of a company.
   * @param {TypedField[]} fields
   * @param {Company} company
   * @param {{ mode: 'company' | 'address' | 'field', focusBack?: Element | null, settleDelay?: number }} options
   * @returns {Promise<FillResult>}
   */
  async function fill(fields, company, options) {
    const selected =
      options.mode === 'address'
        ? fields.filter((field) => ADDRESS_MODE_CATEGORIES.has(CffDetection.categoryOf(field.type)))
        : fields;
    /** @type {UndoEntry[]} */
    const undo = [];
    /** @type {Array<{ field: TypedField, written: string }>} */
    const written = [];
    let skipped = 0;

    for (const field of inFillOrder(selected)) {
      const result = writeField(field, company);
      if (result.status === 'filled') {
        undo.push({ element: /** @type {Control} */ (field.element), previous: result.previous });
        written.push({ field, written: result.written });
      } else if (result.status === 'skipped') {
        skipped++;
      }
    }

    // Some pages rewrite a field after a change elsewhere (city from postal
    // code): write those again once the page has settled.
    if (written.length > 1) {
      await wait(options.settleDelay ?? SETTLE_DELAY_MS);
      for (const entry of written) {
        const control = /** @type {Control} */ (entry.field.element);
        if (control.isConnected && currentValue(control) !== entry.written) {
          writeField(entry.field, company);
        }
      }
    }

    const focusBack = options.focusBack;
    if (focusBack && focusBack.isConnected) {
      /** @type {HTMLElement} */ (focusBack).focus({ preventScroll: true });
    }
    return { filled: written.length, skipped, undo };
  }

  /**
   * Restores the values a fill replaced, in reverse order.
   * @param {UndoEntry[]} entries
   * @returns {number} Number of restored fields.
   */
  function undo(entries) {
    let restored = 0;
    for (const { element, previous } of [...entries].reverse()) {
      if (!element.isConnected) {
        continue;
      }
      if (element.localName === 'select') {
        const select = /** @type {HTMLSelectElement} */ (element);
        const index = Array.from(select.options).findIndex((option) => option.value === previous);
        writeOption(select, index);
      } else {
        element.value = previous;
        dispatch(element, ['input']);
      }
      dispatch(element, ['change']);
      restored++;
    }
    return restored;
  }

  return { fill, undo, findOption, normalizeText };
})();
