# Package global hybride — zone Justin / Die

Ce pipeline prépare **hors du site et sans téléchargement** le socle géospatial
global destiné à la validation dans Blender puis à l'intégration Giro3D :

- sélection de l'entité EFFIS `557390` dans un instantané GeoJSON local ;
- correction explicite de l'ordre non standard `[latitude, longitude]` ;
- calcul d'un tampon de 1 500 m en Lambert-93 (`EPSG:2154`) ;
- publication du périmètre et de l'emprise en WGS84 et Lambert-93 ;
- contrôle d'alignement des grilles MNT/MNS ;
- recadrage et masquage du MNT sur l'emprise exacte ;
- conversion en Cloud Optimized GeoTIFF tuilé avec vues d'ensemble ;
- catalogue et manifeste avec tailles, SHA-256, licences et provenance.

Le MNS est contrôlé et inscrit au manifeste, mais il n'est volontairement pas
publié comme terrain global. Il sert à mesurer les volumes simples et aux
modèles détaillés. L'extension locale `prepare_vector_blocks.py` ajoute les
bâtiments et blocs de végétation au catalogue après production du socle.

Pour les bâtiments, `altitude_minimale_sol` et
`altitude_maximale_toit` ne sont acceptées que si la précision altimétrique BD
TOPO est finie et inférieure ou égale à 5 m, et si la méthode d'acquisition
n'indique pas `Pas de Z`, `sans Z` ou `aucun Z`. Une altitude rejetée est
remplacée par un échantillon du MNT ; aucune altitude ou hauteur arbitraire
n'est inventée. La décision et sa méthode sont conservées par bâtiment dans
`bdtopo_z_quality`, `base_method` et `height_method`.

## Préparer le package réel

Depuis la racine du dépôt :

```powershell
python tools/spatial-hybrid-zone/prepare_zone.py `
  --mnt C:/tmp/justin-mnt-5m.tif `
  --mns C:/tmp/justin-mns-5m.tif `
  --effis C:/tmp/effis-die-current-v1.geojson `
  --output .artifacts/spatial-lidar-surface/justin-fire-2026-v1
```

Le dossier de sortie doit être nouveau. Cette contrainte empêche d'écraser une
révision déjà contrôlée. Le raster est rectangulaire et aligné sur les pixels de
5 m ; les pixels hors du polygone exact sont `nodata`. Le fichier
`vectors/area-of-interest.geojson` reste la référence d'emprise pour le web, et
sa variante `.l93.geojson` sert aux outils de production géospatiale/3D.

## Vérifier

```powershell
python tools/spatial-hybrid-zone/verify_package.py `
  .artifacts/spatial-lidar-surface/justin-fire-2026-v1

python -m unittest discover -s tools/spatial-hybrid-zone/tests -v
```

La vérification recalcule tous les SHA-256 publiés, contrôle les relations
géométriques, le statut différé du MNS et les propriétés COG du MNT.

## Limite de vérité opérationnelle

Le polygone EFFIS est une enveloppe de surface brûlée détectée par satellite. Il
ne doit pas être présenté comme un relevé tactique du front de feu. Le package
conserve l'identifiant, les dates et le hash de l'instantané afin que cette
limite et l'état de la donnée restent auditables.
