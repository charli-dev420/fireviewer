from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.orm import Session

from fire_viewer.domain.errors import ConflictError

SOURCE_REVISION = "e6f3a1b8c420"
TARGET_REVISION = "d7c5e3a1b920"


@dataclass(frozen=True)
class SchemaUpgradeOutcome:
    previous_revision: str
    current_revision: str
    applied: bool


def _migration_config() -> Config:
    candidates = (Path(__file__).resolve().parents[3], Path.cwd().resolve())
    for root in candidates:
        config_path = root / "alembic.ini"
        migrations_path = root / "migrations"
        if config_path.is_file() and (migrations_path / "env.py").is_file():
            config = Config(str(config_path))
            config.set_main_option("script_location", str(migrations_path))
            return config
    raise RuntimeError("Packaged Alembic migration assets are unavailable.")


def _current_revision(session: Session) -> str:
    revision = session.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    if not isinstance(revision, str):
        raise RuntimeError("Alembic revision is invalid.")
    return revision


def upgrade_unity_schema(session: Session) -> SchemaUpgradeOutcome:
    config = _migration_config()
    heads = ScriptDirectory.from_config(config).get_heads()
    if heads != [TARGET_REVISION]:
        raise RuntimeError("The packaged Alembic head does not match the approved target.")

    previous = _current_revision(session)
    if previous == TARGET_REVISION:
        return SchemaUpgradeOutcome(previous, previous, False)
    if previous != SOURCE_REVISION:
        raise ConflictError(
            "unexpected_database_revision",
            f"Expected {SOURCE_REVISION} before the bounded production upgrade.",
        )

    session.rollback()
    command.upgrade(config, TARGET_REVISION)
    current = _current_revision(session)
    if current != TARGET_REVISION:
        raise RuntimeError("Alembic did not reach the approved target revision.")
    return SchemaUpgradeOutcome(previous, current, True)
