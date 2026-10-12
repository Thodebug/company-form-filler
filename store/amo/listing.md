# Fiche addons.mozilla.org

La v2 met à jour la fiche existante de SIRET Form Filler (même identifiant
`siret-form-filler@thodebug.github.io`) : les utilisateurs de la v1 reçoivent la v2 par mise à
jour automatique. Avant de pousser le tag `v2.0.0`, mettre à jour à la main, dans
[addons.mozilla.org/developers](https://addons.mozilla.org/developers/), les champs ci-dessous.

## Informations générales

- **Nom** : Company Form Filler
- **Adresse de la fiche (slug)** : `company-form-filler` si AMO accepte le changement, sinon
  garder `siret-form-filler`
- **Catégorie** : Développement web
- **Étiquettes** : développement web, formulaires, tests, données de test
- **Licence** : MIT
- **Page d'accueil** : https://github.com/Thodebug/company-form-filler
- **Page d'assistance** : https://github.com/Thodebug/company-form-filler/issues
- **Politique de confidentialité** : https://thodebug.github.io/company-form-filler/confidentialite.html
- **Compatible Firefox pour Android** : non (le menu contextuel n'existe pas sur Android)

## Résumé (250 caractères au plus)

Clic droit dans un formulaire : remplit une société ou une adresse française fictive et
cohérente (SIRET, TVA, NAF, adresse réelle, dirigeant, IBAN). Pour les développeurs et
testeurs d'applications de gestion. Aucune donnée envoyée.

## Description

Vous testez une application de gestion et devez inventer une société cohérente à chaque fiche
client ou fournisseur ? Company Form Filler la crée et remplit le formulaire pour vous.

Anciennement SIRET Form Filler, qui ne générait que des numéros SIRET et SIREN.

**Clic droit**

Dans un formulaire reconnu, le sous-menu « Company Form Filler » propose :

- Remplir ce champ (SIRET, TVA, raison sociale, code postal...) avec la société de l'onglet ;
- Nouvelle société et remplir : tout le formulaire, sections comprises ;
- Nouvelle adresse et remplir, sur un formulaire d'adresse ;
- Annuler le dernier remplissage.

**Des données cohérentes**

SIREN et SIRET valides, numéro de TVA calculé, code NAF 2025 et son équivalent rév. 2, forme
juridique, capital et fonction du dirigeant compatibles, commune réelle avec son code postal,
son département et ses coordonnées, téléphone de la bonne zone dans les plages réservées à la
fiction, emails en example.com, IBAN et RIB valides d'une banque fictive, GLN, codes
comptables et ERP.

**Un remplissage soigné**

Chaque valeur est écrite au format du champ (espaces, +33, date, NAF sans point), les listes
déroulantes sont choisies par synonymes (SAS ou 5710, FR ou France), React, Angular, Vue et
les masques de saisie la voient. Un bandeau indique ce qui a été rempli et permet d'annuler.
Les champs génériques d'un formulaire de contact ou d'une lettre d'information ne déclenchent
rien.

**Popup et fiche**

Le bouton de l'extension génère une société ou une adresse. La fiche affiche toutes les
données (copie au clic), garde des sections verrouillées, l'historique des 20 dernières
sociétés et jusqu'à 100 favoris étiquetés.

**Confidentialité**

Aucune donnée collectée, aucune requête réseau. Les sociétés, favoris et réglages restent dans
le stockage local du navigateur ; rien n'est écrit en navigation privée.

**Attention**

Il n'existe pas de plage de SIREN réservée aux tests : un numéro tiré peut coïncider avec une
entreprise réelle. À utiliser uniquement dans des environnements de test.

Page de démonstration : https://thodebug.github.io/company-form-filler/
Code source (MIT) : https://github.com/Thodebug/company-form-filler

## Captures

Dans `store/amo/screenshots/`, à téléverser dans cet ordre (et retirer les anciennes) :

1. `1-menu.png` : « Clic droit dans un formulaire : une société fictive et cohérente en un clic »
2. `2-rempli.png` : « SIRET, TVA, IBAN valides, adresse réelle : tout est cohérent »
3. `3-fiche.png` : « La fiche : toutes les données, verrous, historique et favoris »
4. `4-popup.png` : « Le bouton de l'extension : une société ou une adresse sans changer d'onglet »

Les deux premières sont des illustrations générées par `npm run store-images` (un menu
contextuel ne se capture pas). Les deux suivantes sont des captures de l'extension dans
Chromium.

## Notes pour les relecteurs (champ « Notes to Reviewer »)

The code is plain JavaScript with no bundler, minifier or transpiler: the submitted files are
the files of the repository's `extension/` folder. The packaging script
(`scripts/package.mjs`) only rewrites `manifest.json` per browser. The JSON files of
`extension/data/fr/` are open data (INSEE, La Poste, IGN) produced by
`scripts/build-data.mjs`; sources are listed in `LICENSE-DATA.md`.

`<all_urls>` content script: needed to decide, on any site, whether the right-clicked field
and its form can be filled, so the menu entries are shown only there. The script reads the
attributes and labels of the right-clicked field and of the fields of its form, the text of
elements they reference through aria-labelledby or aria-describedby, and up to 100 characters
of the text next to each. When the user chooses to fill, it reads the current values of those
fields to allow undo. Nothing is sent over the network. The page `pattern` attribute is read
as text and never executed.

`storage`: last generated company, history, favorites and viewer settings in
`storage.local`; the company of each tab in `storage.session`. Nothing is written to disk from
private windows. `menus`: context submenu and `menus.getTargetElement`.

Test page: https://thodebug.github.io/company-form-filler/
