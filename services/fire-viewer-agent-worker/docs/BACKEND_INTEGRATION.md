# Raccordement au backend FireWarning

## Frontière retenue

Le navigateur ne contacte jamais RunPod. Le backend CPU est l'unique client de l'endpoint et reste
responsable de l'incident, des consentements, de la collecte, du prétraitement, du stockage temporaire,
des décisions humaines et de la publication.

```text
contribution ou collecte
  -> validation consentement/licence
  -> antivirus, EXIF, FFprobe, OCR, frames, audio, déduplication
  -> fichiers de travail privés + URLs HTTPS signées
  -> batch et dispatch dédiés persistés
  -> transport RunPod sélectionné par configuration
     -> recette : pod persistant /v1/jobs
     -> production future : Serverless /run
  -> polling et persistance immédiate du résultat
  -> validation déterministe backend
  -> tâche de revue humaine
  -> publication séparée et auditée
```

## Contrat backend implémenté

La table historique `job` reste réservée au terrain et à la publication d'assets. L'analyse média
utilise exclusivement `agent_media_batch`, `agent_media_item`, `agent_media_consent`,
`agent_dispatch`, `agent_model_run`, `agent_dead_letter` et `agent_review_task`.

L'API privée `/api/v2/admin/agent-batches` crée un lot idempotent, persiste les preuves de
consentement, l'enfile et permet le retrait par élément. Le retrait avance la purge, demande
l'annulation distante si nécessaire et le dispatcher efface les références privées et résultats
dérivés arrivés à rétention. Le stockage qui émet les URL HTTPS privées reste responsable de la
suppression physique par sa propre politique de cycle de vie.

Le binaire `fire-viewer-agent-dispatcher` prend un lease atomique. En recette il appelle uniquement
`POST /v1/jobs`, `GET /v1/jobs/{id}` et `POST /v1/jobs/{id}/cancel` sur le proxy HTTPS du pod,
avec un Bearer dédié. Après bascule explicite, le transport Serverless utilise `/run`, `/status/{id}`
et `/cancel/{id}`. Les deux transports renvoient les mêmes états. Le dispatcher valide strictement
les identifiants, fenêtres d'analyse, révisions de modèles et liens de preuve avant de créer une tâche
de revue. Il ne modifie aucun incident public.

## Pod persistant de recette

Le pod démarre avec `FW_RUN_MODE=pod`, expose `8000/http` et monte son volume sur
`/runpod-volume`. `FW_POD_AUTH_TOKEN` contient au moins 32 caractères et n'est partagé qu'entre le
backend et le pod. La file HTTP n'exécute qu'un lot à la fois afin de respecter le déchargement
séquentiel des modèles et le plafond VRAM. `/healthz` ne révèle que l'état du processus.

Le backend utilise `FV_AGENT_RUNPOD_TRANSPORT=pod`, l'URL HTTPS du proxy RunPod et le même token.
Il ne faut pas activer le dispatcher avant que le pod soit sain et son cache de poids verrouillé
complet. Le pod est arrêté après les essais ; son volume est conservé pour éviter de repayer le
provisionnement des poids lors du test suivant.

## Appel RunPod Serverless futur

Après validation du pod, utiliser l'API asynchrone `/run`, jamais un appel synchrone long. Le secret RunPod reste dans le
gestionnaire de secrets backend. Le `batch_id` est stable et l'empreinte canonique du payload est
persistée avant soumission. Un même `batch_id` avec un payload différent est rejeté. L'état
`SUBMITTING` est committé avant le POST : si sa réponse est ambiguë ou si le processus s'arrête après
cette barrière, le dispatch va en dead-letter et n'est jamais resoumis automatiquement.

Le TTL RunPod commence à la soumission et couvre file + exécution. Pour la contrainte utilisateur d'une
heure, la valeur initiale proposée est 3 600 secondes, avec une échéance métier `deadline_at` plus
stricte côté backend. Les résultats asynchrones RunPod ayant une rétention limitée, le reconciler doit
les persister dès leur disponibilité et ne jamais considérer RunPod comme stockage durable.

## Validation en retour

Le backend doit revalider le JSON contre la même version de schéma avant toute écriture métier, puis :

1. vérifier que `batch_id`, `input_id`, modèle et révision correspondent au batch soumis ;
2. vérifier que chaque preuve référencée appartient à l'élément ;
3. conserver la sortie comme donnée privée non publiée ;
4. créer une tâche humaine en cas de résultat, divergence ou échec partiel ;
5. n'autoriser qu'un marqueur de prise de vue issu d'une origine déjà admise ;
6. ignorer toute tentative de géométrie ou de prévision, même si un futur worker l'ajoutait ;
7. auditer séparément toute décision humaine et toute publication.

Les livrables spatiaux sont des calques rattachés à la scène 3D courante : marqueurs et révisions
WGS84 de la zone active. Le dispatcher ne génère, ne remplace et ne republie jamais le GLB ou le
`ModelAsset`. La fusion porte uniquement sur les géométries de calque et produit une nouvelle
révision privée soumise à validation humaine.

La panne d'une étape ne relance pas automatiquement les étapes déjà validées. Un résultat partiel
valide crée une tâche humaine ; un échec, une échéance dépassée, une révision inattendue ou une sortie
invalide ouvre une dead-letter. Aucun résultat partiel ne déclenche la publication.

## Regroupement et coût

- médias planifiés et satellite coïncidents : un seul batch et une seule session GPU ;
- contributions : déclenchement à 8 éléments, 15 minutes ou avant dépassement de l'échéance d'une heure ;
- `max_workers=1` au MVP pour plafonner le coût et préserver l'exécution séquentielle ;
- priorité `user_deadline` calculée par le backend, jamais déclarée par le navigateur ;
- arrêt d'urgence backend empêchant les nouvelles soumissions, sans supprimer l'audit existant.

Le timeout d'inactivité final vient du benchmark et de la distribution réelle des arrivées, pas d'une
valeur fixe choisie à l'avance.
