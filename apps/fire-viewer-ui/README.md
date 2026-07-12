# FIRE-VIEWER — UI / Frontend

Frontend React + TypeScript prêt à intégrer pour une page incidente-centrique stable :

- route canonique `/incident/{fire_id}` ;
- vue opérationnelle avec terrain SVG de démonstration, observations, incertitude et couches ;
- vues **Sources & confiance**, **Historique** et **Journal** ;
- mode public / opérateur de démonstration ;
- vue texte complète lorsque la 3D est indisponible ;
- mode hors ligne explicite ;
- simulation d’un hot-swap v4 → v5 sans perte des marqueurs ;
- responsive desktop, tablette et mobile avec bottom sheet ;
- navigation clavier, focus visible, libellés accessibles, cible tactile minimale de 44 px ;
- exports JSON de démonstration avec provenance et avertissement.

> Le contenu et les incidents sont fictifs. Cette interface ne constitue pas un service d’urgence certifié et ne doit jamais retarder un appel au 18 ou au 112.

## Démarrage

```bash
npm ci
npm run dev
```

Ouvrir ensuite :

```text
http://localhost:5173/incident/FR-83-00042
```

Build de production :

```bash
npm run check
npm run test
npm run build
npm run preview
```

## Contrat `ViewerManifest`

FV-003 ajoute un parseur strict du DTO réseau `ViewerManifest` dans
`src/lib/viewerManifest.ts`. Il n'accepte que le contrat public `snake_case`
version `2.0` et les trois états `available`, `not_available` et `withheld`.
Les exemples fictifs partagés sont testés depuis
`../../contracts/viewer-manifest/v2/examples/`.

Le parseur fournit aussi un résumé minimal dont les collections **Sources**,
**Historique** et **Journal** sont volontairement vides : le manifeste public
ne contient pas ces données et ne doit jamais être complété avec le fixture de
démonstration lorsque les mocks seront désactivés.

## Connexion à une API

Le projet utilise les données fictives par défaut. Copier `.env.example` vers `.env.local` :

```env
VITE_USE_MOCKS=false
VITE_API_BASE_URL=https://api.example.org
```

L’adaptateur existant `src/lib/api.ts` attend encore un objet `IncidentData`
complet sur :

```text
GET /incident/{fire_id}
```

Le raccordement réel du manifeste est volontairement différé à FV-006. Le
contrat public canonique à employer à ce moment-là est :

```text
GET /api/v1/incident/{fire_id}/manifest
```

Il faudra alors utiliser `parseViewerManifest()` et son résumé public, sans
fabriquer les données Sources, Historique ou Journal attendues par la démo.

Les URLs fournies au viewer doivent déjà être validées côté serveur. Le frontend ne transmet pas d’URL arbitraire à un moteur 3D.

## Structure

```text
src/
├── App.tsx                     orchestration, route, états, mode dégradé
├── fixtures/demoIncident.ts    jeu de données fictif versionné
├── lib/api.ts                  validation de fire_id et adaptateur API
├── lib/viewerManifest.ts       parseur strict du contrat réseau public
├── lib/format.ts               formats français et fuseau Europe/Paris
├── types.ts                    contrats TypeScript
├── components/
│   ├── AppHeader.tsx           identité, statut, menu de démonstration
│   ├── PrimaryNav.tsx          vues de l’incident
│   ├── ViewerWorkspace.tsx     composition desktop/mobile
│   ├── TerrainViewer.tsx       rendu SVG remplaçable par Unity/Three/Babylon
│   ├── SituationPanel.tsx      faits, fraîcheur, urgence
│   ├── SynthesisPanel.tsx      confiance, alertes, couches
│   ├── SourcesView.tsx         preuves, provenance, incertitude
│   ├── HistoryView.tsx         épisodes et versions immuables
│   ├── JournalView.tsx         audit append-only
│   └── TextViewDialog.tsx      alternative complète au canvas
└── styles.css                  design system et responsive
```

## Remplacer le terrain SVG par Unity Web

Le composant `TerrainViewer.tsx` constitue le point d’intégration. Conserver :

1. les contrôles critiques dans le DOM ;
2. la vue texte et les métadonnées hors canvas ;
3. les états `METADATA_READY`, `MODEL_LOADING`, `READY`, `DEGRADED` et `ERROR` ;
4. les marqueurs en coordonnées géographiques côté contrat ;
5. le modèle actuel tant que la nouvelle version n’a pas répondu `READY` ;
6. le hash, la version et la fraîcheur visibles dans l’interface.

## Déploiement statique

Le dépôt contient :

- `vercel.json` pour les réécritures SPA ;
- `public/_redirects` pour Netlify / plateformes compatibles ;
- aucune ressource distante nécessaire au rendu de démonstration.

Pour Nginx, ajouter une réécriture de toutes les routes incident vers `index.html`.

## Vérifications recommandées avant mise en ligne

- brancher le schéma JSON réel et refuser les champs/versions incompatibles ;
- ajouter les tests Playwright multi-navigateurs ;
- tester clavier, lecteur d’écran, contraste et zoom 200 % ;
- configurer CSP, HSTS, Referrer-Policy et Permissions-Policy ;
- mesurer le poids du shell, le pic mémoire et les LOD sur appareils réels ;
- ne jamais exposer les preuves brutes ou coordonnées sensibles dans la vue publique ;
- conserver le mode texte lorsque WebGL, Unity, le réseau ou le GLB échouent.
