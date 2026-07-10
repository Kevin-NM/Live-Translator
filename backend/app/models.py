from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.database import Base

# Reserved capture sources for future caption-first fallbacks. Only manual and
# chrome_tab are implemented today; the others intentionally remain design stubs.
SOURCE_TYPES = ("manual", "chrome_tab_audio", "youtube_caption_dom", "browser_speech_api", "windows_live_captions")


class Session(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    source_type = Column(String, default="manual")
    source_name = Column(String, nullable=True)
    source_url = Column(String, nullable=True)
    source_language = Column(String, default="auto")
    target_language = Column(String, default="zh-TW")
    asr_provider = Column(String, nullable=True)
    translation_provider = Column(String, nullable=True)
    provider_id = Column(Integer, ForeignKey("provider_configs.id"), nullable=True)
    status = Column(String, default="active")
    started_at = Column(DateTime, default=datetime.utcnow)
    ended_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    segments = relationship("Segment", back_populates="session", cascade="all, delete-orphan")


class Segment(Base):
    __tablename__ = "segments"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    segment_index = Column(Integer, nullable=False)
    source_language = Column(String, nullable=True)
    source_text = Column(Text, nullable=False)
    translated_text = Column(Text, nullable=True)
    start_ms = Column(Integer, nullable=True)
    end_ms = Column(Integer, nullable=True)
    is_final = Column(Boolean, default=True)
    confidence = Column(Float, nullable=True)
    asr_provider = Column(String, nullable=True)
    translation_provider = Column(String, nullable=True)
    model = Column(String, nullable=True)
    latency_asr_ms = Column(Float, nullable=True)
    latency_translate_ms = Column(Float, nullable=True)
    status = Column(String, default="pending")
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    session = relationship("Session", back_populates="segments")


class ProviderConfig(Base):
    __tablename__ = "provider_configs"

    id = Column(Integer, primary_key=True, index=True)
    provider_name = Column(String, nullable=False)
    base_url = Column(String, nullable=False)
    api_key = Column(String, nullable=False)
    model = Column(String, nullable=False)
    enabled = Column(Boolean, default=True)
    priority = Column(Integer, default=0)
    timeout_ms = Column(Integer, default=5000)
    max_retries = Column(Integer, default=2)
    temperature = Column(Float, default=0.1)
    max_tokens = Column(Integer, default=256)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Setting(Base):
    __tablename__ = "settings"

    key = Column(String, primary_key=True)
    value = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
