# Statut des licences

Ce document décrit uniquement les fichiers observés dans les livrables reçus. Il ne remplace pas une décision du titulaire des droits.

## Éléments vérifiés

- **VÉRIFIÉ** : `services/fire-viewer-backend/LICENSE` contient le texte de la GNU Affero General Public License v3. Le fichier `pyproject.toml` déclare `AGPL-3.0-or-later`.
- **OBSERVÉ** : `apps/fire-viewer-ui` ne contient pas de fichier `LICENSE` et son `package.json` ne déclare pas de licence.
- **OBSERVÉ** : la roadmap mentionne AGPL-3.0 pour le code si Ultralytics est intégré et CC BY 4.0 pour la documentation. Cette mention d'architecture ne suffit pas, à elle seule, à attribuer une licence au dépôt racine ou à tous les fichiers fournis.

## Conséquence actuelle

Le dépôt rend les sources visibles pour la collaboration, mais il ne revendique pas une licence racine unifiée. Les contributeurs ne doivent pas supposer qu'ils peuvent redistribuer ou relicencier l'interface, la roadmap ou les futurs assets sans décision explicite du titulaire des droits.

## Décision à enregistrer avant les contributions externes

Le ticket de gouvernance doit choisir et ajouter :

1. une licence racine pour le code de l'interface et les composants communs ;
2. une licence de documentation ;
3. une politique de provenance pour les données IGN, GLB, textures, captures, jeux de tests et contributions externes ;
4. un fichier `NOTICE` si les composants distribués l'exigent.
