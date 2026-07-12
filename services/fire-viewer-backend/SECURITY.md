# Politique de sécurité

Ne publiez pas de vulnérabilité exploitable dans une issue publique. Utilisez le canal privé du mainteneur ou de l'organisation qui déploie cette copie.

Inclure : version/commit, environnement, endpoint, impact, préconditions, `trace_id` et reproduction minimale sans donnée personnelle.

## Barrières déjà présentes

- validation `extra=forbid` et taille de corps limitée;
- aucune récupération d'URL fournie par le contenu dans ce service;
- confiance des sources administrée côté serveur;
- credential d'ingestion obligatoire pour toute source de confiance, hashé en base et vérifié avant replay idempotent;
- JWT OIDC en staging/production;
- RBAC serveur pour validation et suspension;
- séries non confirmées en visibilité `LIMITED`;
- observations non vérifiées sans effet sur la fraîcheur publique;
- journal append-only avec snapshots/hashes avant et après;
- hashes de preuve et d'asset;
- headers CSP, HSTS en production, Referrer-Policy et Permissions-Policy;
- logs sans corps de requête, token, secret ni preuve brute;
- suspension conservant l'audit;
- backup SQLite publié atomiquement seulement après `integrity_check`.

## Secrets de source

- Générer au moins 32 caractères aléatoires avec un CSPRNG.
- Stocker le secret dans un secret manager; ne jamais le committer.
- Utiliser `X-Source-Token` uniquement entre services sur HTTPS.
- Ne jamais placer ce token dans le shell web, Unity, un manifeste, une URL, un log ou un outil d'analytics.
- Une rotation s'effectue en réappelant `PUT /operator/sources/{source_id}` avec un nouvel `ingest_token`.
- Le service ne renvoie jamais le token et n'en conserve que le hash.

## Configuration obligatoire hors développement

- `FV_AUTH_MODE=jwt`;
- issuer, audience et JWKS OIDC;
- liste explicite `FV_TRUSTED_HOSTS`;
- origines CORS minimales;
- HTTPS terminé par un proxy de confiance;
- secret manager et rotation des comptes de service;
- rate limiting et limites de connexion au niveau de l'ingress;
- accès à `/metrics` restreint au réseau de monitoring;
- sauvegarde testée par restauration;
- un seul writer tant que SQLite est utilisé.

Ce dépôt ne contient pas de mécanisme d'upload de fichiers ni de fetch d'URL. Ces composants devront être isolés, plafonnés, scannés et protégés contre SSRF avant ajout.
