# Analyse de la roadmap Fire Viewer

Cadre de lecture.

La roadmap source reste une architecture incident-centrique : elle n'autorise ni
une carte nationale, ni la conduite des secours, ni la confirmation publique
sur une source unique. Le vertical slice doit rester local, explicable,
réversible et sans coût récurrent imposé.

OBSERVÉ dans le dépôt : le contrat public `ViewerManifest` est séparé des
ressources spatiales de zone. Cette séparation reste nécessaire tant qu'une
publication d'incident vers une révision spatiale n'a pas été revue et
archivée.

NON VÉRIFIÉ dans cette mise à jour : coûts d'hébergement, licences de chaque
donnée géographique, conformité réglementaire, déploiement public et
performances mobiles. Ces sujets ne doivent pas être déduits de la présence des
fichiers locaux.

Architecture cible maintenue.

1. `/incident/{fire_id}` désigne une série d'incident persistante ;
   `episode_id` distingue les périodes et réactivations.
2. Le backend reste la source de vérité transactionnelle pour le matching,
   l'audit, les états publics et les manifestes.
3. Le parcours incident reste DOM-first : statut, fraîcheur, incertitude et
   limitations sont lisibles sans WebGL.
4. Les zones 3D sont des paquets statiques indépendants, publiés par révision
   et servis du même domaine. Elles ne sont pas une carte d'incidents.
5. Unity reste un outil d'authoring, de préparation et d'export. Le renderer
   public retenu est Giro3D, pas Unity WebGL.
6. Toute archive historique d'incident reste une image PNG immuable. Elle ne
   réexpose ni GLB ni viewer 3D.

Évolution assumée du plan spatial.

Le plan initial réservait FV-008 à un GLB fictif unique, puis FV-009 à un pont
Unity WebGL. La disponibilité d'une carte 3D Die–Pontaix impose une séquence
plus réaliste et plus économique :

| Passe | Objet recalibré | Limite structurante |
| --- | --- | --- |
| FV-008 | paquet spatial réel Die–Pontaix, catalogue `1.1`, COG LiDAR, aperçus PNG et GLB découpés | une seule zone publique `DIE-PONTAIX-08@R1`; les deux couvertures LiDAR restent techniques |
| FV-009 | bridge web Giro3D avec chargement local conditionnel | Unity conserve son rôle d'authoring ; il n'est pas chargé dans le navigateur public |
| FV-010 | clôture reproductible G1 | release GitHub de binaires, verrou et provenance versionnés ; clone neuf Windows validé |

Le contrat G1 fixe le catalogue `1.1` à `DIE-PONTAIX-08@R1`, emprise
`[876000, 6403000, 892000, 6413000]`, avec deux emprises techniques de
couverture. Les huit tuiles terrain, les huit aperçus PNG et les 128 GLB sont
des assets de cette seule zone publique. Ils seront installés sous
`/maps/fireviewer-die-pontaix-r1-v4/` par la récupération contrôlée de la
release `spatial-die-pontaix-r1-v4`; les binaires ne font pas partie du clone
Git.

Le client web doit refuser les chemins absolus, les remontées `..`, les
emprises invalides, les tailles invalides et un contrat autre que
`EPSG:2154 / NGF-IGN69`. La récupération vérifie l'archive, refuse les chemins
hostiles et n'installe le contenu qu'après contrôle du paquet. Le navigateur ne
recalcule pas le SHA-256 de chaque réponse runtime : GitHub n'est pas une
origine runtime et ce contrôle reste hors périmètre G1.

Le bridge spatial retenu.

```text
Unity d'authoring
  → COG + PNG + GLB locaux
  → catalogue spatial 1.1, verrou de release et provenance IGN
  → `npm run fetch:spatial` puis contrôle de paquet
  → route /zones/die-pontaix
  → Giro3D dans le navigateur

ViewerManifest v2
  → route /incident/{fire_id}
  → résumé DOM public minimal
  → aucun chargement de carte ou GLB sans publication future explicite
```

OBSERVÉ dans `Giro3DMap.tsx` : les COG et aperçus sont agrégés dans une scène
Lambert-93 commune ; un GLB source `(E, U, -N)` est tourné de +90° sur X pour
la scène `(E, N, U)`. Les détails sont demandés dans un rayon de 2 500 m
autour de la caméra et retirés quand la caméra est à plus de 6 000 m de sa cible.

Cette stratégie répond au besoin visuel de vue lointaine sans rendre la
géométrie détaillée permanente. La qualité réelle, la mémoire GPU, le temps de
premier rendu et la bande passante restent NON VÉRIFIÉS tant qu'ils ne sont pas
mesurés sur les navigateurs et réseaux ciblés.

Gates de maturité.

| Gate | Usage autorisé | État documentaire |
| --- | --- | --- |
| G0 | conception, contrats et fixtures | historique du dépôt |
| G1 | démonstration technique locale et contrôlée | clôture validée : release binaire v4, tag source correctif, clone neuf et E2E de zone unique |
| G2 | bêta supervisée | non engagé |
| G3-candidat | évaluation avec professionnels | non engagé |
| G3 | usage opérationnel | hors périmètre |

Le périmètre G1 local est VÉRIFIÉ par les commandes consignées dans le
[registre](REGISTRE_PROBLEMES_VALIDATIONS.md). Les conditions exactes restent
dans [PLAN_DE_SUITE.md](PLAN_DE_SUITE.md) et la procédure dans
[RUNBOOK_G1.md](RUNBOOK_G1.md).

VÉRIFIÉ le 14 juillet 2026 avant la clôture G1 : FV-007 a exécuté 87/87 tests backend à 88,06 % de
couverture, avec Ruff, mypy, migrations et compilation. Une sauvegarde et une
restauration SQLite fraîche ont aussi été exercées. L'interface a passé son
check, 65 tests Vitest, le build, 8 scénarios E2E, les 4 tests du paquet et le
contrôle SHA-256 de 146 fichiers. La route Giro3D a été vérifiée avec WebGL
dans son parcours antérieur. Ces preuves ne couvrent pas encore la zone
publique unique, la release, le clone neuf ni le nouveau parcours de
recentrage. Docker réellement exécuté, PostgreSQL/PostGIS et la performance
mesurée restent hors de cette preuve.

Risques à maintenir.

| Risque | Barrière ou action avant montée de gate |
| --- | --- |
| rattachement erroné d'une carte à un incident | publication explicite, revue humaine, révision immuable et archive PNG |
| données spatiales altérées ou incomplètes | manifeste IGN versionné, verrou de release, hash de paquet, contrôle des tailles et exercice de chargement |
| terrain mal aligné | points de contrôle, axes, datum et échelle contrôlés à l'export et dans le renderer |
| perte de qualité ou mémoire excessive | mesures de rendu proche/lointain avant toute compression destructrice |
| panne WebGL | parcours DOM incident conservé et résumé explicite sur la route de zone |
| fuite de position | contrat public minimal, données de zone séparées, pas de liaison implicite à un incident |
| coût de diffusion inattendu | release binaire utilisée seulement à la préparation ; mesure de poids, cache et trafic avant tout déploiement |

Suite recommandée après le gate G1.

1. Geler toute évolution de `DIE-PONTAIX-08@R1` sous le tag de release et
   publier toute évolution future sous une nouvelle révision, jamais en
   remplaçant la release existante.
2. Conserver dans le registre les résultats, hashes et captures du clone neuf ;
   toute évolution devra répéter cette recette depuis un nouveau tag source.
3. Mesurer le runtime Giro3D sur bureau et mobile avant de modifier la
   géométrie, le relief ou les lisières.
4. Introduire un registre de zones en base seulement lorsqu'il faudra publier
   plusieurs zones dynamiquement ; G1 conserve un catalogue statique unique.
5. Concevoir la publication incident → `SpatialZoneRevision` sans modifier le
   contrat public minimal par défaut.
6. Préparer le gate G2 : modèle de menace, RBAC, tests E2E de déploiement,
   restauration et monitoring.

Les services cloud, carte externe, Cesium, build Unity WebGL public et
traitement automatique de données opérationnelles ne font pas partie de cette
suite tant qu'une décision explicite et une preuve de coût, sécurité et
confidentialité ne les justifient pas.
