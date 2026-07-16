# MVP — administration des zones, révisions et publications

Décision produit.

La gestion des zones est une exigence du MVP. Un administrateur doit créer,
contrôler, prévisualiser et publier une zone depuis son espace privé. Ajouter
une zone ne doit jamais exiger de modifier le frontend, de déposer des fichiers
dans le dépôt Git ou de remplacer une zone existante.

La consultation publique reste bornée à une zone explicitement choisie. Une
zone publiée s'ouvre seulement à son adresse propre, par exemple
`/zones/DIE-PONTAIX-08`. Il n'existe ni carte globale, ni catalogue public qui
énumère les zones. La carte G1 conserve son rôle de démonstration technique
locale, avec une seule zone logique `DIE-PONTAIX-08@R1`.

Règle de priorité.

MVP-4 précède toute ouverture publique. Une zone n'est accessible que depuis
son adresse propre et après publication explicite par un administrateur,
jamais parce qu'un paquet est présent sur le disque, une release GitHub ou une
révision incomplète. Le public reste sans connexion; l'administration est
authentifiée et privée.

Invariants à préserver.

- `SpatialZone.zone_id` est l'identité stable d'une zone, par exemple
  `DIE-PONTAIX-08`.
- Une modification fonctionnelle ou spatiale crée une `SpatialZoneRevision`
  supplémentaire. Une révision publiée ou retirée ne doit pas être modifiée.
- Chaque révision porte son emprise, sa présentation publique, ses couvertures
  techniques, son contrat spatial et le paquet vérifié auquel elle est liée.
- Un paquet est publiable seulement lorsque les chemins, hashes, manifeste,
  provenance et contrat spatial ont été validés côté serveur.
- Une zone ou révision non publiée n'est jamais visible ni récupérable par un
  parcours public.
- Retirer une publication désactive son adresse publique sans modifier son
  historique, son audit ni sa preuve de vérification.
- Une zone, une révision, un paquet ou une publication ne sont pas supprimés
  destructivement dans le MVP. Les seules opérations sont l'archivage, le
  retrait, la révocation et la création d'une nouvelle révision.
- Un incident ne change pas de révision automatiquement. MVP-5 ajoute une
  action administrateur explicite de republication vers une révision plus
  récente.
- Lorsqu'un incident est archivé, `ZoneArchiveSnapshot` conserve uniquement une
  capture PNG immuable et ses hashes. Aucun GLB, viewer 3D ou URL de paquet ne
  fait partie de sa projection archivale.

Socle déjà présent.

OBSERVÉ dans le backend : `SpatialZone`, `SpatialZoneRevision`, `ModelAsset`,
`ManifestRevision`, `ZoneArchiveSnapshot` et `AuditEvent` existent déjà. Les
révisions spatiales ont une identité de zone stable, une enveloppe locale, le
profil Unity, le datum et les références RAF20; l'archive impose déjà
`image/png` et refuse un GLB. Cette passe complète l'administration autour de
ce socle sans remplacer le contrat spatial FV-004.

Contrat d'administration cible.

Le registre ajoute des agrégats administratifs, sans copier les binaires dans
SQLite :

- un paquet spatial immuable, identifié par son manifeste et son hash, avec la
  liste des fichiers COG, PNG et GLB, leur taille, leur hash, leur provenance,
  leur emplacement contrôlé et le rapport de vérification ;
- une liaison explicite paquet → révision, créée seulement après validation ;
- une publication auditée, avec les états brouillon, vérifié, prévisualisable,
  publié, retiré, révoqué ou archivé selon le parcours ;
- une révision active choisie explicitement par zone. Le changement retire la
  publication précédente sans modifier cette dernière ;
- des événements d'audit append-only pour création, vérification,
  prévisualisation, publication, retrait, archivage et republication
  d'incident.

Le paquet reste produit par Unity et consommé par Giro3D. L'interface
d'administration ne rebâtit ni le terrain ni les GLB dans le navigateur : elle
envoie ou référence le résultat du pipeline, demande les contrôles et ouvre une
prévisualisation privée après succès.

Parcours d'administration.

```text
Créer zone
  → définir identité, emprise, description et statut
  → créer une révision
  → fournir le paquet spatial et son manifeste
  → vérifier hashes, chemins, contrat et provenance
  → prévisualiser dans l'espace privé
  → publier explicitement
  → ouvrir l'adresse publique propre à cette zone
```

Pages administrateur requises.

```text
/admin/zones
/admin/zones/nouvelle
/admin/zones/{zone_id}
/admin/zones/{zone_id}/revisions/{revision}
/admin/publications
```

Ces pages doivent permettre de créer une identité logique, créer ou archiver
une révision, déclarer les couvertures techniques, soumettre un paquet,
consulter le rapport de contrôle, prévisualiser sans accès public, publier ou
retirer une révision et consulter les incidents liés. La page d'incident de
MVP-5 propose ensuite la republication explicite vers une révision compatible.

État de l'implémentation administrateur.

VÉRIFIÉ le 16 juillet 2026 : le shell privé, les routes de lecture et de mutation,
la création et modification des zones, les révisions, l'import direct d'un dossier
de package vers Blob, la finalisation, la validation, la prévisualisation privée et
les transitions de publication sont présents. Les identifiants de zone suivent le
contrat canonique en majuscules, par exemple `DIE-PONTAIX-08`, et les révisions
transportent leur entier, par exemple `1`, affiché comme `R1`.

NON VÉRIFIÉ en hébergement réel : l'import du package de 417 Mo dans le store Blob
de production, le raccordement à Neon/PostGIS et le cycle publication/retrait après
déploiement du backend Vercel.

Séparation des accès.

Le shell navigateur consulte `GET /api/v1/admin/session` avant de monter toute
page privée. Le compte administrateur local unique ouvre une session persistée
en base ; le navigateur reçoit un cookie `HttpOnly` et conserve uniquement le
jeton CSRF en mémoire. Les réponses `/api/v1/admin/*` portent
`Cache-Control: no-store`, les mutations sont idempotentes et les réponses de
problème ne révèlent pas leur détail serveur dans l'interface.

Les comptes multiples, les rôles nominatifs et la MFA sont hors périmètre de ce
MVP à administrateur unique. Aucune URL permanente de fichier privé n'est
renvoyée par la prévisualisation.

Persistance et coût.

Le registre dynamique de zones nécessite une base de données : il ne peut pas
reposer sur le catalogue versionné G1. SQLite reste la référence locale,
reproductible et sans coût récurrent imposé pour les migrations, les tests et
les démonstrations. La cible de persistance partagée est Neon PostgreSQL/PostGIS
et la cible des objets privés est Vercel Blob. Leur raccordement réel reste NON
VÉRIFIÉ. Le MVP-4 conserve SQLite et le stockage local pour les tests
reproductibles, sans reconstruction Unity dans le navigateur.

Ordre MVP acté.

1. MVP-0 — clôture et reproductibilité G1.
2. MVP-1 — accès administrateur, rôles, confidentialité et données privées.
3. MVP-2 — signalement public privé.
4. MVP-3 — analyse, proposition de placement et revue humaine.
5. MVP-4 — administration complète des zones et de leurs révisions.
6. MVP-5 — association feu validé → zone/révision, publication contrôlée et archive PNG.
7. MVP-6 — pages publiques isolées : une zone publiée et les feux qui lui sont
   explicitement liés.
8. MVP-7 — météo publique, déploiement, sécurité et exploitation.

Critères d'acceptation MVP-4.

- Un administrateur crée une seconde zone rurale complète depuis `/admin`, puis
  sa première révision et son paquet vérifié, sans changer le code frontend.
- `DIE-PONTAIX-08@R1` demeure intacte, avec ses hashes et ses deux couvertures
  techniques non visibles comme zones distinctes.
- Un paquet altéré, incomplet, hors contrat, sans provenance ou à chemin hostile
  est refusé avant prévisualisation et publication.
- Une prévisualisation privée ne crée aucune requête publique ni URL de GLB
  accessible anonymement.
- Une zone non publiée, retirée ou archivée répond comme indisponible à son
  adresse publique et n'est jamais énumérée par une route publique.
- Une nouvelle révision ne déplace aucun incident existant; la republication
  MVP-5 est idempotente, auditée et explicite.
- Les migrations, les permissions, les transitions de publication, les hashes,
  l'absence de suppression destructive et le journal append-only sont couverts
  par des tests ciblés et un parcours E2E administrateur.

Limites conservées.

La génération Unity et l'optimisation 3D restent hors site. La carte nationale
est strictement interne à l'Admin ; aucune carte globale publique n'est ajoutée.
La connexion automatique d'un incident et la validation métier opérationnelle
restent hors de cette passe. Aucun secret ne doit être ajouté au dépôt.
