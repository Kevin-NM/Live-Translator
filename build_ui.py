"""Build shared UI with deterministic content versions for browser assets."""
import argparse
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def build(check=False):
    mapping = {"panel.html": "index.html", "panel.css": "panel.css", "panel.js": "panel.js", "audio-worklet.js": "audio-worklet.js", "caption-transport.js":"caption-transport.js", "caption-ui.js":"caption-ui.js"}
    assets = {target: (ROOT / "chrome-extension" / source).read_text(encoding="utf-8")
              for source, target in mapping.items()}
    for name in ("platform.js",):
        assets[name] = (ROOT / "web" / name).read_text(encoding="utf-8")
    html = assets["index.html"]
    for name in ("panel.css", "caption-transport.js", "caption-ui.js", "platform.js", "panel.js"):
        html = html.replace(f'"{name}"', f'"/static/{name}"')
    def version(match):
        name = match.group(1)
        digest = hashlib.sha256(assets[name].encode("utf-8")).hexdigest()[:16]
        return f'"/static/{name}?v={digest}"'
    assets["index.html"] = re.sub(r'"/static/([^"?]+)"', version, html)
    # Read_text normalizes newlines; emit LF bytes on all platforms before hashing.
    # Standalone Web scripts are also normalized so Windows and Linux builds agree.
    for name, data in assets.items():
        path = ROOT / "web" / name
        encoded = data.encode("utf-8")
        if check:
            if not path.exists() or path.read_bytes() != encoded:
                raise SystemExit(f"Out of date: {path.name}. Run python build_ui.py")
        else:
            path.write_bytes(encoded)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    build(parser.parse_args().check)
