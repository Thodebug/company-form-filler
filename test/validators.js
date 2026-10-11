// Independent validators, used by the tests to check what the extension
// generates. They are written from the official rules, separately from the
// extension code, and are not shipped with the extension.

const LA_POSTE_SIREN = '356000000';

/**
 * @param {string} digits
 * @returns {boolean}
 */
export function isLuhnValid(digits) {
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
 * @param {string} value
 * @returns {boolean}
 */
export function isValidSiren(value) {
  return /^\d{9}$/.test(value) && isLuhnValid(value);
}

/**
 * La Poste establishments follow their own rule: the sum of the 14 digits
 * is a multiple of 5.
 * @param {string} value
 * @returns {boolean}
 */
export function isValidSiret(value) {
  if (!/^\d{14}$/.test(value)) {
    return false;
  }
  if (value.startsWith(LA_POSTE_SIREN)) {
    return [...value].reduce((sum, char) => sum + Number(char), 0) % 5 === 0;
  }
  return isLuhnValid(value);
}

/**
 * French VAT number: FR + key + SIREN, key = (12 + 3 × (SIREN mod 97)) mod 97.
 * @param {string} value
 * @returns {boolean}
 */
export function isValidFrenchVat(value) {
  const match = /^FR(\d{2})(\d{9})$/.exec(value);
  if (!match) {
    return false;
  }
  const siren = BigInt(match[2]);
  return BigInt(match[1]) === (12n + 3n * (siren % 97n)) % 97n;
}

/**
 * ISO 13616: moving the first four characters to the end and converting
 * letters to numbers gives a number congruent to 1 modulo 97.
 * @param {string} value
 * @returns {boolean}
 */
export function isValidIban(value) {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value)) {
    return false;
  }
  const rearranged = value.slice(4) + value.slice(0, 4);
  const numeric = [...rearranged]
    .map((char) => (/[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char))
    .join('');
  return BigInt(numeric) % 97n === 1n;
}

/**
 * French RIB: 89 × bank + 15 × branch + 3 × account + key is a multiple of 97.
 * @param {string} bank
 * @param {string} branch
 * @param {string} account Digits only.
 * @param {string} key
 * @returns {boolean}
 */
export function isValidRib(bank, branch, account, key) {
  const total = 89n * BigInt(bank) + 15n * BigInt(branch) + 3n * BigInt(account) + BigInt(key);
  return total % 97n === 0n;
}

/**
 * GS1 numbers (GLN, GTIN): weighting from the right, the check digit has
 * weight 1, then 3, 1, 3... The weighted sum is a multiple of 10.
 * @param {string} value
 * @returns {boolean}
 */
export function isValidGs1(value) {
  if (!/^\d+$/.test(value)) {
    return false;
  }
  let sum = 0;
  [...value].reverse().forEach((char, index) => {
    sum += Number(char) * (index % 2 === 0 ? 1 : 3);
  });
  return sum % 10 === 0;
}
