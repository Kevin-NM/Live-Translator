# Development

Python 3.10+ and Node.js 22+ are used for development. Production only needs Python and desktop Chrome.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe build_ui.py
.\.venv\Scripts\python.exe -m unittest discover -s tests
node tests/extension.test.cjs
node tests/client.test.cjs
```

The shared UI source is `chrome-extension/panel.html`, `panel.css`, `panel.js`. Run `python build_ui.py` after edits. `web/platform.js` captures browser audio; `chrome-extension/platform.js` uses Chrome APIs. CI checks generated files for drift.

Backend tests use mocked inference and HTTP transports; they do not require a GPU or API key. Real audio accuracy, latency and YouTube playback must be checked separately with a GPU and the chosen API.

Model IDs and download repositories are allowlisted in `app/models.py`. Audio sessions lease the selected model. Inference consumes segment generators under the same lock that protects model switching. Lock waits and native loads run off the event loop. Never log or commit API keys, captured audio or browser settings.

Record meaningful changes in `work_report/`, describe verification and remaining work, and create an appropriate Git commit.

Languages live in `app/languages.py`; UI language choices must stay consistent with it. Japanese remains the migration default. Auto detection obtains the final Whisper language and uses it for the live API prompt; comment translation requires an explicit source for specialized Riva models.

`app/transcripts.py` stores whole sessions in local SQLite, including independent final translation updates and playback anchors. Tests must use temporary databases and patch `app.main.transcripts`, never write fixtures into user recordings. The UI retains only 50 rows; storage must retain all cues. Export uses source media time, not delayed playback wall time. Web capture requires a manual origin because browser tab sharing does not expose the source player clock. ASS text neutralizes override syntax, and downloads include UTF-8 BOM for Windows editors.

Do not publish `data/`, API settings or audio fixtures. Verify exported timestamps and Unicode independently with a subtitle parser when changing formatting. Browser extension management is a user-operated step when browser tooling forbids it; do not bypass the restriction.
