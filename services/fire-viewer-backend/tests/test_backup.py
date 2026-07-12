import sqlite3
from contextlib import closing

import pytest

from fire_viewer.scripts.backup_sqlite import create_backup, sqlite_path_from_url


def test_sqlite_backup_is_integrity_checked_and_atomically_published(
    app, settings, tmp_path
) -> None:
    source = sqlite_path_from_url(settings.database_url)
    destination = tmp_path / "backups" / "snapshot.db"
    create_backup(source, destination)

    assert destination.exists()
    assert not list(destination.parent.glob("*.part"))
    with closing(sqlite3.connect(destination)) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
    assert "incident_series" in tables
    assert "audit_event" in tables

    with pytest.raises(ValueError, match="must differ"):
        create_backup(source, source)
