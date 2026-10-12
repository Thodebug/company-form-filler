# Spécification v2 : Company Form Filler

Version finale, validée avant développement après deux audits indépendants, puis mise à jour
des ajustements faits pendant celui-ci (signalés « ajusté »). Elle remplace la spécification v1.

Les décisions marquées **[tech]** ont été tranchées par l'équipe de développement sans
question au commanditaire. Elles n'ont pas d'effet produit visible ou suivent une
recommandation validée. Elles peuvent être revues avant le début du code, pas après.

---

## 1. Projet

- **Nom** : Company Form Filler, version **2.0.0**.
- **Dépôt** : `Thodebug/siret-form-filler` est renommé `Thodebug/company-form-filler`.
  L'historique est conservé et GitHub redirige l'ancien nom.
- **Licence** : MIT pour le code. Les données embarquées ont leur propre licence (§2.12),
  dans `LICENSE-DATA.md`.
- **Fiche AMO** : on met à jour la **fiche existante**. L'identifiant Gecko
  `siret-form-filler@thodebug.github.io` est **conservé**, pour que les utilisateurs v1
  reçoivent la v2 par mise à jour automatique.
  - On ne crée pas de nouvelle fiche.
  - Le nom, la description, les captures et l'icône changent.
  - Le slug AMO change si AMO l'accepte.
- **Navigateurs** :
  - Firefox 142+ ;
  - Chrome et Edge 123+, par zip en mode développeur, sans store ;
  - Firefox Android n'est pas visé.
- **Langues** :
  - interface en français, avec tous les textes dans `_locales/fr/messages.json` (prête pour
    une traduction ; aucune locale anglaise livrée) ;
  - détection des champs avec un vocabulaire **français et anglais** ;
  - code, commentaires et commits en anglais.
- **Pays** : la France seule est livrée. Données et vocabulaire sont rangés par pays
  (`data/fr/`, `vocab/fr.js`). **[tech]** Aucune interface « module pays » n'est formalisée.
- **Principe** : données entièrement fictives mais cohérentes, tirées en local.
  **Aucune requête réseau** émise par l'extension.

---

## 2. Données générées

### 2.1 Modèle

**[tech]** L'objet `Company` est structuré par groupes et porte :

- `schemaVersion: 1` ;
- un `id` technique (UUID v4 construit avec `crypto.getRandomValues`, distinct de l'UUID ERP) ;
- `createdAt` (ISO 8601).

| Groupe       | Clés                                                                                                                                                                                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity`   | `legalName`, `legalNameShort`, `tradeName`, `legalForm` {code INSEE, abrégé, libellé}, `siren`, `nic`, `siret`, `creationDate`, `rcs`                                                                                                                                                    |
| `tax`        | `vatNumber`, `nafCode` (rév. 2.1), `nafLabel`, `nafCodeRev2`, `nafLabelRev2`, `shareCapital` (euros entiers ou `null` pour une EI), `headcountBand` {code INSEE, libellé}, `vatRegime`, `vatCode`                                                                                        |
| `address`    | `streetNumber`, `streetNumberSuffix`, `streetType`, `streetTypeShort`, `streetName`, `line1`, `line1Short` (ajusté : type de voie abrégé), `line2`, `postalCode`, `city`, `inseeCode`, `departmentCode`, `departmentName`, `region`, `country` (`FR`, `France`), `latitude`, `longitude` |
| `contact`    | `phone` (fixe société), `email`, `website`                                                                                                                                                                                                                                               |
| `manager`    | `title` (M., Mme), `firstName`, `lastName`, `role`, `mobile`, `email`                                                                                                                                                                                                                    |
| `bank`       | `bankName`, `bankCode`, `branchCode`, `accountNumber`, `ribKey`, `iban`, `bic`                                                                                                                                                                                                           |
| `accounting` | `customerCode`, `supplierCode`, `customerAccount`, `supplierAccount`, `auxiliaryAccount`, `paymentMethod`, `paymentTerms`, `currency`, `creditLimit`                                                                                                                                     |
| `erp`        | `erpCompanyCode`, `erpSiteCode`, `gln`, `internalRef`, `uuid`                                                                                                                                                                                                                            |

**Valeurs vides autorisées** : `streetNumberSuffix` et `line2` (chaîne vide), et
`shareCapital` (`null` pour une EI). Toutes les autres valeurs sont toujours présentes.
Au remplissage, **une valeur vide ou nulle n'est jamais écrite** : le champ est ignoré et
n'est pas compté dans le bandeau.

**Valeurs sources et valeurs dérivées** (utilisées par les verrous, §7) :

| Valeur dérivée                                                                           | Calculée à partir de                                    |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `siret`, `vatNumber`, `rcs`                                                              | `siren`, `nic`, et le département de l'adresse (greffe) |
| `shareCapital`, `headcountBand`, `role`, `vatRegime`, `vatCode`                          | `legalForm` (et la date de création pour les bornes)    |
| `legalName` d'une EI                                                                     | `manager.lastName` et `firstName`                       |
| `email`, `website`, `manager.email`, `auxiliaryAccount`, `erpCompanyCode`, `erpSiteCode` | `legalName` (slug) et le nom du dirigeant               |
| `phone` (fixe)                                                                           | zone de la commune                                      |
| `postalCode`, `inseeCode`, `department*`, `region`, `latitude`, `longitude`              | la commune                                              |
| `iban`, `ribKey`                                                                         | `bankCode`, `branchCode`, `accountNumber`               |

### 2.2 Identifiants légaux

- **SIREN** : 8 chiffres aléatoires (premier non nul) + clé de Luhn. `356000000` est exclu
  (acquis v1).
- **NIC** **[tech]** : 5 chiffres, de `00010` à `00099` (siège), tels que le SIRET passe Luhn.
  Jamais `00000`.
- **SIRET** = SIREN + NIC, Luhn valide sur 14 chiffres.
- **TVA** : `FR` + clé sur 2 chiffres `(12 + 3 × (SIREN mod 97)) mod 97` + SIREN.
- **RCS** : `RCS <ville du greffe> <A|B> <SIREN groupé 3-3-3>`.
  - Lettre **B** pour les sociétés, **A** pour toute EI (simplification documentée).
  - **[tech]** Le greffe est la préfecture du département de l'adresse.
- **Date de création** **[tech]** : uniforme entre une borne par forme et la veille du jour
  de génération. Elle n'est jamais dans le futur ni antérieure à la forme :
  - SAS : 01/01/1994 ;
  - SASU : 01/01/1999 ;
  - EURL : 01/01/1985 ;
  - autres formes : 01/01/1980.
- **Risque de collision** : aucune plage SIREN n'est réservée aux tests. Ce risque est
  accepté et documenté dans le README, la fiche AMO, la politique de confidentialité et
  l'en-tête de la page de consultation.

### 2.3 Formes juridiques (8, pondérées)

**[tech]** Pondération : SAS 25 %, SASU 20 %, SARL 20 %, EURL 10 %, EI 10 %, SCI 7 %,
SA 5 %, SNC 3 %.

| Forme | Code INSEE | Capital                                                | Fonction                    | NAF autorisés                   |
| ----- | ---------- | ------------------------------------------------------ | --------------------------- | ------------------------------- |
| SAS   | 5710       | 1 000 à 500 000 €                                      | Président                   | tous sauf location immobilière  |
| SASU  | 5720       | 1 000 à 100 000 €                                      | Président                   | tous sauf location immobilière  |
| SARL  | 5499       | 1 000 à 200 000 €                                      | Gérant                      | tous sauf location immobilière  |
| EURL  | 5498       | 1 000 à 50 000 €                                       | Gérant                      | tous sauf location immobilière  |
| SA    | 5599       | 37 000 à 5 000 000 €                                   | Président-directeur général | tous sauf location immobilière  |
| SNC   | 5202       | 1 000 à 100 000 €                                      | Gérant                      | commerce, services              |
| SCI   | 6540       | 1 000 à 100 000 €                                      | Gérant                      | location immobilière uniquement |
| EI    | 1000       | aucun (`null`, affiché « Sans capital », jamais écrit) | Entrepreneur individuel     | artisanat, services, commerce   |

- Les codes INSEE sont vérifiés contre la nomenclature des catégories juridiques au
  développement.
- Les capitaux sont des multiples de 1 000 €.
- Pour une EI, la raison sociale est `NOM PRENOM` du dirigeant, et le régime TVA peut être
  « franchise en base ».

### 2.4 Activité et effectif

- **NAF** : la **rév. 2.1** (NAF 2025, référence APE au 1er janvier 2027) sert de code par
  défaut. Le code **rév. 2** équivalent est stocké, affiché et utilisé au remplissage
  quand le champ l'attend (§5.3).
- **[tech]** Le tirage porte sur 91 sous-classes « plausibles pour une PME », limitées à
  celles dont l'équivalent rév. 2 est sans ambiguïté. Chaque sous-classe embarque son code et
  son libellé dans les deux nomenclatures (ajusté : les nomenclatures complètes ne sont pas
  embarquées, le remplissage d'un `select` n'a besoin que des codes de la société).
- **Effectif** : tranche INSEE tirée selon la forme :
  - EI, SASU, EURL : 00 à 02 ;
  - SA : 11 à 42 ;
  - autres formes : 00 à 21.

### 2.5 Raison sociale et enseigne

- **Format** : MAJUSCULES, sans accent, sans caractère spécial hors espace, apostrophe et
  tiret, **38 caractères maximum**. La forme juridique n'est **jamais** incluse.
- **Variante courte** (`legalNameShort`) : 20 caractères au plus, stockée pour rester stable.
  Elle sert quand `maxlength` est trop court.
- **Construction** **[tech]** : 8 à 10 motifs par famille de NAF (`<NOM> <METIER>`,
  `<METIER> <LIEU>`, `<INITIALES> <ACTIVITE>`, `<ADJ> <METIER>`...). Les mots viennent de
  listes écrites à la main, les noms de famille de §2.8.
- **Enseigne** : casse mixte, accents permis (« Atelier Delcourt »), dérivée de la raison
  sociale.
- **Exclusions** : un test vérifie une liste de mots interdits (marques connues, termes
  réglementés comme « banque » ou « assurance », grossièretés).

### 2.6 Adresse

- **Commune** : réelle, en **métropole et DOM** (971 à 976), **pondérée par la population**.
  Paris, Lyon et Marseille sont tirées par arrondissement. La Corse est codée 2A et 2B.
- **Libellés** **[tech]** :
  - `city` : libellé officiel COG en casse mixte (« Saint-Étienne ») ;
  - Paris, Lyon et Marseille : `city` vaut « Paris », « Lyon » ou « Marseille », avec le code
    postal et le code INSEE de l'arrondissement ;
  - les `select` sont comparés après normalisation (§5.4).
- **Code postal** : réel. Si la commune en a plusieurs, l'un est tiré.
- **GPS** : centre de la commune ± 0,01° aléatoire, 6 décimales.
- **Voie** **[tech]** :
  - numéro de 1 à 199, suffixe bis ou ter dans 5 % des cas ;
  - type de voie pondéré (rue, avenue, boulevard, place, chemin, allée, impasse, route, quai) ;
  - nom tiré d'une liste générique de noms de voies courants ;
  - `line1Short` abrège le type de voie (« 12 bis av. de la Gare »), utilisée quand le champ est
    trop court (ajusté : plus utile qu'une voie sans son type).
- **Complément** (`line2`) : vide dans 60 % des cas, sinon « Bâtiment B », « ZA des ... »,
  « Lot 12 ».

### 2.7 Contact

- **Fixe société** : dans la plage fictive ARCEP de la zone de la commune :
  - 01 99 00 xx xx pour l'Île-de-France ;
  - 02 61 91, 03 53 01, 04 65 71, 05 36 49 pour les autres zones ;
  - les DOM suivent leur zone réelle : 05 pour les Antilles et la Guyane, 02 pour La Réunion et
    Mayotte (ajusté).

  **[tech]** Les plages sont vérifiées contre la décision ARCEP en vigueur et sourcées
  dans `LICENSE-DATA.md`.

- **Mobile du dirigeant** : 06 39 98 xx xx (plage fictive ARCEP).
- **Email société** : `contact@<slug>.example.com`.
- **Email du dirigeant** : `<prenom>.<nom>@<slug>.example.com`.
- **Site** : `https://www.<slug>.example.com`.
- **Slug** : raison sociale en minuscules, avec des tirets, 30 caractères au plus.

### 2.8 Dirigeant

- **Prénoms** : 240 prénoms courants (120 féminins, 120 masculins), avec leur genre.
- **Noms** **[tech]** : 290 noms de famille parmi les plus fréquents en France.
- Ajusté : ces listes sont établies à la main (un prénom ou un nom isolé n'est pas protégé),
  les fichiers de l'INSEE n'étant pas accessibles depuis l'environnement de construction.
- **Civilité** : cohérente avec le genre du prénom.
- **Fonction** : selon la forme (§2.3).

### 2.9 Banque

- **IBAN FR** de 27 caractères : `FR` + clé + code banque (5) + guichet (5) + compte
  (11 chiffres) + clé RIB (2).
  - Clé RIB : `97 - ((89 × banque + 15 × guichet + 3 × compte) mod 97)`.
  - Clé IBAN : mod 97, ISO 13616.
- **Banques fictives** : 6 noms inventés, chacun avec un code banque **non attribué**
  **[tech]**, vérifié contre la liste publique des établissements de crédit.
- **BIC** : 8 caractères `XXXXFRPP`, avec un code établissement inventé et non attribué.

### 2.10 Comptabilité et conditions commerciales

Ces données sont affichées dans la fiche et ne sont jamais détectées dans les formulaires.

**[tech]**

- **Codes tiers** : `customerCode` = `C` + 6 chiffres ; `supplierCode` = `F` + 6 chiffres.
- **Comptes** :
  - `customerAccount` = `411` + 5 chiffres ;
  - `supplierAccount` = `401` + 5 chiffres ;
  - `auxiliaryAccount` = 3 lettres du nom + 5 chiffres.
- **Mode de règlement** : virement, prélèvement, chèque, LCR, carte.
- **Délai** : comptant, 30 jours, 30 jours fin de mois, 45 jours fin de mois, 60 jours.
- **Devise** : EUR.
- **Régime TVA** : réel normal, réel simplifié, franchise en base (EI seulement).
- **Code TVA** : `TVA20`, `TVA10`, `TVA55`, `EXO`.
- **Encours** : 5 000 à 100 000 €, par pas de 5 000 €.

### 2.11 ERP et références

Ces données sont détectées dans les formulaires.

- **Codes ERP** :
  - `erpCompanyCode` : 3 lettres + 3 chiffres (`DEL001`) ;
  - `erpSiteCode` : `erpCompanyCode` + `-` + 2 chiffres.
- **GLN** **[tech]** : 13 chiffres avec le préfixe GS1 de **circulation restreinte** `2`
  (usage interne), donc sans collision possible avec un GLN attribué. Clé GS1 mod 10
  (poids 3 et 1, ce n'est pas la clé de Luhn).
- **`internalRef`** : `REF-` + 8 caractères alphanumériques majuscules.
- **`uuid`** : UUID v4.

### 2.12 Sources et licences

| Données                                      | Source                                                             | Licence             |
| -------------------------------------------- | ------------------------------------------------------------------ | ------------------- |
| Communes, codes INSEE, départements, régions | INSEE, Code officiel géographique 2026                             | Licence Ouverte 2.0 |
| Codes postaux                                | Base officielle des codes postaux (La Poste, data.gouv.fr)         | Licence Ouverte 2.0 |
| Population                                   | INSEE, populations légales                                         | Licence Ouverte 2.0 |
| Coordonnées des communes                     | IGN Admin Express COG, via `gregoiredavid/france-geojson` (ajusté) | Licence Ouverte 2.0 |
| NAF rév. 2                                   | INSEE, via `@socialgouv/codes-naf`                                 | Licence Ouverte 2.0 |
| NAF 2025 (sélection)                         | INSEE, Structure de la NAF 2025                                    | Licence Ouverte 2.0 |
| Catégories juridiques                        | INSEE                                                              | Licence Ouverte 2.0 |
| Prénoms, noms                                | Listes établies à la main (ajusté)                                 | sans objet          |
| Plages téléphoniques fictives                | ARCEP, plan de numérotation, article 2.5.12                        | référence citée     |

- Aucune source sous ODbL n'est utilisée.
- Les données sont produites par `scripts/build-data.mjs`, script reproductible qui indique
  les sources et les millésimes. Elles sont commitées dans `extension/data/fr/`.
- `LICENSE-DATA.md` cite chaque source avec sa date.
- La mise à jour consiste à relancer le script une fois par an.
- Le script remplace les tirets cadratins et demi-cadratins et les points médians, conformément
  à la règle du projet.

### 2.13 Aléa

- `crypto.getRandomValues` uniquement.
- **[tech]** Un nouveau `randomInt(max)` sur 32 bits remplace celui de la v1, limité à 256.
  Le tirage pondéré est cumulatif.
- Aucune graine.

---

## 3. Détection

### 3.1 Éléments éligibles

- **Éléments retenus** : `input` de type text, tel, number, search, email, url ou date, ou
  sans type ; `select` ; `textarea`.
- **Exclus** : password, hidden, checkbox, radio, file, `readonly`, `disabled`,
  contenteditable.
- **Champ cliqué** : un clic droit sur un `select` ne donne pas le contexte `editable` du
  menu. Un `select` ne peut donc **jamais être le champ cliqué**. Les `select` ne sont
  détectés et remplis qu'au sein d'un bloc.
- **Visibles seulement** : sont exclus les éléments en `display:none` ou `visibility:hidden`,
  de taille nulle, en `aria-hidden="true"` ou dans un ancêtre masqué. Exception : un champ
  masqué par un composant de saisie masquée (PrimeNG...) dont l'hôte est visible (acquis v1).

### 3.2 Types reconnus (liste fermée)

**[tech]** Une table déclarative (`vocab/fr.js`) décrit chaque type : mots-clés FR et EN,
mots bloquants, jetons `autocomplete` HTML, indices de forme, libellé de menu, formats.

| Catégorie                                    | Types                                                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Forts société** (qualifient un formulaire) | raison sociale, enseigne, forme juridique, SIREN, SIRET, NIC, TVA, NAF/APE, capital, RCS, effectif, date de création, IBAN, BIC, GLN, code société ERP |
| **Adresse**                                  | ligne 1, complément, numéro, voie, code postal, ville, département, région, pays, adresse complète, latitude, longitude                                |
| **Génériques** (ne qualifient jamais seuls)  | téléphone, mobile, email, site web, civilité, prénom, nom, nom complet, fonction, nom de banque, référence interne, UUID, code établissement ERP       |

**Moteur** **[tech]** : le scoring de la v1 est généralisé à N types.

- Les poids sont ceux de la v1.
- `autocomplete` vaut **3** quand sa valeur est un jeton HTML standard connu.
- Un mot-clé est obligatoire, sauf pour un jeton `autocomplete` standard.
- Le score minimum est 3.
- Départage : le meilleur score l'emporte, puis la priorité de la table.
- Les bloquants sont définis par type.
- Mots ambigus :
  - « adresse email » ou « adresse mail » donne email ;
  - « nom » suivi de société ou entreprise donne raison sociale ;
  - « nom d'utilisateur » est bloquant ;
  - « code » seul ne qualifie rien.

**Société ou dirigeant pour un générique** : un champ email ou téléphone reçoit par défaut la
valeur de la **société** (`contact.email`, `contact.phone`). Il reçoit celle du **dirigeant**
(`manager.email`, `manager.mobile`) dans deux cas :

- la même source nomme le dirigeant, le gérant, le contact, la personne, ou contient un
  prénom ou un nom ;
- le type reconnu est « mobile ».

### 3.3 Bloc et qualification

1. **Bloc de départ** : on remonte depuis le champ cliqué, en traversant le shadow DOM, jusqu'au
   premier ancêtre qui contient au moins **3 types distincts reconnus et visibles**, champ
   cliqué compris. Un `form` est une frontière : si le formulaire du champ en compte moins de
   3, il n'y a pas de bloc (ajusté : sans cela, un champ isolé dans un petit formulaire
   rejoignait les formulaires voisins de la page).
2. **Extension** : on continue de remonter tant que :
   - l'ancêtre suivant n'est pas `body` ;
   - l'ancêtre courant n'est pas déjà un `form` ;
   - le nouvel ancêtre n'introduit **aucun type déjà présent** dans le bloc courant.

   Effet : un formulaire découpé en sections (identité / adresse / banque) est rempli en
   entier, tandis que des blocs répétés (facturation / livraison, lignes de tableau)
   arrêtent l'extension au bloc cliqué.

3. **Qualification « société »** : le bloc contient au moins un type **fort société**.
4. **Qualification « adresse »** : sinon, le bloc contient au moins 3 types **adresse**
   distincts, dont code postal et ville.
5. **Sinon** : aucun bloc qualifié.
6. **Doublons** dans le bloc final (par exemple email et confirmation d'email) : même valeur.
7. **[tech]** Le comptage traverse les shadow roots ouverts et fermés. Il s'arrête au bout
   de **2 000 nœuds** parcourus ; au-delà, le verdict de bloc est négatif.
8. Les frames sont traitées une par une. Un formulaire réparti sur plusieurs iframes n'est
   pas vu entier : c'est une limite documentée.

### 3.4 Moment du calcul

- **Firefox** : à `menus.onShown`, comme en v1, avec un budget de 100 ms.
- **Chromium** : au `pointerdown` du bouton droit, à `contextmenu` (ce qui couvre le
  Ctrl+clic sur Mac), à la touche Menu et à Maj+F10. Le verdict de champ seul est aussi
  calculé au `focusin`.
- **Limite connue sous Chromium** : le menu peut s'ouvrir avec le verdict précédent
  (rare, déjà documenté en v1).
- **[tech]** **Au clic sur une entrée, l'action est toujours réévaluée** dans le script de
  contenu. Si elle n'est plus valide (champ non reconnu, bloc non qualifié), rien n'est
  écrit et le bandeau affiche « Champ non reconnu ».

---

## 4. Menu contextuel

### 4.1 Société de l'onglet

- **Société de l'onglet** : chaque onglet possède au plus **une société en cours**.
  - Elle est **vidée à chaque navigation** de la frame principale de l'onglet : nouveau
    document, rechargement compris.
  - Les changements de route d'une application monopage (`pushState`) ne la vident pas.
  - Elle est vidée aussi à la fermeture de l'onglet.
- **Origine** : la société de l'onglet est créée par la première action qui en a besoin
  (§4.3). Elle est aussi attribuée à l'onglet quand l'utilisateur génère ou choisit une
  société depuis le popup ou la fiche (§6, §7).
- **[tech]** Stockage dans `storage.session`, indexé par identifiant d'onglet : en mémoire,
  jamais sur disque, et conservé pendant la mise en veille de l'arrière-plan. Le script de
  contenu de la frame principale signale chaque nouveau document (`cff:page`).
- **Dernière société** : la dernière société créée ou choisie, tous onglets confondus.
  C'est elle que montrent la fiche et, à défaut de société d'onglet, le popup.

### 4.2 Entrées

Une entrée parente fixe **« Company Form Filler »** (contexte `editable`) porte quatre
sous-entrées conditionnelles. L'entrée parente est masquée quand aucune ne s'applique.

| #   | Libellé                                                            | Visible si                                                                            |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 1   | « Remplir ce champ : <type> » (ex. « Remplir ce champ : SIRET »)   | le champ cliqué est un type fort ou adresse                                           |
| 2   | « Remplir le formulaire avec la société en cours »                 | un bloc est qualifié **et** l'onglet a une société en cours                           |
| 3   | « Nouvelle société et remplir » ou « Nouvelle adresse et remplir » | un bloc est qualifié (société ou adresse, §3.3)                                       |
| 4   | « Annuler le dernier remplissage »                                 | la frame cliquée garde des données d'annulation (§5.2), quel que soit le champ cliqué |

- Le libellé de chaque type est défini dans `messages.json`, avec un message par type.
- Un clic droit sur un champ non reconnu dans un bloc qualifié affiche les entrées 2 et 3.
- Un champ générique isolé (hors bloc qualifié) n'affiche aucune entrée, sauf l'entrée 4.
- **Pas de raccourci clavier.** La touche Menu et Maj+F10 fonctionnent (acquis v1).
- **[tech]** `ensureMenus()` est idempotente et appelée à `onInstalled`, `onStartup` et sur
  échec d'un `update`. Sous Firefox, la mise à jour se fait en un lot avant `refresh`.

### 4.3 Effet de chaque entrée

1. **Remplir ce champ** : écrit la valeur de la **société de l'onglet**. S'il n'y en a pas,
   une nouvelle société est créée : elle devient celle de l'onglet et la dernière société,
   et elle entre dans l'historique. Il n'y a **pas** d'entrée « nouvelle société pour ce
   champ » : pour obtenir un nouveau numéro, on change de page ou on génère depuis le popup.
2. **Remplir avec la société en cours** : écrit la société de l'onglet dans tout le bloc.
3. **Nouvelle société / adresse et remplir** : crée une **société complète** neuve, qui
   devient celle de l'onglet et la dernière société, et entre dans l'historique.
   - En mode société, tout le bloc est écrit.
   - En mode adresse, seuls les champs adresse et les génériques du bloc sont écrits.
4. **Annuler le dernier remplissage** : restaure les valeurs précédentes de tous les champs
   touchés par le dernier remplissage de la frame, `select` compris, en déclenchant `input`
   et `change`.

---

## 5. Remplissage

### 5.1 Règles générales

- **Écrasement** : tout champ reconnu du bloc est écrasé, même s'il est déjà rempli. Les
  valeurs vides ou nulles ne sont jamais écrites (§2.1).
- **Ordre** **[tech]** :
  1. pays, région, département, code postal, ville ;
  2. les autres champs, dans l'ordre du DOM ;
  3. attente de 150 ms, relecture, puis seconde passe sur les champs dont la page a changé
     la valeur.
- **Séquence par champ** **[tech]** :
  1. `focus({preventScroll: true})` ;
  2. insertion par `execCommand('insertText')` pour les champs texte. Si l'insertion réussit,
     **aucun** `input` synthétique supplémentaire n'est émis. Sinon, affectation par le
     setter natif puis `input` ;
  3. `change` ;
  4. vrai `blur()`, pour déclencher les validations de la page.

  À la fin, le focus revient au champ cliqué, avec `preventScroll`. Un `select` reçoit son
  option par `selectedIndex`, puis `input` et `change`.

- **Contrôle** : on relit la valeur et on la compare à la valeur attendue normalisée selon le
  type. Si elle diffère, on refait l'écriture par affectation. Si elle diffère encore, on
  **restaure l'ancienne valeur** et le champ est compté comme ignoré.
- **Champs ignorés** : valeur refusée, `select` sans option correspondante, `maxlength` trop
  court sans variante. Ils sont laissés dans leur état d'origine.

### 5.2 Bandeau et annulation

- **Quand** : un bandeau s'affiche dès qu'**au moins un champ a été tenté**. Exemples :
  - « 12 champs remplis, 2 ignorés » ;
  - « SIRET rempli » ;
  - « Champ ignoré : valeur refusée par la page » ;
  - « Champ non reconnu ».
- **Présentation** :
  - en bas à droite de la page ;
  - avec un lien « Annuler » quand quelque chose a été écrit ;
  - il disparaît après 6 s ou au clic.
- **Accessibilité** : `role="status"`, `aria-live="polite"`.
- **Technique** **[tech]** :
  - le bandeau est dans un shadow root fermé ;
  - les styles passent par une `CSSStyleSheet` adoptée et les propriétés CSSOM (aucun
    `<style>` ni attribut `style` inséré), avec `all: initial` sur l'hôte, pour résister
    aux CSP strictes ;
  - il s'affiche en `popover="manual"` pour rester cliquable au-dessus d'un `<dialog>`
    modal.
- **Données d'annulation** : elles restent en mémoire dans le script de contenu de la frame,
  pour le dernier remplissage seulement. Elles sont perdues au rechargement. Le verdict
  d'entrée 4 interroge le script de contenu et ne s'appuie sur aucun état de l'arrière-plan.

### 5.3 Formats adaptatifs

**[tech]**

- Le format par défaut est le premier de chaque ligne.
- Seuls le placeholder, le masque, le pattern (lu comme texte, jamais exécuté) et
  `maxlength` choisissent un format alternatif.
- L'attribut `type` seul ne change rien, sauf `type=date` et `type=number`.

| Type                 | Formats                                                                | Indice du format alternatif                                                                                                               |
| -------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| SIRET                | `12345678900012` / `123 456 789 00012`                                 | maxlength 17, masque ou placeholder avec espaces                                                                                          |
| SIREN                | `123456789` / `123 456 789`                                            | maxlength 11, masque ou placeholder avec espaces                                                                                          |
| TVA                  | `FR12123456789` / `FR 12 123456789`                                    | placeholder ou masque avec espaces                                                                                                        |
| NAF                  | rév. 2.1 `62.10C` / sans point / rév. 2                                | placeholder ou pattern sans point ; rév. 2 si le placeholder est un code rév. 2 connu, ou si un `select` ne contient que des codes rév. 2 |
| Téléphone            | `0199001234` / `01 99 00 12 34` / `+33199001234` / `+33 1 99 00 12 34` | placeholder ou masque : espaces, `+33` ou les deux                                                                                        |
| IBAN                 | collé / groupé par 4                                                   | maxlength ≥ 33, placeholder ou masque avec espaces                                                                                        |
| Date                 | `JJ/MM/AAAA` / `AAAA-MM-JJ`                                            | `type=date` ou placeholder `AAAA-MM-JJ`                                                                                                   |
| Capital              | `10000` / `10 000`                                                     | placeholder avec espace ; `type=number` donne toujours le format collé                                                                    |
| Code postal          | `75008`                                                                | aucun                                                                                                                                     |
| Adresse en une ligne | `12 rue X, 75008 Paris`                                                | type « adresse complète » en `input`                                                                                                      |
| Adresse multi-lignes | ligne 1, ligne 2 (si non vide), `CP Ville`                             | type « adresse complète » en `textarea`                                                                                                   |
| Nom complet          | `Prénom Nom`                                                           | aucun                                                                                                                                     |
| Latitude, longitude  | 6 décimales, point                                                     | aucun                                                                                                                                     |

L'exemple NAF de la table (`62.10C`) est indicatif : les codes rév. 2.1 réels sont pris dans
la nomenclature INSEE.

### 5.4 Listes déroulantes (`select`)

- **Normalisation** : minuscules, sans accents ni ponctuation, espaces réduites.
- **Comparaison** : d'abord la `value`, puis le libellé, avec une table de synonymes par
  type :
  - forme juridique : abrégé, libellé complet, code INSEE sur 4 et sur 2 chiffres ;
  - pays : `FR`, `FRA`, `250`, `France` ;
  - département : `75`, `075`, `Paris`, `75 - Paris` ;
  - région : nom et code ;
  - civilité : `M`, `M.`, `Monsieur`, `Mr`, `Mme`, `Madame`, `Mrs`, `Ms` ;
  - NAF : rév. 2.1 puis rév. 2.
- **Correspondance** : égalité d'abord, puis « commence par ». Sans correspondance, le champ
  est ignoré.
- **Hors périmètre, documenté** :
  - les listes personnalisées (select2, PrimeNG Dropdown, MUI, ng-select) ;
  - les autocomplétions d'adresse (API Adresse, Google Places).

### 5.5 Longueur

- On ne tronque **jamais**.
- Si `maxlength` est trop court, on écrit la variante courte quand elle existe :
  - raison sociale : `legalNameShort` ;
  - adresse : `line1Short`.
- Sinon, le champ est ignoré et compté dans le bandeau.

---

## 6. Popup du bouton de l'extension

- **Largeur** : fixe, 340 px.
- **Aperçu** : la société de l'**onglet actif** s'il en a une, sinon la dernière société.
  Il est accompagné de la mention « Société de cet onglet » ou « Dernière société ».
  - Il montre la raison sociale, la forme, le SIRET et la ville.
  - Quand il n'y a aucune société : « Aucune société », suivi d'une phrase d'aide.
- **Boutons** :
  - « **Société fictive** » : crée une société complète, l'**attribue à l'onglet actif**, en
    fait la dernière société, l'ajoute à l'historique et met l'aperçu à jour **sans quitter
    le popup** ;
  - « **Adresse fictive** » : même chose, mais l'aperçu montre l'adresse complète (ligne 1,
    ligne 2, CP, ville) à la place de la forme et du SIRET, jusqu'à la fermeture du popup ;
  - « **Utiliser dans cet onglet** » : visible quand l'aperçu montre la dernière société et
    non celle de l'onglet. Il attribue cette société à l'onglet actif ;
  - « **Ouvrir la fiche** » : ouvre la fiche, ou active l'onglet qui la contient déjà.
- **Lien « Signaler un champ mal reconnu »** : il ouvre une issue GitHub préremplie (gabarit
  avec le navigateur et la version). L'URL de la page n'est **jamais** jointe.
- **Navigation privée** : dans une fenêtre privée (si l'utilisateur a autorisé l'extension en
  privé), le popup fonctionne de la même façon. Les sociétés créées restent en
  `storage.session` et ne vont jamais dans l'historique ni sur disque. La mention « Fenêtre
  privée : rien n'est enregistré » s'affiche.
- **Erreurs** (stockage indisponible) : affichées dans le popup.

---

## 7. Page de consultation (fiche)

### 7.1 Ouverture et contenu

- **Onglet unique** : il est réutilisé et activé s'il existe déjà.
  - **[tech]** La fiche connaît son onglet par `tabs.getCurrent()` et répond au message
    `cff:viewer-ping`. L'arrière-plan l'active ensuite avec `tabs.update` et
    `windows.update`. Aucune permission `tabs` n'est nécessaire.
  - La fiche montre la **dernière société** et se met à jour en direct
    (`storage.onChanged`).
  - Elle s'ouvre toujours dans une fenêtre normale (contrainte Chrome en mode `spanning`) et
    n'affiche jamais de société privée.
- **Onglet cible** : **[tech]** l'arrière-plan mémorise le dernier onglet web actif
  (`tabs.onActivated`, sans permission, en ignorant les pages de l'extension). C'est lui que
  visent « Nouvelle société » et « Utiliser » depuis la fiche. Si cet onglet a été fermé, la
  société devient seulement la dernière société.
- **En-tête** :
  - raison sociale et forme ;
  - « Nouvelle société » : régénère en respectant les verrous, l'attribue à l'onglet cible,
    l'ajoute à l'historique ;
  - « Favori » ;
  - bascule de thème ;
  - avertissement permanent : « Données fictives. Un numéro généré peut correspondre à une
    entité réelle. »
- **Corps** : une section par groupe (§2.1), dans cet ordre :
  1. identité ;
  2. fiscal et activité ;
  3. adresse (avec latitude et longitude en texte, sans carte) ;
  4. contact ;
  5. dirigeant ;
  6. banque ;
  7. comptabilité et conditions ;
  8. ERP et références.

  Chaque valeur a un libellé et une valeur formatée. Un clic sur la valeur copie la valeur
  affichée, avec un retour « Copié » pendant 1,5 s. Il n'y a pas de copie globale.

### 7.2 Verrous

- Un cadenas par section, soit 8 verrous.
- Un groupe verrouillé garde ses **valeurs sources** lors de « Nouvelle société » dans la
  fiche.
- Les **valeurs dérivées** (§2.1) sont **toujours recalculées**, même dans un groupe
  verrouillé, pour rester cohérentes. Exemples :
  - adresse verrouillée et identité régénérée : SIREN, NIC et raison sociale changent ; la
    TVA et le SIRET sont recalculés ; le RCS garde le greffe du département verrouillé ;
  - identité verrouillée et dirigeant régénéré : la fonction reste celle de la forme
    verrouillée ;
  - pour une EI dont l'identité est verrouillée, le dirigeant n'est pas régénéré (sa
    raison sociale en dépend).
- **Les verrous ne s'appliquent qu'au bouton de la fiche**, jamais au clic droit ni au
  popup. Ils sont mémorisés dans `storage.local`.

### 7.3 Historique et favoris

Ils occupent un panneau latéral.

- **Historique** : les **20 dernières** sociétés neuves (popup, menu, fiche), de la plus
  récente à la plus ancienne. Les réutilisations n'y entrent pas.
- **Actions par entrée** : « Utiliser » (attribue la société à l'onglet cible, en fait la
  dernière société et l'affiche dans la fiche), « Favori », « Supprimer ». Supprimer une
  entrée ne change ni la dernière société ni les sociétés d'onglet.
- **Favoris** :
  - étoile et **étiquette libre** facultative ;
  - **100 au maximum** : au-delà, l'étoile est désactivée avec le message « 100 favoris
    maximum » ;
  - jamais purgés automatiquement, suppression individuelle ;
  - un favori reste aussi dans l'historique tant qu'il n'en sort pas.
- **Boutons globaux** :
  - « Vider l'historique » garde les favoris et la dernière société ;
  - « Tout effacer » efface la dernière société, l'historique, les favoris et les verrous,
    mais garde le thème et le guide. Il demande une confirmation dans la page, sans boîte
    de dialogue du navigateur.

### 7.4 Premier lancement

À l'installation et à la mise à jour depuis la v1, la fiche s'ouvre avec une première
société générée. Un encart de 3 lignes (clic droit, popup, fiche) l'accompagne et peut être
fermé définitivement.

### 7.5 Style

- **Esthétique ERP fonctionnelle** :
  - rectangles, bordures fines ;
  - ni ombre ni dégradé ;
  - police système, densité élevée ;
  - accent indigo de l'icône.
- **Thème** : un bouton à **3 états** (système, clair, sombre). Le choix est mémorisé et
  s'applique au popup et à la fiche.
- **Accessibilité** : contrastes WCAG 2.1 AA, navigation complète au clavier, focus visible.
- **Responsive** : la fiche est utilisable de 360 à 1 920 px. Sous 900 px, le panneau
  latéral passe sous la fiche.

---

## 8. Stockage et vie privée

- **Permission `storage`**.
- **`storage.local`** (jamais synchronisé) **[tech]**, avec les clés : `schemaVersion`,
  `last` (dernière société, fenêtres normales seulement), `history` (20 au plus),
  `favorites` (100 au plus, avec `label`), `locks`, `theme`, `onboardingDismissed`.
- **`storage.session`** (en mémoire, jamais sur disque) : les sociétés d'onglet (normales et
  privées), le dernier onglet web actif, et les sociétés privées du popup.
- **Validation** **[tech]** :
  - chaque objet est validé à la lecture ; un objet invalide est ignoré ;
  - une migration est prévue par `schemaVersion` (la v2 est la version 1) ;
  - si le stockage échoue, l'extension continue en mémoire et affiche une erreur dans le
    popup et la fiche.
- **Navigation privée** :
  - l'extension ne tourne en privé que si l'utilisateur l'autorise, ce qui est désactivé par
    défaut (documenté) ;
  - quand elle tourne en privé, **rien** n'est écrit dans `storage.local` ;
  - **[tech]** `incognito: "spanning"`, détection par `tab.incognito`.
- **Aucune collecte, aucune requête réseau** : `data_collection_permissions: none` est
  conservé. Le contenu des champs n'est lu qu'en mémoire, pour l'annulation et le contrôle,
  et n'est jamais transmis ni stocké.
- **Désinstallation** : tout est effacé. Les favoris sont perdus en cas de réinstallation ou
  de changement de profil (documenté, pas d'export).
- **Textes à réécrire** : `site/confidentialite.html`, `store/amo/listing.md` et le README.
  - « Aucun stockage » devient « stockage local uniquement ».
  - Ils ajoutent la nature fictive des données, le risque de coïncidence avec une personne
    ou une entité réelle, et la date de mise à jour.
  - L'équipe les rédige ; le commanditaire les relit.

---

## 9. Technique

### 9.1 Architecture

**[tech]** Pas de bundler, scripts classiques, JSDoc + `tsc`, comme en v1.

```
extension/
  manifest.json
  background/
    background.js        entrée : importScripts (Chromium) / liste scripts (Firefox), orchestration
    data.js              lecture des données (fetch de runtime.getURL), cache
    menus.js             sous-menu, état des entrées, ensure
    tabs-state.js        sociétés d'onglet, dernier onglet web, onglet de la fiche (storage.session)
    store.js             storage.local, validation, migration
  generators/
    random.js            tirages 32 bits, pondérés, UUID
    checksums.js         Luhn, clé TVA, mod 97, clé RIB, clé IBAN, GS1
    text.js              casse du registre, slugs, noms courts
    company.js           assemblage d'une société, verrous, dérivations
  data/fr/               communes (JSON par département), departments, naf, legal-forms,
                         headcount, first-names, last-names, streets, words, banks
  vocab/fr.js            table des types
  shared/
    format.js            formats adaptatifs et affichage
    page.js              traductions, thème, construction du DOM des pages
    theme.css            style ERP clair et sombre
  content/
    detection.js         éligibilité, type, bloc, qualification
    fill.js              écriture, select, contrôle, annulation
    banner.js            bandeau
    content.js           liaison (messages cff:*)
  popup/                 popup.html, popup.css, popup.js
  viewer/                viewer.html, viewer.css, viewer.js
  _locales/fr/messages.json
```

- **Répartition** : la génération et les données vivent **uniquement dans l'arrière-plan**.
  Le script de contenu ne charge que `vocab`, `format`, `detection`, `fill`, `banner` et
  `content`. Il reçoit la **Company brute** et applique lui-même le formatage adaptatif
  (§5.3).
- **Messages** :
  - `cff:page` (nouveau document) ;
  - `cff:verdict` / `cff:evaluate` (verdict de champ, de bloc et d'annulation) ;
  - `cff:fill` (action et Company, la réponse donne le décompte) ;
  - `cff:undo` ;
  - `cff:viewer-ping`, `cff:viewer-hello` ;
  - les requêtes du popup et de la fiche (`cff:get-state`, `cff:generate`, `cff:use`...).

  Le protocole complet est décrit dans `docs/ARCHITECTURE.md`.

- **Manifeste** :
  - ajouts : `action` (avec `default_popup`), `storage`, `incognito: "spanning"` ;
  - aucune `web_accessible_resources` ;
  - CSP MV3 par défaut.
- **Permissions finales** : `menus` ou `contextMenus`, et `storage`.
  - Ni `tabs`, ni `clipboardWrite` (la copie est faite sur un geste de l'utilisateur), ni
    `notifications`.
  - Accès `<all_urls>` par le script de contenu, comme en v1.
- **Build** : `scripts/package.mjs` est étendu (permissions, pages, données). Les zips sont
  nommés `company-form-filler-<cible>-<version>.zip`.

### 9.2 Budgets

- **Paquet** : zip de **3 Mo** au plus. Données de communes : **1,5 Mo** au plus, mesuré
  compressé dans le zip.
- **Script de contenu** : 80 Ko non compressé au plus, sans aucun travail au chargement de
  la page, sauf l'envoi de `cff:page` par la frame principale.
- **Temps** :
  - verdict sous Firefox : 100 ms au plus ;
  - génération d'une société : 50 ms au plus, à chaud.
- **Vérification** : un test de taille en CI et un test de temps indicatif sous jsdom.

### 9.3 Tests

- **Générateurs** :
  - 100 000 tirages par générateur ;
  - validateurs **indépendants** (`test/validators.js` étendu : Luhn, TVA, IBAN mod 97,
    clé RIB, GS1) ;
  - toutes les règles de cohérence, verrous et dérivations compris.
- **Données** : présence, unicité, poids, caractères interdits, sources listées dans
  `LICENSE-DATA.md`.
- **Détection** :
  - fixtures par type, en FR et en EN ;
  - faux positifs ;
  - extension du bloc : sections contre blocs répétés ;
  - shadow DOM, champs cachés, plafond de nœuds, `select` jamais cliqué ;
  - la fixture v1 est réécrite (TVA, NIC et RCS deviennent reconnus).
- **Remplissage** :
  - chaque ligne de la table des formats ;
  - `select` et synonymes, variantes courtes, valeurs vides jamais écrites ;
  - contrôle et restauration, annulation, ordre et seconde passe, événements ;
  - email et téléphone société ou dirigeant.
- **Intégration** (API simulée, chemins Firefox et Chromium) :
  - sous-menu et verdicts ;
  - société d'onglet vidée à la navigation ;
  - popup et fiche vers l'onglet cible ;
  - historique, favoris, navigation privée, réévaluation au clic.
- **Projet** : versions, messages (toutes les clés utilisées existent), icônes, caractères
  interdits.
- **Couverture** : 80 % des lignes au minimum.
- **Protocole manuel** avant chaque release (`docs/RECETTE.md`) : 12 scénarios sur la démo,
  dans Firefox, Chrome et Edge.

### 9.4 Projet, release, migration

- **Renommages** : `package.json`, le manifeste (`short_name`, `homepage_url`), les
  workflows, le README, `docs/SPEC.md` (qui devient cette spec) et `store/amo/`.
- **GitHub Pages** : nouvelle URL `thodebug.github.io/company-form-filler/`, mise à jour sur
  la fiche AMO à la v2. L'ancienne URL de Pages cesse de répondre ; c'est accepté.
- **Icône** : un formulaire à plusieurs lignes (société + adresse) sur le même indigo. Le
  SVG et les PNG sont régénérés.
- **Captures AMO** : refaites (sous-menu, bandeau, popup, fiche).
- **Utilisateurs Chromium v1** : la note de release explique comment retirer l'ancienne
  extension et charger la nouvelle.
- **Release** : sur le tag `v2.0.0`, avec le workflow existant. La description AMO est mise
  à jour à la main avant le tag.

### 9.5 Site de démonstration

Il est refait de zéro et sert aussi de jeu de fixtures pour les tests :

1. création de fournisseur façon ERP, en sections (identité / adresse / banque / ERP) ;
2. commande avec facturation et livraison en deux blocs ;
3. formulaire d'adresse pure ;
4. formulaire en anglais ;
5. pièges sans entrée de remplissage : newsletter (email seul), connexion, contact (nom,
   email, téléphone) ;
6. cas limites : champs cachés, `maxlength` trop court (raison sociale et IBAN) ;
7. composants : saisie masquée PrimeNG, shadow DOM ouvert et fermé, iframe, champ ajouté
   dynamiquement, `select` avec synonymes.

---

## 10. Hors périmètre v2

- **Pays et langues** : autres pays livrés, interface en anglais.
- **Sorties** : export JSON ou CSV, copie globale de la fiche.
- **Interaction** : raccourci clavier, entrée « nouvelle société pour ce champ seul ».
- **Éléments de formulaire** : contenteditable, cases à cocher, boutons radio, listes
  personnalisées, autocomplétions d'adresse.
- **Structures de page** : formulaires répartis sur plusieurs iframes, étapes d'assistant
  non affichées.
- **Navigation** : remise à zéro de la société d'onglet lors des changements de route d'une
  application monopage.
- **Données** : détection de la comptabilité et des conditions commerciales, carte
  géographique.
- **Plateforme** : synchronisation, graine, vérification d'existence réelle, Chrome Web
  Store, Edge Add-ons, Firefox Android, tests automatisés dans un vrai navigateur.

---

## 11. Critères d'acceptation

1. **Données sur 100 000 sociétés** : SIREN, SIRET, TVA, IBAN, clé RIB et GLN passent les
   validateurs indépendants. Toutes les règles de cohérence du §2 sont respectées, y compris
   les bornes de date par forme et l'absence de capital pour une EI.
2. **Valeurs interdites** : aucun SIREN `356000000`, aucun NIC `00000`, aucune date future,
   aucune raison sociale de plus de 38 caractères ou contenant un mot interdit.
3. **Démo 1** : un clic droit sur la raison sociale d'un onglet neuf affiche les entrées 1
   et 3. « Nouvelle société et remplir » remplit tous les champs visibles reconnus de
   **toutes les sections**. Le bandeau donne le décompte exact.
4. **Démo 2** : « Nouvelle adresse et remplir » depuis un champ de livraison ne remplit que
   le bloc livraison.
5. **Démos 3 et 5** : sur la démo 3, le sous-menu propose « Nouvelle adresse et remplir ».
   Sur les pièges de la démo 5, aucune entrée 1, 2 ou 3 n'apparaît (l'entrée 4 peut
   apparaître après un remplissage dans la même frame).
6. **Démo 4** (anglais) : les mêmes types que sur la démo 1 sont reconnus.
7. **Société d'onglet** :
   - « Remplir ce champ » sur un SIRET puis sur une TVA de la même page donne des valeurs
     issues du même SIREN ;
   - après un rechargement, le SIRET suivant vient d'une nouvelle société.
8. **Annulation** : « Annuler le dernier remplissage » restaure toutes les valeurs, `select`
   compris. La page reçoit `input` et `change`.
9. **Formats et longueurs** :
   - chaque ligne de la table des formats est choisie par son indice ;
   - les `select` de la démo sont remplis grâce aux synonymes ;
   - les champs trop courts de la démo 6 reçoivent la variante courte, ou sont ignorés sans
     jamais être tronqués.
10. **Popup** :
    - il génère sans changer d'onglet et attribue la société à l'onglet actif ;
    - « Utiliser dans cet onglet » fonctionne ;
    - « Ouvrir la fiche » réutilise l'onglet existant.
11. **Fiche** :
    - elle se met à jour quand le menu crée une société ;
    - « Utiliser » sur une entrée d'historique l'attribue au dernier onglet web actif ;
    - l'historique est limité à 20 et les favoris à 100, avec étiquette ;
    - les verrous ne s'appliquent qu'au bouton de la fiche et les valeurs dérivées sont
      recalculées.
12. **Navigation privée** (autorisée) : rien n'est écrit dans `storage.local`. Le popup
    affiche la mention « Fenêtre privée ».
13. **Premier lancement** : à l'installation et à la mise à jour depuis la v1, la fiche
    s'ouvre avec le guide.
14. **Interface** : thème à 3 états, navigation complète au clavier, contrastes AA.
15. **Réseau** : aucune requête réseau émise par l'extension.
16. **Qualité** : budgets du §9.2 respectés, couverture de 80 % ou plus, `web-ext lint` sans
    avertissement, CI verte, deux zips produits.
17. **Installation** :
    - la v2 s'installe par-dessus la v1 depuis AMO (même identifiant) ;
    - elle s'installe dans Chrome et Edge depuis le zip ;
    - le protocole de `docs/RECETTE.md` passe sur les trois navigateurs.
