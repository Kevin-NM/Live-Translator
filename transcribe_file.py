import argparse

from app.stt import get_model
from app.models import DEFAULT_MODEL, MODELS
from app.languages import LANGUAGES, whisper_language


parser = argparse.ArgumentParser(description="用專案內的 GPU 模型辨識多語音訊")
parser.add_argument("audio", help="音訊檔案路徑，例如 WAV、MP3")
parser.add_argument("--model", choices=MODELS, default=DEFAULT_MODEL)
parser.add_argument("--language", choices=[*LANGUAGES,'auto'], default='ja')
args = parser.parse_args()
segments, _ = get_model(args.model).transcribe(
    args.audio,
    language=whisper_language(args.language),
    beam_size=1,
    condition_on_previous_text=False,
)
for segment in segments:
    print(f"[{segment.start:.1f}–{segment.end:.1f}] {segment.text.strip()}")
