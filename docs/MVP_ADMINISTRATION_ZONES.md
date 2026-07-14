# MVP — administration des zones, révisions et publications

Décision produit.

La gestion des zones est une exigence du MVP. Un administrateur doit créer,
contrôler, prévisualiser et publier une zone depuis son espace privé. Ajouter
une zone ne doit jamais exiger de modifier le frontend, de déposer des fichiers
dans le dépôt Git ou de remplacer une zone existante.

La carte publique des feux ne commence qu'après cette fonction. La carte de
zone G1 conserve son rôle de démonstration technique locale, avec une seule
zone logique `DIE-PONTAIX-08@R1`; elle n'est pas encore un catalogue public
administré.

Règle de priorité.

MVP-4 précède MVP-6. Une carte publique ne listera que les zones publiées par
un administrateur, jamais un paquet présent sur le disque, une release GitHub
ou une révision incomplète. Le public reste sans connexion; l'administration
est authentifiée et privée.

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
- Retirer une publication enlève la révision du catalogue public mais conserve
  son historique, son audit et sa preuve de vérification.
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
  → exposer la zone dans le catalogue public MVP-6
```

Pages administrateur requises.

```text
/admin/zones
/admin/zones/nouvelle
/admin/zones/{zone_id}
/admin/zones/{zone_id}/revisions/{revision}
/admin/publications
```

Ces pages permettent de créer une identité logique, créer ou archiver une
révision, déclarer les couvertures techniques, soumettre un paquet, consulter
le rapport de contrôle, prévisualiser sans accès public, publier ou retirer une
révision et consulter les incidents liés. La page d'incident de MVP-5 propose
ensuite la republication explicite vers une révision compatible.

Séparation des accès.

MVP-1 rend le rôle `administrator` réellement exploitable dans l'interface. Le
backend possède déjà une vérification JWT/OIDC et le contrôle de rôle côté API;
l'écran de connexion, la gestion de session navigateur, la politique de rôles
et l'isolement des assets privés restent à construire. Aucune route `/admin/*`,
aucun manifeste de paquet non publié et aucune URL de prévisualisation ne doit
être utilisable sans ce contrôle.

Persistance et coût.

Le registre dynamique de zones nécessite une base de données : il ne peut pas
reposer sur le catalogue versionné G1. SQLite reste la référence locale,
reproductible et sans coût récurrent imposé pour les migrations, les tests et
les démonstrations. Une persistance partagée et durable pour un déploiement
public est NON VÉRIFIÉE à ce stade; son choix appartient à MVP-1 et MVP-7. Le
MVP-4 introduit une interface de stockage avec une implémentation locale, sans
imposer de service payant ni de reconstruction Unity dans le navigateur.

Ordre MVP acté.

1. MVP-0 — clôture et reproductibilité G1.
2. MVP-1 — accès administrateur, rôles, confidentialité et données privées.
3. MVP-2 — signalement public privé.
4. MVP-3 — analyse, proposition de placement et revue humaine.
5. MVP-4 — administration complète des zones et de leurs révisions.
6. MVP-5 — association feu validé → zone/révision, publication contrôlée et archive PNG.
7. MVP-6 — carte publique : zones et feux publiés.
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
- Une zone non publiée, retirée ou archivée est absente du catalogue public.
- Une nouvelle révision ne déplace aucun incident existant; la republication
  MVP-5 est idempotente, auditée et explicite.
- Les migrations, les permissions, les transitions de publication, les hashes,
  l'absence de suppression destructive et le journal append-only sont couverts
  par des tests ciblés et un parcours E2E administrateur.

Limites conservées.

La génération Unity, l'optimisation 3D, le chargement d'un GLB public, la carte
publique multi-zones, la connexion automatique d'un incident et le déploiement
ne font pas partie de cette passe documentaire. Aucun terrain réel, incident
réel, donnée opérationnelle ou secret ne doit être ajouté pour la réaliser.
