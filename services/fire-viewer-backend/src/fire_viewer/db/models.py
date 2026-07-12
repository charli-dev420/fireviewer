from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from fire_viewer.core.time import utcnow
from fire_viewer.db.base import Base
from fire_viewer.domain.enums import (
    ActorType,
    AssetLod,
    AssetState,
    IncidentStatus,
    JobKind,
    JobState,
    MatchDecision,
    PublicVisibility,
    SourceTrust,
    SourceType,
    VerificationState,
)


def enum_column(enum_type: type, *, name: str) -> Enum:
    return Enum(enum_type, name=name, native_enum=False, validate_strings=True)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class Source(Base, TimestampMixin):
    __tablename__ = "source"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_key: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    source_type: Mapped[SourceType] = mapped_column(
        enum_column(SourceType, name="source_type"), nullable=False
    )
    trust: Mapped[SourceTrust] = mapped_column(
        enum_column(SourceTrust, name="source_trust"), nullable=False
    )
    display_name: Mapped[str | None] = mapped_column(String(255))
    credential_hash: Mapped[str | None] = mapped_column(String(64))
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    observations: Mapped[list[Observation]] = relationship(back_populates="source")


class FireIdCounter(Base):
    __tablename__ = "fire_id_counter"

    territory_code: Mapped[str] = mapped_column(String(3), primary_key=True)
    next_sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    __table_args__ = (CheckConstraint("next_sequence >= 1", name="ck_fire_id_counter_positive"),)


class IncidentSeries(Base, TimestampMixin):
    __tablename__ = "incident_series"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    fire_id: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    territory_code: Mapped[str] = mapped_column(String(3), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    canonical_name: Mapped[str | None] = mapped_column(String(255))
    reference_lon: Mapped[float] = mapped_column(Float, nullable=False)
    reference_lat: Mapped[float] = mapped_column(Float, nullable=False)
    horizontal_uncertainty_m: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_min_lon: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_max_lon: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_min_lat: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_max_lat: Mapped[float] = mapped_column(Float, nullable=False)
    public_visibility: Mapped[PublicVisibility] = mapped_column(
        enum_column(PublicVisibility, name="public_visibility"),
        nullable=False,
        default=PublicVisibility.LIMITED,
    )
    public_note: Mapped[str | None] = mapped_column(String(500))
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    episodes: Mapped[list[Episode]] = relationship(
        back_populates="incident", cascade="all, delete-orphan", order_by="Episode.ordinal"
    )
    observations: Mapped[list[Observation]] = relationship(
        back_populates="attached_incident",
        foreign_keys="Observation.attached_incident_id",
    )
    proposed_observations: Mapped[list[Observation]] = relationship(
        back_populates="proposed_incident",
        foreign_keys="Observation.proposed_incident_id",
    )
    assets: Mapped[list[ModelAsset]] = relationship(back_populates="incident")
    jobs: Mapped[list[Job]] = relationship(back_populates="incident")
    manifest_revisions: Mapped[list[ManifestRevision]] = relationship(back_populates="incident")

    __table_args__ = (
        UniqueConstraint("territory_code", "sequence", name="uq_incident_territory_sequence"),
        CheckConstraint("reference_lon >= -180 AND reference_lon <= 180", name="ck_incident_lon"),
        CheckConstraint("reference_lat >= -90 AND reference_lat <= 90", name="ck_incident_lat"),
        CheckConstraint("horizontal_uncertainty_m > 0", name="ck_incident_uncertainty"),
        CheckConstraint("version >= 1", name="ck_incident_version"),
        Index("ix_incident_bbox", "bbox_min_lon", "bbox_max_lon", "bbox_min_lat", "bbox_max_lat"),
    )


class Episode(Base, TimestampMixin):
    __tablename__ = "episode"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    incident_id: Mapped[int] = mapped_column(
        ForeignKey("incident_series.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    episode_id: Mapped[str] = mapped_column(String(16), nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[IncidentStatus] = mapped_column(
        enum_column(IncidentStatus, name="incident_status"), nullable=False
    )
    review_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    confidence_policy: Mapped[str] = mapped_column(String(64), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    validated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    incident: Mapped[IncidentSeries] = relationship(back_populates="episodes")
    observations: Mapped[list[Observation]] = relationship(
        back_populates="attached_episode", foreign_keys="Observation.attached_episode_id"
    )
    proposed_observations: Mapped[list[Observation]] = relationship(
        back_populates="proposed_episode", foreign_keys="Observation.proposed_episode_id"
    )
    assets: Mapped[list[ModelAsset]] = relationship(back_populates="episode")
    jobs: Mapped[list[Job]] = relationship(back_populates="episode")

    __table_args__ = (
        UniqueConstraint("incident_id", "episode_id", name="uq_episode_public_id"),
        UniqueConstraint("incident_id", "ordinal", name="uq_episode_ordinal"),
        CheckConstraint("ordinal >= 1", name="ck_episode_ordinal"),
        CheckConstraint("version >= 1", name="ck_episode_version"),
        Index(
            "uq_episode_one_current",
            "incident_id",
            unique=True,
            sqlite_where=text("is_current = 1"),
            postgresql_where=text("is_current"),
        ),
    )


class Observation(Base):
    __tablename__ = "observation"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    observation_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    source_id: Mapped[int] = mapped_column(
        ForeignKey("source.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    geometry_type: Mapped[str] = mapped_column(String(16), nullable=False, default="Point")
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    altitude_m: Mapped[float | None] = mapped_column(Float)
    vertical_datum: Mapped[str | None] = mapped_column(String(128))
    horizontal_uncertainty_m: Mapped[float] = mapped_column(Float, nullable=False)
    territory_code: Mapped[str] = mapped_column(String(3), nullable=False)
    toponyms: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    canonical_name_hint: Mapped[str | None] = mapped_column(String(255))
    evidence_hash: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    evidence_license: Mapped[str] = mapped_column(String(255), nullable=False)
    external_reference: Mapped[str | None] = mapped_column(String(512))
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    verification_state: Mapped[VerificationState] = mapped_column(
        enum_column(VerificationState, name="verification_state"), nullable=False
    )
    attached_incident_id: Mapped[int | None] = mapped_column(
        ForeignKey("incident_series.id", ondelete="RESTRICT"), index=True
    )
    attached_episode_id: Mapped[int | None] = mapped_column(
        ForeignKey("episode.id", ondelete="RESTRICT"), index=True
    )
    proposed_incident_id: Mapped[int | None] = mapped_column(
        ForeignKey("incident_series.id", ondelete="RESTRICT"), index=True
    )
    proposed_episode_id: Mapped[int | None] = mapped_column(
        ForeignKey("episode.id", ondelete="RESTRICT"), index=True
    )
    match_decision: Mapped[MatchDecision] = mapped_column(
        enum_column(MatchDecision, name="match_decision"), nullable=False
    )
    match_score: Mapped[float | None] = mapped_column(Float)
    margin_to_second_candidate: Mapped[float | None] = mapped_column(Float)
    match_factors: Mapped[dict[str, float]] = mapped_column(JSON, nullable=False, default=dict)
    review_reasons: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    policy_id: Mapped[str] = mapped_column(String(64), nullable=False)
    trace_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    source: Mapped[Source] = relationship(back_populates="observations")
    attached_incident: Mapped[IncidentSeries | None] = relationship(
        back_populates="observations", foreign_keys=[attached_incident_id]
    )
    attached_episode: Mapped[Episode | None] = relationship(
        back_populates="observations", foreign_keys=[attached_episode_id]
    )
    proposed_incident: Mapped[IncidentSeries | None] = relationship(
        back_populates="proposed_observations", foreign_keys=[proposed_incident_id]
    )
    proposed_episode: Mapped[Episode | None] = relationship(
        back_populates="proposed_observations", foreign_keys=[proposed_episode_id]
    )

    __table_args__ = (
        CheckConstraint("longitude >= -180 AND longitude <= 180", name="ck_observation_lon"),
        CheckConstraint("latitude >= -90 AND latitude <= 90", name="ck_observation_lat"),
        CheckConstraint("horizontal_uncertainty_m > 0", name="ck_observation_uncertainty"),
        CheckConstraint("version >= 1", name="ck_observation_version"),
        Index("ix_observation_episode_time", "attached_episode_id", "observed_at"),
    )


class ModelAsset(Base):
    __tablename__ = "model_asset"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    asset_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    incident_id: Mapped[int] = mapped_column(
        ForeignKey("incident_series.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    episode_id: Mapped[int] = mapped_column(
        ForeignKey("episode.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    lod: Mapped[AssetLod] = mapped_column(enum_column(AssetLod, name="asset_lod"), nullable=False)
    state: Mapped[AssetState] = mapped_column(
        enum_column(AssetState, name="asset_state"), nullable=False
    )
    glb_url: Mapped[str] = mapped_column(String(2_048), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    origin_lon: Mapped[float] = mapped_column(Float, nullable=False)
    origin_lat: Mapped[float] = mapped_column(Float, nullable=False)
    origin_altitude_m: Mapped[float] = mapped_column(Float, nullable=False)
    local_frame: Mapped[str] = mapped_column(String(16), nullable=False, default="ENU")
    meters_per_unit: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    vertical_datum: Mapped[str] = mapped_column(String(128), nullable=False)
    terrain_source_year: Mapped[int | None] = mapped_column(Integer)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    superseded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    incident: Mapped[IncidentSeries] = relationship(back_populates="assets")
    episode: Mapped[Episode] = relationship(back_populates="assets")
    manifest_revisions: Mapped[list[ManifestRevision]] = relationship(back_populates="asset")

    __table_args__ = (
        UniqueConstraint(
            "incident_id",
            "episode_id",
            "version",
            "lod",
            name="uq_asset_version_lod",
        ),
        CheckConstraint("version >= 1", name="ck_asset_version"),
        CheckConstraint("size_bytes > 0", name="ck_asset_size"),
        CheckConstraint("meters_per_unit > 0", name="ck_asset_scale"),
    )


class Job(Base, TimestampMixin):
    __tablename__ = "job"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    kind: Mapped[JobKind] = mapped_column(enum_column(JobKind, name="job_kind"), nullable=False)
    state: Mapped[JobState] = mapped_column(
        enum_column(JobState, name="job_state"), nullable=False, index=True
    )
    incident_id: Mapped[int] = mapped_column(
        ForeignKey("incident_series.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    episode_id: Mapped[int] = mapped_column(
        ForeignKey("episode.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    input_payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    output_payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    lease_owner: Mapped[str | None] = mapped_column(String(255))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    last_error: Mapped[str | None] = mapped_column(Text)
    trace_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)

    incident: Mapped[IncidentSeries] = relationship(back_populates="jobs")
    episode: Mapped[Episode] = relationship(back_populates="jobs")

    __table_args__ = (
        UniqueConstraint("kind", "idempotency_key", name="uq_job_kind_idempotency"),
        CheckConstraint("attempt >= 0", name="ck_job_attempt_nonnegative"),
        CheckConstraint("max_attempts >= 1", name="ck_job_max_attempts_positive"),
    )


class ManifestRevision(Base):
    __tablename__ = "manifest_revision"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    incident_id: Mapped[int] = mapped_column(
        ForeignKey("incident_series.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    episode_id: Mapped[int] = mapped_column(
        ForeignKey("episode.id", ondelete="RESTRICT"), nullable=False
    )
    asset_id: Mapped[int | None] = mapped_column(ForeignKey("model_asset.id", ondelete="RESTRICT"))
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    incident: Mapped[IncidentSeries] = relationship(back_populates="manifest_revisions")
    asset: Mapped[ModelAsset | None] = relationship(back_populates="manifest_revisions")

    __table_args__ = (
        UniqueConstraint("incident_id", "revision", name="uq_manifest_revision"),
        Index(
            "uq_manifest_one_current",
            "incident_id",
            unique=True,
            sqlite_where=text("is_current = 1"),
            postgresql_where=text("is_current"),
        ),
        CheckConstraint("revision >= 1", name="ck_manifest_revision"),
    )


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_record"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    endpoint: Mapped[str] = mapped_column(String(255), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    response_status: Mapped[int] = mapped_column(Integer, nullable=False)
    response_body: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    trace_id: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        UniqueConstraint("endpoint", "idempotency_key", name="uq_idempotency_endpoint_key"),
        Index("ix_idempotency_expires", "expires_at"),
    )


class AuditEvent(Base):
    __tablename__ = "audit_event"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False, index=True
    )
    actor_type: Mapped[ActorType] = mapped_column(
        enum_column(ActorType, name="actor_type"), nullable=False
    )
    actor_id: Mapped[str] = mapped_column(String(255), nullable=False)
    action: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(64), nullable=False)
    target_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    before_hash: Mapped[str | None] = mapped_column(String(64))
    after_hash: Mapped[str | None] = mapped_column(String(64))
    before_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    after_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    trace_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)


class OutboxEvent(Base):
    __tablename__ = "outbox_event"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    topic: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    aggregate_type: Mapped[str] = mapped_column(String(64), nullable=False)
    aggregate_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    trace_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (CheckConstraint("attempts >= 0", name="ck_outbox_attempts"),)
