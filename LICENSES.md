# Licences et réutilisation

## Décision enregistrée le 12 juillet 2026

Le titulaire du projet a confirmé que Fire Viewer est libre, open source et gratuit.

- **Code source** : [GNU AGPL-3.0-or-later](LICENSE).
- **Documentation, roadmap et diagrammes** : [Creative Commons Attribution 4.0 International](LICENSE-DOCS.md).

**VÉRIFIÉ** : le backend fourni déclarait déjà `AGPL-3.0-or-later` et embarquait le texte de l'AGPL v3. Le fichier racine `LICENSE` est une copie identique de ce texte. L'UI et les composants communs sont désormais couverts explicitement par la licence racine.

## Portée

La licence de code s'applique aux sources Fire Viewer dans ce dépôt. La licence documentaire s'applique notamment au README, aux fichiers Markdown, au PDF de roadmap et aux diagrammes produits pour Fire Viewer.

Les dépendances tierces, données IGN, textures, modèles externes et contenus apportés par des contributeurs conservent leurs propres licences, attributions et contraintes de provenance. Une contribution ne doit être ajoutée que si son auteur peut accorder les droits correspondants.

## Donnée géodésique RAF20 distribuée via PROJ

**VÉRIFIÉ** : le profil spatial local emploie la grille publique
`fr_ign_RAF20.tif`, distribuée avec les données PROJ et épinglée à
`dc0cc2a38f0ea1029fe72cca3b5b7ed6dfe7e1db2a8d8482b7326ce3d6f25605`.
La distribution du logiciel PROJ est sous licence MIT ; la provenance CDN/IGN, le hash et
les conditions de réutilisation propres à cette grille sont conservés séparément du code
Fire Viewer.

La grille ne constitue ni un terrain, ni une texture, ni un asset GLB et ne confère aucun
droit sur de telles données. Son emploi est limité par l'[ADR-002](docs/adr/ADR-002-spatial-local-unity-contract.md)
au profil France continentale NGF-IGN69/RAF20 ; Corse et outre-mer demandent des profils et
des conditions de provenance distincts.

## Contribution

En contribuant du code, vous acceptez de le proposer sous AGPL-3.0-or-later. En contribuant de la documentation ou un diagramme, vous acceptez CC BY 4.0. Consultez [CONTRIBUTING.md](CONTRIBUTING.md) avant toute contribution.
