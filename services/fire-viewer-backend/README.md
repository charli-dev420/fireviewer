# Fire-Viewer - socle backend incident-centrique

Premier incrément fonctionnel du backend décrit dans la roadmap Fire-Viewer. Le dépôt livre une **vertical slice exécutable** autour de la phase 02, le contrat de manifeste de la phase 01, ainsi que les fondations utiles aux phases 06, 10, 11 et 14.

> Ce logiciel est un socle de développement et de démonstration. Il n'est pas certifié pour la conduite des secours, l'évacuation, la prévision de propagation ni la confirmation automatique d'un feu.

## Ce qui est opérationnel

- API FastAPI versionnée sous `/api/v1`, contrat OpenAPI exporté et erreurs au format Problem Details.
- SQLite en mode WAL, migrations Alembic reproductibles et index spatial RTree.
- `POST /incident/detect` transactionnel, idempotent et sûr sous concurrence mono-writer.
- Matching explicable `create | attach | review` combinant distance, incertitude, temps, toponymie, confiance de source et marge entre candidats.
- Zone grise conservative : une saturation de la liste de candidats force `review`, jamais une création ou un rattachement silencieux.
- Identité stable `fire_id`, épisodes immuables `episode_id` et nouvel épisode lors d'une réactivation.
- Visibilité publique contrôlée : un candidat ou une réactivation non confirmée reste `LIMITED`; localisation et asset sont masqués jusqu'à validation humaine.
- Une observation auto-rattachée mais non vérifiée ne rafraîchit pas la chronologie publique.
- Registre de sources côté serveur. Une source inconnue ne peut pas s'auto-déclarer institutionnelle.
- Les sources de confiance utilisent un secret d'ingestion dédié, transmis dans `X-Source-Token` et stocké uniquement sous forme de hash.
- Journal d'audit append-only avec snapshots avant/après, hashes, auteur, raison et `trace_id`; des triggers SQLite interdisent `UPDATE` et `DELETE`.
- Outbox transactionnelle et table de jobs avec états, tentatives et leases, prêtes pour le branchement des workers.
- Machine à états contrôlée, confirmation humaine documentée et suspension/kill switch au niveau incident.
- Résolution opérateur des observations en revue : rattacher, créer une série distincte ou rejeter.
- Manifeste viewer avec ETag, cache court, asset immuable et masquage lors d'une suspension.
- OIDC/JWT configurable pour staging/production; le mode sans authentification est interdit hors développement/test.
- Logs JSON avec `trace_id`, métriques Prometheus, headers de sécurité et limite de taille des corps HTTP.
- Sauvegarde SQLite atomique avec `integrity_check` avant publication du fichier final.
- Dockerfile non-root et Compose local.

## Démarrage local

Pré-requis : Python 3.12 ou 3.13.

```bash
cp .env.example .env
python -m venv .venv
. .venv/bin/activate
python -m pip install -e '.[dev]'
alembic upgrade head
uvicorn fire_viewer.main:app --reload --host 0.0.0.0 --port 8000
```

Points d'entrée :

- documentation interactive : `http://localhost:8000/docs`
- readiness : `http://localhost:8000/readyz`
- métriques : `http://localhost:8000/metrics`
- OpenAPI : `http://localhost:8000/openapi.json`

Le profil SQLite doit rester **mono-processus / mono-writer**. Ne lancez pas plusieurs workers Uvicorn sur le même fichier. Le passage à plusieurs instances exige PostgreSQL/PostGIS.

## Démarrage Docker

```bash
docker compose up --build
```

La migration est exécutée avant le démarrage de l'API. Le volume `fire_viewer_data` porte la base SQLite persistante.

## Exemple d'ingestion non vérifiée

```bash
curl -i \
  -X POST http://localhost:8000/api/v1/incident/detect \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: src-local-20260712-00184' \
  -d '{
    "source": {"id": "local-feed", "type": "text", "trust": "unverified"},
    "observed_at": "2026-07-12T08:18:00Z",
    "received_at": "2026-07-12T08:19:04Z",
    "geometry": {
      "type": "Point",
      "coordinates": [6.0214, 43.2897],
      "horizontal_uncertainty_m": 620
    },
    "evidence": {
      "content_hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "license": "source-specific"
    },
    "context": {
      "territory_code": "83",
      "toponyms": ["Massif des Maures"],
      "canonical_name": "Massif des Maures - secteur Nord"
    }
  }'
```

Une première observation retourne typiquement `201 create`. Une observation fortement compatible retourne `200 attach`. Deux candidats de scores proches, ou une recherche tronquée par le budget de candidats, retournent `200 review`.

## Raccordement d'une source de confiance

Le token ci-dessous doit être aléatoire, long, stocké dans un secret manager et utilisé uniquement côté serveur. Il ne doit jamais être intégré au shell web ou au build Unity.

```bash
curl -X PUT http://localhost:8000/api/v1/operator/sources/official-feed-83 \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "institutional",
    "trust": "institutional",
    "display_name": "Flux officiel 83",
    "enabled": true,
    "ingest_token": "replace-with-at-least-32-random-characters",
    "reason": "Source approuvée pour le connecteur institutionnel."
  }'
```

Le connecteur envoie ensuite le même secret dans `X-Source-Token`. Le secret n'est jamais renvoyé par l'API et n'est pas placé dans l'audit.

## Endpoints principaux

| Méthode | Route canonique | Rôle |
|---|---|---|
| `POST` | `/api/v1/incident/detect` | Ingestion idempotente et matching |
| `GET` | `/api/v1/incident/{fire_id}` | Métadonnées publiques et épisodes |
| `GET` | `/api/v1/incident/{fire_id}/manifest` | Contrat viewer, ETag, asset courant |
| `PUT` | `/api/v1/operator/sources/{source_id}` | Registre et credential des sources |
| `POST` | `/api/v1/operator/observations/{observation_id}/resolve` | Résolution d'une revue |
| `POST` | `/api/v1/operator/incidents/{fire_id}/transitions` | Transition d'état auditée |

Les anciennes routes au pluriel `/api/v1/incidents/...` restent disponibles comme alias de compatibilité, mais ne figurent pas dans OpenAPI.

Les mutations sensibles exigent un bearer JWT en staging/production. Le claim de rôles est configurable avec `FV_OIDC_ROLES_CLAIM`. Rôles reconnus : `administrator`, `analyst`, `validator`, `security_operator`.

## Garanties du premier incrément

### Idempotence et concurrence

L'API prend le verrou d'écriture SQLite avec `BEGIN IMMEDIATE` avant l'allocation d'identité et le matching. La réponse complète est conservée pendant la durée de rétention. Une même clé avec un corps différent retourne `409`; après expiration, la clé peut être réutilisée sans collision avec l'outbox.

### Matching conservateur

Le RTree ne sert que de préfiltre. Le classement final utilise une distance géodésique, l'incertitude combinée, la compatibilité temporelle, la toponymie et la confiance enregistrée côté serveur. Les seuils portent un `policy_id`; ils doivent être recalibrés sur un corpus annoté avant tout usage opérationnel.

### État public

Une détection ne peut pas passer seule à `ACTIVE_CONFIRMED`. Les nouvelles séries et réactivations restent `LIMITED`; la vue publique masque leur position et leur asset. La transition vers `ACTIVE_CONFIRMED` exige un rôle `validator` et un `validation_basis` documenté.

### Audit

Les mutations importantes conservent des snapshots structurés avant/après, leurs hashes, l'acteur, la raison et le `trace_id`. Les snapshots sont minimisés et n'exposent pas les preuves brutes. Le journal est protégé par des triggers append-only.

### Authentification des sources

La confiance déclarée dans le JSON n'est jamais suffisante. Pour une source enregistrée comme partenaire, institutionnelle ou opérateur, le service vérifie `X-Source-Token` avant même de servir un rejeu idempotent.

## Qualité

```bash
make quality
```

Résultat de référence de cette livraison :

- 23 tests passants;
- couverture branches incluse : 86,45 %;
- Ruff : aucune erreur et format vérifié;
- mypy strict : aucune erreur;
- compilation Python : réussie;
- migration `upgrade -> check -> downgrade` validée sur une base vierge.

Le détail des commandes exécutées et le smoke test sont consignés dans [`QUALITY_REPORT.md`](QUALITY_REPORT.md).

## Sauvegarde SQLite

```bash
fire-viewer-backup
# ou
python -m fire_viewer.scripts.backup_sqlite --output backups/manual.db
```

Le fichier final n'est remplacé qu'après backup complet et `PRAGMA integrity_check = ok`. La procédure de restauration se trouve dans `docs/RUNBOOK_BACKUP_RESTORE.md`.

## Données de démonstration

Après migration :

```bash
fire-viewer-seed
```

Le seed crée `FR-83-00042` avec trois épisodes. Aucun faux GLB n'est publié. Pour brancher un asset de test immuable :

```bash
export FV_DEMO_ASSET_URL='https://assets.example/incidents/FR-83-00042/E03/v4_hash.glb'
export FV_DEMO_ASSET_SHA256='<64 caractères hexadécimaux>'
export FV_DEMO_ASSET_SIZE_BYTES='19503562'
fire-viewer-seed
```

## Limites assumées

- La géométrie d'ingestion est limitée à `Point` + incertitude horizontale.
- Les fonctions de score sont des paramètres de prototype G1, pas des seuils opérationnels validés.
- Aucun worker LiDAR, upload de preuve, Agent A/Agent B ni pipeline de publication GLB n'est inclus.
- Les tables `job` et `outbox_event` sont persistées, mais aucun runner/dispatcher n'est encore fourni.
- Le schéma PostgreSQL/PostGIS cible est documenté; la migration automatisée depuis SQLite reste une phase dédiée.
- L'authentification forte des opérateurs dépend de l'IdP OIDC raccordé par le déploiement.
- Le rate limiting, le WAF et la protection de `/metrics` sont à appliquer au proxy/ingress.

## Arborescence

```text
src/fire_viewer/
  api/          routes, middlewares et erreurs Problem Details
  core/         configuration, sécurité, logs, identifiants
  db/           modèles SQLAlchemy, moteur SQLite WAL, transactions
  domain/       schémas, états, géodésie et matching
  services/     ingestion, revue, transitions, manifestes
  scripts/      OpenAPI, seed, sauvegarde et vérification des migrations
migrations/     migration Alembic initiale + RTree + audit append-only
tests/          tests unitaires, intégration, concurrence et sécurité
docs/           architecture, intégration, cible PostGIS et runbook
```
