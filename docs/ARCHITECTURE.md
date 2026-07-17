# Architecture actuelle

**Mise à jour :** 16 juillet 2026

## Frontières du système

FireWarning sépare cinq responsabilités :

1. le site public consulte les incidents publiés et leurs représentations ;
2. l’espace Admin qualifie, rattache, importe et publie ;
3. FastAPI porte les règles métier, l’authentification, l’audit et les transactions ;
4. Neon/PostGIS stocke les états et géométries, Vercel Blob stocke les fichiers privés ;
5. les traitements LiDAR/3D restent locaux et l’analyse GPU reste un worker séparé.

```text
                         +---------------------------+
visiteur ----------------> site public React         |
                         | /incendies               |
                         | /incendie/{fire_id}      |
                         +-------------+-------------+
                                       |
administrateur ----------> Admin React | session HttpOnly + CSRF
                         +-------------v-------------+
                         | FastAPI v1/v2             |
                         | règles, audit, projection |
                         +------+-------------+------+
                                |             |
                         Neon/PostGIS   Vercel Private Blob
                                |
                         dispatcher CPU (à déployer)
                                |
                         RunPod Serverless GPU

pipeline LiDAR/3D local -> package contrôlé -> upload direct Blob par l’Admin
```

## Interface publique

La navigation publique expose l’accueil, la liste des incendies avec onglet archives, le parcours de
signalement, les pages compte/réglages et les pages institutionnelles. La route canonique d’un feu
est `/incendie/{fire_id}` ; `/incident/{fire_id}` reste accepté comme alias.

La fiche d’incident agrège deux contrats :

- `GET /api/v1/incident/{fire_id}/manifest` pour l’état et l’asset 3D courant avec ETag ;
- `GET /api/v1/incident/{fire_id}/public-view` pour la projection publique autorisée.

Le rendu reste DOM-first. Une erreur de 3D ou de détail ne doit pas supprimer l’identité, l’état et
les limites de l’incident. Les zones publiques historiques `/zones/*` sont retirées : une zone n’est
visible publiquement qu’à travers une publication liée à un incident.

## Administration

L’Admin utilise un compte local unique pour le MVP. Le serveur crée une session persistée dans un
cookie `Secure`, `HttpOnly`, `SameSite=Strict`; le navigateur conserve le jeton CSRF uniquement en
mémoire. Les actions irréversibles exigent une réauthentification et chaque mutation sensible produit
un audit append-only.

Les routes Admin couvrent : tableau de bord, carte opérationnelle nationale interne, file de
traitement, incidents, rapprochement spatial, signalements, audit, système, configuration,
publications, zones, révisions, informations et packages. Les routes `/api/v2/admin/*` fournissent les
projections récentes du dashboard, de la carte et des assets ; `/api/v1/admin/*` conserve les workflows
transactionnels historiques.

Le multi-utilisateur, les rôles nominatifs et la MFA sont hors périmètre tant qu’un seul
administrateur exploite l’instance. Les écrans de rôles ne doivent pas laisser croire le contraire.

## Persistance et fichiers

PostgreSQL/PostGIS est la cible hébergée. SQLite WAL reste disponible pour le développement local
mono-processus. Le schéma local courant est `a4e9c2f7d610`; la baseline de production enregistrée
avant cette passe était `e6f3a1b8c420`.

Les binaires lourds ne sont jamais stockés dans PostgreSQL. L’Admin sélectionne un dossier préparé
localement, vérifie `package-manifest.json` et `catalog.json`, puis téléverse directement les fichiers
vers Vercel Blob sous un préfixe immuable. FastAPI ne reçoit que les métadonnées de finalisation et
contrôle l’existence, la taille et le type des objets avant d’enregistrer le package.

## Identités et publication

| Identifiant | Rôle |
| --- | --- |
| `fire_id` | identité géographique stable et URL publique |
| `episode_id` | occurrence ou réactivation immuable |
| `zone_id` + `revision` | terrain préparé et versionné |
| `package_id` | ensemble immuable de fichiers spatiaux |
| `asset_id` | représentation publiable liée à un package |
| `batch_id` | lot privé d’analyse média |
| `trace_id` | corrélation d’une opération et de son audit |

La publication d’un asset est une transition explicite, idempotente et auditée. Aucun fichier local,
résultat IA ou observation non validée ne devient public par simple présence dans le stockage.

## Analyse média et RunPod

Le worktree contient un worker GPU séparé, un contrat fermé, des tables dédiées aux consentements,
lots, dispatchs, exécutions, dead letters et tâches de revue, ainsi qu’un dispatcher CPU asynchrone.
Le navigateur ne contacte jamais RunPod. Le dispatcher soumet `/run`, réconcilie `/status/{id}` et
peut appeler `/cancel/{id}`.

Cette chaîne est **implémentée dans le code mais non déployée**. Le setup local CUDA 13 de RoMa et
les SHA-256 des deux poids ont été vérifiés ; le chargement consomme 4,60 Go de VRAM de pic. Le
checkpoint RT-DETR privé, le volume RunPod, le benchmark de cold start et le comportement réel de
l'endpoint restent NON VÉRIFIÉS. Aucun résultat ne modifie directement un incident public.

### Grounding spatial des médias

Le grounding spatial suit [ADR-004](adr/ADR-004-agent-spatial-point-grounding.md) et sépare deux
modèles : le futur LoRA Qwen `fire_pointing` propose un pixel ou une abstention dans une image
incendie ; AerialExtreMatch-RoMa établit des correspondances vue/carte. Le moteur géométrique joint
les pixels de carte au DSM/LiDAR, estime la pose par PnP/RANSAC puis intersecte le rayon du point feu
avec le MNT. Aucun modèle n'émet librement une coordonnée géographique.

Le probe local traverse réellement RoMa -> DSM -> PnP sous les budgets, mais son premier échantillon
tenu à l'écart échoue au gate qualité avec 1 220,68 m d'erreur. Le recalage spatial reste donc
NON DÉPLOYABLE ; le contrat worker 1.0 n'accepte encore aucune référence DSM signée et ne produit
aucun marqueur de phénomène.

Un incident opérationnel en cours est une entrée d'inférence, jamais une donnée d'entraînement. Le
package Die–Pontaix est explicitement refusé par le préflight, y compris sous forme de crop, rendu ou
dérivé synthétique. Les propositions produites restent des calques privés éditables dans l'Admin ;
elles ne remplacent ni le package 3D ni la révision de zone.

## Déploiement

- frontend : projet Vercel `fireviewer`, avec proxy `/api/*` vers l’API ;
- backend : projet Vercel `fireviewer-api`, Functions Python courtes ;
- base : Neon PostgreSQL/PostGIS ;
- objets : Vercel Private Blob ;
- LiDAR/3D : machine locale ;
- dispatcher agentique : processus CPU durable à déployer hors Vercel Functions ;
- GPU : RunPod Serverless à déployer et benchmarker.

Les Functions Vercel ne réalisent aucun calcul LiDAR, extraction vidéo, polling durable ou inférence
GPU.

## Garanties et limites

- Une sortie IA ne confirme jamais seule un incendie.
- Les médias publics nécessitent consentement explicite et modération.
- Les informations publiques ne sont pas des consignes de secours.
- Un asset invalide, incomplet ou non lié à une publication reste privé.
- Le runtime hébergé doit rester indisponible si sa révision Alembic ou ses index PostGIS ne sont pas
  ceux attendus.
- L’upload de 417 Mo, la restauration Neon, la charge multi-instance et le worker RunPod réel restent
  à valider avant toute déclaration de disponibilité opérationnelle.
