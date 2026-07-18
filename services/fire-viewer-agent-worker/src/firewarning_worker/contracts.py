from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from math import isfinite
from typing import Annotated, Literal

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class BatchType(StrEnum):
    USER_MEDIA = "user_media"
    EXTERNAL_MEDIA = "external_media"
    SATELLITE_MEDIA = "satellite_media"


class Priority(StrEnum):
    USER_DEADLINE = "user_deadline"
    SCHEDULED_COMBINED = "scheduled_combined"
    SCHEDULED = "scheduled"


class MediaType(StrEnum):
    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"
    ARTICLE = "article"
    SATELLITE_IMAGE = "satellite_image"


class LocationOrigin(StrEnum):
    METADATA = "METADATA"
    USER_DECLARED = "USER_DECLARED"
    EXPLICIT_SOURCE_GEOMETRY = "EXPLICIT_SOURCE_GEOMETRY"
    HUMAN_CONFIRMED = "HUMAN_CONFIRMED"


class LocationStatus(StrEnum):
    NO_LOCATION = "NO_LOCATION"
    CAPTURE_LOCATION_ONLY = "CAPTURE_LOCATION_ONLY"
    USER_DECLARED_OBSERVATION_LOCATION = "USER_DECLARED_OBSERVATION_LOCATION"
    EXPLICIT_SOURCE_GEOMETRY = "EXPLICIT_SOURCE_GEOMETRY"
    HUMAN_CONFIRMED_OBSERVATION_LOCATION = "HUMAN_CONFIRMED_OBSERVATION_LOCATION"


class InputMetadata(StrictModel):
    captured_at: datetime | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    gps_accuracy_m: float | None = Field(default=None, gt=0, le=100_000)
    location_origin: LocationOrigin | None = None

    @model_validator(mode="after")
    def coordinates_are_complete_and_sourced(self) -> InputMetadata:
        coordinates = (self.latitude, self.longitude)
        if (coordinates[0] is None) != (coordinates[1] is None):
            raise ValueError("latitude and longitude must be provided together")
        if coordinates[0] is not None and self.location_origin is None:
            raise ValueError("coordinates require an explicit location_origin")
        if coordinates[0] is None and (self.gps_accuracy_m is not None or self.location_origin):
            raise ValueError("location metadata requires coordinates")
        return self


class FrameInput(StrictModel):
    frame_id: Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")]
    timestamp_s: float = Field(ge=0)
    working_file_url: AnyHttpUrl


class BatchItem(StrictModel):
    input_id: Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")]
    media_type: MediaType
    working_file_url: AnyHttpUrl | None = None
    metadata: InputMetadata = Field(default_factory=InputMetadata)
    frames: tuple[FrameInput, ...] = Field(default=(), max_length=64)
    audio_url: AnyHttpUrl | None = None
    article_text: str | None = Field(default=None, max_length=100_000)

    @model_validator(mode="after")
    def has_processable_content(self) -> BatchItem:
        if not any((self.working_file_url, self.frames, self.audio_url, self.article_text)):
            raise ValueError("an item must contain at least one processable input")
        if self.media_type == MediaType.AUDIO and self.audio_url is None:
            raise ValueError("audio items require audio_url")
        return self


class WorkerInput(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    batch_id: Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")]
    batch_type: BatchType
    priority: Priority
    deadline_at: datetime | None = None
    items: tuple[BatchItem, ...] = Field(min_length=1, max_length=32)

    @model_validator(mode="after")
    def input_ids_are_unique(self) -> WorkerInput:
        ids = [item.input_id for item in self.items]
        if len(ids) != len(set(ids)):
            raise ValueError("input_id values must be unique inside a batch")
        if sum(len(item.frames) for item in self.items) > 256:
            raise ValueError("a batch may contain at most 256 extracted frames")
        return self


class TranscriptSegment(StrictModel):
    segment_id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
    start_s: float = Field(ge=0)
    end_s: float = Field(gt=0)
    text: str = Field(min_length=1, max_length=10_000)
    uncertain: bool = False

    @model_validator(mode="after")
    def end_follows_start(self) -> TranscriptSegment:
        if self.end_s <= self.start_s:
            raise ValueError("transcript segment end_s must be after start_s")
        return self


class Transcript(StrictModel):
    language: str | None = Field(default=None, max_length=16)
    segments: tuple[TranscriptSegment, ...] = Field(default=(), max_length=10_000)


class PixelRegion(StrictModel):
    region_id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
    evidence_id: str
    label: str = Field(min_length=1, max_length=128)
    bbox_normalized: tuple[float, float, float, float]
    task: Literal["fire_detection", "phrase_grounding", "ocr"]
    model_score: float | None = Field(default=None, ge=0, le=1)

    @model_validator(mode="after")
    def valid_bbox(self) -> PixelRegion:
        x1, y1, x2, y2 = self.bbox_normalized
        if not all(0 <= coordinate <= 1 for coordinate in self.bbox_normalized):
            raise ValueError("bbox_normalized coordinates must be between 0 and 1")
        if x2 <= x1 or y2 <= y1:
            raise ValueError("bbox_normalized must have a positive area")
        return self


class VisualEvidenceSelection(StrictModel):
    evidence_id: str = Field(min_length=1, max_length=128)
    selected_for_grounding: bool
    selection_reason: Literal[
        "single_image",
        "target_detection",
        "temporal_coverage",
        "detector_fallback",
        "capacity_limit",
    ]
    max_detection_score: float | None = Field(default=None, ge=0, le=1)


EvidenceKind = Literal["frame", "image", "transcript_segment", "article_text", "metadata"]


class FactualObservation(StrictModel):
    type: str = Field(min_length=1, max_length=128)
    evidence_kind: EvidenceKind
    evidence_id: str = Field(min_length=1, max_length=128)
    region_id: str | None = Field(default=None, max_length=128)
    description: str = Field(min_length=1, max_length=1_000)
    certainty: Literal["directly_visible", "explicitly_written", "explicitly_spoken"]


class ExplicitLiteral(StrictModel):
    literal: str = Field(min_length=1, max_length=500)
    evidence_kind: EvidenceKind
    evidence_id: str = Field(min_length=1, max_length=128)


class MetadataResult(StrictModel):
    capture_location_available: bool
    capture_location_origin: LocationOrigin | None = None


class GeographicMarkerCandidate(StrictModel):
    type: Literal["media_capture"]
    geometry_origin: LocationOrigin


class ItemResult(StrictModel):
    input_id: str
    metadata_result: MetadataResult
    transcript: Transcript = Field(default_factory=Transcript)
    pixel_regions: tuple[PixelRegion, ...] = ()
    visual_evidence_selection: tuple[VisualEvidenceSelection, ...] = ()
    factual_observations: tuple[FactualObservation, ...] = ()
    explicit_places: tuple[ExplicitLiteral, ...] = ()
    explicit_times: tuple[ExplicitLiteral, ...] = ()
    location_status: LocationStatus
    geographic_marker_candidate: GeographicMarkerCandidate | None = None
    observed_phenomenon_marker: None = None
    requires_human_review: Literal[True] = True


class ModelRun(StrictModel):
    model_role: Literal["asr", "fire_detection", "visual_grounding", "multimodal_extraction"]
    model_id: str
    revision: str
    status: Literal["succeeded", "failed", "skipped"]
    started_at: datetime
    finished_at: datetime
    load_ms: int = Field(ge=0)
    inference_ms: int = Field(ge=0)
    peak_vram_bytes: int | None = Field(default=None, ge=0)
    error_code: str | None = None


class WorkerOutput(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    batch_id: str
    status: Literal["succeeded", "partial_failure", "failed"]
    retryable: bool
    model_runs: tuple[ModelRun, ...]
    items: tuple[ItemResult, ...]
    validation_errors: tuple[str, ...] = ()
    boot_ms: int = Field(ge=0)


SafeIdentifierV2 = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")]
Sha256HexV2 = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


def _is_timezone_aware_v2(value: datetime) -> bool:
    return value.tzinfo is not None and value.utcoffset() is not None


class AnalysisWindowV2(StrictModel):
    analysis_id: SafeIdentifierV2
    fire_id: str = Field(pattern=r"^FR-[0-9A-Z]{2,3}-[0-9]{5}$")
    episode_id: SafeIdentifierV2
    window_start_at: datetime
    window_end_at: datetime
    local_date: date
    timezone: str = Field(min_length=3, max_length=64)

    @model_validator(mode="after")
    def validate_window(self) -> AnalysisWindowV2:
        if not all(
            _is_timezone_aware_v2(value) for value in (self.window_start_at, self.window_end_at)
        ):
            raise ValueError("analysis window datetimes must include a timezone")
        if self.window_end_at <= self.window_start_at:
            raise ValueError("analysis window end must follow its start")
        return self


class SourceProvenanceV2(StrictModel):
    source_key: SafeIdentifierV2
    source_reference_url: AnyHttpUrl | None = None
    license_identifier: str = Field(min_length=1, max_length=128)
    attribution: str | None = Field(default=None, max_length=500)
    trust: Literal["unverified", "partner", "institutional", "operator"]


class CameraMetadataV2(StrictModel):
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    orthometric_height_m: float | None = Field(default=None, allow_inf_nan=False)
    horizontal_accuracy_m: float | None = Field(default=None, gt=0, le=100_000)
    yaw_deg: float | None = Field(default=None, ge=0, lt=360)
    pitch_deg: float | None = Field(default=None, ge=-90, le=90)
    roll_deg: float | None = Field(default=None, ge=-180, le=180)
    horizontal_fov_deg: float | None = Field(default=None, gt=0, lt=180)
    image_width_px: int | None = Field(default=None, gt=0, le=200_000)
    image_height_px: int | None = Field(default=None, gt=0, le=200_000)
    pose_origin: (
        Literal["METADATA", "USER_DECLARED", "CROSS_VIEW_ESTIMATE", "HUMAN_CONFIRMED"] | None
    ) = None

    @model_validator(mode="after")
    def validate_camera(self) -> CameraMetadataV2:
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("camera latitude and longitude must be supplied together")
        position_details = (
            self.orthometric_height_m,
            self.horizontal_accuracy_m,
            self.pose_origin,
        )
        if self.latitude is None and any(value is not None for value in position_details):
            raise ValueError("camera position details require coordinates")
        if self.latitude is not None and self.pose_origin is None:
            raise ValueError("camera coordinates require pose_origin")
        orientation = (self.yaw_deg, self.pitch_deg, self.roll_deg)
        if any(value is not None for value in orientation) and not all(
            value is not None for value in orientation
        ):
            raise ValueError("camera orientation must provide yaw, pitch, and roll together")
        intrinsics = (self.horizontal_fov_deg, self.image_width_px, self.image_height_px)
        if any(value is not None for value in intrinsics) and not all(
            value is not None for value in intrinsics
        ):
            raise ValueError("camera intrinsics require field of view and image dimensions")
        return self


class SatelliteMetadataV2(StrictModel):
    product_id: SafeIdentifierV2
    provider: str = Field(min_length=1, max_length=128)
    acquired_at: datetime
    crs: str = Field(min_length=3, max_length=128)
    raster_width_px: int = Field(gt=0, le=500_000)
    raster_height_px: int = Field(gt=0, le=500_000)
    geotransform: tuple[float, float, float, float, float, float]
    bbox_wgs84: tuple[float, float, float, float]
    resolution_m: float = Field(gt=0, le=100_000)
    bands: tuple[str, ...] = Field(min_length=1, max_length=32)
    cloud_cover_percent: float | None = Field(default=None, ge=0, le=100)

    @model_validator(mode="after")
    def validate_bbox(self) -> SatelliteMetadataV2:
        if not _is_timezone_aware_v2(self.acquired_at):
            raise ValueError("satellite acquisition time must include a timezone")
        if not all(isfinite(value) for value in self.geotransform):
            raise ValueError("satellite geotransform values must be finite")
        min_lon, min_lat, max_lon, max_lat = self.bbox_wgs84
        if not (-180 <= min_lon < max_lon <= 180 and -90 <= min_lat < max_lat <= 90):
            raise ValueError("satellite bbox must be an ordered WGS84 extent")
        if len(self.bands) != len(set(self.bands)):
            raise ValueError("satellite band names must be unique")
        return self


class SpatialReferenceAssetV2(StrictModel):
    kind: Literal["terrain_mnt", "surface_dsm", "orthophoto", "scene_catalog"]
    working_file_url: AnyHttpUrl
    sha256: Sha256HexV2
    crs: str = Field(min_length=3, max_length=128)
    resolution_m: float | None = Field(default=None, gt=0, le=100_000)


class SpatialReferenceBundleV2(StrictModel):
    reference_id: SafeIdentifierV2
    manifest_sha256: Sha256HexV2
    assets: tuple[SpatialReferenceAssetV2, ...] = Field(min_length=1, max_length=8)

    @model_validator(mode="after")
    def validate_assets(self) -> SpatialReferenceBundleV2:
        kinds = [asset.kind for asset in self.assets]
        if len(kinds) != len(set(kinds)):
            raise ValueError("spatial reference asset kinds must be unique")
        return self


class WorkerBatchItemV2(StrictModel):
    input_id: SafeIdentifierV2
    media_type: MediaType
    working_file_url: AnyHttpUrl | None = None
    provenance: SourceProvenanceV2
    captured_at: datetime | None = None
    camera: CameraMetadataV2 | None = None
    satellite: SatelliteMetadataV2 | None = None
    frames: tuple[FrameInput, ...] = Field(default=(), max_length=64)
    audio_url: AnyHttpUrl | None = None
    article_text: str | None = Field(default=None, max_length=100_000)

    @model_validator(mode="after")
    def validate_media_shape(self) -> WorkerBatchItemV2:
        if self.captured_at is not None and not _is_timezone_aware_v2(self.captured_at):
            raise ValueError("media capture time must include a timezone")
        if not any((self.working_file_url, self.frames, self.audio_url, self.article_text)):
            raise ValueError("a v2 media item requires processable content")
        if self.media_type == MediaType.AUDIO and self.audio_url is None:
            raise ValueError("audio items require audio_url")
        if self.media_type == MediaType.SATELLITE_IMAGE:
            if self.satellite is None:
                raise ValueError("satellite images require satellite metadata")
            if self.camera is not None:
                raise ValueError("satellite images cannot carry terrestrial camera metadata")
        elif self.satellite is not None:
            raise ValueError("satellite metadata is reserved for satellite images")
        if self.camera is not None and self.media_type not in {MediaType.IMAGE, MediaType.VIDEO}:
            raise ValueError("camera metadata is reserved for images and videos")
        return self


class WorkerInputV2(StrictModel):
    schema_version: Literal["2.0"] = "2.0"
    batch_id: SafeIdentifierV2
    batch_type: BatchType
    priority: Priority
    analysis_window: AnalysisWindowV2
    deadline_at: datetime | None = None
    reference_bundle: SpatialReferenceBundleV2 | None = None
    items: tuple[WorkerBatchItemV2, ...] = Field(min_length=1, max_length=32)

    @model_validator(mode="after")
    def validate_items(self) -> WorkerInputV2:
        if self.deadline_at is not None and not _is_timezone_aware_v2(self.deadline_at):
            raise ValueError("deadline_at must include a timezone")
        input_ids = [item.input_id for item in self.items]
        if len(input_ids) != len(set(input_ids)):
            raise ValueError("input_id values must be unique")
        if sum(len(item.frames) for item in self.items) > 256:
            raise ValueError("a batch may contain at most 256 frames")
        has_satellite = any(item.media_type == MediaType.SATELLITE_IMAGE for item in self.items)
        if self.batch_type == BatchType.SATELLITE_MEDIA and not all(
            item.media_type == MediaType.SATELLITE_IMAGE for item in self.items
        ):
            raise ValueError("satellite batches may contain only satellite images")
        if self.batch_type != BatchType.SATELLITE_MEDIA and has_satellite:
            raise ValueError("satellite images require a satellite batch")
        return self


class SourceAnnotationV2(StrictModel):
    annotation_id: SafeIdentifierV2
    evidence_id: SafeIdentifierV2
    evidence_kind: Literal["image", "frame", "satellite_image"]
    semantic_anchor: Literal["active_fire_point", "visible_fire_front_point", "smoke_column_base"]
    source_point_normalized: tuple[float, float]
    model_score: float | None = Field(default=None, ge=0, le=1)

    @model_validator(mode="after")
    def validate_point(self) -> SourceAnnotationV2:
        if not all(0 <= coordinate <= 1 for coordinate in self.source_point_normalized):
            raise ValueError("source annotation coordinates must be normalized")
        return self


class SpatialProposalV2(StrictModel):
    proposal_id: SafeIdentifierV2
    annotation_id: SafeIdentifierV2 | None = None
    status: Literal["ground_point", "insufficient_geometry"]
    observed_at: datetime | None = None
    geometry_origin: (
        Literal[
            "SATELLITE_GEOTRANSFORM",
            "CAMERA_RAYCAST",
            "CROSS_VIEW_RAYCAST",
            "EXPLICIT_SOURCE_GEOMETRY",
        ]
        | None
    ) = None
    longitude: float | None = Field(default=None, ge=-180, le=180)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    altitude_m: float | None = Field(default=None, allow_inf_nan=False)
    horizontal_accuracy_m: float | None = Field(default=None, gt=0, le=100_000)
    reference_bundle_sha256: Sha256HexV2 | None = None
    uncertainty_codes: tuple[SafeIdentifierV2, ...] = Field(default=(), max_length=12)

    @model_validator(mode="after")
    def validate_projection(self) -> SpatialProposalV2:
        if self.observed_at is not None and not _is_timezone_aware_v2(self.observed_at):
            raise ValueError("spatial observation time must include a timezone")
        projected = (
            self.geometry_origin,
            self.longitude,
            self.latitude,
            self.horizontal_accuracy_m,
            self.reference_bundle_sha256,
        )
        if self.status == "ground_point":
            if self.annotation_id is None or not all(value is not None for value in projected):
                raise ValueError("ground_point requires sourced coordinates and accuracy")
        else:
            if any(
                value is not None
                for value in (
                    self.geometry_origin,
                    self.longitude,
                    self.latitude,
                    self.altitude_m,
                    self.horizontal_accuracy_m,
                )
            ):
                raise ValueError("insufficient_geometry cannot contain projected coordinates")
            if not self.uncertainty_codes:
                raise ValueError("insufficient_geometry requires an uncertainty code")
        return self


class FactProposalV2(StrictModel):
    fact_id: SafeIdentifierV2
    input_id: SafeIdentifierV2
    category: Literal[
        "fire_activity",
        "burned_area",
        "resources",
        "evacuation",
        "access",
        "infrastructure",
        "weather",
        "other",
    ]
    fact_key: SafeIdentifierV2
    as_of: datetime
    evidence_kind: Literal[
        "frame", "image", "satellite_image", "transcript_segment", "article_text", "metadata"
    ]
    evidence_id: SafeIdentifierV2
    certainty: Literal["directly_visible", "explicitly_written", "explicitly_spoken"]
    value_number: float | None = Field(default=None, allow_inf_nan=False)
    value_text: str | None = Field(default=None, min_length=1, max_length=2_000)
    value_boolean: bool | None = None
    unit: str | None = Field(default=None, min_length=1, max_length=64)
    summary: str = Field(min_length=1, max_length=1_000)
    conflict_group_id: SafeIdentifierV2 | None = None

    @model_validator(mode="after")
    def validate_value(self) -> FactProposalV2:
        if not _is_timezone_aware_v2(self.as_of):
            raise ValueError("fact as_of must include a timezone")
        supplied = sum(
            value is not None for value in (self.value_number, self.value_text, self.value_boolean)
        )
        if supplied != 1:
            raise ValueError("a fact requires exactly one typed value")
        if self.unit is not None and self.value_number is None:
            raise ValueError("fact units are reserved for numeric values")
        return self


class ReportSectionV2(StrictModel):
    key: Literal[
        "situation",
        "observed_activity",
        "probable_activity_zone",
        "resources",
        "impacts",
        "sources_and_freshness",
        "limitations",
    ]
    heading: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=5_000)
    fact_ids: tuple[SafeIdentifierV2, ...] = Field(default=(), max_length=200)
    basis_codes: tuple[SafeIdentifierV2, ...] = Field(default=(), max_length=50)

    @model_validator(mode="after")
    def validate_basis(self) -> ReportSectionV2:
        if not self.fact_ids and not self.basis_codes:
            raise ValueError("report sections require a fact or an explicit basis code")
        return self


class SituationReportDraftV2(StrictModel):
    title: str = Field(min_length=1, max_length=255)
    body_markdown: str = Field(min_length=1, max_length=30_000)
    sections: tuple[ReportSectionV2, ...] = Field(min_length=1, max_length=12)

    @model_validator(mode="after")
    def validate_sections(self) -> SituationReportDraftV2:
        keys = [section.key for section in self.sections]
        if len(keys) != len(set(keys)):
            raise ValueError("report section keys must be unique")
        for section in self.sections:
            if len(section.fact_ids) != len(set(section.fact_ids)):
                raise ValueError("report section fact references must be unique")
        return self


class WorkerItemResultV2(StrictModel):
    input_id: SafeIdentifierV2
    transcript: Transcript = Field(default_factory=Transcript)
    pixel_regions: tuple[PixelRegion, ...] = Field(default=(), max_length=512)
    visual_evidence_selection: tuple[VisualEvidenceSelection, ...] = Field(
        default=(), max_length=256
    )
    source_annotations: tuple[SourceAnnotationV2, ...] = Field(default=(), max_length=512)
    spatial_proposals: tuple[SpatialProposalV2, ...] = Field(default=(), max_length=512)
    fact_proposals: tuple[FactProposalV2, ...] = Field(default=(), max_length=512)
    explicit_places: tuple[ExplicitLiteral, ...] = Field(default=(), max_length=512)
    explicit_times: tuple[ExplicitLiteral, ...] = Field(default=(), max_length=512)
    requires_human_review: Literal[True] = True

    @model_validator(mode="after")
    def validate_references(self) -> WorkerItemResultV2:
        annotation_ids = [item.annotation_id for item in self.source_annotations]
        proposal_ids = [item.proposal_id for item in self.spatial_proposals]
        fact_ids = [item.fact_id for item in self.fact_proposals]
        for label, values in (
            ("annotation", annotation_ids),
            ("spatial proposal", proposal_ids),
            ("fact", fact_ids),
        ):
            if len(values) != len(set(values)):
                raise ValueError(f"duplicate {label} identifier")
        known_annotations = set(annotation_ids)
        if any(
            item.annotation_id is not None and item.annotation_id not in known_annotations
            for item in self.spatial_proposals
        ):
            raise ValueError("spatial proposal references an unknown annotation")
        if any(item.input_id != self.input_id for item in self.fact_proposals):
            raise ValueError("fact proposal input_id must match its item result")
        return self


class WorkerModelRunV2(StrictModel):
    model_role: Literal[
        "asr",
        "visual_filtering",
        "visual_grounding",
        "multimodal_extraction",
        "cross_view_registration",
    ]
    model_id: str
    revision: str
    status: Literal["succeeded", "failed", "skipped"]
    started_at: datetime
    finished_at: datetime
    load_ms: int = Field(ge=0)
    inference_ms: int = Field(ge=0)
    peak_vram_bytes: int | None = Field(default=None, ge=0)
    error_code: str | None = None

    @model_validator(mode="after")
    def validate_timing(self) -> WorkerModelRunV2:
        if not all(_is_timezone_aware_v2(value) for value in (self.started_at, self.finished_at)):
            raise ValueError("model run datetimes must include a timezone")
        if self.finished_at < self.started_at:
            raise ValueError("model run finish must not precede its start")
        return self


class WorkerOutputV2(StrictModel):
    schema_version: Literal["2.0"] = "2.0"
    batch_id: SafeIdentifierV2
    analysis_id: SafeIdentifierV2
    status: Literal["succeeded", "partial_failure", "failed"]
    retryable: bool
    model_runs: tuple[WorkerModelRunV2, ...] = Field(max_length=8)
    items: tuple[WorkerItemResultV2, ...] = Field(min_length=1, max_length=32)
    report_draft: SituationReportDraftV2 | None = None
    validation_errors: tuple[str, ...] = Field(default=(), max_length=64)
    boot_ms: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_output_references(self) -> WorkerOutputV2:
        input_ids = [item.input_id for item in self.items]
        if len(input_ids) != len(set(input_ids)):
            raise ValueError("worker v2 output contains duplicate input_id values")
        all_fact_ids = [fact.fact_id for item in self.items for fact in item.fact_proposals]
        if len(all_fact_ids) != len(set(all_fact_ids)):
            raise ValueError("worker v2 output contains duplicate fact identifiers")
        if self.report_draft is not None:
            referenced = {
                fact_id for section in self.report_draft.sections for fact_id in section.fact_ids
            }
            unknown = referenced - set(all_fact_ids)
            if unknown:
                raise ValueError(f"report references an unknown fact: {sorted(unknown)[0]}")
        return self
