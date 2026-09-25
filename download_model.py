from pathlib import Path

from faster_whisper.utils import download_model


target = Path(__file__).resolve().parent / "models" / "faster-whisper-large-v3-turbo"
revision = "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf"
target.mkdir(parents=True, exist_ok=True)
print(f"Downloading to {target}")
download_model("dropbox-dash/faster-whisper-large-v3-turbo", output_dir=str(target), revision=revision)
for name in ("model.bin", "config.json", "tokenizer.json", "preprocessor_config.json", "vocabulary.json"):
    file = target / name
    if not file.exists() or file.stat().st_size == 0:
        raise SystemExit(f"Missing model file: {file}")
print(f"Ready: {target / 'model.bin'} ({(target / 'model.bin').stat().st_size / 1024**3:.2f} GiB)")
