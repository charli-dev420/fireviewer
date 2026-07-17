"""repair the spatial package file kind width on deployed databases

Revision ID: d7c5e3a1b920
Revises: d2a6e8f1b430
Create Date: 2026-07-17 20:00:00.000000

The Unity file-kind migration intended to widen this column, but the production
PostgreSQL schema can still contain the historical ``VARCHAR(3)`` definition.
This additive repair is deliberately explicit so already-stamped databases are
corrected without rewriting a migration that has been deployed.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d7c5e3a1b920"
down_revision: str | None = "d2a6e8f1b430"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CURRENT_LENGTH = 9
_FK_NAMING_CONVENTION = {"fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"}


def _sqlite_trigger_definitions() -> list[tuple[str, str]]:
    rows = op.get_bind().execute(
        sa.text(
            "SELECT name, sql FROM sqlite_master "
            "WHERE type = 'trigger' AND sql IS NOT NULL "
            "AND (tbl_name = 'spatial_package_file' "
            "OR lower(sql) LIKE '%spatial_package_file%') ORDER BY name"
        )
    )
    return [(name, statement) for name, statement in rows]


def _widen_sqlite_column() -> None:
    triggers = _sqlite_trigger_definitions()
    for name, _statement in triggers:
        quoted_name = name.replace('"', '""')
        op.execute(f'DROP TRIGGER IF EXISTS "{quoted_name}"')
    with op.batch_alter_table(
        "spatial_package_file",
        recreate="always",
        naming_convention=_FK_NAMING_CONVENTION,
    ) as batch_op:
        batch_op.alter_column(
            "kind",
            existing_type=sa.String(length=3),
            type_=sa.String(length=_CURRENT_LENGTH),
            existing_nullable=False,
        )
    for _name, statement in triggers:
        op.execute(statement)


def upgrade() -> None:
    dialect = op.get_bind().dialect.name
    if dialect == "sqlite":
        _widen_sqlite_column()
        return
    if dialect == "postgresql":
        # Keep this SQL explicit: the historical Enum-to-Enum alteration was
        # stamped in production without changing the VARCHAR width.
        op.execute(
            "ALTER TABLE spatial_package_file "
            "ALTER COLUMN kind TYPE VARCHAR(9)"
        )
        return
    op.alter_column(
        "spatial_package_file",
        "kind",
        existing_type=sa.String(length=3),
        type_=sa.String(length=_CURRENT_LENGTH),
        existing_nullable=False,
    )


def downgrade() -> None:
    # d2a6e8f1b430 already models the Unity kinds and therefore also requires
    # VARCHAR(9). Re-introducing VARCHAR(3) would corrupt that revision's
    # contract, so this repair intentionally has no destructive downgrade.
    return
