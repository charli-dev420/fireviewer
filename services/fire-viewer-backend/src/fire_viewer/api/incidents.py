from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Header, Response
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from fire_viewer.api.dependencies import (
    FireIdDep,
    IdempotencyKeyDep,
    SessionDep,
    SettingsDep,
    SourceTokenDep,
    TraceIdDep,
)
from fire_viewer.domain.hashing import sha256_hex
from fire_viewer.domain.schemas import (
    DetectionRequest,
    DetectionResponse,
    IncidentPublicResponse,
    ViewerManifest,
)
from fire_viewer.services.detection import process_detection
from fire_viewer.services.queries import get_incident_public, get_viewer_manifest

router = APIRouter(tags=["incidents"])

_MANIFEST_CACHE_CONTROL = "public, max-age=30, must-revalidate"
_TRACE_ID_HEADER: dict[str, Any] = {
    "description": "Trace identifier to include when reporting an error.",
    "schema": {"type": "string"},
}
_MANIFEST_SUCCESS_HEADERS: dict[str, dict[str, Any]] = {
    "ETag": {
        "description": "Strong entity tag calculated from the serialized ViewerManifest.",
        "schema": {"type": "string"},
    },
    "Cache-Control": {
        "description": "Short public cache lifetime for this viewer representation.",
        "schema": {"type": "string", "example": _MANIFEST_CACHE_CONTROL},
    },
    "X-Trace-Id": _TRACE_ID_HEADER,
}
_PROBLEM_DETAILS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["type", "title", "status", "detail", "instance", "trace_id"],
    "properties": {
        "type": {"type": "string", "format": "uri-reference"},
        "title": {"type": "string"},
        "status": {"type": "integer"},
        "detail": {"type": "string"},
        "instance": {"type": "string"},
        "trace_id": {"type": "string"},
    },
}


def _manifest_problem_response(description: str) -> dict[str, Any]:
    return {
        "description": description,
        "headers": {"X-Trace-Id": _TRACE_ID_HEADER},
        "content": {
            "application/problem+json": {"schema": _PROBLEM_DETAILS_SCHEMA},
        },
    }


@router.post(
    "/detect",
    response_model=DetectionResponse,
    responses={201: {"description": "A new incident series was created."}},
)
def detect_incident(
    payload: DetectionRequest,
    response: Response,
    session: SessionDep,
    settings: SettingsDep,
    trace_id: TraceIdDep,
    idempotency_key: IdempotencyKeyDep,
    source_token: SourceTokenDep,
) -> DetectionResponse:
    outcome = process_detection(
        session,
        payload=payload,
        idempotency_key=idempotency_key,
        source_token=source_token,
        trace_id=trace_id,
        settings=settings,
    )
    response.status_code = outcome.status_code
    response.headers["Idempotent-Replay"] = "true" if outcome.replayed else "false"
    response.headers["Cache-Control"] = "no-store"
    return outcome.response


@router.get("/{fire_id}", response_model=IncidentPublicResponse)
def get_incident(
    fire_id: FireIdDep,
    response: Response,
    session: SessionDep,
) -> IncidentPublicResponse:
    result = get_incident_public(session, fire_id)
    response.headers["Cache-Control"] = "public, max-age=15, must-revalidate"
    return result


@router.get(
    "/{fire_id}/manifest",
    response_model=ViewerManifest,
    summary="Get the public viewer manifest",
    description=(
        "Returns the public ViewerManifest in snake_case. A matching If-None-Match returns "
        "304 without a body. This read endpoint never returns 409; conflicts are reserved for "
        "mutations."
    ),
    responses={
        200: {
            "description": "Current public ViewerManifest.",
            "headers": _MANIFEST_SUCCESS_HEADERS,
        },
        304: {
            "description": "Manifest unchanged; the response body is empty.",
            "headers": _MANIFEST_SUCCESS_HEADERS,
        },
        400: _manifest_problem_response("The fire_id path parameter has an invalid format."),
        404: _manifest_problem_response("No incident exists for this fire_id."),
        410: _manifest_problem_response("The incident has been tombstoned."),
        503: _manifest_problem_response("The incident data is temporarily unavailable."),
    },
)
def get_manifest(
    fire_id: FireIdDep,
    session: SessionDep,
    settings: SettingsDep,
    if_none_match: Annotated[str | None, Header(alias="If-None-Match")] = None,
) -> ViewerManifest | Response:
    manifest = get_viewer_manifest(session, fire_id, settings)
    payload = manifest.model_dump(mode="json", exclude_none=False)
    etag = f'"{sha256_hex(payload)}"'
    headers = {
        "ETag": etag,
        "Cache-Control": _MANIFEST_CACHE_CONTROL,
    }
    if if_none_match == etag:
        return Response(status_code=304, headers=headers)
    return JSONResponse(content=jsonable_encoder(payload), headers=headers)
