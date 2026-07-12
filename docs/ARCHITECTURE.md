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

## Contrat de viewer public v2

L'[ADR-001](adr/ADR-001-viewer-manifest-public-contract.md) fixe le contrat à :

- `GET /api/v1/incident/{fire_id}/manifest`, sous forme `ViewerManifest` v2 en `snake_case` ;
- `schema_version: "2.0"` obligatoire, `fire_id` validé et `ETag` calculé sur la représentation complète ;
- `200` ou `304` conditionnel pour un manifeste, `400`, `404`, `410` et `503` en Problem Details ; `409` reste réservé aux mutations ;
- CORS configurable, avec `If-None-Match` autorisé et `ETag` exposé pour les origines de développement documentées ;
- trois états explicites : `available`, `not_available` et `withheld`. Le dernier masque localisation, asset et repère.

L'UI conserve un parseur strict séparé de son agrégat de démonstration. **NON VÉRIFIÉ** : l'appel de page réel reste différé à FV-006 ; aucune vue Sources, Historique ou Journal ne doit être alimentée par des données mockées lors de ce raccordement.

## Contrat spatial

Le manifeste doit porter l'origine WGS84, le repère local ENU, le datum vertical et `meters_per_unit`. La roadmap cible une convention 1:1 mètre/unité. Le projet Unity de Die existant utilise une convention de présentation 100:1 ; son intégration est suspendue jusqu'à une ADR et des tests de précision.

## Limites de sécurité

- Les agents IA ne confirment jamais seuls un incident.
- Une position non confirmée ou sensible ne doit pas être rendue publique.
- Un asset non hashé, invalide ou hors contrat spatial ne doit pas être chargé.
- Sans WebGL ou réseau, les informations textuelles restent accessibles avec un état dégradé explicite.
