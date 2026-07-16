"""Private incident-centred read models for the operator workbench."""

from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from fire_viewer.core.config import Settings
from fire_viewer.core.time import as_utc
from fire_viewer.db.models import (
    AuditEvent,
    Episode,
    IncidentSeries,
    Job,
    ManifestRevision,
    ModelAsset,
    Observation,
    SpatialZoneRevision,
)
from fire_viewer.domain.enums import PublicReportState, VerificationState
from fire_viewer.domain.errors import NotFoundError
from fire_viewer.domain.model_eligibility import evaluate_model_generation_eligibility
from fire_viewer.domain.schemas import (
    AdminIncidentAuditEvent,
    AdminIncidentDetail,
    AdminIncidentListResponse,
    AdminIncidentMediaReference,
    AdminIncidentModel,
    AdminIncidentModelsPipelineResponse,
    AdminIncidentModelWorkspaceItem,
    AdminIncidentObservation,
    AdminIncidentObservationsResponse,
    AdminIncidentObservationWorkspaceItem,
    AdminIncidentPipelineJob,
    AdminIncidentSource,
    AdminIncidentSourcesMediaResponse,
    AdminIncidentSourceWorkspaceItem,
    AdminIncidentSummary,
    AdminWorkQueueIncident,
    AdminWorkQueueObservation,
    AdminWorkQueueResponse,
)
from fire_viewer.services.public_incident_view import list_public_reports
from fire_viewer.services.queries import _episode_summary


def _summary(incident: IncidentSeries, settings: Settings) -> AdminIncidentSummary:
    current = next(episode for episode in incident.episodes if episode.is_current)
    eligibility = evaluate_model_generation_eligibility(
        estimated_area_ha=current.estimated_area_ha,
        evacuation_established=current.evacuation_established,
        area_threshold_ha=settings.model_generation_min_area_ha,
    )
    return AdminIncidentSummary(
        fire_id=incident.fire_id,
        canonical_name=incident.canonical_name,
        territory_code=incident.territory_code,
        visibility=incident.public_visibility,
        current_episode_id=current.episode_id,
        status=current.status,
        verification_state=current.verification_state,
        corroborating_source_count=current.corroborating_source_count,
        estimated_area_ha=current.estimated_area_ha,
        evacuation_established=current.evacuation_established,
        model_generation_eligible=eligibility.eligible,
        review_required=current.review_required,
        last_observed_at=as_utc(current.last_observed_at),
        pending_observation_count=sum(
            observation.verification_state == VerificationState.PENDING_REVIEW
            for observation in incident.observations
        ),
        version=incident.version,
    )


def list_admin_incidents(session: Session, *, settings: Settings) -> AdminIncidentListResponse:
    incidents = (
        session.execute(
            select(IncidentSeries)
            .options(
                selectinload(IncidentSeries.episodes), selectinload(IncidentSeries.observations)
            )
            .order_by(IncidentSeries.updated_at.desc(), IncidentSeries.fire_id.asc())
            .limit(200)
        )
        .scalars()
        .all()
    )
    return AdminIncidentListResponse(
        incidents=[_summary(incident, settings) for incident in incidents]
    )


def get_admin_work_queue(session: Session) -> AdminWorkQueueResponse:
    """Private queue: only unresolved observations, open reports, and review-required episodes."""
    observations = (
        session.execute(
            select(Observation)
            .where(Observation.verification_state == VerificationState.PENDING_REVIEW)
            .options(
                selectinload(Observation.source),
                selectinload(Observation.proposed_incident),
                selectinload(Observation.proposed_episode),
            )
            .order_by(Observation.observed_at.asc(), Observation.observation_id.asc())
            .limit(200)
        )
        .scalars()
        .all()
    )
    episodes = (
        session.execute(
            select(Episode)
            .where(Episode.is_current.is_(True), Episode.review_required.is_(True))
            .options(selectinload(Episode.incident))
            .order_by(Episode.last_observed_at.asc(), Episode.episode_id.asc())
            .limit(200)
        )
        .scalars()
        .all()
    )
    return AdminWorkQueueResponse(
        observations=[
            AdminWorkQueueObservation(
                observation_id=item.observation_id,
                source_key=item.source.source_key,
                observed_at=as_utc(item.observed_at),
                longitude=item.longitude,
                latitude=item.latitude,
                horizontal_uncertainty_m=item.horizontal_uncertainty_m,
                verification_state=item.verification_state,
                proposed_fire_id=item.proposed_incident.fire_id if item.proposed_incident else None,
                proposed_episode_id=item.proposed_episode.episode_id
                if item.proposed_episode
                else None,
                proposed_episode_status=item.proposed_episode.status
                if item.proposed_episode
                else None,
                match_score=item.match_score,
                review_reasons=list(item.review_reasons),
                version=item.version,
            )
            for item in observations
        ],
        reports=list_public_reports(session, state=PublicReportState.PENDING).reports,
        incidents=[
            AdminWorkQueueIncident(
                fire_id=item.incident.fire_id,
                episode_id=item.episode_id,
                status=item.status,
                verification_state=item.verification_state,
                last_observed_at=as_utc(item.last_observed_at),
                version=item.version,
            )
            for item in episodes
        ],
    )


def _incident_for_workspace(session: Session, *, fire_id: str) -> IncidentSeries:
    incident = session.execute(
        select(IncidentSeries)
        .where(IncidentSeries.fire_id == fire_id)
        .options(selectinload(IncidentSeries.episodes))
    ).scalar_one_or_none()
    if incident is None:
        raise NotFoundError("incident", fire_id)
    return incident


def _incident_observations(session: Session, incident: IncidentSeries) -> list[Observation]:
    """Attached observations and unresolved candidates explicitly proposed for this fire."""
    return list(
        session.execute(
            select(Observation)
            .where(
                or_(
                    Observation.attached_incident_id == incident.id,
                    Observation.proposed_incident_id == incident.id,
                )
            )
            .options(
                selectinload(Observation.source),
                selectinload(Observation.attached_episode),
                selectinload(Observation.proposed_episode),
            )
            .order_by(Observation.observed_at.desc(), Observation.observation_id.asc())
            .limit(500)
        )
        .scalars()
        .all()
    )


def get_admin_incident_observations(
    session: Session, *, fire_id: str
) -> AdminIncidentObservationsResponse:
    incident = _incident_for_workspace(session, fire_id=fire_id)
    observations = _incident_observations(session, incident)
    return AdminIncidentObservationsResponse(
        fire_id=incident.fire_id,
        observations=[
            AdminIncidentObservationWorkspaceItem(
                observation_id=item.observation_id,
                source_key=item.source.source_key,
                source_type=item.source.source_type,
                observed_at=as_utc(item.observed_at),
                received_at=as_utc(item.received_at),
                longitude=item.longitude,
                latitude=item.latitude,
                horizontal_uncertainty_m=item.horizontal_uncertainty_m,
                verification_state=item.verification_state,
                match_decision=item.match_decision.value,
                attached_episode_id=(
                    item.attached_episode.episode_id if item.attached_episode else None
                ),
                proposed_fire_id=(
                    incident.fire_id if item.proposed_incident_id == incident.id else None
                ),
                proposed_episode_id=(
                    item.proposed_episode.episode_id if item.proposed_episode else None
                ),
                match_score=item.match_score,
                margin_to_second_candidate=item.margin_to_second_candidate,
                review_reasons=list(item.review_reasons),
                external_reference=item.external_reference,
                evidence_license=item.evidence_license,
                version=item.version,
            )
            for item in observations
        ],
    )


def get_admin_incident_sources_media(
    session: Session, *, fire_id: str
) -> AdminIncidentSourcesMediaResponse:
    incident = _incident_for_workspace(session, fire_id=fire_id)
    observations = _incident_observations(session, incident)
    source_observations: dict[int, list[Observation]] = {}
    for observation in observations:
        source_observations.setdefault(observation.source.id, []).append(observation)

    sources = [
        AdminIncidentSourceWorkspaceItem(
            source_key=items[0].source.source_key,
            type=items[0].source.source_type,
            trust=items[0].source.trust,
            enabled=items[0].source.enabled,
            display_name=items[0].source.display_name,
            public_display_name=items[0].source.public_display_name,
            public_license=items[0].source.public_license,
            public_reference_url=items[0].source.public_reference_url,
            public_transformations=list(items[0].source.public_transformations),
            observation_count=len(items),
        )
        for _, items in sorted(
            source_observations.items(), key=lambda item: item[1][0].source.source_key
        )
    ]
    return AdminIncidentSourcesMediaResponse(
        fire_id=incident.fire_id,
        sources=sources,
        media_references=[
            AdminIncidentMediaReference(
                observation_id=item.observation_id,
                source_key=item.source.source_key,
                source_type=item.source.source_type,
                observed_at=as_utc(item.observed_at),
                received_at=as_utc(item.received_at),
                verification_state=item.verification_state,
                evidence_hash=item.evidence_hash,
                evidence_license=item.evidence_license,
                external_reference=item.external_reference,
            )
            for item in observations
        ],
    )


def get_admin_incident_models_pipeline(
    session: Session, *, fire_id: str
) -> AdminIncidentModelsPipelineResponse:
    incident = _incident_for_workspace(session, fire_id=fire_id)
    episode_by_db_id = {episode.id: episode.episode_id for episode in incident.episodes}
    revisions = (
        session.execute(
            select(ManifestRevision)
            .where(ManifestRevision.incident_id == incident.id)
            .options(
                selectinload(ManifestRevision.asset)
                .selectinload(ModelAsset.spatial_zone_revision)
                .selectinload(SpatialZoneRevision.zone),
                selectinload(ManifestRevision.spatial_zone_revision).selectinload(
                    SpatialZoneRevision.zone
                ),
            )
            .order_by(ManifestRevision.revision.desc())
            .limit(200)
        )
        .scalars()
        .all()
    )
    jobs = (
        session.execute(
            select(Job)
            .where(Job.incident_id == incident.id)
            .options(selectinload(Job.episode))
            .order_by(Job.updated_at.desc(), Job.job_id.asc())
            .limit(500)
        )
        .scalars()
        .all()
    )

    return AdminIncidentModelsPipelineResponse(
        fire_id=incident.fire_id,
        models=[
            AdminIncidentModelWorkspaceItem(
                revision=revision.revision,
                episode_id=episode_by_db_id.get(revision.episode_id, "inconnu"),
                is_current=revision.is_current,
                created_at=as_utc(revision.created_at),
                reason=revision.reason,
                asset_id=revision.asset.asset_id if revision.asset else None,
                asset_state=revision.asset.state.value if revision.asset else None,
                asset_version=revision.asset.version if revision.asset else None,
                lod=revision.asset.lod.value if revision.asset else None,
                sha256=revision.asset.sha256 if revision.asset else None,
                size_bytes=revision.asset.size_bytes if revision.asset else None,
                terrain_source_year=revision.asset.terrain_source_year if revision.asset else None,
                generated_at=as_utc(revision.asset.generated_at) if revision.asset else None,
                published_at=as_utc(revision.asset.published_at)
                if revision.asset and revision.asset.published_at
                else None,
                superseded_at=as_utc(revision.asset.superseded_at)
                if revision.asset and revision.asset.superseded_at
                else None,
                spatial_zone_id=revision.spatial_zone_revision.zone.zone_id
                if revision.spatial_zone_revision
                else None,
                spatial_zone_revision=revision.spatial_zone_revision.revision
                if revision.spatial_zone_revision
                else None,
                asset_spatial_zone_id=revision.asset.spatial_zone_revision.zone.zone_id
                if revision.asset and revision.asset.spatial_zone_revision
                else None,
                asset_spatial_zone_revision=revision.asset.spatial_zone_revision.revision
                if revision.asset and revision.asset.spatial_zone_revision
                else None,
            )
            for revision in revisions
        ],
        jobs=[
            AdminIncidentPipelineJob(
                job_id=job.job_id,
                kind=job.kind.value,
                state=job.state.value,
                episode_id=job.episode.episode_id,
                attempt=job.attempt,
                max_attempts=job.max_attempts,
                next_attempt_at=as_utc(job.next_attempt_at) if job.next_attempt_at else None,
                last_error=job.last_error,
                created_at=as_utc(job.created_at),
                updated_at=as_utc(job.updated_at),
            )
            for job in jobs
        ],
    )


def get_admin_incident(
    session: Session, *, fire_id: str, settings: Settings
) -> AdminIncidentDetail:
    incident = session.execute(
        select(IncidentSeries)
        .where(IncidentSeries.fire_id == fire_id)
        .options(
            selectinload(IncidentSeries.episodes),
            selectinload(IncidentSeries.observations).selectinload(Observation.source),
            selectinload(IncidentSeries.manifest_revisions)
            .selectinload(ManifestRevision.asset)
            .selectinload(ModelAsset.spatial_zone_revision)
            .selectinload(SpatialZoneRevision.zone),
            selectinload(IncidentSeries.manifest_revisions)
            .selectinload(ManifestRevision.spatial_zone_revision)
            .selectinload(SpatialZoneRevision.zone),
        )
    ).scalar_one_or_none()
    if incident is None:
        raise NotFoundError("incident", fire_id)

    episode_by_db_id = {episode.id: episode.episode_id for episode in incident.episodes}
    audit_target_ids = [
        incident.fire_id,
        *[f"{incident.fire_id}/{episode.episode_id}" for episode in incident.episodes],
        *[item.observation_id for item in incident.observations],
    ]
    audit_rows = (
        session.execute(
            select(AuditEvent)
            .where(AuditEvent.target_id.in_(audit_target_ids))
            .order_by(AuditEvent.occurred_at.desc())
            .limit(100)
        )
        .scalars()
        .all()
    )
    source_rows = {
        observation.source.id: observation.source for observation in incident.observations
    }
    summary = _summary(incident, settings)
    return AdminIncidentDetail(
        **summary.model_dump(),
        episodes=[_episode_summary(episode, settings) for episode in incident.episodes],
        observations=[
            AdminIncidentObservation(
                observation_id=observation.observation_id,
                source_key=observation.source.source_key,
                observed_at=as_utc(observation.observed_at),
                verification_state=observation.verification_state,
                attached_episode_id=episode_by_db_id.get(observation.attached_episode_id)
                if observation.attached_episode_id is not None
                else None,
                proposed_fire_id=incident.fire_id
                if observation.proposed_incident_id == incident.id
                else None,
                proposed_episode_id=episode_by_db_id.get(observation.proposed_episode_id)
                if observation.proposed_episode_id is not None
                else None,
                match_score=observation.match_score,
                review_reasons=list(observation.review_reasons),
                version=observation.version,
            )
            for observation in sorted(
                incident.observations, key=lambda item: item.observed_at, reverse=True
            )
        ],
        sources=[
            AdminIncidentSource(
                source_key=source.source_key,
                type=source.source_type,
                trust=source.trust,
                enabled=source.enabled,
                display_name=source.display_name,
                public_display_name=source.public_display_name,
            )
            for source in sorted(source_rows.values(), key=lambda item: item.source_key)
        ],
        models=[
            AdminIncidentModel(
                revision=revision.revision,
                episode_id=episode_by_db_id.get(revision.episode_id, "inconnu"),
                is_current=revision.is_current,
                asset_id=revision.asset.asset_id if revision.asset else None,
                asset_state=revision.asset.state.value if revision.asset else None,
                asset_version=revision.asset.version if revision.asset else None,
                lod=revision.asset.lod.value if revision.asset else None,
                size_bytes=revision.asset.size_bytes if revision.asset else None,
                generated_at=as_utc(revision.asset.generated_at) if revision.asset else None,
                spatial_zone_id=revision.spatial_zone_revision.zone.zone_id
                if revision.spatial_zone_revision
                else None,
                spatial_zone_revision=revision.spatial_zone_revision.revision
                if revision.spatial_zone_revision
                else None,
                asset_spatial_zone_id=revision.asset.spatial_zone_revision.zone.zone_id
                if revision.asset and revision.asset.spatial_zone_revision
                else None,
                asset_spatial_zone_revision=revision.asset.spatial_zone_revision.revision
                if revision.asset and revision.asset.spatial_zone_revision
                else None,
            )
            for revision in sorted(
                incident.manifest_revisions, key=lambda item: item.revision, reverse=True
            )
        ],
        audit=[
            AdminIncidentAuditEvent(
                event_id=event.event_id,
                occurred_at=as_utc(event.occurred_at),
                action=event.action,
                target_type=event.target_type,
                target_id=event.target_id,
                actor_type=event.actor_type.value,
                actor_id=event.actor_id,
                reason=event.reason,
            )
            for event in audit_rows
        ],
    )
