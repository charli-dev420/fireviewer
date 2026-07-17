# Design QA - interface publique FireWarning

## Références

- Accueil : rendu desktop et mobile fourni dans `firewarning-homepage(1).zip`.
- Pages de base : six maquettes desktop/mobile fournies pour Compte, Réglages, Fonctionnement, Confidentialité, Accessibilité et Mentions légales.
- Direction artistique : papier clair texturé, encre bleu nuit, accent orange, photographie d'orage et d'incendie contenue dans les heroes.

## Contrôles observés

- OBSERVÉ : l'accueil reprend la structure web du projet ZIP et ne présente pas une navigation d'application mobile.
- OBSERVÉ : les pages Compte, Réglages, Fonctionnement, Confidentialité, Accessibilité et Mentions légales suivent les compositions de leurs maquettes de référence.
- OBSERVÉ : chaque route à hero utilise une photographie distincte ; le hero de l'accueil n'est pas réutilisé sur les pages internes.
- OBSERVÉ : les backgrounds laissent une zone sombre à gauche afin de conserver un contraste suffisant avec les titres blancs.
- OBSERVÉ : le menu mobile remplace la navigation desktop sous 900 px, sans barre de navigation d'application en bas d'écran.
- OBSERVÉ : les cartes desktop deviennent des listes ou accordéons adaptés au mobile.
- OBSERVÉ : le parcours `/signaler` reprend le hero orage/incendie dédié, puis une barrière d'urgence et un formulaire papier en six étapes.
- OBSERVÉ : les sous-pages `Ajouter une preuve`, `Signaler une erreur` et `Suivi` utilisent un en-tête compact bleu nuit afin de ne pas répéter le même hero raster.
- OBSERVÉ : aucun vert fonctionnel n'est utilisé dans les surfaces publiques contrôlées ; l'accent actif est orange.
- OBSERVÉ : le menu mobile expose Accueil, Incendies, Signaler, Fonctionnement, Compte, Réglages, Accessibilité, Confidentialité et Mentions légales.

## Preuves de rendu

- `.artifacts/account-desktop-v2.png`
- `.artifacts/settings-mobile-v2.png`
- `.artifacts/operation-desktop-v2.png`
- `.artifacts/privacy-desktop-v2.png`
- `.artifacts/accessibility-mobile-v2.png`
- `.artifacts/report-desktop-v3.png`
- `.artifacts/report-form-mobile-v5.png`
- `.artifacts/add-evidence-desktop-v3.png`
- `.artifacts/incident-error-mobile-v3.png`
- `.artifacts/public-menu-mobile-v4.png`

## Résultat

- VÉRIFIÉ : aucun défaut P0, P1 ou P2 constaté sur les captures ci-dessus.
- VÉRIFIÉ : le contrôle mobile d'état d'accessibilité affiche désormais son chevron au lieu d'un bouton vide.
- VÉRIFIÉ : aucun débordement horizontal n'est présent à 390 px sur les trois nouveaux parcours.
- VÉRIFIÉ : le menu mobile s'ouvre au-dessus du contenu et reste intégralement défilable.
- VÉRIFIÉ : aucun message d'erreur console n'a été observé pendant les captures desktop et mobile.
- P3 : les pages de contribution n'ont pas de maquette dédiée pixel-perfect ; leur contrôle porte sur la fidélité au système visuel validé et aux exigences fonctionnelles fournies.

final result: passed
