from __future__ import annotations

from fire_viewer.db.models import Observation, Source
from fire_viewer.domain.enums import MatchDecision, SourceTrust, SourceType, VerificationState


def _verified_observation(session, incident, episode, *, state: VerificationState) -> None:
    source = Source(
        source_key=f"public-view-{incident.fire_id}-{state.value}",
        source_type=SourceType.INSTITUTIONAL,
        trust=SourceTrust.INSTITUTIONAL,
        display_name="Private source name",
        public_display_name="Source institutionnelle",
        public_license="ODbL-1.0",
        public_reference_url="https://example.invalid/public-source",
        public_transformations=["normalisation"],
        enabled=True,
    )
    session.add(source)
    session.flush()
    session.add(
        Observation(
            observation_id=f"OBS-{incident.fire_id}-{state.value}",
            source_id=source.id,
            observed_at=episode.last_observed_at,
            received_at=episode.last_observed_at,
            longitude=incident.reference_lon,
            latitude=incident.reference_lat,
            horizontal_uncertainty_m=incident.horizontal_uncertainty_m,
            territory_code=incident.territory_code,
            toponyms=["private precise toponym"],
            evidence_hash="sha256:" + "a" * 64,
            evidence_license="private-license",
            external_reference="https://example.invalid/private-evidence",
            request_hash="b" * 64,
            verification_state=state,
            attached_incident_id=incident.id,
            attached_episode_id=episode.id,
            match_decision=MatchDecision.ATTACH,
            match_factors={},
            review_reasons=[],
            policy_id="test-policy",
            trace_id="trace-public-view",
            version=1,
        )
    )
    session.commit()


def test_public_view_filters_sensitive_observation_fields_and_supports_etag(
    client, seed_incident, session
) -> None:
    incident, episode = seed_incident(fire_id="FR-83-00601", sequence=601, lon=6.02, lat=43.29)
    _verified_observation(session, incident, episode, state=VerificationState.VERIFIED)
    _verified_observation(session, incident, episode, state=VerificationState.PENDING_REVIEW)

    response = client.get(f"/api/v1/incident/{incident.fire_id}/public-view")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=30, must-revalidate"
    body = response.json()
    assert body["schema_version"] == "1.0"
    assert len(body["observations"]) == 1
    assert body["sources"][0]["name"] == "Source institutionnelle"
    rendered = str(body)
    assert "private precise toponym" not in rendered
    assert "private-evidence" not in rendered
    assert "Private source name" not in rendered
    assert (
        client.get(
            f"/api/v1/incident/{incident.fire_id}/public-view",
            headers={"If-None-Match": response.headers["etag"]},
        ).status_code
        == 304
    )
    assert (
        client.get(f"/api/v1/incident/{incident.fire_id}/public-view/export.json").json()["fire_id"]
        == incident.fire_id
    )
    assert (
        "occurred_at"
        in client.get(f"/api/v1/incident/{incident.fire_id}/public-view/timeline.csv").text
    )


def test_public_report_is_deduplicated_and_never_changes_public_view(client, seed_incident) -> None:
    incident, _episode = seed_incident(fire_id="FR-83-00602", sequence=602, lon=6.03, lat=43.30)
    payload = {
        "category": "information_obsolete",
        "message": "La date de validation affichée doit être vérifiée.",
    }

    first = client.post(f"/api/v1/incident/{incident.fire_id}/reports", json=payload)
    duplicate = client.post(f"/api/v1/incident/{incident.fire_id}/reports", json=payload)

    assert first.status_code == 202
    assert duplicate.status_code == 202
    assert duplicate.json()["replayed"] is True
    assert client.get(f"/api/v1/incident/{incident.fire_id}/public-view").status_code == 200
