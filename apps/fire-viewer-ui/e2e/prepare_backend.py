"""Create the disposable database used by the live Playwright harness.

This intentionally uses Alembic's Python API instead of the ``alembic.ini``
default.  The E2E suite must never migrate the developer's local database.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from alembic import command
from alembic.config import Config


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-root", type=Path, required=True)
    parser.add_argument("--database-path", type=Path, required=True)
    parser.add_argument("--database-url", required=True)
    return parser.parse_args()


def sqlite_url(database_path: Path) -> str:
    return f"sqlite:///{database_path.as_posix()}"


def main() -> None:
    args = parse_args()
    backend_root = args.backend_root.resolve()
    database_path = args.database_path.resolve()
    database_url = args.database_url.replace("\\", "/")
    expected_url = sqlite_url(database_path)

    if not database_path.is_absolute():
        raise ValueError("The E2E database path must be absolute.")
    if database_url != expected_url:
        raise ValueError(
            "The E2E SQLite URL must exactly match its explicit absolute database path."
        )
    if database_url == "sqlite:///./data/fire_viewer.db":
        raise ValueError("Refusing to migrate Alembic's default developer database.")

    alembic_ini = backend_root / "alembic.ini"
    migrations = backend_root / "migrations"
    if not alembic_ini.is_file() or not migrations.is_dir():
        raise FileNotFoundError("Backend Alembic configuration is unavailable.")

    database_path.parent.mkdir(parents=True, exist_ok=True)
    config = Config(str(alembic_ini))
    config.set_main_option("script_location", str(migrations))
    config.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(config, "head")
    print(f"E2E database migrated: {database_path}")


if __name__ == "__main__":
    main()
