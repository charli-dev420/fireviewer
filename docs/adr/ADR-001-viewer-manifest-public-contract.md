# ADR-001 — Contrat public ViewerManifest v2

- **Statut** : accepté
- **Date** : 12 juillet 2026
- **Décideurs** : projet Fire Viewer

## Contexte

L'interface reçue consommait un agrégat de démonstration `IncidentData` en camelCase, tandis que l'API expose déjà un manifeste viewer plus restreint en snake_case. Les deux formes ne sont pas compatibles directement. Le produit doit toutefois conserver une source de vérité transactionnelle, un fallback texte et la minimisation des données publiques.

## Décision

### Ressource et version

- La page stable reste `/incident/{fire_id}`.
- La ressource viewer publique canonique est `GET /api/v1/incident/{fire_id}/manifest`.
- L'alias historique au pluriel `/api/v1/incidents/...` n'est pas documenté par OpenAPI et ne doit pas être utilisé par du nouveau code.
- Le corps de réponse est `ViewerManifest` avec `schema_version: "2.0"`, en **snake_case**.
- Le `fire_id` respecte `^FR-[0-9A-Z]{2,3}-[0-9]{5}$`.

### Contenu et confidentialité

Le contrat contient uniquement l'identité d'incident, l'épisode courant, le statut, la fraîcheur, la localisation publique éventuelle, l'asset et le repère éventuels, l'état de modèle et l'avertissement public. Il n'expose ni observations brutes, ni journal, ni historique riche, ni attribution opérateur.

Les invariants sont les suivants :

- `available` : `asset` et `frame` sont présents et peuvent être affichés comme métadonnées ;
- `not_available` : l'incident est public mais aucun asset publiable n'est disponible ; `asset` et `frame` sont `null` ;
- `withheld` : la localisation, l'asset et le repère sont masqués ; `location`, `asset` et `frame` sont `null`.

L'UI adaptera ce DTO réseau vers son propre modèle de présentation. Elle ne doit pas compléter les vues Sources, Historique ou Journal par des données mockées lorsque l'API réelle sera branchée dans FV-006.

### Cache, CORS et erreurs

- Une réponse `200` porte un `ETag` fort calculé sur le manifeste et `Cache-Control: public, max-age=30, must-revalidate`.
- Une requête avec un `If-None-Match` identique reçoit `304`, sans corps, avec les mêmes en-têtes de cache.
- Les erreurs viewer sont des `application/problem+json` avec `trace_id` : `400` (identifiant invalide), `404` (inconnu), `410` (tombstoned) et `503` (incohérence interne).
- `409` ne fait pas partie du contrat de lecture viewer. Il est réservé aux mutations concurrentes ou idempotentes.
- CORS autorise uniquement les origines configurées. En développement, la configuration fournie couvre `http://localhost:5173` et `http://localhost:3000`; `If-None-Match` est autorisé et `ETag` est exposé. Aucune origine de production n'est choisie ici.

## Conséquences

- `ViewerManifest` Pydantic est la source de vérité du schéma de sérialisation.
- Le schéma JSON versionné et les exemples sous `contracts/viewer-manifest/v2/` sont des artefacts contrôlés par les tests backend et UI.
- FV-003 ne branche pas la page sur l'API réelle, ne charge pas de GLB et ne crée pas d'endpoints de sources, historique ou journal. Ces travaux restent dans FV-006 et les lots ultérieurs.
