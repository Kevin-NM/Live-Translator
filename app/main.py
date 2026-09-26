from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.stt import acquire_model, release_model, transcribe_pcm
from app.models import DEFAULT_MODEL, list_models, model_ready
from app.translation import PRESETS, TranslationConfig, translate


ROOT = Path(__file__).resolve().parent.parent
PROTOCOL_VERSION = 7
app = FastAPI(title="Live Translator")
app.mount("/static", StaticFiles(directory=ROOT / "web"), name="static")


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    direction: str
    style: str = ""
    translation: dict = Field(default_factory=dict)


@app.get("/")
async def index():
    return FileResponse(ROOT / "web" / "index.html")


@app.get("/api/status")
async def status():
    return {"version": "0.6.0", "model_ready": model_ready(DEFAULT_MODEL), "models": list_models(), "protocol_version": PROTOCOL_VERSION, "presets": {key: {"endpoint": value[0], "model": value[1]} for key, value in PRESETS.items()}}


@app.post("/api/translate")
async def translate_text(request: TranslateRequest):
    try:
        config = TranslationConfig.from_payload(request.translation)
        result = await translate(request.text, request.direction, config, request.style)
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"翻譯 API 失敗：{exc}") from exc
    return {"text": result}


@app.websocket("/ws/audio")
async def audio_socket(ws: WebSocket):
    origin = ws.headers.get("origin")
    parsed_origin = urlparse(origin) if origin else None
    if origin and parsed_origin.netloc != ws.headers.get("host") and parsed_origin.scheme != "chrome-extension":
        await ws.close(code=1008)
        return
    await ws.accept()
    send_lock = asyncio.Lock()
    translation_tasks: set[asyncio.Task] = set()
    leased = False
    model = None

    async def send(payload: dict):
        async with send_lock:
            await ws.send_json(payload)

    try:
        first = await ws.receive_text()
        settings = json.loads(first)
        config = TranslationConfig.from_payload(settings.get("translation", {}), require_key=False)
        recognition = settings.get("recognition", {})
        quality = recognition.get("quality", "accurate")
        if quality not in ("accurate", "fast"):
            raise ValueError("不支援的辨識模式")
        vocabulary = str(recognition.get("vocabulary", ""))[:500]
        segment_seconds = int(recognition.get("segment_seconds", 4))
        if segment_seconds not in (3, 4, 6):
            raise ValueError("辨識片段必須為 3、4 或 6 秒")
        previews = bool(recognition.get("previews", True))
        await send({"type": "status", "message": "載入本機 GPU 語音模型…"})
        loading = asyncio.create_task(asyncio.to_thread(acquire_model, recognition.get("model", DEFAULT_MODEL)))
        try:
            model = await asyncio.shield(loading)
        except asyncio.CancelledError:
            # Cancelling to_thread does not stop its native loader; collect and release its lease.
            try:
                await loading
            except Exception:
                pass
            else:
                await asyncio.to_thread(release_model)
            raise
        leased = True
        del loading
        await send({"type": "ready"})
    except WebSocketDisconnect:
        if leased:
            model = None
            await asyncio.to_thread(release_model)
        return
    except asyncio.CancelledError:
        if leased:
            model = None
            await asyncio.to_thread(release_model)
        raise
    except Exception as exc:
        if leased:
            model = None
            await asyncio.to_thread(release_model)
        await send({"type": "error", "message": str(exc)})
        await ws.close()
        return

    audio: list[np.ndarray] = []
    samples = 0
    silence = 0
    has_voice = False
    last_decode_samples = 0
    sequence = 0
    total_samples = 0
    utterance_start_sample = 0
    last_voice_sample = 0
    pre_roll = np.empty(0, dtype=np.float32)

    async def finalise():
        nonlocal audio, samples, silence, has_voice, last_decode_samples, sequence
        if has_voice and samples >= 8000:
            sequence += 1
            current = sequence
            combined = np.concatenate(audio)
            decode_started = time.perf_counter()
            result = await asyncio.to_thread(transcribe_pcm, combined, final=True, quality=quality, vocabulary=vocabulary, model=model)
            stt_ms = round((time.perf_counter() - decode_started) * 1000)
            if result:
                start_ms = round(utterance_start_sample / 16)
                end_ms = round(last_voice_sample / 16)
                await send({"type": "final", "id": current, "text": result, "start_ms": start_ms, "end_ms": end_ms, "stt_ms": stt_ms})
                if config.provider != "none" and not config.api_key and not config.endpoint.startswith(("http://localhost", "http://127.0.0.1")):
                    await send({"type": "translation_error", "id": current, "start_ms": start_ms, "end_ms": end_ms, "message": "請填入 API Key"})
                elif config.provider != "none":
                    async def do_translate(text: str, item_id: int, cue_start_ms: int, cue_end_ms: int, decoding_ms: int, accumulated_ms: int):
                        try:
                            translation_started = time.perf_counter()
                            output = await translate(text, "ja-zh", config)
                            translation_ms = round((time.perf_counter() - translation_started) * 1000)
                            await send({"type": "translation", "id": item_id, "start_ms": cue_start_ms, "end_ms": cue_end_ms, "text": output, "stt_ms": decoding_ms, "translation_ms": translation_ms, "required_delay_ms": accumulated_ms + decoding_ms + translation_ms})
                        except Exception as exc:
                            await send({"type": "translation_error", "id": item_id, "start_ms": cue_start_ms, "end_ms": cue_end_ms, "message": str(exc)})
                    task = asyncio.create_task(do_translate(result, current, start_ms, end_ms, stt_ms, round((total_samples - utterance_start_sample) / 16)))
                    translation_tasks.add(task)
                    task.add_done_callback(translation_tasks.discard)
        audio, samples, silence, has_voice, last_decode_samples = [], 0, 0, False, 0

    try:
        while True:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                break
            if message.get("text") is not None:
                try:
                    command = json.loads(message["text"])
                except json.JSONDecodeError:
                    await send({"type": "error", "message": "無效的指令"})
                    continue
                if command.get("type") == "eos":
                    await finalise()
                    if translation_tasks:
                        await asyncio.gather(*translation_tasks, return_exceptions=True)
                    break
                continue
            data = message.get("bytes")
            if not data:
                continue
            if len(data) % 2 or len(data) > 32000:
                await send({"type": "error", "message": "音訊必須是 16 kHz mono PCM16，單次最多 1 秒"})
                continue
            chunk = np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768.0
            total_samples += chunk.size
            rms = float(np.sqrt(np.mean(chunk * chunk)))
            voice = rms >= 0.012
            if not has_voice and not voice:
                pre_roll = np.concatenate((pre_roll, chunk))[-6400:]
                continue
            if not has_voice:
                utterance_start_sample = total_samples - chunk.size
                if pre_roll.size:
                    audio.append(pre_roll)
                    samples += pre_roll.size
                    pre_roll = np.empty(0, dtype=np.float32)
            if voice:
                last_voice_sample = total_samples
            has_voice = has_voice or voice
            audio.append(chunk)
            samples += chunk.size
            silence = 0 if voice else silence + chunk.size
            if previews and samples >= 25600 and samples - last_decode_samples >= 25600 and silence < 9600 and samples < segment_seconds * 16000:
                result = await asyncio.to_thread(transcribe_pcm, np.concatenate(audio), quality=quality, vocabulary=vocabulary, model=model)
                if result:
                    await send({"type": "partial", "text": result, "start_ms": round(utterance_start_sample / 16), "end_ms": round(total_samples / 16)})
                last_decode_samples = samples
            if silence >= 11200 or samples >= segment_seconds * 16000:
                await finalise()
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await send({"type": "error", "message": str(exc)})
        except Exception:
            pass
    finally:
        if leased:
            model = None
            await asyncio.to_thread(release_model)
        for task in translation_tasks:
            task.cancel()
        try:
            await ws.close()
        except Exception:
            pass
