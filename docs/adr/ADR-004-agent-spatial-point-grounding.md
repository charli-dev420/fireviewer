# ADR-004 — Grounding ponctuel des prises de vue sur le terrain LiDAR

- **Statut** : accepté et figé pour le setup v1
- **Date** : 16 juillet 2026
- **Décideur produit** : projet FireWarning
- **Portée** : corpus, entraînement et proposition de calques privés issus des médias
- **Complète** : ADR-002 et ADR-003 sans modifier leurs repères
- **Complétée par** : ADR-005 pour le contrat worker v2, les faits et le rapport d'incident

## Contexte

FireWarning connaît déjà l'incident et dispose, pour une zone préparée, d'un MNT LiDAR, d'une
orthophoto et d'un modèle 3D géoréférencés. Le besoin n'est donc ni de détecter l'existence du feu,
ni de demander à un modèle de langage d'inventer une longitude et une latitude. Le besoin est de
repérer, dans une prise de vue, le pixel qui correspond au point d'ancrage observable du phénomène,
puis de le projeter sur le terrain de référence.

Le livrable reste un calque privé ajouté au modèle 3D immuable : marqueur ponctuel, ensemble de
points ou géométrie dérivée. Il ne remplace jamais le GLB, le LiDAR, l'orthophoto ou la révision de
zone existante.

## Décision

### Deux familles indépendantes, réunies seulement à l'inférence

Le corpus n'est pas un manifeste unique de triplets artificiellement complets. Il contient deux
familles versionnées et évaluées séparément :

1. `fire_pointing` réutilise les images incendie autorisées. Sa vérité terrain est un point dans la
   prise de vue source, exprimé en coordonnées pixel normalisées, ou une abstention explicite. Une
   boîte feu/fumée existante ne fournit qu'une pré-annotation faible ; son centre bas ne devient
   jamais une vérité terrain sans validation humaine ;
2. `cross_view_registration` relie une prise de vue géoréférencée à une carte, une orthophoto ou un
   rendu de terrain correspondant, avec pose, intrinsics et coordonnées métriques lorsque la source
   les fournit. Cette famille ne contient pas nécessairement de feu.

La première famille apprend **où regarder dans l'image incendie**. La seconde apprend **comment
recaler une vue sur un référentiel cartographique**. Elles ne sont jointes que dans le pipeline
d'inférence : pixel proposé + pose ou recalage + intersection déterministe avec le MNT LiDAR.

Les vues cartographiques dérivées sont petites et hashées. Les gros MNT, MNS, orthophotos et GLB ne
sont pas dupliqués : un registre séparé conserve leur URI, SHA-256, résolution, licence et système de
coordonnées.

### Exclusion absolue des incidents opérationnels en cours

Les médias, cartes, LiDAR, GLB et propositions d'une zone FireWarning active sont interdits dans
`train` et `validation`, y compris sous forme de crop, rendu, augmentation ou dérivé synthétique.
Le package `fireviewer-die-pontaix-r1-v4` et tous ses successeurs de la même opération sont placés sur
une denylist du préflight.

Une zone opérationnelle sert uniquement à l'inférence privée. Après clôture, conservation autorisée,
purge des données non consenties et décision humaine explicite, une révision gelée peut éventuellement
devenir un lot d'acceptation hors entraînement. Elle ne peut jamais être promue silencieusement vers
le train ou la validation.

### Séparation entre apprentissage et géométrie

Le modèle apprend exclusivement à produire un objet fermé contenant :

- `status` : `ground_point` ou `insufficient_geometry` ;
- `semantic_anchor` : base du feu, base de la colonne de fumée, front visible, véhicule ou aéronef ;
- `source_pixel_normalized` ;
- `map_pixel_normalized` pour le profil cross-view ;
- une confiance et des codes d'incertitude bornés.

Les coordonnées Lambert-93, NGF, WGS84, ENU ou glTF ne sont jamais des cibles génératives. Elles
restent dans le manifeste pour la vérification et les métriques seulement. Leur calcul appartient au
moteur spatial déterministe.

Pour un pixel `(u, v)`, une caméra calibrée et sa pose :

```text
direction_camera = inverse(K) * [u, v, 1]
direction_world  = R_camera_to_world * direction_camera
rayon(t)         = camera_position_l93_ngf + t * direction_world
point_l93_ngf    = intersection(rayon, MNT_LiDAR)
```

Le MNT est la surface normative du sol. Le MNS et les classes LiDAR peuvent documenter canopée,
bâtiments et obstacles, mais ne remplacent jamais implicitement le MNT pour l'ancrage au sol. Pour
une fumée, l'annotation vise la base observable de la colonne. Si elle ne peut pas être établie, la
bonne sortie est `insufficient_geometry`.

### Modèles et entraînement v1

Les deux familles n'utilisent plus le même modèle :

- `fire_pointing` conserve `Qwen/Qwen3-VL-4B-Instruct` à la révision immuable
  `ebb281ec70b05090aa6165b016eac8ec08e71b17` ; son adaptation future est un LoRA BF16, sans NF4,
  avec encodeur visuel gelé au premier pilote. Le training local cible CUDA 13/SM120, utilise
  l'attention `eager`, limite la VRAM à 14 Go et la RAM hôte à 10 Go ;
- `cross_view_registration` utilise d'abord le checkpoint officiel AerialExtreMatch-RoMa v1.0.0,
  code MIT à la révision `048ab96f84430f3e0f1144f05c94fe1e1f0bca8a`, avec DINOv2 ViT-L/14
  Apache-2.0. Il produit des correspondances denses, pas des coordonnées géographiques ;
- les pixels de carte sont convertis en points 3D par le DSM/LiDAR, une pose caméra est estimée par
  PnP/RANSAC, puis le pixel pointing est projeté par raycast déterministe ;
- aucun entraînement RoMa n'est autorisé avant l'échec mesuré du checkpoint officiel sur le
  benchmark complet et la disponibilité du lot critique double-validé ;
- Florence-2 reste un auxiliaire de pré-annotation et de grounding, pas l'autorité géométrique ;
- le worker RunPod cible Ada ou similaire, 16 Go de VRAM et FlashAttention 2 pour Qwen runtime ; le
  chemin local Blackwell d'entraînement n'est pas injecté dans cette image ;
- checkpoints, adapters, datasets et caches sont exclus de Docker et de GitHub. Ils sont vérifiés
  par SHA-256 sur un volume externe avant chargement hors-ligne.

Le setup RoMa ne contient aucune commande d'entraînement. Le setup Qwen peut préparer les
annotations et le plan, mais le probe et le run réel restent séparés et le run exige
`--confirm-training`.

### Gates figés

Le setup distingue quatre états :

| Gate | Condition minimale |
| --- | --- |
| `setup_ready` | deux arborescences, deux schémas et denylist opérationnelle créés sans gros média dupliqué |
| `pointing_smoke_ready` | au moins 8 positifs et 4 abstentions double-validés, répartis entre train et validation |
| `registration_smoke_ready` | au moins 8 paires train et 4 validation, avec pose/intrinsics et aucune zone opérationnelle |
| `pointing_training_ready` | le corpus pointing passe ses gates et le run reste explicitement confirmé |
| `registration_benchmark_ready` | checkpoint RoMa, DSM et 390 paires vérifiés, sans fuite spatiale |
| `deployment_ready` | deux lots critiques séparés, double-validés, restent hors entraînement |

Ces volumes sont des minima de pipeline, pas une preuve de qualité. La promotion de l'adapter exige
en plus, sur le lot critique :

- 100 % de sorties conformes au schéma ;
- aucun point précis produit pour un exemple `insufficient_geometry` ;
- rappel d'abstention supérieur ou égal à 95 % ;
- erreur horizontale médiane inférieure ou égale à 20 m et P95 inférieure ou égale à 75 m pour les
  points dont la pose et la surface permettent une vérité terrain ;
- validation humaine de chaque proposition avant toute fusion ou publication.

Les seuils géométriques pourront être durcis dans une nouvelle ADR après mesure. Ils ne peuvent pas
être assouplis silencieusement dans un script d'entraînement.

## Flux d'intégration

```text
image incendie ------> Qwen LoRA pointing ------> point pixel ou abstention
                                                  |
vue + orthophoto ----> AEM-RoMa -> DSM -> PnP ----+
                                                  |
                                                  v
                                  raycast MNT / géométrie déterministe
                |
                v
coordonnée L93/NGF -> ENU -> glTF et WGS84 dérivé
                |
                v
proposition de calque privée
                |
                v
édition, fusion et validation humaine dans l'Admin
```

Le worker n'écrit jamais directement une zone active et ne publie rien. Une future évolution du
contrat worker devra créer une proposition de revue dédiée ; elle ne détournera ni le champ historique
`observed_phenomenon_marker`, actuellement interdit, ni la table historique des jobs.

## Conséquences et limites

- Le corpus RT-DETR existant reste un corpus de filtrage média distinct.
- Les paires image/massif sans pose ou correspondance cartographique restent des candidats de
  contexte ; elles ne deviennent pas automatiquement des vérités terrain ponctuelles.
- Une coordonnée EXIF de prise de vue n'est pas le point du feu.
- Une position sur carte sans provenance, révision spatiale et double validation ne peut pas entrer
  dans le lot critique.
- Un corpus générique de recalage n'est pas une preuve de qualité sur les massifs français ; il
  initialise le modèle avant une évaluation hors entraînement sur des zones closes et autorisées.
- Le probe GPU du 17 juillet 2026 prouve le chargement local et le chemin correspondances -> DSM ->
  PnP sous les budgets (4,60 Go VRAM, environ 2,66 Go RSS), mais échoue au gate qualité de la paire
  tenue à l'écart avec 1 220,68 m d'erreur de centre caméra. RoMa n'est donc pas déployable pour le
  recalage spatial tant que le benchmark complet n'est pas résolu.
- Le contrat worker 1.0 reste inchangé : il ne fabrique pas de marqueur de phénomène. Une évolution
  dédiée devra transporter la référence cartographique/DSM signée et créer une proposition privée
  de revue sans détourner la table de jobs historique.
