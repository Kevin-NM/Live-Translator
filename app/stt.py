from __future__ import annotations

from pathlib import Path
from threading import Lock

import numpy as np
from faster_whisper import WhisperModel


ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = ROOT / "models" / "faster-whisper-large-v3-turbo"
_model: WhisperModel | None = None
_lock = Lock()


def get_model() -> WhisperModel:
    global _model
    with _lock:
        if _model is None:
            if not (MODEL_DIR / "model.bin").exists():
                raise RuntimeError(f"找不到模型：{MODEL_DIR}。請先執行 download_model.py")
            try:
                _model = WhisperModel(str(MODEL_DIR), device="cuda", compute_type="float16", local_files_only=True)
            except Exception as exc:
                raise RuntimeError(f"GPU 模型載入失敗。請檢查 CUDA 12 cuBLAS / cuDNN 9：{exc}") from exc
        return _model


def transcribe_pcm(audio: np.ndarray) -> str:
    if audio.size < 8000:
        return ""
    segments, _ = get_model().transcribe(
        audio.astype(np.float32, copy=False),
        language="ja",
        task="transcribe",
        beam_size=1,
        condition_on_previous_text=False,
        vad_filter=False,
        without_timestamps=True,
    )
    return "".join(segment.text for segment in segments).strip()
