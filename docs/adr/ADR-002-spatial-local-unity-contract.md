# ADR-002 — Contrat spatial local ENU et Unity

- **Statut** : accepté
- **Date** : 12 juillet 2026
- **Décideurs** : projet Fire Viewer

## Contexte

La roadmap demande un terrain local géoréférencé, avec une origine explicite, des unités
contrôlées et une provenance reproductible. Le projet Unity de Die externe emploie une
présentation à `100` unités Unity par mètre, alors que le pipeline terrain et glTF doit
rester métrique. Sans convention explicite, ce décalage crée le risque H3 de marqueurs,
distances et assets mal alignés.

Cette décision couvre les zones rurales locales de **France continentale** uniquement.
La Corse et les outre-mer sont explicitement hors périmètre : RAF20/NGF-IGN69 ne doit pas
être utilisé pour les représenter. Une future décision devra traiter la Corse avec
RAC23/NGF-IGN78 et définir les référentiels adaptés aux outre-mer.

## Décision

### Référentiel, hauteur et zone locale

- Toute origine de zone publiée est exprimée en WGS 84 tridimensionnel, **EPSG:4979**
  (`longitude`, `latitude`, hauteur ellipsoïdale `h`, en mètres). Toute forme tableau
  `origin_wgs84` respecte strictement l'ordre `[longitude, latitude, hauteur]`.
- Pour les données sources continentales, la hauteur fournie en **NGF-IGN69** (`H`) est
  convertie avec la grille **RAF20** : `h = H + N_RAF20`. Le manifest de zone conserve la
  hauteur source, l'ondulation appliquée et le résultat EPSG:4979 ; il ne les recalcule
  jamais implicitement.
- La grille est épinglée à l'artefact officiel
  `https://cdn.proj.org/fr_ign_RAF20.tif`, SHA-256
  `dc0cc2a38f0ea1029fe72cca3b5b7ed6dfe7e1db2a8d8482b7326ce3d6f25605`.
  Elle est distribuée comme donnée PROJ locale du backend, vérifiée par hash ; la
  transformation ne dépend d'aucun téléchargement réseau à l'exécution.
- Chaque zone a une origine EPSG:4979, un repère tangent local **ENU** (Est, Nord, Haut)
  en mètres, une emprise déclarée et un identifiant stable `zone_id`.
- Une zone est rurale et locale : elle est réutilisable seulement à l'intérieur de son
  emprise et de sa tolérance déclarées. Elle ne représente ni une carte nationale ni un
  globe.

### glTF et Unity

- Le contenu géométrique GLB reste métrique : `1` unité glTF = `1 mètre ENU`
  (`gltf_meters_per_unit = 1.0`).
- L'export glTF droitier, Y vers le haut, est fixé à
  `gltf_m = (E, U, -N)`. Cette règle est versionnée dans le snapshot spatial.
- Unity reçoit le même repère local avec une échelle de **100 unités Unity par mètre** :
  `unity_units = (100E, 100U, 100N)`. Le champ
  `ViewerManifest.frame.meters_per_unit` décrit ce monde de rendu et vaut donc `0.01`.
  L'adaptateur glTF vers Unity applique `(x, y, z) -> (100x, 100y, -100z)` ; aucun
  facteur d'échelle implicite ne peut être ajouté par scène ou prefab.
- Ces conventions concernent les coordonnées locales seulement. Latitude, longitude,
  hauteur, datum et version de zone restent hors de la scène Unity et sont fournis par le
  snapshot immuable.
- **Cesium n'est pas retenu** : pas de globe, de tuiles Cesium ni de géoréférencement
  global exécuté dans Unity pour cette phase.

### Versioning, snapshots et archives

- Une zone est versionnée par le couple immuable `(zone_id, zone_revision)`. Tout
  changement d'origine, d'emprise, de transformation verticale, de grille RAF20, d'axes
  ou d'échelle crée une nouvelle révision ; une ancienne révision n'est pas modifiée.
- Chaque asset GLB publié référence exactement une révision de zone au moyen d'un
  `spatial_snapshot`. Le snapshot contient le repère, la conversion verticale, les axes,
  l'échelle Unity et l'archive de prévisualisation.
- Chaque archive de révision de manifeste/incident conserve une archive PNG immuable de
  prévisualisation : URI d'archive, SHA-256, dimensions, date de génération et emprise.
  Le PNG appartient à un `spatial_snapshot` précis ; il n'est pas une propriété obligatoire
  de toute zone active. Il sert de preuve visuelle et ne remplace ni le terrain source, ni
  le GLB, ni les métadonnées géodésiques.
- Les conditions de réutilisation et l'attribution associées à la grille officielle
  doivent accompagner la donnée PROJ distribuée. Aucun droit supplémentaire n'est déduit
  par ce contrat.

## Validation FV-004

- Les fixtures `contracts/spatial/v1/fixtures/` prouvent les axes et l'échelle par des
  points fictifs ENU, glTF et Unity ; le round-trip doit rester inférieur ou égal à
  `0.001 m` (`0.1` unité Unity).
- Le registre de zones, une révision et un snapshot fictifs doivent valider contre le
  schéma JSON spatial v1 et référencer la même paire `(zone_id, zone_revision)`.
- FV-004 exécute les contrôles de transformation ENU/Unity/glTF, de changement d'origine,
  de hash RAF20 et d'axes à partir des fixtures. Le hash de l'archive PNG est contrôlé sur
  le snapshot lorsqu'un PNG est présent.
- Le rendu effectif d'un GLB dans Unity et la production matérielle d'une archive PNG ne
  font pas partie de cette passe documentaire ; ils restent des validations d'intégration.

## Conséquences et limites

- **VÉRIFIÉ dans les artefacts FV-004** : le contrat, les fixtures fictives, la portée
  continentale et la grille RAF20 locale épinglée sont documentés.
- **NON VÉRIFIÉ** : aucun GLB rendu dans Unity ni archive PNG matérielle n'est produit par
  cette ADR, et la migration n'a pas été exécutée sur une instance PostgreSQL. Ces preuves
  d'intégration restent requises avant d'affirmer qu'un viewer 3D est aligné.
- La décision ne rend pas les coordonnées, les assets ou les données terrain publics ;
  les règles de visibilité du `ViewerManifest` restent applicables.
