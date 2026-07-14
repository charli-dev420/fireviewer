# Registre des problèmes, corrections et validations

Règle du registre.

Une ligne n'est marquée VÉRIFIÉE que si la commande, le test ou le comportement
réel a été exécuté pour cette ligne. Les entrées antérieures sont conservées
comme preuves historiques : cette mise à jour documentaire ne les rejoue pas.
Une limite reste NON VÉRIFIÉE jusqu'à son contrôle explicite.

Historique FV-005 — seed fictif et matrice publique.

| ID | État de la passe | Problème | Correction conservée | Preuve historique ou limite |
| --- | --- | --- | --- | --- |
| FV5-001 | preuve historique | Le seed `FR-83-00042` dépendait de références réalistes et ne prouvait pas sa réexécution. | Dataset déclaratif fictif, sans asset publié, collision non destructive et ETag calculé. | Création, second passage sans écriture, collision et manifeste/hash étaient consignés. |
| FV5-002 | preuve historique | Des couples `UNDER_REVIEW + available` et `REJECTED + not_available` étaient acceptés. | Politique canonique partagée par création, transition, projection et parseur UI. | Transitions, Pydantic, fixtures JSON et Vitest étaient consignés. |
| FV5-003 | preuve historique | Une paire statut/visibilité incohérente pouvait être projetée de manière ambiguë. | Échec fermé en `503 incident_inconsistent`, sans localisation, asset ni frame. | Test d'injection de combinaison incohérente consigné. |
| FV5-004 | preuve historique | Le mock runtime utilisait une URL `.invalid` réservée aux tests. | Maquette locale `mock://`, sans GLB, URL externe ni manifeste publié. | Typecheck, tests et build étaient consignés. |
| FV5-005 | preuve historique | Gitleaks signalait des littéraux d'idempotence de test. | Littéraux dérivés du suffixe de scénario sans réduire la couverture. | Scan ciblé propre consigné. |
| FV5-006 | limite active | Une commande Alembic manuelle a visé l'URL par défaut au lieu d'une base temporaire. | Les contrôles suivants injectent l'URL SQLite temporaire dans `alembic.config.Config`. | État antérieur de la base locale : NON VÉRIFIÉ. |

Historique FV-006 — raccordement réel de l'UI.

| ID | État de la passe | Problème | Correction conservée | Preuve historique ou limite |
| --- | --- | --- | --- | --- |
| FV6-001 | preuve historique | Les mocks pouvaient s'activer implicitement. | `VITE_USE_MOCKS` exige `true` ou `false` avec origine HTTP(S) pure ; sinon N/A sans requête. | Tests de configuration et build étaient consignés. |
| FV6-002 | preuve historique | Un `304` sans corps pouvait réutiliser un cache invalide. | Cache séparé par origine, schéma et `fire_id`, ETag strict, purge et unique retry inconditionnel. | Tests `200/304`, cache corrompu, timeout et E2E étaient consignés. |
| FV6-003 | preuve historique | Le dashboard riche pouvait injecter des données mockées dans la vue API. | Branches mock/API séparées ; panneaux vides explicites ; aucun SVG, GLB ou Unity en mode API. | Tests jsdom, build et recette navigateur étaient consignés. |
| FV6-004 | preuve historique | Une recette E2E pouvait appliquer Alembic à la base par défaut. | URL SQLite temporaire absolue, refus de l'URL de développement et nettoyage du répertoire temporaire. | Huit scénarios E2E étaient consignés. |
| FV6-005 | preuve historique | Un manifeste `available` pouvait déclencher un asset 3D prématuré. | Métadonnées seules et indication WebGL textuelle dans le parcours API. | Tests WebGL et absence de requête GLB consignés. |
| FV6-006 | preuve historique | Un import mock inconditionnel émettait son chunk dans le build API. | Import plié derrière `VITE_USE_MOCKS=true`. | Builds API, N/A et mock distingués dans la preuve historique. |
| FV6-007 | preuve historique | `mypy .` traversait un build généré hors contrôle officiel. | La qualité suit les cibles déclarées, via `make typecheck`. | Contrôles backend historiques consignés. |
| FV6-008 | preuve historique | Un scan large traversait l'environnement virtuel ignoré. | Scan ancré sur le diff Git et les fichiers non suivis pertinents. | Gitleaks ciblé propre consigné. |

Historique FV-007 — intégrité SQLite.

VÉRIFIÉ le 14 juillet 2026 : 87/87 tests backend, couverture 88,06 %, Ruff,
mypy, migrations et compilation ont passé. Une sauvegarde et une restauration
SQLite fraîche ont été exécutées ; une base locale a aussi été sauvegardée avant
la migration `c6d4f13a9b20 -> e7a4c9d8f2b1`. Le package editable a été
réinstallé sans dépendances et `fire-viewer-restore --help` fonctionne.

| ID | État de la passe | Problème | Correction conservée | Preuve historique ou limite |
| --- | --- | --- | --- | --- |
| FV7-001 | VÉRIFIÉ le 14 juillet 2026 | Des liens observation/incident/épisode pouvaient être incomplets ou traverser deux incidents par SQL direct. | Migration `e7a4c9d8f2b1`, contraintes de paire, contrôles de cohérence et immuabilité de `episode.incident_id`. | Attach réel et écritures SQL directes sont couverts par la suite backend exécutée. |
| FV7-002 | VÉRIFIÉ le 14 juillet 2026 | Les scores égaux et les replays idempotents pouvaient ne pas être déterministes. | Départage stable, idempotence concurrente et réponses `create/attach/review` rejouables. | Contrôles concurrentiels SQLite dans les 87 tests exécutés. |
| FV7-003 | VÉRIFIÉ le 14 juillet 2026 | Un trigger audit affaibli pouvait être accepté par le contrôle de backup. | Comparaison de définition et hash des triggers append-only, plus contrôle des 26 triggers critiques. | Sauvegarde/restauration fraîche exécutée et contrôle de migration passé. |
| FV7-004 | VÉRIFIÉ le 14 juillet 2026 | Une restauration risquait de modifier la source ou une cible existante. | Copie lecture seule vers `.part`, migration privée, validation puis publication vers cible neuve. | Sauvegarde/restauration fraîche et migration `c6d4f13a9b20 -> e7a4c9d8f2b1` exécutées. |
| FV7-005 | limite active | Docker réellement exécuté et PostgreSQL/PostGIS n'entraient pas dans la preuve SQLite. | Aucun contournement ajouté. | NON VÉRIFIÉ. |

FV-008 — paquet spatial réel Die–Pontaix.

| ID | État actuel | Problème observé | Décision ou correction | Preuve disponible ou limite |
| --- | --- | --- | --- | --- |
| FV8-001 | preuve historique le 14 juillet 2026 | Le plan d'origine ne prévoyait qu'un GLB fictif alors que le produit devait montrer un territoire rural réel et complet. | FV-008 a introduit un paquet de zone : COG LiDAR, PNG, GLB, catalogue et manifeste de paquet. G1 remplace la présentation de deux secteurs par une zone publique unique. | `npm run verify:spatial` historique a validé 146 fichiers, 144 assets et 416 988 759 octets. La révision G1 doit rejouer la preuve. |
| FV8-002 | preuve historique le 14 juillet 2026 | Un asset chargé hors du paquet pourrait contourner la portée publique et le contrôle de provenance. | Le contrôle historique refusait chemins absolus, `..` et préfixes inattendus. G1 ajoute le verrou de release, la provenance IGN versionnée et l'installation atomique du paquet. | Le recalcul par le navigateur après téléchargement reste NON VÉRIFIÉ ; il n'est pas requis puisque GitHub n'est pas une origine runtime. |
| FV8-003 | OBSERVÉ | Une carte de zone pourrait être interprétée comme un incident ou révéler une information opérationnelle. | La route de zone est séparée de `ViewerManifest`; aucune liaison incident → zone n'est créée par le client. | Le commentaire et le chemin d'exécution du renderer sont présents. La politique de publication d'une zone réelle reste à formaliser avant déploiement public. |
| FV8-004 | À exécuter | Une optimisation de poids pourrait dégrader bâtiments, routes, lisières ou relief. | Mesurer d'abord le rendu, la mémoire et la bande passante ; ne compresser qu'avec comparaison visuelle et seuils explicites. | NON VÉRIFIÉ : budget de performance et de diffusion. |

FV-009 — bridge web Giro3D.

| ID | État actuel | Problème observé | Décision ou correction | Preuve disponible ou limite |
| --- | --- | --- | --- | --- |
| FV9-001 | VÉRIFIÉ le 14 juillet 2026 | Un runtime Unity WebGL ajouterait un second viewer et un coût de transfert sans résoudre le besoin de carte statique. | Unity reste l'outil d'authoring ; Giro3D est le renderer public. | `Giro3DMap.tsx` importe Giro3D, Three et GLTFLoader ; aucun runtime Unity n'est chargé dans le build. |
| FV9-002 | OBSERVÉ | Les COG et GLB n'ont pas le même repère local. | Le bridge applique glTF `(E,U,-N)` → Giro3D `(E,N,U)` par rotation X +90°, puis pose chaque GLB sur son origine L93/NGF. | Transformation visible dans le code ; points de contrôle géodésiques dans le navigateur : NON VÉRIFIÉ. |
| FV9-003 | VÉRIFIÉ le 14 juillet 2026 | Garder tous les détails à la vue lointaine augmenterait mémoire et trafic. | Détails dans un rayon de 2 500 m ; retrait au-delà de 6 000 m caméra-cible ; COG et PNG restent visibles. | La politique est testée dans le navigateur avec une vue détaillée. Les mesures réelles de mémoire et de trafic restent NON VÉRIFIÉES. |
| FV9-004 | VÉRIFIÉ le 14 juillet 2026 | Sans WebGL, la carte ne peut pas rendre de relief utile. | La route de zone conserve un résumé DOM explicite, sans faux rendu 3D ; le parcours incident reste indépendant. | Test jsdom sans WebGL passé. Contrôle navigateur de tous les moteurs ciblés : NON VÉRIFIÉ. |
| FV9-005 | VÉRIFIÉ le 14 juillet 2026 | Un échec du chunk lazy Giro3D contournerait le callback du renderer et ferait tomber la route de zone. | `SpatialMapRenderBoundary` capture l'échec du chargement 3D et rend le même résumé DOM sûr, sans détail d'erreur réseau. | Test jsdom qui fait échouer un enfant du boundary : passé. |
| FV9-006 | VÉRIFIÉ le 14 juillet 2026 | Le parseur navigateur ne contrôlait pas tous les axes et règles spatiales déjà imposés avant publication. | Il impose désormais RGF93, NGF-IGN69, les axes Giro3D/glTF, le pont Unity, l'origine GLB, les emprises et le runtime same-origin sans Cesium. | Tests de rejet du pont d'axes, de l'origine GLB et du runtime externe : passés. |
| FV9-007 | preuve historique | Une tuile GLB en échec pouvait rester en erreur lors d'un ancien changement de secteur. | Les échecs hors champ sont retirés et un centrage explicite autorise une nouvelle tentative. G1 remplace le changement de secteur par le recentrage de la zone unique. | Compilation, tests UI et rendu navigateur étaient consignés ; récupération après une vraie erreur réseau GLB reste NON VÉRIFIÉE. |

FV-010 — runbook G1.

| ID | État actuel | Problème observé | Décision ou correction | Preuve disponible ou limite |
| --- | --- | --- | --- | --- |
| FV10-001 | VÉRIFIÉ localement le 14 juillet 2026 | Les procédures de migration, seed, carte, backup et restauration étaient réparties dans plusieurs documents. | `docs/RUNBOOK_G1.md` centralise le parcours contrôlé et ses critères de sortie. | Backend, interface, carte, sauvegarde et restauration ont été exercés dans l'arbre de travail. |
| FV10-002 | remplacé par G1 | Un document pourrait donner une impression de reproductibilité sans démarrer réellement les services. | G1 exige les commandes officielles, la release binaire immuable, l'ouverture des deux routes et une restauration vers cible neuve depuis un checkout propre. | Les preuves G1 doivent être inscrites dans les lignes ci-dessous ; aucune publication ou clone neuf ne doit être présumé. |

G1 — clôture reproductible avec GitHub Releases.

| ID | État actuel | Problème observé | Correction attendue | Preuve à consigner |
| --- | --- | --- | --- | --- |
| G1-001 | VÉRIFIÉ localement le 14 juillet 2026 | Les secteurs Die et Pontaix apparaissaient comme deux zones publiques. | Catalogue `1.1` avec la seule identité `DIE-PONTAIX-08@R1`, emprise globale et deux couvertures techniques non sélectionnables. | `npm run check`, `npm run test` (68 tests) et `npm run test:e2e` (20 scénarios, bureau et émulation mobile) ont confirmé l'intitulé unique et le recentrage. |
| G1-002 | VÉRIFIÉ localement le 14 juillet 2026 | Le paquet de 144 binaires ne pouvait pas être cloné proprement sans versionner 417 Mo dans Git. | Archive `fireviewer-die-pontaix-r1-v4.tar.gz` distribuée par release, avec `SHA256SUMS`; Git ignore seulement les répertoires binaires installés. | `pack:spatial`, `verify:spatial` et une installation isolée depuis l'archive locale ont validé les 144 hashes et 416850962 octets. Le clone neuf depuis la release reste NON VÉRIFIÉ avant publication. |
| G1-003 | VÉRIFIÉ localement le 14 juillet 2026 | Le catalogue et le manifeste de paquet ne pointaient pas vers le même manifeste de provenance IGN. | `ign_sources.v1.json` versionné et hashé ; catalogue, manifeste et verrou référencent le même SHA-256. | `npm run verify:spatial` a contrôlé le SHA-256 `cff6e9ffa71ce38397defe490bf54f6ba361cc9e5ed8621f22719e5e86d20fe5`, son chemin et ses 265766 octets. |
| G1-004 | VÉRIFIÉ localement le 14 juillet 2026 | Une extraction directe pourrait installer une archive corrompue ou contenant un chemin hostile. | `fetch:spatial` contrôle hash et liste d'entrées, extrait dans un temporaire puis installe seulement après `verify:spatial`. | `npm run test:spatial` a passé 11 tests, y compris les archives altérées, les liens, les chemins absolus et `..`, ainsi que le retour arrière. |
| G1-005 | VÉRIFIÉ localement le 14 juillet 2026 | La vue d'ensemble était limitée et le changement de zone ne représentait plus le contrat public. | Caméra sans plafond de 3,6 km, COG/PNG à distance, GLB au rapprochement, bouton `Recentrer la zone` et fallback DOM. | `npm run test:e2e` a passé 20 scénarios, dont `/zones/die-pontaix` sur bureau et émulation mobile : absence de Cesium, d'URL externe et de GLB à la vue d'ensemble. |
| G1-006 | NON VÉRIFIÉ — publication en attente | Une release GitHub peut exister sans contenir les trois assets cohérents ou sans qu'un clone neuf les consomme. | Tag immuable `spatial-die-pontaix-r1-v4`, archive, `SHA256SUMS` et attribution IGN publiés ; le verrou porte URL HTTPS, taille et hash. | L'archive locale a le SHA-256 `238c97a5e285fefa02a59c7ae4b8783921c5db13815b9a18eb4edae8adbc1a3f`. `git diff --check` et `gitleaks protect --staged --no-banner` ont passé localement ; la publication GitHub, le téléchargement HTTPS public et le clone neuf restent à exécuter. |

Limites actives.

- NON VÉRIFIÉ : déploiement public, cache CDN, origines CORS de production et
  coût de diffusion du paquet spatial.
- NON VÉRIFIÉ : licence et provenance de publication de chaque donnée
  géographique réelle.
- NON VÉRIFIÉ : performance mobile, mémoire GPU et temps de premier rendu.
- NON VÉRIFIÉ : publication de la GitHub Release G1 et récupération depuis son
  URL publique, jusqu'à la preuve de clôture.
- NON VÉRIFIÉ : association publique contrôlée d'une `SpatialZoneRevision`
  réelle à un incident.
- NON VÉRIFIÉ : build Docker et migration contre PostgreSQL/PostGIS réel.
