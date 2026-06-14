@echo off
cd /d "%~dp0"
if not exist "node_modules" (
    echo Installing dependencies...
    npm install
)
echo Starting Live Translator frontend on http://localhost:5173 ...
npm run dev
pause
