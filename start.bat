@echo off
cd /d "%~dp0"

echo ========================================
echo  Live Translator - Starting...
echo ========================================

echo.
echo [1/2] Starting Backend (port 8787)...
start "Live Translator Backend" cmd /k "cd /d "%~dp0backend" && .venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8787"

timeout /t 3 /nobreak >nul

echo [2/2] Starting Frontend (port 5173)...
start "Live Translator Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo ========================================
echo  Backend:  http://127.0.0.1:8787
echo  Frontend: http://localhost:5173
echo  API Docs: http://127.0.0.1:8787/docs
echo ========================================
echo.
echo  Chrome Extension:
echo    1. Open chrome://extensions/
echo    2. Enable Developer mode
echo    3. Click Load unpacked
echo    4. Select the chrome-extension folder
echo ========================================
echo.
echo Close this window to stop (backend/frontend run in their own windows).
pause
