import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import { fileSource, GENERATOR_SCRIPTS, loadPage, loadScripts } from './helpers.js';

/** @type {Company} */
let company;
/** @type {Company} */
let individual;

before(async () => {
  const { get } = loadScripts(GENERATOR_SCRIPTS);
  const source = fileSource();
  company = await get('CffCompany').generate(source);
  for (
    let i = 0;
    i < 2000 && (company.identity.legalForm.key === 'EI' || !company.address.line2);
    i++
  ) {
    company = await get('CffCompany').generate(source);
  }
  do {
    individual = await get('CffCompany').generate(source);
  } while (individual.identity.legalForm.key !== 'EI');
  company = JSON.parse(JSON.stringify(company));
  individual = JSON.parse(JSON.stringify(individual));
});

/**
 * @param {string} html
 */
function page(html) {
  const loaded = loadPage(html);
  return {
    ...loaded,
    format: loaded.get('CffFormat'),
    fill: loaded.get('CffFill'),
    detection: loaded.get('CffDetection'),
    /** @param {string} id */
    byId: (id) => /** @type {HTMLInputElement} */ (loaded.window.document.getElementById(id)),
  };
}

describe('format', () => {
  /**
   * @param {string} type
   * @param {string} attributes
   * @param {string} [tag]
   */
  function formatted(type, attributes, tag = 'input') {
    const { format, byId } = page(`<${tag} id="f" ${attributes}></${tag}>`);
    return format.valueFor(type, company, format.hintsOf(byId('f')));
  }

  it('writes identifiers without spaces by default', () => {
    assert.equal(formatted('siret', ''), company.identity.siret);
    assert.equal(formatted('siren', ''), company.identity.siren);
    assert.equal(formatted('iban', ''), company.bank.iban);
    assert.equal(formatted('vat', ''), company.tax.vatNumber);
    assert.equal(formatted('phone', ''), company.contact.phone);
  });

  it('follows the spaces of the placeholder or of the input mask', () => {
    assert.match(
      formatted('siret', 'placeholder="123 456 789 00012"'),
      /^\d{3} \d{3} \d{3} \d{5}$/,
    );
    assert.match(formatted('siret', 'maxlength="17"'), /^\d{3} \d{3} \d{3} \d{5}$/);
    assert.match(formatted('siren', 'mask="999 999 999"'), /^\d{3} \d{3} \d{3}$/);
    assert.match(
      formatted('iban', 'placeholder="FR76 3000 6000 0112 3456 7890 189"'),
      /^FR\d{2}( [A-Z0-9]{4}){5} [A-Z0-9]{3}$/,
    );
    assert.match(formatted('phone', 'placeholder="01 23 45 67 89"'), /^0\d( \d{2}){4}$/);
    assert.match(formatted('phone', 'placeholder="+33612345678"'), /^\+33\d{9}$/);
    assert.match(formatted('phone', 'placeholder="+33 6 12 34 56 78"'), /^\+33 \d( \d{2}){4}$/);
    assert.match(formatted('vat', 'placeholder="FR 12 345678901"'), /^FR \d{2} \d{9}$/);
  });

  it('writes dates in the format the field expects', () => {
    const [year, month, day] = company.identity.creationDate.split('-');
    assert.equal(formatted('creationDate', ''), `${day}/${month}/${year}`);
    assert.equal(formatted('creationDate', 'type="date"'), company.identity.creationDate);
    assert.equal(
      formatted('creationDate', 'placeholder="AAAA-MM-JJ"'),
      company.identity.creationDate,
    );
  });

  it('writes NAF codes in the expected nomenclature', () => {
    assert.equal(formatted('naf', ''), company.tax.nafCode);
    assert.equal(formatted('naf', 'placeholder="6201Z"'), company.tax.nafCodeRev2.replace('.', ''));
    assert.equal(formatted('naf', 'placeholder="62.01Z"'), company.tax.nafCodeRev2);
    assert.equal(formatted('naf', 'maxlength="5"'), company.tax.nafCode.replace('.', ''));
  });

  it('writes the capital as a plain number in number inputs', () => {
    assert.equal(formatted('capital', 'type="number"'), String(company.tax.shareCapital));
    if (/** @type {number} */ (company.tax.shareCapital) >= 1000) {
      assert.match(formatted('capital', 'placeholder="10 000"'), /^\d{1,3}( \d{3})+$/);
    }
  });

  it('never truncates: short variant or nothing', () => {
    const name = formatted('legalName', 'maxlength="20"');
    assert.equal(
      name,
      company.identity.legalName.length <= 20
        ? company.identity.legalName
        : company.identity.legalNameShort,
    );
    assert.equal(formatted('iban', 'maxlength="20"'), null);
    assert.equal(formatted('siret', 'maxlength="9"'), null);
  });

  it('writes the full address on one line or several', () => {
    const { line1, line2, postalCode, city } = company.address;
    assert.equal(formatted('fullAddress', ''), [line1, line2, `${postalCode} ${city}`].join(', '));
    assert.equal(
      formatted('fullAddress', '', 'textarea'),
      [line1, line2, `${postalCode} ${city}`].join('\n'),
    );
  });

  it('has no value for the capital of an individual entrepreneur', () => {
    const { format } = page('');
    assert.equal(format.valueFor('capital', individual), null);
    assert.equal(
      format.candidatesFor('capital', individual, format.hintsOf(page('<input id="f">').byId('f')))
        .length,
      0,
    );
  });
});

describe('fill', () => {
  it('fills a block in geographic order, fires events and blurs each field', async () => {
    const { window, fill, detection, byId } = page(`<form>
      <label for="name">Raison sociale</label><input id="name" value="old">
      <label for="siret">SIRET</label><input id="siret">
      <label for="city">Ville</label><input id="city">
      <label for="zip">Code postal</label><input id="zip">
    </form>`);
    /** @type {string[]} */
    const events = [];
    for (const type of ['input', 'change', 'blur', 'focus']) {
      window.document.addEventListener(
        type,
        (event) => events.push(`${event.type}:${/** @type {Element} */ (event.target).id}`),
        true,
      );
    }
    const block = detection.findBlock(byId('name'));
    const result = await fill.fill(block.fields, company, {
      mode: 'company',
      settleDelay: 0,
      focusBack: byId('name'),
    });
    assert.equal(result.filled, 4);
    assert.equal(result.skipped, 0);
    assert.equal(byId('name').value, company.identity.legalName);
    assert.equal(byId('siret').value, company.identity.siret);
    assert.equal(byId('city').value, company.address.city);
    assert.equal(byId('zip').value, company.address.postalCode);
    const order = events
      .filter((event) => event.startsWith('change:'))
      .map((event) => event.slice(7));
    assert.deepEqual(order, ['zip', 'city', 'name', 'siret']);
    assert.ok(events.includes('blur:siret'));
    assert.equal(window.document.activeElement, byId('name'));
  });

  it('writes only address and generic fields in address mode', async () => {
    const { fill, byId } = page(`<form>
      <label for="siret">SIRET</label><input id="siret">
      <label for="zip">Code postal</label><input id="zip">
      <label for="mail">Email</label><input id="mail">
    </form>`);
    await fill.fill(
      [
        { element: byId('siret'), type: 'siret' },
        { element: byId('zip'), type: 'postalCode' },
        { element: byId('mail'), type: 'email' },
      ],
      company,
      { mode: 'address', settleDelay: 0 },
    );
    assert.equal(byId('siret').value, '');
    assert.equal(byId('zip').value, company.address.postalCode);
    assert.equal(byId('mail').value, company.contact.email);
  });

  it('selects options through synonyms', async () => {
    const { fill, byId } = page(`<form>
      <select id="form"><option value="">--</option><option value="5710">Société par actions simplifiée</option>
        <option value="5499">Société à responsabilité limitée (SARL)</option><option value="5498">EURL</option>
        <option value="1000">Entrepreneur individuel</option><option value="5720">SASU</option>
        <option value="5599">SA</option><option value="5202">SNC</option><option value="6540">SCI</option></select>
      <select id="country"><option value="BE">Belgique</option><option value="FR">France</option></select>
      <select id="title"><option>Choisir</option><option value="mr">Monsieur</option><option value="mrs">Madame</option></select>
      <select id="dep"><option>--</option>${Array.from({ length: 95 }, (_, i) => {
        const code = String(i + 1).padStart(2, '0');
        return `<option value="${code}">${code} - Département ${code}</option>`;
      }).join(
        '',
      )}<option value="2A">2A - Corse-du-Sud</option><option value="2B">2B - Haute-Corse</option>
      <option value="971">971 - Guadeloupe</option><option value="972">972 - Martinique</option>
      <option value="973">973 - Guyane</option><option value="974">974 - La Réunion</option><option value="976">976 - Mayotte</option></select>
    </form>`);
    const result = await fill.fill(
      [
        { element: byId('form'), type: 'legalForm' },
        { element: byId('country'), type: 'country' },
        { element: byId('title'), type: 'title' },
        { element: byId('dep'), type: 'department' },
      ],
      company,
      { mode: 'company', settleDelay: 0 },
    );
    assert.equal(result.filled, 4);
    assert.equal(byId('form').value, company.identity.legalForm.code);
    assert.equal(byId('country').value, 'FR');
    assert.equal(byId('title').value, company.manager.title === 'Mme' ? 'mrs' : 'mr');
    assert.equal(byId('dep').value, company.address.departmentCode);
  });

  it('skips a select without matching option and a field too short', async () => {
    const { fill, byId } = page(`<form>
      <select id="country"><option>Belgique</option><option>Suisse</option></select>
      <input id="iban" maxlength="10" value="keep">
    </form>`);
    const result = await fill.fill(
      [
        { element: byId('country'), type: 'country' },
        { element: byId('iban'), type: 'iban' },
      ],
      company,
      { mode: 'company', settleDelay: 0 },
    );
    assert.equal(result.filled, 0);
    assert.equal(result.skipped, 2);
    assert.equal(byId('iban').value, 'keep');
  });

  it('never writes an empty value and does not count it', async () => {
    const { fill, byId } = page('<form><input id="capital" value="old"></form>');
    const result = await fill.fill([{ element: byId('capital'), type: 'capital' }], individual, {
      mode: 'field',
      settleDelay: 0,
    });
    assert.deepEqual([result.filled, result.skipped], [0, 0]);
    assert.equal(byId('capital').value, 'old');
  });

  it('restores the previous value when the page refuses the new one', async () => {
    const { window, fill, byId } = page('<form><input id="siret" value="old"></form>');
    const input = byId('siret');
    // A page that rejects every change.
    input.addEventListener('input', () => {
      Object.defineProperty(input, 'value', {
        configurable: true,
        get: () => 'rejected',
        set: () => {},
      });
    });
    window.document.execCommand = () => false;
    const result = await fill.fill([{ element: input, type: 'siret' }], company, {
      mode: 'field',
      settleDelay: 0,
    });
    assert.equal(result.skipped, 1);
  });

  it('uses insertText when the browser supports it, without an extra input event', async () => {
    const { window, fill, byId } = page('<form><input id="siret" value="old"></form>');
    const input = byId('siret');
    let inputEvents = 0;
    input.addEventListener('input', () => inputEvents++);
    window.document.execCommand = (
      /** @type {string} */ command,
      /** @type {boolean} */ _ui,
      /** @type {string} */ value,
    ) => {
      assert.equal(command, 'insertText');
      input.value = value;
      input.dispatchEvent(new window.InputEvent('input', { bubbles: true }));
      return true;
    };
    await fill.fill([{ element: input, type: 'siret' }], company, {
      mode: 'field',
      settleDelay: 0,
    });
    assert.equal(input.value, company.identity.siret);
    assert.equal(inputEvents, 1);
  });

  it('keeps the value an input mask reformatted', async () => {
    const { window, fill, byId } = page('<form><input id="siret"></form>');
    const input = byId('siret');
    window.document.execCommand = (
      /** @type {string} */ _command,
      /** @type {boolean} */ _ui,
      /** @type {string} */ value,
    ) => {
      input.value = `${value.slice(0, 3)} ${value.slice(3, 6)} ${value.slice(6, 9)} ${value.slice(9)}`;
      return true;
    };
    const result = await fill.fill([{ element: input, type: 'siret' }], company, {
      mode: 'field',
      settleDelay: 0,
    });
    assert.equal(result.filled, 1);
    assert.match(input.value, /^\d{3} \d{3} \d{3} \d{5}$/);
  });

  it('writes again a field the page changed after the first pass', async () => {
    const { fill, byId } = page('<form><input id="zip"><input id="city"></form>');
    // The page fills the city from the postal code, after a while.
    byId('zip').addEventListener('change', () =>
      setTimeout(() => (byId('city').value = 'AUTRE VILLE'), 5),
    );
    await fill.fill(
      [
        { element: byId('zip'), type: 'postalCode' },
        { element: byId('city'), type: 'city' },
      ],
      company,
      { mode: 'company', settleDelay: 20 },
    );
    assert.equal(byId('city').value, company.address.city);
  });

  it('undoes the last fill, selects included', async () => {
    const { fill, byId } = page(`<form><input id="name" value="Ancien nom">
      <select id="country"><option value="BE">Belgique</option><option value="FR">France</option></select></form>`);
    const result = await fill.fill(
      [
        { element: byId('name'), type: 'legalName' },
        { element: byId('country'), type: 'country' },
      ],
      company,
      { mode: 'company', settleDelay: 0 },
    );
    assert.equal(byId('country').value, 'FR');
    assert.equal(fill.undo(result.undo), 2);
    assert.equal(byId('name').value, 'Ancien nom');
    assert.equal(byId('country').value, 'BE');
  });
});

describe('banner', () => {
  it('shows one status banner at a time and runs the undo action', () => {
    const { window, get } = page('<p>page</p>');
    const banner = get('CffBanner');
    let undone = 0;
    banner.show(window.document, 'Premier');
    banner.show(window.document, '3 champs remplis', {
      undoLabel: 'Annuler',
      onUndo: () => undone++,
    });
    const hosts = window.document.querySelectorAll(banner.HOST_TAG);
    assert.equal(hosts.length, 1);
    banner.hide();
    assert.equal(window.document.querySelectorAll(banner.HOST_TAG).length, 0);
    assert.equal(undone, 0);
  });
});
