# Fontainebleau 2026 — EMSR894

Cette production utilise l'AOI officielle Copernicus EMSR894, tamponnée de
1 500 m pour le terrain, et les couches BD TOPO courantes servies par le WFS
public IGN. Le dernier produit `DEL` terminé est archivé comme preuve distincte
de l'incident. Son périmètre brûlé n'est pas injecté dans le terrain Unity.
Le GeoJSON d'enveloppe porte le rôle explicite
`cems-activation-aoi-not-burn-perimeter` : le producteur l'utilise pour le
découpage spatial et émet zéro anneau présenté comme une observation du feu.

Depuis la racine du dépôt :

```powershell
python tools/spatial-hybrid-zone/production-kit-france/productions/fontainebleau-forest-2026/prepare_sources.py `
  --output-root .artifacts/spatial-lidar-surface/fontainebleau-forest-r1-v1/sources

python tools/spatial-hybrid-zone/production-kit-france/run_production.py `
  --config tools/spatial-hybrid-zone/production-kit-france/productions/fontainebleau-forest-2026/zone.json `
  --plan
```

La production automatisée doit s'arrêter après `validate_catalog`. La création
de `site-upload/` exige ensuite une capture et un reçu de validation manuelle
Unity 6000.3.18f1 conformes au schéma du kit. Aucun upload ni aucune publication
ne sont déclenchés par ces commandes.

Le dry-run gelé pour cette V1 attend `208` dalles source LiDAR HD et `756`
tuiles de sortie de 500 m. Une variation est bloquante et impose une nouvelle
revue du plan avant téléchargement.

La zone couvre plus de 170 km² : `near_lod_enabled` est désactivé. Le package
ne télécharge ni ne publie les orthophotos 0,2 m et le runtime reste au profil
`mid` 0,5 m à courte distance.
