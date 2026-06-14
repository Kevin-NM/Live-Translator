# Live Translator

Real-time translation tool for Windows 11. Captures Chrome tab audio, transcribes with ASR, and translates to Traditional Chinese.

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+
- ffmpeg (in PATH)
- Chrome browser

### 1. Start Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8787
```

Or double-click `backend/run_backend.bat`.

### 2. Start Frontend

```bash
cd frontend
npm install
npm run dev
```

Or double-click `frontend/run_frontend.bat`.

### 3. Load Chrome Extension

1. Open Chrome → `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `chrome-extension/` folder
5. The extension icon appears in the toolbar

### 4. Setup Provider

1. Open http://localhost:5173 → Providers
2. Click "Add Provider"
3. Enter base_url, api_key, model
4. Click "Test" to verify

### 5. Create Chrome Live Session

**Option A: From Chrome Extension**
1. Open the YouTube / live stream tab
2. Click the extension icon
3. Click "Create Session from Tab"
4. Session is auto-created with tab title

**Option B: From Web UI**
1. Go to Sessions → New Session
2. Enter title, select source language
3. Go to session detail → switch to "Chrome Live" tab

### 6. Start Live Translation

1. In the Chrome Extension popup, select the session
2. Click "Start Capture"
3. Go to Web UI session detail → Chrome Live tab
4. Watch real-time subtitles appear (source + translation)

### 7. Stop & Export

1. Click "Stop Capture" in extension or "Stop Session" in Web UI
2. Click "Export JSON" or "Export CSV" to download

## Architecture

```
Chrome Tab Audio
  → Chrome Extension (MediaRecorder webm/opus)
  → WebSocket /ws/audio/{session_id}
  → ffmpeg decode → PCM 16kHz
  → faster-whisper ASR
  → OpenAI-compatible API translation
  → WebSocket /ws/live/{session_id}
  → Web UI real-time display
  → SQLite persistence
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/providers` | CRUD | Provider management |
| `/api/sessions` | CRUD | Session management |
| `/api/sessions/from-chrome-tab` | POST | Create Chrome tab session |
| `/api/sessions/{id}/translate` | POST | Manual translate |
| `/api/sessions/{id}/live/start` | POST | Start live mode |
| `/api/sessions/{id}/live/stop` | POST | Stop live mode |
| `/api/sessions/{id}/segments` | GET | Get segments |
| `/api/sessions/{id}/export` | GET | Export JSON/CSV |
| `/api/audio/status` | GET | Audio pipeline status |
| `/api/settings` | GET/PATCH | ASR settings |
| `/ws/audio/{session_id}` | WS | Audio input |
| `/ws/live/{session_id}` | WS | Live subtitle output |

## Tech Stack

- **Backend**: Python 3.11+, FastAPI, SQLite, SQLAlchemy, Pydantic, httpx
- **ASR**: faster-whisper (small/medium/large-v3-turbo)
- **Frontend**: React 18, Vite, TailwindCSS, Axios, React Router
- **Extension**: Chrome Manifest V3, tabCapture, MediaRecorder, WebSocket

## Settings

| Setting | Default | Options |
|---------|---------|---------|
| ASR Model | small | small, medium, large-v3-turbo |
| Device | auto | auto, cuda, cpu |
| Compute Type | int8_float16 | int8_float16, float16, int8 |
| Chunk Seconds | 3 | 2, 3, 4 |
| Source Language | ja | ja, en, auto |
