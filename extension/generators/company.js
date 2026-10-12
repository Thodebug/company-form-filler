// Each group is drawn anew or kept from a previous company (viewer locks);
// harmonize() then recomputes every value derived from another group.
'use strict';

const CffCompany = (() => {
  const SCHEMA_VERSION = 1;
  const GROUPS = /** @type {const} */ ([
    'identity',
    'tax',
    'address',
    'contact',
    'manager',
    'bank',
    'accounting',
    'erp',
  ]);
  // La Poste SIRETs follow a digit-sum rule instead of Luhn.
  const LA_POSTE_SIREN = '356000000';
  const MAX_LEGAL_NAME = 38;
  const MAX_SHORT_NAME = 20;
  const MAX_SLUG = 30;
  const NAME_ATTEMPTS = 20;
  const DAY_MS = 86_400_000;

  // Ranges ARCEP reserves for fiction (plan de numérotation, art. 2.5.12).
  const FICTION_LANDLINE = {
    '01': '019900',
    '02': '026191',
    '03': '035301',
    '04': '046571',
    '05': '053649',
  };
  const FICTION_MOBILE = '063998';

  const PAYMENT_METHODS = ['Virement', 'Prélèvement', 'Chèque', 'LCR', 'Carte bancaire'];
  const PAYMENT_TERMS = [
    'Comptant',
    '30 jours',
    '30 jours fin de mois',
    '45 jours fin de mois',
    '60 jours',
  ];
  const VAT_REGIMES = {
    normal: 'Réel normal',
    simplified: 'Réel simplifié',
    franchise: 'Franchise en base',
  };

  const { int, between, chance, pick, weighted, digits, letters, uuid } = CffRandom;

  // Stable weight functions, so that CffRandom caches cumulative weights.
  /** @param {{ weight: number }} entry */
  const byWeight = (entry) => entry.weight;
  /** @param {DepartmentEntry} entry */
  const byDepartmentPopulation = (entry) => entry.population;
  /** @param {CommuneRow} row */
  const byCommunePopulation = (row) => row[3];
  const { luhnCheckDigit, vatKey, ribKey, ibanKey, gs1CheckDigit } = CffChecksums;
  const { registerCase, slug, titleCase, shorten, lettersOf } = CffText;

  /**
   * @typedef {{
   *   previous?: Company | null,
   *   locks?: readonly CompanyGroup[],
   *   today?: Date,
   * }} GenerateOptions
   */

  /**
   * @param {CompanyDataSource} source
   * @param {GenerateOptions} [options]
   * @returns {Promise<Company>}
   */
  async function generate(source, options = {}) {
    const data = await source.load();
    const today = options.today || new Date();
    const previous = options.previous || null;
    const locks = new Set(previous ? options.locks || [] : []);
    /** @type {<G extends CompanyGroup>(group: G) => Company[G] | null} */
    const kept = (group) =>
      previous && locks.has(group) ? structuredClone(previous[group]) : null;

    const legalForm = chooseLegalForm(data, kept('identity'), kept('tax'));
    const tax = kept('tax') || drawTax(data, legalForm);
    // An EI's legal name is its owner's name: a locked identity keeps the owner.
    const keepManager = locks.has('manager') || (locks.has('identity') && legalForm.key === 'EI');
    const manager =
      (keepManager && previous ? structuredClone(previous.manager) : null) || drawManager(data);
    const identity = kept('identity') || drawIdentity(data, legalForm, tax, today);
    const address = kept('address') || (await drawAddress(data, source));
    const contact = kept('contact') || { phone: '', email: '', website: '' };
    const bank = kept('bank') || drawBank(data);
    const accounting = kept('accounting') || drawAccounting();
    const erp = kept('erp') || drawErp();

    /** @type {Company} */
    const company = {
      schemaVersion: SCHEMA_VERSION,
      id: uuid(),
      createdAt: today.toISOString(),
      identity,
      tax,
      address,
      contact,
      manager,
      bank,
      accounting,
      erp,
    };
    return harmonize(company, data, legalForm);
  }

  /**
   * @param {CompanyData} data
   * @param {Company['identity'] | null} keptIdentity
   * @param {Company['tax'] | null} keptTax
   * @returns {LegalFormEntry}
   */
  function chooseLegalForm(data, keptIdentity, keptTax) {
    if (keptIdentity) {
      const form = data.legalForms.find((entry) => entry.key === keptIdentity.legalForm.key);
      if (form) {
        return form;
      }
    }
    if (!keptTax) {
      return weighted(data.legalForms, byWeight);
    }
    const compatible = data.legalForms.filter((form) => form.families.includes(keptTax.nafFamily));
    return weighted(compatible.length ? compatible : data.legalForms, byWeight);
  }

  /**
   * @param {CompanyData} data
   * @param {LegalFormEntry} legalForm
   * @returns {Company['tax']}
   */
  function drawTax(data, legalForm) {
    const naf = pick(data.naf.filter((entry) => legalForm.families.includes(entry.family)));
    return {
      vatNumber: '',
      nafCode: naf.code,
      nafLabel: naf.label,
      nafCodeRev2: naf.rev2,
      nafLabelRev2: naf.rev2Label,
      nafFamily: naf.family,
      shareCapital: null,
      headcountBand: { code: '', label: '' },
      vatRegime: '',
      vatCode: '',
    };
  }

  /**
   * @returns {string}
   */
  function drawSiren() {
    for (;;) {
      const body = String(between(1, 9)) + digits(7);
      const siren = body + luhnCheckDigit(body);
      if (siren !== LA_POSTE_SIREN) {
        return siren;
      }
    }
  }

  /**
   * Head office NICs are small; the last digit makes the SIRET pass Luhn.
   * @param {string} siren
   * @returns {string}
   */
  function drawNic(siren) {
    const body = `000${between(1, 9)}`;
    return body + luhnCheckDigit(siren + body);
  }

  /**
   * @param {string} minDate ISO date.
   * @param {Date} today
   * @returns {string} ISO date.
   */
  function drawCreationDate(minDate, today) {
    const start = Date.parse(`${minDate}T00:00:00Z`);
    const yesterday =
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - DAY_MS;
    const days = Math.max(0, Math.floor((yesterday - start) / DAY_MS));
    return new Date(start + between(0, days) * DAY_MS).toISOString().slice(0, 10);
  }

  /**
   * @param {CompanyData} data
   * @param {LegalFormEntry} legalForm
   * @param {Company['tax']} tax
   * @param {Date} today
   * @returns {Company['identity']}
   */
  function drawIdentity(data, legalForm, tax, today) {
    const siren = drawSiren();
    const naf = data.naf.find((entry) => entry.code === tax.nafCode);
    return {
      legalName: legalForm.key === 'EI' ? '' : drawLegalName(data, naf, tax.nafFamily),
      legalNameShort: '',
      tradeName: '',
      legalForm: formRef(legalForm),
      siren,
      nic: drawNic(siren),
      siret: '',
      creationDate: drawCreationDate(legalForm.minDate, today),
      rcs: '',
    };
  }

  /**
   * @param {LegalFormEntry} form
   * @returns {LegalFormRef}
   */
  function formRef(form) {
    return { key: form.key, code: form.code, short: form.short, label: form.label };
  }

  /**
   * @param {CompanyData} data
   * @param {NafEntry | undefined} naf
   * @param {string} family
   * @returns {string}
   */
  function drawLegalName(data, naf, family) {
    const words = data.words;
    const patterns = words.patterns[family] || words.patterns.default;
    const trades = naf ? naf.trades : ['SERVICES'];
    for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt++) {
      const name = registerCase(
        pick(patterns).replace(/\{([A-Z]+)\}/g, (_match, token) => {
          switch (token) {
            case 'TRADE':
              return pick(trades);
            case 'NAME':
              return pick(data.lastNames);
            case 'INITIALS':
              return letters(between(2, 3));
            case 'PLACE':
              return pick(words.places);
            case 'AREA':
              return pick(words.areas);
            case 'TECH':
              return pick(words.tech);
            default:
              throw new Error(`Unknown name token ${token}`);
          }
        }),
      );
      if (name.length <= MAX_LEGAL_NAME && !containsForbiddenWord(name, words.forbidden)) {
        return name;
      }
    }
    return registerCase(trades[0]);
  }

  /**
   * @param {string} name
   * @param {readonly string[]} forbidden
   * @returns {boolean}
   */
  function containsForbiddenWord(name, forbidden) {
    const words = new Set(name.split(/[ '-]+/));
    return forbidden.some((word) => words.has(word));
  }

  /**
   * @param {CompanyData} data
   * @returns {Company['manager']}
   */
  function drawManager(data) {
    const gender = chance(0.5) ? 'female' : 'male';
    return {
      title: gender === 'female' ? 'Mme' : 'M.',
      gender,
      firstName: pick(data.firstNames[gender]),
      lastName: pick(data.lastNames),
      role: '',
      mobile: FICTION_MOBILE + digits(4),
      email: '',
    };
  }

  /**
   * Real commune, so postal and INSEE codes match; the street is fictitious.
   * @param {CompanyData} data
   * @param {CompanyDataSource} source
   * @returns {Promise<Company['address']>}
   */
  async function drawAddress(data, source) {
    const department = weighted(data.departments, byDepartmentPopulation);
    const communes = await source.communes(department.code);
    const [inseeCode, city, postalCodes, , latitude, longitude] = weighted(
      communes,
      byCommunePopulation,
    );
    const streetType = weighted(data.streets.types, byWeight);
    const suffix = chance(0.05) ? pick(['bis', 'ter']) : '';
    return {
      streetNumber: String(between(1, 199)),
      streetNumberSuffix: suffix,
      streetType: streetType.name,
      streetTypeShort: streetType.short,
      streetName: pick(data.streets.names),
      line1: '',
      line1Short: '',
      line2: chance(0.4) ? pick(data.streets.complements) : '',
      postalCode: Array.isArray(postalCodes) ? pick(postalCodes) : postalCodes,
      city,
      inseeCode,
      departmentCode: department.code,
      departmentName: department.name,
      regionCode: department.region,
      region: department.regionName,
      country: 'FR',
      countryName: 'France',
      latitude: jitter(latitude),
      longitude: jitter(longitude),
    };
  }

  /**
   * Up to ±0.01° so that addresses do not all sit on the commune centre.
   * @param {number} value
   * @returns {number}
   */
  function jitter(value) {
    const offset = (int(20_001) - 10_000) / 1_000_000;
    return Math.round((value + offset) * 1e6) / 1e6;
  }

  /**
   * @param {CompanyData} data
   * @returns {Company['bank']}
   */
  function drawBank(data) {
    const bank = pick(data.banks);
    return {
      bankName: bank.name,
      bankCode: bank.bankCode,
      branchCode: digits(5),
      accountNumber: digits(11),
      ribKey: '',
      iban: '',
      bic: bank.bic,
    };
  }

  /**
   * @returns {Company['accounting']}
   */
  function drawAccounting() {
    return {
      customerCode: `C${digits(6)}`,
      supplierCode: `F${digits(6)}`,
      customerAccount: `411${digits(5)}`,
      supplierAccount: `401${digits(5)}`,
      auxiliaryAccount: `XXX${digits(5)}`,
      paymentMethod: pick(PAYMENT_METHODS),
      paymentTerms: pick(PAYMENT_TERMS),
      currency: 'EUR',
      creditLimit: between(1, 20) * 5000,
    };
  }

  /**
   * @returns {Company['erp']}
   */
  function drawErp() {
    const glnBody = `2${digits(11)}`;
    const companyDigits = digits(3);
    return {
      erpCompanyCode: `XXX${companyDigits}`,
      erpSiteCode: `XXX${companyDigits}-${digits(2)}`,
      gln: glnBody + gs1CheckDigit(glnBody),
      internalRef: `REF-${randomAlphanumeric(8)}`,
      uuid: uuid(),
    };
  }

  /**
   * @param {number} length
   * @returns {string}
   */
  function randomAlphanumeric(length) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += alphabet[int(alphabet.length)];
    }
    return result;
  }

  /**
   * Also redraws kept values that do not fit the legal form, activity or region.
   * @param {Company} company
   * @param {CompanyData} data
   * @param {LegalFormEntry} legalForm
   * @returns {Company}
   */
  function harmonize(company, data, legalForm) {
    const { identity, tax, address, contact, manager, bank, accounting, erp } = company;
    const department =
      data.departments.find((entry) => entry.code === address.departmentCode) ||
      data.departments[0];

    identity.legalForm = formRef(legalForm);
    if (legalForm.key === 'EI') {
      identity.legalName = registerCase(`${manager.lastName} ${manager.firstName}`);
    } else if (!identity.legalName) {
      identity.legalName = drawLegalName(
        data,
        data.naf.find((entry) => entry.code === tax.nafCode),
        tax.nafFamily,
      );
    }
    identity.legalNameShort = shorten(identity.legalName, MAX_SHORT_NAME);
    identity.tradeName = titleCase(identity.legalName);
    identity.siret = identity.siren + identity.nic;
    identity.rcs = `RCS ${department.prefecture} ${legalForm.rcsLetter} ${groupSiren(identity.siren)}`;
    if (identity.creationDate < legalForm.minDate) {
      identity.creationDate = legalForm.minDate;
    }

    tax.vatNumber = `FR${vatKey(identity.siren)}${identity.siren}`;
    if (!fitsCapital(tax.shareCapital, legalForm)) {
      tax.shareCapital = legalForm.capital ? drawCapital(legalForm.capital) : null;
    }
    if (!legalForm.headcount.includes(tax.headcountBand.code)) {
      const code = pick(legalForm.headcount);
      tax.headcountBand = { code, label: data.headcount[code] };
    }
    const allowedRegimes =
      legalForm.key === 'EI'
        ? [VAT_REGIMES.franchise, VAT_REGIMES.simplified]
        : [VAT_REGIMES.normal, VAT_REGIMES.simplified];
    if (!allowedRegimes.includes(tax.vatRegime)) {
      tax.vatRegime = pick(allowedRegimes);
    }
    tax.vatCode = vatCodeFor(tax);

    address.line1 = streetLine(address, address.streetType);
    address.line1Short = streetLine(address, address.streetTypeShort);

    const domain = `${slug(identity.legalName, MAX_SLUG)}.example.com`;
    const zonePrefix =
      FICTION_LANDLINE[/** @type {keyof typeof FICTION_LANDLINE} */ (department.phoneZone)];
    if (!contact.phone.startsWith(zonePrefix)) {
      contact.phone = zonePrefix + digits(4);
    }
    contact.email = `contact@${domain}`;
    contact.website = `https://www.${domain}`;

    manager.role = manager.gender === 'female' ? legalForm.roleFeminine : legalForm.role;
    manager.email = `${slug(manager.firstName, MAX_SLUG)}.${slug(manager.lastName, MAX_SLUG)}@${domain}`;

    bank.ribKey = ribKey(bank.bankCode, bank.branchCode, bank.accountNumber);
    const bban = bank.bankCode + bank.branchCode + bank.accountNumber + bank.ribKey;
    bank.iban = `FR${ibanKey('FR', bban)}${bban}`;

    const nameLetters = lettersOf(identity.legalName, 3);
    accounting.auxiliaryAccount = nameLetters + accounting.auxiliaryAccount.slice(3);
    const companyDigits = erp.erpCompanyCode.slice(3);
    erp.erpCompanyCode = nameLetters + companyDigits;
    erp.erpSiteCode = `${erp.erpCompanyCode}-${erp.erpSiteCode.slice(-2)}`;
    return company;
  }

  /**
   * Log-uniform: small share capitals are the most common in the register.
   * @param {[number, number]} range
   * @returns {number}
   */
  function drawCapital([min, max]) {
    const ratio = int(1_000_001) / 1_000_000;
    const amount = min * (max / min) ** ratio;
    return Math.min(max, Math.max(min, Math.round(amount / 1000) * 1000));
  }

  /**
   * @param {number | null} capital
   * @param {LegalFormEntry} legalForm
   * @returns {boolean}
   */
  function fitsCapital(capital, legalForm) {
    if (!legalForm.capital) {
      return capital === null;
    }
    return (
      typeof capital === 'number' &&
      capital >= legalForm.capital[0] &&
      capital <= legalForm.capital[1] &&
      capital % 1000 === 0
    );
  }

  /**
   * @param {Company['tax']} tax
   * @returns {string}
   */
  function vatCodeFor(tax) {
    if (tax.vatRegime === VAT_REGIMES.franchise) {
      return 'EXO';
    }
    if (tax.nafFamily === 'hospitality') {
      return 'TVA10';
    }
    if (tax.nafFamily === 'food') {
      return 'TVA55';
    }
    return 'TVA20';
  }

  /**
   * @param {Company['address']} address
   * @param {string} streetType
   * @returns {string}
   */
  function streetLine(address, streetType) {
    const number = address.streetNumberSuffix
      ? `${address.streetNumber} ${address.streetNumberSuffix}`
      : address.streetNumber;
    return `${number} ${streetType} ${address.streetName}`;
  }

  /**
   * @param {string} siren
   * @returns {string}
   */
  function groupSiren(siren) {
    return `${siren.slice(0, 3)} ${siren.slice(3, 6)} ${siren.slice(6)}`;
  }

  /**
   * @param {unknown} value
   * @returns {value is Company}
   */
  function isCompany(value) {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const company = /** @type {Record<string, any>} */ (value);
    return (
      company.schemaVersion === SCHEMA_VERSION &&
      typeof company.id === 'string' &&
      GROUPS.every((group) => company[group] && typeof company[group] === 'object') &&
      /^\d{14}$/.test(company.identity.siret) &&
      typeof company.identity.legalName === 'string' &&
      typeof company.address.city === 'string'
    );
  }

  return {
    SCHEMA_VERSION,
    GROUPS,
    LA_POSTE_SIREN,
    FICTION_LANDLINE,
    FICTION_MOBILE,
    MAX_LEGAL_NAME,
    MAX_SHORT_NAME,
    generate,
    isCompany,
  };
})();
