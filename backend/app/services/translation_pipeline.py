import asyncio
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class TranslationJob:
    session_id: int
    segment_id: int
    source_text: str
    source_language: str
    mode: str = "realtime"


@dataclass
class TranslationJobResult:
    session_id: int
    segment_id: int
    translated_text: str
    provider_name: str
    model: str
    latency_ms: float
    status: str
    error_message: Optional[str] = None


class TranslationPipeline:
    def __init__(self):
        self._queue: asyncio.Queue[TranslationJob] = asyncio.Queue()
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._on_result_callbacks: list = []

    def on_result(self, callback):
        self._on_result_callbacks.append(callback)

    def remove_callback(self, callback):
        if callback in self._on_result_callbacks:
            self._on_result_callbacks.remove(callback)

    async def start(self):
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._process_loop())
        logger.info("Translation pipeline started")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("Translation pipeline stopped")

    async def submit(self, job: TranslationJob):
        await self._queue.put(job)

    async def _process_loop(self):
        while self._running:
            try:
                job = await asyncio.wait_for(self._queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

            result = await self._translate_job(job)
            for cb in self._on_result_callbacks:
                try:
                    await cb(result)
                except Exception as e:
                    logger.error(f"Translation result callback error: {e}")

    async def _translate_job(self, job: TranslationJob) -> TranslationJobResult:
        from app.database import SessionLocal
        from app import crud, translator as translator_mod

        db = SessionLocal()
        try:
            session = crud.get_session(db, job.session_id)
            if not session:
                return TranslationJobResult(
                    session_id=job.session_id, segment_id=job.segment_id,
                    translated_text="", provider_name="", model="",
                    latency_ms=0, status="error", error_message="Session not found"
                )

            provider = None
            if session.provider_id:
                provider = crud.get_provider(db, session.provider_id)
            if not provider:
                providers = crud.get_providers(db)
                enabled = [p for p in providers if p.enabled]
                if enabled:
                    provider = enabled[0]

            if not provider:
                crud.update_segment_result(
                    db, job.segment_id,
                    translated_text="", provider_name="none", model="none",
                    latency_ms=0, status="error", error_message="No enabled provider"
                )
                return TranslationJobResult(
                    session_id=job.session_id, segment_id=job.segment_id,
                    translated_text="", provider_name="none", model="none",
                    latency_ms=0, status="error", error_message="No enabled provider"
                )

            result = await translator_mod.translate_text(
                provider=provider,
                source_text=job.source_text,
                source_language=job.source_language,
                mode=job.mode,
            )

            crud.update_segment_result(
                db, job.segment_id,
                translated_text=result.translated_text,
                provider_name=result.provider_name,
                model=result.model,
                latency_ms=result.latency_ms,
                status=result.status,
                error_message=result.error_message,
            )

            return TranslationJobResult(
                session_id=job.session_id,
                segment_id=job.segment_id,
                translated_text=result.translated_text,
                provider_name=result.provider_name,
                model=result.model,
                latency_ms=result.latency_ms,
                status=result.status,
                error_message=result.error_message,
            )
        except Exception as e:
            logger.error(f"Translation job error: {e}")
            return TranslationJobResult(
                session_id=job.session_id, segment_id=job.segment_id,
                translated_text="", provider_name="", model="",
                latency_ms=0, status="error", error_message=str(e)
            )
        finally:
            db.close()


translation_pipeline = TranslationPipeline()
