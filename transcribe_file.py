import argparse

from app.stt import get_model


parser = argparse.ArgumentParser(description="用專案內的 GPU 模型辨識日文音訊")
parser.add_argument("audio", help="音訊檔案路徑，例如 WAV、MP3")
args = parser.parse_args()
segments, _ = get_model().transcribe(
    args.audio,
    language="ja",
    beam_size=1,
    condition_on_previous_text=False,
)
for segment in segments:
    print(f"[{segment.start:.1f}–{segment.end:.1f}] {segment.text.strip()}")
