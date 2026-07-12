# FIRE-VIEWER — UI / Frontend

Frontend React + TypeScript pour une page incidente-centrique stable :

- route canonique `/incident/{fire_id}` ;
- `VITE_USE_MOCKS=true` pour le dashboard fictif riche, incluant le terrain SVG de démonstration ;
- `VITE_USE_MOCKS=false` pour la consultation exclusive du `ViewerManifest` public réel ;
- vue API DOM-first, textuelle même quand un modèle est annoncé ;
- vues **Sources & confiance**, **Historique** et **Journal** explicitement non incluses dans le contrat API public ;
- erreur de configuration explicite plutôt qu'un fallback implicite vers des mocks ;
- responsive desktop, tablette et mobile avec bottom sheet ;
- navigation clavier, focus visible, libellés accessibles, cible tactile minimale de 44 px ;
- aucun téléchargement GLB, chargement Unity ou archive PNG dans le parcours API FV-006.

> Le contenu et les incidents sont fictifs. Cette interface ne constitue pas un service d’urgence certifié et ne doit jamais retarder un appel au 18 ou au 112.

## Démarrage

```bash
npm ci
npm run dev
```

Ouvrir ensuite :

```text
http://localhost:5173/incident/FR-83-00042
```

Build de production :

```bash
npm run check
npm run test
npm run build
npm run preview
```

Copier ensuite `.env.example` vers `.env.local` et choisir explicitement un mode :

```env
# Dashboard fictif historique
VITE_USE_MOCKS=true
```

```env
# Manifeste public réel local
VITE_USE_MOCKS=false
VITE_API_BASE_URL=http://localhost:8000
```

Seules les chaînes exactes `true` et `false` sont valides. Avec une valeur absente ou
invalide — y compris `false` sans `VITE_API_BASE_URL` HTTP(S) pure — l'UI affiche
`N/A — mode de données non configuré` et n'émet aucune requête ni ne charge de fixture.
`VITE_API_BASE_URL` désigne uniquement l'origine (`http://localhost:8000`), jamais un
préfixe tel que `/api` ou `/api/v1`.

## Contrat `ViewerManifest`

FV-003 fournit le parseur strict du DTO réseau `ViewerManifest` dans
`src/lib/viewerManifest.ts`. Il n'accepte que le contrat public `snake_case`
version `2.0` et les trois états `available`, `not_available` et `withheld`.
Les exemples fictifs partagés sont sous
`../../contracts/viewer-manifest/v2/examples/`.

FV-006 s'appuie sur ce parseur à travers `src/lib/manifestClient.ts`. En mode API,
il demande exclusivement :

```text
GET {VITE_API_BASE_URL}/api/v1/incident/{fire_id}/manifest
```

Chaque réponse `200` est parsée, doit correspondre au `fire_id` demandé et doit
fournir un `ETag`. L'URL n'est jamais l'ancien endpoint
`/incident/{fire_id}`. Les erreurs `400`, `404`, `410` et `503` sont rendues avec
un libellé sûr et, si fourni, un `trace_id` comme code de suivi ; le champ distant
`detail` n'est ni interprété ni affiché.

Le résumé public ne fabrique pas les collections **Sources**, **Historique** ou
**Journal**. En mode API, ces onglets restent accessibles, mais affichent un panneau
« non inclus dans le manifeste public » sans compteurs, exports, filtres, mode opérateur
ni contenu issu de `demoIncident`.

## Cache et revalidation

Le client conserve seulement `{ manifest, etag, checkedAt }` sous une clé
`sessionStorage` qui inclut l'origine API, la version de schéma et le `fire_id`. Si le
stockage navigateur est refusé ou saturé, une copie mémoire validée sert de repli. Les
requêtes utilisent `cache: "no-store"`, `credentials: "omit"` et `If-None-Match` quand
un `ETag` est déjà connu.

Une réponse `304` ne réutilise le cache que si son `ETag` correspond exactement à une
entrée encore conforme au parseur. Sans cache, avec cache corrompu ou `ETag` incohérent,
l'entrée est purgée puis une seule requête inconditionnelle est effectuée. L'UI revalide à
l'ouverture, lors du retour de l'onglet au premier plan et toutes les cinq minutes tant que
la page est visible. Après une erreur de revalidation, le dernier manifeste reste affiché
mais est signalé comme obsolète ; aucun mock ne remplace cette donnée.

## Surface publique API

`ManifestWorkspace` est le rendu du mode API. Il expose seulement :

- le `fire_id`, l'`episode_id`, le statut français canonique, la fraîcheur et l'instant de dernière revalidation ;
- la localisation et l'incertitude uniquement quand `location` est présente dans le manifeste ;
- pour `available`, version, hash SHA-256, taille et LOD, sans demande de fichier GLB ;
- pour `not_available`, « aucun modèle public disponible » ;
- pour `withheld`, aucune coordonnée, aucun asset et aucun repère déduit ;
- pour `CLOSED`, aucun viewer et aucune archive PNG interne.

`TerrainViewer`, ses marqueurs, son périmètre et ses simulations SVG ne sont jamais montés
en mode API. La détection WebGL ne charge aucun asset : elle ne fait qu'expliquer que le
rendu reste textuel si WebGL manque, ou que le chargement GLB/Unity est reporté à
FV-008/FV-009 s'il est présent.

## Reproduction E2E

La commande suivante installe le navigateur Chromium utilisé par Playwright puis lance la
recette locale :

```bash
npm run test:e2e:install
npm run test:e2e
```

`e2e/globalSetup.ts` prépare une SQLite sous le répertoire temporaire, appelle
`e2e/prepare_backend.py` afin d'injecter son URL dans `alembic.config.Config`, exécute
`fire-viewer-seed`, puis démarre Uvicorn et Vite avec CORS local. Le fichier de préparation
refuse explicitement l'URL SQLite de développement par défaut. Le harnais E2E a besoin de
`services/fire-viewer-backend/.venv` et de son binaire `fire-viewer-seed`; définir
`FV_E2E_BACKEND_PYTHON` permet de remplacer l'interpréteur Python détecté. Il active aussi
`VITE_E2E_TEST_MODE=true` uniquement dans le serveur Vite de test afin d'accélérer le
polling ; l'intervalle normal livré reste cinq minutes.

**VÉRIFIÉ localement** : `npm run test:e2e` exécute huit scénarios Chromium avec une
SQLite temporaire réellement migrée et seedée. Ils couvrent CORS, `200`/`304`, polling,
`404`, timeout, les deux états WebGL et l'absence de requête GLB ou de module mock en
mode API. Un hébergement et des navigateurs de production restent **NON VÉRIFIÉS**.

**VÉRIFIÉ dans un checkout Git neuf** : `npm ci`, `npm run check`, `npm run test` (57)
et `npm run build` réussissent au commit FV-006. La recette E2E requiert en plus
l'environnement Python backend, elle a donc été exécutée dans l'arbre de travail contrôlé.

## Structure

```text
src/
├── App.tsx                     sélection explicite mock/API, route et revalidation live
├── MockApp.tsx                 dashboard fictif riche, isolé du parcours API
├── fixtures/demoIncident.ts    jeu de données fictif versionné
├── lib/api.ts                  chargeur du seul dashboard mock
├── lib/manifestClient.ts       URL canonique, ETag, cache et erreurs sûres API
├── lib/viewerManifest.ts       parseur strict du contrat réseau public
├── lib/format.ts               formats français et fuseau Europe/Paris
├── types.ts                    contrats TypeScript
├── components/
│   ├── AppHeader.tsx           identité, statut, menu de démonstration
│   ├── PrimaryNav.tsx          vues de l’incident
│   ├── ViewerWorkspace.tsx     composition desktop/mobile
│   ├── TerrainViewer.tsx       rendu SVG réservé au dashboard mock
│   ├── ManifestWorkspace.tsx   rendu API DOM-first et panneaux public/minimal
│   ├── SituationPanel.tsx      faits, fraîcheur, urgence
│   ├── SynthesisPanel.tsx      confiance, alertes, couches
│   ├── SourcesView.tsx         preuves, provenance, incertitude
│   ├── HistoryView.tsx         épisodes et versions immuables
│   ├── JournalView.tsx         audit append-only
│   └── TextViewDialog.tsx      alternative complète au canvas
└── styles.css                  design system et responsive
e2e/                            harnais Playwright, migration SQLite et parcours live
```

## 3D future : pas de chargement en FV-006

`TerrainViewer.tsx` ne constitue qu'une démonstration mock. Il ne doit pas devenir un
fallback caché pour le manifeste public. Lorsque FV-008 puis FV-009 ajouteront un asset
GLB et un pont Unity/WebGL, conserver :

1. les contrôles critiques dans le DOM ;
2. la vue texte et les métadonnées hors canvas ;
3. le hash, la version, la taille, le LOD et la fraîcheur visibles avant tout chargement ;
4. l'absence totale de GLB/Unity lorsque le manifeste est `withheld`, `not_available` ou `CLOSED` ;
5. un fallback explicite lorsque WebGL, le réseau ou le futur asset échouent ;
6. l'absence de coordonnées spatiales déduites hors des champs déjà publics.

## Déploiement statique

Le dépôt contient :

- `vercel.json` pour les réécritures SPA ;
- `public/_redirects` pour Netlify / plateformes compatibles ;
- aucune ressource distante nécessaire au rendu de démonstration mock.

Pour Nginx, ajouter une réécriture de toutes les routes incident vers `index.html`. Le mode
de données est injecté par Vite à la construction : un déploiement API doit fournir
`VITE_USE_MOCKS=false` et une origine API explicite, jamais des valeurs implicites.

## Vérifications recommandées avant mise en ligne

- **VÉRIFIÉ localement** : `npm run check`, `npm run test` (57 tests), `npm run build` et `npm run test:e2e` (8 scénarios Chromium) passent après l'intégration finale ;
- **VÉRIFIÉ** : les builds API et non configuré n'émettent aucun chunk `MockApp`, fixture `demoIncident`, marqueur `mock://` ni `TerrainViewer`; le build `VITE_USE_MOCKS=true` conserve volontairement le dashboard fictif ;
- étendre la recette Playwright à d'autres navigateurs et aux contraintes de déploiement ciblées ;
- tester clavier, lecteur d’écran, contraste et zoom 200 % ;
- configurer CSP, HSTS, Referrer-Policy et Permissions-Policy ;
- mesurer le poids du shell, le pic mémoire et les LOD sur appareils réels ;
- ne jamais exposer les preuves brutes ou coordonnées sensibles dans la vue publique ;
- conserver le mode texte lorsque WebGL, Unity, le réseau ou le GLB échouent.
