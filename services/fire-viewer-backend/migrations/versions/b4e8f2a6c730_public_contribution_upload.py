"""add private public contribution upload contract

Revision ID: b4e8f2a6c730
Revises: a3d7e9f1b520
Create Date: 2026-07-20 15:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b4e8f2a6c730"
down_revision: str | None = "a3d7e9f1b520"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enum(*values: str, name: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False)


def _sha256_hex_check(column: str) -> str:
    remaining = column
    for character in "0123456789abcdef":
        remaining = f"replace({remaining}, '{character}', '')"
    return f"length({column}) = 64 AND length({remaining}) = 0"


def upgrade() -> None:
    default_scopes = '["temporary_storage","agent_analysis","human_review"]'
    with op.batch_alter_table("agent_source_package") as batch:
        batch.alter_column(
            "incident_id", existing_type=sa.Integer(), existing_nullable=False, nullable=True
        )
        batch.alter_column(
            "episode_id", existing_type=sa.Integer(), existing_nullable=False, nullable=True
        )
        batch.add_column(
            sa.Column(
                "consent_scopes",
                sa.JSON(),
                nullable=False,
                server_default=sa.text(f"'{default_scopes}'"),
            )
        )
        batch.add_column(sa.Column("subject_reference_hash", sa.String(64), nullable=True))
        batch.create_check_constraint(
            "ck_agent_source_package_incident_episode_pair",
            "(incident_id IS NULL AND episode_id IS NULL) OR "
            "(incident_id IS NOT NULL AND episode_id IS NOT NULL)",
        )
        batch.create_check_constraint(
            "ck_agent_source_package_subject_hash",
            "subject_reference_hash IS NULL OR ("
            + _sha256_hex_check("subject_reference_hash")
            + ")",
        )
    with op.batch_alter_table("agent_source_package") as batch:
        batch.alter_column(
            "consent_scopes",
            existing_type=sa.JSON(),
            existing_nullable=False,
            server_default=None,
        )

    op.create_table(
        "public_contribution_submission",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("contribution_id", sa.String(96), nullable=False),
        sa.Column(
            "kind",
            _enum("new_fire", "incident_evidence", name="public_contribution_kind"),
            nullable=False,
        ),
        sa.Column(
            "state",
            _enum(
                "OPEN",
                "PENDING",
                "ACCEPTED",
                "REJECTED",
                "WITHDRAWN",
                name="public_contribution_state",
            ),
            nullable=False,
        ),
        sa.Column("incident_id", sa.Integer(), nullable=True),
        sa.Column("source_package_id", sa.Integer(), nullable=True),
        sa.Column("submission_payload", sa.JSON(), nullable=False),
        sa.Column("consent_payload", sa.JSON(), nullable=False),
        sa.Column("contact_reference_hash", sa.String(64), nullable=True),
        sa.Column("origin_fingerprint", sa.String(64), nullable=False),
        sa.Column("submitted_day", sa.String(10), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("tracking_token_hash", sa.String(64), nullable=False),
        sa.Column("trace_id", sa.String(128), nullable=False),
        sa.Column("purge_after", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by", sa.String(255), nullable=True),
        sa.Column("review_reason", sa.String(1_000), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["incident_id"], ["incident_series.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["source_package_id"], ["agent_source_package.id"], ondelete="RESTRICT"
        ),
        sa.UniqueConstraint(
            "origin_fingerprint",
            "submitted_day",
            "idempotency_key",
            name="uq_public_contribution_origin_day_idempotency",
        ),
        sa.CheckConstraint(
            _sha256_hex_check("origin_fingerprint"), name="ck_public_contribution_origin_hash"
        ),
        sa.CheckConstraint(
            _sha256_hex_check("request_hash"), name="ck_public_contribution_request_hash"
        ),
        sa.CheckConstraint(
            _sha256_hex_check("tracking_token_hash"),
            name="ck_public_contribution_tracking_hash",
        ),
        sa.CheckConstraint(
            "contact_reference_hash IS NULL OR ("
            + _sha256_hex_check("contact_reference_hash")
            + ")",
            name="ck_public_contribution_contact_hash",
        ),
        sa.CheckConstraint("version >= 1", name="ck_public_contribution_version"),
    )
    for column in (
        "contribution_id",
        "state",
        "incident_id",
        "source_package_id",
        "origin_fingerprint",
        "submitted_day",
        "trace_id",
        "purge_after",
    ):
        op.create_index(
            f"ix_public_contribution_submission_{column}",
            "public_contribution_submission",
            [column],
            unique=column in {"contribution_id", "source_package_id"},
        )


def downgrade() -> None:
    op.drop_table("public_contribution_submission")
    with op.batch_alter_table("agent_source_package") as batch:
        batch.drop_constraint("ck_agent_source_package_subject_hash", type_="check")
        batch.drop_constraint("ck_agent_source_package_incident_episode_pair", type_="check")
        batch.drop_column("subject_reference_hash")
        batch.drop_column("consent_scopes")
        batch.alter_column(
            "episode_id", existing_type=sa.Integer(), existing_nullable=True, nullable=False
        )
        batch.alter_column(
            "incident_id", existing_type=sa.Integer(), existing_nullable=True, nullable=False
        )
