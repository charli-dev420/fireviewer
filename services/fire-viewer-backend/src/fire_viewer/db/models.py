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
    EvidenceSpatialMode,
    IncidentStatus,
    JobKind,
    JobState,
    MatchDecision,
    PublicReportCategory,
    PublicReportState,
    PublicVisibility,
    SourceTrust,
    SourceType,
    SpatialPackageFileKind,
    SpatialPackageState,
    VerificationState,
    ZoneContributionState,
    ZoneInformationState,
    ZonePublicationState,
    ZoneUploadState,
    ZoneVisibility,
)


def enum_column(enum_type: type, *, name: str) -> Enum:
    return Enum(enum_type, name=name, native_enum=False, validate_strings=True)


def sha256_hex_check(column: str) -> str:
    """Portable SQL predicate for a lowercase hexadecimal SHA-256 digest."""

    remaining = column
    for character in "0123456789abcdef":
        remaining = f"replace({remaining}, '{character}', '')"
    return f"length({column}) = 64 AND length({remaining}) = 0"


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
    public_display_name: Mapped[str | None] = mapped_column(String(255))
    public_license: Mapped[str | None] = mapped_column(String(255))
    public_reference_url: Mapped[str | None] = mapped_column(String(2_048))
    public_transformations: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
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
    jobs: Mapped[list[Job]] = relationship(back_populates="incident")
    manifest_revisions: Mapped[list[ManifestRevision]] = relationship(back_populates="incident")
    archive_snapshot: Mapped[ZoneArchiveSnapshot | None] = relationship(
        back_populates="incident", uselist=False
    )
    public_reports: Mapped[list[IncidentPublicReport]] = relationship(back_populates="incident")

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
    verification_state: Mapped[VerificationState] = mapped_column(
        enum_column(VerificationState, name="episode_verification_state"),
        nullable=False,
        default=VerificationState.UNVERIFIED,
    )
    corroborating_source_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    evidence_basis_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    estimated_area_ha: Mapped[float | None] = mapped_column(Float)
    evacuation_established: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    evacuation_basis: Mapped[str | None] = mapped_column(String(1_000))
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
    jobs: Mapped[list[Job]] = relationship(back_populates="episode")

    __table_args__ = (
        UniqueConstraint("incident_id", "episode_id", name="uq_episode_public_id"),
        UniqueConstraint("incident_id", "ordinal", name="uq_episode_ordinal"),
        CheckConstraint("ordinal >= 1", name="ck_episode_ordinal"),
        CheckConstraint("corroborating_source_count >= 0", name="ck_episode_corroboration_count"),
        CheckConstraint(
            "estimated_area_ha IS NULL OR estimated_area_ha >= 0",
            name="ck_episode_estimated_area",
        ),
        CheckConstraint(
            "evacuation_established = 0 OR evacuation_basis IS NOT NULL",
            name="ck_episode_evacuation_basis",
        ),
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
    public_spatial_mode: Mapped[EvidenceSpatialMode] = mapped_column(
        enum_column(EvidenceSpatialMode, name="evidence_spatial_mode"),
        nullable=False,
        default=EvidenceSpatialMode.WITHHELD,
    )
    raw_purge_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    raw_purged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    raw_retention_hold_reason: Mapped[str | None] = mapped_column(String(500))
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
        CheckConstraint(
            "(attached_incident_id IS NULL AND attached_episode_id IS NULL) "
            "OR (attached_incident_id IS NOT NULL AND attached_episode_id IS NOT NULL)",
            name="ck_observation_attached_pair_complete",
        ),
        CheckConstraint(
            "(proposed_incident_id IS NULL AND proposed_episode_id IS NULL) "
            "OR (proposed_incident_id IS NOT NULL AND proposed_episode_id IS NOT NULL)",
            name="ck_observation_proposed_pair_complete",
        ),
        Index("ix_observation_episode_time", "attached_episode_id", "observed_at"),
    )


class IncidentPublicReport(Base):
    """Anonymous, moderated public correction request. No network identity is persisted."""

    __tablename__ = "incident_public_report"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    report_id: Mapped[str] = mapped_column(String(96), nullable=False, unique=True, index=True)
    incident_id: Mapped[int] = mapped_column(
        ForeignKey("incident_series.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    category: Mapped[PublicReportCategory] = mapped_column(
        enum_column(PublicReportCategory, name="public_report_category"), nullable=False
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)
    origin_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    submitted_day: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    state: Mapped[PublicReportState] = mapped_column(
        enum_column(PublicReportState, name="public_report_state"),
        nullable=False,
        default=PublicReportState.PENDING,
        index=True,
    )
    closure_reason: Mapped[str | None] = mapped_column(String(500))
    reviewed_by: Mapped[str | None] = mapped_column(String(255))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    incident: Mapped[IncidentSeries] = relationship(back_populates="public_reports")

    __table_args__ = (
        UniqueConstraint(
            "incident_id",
            "origin_fingerprint",
            "content_hash",
            "submitted_day",
            name="uq_public_report_origin_content_day",
        ),
        CheckConstraint("version >= 1", name="ck_public_report_version"),
        CheckConstraint(
            sha256_hex_check("origin_fingerprint"), name="ck_public_report_origin_hash"
        ),
        CheckConstraint(sha256_hex_check("content_hash"), name="ck_public_report_content_hash"),
        Index("ix_public_report_origin_day", "origin_fingerprint", "submitted_day"),
    )


class SpatialZone(Base, TimestampMixin):
    """Stable identity for a reusable, local rural 3D zone."""

    __tablename__ = "spatial_zone"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    zone_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    label: Mapped[str | None] = mapped_column(String(255))

    revisions: Mapped[list[SpatialZoneRevision]] = relationship(
        back_populates="zone", order_by="SpatialZoneRevision.revision"
    )
    publications: Mapped[list[ZonePublication]] = relationship(back_populates="zone")
    profile: Mapped[ZoneProfile | None] = relationship(back_populates="zone", uselist=False)
    uploads: Mapped[list[ZoneUpload]] = relationship(back_populates="zone")
    information: Mapped[list[ZoneInformation]] = relationship(back_populates="zone")
    contributions: Mapped[list[ZoneContribution]] = relationship(back_populates="zone")


class ZoneProfile(Base, TimestampMixin):
    """Editable MVP presentation and L93 envelope for one independently published zone."""

    __tablename__ = "zone_profile"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    spatial_zone_id: Mapped[int] = mapped_column(
        ForeignKey("spatial_zone.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
        index=True,
    )
    description: Mapped[str] = mapped_column(String(4_000), nullable=False)
    visibility: Mapped[ZoneVisibility] = mapped_column(
        enum_column(ZoneVisibility, name="zone_visibility"),
        nullable=False,
        default=ZoneVisibility.DRAFT,
        index=True,
    )
    min_easting_l93: Mapped[float] = mapped_column(Float, nullable=False)
    min_northing_l93: Mapped[float] = mapped_column(Float, nullable=False)
    max_easting_l93: Mapped[float] = mapped_column(Float, nullable=False)
    max_northing_l93: Mapped[float] = mapped_column(Float, nullable=False)

    zone: Mapped[SpatialZone] = relationship(back_populates="profile")

    __table_args__ = (
        CheckConstraint(
            "min_easting_l93 < max_easting_l93 AND min_northing_l93 < max_northing_l93",
            name="ck_zone_profile_l93_bounds",
        ),
    )


class ZoneUpload(Base):
    """A locally stored, verified archive.  Only one validated upload can be active per zone."""

    __tablename__ = "zone_upload"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    upload_id: Mapped[str] = mapped_column(String(96), nullable=False, unique=True, index=True)
    spatial_zone_id: Mapped[int] = mapped_column(
        ForeignKey("spatial_zone.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    package_id: Mapped[str] = mapped_column(String(96), nullable=False)
    archive_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    archive_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    catalog_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    catalog_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    state: Mapped[ZoneUploadState] = mapped_column(
        enum_column(ZoneUploadState, name="zone_upload_state"),
        nullable=False,
        default=ZoneUploadState.RECEIVED,
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    validation_summary: Mapped[str] = mapped_column(String(1_000), nullable=False)
    asset_catalog: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    # This is a server-controlled relative key, never an API value and never a client path.
    storage_key: Mapped[str] = mapped_column(String(255), nullable=False)
    created_by: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    zone: Mapped[SpatialZone] = relationship(back_populates="uploads")

    __table_args__ = (
        UniqueConstraint("spatial_zone_id", "revision", name="uq_zone_upload_revision"),
        Index(
            "uq_zone_upload_one_active",
            "spatial_zone_id",
            unique=True,
            sqlite_where=text("is_active = 1"),
            postgresql_where=text("is_active"),
        ),
        CheckConstraint(sha256_hex_check("archive_sha256"), name="ck_zone_upload_archive_sha256"),
        CheckConstraint(sha256_hex_check("catalog_sha256"), name="ck_zone_upload_catalog_sha256"),
        CheckConstraint("archive_size_bytes > 0", name="ck_zone_upload_archive_size"),
        CheckConstraint("catalog_size_bytes > 0", name="ck_zone_upload_catalog_size"),
        CheckConstraint("revision >= 1", name="ck_zone_upload_revision_positive"),
        CheckConstraint(
            "NOT is_active OR state = 'VALIDATED'",
            name="ck_zone_upload_active_requires_validated",
        ),
    )


class ZoneInformation(Base, TimestampMixin):
    """Reviewed, coordinate-bearing data shown only when its parent zone is public."""

    __tablename__ = "zone_information"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    information_id: Mapped[str] = mapped_column(String(96), nullable=False, unique=True, index=True)
    spatial_zone_id: Mapped[int] = mapped_column(
        ForeignKey("spatial_zone.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(64), nullable=False)
    easting_l93: Mapped[float] = mapped_column(Float, nullable=False)
    northing_l93: Mapped[float] = mapped_column(Float, nullable=False)
    state: Mapped[ZoneInformationState] = mapped_column(
        enum_column(ZoneInformationState, name="zone_information_state"),
        nullable=False,
        default=ZoneInformationState.DRAFT,
        index=True,
    )
    review_note: Mapped[str | None] = mapped_column(String(1_000))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[str] = mapped_column(String(255), nullable=False)

    zone: Mapped[SpatialZone] = relationship(back_populates="information")


class ZoneContribution(Base):
    """Untrusted public submission.  Pending rows are never returned by public reads."""

    __tablename__ = "zone_contribution"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    contribution_id: Mapped[str] = mapped_column(
        String(96), nullable=False, unique=True, index=True
    )
    spatial_zone_id: Mapped[int] = mapped_column(
        ForeignKey("spatial_zone.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(64), nullable=False)
    easting_l93: Mapped[float | None] = mapped_column(Float)
    northing_l93: Mapped[float | None] = mapped_column(Float)
    state: Mapped[ZoneContributionState] = mapped_column(
        enum_column(ZoneContributionState, name="zone_contribution_state"),
        nullable=False,
        default=ZoneContributionState.PENDING,
        index=True,
    )
    review_reason: Mapped[str | None] = mapped_column(String(1_000))
    reviewed_by: Mapped[str | None] = mapped_column(String(255))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    zone: Mapped[SpatialZone] = relationship(back_populates="contributions")

    __table_args__ = (
        CheckConstraint(
            "(easting_l93 IS NULL AND northing_l93 IS NULL) "
            "OR (easting_l93 IS NOT NULL AND northing_l93 IS NOT NULL)",
            name="ck_zone_contribution_l93_pair",
        ),
    )


class SpatialZoneRevision(Base):
    """Immutable spatial reference and local envelope for one zone revision.

    The persisted frame is deliberately independent from a model asset: a zone can be
    shared by multiple incidents, while an extension creates a new revision instead of
    moving existing incidents.
    """

    __tablename__ = "spatial_zone_revision"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    spatial_zone_id: Mapped[int] = mapped_column(
        ForeignKey("spatial_zone.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    spatial_profile_version: Mapped[str] = mapped_column(String(16), nullable=False, default="1.0")
    origin_easting_l93: Mapped[float | None] = mapped_column(Float)
    origin_northing_l93: Mapped[float | None] = mapped_column(Float)
    horizontal_crs: Mapped[str | None] = mapped_column(String(32))
    vertical_crs: Mapped[str | None] = mapped_column(String(32))
    ground_model: Mapped[str | None] = mapped_column(String(64))
    ground_resolution_m: Mapped[float | None] = mapped_column(Float)
    surface_height_reference: Mapped[str | None] = mapped_column(String(64))
    origin_lon: Mapped[float] = mapped_column(Float, nullable=False)
    origin_lat: Mapped[float] = mapped_column(Float, nullable=False)
    source_orthometric_height_m: Mapped[float] = mapped_column(Float, nullable=False)
    geoid_undulation_m: Mapped[float] = mapped_column(Float, nullable=False)
    origin_ellipsoid_height_m: Mapped[float] = mapped_column(Float, nullable=False)
    source_vertical_datum: Mapped[str] = mapped_column(
        String(128), nullable=False, default="NGF-IGN69"
    )
    vertical_transform_id: Mapped[str] = mapped_column(String(64), nullable=False, default="RAF20")
    vertical_grid_filename: Mapped[str] = mapped_column(
        String(255), nullable=False, default="fr_ign_RAF20.tif"
    )
    vertical_grid_sha256: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        default="dc0cc2a38f0ea1029fe72cca3b5b7ed6dfe7e1db2a8d8482b7326ce3d6f25605",
    )
    vertical_datum: Mapped[str] = mapped_column(String(128), nullable=False, default="EPSG:4979")
    local_frame: Mapped[str] = mapped_column(String(16), nullable=False, default="ENU")
    meters_per_unit: Mapped[float] = mapped_column(Float, nullable=False, default=0.01)
    unity_profile: Mapped[str] = mapped_column(
        String(64), nullable=False, default="unity-eun-100-v1"
    )
    gltf_to_unity_profile: Mapped[str] = mapped_column(
        String(64), nullable=False, default="gltf-eun-negz-metric-v1"
    )
    min_east_m: Mapped[float] = mapped_column(Float, nullable=False)
    max_east_m: Mapped[float] = mapped_column(Float, nullable=False)
    min_north_m: Mapped[float] = mapped_column(Float, nullable=False)
    max_north_m: Mapped[float] = mapped_column(Float, nullable=False)
    min_up_m: Mapped[float] = mapped_column(Float, nullable=False)
    max_up_m: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    zone: Mapped[SpatialZone] = relationship(back_populates="revisions")
    assets: Mapped[list[ModelAsset]] = relationship(back_populates="spatial_zone_revision")
    spatial_packages: Mapped[list[SpatialPackage]] = relationship(
        back_populates="spatial_zone_revision"
    )
    zone_publications: Mapped[list[ZonePublication]] = relationship(
        back_populates="spatial_zone_revision"
    )
    manifest_revisions: Mapped[list[ManifestRevision]] = relationship(
        back_populates="spatial_zone_revision"
    )
    archive_snapshots: Mapped[list[ZoneArchiveSnapshot]] = relationship(
        back_populates="spatial_zone_revision"
    )

    __table_args__ = (
        UniqueConstraint("spatial_zone_id", "revision", name="uq_spatial_zone_revision"),
        CheckConstraint("revision >= 1", name="ck_spatial_zone_revision_positive"),
        CheckConstraint(
            "ground_resolution_m IS NULL OR ground_resolution_m > 0",
            name="ck_spatial_zone_ground_resolution",
        ),
        CheckConstraint("origin_lon >= -5.5 AND origin_lon <= 10.0", name="ck_spatial_zone_lon"),
        CheckConstraint("origin_lat >= 42.0 AND origin_lat <= 51.5", name="ck_spatial_zone_lat"),
        CheckConstraint(
            "origin_lon > -1e308 AND origin_lon < 1e308 "
            "AND origin_lat > -1e308 AND origin_lat < 1e308 "
            "AND source_orthometric_height_m > -1e308 "
            "AND source_orthometric_height_m < 1e308 "
            "AND geoid_undulation_m > -1e308 AND geoid_undulation_m < 1e308 "
            "AND origin_ellipsoid_height_m > -1e308 "
            "AND origin_ellipsoid_height_m < 1e308",
            name="ck_spatial_zone_origin_finite",
        ),
        CheckConstraint(
            "abs(origin_ellipsoid_height_m - source_orthometric_height_m "
            "- geoid_undulation_m) <= 0.001",
            name="ck_spatial_zone_vertical_derivation",
        ),
        CheckConstraint(
            "NOT (origin_lon >= 8.3 AND origin_lon <= 9.8 "
            "AND origin_lat >= 41.0 AND origin_lat <= 43.3)",
            name="ck_spatial_zone_not_corsica",
        ),
        CheckConstraint("source_vertical_datum = 'NGF-IGN69'", name="ck_spatial_zone_source_datum"),
        CheckConstraint("vertical_transform_id = 'RAF20'", name="ck_spatial_zone_transform"),
        CheckConstraint(
            "vertical_grid_filename = 'fr_ign_RAF20.tif'", name="ck_spatial_zone_grid_filename"
        ),
        CheckConstraint(
            "vertical_grid_sha256 = "
            "'dc0cc2a38f0ea1029fe72cca3b5b7ed6dfe7e1db2a8d8482b7326ce3d6f25605'",
            name="ck_spatial_zone_grid_hash",
        ),
        CheckConstraint("vertical_datum = 'EPSG:4979'", name="ck_spatial_zone_datum"),
        CheckConstraint("local_frame = 'ENU'", name="ck_spatial_zone_frame"),
        CheckConstraint("meters_per_unit = 0.01", name="ck_spatial_zone_scale"),
        CheckConstraint("unity_profile = 'unity-eun-100-v1'", name="ck_spatial_zone_unity_profile"),
        CheckConstraint(
            "gltf_to_unity_profile = 'gltf-eun-negz-metric-v1'",
            name="ck_spatial_zone_gltf_profile",
        ),
        CheckConstraint(
            "min_east_m < max_east_m AND min_east_m <= 0 AND max_east_m >= 0",
            name="ck_spatial_zone_east_bounds",
        ),
        CheckConstraint(
            "min_east_m > -1e308 AND min_east_m < 1e308 "
            "AND max_east_m > -1e308 AND max_east_m < 1e308 "
            "AND min_north_m > -1e308 AND min_north_m < 1e308 "
            "AND max_north_m > -1e308 AND max_north_m < 1e308 "
            "AND min_up_m > -1e308 AND min_up_m < 1e308 "
            "AND max_up_m > -1e308 AND max_up_m < 1e308",
            name="ck_spatial_zone_bounds_finite",
        ),
        CheckConstraint(
            "min_north_m < max_north_m AND min_north_m <= 0 AND max_north_m >= 0",
            name="ck_spatial_zone_north_bounds",
        ),
        CheckConstraint(
            "min_up_m < max_up_m AND min_up_m <= 0 AND max_up_m >= 0",
            name="ck_spatial_zone_up_bounds",
        ),
    )


class SpatialPackage(Base):
    """Immutable admin registry entry for a Unity-produced spatial package.

    The package stores controlled object locations, hashes and verification
    metadata only. COG/PNG/GLB binaries stay outside SQLite.
    """

    __tablename__ = "spatial_package"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    package_id: Mapped[str] = mapped_column(String(96), nullable=False, unique=True, index=True)
    manifest_uri: Mapped[str] = mapped_column(String(2_048), nullable=False)
    manifest_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    manifest_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_uri: Mapped[str] = mapped_column(String(2_048), nullable=False)
    state: Mapped[SpatialPackageState] = mapped_column(
        enum_column(SpatialPackageState, name="spatial_package_state"),
        nullable=False,
        default=SpatialPackageState.DRAFT,
    )
    provenance: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    verification_report: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_by: Mapped[str] = mapped_column(String(255), nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    spatial_zone_revision_id: Mapped[int | None] = mapped_column(
        ForeignKey("spatial_zone_revision.id", ondelete="RESTRICT"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    spatial_zone_revision: Mapped[SpatialZoneRevision | None] = relationship(
        back_populates="spatial_packages"
    )
    files: Mapped[list[SpatialPackageFile]] = relationship(
        back_populates="package", cascade="all, delete-orphan"
    )
    zone_publications: Mapped[list[ZonePublication]] = relationship(back_populates="package")
    manifest_revisions: Mapped[list[ManifestRevision]] = relationship(back_populates="package")

    __table_args__ = (
        CheckConstraint(
            sha256_hex_check("manifest_sha256"),
            name="ck_spatial_package_manifest_sha256",
        ),
        CheckConstraint("manifest_size_bytes > 0", name="ck_spatial_package_manifest_size"),
        CheckConstraint("length(manifest_uri) > 0", name="ck_spatial_package_manifest_uri"),
        CheckConstraint("length(storage_uri) > 0", name="ck_spatial_package_storage_uri"),
        CheckConstraint(
            "(state IN ('VERIFIED', 'PREVIEWABLE', 'PUBLISHED', 'WITHDRAWN', "
            "'REVOKED', 'ARCHIVED') "
            "AND verified_at IS NOT NULL) OR state = 'DRAFT'",
            name="ck_spatial_package_verified_states_timestamp",
        ),
        CheckConstraint(
            "spatial_zone_revision_id IS NULL OR state IN "
            "('VERIFIED', 'PREVIEWABLE', 'PUBLISHED', 'WITHDRAWN', 'REVOKED', 'ARCHIVED')",
            name="ck_spatial_package_revision_requires_validated_state",
        ),
    )


class SpatialPackageFile(Base):
    """Object-store reference for one file that belongs to an admin package."""

    __tablename__ = "spatial_package_file"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    spatial_package_id: Mapped[int] = mapped_column(
        ForeignKey("spatial_package.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[SpatialPackageFileKind] = mapped_column(
        enum_column(SpatialPackageFileKind, name="spatial_package_file_kind"), nullable=False
    )
    uri: Mapped[str] = mapped_column(String(2_048), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    media_type: Mapped[str] = mapped_column(String(128), nullable=False)
    provenance: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    package: Mapped[SpatialPackage] = relationship(back_populates="files")
    model_assets: Mapped[list[ModelAsset]] = relationship(back_populates="spatial_package_file")

    __table_args__ = (
        UniqueConstraint("spatial_package_id", "kind", "uri", name="uq_spatial_package_file"),
        CheckConstraint(sha256_hex_check("sha256"), name="ck_spatial_package_file_sha256"),
        CheckConstraint("size_bytes > 0", name="ck_spatial_package_file_size"),
        CheckConstraint("length(uri) > 0", name="ck_spatial_package_file_uri"),
        CheckConstraint(
            "(kind = 'COG' AND media_type IN "
            "('image/tiff', 'image/geotiff', 'application/octet-stream')) "
            "OR (kind = 'PNG' AND media_type = 'image/png') "
            "OR (kind = 'GLB' AND media_type IN ('model/gltf-binary', 'application/octet-stream'))",
            name="ck_spatial_package_file_media_type",
        ),
    )


class ZonePublication(Base):
    """Administrative publication lifecycle for one explicit zone revision choice."""

    __tablename__ = "zone_publication"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    publication_id: Mapped[str] = mapped_column(String(96), nullable=False, unique=True, index=True)
    spatial_zone_id: Mapped[int] = mapped_column(
        ForeignKey("spatial_zone.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    spatial_zone_revision_id: Mapped[int] = mapped_column(
        ForeignKey("spatial_zone_revision.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    spatial_package_id: Mapped[int] = mapped_column(
        ForeignKey("spatial_package.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    state: Mapped[ZonePublicationState] = mapped_column(
        enum_column(ZonePublicationState, name="zone_publication_state"),
        nullable=False,
        default=ZonePublicationState.DRAFT,
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    zone: Mapped[SpatialZone] = relationship(back_populates="publications")
    spatial_zone_revision: Mapped[SpatialZoneRevision] = relationship(
        back_populates="zone_publications"
    )
    package: Mapped[SpatialPackage] = relationship(back_populates="zone_publications")
    events: Mapped[list[ZonePublicationEvent]] = relationship(
        back_populates="publication", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index(
            "uq_zone_publication_one_active",
            "spatial_zone_id",
            unique=True,
            sqlite_where=text("is_active = 1"),
            postgresql_where=text("is_active"),
        ),
        CheckConstraint(
            "(is_active AND state = 'PUBLISHED') OR (NOT is_active AND state != 'PUBLISHED')",
            name="ck_zone_publication_active_state",
        ),
    )


class ZonePublicationEvent(Base):
    """Append-only audit event for publication state transitions."""

    __tablename__ = "zone_publication_event"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(String(96), nullable=False, unique=True, index=True)
    zone_publication_id: Mapped[int] = mapped_column(
        ForeignKey("zone_publication.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    from_state: Mapped[ZonePublicationState | None] = mapped_column(
        enum_column(ZonePublicationState, name="zone_publication_from_state")
    )
    to_state: Mapped[ZonePublicationState] = mapped_column(
        enum_column(ZonePublicationState, name="zone_publication_to_state"), nullable=False
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(255), nullable=False)
    event_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSON, nullable=False, default=dict
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    publication: Mapped[ZonePublication] = relationship(back_populates="events")


class ModelAsset(Base):
    __tablename__ = "model_asset"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    asset_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    legacy_incident_id: Mapped[int | None] = mapped_column(
        ForeignKey("incident_series.id", ondelete="RESTRICT"), index=True
    )
    legacy_episode_id: Mapped[int | None] = mapped_column(
        ForeignKey("episode.id", ondelete="RESTRICT"), index=True
    )
    legacy_origin_lon: Mapped[float | None] = mapped_column(Float)
    legacy_origin_lat: Mapped[float | None] = mapped_column(Float)
    legacy_origin_altitude_m: Mapped[float | None] = mapped_column(Float)
    legacy_local_frame: Mapped[str | None] = mapped_column(String(16))
    legacy_meters_per_unit: Mapped[float | None] = mapped_column(Float)
    legacy_vertical_datum: Mapped[str | None] = mapped_column(String(128))
    spatial_zone_revision_id: Mapped[int | None] = mapped_column(
        ForeignKey("spatial_zone_revision.id", ondelete="RESTRICT"), index=True
    )
    spatial_package_file_id: Mapped[int | None] = mapped_column(
        ForeignKey("spatial_package_file.id", ondelete="RESTRICT"), unique=True, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    lod: Mapped[AssetLod] = mapped_column(enum_column(AssetLod, name="asset_lod"), nullable=False)
    state: Mapped[AssetState] = mapped_column(
        enum_column(AssetState, name="asset_state"), nullable=False
    )
    glb_url: Mapped[str] = mapped_column(String(2_048), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    terrain_source_year: Mapped[int | None] = mapped_column(Integer)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    superseded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    purge_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    purge_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    purged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    retention_hold_reason: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    spatial_zone_revision: Mapped[SpatialZoneRevision | None] = relationship(
        back_populates="assets"
    )
    spatial_package_file: Mapped[SpatialPackageFile | None] = relationship(
        back_populates="model_assets"
    )
    manifest_revisions: Mapped[list[ManifestRevision]] = relationship(back_populates="asset")
    archive_snapshots: Mapped[list[ZoneArchiveSnapshot]] = relationship(back_populates="asset")

    __table_args__ = (
        UniqueConstraint("spatial_zone_revision_id", "version", "lod", name="uq_asset_version_lod"),
        CheckConstraint("version >= 1", name="ck_asset_version"),
        CheckConstraint("size_bytes > 0", name="ck_asset_size"),
        CheckConstraint(
            "spatial_zone_revision_id IS NOT NULL OR state IN ('QUARANTINED', 'DELETED_TOMBSTONE')",
            name="ck_asset_zone_revision_required",
        ),
        CheckConstraint(
            "(legacy_incident_id IS NULL AND legacy_episode_id IS NULL "
            "AND legacy_origin_lon IS NULL AND legacy_origin_lat IS NULL "
            "AND legacy_origin_altitude_m IS NULL AND legacy_local_frame IS NULL "
            "AND legacy_meters_per_unit IS NULL AND legacy_vertical_datum IS NULL) "
            "OR (legacy_incident_id IS NOT NULL AND legacy_episode_id IS NOT NULL "
            "AND legacy_origin_lon IS NOT NULL AND legacy_origin_lat IS NOT NULL "
            "AND legacy_origin_altitude_m IS NOT NULL AND legacy_local_frame IS NOT NULL "
            "AND legacy_meters_per_unit IS NOT NULL AND legacy_vertical_datum IS NOT NULL)",
            name="ck_asset_legacy_provenance",
        ),
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
    cancel_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_reason: Mapped[str | None] = mapped_column(String(500))

    incident: Mapped[IncidentSeries] = relationship(back_populates="jobs")
    episode: Mapped[Episode] = relationship(back_populates="jobs")

    __table_args__ = (
        UniqueConstraint("kind", "idempotency_key", name="uq_job_kind_idempotency"),
        CheckConstraint("attempt >= 0", name="ck_job_attempt_nonnegative"),
        CheckConstraint("max_attempts >= 1", name="ck_job_max_attempts_positive"),
    )


class AdminLocalSession(Base, TimestampMixin):
    """Opaque, revocable local-admin browser session. Only a SHA-256 digest is persisted."""

    __tablename__ = "admin_local_session"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    csrf_token: Mapped[str] = mapped_column(String(128), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    idle_expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)


class AdminLoginAttempt(Base):
    __tablename__ = "admin_login_attempt"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    origin_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    attempted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False, index=True
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
    spatial_zone_revision_id: Mapped[int | None] = mapped_column(
        ForeignKey("spatial_zone_revision.id", ondelete="RESTRICT"), index=True
    )
    spatial_package_id: Mapped[int | None] = mapped_column(
        ForeignKey("spatial_package.id", ondelete="RESTRICT"), index=True
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    incident: Mapped[IncidentSeries] = relationship(back_populates="manifest_revisions")
    asset: Mapped[ModelAsset | None] = relationship(back_populates="manifest_revisions")
    spatial_zone_revision: Mapped[SpatialZoneRevision | None] = relationship(
        back_populates="manifest_revisions"
    )
    package: Mapped[SpatialPackage | None] = relationship(back_populates="manifest_revisions")
    archive_snapshot: Mapped[ZoneArchiveSnapshot | None] = relationship(
        back_populates="manifest_revision", uselist=False
    )

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
        CheckConstraint(
            "spatial_zone_revision_id IS NULL OR asset_id IS NOT NULL",
            name="ck_manifest_zone_requires_asset",
        ),
    )


class ZoneArchiveSnapshot(Base):
    """The one immutable PNG capture retained when an incident is archived."""

    __tablename__ = "zone_archive_snapshot"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    archive_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    incident_id: Mapped[int] = mapped_column(
        ForeignKey("incident_series.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
        index=True,
    )
    manifest_revision_id: Mapped[int] = mapped_column(
        ForeignKey("manifest_revision.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
        index=True,
    )
    asset_id: Mapped[int] = mapped_column(
        ForeignKey("model_asset.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    spatial_zone_revision_id: Mapped[int] = mapped_column(
        ForeignKey("spatial_zone_revision.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    image_url: Mapped[str] = mapped_column(String(2_048), nullable=False)
    media_type: Mapped[str] = mapped_column(String(64), nullable=False, default="image/png")
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    asset_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    render_profile: Mapped[str] = mapped_column(String(128), nullable=False)
    rendered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    incident: Mapped[IncidentSeries] = relationship(back_populates="archive_snapshot")
    manifest_revision: Mapped[ManifestRevision] = relationship(back_populates="archive_snapshot")
    asset: Mapped[ModelAsset] = relationship(back_populates="archive_snapshots")
    spatial_zone_revision: Mapped[SpatialZoneRevision] = relationship(
        back_populates="archive_snapshots"
    )

    __table_args__ = (
        CheckConstraint("media_type = 'image/png'", name="ck_zone_archive_png"),
        CheckConstraint(sha256_hex_check("sha256"), name="ck_zone_archive_sha256"),
        CheckConstraint(sha256_hex_check("asset_sha256"), name="ck_zone_archive_asset_sha256"),
        CheckConstraint("lower(image_url) NOT LIKE '%.glb%'", name="ck_zone_archive_not_glb"),
        CheckConstraint("lower(image_url) LIKE '%.png'", name="ck_zone_archive_png_url"),
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
