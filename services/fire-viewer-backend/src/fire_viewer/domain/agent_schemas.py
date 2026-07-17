from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator

from fire_viewer.domain.enums import (
    AgentBatchPriority,
    AgentBatchState,
    AgentBatchType,
    AgentConsentBasis,
    AgentConsentState,
    AgentDispatchState,
    AgentMediaType,
)


class StrictAgentModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


SafeIdentifier = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")]
Sha256Hex = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class AgentLocationMetadata(StrictAgentModel):
    captured_at: datetime | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    gps_accuracy_m: float | None = Field(default=None, gt=0, le=100_000)
    location_origin: (
        Literal["METADATA", "USER_DECLARED", "EXPLICIT_SOURCE_GEOMETRY", "HUMAN_CONFIRMED"] | None
    ) = None

    @model_validator(mode="after")
    def validate_location(self) -> AgentLocationMetadata:
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be supplied together")
        if self.latitude is not None and self.location_origin is None:
            raise ValueError("coordinates require location_origin")
        if self.latitude is None and (self.gps_accuracy_m is not None or self.location_origin):
            raise ValueError("location metadata requires coordinates")
        return self


class AgentFrameInput(StrictAgentModel):
    frame_id: SafeIdentifier
    timestamp_s: float = Field(ge=0)
    working_file_url: AnyHttpUrl


class AgentConsentInput(StrictAgentModel):
    basis: AgentConsentBasis
    scopes: list[
        Literal[
            "temporary_storage",
            "agent_analysis",
            "human_review",
            "retain_evidence",
            "display_media",
            "display_spatial_marker",
            "contact_contributor",
        ]
    ] = Field(min_length=3, max_length=7)
    terms_version: str = Field(min_length=1, max_length=64)
    evidence_sha256: Sha256Hex
    subject_reference_hash: Sha256Hex | None = None
    source_reference_url: AnyHttpUrl | None = None
    license_identifier: str | None = Field(default=None, min_length=1, max_length=128)
    granted_at: datetime
    expires_at: datetime | None = None

    @model_validator(mode="after")
    def validate_basis_and_scope(self) -> AgentConsentInput:
        required = {"temporary_storage", "agent_analysis", "human_review"}
        if not required.issubset(set(self.scopes)):
            raise ValueError("temporary storage, agent analysis, and human review are required")
        if self.basis == AgentConsentBasis.SOURCE_LICENSE and (
            self.source_reference_url is None or self.license_identifier is None
        ):
            raise ValueError("source_license requires its HTTPS reference and identifier")
        if self.expires_at is not None and self.expires_at <= self.granted_at:
            raise ValueError("consent expires_at must follow granted_at")
        return self


class AgentMediaItemInput(StrictAgentModel):
    input_id: SafeIdentifier
    media_type: AgentMediaType
    working_file_url: AnyHttpUrl | None = None
    media_sha256: Sha256Hex | None = None
    size_bytes: int | None = Field(default=None, gt=0, le=2_147_483_648)
    metadata: AgentLocationMetadata = Field(default_factory=AgentLocationMetadata)
    frames: list[AgentFrameInput] = Field(default_factory=list, max_length=64)
    audio_url: AnyHttpUrl | None = None
    article_text: str | None = Field(default=None, max_length=100_000)
    consent: AgentConsentInput

    @model_validator(mode="after")
    def validate_processable_input(self) -> AgentMediaItemInput:
        if not any((self.working_file_url, self.frames, self.audio_url, self.article_text)):
            raise ValueError("a media item requires processable content")
        if self.media_type == AgentMediaType.AUDIO and self.audio_url is None:
            raise ValueError("audio items require audio_url")
        if self.working_file_url is not None and (
            self.media_sha256 is None or self.size_bytes is None
        ):
            raise ValueError("working_file_url requires media_sha256 and size_bytes")
        return self


class AgentBatchCreateRequest(StrictAgentModel):
    schema_version: Literal["1.0"] = "1.0"
    batch_id: SafeIdentifier
    batch_type: AgentBatchType
    priority: AgentBatchPriority
    fire_id: str | None = Field(default=None, pattern=r"^FR-[0-9A-Z]{2,3}-[0-9]{5}$")
    episode_id: SafeIdentifier | None = None
    deadline_at: datetime | None = None
    purge_after: datetime
    items: list[AgentMediaItemInput] = Field(min_length=1, max_length=32)

    @model_validator(mode="after")
    def validate_batch(self) -> AgentBatchCreateRequest:
        if (self.fire_id is None) != (self.episode_id is None):
            raise ValueError("fire_id and episode_id must be supplied together")
        input_ids = [item.input_id for item in self.items]
        if len(input_ids) != len(set(input_ids)):
            raise ValueError("input_id values must be unique")
        if sum(len(item.frames) for item in self.items) > 256:
            raise ValueError("a batch may contain at most 256 frames")
        return self


class AgentBatchItemResponse(StrictAgentModel):
    input_id: str
    media_type: AgentMediaType
    media_sha256: str | None
    size_bytes: int | None
    consent_state: AgentConsentState
    purge_after: datetime
    purged_at: datetime | None


class AgentDispatchResponse(StrictAgentModel):
    dispatch_id: str
    state: AgentDispatchState
    payload_hash: str
    attempt: int
    poll_count: int
    remote_job_id: str | None
    remote_status: str | None
    next_attempt_at: datetime | None
    submitted_at: datetime | None
    completed_at: datetime | None
    last_error_code: str | None


class AgentBatchResponse(StrictAgentModel):
    batch_id: str
    fire_id: str | None = None
    episode_id: str | None = None
    schema_version: str
    batch_type: AgentBatchType
    priority: AgentBatchPriority
    state: AgentBatchState
    payload_hash: str | None
    deadline_at: datetime | None
    purge_after: datetime
    submitted_at: datetime | None
    completed_at: datetime | None
    items: list[AgentBatchItemResponse]
    dispatch: AgentDispatchResponse | None = None


class AgentBatchCreateOutcome(StrictAgentModel):
    replayed: bool
    batch: AgentBatchResponse


class AgentConsentWithdrawRequest(StrictAgentModel):
    reason: str = Field(min_length=8, max_length=500)


class AgentConsentWithdrawResponse(StrictAgentModel):
    batch_id: str
    input_id: str
    consent_state: AgentConsentState
    batch_state: AgentBatchState
    dispatch_state: AgentDispatchState | None


class WorkerFrameInput(StrictAgentModel):
    frame_id: SafeIdentifier
    timestamp_s: float = Field(ge=0)
    working_file_url: AnyHttpUrl


class WorkerBatchItem(StrictAgentModel):
    input_id: SafeIdentifier
    media_type: AgentMediaType
    working_file_url: AnyHttpUrl | None = None
    metadata: AgentLocationMetadata
    frames: list[WorkerFrameInput] = Field(default_factory=list, max_length=64)
    audio_url: AnyHttpUrl | None = None
    article_text: str | None = Field(default=None, max_length=100_000)


class WorkerInput(StrictAgentModel):
    schema_version: Literal["1.0"] = "1.0"
    batch_id: SafeIdentifier
    batch_type: AgentBatchType
    priority: AgentBatchPriority
    deadline_at: datetime | None = None
    items: list[WorkerBatchItem] = Field(min_length=1, max_length=32)


class WorkerTranscriptSegment(StrictAgentModel):
    segment_id: SafeIdentifier
    start_s: float = Field(ge=0)
    end_s: float = Field(gt=0)
    text: str = Field(min_length=1, max_length=10_000)
    uncertain: bool = False


class WorkerTranscript(StrictAgentModel):
    language: str | None = Field(default=None, max_length=16)
    segments: list[WorkerTranscriptSegment] = Field(default_factory=list, max_length=10_000)


class WorkerPixelRegion(StrictAgentModel):
    region_id: SafeIdentifier
    evidence_id: str
    label: str = Field(min_length=1, max_length=128)
    bbox_normalized: tuple[float, float, float, float]
    task: Literal["fire_detection", "phrase_grounding", "ocr"]
    model_score: float | None = Field(default=None, ge=0, le=1)

    @model_validator(mode="after")
    def validate_box(self) -> WorkerPixelRegion:
        x1, y1, x2, y2 = self.bbox_normalized
        if not all(0 <= coordinate <= 1 for coordinate in self.bbox_normalized):
            raise ValueError("bbox coordinates must be normalized")
        if x2 <= x1 or y2 <= y1:
            raise ValueError("bbox must have positive area")
        return self


class WorkerVisualEvidenceSelection(StrictAgentModel):
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


class WorkerFactualObservation(StrictAgentModel):
    type: str = Field(min_length=1, max_length=128)
    evidence_kind: Literal["frame", "image", "transcript_segment", "article_text", "metadata"]
    evidence_id: str = Field(min_length=1, max_length=128)
    region_id: str | None = Field(default=None, max_length=128)
    description: str = Field(min_length=1, max_length=1_000)
    certainty: Literal["directly_visible", "explicitly_written", "explicitly_spoken"]


class WorkerExplicitLiteral(StrictAgentModel):
    literal: str = Field(min_length=1, max_length=500)
    evidence_kind: Literal["frame", "image", "transcript_segment", "article_text", "metadata"]
    evidence_id: str = Field(min_length=1, max_length=128)


class WorkerMetadataResult(StrictAgentModel):
    capture_location_available: bool
    capture_location_origin: (
        Literal["METADATA", "USER_DECLARED", "EXPLICIT_SOURCE_GEOMETRY", "HUMAN_CONFIRMED"] | None
    ) = None


class WorkerGeographicMarker(StrictAgentModel):
    type: Literal["media_capture"]
    geometry_origin: Literal[
        "METADATA", "USER_DECLARED", "EXPLICIT_SOURCE_GEOMETRY", "HUMAN_CONFIRMED"
    ]


class WorkerItemResult(StrictAgentModel):
    input_id: str
    metadata_result: WorkerMetadataResult
    transcript: WorkerTranscript = Field(default_factory=WorkerTranscript)
    pixel_regions: list[WorkerPixelRegion] = Field(default_factory=list)
    visual_evidence_selection: list[WorkerVisualEvidenceSelection] = Field(default_factory=list)
    factual_observations: list[WorkerFactualObservation] = Field(default_factory=list)
    explicit_places: list[WorkerExplicitLiteral] = Field(default_factory=list)
    explicit_times: list[WorkerExplicitLiteral] = Field(default_factory=list)
    location_status: Literal[
        "NO_LOCATION",
        "CAPTURE_LOCATION_ONLY",
        "USER_DECLARED_OBSERVATION_LOCATION",
        "EXPLICIT_SOURCE_GEOMETRY",
        "HUMAN_CONFIRMED_OBSERVATION_LOCATION",
    ]
    geographic_marker_candidate: WorkerGeographicMarker | None = None
    observed_phenomenon_marker: None = None
    requires_human_review: Literal[True]


class WorkerModelRun(StrictAgentModel):
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


class WorkerOutput(StrictAgentModel):
    schema_version: Literal["1.0"] = "1.0"
    batch_id: str
    status: Literal["succeeded", "partial_failure", "failed"]
    retryable: bool
    model_runs: list[WorkerModelRun]
    items: list[WorkerItemResult]
    validation_errors: list[str] = Field(default_factory=list)
    boot_ms: int = Field(ge=0)
