# FIRE-VIEWER - interface publique et administration

Frontend React + TypeScript de consultation incidente-centrique. La route publique
canonique est `/incident/{fire_id}`. Les zones spatiales ne sont jamais une surface
publique : elles restent des références techniques accessibles seulement sous
`/admin/zones/*` lorsqu'un rattachement persistant les lie à un modèle.

La fiche publique charge deux contrats distincts :

- `GET /api/v1/incident/{fire_id}/manifest` : contrat léger, ETag et état du modèle ;
- `GET /api/v1/incident/{fire_id}/public-view` : projection publique versionnée des
  faits, observations validées, sources, épisodes, chronologie, téléchargements et
  limites de diffusion.

Aucune fixture, route ou prévisualisation locale ne complète une donnée manquante. Une
erreur de détail affiche un état dégradé explicite tout en conservant les métadonnées du
manifest. Le viewer GLB est chargé uniquement lorsque le manifest publie un asset ; il
ne prédit pas la propagation et ne remplace pas les consignes officielles.

L'administration utilise des routes dédiées : tableau de bord, carte opérationnelle
nationale interne, file de traitement, incidents, rapprochement spatial, signalements,
audit, état système, configuration, zones, packages et publications. Le MVP utilise un
compte administrateur unique validé par le backend ; le navigateur ne s'attribue jamais
de rôle ou de capacité.

> Les jeux de données de développement et les tests ne constituent pas un service
> d'urgence. En situation réelle, contacter les services d'urgence compétents.

## Démarrage

```bash
npm ci
npm run dev
```

Configurer une origine API explicite dans `.env.local` :

```env
VITE_API_BASE_URL=http://localhost:8000
```

Puis ouvrir par exemple :

```text
http://localhost:5173/incident/FR-83-00042
```

## Vérification

```bash
npm run check
npm run test
npm run build
npm run test:e2e
```

`npm run build` produit le site sans exiger les 417 Mo du paquet spatial local. Utiliser
`npm run build:spatial` pour vérifier ce paquet avant un build de recette. La recette E2E
conserve cette vérification, prépare une base SQLite temporaire, migre le backend puis
démarre Uvicorn et Vite avec CORS local. Elle nécessite l'environnement Python du backend.

## Structure utile

```text
src/
├── App.tsx                         routes publiques et Admin
├── lib/manifestClient.ts            manifest léger, ETag et revalidation
├── lib/publicIncidentView.ts        projection publique réelle
├── lib/adminApi.ts                  contrats et commandes Admin
├── components/public/               fiche incident et viewer GLB tactique
├── components/admin/                file, dossier incident, gouvernance et zones techniques
└── styles.css                       design system partagé
e2e/                                recettes Playwright avec backend réel
```

Les exemples sous `../../contracts/` et les données de seed backend servent aux tests de
contrat et d'intégration. Ils ne sont pas montés par l'application publique.

## Déploiement

Le dépôt fournit `vercel.json` et `public/_redirects` pour les réécritures SPA. En
production, `/api/*` est réécrit vers `https://fireviewer-api.vercel.app/api/*`, ce qui
permet au cookie Admin `SameSite=Strict` de rester sur un parcours même origine. Une
origine explicite `VITE_API_BASE_URL` reste utilisée en développement et en recette.
Les secrets, chemins de stockage et politiques d'identité ne doivent jamais être
injectés dans le bundle frontend.
