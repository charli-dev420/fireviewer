# FireWarning agent worker

Worker GPU RunPod isolé pour l'analyse factuelle de médias. La recette utilise d'abord un pod
persistant ; RunPod Serverless ne sera activé qu'après validation du pipeline. Le worker prépare
l'intégration GPU sans
autoriser le worker à publier, géolocaliser un phénomène, produire une prévision ou transformer une
détection en fait public.

## État livré

Le service contient :

- le contrat d'entrée et de sortie fermé `1.0` ;
- les révisions Hugging Face verrouillées par commit ;
- la vérification réelle du SHA-256 du checkpoint RT-DETR privé ;
- le chargement strictement séquentiel Whisper → RT-DETR → Florence → Qwen ;
- le déchargement et le nettoyage CUDA entre les modèles ;
- la conservation des résultats des étapes terminées si une étape ultérieure échoue ;
- une seule correction Qwen après une sortie invalide, puis revue humaine ;
- le contrôle des liens de preuve, du vocabulaire spéculatif et des marqueurs géographiques ;
- des métriques par modèle : chargement, inférence, pic VRAM, statut et code d'erreur ;
- un téléchargement borné aux hôtes HTTPS internes explicitement autorisés, sans redirection.
- une recherche Qwen3-4B pilotant uniquement `search`, `inspect` et `fetch` via un courtier réseau ;
- un processus de recherche sans socket IPv4/IPv6, vérifié par seccomp au démarrage du pod.

Le checkpoint `RT-DETRv2-R18 FireWarning` entraîné n'est pas dans le dépôt. L'absence de ce checkpoint
est annoncée comme une étape `skipped`; elle ne doit pas être masquée en production.

## Stratégie de démarrage et coût

Le conteneur ne contient aucun poids. À son démarrage, son bootstrap inspecte le volume monté et ne
télécharge que les snapshots publics verrouillés qui sont absents. Un verrou de volume empêche deux
pods de provisionner le même cache en parallèle. Une fois le marqueur atomique écrit, le bootstrap
repasse `HF_HUB_OFFLINE` et `TRANSFORMERS_OFFLINE` à `1`, puis remplace son processus par le worker.
Les démarrages suivants ne contactent donc pas Hugging Face lorsque le cache est complet. RT-DETR,
qui reste un artefact privé, est copié séparément sur ce volume après validation de son SHA-256.

Cette organisation réduit l'image Docker. Le premier pod attaché à un stockage vide paie encore le
temps de téléchargement ; conserver le volume rempli évite ce coût aux cold starts suivants. Pour un
provisionnement sans GPU facturé, la même commande peut toujours être exécutée auparavant sur un pod
CPU attaché au volume.
L'image destinée au registre public ne contient ni poids, ni checkpoint RT-DETR, ni corpus, ni fichier
`.env`, ni secret. Les snapshots publics et le checkpoint FireWarning privé sont montés au runtime.
Elle conserve un endpoint GPU unique et une session unique par lot. Le coût de lecture du volume et le
risque de disponibilité lié au datacenter du volume restent à mesurer.

Le fichier `deploy/runpod-pod.example.json` documente le pod de recette : port HTTP 8000, file FIFO
à un seul consommateur, volume persistant et authentification Bearer. Le secret est injecté uniquement
dans l'environnement RunPod. La file locale est volontairement limitée à la recette : le backend
reste la source durable des lots et dispatchs et un redémarrage ambigu est placé en dead-letter, jamais
resoumis automatiquement.

Après la recette, le fichier `deploy/runpod-endpoint.example.json` propose pour Serverless
`active_workers=0`, `max_workers=1`,
FlashBoot, scaling par délai de file et un timeout d'inactivité initial de **90 secondes**. Cette valeur
est volontairement inférieure aux 600–900 secondes envisagées dans le cahier des charges : garder un
GPU inactif n'est rentable que si le prochain lot arrive avant le temps/coût d'un nouveau cold start.
Le benchmark doit comparer 60, 90, 120, 300 et 600 secondes avant arbitrage production.

## Provisionnement des modèles

Le bootstrap de l'image exécute automatiquement ce provisionnement lorsque le volume est incomplet.
La même opération peut être anticipée sur une machine d'administration ou un pod CPU ayant accès au
volume :

```bash
python -m pip install -e '.[runtime]'
python scripts/prefetch_models.py \
  --cache-root /runpod-volume/huggingface-cache/hub \
  --roma-root /runpod-volume/firewarning-roma
```

Le provisionneur télécharge Qwen par défaut afin qu'un cache RunPod incomplet n'apparaisse pas comme
prêt. `--skip-qwen` ne sert qu'aux smokes média explicitement incomplets. Il télécharge aussi le
checkpoint AerialExtreMatch-RoMa et DINOv2 dans `FW_ROMA_ROOT`, vérifie taille et SHA-256, puis écrit
un manifeste local. Les poids restent sur le volume et n'entrent ni dans Docker ni dans GitHub.

Vérifier ensuite que les répertoires exacts existent :

```text
/runpod-volume/huggingface-cache/hub/models--openai--whisper-large-v3-turbo/snapshots/41f01f...
/runpod-volume/huggingface-cache/hub/models--microsoft--Florence-2-large-ft/snapshots/4a12a2...
/runpod-volume/huggingface-cache/hub/models--Qwen--Qwen3-4B-Instruct-2507/snapshots/e7974d...
/runpod-volume/huggingface-cache/hub/models--Qwen--Qwen3-VL-4B-Instruct/snapshots/ebb281...
/runpod-volume/firewarning-roma/weights/roma_extre.pth
/runpod-volume/firewarning-roma/weights/dinov2_vitl14_pretrain.pth
```

Le worker utilise `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1` et `local_files_only=True`. Une révision
absente échoue donc immédiatement, sans repli vers `main` ni téléchargement silencieux.

## Variables obligatoires

| Variable | Rôle |
|---|---|
| `FW_ALLOWED_MEDIA_HOSTS` | Liste séparée par virgules des hôtes privés signant les médias |
| `FW_RUN_MODE` | `pod` pendant la recette persistante ; `serverless` seulement après la bascule validée |
| `FW_POD_AUTH_TOKEN` | Secret Bearer d'au moins 32 caractères, requis uniquement en mode `pod` |
| `FW_POD_PORT` | Port HTTP du pod persistant, `8000` par défaut |
| `FW_ENABLE_TRANSFORMERS_RUNTIME` | `true` uniquement dans l'image GPU complète |
| `FW_HF_CACHE_ROOT` | Racine `hub` du cache Hugging Face monté |
| `FW_ROMA_ROOT` | Racine externe des deux poids RoMa vérifiés |
| `FW_AUTO_PREFETCH_MODELS` | `true` par défaut ; télécharge les poids publics épinglés absents avant le worker |
| `FW_MODEL_PREFETCH_LOCK_PATH` | Verrou partagé de provisionnement ; défaut dans la racine du cache monté |
| `FW_ATTENTION_IMPLEMENTATION` | `flash_attention_2`, obligatoire; aucun repli SDPA |
| `FW_ENABLE_SOURCE_RESEARCH` | `true` pour démarrer le courtier et le service Qwen isolé |
| `FW_RESEARCH_RUN_DIRECTORY` | Répertoire privé des sockets Unix, `/run/firewarning` par défaut |
| `FW_RESEARCH_MODEL_TIMEOUT_SECONDS` | Limite d’une recherche Qwen, 840 secondes par défaut |
| `FW_BOOTSTRAP_FAILURE_HOLD_SECONDS` | Durée bornée (0–900 s, 300 par défaut) pendant laquelle `/healthz` conserve l’erreur de bootstrap avant l’arrêt |
| `FW_RTDETR_CHECKPOINT_PATH` | Répertoire contenant `model.safetensors` et la configuration Transformers |
| `FW_RTDETR_CHECKPOINT_SHA256` | SHA-256 exact de `model.safetensors` |

Ne jamais placer une clé RunPod, `FW_POD_AUTH_TOKEN`, un token Hugging Face ou une URL signée dans
l'image ou le dépôt.

## Construction et tests

```bash
python -m pip install -e '.[dev]'
ruff check src tests scripts
ruff format --check src tests scripts
python -m pytest -q
docker build -t firewarning-agent-worker:local .
```

Les tests locaux utilisent des adaptateurs injectés et ne prétendent pas valider CUDA, les poids ou la
qualité des modèles. La recette GPU exige un endpoint de staging et les dix cycles complets décrits dans
`docs/RUNPOD_BENCHMARK.md`.

Le contrat de raccordement, les responsabilités du dispatcher et l'écart exact avec la table de jobs
actuelle sont décrits dans `docs/BACKEND_INTEGRATION.md`.

## Corpus externe et préparation du training

Les médias d'entraînement ne sont jamais copiés dans le dépôt ni dans l'image Docker publique. La
racine locale retenue est `D:\dataset\datasetfire`; elle centralise Pyro-SDIS, le sous-ensemble RGB
utile de FASDD, les candidats Wikimedia et le référentiel officiel commune→massif.

FASDD est acquis uniquement depuis ScienceDB. Les lots CV, RS RGB et UAV ont été contrôlés par taille
et MD5, puis convertis en manifeste COCO normalisé. Les archives combinée, RS RAW et RS SWIR, ainsi que
les représentations YOLO/VOC/TDML redondantes, ne sont pas conservées. La finalisation recalcule des
composantes de séquence avec une empreinte visuelle forte, équilibre les lignes à 70/15/15 et vérifie
le SHA-256 de chaque média avant remplacement atomique du manifeste.

```powershell
python -m training.fasdd_acquisition download --root D:\dataset\datasetfire --lot CV
python -m training.fasdd_acquisition curate --root D:\dataset\datasetfire `
  --lot CV --archive D:\dataset\datasetfire\_staging\fasdd\FASDD_CV.zip `
  --exclude-manifest D:\dataset\datasetfire\corpus\pyro-sdis-v0.1.0\manifest.jsonl `
  --delete-archive
python -m training.fasdd_acquisition finalize --root D:\dataset\datasetfire
```

Le référentiel ANCT téléchargé sur data.gouv est une table d'appartenance des communes aux massifs,
pas une géométrie polygonale. Une jointure point-dans-polygone exigera donc des géométries communales
COG 2021 verrouillées séparément. Les 442 médias Wikimedia restent des candidats : ils ne doivent pas
entrer dans le training ou le test critique avant annotation et double validation.

## Validation ponctuelle sur un pod GPU classique

Le même artefact public peut démarrer en mode `FW_RUN_MODE=pod_validation` pour qualifier un lot
sur un GPU explicitement choisi. Le payload est fourni par
`FW_VALIDATION_PAYLOAD_GZIP_B64` (JSON gzip + base64), jamais copié dans l'image. Le serveur expose
`/health` et `/result` sur `FW_VALIDATION_PORT` (8000 par défaut) et exige
`Authorization: Bearer <FW_VALIDATION_TOKEN>` ; le token doit contenir au moins 32 caractères.

Pour le test privé photo + provenance, les octets normalisés sont injectés séparément dans
`FW_VALIDATION_ASSET_BUNDLE_GZIP_B64` lorsqu'ils tiennent dans la configuration du pod. Pour un lot
plus volumineux, le serveur démarre en état `awaiting_assets` et accepte le même bundle une seule fois
sur `POST /assets`, avec le même Bearer token et une limite stricte de 2 Mio. Le payload conserve des URL HTTPS sur
`validation-assets.internal` : le chemin réel `handle_job` et la validation de la liste blanche sont
donc traversés, tandis qu'un transport strictement limité au lot injecté remplace uniquement le
téléchargement réseau. Ce mécanisme de test n'autorise ni URL locale ni contournement des contrôles
de production. Le payload, les photos et les captures de provenance restent absents de Docker et de
Git.

Ce mode exécute la frontière réelle `handle_job`, publie les versions CUDA/FA2 et les métriques du
worker, puis reste disponible uniquement le temps de récupérer le rapport. Il ne transforme pas un
test en validation humaine : `deployment_ready=false` et `human_validation_required=true` restent
forcés. Le pod doit être arrêté immédiatement après récupération du résultat.

## Deux corpus pour le grounding spatial

Le plan figé dans `../../docs/adr/ADR-004-agent-spatial-point-grounding.md` ne demande plus un détecteur de
feu comme modèle principal. Il compose deux familles indépendantes :

- `fire-pointing-v0.1.0` référence les 155 486 images existantes sans en copier une seule. Les
  213 643 centres bas de boîtes feu/fumée sont uniquement des propositions d'annotation ;
- `cross-view-registration-v0.1.0` contient 390 paires : 264 vues UAV AerialExtreMatch et 126 vues
  rurales/montagneuses ODM. Les splits comptent 288 train, 57 validation et 45 test dans 14 groupes
  spatiaux, sans groupe partagé.

Die–Pontaix et ses identifiants opérationnels sont sur denylist. Aucun média, crop, rendu, LiDAR ou
GLB de cette opération n'est admis dans train ou validation. L'image Docker publique ne contient
aucun de ces corpus.

```powershell
python -m pip install -e ".[spatial-training,dev]"
python training\spatial_training_setup.py build-pointing `
  --dataset-root D:\dataset\datasetfire
python training\spatial_training_setup.py download-registration `
  --dataset-root D:\dataset\datasetfire
python training\spatial_training_setup.py build-registration `
  --dataset-root D:\dataset\datasetfire
python training\spatial_training_setup.py preflight `
  --dataset-root D:\dataset\datasetfire
```

Le téléchargement du recalage exclut les références HQ de 11,67 Go et conserve environ 1,55 Go de
contenu utile. Le recalage utilise maintenant le checkpoint AerialExtreMatch-RoMa officiel à la
révision source `048ab96f84430f3e0f1144f05c94fe1e1f0bca8a`. Les correspondances sont converties en
points 2D–3D via le DSM, puis la pose est estimée par PnP avant tout raycast ; Qwen n'apprend plus le
recalage vue–carte.

```powershell
.\scripts\setup_spatial_registration_roma_cuda13.ps1 `
  -DatasetRoot D:\dataset\datasetfire
```

Le probe réel du 17 juillet 2026 prouve le chargement CUDA 13 et le chemin DSM/PnP avec 4,60 Go de
VRAM de pic et 2,66 Go de RSS. Il échoue toutefois au gate qualité sur la paire tenue à l'écart
(1 220,68 m d'erreur de pose avec normalisation de cap). Le modèle n'est donc pas déployable pour le
recalage spatial : le benchmark validation complet et le lot critique double-validé restent
obligatoires. Ce constat n'empêche pas de valider le pipeline média 1.0, qui ne publie aucun marqueur.

Qwen reste uniquement un futur LoRA `fire_pointing`. Les annotations locales préparées comptent
147 866 lignes train et 32 923 validation ; `training_started=false` et aucune commande n'a lancé
le probe Qwen ou l'optimiseur.
