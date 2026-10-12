import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadPage, readProjectFile } from './helpers.js';

/**
 * Checks every element carrying data-expected in `html`.
 * @param {string} html
 * @param {string} label
 * @returns {number} Number of checked elements.
 */
function checkExpectations(html, label) {
  const { window, get } = loadPage(html);
  const detection = get('CffDetection');
  const fields = Array.from(window.document.querySelectorAll('[data-expected]'));
  assert.ok(fields.length > 0, `${label}: no field with data-expected`);
  for (const [index, field] of fields.entries()) {
    const expected = field.getAttribute('data-expected');
    const result = detection.detectType(field);
    assert.equal(
      result.type || 'none',
      expected,
      `${label} #${index}: ${field.outerHTML}\nscores=${JSON.stringify(result.scores)}`,
    );
  }
  return fields.length;
}

describe('normalize', () => {
  it('lowercases, strips accents, splits camelCase and expands n°', () => {
    const detection = loadPage('').get('CffDetection');
    assert.equal(detection.normalize('N° SIRET'), 'numero siret');
    assert.equal(detection.normalize('companySiretNumber'), 'company siret number');
    assert.equal(detection.normalize("Numéro d'établissement"), 'numero d etablissement');
    assert.equal(detection.normalize('siret_client-id'), 'siret client id');
  });
});

describe('patternDigitCount', () => {
  it('reads simple digit patterns', () => {
    const count = loadPage('').get('CffDetection').patternDigitCount;
    assert.equal(count('[0-9]{14}'), 14);
    assert.equal(count(String.raw`^\d{14}$`), 14);
    assert.equal(count(String.raw`\d{3} ?\d{3} ?\d{3} ?\d{5}`), 14);
    assert.equal(count(String.raw`(?:\d{14}|\d{3} \d{3} \d{3} \d{5})`), 14);
    assert.equal(count(String.raw`\d{9}`), 9);
    assert.equal(count(String.raw`\d{3}\s?\d{3}\s?\d{3}`), 9);
    assert.equal(count(String.raw`[0-9]{5}`), 5);
  });

  it('ignores patterns it does not fully understand', () => {
    const count = loadPage('').get('CffDetection').patternDigitCount;
    for (const pattern of [
      '[0-9]*',
      String.raw`\d{14}|\d{9}`,
      String.raw`\d{3,5}`,
      String.raw`FR\d{11}`,
    ]) {
      assert.equal(count(pattern), null, pattern);
    }
  });

  it('never runs the page pattern, so a catastrophic one stays instant', () => {
    const { window, get } = loadPage(
      String.raw`<label for="f">SIRET</label><input id="f" pattern="(\d|\d|\d|\d|\d|\d|\d|\d)*x">`,
    );
    const started = Date.now();
    const result = get('CffDetection').detectType(window.document.getElementById('f'));
    assert.ok(Date.now() - started < 200, 'detection took too long');
    assert.equal(result.type, 'siret');
  });
});

describe('detectType on fixtures', () => {
  it('matches every expectation of test/fixtures/detection.html', () => {
    const count = checkExpectations(readProjectFile('test/fixtures/detection.html'), 'fixtures');
    assert.ok(count >= 110, `only ${count} fixtures`);
  });

  it('matches every expectation of the demo page', () => {
    checkExpectations(readProjectFile('site/index.html'), 'demo');
  });

  it('returns no type for null, text nodes and non controls', () => {
    const { window, get } = loadPage('<p id="p">SIRET</p>');
    const detection = get('CffDetection');
    assert.equal(detection.detectType(null).type, null);
    assert.equal(detection.detectType(window.document.getElementById('p')).type, null);
  });
});

describe('detectType with shadow DOM', () => {
  /**
   * @param {'open' | 'closed'} mode
   * @param {string} inner
   * @param {string} [hostAttributes]
   */
  function buildShadow(mode, inner, hostAttributes = '') {
    const { window, get } = loadPage(
      `<form><div class="row"><x-field ${hostAttributes}></x-field></div></form>`,
    );
    const host = /** @type {Element} */ (window.document.querySelector('x-field'));
    const shadow = host.attachShadow({ mode });
    shadow.innerHTML = inner;
    return {
      detection: get('CffDetection'),
      input: /** @type {HTMLInputElement} */ (shadow.querySelector('input')),
    };
  }

  it('reads a label inside an open shadow root', () => {
    const { detection, input } = buildShadow(
      'open',
      '<label for="i">N° SIRET</label><input id="i">',
    );
    assert.equal(detection.detectType(input).type, 'siret');
  });

  it('reads a label inside a closed shadow root', () => {
    const { detection, input } = buildShadow(
      'closed',
      '<label for="i">SIREN</label><input id="i">',
    );
    assert.equal(detection.detectType(input).type, 'siren');
  });

  it('crosses the shadow boundary to read the host attributes', () => {
    const { detection, input } = buildShadow(
      'closed',
      '<input>',
      'formcontrolname="siret" mask="999 999 999 99999"',
    );
    assert.equal(detection.detectType(input).type, 'siret');
  });

  it('ignores a host whose light DOM holds another field', () => {
    const { window, get } = loadPage(
      '<form><x-group label="SIRET"><input name="other"></x-group></form>',
    );
    const host = /** @type {Element} */ (window.document.querySelector('x-group'));
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<input><slot></slot>';
    const input = /** @type {HTMLInputElement} */ (shadow.querySelector('input'));
    assert.equal(get('CffDetection').detectType(input).type, null);
  });
});

describe('detectType on dynamic content', () => {
  it('detects a field added after load', () => {
    const { window, get } = loadPage('<form id="f"></form>');
    const row = window.document.createElement('div');
    row.innerHTML = '<label for="late">SIRET</label><input id="late">';
    window.document.getElementById('f')?.append(row);
    assert.equal(
      get('CffDetection').detectType(window.document.getElementById('late')).type,
      'siret',
    );
  });
});

/**
 * @param {string} html
 * @param {string} clickedId
 */
function blockOf(html, clickedId) {
  const { window, get } = loadPage(html);
  const block = get('CffDetection').findBlock(window.document.getElementById(clickedId));
  return {
    window,
    block,
    /** @returns {string[]} */
    ids: () =>
      block
        ? Array.from(block.fields, (/** @type {{ element: Element }} */ field) => field.element.id)
        : [],
  };
}

/**
 * @param {string} id
 * @param {string} label
 * @param {string} [attributes]
 */
function field(id, label, attributes = '') {
  return `<div class="row"><label for="${id}">${label}</label><input id="${id}" ${attributes}></div>`;
}

const ERP_FORM = `<form id="supplier">
  <fieldset id="identity"><legend>Identité</legend>
    ${field('name', 'Raison sociale')}${field('siret', 'SIRET')}${field('vat', 'N° TVA')}
  </fieldset>
  <fieldset id="address"><legend>Adresse</legend>
    ${field('line1', 'Adresse')}${field('zip', 'Code postal')}${field('city', 'Ville')}
  </fieldset>
  <fieldset id="bank"><legend>Banque</legend>
    ${field('iban', 'IBAN')}${field('bic', 'BIC')}
  </fieldset>
</form>`;

const ORDER_FORM = `<form id="order">
  <fieldset id="billing"><legend>Facturation</legend>
    ${field('b-name', 'Nom')}${field('b-line1', 'Adresse')}${field('b-zip', 'Code postal')}${field('b-city', 'Ville')}
  </fieldset>
  <fieldset id="shipping"><legend>Livraison</legend>
    ${field('s-name', 'Nom')}${field('s-line1', 'Adresse')}${field('s-zip', 'Code postal')}${field('s-city', 'Ville')}
  </fieldset>
</form>`;

describe('findBlock', () => {
  it('takes a form split in sections as a whole and qualifies it as a company', () => {
    const { block, ids } = blockOf(ERP_FORM, 'zip');
    assert.equal(block?.qualification, 'company');
    assert.equal(block?.root.id, 'supplier');
    assert.deepEqual(ids(), ['name', 'siret', 'vat', 'line1', 'zip', 'city', 'iban', 'bic']);
  });

  it('stops at the clicked block when blocks repeat the same types', () => {
    const { block, ids } = blockOf(ORDER_FORM, 's-zip');
    assert.equal(block?.qualification, 'address');
    assert.equal(block?.root.id, 'shipping');
    assert.deepEqual(ids(), ['s-name', 's-line1', 's-zip', 's-city']);
  });

  it('qualifies a pure address form', () => {
    const { block } = blockOf(
      `<form>${field('l', 'Adresse')}${field('z', 'Code postal')}${field('c', 'Ville')}${field('n', 'Prénom')}</form>`,
      'c',
    );
    assert.equal(block?.qualification, 'address');
  });

  it('needs the postal code and the city for an address form', () => {
    const { block } = blockOf(
      `<form>${field('l', 'Adresse')}${field('l2', "Complément d'adresse")}${field('c', 'Ville')}</form>`,
      'c',
    );
    assert.equal(block?.qualification, null);
  });

  it('never qualifies a contact form made of generic fields', () => {
    const { block } = blockOf(
      `<form>${field('n', 'Nom')}${field('e', 'Email')}${field('p', 'Téléphone')}<textarea id="m"></textarea></form>`,
      'e',
    );
    assert.equal(block?.qualification, null);
  });

  it('returns no block for a newsletter or a login form', () => {
    assert.equal(
      blockOf(`<form>${field('e', 'Email')}<button>OK</button></form>`, 'e').block,
      null,
    );
    assert.equal(
      blockOf(`<form>${field('u', "Nom d'utilisateur")}<input id="pw" type="password"></form>`, 'u')
        .block,
      null,
    );
  });

  it('ignores hidden fields', () => {
    const { block, ids } = blockOf(
      `<form>${field('n', 'Raison sociale')}${field('s', 'SIRET')}
        <div style="display:none">${field('h', 'IBAN')}</div>${field('c', 'Ville')}</form>`,
      'n',
    );
    assert.equal(block?.qualification, 'company');
    assert.deepEqual(ids(), ['n', 's', 'c']);
  });

  it('includes select elements of the block', () => {
    const { block, ids } = blockOf(
      `<form>${field('n', 'Raison sociale')}${field('s', 'SIRET')}
        <label for="f">Forme juridique</label><select id="f"><option>SAS</option></select></form>`,
      'n',
    );
    assert.equal(block?.qualification, 'company');
    assert.deepEqual(ids(), ['n', 's', 'f']);
  });

  it('finds fields inside shadow roots', () => {
    const { window, get } = loadPage(
      `<form id="f">${field('n', 'Raison sociale')}<x-a></x-a><x-b></x-b></form>`,
    );
    const document = window.document;
    for (const [tag, label, mode] of /** @type {const} */ ([
      ['x-a', 'SIRET', 'open'],
      ['x-b', 'Code postal', 'closed'],
    ])) {
      const shadow = /** @type {Element} */ (document.querySelector(tag)).attachShadow({ mode });
      shadow.innerHTML = `<label for="i">${label}</label><input id="i">`;
      if (mode === 'closed') {
        // The content script reaches closed roots through the extension API.
        const host = document.querySelector(tag);
        get('CffDetection').configure({
          shadowRootOf: (/** @type {Element} */ element) =>
            element === host ? shadow : element.shadowRoot,
        });
      }
    }
    const block = get('CffDetection').findBlock(document.getElementById('n'));
    assert.equal(block?.qualification, 'company');
    assert.equal(block?.fields.length, 3);
  });

  it('gives up on huge pages', () => {
    const rows = Array.from({ length: 1200 }, (_, i) => `<p><span>${i}</span></p>`).join('');
    const { block } = blockOf(
      `<form>${field('n', 'Raison sociale')}${rows}${field('s', 'SIRET')}${field('c', 'Ville')}</form>`,
      'n',
    );
    assert.equal(block, null);
  });

  it('returns no block for a control alone in the page', () => {
    assert.equal(blockOf(field('s', 'SIRET'), 's').block, null);
  });
});
