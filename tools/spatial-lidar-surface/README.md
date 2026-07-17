# Production LiDAR directe

Cette chaîne produit une surface 3D directement depuis le MNS LiDAR HD IGN à
0,50 m. Elle n'ajoute aucun arbre, bâtiment, toit, route ou autre modèle 3D.
Les éléments visibles sont uniquement ceux présents dans les altitudes du MNS.

Le MNT est lu uniquement pour calculer des statistiques de hauteur au-dessus du
sol. Il ne modifie jamais la géométrie exportée.

## Production pilote

```powershell
python tools/spatial-lidar-surface/fetch_orthophoto.py `
  --source-project D:\chemin\vers\les-sources-lidar `
  --tile-id DIE-08-T00-V33 `
  --output .artifacts/spatial-lidar-surface/sources/DIE-08-T00-V33-orthophoto-ign.tif

python tools/spatial-lidar-surface/produce.py `
  --source-project D:\chemin\vers\les-sources-lidar `
  --workspace .artifacts/spatial-lidar-surface `
  --tile-id DIE-08-T00-V33 `
  --orthophoto .artifacts/spatial-lidar-surface/sources/DIE-08-T00-V33-orthophoto-ign.tif `
  --force
```

Contrôle indépendant :

```powershell
python tools/spatial-lidar-surface/verify.py `
  .artifacts/spatial-lidar-surface/DIE-08-T00-V33/catalog.json
```

## Architecture de diffusion

- `far-domain/` contient le LOD3 MNT 10 m pour les 128 km². Il reste toujours
  disponible comme socle et comme repli pendant un chargement.
- `near-cache/` contient uniquement les LOD0, LOD1 et LOD2 MNS des tuiles
  effectivement consultées.
- `orthophoto-cache/` conserve les orthophotos IGN associées au cache proche.
- `near-cache/index.json` porte la date du dernier accès, le poids et le plafond
  LRU. Le plafond par défaut est 12 Go.

Production du socle complet :

```powershell
python tools/spatial-lidar-surface/produce_far_domain.py `
  --source-project D:\chemin\vers\les-sources-lidar `
  --workspace .artifacts/spatial-lidar-surface `
  --force
```

Mise en cache d'une zone consultée :

```powershell
python tools/spatial-lidar-surface/cache_near.py `
  --source-project D:\chemin\vers\les-sources-lidar `
  --workspace .artifacts/spatial-lidar-surface `
  --tile-id DIE-08-T00-V33
```

Le rendu doit conserver le LOD3 jusqu'au chargement complet du cache proche,
puis effectuer un fondu croisé. Il ne faut pas interpoler géométriquement le MNS
vers le MNT : les bâtiments et la canopée peuvent présenter plusieurs dizaines
de mètres de différence verticale.

Assemblage de l'index consommable par un chargeur :

```powershell
python tools/spatial-lidar-surface/assemble_runtime_index.py `
  --workspace .artifacts/spatial-lidar-surface
```

La sortie contient 16 secteurs de 250 m. Chaque secteur possède quatre niveaux
de détail : MNS 0,50 m, MNS 1 m, MNS 2 m et MNT 10 m. Les niveaux MNS moins
détaillés sont des sous-échantillonnages exacts ; aucun lissage ni reconstruction
n'est appliqué. Le MNT 10 m est réservé à la très longue distance afin d'obtenir
un aplat stable sans scintillement des bâtiments et de la canopée.

L'orthophoto est utilisée uniquement comme couleur de sommet. Elle ne déplace,
n'ajoute ou ne supprime aucun sommet du maillage LiDAR.

## Limite connue

Le MNS est une grille 2,5D : il décrit la première surface vue depuis le ciel.
Il restitue les toits, les routes, le relief et la canopée mesurés, mais pas les
façades verticales, les dessous de végétation ni les surplombs. Pour ces éléments,
il faut repartir des points LiDAR classés LAS/LAZ/COPC, absents du dossier source.
