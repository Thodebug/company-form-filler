// Values are never truncated: a field too short for every candidate format is
// skipped. Also loaded by the viewer and the popup.
'use strict';

const CffFormat = (() => {
  /**
   * @typedef {{
   *   tag: string,
   *   inputType: string,
   *   placeholder: string,
   *   mask: string,
   *   pattern: string,
   *   maxLength: number,
   * }} FieldHints
   */

  /**
   * @param {Element} element
   * @returns {FieldHints}
   */
  function hintsOf(element) {
    const maxLength = parseInt(element.getAttribute('maxlength') || '', 10);
    let mask = '';
    for (
      let current = /** @type {Element | null} */ (element), depth = 0;
      current && depth < 3;
      depth++
    ) {
      const attribute = Array.from(current.attributes).find(
        (candidate) => /mask/i.test(candidate.name) && /[90#]/.test(candidate.value),
      );
      if (attribute) {
        mask = attribute.value;
        break;
      }
      current = current.parentElement;
    }
    return {
      tag: element.localName,
      inputType:
        element.localName === 'input' ? /** @type {HTMLInputElement} */ (element).type : '',
      placeholder: element.getAttribute('placeholder') || '',
      mask,
      pattern: element.getAttribute('pattern') || '',
      maxLength: maxLength > 0 ? maxLength : 0,
    };
  }

  /** @type {FieldHints} */
  const NO_HINTS = {
    tag: 'input',
    inputType: 'text',
    placeholder: '',
    mask: '',
    pattern: '',
    maxLength: 0,
  };

  /**
   * @param {string} digits
   * @param {number[]} sizes
   * @returns {string}
   */
  function group(digits, sizes) {
    const parts = [];
    let index = 0;
    for (const size of sizes) {
      parts.push(digits.slice(index, index + size));
      index += size;
    }
    if (index < digits.length) {
      parts.push(digits.slice(index));
    }
    return parts.filter(Boolean).join(' ');
  }

  /**
   * @param {string} iban
   * @returns {string}
   */
  function groupIban(iban) {
    return iban.replace(/(.{4})(?=.)/g, '$1 ');
  }

  /**
   * @param {string} national Ten digits starting with 0.
   * @returns {string[]}
   */
  function phoneVariants(national) {
    const spaced = national.replace(/(\d{2})(?=\d)/g, '$1 ');
    const international = `+33${national.slice(1)}`;
    const internationalSpaced = `+33 ${national.slice(1, 2)} ${national.slice(2).replace(/(\d{2})(?=\d)/g, '$1 ')}`;
    return [national, spaced, international, internationalSpaced];
  }

  /**
   * @param {string} isoDate YYYY-MM-DD
   * @returns {string} DD/MM/YYYY
   */
  function frenchDate(isoDate) {
    const [year, month, day] = isoDate.split('-');
    return `${day}/${month}/${year}`;
  }

  /**
   * @param {number} amount
   * @returns {string}
   */
  function groupThousands(amount) {
    return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  /**
   * @param {Company} company
   * @param {boolean} multiline
   * @returns {string}
   */
  function fullAddress(company, multiline) {
    const { line1, line2, postalCode, city } = company.address;
    const parts = [line1, line2, `${postalCode} ${city}`].filter(Boolean);
    return multiline ? parts.join('\n') : parts.join(', ');
  }

  /**
   * Default format first.
   * @param {string} type
   * @param {Company} company
   * @param {FieldHints} hints
   * @returns {string[]}
   */
  function candidatesFor(type, company, hints) {
    const { identity, tax, address, contact, manager, bank, erp } = company;
    switch (type) {
      case 'legalName':
        return [identity.legalName, identity.legalNameShort];
      case 'tradeName':
        return [identity.tradeName];
      case 'legalForm':
        return [identity.legalForm.short, identity.legalForm.label];
      case 'siren':
        return [identity.siren, group(identity.siren, [3, 3, 3])];
      case 'siret':
        return [identity.siret, group(identity.siret, [3, 3, 3, 5])];
      case 'nic':
        return [identity.nic];
      case 'vat':
        return [
          tax.vatNumber,
          `${tax.vatNumber.slice(0, 2)} ${tax.vatNumber.slice(2, 4)} ${tax.vatNumber.slice(4)}`,
        ];
      case 'rcs':
        return [identity.rcs];
      case 'naf':
        return nafCandidates(company, hints);
      case 'capital':
        if (tax.shareCapital === null) {
          return [];
        }
        return hints.inputType === 'number'
          ? [String(tax.shareCapital)]
          : [String(tax.shareCapital), groupThousands(tax.shareCapital)];
      case 'headcount':
        return hints.inputType === 'number'
          ? [String(parseInt(tax.headcountBand.label, 10) || 0)]
          : [tax.headcountBand.label];
      case 'creationDate':
        return dateCandidates(identity.creationDate, hints);
      case 'iban':
        return [bank.iban, groupIban(bank.iban)];
      case 'bic':
        return [bank.bic];
      case 'bankName':
        return [bank.bankName];
      case 'gln':
        return [erp.gln];
      case 'erpCompanyCode':
        return [erp.erpCompanyCode];
      case 'erpSiteCode':
        return [erp.erpSiteCode];
      case 'internalRef':
        return [erp.internalRef];
      case 'uuid':
        return [erp.uuid];
      case 'addressLine1':
        return [address.line1, address.line1Short];
      case 'addressLine2':
        return address.line2 ? [address.line2] : [];
      case 'streetNumber':
        return [
          address.streetNumberSuffix
            ? `${address.streetNumber} ${address.streetNumberSuffix}`
            : address.streetNumber,
        ];
      case 'street':
        return [
          `${address.streetType} ${address.streetName}`,
          `${address.streetTypeShort} ${address.streetName}`,
        ];
      case 'postalCode':
        return [address.postalCode];
      case 'city':
        return [address.city];
      case 'department':
        return [address.departmentName, address.departmentCode];
      case 'region':
        return [address.region];
      case 'country':
        return [address.countryName, address.country];
      case 'fullAddress':
        return [fullAddress(company, hints.tag === 'textarea')];
      case 'latitude':
        return [address.latitude.toFixed(6)];
      case 'longitude':
        return [address.longitude.toFixed(6)];
      case 'phone':
        return phoneVariants(contact.phone);
      case 'mobile':
        return phoneVariants(manager.mobile);
      case 'email':
        return [contact.email];
      case 'managerEmail':
        return [manager.email];
      case 'website':
        return [contact.website];
      case 'title':
        return [manager.title];
      case 'firstName':
        return [manager.firstName];
      case 'lastName':
        return [manager.lastName];
      case 'fullName':
        return [`${manager.firstName} ${manager.lastName}`];
      case 'role':
        return [manager.role];
      default:
        return [];
    }
  }

  /**
   * NAF rév. 2 sub-classes end with Z or A to F, NAF 2025 ones with G to L or
   * Y, so a rév. 2 placeholder selects the rév. 2 code.
   * @param {Company} company
   * @param {FieldHints} hints
   * @returns {string[]}
   */
  function nafCandidates(company, hints) {
    const { nafCode, nafCodeRev2 } = company.tax;
    const placeholder = hints.placeholder.trim().toUpperCase();
    const rev2 = /^\d{2}\.?\d{2}[A-FZ]$/.test(placeholder);
    const withoutDot =
      /^\d{4}[A-Z]$/.test(placeholder) || (hints.maxLength > 0 && hints.maxLength < 6);
    const code = rev2 ? nafCodeRev2 : nafCode;
    return withoutDot ? [code.replace('.', '')] : [code, code.replace('.', '')];
  }

  /**
   * @param {string} isoDate
   * @param {FieldHints} hints
   * @returns {string[]}
   */
  function dateCandidates(isoDate, hints) {
    if (hints.inputType === 'date' || /^(aaaa|yyyy)-/i.test(hints.placeholder.trim())) {
      return [isoDate];
    }
    return [frenchDate(isoDate), isoDate];
  }

  /**
   * @param {string} text
   * @returns {string}
   */
  function shapeOf(text) {
    return text.replace(/[0-9]/g, '9').replace(/[A-Za-z]/g, 'A');
  }

  /**
   * @param {string} placeholder
   * @returns {string}
   */
  function placeholderShape(placeholder) {
    return shapeOf(placeholder.trim().replace(/[x#_*]/gi, '0'));
  }

  /**
   * @param {string} mask
   * @returns {string}
   */
  function maskShape(mask) {
    return mask.replace(/[90#]/g, '9').replace(/[a]/g, 'A');
  }

  /**
   * @param {string[]} candidates Default first.
   * @param {FieldHints} hints
   * @returns {string | null} Null when no candidate fits the field.
   */
  function choose(candidates, hints) {
    const unique = [...new Set(candidates.filter(Boolean))];
    const fitting = hints.maxLength
      ? unique.filter((value) => value.length <= hints.maxLength)
      : unique;
    if (fitting.length === 0) {
      return null;
    }
    const shapes = [placeholderShape(hints.placeholder), maskShape(hints.mask)].filter((shape) =>
      /9/.test(shape),
    );
    const sameShape = fitting.find((value) => shapes.includes(shapeOf(value)));
    if (sameShape) {
      return sameShape;
    }
    // A maxlength matching a variant's length points to it (17 for a spaced
    // SIRET, 33 for a grouped IBAN).
    if (hints.maxLength && fitting[0].length !== hints.maxLength) {
      const exactLength = fitting.find((value) => value.length === hints.maxLength);
      if (exactLength) {
        return exactLength;
      }
    }
    const clue = `${hints.placeholder} ${hints.mask}`;
    if (/^\s*\+/.test(hints.placeholder)) {
      const international = fitting.filter((value) => value.startsWith('+'));
      const spaced = international.find((value) => value.includes(' '));
      if (international.length) {
        return /\d \d/.test(hints.placeholder) && spaced ? spaced : international[0];
      }
    }
    if (/[0-9x#] [0-9x#]/i.test(clue)) {
      const spaced = fitting.find((value) => / /.test(value) && !value.startsWith('+'));
      if (spaced) {
        return spaced;
      }
    }
    return fitting[0];
  }

  /**
   * @param {string} type
   * @param {Company} company
   * @param {FieldHints} [hints]
   * @returns {string | null} Null when the company has no value for the
   *   type or when no format fits the field.
   */
  function valueFor(type, company, hints = NO_HINTS) {
    return choose(candidatesFor(type, company, hints), hints);
  }

  // Numeric entries are INSEE legal category codes (level 2).
  const LEGAL_FORM_SYNONYMS = /** @type {Record<string, string[]>} */ ({
    SAS: ['Société par actions simplifiée', '57', 'SA simplifiée'],
    SASU: ['SAS unipersonnelle', 'Société par actions simplifiée unipersonnelle', '57'],
    SARL: ['Société à responsabilité limitée', '54'],
    EURL: ['SARL unipersonnelle', 'Entreprise unipersonnelle à responsabilité limitée', '54'],
    SA: ['Société anonyme', '55'],
    SNC: ['Société en nom collectif', '52'],
    SCI: ['Société civile immobilière', 'Société civile', '65'],
    EI: [
      'Entrepreneur individuel',
      'Entreprise individuelle',
      'Auto-entrepreneur',
      'Micro-entreprise',
      '10',
    ],
  });

  // 250 is the ISO 3166-1 numeric code.
  const COUNTRY_SYNONYMS = ['FR', 'FRA', '250', 'France', 'France métropolitaine'];
  const TITLE_SYNONYMS = /** @type {Record<string, string[]>} */ ({
    'M.': ['M.', 'M', 'Monsieur', 'Mr', 'Mr.'],
    Mme: ['Mme', 'Madame', 'Mrs', 'Mrs.', 'Ms', 'Ms.'],
  });

  /**
   * Best match first.
   * @param {string} type
   * @param {Company} company
   * @returns {string[]}
   */
  function optionCandidates(type, company) {
    const { identity, tax, address, manager } = company;
    switch (type) {
      case 'legalForm': {
        const form = identity.legalForm;
        return [form.short, form.label, form.code, ...(LEGAL_FORM_SYNONYMS[form.key] || [])];
      }
      case 'country':
        return COUNTRY_SYNONYMS;
      case 'department':
        return [
          address.departmentCode,
          address.departmentCode.padStart(3, '0'),
          address.departmentName,
          `${address.departmentCode} - ${address.departmentName}`,
        ];
      case 'region':
        return [address.region, address.regionCode];
      case 'title':
        return TITLE_SYNONYMS[manager.title] || [manager.title];
      case 'naf':
        return [
          tax.nafCode,
          tax.nafCode.replace('.', ''),
          tax.nafCodeRev2,
          tax.nafCodeRev2.replace('.', ''),
        ];
      case 'headcount':
        return [tax.headcountBand.code, tax.headcountBand.label];
      default:
        return candidatesFor(type, company, NO_HINTS);
    }
  }

  /** Used by the viewer and the popup. */
  const display = {
    /** @param {string} siret */
    siret: (siret) => group(siret, [3, 3, 3, 5]),
    /** @param {string} siren */
    siren: (siren) => group(siren, [3, 3, 3]),
    iban: groupIban,
    /** @param {string} phone */
    phone: (phone) => phoneVariants(phone)[1],
    date: frenchDate,
    /**
     * @param {number | null} amount
     * @param {string} [noneLabel]
     */
    euros: (amount, noneLabel = '') =>
      amount === null ? noneLabel : `${groupThousands(amount)} €`,
    /** @param {Company} company */
    fullAddress: (company) => fullAddress(company, true),
  };

  return { hintsOf, valueFor, optionCandidates, candidatesFor, choose, shapeOf, display };
})();
