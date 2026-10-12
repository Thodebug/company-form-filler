'use strict';

(() => {
  const { api, t, localize, send, applyTheme, h } = CffPage;
  const ISSUES_URL = 'https://github.com/Thodebug/company-form-filler/issues/new';

  /** @type {{ tabId: number | null, incognito: boolean, mode: 'company' | 'address', state: CffViewState | null }} */
  const view = { tabId: null, incognito: false, mode: 'company', state: null };

  /** @param {string} id */
  const byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

  /**
   * @param {string} label
   * @param {string} value
   */
  function line(label, value) {
    return h('div', { class: 'card-line' }, [
      h('span', { class: 'muted' }, [label]),
      h('span', {}, [value]),
    ]);
  }

  /**
   * @param {Company} company
   * @returns {Node[]}
   */
  function companyLines(company) {
    const { identity, address } = company;
    if (view.mode === 'address') {
      return [
        h('div', { class: 'card-name' }, [identity.legalName]),
        h('div', {}, [address.line1]),
        address.line2 ? h('div', {}, [address.line2]) : null,
        h('div', {}, [`${address.postalCode} ${address.city}`]),
      ].filter((node) => node !== null);
    }
    return [
      h('div', { class: 'card-name' }, [identity.legalName]),
      line(t('field_identity_legalForm'), identity.legalForm.short),
      line(t('field_identity_siret'), CffFormat.display.siret(identity.siret)),
      line(t('field_address_city'), `${address.postalCode} ${address.city}`),
    ];
  }

  function render() {
    const state = view.state;
    if (!state) {
      return;
    }
    const company = state.tabCompany || state.last;
    byId('preview-label').textContent = t(
      state.tabCompany ? 'popupTabCompany' : 'popupLastCompany',
    );
    const card = byId('card');
    card.replaceChildren(
      ...(company
        ? companyLines(company)
        : [
            h('div', { class: 'card-name' }, [t('popupNoCompany')]),
            h('div', { class: 'card-empty' }, [t('popupHelp')]),
          ]),
    );
    byId('use-here').hidden = !(state.last && !state.tabCompany && view.tabId !== null);
    byId('private').hidden = !state.incognito;
    byId('storage-error').hidden = !state.storageError;
    applyTheme(state.theme);
  }

  async function refresh() {
    view.state = await send({
      type: 'cff:get-state',
      tabId: view.tabId,
      incognito: view.incognito,
    });
    render();
  }

  /**
   * @param {'company' | 'address'} mode
   */
  async function generate(mode) {
    view.mode = mode;
    await send({ type: 'cff:generate', tabId: view.tabId, incognito: view.incognito });
    await refresh();
  }

  function reportUrl() {
    const version = api.runtime.getManifest().version;
    const body = [
      '**Champ concerné** (libellé, et si possible extrait HTML) :',
      '',
      '**Ce qui était attendu** :',
      '',
      `Version : ${version}`,
      `Navigateur : ${navigator.userAgent}`,
    ].join('\n');
    const params = new URLSearchParams({
      title: 'Champ mal reconnu : ',
      body,
      labels: 'detection',
    });
    return `${ISSUES_URL}?${params}`;
  }

  async function start() {
    localize(document);
    byId('report').setAttribute('href', reportUrl());
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    view.tabId = tab && typeof tab.id === 'number' ? tab.id : null;
    view.incognito = Boolean(tab && tab.incognito);

    byId('generate-company').addEventListener('click', () => generate('company'));
    byId('generate-address').addEventListener('click', () => generate('address'));
    byId('use-here').addEventListener('click', async () => {
      const last = view.state && view.state.last;
      if (last) {
        await send({
          type: 'cff:use',
          companyId: last.id,
          tabId: view.tabId,
          incognito: view.incognito,
        });
        await refresh();
      }
    });
    byId('open-viewer').addEventListener('click', async () => {
      await send({ type: 'cff:open-viewer' });
      window.close();
    });
    await refresh();
  }

  start().catch(() => {
    byId('storage-error').hidden = false;
  });
})();
