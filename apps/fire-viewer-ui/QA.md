# Vérifications effectuées

- `npm run build` : TypeScript strict et build Vite réussis.
- `npm audit` : aucune vulnérabilité signalée au moment de la génération.
- Affichage contrôlé sous Chromium aux largeurs 320, 430, 768, 1280 et 1536 px.
- Aucun débordement horizontal détecté sur les largeurs testées.
- Aucune erreur JavaScript ou erreur console sur les captures finales.
- Routes invalides rejetées par la validation stricte du `fire_id`.
- États vérifiés : chargement des métadonnées, chargement du modèle, prêt, mode dégradé et hors ligne.
- Vues vérifiées : Vue 3D, Sources & confiance, Historique, Journal et Vue texte.
- Interactions vérifiées : filtres, toggles de couches, ouverture des détails, changement de rôle, prévisualisation de version et simulation de hot-swap.

Ces contrôles valident le frontend de démonstration, pas un usage opérationnel ni une certification de sécurité publique.
