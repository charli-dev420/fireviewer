from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect


def main() -> None:
    project_root = Path(__file__).resolve().parents[3]
    with TemporaryDirectory(prefix="fire-viewer-migrations-") as temporary_directory:
        database_path = Path(temporary_directory) / "migration_check.db"
        config = Config(str(project_root / "alembic.ini"))
        config.set_main_option("script_location", str(project_root / "migrations"))
        config.set_main_option("sqlalchemy.url", f"sqlite:///{database_path}")

        command.upgrade(config, "head")
        command.check(config)
        command.downgrade(config, "base")

        engine = create_engine(f"sqlite:///{database_path}")
        try:
            remaining = set(inspect(engine).get_table_names())
        finally:
            engine.dispose()
        if remaining - {"alembic_version"}:
            raise RuntimeError(f"Downgrade left unexpected tables: {sorted(remaining)}")

    print("Alembic upgrade/check/downgrade: OK")


if __name__ == "__main__":
    main()
