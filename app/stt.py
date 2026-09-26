from __future__ import annotations

from pathlib import Path
from threading import RLock

import numpy as np
from faster_whisper import WhisperModel


from app.models import DEFAULT_MODEL, model_dir, model_ready
from app.languages import whisper_language

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = model_dir(DEFAULT_MODEL)
_model: WhisperModel | None = None
_model_id = None
_leases = 0
_lock = RLock()


def get_model(model_id: str = DEFAULT_MODEL) -> WhisperModel:
    global _model, _model_id
    with _lock:
        directory = model_dir(model_id)
        if _leases and _model_id != model_id:
            raise RuntimeError("其他擷取正在使用不同模型，請先停止所有擷取再更換模型")
        if _model_id != model_id:
            if not model_ready(model_id):
                raise RuntimeError(f"模型尚未下載，請執行 download_model.py --model {model_id}")
            if _model is not None:
                _model.model.unload_model()
            _model = None
            _model_id = None
        if _model is None:
            try:
                _model = WhisperModel(str(directory), device="cuda", compute_type="float16", local_files_only=True)
                _model_id = model_id
            except Exception as exc:
                raise RuntimeError(f"GPU 模型載入失敗。請檢查 CUDA 12 cuBLAS / cuDNN 9：{exc}") from exc
        return _model


def acquire_model(model_id: str = DEFAULT_MODEL) -> WhisperModel:
    global _leases
    with _lock:
        model = get_model(model_id)
        _leases += 1
        return model


def release_model() -> None:
    global _leases
    with _lock:
        _leases = max(0, _leases - 1)


def transcribe_pcm(audio: np.ndarray, *, final: bool = False, quality: str = "accurate", vocabulary: str = "", model=None, language="ja", with_language=False):
    if audio.size < 8000:
        return ""
    with _lock:
        return _decode(audio, final=final, quality=quality, vocabulary=vocabulary, model=model or get_model(), language=language, with_language=with_language)


def _decode(audio, *, final, quality, vocabulary, model, language, with_language):
    segments, info = model.transcribe(
        audio.astype(np.float32, copy=False),
        language=whisper_language(language),
        task="transcribe",
        beam_size=5 if final and quality == "accurate" else 1,
        temperature=0,
        initial_prompt=vocabulary.strip()[:500] or None,
        condition_on_previous_text=False,
        vad_filter=final and quality == "accurate",
        vad_parameters={"min_silence_duration_ms": 700, "speech_pad_ms": 300},
        without_timestamps=True,
    )
    text = "".join(segment.text for segment in segments).strip()
    return (text, getattr(info, "language", None)) if with_language else text
