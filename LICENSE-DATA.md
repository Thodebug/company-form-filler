# Données embarquées : sources et licences

Le code de l'extension est publié sous licence MIT (voir [LICENSE](LICENSE)). Les fichiers de
`extension/data/fr/` reprennent ou dérivent des données publiques listées ci-dessous.

## Données produites par `scripts/build-data.mjs`

Le script est reproductible : `npm run build:data` relit les sources et réécrit les fichiers.
Il est à relancer une fois par an, ou quand une source change.

| Fichier            | Contenu                                                                                     | Source                                                                                                                                                                    | Licence                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `departments.json` | Départements, régions, préfectures, populations                                             | INSEE, Code officiel géographique, et La Poste, via le paquet npm [`@etalab/decoupage-administratif`](https://github.com/etalab/decoupage-administratif) 6.0.0            | [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/) |
| `communes/*.json`  | Communes et arrondissements municipaux : code INSEE, nom, codes postaux, population         | Même source                                                                                                                                                               | Licence Ouverte 2.0                                                             |
| `communes/*.json`  | Centre de chaque commune (latitude, longitude, 4 décimales)                                 | IGN, Admin Express COG, via [`gregoiredavid/france-geojson`](https://github.com/gregoiredavid/france-geojson), commit `5d34ee6`, centroïde calculé du plus grand polygone | Licence Ouverte 2.0                                                             |
| `naf.json`         | Libellés NAF rév. 2                                                                         | INSEE, via le paquet npm [`@socialgouv/codes-naf`](https://github.com/SocialGouv/codes-naf) 1.1.1                                                                         | Licence Ouverte 2.0                                                             |
| `naf.json`         | Sélection de 91 sous-classes NAF 2025 avec leur libellé (`scripts/data/naf-selection.json`) | INSEE, [Structure de la NAF 2025](https://www.insee.fr/fr/information/8617910)                                                                                            | Licence Ouverte 2.0                                                             |

Notes :

- Les communes créées après 2018, absentes des contours IGN de 2018, prennent le centre moyen
  de leurs communes déléguées, ou à défaut celui de leur département (42 communes).
- Les arrondissements de Paris, Lyon et Marseille partagent le centre de leur ville.
- Chaque sous-classe NAF 2025 sélectionnée, son libellé et son équivalent rév. 2 ont été
  vérifiés en octobre 2026 contre la
  [table de correspondance de l'INSEE](https://www.insee.fr/fr/information/8617910)
  (`Correspondances_NAFrev2-NAF2025.xlsx`, édition de janvier 2026). À revérifier à chaque
  mise à jour de la nomenclature.

## Données saisies à la main

| Fichier                               | Contenu                                                              | Origine                                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `legal-forms.json`                    | 8 formes juridiques, codes de catégorie juridique, règles de capital | Nomenclature des catégories juridiques de l'INSEE (Licence Ouverte 2.0), règles du Code de commerce          |
| `headcount.json`                      | Tranches d'effectif salarié                                          | Nomenclature INSEE (Licence Ouverte 2.0)                                                                     |
| `first-names.json`, `last-names.json` | Prénoms et noms de famille courants en France                        | Listes établies à la main ; un prénom ou un nom isolé n'est pas protégé                                      |
| `streets.json`                        | Types et noms de voies génériques                                    | Listes établies à la main                                                                                    |
| `words.json`                          | Motifs de raisons sociales, mots interdits                           | Listes établies à la main                                                                                    |
| `banks.json`                          | Banques fictives                                                     | Inventées : codes banque de la plage 99xxx et codes BIC commençant par Z, non attribués à notre connaissance |

## Valeurs réservées

- **Téléphones** : plages réservées aux œuvres de fiction par le plan national de numérotation
  (décision Arcep, article 2.5.12, [Légifrance](https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000037263033)) :
  01 99 00, 02 61 91, 03 53 01, 04 65 71, 05 36 49 et 06 39 98.
- **Emails et sites** : sous-domaines de `example.com`, domaine réservé à la documentation
  ([RFC 2606](https://www.rfc-editor.org/rfc/rfc2606)).
- **GLN** : préfixe GS1 `2`, réservé à la circulation restreinte (usage interne).
- **SIREN** : aucune plage n'est réservée aux tests. Un numéro tiré peut correspondre à une
  entreprise réelle, y compris un entrepreneur individuel.
