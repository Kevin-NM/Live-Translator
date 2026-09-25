@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Python environment missing. Run setup.ps1 first.
  pause
  exit /b 1
)
if not exist "models\faster-whisper-large-v3-turbo\model.bin" (
  echo Speech model missing. Run .venv\Scripts\python.exe download_model.py first.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" run.py
pause
