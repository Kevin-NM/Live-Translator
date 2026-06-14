import asyncio
import base64
import json
import logging
import time
from dataclasses import dataclass, field
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.services.ws_manager import ws_manager
from app.services.audio_pipeline import audio_pipeline
from app.services.asr_service import transcribe_audio, get_model_info
from app.services.translation_pipeline import translation_pipeline, TranslationJob
from app.database import SessionLocal
from app import crud

logger = logging.getLogger(__name__)
router = APIRouter()


@dataclass
class LiveSessionStats:
    audio_ws_connected: bool = False
    chunks_received: int = 0
    last_audio_chunk_at: float = 0.0
    last_audio_chunk_bytes: int = 0
    last_decode_status: str = "pending"
    last_error: str = ""
    session_active: bool = True
    last_format: str = ""
    last_sample_rate: int = 0
    last_channels: int = 0
    pcm_duration_buffered: float = 0.0


_live_stats: dict[int, LiveSessionStats] = {}


def get_live_stats(session_id: int) -> LiveSessionStats:
    if session_id not in _live_stats:
        _live_stats[session_id] = LiveSessionStats()
    return _live_stats[session_id]


def remove_live_stats(session_id: int):
    _live_stats.pop(session_id, None)


@router.websocket("/ws/audio/{session_id}")
async def ws_audio(ws: WebSocket, session_id: int):
    logger.info(f"Audio WS incoming connection: session={session_id}")
    await ws_manager.connect_audio(ws, session_id)

    stats = get_live_stats(session_id)
    stats.audio_ws_connected = True
    stats.last_error = ""
    logger.info(f"Audio WS connected: session={session_id}")

    settings = {}
    db = SessionLocal()
    try:
        settings = crud.get_settings(db)
    finally:
        db.close()

    chunk_sec = float(settings.get("chunk_seconds", "3"))
    audio_pipeline.configure(chunk_seconds=chunk_sec, sample_rate=16000)
    logger.info(f"Audio pipeline configured: chunk_seconds={chunk_sec}")

    try:
        while True:
            raw = await ws.receive_text()
            logger.debug(f"Audio WS received raw message, length={len(raw)}")

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError as e:
                logger.warning(f"Audio WS invalid JSON: {e}")
                stats.last_error = f"Invalid JSON: {e}"
                continue

            msg_type = msg.get("type", "")
            logger.debug(f"Audio WS message type={msg_type}")

            if msg_type == "audio_chunk":
                b64_data = msg.get("data", "")
                fmt = msg.get("format", "pcm_s16le")
                source_rate = msg.get("sample_rate", 48000)
                channels = msg.get("channels", 1)
                timestamp_ms = msg.get("timestamp_ms", 0)

                logger.info(
                    f"received audio_chunk: format={fmt} sample_rate={source_rate} "
                    f"channels={channels} base64_length={len(b64_data)}"
                )

                try:
                    audio_bytes = base64.b64decode(b64_data)
                except Exception as e:
                    logger.error(f"base64 decode failed: {e}")
                    stats.last_error = f"base64 decode: {e}"
                    stats.last_decode_status = "error"
                    continue

                logger.info(f"decoded audio bytes length={len(audio_bytes)}")
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
                    logger.warning(f"Unknown audio format: {fmt}")
                    stats.last_error = f"Unknown format: {fmt}"
                    stats.last_decode_status = "error"
                    continue

                buf_info = audio_pipeline.get_buffer_info(session_id)
                stats.pcm_duration_buffered = buf_info.get("buffered_seconds", 0)
                logger.info(f"Buffer: {buf_info}")

                if chunk is None:
                    logger.debug("audio_pipeline returned None (buffering)")
                    stats.last_decode_status = "buffering"
                    continue

                logger.info(f"ASR chunk ready: {len(chunk)} samples ({len(chunk)/16000:.1f}s)")
                stats.last_decode_status = "ok"

                asyncio.create_task(_process_asr_chunk(session_id, chunk, settings))

            elif msg_type == "stop":
                logger.info(f"Audio WS received stop command for session={session_id}")
                chunk = await audio_pipeline.flush_session(session_id)
                if chunk is not None and len(chunk) > 0:
                    logger.info(f"Flushed remaining audio: {len(chunk)} samples")
                    asyncio.create_task(_process_asr_chunk(session_id, chunk, settings))
                break

            else:
                logger.warning(f"Audio WS unknown message type: {msg_type}")

    except WebSocketDisconnect as e:
        logger.info(f"Audio WS disconnected: session={session_id}, code={e.code}")
    except Exception as e:
        logger.error(f"Audio WS error: session={session_id}, error={e}", exc_info=True)
        stats.last_error = str(e)
    finally:
        stats.audio_ws_connected = False
        ws_manager.disconnect_audio(session_id)
        audio_pipeline.remove_buffer(session_id)
        logger.info(f"Audio WS cleanup done: session={session_id}, total_chunks_received={stats.chunks_received}")


async def _process_asr_chunk(session_id: int, chunk, settings: dict):
    try:
        logger.info(f"ASR processing: session={session_id}, samples={len(chunk)}")
        results = transcribe_audio(
            audio_data=chunk,
            sample_rate=16000,
            language=settings.get("source_language", "ja"),
            model_size=settings.get("asr_model", "small"),
            device=settings.get("device", "auto"),
            compute_type=settings.get("compute_type", "int8_float16"),
        )

        if not results:
            logger.debug(f"ASR returned no results for session={session_id}")
            return

        logger.info(f"ASR returned {len(results)} segments for session={session_id}")

        db = SessionLocal()
        try:
            from app.models import Segment
            for asr_result in results:
                text = asr_result.text.strip()
                if not text or len(text) < 2:
                    logger.debug(f"ASR segment too short, skipping: '{text}'")
                    continue

                session = crud.get_session(db, session_id)
                if not session or session.status != "active":
                    logger.info(f"Session {session_id} no longer active, stopping ASR")
                    return

                last_seg = db.query(Segment).filter(
                    Segment.session_id == session_id,
                    Segment.is_final == True,
                ).order_by(Segment.segment_index.desc()).first()

                if last_seg and last_seg.source_text.strip() == text:
                    logger.debug(f"ASR duplicate detected, skipping: '{text[:50]}'")
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

                logger.info(f"Segment created: id={segment.id}, text='{text[:50]}'")

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
                    "status": "asr_done",
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
    except Exception as e:
        logger.error(f"Live WS error: {e}")
    finally:
        ws_manager.disconnect_live(ws, session_id)
        logger.info(f"Live WS disconnected: session={session_id}")
