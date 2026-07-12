from __future__ import annotations

from typing import Annotated

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
    responses={304: {"description": "Manifest unchanged."}},
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
        "Cache-Control": "public, max-age=30, must-revalidate",
    }
    if if_none_match == etag:
        return Response(status_code=304, headers=headers)
    return JSONResponse(content=jsonable_encoder(payload), headers=headers)
