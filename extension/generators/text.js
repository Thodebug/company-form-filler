/**
 * Text helpers for generated names, slugs and codes.
 */
'use strict';

const CffText = (() => {
  /**
   * Removes diacritics.
   * @param {string} text
   * @returns {string}
   */
  function stripAccents(text) {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /**
   * Uppercase ASCII, keeping only letters, digits, spaces, apostrophes and
   * hyphens: the shape of a legal name in the French business register.
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

  /** Words that never end a shortened name: "PENSION CANINE DU" reads badly. */
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
   * Keeps the first words whose total length, separators included, fits
   * `maxLength`, without a trailing small word. A single word too long is cut.
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
   * Lowercase ASCII slug with hyphens, cut between words at `maxLength`.
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
   * "BOULANGERIE DU CENTRE" to "Boulangerie du Centre".
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
   * Shortens a name to `maxLength` by dropping trailing words, then by
   * cutting the last remaining word if needed.
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
   * First `count` ASCII letters of a name, padded with X.
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
