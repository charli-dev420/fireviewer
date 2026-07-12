from sqlalchemy import func, select

from fire_viewer.db.models import IncidentSeries, Observation


def test_review_resolution_create_is_idempotent(
    client, session, payload_factory, seed_incident
) -> None:
    seed_incident(fire_id="FR-83-00030", sequence=30, lon=6.0200, lat=43.2897, uncertainty_m=500)
    seed_incident(fire_id="FR-83-00031", sequence=31, lon=6.0220, lat=43.2897, uncertainty_m=500)
    detection = client.post(
        "/api/v1/incidents/detect",
        headers={"Idempotency-Key": "review-detect-0001"},
        json=payload_factory(
            source_id="review-resolution-source",
            lon=6.0210,
            lat=43.2897,
            uncertainty_m=450,
            content_char="4",
        ),
    )
    assert detection.status_code == 200
    assert detection.json()["decision"] == "review"
    observation_id = detection.json()["observation_id"]
    resolution_payload = {
        "action": "create",
        "expected_version": 1,
        "reason": "Validator determined this is a distinct incident series.",
    }
    first = client.post(
        f"/api/v1/operator/observations/{observation_id}/resolve",
        headers={"Idempotency-Key": "review-resolve-0001"},
        json=resolution_payload,
    )
    second = client.post(
        f"/api/v1/operator/observations/{observation_id}/resolve",
        headers={"Idempotency-Key": "review-resolve-0001"},
        json=resolution_payload,
    )
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert second.headers["Idempotent-Replay"] == "true"
    assert session.scalar(select(func.count()).select_from(IncidentSeries)) == 3
    observation = session.execute(
        select(Observation).where(Observation.observation_id == observation_id)
    ).scalar_one()
    assert observation.attached_incident_id is not None
    assert observation.verification_state.value == "VERIFIED"
