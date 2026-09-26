import argparse

from faster_whisper.utils import download_model
from app.models import DEFAULT_MODEL, MODELS, model_dir, model_ready


def main():
    parser = argparse.ArgumentParser(description="下載本機 STT 模型到專案 models 資料夾")
    parser.add_argument("--model", choices=MODELS, default=DEFAULT_MODEL)
    args = parser.parse_args()
    entry = MODELS[args.model]
    target = model_dir(args.model)
    target.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {args.model} to {target}")
    kwargs = {"revision": entry["revision"]} if "revision" in entry else {}
    download_model(entry["repo"], output_dir=str(target), **kwargs)
    if not model_ready(args.model):
        raise SystemExit("下載未完成，請重新執行同一指令")
    print(f"Ready: {target}")

if __name__ == "__main__":
    main()
