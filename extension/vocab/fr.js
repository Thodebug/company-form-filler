/**
 * Field types recognized in French and English forms.
 *
 * Patterns run on normalized text: lowercase ASCII words separated by single
 * spaces ("N° de TVA" becomes "numero de tva", "companyName" becomes
 * "company name"). The order of TYPES is the priority used to break ties.
 *
 * Categories:
 *   - strong: specific to a company, qualifies a form as a company form;
 *   - address: postal address, three of them with postal code and city
 *     qualify a form as an address form;
 *   - generic: found on any site, never qualifies a form on its own.
 */
'use strict';

const CffVocab = (() => {
  /** Words that make a source describe something else than a company field. */
  const NOT_COMPANY_NAME =
    /\b(adresse|address|siret|siren|tva|vat|numero|number|code|e ?mail|courriel|phone|tel|telephone|type|forme|form|secteur|sector|taille|size|effectif|ville|city|pays|country|site|logo|iban|capital|date|activite|activity|creation|statut)\b/;

  /** @type {CffFieldType[]} */
  const TYPES = [
    // Company identifiers first: their keywords are the most specific.
    {
      id: 'siret',
      category: 'strong',
      keywords: [
        /sir+et/,
        /\b(numero|num|no|n|number) (d )?etablissement\b/,
        /\bestablishment (number|id|no)\b/,
      ],
      blockers: [/\b(tva|vat|intra ?com)\b/],
    },
    {
      id: 'siren',
      category: 'strong',
      keywords: [/siren/],
      blockers: [/\b(tva|vat|intra ?com)\b/],
    },
    {
      id: 'nic',
      category: 'strong',
      keywords: [/\bnic\b/],
    },
    {
      id: 'vat',
      category: 'strong',
      keywords: [/\btva\b/, /\bvat\b/, /intra ?com/, /\btax (id|number)\b/],
      blockers: [/\b(taux|rate|montant|amount|regime|assujetti|code tva|exoneration|exemption)\b/],
    },
    {
      id: 'rcs',
      category: 'strong',
      keywords: [/\brcs\b/, /registre du commerce/, /\btrade regist(er|ry)\b/, /\bgreffe\b/],
    },
    {
      id: 'naf',
      category: 'strong',
      keywords: [/\b(naf|ape|nace)\b/, /\bcode (d )?activite\b/, /\bactivite principale\b/],
    },
    {
      id: 'gln',
      category: 'strong',
      keywords: [/\bgln\b/, /global location number/],
    },
    {
      id: 'iban',
      category: 'strong',
      keywords: [
        /\biban\b/,
        /\brib\b/,
        /\bcompte bancaire\b/,
        /\bbank account\b/,
        /\baccount number\b/,
      ],
      blockers: [/\b(bic|swift|cle rib|banque|bank name|titulaire|holder)\b/],
    },
    {
      id: 'bic',
      category: 'strong',
      keywords: [/\b(bic|swift)\b/],
    },
    {
      id: 'legalForm',
      category: 'strong',
      keywords: [
        /\bforme (juridique|sociale)\b/,
        /\bstatut (juridique|legal)\b/,
        /\btype (de |d )?(societe|entreprise|structure)\b/,
        /\blegal (form|status|structure|entity type)\b/,
        /\b(company|business|entity) type\b/,
        /\bforme\b/,
      ],
    },
    {
      id: 'capital',
      category: 'strong',
      keywords: [/\bcapital( social)?\b/, /\bshare capital\b/],
    },
    {
      id: 'headcount',
      category: 'strong',
      keywords: [
        /\beffectifs?\b/,
        /\bnombre (de |d )?(salaries|employes|collaborateurs)\b/,
        /\btranche (d )?effectif\b/,
        /\bheadcount\b/,
        /\b(number of )?employees\b/,
        /\b(company|business) size\b/,
      ],
    },
    {
      id: 'creationDate',
      category: 'strong',
      keywords: [
        /\bdate (de |d )?(creation|immatriculation|debut d activite)\b/,
        /\bcreee? le\b/,
        /\b(creation|incorporation|registration|founding) date\b/,
        /\bdate (of )?(incorporation|creation)\b/,
        /\bfounded\b/,
      ],
    },
    {
      id: 'erpCompanyCode',
      category: 'strong',
      keywords: [/\bcode (societe|entreprise|entite|erp)\b/, /\bcompany code\b/, /\berp code\b/],
    },
    {
      id: 'tradeName',
      category: 'strong',
      keywords: [
        /\benseigne\b/,
        /\bnom commercial\b/,
        /\btrade name\b/,
        /\bbrand name\b/,
        /\bdoing business as\b/,
      ],
    },
    {
      id: 'legalName',
      category: 'strong',
      keywords: [
        /\braison sociale\b/,
        /\bdenomination( sociale)?\b/,
        /\bnom (de l |du |de la )?(societe|entreprise|structure|organisation|organisme|etablissement|client|fournisseur)\b/,
        /\b(company|organi[sz]ation|business|legal|corporate) name\b/,
        /\b(societe|entreprise|organisation|organisme|company|organi[sz]ation)\b/,
      ],
      blockers: [NOT_COMPANY_NAME, /\bcommercial\b/],
      autocomplete: ['organization'],
    },
    // Address.
    {
      id: 'fullAddress',
      category: 'address',
      keywords: [/\badresse (complete|postale complete)\b/, /\b(full|complete|postal) address\b/],
      blockers: [/\b(e ?mail|mail|courriel|ip|web|url)\b/],
      autocomplete: ['street-address'],
    },
    {
      id: 'addressLine2',
      category: 'address',
      keywords: [
        /\bcomplement( d adresse)?\b/,
        /\b(adresse|address) (ligne )?2\b/,
        /\b(address ?line ?2|addr ?2|line ?2|ligne ?2)\b/,
        /\b(batiment|appartement|apt|suite|lieu dit|residence|building)\b/,
      ],
      blockers: [/\b(pays|country|ville|city|fiscale?|tax|nom|name)\b/],
      autocomplete: ['address-line2', 'address-line3'],
    },
    {
      id: 'streetNumber',
      category: 'address',
      keywords: [
        /\bnumero (de |dans la )?(la )?(rue|voie)\b/,
        /\b(street|house|building) number\b/,
        /\bn voie\b/,
      ],
    },
    {
      id: 'street',
      category: 'address',
      keywords: [/\bnom (de la )?(rue|voie)\b/, /\blibelle (de la )?voie\b/, /\bstreet name\b/],
    },
    {
      id: 'postalCode',
      category: 'address',
      keywords: [
        /\bcode postal\b/,
        /\bcp\b/,
        /\bpostal ?code\b/,
        /\bzip( ?code)?\b/,
        /\bpost ?code\b/,
        /\bcode post\b/,
      ],
      autocomplete: ['postal-code'],
    },
    {
      id: 'city',
      category: 'address',
      keywords: [
        /\bville\b/,
        /\bcommune\b/,
        /\blocalite\b/,
        /\bcity\b/,
        /\btown\b/,
        /\blocality\b/,
      ],
      blockers: [/\b(naissance|birth|code|insee)\b/],
      autocomplete: ['address-level2'],
    },
    {
      id: 'department',
      category: 'address',
      keywords: [/\bdepartement\b/, /\bdepartment\b/, /\bdept\b/, /\bcounty\b/],
    },
    {
      id: 'region',
      category: 'address',
      keywords: [/\bregion\b/, /\bstate\b/, /\bprovince\b/],
      autocomplete: ['address-level1'],
    },
    {
      id: 'country',
      category: 'address',
      keywords: [/\bpays\b/, /\bcountry\b/, /\bnation\b/],
      blockers: [/\b(indicatif|dial|code tel|phone)\b/],
      autocomplete: ['country', 'country-name'],
    },
    {
      id: 'latitude',
      category: 'address',
      keywords: [/\blatitude\b/, /\blat\b/],
    },
    {
      id: 'longitude',
      category: 'address',
      keywords: [/\blongitude\b/, /\b(lng|lon)\b/],
    },
    {
      id: 'addressLine1',
      category: 'address',
      keywords: [
        /\badresse\b/,
        /\baddress\b/,
        /\b(address ?line ?1|addr ?1|line ?1|ligne ?1)\b/,
        /\b(rue|voie|street)\b/,
      ],
      blockers: [
        /\b(e ?mail|mail|courriel|electronique|ip|web|url|site|ville|city|pays|country|code postal|postal|zip)\b/,
        /\b(nom (de la )?(rue|voie)|libelle|numero|n voie|street (name|number))\b/,
      ],
      autocomplete: ['address-line1'],
    },
    // Generic.
    {
      id: 'mobile',
      category: 'generic',
      keywords: [/\b(portable|mobile|gsm|cellulaire|cell( phone)?)\b/],
      blockers: [/\b(app|application)\b/],
      autocomplete: ['tel-national', 'tel'],
    },
    {
      id: 'phone',
      category: 'generic',
      keywords: [/\b(telephone|tel|phone|fixe|standard|landline)\b/],
      blockers: [/\bfax\b/],
      autocomplete: ['tel', 'tel-national'],
      inputTypes: ['tel'],
    },
    {
      id: 'email',
      category: 'generic',
      keywords: [/\be ?mail\b/, /\bcourriel\b/, /\bmel\b/, /\badresse (electronique|mail)\b/],
      autocomplete: ['email'],
      inputTypes: ['email'],
    },
    {
      id: 'website',
      category: 'generic',
      keywords: [
        /\bsite( web| internet)?\b/,
        /\bweb ?site\b/,
        /\burl\b/,
        /\bhomepage\b/,
        /\bwww\b/,
      ],
      autocomplete: ['url'],
      inputTypes: ['url'],
    },
    {
      id: 'title',
      category: 'generic',
      keywords: [/\bcivilite\b/, /\bsalutation\b/, /\bhonorific\b/, /\btitle\b/],
      blockers: [/\b(job|poste|fonction)\b/],
      autocomplete: ['honorific-prefix'],
    },
    {
      id: 'firstName',
      category: 'generic',
      keywords: [/\bprenom\b/, /\bfirst ?name\b/, /\bgiven ?name\b/, /\bforename\b/],
      blockers: [/\b(nom et prenom|prenom et nom|nom prenom|prenom nom)\b/],
      autocomplete: ['given-name'],
    },
    {
      id: 'fullName',
      category: 'generic',
      keywords: [
        /\b(nom et prenom|prenom et nom|nom prenom|prenom nom|nom complet)\b/,
        /\bfull ?name\b/,
        /\b(your|contact) name\b/,
        /\bname\b/,
      ],
      blockers: [
        /\b(company|organi[sz]ation|business|legal|corporate|user|file|street|bank|first|last|family|given|trade|brand|domain)\b/,
      ],
      autocomplete: ['name'],
    },
    {
      id: 'lastName',
      category: 'generic',
      keywords: [/\bnom( de famille)?\b/, /\blast ?name\b/, /\bfamily ?name\b/, /\bsurname\b/],
      blockers: [
        /\b(prenom|societe|entreprise|commercial|utilisateur|user|domaine|banque|bank|rue|voie|ville|fichier|produit|projet|enseigne|raison|complet|organisation|organisme|structure|client|fournisseur|etablissement)\b/,
      ],
      autocomplete: ['family-name'],
    },
    {
      id: 'role',
      category: 'generic',
      keywords: [
        /\bfonction\b/,
        /\bposte\b/,
        /\bjob ?title\b/,
        /\bposition\b/,
        /\brole\b/,
        /\bqualite\b/,
      ],
      autocomplete: ['organization-title'],
    },
    {
      id: 'bankName',
      category: 'generic',
      keywords: [
        /\bbanque\b/,
        /\bbank( name)?\b/,
        /\betablissement bancaire\b/,
        /\bdomiciliation\b/,
      ],
      blockers: [/\b(iban|bic|swift|rib|account|compte|code)\b/],
    },
    {
      id: 'erpSiteCode',
      category: 'generic',
      keywords: [/\bcode (etablissement|site)\b/, /\b(site|establishment) code\b/],
    },
    {
      id: 'internalRef',
      category: 'generic',
      keywords: [
        /\breference interne\b/,
        /\bref interne\b/,
        /\binternal ref(erence)?\b/,
        /\b(external|externe) id\b/,
        /\bidentifiant externe\b/,
      ],
    },
    {
      id: 'uuid',
      category: 'generic',
      keywords: [/\b(uuid|guid)\b/],
    },
  ];

  /**
   * A source naming a person turns the company email and phone into the
   * manager's ones.
   */
  const PERSON_WORDS =
    /\b(dirigeant|gerant|gerante|president|presidente|representant|contact|personne|interlocuteur|manager|director|owner|prenom|nom|personal|perso|personnel|first name|last name)\b/;

  /** Field types that fit a numeric input (number, or tel for a numeric keypad). */
  const NUMERIC_TYPES = [
    'siren',
    'siret',
    'nic',
    'capital',
    'postalCode',
    'streetNumber',
    'latitude',
    'longitude',
    'headcount',
    'phone',
    'mobile',
    'gln',
  ];

  /** Input types that only accept some field types. */
  const INPUT_TYPE_ONLY = /** @type {Record<string, string[]>} */ ({
    email: ['email', 'managerEmail'],
    url: ['website'],
    date: ['creationDate'],
    tel: NUMERIC_TYPES,
    number: NUMERIC_TYPES,
  });

  /** Field types a textarea can hold. */
  const TEXTAREA_TYPES = ['fullAddress', 'addressLine1', 'addressLine2', 'legalName'];

  const BY_ID = new Map(TYPES.map((type) => [type.id, type]));

  return { TYPES, BY_ID, PERSON_WORDS, INPUT_TYPE_ONLY, TEXTAREA_TYPES };
})();
