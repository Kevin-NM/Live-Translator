from fastapi import APIRouter
from app.schemas import HealthResponse

router = APIRouter()


@router.get("/api/health", response_model=HealthResponse)
async def health_check():
    return HealthResponse(
        status="ok",
        version="0.1.0",
        database="sqlite"
    )
