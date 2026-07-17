from __future__ import annotations

from datetime import datetime
from enum import StrEnum
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
