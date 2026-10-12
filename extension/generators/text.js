'use strict';

const CffText = (() => {
  /**
   * The range is U+0300 to U+036F, combining diacritical marks.
   * @param {string} text
   * @returns {string}
   */
  function stripAccents(text) {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /**
   * Shape of a legal name in the French business register.
   * @param {string} text
   * @returns {string}
   */
  function registerCase(text) {
    return stripAccents(text)
      .toUpperCase()
      .replace(/[^A-Z0-9' -]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Never left at the end of a shortened name: "PENSION CANINE DU" reads badly.
  const SMALL_WORDS = new Set([
    'de',
    'du',
    'des',
    'la',
    'le',
    'les',
    'et',
    'en',
    'au',
    'aux',
    'l',
    'd',
    "l'",
    "d'",
  ]);

  /**
   * @param {string[]} words
   * @param {string} separator
   * @param {number} maxLength
   * @returns {string}
   */
  function keepWords(words, separator, maxLength) {
    const kept = [...words];
    while (kept.length > 1 && kept.join(separator).length > maxLength) {
      kept.pop();
    }
    while (kept.length > 1 && SMALL_WORDS.has(kept[kept.length - 1].toLowerCase())) {
      kept.pop();
    }
    return kept.join(separator).slice(0, maxLength);
  }

  /**
   * @param {string} text
   * @param {number} maxLength
   * @returns {string}
   */
  function slug(text, maxLength) {
    const words = stripAccents(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    return keepWords(words, '-', maxLength);
  }

  /**
   * @param {string} text
   * @returns {string}
   */
  function titleCase(text) {
    return text
      .toLowerCase()
      .split(' ')
      .map((word, index) => {
        if (index > 0 && SMALL_WORDS.has(word)) {
          return word;
        }
        return word.replace(
          /(^|[-'])([a-z])/g,
          (_match, before, letter) => before + letter.toUpperCase(),
        );
      })
      .join(' ');
  }

  /**
   * @param {string} text
   * @param {number} maxLength
   * @returns {string}
   */
  function shorten(text, maxLength) {
    return keepWords(text.split(/(?<=')|\s+/).filter(Boolean), ' ', maxLength)
      .replace(/' /g, "'")
      .trim();
  }

  /**
   * @param {string} text
   * @param {number} count
   * @returns {string}
   */
  function lettersOf(text, count) {
    return stripAccents(text)
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, count)
      .padEnd(count, 'X');
  }

  return { stripAccents, registerCase, slug, titleCase, shorten, lettersOf };
})();
