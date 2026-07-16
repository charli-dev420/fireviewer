# État de préparation backend et administration

**Date d'audit :** 16 juillet 2026
**Références :** plan d'implémentation backend, cahier des charges Admin sections 1 à 47,
ADR-003 et code du dépôt.

## Verdict

- **G1 local : connectable.** L'interface Admin peut utiliser l'API locale avec une session
  `Secure`/`HttpOnly`, un jeton CSRF en mémoire et PostgreSQL/PostGIS via Docker Compose.
- **G1 hébergé : bloqué par l'infrastructure.** Le point d'entrée FastAPI, Neon/PostgreSQL et
  Vercel Private Blob sont pris en charge par le code. VÉRIFIÉ côté Vercel : le seul projet
  `fireviewer` déploie le frontend ; aucun projet backend distinct n'est actuellement créé.
- **Compte unique : cible MVP actuelle.** Les identités nominatives, rôles multiples et MFA sont
  volontairement hors périmètre tant qu'un seul administrateur exploite l'instance. Ils ne doivent
  pas être présentés comme des fonctions disponibles.

Le projet ne doit donc pas être présenté comme complet ou prêt à un usage opérationnel critique.
La cible actuellement cohérente est une bêta G1 supervisée.

## Architecture retenue

| Domaine | Développement | Hébergement cible |
|---|---|---|
| Interface publique et Admin | Vite/React | Vercel |
| API courte et transactionnelle | FastAPI | Vercel Python Functions |
| Base spatiale | PostGIS Docker | Neon PostgreSQL/PostGIS |
| Assets privés | stockage local | Vercel Private Blob |
| Préparation LiDAR/3D | machine locale | hors backend hébergé |
| IA à la demande | doubles de test | RunPod serverless, NON IMPLÉMENTÉ |

La cible Vercel Private Blob remplace les anciennes propositions R2/MinIO. Les fichiers lourds ne
sont jamais stockés dans PostgreSQL.

## Matrice backend

| Exigence | État | Preuve observée | Reste à faire |
|---|---|---|---|
| PostgreSQL/PostGIS | Partiel | Migration `c2e8f4a6b910`, colonnes 4326/2154, index GiST | Exécuter sur une branche Neon réelle et tester la concurrence multi-writer |
| Révision de schéma | Implémenté | `/readyz` compare `alembic_version` à `FV_DATABASE_SCHEMA_REVISION` | Synchroniser la variable lors de chaque nouvelle migration |
| Readiness spatiale | Implémenté | RTree exigé sur SQLite, PostGIS et quatre index exigés sur PostgreSQL | Vérifier sur Neon réel |
| Entrée Vercel | Implémenté | `services/fire-viewer-backend/api/index.py` expose l'ASGI `app` | Déployer un preview réel |
| Stockage privé | Implémenté, hébergement non vérifié | Abstraction locale/Vercel Blob, jeton client limité au préfixe, upload navigateur multipart et finalisation serveur | Tester avec le store Blob privé réel et un package de taille représentative |
| Migrations réversibles | Implémenté localement | Alembic, contrôle upgrade/check/downgrade SQLite | Import SQLite vers Neon avec rapport de rapprochement |
| Incident et épisodes | Implémenté G1 | `fire_id` stable, épisodes, matching, revue, transitions | Verrous et scénarios de charge PostgreSQL réels |
| Carte opérationnelle Admin | Implémenté en lecture | `/api/v2/admin/operational-map` et page Admin correspondante | Édition complète des couches depuis la carte |
| Session Admin locale | Implémenté G1 | Cookie `HttpOnly`, expiration, CSRF, limitation de tentatives | Rotation/administration des sessions |
| OIDC/JWT serveur | Hors périmètre MVP | Validation serveur conservée pour une évolution future | Ne pas exposer dans l'interface du compte unique |
| RBAC métier | Hors périmètre MVP | Le compte local reçoit les capacités nécessaires côté serveur | Réévaluer uniquement lors du passage à plusieurs administrateurs |
| Audit append-only | Implémenté G1 | Événements, snapshots, triggers SQLite/PostgreSQL | Export signé, politique de rétention, revue auditeur |
| File de travail | Partiel | Projection `/admin/work-queue`, table `job` avec leases | Attribution, prise de tâche, renouvellement, libération et actions groupées |
| Contributions | Très partiel | Observations et signalements publics | Workflow contribution, états, auteur, modération et droits de retrait |
| Médias | Non implémenté | Métadonnées de sources seulement | Quarantaine, MIME réel, antivirus, dérivés, floutage, publication et retrait |
| Consentements | Non implémenté | Politique documentaire seulement | Preuve de consentement, portée, révocation et purge dérivée |
| Commentaires | Non implémenté | Aucun modèle métier dédié | Modération, distinction discussion/consigne et audit |
| Packages 3D locaux | Implémenté, Blob réel non vérifié | Sélection du dossier, contrôles manifeste/catalogue, upload direct, finalisation, validation et preview | Test réel Vercel Blob avec le package de 417 Mo |
| Publication atomique | Implémenté G1 | Machine d'état, rollback, idempotence et réauthentification par mot de passe pour publier | Exercer publication/retrait/restauration sur Neon et Blob réels |
| Jobs/runner | Non implémenté | Persistance `job` et outbox uniquement | Dispatcher, reconciler, retries, dead-letter et budget |
| RunPod/SLM | Non implémenté | Aucun appel externe de production | Registre, déploiements, exécutions, revue, prompts, outils, évaluations, dérive |
| Sauvegardes | Partiel | Sauvegarde/restauration SQLite | Sauvegardes Neon, exercice de restauration et RPO/RTO |
| Observabilité | Partiel | Logs structurés, trace ID, métriques, état système | Alertes, dashboards hébergés, SLO et protection `/metrics` |

## Matrice de l'espace Admin

| Page ou flux du CDC | État actuel |
|---|---|
| Connexion locale | Fonctionnelle G1 : cookie HttpOnly, CSRF, expiration et limitation des tentatives |
| MFA, profil et sécurité nominative | Hors périmètre du compte unique |
| Tableau de bord | Fonctionnel, alimenté par l'API et relié aux files et incidents |
| Carte opérationnelle nationale interne | Fonctionnelle en lecture, modèles accessibles par incident |
| File de traitement | Fonctionnelle en lecture, leases et assignations manquants |
| Liste et dossier incident | Fonctionnels en lecture |
| Création d'incident guidée | Partielle via détection/résolution, assistant CDC manquant |
| Informations publiques | Édition localisée disponible pour les zones ; dossier incident incomplet |
| Correspondance spatiale | Projection et résolution G1 disponibles |
| Modèles et couches 3D | Registre, import direct Blob, validation, preview et publication disponibles ; store réel non testé |
| Zones et marqueurs | Zones administratives disponibles ; outils cartographiques complets manquants |
| Contributions, médias et consentements | Non complets |
| Gestes à adopter et statistiques | Projections publiques disponibles ; workflow éditorial Admin incomplet |
| Épisodes, réactivations et archives | Modèle métier présent ; écrans/actions CDC incomplets |
| Publications et kill switch | Base backend présente ; double validation et UX complète manquantes |
| Supervision SLM | Non implémentée |
| Système, audit, rôles et configuration | Projections sûres en lecture ; administration complète manquante |

## Contrat de connexion actuel

1. Lancer les migrations jusqu'à `e6f3a1b8c420`.
2. Démarrer l'API et exiger un `200` sur `/readyz`.
3. Configurer le frontend avec `VITE_API_BASE_URL` pointant vers l'origine HTTPS de l'API.
4. En G1, utiliser `FV_AUTH_MODE=local_admin` et un hash généré par
   `fire-viewer-hash-admin-password`.
5. Le navigateur reçoit uniquement le cookie de session `HttpOnly`; `/api/v1/admin/session`
   renvoie le jeton CSRF conservé en mémoire.
6. Toutes les mutations Admin envoient `credentials: include`, `X-CSRF-Token` et, lorsque requis,
   `Idempotency-Key`.

## Blocages avant raccordement hébergé

1. Créer un projet Vercel backend dont la racine est `services/fire-viewer-backend`.
2. Créer et migrer la base Neon/PostGIS, puis obtenir `200` sur `/readyz`.
3. Connecter un store Vercel Blob privé au projet backend.
4. Utiliser un domaine API appartenant au même site que le frontend, ou un proxy même origine,
   afin que le cookie `SameSite=Strict` soit effectivement envoyé.
5. Définir `VITE_API_BASE_URL`, `FV_CORS_ORIGINS` et `FV_TRUSTED_HOSTS` avec les origines réelles.
6. Exercer un import direct du package de 417 Mo, puis preview, publication, retrait et restauration.
7. Ajouter sauvegarde/restauration PostgreSQL, test de concurrence Neon et exercice de panne.

VÉRIFIÉ localement le 16 juillet 2026 : `155` tests backend, couverture `85,02 %`, Ruff, mypy,
`122` tests frontend, build de production et `6` scénarios E2E Admin desktop/mobile.

## Gates

- **Gate G1 local :** migrations, `/readyz`, auth locale, CSRF, routes Admin et tests locaux passent.
- **Gate G1 hébergé :** preview Vercel + Neon + Blob réellement déployé, upload d'un package de
  taille réaliste, publication/rollback et restauration testés.
- **Gate multi-administrateur ultérieure :** identité nominative, MFA, rôles persistés et séparation
  des pouvoirs ne deviennent obligatoires que lorsque le produit quitte le modèle du compte unique.
- **Gate opérationnelle :** validation métier incendie, sécurité, accessibilité, charge, résilience
  et procédures humaines indépendantes du développement.
