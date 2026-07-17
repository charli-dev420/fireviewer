# FireWarning / Fire Viewer

Plateforme web incidente-centrique pour publier une page unique par incendie, administrer les
informations associées et diffuser des représentations 3D préparées hors ligne.

> FireWarning est un outil communautaire expérimental. Il ne contacte pas les secours, ne produit
> aucune consigne officielle et ne doit pas guider une intervention. En France, appelez le 18 ou le
> 112 en cas de danger immédiat.

## État actuel

La source de vérité détaillée est [l’état de préparation backend et administration](docs/ADMIN_BACKEND_READINESS.md).

| Surface | État vérifié le 16 juillet 2026 | Limites principales |
| --- | --- | --- |
| Site public React | Implémenté et déployé sur `fireviewer.vercel.app` | Données opérationnelles réelles non validées ; fiche incident dépend de l’API |
| Espace Admin | Connecté à l’API, compte administrateur unique, carte nationale interne et gestion des zones/packages | Plusieurs écrans restent surtout en consultation ; pas de multi-utilisateur ni MFA |
| API FastAPI | Déployée sur `fireviewer-api.vercel.app` avec Neon/PostGIS et Blob privé | La baseline hébergée enregistrée est `e6f3a1b8c420` |
| Schéma local courant | Alembic `a4e9c2f7d610`, upgrade/idempotence/check/downgrade validés | Les migrations agents et normalisation d’assets ne sont pas encore promues en production |
| Packages 3D | Préparation locale, upload direct navigateur vers Vercel Blob, validation et publication administrées | Import réel du package de 417 Mo non vérifié de bout en bout en production |
| Worker IA RunPod | Contrats, worker, tables dédiées et dispatcher asynchrone présents dans le worktree | Endpoint GPU, poids, CUDA, benchmark et déploiement CPU du dispatcher non vérifiés |

Le frontend a passé `npm run check`, 122 tests Vitest actifs et le build de production. La suite
backend complète passe : 164 tests réussis en 4 min 31 s, avec 83,96 % de couverture pour un seuil
requis de 80 %. Le worker nécessite encore un environnement de développement installé correctement
pour collecter toute sa suite.

## Principes produit

- Une page publique canonique par incendie : `/incendie/{fire_id}`.
- Les incidents en cours et les archives sont découverts depuis `/incendies`, sans carte nationale
  publique.
- Les images publiques proviennent uniquement des utilisateurs, après consentement explicite et
  modération ; il n’existe pas de galerie publique générale.
- La 3D est une représentation datée et versionnée. Les informations essentielles restent
  accessibles sans WebGL.
- La carte nationale est exclusivement administrative.
- La préparation LiDAR, COG, PNG et GLB reste locale. Le backend hébergé stocke les métadonnées et
  orchestre l’upload, la validation et la publication.
- Aucun résultat IA ne confirme ni ne publie seul un incendie.

## Architecture

```text
Navigateur public/Admin (React + Vite, Vercel)
        |
        | HTTPS, session Admin HttpOnly + CSRF
        v
API FastAPI (Vercel Functions)
        |-------------------- Neon PostgreSQL/PostGIS
        |-------------------- Vercel Private Blob
        `-------------------- dispatcher CPU -> RunPod Serverless (non déployé)

Pipeline LiDAR/3D local -> dossier package -> upload direct Blob depuis l’Admin
```

Voir [l’architecture détaillée](docs/ARCHITECTURE.md) et le
[guide Vercel/Neon/Blob](services/fire-viewer-backend/docs/DEPLOYMENT_VERCEL_NEON.md).

## Organisation du dépôt

```text
apps/fire-viewer-ui/             site public et espace Admin React/TypeScript
services/fire-viewer-backend/    API FastAPI, SQLAlchemy, Alembic, PostGIS et Blob
services/fire-viewer-agent-worker/ worker RunPod et outils de corpus/entraînement
tools/spatial-hybrid-zone/       préparation locale des packages spatiaux
contracts/                       contrats publics, spatiaux et fixtures
docs/                            architecture, ADR, readiness, runbooks et historique G1
```

## Démarrage local

### Backend SQLite

```powershell
Set-Location services/fire-viewer-backend
uv venv --python 3.13 .venv
uv pip install --python .venv\Scripts\python.exe -e '.[dev]'
Copy-Item .env.example .env
$env:FV_DATABASE_URL = 'sqlite:///./data/fire_viewer_local.db'
& .\.venv\Scripts\alembic.exe upgrade head
& .\.venv\Scripts\uvicorn.exe fire_viewer.main:app --host 127.0.0.1 --port 8000
```

SQLite reste réservé au développement mono-processus. Le runtime hébergé utilise
PostgreSQL/PostGIS.

### Frontend

```powershell
Set-Location apps/fire-viewer-ui
npm ci
$env:VITE_API_BASE_URL = 'http://127.0.0.1:8000'
npm run dev
```

Routes principales :

- `http://127.0.0.1:5173/` : accueil public ;
- `http://127.0.0.1:5173/incendies` : incidents en cours et archives ;
- `http://127.0.0.1:5173/incendie/FR-83-00042` : fiche incidente-centrique ;
- `http://127.0.0.1:5173/admin` : administration ;
- `http://127.0.0.1:8000/docs` : OpenAPI locale.

## Contrôles

```powershell
# Frontend
Set-Location apps/fire-viewer-ui
npm run check
npm run test
npm run build

# Backend
Set-Location ../../services/fire-viewer-backend
& .\.venv\Scripts\ruff.exe check .
& .\.venv\Scripts\mypy.exe
& .\.venv\Scripts\pytest.exe
& .\.venv\Scripts\python.exe -m fire_viewer.scripts.check_migrations
```

Les contrôles spatiaux de 417 Mo sont séparés du build web standard : `npm run fetch:spatial`,
`npm run verify:spatial` et `npm run build:spatial`.

## Documentation

- [État actuel et écarts du cahier des charges](docs/ADMIN_BACKEND_READINESS.md)
- [Architecture actuelle](docs/ARCHITECTURE.md)
- [Plan de suite priorisé](docs/PLAN_DE_SUITE.md)
- [Administration des zones et packages](docs/MVP_ADMINISTRATION_ZONES.md)
- [ADR de sécurité et contrats](docs/adr/ADR-003-cdc-v2-p0-arbitrations.md)
- [Registre historique des validations](docs/REGISTRE_PROBLEMES_VALIDATIONS.md)
- [Runbook de déploiement](services/fire-viewer-backend/docs/DEPLOYMENT_VERCEL_NEON.md)
- [Worker IA et limites RunPod](services/fire-viewer-agent-worker/README.md)

## Licence

Code sous [GNU AGPL-3.0-or-later](LICENSE). Documentation et diagrammes sous
[CC BY 4.0](LICENSE-DOCS.md), sous réserve des exceptions du
[registre de provenance](ASSET_PROVENANCE.md). Les données et dépendances conservent leurs licences
propres. Les JPEG de hero restent exclus de la concession tant que leur provenance n'est pas
documentée.
