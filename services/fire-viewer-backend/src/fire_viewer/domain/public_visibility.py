"""Canonical public-visibility rules for incident lifecycle states.

The persisted visibility is intentionally kept separate from the episode status so an
operator can tombstone an incident without inventing a terminal episode status.  For
every non-tombstoned public projection, however, the pair must match this module's
canonical mapping.  Readers fail closed when it does not.
"""

from typing import Final

from fire_viewer.domain.enums import IncidentStatus, PublicVisibility

CANONICAL_VISIBILITY_BY_STATUS: Final[dict[IncidentStatus, PublicVisibility]] = {
    IncidentStatus.CANDIDATE: PublicVisibility.LIMITED,
    IncidentStatus.UNDER_REVIEW: PublicVisibility.LIMITED,
    IncidentStatus.REJECTED: PublicVisibility.LIMITED,
    IncidentStatus.SUSPENDED: PublicVisibility.SUSPENDED,
    IncidentStatus.ACTIVE_CONFIRMED: PublicVisibility.PUBLIC,
    IncidentStatus.MONITORING: PublicVisibility.PUBLIC,
    IncidentStatus.EXTINGUISHED: PublicVisibility.PUBLIC,
    IncidentStatus.CLOSED: PublicVisibility.PUBLIC,
}

# A closed incident may retain its public location but never a live viewer asset or frame.
PUBLIC_LOCATION_STATUSES: Final[frozenset[IncidentStatus]] = frozenset(
    {
        IncidentStatus.ACTIVE_CONFIRMED,
        IncidentStatus.MONITORING,
        IncidentStatus.EXTINGUISHED,
        IncidentStatus.CLOSED,
    }
)
VIEWER_ASSET_STATUSES: Final[frozenset[IncidentStatus]] = frozenset(
    {
        IncidentStatus.ACTIVE_CONFIRMED,
        IncidentStatus.MONITORING,
        IncidentStatus.EXTINGUISHED,
    }
)
WITHHELD_MANIFEST_STATUSES: Final[frozenset[IncidentStatus]] = frozenset(
    {
        IncidentStatus.CANDIDATE,
        IncidentStatus.UNDER_REVIEW,
        IncidentStatus.REJECTED,
        IncidentStatus.SUSPENDED,
    }
)


def canonical_public_visibility(status: IncidentStatus) -> PublicVisibility:
    """Return the only non-tombstoned visibility permitted for ``status``."""

    return CANONICAL_VISIBILITY_BY_STATUS[status]


def has_canonical_public_visibility(
    status: IncidentStatus,
    visibility: PublicVisibility,
) -> bool:
    """Whether a persisted lifecycle pair is safe to expose publicly.

    ``TOMBSTONED`` deliberately has no status mapping.  The query layer handles it as
    a 410 before asking this policy whether any projection is allowed.
    """

    return visibility == canonical_public_visibility(status)


def permits_public_location(status: IncidentStatus, visibility: PublicVisibility) -> bool:
    """Whether the public query may expose the incident location."""

    return status in PUBLIC_LOCATION_STATUSES and has_canonical_public_visibility(
        status, visibility
    )


def permits_public_viewer_asset(status: IncidentStatus, visibility: PublicVisibility) -> bool:
    """Whether the public manifest may expose a live 3D asset and spatial frame."""

    return status in VIEWER_ASSET_STATUSES and has_canonical_public_visibility(status, visibility)
