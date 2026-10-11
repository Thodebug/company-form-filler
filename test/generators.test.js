import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import { fileSource, GENERATOR_SCRIPTS, loadScripts, readProjectFile } from './helpers.js';
import {
  isValidFrenchVat,
  isValidGs1,
  isValidIban,
  isValidRib,
  isValidSiren,
  isValidSiret,
} from './validators.js';

const { get } = loadScripts(GENERATOR_SCRIPTS);
const random = get('CffRandom');
const checksums = get('CffChecksums');
const text = get('CffText');
const generator = get('CffCompany');

const COMPANY_DRAWS = Number(process.env.CFF_COMPANY_DRAWS || 100_000);
const TODAY = new Date('2026-10-12T10:00:00Z');
const FICTION_LANDLINE = /^0(199 ?00|261 ?91|353 ?01|465 ?71|536 ?49)/;

/**
 * Copies a value created in the script context into this realm, so that
 * deep comparisons do not trip on different prototypes.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const data = {
  legalForms: JSON.parse(readProjectFile('extension/data/fr/legal-forms.json')),
  naf: JSON.parse(readProjectFile('extension/data/fr/naf.json')),
  departments: JSON.parse(readProjectFile('extension/data/fr/departments.json')),
  words: JSON.parse(readProjectFile('extension/data/fr/words.json')),
  headcount: JSON.parse(readProjectFile('extension/data/fr/headcount.json')),
};

describe('random', () => {
  it('draws integers within bounds and rejects invalid bounds', () => {
    for (let i = 0; i < 10_000; i++) {
      const value = random.int(7);
      assert.ok(Number.isInteger(value) && value >= 0 && value < 7);
    }
    assert.equal(random.int(1), 0);
    assert.throws(() => random.int(0), { name: 'RangeError' });
    assert.throws(() => random.int(2 ** 32 + 1), { name: 'RangeError' });
    const big = random.int(35_000);
    assert.ok(big >= 0 && big < 35_000);
  });

  it('covers the whole range of between()', () => {
    const seen = new Set();
    for (let i = 0; i < 2000; i++) {
      seen.add(random.between(3, 6));
    }
    assert.deepEqual([...seen].sort(), [3, 4, 5, 6]);
  });

  it('never picks an item without weight', () => {
    for (let i = 0; i < 2000; i++) {
      assert.notEqual(
        random.weighted(['a', 'b', 'c'], (item) => (item === 'b' ? 0 : 1)),
        'b',
      );
    }
    assert.throws(() => random.weighted(['a'], () => 0), { name: 'RangeError' });
    assert.throws(() => random.pick([]), { name: 'RangeError' });
  });

  it('builds version 4 UUIDs', () => {
    for (let i = 0; i < 1000; i++) {
      assert.match(
        random.uuid(),
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });
});

describe('checksums', () => {
  it('computes the IBAN key of the reference example', () => {
    assert.equal(checksums.ibanKey('FR', '20041010050500013M02606'), '14');
    assert.ok(isValidIban('FR1420041010050500013M02606'));
  });

  it('computes the GS1 check digit of the reference example', () => {
    assert.equal(checksums.gs1CheckDigit('400638133393'), '1');
  });

  it('agrees with the independent validators', () => {
    for (let i = 0; i < 20_000; i++) {
      const siren = random.digits(9);
      assert.ok(isValidFrenchVat(`FR${checksums.vatKey(siren)}${siren}`));
      const partial = random.digits(12);
      assert.ok(isValidGs1(partial + checksums.gs1CheckDigit(partial)));
      const bank = random.digits(5);
      const branch = random.digits(5);
      const account = random.digits(11);
      const key = checksums.ribKey(bank, branch, account);
      assert.ok(isValidRib(bank, branch, account, key));
    }
  });
});

describe('text', () => {
  it('writes legal names in register case', () => {
    assert.equal(text.registerCase("  Café de l'Église & Fils "), "CAFE DE L'EGLISE FILS");
  });

  it('builds slugs cut on a hyphen', () => {
    assert.equal(text.slug("BOULANGERIE DE L'EGLISE", 30), 'boulangerie-de-l-eglise');
    assert.equal(text.slug('ALPHA BETA GAMMA DELTA EPSILON ZETA', 20), 'alpha-beta-gamma');
  });

  it('title-cases names, keeping small words lowercase', () => {
    assert.equal(text.titleCase('BOULANGERIE DU CENTRE'), 'Boulangerie du Centre');
    assert.equal(text.titleCase("CAVE DE L'OUEST"), "Cave de L'Ouest");
  });

  it('shortens on word boundaries', () => {
    assert.equal(text.shorten('MENUISERIE INDUSTRIELLE DUPONT', 20), 'MENUISERIE');
    assert.equal(text.shorten('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 20), 'ABCDEFGHIJKLMNOPQRST');
  });
});

describe('company', () => {
  /** @type {Company[]} */
  let companies = [];
  const source = fileSource();

  before(async () => {
    companies = [];
    for (let i = 0; i < COMPANY_DRAWS; i++) {
      companies.push(await generator.generate(source, { today: TODAY }));
    }
  });

  it(`builds valid identifiers (${COMPANY_DRAWS} companies)`, () => {
    for (const { identity, tax, bank, erp } of companies) {
      assert.ok(isValidSiren(identity.siren), identity.siren);
      assert.notEqual(identity.siren, '356000000');
      assert.ok(isValidSiret(identity.siret), identity.siret);
      assert.equal(identity.siret, identity.siren + identity.nic);
      assert.match(identity.nic, /^000[1-9]\d$/);
      assert.ok(isValidFrenchVat(tax.vatNumber), tax.vatNumber);
      assert.ok(tax.vatNumber.endsWith(identity.siren));
      assert.ok(isValidIban(bank.iban), bank.iban);
      assert.equal(bank.iban.length, 27);
      assert.ok(isValidRib(bank.bankCode, bank.branchCode, bank.accountNumber, bank.ribKey));
      assert.equal(
        bank.iban.slice(4),
        bank.bankCode + bank.branchCode + bank.accountNumber + bank.ribKey,
      );
      assert.match(bank.bic, /^[A-Z]{4}FR[A-Z0-9]{2}$/);
      assert.ok(isValidGs1(erp.gln) && /^2\d{12}$/.test(erp.gln), erp.gln);
      assert.match(
        erp.uuid,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it('respects the rules of each legal form', () => {
    for (const { identity, tax, manager } of companies) {
      const form = data.legalForms.find(
        (/** @type {any} */ entry) => entry.key === identity.legalForm.key,
      );
      assert.ok(form, identity.legalForm.key);
      assert.equal(identity.legalForm.code, form.code);
      assert.ok(form.families.includes(tax.nafFamily), `${form.key} ${tax.nafFamily}`);
      if (form.capital) {
        assert.ok(tax.shareCapital >= form.capital[0] && tax.shareCapital <= form.capital[1]);
        assert.equal(tax.shareCapital % 1000, 0);
      } else {
        assert.equal(tax.shareCapital, null);
      }
      assert.ok(form.headcount.includes(tax.headcountBand.code));
      assert.equal(tax.headcountBand.label, data.headcount[tax.headcountBand.code]);
      assert.equal(manager.role, manager.gender === 'female' ? form.roleFeminine : form.role);
      assert.ok(identity.creationDate >= form.minDate, identity.creationDate);
      assert.ok(identity.creationDate < '2026-10-12', identity.creationDate);
      assert.match(identity.rcs, new RegExp(` ${form.rcsLetter} \\d{3} \\d{3} \\d{3}$`));
      if (form.key === 'EI') {
        assert.ok(identity.legalName.startsWith(text.registerCase(manager.lastName)));
        assert.notEqual(tax.vatRegime, 'Réel normal');
      }
    }
  });

  it('writes legal names within the register constraints', () => {
    const forbidden = new Set(data.words.forbidden);
    for (const { identity } of companies) {
      assert.match(identity.legalName, /^[A-Z0-9' -]+$/, identity.legalName);
      assert.ok(identity.legalName.length <= 38, identity.legalName);
      assert.ok(identity.legalNameShort.length <= 20, identity.legalNameShort);
      assert.ok(identity.legalName.startsWith(identity.legalNameShort));
      for (const word of identity.legalName.split(/[ '-]+/)) {
        assert.ok(!forbidden.has(word), identity.legalName);
      }
      assert.equal(identity.tradeName.toUpperCase(), identity.legalName);
    }
  });

  it('places the company in a real commune with consistent geography', async () => {
    const departments = new Map(
      data.departments.map((/** @type {any} */ entry) => [entry.code, entry]),
    );
    for (const { address, identity, contact } of companies) {
      const department = departments.get(address.departmentCode);
      assert.ok(department, address.departmentCode);
      assert.equal(address.region, department.regionName);
      assert.ok(identity.rcs.startsWith(`RCS ${department.prefecture} `));
      const rows = await source.communes(address.departmentCode);
      const commune = rows.find((row) => row[0] === address.inseeCode);
      assert.ok(commune, address.inseeCode);
      assert.equal(address.city, commune[1]);
      assert.ok([commune[2]].flat().includes(address.postalCode));
      assert.ok(Math.abs(address.latitude - commune[4]) <= 0.010001);
      assert.ok(Math.abs(address.longitude - commune[5]) <= 0.010001);
      assert.match(address.postalCode, /^\d{5}$/);
      assert.ok(address.line1.startsWith(address.streetNumber));
      assert.ok(address.line1Short.length <= address.line1.length);
      assert.ok(
        contact.phone.startsWith(
          { '01': '019900', '02': '026191', '03': '035301', '04': '046571', '05': '053649' }[
            /** @type {'01'} */ (department.phoneZone)
          ],
        ),
      );
      assert.match(contact.phone, FICTION_LANDLINE);
      assert.equal(contact.phone.length, 10);
    }
  });

  it('uses reserved domains and fictitious numbers for contacts', () => {
    for (const { contact, manager } of companies) {
      assert.match(contact.email, /^contact@[a-z0-9-]{1,30}\.example\.com$/);
      assert.match(contact.website, /^https:\/\/www\.[a-z0-9-]{1,30}\.example\.com$/);
      assert.match(manager.email, /^[a-z0-9-]+\.[a-z0-9-]+@[a-z0-9-]{1,30}\.example\.com$/);
      assert.ok(manager.email.endsWith(contact.email.slice('contact'.length)));
      assert.match(manager.mobile, /^063998\d{4}$/);
      assert.equal(manager.title, manager.gender === 'female' ? 'Mme' : 'M.');
    }
  });

  it('builds accounting and ERP codes from the legal name', () => {
    for (const { identity, accounting, erp } of companies) {
      const letters = text.lettersOf(identity.legalName, 3);
      assert.match(accounting.customerCode, /^C\d{6}$/);
      assert.match(accounting.supplierCode, /^F\d{6}$/);
      assert.match(accounting.customerAccount, /^411\d{5}$/);
      assert.match(accounting.supplierAccount, /^401\d{5}$/);
      assert.equal(accounting.auxiliaryAccount.slice(0, 3), letters);
      assert.equal(erp.erpCompanyCode.slice(0, 3), letters);
      assert.match(erp.erpSiteCode, new RegExp(`^${erp.erpCompanyCode}-\\d{2}$`));
      assert.equal(accounting.creditLimit % 5000, 0);
      assert.match(erp.internalRef, /^REF-[A-Z0-9]{8}$/);
    }
  });

  it('draws every legal form and many departments', () => {
    const forms = new Set(companies.map((company) => company.identity.legalForm.key));
    assert.equal(forms.size, data.legalForms.length);
    const departments = new Set(companies.map((company) => company.address.departmentCode));
    assert.ok(departments.size > 50, String(departments.size));
  });

  it('produces companies accepted by the structural check', () => {
    for (const company of companies.slice(0, 1000)) {
      assert.ok(generator.isCompany(company));
      assert.ok(generator.isCompany(JSON.parse(JSON.stringify(company))));
    }
    assert.equal(generator.isCompany({}), false);
    assert.equal(generator.isCompany(null), false);
  });
});

describe('company locks', () => {
  const source = fileSource();

  it('keeps the source values of a locked group and recomputes derived values', async () => {
    for (let i = 0; i < 300; i++) {
      const previous = await generator.generate(source, { today: TODAY });
      const next = await generator.generate(source, {
        previous,
        locks: ['address', 'bank'],
        today: TODAY,
      });
      assert.deepEqual(plain(next.address), plain(previous.address));
      assert.equal(next.bank.iban, previous.bank.iban);
      assert.notEqual(next.identity.siren, previous.identity.siren);
      assert.ok(isValidFrenchVat(next.tax.vatNumber));
      assert.ok(next.tax.vatNumber.endsWith(next.identity.siren));
      const prefecture = next.identity.rcs.split(' ')[1];
      assert.ok(previous.identity.rcs.includes(prefecture));
    }
  });

  it('keeps the legal form, the owner and the legal name of a locked EI identity', async () => {
    let checked = 0;
    while (checked < 20) {
      const previous = await generator.generate(source, { today: TODAY });
      if (previous.identity.legalForm.key !== 'EI') {
        continue;
      }
      const next = await generator.generate(source, {
        previous,
        locks: ['identity'],
        today: TODAY,
      });
      // The RCS follows the registry of the new address.
      assert.deepEqual(
        plain({ ...next.identity, rcs: '' }),
        plain({ ...previous.identity, rcs: '' }),
      );
      assert.equal(
        next.identity.rcs.split(' ').slice(-4).join(' '),
        previous.identity.rcs.split(' ').slice(-4).join(' '),
      );
      assert.equal(next.manager.lastName, previous.manager.lastName);
      checked++;
    }
  });

  it('chooses a legal form compatible with a locked activity', async () => {
    for (let i = 0; i < 300; i++) {
      const previous = await generator.generate(source, { today: TODAY });
      const next = await generator.generate(source, { previous, locks: ['tax'], today: TODAY });
      const form = data.legalForms.find(
        (/** @type {any} */ entry) => entry.key === next.identity.legalForm.key,
      );
      assert.ok(form.families.includes(next.tax.nafFamily));
      assert.equal(next.tax.nafCode, previous.tax.nafCode);
      assert.ok(isValidFrenchVat(next.tax.vatNumber));
    }
  });

  it('ignores locks without a previous company', async () => {
    const company = await generator.generate(source, { locks: ['identity'], today: TODAY });
    assert.ok(generator.isCompany(company));
  });
});
