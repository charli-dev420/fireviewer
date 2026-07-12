# Architecture cible

![Architecture Fire Viewer](../assets/diagrams/fire-viewer-architecture.svg)

## Source de vérité et flux de données

```text
observations -> API transactionnelle -> audit / matching / états
                                      -> manifeste courant -> shell web
                                                           -> Unity WebGL
                                      -> asset GLB immuable
```

Le backend est responsable des identifiants, de l'audit, des règles de matching et de la publication de manifestes. L'UI affiche la situation avant toute initialisation 3D. Unity charge seulement un asset dont l'intégrité et le repère sont décrits par le manifeste.

## Identifiants stables

| Identifiant | Rôle |
| --- | --- |
| `fire_id` | Série géographique persistante et route publique stable |
| `episode_id` | Période opérationnelle immuable, y compris une réactivation |
| `asset_id` + version | Modèle terrain/3D immuable, hashé et publiable atomiquement |
| `trace_id` | Corrélation d'une opération métier et de son audit |

## Contrat de viewer à stabiliser

**VÉRIFIÉ dans les sources reçues** :

- l'UI attend un objet `IncidentData` en camelCase à l'URL `{VITE_API_BASE_URL}/incident/{fire_id}` ;
- le backend expose `GET /api/v1/incident/{fire_id}` pour le résumé public ;
- le backend expose `GET /api/v1/incident/{fire_id}/manifest` pour le manifeste, au format snake_case.

Le contrat public n'est donc pas encore stabilisé. Le ticket `FV-003` doit définir un unique endpoint viewer, sa version, son casing, les erreurs, CORS, ETag et le test de compatibilité qui les verrouille.

## Contrat spatial

Le manifeste doit porter l'origine WGS84, le repère local ENU, le datum vertical et `meters_per_unit`. La roadmap cible une convention 1:1 mètre/unité. Le projet Unity de Die existant utilise une convention de présentation 100:1 ; son intégration est suspendue jusqu'à une ADR et des tests de précision.

## Limites de sécurité

- Les agents IA ne confirment jamais seuls un incident.
- Une position non confirmée ou sensible ne doit pas être rendue publique.
- Un asset non hashé, invalide ou hors contrat spatial ne doit pas être chargé.
- Sans WebGL ou réseau, les informations textuelles restent accessibles avec un état dégradé explicite.
