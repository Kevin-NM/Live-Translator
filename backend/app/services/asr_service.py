import logging
import time
import threading
import numpy as np
from typing import Optional

logger = logging.getLogger(__name__)

_MODEL_CACHE = {}
_MODEL_LOCK = threading.Lock()


def _get_cache_key(model_size: str, device: str, compute_type: str) -> str:
    return f"{model_size}:{device}:{compute_type}"


def _resolve_device(device: str, compute_type: str) -> tuple[str, str]:
    if device == "auto":
        try:
            import torch
            if torch.cuda.is_available():
                logger.info("ASR: Using CUDA GPU")
                return "cuda", compute_type
            else:
                logger.info("ASR: CUDA not available, falling back to CPU int8")
                return "cpu", "int8"
        except Exception:
            logger.info("ASR: torch not available, falling back to CPU int8")
            return "cpu", "int8"

    if device == "cuda" and compute_type == "int8_float16":
        try:
            import torch
            vram = torch.cuda.get_device_properties(0).total_mem / (1024**3)
            if vram < 6:
                logger.warning(f"ASR: GPU VRAM={vram:.1f}GB is low, using int8 instead")
                compute_type = "int8"
        except Exception:
            pass

    return device, compute_type


def _load_model(model_size: str = "small", device: str = "auto", compute_type: str = "int8_float16"):
    device, compute_type = _resolve_device(device, compute_type)
    key = _get_cache_key(model_size, device, compute_type)

    with _MODEL_LOCK:
        if key in _MODEL_CACHE:
            logger.debug(f"ASR: using cached model={key}")
            return _MODEL_CACHE[key]

        try:
            from faster_whisper import WhisperModel
        except ImportError as e:
            missing = str(e).split("'")[-2] if "'" in str(e) else str(e)
            raise RuntimeError(
                f"ASR dependency import failed: {missing}. "
                f"Please run: .venv\\Scripts\\python.exe -m pip install -r requirements.txt"
            )

        logger.info(f"ASR: Loading model={model_size} device={device} compute_type={compute_type}")
        load_start = time.monotonic()

        try:
            model = WhisperModel(model_size, device=device, compute_type=compute_type)
        except Exception as e:
            logger.error(f"ASR: Failed to load model: {e}")
            if device == "cuda":
                logger.info("ASR: Retrying with CPU int8")
                device, compute_type = "cpu", "int8"
                key = _get_cache_key(model_size, device, compute_type)
                if key in _MODEL_CACHE:
                    return _MODEL_CACHE[key]
                model = WhisperModel(model_size, device="cpu", compute_type="int8")
            else:
                raise

        load_ms = (time.monotonic() - load_start) * 1000
        _MODEL_CACHE[key] = model
        logger.info(f"ASR: Model loaded and cached key={key} load_latency_ms={load_ms:.0f}")
        return model


class ASRResult:
    def __init__(self, text: str, language: str, confidence: float,
                 start_ms: int, end_ms: int, latency_ms: float):
        self.text = text
        self.language = language
        self.confidence = confidence
        self.start_ms = start_ms
        self.end_ms = end_ms
        self.latency_ms = latency_ms


def transcribe_audio(
    audio_data: np.ndarray,
    sample_rate: int = 16000,
    language: Optional[str] = None,
    model_size: str = "small",
    device: str = "auto",
    compute_type: str = "int8_float16",
    chunk_start_ms: int = 0,
) -> list[ASRResult]:
    start_time = time.monotonic()

    model = _load_model(model_size, device, compute_type)

    if audio_data.dtype != np.float32:
        audio_data = audio_data.astype(np.float32)

    if np.max(np.abs(audio_data)) > 1.0:
        audio_data = audio_data / 32768.0

    lang = None if language in ("auto", None) else language

    try:
        segments_iter, info = model.transcribe(
            audio_data,
            language=lang,
            beam_size=5,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500, speech_pad_ms=200),
        )

        latency_ms = (time.monotonic() - start_time) * 1000
        detected_lang = info.language if info.language else (language or "en")

        results = []
        for seg in segments_iter:
            text = seg.text.strip()
            if not text or len(text) < 2:
                continue
            results.append(ASRResult(
                text=text,
                language=detected_lang,
                confidence=seg.avg_logprob if hasattr(seg, 'avg_logprob') else 0.0,
                start_ms=chunk_start_ms + int(seg.start * 1000),
                end_ms=chunk_start_ms + int(seg.end * 1000),
                latency_ms=latency_ms,
            ))

        return results

    except Exception as e:
        logger.error(f"ASR transcription failed: {e}")
        return []


def preload_model(model_size: str = "small", device: str = "auto", compute_type: str = "int8_float16") -> dict:
    start_time = time.monotonic()
    try:
        device, compute_type = _resolve_device(device, compute_type)
        key = _get_cache_key(model_size, device, compute_type)
        already_cached = key in _MODEL_CACHE
        _load_model(model_size, device, compute_type)
        latency_ms = (time.monotonic() - start_time) * 1000
        return {
            "status": "ok",
            "model": model_size,
            "device": device,
            "compute_type": compute_type,
            "cached": already_cached,
            "load_latency_ms": round(latency_ms, 2),
            "error_message": None,
        }
    except Exception as e:
        latency_ms = (time.monotonic() - start_time) * 1000
        return {
            "status": "error",
            "model": model_size,
            "device": device,
            "compute_type": compute_type,
            "cached": False,
            "load_latency_ms": round(latency_ms, 2),
            "error_message": str(e),
        }


def is_model_loaded() -> bool:
    return len(_MODEL_CACHE) > 0


def get_model_info() -> dict:
    keys = list(_MODEL_CACHE.keys())
    if keys:
        parts = keys[-1].split(":")
        return {
            "loaded": True,
            "model": parts[0] if len(parts) > 0 else None,
            "device": parts[1] if len(parts) > 1 else None,
            "compute_type": parts[2] if len(parts) > 2 else None,
            "cached_keys": keys,
        }
    return {"loaded": False, "device": None, "compute_type": None, "cached_keys": []}
