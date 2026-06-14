import logging
import numpy as np
from typing import Optional

logger = logging.getLogger(__name__)

_whisper_model = None
_whisper_device = None
_whisper_compute_type = None


def _load_model(model_size: str = "small", device: str = "auto", compute_type: str = "int8_float16"):
    global _whisper_model, _whisper_device, _whisper_compute_type

    if _whisper_model is not None and _whisper_device == device and _whisper_compute_type == compute_type:
        return _whisper_model

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise RuntimeError("faster-whisper is not installed. Run: pip install faster-whisper")

    if device == "auto":
        try:
            import torch
            if torch.cuda.is_available():
                device = "cuda"
                logger.info("ASR: Using CUDA GPU")
            else:
                device = "cpu"
                compute_type = "int8"
                logger.info("ASR: CUDA not available, falling back to CPU int8")
        except Exception:
            device = "cpu"
            compute_type = "int8"
            logger.info("ASR: torch not available, falling back to CPU int8")

    if device == "cuda" and compute_type == "int8_float16":
        try:
            import torch
            vram = torch.cuda.get_device_properties(0).total_mem / (1024**3)
            if vram < 6:
                logger.warning(f"ASR: GPU VRAM={vram:.1f}GB is low, using int8 instead")
                compute_type = "int8"
        except Exception:
            pass

    logger.info(f"ASR: Loading model={model_size} device={device} compute_type={compute_type}")
    try:
        _whisper_model = WhisperModel(model_size, device=device, compute_type=compute_type)
        _whisper_device = device
        _whisper_compute_type = compute_type
        logger.info("ASR: Model loaded successfully")
        return _whisper_model
    except Exception as e:
        logger.error(f"ASR: Failed to load model: {e}")
        if device == "cuda":
            logger.info("ASR: Retrying with CPU int8")
            try:
                _whisper_model = WhisperModel(model_size, device="cpu", compute_type="int8")
                _whisper_device = "cpu"
                _whisper_compute_type = "int8"
                return _whisper_model
            except Exception as e2:
                logger.error(f"ASR: CPU fallback also failed: {e2}")
                raise
        raise


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
    import time
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


def is_model_loaded() -> bool:
    return _whisper_model is not None


def get_model_info() -> dict:
    return {
        "loaded": _whisper_model is not None,
        "device": _whisper_device,
        "compute_type": _whisper_compute_type,
    }
