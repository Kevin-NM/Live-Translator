@echo off
cd /d "%~dp0"

echo ========================================
echo Live Translator Backend
echo ========================================

if not exist ".venv\Scripts\python.exe" (
    echo Creating virtual environment...
    py -3 -m venv .venv
)

echo.
echo Using Python:
".venv\Scripts\python.exe" -c "import sys; print(sys.executable)"

echo.
echo Installing requirements into backend .venv...
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt

echo.
echo Checking faster-whisper...
".venv\Scripts\python.exe" -c "from faster_whisper import WhisperModel; print('faster-whisper OK')" || (
    echo.
    echo ERROR: faster-whisper import failed in backend .venv
    echo Please check requirements.txt or run:
    echo ".venv\Scripts\python.exe" -m pip install faster-whisper
    pause
    exit /b 1
)

echo.
echo Starting Live Translator backend on http://127.0.0.1:8787 ...
".venv\Scripts\python.exe" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8787

pause