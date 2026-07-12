# Runbook — sauvegarde et restauration SQLite

## Sauvegarde

1. Vérifier que `FV_DATABASE_URL` pointe vers le fichier attendu.
2. Lancer :

   ```bash
   fire-viewer-backup --output backups/fire_viewer_manual.db
   ```

3. Le script exécute un checkpoint WAL, l'API de backup SQLite puis `PRAGMA integrity_check` sur un fichier temporaire.
4. Le fichier cible est remplacé atomiquement uniquement après validation; aucun `.part` ne doit rester.
5. Copier la sauvegarde vers un stockage distinct et chiffré selon la politique du déploiement.
6. Conserver le hash SHA-256, la version applicative et la révision Alembic.

## Restauration sur une instance vierge

1. Suspendre les écritures ou arrêter l'API.
2. Ne jamais écraser l'unique copie existante; renommer le fichier courant.
3. Copier le backup vers le chemin configuré.
4. Vérifier :

   ```bash
   sqlite3 data/fire_viewer.db 'PRAGMA integrity_check;'
   sqlite3 data/fire_viewer.db 'SELECT version_num FROM alembic_version;'
   ```

5. Exécuter `alembic upgrade head` si la sauvegarde provient d'une version antérieure compatible.
6. Démarrer une seule instance API et appeler `/readyz`.
7. Contrôler un échantillon : incident, épisode courant, manifeste, jobs, nombre d'audits et objets référencés.
8. Réactiver les écritures seulement après validation.

## Critères d'échec

- `integrity_check` différent de `ok`;
- migration non reproductible;
- épisode courant absent ou multiple;
- manifeste pointant vers un asset inexistant;
- compte d'audits inférieur à la sauvegarde source;
- divergence de hash.

Dans ces cas, conserver toutes les copies et ne pas tenter de « réparer » directement le journal d'audit.
