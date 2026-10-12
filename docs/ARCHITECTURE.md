# Architecture

Company Form Filler est une extension WebExtension MV3 écrite en JavaScript sans bundler. Les
fichiers de `extension/` sont publiés tels quels ; `scripts/package.mjs` ne réécrit que le
manifeste de chaque navigateur.

## Modules

Chaque fichier est un script classique qui définit un seul objet global (`CffRandom`,
`CffDetection`...). Les scripts d'un même contexte partagent leur portée globale : TypeScript
(`checkJs`) infère les types d'un fichier à l'autre, sans fichier de déclaration à maintenir.
Les types partagés (société, messages, API d'extension) sont dans `types/`.

| Contexte                                                          | Scripts, dans l'ordre de chargement                                                                                                             |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Arrière-plan (page d'événements Firefox, service worker Chromium) | `generators/random.js`, `checksums.js`, `text.js`, `company.js`, `background/data.js`, `store.js`, `tabs-state.js`, `menus.js`, `background.js` |
| Script de contenu (chaque frame)                                  | `vocab/fr.js`, `shared/format.js`, `content/detection.js`, `fill.js`, `banner.js`, `content.js`                                                 |
| Popup                                                             | `shared/format.js`, `shared/page.js`, `popup/popup.js`                                                                                          |
| Fiche                                                             | `shared/format.js`, `shared/page.js`, `viewer/viewer.js`                                                                                        |

Sous Chromium, `background.js` importe les autres scripts avec `importScripts` ; sous Firefox,
le manifeste les liste dans `background.scripts`. Un test vérifie que les deux listes
concordent.

La génération et les données ne vivent que dans l'arrière-plan : les pages ne chargent jamais
les 2 Mo de communes. Le script de contenu reçoit une société complète et choisit lui-même le
format de chaque valeur (`CffFormat`).

## Données

- `data/fr/communes/<département>.json` : lignes `[code INSEE, nom, code(s) postal(aux),
population, latitude, longitude]`, chargées à la demande ; les 12 derniers départements
  restent en cache.
- `data/fr/departments.json`, `naf.json` : produits par `scripts/build-data.mjs`.
- Les autres fichiers sont saisis à la main. Voir `LICENSE-DATA.md`.

## État

| Où                           | Quoi                                                                                          | Durée de vie                             |
| ---------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `storage.local`, clé `cff`   | dernière société, historique (20), favoris (100), verrous, thème, guide fermé                 | permanent, jamais synchronisé            |
| `storage.session`            | société de chaque onglet et identifiant de son document (`tab:<id>`), dernière société privée | session du navigateur, jamais sur disque |
| Mémoire du script de contenu | valeurs remplacées par le dernier remplissage de la frame                                     | jusqu'au rechargement                    |

La société d'un onglet n'est rendue que si la frame principale répond encore avec le même
identifiant de document : une navigation l'invalide sans qu'aucun message soit envoyé au
chargement des pages. L'arrière-plan n'écoute aucun évènement d'onglet ; il n'est réveillé que
par le menu, le popup ou la fiche. Les sociétés des onglets fermés sont effacées à
l'attribution suivante.

Toute lecture de `storage.local` passe par `CffStore.sanitize` : une société invalide, un verrou
inconnu ou un thème inconnu sont ignorés. `CffStore.migrate` accueillera les changements de
schéma (`schemaVersion`).

## Messages

### Script de contenu vers arrière-plan

| Message                     | Quand                                                                      | Effet                                       |
| --------------------------- | -------------------------------------------------------------------------- | ------------------------------------------- |
| `cff:verdict` `{ verdict }` | Chromium : bouton droit pressé, `contextmenu`, touche Menu, Maj+F10, focus | met à jour le sous-menu avant son ouverture |

### Arrière-plan vers script de contenu (`tabs.sendMessage`, frame cliquée)

| Message                                                                       | Réponse                                                                          |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `cff:evaluate` `{ targetElementId? }`                                         | `{ verdict }`                                                                    |
| `cff:fill` `{ targetElementId?, action: 'field' \| 'form', company \| null }` | `{ ok, filled?, skipped? }` ; le script revérifie l'action et affiche le bandeau |
| `cff:undo`                                                                    | `{ restored }`                                                                   |
| `cff:page-id` (frame principale)                                              | `{ page }`, identifiant tiré au chargement du document                           |

Un verdict vaut `{ field, block, canUndo }` : type fort ou d'adresse du champ cliqué,
qualification du bloc (`company`, `address` ou `null`), annulation possible dans la frame.

### Popup et fiche vers arrière-plan

| Message                                                                    | Effet                                                                                                                |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `cff:get-state` `{ tabId?, incognito? }`                                   | état persistant, société de l'onglet (`tabId`, ou onglet utilisé en dernier pour la fiche), drapeaux privé et erreur |
| `cff:generate` `{ tabId?, incognito?, useLocks? }`                         | nouvelle société pour l'onglet ; `useLocks` (fiche) applique les verrous à partir de la dernière société             |
| `cff:use` `{ companyId, tabId?, incognito? }`                              | une société de l'historique ou des favoris devient la dernière et celle de l'onglet                                  |
| `cff:favorite` `{ companyId, favorite, label }`                            | ajoute, renomme ou retire un favori                                                                                  |
| `cff:history-delete` `{ companyId }`, `cff:history-clear`, `cff:clear-all` | historique et effacement                                                                                             |
| `cff:locks` `{ locks }`, `cff:theme` `{ theme }`, `cff:onboarding-dismiss` | réglages de la fiche                                                                                                 |
| `cff:open-viewer`                                                          | ouvre la fiche ou active son onglet                                                                                  |

L'arrière-plan n'accepte ces requêtes que du popup (sans onglet) ou d'une page de l'extension
(URL de son origine) : une page web ne peut pas les envoyer.

### Arrière-plan vers fiche

`cff:viewer-ping` : la fiche ouverte répond `{ tabId }`, ce qui permet de l'activer au lieu
d'en ouvrir une seconde. La fiche se met aussi à jour seule en écoutant `storage.onChanged`.

## Menu contextuel

Une entrée parente « Company Form Filler » et quatre sous-entrées (`cff-field`,
`cff-form-current`, `cff-form-new`, `cff-undo`), toutes dans le contexte `editable`.
`CffMenus.stateFor(verdict, ongletAUneSociété)` calcule leur visibilité et leurs titres.

- **Firefox** : `menus.onShown` demande le verdict à la frame (`getTargetElement`), met à jour
  les entrées puis appelle `menus.refresh()` ; `onHidden` les masque.
- **Chromium** : le verdict arrive avant l'ouverture du menu (`cff:verdict`).

Au clic, l'arrière-plan redemande toujours le verdict avant de générer une société : un menu
affiché avec un verdict périmé ne crée rien et le bandeau indique « Champ non reconnu ».

## Détection et remplissage

1. `CffDetection.detectType` attribue un score à chaque type de `vocab/fr.js` à partir des
   attributs, libellés, attributs ARIA, `autocomplete`, type de champ, masque et texte voisin.
   Les mots-clés d'un type forment une seule expression régulière, et les correspondances sont
   mises en cache par texte : classes, attributs et titres de colonne se répètent d'un champ à
   l'autre.
2. `CffDetection.findBlock` cherche le bloc du champ : premier ancêtre à trois types reconnus et
   visibles, sans sortir du formulaire, puis extension tant qu'aucun type ne se répète. Les
   champs de l'ancêtre suivant ne sont examinés que jusqu'au premier type répété.
   Dans un bloc qualifié, les libellés vagues (« Code », « Libellé ») sont reconnus en plus.
   Au remplissage, `CffDetection.companionAddress` ajoute le formulaire d'adresse voisin
   d'un bloc société qui n'a pas d'adresse.
3. `CffFill.fill` écrit les valeurs (géographie d'abord), contrôle ce que la page a gardé,
   repasse sur les champs modifiés par la page et renvoie de quoi annuler.

## Tests

- `test/generators.test.js` : 100 000 sociétés contrôlées par des validateurs indépendants
  (`test/validators.js`), verrous.
- `test/detection.test.js` : fixtures (`test/fixtures/detection.html`) et page de démonstration
  (`data-expected`, `data-expected-block`).
- `test/fill.test.js` : formats, `select`, contrôle, seconde passe, annulation, bandeau.
- `test/integration.test.js` : vrais scripts d'arrière-plan et de contenu face à une API
  simulée, chemins Firefox et Chromium, popup, fiche, navigation privée, premier lancement.
- `test/project.test.js` : manifeste, messages, données, budgets, caractères interdits.
- `docs/RECETTE.md` : recette manuelle dans les vrais navigateurs.
