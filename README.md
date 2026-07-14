# Fire Viewer

Prototype communautaire, incident-centrique et transparent pour visualiser des
données d'incident avec leur provenance, leur fraîcheur et leur incertitude.

![Diagramme d'architecture Fire Viewer](assets/diagrams/fire-viewer-architecture.svg)

État.

G1 clôt une démonstration contrôlée, sans coût récurrent imposé : manifeste
public, persistance SQLite et carte de zone restent séparés. Le paquet binaire
spatial n'est volontairement pas stocké dans Git. La release publique
`spatial-die-pontaix-r1-v4` le distribue ; le tag source de clôture
`spatial-die-pontaix-r1-v4-fix1` préserve les contrats hashés en LF et permet
à un checkout Windows standard de le récupérer, le vérifier puis l'installer
avant le build. Le tag v4 publié est conservé tel quel. Il ne s'agit pas d'un
service d'urgence, d'un outil de prévision, ni d'un système de confirmation
automatique d'incendie.

OBSERVÉ dans l'arbre de travail : deux parcours publics sont séparés.

| Route | Contenu | Limite |
| --- | --- | --- |
| `/incident/{fire_id}` | manifeste public minimal `ViewerManifest` v2 et rendu DOM | aucune donnée de zone ou asset spatial n'est inférée |
| `/zones/die-pontaix` | carte 3D statique Die–Pontaix, COG LiDAR, PNG et GLB locaux | paquet de zone, sans rattachement à un incident |

La clôture livrable G1 exige que la même révision Git passe les contrôles et
l'exercice décrits dans [le plan](docs/PLAN_DE_SUITE.md) et
[le runbook](docs/RUNBOOK_G1.md). Cette page ne transforme pas les preuves
historiques en contrôles nouvellement exécutés.

VÉRIFIÉ le 14 juillet 2026 dans un clone neuf avec `core.autocrlf=true` : le
backend a passé 88/88 tests avec 88,06 % de couverture, Ruff, mypy, migrations
et compilation. Une sauvegarde et une restauration SQLite fraîche ont également
été exécutées. L'interface a passé `npm ci`, `fetch:spatial`, le check, 68 tests
Vitest, 11 tests spatiaux, le build et 20 scénarios E2E bureau et émulation
mobile. Les 144 fichiers de la carte, la provenance IGN et l'archive HTTPS ont
été contrôlés. Les limites de runtime public restent dans le registre.

En cas de feu ou de danger immédiat en France, contactez les secours au 18 ou
au 112. N'utilisez jamais ce prototype pour guider une intervention ou vous
rapprocher d'un incendie.

Principe du produit.

- Le backend est la source de vérité pour les observations, le matching,
  l'audit, les états publics et les manifestes.
- Le shell web affiche toujours le statut, la fraîcheur et les incertitudes.
  Le parcours incident reste utilisable sans WebGL.
- Unity est l'outil d'authoring spatial. Giro3D est le renderer web public
  choisi pour les paquets de zone.
- Les zones cartographiques ne sont pas des incidents : une association future
  doit passer par une publication de révision contrôlée et une archive PNG
  immuable.
- Les agents IA futurs ne produiront que des observations structurées ; ils ne
  peuvent ni confirmer seuls un incident ni publier un état public.

Organisation du dépôt.

```text
apps/fire-viewer-ui/                 Interface React, TypeScript, Vite et carte Giro3D
services/fire-viewer-backend/        API FastAPI, SQLAlchemy, Alembic et SQLite
contracts/                           Schémas JSON et fixtures publics ou spatiaux
contracts/spatial/releases/          Verrous de release et provenance IGN versionnés
docs/                                Architecture, décisions, plan, registre et runbook G1
assets/diagrams/                     Schémas maintenables du projet
archives/received/                   ZIP d'origine locaux, ignorés par Git
```

Sources et documentation.

- [Architecture cible](docs/ARCHITECTURE.md)
- [Contrat public ViewerManifest v2](docs/adr/ADR-001-viewer-manifest-public-contract.md)
- [Schéma ViewerManifest v2](contracts/viewer-manifest/v2/viewer-manifest.schema.json)
- [Contrat spatial local ENU et Unity](docs/adr/ADR-002-spatial-local-unity-contract.md)
- [Contrat spatial local v1](contracts/spatial/v1/README.md)
- [Verrou de la release Die–Pontaix R1](contracts/spatial/releases/fireviewer-die-pontaix-r1-v4.release-lock.json)
- [Provenance IGN versionnée](contracts/spatial/releases/ign_sources.v1.json)
- [Dataset fictif et matrice publique v1](contracts/demo/v1/README.md)
- [Analyse de la roadmap](docs/ANALYSE_ROADMAP.md)
- [MVP — administration des zones, révisions et publications](docs/MVP_ADMINISTRATION_ZONES.md)
- [Plan de suite et critères de clôture G1](docs/PLAN_DE_SUITE.md)
- [Registre problèmes et validations](docs/REGISTRE_PROBLEMES_VALIDATIONS.md)
- [Runbook G1](docs/RUNBOOK_G1.md)
- [Runbook sauvegarde/restauration SQLite](services/fire-viewer-backend/docs/RUNBOOK_BACKUP_RESTORE.md)
- [Roadmap source](docs/roadmap/roadmap_fire_viewer_incident_centrique_detaillee-1.pdf)
- [Contribution](CONTRIBUTING.md)
- [Sécurité](SECURITY.md)
- [Statut des licences](LICENSES.md)

Démarrage local.

Les commandes ci-dessous suivent les scripts déclarés par les projets. Utiliser
une base de démonstration dédiée ; ne pas remplacer une base locale existante.

```powershell
# Backend, dans un premier terminal
Set-Location services/fire-viewer-backend
uv venv --python 3.13 .venv
uv pip install --python .venv\Scripts\python.exe -e '.[dev]'
$env:FV_DATABASE_URL = 'sqlite:///./data/fire_viewer_g1.db'
.\.venv\Scripts\alembic.exe upgrade head
.\.venv\Scripts\fire-viewer-seed.exe
.\.venv\Scripts\uvicorn.exe fire_viewer.main:app --host 127.0.0.1 --port 8000

# Interface, dans un second terminal
Set-Location apps/fire-viewer-ui
npm ci
$env:VITE_USE_MOCKS = 'false'
$env:VITE_API_BASE_URL = 'http://127.0.0.1:8000'
npm run dev
```

Ouvrir ensuite :

- `http://127.0.0.1:5173/incident/FR-83-00042` pour le seed fictif ;
- `http://127.0.0.1:5173/zones/die-pontaix` pour la carte 3D locale ;
- `http://127.0.0.1:8000/docs` pour l'OpenAPI locale.

Le détail des opérations, sauvegardes et critères de succès est dans le
[runbook G1](docs/RUNBOOK_G1.md).

Modes de données de l'interface.

| Valeur de `VITE_USE_MOCKS` | Résultat |
| --- | --- |
| `true` | dashboard fictif historique, réservé à la démonstration locale |
| `false` avec `VITE_API_BASE_URL` valide | consultation exclusive du manifeste public réel |
| absente, invalide ou `false` sans origine valide | écran N/A sans requête ni fixture |

Une origine valide est une origine HTTP(S) pure, par exemple
`http://localhost:8000`. Elle ne contient ni chemin `/api`, ni query,
fragment ou identifiants.

Carte de la zone Die–Pontaix.

Le contrat G1 déclare une seule zone publique `DIE-PONTAIX-08@R1`, dans le
catalogue `1.1`. Son emprise logique Lambert-93 est
`[876000, 6403000, 892000, 6413000]`. Elle contient deux emprises techniques
de couverture, `[876000, 6403000, 884000, 6411000]` et
`[884000, 6405000, 892000, 6413000]` : elles ne deviennent jamais deux zones
visibles dans l'interface.

Après `npm run fetch:spatial`, le paquet est installé sous
`apps/fire-viewer-ui/public/maps/fireviewer-die-pontaix-r1-v4/`. Git suit le
catalogue, le manifeste, le verrou de release et la provenance ; il ignore les
144 binaires installés : huit COG LiDAR, huit aperçus PNG et 128 GLB. Les noms
techniques, tailles et SHA-256 de ces binaires sont conservés par le manifeste
de paquet. La provenance IGN est la Licence Ouverte / Open Licence 2.0 ; son
manifeste versionné est
`contracts/spatial/releases/ign_sources.v1.json` et son SHA-256 est
`cff6e9ffa71ce38397defe490bf54f6ba361cc9e5ed8621f22719e5e86d20fe5`.

La release publique `spatial-die-pontaix-r1-v4` contient
`fireviewer-die-pontaix-r1-v4.tar.gz`, `SHA256SUMS` et l'attribution IGN. Le
tag source de clôture `spatial-die-pontaix-r1-v4-fix1` ne remplace ni ne modifie
cette release : il corrige seulement la reproductibilité du checkout Windows.
GitHub sert seulement à reconstituer le paquet au build : la carte ne charge
jamais d'asset depuis GitHub au runtime. `npm run fetch:spatial` contrôle
l'archive avant extraction et `npm run verify:spatial` recalcule les chemins,
tailles et SHA-256 installés. `npm run build` dépend de cette vérification et
échoue explicitement si la carte n'a pas été récupérée et contrôlée.

La vue d'ensemble couvre l'emprise complète sans plafond artificiel de 3,6 km.
Les COG et aperçus PNG restent visibles à distance ; les GLB détaillés ne sont
chargés qu'au rapprochement. Sans WebGL, la route conserve un résumé DOM de la
zone sans simuler de rendu 3D ni rattachement à un incident. Le parcours
d'incident reste textuel et indépendant.

Contrat public ViewerManifest v2.

`GET /api/v1/incident/{fire_id}/manifest` est la ressource viewer canonique.
Le contrat utilise `snake_case`, un `schema_version` obligatoire, ETag et
`If-None-Match`, les états `available`, `not_available` et `withheld`,
ainsi que des Problem Details pour les erreurs.

Sources, historique détaillé, journal, carte de zone et archive PNG interne ne
font pas partie de ce contrat public minimal. Le mode API affiche uniquement les
informations que le manifeste autorise.

Contrôles à rejouer pour une révision publiable.

```powershell
# Interface
Set-Location apps/fire-viewer-ui
npm ci
npm run fetch:spatial
npm run check
npm run test
npm run test:spatial
npm run verify:spatial
npm run build
npm run test:e2e

# Backend
Set-Location ../../services/fire-viewer-backend
make quality
```

Le résultat de ces commandes doit être enregistré dans
[le registre](docs/REGISTRE_PROBLEMES_VALIDATIONS.md). Une validation de
navigateur, de cache et de réseau de production reste NON VÉRIFIÉE tant
qu'elle n'est pas exécutée sur l'environnement de déploiement réel.

Sécurité et données.

Ne placez dans ce dépôt ni position opérationnelle sensible, ni preuve brute,
ni image de témoin, ni secret, ni fichier `.env`. Les archives reçues sont
conservées localement pour provenance mais restent exclues de Git. Consultez
[SECURITY.md](SECURITY.md) avant d'ouvrir une issue ou de contribuer.

Licence.

Le code source est sous [GNU AGPL-3.0-or-later](LICENSE). La documentation, la
roadmap et les diagrammes sont sous [CC BY 4.0](LICENSE-DOCS.md). Ces licences
n'annulent pas les licences des dépendances ou des données géographiques et
n'offrent aucune garantie de disponibilité opérationnelle.
