# Fire Viewer

> Prototype communautaire, incident-centrique et transparent pour visualiser des données d'incident avec leur provenance, leur fraîcheur et leur incertitude.

![Diagramme d'architecture Fire Viewer](assets/diagrams/fire-viewer-architecture.svg)

## Statut

**G0 - conception et fondations.** Le dépôt rassemble les sources reçues, la roadmap d'architecture et le backlog du premier vertical slice local. FV-006 raccorde le shell web au contrat public minimal ; il ne s'agit toujours pas d'un service d'urgence, d'un outil de prévision, ni d'un système de confirmation automatique d'incendie.

En cas de feu ou de danger immédiat en France, contactez les secours au **18** ou au **112**. N'utilisez jamais ce prototype pour guider une intervention ou vous rapprocher d'un incendie.

## Principe du produit

Fire Viewer associe une page stable à une série d'incident identifiée par `fire_id`. Chaque épisode opérationnel reste traçable via `episode_id`, et chaque modèle 3D est référencé par un manifeste versionné et immuable.

- Le **backend** est la source de vérité pour les observations, le matching, l'audit et les manifestes.
- Le **shell web** affiche toujours les informations textuelles, l'état, la fraîcheur et les incertitudes.
- Le **viewer Unity/WebGL** est une couche de visualisation spatiale : il ne doit jamais être la seule source d'information.
- Les futurs agents IA ne produiront que des observations structurées. Ils ne pourront pas confirmer seuls un incident ni publier un état public.

## Organisation du dépôt

```text
apps/fire-viewer-ui/                 Interface React, TypeScript et Vite
services/fire-viewer-backend/        API FastAPI, SQLAlchemy et Alembic
contracts/                           Schémas JSON et fixtures de contrats publics et spatiaux
docs/                                Architecture, roadmap, analyse et plan G0/G1
assets/diagrams/                     Schémas maintenables du projet
archives/received/                   ZIP d'origine conservés localement et ignorés par Git
```

## Sources et documentation

- [Architecture cible](docs/ARCHITECTURE.md)
- [ADR-001 — Contrat public ViewerManifest v2](docs/adr/ADR-001-viewer-manifest-public-contract.md)
- [Schéma ViewerManifest v2](contracts/viewer-manifest/v2/viewer-manifest.schema.json)
- [ADR-002 — Contrat spatial local ENU et Unity](docs/adr/ADR-002-spatial-local-unity-contract.md)
- [Contrat spatial local v1](contracts/spatial/v1/README.md)
- [Dataset fictif et matrice publique v1](contracts/demo/v1/README.md)
- [Analyse de la roadmap](docs/ANALYSE_ROADMAP.md)
- [Plan de suite G0/G1](docs/PLAN_DE_SUITE.md)
- [Registre problèmes et validations](docs/REGISTRE_PROBLEMES_VALIDATIONS.md)
- [Roadmap source](docs/roadmap/roadmap_fire_viewer_incident_centrique_detaillee-1.pdf)
- [Contribution](CONTRIBUTING.md)
- [Sécurité](SECURITY.md)
- [Statut des licences](LICENSES.md)

## Contrôles vérifiés — 12 et 13 juillet 2026

- **VÉRIFIÉ** : l'interface s'installe avec `npm ci`, passe `npm run check`, **57 tests Vitest** et produit son build Vite avec `npm run build`.
- **VÉRIFIÉ** : ces quatre contrôles UI ont été rejoués dans un worktree Git neuf au commit FV-006, après un `npm ci` sans dépendance préexistante.
- **VÉRIFIÉ** : le backend a été validé sous CPython 3.13.2 : migrations Alembic, Ruff, formatage Ruff, mypy, compilation Python et 69 tests automatisés sont passés. La couverture mesurée est de 88,70 % (seuil du projet : 80 %).
- **VÉRIFIÉ** : le verrou npm a été corrigé pour référencer le registre public npm, afin que `npm ci` ne dépende plus d'une URL interne indisponible hors de l'environnement de préparation.
- **VÉRIFIÉ (localement)** : FV-006 parcourt l'UI API réelle sous Chromium Playwright : SQLite temporaire migrée et seedée, CORS, premier `200`, revalidation `304`, polling, `404`, timeout, fallback WebGL et absence de téléchargement GLB ou du module mock en mode API (8 scénarios).
- **NON VÉRIFIÉ** : le déploiement public, ses en-têtes CDN, les origines CORS de production et le contrôle visuel par le navigateur natif de l'environnement restent hors de cette preuve locale.

## Démarrage local

Les commandes ci-dessous correspondent aux scripts déclarés par les deux projets. La baseline ci-dessus a été exécutée sous PowerShell ; adaptez uniquement le choix de l'environnement Python à votre machine.

```powershell
# Interface
Set-Location apps/fire-viewer-ui
npm ci
npm run check
npm run build

# Backend
Set-Location ../../services/fire-viewer-backend
uv venv --python 3.13 .venv
uv pip install --python .venv\Scripts\python.exe -e '.[dev]'
.\.venv\Scripts\alembic.exe upgrade head
.\.venv\Scripts\python.exe -m pytest
```

### Modes de données de l'interface

Le choix de données est volontairement explicite dans le fichier
`apps/fire-viewer-ui/.env.local` :

| Valeur de `VITE_USE_MOCKS` | Résultat |
| --- | --- |
| `true` | Dashboard fictif historique, réservé à la démonstration locale. |
| `false` avec `VITE_API_BASE_URL` valide | Consultation exclusive du manifeste public réel. |
| absente, autre valeur, ou `false` sans origine valide | Écran `N/A — mode de données non configuré`, sans requête et sans fixture. |

Une origine valide est une origine HTTP(S) pure, par exemple
`http://localhost:8000` ou `https://api.example.org`. Elle ne contient ni chemin
`/api`, ni query, fragment ou identifiants. Le client construit lui-même le chemin
canonique ; elle ne doit donc jamais être réglée sur `/api/v1`.

```env
# Mode API local
VITE_USE_MOCKS=false
VITE_API_BASE_URL=http://localhost:8000
```

### Reproduction E2E FV-006

Après avoir préparé l'environnement Python du backend ci-dessus, la suite E2E déclarée
par l'UI se lance depuis `apps/fire-viewer-ui` :

```powershell
npm run test:e2e:install
npm run test:e2e
```

Le harnais Playwright est conçu pour créer une SQLite temporaire, appliquer Alembic avec
une URL explicitement injectée, lancer `fire-viewer-seed`, puis démarrer Uvicorn et Vite
sur `localhost:8000` et `localhost:5173`. Il nettoie ensuite les processus et le dossier
temporaire. `FV_E2E_BACKEND_PYTHON` permet d'indiquer un autre exécutable Python du
backend. Le seul serveur Vite E2E active un polling accéléré ; l'application normale reste
réglée à cinq minutes. **VÉRIFIÉ localement sur l'état FV-006** : les huit scénarios
Playwright passent avec migration et seed dans une SQLite temporaire ; les processus et le
dossier temporaire sont arrêtés/nettoyés par le harnais.

## Contrat viewer public v2

Le contrat public est défini par l'[ADR-001](docs/adr/ADR-001-viewer-manifest-public-contract.md) :

- `GET /api/v1/incident/{fire_id}/manifest` est la ressource viewer canonique ;
- `ViewerManifest` v2 utilise `snake_case`, un `schema_version` obligatoire et les états `available`, `not_available` et `withheld` ;
- les réponses conditionnelles utilisent `ETag` et `If-None-Match` ; les erreurs viewer sont des Problem Details ;
- les sources, l'historique et le journal ne font pas partie de ce contrat public minimal.

**VÉRIFIÉ dans FV-006** : en mode API, l'UI demande
`GET {VITE_API_BASE_URL}/api/v1/incident/{fire_id}/manifest`, valide chaque `200` par le
parseur strict, exige un `ETag` et ne conserve que le résumé public. Aucun champ du
dashboard fictif n'est complété à partir de cette réponse.

Le cache de session est indexé par origine API, version de schéma et `fire_id`. Il mémorise
le manifeste validé, son `ETag` et son instant de contrôle dans `sessionStorage`, avec un
repli mémoire lorsque le stockage navigateur est inaccessible. Une requête envoie
`If-None-Match` avec `cache: "no-store"` et `credentials: "omit"`. Sur `304`, seule une
entrée validée dont l'`ETag` correspond est réutilisée ; sinon elle est purgée et une unique
requête inconditionnelle est tentée. L'ouverture, le retour de l'onglet au premier plan et
un intervalle de cinq minutes lorsque l'onglet est visible déclenchent une revalidation. En
cas d'échec après un succès, le dernier manifeste reste visible comme obsolète ; il n'y a
jamais de retour silencieux au mock.

**VÉRIFIÉ localement** : les tests Vitest couvrent les configurations, le parse strict,
l'ETag, le cache `200`/`304`, les corruptions et les erreurs ; Playwright couvre le
parcours seed réel, `304`, `404`, timeout, CORS et les deux états WebGL. Les services et
le navigateur de production restent **NON VÉRIFIÉS**.

## Surface API sûre

Le mode API est volontairement DOM-first. Il affiche le `fire_id`, l'épisode, le statut,
la fraîcheur et uniquement les champs autorisés par le manifeste : localisation et
incertitude publiques, ou métadonnées de l'asset pour `available`. `not_available` indique
honnêtement l'absence de modèle. `withheld` n'infère ni coordonnée, ni asset, ni repère.
Pour `CLOSED`, aucun viewer ni snapshot PNG interne n'est publié.

Les onglets Sources, Historique et Journal restent présents afin de ne pas modifier la
navigation, mais chacun affiche « non inclus dans le manifeste public ». Compteurs, exports,
filtres, mode opérateur et contenu de fixture ne sont pas utilisés dans ce parcours. Le
`TerrainViewer` SVG, ses marqueurs et ses simulations restent strictement dans le mode
mock. Même pour un manifeste `available`, l'UI ne télécharge pas de GLB et ne monte pas
Unity : elle fournit un message textuel selon la disponibilité WebGL. Le téléchargement GLB,
le rendu Unity/WebGL et l'archive PNG matérielle appartiennent respectivement à FV-008 et
FV-009.

## Dataset fictif et matrice d'états v1

**VÉRIFIÉ** : `fire-viewer-seed` prépare le dataset entièrement fictif
`FR-83-00042`, avec `E01` et `E02` clos puis `E03` en surveillance. Il est
idempotent : une seconde exécution vérifie le dataset existant sans l'écrire, tandis
qu'une collision échoue sans écrasement. Le manifeste de référence, son SHA-256/`ETag`
et la matrice de visibilité sont versionnés sous
[`contracts/demo/v1/`](contracts/demo/v1/).

Le seed ne publie aucun asset : `E03` retourne donc `not_available`. Les états de
revue et de suspension masquent strictement position, asset et repère ; une incohérence
persistée statut/visibilité répond `503` sans projection publique. Les tests emploient
seuls des métadonnées `.invalid` pour exercer `available`, sans GLB ni téléchargement.

## Contrat spatial local v1

**VÉRIFIÉ dans les artefacts FV-004** : l'[ADR-002](docs/adr/ADR-002-spatial-local-unity-contract.md)
et les [fixtures spatiaux](contracts/spatial/v1/fixtures/) fixent un profil rural local de
France continentale : origine `EPSG:4979` en `[longitude, latitude, hauteur]`, source
verticale `NGF-IGN69` convertie hors ligne par RAF20, ENU, GLB métrique et Unity à
`100` unités par mètre (`ViewerManifest.frame.meters_per_unit = 0.01`).

La Corse et les outre-mer sont hors périmètre de ce profil. Les zones sont réutilisables
uniquement à l'intérieur de leur emprise versionnée ; un snapshot de révision de manifeste
porte l'archive PNG et la provenance associée. Cesium ne fait pas partie de cette phase.

**NON VÉRIFIÉ** : aucun GLB rendu par Unity ni archive PNG réelle n'est encore livré. Les
contrôles de transformation, axes, origine et hash sont exécutés dans FV-004 ; le rendu et
l'archivage matériel resteront à intégrer avant toute affirmation d'alignement 3D.

## Sécurité et données

Ne placez dans ce dépôt ni position opérationnelle sensible, ni preuve brute, ni image de témoin, ni secret, ni fichier `.env`. Les archives reçues sont conservées localement pour provenance mais restent exclues de Git. Consultez [SECURITY.md](SECURITY.md) avant d'ouvrir une issue ou de contribuer.

## Licence

Le projet est libre, open source et gratuit :

- le code source du dépôt est sous [GNU AGPL-3.0-or-later](LICENSE) ;
- la documentation, la roadmap et les diagrammes sont sous [CC BY 4.0](LICENSE-DOCS.md).

Ces licences n'annulent pas les licences propres aux dépendances tierces ni les conditions de réutilisation des données géographiques. Elles n'offrent aucune garantie de disponibilité opérationnelle ou d'usage d'urgence. Les détails de périmètre sont dans [LICENSES.md](LICENSES.md).
