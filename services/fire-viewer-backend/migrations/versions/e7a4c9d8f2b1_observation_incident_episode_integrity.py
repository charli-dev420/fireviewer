"""enforce coherent observation incident and episode links

Revision ID: e7a4c9d8f2b1
Revises: c6d4f13a9b20
Create Date: 2026-07-13 02:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e7a4c9d8f2b1"
down_revision: str | None = "c6d4f13a9b20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


ATTACHED_PAIR_COMPLETE = (
    "(attached_incident_id IS NULL AND attached_episode_id IS NULL) "
    "OR (attached_incident_id IS NOT NULL AND attached_episode_id IS NOT NULL)"
)
PROPOSED_PAIR_COMPLETE = (
    "(proposed_incident_id IS NULL AND proposed_episode_id IS NULL) "
    "OR (proposed_incident_id IS NOT NULL AND proposed_episode_id IS NOT NULL)"
)

SQLITE_TRIGGER_NAMES = (
    "episode_incident_immutable",
    "observation_validate_pairs_insert",
    "observation_validate_pairs_update",
    "observation_validate_episode_ownership_insert",
    "observation_validate_episode_ownership_update",
)


def _validate_existing_links() -> None:
    """Refuse to turn a pre-existing incoherent database into a supposedly valid one."""

    bind = op.get_bind()
    incomplete_pair = bind.execute(
        sa.text(
            "SELECT id FROM observation WHERE "
            "(attached_incident_id IS NULL) <> (attached_episode_id IS NULL) "
            "OR (proposed_incident_id IS NULL) <> (proposed_episode_id IS NULL) "
            "LIMIT 1"
        )
    ).scalar_one_or_none()
    if incomplete_pair is not None:
        raise RuntimeError(
            "Cannot upgrade FV-007: observation "
            f"{incomplete_pair} has an incomplete incident/episode pair"
        )

    mismatched_episode = bind.execute(
        sa.text(
            "SELECT observation.id FROM observation "
            "WHERE (attached_incident_id IS NOT NULL AND NOT EXISTS ("
            "  SELECT 1 FROM episode "
            "  WHERE episode.id = observation.attached_episode_id "
            "    AND episode.incident_id = observation.attached_incident_id"
            ")) "
            "OR (proposed_incident_id IS NOT NULL AND NOT EXISTS ("
            "  SELECT 1 FROM episode "
            "  WHERE episode.id = observation.proposed_episode_id "
            "    AND episode.incident_id = observation.proposed_incident_id"
            ")) "
            "LIMIT 1"
        )
    ).scalar_one_or_none()
    if mismatched_episode is not None:
        raise RuntimeError(
            "Cannot upgrade FV-007: observation "
            f"{mismatched_episode} links an episode to another incident"
        )


def _create_sqlite_triggers() -> None:
    incomplete_pair = (
        "(NEW.attached_incident_id IS NULL AND NEW.attached_episode_id IS NOT NULL) "
        "OR (NEW.attached_incident_id IS NOT NULL AND NEW.attached_episode_id IS NULL) "
        "OR (NEW.proposed_incident_id IS NULL AND NEW.proposed_episode_id IS NOT NULL) "
        "OR (NEW.proposed_incident_id IS NOT NULL AND NEW.proposed_episode_id IS NULL)"
    )
    mismatched_episode = (
        "(NEW.attached_incident_id IS NOT NULL AND NEW.attached_episode_id IS NOT NULL "
        "AND NOT EXISTS (SELECT 1 FROM episode AS attached_episode "
        "WHERE attached_episode.id = NEW.attached_episode_id "
        "AND attached_episode.incident_id = NEW.attached_incident_id)) "
        "OR (NEW.proposed_incident_id IS NOT NULL AND NEW.proposed_episode_id IS NOT NULL "
        "AND NOT EXISTS (SELECT 1 FROM episode AS proposed_episode "
        "WHERE proposed_episode.id = NEW.proposed_episode_id "
        "AND proposed_episode.incident_id = NEW.proposed_incident_id))"
    )

    operations = (
        ("insert", "INSERT"),
        (
            "update",
            "UPDATE OF attached_incident_id, attached_episode_id, "
            "proposed_incident_id, proposed_episode_id",
        ),
    )
    for suffix, operation in operations:
        op.execute(
            f"CREATE TRIGGER observation_validate_pairs_{suffix} "
            f"BEFORE {operation} ON observation WHEN {incomplete_pair} "
            "BEGIN SELECT RAISE(ABORT, 'observation incident and episode pairs must be supplied together'); END"
        )
        op.execute(
            f"CREATE TRIGGER observation_validate_episode_ownership_{suffix} "
            f"BEFORE {operation} ON observation WHEN {mismatched_episode} "
            "BEGIN SELECT RAISE(ABORT, 'observation episode must belong to its incident'); END"
        )

    # An episode is born in exactly one incident series.  Its ownership must never
    # be moved later, otherwise an observation that already references the
    # episode could become a cross-incident link without touching observation.
    op.execute(
        "CREATE TRIGGER episode_incident_immutable "
        "BEFORE UPDATE OF incident_id ON episode "
        "WHEN NEW.incident_id <> OLD.incident_id "
        "BEGIN SELECT RAISE(ABORT, 'episode incident_id is immutable'); END"
    )


def _drop_sqlite_triggers() -> None:
    for trigger in SQLITE_TRIGGER_NAMES:
        op.execute(f"DROP TRIGGER IF EXISTS {trigger}")


def upgrade() -> None:
    _validate_existing_links()

    with op.batch_alter_table("observation", schema=None) as batch_op:
        batch_op.create_check_constraint(
            "ck_observation_attached_pair_complete", ATTACHED_PAIR_COMPLETE
        )
        batch_op.create_check_constraint(
            "ck_observation_proposed_pair_complete", PROPOSED_PAIR_COMPLETE
        )

    if op.get_bind().dialect.name == "sqlite":
        _create_sqlite_triggers()


def downgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        _drop_sqlite_triggers()

    with op.batch_alter_table("observation", schema=None) as batch_op:
        batch_op.drop_constraint("ck_observation_proposed_pair_complete", type_="check")
        batch_op.drop_constraint("ck_observation_attached_pair_complete", type_="check")
