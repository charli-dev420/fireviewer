# Politique de sécurité du backend

Ne publiez pas de vulnérabilité exploitable dans une issue publique. Utilisez le canal privé du
mainteneur ou de l'organisation qui déploie cette copie. Un rapport peut contenir le commit,
l'environnement, l'impact, les préconditions et un `trace_id`, mais aucune donnée personnelle,
preuve brute, URL signée ou valeur de secret.

## Modèle d'authentification actuel

Le déploiement initial utilise un compte administrateur unique avec session `HttpOnly`, protection
CSRF et réauthentification pour les actions irréversibles. Le mot de passe n'est jamais stocké en
clair dans le dépôt : seul un hash `scrypt` doit être injecté par le gestionnaire de secrets du
déploiement.

Le mode OIDC/JWT existe dans le code pour une évolution multi-utilisateur, mais il n'est pas une
preuve qu'un fournisseur d'identité, une MFA ou des rôles nominatifs sont raccordés au déploiement
actuel. Ces capacités doivent être validées séparément avant d'ajouter un second administrateur.

## Barrières implémentées

- validation stricte des schémas et limite de taille des corps reçus par FastAPI ;
- confiance des sources administrée côté serveur et secrets d'ingestion stockés sous forme de hash ;
- états publics conservateurs et validation humaine avant publication ;
- journal d'audit append-only avec snapshots et hashes avant/après ;
- headers de sécurité, logs structurés sans corps ni secret et réponses Admin `no-store` ;
- suspension d'un incident sans effacement de son audit ;
- contrôle de révision Alembic et des index spatiaux dans la readiness ;
- sauvegarde/restauration SQLite locale non destructive pour le développement.

## Upload de packages privés

Les packages 3D sont envoyés directement du navigateur vers Vercel Blob privé. Les binaires ne
traversent pas FastAPI. L'API autorise un préfixe d'upload limité, puis finalise uniquement les
métadonnées après contrôle de présence, taille et type des objets. Les SHA-256 du pipeline local
sont enregistrés, mais ne sont pas recalculés par une Function Vercel sur les gros fichiers.

Ce mécanisme ne doit pas être décrit comme entièrement éprouvé en production tant que l'import
réel du package de référence n'a pas été exécuté de bout en bout.

## Configuration obligatoire hors développement

- `FV_AUTH_MODE=local_admin` avec hash robuste et secret de rapport distinct pour le déploiement
  mono-administrateur, ou OIDC/JWT entièrement raccordé pour un déploiement multi-utilisateur ;
- liste explicite `FV_TRUSTED_HOSTS`, origines CORS minimales et HTTPS ;
- secrets dans le gestionnaire du fournisseur, jamais dans Git ou le bundle frontend ;
- rate limiting et restriction de `/metrics` au niveau de l'ingress ;
- PostgreSQL/PostGIS pour plusieurs instances ; SQLite reste mono-writer ;
- sauvegarde réellement restaurée et contrôlée avant toute promesse de reprise.

## Secrets de source

Générer les secrets avec un CSPRNG, les stocker côté serveur et les faire tourner sans les placer
dans une URL, un manifeste, un log, Unity ou le frontend. `X-Source-Token` est réservé aux échanges
serveur-à-serveur sur HTTPS ; l'API n'en conserve que le hash et ne le renvoie jamais.
