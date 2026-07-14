# Architecture cible

![Architecture Fire Viewer](../assets/diagrams/fire-viewer-architecture.svg)

Source de vérité et flux de données.

```text
observations -> API transactionnelle -> audit / matching / états
                                      -> manifeste courant -> client web strict
                                                           -> rendu DOM public minimal
Unity d'authoring -> paquet spatial statique versionné -> route de zone
                                                    -> Giro3D WebGL ou résumé DOM
```

Le backend est responsable des identifiants, de l'audit, des règles de matching et de la publication de manifestes. L'UI affiche la situation avant toute initialisation 3D. Le manifeste public reste rendu dans le DOM ; la carte de zone est un paquet statique distinct, préparé dans Unity puis rendu par Giro3D, sans association implicite à un incident.

Identifiants stables.

| Identifiant | Rôle |
| --- | --- |
| `fire_id` | Série géographique persistante et route publique stable |
| `episode_id` | Période opérationnelle immuable, y compris une réactivation |
| `asset_id` + version | Modèle terrain/3D immuable, hashé et publiable atomiquement |
| `trace_id` | Corrélation d'une opération métier et de son audit |

Contrat de viewer public v2.

L'[ADR-001](adr/ADR-001-viewer-manifest-public-contract.md) fixe le contrat à :

- `GET /api/v1/incident/{fire_id}/manifest`, sous forme `ViewerManifest` v2 en `snake_case` ;
- `schema_version: "2.0"` obligatoire, `fire_id` validé et `ETag` calculé sur la représentation complète ;
- `200` ou `304` conditionnel pour un manifeste, `400`, `404`, `410` et `503` en Problem Details ; `409` reste réservé aux mutations ;
- CORS configurable, avec `If-None-Match` autorisé et `ETag` exposé pour les origines de développement documentées ;
- trois états explicites : `available`, `not_available` et `withheld`. Le dernier masque localisation, asset et repère.

L'UI conserve un parseur strict séparé de son agrégat de démonstration ; la consommation
réelle du manifeste est décrite ci-dessous. Les vues Sources, Historique et Journal ne
doivent jamais être alimentées par des données mockées dans ce parcours.

Consommation web FV-006.

VÉRIFIÉ dans FV-006 : `App` choisit une branche discriminée par
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
fixture ne sont pas montés dans la branche API. La vérification WebGL du manifeste ne charge
pas de GLB ; la carte de zone est un parcours distinct qui utilise son propre paquet statique.

VÉRIFIÉ localement le 14 juillet 2026 : `npm run check`, 65 tests Vitest, le
build Vite et les huit scénarios Playwright réels traversent cette séparation,
y compris l'absence de requête GLB et de module mock en mode API. Le déploiement
public et le contrôle dans les navigateurs ciblés restent NON VÉRIFIÉS ; ce
résultat ne constitue pas une preuve de non-régression globale.

Projection publique canonique.

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

Contrat spatial.

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

VÉRIFIÉ : les points de contrôle fictifs WGS84/ENU/Unity, le facteur ×100, le
hash RAF20 et la migration SQLite sont traversés par les tests backend. NON
VÉRIFIÉ : l'import d'un GLB réel dans Unity, la production matérielle du PNG et
l'exécution de la migration sur une instance PostgreSQL restent nécessaires
avant de déclarer un terrain 3D aligné en intégration.

Paquet spatial G1.

G1 publie une seule zone logique `DIE-PONTAIX-08@R1`. Son catalogue `1.1`
déclare l'emprise Lambert-93 `[876000, 6403000, 892000, 6413000]` et deux
emprises techniques de couverture : `[876000, 6403000, 884000, 6411000]` et
`[884000, 6405000, 892000, 6413000]`. Ces couvertures servent à localiser les
assets disponibles ; elles ne sont jamais deux zones publiques ni deux choix
dans l'interface. Les huit COG, huit PNG et 128 GLB sont tous rattachés à cette
unique identité, sans modifier leur nom, leur taille ou leur SHA-256.

Le dépôt versionne le catalogue, le manifeste de paquet, le verrou de release
`contracts/spatial/releases/fireviewer-die-pontaix-r1-v4.release-lock.json` et
la provenance `contracts/spatial/releases/ign_sources.v1.json`. Seuls les
répertoires binaires installés sous
`apps/fire-viewer-ui/public/maps/fireviewer-die-pontaix-r1-v4/` sont ignorés.
La release GitHub publique `spatial-die-pontaix-r1-v4` fournit l'archive
`fireviewer-die-pontaix-r1-v4.tar.gz`, `SHA256SUMS` et l'attribution IGN. Le
tag source `spatial-die-pontaix-r1-v4-fix1` force les fins de ligne LF des
contrats hashés sans modifier le tag associé à la release v4. La release sert
au clone et au build, jamais au runtime public : Giro3D ne charge que des
chemins same-origin après installation locale du paquet.

La publication des trois assets et leur consommation par un clone neuf sont
VÉRIFIÉES. Leur conservation est contrôlée par les hashes versionnés. Le
verrouillage technique du tag et de la release GitHub reste NON VÉRIFIÉ : l'API
publique indiquait `immutable: false` lors du contrôle.

`npm run fetch:spatial` télécharge ou reçoit une archive locale, vérifie son
hash, refuse les entrées hostiles et installe dans un répertoire temporaire.
`npm run verify:spatial` recalcule ensuite les hashes du catalogue et du
manifeste avant publication des fichiers. Le build dépend de cette dernière
vérification ; il ne peut pas fabriquer un site dont la carte est absente ou
non contrôlée. Aucun registre spatial en base ni lien incident → zone n'est
introduit dans G1.

La source de vérité du vertical slice reste une seule SQLite en WAL avec un seul écrivain.
`BEGIN IMMEDIATE` sérialise la création, le rattachement et la revue; une clé
d'idempotence concurrente ne crée qu'un seul agrégat et son rejeu ne double ni audit ni
outbox. Les égalités de score sont départagées par identifiants stables, et les liens
persistés observation → incident → épisode sont complets, cohérents et non déplaçables par
SQL direct.

La migration `e7a4c9d8f2b1` impose ces liens sur SQLite. Les audits de création, revue,
réactivation et rejet conservent des snapshots hashés, et les triggers refusent toute
modification ou suppression du journal. Une sauvegarde/restauration locale vérifie
intégrité, clés étrangères, révision, hashes et tous les triggers critiques. La restauration
écrit uniquement une cible neuve après migration et validation d'un fichier temporaire; elle
ne modifie pas la source ni une cible existante.

Ce mécanisme reste volontairement sans coût récurrent : fichiers SQLite locaux et outils
open source déjà présents. L'exécution réelle de l'image Docker et la reprise sur
PostgreSQL/PostGIS restent hors des tests SQLite.

Limites de sécurité.

- Les agents IA ne confirment jamais seuls un incident.
- Une position non confirmée ou sensible ne doit pas être rendue publique.
- Un asset non hashé, invalide ou hors contrat spatial ne doit pas être chargé.
- Sans WebGL ou réseau, les informations textuelles restent accessibles avec un état dégradé explicite.
