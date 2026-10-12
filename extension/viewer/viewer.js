'use strict';

(() => {
  const { api, t, localize, send, applyTheme, h, icon, ICONS, copy } = CffPage;
  const { display } = CffFormat;
  const COPIED_MS = 1500;
  /** @type {readonly CffTheme[]} */
  const THEME_CYCLE = ['system', 'light', 'dark'];
  const THEME_MESSAGES = { system: 'themeSystem', light: 'themeLight', dark: 'themeDark' };
  const MAX_FAVORITES = 100;

  /**
   * @typedef {{ key: string, format?: (company: Company) => string, mono?: boolean }} FieldSpec
   * @typedef {{ group: CompanyGroup, fields: FieldSpec[] }} SectionSpec
   */

  /** @type {SectionSpec[]} */
  const SECTIONS = [
    {
      group: 'identity',
      fields: [
        { key: 'legalName' },
        { key: 'legalNameShort' },
        { key: 'tradeName' },
        {
          key: 'legalForm',
          format: (c) => `${c.identity.legalForm.short} (${c.identity.legalForm.label})`,
        },
        { key: 'siren', format: (c) => display.siren(c.identity.siren), mono: true },
        { key: 'nic', mono: true },
        { key: 'siret', format: (c) => display.siret(c.identity.siret), mono: true },
        { key: 'creationDate', format: (c) => display.date(c.identity.creationDate) },
        { key: 'rcs' },
      ],
    },
    {
      group: 'tax',
      fields: [
        { key: 'vatNumber', mono: true },
        { key: 'nafCode', mono: true },
        { key: 'nafLabel' },
        { key: 'nafCodeRev2', mono: true },
        { key: 'nafLabelRev2' },
        {
          key: 'shareCapital',
          format: (c) => display.euros(c.tax.shareCapital, t('viewerNoCapital')),
        },
        { key: 'headcountBand', format: (c) => c.tax.headcountBand.label },
        { key: 'vatRegime' },
        { key: 'vatCode', mono: true },
      ],
    },
    {
      group: 'address',
      fields: [
        { key: 'line1' },
        { key: 'line2' },
        { key: 'postalCode', mono: true },
        { key: 'city' },
        { key: 'inseeCode', mono: true },
        {
          key: 'departmentName',
          format: (c) => `${c.address.departmentCode} - ${c.address.departmentName}`,
        },
        { key: 'region' },
        { key: 'countryName' },
        { key: 'latitude', format: (c) => c.address.latitude.toFixed(6), mono: true },
        { key: 'longitude', format: (c) => c.address.longitude.toFixed(6), mono: true },
      ],
    },
    {
      group: 'contact',
      fields: [
        { key: 'phone', format: (c) => display.phone(c.contact.phone), mono: true },
        { key: 'email' },
        { key: 'website' },
      ],
    },
    {
      group: 'manager',
      fields: [
        { key: 'title' },
        { key: 'firstName' },
        { key: 'lastName' },
        { key: 'role' },
        { key: 'mobile', format: (c) => display.phone(c.manager.mobile), mono: true },
        { key: 'email' },
      ],
    },
    {
      group: 'bank',
      fields: [
        { key: 'bankName' },
        { key: 'bankCode', mono: true },
        { key: 'branchCode', mono: true },
        { key: 'accountNumber', mono: true },
        { key: 'ribKey', mono: true },
        { key: 'iban', format: (c) => display.iban(c.bank.iban), mono: true },
        { key: 'bic', mono: true },
      ],
    },
    {
      group: 'accounting',
      fields: [
        { key: 'customerCode', mono: true },
        { key: 'supplierCode', mono: true },
        { key: 'customerAccount', mono: true },
        { key: 'supplierAccount', mono: true },
        { key: 'auxiliaryAccount', mono: true },
        { key: 'paymentMethod' },
        { key: 'paymentTerms' },
        { key: 'currency' },
        { key: 'creditLimit', format: (c) => display.euros(c.accounting.creditLimit) },
      ],
    },
    {
      group: 'erp',
      fields: [
        { key: 'erpCompanyCode', mono: true },
        { key: 'erpSiteCode', mono: true },
        { key: 'gln', mono: true },
        { key: 'internalRef', mono: true },
        { key: 'uuid', mono: true },
      ],
    },
  ];

  /** @type {{ state: CffViewState | null, tab: 'history' | 'favorites' }} */
  const view = { state: null, tab: 'history' };

  /** @param {string} id */
  const byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

  /**
   * @param {Company} company
   * @param {SectionSpec} section
   * @param {FieldSpec} field
   * @returns {string}
   */
  function valueOf(company, section, field) {
    if (field.format) {
      return field.format(company);
    }
    const value = /** @type {Record<string, unknown>} */ (company[section.group])[field.key];
    return value === null || value === undefined ? '' : String(value);
  }

  /**
   * @param {string} text
   */
  function announce(text) {
    byId('status').textContent = text;
  }

  /**
   * @param {HTMLElement} holder
   * @param {string} text
   */
  async function copyValue(holder, text) {
    if (!(await copy(text))) {
      return;
    }
    holder.querySelector('.copied')?.remove();
    const badge = h('span', { class: 'copied' }, [t('viewerCopied')]);
    holder.append(badge);
    announce(`${t('viewerCopied')} : ${text}`);
    setTimeout(() => badge.remove(), COPIED_MS);
  }

  /**
   * @param {Company} company
   * @param {SectionSpec} section
   * @param {boolean} locked
   * @returns {HTMLElement}
   */
  function renderSection(company, section, locked) {
    const title = t(`group_${section.group}`);
    const lock = h(
      'button',
      {
        type: 'button',
        class: 'btn btn-quiet',
        'aria-pressed': String(locked),
        title: `${t(locked ? 'viewerUnlock' : 'viewerLock')}. ${t('viewerLockHint')}`,
        'aria-label': `${t(locked ? 'viewerUnlock' : 'viewerLock')} : ${title}`,
        'data-focus-key': `lock-${section.group}`,
      },
      [icon(locked ? ICONS.lockClosed : ICONS.lockOpen)],
    );
    lock.addEventListener('click', () => toggleLock(section.group));

    const rows = h('dl', { class: 'rows' });
    for (const field of section.fields) {
      const text = valueOf(company, section, field);
      const holder = h('dd');
      if (text) {
        const button = h(
          'button',
          {
            type: 'button',
            class: field.mono ? 'value mono' : 'value',
            title: t('viewerCopyHint'),
            'data-focus-key': `value-${section.group}-${field.key}`,
          },
          [text],
        );
        button.addEventListener('click', () => copyValue(holder, text));
        holder.append(button);
      } else {
        holder.append(h('span', { class: 'muted' }, ['-']));
      }
      rows.append(h('dt', {}, [t(`field_${section.group}_${field.key}`)]), holder);
    }
    return h('section', { class: locked ? 'group locked' : 'group', 'aria-label': title }, [
      h('header', { class: 'group-head' }, [h('h2', {}, [title]), lock]),
      rows,
    ]);
  }

  /**
   * @param {CffViewState} state
   */
  function renderSheet(state) {
    const company = state.last;
    const sheet = byId('sheet');
    byId('company-name').textContent = company ? company.identity.legalName : t('viewerTitle');
    byId('company-form').textContent = company ? company.identity.legalForm.short : '';
    document.title = `${company ? company.identity.legalName : t('viewerTitle')} | ${t('extName')}`;
    if (!company) {
      sheet.replaceChildren(h('p', { class: 'empty' }, [t('viewerEmpty')]));
      return;
    }
    sheet.replaceChildren(
      ...SECTIONS.map((section) =>
        renderSection(company, section, state.locks.includes(section.group)),
      ),
    );
  }

  /**
   * @param {CffViewState} state
   */
  function renderHeader(state) {
    const company = state.last;
    const isFavorite = Boolean(
      company && state.favorites.some((entry) => entry.company.id === company.id),
    );
    const full = state.favorites.length >= MAX_FAVORITES && !isFavorite;
    const favorite = /** @type {HTMLButtonElement} */ (byId('favorite'));
    const starIcon = icon(ICONS.star);
    starIcon.classList.add('icon-star');
    favorite.replaceChildren(
      starIcon,
      t(isFavorite ? 'viewerFavoriteRemove' : 'viewerFavoriteAdd'),
    );
    favorite.setAttribute('aria-pressed', String(isFavorite));
    favorite.disabled = !company || full;
    favorite.title = full ? t('viewerFavoritesFull') : '';

    const theme = /** @type {HTMLButtonElement} */ (byId('theme'));
    theme.replaceChildren(icon(ICONS.theme), t(THEME_MESSAGES[state.theme]));

    const fresh = /** @type {HTMLButtonElement} */ (byId('new-company'));
    fresh.replaceChildren(icon(ICONS.refresh), t('viewerNew'));
    fresh.title = state.locks.length ? t('viewerLockHint') : '';

    byId('storage-error').hidden = !state.storageError;
    byId('onboarding').hidden = state.onboardingDismissed;
  }

  /**
   * @param {Company} company
   * @returns {string}
   */
  function metaOf(company) {
    const created = new Date(company.createdAt);
    const when = Number.isNaN(created.getTime())
      ? ''
      : created.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    return `${company.identity.legalForm.short} | ${company.address.postalCode} ${company.address.city} | ${when}`;
  }

  /**
   * @param {string} label
   * @param {() => void} onClick
   * @param {{ title?: string, danger?: boolean, pressed?: boolean, disabled?: boolean, focusKey?: string }} [options]
   */
  function smallButton(label, onClick, options = {}) {
    const button = h(
      'button',
      {
        type: 'button',
        class: options.danger ? 'btn btn-danger' : 'btn',
        title: options.title,
        'aria-pressed': options.pressed === undefined ? undefined : String(options.pressed),
        disabled: options.disabled,
        'data-focus-key': options.focusKey,
      },
      [label],
    );
    button.addEventListener('click', onClick);
    return button;
  }

  /**
   * @param {CffViewState} state
   */
  function renderHistory(state) {
    const list = byId('history-list');
    if (state.history.length === 0) {
      list.replaceChildren(h('li', { class: 'muted' }, [t('viewerEmptyHistory')]));
      return;
    }
    const favorites = new Set(state.favorites.map((entry) => entry.company.id));
    const full = state.favorites.length >= MAX_FAVORITES;
    list.replaceChildren(
      ...state.history.map((company) => {
        const isCurrent = Boolean(state.last && state.last.id === company.id);
        const isFavorite = favorites.has(company.id);
        return h('li', { class: isCurrent ? 'entry current' : 'entry' }, [
          h('div', { class: 'entry-name' }, [company.identity.legalName]),
          h('div', { class: 'entry-meta' }, [
            isCurrent ? `${t('viewerCurrent')} | ${metaOf(company)}` : metaOf(company),
          ]),
          h('div', { class: 'entry-actions' }, [
            smallButton(t('viewerUse'), () => use(company.id), {
              title: t('viewerUseHint'),
              focusKey: `history-${company.id}-use`,
            }),
            smallButton(
              t(isFavorite ? 'viewerFavoriteRemove' : 'viewerFavoriteAdd'),
              () => setFavorite(company.id, !isFavorite),
              {
                pressed: isFavorite,
                disabled: full && !isFavorite,
                title: full && !isFavorite ? t('viewerFavoritesFull') : undefined,
                focusKey: `history-${company.id}-favorite`,
              },
            ),
            smallButton(t('viewerDelete'), () => removeFromHistory(company.id), {
              focusKey: `history-${company.id}-delete`,
            }),
          ]),
        ]);
      }),
    );
  }

  /**
   * @param {CffViewState} state
   */
  function renderFavorites(state) {
    const list = byId('favorites-list');
    if (state.favorites.length === 0) {
      list.replaceChildren(h('li', { class: 'muted' }, [t('viewerEmptyFavorites')]));
      return;
    }
    list.replaceChildren(
      ...state.favorites.map(({ company, label }) => {
        const input = h('input', {
          type: 'text',
          maxlength: '80',
          value: label,
          placeholder: t('viewerLabelPlaceholder'),
          'aria-label': `${t('viewerLabelPlaceholder')} : ${company.identity.legalName}`,
          'data-focus-key': `favorite-${company.id}-label`,
        });
        input.addEventListener('change', () => setFavorite(company.id, true, input.value));
        const isCurrent = Boolean(state.last && state.last.id === company.id);
        return h('li', { class: isCurrent ? 'entry current' : 'entry' }, [
          h('div', { class: 'entry-name' }, [company.identity.legalName]),
          h('div', { class: 'entry-meta' }, [metaOf(company)]),
          input,
          h('div', { class: 'entry-actions' }, [
            smallButton(t('viewerUse'), () => use(company.id), {
              title: t('viewerUseHint'),
              focusKey: `favorite-${company.id}-use`,
            }),
            smallButton(t('viewerFavoriteRemove'), () => setFavorite(company.id, false), {
              focusKey: `favorite-${company.id}-remove`,
            }),
          ]),
        ]);
      }),
    );
  }

  function renderTabs() {
    const history = view.tab === 'history';
    byId('tab-history').setAttribute('aria-selected', String(history));
    byId('tab-favorites').setAttribute('aria-selected', String(!history));
    byId('panel-history').hidden = !history;
    byId('panel-favorites').hidden = history;
  }

  // Runs on every storage change, so it must keep the keyboard focus and leave
  // a favorite label being typed alone.
  function render() {
    const state = view.state;
    if (!state) {
      return;
    }
    const active = document.activeElement;
    const focusKey = active ? active.getAttribute('data-focus-key') : null;
    const editingLabel = Boolean(
      active && active.closest('#favorites-list') && active.localName === 'input',
    );
    applyTheme(state.theme);
    renderHeader(state);
    renderSheet(state);
    renderHistory(state);
    if (!editingLabel) {
      renderFavorites(state);
    }
    renderTabs();
    if (focusKey && document.activeElement !== active) {
      restoreFocus(focusKey);
    }
  }

  /**
   * @param {string} focusKey
   */
  function restoreFocus(focusKey) {
    const same = document.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
    if (same instanceof HTMLElement) {
      same.focus();
      return;
    }
    // The entry was removed: focus the first control of its list.
    const listId = focusKey.startsWith('history-') ? 'history-list' : 'favorites-list';
    const fallback = byId(listId).querySelector('button, input') || byId(`tab-${view.tab}`);
    if (fallback instanceof HTMLElement) {
      fallback.focus();
    }
  }

  async function refresh() {
    view.state = await send({ type: 'cff:get-state' });
    render();
  }

  /** @param {CompanyGroup} group */
  async function toggleLock(group) {
    const locks = view.state ? view.state.locks : [];
    const next = locks.includes(group)
      ? locks.filter((entry) => entry !== group)
      : [...locks, group];
    await send({ type: 'cff:locks', locks: next });
    await refresh();
  }

  /** @param {string} companyId */
  async function use(companyId) {
    await send({ type: 'cff:use', companyId });
    await refresh();
    announceCompany();
    window.scrollTo({ top: 0 });
  }

  function announceCompany() {
    const company = view.state && view.state.last;
    if (company) {
      announce(`${t('viewerTitle')} : ${company.identity.legalName}`);
    }
  }

  /**
   * @param {string} companyId
   * @param {boolean} favorite
   * @param {string} [label]
   */
  async function setFavorite(companyId, favorite, label) {
    const existing = view.state?.favorites.find((entry) => entry.company.id === companyId);
    await send({
      type: 'cff:favorite',
      companyId,
      favorite,
      label: label ?? (existing ? existing.label : ''),
    });
    await refresh();
  }

  /** @param {string} companyId */
  async function removeFromHistory(companyId) {
    await send({ type: 'cff:history-delete', companyId });
    await refresh();
  }

  /**
   * ARIA tabs pattern: arrow keys switch tabs.
   * @param {KeyboardEvent} event
   */
  function onTabKey(event) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      view.tab = view.tab === 'history' ? 'favorites' : 'history';
      renderTabs();
      byId(`tab-${view.tab}`).focus();
    }
  }

  function bindEvents() {
    byId('new-company').addEventListener('click', async () => {
      await send({ type: 'cff:generate', useLocks: true });
      await refresh();
      announceCompany();
    });
    byId('favorite').addEventListener('click', () => {
      const company = view.state && view.state.last;
      if (company) {
        const isFavorite = view.state?.favorites.some((entry) => entry.company.id === company.id);
        setFavorite(company.id, !isFavorite);
      }
    });
    byId('theme').addEventListener('click', async () => {
      const current = view.state ? view.state.theme : 'system';
      const next = THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length];
      await send({ type: 'cff:theme', theme: next });
      await refresh();
    });
    byId('onboarding-close').addEventListener('click', async () => {
      await send({ type: 'cff:onboarding-dismiss' });
      await refresh();
    });
    for (const tab of /** @type {const} */ (['history', 'favorites'])) {
      byId(`tab-${tab}`).addEventListener('click', () => {
        view.tab = tab;
        renderTabs();
      });
      byId(`tab-${tab}`).addEventListener('keydown', onTabKey);
    }
    byId('clear-history').addEventListener('click', async () => {
      await send({ type: 'cff:history-clear' });
      await refresh();
    });
    byId('clear-all').addEventListener('click', () => {
      byId('confirm').hidden = false;
      byId('confirm-no').focus();
    });
    byId('confirm-no').addEventListener('click', () => {
      byId('confirm').hidden = true;
      byId('clear-all').focus();
    });
    byId('confirm-yes').addEventListener('click', async () => {
      byId('confirm').hidden = true;
      await send({ type: 'cff:clear-all' });
      await refresh();
    });

    // The menu and the popup can change the stored company too.
    api.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && 'cff' in changes) {
        refresh();
      }
    });

    // The background finds an open viewer by pinging it.
    api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (
        message &&
        typeof message === 'object' &&
        /** @type {{ type?: unknown }} */ (message).type === 'cff:viewer-ping'
      ) {
        api.tabs.getCurrent().then((tab) => sendResponse({ tabId: tab ? tab.id : null }));
        return true;
      }
      return undefined;
    });
  }

  async function start() {
    localize(document);
    document
      .querySelector('.side')
      ?.setAttribute('aria-label', `${t('viewerHistory')} / ${t('viewerFavorites')}`);
    bindEvents();
    await refresh();
  }

  start().catch(() => {
    byId('storage-error').hidden = false;
  });
})();
