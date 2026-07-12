from typing import Literal

from fastapi import APIRouter
from sqlalchemy import text

from fire_viewer.api.dependencies import SessionDep, SettingsDep
from fire_viewer.domain.errors import DomainError
from fire_viewer.domain.schemas import HealthResponse, ReadinessResponse

router = APIRouter(tags=["health"])


@router.get("/healthz", response_model=HealthResponse, include_in_schema=False)
def health(settings: SettingsDep) -> HealthResponse:
    return HealthResponse(status="ok", version=settings.app_version)


@router.get("/readyz", response_model=ReadinessResponse, include_in_schema=False)
def readiness(session: SessionDep) -> ReadinessResponse:
    try:
        session.execute(text("SELECT 1"))
        spatial_status: Literal["ok", "not_applicable"] = "not_applicable"
        if session.get_bind().dialect.name == "sqlite":
            exists = session.execute(
                text(
                    "SELECT 1 FROM sqlite_master "
                    "WHERE type='table' AND name='incident_series_rtree'"
                )
            ).scalar_one_or_none()
            if not exists:
                raise RuntimeError("SQLite RTree index is missing; migrations are not at head")
            spatial_status = "ok"
    except Exception as exc:
        raise DomainError(
            status_code=503,
            code="not_ready",
            title="Service not ready",
            detail="Database or spatial index readiness checks failed.",
        ) from exc
    return ReadinessResponse(
        status="ready",
        database="ok",
        spatial_index=spatial_status,
    )
