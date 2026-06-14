from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class ProviderConfigBase(BaseModel):
    provider_name: str = Field(..., min_length=1)
    base_url: str = Field(..., min_length=1)
    api_key: str = Field(..., min_length=1)
    model: str = Field(..., min_length=1)
    enabled: bool = True
    priority: int = 0
    timeout_ms: int = Field(default=5000, ge=1000, le=60000)
    max_retries: int = Field(default=2, ge=0, le=5)
    temperature: float = Field(default=0.1, ge=0.0, le=2.0)
    max_tokens: int = Field(default=256, ge=1, le=4096)


class ProviderConfigCreate(ProviderConfigBase):
    pass


class ProviderConfigUpdate(BaseModel):
    provider_name: Optional[str] = None
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None
    enabled: Optional[bool] = None
    priority: Optional[int] = None
    timeout_ms: Optional[int] = None
    max_retries: Optional[int] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None


class ProviderConfigRead(ProviderConfigBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProviderTestRequest(BaseModel):
    pass


class ProviderTestResponse(BaseModel):
    status: str
    latency_ms: float
    model: str
    output: str
    error_message: Optional[str] = None


class TranslationTestRequest(BaseModel):
    provider_id: int
    source_text: Optional[str] = None
    source_language: Optional[str] = "ja"


class InjectTextRequest(BaseModel):
    source_language: str = "ja"
    source_text: str = Field(..., min_length=1)


class TranslationTestResponse(BaseModel):
    status: str
    latency_ms: float
    model: str
    provider_name: str
    source_text: str
    translated_text: str
    error_message: Optional[str] = None
    http_status: Optional[int] = None
    raw_response_preview: Optional[str] = None


class SessionCreate(BaseModel):
    title: str = Field(..., min_length=1)
    source_language: str = Field(default="auto")
    target_language: str = Field(default="zh-TW")
    translation_provider: Optional[str] = None


class ChromeTabSessionCreate(BaseModel):
    title: str = Field(..., min_length=1)
    source_url: Optional[str] = None
    source_name: Optional[str] = None
    source_language: str = Field(default="ja")
    target_language: str = Field(default="zh-TW")
    provider_id: Optional[int] = None


class SessionUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None


class SessionRead(BaseModel):
    id: int
    title: str
    source_type: Optional[str] = None
    source_name: Optional[str] = None
    source_url: Optional[str] = None
    source_language: str
    target_language: str
    asr_provider: Optional[str] = None
    translation_provider: Optional[str] = None
    provider_id: Optional[int] = None
    status: str
    started_at: Optional[datetime]
    ended_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SegmentRead(BaseModel):
    id: int
    session_id: int
    segment_index: int
    source_language: Optional[str]
    source_text: str
    translated_text: Optional[str]
    start_ms: Optional[int] = None
    end_ms: Optional[int] = None
    is_final: Optional[bool] = True
    confidence: Optional[float] = None
    asr_provider: Optional[str] = None
    translation_provider: Optional[str] = None
    model: Optional[str] = None
    latency_asr_ms: Optional[float] = None
    latency_translate_ms: Optional[float] = None
    status: str
    error_message: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TranslateRequest(BaseModel):
    source_text: str = Field(..., min_length=1)
    source_language: str = Field(default="auto")
    mode: str = Field(default="realtime", pattern="^(realtime|quality)$")


class TranslateResponse(BaseModel):
    segment_id: int
    source_text: str
    translated_text: str
    model: str
    provider: str
    latency_ms: float
    status: str
    error_message: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    version: str
    database: str
    db_path: Optional[str] = None


class AudioStatusResponse(BaseModel):
    connected: bool
    active_sessions: list[int]
    asr_model: Optional[str] = None
    asr_device: Optional[str] = None
    asr_loaded: bool = False


class LiveStartResponse(BaseModel):
    session_id: int
    status: str
    message: Optional[str] = None


class LiveStopResponse(BaseModel):
    session_id: int
    status: str


class SettingsRead(BaseModel):
    asr_model: str = "small"
    device: str = "auto"
    compute_type: str = "int8_float16"
    chunk_seconds: int = 3
    source_language: str = "ja"


class SettingsUpdate(BaseModel):
    asr_model: Optional[str] = None
    device: Optional[str] = None
    compute_type: Optional[str] = None
    chunk_seconds: Optional[int] = None
    source_language: Optional[str] = None


class LiveStatusResponse(BaseModel):
    session_id: int
    audio_ws_connected: bool = False
    last_audio_chunk_at: Optional[float] = None
    last_audio_chunk_bytes: int = 0
    chunks_received: int = 0
    last_decode_status: str = "pending"
    last_error: str = ""
