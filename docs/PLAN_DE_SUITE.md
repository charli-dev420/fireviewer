# Plan de suite - Fire Viewer

## Règle de conduite

Ce plan vise d'abord G0 puis un vertical slice G1 local et fictif. Il ne constitue ni un plan de mise en production, ni une autorisation d'usage opérationnel. Chaque ticket doit avoir un propriétaire, un test exécuté et un artefact de preuve.

## Lot 0 - Baseline et décisions de contrat

| ID | Action | Dépendances | Preuve d'acceptation |
| --- | --- | --- | --- |
| FV-001 | Initialiser le dépôt Git Fire Viewer et ajouter les exclusions pour `.venv`, `node_modules`, bases SQLite, builds Unity et secrets | aucune | statut Git propre, `.gitignore` revu, provenance des ZIP conservée |
| FV-002 | Exécuter les contrôles natifs reçus : backend (`make test`, `make quality` ou équivalents Windows) et UI (`npm ci`, `npm run check`, `npm run build`) | FV-001, accès aux dépendances | logs de commandes et artefacts de build ; aucun test annoncé sans exécution |
| FV-003 | Choisir et enregistrer le contrat public `ViewerManifest` : URL, version, casing JSON, ETag, erreurs 404/409, CORS | FV-002 | ADR + schéma JSON + test de contrat UI/API rouge puis vert |
| FV-004 | Décider le contrat de coordonnées Unity : ENU, datum vertical, origine, `metersPerUnit`, stratégie 1:1 ou conversion explicite de Die | inventaire Unity externe | ADR + fixture WGS84/ENU/Unity + tests de précision et de changement d'origine |
| FV-005 | Créer un jeu de données entièrement fictif `FR-83-00042` et la matrice des états/visibilités | FV-003 | seed rejouable, manifeste hashé, transitions et masquage des données sensibles testés |

## Lot 1 - Vertical slice G1 local

| ID | Action | Dépendances | Preuve d'acceptation |
| --- | --- | --- | --- |
| FV-006 | Connecter l'UI au manifeste réel et conserver le mode mock explicite | FV-003, FV-005 | parcours `/incident/FR-83-00042` en API réelle, erreur 404, timeout et WebGL indisponible testés |
| FV-007 | Vérifier migrations, idempotence, matching `create/attach/review`, audit append-only et restauration SQLite | FV-002, FV-005 | tests transactionnels ; scénario de sauvegarde/corruption/restauration documenté |
| FV-008 | Produire un seul asset GLB de démonstration avec manifeste immuable, SHA-256 et métadonnées ENU | FV-004, FV-005 | téléchargement, hash, taille, unité et repères contrôlés avant chargement |
| FV-009 | Ajouter un pont minimal JavaScript/C# et un build Unity WebGL de démonstration, sans retirer le DOM texte | FV-004, FV-008 | contrat de messages borné, test navigateur et fallback sans WebGL |
| FV-010 | Écrire le runbook local de démarrage, arrêt, migration, seed, rollback et incident fictif | FV-006 à FV-009 | exercice reproductible par une seconde personne ou dans un environnement propre |

Le gate G1 ne pourra être déclaré atteint que lorsque FV-006 à FV-010 auront des preuves exécutées. À cet instant, le produit reste une démonstration contrôlée, non opérationnelle.

## Lot 2 - Capacités préparatoires après G1

1. Phases 3 et 4 : agents vision et texte. Les limiter à des observations structurées ; préparer corpus négatifs, jeux ambigus, calibration et quarantaine.
2. Phases 5 et 6 : pipeline IGN/PDAL/GDAL/TIN, provenance, versioning d'asset, rollback et réactivation. Ne pas choisir Poisson comme reconstruction par défaut du MNT.
3. Phases 7, 10 et 11 : profils d'environnement, stockage objet, worker idempotent, upload temporaire puis publication atomique, traces et métriques.
4. Phases 8, 9, 12 et 13 : contrat Unity complet, UI accessible, hot-swap du même `fire_id`, cache contrôlé et fallback hors ligne.

## Lot 3 - Conditions avant bêta supervisée (G2)

Les phases 14 à 18 sont des prérequis : threat model, RBAC, minimisation des données, kill switch, test de charge mesuré, matrice mobile, recette E2E, documentation et exercices de restauration. Une bêta n'est planifiable qu'après des preuves de ces contrôles sur données fictives et un go/no-go documenté.

## Ce qui ne doit pas être fait maintenant

- publier un feu, une position sensible ou une preuve réelle ;
- présenter le prototype comme un service d'urgence, un outil de prévision ou un système de confirmation automatique ;
- brancher Unity au backend avant d'avoir fixé le contrat JSON et les unités ;
- lancer plusieurs workers sur la même base SQLite locale ;
- effacer les ZIP reçus ou le projet Unity de Die externe.

## Prochaine action sûre

Exécuter FV-001 à FV-003. Elles réduisent les deux inconnues matérielles déjà observées : l'intégration HTTP non compatible et l'absence de baseline reproductible. FV-004 doit démarrer en parallèle comme décision d'architecture, mais aucun transfert d'asset de Die ne doit être effectué avant sa preuve métrique.
