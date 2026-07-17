"""normalize asset LOD and spatial package foreign-key contracts

Revision ID: a4e9c2f7d610
Revises: f3b8c1d7a920
Create Date: 2026-07-16 12:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a4e9c2f7d610"
down_revision = "f3b8c1d7a920"
branch_labels = None
depends_on = None

_FK_NAMING_CONVENTION = {"fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"}
_CURRENT_LODS = ("MOBILE", "DESKTOP", "CLOSE", "LOCAL", "EXTENDED")
_LEGACY_LODS = ("MOBILE", "DESKTOP")


def _asset_lod_type(values: tuple[str, ...]) -> sa.Enum:
    return sa.Enum(*values, name="asset_lod", native_enum=False)


def _sqlite_trigger_definitions(*tables: str) -> list[tuple[str, str]]:
    bind = op.get_bind()
    definitions: list[tuple[str, str]] = []
    target_tables = {table.casefold() for table in tables}
    rows = bind.execute(
        sa.text(
            "SELECT name, tbl_name, sql FROM sqlite_master "
            "WHERE type = 'trigger' AND sql IS NOT NULL ORDER BY name"
        )
    )
    for name, owning_table, statement in rows:
        normalized_statement = statement.casefold()
        if owning_table.casefold() in target_tables or any(
            table in normalized_statement for table in target_tables
        ):
            definitions.append((name, statement))
    return definitions


def _drop_sqlite_triggers(definitions: list[tuple[str, str]]) -> None:
    for name, _statement in definitions:
        quoted_name = name.replace('"', '""')
        op.execute(f'DROP TRIGGER IF EXISTS "{quoted_name}"')


def _restore_sqlite_triggers(definitions: list[tuple[str, str]]) -> None:
    for _name, statement in definitions:
        op.execute(statement)


def _normalize_sqlite_contract(*, lod_type: sa.Enum, existing_lod_length: int) -> None:
    trigger_definitions = _sqlite_trigger_definitions("model_asset", "manifest_revision")
    _drop_sqlite_triggers(trigger_definitions)

    with op.batch_alter_table(
        "model_asset",
        recreate="always",
        naming_convention=_FK_NAMING_CONVENTION,
    ) as batch_op:
        batch_op.alter_column(
            "lod",
            existing_type=sa.String(length=existing_lod_length),
            type_=lod_type,
            existing_nullable=False,
        )
        batch_op.drop_constraint(
            "fk_model_asset_spatial_package_file_id_spatial_package_file",
            type_="foreignkey",
        )
        batch_op.create_foreign_key(
            "fk_model_asset_spatial_package_file_id_spatial_package_file",
            "spatial_package_file",
            ["spatial_package_file_id"],
            ["id"],
            ondelete="RESTRICT",
        )

    with op.batch_alter_table(
        "manifest_revision",
        recreate="always",
        naming_convention=_FK_NAMING_CONVENTION,
    ) as batch_op:
        batch_op.drop_constraint(
            "fk_manifest_revision_spatial_package_id_spatial_package",
            type_="foreignkey",
        )
        batch_op.create_foreign_key(
            "fk_manifest_revision_spatial_package_id_spatial_package",
            "spatial_package",
            ["spatial_package_id"],
            ["id"],
            ondelete="RESTRICT",
        )

    _restore_sqlite_triggers(trigger_definitions)


def _ensure_legacy_lod_values() -> None:
    unsupported = (
        op.get_bind()
        .execute(
            sa.text("SELECT lod FROM model_asset WHERE lod NOT IN ('MOBILE', 'DESKTOP') LIMIT 1")
        )
        .scalar_one_or_none()
    )
    if unsupported is not None:
        raise RuntimeError(
            "Cannot downgrade asset LOD schema while model_asset contains "
            f"the non-legacy value {unsupported!r}"
        )


def upgrade() -> None:
    current_type = _asset_lod_type(_CURRENT_LODS)
    if op.get_bind().dialect.name == "sqlite":
        _normalize_sqlite_contract(lod_type=current_type, existing_lod_length=7)
        return

    op.alter_column(
        "model_asset",
        "lod",
        existing_type=sa.String(length=7),
        type_=current_type,
        existing_nullable=False,
    )


def downgrade() -> None:
    _ensure_legacy_lod_values()
    legacy_type = _asset_lod_type(_LEGACY_LODS)
    if op.get_bind().dialect.name == "sqlite":
        _normalize_sqlite_contract(lod_type=legacy_type, existing_lod_length=8)
        return

    op.alter_column(
        "model_asset",
        "lod",
        existing_type=sa.String(length=8),
        type_=legacy_type,
        existing_nullable=False,
    )
