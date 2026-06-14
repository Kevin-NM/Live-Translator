import asyncio
import base64
import json
import logging
import re
import time
from dataclasses import dataclass
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.services.ws_manager import ws_manager
from app.services.audio_pipeline import audio_pipeline
from app.services.asr_service import transcribe_audio
from app.services.translation_pipeline import translation_pipeline, TranslationJob
from app.database import SessionLocal
from app import crud

logger = logging.getLogger(__name__)
router = APIRouter()

STALE_THRESHOLD_SECONDS = 30.0


@dataclass
class LiveSessionStats:
    audio_ws_connected: bool = False
    audio_status: str = "idle"
    chunks_received: int = 0
    last_audio_chunk_at: float = 0.0
    last_audio_chunk_bytes: int = 0
    last_decode_status: str = "idle"
    last_error: str = ""
    last_disconnect_time: float = 0.0
    last_format: str = ""
    last_sample_rate: int = 0
    last_channels: int = 0
    pcm_duration_buffered: float = 0.0
    capture_id: str = ""


_live_stats: dict[int, LiveSessionStats] = {}


def get_live_stats(session_id: int) -> LiveSessionStats:
    if session_id not in _live_stats:
        _live_stats[session_id] = LiveSessionStats()
    return _live_stats[session_id]


def remove_live_stats(session_id: int):
    _live_stats.pop(session_id, None)


def reset_live_stats(session_id: int):
    _live_stats[session_id] = LiveSessionStats()


@router.websocket("/ws/audio/{session_id}")
async def ws_audio(ws: WebSocket, session_id: int):
    logger.info(f"Audio WS incoming connection: session={session_id}")
    await ws_manager.connect_audio(ws, session_id)

    stats = get_live_stats(session_id)
    stats.audio_ws_connected = True
    stats.audio_status = "connected"
    stats.last_error = ""
    stats.last_decode_status = "connected"
    logger.info(f"Audio WS connected: session={session_id}")

    settings = {}
    db = SessionLocal()
    try:
        settings = crud.get_settings(db)
    finally:
        db.close()

    chunk_sec = float(settings.get("chunk_seconds", "3"))
    audio_pipeline.configure(chunk_seconds=chunk_sec, sample_rate=16000)

    try:
        while True:
            raw = await ws.receive_text()

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError as e:
                stats.last_error = f"Invalid JSON: {e}"
                continue

            msg_type = msg.get("type", "")

            if msg_type == "audio_chunk":
                b64_data = msg.get("data", "")
                fmt = msg.get("format", "pcm_s16le")
                source_rate = msg.get("sample_rate", 48000)
                channels = msg.get("channels", 1)
                chunk_capture_id = msg.get("capture_id", "")

                if chunk_capture_id and stats.capture_id and chunk_capture_id != stats.capture_id:
                    logger.warning(f"Audio chunk from stale capture_id={chunk_capture_id}, expected={stats.capture_id}")
                    continue

                if chunk_capture_id and not stats.capture_id:
                    stats.capture_id = chunk_capture_id

                try:
                    audio_bytes = base64.b64decode(b64_data)
                except Exception as e:
                    stats.last_error = f"base64 decode: {e}"
                    stats.last_decode_status = "error"
                    continue

                stats.chunks_received += 1
                stats.last_audio_chunk_at = time.time()
                stats.last_audio_chunk_bytes = len(audio_bytes)
                stats.last_format = fmt
                stats.last_sample_rate = source_rate
                stats.last_channels = channels

                if fmt == "pcm_s16le":
                    chunk = await audio_pipeline.process_pcm_s16le(
                        session_id, audio_bytes, source_rate, channels
                    )
                elif fmt == "pcm_f32le":
                    chunk = await audio_pipeline.process_pcm_f32le(
                        session_id, audio_bytes, source_rate, channels
                    )
                else:
                    stats.last_error = f"Unknown format: {fmt}"
                    stats.last_decode_status = "error"
                    continue

                buf_info = audio_pipeline.get_buffer_info(session_id)
                stats.pcm_duration_buffered = buf_info.get("buffered_seconds", 0)

                if chunk is None:
                    stats.last_decode_status = "buffering"
                    continue

                stats.last_decode_status = "ok"
                asyncio.create_task(_process_asr_chunk(session_id, chunk, settings))

            elif msg_type == "stop":
                logger.info(f"Audio WS received stop command for session={session_id}")
                chunk = await audio_pipeline.flush_session(session_id)
                if chunk is not None and len(chunk) > 0:
                    asyncio.create_task(_process_asr_chunk(session_id, chunk, settings))
                break

    except WebSocketDisconnect as e:
        logger.info(f"Audio WS disconnected: session={session_id}, code={e.code}")
    except Exception as e:
        logger.error(f"Audio WS error: session={session_id}, error={e}", exc_info=True)
        stats.last_error = str(e)
    finally:
        stats.audio_ws_connected = False
        stats.audio_status = "disconnected"
        stats.last_disconnect_time = time.time()
        stats.last_decode_status = "disconnected"
        stats.pcm_duration_buffered = 0
        ws_manager.disconnect_audio(session_id)
        audio_pipeline.remove_buffer(session_id)
        logger.info(f"Audio WS cleanup: session={session_id}, chunks={stats.chunks_received}")


async def _process_asr_chunk(session_id: int, chunk, settings: dict):
    try:
        results = transcribe_audio(
            audio_data=chunk,
            sample_rate=16000,
            language=settings.get("source_language", "ja"),
            model_size=settings.get("asr_model", "small"),
            device=settings.get("device", "auto"),
            compute_type=settings.get("compute_type", "int8_float16"),
        )

        if not results:
            return

        db = SessionLocal()
        try:
            from app.models import Segment
            for asr_result in results:
                text = asr_result.text.strip()
                if not text or len(text) < 2:
                    continue

                session = crud.get_session(db, session_id)
                if not session or session.status != "active":
                    return

                last_seg = db.query(Segment).filter(
                    Segment.session_id == session_id,
                    Segment.is_final == True,
                ).order_by(Segment.segment_index.desc()).first()

                if last_seg and last_seg.source_text.strip() == text:
                    continue

                segment_index = crud.get_next_segment_index(db, session_id)
                segment = crud.create_segment(
                    db, session_id, segment_index,
                    source_language=asr_result.language,
                    source_text=text,
                    start_ms=asr_result.start_ms,
                    end_ms=asr_result.end_ms,
                    is_final=True,
                    confidence=asr_result.confidence,
                    asr_provider="faster-whisper",
                    latency_asr_ms=asr_result.latency_ms,
                )

                await ws_manager.broadcast_live(session_id, {
                    "type": "final",
                    "session_id": session_id,
                    "segment_id": segment.id,
                    "source_language": asr_result.language,
                    "source_text": text,
                    "translated_text": None,
                    "start_ms": asr_result.start_ms,
                    "end_ms": asr_result.end_ms,
                    "latency_asr_ms": round(asr_result.latency_ms, 2),
                    "latency_translate_ms": None,
                    "status": "queued",
                })

                await translation_pipeline.submit(TranslationJob(
                    session_id=session_id,
                    segment_id=segment.id,
                    source_text=text,
                    source_language=asr_result.language,
                    mode="realtime",
                ))

        finally:
            db.close()

    except Exception as e:
        logger.error(f"ASR processing error: {e}", exc_info=True)
        await ws_manager.broadcast_live(session_id, {
            "type": "error",
            "session_id": session_id,
            "error": str(e),
        })


@router.websocket("/ws/live/{session_id}")
async def ws_live(ws: WebSocket, session_id: int):
    logger.info(f"Live WS connected: session={session_id}")
    await ws_manager.connect_live(ws, session_id)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        ws_manager.disconnect_live(ws, session_id)
