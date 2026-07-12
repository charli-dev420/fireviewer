from enum import StrEnum


class SourceType(StrEnum):
    TEXT = "text"
    IMAGE = "image"
    VIDEO = "video"
    SENSOR = "sensor"
    OPERATOR = "operator"
    INSTITUTIONAL = "institutional"


class SourceTrust(StrEnum):
    UNVERIFIED = "unverified"
    PARTNER = "partner"
    INSTITUTIONAL = "institutional"
    OPERATOR = "operator"


class IncidentStatus(StrEnum):
    CANDIDATE = "CANDIDATE"
    UNDER_REVIEW = "UNDER_REVIEW"
    ACTIVE_CONFIRMED = "ACTIVE_CONFIRMED"
    MONITORING = "MONITORING"
    EXTINGUISHED = "EXTINGUISHED"
    CLOSED = "CLOSED"
    SUSPENDED = "SUSPENDED"
    REJECTED = "REJECTED"


class PublicVisibility(StrEnum):
    PUBLIC = "PUBLIC"
    LIMITED = "LIMITED"
    SUSPENDED = "SUSPENDED"
    TOMBSTONED = "TOMBSTONED"


class MatchDecision(StrEnum):
    CREATE = "create"
    ATTACH = "attach"
    REVIEW = "review"


class VerificationState(StrEnum):
    UNVERIFIED = "UNVERIFIED"
    PENDING_REVIEW = "PENDING_REVIEW"
    VERIFIED = "VERIFIED"
    REJECTED = "REJECTED"


class AssetState(StrEnum):
    GENERATED = "GENERATED"
    VALIDATED = "VALIDATED"
    PUBLISHED = "PUBLISHED"
    SUPERSEDED = "SUPERSEDED"
    QUARANTINED = "QUARANTINED"
    DELETED_TOMBSTONE = "DELETED_TOMBSTONE"


class AssetLod(StrEnum):
    MOBILE = "mobile"
    DESKTOP = "desktop"


class JobKind(StrEnum):
    TERRAIN_BAKE = "TERRAIN_BAKE"
    ASSET_PUBLICATION = "ASSET_PUBLICATION"


class JobState(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    VALIDATING = "VALIDATING"
    UPLOADING = "UPLOADING"
    VERIFYING = "VERIFYING"
    PUBLISHING = "PUBLISHING"
    SUCCEEDED = "SUCCEEDED"
    RETRY_WAIT = "RETRY_WAIT"
    QUARANTINED = "QUARANTINED"
    CANCELLED = "CANCELLED"


class ActorType(StrEnum):
    PUBLIC_SOURCE = "public_source"
    OPERATOR = "operator"
    SERVICE = "service"
    SYSTEM = "system"


class ReviewResolutionAction(StrEnum):
    ATTACH = "attach"
    CREATE = "create"
    REJECT = "reject"
