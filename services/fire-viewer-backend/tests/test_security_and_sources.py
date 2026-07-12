from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError

from fire_viewer.db.models import AuditEvent, Observation, Source

TRUSTED_SOURCE_TOKEN = "source-token-for-tests-0123456789abcdef"


def test_unknown_source_cannot_self_assert_trust(client, session, payload_factory) -> None:
    response = client.post(
        "/api/v1/incident/detect",
        headers={"Idempotency-Key": "trust-escalation-test-0001"},
        json=payload_factory(
            source_id="unknown-institutional-source",
            trust="institutional",
            source_type="institutional",
        ),
    )
    assert response.status_code == 403
    assert session.scalar(select(func.count()).select_from(Source)) == 0
    assert session.scalar(select(func.count()).select_from(Observation)) == 0
    audit = session.execute(
        select(AuditEvent).where(AuditEvent.action == "source.trust_claim.rejected")
    ).scalar_one()
    assert audit.actor_id == "unknown-institutional-source"


def test_trusted_source_requires_provisioned_credential(client) -> None:
    registration = client.put(
        "/api/v1/operator/sources/official-feed-without-token",
        json={
            "type": "institutional",
            "trust": "institutional",
            "display_name": "Official feed without token",
            "enabled": True,
            "reason": "Negative test for source credential provisioning.",
        },
    )
    assert registration.status_code == 409
    assert registration.json()["type"].endswith("source_credential_required")


def test_operator_can_register_authenticated_trusted_source_then_ingest(
    client, payload_factory
) -> None:
    registration = client.put(
        "/api/v1/operator/sources/official-feed-83",
        json={
            "type": "institutional",
            "trust": "institutional",
            "display_name": "Official feed 83",
            "enabled": True,
            "ingest_token": TRUSTED_SOURCE_TOKEN,
            "reason": "Approved test source registration.",
        },
    )
    assert registration.status_code == 200
    assert registration.json()["credential_configured"] is True
    assert "ingest_token" not in registration.text

    missing = client.post(
        "/api/v1/incident/detect",
        headers={"Idempotency-Key": "official-source-missing-token-0001"},
        json=payload_factory(
            source_id="official-feed-83",
            source_type="institutional",
            trust="institutional",
            content_char="0",
        ),
    )
    assert missing.status_code == 401
    assert missing.headers["WWW-Authenticate"] == "SourceToken"

    invalid = client.post(
        "/api/v1/incident/detect",
        headers={
            "Idempotency-Key": "official-source-invalid-token-0001",
            "X-Source-Token": "wrong-token-for-tests-0123456789abcdef",
        },
        json=payload_factory(
            source_id="official-feed-83",
            source_type="institutional",
            trust="institutional",
            content_char="1",
        ),
    )
    assert invalid.status_code == 401

    detection = client.post(
        "/api/v1/incident/detect",
        headers={
            "Idempotency-Key": "official-source-test-0001",
            "X-Source-Token": TRUSTED_SOURCE_TOKEN,
        },
        json=payload_factory(
            source_id="official-feed-83",
            source_type="institutional",
            trust="institutional",
            content_char="2",
        ),
    )
    assert detection.status_code == 201
    assert detection.json()["factors"] == {}


def test_audit_table_is_append_only(client, session, payload_factory) -> None:
    response = client.post(
        "/api/v1/incident/detect",
        headers={"Idempotency-Key": "audit-append-test-0001"},
        json=payload_factory(content_char="3"),
    )
    assert response.status_code == 201
    event_id = session.execute(select(AuditEvent.id).limit(1)).scalar_one()
    try:
        session.execute(
            text("UPDATE audit_event SET reason = 'tampered' WHERE id = :id"),
            {"id": event_id},
        )
        session.commit()
        raise AssertionError("audit update unexpectedly succeeded")
    except DBAPIError:
        session.rollback()
