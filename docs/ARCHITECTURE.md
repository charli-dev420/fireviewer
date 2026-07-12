# Architecture cible

![Architecture Fire Viewer](../assets/diagrams/fire-viewer-architecture.svg)

## Source de vérité et flux de données

```text
observations -> API transactionnelle -> audit / matching / états
                                      -> manifeste courant -> client web strict
                                                           -> rendu DOM public minimal
                                                           -> Unity WebGL (FV-009)
                                      -> asset GLB immuable (FV-008)
```

Le backend est responsable des identifiants, de l'audit, des règles de matching et de la publication de manifestes. L'UI affiche la situation avant toute initialisation 3D. FV-006 rend le manifeste public dans le DOM ; Unity ne sera autorisé à charger un asset dont l'intégrité et le repère sont décrits par le manifeste qu'après FV-008/FV-009.

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

L'UI conserve un parseur strict séparé de son agrégat de démonstration ; la consommation
réelle du manifeste est décrite ci-dessous. Les vues Sources, Historique et Journal ne
doivent jamais être alimentées par des données mockées dans ce parcours.

### Consommation web FV-006

**VÉRIFIÉ dans FV-006** : `App` choisit une branche discriminée par
`VITE_USE_MOCKS`. La valeur exacte `true` monte le dashboard `IncidentData` fictif ; la
valeur exacte `false` exige une origine HTTP(S) sans préfixe API et monte la branche
`ViewerManifest`. Toute autre configuration conduit à `N/A — mode de données non
configuré`, sans requête et sans fixture.

La branche API appelle exclusivement
`GET {VITE_API_BASE_URL}/api/v1/incident/{fire_id}/manifest`. Elle parse chaque `200`,
vérifie le `fire_id`, exige un `ETag`, puis adapte seulement le résumé public. Les requêtes
utilisent `cache: "no-store"`, `credentials: "omit"` et `If-None-Match`. Le cache contient
`{ manifest, etag, checkedAt }`, est séparé par origine, version de schéma et `fire_id`, et
utilise `sessionStorage` avec repli mémoire. Un `304` n'est accepté que pour une entrée
validée avec le même `ETag`; sinon le cache est purgé et un unique retry sans condition est
fait. Le client revalide à l'ouverture, au retour de visibilité et toutes les cinq minutes
tant que l'onglet est visible. Après un échec ultérieur, il rend la dernière valeur connue
comme obsolète au lieu de revenir au mock.

`ManifestWorkspace` est DOM-first : les métadonnées publiques de `available` sont visibles,
`not_available` reste explicite, et `withheld` ne produit aucune donnée spatiale inférée.
Sources, Historique et Journal sont des panneaux vides « non inclus dans le manifeste
public ». `TerrainViewer`, marqueurs, périmètre, simulations, exports et mode opérateur du
fixture ne sont pas montés dans la branche API. La vérification WebGL ne charge pas de GLB ;
elle explique que GLB/Unity restent à FV-008/FV-009.

**VÉRIFIÉ localement** : `npm run check`, 57 tests Vitest, le build Vite et les huit
scénarios Playwright réels traversent cette séparation, y compris l'absence de requête
GLB et de module mock en mode API. Le navigateur natif de l'environnement et un
déploiement public restent **NON VÉRIFIÉS** ; ce résultat ne constitue pas une preuve de
non-régression globale.

### Projection publique canonique

La visibilité n'est pas une préférence de rendu : elle suit la machine à états et échoue
fermée lorsqu'une ligne persistée est incohérente. La matrice versionnée de démonstration
est conservée sous `contracts/demo/v1/`.

| Statut courant | Visibilité effective | Projection viewer |
| --- | --- | --- |
| `CANDIDATE`, `UNDER_REVIEW`, `REJECTED` | `LIMITED` | `withheld` : localisation, asset et repère masqués |
| `SUSPENDED` | `SUSPENDED` | `withheld` : localisation, asset et repère masqués |
| `ACTIVE_CONFIRMED`, `MONITORING`, `EXTINGUISHED` | `PUBLIC` | `available` seulement avec asset publié conforme, sinon `not_available` |
| `CLOSED` | `PUBLIC` | `not_available` : aucun GLB ou repère public, même avec un snapshot PNG interne |
| tombstone | `TOMBSTONED` | réponse `410` Problem Details, sans manifeste |

Le jeu `FR-83-00042` est un identifiant de fixture, non une déclaration de feu ni de
localisation opérationnelle. Son seed de référence est sans asset et sert à vérifier le
fallback texte du manifeste public ; il ne déclenche aucun chargement 3D avant FV-008.

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
