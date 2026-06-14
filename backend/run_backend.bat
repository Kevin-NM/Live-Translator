@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\activate" (
    echo Creating virtual environment...
    python -m venv .venv
)
call .venv\Scripts\activate
pip install -r requirements.txt
echo Starting Live Translator backend on http://127.0.0.1:8787 ...
uvicorn app.main:app --reload --host 127.0.0.1 --port 8787
pause
