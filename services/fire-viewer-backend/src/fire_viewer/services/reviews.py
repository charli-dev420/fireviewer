from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from fire_viewer.core.config import Settings
from fire_viewer.core.ids import FIRE_ID_RE
from fire_viewer.core.security import Actor
from fire_viewer.core.time import as_utc
from fire_viewer.db.models import Episode, IncidentSeries, Observation
from fire_viewer.db.transactions import begin_write_transaction
from fire_viewer.domain.enums import (
    IncidentStatus,
    MatchDecision,
    ReviewResolutionAction,
    VerificationState,
)
from fire_viewer.domain.errors import BadRequestError, ConflictError, NotFoundError
from fire_viewer.domain.hashing import sha256_hex
from fire_viewer.domain.schemas import ReviewResolutionRequest, ReviewResolutionResponse
from fire_viewer.services.common import (
    create_incident_and_episode,
    create_reactivation_episode,
    emit_outbox,
    observation_snapshot,
    record_operator_audit,
)
from fire_viewer.services.idempotency import find_replay, store_response


@dataclass(frozen=True, slots=True)
class ReviewOutcome:
    response: ReviewResolutionResponse
    replayed: bool


def resolve_review(
    session: Session,
    *,
    observation_id: str,
    payload: ReviewResolutionRequest,
    idempotency_key: str,
    actor: Actor,
    trace_id: str,
    settings: Settings,
) -> ReviewOutcome:
    endpoint = f"POST /api/v1/operator/observations/{observation_id}/resolve"
    request_hash = sha256_hex(
        {
            "actor_id": actor.actor_id,
            "payload": payload.model_dump(mode="json", exclude_none=True),
        }
    )
    begin_write_transaction(session)
    replay = find_replay(
        session,
        endpoint=endpoint,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
    )
    if replay:
        session.rollback()
        return ReviewOutcome(
            response=ReviewResolutionResponse.model_validate(replay.response_body),
            replayed=True,
        )

    observation = session.execute(
        select(Observation).where(Observation.observation_id == observation_id).with_for_update()
    ).scalar_one_or_none()
    if observation is None:
        raise NotFoundError("observation", observation_id)
    if observation.version != payload.expected_version:
        raise ConflictError(
            "stale_observation_version",
            "The observation was modified by another operation.",
            extra={"current_version": observation.version},
        )
    if observation.verification_state in {VerificationState.VERIFIED, VerificationState.REJECTED}:
        raise ConflictError(
            "review_already_resolved",
            "The observation review has already been resolved.",
        )

    before = observation_snapshot(observation)
    incident: IncidentSeries | None = None
    episode: Episode | None = None

    if payload.action == ReviewResolutionAction.REJECT:
        observation.verification_state = VerificationState.REJECTED
    elif payload.action == ReviewResolutionAction.CREATE:
        incident, episode = create_incident_and_episode(
            session,
            territory_code=observation.territory_code,
            longitude=observation.longitude,
            latitude=observation.latitude,
            uncertainty_m=observation.horizontal_uncertainty_m,
            canonical_name=observation.canonical_name_hint
            or (observation.toponyms[0] if observation.toponyms else None),
            observed_at=as_utc(observation.observed_at),
            policy_id=settings.matching_policy_id,
        )
        observation.attached_incident_id = incident.id
        observation.attached_episode_id = episode.id
        observation.proposed_incident_id = None
        observation.proposed_episode_id = None
        observation.match_decision = MatchDecision.CREATE
        observation.verification_state = VerificationState.VERIFIED
        observation.review_reasons = []
    else:
        if payload.target_fire_id is None or not FIRE_ID_RE.fullmatch(payload.target_fire_id):
            raise BadRequestError("invalid_fire_id", "target_fire_id has an invalid format.")
        incident = session.execute(
            select(IncidentSeries)
            .where(IncidentSeries.fire_id == payload.target_fire_id)
            .with_for_update()
        ).scalar_one_or_none()
        if incident is None:
            raise NotFoundError("incident", payload.target_fire_id)
        current = session.execute(
            select(Episode)
            .where(Episode.incident_id == incident.id, Episode.is_current.is_(True))
            .with_for_update()
        ).scalar_one()
        if current.status in {IncidentStatus.SUSPENDED, IncidentStatus.REJECTED}:
            raise ConflictError(
                "incident_not_attachable",
                "The selected incident cannot accept observations in its current state.",
            )
        if current.status in {IncidentStatus.EXTINGUISHED, IncidentStatus.CLOSED}:
            episode = create_reactivation_episode(
                session,
                incident=incident,
                previous_episode=current,
                observed_at=as_utc(observation.observed_at),
                policy_id=settings.matching_policy_id,
            )
        else:
            episode = current
            if as_utc(observation.observed_at) > as_utc(episode.last_observed_at):
                episode.last_observed_at = as_utc(observation.observed_at)
                episode.version += 1
        observation.attached_incident_id = incident.id
        observation.attached_episode_id = episode.id
        observation.proposed_incident_id = None
        observation.proposed_episode_id = None
        observation.match_decision = MatchDecision.ATTACH
        observation.verification_state = VerificationState.VERIFIED
        observation.review_reasons = []

    observation.version += 1
    session.flush()
    after = observation_snapshot(observation)
    record_operator_audit(
        session,
        actor=actor,
        action="observation.review.resolved",
        target_type="observation",
        target_id=observation.observation_id,
        reason=payload.reason,
        trace_id=trace_id,
        before=before,
        after=after,
        payload={"resolution": payload.action.value},
    )
    emit_outbox(
        session,
        topic="observation.review_resolved",
        aggregate_type="observation",
        aggregate_id=observation.observation_id,
        trace_id=trace_id,
        idempotency_key=idempotency_key,
        payload={
            "observation_id": observation.observation_id,
            "resolution": payload.action.value,
            "fire_id": incident.fire_id if incident else None,
            "episode_id": episode.episode_id if episode else None,
        },
    )
    response = ReviewResolutionResponse(
        observation_id=observation.observation_id,
        action=payload.action,
        verification_state=observation.verification_state,
        fire_id=incident.fire_id if incident else None,
        episode_id=episode.episode_id if episode else None,
        version=observation.version,
        trace_id=trace_id,
    )
    response_body = response.model_dump(mode="json", exclude_none=True)
    store_response(
        session,
        endpoint=endpoint,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        response_status=200,
        response_body=response_body,
        trace_id=trace_id,
        settings=settings,
    )
    session.commit()
    return ReviewOutcome(response=response, replayed=False)
