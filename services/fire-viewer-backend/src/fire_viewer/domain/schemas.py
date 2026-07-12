from __future__ import annotations

import math
from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    WithJsonSchema,
    field_validator,
    model_validator,
)

from fire_viewer.core.ids import SOURCE_KEY_RE, TERRITORY_CODE_RE
from fire_viewer.domain.enums import (
    AssetLod,
    IncidentStatus,
    MatchDecision,
    PublicVisibility,
    ReviewResolutionAction,
    SourceTrust,
    SourceType,
    VerificationState,
)

StrictText = Annotated[str, StringConstraints(strip_whitespace=True)]
ManifestLongitude = Annotated[float, Field(ge=-180.0, le=180.0, allow_inf_nan=False)]
ManifestLatitude = Annotated[float, Field(ge=-90.0, le=90.0, allow_inf_nan=False)]
ManifestEllipsoidHeight = Annotated[float, Field(allow_inf_nan=False)]
ManifestMetersPerUnit = Annotated[
    float,
    Field(ge=0.01, le=0.01, allow_inf_nan=False),
    WithJsonSchema({"const": 0.01, "type": "number"}),
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class SourceInput(StrictModel):
    id: str = Field(min_length=3, max_length=128)
    type: SourceType
    trust: SourceTrust = SourceTrust.UNVERIFIED

    @field_validator("id")
    @classmethod
    def validate_source_id(cls, value: str) -> str:
        if not SOURCE_KEY_RE.fullmatch(value):
            raise ValueError("source.id contains unsupported characters")
        return value


class PointGeometryInput(StrictModel):
    type: Literal["Point"] = "Point"
    coordinates: tuple[float, float]
    horizontal_uncertainty_m: float = Field(gt=0.0, le=50_000.0)
    altitude_m: float | None = Field(default=None, ge=-500.0, le=10_000.0)
    vertical_datum: str | None = Field(default=None, min_length=2, max_length=128)

    @model_validator(mode="after")
    def validate_coordinates(self) -> PointGeometryInput:
        longitude, latitude = self.coordinates
        if not -180.0 <= longitude <= 180.0:
            raise ValueError("longitude must be between -180 and 180")
        if not -90.0 <= latitude <= 90.0:
            raise ValueError("latitude must be between -90 and 90")
        if self.altitude_m is not None and not self.vertical_datum:
            raise ValueError("vertical_datum is required when altitude_m is supplied")
        return self


class EvidenceInput(StrictModel):
    content_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    license: str = Field(min_length=1, max_length=255)
    external_reference: str | None = Field(default=None, max_length=512)


class DetectionContext(StrictModel):
    territory_code: str = Field(min_length=2, max_length=3)
    toponyms: list[str] = Field(default_factory=list, max_length=10)
    canonical_name: str | None = Field(default=None, min_length=2, max_length=255)

    @field_validator("territory_code")
    @classmethod
    def validate_territory_code(cls, value: str) -> str:
        normalized = value.upper()
        if not TERRITORY_CODE_RE.fullmatch(normalized):
            raise ValueError("territory_code must contain 2 or 3 uppercase alphanumerics")
        return normalized

    @field_validator("toponyms")
    @classmethod
    def validate_toponyms(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for item in values:
            stripped = item.strip()
            if not 2 <= len(stripped) <= 128:
                raise ValueError("each toponym must contain between 2 and 128 characters")
            if stripped not in normalized:
                normalized.append(stripped)
        return normalized


class DetectionRequest(StrictModel):
    source: SourceInput
    observed_at: AwareDatetime
    received_at: AwareDatetime
    geometry: PointGeometryInput
    evidence: EvidenceInput
    context: DetectionContext


class DetectionResponse(StrictModel):
    observation_id: str
    decision: MatchDecision
    fire_id: str | None = None
    episode_id: str | None = None
    proposed_fire_id: str | None = None
    proposed_episode_id: str | None = None
    score: float | None = None
    margin_to_second_candidate: float | None = None
    factors: dict[str, float] = Field(default_factory=dict)
    distance_m: float | None = None
    review_reasons: list[str] = Field(default_factory=list)
    public_confirmation: Literal["pending", "not_applicable"]
    policy_id: str
    trace_id: str


class EpisodeSummary(StrictModel):
    episode_id: str
    ordinal: int
    status: IncidentStatus
    review_required: bool
    started_at: datetime
    last_observed_at: datetime
    validated_at: datetime | None = None
    ended_at: datetime | None = None
    is_current: bool
    version: int


class IncidentPublicResponse(StrictModel):
    fire_id: str
    canonical_name: str | None = None
    visibility: PublicVisibility
    status: IncidentStatus
    current_episode_id: str
    location: PointGeometryInput | None
    public_note: str | None = None
    last_observed_at: datetime
    created_at: datetime
    episodes: list[EpisodeSummary]


class ManifestStatus(StrictModel):
    code: IncidentStatus
    validated_at: datetime | None = None
    review_required: bool


class ManifestAsset(StrictModel):
    asset_id: str
    version: int
    url: str
    sha256: str
    size_bytes: int
    lod: AssetLod


class ManifestFrame(StrictModel):
    origin_wgs84: tuple[ManifestLongitude, ManifestLatitude, ManifestEllipsoidHeight]
    local_frame: Literal["ENU"]
    meters_per_unit: ManifestMetersPerUnit
    vertical_datum: Literal["EPSG:4979"]

    @field_validator("origin_wgs84")
    @classmethod
    def validate_origin_wgs84(cls, value: tuple[float, float, float]) -> tuple[float, float, float]:
        if not all(math.isfinite(component) for component in value):
            raise ValueError("origin_wgs84 values must be finite")
        return value


class ManifestFreshness(StrictModel):
    incident_at: datetime
    terrain_source_year: int | None = None
    generated_at: datetime | None = None


class ViewerManifest(StrictModel):
    schema_version: Literal["2.0"]
    fire_id: str
    episode_id: str
    status: ManifestStatus
    location: PointGeometryInput | None
    asset: ManifestAsset | None = None
    frame: ManifestFrame | None = None
    freshness: ManifestFreshness
    model_state: Literal["available", "not_available", "withheld"]
    public_notice: str

    @model_validator(mode="after")
    def validate_public_projection(self) -> ViewerManifest:
        if self.model_state == "available" and (
            self.location is None or self.asset is None or self.frame is None
        ):
            raise ValueError("available manifests require location, asset, and frame")
        if self.model_state == "not_available" and (
            self.location is None or self.asset is not None or self.frame is not None
        ):
            raise ValueError("not_available manifests require location without asset or frame")
        if self.model_state == "withheld" and any(
            value is not None for value in (self.location, self.asset, self.frame)
        ):
            raise ValueError("withheld manifests must not include location, asset, or frame")
        return self


class TransitionRequest(StrictModel):
    target_status: IncidentStatus
    expected_version: int = Field(ge=1)
    reason: str = Field(min_length=10, max_length=500)
    public_note: str | None = Field(default=None, max_length=500)
    validation_basis: str | None = Field(default=None, max_length=1_000)


class TransitionResponse(StrictModel):
    fire_id: str
    episode_id: str
    previous_status: IncidentStatus
    status: IncidentStatus
    version: int
    review_required: bool
    trace_id: str


class ReviewResolutionRequest(StrictModel):
    action: ReviewResolutionAction
    expected_version: int = Field(ge=1)
    reason: str = Field(min_length=10, max_length=500)
    target_fire_id: str | None = Field(default=None, max_length=32)

    @model_validator(mode="after")
    def validate_target(self) -> ReviewResolutionRequest:
        if self.action == ReviewResolutionAction.ATTACH and not self.target_fire_id:
            raise ValueError("target_fire_id is required for attach")
        if self.action != ReviewResolutionAction.ATTACH and self.target_fire_id is not None:
            raise ValueError("target_fire_id is only valid for attach")
        return self


class ReviewResolutionResponse(StrictModel):
    observation_id: str
    action: ReviewResolutionAction
    verification_state: VerificationState
    fire_id: str | None = None
    episode_id: str | None = None
    version: int
    trace_id: str


class SourceUpsertRequest(StrictModel):
    type: SourceType
    trust: SourceTrust
    display_name: str | None = Field(default=None, max_length=255)
    enabled: bool = True
    ingest_token: str | None = Field(default=None, min_length=32, max_length=256)
    reason: str = Field(min_length=10, max_length=500)


class SourceResponse(StrictModel):
    id: str
    type: SourceType
    trust: SourceTrust
    display_name: str | None = None
    enabled: bool
    credential_configured: bool
    created_at: datetime
    updated_at: datetime


class HealthResponse(StrictModel):
    status: Literal["ok"]
    version: str


class ReadinessResponse(StrictModel):
    status: Literal["ready"]
    database: Literal["ok"]
    spatial_index: Literal["ok", "not_applicable"]
