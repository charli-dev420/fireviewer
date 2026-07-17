# État de préparation backend et administration

**Date de contrôle :** 16 juillet 2026
**Portée :** checkout courant, déploiements enregistrés et contrôles exécutés pendant cette passe.

## Verdict

- **Site public : déployé, non opérationnel critique.** Le frontend public et l’Admin sont servis par
  Vercel. Le contenu et les parcours sont implémentés, mais aucune validation métier incendie ne
  permet de présenter le service comme un outil de secours.
- **Backend hébergé : raccordé.** Un projet FastAPI distinct, Neon/PostGIS et Vercel Private Blob ont
  été configurés. La baseline hébergée enregistrée est `e6f3a1b8c420`.
- **Checkout courant : en avance sur la production.** Le schéma local atteint `a4e9c2f7d610` et ajoute
  les lots médias agents et la normalisation des contrats d’assets. Cette avance n’est pas encore une
  preuve de déploiement.
- **Admin : utilisable avec un compte unique.** Session HttpOnly, CSRF, limitation des connexions,
  réauthentification et audit sont présents. MFA, identité nominative et RBAC multi-utilisateur sont
  volontairement hors périmètre.
- **IA : intégration en cours.** Le worker et le dispatcher existent, mais aucun endpoint RunPod réel
  n’a été validé.

## Matrice actuelle

| Domaine | État | Preuve actuelle | Reste à valider |
| --- | --- | --- | --- |
| Frontend public | Implémenté et déployé | Routes publiques, 122 tests actifs, typecheck et build passants | Recette de contenu réel, accessibilité complète, performance mobile |
| Fiche incident | Implémentée | Manifest + public-view, viewer 3D conditionnel, états dégradés | Incident réel validé et asset publié depuis Blob |
| Admin | Partiellement complet | Dashboard, carte nationale interne, files, incidents, zones, packages, publications | Finir les mutations des écrans encore en lecture et la recette métier |
| Auth Admin | Implémentée MVP | Compte unique, cookie HttpOnly, CSRF, rate limit, réauthentification | Procédure de récupération exercée et rotation périodique |
| API Vercel | Déployée | Point d’entrée `api/index.py`, proxy frontend `/api/*` | Revalider après promotion du nouveau schéma |
| Neon/PostGIS | Déployé sur baseline | Readiness et index spatiaux intégrés au code ; baseline `e6f3a1b8c420` enregistrée | Migrer staging puis production vers `a4e9c2f7d610`, tests multi-writer et restauration |
| Vercel Private Blob | Raccordé | Backend de stockage, jeton limité, upload client multipart et finalisation | Import réel 417 Mo, reprise d’échec et cycle publication/retrait |
| Packages 3D | Implémentés | Dossier local, manifeste/catalogue, registre, preview et publication | Recette production complète et budget performance |
| LiDAR/3D | Local uniquement | Outils et paquet Die–Pontaix historique | Automatisation volontairement non prioritaire ; documenter l’opération manuelle |
| Audit | Implémenté | Snapshots, hashes et garde append-only | Export, rétention et exercice de restauration Neon |
| Contributions/médias | Partiel | Signalements publics, lots privés, consentements et retraits persistés | Antivirus, EXIF/FFprobe/OCR/frames, dérivés, revue complète et purge physique |
| Worker RunPod | Code présent, non déployé | Contrats fermés, worker séquentiel, révisions verrouillées | Installer l’environnement, tests complets, image GPU, CUDA et benchmark |
| Dispatcher CPU | Code présent, non déployé | Lease, soumission/poll/cancel, dead letter et validation de retour | Hébergement 24/7 hors Function, secrets réels et test de panne |
| Sauvegardes | Partiel | SQLite sauvegarde/restauration validées historiquement | Sauvegarde Neon et exercice RPO/RTO |
| Observabilité | Partiel | Logs, trace ID, métriques et page système | Alertes hébergées, SLO et protection de `/metrics` |

## Écart production / checkout

```text
production enregistrée : e6f3a1b8c420
                         |
                         +-- f3b8c1d7a920  lots médias et dispatch agentique
                         `-- a4e9c2f7d610  normalisation assets/packages (HEAD local)
```

La mise à jour de `FV_DATABASE_SCHEMA_REVISION` et l’exécution d’Alembic doivent précéder le
déploiement du code qui dépend de ces tables. `/readyz` doit rester en `503` en cas de divergence.

## Contrôles exécutés pendant cette passe

- Frontend : `npm run check`, 122 tests passants, 4 ignorés, build Vite réussi.
- Migrations : `a4e9c2f7d610` est l’unique head ; upgrade, second upgrade, contrôle de dérive et
  downgrade réussis sur SQLite temporaire.
- Backend : Ruff passe et mypy passe sur 80 fichiers source.
- Backend ciblé : 22 tests agents/migration/infrastructure passent ; l’échec final de la commande est
  uniquement le seuil de couverture globale, inadapté à un sous-ensemble.
- Backend complet : 164 tests réussis en 271,53 secondes, avec 83,96 % de couverture pour un seuil
  requis de 80 %. Deux avertissements non bloquants restent visibles : adaptateur SQLite `datetime`
  déprécié sous Python 3.13 et cache pytest non inscriptible dans cet environnement Windows.
- Worker : Ruff lint passe. Le formatage signale six fichiers, mypy ne trouve pas de marqueur
  `py.typed` et la suite ne collecte pas sans installation/PYTHONPATH combinant `src` et la racine.

La relecture HTTPS directe des déploiements a été empêchée par le magasin d’identifiants TLS Windows
de cet environnement (`SEC_E_NO_CREDENTIALS`). Les statuts hébergés ci-dessus reposent donc sur la
dernière vérification enregistrée dans la tâche, pas sur un nouveau probe réseau de cette passe.

## Gates restantes

1. Migrer une branche Neon de staging jusqu’à `a4e9c2f7d610` et obtenir `200` sur `/readyz`.
2. Déployer le backend courant en preview, puis exécuter les parcours Admin contre cette preview.
3. Importer réellement le package de 417 Mo, prévisualiser, publier, retirer et restaurer.
4. Corriger l’environnement qualité du worker et obtenir lint, format, mypy et tests tous verts.
5. Déployer le dispatcher CPU et un endpoint RunPod de staging, puis exécuter le benchmark documenté.
6. Exercer sauvegarde/restauration Neon, concurrence multi-instance, panne Blob et révocation de
   session Admin.
7. Réaliser une recette accessibilité, mobile/réseau dégradé et validation métier indépendante.

La gate opérationnelle reste fermée tant que ces preuves et les procédures humaines ne sont pas
réalisées.
