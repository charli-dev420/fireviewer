# ADR-005 — Analyse IA journalière d'un incident

- **Statut** : accepté pour implémentation
- **Date** : 18 juillet 2026
- **Décideur produit** : projet FireWarning
- **Portée** : satellite, médias, contributions utilisateur, faits opérationnels et rapport
- **Complète** : ADR-004 sans relancer le training ni modifier le modèle 3D

## Contexte

FireWarning doit regrouper, pour un incident et une journée, des images satellites, des médias
externes et des contributions utilisateur. L'analyse doit proposer les points d'activité visibles,
une zone probable d'activité observée, des faits opérationnels sourcés et un rapport éditable pour la
fiche incident.

Le produit connaît déjà l'incident. Le besoin n'est pas de détecter l'existence du feu et encore moins
de prévoir librement sa propagation. Il faut transformer des preuves datées en propositions privées,
traçables et révisables. Le GLB, le LiDAR, le MNT et l'orthophoto restent les référentiels immuables de
la scène. Les résultats IA sont uniquement des calques et des informations ajoutés à cette scène.

Le contrat worker `1.0` reste volontairement limité au lieu de prise de vue et interdit le marqueur du
phénomène. Il ne doit pas être étendu silencieusement. La nouvelle capacité utilise un contrat
parallèle `2.0` et de nouvelles persistances additives.

## Décision

### Une fenêtre d'analyse par incident et période

L'unité métier est une fenêtre d'analyse rattachée à un `fire_id` et un `episode_id`. Le traitement
rétrospectif utilise une fenêtre par journée locale, conservée avec ses bornes UTC et son fuseau.

Une fenêtre peut référencer plusieurs lots techniques. Le regroupement par défaut est de dix éléments
par lot ; la limite défensive du contrat reste de trente-deux éléments et 256 frames. Plusieurs lots
ne créent jamais plusieurs versions publiques concurrentes : ils alimentent la même revue journalière.

### Trois voies d'entrée, une même provenance

Chaque élément conserve une provenance, une licence, une attribution éventuelle, une date de capture
et une référence de preuve.

1. **Satellite** : l'identifiant produit, le fournisseur, l'heure d'acquisition, le CRS, la
   géotransformation, la résolution, l'emprise et les bandes sont obligatoires. La conversion vers la
   carte utilise la géotransformation du produit. Un modèle de langage n'est jamais l'autorité
   géographique de cette voie.
2. **Média externe** : une image ou une frame peut proposer un point dans l'image. Sa projection exige
   une pose caméra admise ou un recalage vue/carte qualifié, puis un raycast déterministe sur le MNT.
3. **Contribution utilisateur** : elle suit le même chemin géométrique qu'un média externe, mais
   l'analyse, la conservation, l'affichage du média et l'affichage spatial restent gouvernés par des
   consentements distincts et révocables.

Un audio ou un article peut fournir des faits, des lieux explicitement cités et des dates. Il ne peut
pas fournir un point géographique précis sans géométrie explicite provenant de la source.

### Points dans la source puis points sur la carte

Le worker `2.0` sépare deux objets :

- une `SourceAnnotationV2`, qui identifie un point normalisé dans une image ou une frame ;
- une `SpatialProposalV2`, qui contient soit un `ground_point` calculé, soit
  `insufficient_geometry` avec au moins un code d'incertitude.

Les ancres v2 sont bornées à :

- `active_fire_point` ;
- `visible_fire_front_point` ;
- `smoke_column_base`.

Il n'existe ni masque génératif obligatoire ni contour de feu produit librement par le modèle. Une
image peut produire plusieurs annotations et plusieurs propositions. Toute proposition cartographique
doit référencer l'annotation source, la méthode de projection, la précision horizontale et l'empreinte
du bundle spatial utilisé.

Les méthodes admises sont :

- `SATELLITE_GEOTRANSFORM` ;
- `CAMERA_RAYCAST` ;
- `CROSS_VIEW_RAYCAST` ;
- `EXPLICIT_SOURCE_GEOMETRY`.

Une coordonnée sans cette chaîne de preuve est invalide. La position EXIF de la caméra n'est jamais
la position du feu.

### Zone probable d'activité observée

Le worker ne crée pas de zone finale. Après validation stricte du contrat, le backend agrège :

- les points proposés et leurs rayons d'incertitude ;
- les géométries des produits satellites ;
- les révisions antérieures explicitement sélectionnées ;
- les corrections humaines.

Cette agrégation produit un brouillon de `ActiveFireZoneRevision`. La géométrie est une observation
datée, pas une prévision. Toute fusion est déterministe et crée une nouvelle révision ; elle ne modifie
jamais une révision existante.

### Faits opérationnels

Une `FactProposalV2` contient exactement une valeur typée : nombre, texte ou booléen. Une unité n'est
admise que pour un nombre. Chaque fait référence l'élément, la preuve, l'heure de validité et l'une des
certitudes fermées suivantes : directement visible, explicitement écrit ou explicitement prononcé.

Les catégories initiales couvrent :

- activité du feu et surface ;
- moyens humains, terrestres et aériens ;
- évacuations et confinements ;
- accès et routes ;
- infrastructures ;
- météo explicitement sourcée ;
- autres faits conservés pour revue.

Deux valeurs contradictoires ne sont pas fusionnées silencieusement. Elles peuvent partager un groupe
de conflit et restent séparées jusqu'à la décision humaine.

### Rapport de situation

Le worker peut fournir un `SituationReportDraftV2`. Ses sections référencent uniquement des identifiants
de faits présents dans la même sortie. Une section de limites peut à la place porter un code de base
explicite, par exemple une pose caméra absente, sans inventer un fait. Le backend rejettera
ultérieurement toute affirmation chiffrée qui ne peut pas être reliée à un fait validé.

Les sections prévues sont : situation, activité observée, zone probable, moyens engagés, impacts,
sources et fraîcheur, limites.

Le rapport est un brouillon privé. `public_note`, limité à une note courte, et
`IncidentPublicReport`, réservé aux demandes de correction du public, ne sont jamais détournés pour
le stocker.

### Modèles et rôle de RT-DETR

Le chemin GPU reste séquentiel et compatible avec un pod de 16 Go : Whisper, filtrage visuel
facultatif, Florence, Qwen, recalage cross-view lorsque nécessaire, puis nettoyage CUDA entre chaque
famille.

RT-DETR n'est plus un détecteur de présence du feu et son checkpoint privé n'est pas un gate du
contrat v2. Son rôle éventuel est `visual_filtering` : choix de frames ou repérage de véhicules,
aéronefs et personnes. Florence assiste le grounding. Qwen extrait les ancres et les faits dans un
JSON fermé. RoMa/DINOv2 ne peut proposer un recalage exploitable qu'après réussite de son benchmark.

Le training Qwen et tout fine-tuning restent hors de cette évolution. Un incident actif sert
uniquement à l'inférence privée et reste interdit dans train et validation.

### Validation humaine et publication en situation opérationnelle

Toutes les sorties v2 portent `requires_human_review=true`. Le dispatcher persiste des propositions ;
il ne crée jamais seul une publication.

L'opérateur ne suit pas un workflow administratif en plusieurs écrans. Depuis l'unique fiche de
l'incident, la dernière analyse disponible est déjà ouverte et préremplie : scène 3D, calque proposé,
faits utiles et rapport. Les sources et les détails techniques sont repliés par défaut et restent
accessibles à la demande.

Le parcours nominal tient en trois gestes :

1. vérifier visuellement la mise à jour proposée ;
2. corriger directement un point, une zone, un fait ou le texte si nécessaire ;
3. utiliser l'action principale `Valider et publier la mise à jour`.

Un enregistrement de brouillon reste disponible sans imposer d'étape supplémentaire. Le rejet d'un
élément est une action locale depuis cet élément, pas une page dédiée. Les décisions détaillées sont
conservées côté backend pour la traçabilité mais ne deviennent ni des formulaires ni des validations
séquentielles. L'action principale est idempotente, reprend après une coupure réseau et ne perd pas les
corrections déjà saisies. Aucun brouillon, résultat partiel ou objet rejeté ne devient public.

## Stratégie de compatibilité

- Les contrats `WorkerInput` et `WorkerOutput` v1 restent inchangés.
- Les nouveaux objets portent tous le suffixe `V2` pendant le raccordement.
- Le dispatcher choisit le validateur à partir de `schema_version` sans repli silencieux.
- La recette utilise un pod RunPod persistant avec une file HTTP authentifiée et un seul consommateur.
- Le transport Serverless reste présent mais inactif jusqu'à la réussite des gates GPU.
- Le worker v1 ne reçoit aucune référence spatiale v2.
- Le worker v2 n'écrit pas dans la table historique `job`.
- Les migrations de persistance sont additives et ne détournent pas la table historique `job`.

## Gates d'implémentation

| Gate | Condition |
| --- | --- |
| `contract_ready` | schémas backend et worker acceptent les mêmes exemples et rejettent les mêmes violations critiques |
| `persistence_ready` | propositions, faits, rapports et fenêtres sont persistés sans détourner `job` |
| `local_flow_ready` | un lot simulé produit une revue privée complète sans GPU |
| `worker_flow_ready` | le worker réel traite les trois voies et respecte les abstentions |
| `admin_review_ready` | une page incident préremplie permet de corriger puis valider et publier en une action idempotente |
| `public_projection_ready` | seules les révisions approuvées sont visibles dans la fiche et la scène 3D |
| `runpod_ready` | dix cycles réels valident cold start, timeout, annulation, échec partiel et budget 16 Go |

## Conséquences

- Le rapport complet devient un objet versionné ; il ne tient plus dans une note libre de 500
  caractères.
- Plusieurs points peuvent provenir du même média, ce qui exigera une migration de la contrainte
  actuelle sur `IncidentSpatialMarker`.
- Le retrait de consentement doit invalider les propositions dépendantes et bloquer leur publication.
- Les gros référentiels spatiaux restent sur stockage privé. Le contrat transporte des URL signées et
  des SHA-256, jamais les données dans Docker ou GitHub.
- Le recalage actuellement mesuré à 1,22 km reste non déployable pour produire un point précis, mais
  ne bloque pas l'extraction factuelle, la transcription ou la préparation d'un rapport privé.
