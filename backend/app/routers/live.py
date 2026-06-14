import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app import crud, schemas
from app.services.asr_service import is_model_loaded, get_model_info
from app.services.audio_pipeline import audio_pipeline
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


@router.post("/api/translation/test", response_model=schemas.TranslationTestResponse)
async def translation_test(data: schemas.TranslationTestRequest, db: DbSession = Depends(get_db)):
    from app import translator as translator_mod

    provider = crud.get_provider(db, data.provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    if not provider.enabled:
        raise HTTPException(status_code=400, detail="Provider is disabled")

    source_text = data.source_text or "いや、これはさすがに無理でしょ。今のタイミングで突っ込むのは危なすぎるって。"
    source_language = data.source_language or "ja"

    result = await translator_mod.translate_text(
        provider=provider,
        source_text=source_text,
        source_language=source_language,
        mode="realtime",
    )

    return schemas.TranslationTestResponse(
        status=result.status,
        latency_ms=round(result.latency_ms, 2),
        model=result.model,
        provider_name=result.provider_name,
        source_text=source_text,
        translated_text=result.translated_text,
        error_message=result.error_message,
        http_status=result.http_status,
        raw_response_preview=result.raw_response_preview,
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
        last_format=stats.last_format,
        last_sample_rate=stats.last_sample_rate,
        last_channels=stats.last_channels,
        pcm_duration_buffered=stats.pcm_duration_buffered,
    )


@router.patch("/api/settings", response_model=schemas.SettingsRead)
async def update_settings(data: schemas.SettingsUpdate, db: DbSession = Depends(get_db)):
    return crud.update_settings(db, data)


@router.post("/api/sessions/{session_id}/live/inject-text")
async def inject_text(session_id: int, data: schemas.InjectTextRequest, db: DbSession = Depends(get_db)):
    from app.services.translation_pipeline import TranslationJob

    session = crud.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == "stopped":
        raise HTTPException(status_code=400, detail="Session is stopped")

    segment_index = crud.get_next_segment_index(db, session_id)
    segment = crud.create_segment(
        db, session_id, segment_index,
        source_language=data.source_language,
        source_text=data.source_text.strip(),
        is_final=True,
        asr_provider="inject",
    )

    await ws_manager.broadcast_live(session_id, {
        "type": "final",
        "session_id": session_id,
        "segment_id": segment.id,
        "source_language": data.source_language,
        "source_text": data.source_text.strip(),
        "translated_text": None,
        "start_ms": None,
        "end_ms": None,
        "latency_asr_ms": 0,
        "latency_translate_ms": None,
        "status": "translating",
    })

    await translation_pipeline.submit(TranslationJob(
        session_id=session_id,
        segment_id=segment.id,
        source_text=data.source_text.strip(),
        source_language=data.source_language,
        mode="realtime",
    ))

    return {"session_id": session_id, "segment_id": segment.id, "status": "queued"}
