// The tests check these against independent validators in test/validators.js.
'use strict';

const CffChecksums = (() => {
  /**
   * @param {string} digits
   * @returns {boolean}
   */
  function isLuhnValid(digits) {
    if (!/^\d+$/.test(digits)) {
      return false;
    }
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let digit = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }
      sum += digit;
    }
    return sum % 10 === 0;
  }

  /**
   * @param {string} partial
   * @returns {string}
   */
  function luhnCheckDigit(partial) {
    for (let digit = 0; digit <= 9; digit++) {
      if (isLuhnValid(partial + digit)) {
        return String(digit);
      }
    }
    throw new Error('Unreachable: a Luhn check digit always exists');
  }

  /**
   * Digit by digit: the input exceeds Number precision.
   * @param {string} digits
   * @returns {number}
   */
  function mod97(digits) {
    let remainder = 0;
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
    return remainder;
  }

  /**
   * French intra-community VAT key: (12 + 3 × (SIREN mod 97)) mod 97.
   * @param {string} siren
   * @returns {string} Two digits.
   */
  function vatKey(siren) {
    return String((12 + 3 * (Number(siren) % 97)) % 97).padStart(2, '0');
  }

  /**
   * French RIB key: 97 - ((89 × bank + 15 × branch + 3 × account) mod 97).
   * Letters in the account number are not supported.
   * @param {string} bankCode
   * @param {string} branchCode
   * @param {string} accountNumber
   * @returns {string} Two digits.
   */
  function ribKey(bankCode, branchCode, accountNumber) {
    const remainder =
      (89 * Number(bankCode) + 15 * Number(branchCode) + 3 * mod97(accountNumber)) % 97;
    return String(97 - remainder).padStart(2, '0');
  }

  /**
   * ISO 13616: A = 10 to Z = 35.
   * @param {string} text
   * @returns {string}
   */
  function lettersToDigits(text) {
    return text.toUpperCase().replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  }

  /**
   * ISO 13616: 98 - (BBAN + country + "00") mod 97.
   * @param {string} country Two letters.
   * @param {string} bban
   * @returns {string} Two digits.
   */
  function ibanKey(country, bban) {
    const remainder = mod97(lettersToDigits(`${bban}${country}00`));
    return String(98 - remainder).padStart(2, '0');
  }

  /**
   * GS1 check digit (weights 3 and 1 from the right), used by GLN and GTIN.
   * @param {string} partial Data digits without the check digit.
   * @returns {string}
   */
  function gs1CheckDigit(partial) {
    let sum = 0;
    for (let i = 0; i < partial.length; i++) {
      const digit = Number(partial[partial.length - 1 - i]);
      sum += digit * (i % 2 === 0 ? 3 : 1);
    }
    return String((10 - (sum % 10)) % 10);
  }

  return { isLuhnValid, luhnCheckDigit, mod97, vatKey, ribKey, ibanKey, gs1CheckDigit };
})();
