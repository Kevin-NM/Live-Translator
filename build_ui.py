"""The extension owns the shared UI; ship reproducible standalone Web assets."""
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def build(check=False):
    mapping = {"panel.html": "index.html", "panel.css": "panel.css", "panel.js": "panel.js", "audio-worklet.js": "audio-worklet.js"}
    for source, target in mapping.items():
        data = (ROOT / "chrome-extension" / source).read_text(encoding="utf-8")
        if source == "panel.html":
            for asset in ("panel.css", "platform.js", "panel.js"):
                data = data.replace(f'"{asset}"', f'"/static/{asset}"')
        path = ROOT / "web" / target
        if check:
            if not path.exists() or path.read_text(encoding="utf-8") != data:
                raise SystemExit(f"Out of date: {path.name}. Run python build_ui.py")
        else:
            path.write_text(data, encoding="utf-8")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    build(parser.parse_args().check)
