import argparse
import threading
import time
import webbrowser

import uvicorn


parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=8788)
parser.add_argument("--no-browser", action="store_true")
args = parser.parse_args()
server = uvicorn.Server(uvicorn.Config("app.main:app", host="127.0.0.1", port=args.port))


def open_browser_when_ready():
    while not server.started and not server.should_exit:
        time.sleep(0.1)
    if server.started:
        webbrowser.open(f"http://127.0.0.1:{args.port}")


if not args.no_browser:
    threading.Thread(target=open_browser_when_ready, daemon=True).start()
server.run()
