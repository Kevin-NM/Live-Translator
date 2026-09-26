from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MODEL = "large-v3-turbo"
MODELS = {
    "large-v3-turbo": {"label": "Large v3 Turbo · 速度與品質平衡", "repo": "dropbox-dash/faster-whisper-large-v3-turbo", "revision": "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf"},
    "large-v3": {"label": "Large v3 · 完整模型，較慢", "repo": "Systran/faster-whisper-large-v3"},
    "medium": {"label": "Medium · 較低 GPU 用量", "repo": "Systran/faster-whisper-medium"},
    "small": {"label": "Small · 輕量模型", "repo": "Systran/faster-whisper-small"},
}
REQUIRED_FILES = ("model.bin", "config.json", "tokenizer.json")

def model_dir(model_id: str) -> Path:
    if model_id not in MODELS:
        raise ValueError("不支援的本機模型")
    return ROOT / "models" / f"faster-whisper-{model_id}"

def model_ready(model_id: str) -> bool:
    directory = model_dir(model_id)
    return all((directory / name).is_file() and (directory / name).stat().st_size > 0 for name in REQUIRED_FILES)

def list_models() -> list[dict]:
    return [{"id": key, "label": value["label"], "ready": model_ready(key), "download_command": f".\\.venv\\Scripts\\python.exe download_model.py --model {key}"} for key, value in MODELS.items()]
