from datetime import UTC, datetime, timedelta

from fire_viewer.core.config import Settings
from fire_viewer.domain.enums import IncidentStatus, MatchDecision, SourceTrust
from fire_viewer.domain.matching import Candidate, ObservationForMatch, match_observation


def test_candidate_overflow_forces_review_even_when_visible_candidates_score_low() -> None:
    now = datetime.now(UTC)
    settings = Settings(_env_file=None, environment="test", auth_mode="disabled")
    observation = ObservationForMatch(
        longitude=6.0,
        latitude=43.0,
        uncertainty_m=50.0,
        observed_at=now,
        toponyms=("Unrelated place",),
        canonical_name_hint=None,
        source_trust=SourceTrust.UNVERIFIED,
    )
    candidates = [
        Candidate(
            incident_db_id=1,
            episode_db_id=1,
            fire_id="FR-83-00001",
            episode_id="E01",
            reference_lon=7.0,
            reference_lat=44.0,
            uncertainty_m=50.0,
            canonical_name="Another place",
            status=IncidentStatus.MONITORING,
            started_at=now - timedelta(hours=1),
            last_observed_at=now - timedelta(minutes=30),
            ended_at=None,
        )
    ]

    result = match_observation(
        observation,
        candidates,
        settings,
        candidate_overflow=True,
    )

    assert result.decision == MatchDecision.REVIEW
    assert result.review_reasons == ("candidate_limit_exceeded",)
