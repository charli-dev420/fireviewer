from fastapi import APIRouter

from fire_viewer.api import incidents, operator

api_router = APIRouter()
api_router.include_router(incidents.router, prefix="/incident")
api_router.include_router(
    incidents.router,
    prefix="/incidents",
    include_in_schema=False,
)
api_router.include_router(operator.router)
