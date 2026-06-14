import logging
import re
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse, Response
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app import crud, schemas, translator
from app.services.export_service import export_session_json, export_session_csv

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("", response_model=schemas.SessionRead, status_code=201)
async def create_session(data: schemas.SessionCreate, db: DbSession = Depends(get_db)):
    return crud.create_session(db, data)


@router.get("", response_model=List[schemas.SessionRead])
async def list_sessions(db: DbSession = Depends(get_db)):
    return crud.get_sessions(db)


@router.get("/{session_id}", response_model=schemas.SessionRead)
async def get_session(session_id: int, db: DbSession = Depends(get_db)):
    session = crud.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.patch("/{session_id}", response_model=schemas.SessionRead)
async def update_session(session_id: int, data: schemas.SessionUpdate, db: DbSession = Depends(get_db)):
    session = crud.update_session(db, session_id, data)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.post("/{session_id}/stop", response_model=schemas.SessionRead)
async def stop_session(session_id: int, db: DbSession = Depends(get_db)):
    session = crud.stop_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.post("/{session_id}/translate", response_model=schemas.TranslateResponse)
async def translate_in_session(
    session_id: int,
    data: schemas.TranslateRequest,
    db: DbSession = Depends(get_db),
):
    session = crud.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == "stopped":
        raise HTTPException(status_code=400, detail="session_stopped")

    if not data.source_text or not data.source_text.strip():
        raise HTTPException(status_code=400, detail="source_text_empty")

    provider = None

    if session.provider_id:
        provider = crud.get_provider(db, session.provider_id)

    if not provider and session.translation_provider:
        providers = crud.get_providers(db)
        matched = [p for p in providers if p.enabled and p.provider_name == session.translation_provider]
        if matched:
            provider = matched[0]

    if not provider:
        providers = crud.get_providers(db)
        enabled = [p for p in providers if p.enabled]
        if enabled:
            provider = enabled[0]

    if not provider:
        raise HTTPException(status_code=400, detail="provider_not_configured")

    if not provider.enabled:
        raise HTTPException(status_code=400, detail="provider_disabled")

    segment_index = crud.get_next_segment_index(db, session_id)
    source_lang = data.source_language
    if source_lang == "auto":
        if re.search(r'[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]', data.source_text):
            source_lang = "ja"
        else:
            source_lang = "en"

    segment = crud.create_segment(
        db, session_id, segment_index, source_lang, data.source_text.strip()
    )

    result = await translator.translate_text(
        provider=provider,
        source_text=data.source_text.strip(),
        source_language=source_lang,
        mode=data.mode,
    )

    crud.update_segment_result(
        db, segment.id,
        translated_text=result.translated_text,
        provider_name=result.provider_name,
        model=result.model,
        latency_ms=result.latency_ms,
        status="translated" if result.status == "completed" else "error",
        error_message=result.error_message,
    )

    return schemas.TranslateResponse(
        segment_id=segment.id,
        source_text=data.source_text.strip(),
        translated_text=result.translated_text,
        model=result.model,
        provider=result.provider_name,
        latency_ms=round(result.latency_ms, 2),
        status="translated" if result.status == "completed" else "error",
        error_message=result.error_message,
    )


@router.get("/{session_id}/segments", response_model=List[schemas.SegmentRead])
async def list_segments(session_id: int, db: DbSession = Depends(get_db)):
    session = crud.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return crud.get_segments(db, session_id)


@router.get("/{session_id}/export")
async def export_session(
    session_id: int,
    format: str = Query(default="json", pattern="^(json|csv)$"),
    db: DbSession = Depends(get_db),
):
    session = crud.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    segments = crud.get_all_segments_for_export(db, session_id)

    if format == "json":
        content = export_session_json(session, segments)
        return Response(
            content=content,
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename=session_{session_id}.json"}
        )
    else:
        content = export_session_csv(session, segments)
        return PlainTextResponse(
            content=content,
            headers={"Content-Disposition": f"attachment; filename=session_{session_id}.csv"}
        )
