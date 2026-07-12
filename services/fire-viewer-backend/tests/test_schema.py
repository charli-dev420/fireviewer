from sqlalchemy import inspect


def test_minimal_incident_schema_is_migrated(app) -> None:
    inspector = inspect(app.state.engine)
    tables = set(inspector.get_table_names())
    assert {
        "incident_series",
        "episode",
        "observation",
        "model_asset",
        "job",
        "source",
        "audit_event",
        "manifest_revision",
        "idempotency_record",
        "outbox_event",
    }.issubset(tables)
    audit_columns = {column["name"] for column in inspector.get_columns("audit_event")}
    assert {"before_snapshot", "after_snapshot", "before_hash", "after_hash"}.issubset(
        audit_columns
    )
