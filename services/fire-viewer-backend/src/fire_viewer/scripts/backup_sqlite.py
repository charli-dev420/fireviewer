from __future__ import annotations

import argparse
import os
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import unquote
from uuid import uuid4

from fire_viewer.core.config import get_settings


def sqlite_path_from_url(url: str) -> Path:
    prefixes = ("sqlite:///", "sqlite+pysqlite:///")
    for prefix in prefixes:
        if url.startswith(prefix):
            value = unquote(url.removeprefix(prefix))
            if value == ":memory:":
                raise ValueError("An in-memory database cannot be backed up")
            return Path(value).resolve()
    raise ValueError("fire-viewer-backup only supports SQLite database URLs")


def create_backup(source_path: Path, destination_path: Path) -> None:
    source_path = source_path.resolve()
    destination_path = destination_path.resolve()
    if not source_path.exists():
        raise FileNotFoundError(source_path)
    if source_path == destination_path:
        raise ValueError("Backup destination must differ from the source database")

    destination_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = destination_path.with_name(f".{destination_path.name}.{uuid4().hex}.part")
    try:
        with (
            closing(sqlite3.connect(source_path)) as source,
            closing(sqlite3.connect(temporary_path)) as destination,
        ):
            source.execute("PRAGMA wal_checkpoint(FULL)")
            source.backup(destination)
            result = destination.execute("PRAGMA integrity_check").fetchone()
            if not result or result[0] != "ok":
                raise RuntimeError(f"Backup integrity check failed: {result}")
        with temporary_path.open("rb") as handle:
            os.fsync(handle.fileno())
        os.replace(temporary_path, destination_path)
    finally:
        temporary_path.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a consistent SQLite backup")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    settings = get_settings()
    source = sqlite_path_from_url(settings.database_url)
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    output = args.output or Path("backups") / f"fire_viewer_{timestamp}.db"
    create_backup(source, output)
    print(output.resolve())


if __name__ == "__main__":
    main()
