import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app import crud, schemas
from app.services.asr_service import is_model_loaded, get_model_info
from app.services.audio_pipeline import check_ffmpeg, audio_pipeline
from app.services.ws_manager import ws_manager
from app.services.translation_pipeline import translation_pipeline

logger = logging.getLogger(__name__)
router = APIRouter(tags=["live"])


@router.get("/api/audio/status", response_model=schemas.AudioStatusResponse)
async def audio_status():
    info = get_model_info()
    return schemas.AudioStatusResponse(
        connected=len(ws_manager.get_active_sessions()) > 0,
        active_sessions=ws_manager.get_active_sessions(),
        asr_device=info.get("device"),
        asr_loaded=info.get("loaded", False),
    )


@router.post("/api/sessions/from-chrome-tab", response_model=schemas.SessionRead, status_code=201)
async def create_chrome_tab_session(data: schemas.ChromeTabSessionCreate, db: DbSession = Depends(get_db)):
    provider_name = None
    if data.provider_id:
        provider = crud.get_provider(db, data.provider_id)
        if provider:
            provider_name = provider.provider_name
        else:
            raise HTTPException(status_code=404, detail="Provider not found")

    return crud.create_chrome_tab_session(db, data, provider_name)


@router.post("/api/sessions/{session_id}/live/start", response_model=schemas.LiveStartResponse)
async def live_start(session_id: int, db: DbSession = Depends(get_db)):
    session = crud.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == "stopped":
        raise HTTPException(status_code=400, detail="Session is stopped")

    if not check_ffmpeg():
        raise HTTPException(status_code=500, detail="ffmpeg not found. Install ffmpeg and add to PATH.")

    settings = crud.get_settings(db)

    try:
        audio_pipeline.configure(
            chunk_seconds=float(settings.get("chunk_seconds", "3")),
            sample_rate=16000,
        )
        await translation_pipeline.start()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start pipeline: {e}")

    return schemas.LiveStartResponse(
        session_id=session_id,
        status="ready",
        message="Live session ready. Connect Chrome Extension to start capturing audio.",
    )


@router.post("/api/sessions/{session_id}/live/stop", response_model=schemas.LiveStopResponse)
async def live_stop(session_id: int, db: DbSession = Depends(get_db)):
    session = crud.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    crud.stop_session(db, session_id)
    audio_pipeline.remove_buffer(session_id)

    await ws_manager.broadcast_live(session_id, {
        "type": "status",
        "session_id": session_id,
        "status": "stopped",
    })

    return schemas.LiveStopResponse(session_id=session_id, status="stopped")


@router.get("/api/settings", response_model=schemas.SettingsRead)
async def get_settings(db: DbSession = Depends(get_db)):
    return crud.get_settings(db)


@router.get("/api/sessions/{session_id}/live/status", response_model=schemas.LiveStatusResponse)
async def live_status(session_id: int):
    from app.routers.websocket import get_live_stats
    stats = get_live_stats(session_id)
    return schemas.LiveStatusResponse(
        session_id=session_id,
        audio_ws_connected=stats.audio_ws_connected,
        last_audio_chunk_at=stats.last_audio_chunk_at if stats.last_audio_chunk_at > 0 else None,
        last_audio_chunk_bytes=stats.last_audio_chunk_bytes,
        chunks_received=stats.chunks_received,
        last_decode_status=stats.last_decode_status,
        last_error=stats.last_error,
    )


@router.patch("/api/settings", response_model=schemas.SettingsRead)
async def update_settings(data: schemas.SettingsUpdate, db: DbSession = Depends(get_db)):
    return crud.update_settings(db, data)
