# Analyse de la roadmap Fire Viewer

## Périmètre et preuves

- **VÉRIFIÉ** : `docs/roadmap/roadmap_fire_viewer_incident_centrique_detaillee-1.pdf` contient 65 pages, est non chiffré et son SHA-256 est `80F5B4A6101630E3BED88D04852A0260D42717FA75870762579A2901EB4016F0`.
- **VÉRIFIÉ** : le texte des 65 pages a été extrait et des pages représentatives ont été rendues visuellement. La structure, les tableaux et les maquettes examinés sont lisibles, sans texte coupé ni chevauchement visible.
- **OBSERVÉ** : le document est la version 1.0 du 12 juillet 2026. Il définit une architecture incidente-centrique, pas une carte nationale ni un système de conduite des secours.
- **NON VÉRIFIÉ** : les références externes, coûts d'hébergement, licences tierces et exigences réglementaires citées par le PDF n'ont pas été revalidés ici.

## Architecture cible imposée par la roadmap

1. Une URL stable `/incident/{fire_id}` identifie une série géographique persistante.
2. Un `episode_id` immuable représente une période opérationnelle, y compris une réactivation.
3. Le backend est la source de vérité transactionnelle. Le manifeste courant référence un asset GLB immuable, hashé et versionné.
4. Le DOM affiche toujours statut, fraîcheur, incertitude, sources et mode texte. Unity/WebGL reste une couche spatiale remplaçable, jamais le seul canal d'information.
5. Les agents vision et texte produisent des observations structurées avec incertitude. Ils ne confirment pas seuls un incendie et ne publient pas directement.
6. Le terrain est daté et géoréférencé. La chaîne privilégiée est données IGN -> PDAL/GDAL -> raster MNT -> TIN contrôlé -> GLB, avec origine ENU et provenance complète.

## Gates de maturité

| Gate | Usage autorisé | Preuves minimales |
| --- | --- | --- |
| G0 | conception | contrats, maquettes, tests unitaires, aucune donnée réelle |
| G1 | démonstration technique contrôlée | idempotence, audit, intégrité asset, mode texte, sécurité de base |
| G2 | bêta supervisée | E2E, tests utilisateurs, threat model, restauration, monitoring |
| G3-candidat | évaluation avec professionnels | SLA cible, formation, procédures 24/7, audits, responsabilités |
| G3 | usage opérationnel | validation formelle, conformité, gouvernance, financement durable |

**OBSERVÉ** : le PDF interdit une confirmation publique sur une source unique, une prévision non validée, l'exposition de données sensibles et toute promesse de disponibilité d'urgence fondée sur un hébergement gratuit.

## Ce qui est déjà présent dans les sources reçues

| Composant | Observé | Couverture roadmap |
| --- | --- | --- |
| `apps/fire-viewer-ui` | React 19, TypeScript, Vite, route incident, modes mock/API explicites, client `ViewerManifest`, DOM accessible et SVG de démonstration isolé | fondation de la phase 1 et préparation des phases 8-9 |
| `services/fire-viewer-backend` | FastAPI, SQLAlchemy, Alembic, SQLite WAL, matching `create/attach/review`, audit, manifest et endpoints santé | fondation de la phase 2, éléments des phases 6 et 7 |
| Projet Unity de Die externe | Unity 6.3, glTFast 6.15.1, Cesium, assets GLB et terrain Die | matière potentielle pour les phases 5 et 8, non intégrée |
| Agents, pipeline IGN, workers, pont JS/C#, publication atomique, cache/hot-swap, infrastructure pilote | absents des deux ZIP | phases 3 à 20 à planifier et réaliser |

## Écarts d'intégration à résoudre avant toute démo connectée

### Contrat HTTP UI/backend

**OBSERVÉ dans la baseline avant FV-006** : le dashboard historique chargeait un
`IncidentData` camelCase riche depuis l'ancien chemin `/incident/{fire_id}`. Ce contrat ne
correspondait ni au manifeste public minimal ni aux réponses backend disponibles.

**OBSERVÉ dans le code backend** : le manifeste correspondant est disponible via
`GET /api/v1/incident/{fire_id}/manifest`, au format `snake_case` (`schema_version`,
`fire_id`, etc.). Le `IncidentPublicResponse` de `/api/v1/incident/{fire_id}` ne contient
ni asset ni frame et n'est pas le contrat viewer.

**VÉRIFIÉ après FV-003** : l'[ADR-001](adr/ADR-001-viewer-manifest-public-contract.md) fixe désormais le chemin canonique `/api/v1/incident/{fire_id}/manifest` et le schéma `ViewerManifest` v2 en `snake_case`. Le modèle Pydantic, le schéma JSON versionné, l'OpenAPI et les parseurs UI sont couverts par des tests de contrat sur données fictives.

**VÉRIFIÉ après FV-005** : le dataset `FR-83-00042` est déclaratif, entièrement fictif et rejouable sans écrasement. Son manifeste `not_available`, son hash/`ETag` et la matrice des projections publiques sont versionnés. Les couples statut/visibilité non canoniques échouent fermés en `503`; les exemples et le parseur UI n'acceptent plus `UNDER_REVIEW + available` ni `REJECTED + not_available`.

**VÉRIFIÉ dans FV-006** : le shell API remplace ce chemin legacy par
`GET {VITE_API_BASE_URL}/api/v1/incident/{fire_id}/manifest`. `VITE_USE_MOCKS=true` conserve
le seul dashboard fictif ; `false` avec une origine HTTP(S) pure active l'API ; toute autre
configuration affiche `N/A` sans requête ni fixture. La réponse `200` passe par
`parseViewerManifest()`, doit avoir le bon `fire_id` et un `ETag`, puis est réduite à un
résumé public.

Le cache de navigation est borné à `sessionStorage` ou, à défaut, à la mémoire du processus.
La clé contient origine, schéma et `fire_id`. Une revalidation envoie `If-None-Match`; un
`304` ne sert que si l'`ETag` et l'entrée validée concordent, sinon une seule requête sans
condition suit la purge. L'ouverture, le retour de visibilité et cinq minutes d'onglet
visible sont les déclencheurs normaux. Un échec conserve seulement le dernier manifeste
marqué obsolète, sans fallback mock.

La vue connectée est DOM-first : ni `TerrainViewer` SVG, ni marqueur, ni simulation, ni
GLB/Unity ne sont montés. Sources, Historique et Journal indiquent qu'ils ne sont pas
inclus dans le manifeste public. Les métadonnées d'un `available` sont informatives ; le
chargement GLB/Unity et l'archive PNG restent FV-008/FV-009.

**VÉRIFIÉ localement** : les tests couvrent le raccordement seed réel, le `304` navigateur,
le timeout, les deux états WebGL et la recette Playwright. Aucun GLB ni module mock n'est
demandé en mode API. Une compatibilité de déploiement connecté reste **NON VÉRIFIÉE** tant
qu'aucune infrastructure de production et aucun navigateur supplémentaire ne sont testés.

### Reproduction E2E de l'écart HTTP

**VÉRIFIÉ localement** : `npm run test:e2e` s'appuie sur
`apps/fire-viewer-ui/e2e/globalSetup.ts`. Il crée un dossier temporaire, prépare une SQLite
avec `e2e/prepare_backend.py`, lance le seed, Uvicorn (`localhost:8000`) et Vite
(`localhost:5173`) avec CORS local, puis les arrête. La migration ne lit pas l'URL implicite
de `alembic.ini` : elle est injectée dans `alembic.config.Config` et le script refuse la
base de développement par défaut. `npm run test:e2e:install` installe Chromium au préalable.
Le polling est accéléré seulement dans le Vite de test ; la cadence normale reste cinq
minutes.

**VÉRIFIÉ dans l'arbre de travail FV-006** : les huit scénarios réussissent avec
l'environnement Python backend préparé. **VÉRIFIÉ dans un checkout Git neuf** : `npm ci`,
`npm run check`, les 57 tests et le build UI passent au commit FV-006. L'E2E nécessite
l'environnement Python backend et reste donc prouvé dans l'arbre de travail contrôlé.

### Repère et échelle Unity

**VÉRIFIÉ** : la roadmap demande `1` mètre = `1` unité dans le manifeste et le GLB, avec une origine ENU. Le projet Unity de Die existant déclare une présentation `1` mètre = `100` unités Unity.

**VÉRIFIÉ après FV-004** : l'[ADR-002](adr/ADR-002-spatial-local-unity-contract.md)
choisit une adaptation explicite plutôt qu'une normalisation implicite. Le GLB reste
métrique (`1 mètre` par unité glTF) tandis que le monde Unity emploie `100` unités par
mètre, soit `ViewerManifest.frame.meters_per_unit = 0.01`. L'origine est `EPSG:4979` dans
l'ordre `[longitude, latitude, hauteur]`, le repère est ENU et le pont glTF vers Unity est
versionné par le contrat spatial v1.

**VÉRIFIÉ dans le périmètre documentaire** : le profil RAF20/NGF-IGN69 est limité à la
France continentale rurale. Corse et outre-mer sont hors périmètre ; la Corse exigera un
profil RAC23/NGF-IGN78 dédié. Les zones sont versionnées et réutilisables uniquement dans
leur emprise ; l'archive PNG est attachée à un snapshot de révision de manifeste, pas à une
zone active en général. Cesium est exclu de cette phase.

**NON VÉRIFIÉ** : aucun GLB réel n'a encore été rendu ou importé dans Unity, et aucun PNG
d'archive matériel n'a été produit. Les contrôles FV-004 couvrent les transformations,
axes, origine et hash hors rendu ; les preuves d'intégration restent nécessaires pour
réduire le risque H3.

## Risques prioritaires à conserver dans le backlog

| Risque roadmap | Barrière vérifiable |
| --- | --- |
| H1 - mauvais rattachement | score explicable, marge, `episode_id`, revue humaine |
| H2 - donnée obsolète | horodatage, TTL, cache et mode dégradé visibles |
| H3 - terrain mal aligné | ENU, datum, points de contrôle, unité et hash testés |
| H4 - faux positif IA | observation seulement, corpus négatif, corroboration |
| H5 - panne 3D | DOM texte et tests sans WebGL/réseau |
| H6 - fuite de position | RBAC, minimisation, vues publique/opérateur séparées |

La passe FV-007 a exécuté 87 tests backend avec 88,06 % de couverture. Elle traverse
`upgrade -> upgrade idempotent -> check -> downgrade`, le matching déterministe
`create/attach/review`, le rejet des liens observation/épisode incohérents, l'idempotence
concurrente, l'audit append-only et une restauration SQLite validée. Une source historique
`c6d4f13a9b20` est migrée seulement dans un candidat `.part`, puis publiée vers une cible
neuve après contrôle de l'intégrité, des clés étrangères, des hashes et des triggers.

Cette passe n'ajoute aucun coût récurrent : SQLite local, Alembic, Python et fichiers de
sauvegarde locaux suffisent. Docker réellement exécuté, PostgreSQL/PostGIS, stockage distant
et procédure d'exploitation d'urgence restent hors de cette preuve.

## Décision de cadrage recommandée

La suite conseillée est FV-008 : un seul asset GLB de démonstration, fictif, immuable et
contrôlé par hash dans le contrat spatial déjà établi. Unity/WebGL reste à FV-009 ; le
brancher plus tôt ne réduit pas l'incertitude de publication de l'asset.
