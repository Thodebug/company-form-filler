// Runs on the clicked control and its ancestors only; the page is never
// scanned as a whole.
'use strict';

const CffDetection = (() => {
  const ELIGIBLE_INPUT_TYPES = new Set(['text', 'tel', 'number', 'search', 'email', 'url', 'date']);

  const TEXT_LIKE_TYPES = new Set([
    ...ELIGIBLE_INPUT_TYPES,
    'password',
    'datetime-local',
    'month',
    'week',
    'time',
  ]);

  const WEIGHT_STRONG = 3;
  const WEIGHT_WEAK = 2;
  const WEIGHT_TOKEN = 3;
  const BONUS_LENGTH = 2;
  const BONUS_PATTERN = 3;
  const BONUS_MASK = 3;
  const BONUS_PLACEHOLDER_SHAPE = 2;
  const MIN_SCORE = 3;
  const MAX_ANCESTOR_LEVELS = 3;
  const NEIGHBOR_TEXT_LIMIT = 100;
  /** Neighbour text this short is a label in all but name (table cells, grids). */
  const LABEL_LIKE_TEXT_LIMIT = 30;
  const MAX_PATTERN_LENGTH = 120;
  const BLOCK_MIN_TYPES = 3;
  const ADDRESS_MIN_TYPES = 3;
  /** Bounds the walk on very large pages. */
  const MAX_NODES = 2000;
  const MAX_SHADOW_DEPTH = 16;

  const STRONG_ATTRIBUTES = [
    'id',
    'name',
    'formcontrolname',
    'ng-reflect-name',
    'aria-label',
    'placeholder',
  ];
  const WEAK_ATTRIBUTES = ['class', 'title'];
  const ANCESTOR_ATTRIBUTES = [
    'id',
    'name',
    'class',
    'formcontrolname',
    'ng-reflect-name',
    'label',
    'aria-label',
    'title',
  ];

  /**
   * Replaced by the content script with the extension API, which also reaches
   * closed shadow roots.
   * @type {(element: Element) => ShadowRoot | null}
   */
  let shadowRootOf = (element) => element.shadowRoot || null;

  /**
   * @param {{ shadowRootOf?: (element: Element) => ShadowRoot | null }} options
   */
  function configure(options) {
    if (options.shadowRootOf) {
      shadowRootOf = options.shadowRootOf;
    }
  }

  /**
   * @param {string} text
   * @returns {string}
   */
  function normalize(text) {
    return String(text)
      .replace(/([a-z\d])([A-Z])/g, '$1 $2')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\bn\s*[°º]/g, ' numero ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /**
   * @param {Element | null | undefined} element
   * @returns {element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement}
   */
  function isEligible(element) {
    if (!element || element.nodeType !== 1) {
      return false;
    }
    const name = element.localName;
    if (name === 'input') {
      const input = /** @type {HTMLInputElement} */ (element);
      if (!ELIGIBLE_INPUT_TYPES.has(input.type) || input.readOnly) {
        return false;
      }
    } else if (name === 'textarea') {
      if (/** @type {HTMLTextAreaElement} */ (element).readOnly) {
        return false;
      }
    } else if (name !== 'select') {
      return false;
    }
    const control = /** @type {HTMLInputElement} */ (element);
    if (control.disabled) {
      return false;
    }
    try {
      return !control.matches(':disabled');
    } catch {
      return true;
    }
  }

  /**
   * @param {Element} element
   * @returns {boolean}
   */
  function isVisible(element) {
    if (element.closest('[aria-hidden="true"], [hidden]')) {
      return false;
    }
    if (isRendered(element)) {
      return true;
    }
    // Masked input components may hide the real input behind a visible host
    // carrying the mask.
    for (let current = composedParent(element), depth = 0; current && depth < 3; depth++) {
      if (Array.from(current.attributes).some((attribute) => /mask/i.test(attribute.name))) {
        return isRendered(current);
      }
      current = composedParent(current);
    }
    return false;
  }

  /**
   * Falls back to computed styles where there is no layout (tests).
   * @param {Element} element
   * @returns {boolean}
   */
  function isRendered(element) {
    const withVisibility =
      /** @type {Element & { checkVisibility?: (options?: object) => boolean }} */ (element);
    if (typeof withVisibility.checkVisibility === 'function') {
      return (
        withVisibility.checkVisibility({ visibilityProperty: true }) &&
        Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0)
      );
    }
    const view = element.ownerDocument.defaultView;
    for (
      let current = /** @type {Element | null} */ (element);
      current;
      current = composedParent(current)
    ) {
      const style = view ? view.getComputedStyle(current) : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) {
        return false;
      }
    }
    return true;
  }

  /**
   * @param {Element} element
   * @returns {Element | null}
   */
  function composedParent(element) {
    if (element.parentElement) {
      return element.parentElement;
    }
    const rootNode = element.getRootNode();
    if (rootNode && rootNode.nodeType === 11 && 'host' in rootNode) {
      return /** @type {ShadowRoot} */ (rootNode).host;
    }
    return null;
  }

  /**
   * @param {Element} element
   * @returns {boolean}
   */
  function isTextLikeControl(element) {
    if (element.localName === 'select' || element.localName === 'textarea') {
      return true;
    }
    if (element.localName !== 'input') {
      return false;
    }
    return TEXT_LIKE_TYPES.has((element.getAttribute('type') || 'text').toLowerCase());
  }

  /**
   * Live collections are evaluated lazily, so the search stops at the first
   * match instead of listing every control of a large wrapper.
   * @param {Element} wrapper
   * @param {Element} field
   * @returns {boolean}
   */
  function hasOtherControl(wrapper, field) {
    for (const tag of ['input', 'select', 'textarea']) {
      for (const control of wrapper.getElementsByTagName(tag)) {
        if (control !== field && isTextLikeControl(control)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Stops at the first wrapper shared with another field, so section titles
   * and form-wide attributes do not count as clues.
   * @param {Element} field
   * @returns {Element[]}
   */
  function ownWrappers(field) {
    /** @type {Element[]} */
    const result = [];
    let current = composedParent(field);
    while (current && result.length < MAX_ANCESTOR_LEVELS) {
      if (current.localName === 'body' || current.localName === 'html') {
        break;
      }
      if (hasOtherControl(current, field)) {
        break;
      }
      result.push(current);
      current = composedParent(current);
    }
    return result;
  }

  /**
   * @param {Node} node
   * @returns {string}
   */
  function textOf(node) {
    return (node.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * @param {Element} field
   * @param {string} id
   * @returns {Element | null}
   */
  function findById(field, id) {
    const rootNode = /** @type {Document | ShadowRoot} */ (field.getRootNode());
    return rootNode && typeof rootNode.getElementById === 'function'
      ? rootNode.getElementById(id)
      : null;
  }

  /**
   * @typedef {{ text: string, weight: number, placeholder?: boolean }} Source
   */

  /**
   * @param {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} field
   * @param {Element[]} wrappers
   * @returns {Source[]}
   */
  function collectSources(field, wrappers) {
    /** @type {Source[]} */
    const sources = [];
    /**
     * @param {string | null | undefined} text
     * @param {number} weight
     * @param {boolean} [placeholder] An example value ("nom@exemple.fr") says
     *   nothing about whose value the field holds.
     */
    const add = (text, weight, placeholder = false) => {
      if (text && text.trim()) {
        sources.push({ text: normalize(text), weight, placeholder });
      }
    };
    /**
     * @param {Element} element
     * @param {number} weight
     */
    const addDataAttributes = (element, weight) => {
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.name.startsWith('data-')) {
          add(`${attribute.name.slice(5)} ${attribute.value}`, weight);
        }
      }
    };

    for (const name of STRONG_ATTRIBUTES) {
      add(field.getAttribute(name), WEIGHT_STRONG, name === 'placeholder');
    }
    for (const name of WEAK_ATTRIBUTES) {
      add(field.getAttribute(name), WEIGHT_WEAK);
    }
    addDataAttributes(field, WEIGHT_WEAK);

    for (const label of Array.from(field.labels || [])) {
      add(textOf(label), WEIGHT_STRONG);
    }
    for (const name of ['aria-labelledby', 'aria-describedby']) {
      for (const id of (field.getAttribute(name) || '').split(/\s+/).filter(Boolean)) {
        const referenced = findById(field, id);
        if (referenced) {
          add(textOf(referenced), WEIGHT_STRONG);
        }
      }
    }

    let neighborTextTaken = false;
    for (const wrapper of wrappers) {
      for (const name of ANCESTOR_ATTRIBUTES) {
        add(wrapper.getAttribute(name), WEIGHT_WEAK);
      }
      addDataAttributes(wrapper, WEIGHT_WEAK);
      if (!neighborTextTaken) {
        const text = textOf(wrapper);
        if (text) {
          add(
            text.slice(0, NEIGHBOR_TEXT_LIMIT),
            text.length <= LABEL_LIKE_TEXT_LIMIT ? WEIGHT_STRONG : WEIGHT_WEAK,
          );
          neighborTextTaken = true;
        }
      }
    }
    return sources;
  }

  /**
   * Parses the pattern instead of executing it: the page controls this text,
   * and an arbitrary regular expression could freeze it (catastrophic
   * backtracking).
   * @param {string} pattern
   * @returns {number | null}
   */
  function patternDigitCount(pattern) {
    if (pattern.length > MAX_PATTERN_LENGTH) {
      return null;
    }
    let body = pattern.trim().replace(/^\^/, '').replace(/\$$/, '');
    const wrapped = /^\(\?:(.*)\)$/.exec(body);
    if (wrapped) {
      body = wrapped[1];
    }
    /** @type {Set<number>} */
    const counts = new Set();
    for (const alternative of body.split('|')) {
      const compact = alternative
        .replace(/\\d|\[0-9\]/g, 'D')
        .replace(/\\s[?*]|\[ \][?*]| [?*]?/g, '');
      if (!/^(?:D(?:\{\d{1,2}\})?)+$/.test(compact)) {
        return null;
      }
      let digits = 0;
      for (const match of compact.matchAll(/D(?:\{(\d{1,2})\})?/g)) {
        digits += match[1] ? Number(match[1]) : 1;
      }
      counts.add(digits);
    }
    return counts.size === 1 ? [...counts][0] : null;
  }

  /**
   * Digit slots of a mask attribute, such as PrimeNG `mask="999 999 999 99999"`
   * on the component host.
   * @param {Element[]} elements
   * @returns {number}
   */
  function maskDigitCount(elements) {
    for (const element of elements) {
      for (const attribute of Array.from(element.attributes)) {
        if (/mask/i.test(attribute.name) && attribute.value) {
          const slots = attribute.value.match(/[90#]/g);
          if (slots) {
            return slots.length;
          }
        }
      }
    }
    return 0;
  }

  /**
   * @typedef {{ bonus: number, incompatible: boolean }} Hint
   */

  /**
   * @param {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} field
   * @param {Element[]} wrappers
   * @returns {Map<string, Hint>}
   */
  function shapeHints(field, wrappers) {
    /** @type {Map<string, Hint>} */
    const hints = new Map();
    /** @param {string} type */
    const hint = (type) => {
      let entry = hints.get(type);
      if (!entry) {
        entry = { bonus: 0, incompatible: false };
        hints.set(type, entry);
      }
      return entry;
    };
    if (field.localName !== 'input') {
      return hints;
    }
    const input = /** @type {HTMLInputElement} */ (field);

    if (input.type !== 'number') {
      const maxLength = parseInt(input.getAttribute('maxlength') || '', 10);
      if (maxLength > 0) {
        if (maxLength === 14 || maxLength === 17) {
          hint('siret').bonus += BONUS_LENGTH;
        }
        if (maxLength === 9 || maxLength === 11) {
          hint('siren').bonus += BONUS_LENGTH;
        }
        if (maxLength === 5) {
          hint('postalCode').bonus += BONUS_LENGTH;
          hint('nic').bonus += BONUS_LENGTH;
        }
        if (maxLength === 27 || maxLength === 33 || maxLength === 34) {
          hint('iban').bonus += BONUS_LENGTH;
        }
        hint('siret').incompatible ||= maxLength < 14;
        hint('siren').incompatible ||= maxLength < 9;
      }
      const minLength = parseInt(input.getAttribute('minlength') || '', 10);
      if (minLength > 0) {
        hint('siret').incompatible ||= minLength > 17;
        hint('siren').incompatible ||= minLength > 11;
      }
    }

    const pattern = input.getAttribute('pattern');
    const patternDigits = pattern ? patternDigitCount(pattern) : null;
    if (patternDigits === 14) {
      hint('siret').bonus += BONUS_PATTERN;
      hint('siren').incompatible = true;
    } else if (patternDigits === 9) {
      hint('siren').bonus += BONUS_PATTERN;
      hint('siret').incompatible = true;
    } else if (patternDigits === 5) {
      hint('postalCode').bonus += BONUS_PATTERN;
    }

    const maskDigits = maskDigitCount([input, ...wrappers]);
    if (maskDigits === 14) {
      hint('siret').bonus += BONUS_MASK;
      hint('siren').incompatible = true;
    } else if (maskDigits === 9) {
      hint('siren').bonus += BONUS_MASK;
      hint('siret').incompatible = true;
    }

    const placeholder = (input.getAttribute('placeholder') || '').replace(/[\s.-]/g, '');
    if (/^[0-9x#*_]{14}$/i.test(placeholder)) {
      hint('siret').bonus += BONUS_PLACEHOLDER_SHAPE;
    } else if (/^[0-9x#*_]{9}$/i.test(placeholder)) {
      hint('siren').bonus += BONUS_PLACEHOLDER_SHAPE;
    } else if (/^FR[0-9x]{2}/i.test(placeholder) && placeholder.length >= 25) {
      hint('iban').bonus += BONUS_PLACEHOLDER_SHAPE;
    } else if (/^FR[0-9x]{11}$/i.test(placeholder)) {
      hint('vat').bonus += BONUS_PLACEHOLDER_SHAPE;
    }
    return hints;
  }

  /**
   * @typedef {{ definition: CffFieldType, keyword: RegExp, blocker: RegExp | null }} Matcher
   */

  /** @type {Matcher[] | null} */
  let matcherCache = null;
  /** @type {Map<string, Set<number>>} */
  const matchCache = new Map();
  const MATCH_CACHE_SIZE = 1000;

  /**
   * One alternation per type: a single test is much cheaper than one per
   * keyword. Built on first use, so pages where the menu never opens pay
   * nothing.
   * @returns {Matcher[]}
   */
  function matchers() {
    /** @param {RegExp[]} patterns */
    const anyOf = (patterns) =>
      new RegExp(patterns.map((pattern) => `(?:${pattern.source})`).join('|'));
    if (!matcherCache) {
      matcherCache = CffVocab.TYPES.map((definition) => ({
        definition,
        keyword: anyOf(definition.keywords),
        blocker:
          definition.blockers && definition.blockers.length ? anyOf(definition.blockers) : null,
      }));
    }
    return matcherCache;
  }

  /**
   * Cached because most clues repeat from one control to the next (classes,
   * data attributes, column titles).
   * @param {string} text
   * @returns {Set<number>} Indexes in CffVocab.TYPES.
   */
  function typesMentionedIn(text) {
    let found = matchCache.get(text);
    if (!found) {
      found = new Set();
      matchers().forEach(({ keyword, blocker }, index) => {
        if (keyword.test(text) && !(blocker && blocker.test(text))) {
          /** @type {Set<number>} */ (found).add(index);
        }
      });
      if (matchCache.size >= MATCH_CACHE_SIZE) {
        matchCache.clear();
      }
      matchCache.set(text, found);
    }
    return found;
  }

  /**
   * @param {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} field
   * @param {string} typeId
   * @returns {boolean}
   */
  function acceptsType(field, typeId) {
    if (field.localName === 'textarea') {
      return CffVocab.TEXTAREA_TYPES.includes(typeId);
    }
    if (field.localName === 'input') {
      const only = CffVocab.INPUT_TYPE_ONLY[/** @type {HTMLInputElement} */ (field).type];
      return !only || only.includes(typeId);
    }
    return true;
  }

  /**
   * @typedef {{
   *   type: string | null,
   *   category: 'strong' | 'address' | 'generic' | null,
   *   scores: Record<string, number>,
   * }} TypeDetection
   */

  /**
   * @param {Element | null | undefined} element
   * @returns {TypeDetection}
   */
  function detectType(element) {
    /** @type {TypeDetection} */
    const result = { type: null, category: null, scores: {} };
    if (!isEligible(element)) {
      return result;
    }
    const field = element;
    const wrappers = ownWrappers(field);
    const sources = collectSources(field, wrappers);
    const hints = shapeHints(field, wrappers);
    const autocomplete = (field.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/);
    const inputType =
      field.localName === 'input' ? /** @type {HTMLInputElement} */ (field).type : '';

    const mentions = sources.map((source) => typesMentionedIn(source.text));
    /** @type {{ id: string, score: number, order: number }[]} */
    const candidates = [];
    CffVocab.TYPES.forEach((definition, order) => {
      if (!acceptsType(field, definition.id)) {
        return;
      }
      let score = 0;
      let evidence = false;
      sources.forEach((source, index) => {
        if (mentions[index].has(order)) {
          score += source.weight;
          evidence = true;
        }
      });
      if ((definition.autocomplete || []).some((token) => autocomplete.includes(token))) {
        score += WEIGHT_TOKEN;
        evidence = true;
      }
      if ((definition.inputTypes || []).includes(inputType)) {
        score += WEIGHT_TOKEN;
        evidence = true;
      }
      const hint = hints.get(definition.id);
      if (hint) {
        score += hint.bonus;
      }
      if (score > 0) {
        result.scores[definition.id] = score;
      }
      if (evidence && score >= MIN_SCORE && !(hint && hint.incompatible)) {
        candidates.push({ id: definition.id, score, order });
      }
    });
    if (candidates.length === 0) {
      return result;
    }
    candidates.sort((a, b) => b.score - a.score || a.order - b.order);
    let type = candidates[0].id;
    type = refineType(field, type, sources);
    result.type = type;
    const definition = CffVocab.BY_ID.get(type);
    result.category = definition ? definition.category : null;
    return result;
  }

  /**
   * @param {Element} field
   * @param {string} type
   * @param {Source[]} sources
   * @returns {string}
   */
  function refineType(field, type, sources) {
    if (type === 'addressLine1' && field.localName === 'textarea') {
      return 'fullAddress';
    }
    /** @param {RegExp[]} patterns */
    const mentions = (patterns) =>
      sources.some(
        (source) => !source.placeholder && patterns.some((pattern) => pattern.test(source.text)),
      );
    if (type === 'email' && mentions([CffVocab.PERSON_WORDS])) {
      return 'managerEmail';
    }
    const mobile = /** @type {CffFieldType} */ (CffVocab.BY_ID.get('mobile'));
    if (type === 'phone' && mentions([CffVocab.PERSON_WORDS, ...mobile.keywords])) {
      return 'mobile';
    }
    return type;
  }

  /**
   * @param {string} type
   * @returns {'strong' | 'address' | 'generic'}
   */
  function categoryOf(type) {
    const definition = CffVocab.BY_ID.get(type);
    return definition ? definition.category : 'generic';
  }

  /**
   * @param {Element} root
   * @returns {Element[] | null}
   */
  function collectControls(root) {
    /** @type {Element[]} */
    const controls = [];
    let visited = 0;
    /** @type {Array<{ node: Element | ShadowRoot, depth: number }>} */
    const stack = [{ node: root, depth: 0 }];
    while (stack.length) {
      const { node, depth } = /** @type {{ node: Element | ShadowRoot, depth: number }} */ (
        stack.pop()
      );
      if (++visited > MAX_NODES) {
        return null;
      }
      if (node.nodeType === 1 && isEligible(/** @type {Element} */ (node))) {
        controls.push(/** @type {Element} */ (node));
      }
      const children = Array.from(node.children);
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ node: children[i], depth });
      }
      if (node.nodeType === 1 && depth < MAX_SHADOW_DEPTH) {
        const shadow = shadowRootOf(/** @type {Element} */ (node));
        if (shadow) {
          stack.push({ node: shadow, depth: depth + 1 });
        }
      }
    }
    return controls;
  }

  /**
   * @typedef {{ element: Element, type: string }} TypedField
   * @typedef {{
   *   root: Element,
   *   qualification: 'company' | 'address' | null,
   *   fields: TypedField[],
   * }} Block
   */

  /**
   * @param {Element | null | undefined} element
   * @returns {Block | null}
   */
  function findBlock(element) {
    if (!element || element.nodeType !== 1) {
      return null;
    }
    /** @type {Map<Element, string | null>} */
    const typeCache = new Map();
    /** @param {Element} control */
    const typeOf = (control) => {
      if (!typeCache.has(control)) {
        typeCache.set(control, isVisible(control) ? detectType(control).type : null);
      }
      return /** @type {string | null} */ (typeCache.get(control));
    };
    /** @param {Element[]} controls */
    const typesOf = (controls) => new Set(controls.map(typeOf).filter((type) => type !== null));

    let block = null;
    /** @type {Element[]} */
    let controls = [];
    for (let current = composedParent(element); current; current = composedParent(current)) {
      if (current.localName === 'body' || current.localName === 'html') {
        return null;
      }
      const found = collectControls(current);
      if (!found) {
        return null;
      }
      if (typesOf(found).size >= BLOCK_MIN_TYPES) {
        block = current;
        controls = found;
        break;
      }
      if (current.localName === 'form') {
        return null;
      }
    }
    if (!block) {
      return null;
    }

    // Growing until a type repeats takes a sectioned form whole but stops
    // between billing and shipping addresses.
    let types = typesOf(controls);
    while (block.localName !== 'form') {
      const next = composedParent(block);
      if (!next || next.localName === 'body' || next.localName === 'html') {
        break;
      }
      const nextControls = collectControls(next);
      if (!nextControls) {
        break;
      }
      const known = new Set(controls);
      /** @type {Set<string>} */
      const newTypes = new Set();
      // Stops at the first repeat: a large parent form is rarely read whole.
      const repeats = nextControls.some((control) => {
        if (known.has(control)) {
          return false;
        }
        const type = typeOf(control);
        if (type === null) {
          return false;
        }
        newTypes.add(type);
        return types.has(type);
      });
      if (repeats) {
        break;
      }
      block = next;
      controls = nextControls;
      types = new Set([...types, ...newTypes]);
    }

    return {
      root: block,
      qualification: qualify(types),
      fields: controls
        .map((control) => ({ element: control, type: typeOf(control) }))
        .filter((/** @type {{ type: string | null }} */ field) => field.type !== null)
        .map((field) => /** @type {TypedField} */ (field)),
    };
  }

  /**
   * @param {Set<string>} types
   * @returns {'company' | 'address' | null}
   */
  function qualify(types) {
    if ([...types].some((type) => categoryOf(type) === 'strong')) {
      return 'company';
    }
    const address = [...types].filter((type) => categoryOf(type) === 'address');
    if (address.length >= ADDRESS_MIN_TYPES && types.has('postalCode') && types.has('city')) {
      return 'address';
    }
    return null;
  }

  return {
    configure,
    normalize,
    isEligible,
    isVisible,
    composedParent,
    patternDigitCount,
    detectType,
    categoryOf,
    findBlock,
  };
})();
