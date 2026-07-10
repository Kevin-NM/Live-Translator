import asyncio
import logging
import time
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app import crud, schemas
from app.services.asr_service import is_model_loaded, get_model_info, preload_model
from app.services.audio_pipeline import audio_pipeline
from app.services.ws_manager import ws_manager
from app.services.translation_pipeline import translation_pipeline

logger = logging.getLogger(__name__)
router = APIRouter(tags=["live"])

STALE_THRESHOLD = 30.0


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
        route="provider_test",
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
async def live_start(session_id: int, data: schemas.LiveStartRequest | None = None, db: DbSession = Depends(get_db)):
    from app.routers.websocket import start_live_stats
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
        start_live_stats(session_id, data.capture_id if data else "")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start pipeline: {e}")

    return schemas.LiveStartResponse(
        session_id=session_id,
        status="ready",
        message="Live session ready. Connect Chrome Extension to start capturing audio.",
    )


@router.post("/api/sessions/{session_id}/live/stop", response_model=schemas.LiveStopResponse)
async def live_stop(session_id: int, db: DbSession = Depends(get_db)):
    from app.routers.websocket import get_live_stats
    session = crud.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    crud.stop_session(db, session_id)
    audio_pipeline.remove_buffer(session_id)
    stats = get_live_stats(session_id)
    stats.audio_ws_connected = False
    stats.audio_status = "stopped"
    stats.last_decode_status = "stopped"
    stats.pcm_duration_buffered = 0

    await ws_manager.broadcast_live(session_id, {
        "type": "status",
        "session_id": session_id,
        "status": "stopped",
    })

    return schemas.LiveStopResponse(session_id=session_id, status="stopped")


@router.get("/api/settings", response_model=schemas.SettingsRead)
async def get_settings(db: DbSession = Depends(get_db)):
    return crud.get_settings(db)


@router.post("/api/asr/preload", response_model=schemas.ASRPreloadResponse)
async def asr_preload(db: DbSession = Depends(get_db)):
    settings = crud.get_settings(db)
    result = preload_model(
        model_size=settings.get("asr_model", "small"),
        device=settings.get("device", "auto"),
        compute_type=settings.get("compute_type", "int8_float16"),
    )
    return schemas.ASRPreloadResponse(**result)


@router.get("/api/sessions/{session_id}/live/status", response_model=schemas.LiveStatusResponse)
async def live_status(session_id: int, db: DbSession = Depends(get_db)):
    from app.routers.websocket import get_live_stats
    stats = get_live_stats(session_id)

    session = crud.get_session(db, session_id)
    session_status = session.status if session else "unknown"

    now = time.time()
    in_startup_grace = stats.startup_grace_until > now and stats.chunks_received == 0
    if stats.audio_status in ("starting", "connecting") and not in_startup_grace and stats.chunks_received == 0:
        stats.audio_status = "disconnected"
        stats.last_decode_status = "disconnected"
        stats.last_error = "Extension audio did not connect within 10 seconds"
    is_stale = stats.audio_status == "disconnected" and not in_startup_grace

    return schemas.LiveStatusResponse(
        session_id=session_id,
        session_status=session_status,
        audio_ws_connected=stats.audio_ws_connected,
        audio_status=stats.audio_status,
        started_at=stats.started_at or None,
        startup_grace_until=stats.startup_grace_until or None,
        capture_id=stats.capture_id or None,
        last_audio_chunk_at=stats.last_audio_chunk_at if stats.last_audio_chunk_at > 0 else None,
        last_audio_chunk_bytes=stats.last_audio_chunk_bytes,
        chunks_received=stats.chunks_received,
        last_decode_status=stats.last_decode_status,
        last_error=stats.last_error,
        last_disconnect_time=stats.last_disconnect_time if stats.last_disconnect_time > 0 else None,
        is_stale=is_stale,
        last_format=stats.last_format,
        last_sample_rate=stats.last_sample_rate,
        last_channels=stats.last_channels,
        pcm_duration_buffered=stats.pcm_duration_buffered,
        translation_queue_size=translation_pipeline.queue_size,
        active_translation_jobs=translation_pipeline.active_jobs,
        translation_timeout_count=translation_pipeline.timeout_count,
        last_translation_error=translation_pipeline.last_error,
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
        route="inject",
    ))

    return {"session_id": session_id, "segment_id": segment.id, "status": "queued"}


@router.get("/api/debug/translation-contracts")
async def translation_contracts(session_id: int | None = None, limit: int = 20):
    from app.translator import get_translation_contracts
    return get_translation_contracts(session_id=session_id, limit=limit)


@router.post("/api/debug/translation-compare")
async def translation_compare(data: schemas.TranslationCompareRequest, db: DbSession = Depends(get_db)):
    from app import translator as translator_mod
    from app.services.translation_pipeline import inspect_target_language
    provider = crud.get_provider(db, data.provider_id)
    if not provider or not provider.enabled:
        raise HTTPException(status_code=404, detail="Enabled provider not found")
    cases = [(route, None) for route in ("provider_test", "manual", "inject", "live")]
    cases += [("compare", variant) for variant in ("chat_prompt", "minimal_prompt", "zh_direct_prompt")]
    results = await asyncio.gather(*[
        translator_mod.translate_text(
            provider, data.source_text, data.source_language, target_language=data.target_language,
            route=route, prompt_variant=variant,
        ) for route, variant in cases
    ])
    response = []
    for (route, variant), result in zip(cases, results):
        detector = inspect_target_language(result.translated_text, data.target_language, data.source_text)
        if result.contract is not None:
            result.contract["wrong_target_language"] = detector
            if detector["is_wrong"] and result.status == "completed":
                result.contract["final_status"] = "rejected"
        response.append({"route": route, "variant": variant or result.contract.get("prompt_builder"), **(result.contract or {}), "wrong_target_language": detector})
    return response

@router.post("/api/sessions/{session_id}/segments/recover")
async def recover_segments(session_id: int, db: DbSession = Depends(get_db)):
    from app.models import Segment
    from app.services.translation_pipeline import TranslationJob
    from datetime import datetime, timedelta

    session = crud.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    threshold = datetime.utcnow() - timedelta(seconds=STALE_THRESHOLD)
    stale = db.query(Segment).filter(
        Segment.session_id == session_id,
        Segment.status.in_(["pending", "queued", "translating"]),
        Segment.created_at < threshold,
    ).all()

    recovered = 0
    failed = 0
    for seg in stale:
        if session.status == "active":
            try:
                await translation_pipeline.submit(TranslationJob(
                    session_id=session_id,
                    segment_id=seg.id,
                    source_text=seg.source_text,
                    source_language=seg.source_language or "ja",
                    mode="realtime",
                ))
                recovered += 1
            except Exception:
                crud.update_segment_result(
                    db, seg.id,
                    translated_text="", provider_name="", model="",
                    latency_ms=0, status="error", error_message="recovery_failed",
                )
                failed += 1
        else:
            crud.update_segment_result(
                db, seg.id,
                translated_text="", provider_name="", model="",
                latency_ms=0, status="error", error_message="stale_job_cancelled",
            )
            failed += 1

    return {"session_id": session_id, "stale_found": len(stale), "recovered": recovered, "failed": failed}
