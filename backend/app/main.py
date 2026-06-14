import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import init_db
from app.routers import health, providers, sessions, live, websocket
from app.services.translation_pipeline import translation_pipeline
from app.services.ws_manager import ws_manager

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")

logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("huggingface_hub").setLevel(logging.WARNING)
logging.getLogger("filelock").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)

app = FastAPI(title="Live Translator", version="0.2.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "chrome-extension://*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(providers.router)
app.include_router(sessions.router)
app.include_router(live.router)
app.include_router(websocket.router)


async def _on_translation_result(result):
    await ws_manager.broadcast_live(result.session_id, {
        "type": "translation_update",
        "session_id": result.session_id,
        "segment_id": result.segment_id,
        "translated_text": result.translated_text,
        "provider_name": result.provider_name,
        "model": result.model,
        "latency_translate_ms": round(result.latency_ms, 2),
        "status": "translated" if result.status == "completed" else "error",
        "error_message": result.error_message,
    })


@app.on_event("startup")
async def on_startup():
    init_db()
    translation_pipeline.on_result(_on_translation_result)
    await translation_pipeline.start()


@app.on_event("shutdown")
async def on_shutdown():
    await translation_pipeline.stop()
