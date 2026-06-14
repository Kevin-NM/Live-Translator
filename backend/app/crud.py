from datetime import datetime
from typing import Optional, List
from sqlalchemy.orm import Session as DbSession
from sqlalchemy import desc
from app import models, schemas


# --- Provider CRUD ---

def get_providers(db: DbSession) -> List[models.ProviderConfig]:
    return db.query(models.ProviderConfig).order_by(
        desc(models.ProviderConfig.priority),
        models.ProviderConfig.id
    ).all()


def get_provider(db: DbSession, provider_id: int) -> Optional[models.ProviderConfig]:
    return db.query(models.ProviderConfig).filter(models.ProviderConfig.id == provider_id).first()


def create_provider(db: DbSession, data: schemas.ProviderConfigCreate) -> models.ProviderConfig:
    provider = models.ProviderConfig(**data.model_dump())
    db.add(provider)
    db.commit()
    db.refresh(provider)
    return provider


def update_provider(db: DbSession, provider_id: int, data: schemas.ProviderConfigUpdate) -> Optional[models.ProviderConfig]:
    provider = get_provider(db, provider_id)
    if not provider:
        return None
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(provider, key, value)
    provider.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(provider)
    return provider


def delete_provider(db: DbSession, provider_id: int) -> bool:
    provider = get_provider(db, provider_id)
    if not provider:
        return False
    db.delete(provider)
    db.commit()
    return True


# --- Session CRUD ---

def get_sessions(db: DbSession) -> List[models.Session]:
    return db.query(models.Session).order_by(desc(models.Session.created_at)).all()


def get_session(db: DbSession, session_id: int) -> Optional[models.Session]:
    return db.query(models.Session).filter(models.Session.id == session_id).first()


def create_session(db: DbSession, data: schemas.SessionCreate) -> models.Session:
    session = models.Session(**data.model_dump())
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def create_chrome_tab_session(db: DbSession, data: schemas.ChromeTabSessionCreate, provider_name: Optional[str] = None) -> models.Session:
    session = models.Session(
        title=data.title,
        source_type="chrome_tab",
        source_name=data.source_name or data.title,
        source_url=data.source_url,
        source_language=data.source_language,
        target_language=data.target_language,
        translation_provider=provider_name,
        provider_id=data.provider_id,
        status="active",
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def update_session(db: DbSession, session_id: int, data: schemas.SessionUpdate) -> Optional[models.Session]:
    session = get_session(db, session_id)
    if not session:
        return None
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(session, key, value)
    session.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(session)
    return session


def stop_session(db: DbSession, session_id: int) -> Optional[models.Session]:
    session = get_session(db, session_id)
    if not session:
        return None
    session.status = "stopped"
    session.ended_at = datetime.utcnow()
    session.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(session)
    return session


# --- Segment CRUD ---

def get_segments(db: DbSession, session_id: int) -> List[models.Segment]:
    return db.query(models.Segment).filter(
        models.Segment.session_id == session_id
    ).order_by(models.Segment.segment_index).all()


def get_next_segment_index(db: DbSession, session_id: int) -> int:
    last = db.query(models.Segment).filter(
        models.Segment.session_id == session_id
    ).order_by(desc(models.Segment.segment_index)).first()
    return (last.segment_index + 1) if last else 1


def create_segment(db: DbSession, session_id: int, segment_index: int,
                   source_language: str, source_text: str,
                   start_ms: Optional[int] = None, end_ms: Optional[int] = None,
                   is_final: bool = True, confidence: Optional[float] = None,
                   asr_provider: Optional[str] = None,
                   latency_asr_ms: Optional[float] = None) -> models.Segment:
    segment = models.Segment(
        session_id=session_id,
        segment_index=segment_index,
        source_language=source_language,
        source_text=source_text,
        start_ms=start_ms,
        end_ms=end_ms,
        is_final=is_final,
        confidence=confidence,
        asr_provider=asr_provider,
        latency_asr_ms=latency_asr_ms,
        status="pending"
    )
    db.add(segment)
    db.commit()
    db.refresh(segment)
    return segment


def update_segment_result(db: DbSession, segment_id: int,
                          translated_text: str, provider_name: str,
                          model: str, latency_ms: float,
                          status: str = "completed",
                          error_message: Optional[str] = None) -> Optional[models.Segment]:
    segment = db.query(models.Segment).filter(models.Segment.id == segment_id).first()
    if not segment:
        return None
    segment.translated_text = translated_text
    segment.translation_provider = provider_name
    segment.model = model
    segment.latency_translate_ms = latency_ms
    segment.status = status
    segment.error_message = error_message
    segment.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(segment)
    return segment


def get_all_segments_for_export(db: DbSession, session_id: int) -> List[models.Segment]:
    return get_segments(db, session_id)


# --- Settings CRUD ---

def get_settings(db: DbSession) -> dict:
    defaults = {
        "asr_model": "small",
        "device": "auto",
        "compute_type": "int8_float16",
        "chunk_seconds": "3",
        "source_language": "ja",
    }
    rows = db.query(models.Setting).all()
    for row in rows:
        defaults[row.key] = row.value
    return defaults


def update_settings(db: DbSession, data: schemas.SettingsUpdate) -> dict:
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        existing = db.query(models.Setting).filter(models.Setting.key == key).first()
        if existing:
            existing.value = str(value)
            existing.updated_at = datetime.utcnow()
        else:
            db.add(models.Setting(key=key, value=str(value)))
    db.commit()
    return get_settings(db)
