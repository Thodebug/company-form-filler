// Demo page only, not shipped with the extension.
(function () {
  'use strict';

  /**
   * @param {string} digits
   * @returns {boolean}
   */
  function isLuhnValid(digits) {
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
    return digits.length > 0 && sum % 10 === 0;
  }

  /**
   * @param {string} value
   * @returns {boolean}
   */
  function isValidIban(value) {
    const iban = value.replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) {
      return false;
    }
    const numeric = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (letter) =>
      String(letter.charCodeAt(0) - 55),
    );
    let remainder = 0;
    for (const digit of numeric) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
    return remainder === 1;
  }

  /** @type {Record<string, (value: string) => boolean>} */
  const CHECKS = {
    siret: (value) => {
      const digits = value.replace(/\D/g, '');
      return digits.length === 14 && isLuhnValid(digits) && isLuhnValid(digits.slice(0, 9));
    },
    vat: (value) => {
      const match = /^FR(\d{2})(\d{9})$/.exec(value.replace(/\s+/g, '').toUpperCase());
      return Boolean(match) && Number(match[1]) === (12 + 3 * (Number(match[2]) % 97)) % 97;
    },
    iban: isValidIban,
  };

  /**
   * @param {Event} event
   */
  function onValue(event) {
    const target = event.composedPath()[0];
    if (!(target instanceof HTMLInputElement) || !target.dataset.check) {
      return;
    }
    const status = target.closest('.f')?.querySelector(':scope > .status');
    const check = CHECKS[target.dataset.check];
    if (!status || !check) {
      return;
    }
    const ok = target.value === '' || check(target.value);
    status.textContent = target.value === '' ? '' : ok ? '✓' : '✗';
    status.classList.toggle('bad', !ok);
    status.title = ok ? 'Clé de contrôle valide' : 'Clé de contrôle invalide';
  }
  document.addEventListener('input', onValue, true);
  document.addEventListener('change', onValue, true);

  // Mimics PrimeNG p-inputmask, which reformats the value as it is typed.
  for (const host of document.querySelectorAll('p-inputmask')) {
    const input = host.querySelector('input');
    const mask = host.getAttribute('mask') || '';
    if (!input) {
      continue;
    }
    input.addEventListener('input', () => {
      const digits = input.value.replace(/\D/g, '');
      let result = '';
      let index = 0;
      for (const char of mask) {
        if (index >= digits.length) {
          break;
        }
        result += char === '9' ? digits[index++] : char;
      }
      input.value = result;
    });
  }

  customElements.define(
    'cff-demo-field',
    class extends HTMLElement {
      connectedCallback() {
        if (this.dataset.ready) {
          return;
        }
        this.dataset.ready = 'true';
        const mode = this.getAttribute('mode') === 'closed' ? 'closed' : 'open';
        const root = this.attachShadow({ mode });
        const label = document.createElement('label');
        label.htmlFor = 'inner';
        label.textContent = this.getAttribute('label') || '';
        const input = document.createElement('input');
        input.id = 'inner';
        const style = document.createElement('style');
        style.textContent =
          ':host{display:grid;grid-template-columns:150px 1fr;gap:6px;align-items:center}' +
          'label{color:#5a6372}input{padding:4px 6px;border:1px solid #cfd4dc;border-radius:2px;font:inherit}';
        root.append(style, label, input);
      }
    },
  );

  document.getElementById('add-field')?.addEventListener('click', (event) => {
    const button = /** @type {HTMLButtonElement} */ (event.currentTarget);
    const row = document.createElement('div');
    row.className = 'f';
    const label = document.createElement('label');
    label.htmlFor = 'k-iban';
    label.textContent = 'IBAN ajouté';
    const input = document.createElement('input');
    input.id = 'k-iban';
    input.dataset.check = 'iban';
    const status = document.createElement('span');
    status.className = 'status';
    row.append(label, input, status);
    document.getElementById('dynamic')?.append(row);
    button.disabled = true;
  });
})();
