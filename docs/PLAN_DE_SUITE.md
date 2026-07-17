# Plan de suite priorisé

**Référence :** état du 17 juillet 2026.
Le runbook G1 et le registre historique restent utiles pour reproduire les anciennes preuves, mais
ce document décrit désormais le travail restant sur l’architecture Vercel + Neon + Blob actuelle.

## P0 — Promouvoir le schéma courant sans casser la production

1. Geler le diff des migrations `f3b8c1d7a920` et `a4e9c2f7d610`.
2. Appliquer Alembic sur une branche Neon de staging avec la chaîne directe.
3. Déployer une preview backend avec `FV_DATABASE_SCHEMA_REVISION=a4e9c2f7d610`.
4. Vérifier `/readyz`, les quatre index PostGIS, les sessions Admin et les routes v1/v2.
5. Exécuter la suite backend complète sans timeout et archiver le résultat.
6. Promouvoir production seulement après rollback de migration testé sur staging.

**Gate :** aucune divergence entre code, `alembic_version`, OpenAPI et variables Vercel.

## P0 — Recette réelle des packages 3D

1. Sélectionner le dossier local complet avec `package-manifest.json` et `catalog.json`.
2. Importer les 417 Mo directement vers Vercel Private Blob depuis l’Admin.
3. Vérifier la progression, une reprise après coupure et l’absence de binaire dans FastAPI.
4. Finaliser, prévisualiser les trois distances, publier, retirer puis restaurer.
5. Vérifier l’immuabilité des chemins, tailles, types et SHA-256 enregistrés.

**Gate :** un package incomplet n’existe pas en base et aucun objet privé n’est exposé publiquement.

## P0 — Stabiliser la chaîne média agentique

1. Maintenir Ruff, mypy et tests verts dans l'environnement reproductible livré.
2. Construire et inspecter l’image GPU publique sans poids, dataset, cache ni secret.
3. Provisionner Whisper, Florence, Qwen runtime et RoMa/DINOv2 aux révisions/empreintes exactes sur
   le volume RunPod ; RT-DETR attend toujours son checkpoint privé validé.
4. Déployer le dispatcher CPU durable hors Vercel Functions.
5. Exécuter dix cycles de benchmark, y compris cold start, timeout, annulation et résultat partiel.

**Gate :** aucune sortie GPU ne modifie un incident ; toute sortie crée au maximum une tâche de revue
humaine privée.

## P0 — Qualifier les deux corpus de grounding spatial

1. Conserver `fire-pointing-v0.1.0` comme manifeste de références, sans recopier FASDD, Pyro-SDIS ou
   Wikimedia.
2. Faire annoter et double-valider des points `fire_base`, `smoke_column_base` et des abstentions ;
   les centres bas de boîtes actuels restent des pré-annotations faibles.
3. Conserver l'audit passé des 264 poses historiques AerialExtreMatch.
4. Conserver les 126 paires ODM rurales/montagneuses ajoutées ; le corpus total contient 390 paires
   et 14 groupes spatiaux sans fuite.
5. Exécuter le benchmark complet AerialExtreMatch-RoMa : le probe mono-échantillon traverse le
   runtime sous budget mais échoue à 1 220,68 m, donc aucune promotion n'est autorisée.
6. Constituer deux lots critiques hors entraînement, un par famille.
7. Maintenir la denylist des incidents actifs ; Die–Pontaix reste uniquement une zone d'inférence
   privée et ne peut fournir aucun dérivé de train/validation.

**Gate :** Qwen pointing reste en attente et exige les points humains ; RoMa doit passer le benchmark
complet puis le lot critique double-validé. Le fait que le corpus cross-view soit `training_ready`
n'autorise ni fine-tuning ni déploiement tant que la baseline officielle n'est pas qualifiée.

## P1 — Compléter l’Admin utile

- rendre les files assignables avec lease, reprise et libération ;
- terminer les mutations du dossier incident et des zones depuis la carte nationale interne ;
- raccorder la revue des contributions, médias, consentements et retraits ;
- rendre publication, kill switch et restauration explicites avec réauthentification ;
- simplifier les écrans rôles/profil tant que le produit conserve un seul administrateur ;
- ajouter les états vide, erreur, hors ligne et conflit concurrent sur chaque parcours critique.

## P1 — Fiabiliser l’hébergement

- sauvegarde Neon planifiée et restauration exercée ;
- test multi-instance PostgreSQL/PostGIS ;
- alertes sur readiness, erreurs API, échecs Blob et dead letters ;
- rotation des secrets et procédure documentée de récupération du compte Admin ;
- politique de rétention et purge physique des médias retirés ;
- budgets de taille, temps, mémoire et coût suivis par environnement.

## P1 — Recette publique

- vérifier toutes les routes desktop et mobile ;
- terminer WCAG 2.2 AA sur les parcours accueil, incidents, fiche et signalement ;
- tester réseau lent, offline, absence WebGL et reprise de téléchargement ;
- valider le contenu avec des spécialistes incendie/gestion de crise ;
- mesurer le bundle et découper le chunk principal actuellement supérieur à 500 kB minifié.

## Hors périmètre actuel

- automatiser la préparation LiDAR complète dans le cloud ;
- carte nationale publique ;
- publication autonome d’une sortie IA ;
- prévision de propagation ou consigne d’évacuation ;
- multi-administrateur, RBAC nominatif et MFA avant qu’un second opérateur soit réellement requis ;
- certification ou promesse de disponibilité opérationnelle.

Les changements de statut doivent être reportés dans
[ADMIN_BACKEND_READINESS.md](ADMIN_BACKEND_READINESS.md) avec la commande et l’environnement qui les
prouvent.
