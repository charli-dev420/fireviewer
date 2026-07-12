# Registre des problèmes, corrections et validations

Ce registre conserve les écarts rencontrés pendant les passes de développement. Une entrée
ne passe à **VÉRIFIÉ** que lorsqu'une commande ou un test réellement exécuté en apporte la
preuve. Les points non exécutés restent explicitement **NON VÉRIFIÉ**.

## FV-005 — seed fictif et matrice des états publics

| ID | État | Problème observé | Correction appliquée | Preuve ou limite |
| --- | --- | --- | --- | --- |
| FV5-001 | **VÉRIFIÉ** | Le seed `FR-83-00042` contenait des référents géographiques réalistes, dépendait de variables `FV_DEMO_ASSET_*` et ne prouvait pas sa réexécution. | Spécification déclarative v1 entièrement fictive, sans asset, avec collision non destructive et ETag calculé. | Tests SQLite de création, seconde exécution sans écriture, collision et manifeste/hash. |
| FV5-002 | **VÉRIFIÉ** | Des exemples validaient `UNDER_REVIEW + available` et `REJECTED + not_available`, incompatibles avec la machine à états. | Politique canonique partagée par création, réactivation, transition, projection backend et parseur UI. | Tests de transitions, Pydantic, fixtures JSON et Vitest couvrant les couples autorisés et rejetés. |
| FV5-003 | **VÉRIFIÉ** | Une paire persistée statut/visibilité incohérente pouvait être projetée de façon ambiguë. | Les lectures publiques échouent fermées en `503 incident_inconsistent`, avec Problem Details et `trace_id`. | Test injectant `MONITORING + LIMITED` après un asset conforme ; aucune localisation, asset ou frame n'est exposé. |
| FV5-004 | **VÉRIFIÉ** | Le mock UI runtime pointait encore vers une URL `.invalid`, alors que ces métadonnées sont réservées aux tests de contrat. | Remplacement par une maquette locale `mock://` explicitement sans GLB, URL externe ni manifeste publié ; dates structurantes alignées sur le seed. | `npm run check`, 34 tests Vitest et build Vite passent. |
| FV5-005 | **VÉRIFIÉ** | Gitleaks signalait quatre faux positifs sur des littéraux d'idempotence de test. | Les littéraux sont construits à partir d'un suffixe de scénario, sans diminuer la couverture de l'idempotence. | Test de politique : 12 passes ; nouveau scan ciblé propre. |
| FV5-006 | **OBSERVÉ** | Une première commande manuelle Alembic a suivi l'URL par défaut de `alembic.ini` et a utilisé `services/fire-viewer-backend/data/fire_viewer.db` au lieu de la base temporaire attendue. | Aucun effacement n'a été tenté sur ce fichier ignoré, potentiellement local. Toutes les vérifications suivantes injectent l'URL SQLite temporaire directement dans `alembic.config.Config`. | La migration fraîche, le seed double et le manifeste hashé ont ensuite été exécutés dans `TemporaryDirectory`. L'état antérieur du fichier local est **NON VÉRIFIÉ**. |

## Limites actives

- **NON VÉRIFIÉ** : page UI raccordée à l'API avec `VITE_USE_MOCKS=false`, cache navigateur `304`, timeout et panneaux dégradés complets — FV-006.
- **NON VÉRIFIÉ** : GLB réel, import/rendu Unity et production matérielle de l'archive PNG — FV-008/FV-009.
- **NON VÉRIFIÉ** : migration exécutée contre une instance PostgreSQL réelle — hors contrôle SQLite actuel.
