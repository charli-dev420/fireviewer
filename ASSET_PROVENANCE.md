# Provenance des assets visuels

Ce registre détermine quels fichiers visuels peuvent être redistribués avec le dépôt public. Une
présence dans Git ne constitue pas, à elle seule, une preuve de droit de réutilisation.

## Assets produits par le projet

| Fichiers | Statut | Licence |
|---|---|---|
| `assets/diagrams/fire-viewer-architecture.svg` | Diagramme source du projet | CC BY 4.0 |
| `docs/roadmap/CDC_FIRE_VIEWER_V2_CONSOLIDE.docx` | Document Fire Viewer ; métadonnées contrôlées | CC BY 4.0 |
| `docs/roadmap/roadmap_fire_viewer_incident_centrique_detaillee-1.pdf` | Document Fire Viewer ; auteur déclaré « Communauté Fire-Viewer » | CC BY 4.0 |

## Provenance à confirmer avant redistribution

Les fichiers suivants sont utilisés comme images de hero, mais le dépôt ne contient actuellement
ni fichier source, ni reçu de génération, ni déclaration d'auteur permettant de vérifier leur
licence :

```text
apps/fire-viewer-ui/src/assets/public/fire-hero-about.jpg
apps/fire-viewer-ui/src/assets/public/fire-hero-accessibility.jpg
apps/fire-viewer-ui/src/assets/public/fire-hero-account.jpg
apps/fire-viewer-ui/src/assets/public/fire-hero-home.jpg
apps/fire-viewer-ui/src/assets/public/fire-hero-incidents.jpg
apps/fire-viewer-ui/src/assets/public/fire-hero-information.jpg
apps/fire-viewer-ui/src/assets/public/fire-hero-legal.jpg
apps/fire-viewer-ui/src/assets/public/fire-hero-privacy.jpg
apps/fire-viewer-ui/src/assets/public/fire-hero-report.jpg
apps/fire-viewer-ui/src/assets/public/fire-hero-settings.jpg
```

**NON VÉRIFIÉ** : ces dix JPEG ne sont pas couverts par la déclaration CC BY 4.0 du dépôt tant que
leur provenance et les droits de redistribution ne sont pas documentés. Avant une redistribution
publique, il faut soit ajouter la preuve et la licence applicables, soit les remplacer par des
visuels dont les droits sont établis.

## Règle de contribution

Tout nouvel asset doit enregistrer son auteur ou outil de génération, sa date, sa licence, sa
source autorisée et, si possible, son SHA-256. Aucun média utilisateur ou contenu opérationnel réel
ne doit être ajouté au dépôt.
