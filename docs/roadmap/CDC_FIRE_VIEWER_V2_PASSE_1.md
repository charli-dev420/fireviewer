# CDC Fire-Viewer v2 - Passe 1

## Statut du document

- **Révision** : 2.1
- **Date** : 15 juillet 2026
- **Statut** : première passe normative approuvée
- **Périmètre** : arbitrages P0.1 uniquement
- **Référence détaillée** : [ADR-003](../adr/ADR-003-cdc-v2-p0-arbitrations.md)

Cette passe ferme les six arbitrages qui empêchaient d'utiliser le CDC v2 comme
référence de développement. Elle fixe la cible produit. Elle ne prouve pas que les
mécanismes correspondants sont déjà implémentés.

## 1. Principes inchangés

- Une page publique canonique par incident : `/incident/{fire_id}`.
- Un `fire_id` permanent et un nouvel `episode_id` immuable à chaque réactivation
  confirmée.
- Aucun parcours public par `zone_id`.
- Le statut opérationnel, la vérification et la fraîcheur restent trois axes distincts.
- Aucun statut `vérifié` ne peut être produit sans validation humaine.
- Le texte public reste exploitable sans WebGL ni modèle 3D.
- Une zone ou une révision spatiale reste une référence technique, jamais l'identité
  métier d'un feu.

## 2. Arbitrages approuvés

### ARB-01 - Session administrateur

- Aucun compte utilisateur public, paiement, profil, cookie public ou cookie de suivi.
- Pour G0/G1, l'Admin utilise un identifiant et un mot de passe locaux.
- Un cookie de session strictement technique est autorisé pour l'Admin s'il est
  `Secure`, `HttpOnly`, `SameSite=Strict`, protégé par CSRF et limité dans le temps.
- Aucun secret de session ne doit être stocké dans `localStorage`.

### ARB-02 - Référentiel spatial

- Référentiel horizontal de production : RGF93 / Lambert-93, `EPSG:2154`.
- Référentiel vertical : NGF-IGN69, `EPSG:5720`.
- Sol de référence : MNT LiDAR HD à 0,5 m lorsque cette résolution est disponible et
  autorisée.
- Le MNS et les classes LiDAR servent aux objets, à la canopée et aux hauteurs.
- Toute hauteur MNS est calculée relativement au MNT de référence.
- Blender et le GLB utilisent un repère local métrique.
- L'origine locale Lambert-93 / NGF-IGN69 est enregistrée explicitement avec la
  révision spatiale.
- Une position WGS84 dérivée peut servir à l'échange et à l'affichage, mais ne remplace
  pas l'origine métrique de production.

### ARB-03 - Données brutes et audit

- Les images, vidéos, textes et données source brutes restent privées et isolées pendant
  le traitement et la revue.
- Après une décision humaine, le brut est purgé au plus tard dans les 24 heures.
- Une exception exige une obligation légale ou une enquête formellement documentée.
- Une publication automatique corroborée ne rend jamais le brut public.
- L'audit conserve seulement les identifiants nécessaires, dates, hash non réversible,
  licence, transformations, décision, motif et référence externe autorisée.
- Aucun média, texte brut, position personnelle ou secret ne doit être copié dans
  l'audit.

### ARB-04 - Compte unique et maturité

- Un compte Admin local unique est accepté uniquement pour G0 et G1.
- Avant G2, les opérateurs doivent disposer d'identités nominatives.
- Les actions critiques exigent une seconde approbation avant G2.
- Un déploiement avec compte partagé ne peut pas être présenté comme G2, G3 ou comme une
  architecture d'exploitation critique.

### ARB-05 - Publication, preuves et modèle 3D

#### Publication de la fiche

Une fiche publique peut être créée ou actualisée lorsque **l'une** des conditions
suivantes est satisfaite :

1. une validation humaine est enregistrée ;
2. au moins trois preuves indépendantes sont corroborantes.

Ces deux voies ne donnent pas le même statut :

| Condition | Statut public maximal | Affichage spatial |
| --- | --- | --- |
| Validation humaine | Vérifié | Marqueurs validés et publiables |
| Trois preuves, sans validation humaine | Corroboré - non validé | Zone généralisée uniquement |
| Moins de trois preuves et aucune validation humaine | Candidat interne | Aucune projection publique détaillée |

Règles obligatoires :

- Trois preuves automatiques ne produisent jamais le statut `vérifié`.
- La recherche publique recherche des incidents publiés.
- Une fiche corroborée peut apparaître dans cette recherche avec son statut explicite.
- Une preuve validée et autorisée à la diffusion est reportée comme marqueur dans le
  viewer 3D de l'incident.
- Une corroboration automatique n'affiche jamais une position précise ni le média brut.

#### Déclenchement du modèle 3D

La fiche publique reste disponible sous tout seuil de surface. La génération du modèle
3D est déclenchée si **l'une** des conditions suivantes est satisfaite :

1. une évacuation est établie par une source institutionnelle ou une validation humaine ;
2. la surface estimée de l'incident atteint au moins **500 hectares**.

Le seuil déclenche le pipeline de production. Le modèle ne peut devenir public qu'après
validation humaine du package spatial, notamment de son origine, ses unités, son
intégrité, sa couverture et ses limites.

**Limite de la passe interfaces/backend** : cette passe calcule et persiste uniquement
l'éligibilité, puis émet un événement d'outbox portant
`execution_scope=external_pipeline_not_implemented`. Elle ne charge, ne génère, ne
transforme et ne publie aucun modèle 3D. Le traitement du modèle et la consommation de
cet événement appartiennent à un lot externe ultérieur.

### ARB-06 - Conservation des modèles

- Tous les modèles effectivement publiés sont conservés.
- Le modèle final de chaque épisode est conservé, même après remplacement.
- Les brouillons, échecs et intermédiaires non référencés sont purgés après 30 jours.
- Une publication, une archive, un audit de sécurité ou une enquête ouverte bloque la
  purge jusqu'à résolution documentée.

## 3. Matrice d'exigences de la passe 1

| ID | Priorité | Exigence | Preuve d'acceptation attendue |
| --- | --- | --- | --- |
| PUB-011 | P0 | Publication après validation humaine OU trois preuves | Les deux voies produisent une page et des statuts distincts |
| PUB-012 | P0 | Marqueur validé, zone généralisée si seulement corroborée | Aucun point précis ou média brut dans la voie automatique |
| DATA-001 | P0 | Données brutes éphémères | Purge démontrée au plus tard 24 h après décision humaine |
| DATA-002 | P0 | Audit minimisé | Inspection prouvant l'absence de média, texte brut, position personnelle et secret |
| SPAT-003 | P0 | Production EPSG:2154 / EPSG:5720 | Origine locale persistée et transformations traçables |
| SPAT-004 | P0 | MNT 0,5 m de référence, MNS relatif | Aucune mesure de sol issue du MNS |
| SPAT-005 | P0 | Éligibilité au pipeline 3D si évacuation OU surface >= 500 ha | Cas sous seuil, seuil exact et évacuation testés ; aucun job 3D créé par la passe interfaces/backend |
| SPAT-006 | P0 | Publication 3D après validation humaine du package | Exigence future hors de cette passe ; aucun GLB n'est chargé ou publié |
| ASSET-001 | P0 | Modèles publiés et finaux conservés | Les références d'archive restent résolubles |
| ASSET-002 | P0 | Purge des assets non référencés après 30 jours | Une référence ou enquête empêche la purge |
| SEC-001 | P0 | Cookie Admin technique sécurisé et CSRF | Aucun cookie public ni secret dans `localStorage` |
| SEC-002 | P0 | Compte unique limité à G0/G1 | Gate G2 refusée sans identités nominatives et seconde approbation |

## 4. État de conformité après cette passe

- **VÉRIFIÉ** : les décisions ARB-01 à ARB-06 sont consignées dans ce document et dans
  l'ADR-003.
- **VÉRIFIÉ** : trois preuves indépendantes peuvent publier une synthèse publique
  `corroboré - non validé`, tandis que la validation humaine est la seule voie vers
  `vérifié`. Les doublons et les preuves spatialement incohérentes ne fabriquent ni
  seuil ni zone publique trompeuse.
- **VÉRIFIÉ** : la publication précise d'une preuve exige une décision humaine et une
  autorisation explicite de diffusion. Sans cette autorisation, la projection reste
  absente ou généralisée et aucun média brut n'est exposé.
- **VÉRIFIÉ** : les métadonnées transitoires portées par une observation sont purgées
  lors de la décision humaine, et les snapshots d'audit refusent les clés sensibles.
  Cette preuve ne couvre pas un éventuel stockage binaire externe, qui n'est pas
  implémenté dans ce dépôt.
- **VÉRIFIÉ** : le profil spatial v2 persiste les métadonnées `EPSG:2154`,
  `EPSG:5720`, l'origine locale métrique, le MNT de référence et la relation des
  hauteurs de surface. Cela ne prouve aucun traitement LiDAR, MNT/MNS ou GLB réel.
- **VÉRIFIÉ** : les cas 499,99 ha, 500 ha et évacuation établie calculent l'éligibilité
  attendue. Le test confirme qu'aucun `Job` 3D n'est créé ; seuls des événements
  d'outbox explicitement marqués `external_pipeline_not_implemented` sont persistés.
- **VÉRIFIÉ** : la session Admin locale utilise le cookie technique et la protection
  CSRF sans persistance du secret dans le navigateur. Les tests frontend, le build,
  l'OpenAPI et les migrations couvrent les contrats modifiés.
- **NON VÉRIFIÉ** : génération, chargement, transformation, comparaison et publication
  réelles d'un modèle 3D ; consommation de l'outbox par un worker ; purge d'assets à
  30 jours ; projection des preuves dans un moteur 3D. Ces mécanismes sont hors de la
  passe interfaces/backend.

## 5. Gate de sortie P0.1

P0.1 est terminée sur le plan normatif lorsque :

- les six arbitrages portent le statut `APPROUVÉ` ;
- aucune section du CDC ne réintroduit la condition cumulative « trois preuves ET
  validation humaine » ;
- le seuil de 500 ha s'applique au pipeline 3D, jamais à l'existence de la fiche ;
- les exigences et preuves attendues ci-dessus sont utilisées par les lots suivants.

Le lot interfaces/backend s'arrête à la production de contrats, d'états, de contrôles
et de demandes externes traçables. Un lot ultérieur pourra consommer ces demandes et
traiter les modèles 3D, sans modifier les règles de publication publique ci-dessus.
