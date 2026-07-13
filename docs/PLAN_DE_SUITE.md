# Plan de suite - Fire Viewer

## Règle de conduite

Ce plan vise d'abord G0 puis un vertical slice G1 local et fictif. Il ne constitue ni un plan de mise en production, ni une autorisation d'usage opérationnel. Chaque ticket doit avoir un propriétaire, un test exécuté et un artefact de preuve.

Le vertical slice est pensé pour ne pas engager de frais : outils libres, dépôt public,
SQLite local, fichiers de sauvegarde locaux et dépendances déjà déclarées. Une passe ne
doit pas introduire de service cloud, d'API payante, de licence propriétaire ou de coût
récurrent sans décision explicite. Cette contrainte ne vaut pas promesse de disponibilité
opérationnelle.

## Suivi d'exécution

| ID | État | Preuve actuelle |
| --- | --- | --- |
| FV-001 | **VÉRIFIÉ** | dépôt public initialisé, provenance locale des ZIP ignorée par Git, documentation et licences publiées |
| FV-002 | **VÉRIFIÉ** | UI : `npm ci`, contrôle TypeScript, build et parcours mocké bureau/mobile ; backend : migrations, qualité, compilation et 69 tests passants à 88,70 % de couverture |
| FV-003 | **VÉRIFIÉ** | ADR-001, schéma JSON `ViewerManifest` v2, fixtures fictifs, OpenAPI, CORS et tests backend/UI ; le raccordement réseau réel est vérifié localement par FV-006 |
| FV-004 | **VÉRIFIÉ (contrat et contrôles SQLite)** | ADR-002, schéma spatial v1, fixtures fictifs ENU/glTF/Unity, zones, révision, snapshot et contrôles de transformation, axes, origine et hash RAF20 ; rendu Unity/PNG réel et migration PostgreSQL restent non vérifiés |
| FV-005 | **VÉRIFIÉ (SQLite et contrats)** | seed `FR-83-00042` v1 entièrement fictif, idempotence sans écriture au second passage, manifeste/ETag hashés, matrice versionnée et masquage canonique ; 69 tests backend et 34 tests UI passent |
| FV-006 | **VÉRIFIÉ (SQLite, UI et Chromium Playwright)** | mode de données explicite, client `ViewerManifest` v2, cache ETag/`304`, surface API DOM-first et harnais E2E ; `check`, 57 tests, build et 8 scénarios Chromium passent avec CORS, seed réel, `200`/`304`, `404`, timeout et absence de GLB/mock API ; `npm ci`/check/tests/build sont rejoués dans un checkout Git neuf |
| FV-007 | SQLite local validé | migration `e7a4c9d8f2b1`, `upgrade` idempotent, 26 triggers critiques, idempotence concurrente, matching déterministe `create/attach/review`, audit append-only et sauvegarde/restauration non destructive ; 87 tests backend passent à 88,06 % de couverture. Docker réel et PostgreSQL restent hors de cette preuve. |

**VÉRIFIÉ dans FV-006** : `IncidentData` et le terrain SVG sont isolés dans le parcours
mock ; le parcours API ne consomme que le résumé de `ViewerManifest`. Les tests Vitest et
Playwright couvrent le raccordement `VITE_USE_MOCKS=false`, le cache, les erreurs, CORS et
l'absence de GLB ou module mock dans le parcours API.

## Lot 0 - Baseline et décisions de contrat

| ID | Action | Dépendances | Preuve d'acceptation |
| --- | --- | --- | --- |
| FV-001 | Initialiser le dépôt Git Fire Viewer et ajouter les exclusions pour `.venv`, `node_modules`, bases SQLite, builds Unity et secrets | aucune | statut Git propre, `.gitignore` revu, provenance des ZIP conservée |
| FV-002 | Exécuter les contrôles natifs reçus : backend (`make test`, `make quality` ou équivalents Windows) et UI (`npm ci`, `npm run check`, `npm run build`) | FV-001, accès aux dépendances | logs de commandes et artefacts de build ; aucun test annoncé sans exécution |
| FV-003 | Choisir et enregistrer le contrat public `ViewerManifest` : URL, version, casing JSON, ETag, erreurs 404/409, CORS | FV-002 | ADR + schéma JSON + test de contrat UI/API rouge puis vert |
| FV-004 | Fixer le profil local : France continentale rurale, NGF-IGN69 + RAF20 hors ligne, `EPSG:4979`, ENU, GLB métrique et Unity 100 u/m (`meters_per_unit=0.01`) | inventaire Unity externe | ADR-002 + schéma/fixtures spatiaux ; contrôles exécutés de transformation, axes, origine et hash RAF20 ; rendu GLB/Unity et PNG réel restent des intégrations séparées |
| FV-005 | Créer un jeu de données entièrement fictif `FR-83-00042` et la matrice des états/visibilités | FV-003 | seed rejouable, manifeste hashé, transitions et masquage des données sensibles testés |

## Lot 1 - Vertical slice G1 local

| ID | Action | Dépendances | Preuve d'acceptation |
| --- | --- | --- | --- |
| FV-006 | Connecter l'UI au manifeste réel, avec modes `true`/`false`/N/A explicites, ETag/`304`, cache session/mémoire et rendu DOM public minimal | FV-003, FV-005 | `npm run check`, `npm run test`, build et Playwright : seed réel, CORS, `200`/`304`, `404`, timeout, WebGL indisponible, aucun GLB/Unity téléchargé |
| FV-007 | Vérifier migrations, idempotence, matching `create/attach/review`, audit append-only et restauration SQLite | FV-002, FV-005 | tests transactionnels ; scénario de sauvegarde/corruption/restauration documenté |
| FV-008 | Produire un seul asset GLB de démonstration avec manifeste immuable, SHA-256 et métadonnées ENU | FV-004, FV-005 | téléchargement, hash, taille, unité et repères contrôlés avant chargement |
| FV-009 | Ajouter un pont minimal JavaScript/C# et un build Unity WebGL de démonstration, sans retirer le DOM texte | FV-004, FV-008 | contrat de messages borné, test navigateur et fallback sans WebGL |
| FV-010 | Écrire le runbook local de démarrage, arrêt, migration, seed, rollback et incident fictif | FV-006 à FV-009 | exercice reproductible par une seconde personne ou dans un environnement propre |

Le gate G1 ne pourra être déclaré atteint que lorsque FV-006 à FV-010 auront des preuves exécutées. À cet instant, le produit reste une démonstration contrôlée, non opérationnelle.

## Lot 2 - Capacités préparatoires après G1

1. Phases 3 et 4 : agents vision et texte. Les limiter à des observations structurées ; préparer corpus négatifs, jeux ambigus, calibration et quarantaine.
2. Phases 5 et 6 : pipeline IGN/PDAL/GDAL/TIN, provenance, versioning d'asset, rollback et réactivation. Ne pas choisir Poisson comme reconstruction par défaut du MNT.
3. Phases 7, 10 et 11 : profils d'environnement, stockage objet, worker idempotent, upload temporaire puis publication atomique, traces et métriques.
4. Phases 8, 9, 12 et 13 : contrat Unity complet, UI accessible, hot-swap du même `fire_id`, cache contrôlé et fallback hors ligne.

## Lot 3 - Conditions avant bêta supervisée (G2)

Les phases 14 à 18 sont des prérequis : threat model, RBAC, minimisation des données, kill switch, test de charge mesuré, matrice mobile, recette E2E, documentation et exercices de restauration. Une bêta n'est planifiable qu'après des preuves de ces contrôles sur données fictives et un go/no-go documenté.

## Ce qui ne doit pas être fait maintenant

- publier un feu, une position sensible ou une preuve réelle ;
- présenter le prototype comme un service d'urgence, un outil de prévision ou un système de confirmation automatique ;
- brancher Unity au backend avant d'avoir exécuté les tests de précision, d'import et de changement d'origine du contrat spatial ;
- lancer plusieurs workers sur la même base SQLite locale ;
- effacer les ZIP reçus ou le projet Unity de Die externe.

## Prochaine action sûre

Réaliser FV-008 : produire un unique asset GLB de démonstration entièrement fictif,
versionné, hashé et rattaché à une révision de zone déjà contractuelle. Cette passe doit
rester locale et sans coût récurrent; elle ne branche ni Unity/WebGL ni un terrain réel.
FV-009 reste exclusivement responsable du pont Unity/WebGL, tandis que FV-010 documentera
l'exercice local complet de démarrage, arrêt, migration, restauration et incident fictif.
