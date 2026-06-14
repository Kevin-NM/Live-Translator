from fastapi import APIRouter
from app.schemas import HealthResponse
from app.database import get_db_path

router = APIRouter()


@router.get("/api/health", response_model=HealthResponse)
async def health_check():
    return HealthResponse(
        status="ok",
        version="0.2.0",
        database="sqlite",
        db_path=get_db_path(),
    )
