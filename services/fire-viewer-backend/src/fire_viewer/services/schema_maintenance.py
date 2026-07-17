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
APPROVED_TRANSITIONS = {
    "e6f3a1b8c420": "f3b8c1d7a920",
    "f3b8c1d7a920": "a4e9c2f7d610",
    "a4e9c2f7d610": "b8d4f6a9c210",
    "b8d4f6a9c210": "c9f1a7d4e620",
    "c9f1a7d4e620": "d2a6e8f1b430",
    "d2a6e8f1b430": "d7c5e3a1b920",
}


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
    scripts = ScriptDirectory.from_config(config)
    heads = scripts.get_heads()
    if heads != [TARGET_REVISION]:
        raise RuntimeError("The packaged Alembic head does not match the approved target.")

    previous = _current_revision(session)
    if previous == TARGET_REVISION:
        return SchemaUpgradeOutcome(previous, previous, False)
    next_revision = APPROVED_TRANSITIONS.get(previous)
    if next_revision is None:
        raise ConflictError(
            "unexpected_database_revision",
            "The database revision is outside the approved production upgrade chain.",
        )
    next_script = scripts.get_revision(next_revision)
    if next_script is None or next_script.down_revision != previous:
        raise RuntimeError("The packaged Alembic chain does not match the approved transition.")

    session.rollback()
    # One explicit revision per request keeps this exceptional maintenance
    # operation within the serverless execution window. Every transition is
    # still an actual Alembic migration; none is skipped or merely stamped.
    command.upgrade(config, next_revision)
    current = _current_revision(session)
    if current != next_revision:
        raise RuntimeError("Alembic did not reach the approved next revision.")
    return SchemaUpgradeOutcome(previous, current, True)
