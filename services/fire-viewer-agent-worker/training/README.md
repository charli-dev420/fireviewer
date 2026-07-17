# Corpus et entraînement RT-DETR FireWarning

Le corpus est privé par défaut et reste sous `data/corpus/`, répertoire ignoré par Git et exclu de
l'image Docker publique. Le dépôt ne versionne que les contrats, les outils reproductibles, les
révisions des sources et les rapports sans média.

## Base retenue

La première strate reproductible est `pyronear/pyro-sdis` à la révision
`a1e553ec4d806f71fc6db744cc22bc3469487382` : 33 636 images françaises, dont 28 103 avec fumée,
licence Apache-2.0. La répartition d'origine n'est pas utilisée. FireWarning recalcule les splits en
tenant une caméra entière dans un seul sous-ensemble afin d'éviter que son arrière-plan fixe fuite
vers le test.

FASDD V9 est approuvé comme extension feu/fumée/négatifs, mais n'est pas téléchargé automatiquement :
la publication officielle représente environ 82,1 Go et est sous CC BY-SA 4.0. Son ajout doit passer
par l'archive officielle et conserver cette licence. Les miroirs qui annoncent une autre licence ne
sont pas des sources d'autorité.

Les classes `firefighting_aircraft_visible` et `fire_response_vehicle_visible` nécessitent un lot
curaté et doublement validé. Un aéronef ou un camion générique ne doit jamais être remappé
automatiquement vers ces classes métier.

## Lots additionnels et paires feu/massif

`corpus/wikimedia_lots.json` définit sept acquisitions candidates : incendie 2025 du massif des
Corbières, aéronefs de lutte français, véhicules DFCI, autres véhicules de pompiers français et feux
de forêt français de 2021, 2022 et 2023. Chaque
fichier passe par l'API Wikimedia officielle et sa propre licence. Seuls CC0, domaine public,
CC BY et CC BY-SA sont acceptés ; l'URL de licence, l'auteur, le crédit, la page descriptive et le
SHA-1 original sont conservés. Le collecteur demande une miniature de 2 048 px et conserve les
dimensions réellement servies : l'API peut retourner une miniature pré-générée plus grande. La
copie locale est adressée par SHA-256 et n'entre pas dans l'image Docker.

```powershell
.\.venv\Scripts\python.exe -m training.wikimedia_corpus `
  --output data\corpus\firewarning-wikimedia-candidates-v0.1.0
```

Le collecteur attend entre les téléchargements et respecte `Retry-After`. La reprise acquiert les
nouveaux titres ajoutés au catalogue et retente les erreurs transitoires ; les licences et les formats
déjà refusés restent en quarantaine :

```powershell
.\.venv\Scripts\python.exe -m training.wikimedia_corpus `
  --output data\corpus\firewarning-wikimedia-candidates-v0.1.0 `
  --resume
```

Ces lignes ont le rôle `annotation_candidate` ou `geo_context_evaluation`, sans boîte et sans label
négatif. Elles ne sont donc pas consommables par l'entraînement. Il faut dessiner les boîtes,
effectuer une double validation, regrouper les séries d'un même événement et promouvoir
explicitement les lignes retenues vers `detector_training`.

Le rapport reproductible `corpus/wikimedia-acquisition-report.json` décrit le dernier passage local
complet : 442 fichiers vérifiés, 152 paires dotées d'un contexte de localisation et 380 candidats à
annoter. Il confirme aussi `training_rows=0` ; ces nombres ne constituent donc pas une annonce de
corpus prêt à entraîner.

Pour le lot Corbières, le couple image/massif vient de la catégorie d'événement source. Il exprime
une précision `massif`, pas les coordonnées exactes de la caméra ou du front de feu. Si Wikimedia
fournit une coordonnée structurée pour un fichier, elle est conservée comme point avec sa page en
référence. La ressource officielle `Les périmètres de massifs` est épinglée au COG 2021 et réduite
aux 8 617 communes rattachées à l'un des neuf massifs. Elle est une table d'appartenance communale,
pas une géométrie autonome : toute jointure point-dans-polygone exigera donc une géométrie communale
COG 2021 épinglée séparément. Le zonage IGN `DÉBROUSSAILLEMENT` reste une autre couche de contexte.
Ces références ne doivent jamais servir à fabriquer une localisation à partir du contenu visuel seul.

## Construire la strate Pyro-SDIS

Depuis `services/fire-viewer-agent-worker` :

```powershell
.\.venv\Scripts\python.exe -m pip install -e ".[corpus,dev]"
.\.venv\Scripts\python.exe training\corpus_pipeline.py ingest-pyro-sdis `
  --output data\corpus\firewarning-v0.1.0 `
  --cache data\huggingface-cache
```

L'ingestion reprend un `manifest.partial.jsonl` après interruption, supprime les doublons SHA-256,
calcule un pHash, signale les quasi-doublons, préserve les images négatives sans boîte et produit
`quality-report.json`. Le manifeste final est adressé par contenu. Un smoke test isolé peut utiliser
`--max-rows 10`; ne jamais mélanger cette sortie limitée au répertoire du corpus complet.

Avant finalisation, les groupes caméra reliés par quasi-doublons pHash sont fusionnés en composantes
et chaque composante reçoit un split unique. Pour réconcilier un manifeste produit par une version
antérieure :

```powershell
.\.venv\Scripts\python.exe training\corpus_pipeline.py reconcile-splits `
  --manifest data\corpus\firewarning-v0.1.0\manifest.jsonl
```

Vérification complète des octets :

```powershell
.\.venv\Scripts\python.exe training\corpus_pipeline.py validate `
  --manifest data\corpus\firewarning-v0.1.0\manifest.jsonl `
  --verify-files
```

## Deux profils, deux gates distincts

Le RT-DETR du worker n'établit jamais que le feu est présent : l'incident et la présence du feu sont
déjà connus. Il sert uniquement à classer et prioriser les images ou frames qui méritent le grounding
Florence, sans éliminer tout le contexte temporel ou géographique.

Le profil courant `media_filter_v1` ne conserve que `smoke_visible` et `flame_visible`. Il peut être
entraîné dès que `training_ready` est vrai. Le profil futur `operational_four_class_v1` ajoute
`firefighting_aircraft_visible` et `fire_response_vehicle_visible`; son readiness reste exposé par
`four_class_training_ready` dans les rapports de corpus.

Pour chaque profil, `training_ready` exige au minimum :

- les classes du profil présentes dans `train` et `validation` ;
- des négatifs conservés ;
- aucune fuite de `split_group` ;
- des licences ou consentements d'entraînement explicites ;
- la revue des quasi-doublons traversant plusieurs domaines.

`deployment_ready` ajoute le lot `detector_critical_test`, qui doit être doublement validé et couvrir
les classes du profil ainsi que des négatifs. Ce gate bloque la promotion du checkpoint vers le
worker public, pas le démarrage de l'entraînement. Il doit notamment couvrir faux positifs, nuit,
vidéos mobiles et données françaises.

La strate Pyro-SDIS seule ne couvre que `smoke_visible`. La combinaison locale avec FASDD apporte
également `flame_visible`; elle rend donc le profil `media_filter_v1` entraînable, sous réserve du
préflight exact des manifestes. Elle ne rend pas le checkpoint déployable tant que le test critique
double-validé manque.

Le passage local consigné dans `corpus/pyro-sdis-ingestion-report.json` contient 32 594 images
uniques issues des 33 636 lignes épinglées, 31 129 boîtes fumée et 5 320 négatifs. Quatre composantes
de groupes reliés par pHash ont été réaffectées pour ramener les quasi-doublons inter-splits de 58 à
zéro. Le profil quatre classes reste volontairement bloqué sur les classes véhicule et aéronef. Le
profil filtre média n'est plus bloqué par ces classes hors périmètre ; son déploiement reste bloqué
par l'absence de test critique doublement validé.

## Préflight et entraînement RT-DETRv2-R18

Le modèle de base est épinglé à `PekingU/rtdetr_v2_r18vd` au commit
`5650961749fa93567c0d46fc7f43ea4f9e914107`. Le préflight relit les octets, fusionne les manifestes,
refuse les doublons inter-manifestes, les fuites de groupe, une classe absente de `train` ou
`validation` et l'absence de négatifs. Par défaut, il vérifie le profil `media_filter_v1` et le gate
`training_ready` :

```powershell
.\.venv\Scripts\python.exe -m training.train_rtdetr preflight `
  --profile media_filter_v1 `
  --manifest D:\dataset\datasetfire\corpus\fasdd\manifest.jsonl `
  --manifest D:\dataset\datasetfire\corpus\pyro-sdis-v0.1.0\manifest.jsonl
```

Avant toute promotion vers le worker, le même préflight doit imposer le test critique :

```powershell
.\.venv\Scripts\python.exe -m training.train_rtdetr preflight `
  --profile media_filter_v1 `
  --require-deployment-ready `
  --manifest D:\dataset\datasetfire\corpus\fasdd\manifest.jsonl `
  --manifest D:\dataset\datasetfire\corpus\pyro-sdis-v0.1.0\manifest.jsonl
```

L'entraînement ne possède pas d'option de contournement du gate. Les réglages par défaut ciblent un
GPU Ada 16 Go : RT-DETRv2-R18, carré 640 px, lot 2, accumulation 8, gradient checkpointing, BF16 si
le GPU le supporte sinon FP16, TF32 et AdamW fusionné. FlashAttention 2 reste obligatoire pour Qwen
dans le worker ; RT-DETR utilise ici ses couches de détection natives et aucune activation SDPA
explicite n'est ajoutée.

```powershell
.\.venv\Scripts\python.exe -m training.train_rtdetr train `
  --profile media_filter_v1 `
  --manifest D:\dataset\datasetfire\corpus\fasdd\manifest.jsonl `
  --manifest D:\dataset\datasetfire\corpus\pyro-sdis-v0.1.0\manifest.jsonl `
  --output D:\dataset\datasetfire\training\rtdetr-v2-r18-media-filter-v1
```

La sortie contient `training-provenance.json`, les métriques par split,
`model.safetensors.sha256` et les deux valeurs exactes à fournir au worker :
`FW_RTDETR_CHECKPOINT_PATH` et `FW_RTDETR_CHECKPOINT_SHA256`.

## Grounding spatial : deux familles, aucun incident actif

Le corpus de grounding est distinct du filtre RT-DETR. Son contrat est figé par
`../../../docs/adr/ADR-004-agent-spatial-point-grounding.md` :

1. `fire_pointing` pourra adapter Qwen pour un point pixel ou une abstention dans les images
   incendie ;
2. `cross_view_registration` évalue d'abord AerialExtreMatch-RoMa pour établir des correspondances
   vue/carte ;
3. le raycast MNT transforme ensuite le pixel en point métrique de façon déterministe.

Le setup local réutilise FASDD, Pyro-SDIS et Wikimedia par chemin + SHA-256. Il ne duplique donc
aucun média. Le lot de recalage retenu est la révision
`b70225c2fd468976d5f9fc9bf435645da4184492` de
`Xecades/AerialExtreMatch-Localization` : seuls `rgb`, `LQref`, poses et intrinsics sont acquis. Les
deux GeoTIFF HQ totalisant 11,67 Go sont exclus.

Les commandes reproductibles sont :

```powershell
python training\spatial_training_setup.py build-pointing `
  --dataset-root D:\dataset\datasetfire
python training\spatial_training_setup.py download-registration `
  --dataset-root D:\dataset\datasetfire
python training\spatial_training_setup.py build-registration `
  --dataset-root D:\dataset\datasetfire
python training\spatial_training_setup.py preflight `
  --dataset-root D:\dataset\datasetfire
```

Le préflight refuse les tokens opérationnels Die–Pontaix avant lecture des sources. Une zone active
ne peut entrer dans train/validation, même sous forme synthétique. Le passage construit du 16 juillet
2026 donne :

| Famille | Contenu construit | État réel |
| --- | --- | --- |
| `fire_pointing` | 147 866 annotations train, 32 923 validation, labels faibles, zéro média copié | bootstrap préparable, pas production |
| `cross_view_registration` | 390 paires, 3 domaines, 14 groupes spatiaux sans fuite | `training_ready`, pas `deployment_ready` |

### Corpus opérationnel Die–Pontaix hors entraînement

Le lot `die-pontaix-operational-evaluation-v0.1.0` est volontairement séparé des deux familles de
training. Il regroupe les acquisitions publiques EMSR890 des 5, 7, 8, 9, 10 et 11 juillet 2026.
Chaque journée contient exactement dix éléments : cinq vues NASA Worldview, la carte Copernicus en
PDF et PNG, la géométrie officielle, les métadonnées du produit et une référence signée vers le
package 3D FireViewer. Le package de 401 Mo n'est pas dupliqué et les ZIP Copernicus sont supprimés
après extraction des seuls fichiers utiles.

```powershell
python -m training.die_operational_corpus plan
python -m training.die_operational_corpus build `
  --dataset-root D:\dataset\datasetfire
```

Le build rejette les tuiles NASA vides/noires et sélectionne alors une composition VIIRS NOAA-20
ou NOAA-21 avec anomalies thermiques. Une reconstruction contrôlée utilise `--replace` et ne
supprime l'ancienne révision qu'après construction complète de la nouvelle.

Le manifeste et les payloads journaliers portent sans exception `training_membership=false`. Les
sources NASA/CEMS sont redistribuables avec attribution, mais les résultats des modèles restent non
publiés et non fusionnables avant validation humaine. Ce corpus journalier ne télécharge aucune photo
de presse ou du Web sans licence de redistribution production vérifiée.

### Lot privé photo + capture de provenance pour le déploiement de test

Le lot `die-pontaix-ground-photo-pipeline-evaluation-v0.1.0` est un banc d'inférence privé, pas un
corpus d'entraînement. Il contient cinq paires explicitement fournies par l'utilisateur : une photo
propre et la capture qui rend visibles sa source, son auteur ou sa date lorsqu'ils sont disponibles.
Les doublons exacts sont rejetés et les âges relatifs affichés par un réseau social ne sont jamais
convertis en date de prise de vue.

Le build produit dix éléments, un payload compressé et un bundle d'actifs compressé sous
`D:\dataset\datasetfire\corpus`, sans modifier les originaux. Les copies de test sont plafonnées à
1024 px. Tous les éléments portent `training_membership=false`; les sources ne sont pas déclarées
redistribuables et les sorties ne deviennent publiables ou fusionnables qu'après validation humaine
dans l'espace admin.

```powershell
python -m training.die_photo_evaluation `
  --dataset-root D:\dataset\datasetfire `
  --source-root D:\dataset\datasetfire\incoming\die-pontaix-ground-photo-evaluation-v0.1.0
```

Le recalage ne possède volontairement aucune commande `train`. Le checkpoint officiel doit d'abord
passer le benchmark tenu à l'écart et le futur lot critique double-validé :

```powershell
.\scripts\setup_spatial_registration_roma_cuda13.ps1 `
  -DatasetRoot D:\dataset\datasetfire
```

Le script installe le code MIT à la révision
`048ab96f84430f3e0f1144f05c94fe1e1f0bca8a`, vérifie les SHA-256 du checkpoint RoMa et du backbone
DINOv2, exécute un vrai passage GPU puis s'arrête. Le probe observé utilise 4 599 887 360 octets de
VRAM et environ 2,66 Go de RSS. Le runtime passe, mais le gate qualité échoue sur l'échantillon tenu
à l'écart : 1 220,68 m d'erreur de centre caméra et 8 inliers PnP. Aucune qualité production n'est
donc revendiquée et aucun fine-tuning n'est autorisé à ce stade.

Le training Qwen reste séparé et gelé : `spatial_train_qwen.py prepare` n'exporte plus que
`fire-pointing-{train,validation}.jsonl`; le plan contient `training_started=false` et la commande
réelle exige toujours `--confirm-training`. FLAME 3 reste enregistré comme extension historique feu
+ thermique géoréférencée ; il n'est pas téléchargé silencieusement.
