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
| `apps/fire-viewer-ui` | React 19, TypeScript, Vite, route incident, mode mock, DOM accessible et vue 3D de démonstration SVG | fondation de la phase 1 et une partie de la phase 9 |
| `services/fire-viewer-backend` | FastAPI, SQLAlchemy, Alembic, SQLite WAL, matching `create/attach/review`, audit, manifest et endpoints santé | fondation de la phase 2, éléments des phases 6 et 7 |
| Projet Unity de Die externe | Unity 6.3, glTFast 6.15.1, Cesium, assets GLB et terrain Die | matière potentielle pour les phases 5 et 8, non intégrée |
| Agents, pipeline IGN, workers, pont JS/C#, publication atomique, cache/hot-swap, infrastructure pilote | absents des deux ZIP | phases 3 à 20 à planifier et réaliser |

## Écarts d'intégration à résoudre avant toute démo connectée

### Contrat HTTP UI/backend

**VÉRIFIÉ dans le code** :

- L'UI appelle `GET {VITE_API_BASE_URL}/incident/{fire_id}` et exige une réponse `schemaVersion: "2.0"`, `fireId`, `episodeId`, `asset`, `frame` et `status`.
- Le backend expose l'API sous `/api/v1`. `GET /api/v1/incident/{fire_id}` renvoie un `IncidentPublicResponse`, sans `asset` ni `frame`.
- Le manifeste correspondant est disponible via `GET /api/v1/incident/{fire_id}/manifest`, au format Python `snake_case` (`schema_version`, `fire_id`, etc.).

**Conclusion VÉRIFIÉE** : les deux projets ne sont pas compatibles directement avec `VITE_USE_MOCKS=false`. Le premier ticket d'intégration doit fixer le chemin canonique et un unique schéma JSON public, puis le prouver par un test de contrat. Une option cohérente est d'adapter l'UI au endpoint `/api/v1/incident/{fire_id}/manifest` et de définir des alias JSON camelCase côté API, mais cette solution reste **INFÉRÉE** tant qu'une décision d'architecture n'est pas enregistrée.

### Repère et échelle Unity

**VÉRIFIÉ** : la roadmap demande `1` mètre = `1` unité dans le manifeste et le GLB, avec une origine ENU. Le projet Unity de Die existant déclare une présentation `1` mètre = `100` unités Unity.

**Impact** : copier le projet Unity ou charger ses assets dans le viewer sans contrat d'adaptation créerait un risque H3 de mauvais alignement des distances et marqueurs. Une ADR doit décider soit la normalisation à 1:1, soit une conversion explicite, testée et transportée par le manifeste.

## Risques prioritaires à conserver dans le backlog

| Risque roadmap | Barrière vérifiable |
| --- | --- |
| H1 - mauvais rattachement | score explicable, marge, `episode_id`, revue humaine |
| H2 - donnée obsolète | horodatage, TTL, cache et mode dégradé visibles |
| H3 - terrain mal aligné | ENU, datum, points de contrôle, unité et hash testés |
| H4 - faux positif IA | observation seulement, corpus négatif, corroboration |
| H5 - panne 3D | DOM texte et tests sans WebGL/réseau |
| H6 - fuite de position | RBAC, minimisation, vues publique/opérateur séparées |

## Décision de cadrage recommandée

**INFÉRÉ** : le prochain jalon doit être un vertical slice G0/G1 entièrement fictif et local : une route stable, un incident de démonstration, un manifeste hashé, un fallback texte, un appel API réel et un chargement 3D contrôlé. Démarrer par les agents IA, la publication cloud ou une bêta publique avant ce slice augmenterait les risques H1, H3, H4 et H5 sans réduire une incertitude de base.
