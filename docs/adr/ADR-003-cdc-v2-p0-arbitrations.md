# ADR-003 - Arbitrages normatifs de la première passe du CDC v2

- **Statut** : accepté
- **Date** : 15 juillet 2026
- **Décideur produit** : projet Fire-Viewer
- **Portée** : CDC v2, gates G0 à G3 et lots de mise en conformité associés
- **Amende** : ADR-002 pour le référentiel spatial de production

## Contexte

Le CDC consolidé v2 identifiait six conflits qui ne pouvaient pas être résolus
implicitement par le code. Les décisions ci-dessous ferment la passe P0.1. Elles
définissent la cible normative ; elles ne prouvent pas que les mécanismes associés sont
déjà implémentés.

## Décisions

### ARB-01 - Session administrateur

- Aucun cookie public, cookie de suivi ou compte utilisateur public n'est autorisé.
- L'administration utilise un identifiant et un mot de passe locaux pour G0/G1.
- Une session Admin peut utiliser un cookie technique `Secure`, `HttpOnly` et
  `SameSite=Strict`, associé à une protection CSRF et à une expiration absolue et
  d'inactivité.
- Aucun secret de session ne doit être placé dans `localStorage`.

### ARB-02 - Référentiel spatial et surfaces

- Le référentiel horizontal de production est RGF93 / Lambert-93, `EPSG:2154`.
- Le référentiel vertical est NGF-IGN69, `EPSG:5720`.
- Le sol de référence est le MNT LiDAR HD à 0,5 m lorsque cette résolution est
  disponible et autorisée. Sa résolution et sa date réelles restent enregistrées.
- Le MNS et les classes LiDAR servent aux objets, à la canopée et aux hauteurs. Toute
  hauteur est calculée relativement au MNT de référence, jamais interprétée comme une
  altitude de sol.
- Blender et le GLB utilisent un repère local métrique. L'origine du repère est
  persistée explicitement en Lambert-93 / NGF-IGN69 avec la révision spatiale.
- Une représentation WGS84 3D dérivée peut être conservée pour l'échange et
  l'affichage public, mais elle ne remplace pas l'origine métrique de production.

Cette décision amende le profil spatial v1 de l'ADR-002. Le schéma v2 persiste désormais
les métadonnées du référentiel de production sans réécrire les snapshots v1. Cette
migration de contrat ne constitue pas une preuve de traitement LiDAR, de reconstruction
ou de chargement GLB.

### ARB-03 - Rétention des données brutes et audit

- Les images, médias, textes bruts et données source temporaires restent isolés et
  privés pendant le traitement et la revue.
- Après une décision humaine, ils sont purgés au plus tard dans les 24 heures, sauf
  obligation légale ou enquête formellement documentée.
- Une publication automatique corroborée ne rend jamais le brut public. Le brut reste
  temporaire jusqu'à la revue humaine puis suit le même délai maximal de 24 heures.
- L'audit conserve uniquement les identifiants nécessaires, dates, hash non réversible,
  licence, transformations, décision, motif et référence externe autorisée. Il ne copie
  ni média, ni texte brut, ni position personnelle, ni secret.

### ARB-04 - Compte unique et niveau de maturité

- Un compte administrateur local unique est accepté uniquement pour G0 et G1.
- Avant toute entrée en G2, les décisions sensibles exigent des identités nominatives,
  une attribution individuelle et une seconde approbation selon la matrice de criticité.
- Un déploiement avec compte partagé ne peut pas être présenté comme G2, G3 ou comme un
  outil d'exploitation critique.

### ARB-05 - Publication publique, preuves et déclenchement 3D

- La fiche publique d'un incident peut être créée ou actualisée après **l'une** des deux
  conditions : validation humaine, **ou** au moins trois preuves indépendantes
  corroborantes.
- Une validation humaine autorise le statut `vérifié`. Trois preuves sans validation
  humaine autorisent uniquement `corroboré - non validé` ; elles ne produisent jamais un
  statut vérifié.
- La recherche publique recherche des incidents. Toute fiche publiée peut y apparaître
  avec son niveau de vérification explicite ; elle n'est pas reléguée à une URL secrète.
- Une preuve validée et publiable est projetée comme marqueur dans le viewer 3D de
  l'incident. Trois preuves corroborantes non validées sont représentées au maximum par
  une zone généralisée explicitement étiquetée, jamais par un point précis ni par le
  média brut.
- La fiche publique reste disponible sous tout seuil de surface. La génération du
  modèle 3D est déclenchée lorsque l'incident comporte une évacuation établie par une
  source institutionnelle ou une validation humaine, **ou** lorsque la surface estimée
  atteint au moins **500 hectares**.
- Le seuil rend l'incident éligible au pipeline 3D. La publication du modèle reste
  soumise à la validation humaine du package spatial, de son origine, de ses unités, de
  son intégrité et de ses limites.

### ARB-06 - Rétention des modèles

- Tous les modèles effectivement publiés sont conservés.
- Le modèle final de chaque épisode est conservé même s'il a été remplacé dans la page
  courante.
- Les brouillons, échecs et intermédiaires non référencés sont purgés après 30 jours.
- Une archive, une publication, un audit de sécurité ou une enquête ouverte bloque la
  purge de l'asset concerné jusqu'à résolution documentée.

## Limite d'implémentation de cette passe

Le lot courant couvre les interfaces, les contrats et le backend applicatif. Il peut
enregistrer l'éligibilité d'un épisode et émettre une demande d'outbox destinée à un
pipeline externe. Cette demande porte explicitement
`execution_scope=external_pipeline_not_implemented`.

Le lot ne charge, ne génère, ne transforme, ne compare et ne publie aucun modèle 3D. Il
ne crée aucun job de production 3D et ne démontre aucun worker consommateur d'outbox.
Les exigences de modèle décrites par ARB-05 et ARB-06 restent normatives pour un lot
ultérieur, sans être présentées comme des capacités actuelles.

## Conséquences obligatoires

- Le CDC consolidé passe en révision 2.1 et la section des arbitrages devient un registre
  de décisions approuvées.
- La matrice d'exigences doit tester séparément publication corroborée, validation
  humaine, visibilité des preuves, déclenchement 3D et validation du package.
- Le contrat spatial v2 et sa migration sont **VÉRIFIÉS** au niveau des métadonnées
  backend. Le traitement géospatial réel reste **NON VÉRIFIÉ** et hors de ce lot.
- La publication corroborée, l'autorisation humaine d'une position précise, la purge
  des métadonnées transitoires et les cas limites du seuil de 500 ha sont **VÉRIFIÉS**
  par les tests du backend.
- Le seuil de 500 ha produit seulement une éligibilité et un événement externe. La
  génération, le chargement et la publication d'un modèle restent **NON VÉRIFIÉS** et
  ne sont pas implémentés par cette passe.

## Gate P0.1

La passe P0.1 est close lorsque le CDC 2.1, cette ADR et la matrice d'exigences portent
les six décisions sans formulation contradictoire. Les lots d'implémentation commencent
à P0.2 ; la clôture documentaire de P0.1 ne certifie aucune capacité opérationnelle.
