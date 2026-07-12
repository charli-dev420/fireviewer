# Contribution

1. Créer une branche ciblée et une issue décrivant le risque traité.
2. Ajouter ou modifier d'abord les tests de contrat et de sécurité.
3. Exécuter `make quality`.
4. Ne jamais modifier une migration déjà déployée; créer une nouvelle révision Alembic.
5. Toute évolution du matching doit changer `policy_id`, documenter les facteurs et fournir un corpus de validation.
6. Toute transition d'état nouvelle exige une revue sécurité et des tests de refus.
7. Ne jamais committer de preuve réelle, identité de témoin, coordonnée opérationnelle ou secret.

Les règles de matching, de visibilité publique et de rétention nécessitent une revue à deux personnes lorsque l'équipe le permet.
