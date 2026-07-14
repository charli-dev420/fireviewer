# Plan de suite — Fire Viewer

État de référence.

Le projet vise un vertical slice G1 local, contrôlé et sans coût récurrent. Il
utilise des outils libres, SQLite local, des fichiers statiques du même domaine
et les dépendances versionnées dans le dépôt. Ce plan ne constitue ni une mise
en production, ni une autorisation d'usage opérationnel.

Règle de bascule G1.

La documentation ne suffit pas à déclarer G1 terminé. Le périmètre technique
local devient VÉRIFIÉ lorsque les contrôles ci-dessous ont été exécutés dans le
même arbre de travail et que leurs résultats sont consignés dans le registre.
Le gate de livraison devient VÉRIFIÉ uniquement lorsque la même révision Git
contient FV-006 à FV-010, le contrat du paquet spatial et son verrou de release,
et que le runbook est rejoué depuis un checkout propre :

- backend : migration vierge, second `upgrade`, seed exécuté deux fois,
  `make quality`, sauvegarde et restauration SQLite vers une cible neuve ;
- interface : `npm ci`, `npm run fetch:spatial`, `npm run check`,
  `npm run test`, `npm run test:spatial`, `npm run verify:spatial`,
  `npm run build` et la recette E2E déclarée ;
- carte : une seule zone publique `DIE-PONTAIX-08@R1`, lecture du catalogue,
  contrôle des hashes de paquet, route `/zones/die-pontaix` dans un navigateur
  WebGL, recentrage et vue d'ensemble sans chargement de GLB détaillé ;
- release : le tag binaire `spatial-die-pontaix-r1-v4`, l'archive,
  `SHA256SUMS`, l'attribution IGN et le verrou versionné concordent ; le tag
  source `spatial-die-pontaix-r1-v4-fix1` stabilise le checkout Windows ;
- runbook : exercice sur un checkout propre, sans réutiliser une base ou un
  build existant.

Un échec conserve le gate au statut BLOQUÉ, avec l'erreur et la voie de reprise
dans le registre. Aucun résultat historique n'est réinterprété ici comme une
exécution nouvelle.

Suivi d'exécution.

| ID | Objet | État documentaire actuel | Preuve attendue pour le gate |
| --- | --- | --- | --- |
| FV-001 | dépôt, licences et exclusions | historique versionné | état Git et documentation contrôlés |
| FV-002 | contrôles de baseline | historique versionné | commandes officielles rejouées |
| FV-003 | contrat public `ViewerManifest` v2 | historique versionné | schéma, OpenAPI et parseurs cohérents |
| FV-004 | contrat spatial ENU, glTF et Unity | historique versionné | transformations et révisions de zone contrôlées |
| FV-005 | seed fictif et matrice de visibilité | historique versionné | second seed sans écriture et projections sûres |
| FV-006 | UI connectée au manifeste public | historique versionné | cache, ETag/304, CORS local et parcours API |
| FV-007 | intégrité SQLite | VÉRIFIÉ le 14 juillet 2026 | 87/87 tests, 88,06 % de couverture, Ruff, mypy, migrations, compilation et restauration SQLite fraîche |
| FV-008 | paquet spatial réel Die–Pontaix | VÉRIFIÉ le 14 juillet 2026 | catalogue `1.1`, zone unique, 144 binaires invariants, provenance et release contrôlées |
| FV-009 | bridge web Giro3D | VÉRIFIÉ le 14 juillet 2026 | vue d'ensemble, recentrage, chargement conditionnel et fallback DOM par E2E bureau et émulation mobile |
| FV-010 | runbook G1 | VÉRIFIÉ le 14 juillet 2026 | release v4, tag source correctif et exercice complet dans un checkout propre |

FV-008 — paquet spatial réel, versionné et same-origin.

Cette passe remplace le scénario historique d'un GLB fictif unique. Le
catalogue `1.1` déclare une seule zone publique `DIE-PONTAIX-08@R1`, emprise
Lambert-93 `[876000, 6403000, 892000, 6413000]`. Deux emprises techniques de
couverture, `[876000, 6403000, 884000, 6411000]` et
`[884000, 6405000, 892000, 6413000]`, décrivent les secteurs LiDAR disponibles
sans devenir des zones visibles. Les huit tuiles COG, huit aperçus couleur PNG
et 128 GLB détaillés du bâti, des routes, chemins, lisières et arbres restent
bit à bit inchangés.

Le dépôt suit sous
`apps/fire-viewer-ui/public/maps/fireviewer-die-pontaix-r1-v4/` le catalogue et
le manifeste seulement ; les répertoires binaires `terrain/` et `vectors/` sont
ignorés. Le verrou de release et le manifeste IGN sont suivis sous
`contracts/spatial/releases/`. La GitHub Release
`spatial-die-pontaix-r1-v4` distribue l'archive
`fireviewer-die-pontaix-r1-v4.tar.gz`, `SHA256SUMS` et l'attribution IGN.
`npm run fetch:spatial` vérifie l'archive avant extraction, refuse les chemins
hostiles et n'installe les binaires qu'après contrôle. `npm run build` dépend
de `npm run verify:spatial` ; un build sans paquet vérifié échoue.

Le paquet est un contenu de zone, pas un manifeste d'incident. Il ne doit pas
ajouter implicitement une position, un feu ou un asset au contrat
`ViewerManifest` v2. Tout rattachement incident → révision de zone reste une
passe distincte, revue et archivée par PNG immuable.

FV-009 — bridge web Giro3D.

Unity reste l'outil d'authoring et d'export spatial. Le runtime public choisi
est Giro3D dans l'interface web, sans build Unity WebGL ni pont JavaScript/C#.
Le bridge doit :

- lire un catalogue strict et refuser les chemins sortant du paquet ;
- conserver le pont glTF local `(E, U, -N)` vers la scène Giro3D
  `(E, N, U)` ;
- afficher le relief et l'aperçu couleur à toute distance ;
- charger les GLB détaillés seulement autour de la caméra, puis les libérer
  hors de la distance configurée ;
- présenter `Zone Die–Pontaix` comme unique choix public et proposer
  `Recentrer la zone` pour revenir à l'emprise complète ;
- rester indépendant de `ViewerManifest` et de toute donnée d'incident ;
- conserver un résumé DOM explicite lorsque WebGL est indisponible, sans
  prétendre fournir le rendu 3D.

Ce choix maintient le coût d'exécution au niveau d'un site statique et évite de
maintenir deux viewers publics. Il ne modifie pas le contrat spatial Unity :
Unity reste à 100 unités par mètre, alors que les COG et GLB restent métriques.

FV-010 — runbook G1.

Le runbook de démarrage, arrêt, migration, seed, récupération du paquet,
carte, sauvegarde, restauration et rollback est
[docs/RUNBOOK_G1.md](RUNBOOK_G1.md). Il est délibérément exécutable sans
service cloud de runtime, Cesium, API cartographique externe ni dépendance
propriétaire. GitHub Releases sert uniquement à la récupération du paquet au
build, jamais aux requêtes de la carte publique.

Suite après G1.

1. Pour une nouvelle carte, créer une nouvelle release et un nouveau catalogue ;
   ne jamais remplacer `DIE-PONTAIX-08@R1` ni son archive.
2. Ajouter un registre de zones en base lorsqu'il faudra publier des zones
   supplémentaires dynamiquement ; G1 reste statique et sans lien incident →
   carte.
3. Mesurer le chargement, la mémoire WebGL et la bande passante avant toute
   compression destructrice ou tout déploiement.
4. Ajouter une publication explicite de révision spatiale vers un incident,
   avec revue humaine et archive PNG immuable, sans enrichir le manifeste public
   par défaut.
5. Préparer G2 : threat model, RBAC, minimisation des données, tests E2E
   mesurés, restauration, cache et monitoring.

Ce qui reste hors périmètre.

- carte nationale, Cesium ou fond cartographique externe ;
- incident réel, position opérationnelle sensible, preuve brute ou donnée de
  secours ;
- promesse de disponibilité, de prévision ou de confirmation automatique ;
- plusieurs writers Uvicorn sur la même SQLite ;
- déploiement public et coûts de diffusion : NON VÉRIFIÉ tant qu'une mesure
  d'hébergement et de trafic n'a pas été réalisée.
