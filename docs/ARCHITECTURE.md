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

L'[ADR-002](adr/ADR-002-spatial-local-unity-contract.md) fixe un profil de terrain local
pour la France continentale rurale. Toute origine est `EPSG:4979` et toute valeur tableau
`origin_wgs84` est `[longitude, latitude, hauteur_ellipsoïdale]`. Une hauteur source
NGF-IGN69 est convertie par RAF20 local, épinglé par URI et SHA-256, sans téléchargement
réseau à l'exécution. Corse et outre-mer nécessitent un profil distinct et restent hors
périmètre.

Le repère physique est ENU en mètres. Le GLB stocke `(E, U, -N)` avec
`gltf_meters_per_unit = 1.0`; Unity reçoit `(100E, 100U, 100N)`. Le monde de rendu Unity
est donc décrit par `ViewerManifest.frame.meters_per_unit = 0.01`, sans facteur implicite
dans une scène ou un prefab. Un `spatial_snapshot` immuable associe l'asset à une révision
de zone et à l'archive PNG de la révision de manifeste. Aucun globe, tuilage ou runtime
Cesium ne fait partie de cette architecture.

```text
NGF-IGN69 H --RAF20 local--> EPSG:4979 [lon, lat, h] --origine--> ENU mètres
                                                                  |-- GLB (E, U, -N), 1 m/u
                                                                  `-- Unity (100E, 100U, 100N), 0.01 m/u
```

**VÉRIFIÉ** : les points de contrôle fictifs WGS84/ENU/Unity, le facteur ×100, le hash
RAF20 et la migration SQLite sont traversés par les tests backend. **NON VÉRIFIÉ** :
l'import d'un GLB réel dans Unity, la production matérielle du PNG et l'exécution de la
migration sur une instance PostgreSQL restent nécessaires avant de déclarer un terrain 3D
aligné en intégration.

## Limites de sécurité

- Les agents IA ne confirment jamais seuls un incident.
- Une position non confirmée ou sensible ne doit pas être rendue publique.
- Un asset non hashé, invalide ou hors contrat spatial ne doit pas être chargé.
- Sans WebGL ou réseau, les informations textuelles restent accessibles avec un état dégradé explicite.
