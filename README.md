# Fire Viewer

> Prototype communautaire, incident-centrique et transparent pour visualiser des données d'incident avec leur provenance, leur fraîcheur et leur incertitude.

![Diagramme d'architecture Fire Viewer](assets/diagrams/fire-viewer-architecture.svg)

## Statut

**G0 - conception et fondations.** Le dépôt rassemble les sources reçues, la roadmap d'architecture et le backlog du premier vertical slice local. Il ne s'agit pas d'un service d'urgence, d'un outil de prévision, ni d'un système de confirmation automatique d'incendie.

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
docs/                                Architecture, roadmap, analyse et plan G0/G1
assets/diagrams/                     Schémas maintenables du projet
archives/received/                   ZIP d'origine conservés localement et ignorés par Git
```

## Sources et documentation

- [Architecture cible](docs/ARCHITECTURE.md)
- [Analyse de la roadmap](docs/ANALYSE_ROADMAP.md)
- [Plan de suite G0/G1](docs/PLAN_DE_SUITE.md)
- [Roadmap source](docs/roadmap/roadmap_fire_viewer_incident_centrique_detaillee-1.pdf)
- [Contribution](CONTRIBUTING.md)
- [Sécurité](SECURITY.md)
- [Statut des licences](LICENSES.md)

## Démarrage local prévu

Les commandes ci-dessous sont **OBSERVÉES** dans les projets reçus mais **NON VÉRIFIÉES** dans ce dépôt racine. Elles seront validées par le ticket `FV-002` avant d'être présentées comme un parcours supporté.

```powershell
# Interface
Set-Location apps/fire-viewer-ui
npm ci
npm run check
npm run build

# Backend
Set-Location ../../services/fire-viewer-backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e '.[dev]'
alembic upgrade head
make test
```

## Deux décisions à prendre avant une démo connectée

1. **Contrat API** - l'UI attend aujourd'hui un manifeste camelCase à `/incident/{fire_id}`, tandis que le backend fournit son manifeste snake_case sous `/api/v1/incident/{fire_id}/manifest`.
2. **Contrat spatial** - la roadmap attend `1 mètre = 1 unité`, alors que le projet Unity de Die existant utilise une présentation `1 mètre = 100 unités`.

Ces écarts sont documentés avec leurs preuves dans [l'analyse de roadmap](docs/ANALYSE_ROADMAP.md). Aucun couplage Unity ou appel API réel ne doit être déclaré fonctionnel avant tests de contrat et de précision métrique.

## Sécurité et données

Ne placez dans ce dépôt ni position opérationnelle sensible, ni preuve brute, ni image de témoin, ni secret, ni fichier `.env`. Les archives reçues sont conservées localement pour provenance mais restent exclues de Git. Consultez [SECURITY.md](SECURITY.md) avant d'ouvrir une issue ou de contribuer.

## Licence

Le backend fourni contient une licence AGPL-3.0-or-later. L'UI fournie ne contient pas de licence explicite. Le dépôt racine ne revendique donc pas encore une licence unifiée : lire [LICENSES.md](LICENSES.md) avant toute redistribution ou contribution.
