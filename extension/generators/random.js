/**
 * Uniform and weighted random draws backed by the Web Crypto API.
 *
 * Every draw goes through `crypto.getRandomValues`; there is no seed and no
 * reproducibility, on purpose.
 */
'use strict';

const CffRandom = (() => {
  const UINT32_RANGE = 2 ** 32;
  /** Random words are fetched by batches: one crypto call per draw is slow. */
  const POOL_SIZE = 1024;
  const pool = new Uint32Array(POOL_SIZE);
  let poolIndex = POOL_SIZE;

  /**
   * @returns {number} Uniform 32-bit unsigned integer.
   */
  function nextUint32() {
    if (poolIndex >= POOL_SIZE) {
      globalThis.crypto.getRandomValues(pool);
      poolIndex = 0;
    }
    return pool[poolIndex++];
  }

  /**
   * Returns a uniformly distributed integer in [0, max).
   * @param {number} max Exclusive upper bound, between 1 and 2^32.
   * @returns {number}
   */
  function int(max) {
    if (!Number.isInteger(max) || max < 1 || max > UINT32_RANGE) {
      throw new RangeError(`Invalid bound ${max}`);
    }
    // Rejection sampling removes the modulo bias.
    const limit = UINT32_RANGE - (UINT32_RANGE % max);
    for (;;) {
      const value = nextUint32();
      if (value < limit) {
        return value % max;
      }
    }
  }

  /**
   * Integer in [min, max], both included.
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  function between(min, max) {
    return min + int(max - min + 1);
  }

  /**
   * @param {number} probability Between 0 and 1.
   * @returns {boolean}
   */
  function chance(probability) {
    return int(1_000_000) < probability * 1_000_000;
  }

  /**
   * @template T
   * @param {readonly T[]} items Non-empty list.
   * @returns {T}
   */
  function pick(items) {
    if (items.length === 0) {
      throw new RangeError('Cannot pick from an empty list');
    }
    return items[int(items.length)];
  }

  /**
   * Cumulative weights per list and weight function: the same lists (communes
   * of a department, departments) are drawn from again and again.
   * @type {WeakMap<readonly unknown[], { weightOf: Function, cumulative: number[] }>}
   */
  const cumulativeCache = new WeakMap();

  /**
   * @template T
   * @param {readonly T[]} items
   * @param {(item: T) => number} weightOf
   * @returns {number[]}
   */
  function cumulativeWeights(items, weightOf) {
    const cached = cumulativeCache.get(items);
    if (cached && cached.weightOf === weightOf) {
      return cached.cumulative;
    }
    let total = 0;
    const cumulative = items.map((item) => {
      total += Math.max(0, Math.round(weightOf(item)));
      return total;
    });
    cumulativeCache.set(items, { weightOf, cumulative });
    return cumulative;
  }

  /**
   * Picks an item with a probability proportional to its weight. Pass a
   * stable `weightOf` function to benefit from the cache.
   * @template T
   * @param {readonly T[]} items
   * @param {(item: T) => number} weightOf Non-negative weights, at least one positive.
   * @returns {T}
   */
  function weighted(items, weightOf) {
    const cumulative = cumulativeWeights(items, weightOf);
    const total = cumulative.length ? cumulative[cumulative.length - 1] : 0;
    if (total < 1) {
      throw new RangeError('No positive weight');
    }
    const target = int(total);
    // First index whose cumulative weight exceeds the target.
    let low = 0;
    let high = cumulative.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (cumulative[middle] > target) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    return items[low];
  }

  /**
   * @param {number} count
   * @returns {string}
   */
  function digits(count) {
    let result = '';
    for (let i = 0; i < count; i++) {
      result += String(int(10));
    }
    return result;
  }

  /**
   * @param {number} count
   * @returns {string}
   */
  function letters(count) {
    let result = '';
    for (let i = 0; i < count; i++) {
      result += String.fromCharCode(65 + int(26));
    }
    return result;
  }

  /**
   * Version 4 UUID, built by hand: crypto.randomUUID only exists in secure
   * contexts.
   * @returns {string}
   */
  function uuid() {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return { int, between, chance, pick, weighted, digits, letters, uuid };
})();
