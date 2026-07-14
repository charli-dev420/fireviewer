# Runbook G1 — démonstration locale contrôlée

But.

Ce runbook permet de rejouer une démonstration G1 sans service cloud de runtime,
carte externe, Cesium, licence propriétaire ou données d'incident réelles. Il prépare
une SQLite de démonstration, le seed fictif, l'API, l'interface et la carte
statique de la zone publique `DIE-PONTAIX-08@R1`. Il inclut une sauvegarde et
une restauration non destructives.

Ce document est une procédure, pas une preuve d'exécution. Le parcours complet
a été exercé le 14 juillet 2026 depuis le tag source de clôture ; les résultats
sont consignés dans [le registre](REGISTRE_PROBLEMES_VALIDATIONS.md).

Préconditions.

- utiliser un checkout Git propre de la révision à vérifier ;
- disposer de Python 3.13, `uv`, Node/npm et d'un navigateur avec WebGL ;
- disposer de la GitHub Release publique `spatial-die-pontaix-r1-v4`, ou de son
  archive contrôlée pour la recette hors ligne ;
- utiliser le tag source `spatial-die-pontaix-r1-v4-fix1`, qui conserve les
  octets LF des contrats hashés sur un checkout Windows standard ;
- ne pas employer une base SQLite de développement existante ;
- ne pas enregistrer de secret, d'incident réel, de position opérationnelle ou
  de fichier `.env` dans Git ;
- garder un seul processus d'écriture Uvicorn pour la SQLite locale.

Obtenir le checkout propre du tag.

Après publication de la release, utiliser un répertoire neuf, sans
`node_modules`, base SQLite ni paquet spatial préexistant :

```powershell
Set-Location <dossier-parent>
git clone --branch spatial-die-pontaix-r1-v4-fix1 --depth 1 https://github.com/charli-dev420/fireviewer.git fireviewer-g1-clean
Set-Location fireviewer-g1-clean
git status --short
git rev-parse --verify HEAD
```

La sortie de `git status --short` doit être vide. Conserver le hash affiché par
`git rev-parse` avec les résultats de la recette ; il identifie le tag contrôlé.

Préparer le backend.

Dans un premier terminal PowerShell :

```powershell
Set-Location services/fire-viewer-backend
uv venv --python 3.13 .venv
uv pip install --python .venv\Scripts\python.exe -e '.[dev]'
New-Item -ItemType Directory -Force data, backups | Out-Null
$env:FV_DATABASE_URL = 'sqlite:///./data/fire_viewer_g1.db'
.\.venv\Scripts\alembic.exe upgrade head
.\.venv\Scripts\alembic.exe upgrade head
.\.venv\Scripts\fire-viewer-seed.exe
.\.venv\Scripts\fire-viewer-seed.exe
```

Critère de sortie : le deuxième seed ne modifie pas le dataset fictif
`FR-83-00042`. Une collision ou une erreur doit arrêter la démonstration ; ne
pas écraser la base pour la contourner.

Démarrer l'API locale.

Toujours dans le terminal backend :

```powershell
.\.venv\Scripts\uvicorn.exe fire_viewer.main:app --host 127.0.0.1 --port 8000
```

Vérifier dans un autre terminal :

```powershell
Invoke-WebRequest http://127.0.0.1:8000/readyz
Invoke-WebRequest http://127.0.0.1:8000/api/v1/incident/FR-83-00042/manifest
```

Le manifeste du seed est fictif et doit rester honnêtement
`model_state=not_available`. Il ne doit ni publier de GLB, ni créer un lien
avec `DIE-PONTAIX-08`.

Préparer la release spatiale.

Cette étape est réservée au mainteneur qui construit une nouvelle release. Le
paquet contient seulement les 144 binaires de la zone : huit COG, huit PNG et
128 GLB. Le catalogue, le manifeste de paquet, le verrou de release et
`ign_sources.v1.json` restent dans Git. Ne lancer cette commande qu'après le
contrôle local des binaires :

```powershell
Set-Location apps/fire-viewer-ui
npm run pack:spatial
```

Le script produit l'archive `fireviewer-die-pontaix-r1-v4.tar.gz` et
`SHA256SUMS`. Contrôler ensuite que ces fichiers correspondent au verrou
versionné avant publication. La release publique
`spatial-die-pontaix-r1-v4` contient ces trois assets et n'est jamais déplacée.
Le tag source `spatial-die-pontaix-r1-v4-fix1` est distinct : il corrige la
reproductibilité du checkout sans reconstruire ni réimporter les 144 binaires.
GitHub sert uniquement à préparer le paquet : la carte publique ne charge aucun
asset depuis GitHub.

Préparer et démarrer l'interface.

Dans un deuxième terminal :

```powershell
Set-Location apps/fire-viewer-ui
npm ci
npm run fetch:spatial
$env:VITE_USE_MOCKS = 'false'
$env:VITE_API_BASE_URL = 'http://127.0.0.1:8000'
npm run dev
```

Ouvrir les deux routes :

- `http://127.0.0.1:5173/incident/FR-83-00042`
- `http://127.0.0.1:5173/zones/die-pontaix`

La première route doit présenter seulement le résumé public autorisé. La seconde
doit lire le catalogue local et afficher `Zone Die–Pontaix` avec le bouton
`Recentrer la zone`, sans appel à Cesium ni fond cartographique externe. À la
vue d'ensemble, elle doit conserver le relief et l'aperçu couleur sans maintenir
les GLB détaillés ; elle ne doit pas présenter deux zones publiques. Sans WebGL,
elle doit afficher son résumé DOM de zone sans prétendre remplacer le rendu 3D.
Répéter ce contrôle dans un navigateur WebGL de bureau puis sur mobile ou son
émulation, en relevant la console, les requêtes et le fallback sans WebGL.

Contrôles de qualité.

Exécuter les contrôles depuis les dossiers indiqués :

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

# Dépôt, depuis sa racine
Set-Location ../..
git diff --check
gitleaks protect --staged --no-banner
```

`npm run fetch:spatial` vérifie le hash de l'archive de release, refuse les
chemins hostiles, extrait dans un répertoire temporaire puis n'installe les
binaires qu'après `npm run verify:spatial`. Ce dernier vérifie chaque chemin,
taille et SHA-256 déclarés par
`public/maps/fireviewer-die-pontaix-r1-v4/catalog.json`, le manifeste de
paquet, le verrou et la provenance IGN. `npm run build` en dépend : sans paquet
contrôlé, le build doit échouer explicitement.

Sauvegarder la SQLite G1.

Arrêter les écritures avant de lancer cette étape. Depuis le dossier backend :

```powershell
fire-viewer-backup --output backups/fire_viewer_g1.db
Get-FileHash backups/fire_viewer_g1.db -Algorithm SHA256
```

Conserver la sortie de la commande et le hash dans le registre ou l'artefact de
recette. Ne pas utiliser le nom de votre seule copie comme sortie de backup.

Restaurer vers une cible neuve.

```powershell
fire-viewer-restore --source backups/fire_viewer_g1.db --target data/fire_viewer_g1_recovered.db
```

La restauration doit refuser une cible déjà existante et ne doit pas modifier
la source. Démarrer ensuite une instance avec `FV_DATABASE_URL` pointant vers
la cible restaurée, puis vérifier `/readyz` et le manifeste fictif. Le
détail des gardes de sauvegarde est dans
[le runbook SQLite](../services/fire-viewer-backend/docs/RUNBOOK_BACKUP_RESTORE.md).

Arrêt et rollback.

1. Arrêter Vite et Uvicorn avec Ctrl+C.
2. Conserver la base d'origine et la base restaurée : ne supprimer aucune des
   deux pendant la recette.
3. Si une vérification échoue, noter le message, la commande, la révision Git
   et l'artefact concerné dans le registre.
4. Reprendre depuis un checkout propre ou une nouvelle base dédiée ; ne pas
   réparer une preuve en modifiant manuellement la SQLite ou le catalogue.

Sortie de gate.

G1 est prêt à être déclaré VÉRIFIÉ lorsque :

- les commandes backend et interface ont passé sur la même révision ;
- les routes incident et carte ont été ouvertes avec les comportements attendus ;
- la zone unique, le recentrage, la vue d'ensemble sans GLB, l'absence de
  Cesium et d'URL externe ont été observés sur bureau et mobile ;
- la sauvegarde et la restauration vers une cible neuve ont été démontrées ;
- la release publiée contient l'archive, `SHA256SUMS` et l'attribution IGN ;
  le verrou, les hashes des 144 binaires et le manifeste IGN concordent ;
- le checkout propre a récupéré le paquet avec `npm run fetch:spatial`, puis
  exécuté les contrôles sans réutiliser de build ou d'asset local ;
- les résultats, avertissements et limites restantes sont ajoutés au registre.

Le déploiement Vercel, le cache CDN, la performance mobile, les licences de
publication géographique, les incidents réels et la liaison publique entre une
zone et un incident restent hors de cette recette G1.
